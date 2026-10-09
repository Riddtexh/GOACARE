'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.GOACARE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-api-'));
process.env.GOACARE_STAFF_CODE = 'TEST-STAFF-CODE';
const { createServer } = require('../server');
const db = require('../db');

let server, base;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

const call = (method, p, body, cookie) => fetch(base + p, {
  method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined
});
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
async function register(extra) {
  const res = await call('POST', '/api/auth/register', { password: 'secret1', ...extra });
  return { res, cookie: cookieOf(res), body: await res.json() };
}
const tomorrow = () => new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);

test('seed data is clean: no duplicate hospitals, no 108 placeholder phones, doctors linked to facilities', async () => {
  const fac = (await (await call('GET', '/api/facilities')).json()).facilities;
  assert.equal(new Set(fac.map(f => f.id)).size, fac.length);
  assert.ok(!fac.some(f => f.id === 'healthway-oldgoa'));
  assert.ok(!fac.some(f => f.phone.trim() === '108'));
  assert.ok(fac.every(f => f.phoneVerified === !!f.phone));
  const docs = (await (await call('GET', '/api/doctors')).json()).doctors;
  assert.ok(docs.every(d => fac.some(f => f.id === d.facilityId)));
});

test('roles: staff sign-up needs the staff code and a linked hospital / doctor', async () => {
  const noCode = await register({ name: 'Nurse Priya', phone: '9000000001', role: 'hospital', facilityId: 'gmc-bambolim', staffCode: 'nope' });
  assert.equal(noCode.res.status, 403);
  const noFacility = await register({ name: 'Nurse Priya', phone: '9000000001', role: 'hospital', staffCode: 'TEST-STAFF-CODE' });
  assert.equal(noFacility.res.status, 400);
  const ok = await register({ name: 'Nurse Priya', phone: '9000000001', role: 'hospital', facilityId: 'gmc-bambolim', staffCode: 'TEST-STAFF-CODE' });
  assert.equal(ok.res.status, 201);
  assert.equal(ok.body.user.role, 'hospital');
  assert.equal(ok.body.user.facilityId, 'gmc-bambolim');
  const bad = await register({ name: 'X Y', phone: '9000000002', role: 'admin' });
  assert.equal(bad.res.status, 400);
});

test('hospital staff can change their own beds; patients and other hospitals cannot; patients see the change', async () => {
  const staff = await register({ name: 'Ward Admin', phone: '9000000010', role: 'hospital', facilityId: 'asilo-mapusa', staffCode: 'TEST-STAFF-CODE' });
  const patient = await register({ name: 'Asha Naik', phone: '9000000011', role: 'patient' });
  const body = { icuBeds: 7, oxygenBeds: 21, generalBeds: 33 };
  assert.equal((await call('PUT', '/api/facilities/asilo-mapusa/beds', body)).status, 401);
  assert.equal((await call('PUT', '/api/facilities/asilo-mapusa/beds', body, patient.cookie)).status, 403);
  assert.equal((await call('PUT', '/api/facilities/gmc-bambolim/beds', body, staff.cookie)).status, 403);
  assert.equal((await call('PUT', '/api/facilities/asilo-mapusa/beds', { ...body, icuBeds: -1 }, staff.cookie)).status, 400);

  const first = await call('GET', '/api/facilities');
  const etag = first.headers.get('etag');
  assert.equal((await call('PUT', '/api/facilities/asilo-mapusa/beds', body, staff.cookie)).status, 200);
  const again = await fetch(base + '/api/facilities', { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 200);
  const f = (await again.json()).facilities.find(x => x.id === 'asilo-mapusa');
  assert.deepEqual([f.icuBeds, f.oxygenBeds, f.generalBeds], [7, 21, 33]);
  assert.ok(f.staffUpdatedAt);
  const impact = await (await call('GET', '/api/impact')).json();
  assert.ok(impact.facilitiesLive >= 1);
});

test('doctor status: a doctor changes only themselves; a hospital changes its own doctors; substitute appears', async () => {
  const doc = db.getDoctor(1);                      // Cardiology at GMC
  const self = await register({ name: doc.name, phone: '9000000020', role: 'doctor', doctorId: doc.id, staffCode: 'TEST-STAFF-CODE' });
  assert.equal(self.body.user.doctorId, doc.id);
  assert.equal((await call('PUT', '/api/doctors/2/status', { status: 'On Call' }, self.cookie)).status, 403);
  assert.equal((await call('PUT', '/api/doctors/1/status', { status: 'Napping' }, self.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/doctors/1/status', { status: 'In Surgery' }, self.cookie)).status, 200);
  const list = (await (await call('GET', '/api/doctors')).json()).doctors;
  const d1 = list.find(d => d.id === 1);
  assert.equal(d1.status, 'In Surgery');
  const cardio = list.filter(d => d.spec === 'Cardiology' && d.id !== 1 && d.status === 'Available');
  if (cardio.length) { assert.ok(d1.substitute); assert.equal(d1.substitute.name === d1.name, false); }
  const hosp = await register({ name: 'Other Hospital', phone: '9000000021', role: 'hospital', facilityId: 'hospicio-margao', staffCode: 'TEST-STAFF-CODE' });
  assert.equal((await call('PUT', '/api/doctors/1/status', { status: 'Available' }, hosp.cookie)).status, 403);
});

test('crowd = booked load + reported wait (no random numbers)', async () => {
  const p = await register({ name: 'Ravi Kamat', phone: '9000000030', role: 'patient' });
  await call('POST', '/api/me/consent', { accept: true }, p.cookie);
  const date = tomorrow();
  const before = await (await call('GET', '/api/crowd?date=' + date)).json();
  assert.deepEqual(before.load, {});
  const a = await call('POST', '/api/me/appointments', { key: 'd:2', date, time: '10:00', reason: 'knee pain' }, p.cookie);
  assert.equal(a.status, 201);
  assert.equal((await call('POST', '/api/me/appointments', { key: 'd:2', date, time: '10:00' }, p.cookie)).status, 409);   // same person, same slot
  const after = await (await call('GET', '/api/crowd?date=' + date)).json();
  assert.equal(after.load['d:2']['10:00'], 1);
  // a wait report for a facility shows up, and a second report from the same person is throttled
  assert.equal((await call('POST', '/api/facilities/gmc-bambolim/wait', { minutes: 45 }, p.cookie)).status, 201);
  assert.equal((await call('POST', '/api/facilities/gmc-bambolim/wait', { minutes: 50 }, p.cookie)).status, 429);
  assert.equal((await call('POST', '/api/facilities/gmc-bambolim/wait', { minutes: 5000 }, p.cookie)).status, 400);
  const now = await (await call('GET', '/api/crowd')).json();
  assert.equal(now.waits['gmc-bambolim'].minutes, 45);
});

test('slot capacity is enforced across users, and staff confirm requests', async () => {
  const date = tomorrow();
  const users = [];
  for (let i = 0; i < 5; i++) { const u = await register({ name: 'Patient ' + i + 'x', phone: '91000000' + String(i).padStart(2, '0'), role: 'patient' }); await call('POST', '/api/me/consent', { accept: true }, u.cookie); users.push(u); }
  const codes = [];
  for (const u of users) codes.push((await call('POST', '/api/me/appointments', { key: 'd:3', date, time: '09:30', reason: 'check' }, u.cookie)).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 409]);   // doctor slot capacity is 4

  const doc3 = db.getDoctor(3);
  const hosp = await register({ name: 'Admin Three', phone: '9000000040', role: 'hospital', facilityId: doc3.facilityId, staffCode: 'TEST-STAFF-CODE' });
  const reqs = (await (await call('GET', '/api/staff/appointments', undefined, hosp.cookie)).json()).appointments;
  assert.ok(reqs.length >= 4);
  const id = reqs[0].id;
  assert.equal((await call('PUT', `/api/appointments/${id}/status`, { status: 'Confirmed' }, hosp.cookie)).status, 200);
  const mine = (await (await call('GET', '/api/me/data', undefined, users[0].cookie)).json()).appointments;
  assert.ok(mine.some(a => a.id === id ? a.status === 'Confirmed' : true));
  const other = await register({ name: 'Elsewhere Admin', phone: '9000000041', role: 'hospital', facilityId: 'chc-valpoi', staffCode: 'TEST-STAFF-CODE' });
  assert.equal((await call('PUT', `/api/appointments/${id}/status`, { status: 'Declined' }, other.cookie)).status, 403);
});

test('triage routes to the nearest facility with the right bed, not just GMC; red flags call 108', async () => {
  // someone in Canacona (far south) with chest pain must not be sent to GMC Bambolim
  db.setBeds('chc-canacona', 3, 8, 24);
  const r = await (await call('GET', '/api/triage?symptom=chest_pain&lat=15.0139&lng=74.0231')).json();
  assert.equal(r.level, 'red'); assert.equal(r.call108, true);
  assert.ok(r.recommendations.length > 0);
  assert.ok(r.recommendations.every(x => x.freeBeds.icu > 0));
  assert.notEqual(r.recommendations[0].id, 'gmc-bambolim');
  assert.ok(r.recommendations[0].distanceKm < 60);
  assert.equal(r.redirectedFromGmc, true);

  // maternity is not the generic OPD message
  const m = await (await call('GET', '/api/triage?symptom=maternity&lat=15.5&lng=73.83')).json();
  assert.equal(m.level, 'red'); assert.equal(m.need, 'general');
  const fever = await (await call('GET', '/api/triage?symptom=fever')).json();
  assert.equal(fever.level, 'amber');
  assert.equal((await call('GET', '/api/triage?symptom=nonsense')).status, 400);

  // a facility with zero ICU beds is never recommended for an ICU case
  db.raw.prepare("UPDATE facilities SET icu_beds = 0").run();
  const none = await (await call('GET', '/api/triage?symptom=stroke&lat=15.5&lng=73.83')).json();
  assert.equal(none.recommendations.length, 0);
  const impact = await (await call('GET', '/api/impact')).json();
  assert.ok(impact.redirectsThisWeek >= 1);
});

test('"less crowded alternative" suggests a public facility when GMC is crowded', async () => {
  const ids = ['gmc-bambolim'];
  for (let i = 0; i < 12; i++) db.addWaitReport('gmc-bambolim', 90, 'demo', null);
  const r = await (await call('GET', '/api/alternatives?facilityId=gmc-bambolim&specialty=Pediatrics')).json();
  assert.equal(r.crowded, true);
  assert.ok(r.alternatives.length > 0);
  assert.ok(r.alternatives.every(a => a.id !== 'gmc-bambolim'));
  assert.equal((await call('POST', '/api/redirects', { from: 'gmc-bambolim', to: r.alternatives[0].id })).status, 201);
});

test('privacy: consent gate, server-side records, per-user isolation, export and delete-my-data', async () => {
  const a = await register({ name: 'Maria Dias', phone: '9200000001', role: 'patient' });
  const b = await register({ name: 'John Pinto', phone: '9200000002', role: 'patient' });
  const rec = { date: '2026-08-14', facility: 'GMC / Dr X', diagnosis: 'Check-up', prescription: 'Rest', followup: '' };
  const blocked = await call('POST', '/api/me/records', rec, a.cookie);
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'consent_required');
  assert.equal((await call('POST', '/api/me/consent', { accept: true }, a.cookie)).status, 200);
  assert.equal((await call('POST', '/api/me/consent', { accept: true }, b.cookie)).status, 200);
  const saved = await (await call('POST', '/api/me/records', rec, a.cookie)).json();
  assert.ok(saved.record.id);
  assert.equal((await call('PUT', '/api/me/profile', { name: 'Maria Dias', bloodGroup: 'O+ Positive', allergies: 'Penicillin' }, a.cookie)).status, 200);
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const rx = await call('POST', '/api/me/prescriptions', { date: '2026-08-14', doctor: 'Dr X', note: 'BP', img: jpeg }, a.cookie);
  assert.equal(rx.status, 201);
  const rxId = (await rx.json()).prescription.id;
  assert.equal((await call('GET', `/api/me/prescriptions/${rxId}/image`, undefined, a.cookie)).status, 200);
  assert.equal((await call('GET', `/api/me/prescriptions/${rxId}/image`, undefined, b.cookie)).status, 404);   // other users cannot read it
  assert.equal((await call('DELETE', `/api/me/records/${saved.record.id}`, undefined, b.cookie)).status, 404);

  const claim = await (await call('POST', '/api/me/claims', { procedure: 'Knee replacement', hospital: 'Manipal', amount: 85000, submittedOn: '2026-09-01' }, a.cookie)).json();
  assert.equal(claim.claim.stage, 'Submitted');
  assert.equal((await call('PUT', `/api/me/claims/${claim.claim.id}`, { stage: 'Documents verified' }, a.cookie)).status, 200);
  assert.equal((await call('PUT', `/api/me/claims/${claim.claim.id}`, { stage: 'Teleported' }, a.cookie)).status, 400);

  const mine = await (await call('GET', '/api/me/data', undefined, a.cookie)).json();
  assert.equal(mine.records.length, 1); assert.equal(mine.profile.allergies, 'Penicillin'); assert.equal(mine.claims[0].stage, 'Documents verified');
  const theirs = await (await call('GET', '/api/me/data', undefined, b.cookie)).json();
  assert.equal(theirs.records.length, 0);
  const exp = await call('GET', '/api/me/export', undefined, a.cookie);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
  assert.equal((await exp.json()).records.length, 1);

  assert.equal((await call('DELETE', '/api/me', {}, a.cookie)).status, 400);
  assert.equal((await call('DELETE', '/api/me', { confirm: 'DELETE' }, a.cookie)).status, 200);
  assert.equal((await call('GET', '/api/me/data', undefined, a.cookie)).status, 401);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM records WHERE id = ?').get(saved.record.id).n, 0);   // really gone from the database
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM prescriptions WHERE id = ?').get(rxId).n, 0);
  assert.equal((await call('POST', '/api/auth/login', { phone: '9200000001', password: 'secret1' })).status, 401);
});

test('crowd and demo data: simulated rows are flagged so the UI can label them', async () => {
  db.clearDemo();
  const c = await (await call('GET', '/api/crowd')).json();
  assert.equal(c.demo.bookings, 0);
  assert.equal(c.demo.waitReports, 0);
});

test('admin: cannot be created through sign-up; only admins can read registered users; secrets and photos stay hidden; views are logged', async () => {
  // sign-up refuses the admin role even with the staff code
  const sneaky = await register({ name: 'Sneaky One', phone: '9300000009', role: 'admin', staffCode: 'TEST-STAFF-CODE' });
  assert.equal(sneaky.res.status, 400);

  const patient = await register({ name: 'Sunil Prabhu', phone: '9300000001' });
  const admin = await register({ name: 'Admin Anita', phone: '9300000002' });

  // guests and ordinary accounts are kept out
  assert.equal((await call('GET', '/api/admin/users')).status, 401);
  assert.equal((await call('GET', '/api/admin/users', undefined, patient.cookie)).status, 403);
  assert.equal((await call('GET', '/api/admin/users/1', undefined, patient.cookie)).status, 403);
  assert.equal((await call('GET', '/api/admin/audit', undefined, patient.cookie)).status, 403);

  // the patient stores some data
  await call('POST', '/api/me/consent', { accept: true }, patient.cookie);
  await call('PUT', '/api/me/profile', { name: 'Sunil Prabhu', phone: '9300000001', bloodGroup: 'O+', allergies: 'Penicillin' }, patient.cookie);
  await call('POST', '/api/me/records', { date: '2026-09-01', facility: 'Dr Rao', diagnosis: 'Viral fever', prescription: 'Rest and fluids' }, patient.cookie);
  const img = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');
  await call('POST', '/api/me/prescriptions', { date: '2026-09-01', doctor: 'Dr Rao', note: 'fever', img }, patient.cookie);

  // promoting an account (what `npm run make-admin` does) takes effect on the very next request
  db.setUserRole(admin.body.user.id, 'admin');
  const all = await call('GET', '/api/admin/users', undefined, admin.cookie);
  assert.equal(all.status, 200);
  const list = await all.json();
  const sunil = list.users.find(u => u.name === 'Sunil Prabhu');
  assert.ok(sunil);
  assert.equal(sunil.counts.records, 1);
  assert.equal(sunil.counts.prescriptions, 1);
  assert.ok(list.byRole.admin >= 1);
  const text = JSON.stringify(list);
  assert.ok(!/password|hash|salt|token/i.test(text), 'no secrets in the list');

  const found = await (await call('GET', '/api/admin/users?q=prabhu', undefined, admin.cookie)).json();
  assert.deepEqual(found.users.map(u => u.name), ['Sunil Prabhu']);
  assert.equal((await (await call('GET', '/api/admin/users?q=%25', undefined, admin.cookie)).json()).users.length, 0);   // % is searched literally

  const detail = await (await call('GET', '/api/admin/users/' + sunil.id, undefined, admin.cookie)).json();
  assert.equal(detail.profile.bloodGroup, 'O+');
  assert.equal(detail.records[0].diagnosis, 'Viral fever');
  assert.equal(detail.prescriptions.length, 1);
  assert.ok(!('imgUrl' in detail.prescriptions[0]) && !JSON.stringify(detail).includes('base64'), 'prescription photo is not exposed');
  assert.ok(!/password|hash|salt|token/i.test(JSON.stringify(detail)));
  assert.equal((await call('GET', '/api/admin/users/99999', undefined, admin.cookie)).status, 404);

  // everything the admin did was logged
  const audit = (await (await call('GET', '/api/admin/audit', undefined, admin.cookie)).json()).audit;
  assert.ok(audit.some(a => a.action === 'view_user' && a.targetUserId === sunil.id && a.admin === 'Admin Anita'));
  assert.ok(audit.some(a => a.action === 'list_users'));

  // an admin account cannot be used to edit hospital data
  assert.equal((await call('PUT', '/api/facilities/gmc-bambolim/beds', { icuBeds: 1, oxygenBeds: 1, generalBeds: 1 }, admin.cookie)).status, 403);

  // revoking takes effect immediately too
  db.setUserRole(admin.body.user.id, 'patient');
  assert.equal((await call('GET', '/api/admin/users', undefined, admin.cookie)).status, 403);
});
