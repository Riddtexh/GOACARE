'use strict';
// Wards, crowd, costs, stores, assets, doctor management, role permissions and the public feed.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.GOACARE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-ops-'));
process.env.GOACARE_STAFF_CODE = 'TEST-STAFF-CODE';
const { createServer } = require('../server');
const db = require('../db');
const ops = require('../ops-db');

let server, base;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const call = (method, p, body, cookie) => fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
const json = async (m, p, b, c) => { const r = await call(m, p, b, c); return { status: r.status, body: await r.json().catch(() => null), res: r }; };
let phone = 9400000000;
async function register(extra) {
  const res = await call('POST', '/api/auth/register', { password: 'secret1', name: 'Test Person', phone: String(phone++), staffCode: 'TEST-STAFF-CODE', ...extra });
  return { status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0], user: (await res.json()).user };
}
const staff = (facilityId, staffRole) => register({ role: 'hospital', facilityId, staffRole, name: (staffRole || 'manager') + ' ' + facilityId });
const GMC = 'gmc-bambolim', ASILO = 'asilo-mapusa', MARGAO = 'hospicio-margao';
async function admin() { const a = await register({ role: 'patient', staffCode: undefined }); db.setUserRole(a.user.id, 'admin'); return a; }

test('staff roles: sign-up validates the role, the user carries a permission map, and the server enforces it', async () => {
  assert.equal((await register({ role: 'hospital', facilityId: GMC, staffRole: 'ceo' })).status, 400);
  const mgr = await staff(GMC), nurse = await staff(GMC, 'nurse'), rec = await staff(GMC, 'reception');
  assert.equal(mgr.user.staffRole, 'manager');   // default keeps existing behaviour
  assert.equal(nurse.user.caps.beds, 'write'); assert.equal(nurse.user.caps.costs, 'view'); assert.equal(rec.user.caps.stores, null); assert.equal(rec.user.caps.appointments, 'write');
  const ward = { total: 20, available: 5, occupied: 14, outOfService: 1 };
  assert.equal((await call('PUT', '/api/staff/wards/icu', ward, rec.cookie)).status, 403, 'reception cannot edit beds');
  assert.equal((await call('PUT', '/api/staff/wards/icu', ward, nurse.cookie)).status, 200);
  assert.equal((await call('POST', '/api/staff/crowd', { level: 'Busy' }, rec.cookie)).status, 201, 'everyone may update the crowd level');
  const cost = { serviceName: 'Consultation', minCost: 100, maxCost: 300 };
  assert.equal((await call('POST', '/api/staff/costs', cost, nurse.cookie)).status, 403);
  assert.equal((await call('GET', '/api/staff/costs', undefined, nurse.cookie)).status, 200, 'nurses may read costs');
  assert.equal((await call('GET', '/api/staff/stores', undefined, rec.cookie)).status, 403, 'reception has no access to stores');
  assert.equal((await call('GET', '/api/staff/assets', undefined, rec.cookie)).status, 403);
  assert.equal((await call('GET', '/api/staff/assets', undefined, nurse.cookie)).status, 200);
  assert.equal((await call('PUT', `/api/facilities/${GMC}/beds`, { icuBeds: 1, oxygenBeds: 1, generalBeds: 1 }, rec.cookie)).status, 403, 'the older beds endpoint obeys the same roles');
  assert.equal((await call('POST', '/api/staff/doctors', { name: 'Dr X Y', spec: 'ENT', timings: '9-1', room: 'R1' }, nurse.cookie)).status, 403);
  assert.equal((await call('POST', '/api/staff/units', { name: 'Nurse Unit', type: 'opd' }, nurse.cookie)).status, 403);
  assert.equal((await call('GET', '/api/staff/team', undefined, nurse.cookie)).status, 403);
  // doctors' duty: reception and manager yes, nurse no
  const d = db.listDoctors().find(x => x.facilityId === GMC).id;
  assert.equal((await call('PUT', `/api/doctors/${d}/status`, { dutyStatus: 'On Leave' }, nurse.cookie)).status, 403);
  assert.equal((await call('PUT', `/api/doctors/${d}/status`, { dutyStatus: 'On Leave' }, rec.cookie)).status, 200);
  assert.equal((await call('PUT', `/api/doctors/${d}/status`, { dutyStatus: 'Sleeping' }, rec.cookie)).status, 400);
  const appt = await json('GET', '/api/staff/appointments', undefined, rec.cookie); assert.equal(appt.status, 200);
  // team management
  const t = await json('GET', '/api/staff/team', undefined, mgr.cookie);
  assert.ok(t.body.team.some(m => m.id === nurse.user.id && m.staffRole === 'nurse') && t.body.team.every(m => !('password_hash' in m)));
  assert.equal((await call('PUT', `/api/staff/team/${nurse.user.id}`, { staffRole: 'manager' }, rec.cookie)).status, 403);
  assert.equal((await call('PUT', `/api/staff/team/${nurse.user.id}`, { staffRole: 'root' }, mgr.cookie)).status, 400);
  assert.equal((await call('PUT', `/api/staff/team/${nurse.user.id}`, { staffRole: 'reception' }, mgr.cookie)).status, 200);
  assert.equal(db.findUserById(nurse.user.id).staffRole, 'reception');
  const other = await staff(ASILO);
  assert.equal((await call('PUT', `/api/staff/team/${nurse.user.id}`, { staffRole: 'manager' }, other.cookie)).status, 404, 'another hospital cannot touch this team');
  for (const m of t.body.team.filter(x => x.staffRole === 'manager' && x.id !== mgr.user.id)) await call('PUT', `/api/staff/team/${m.id}`, { staffRole: 'nurse' }, mgr.cookie);
  assert.equal((await call('PUT', `/api/staff/team/${mgr.user.id}`, { staffRole: 'nurse' }, mgr.cookie)).status, 409, 'the last manager cannot be demoted');
});

test('wards: validation, per-ward save, audit, and ICU / General mirror onto the counts the patient site reads', async () => {
  const m = await staff(ASILO);
  const put = (type, b) => json('PUT', '/api/staff/wards/' + type, b, m.cookie);
  assert.equal((await put('vip', { total: 5, available: 1 })).status, 404);
  assert.equal((await put('icu', { total: 10 })).status, 400, 'available is required');
  assert.equal((await put('icu', { total: 10, available: 2.5 })).status, 400);
  assert.equal((await put('icu', { total: 10, available: -1 })).status, 400);
  assert.equal((await put('icu', { total: 10, available: 11 })).status, 400);
  assert.match((await put('icu', { total: 10, available: 5, occupied: 5, outOfService: 2 })).body.error, /cannot be more than the total capacity \(10\)/);
  assert.equal((await put('icu', { total: 10, available: 3, occupied: 6, outOfService: 1, notes: 'Ventilator bay 2 down' })).status, 200);
  const g = await json('GET', '/api/staff/wards', undefined, m.cookie);
  const icu = g.body.wards.find(w => w.type === 'icu');
  assert.deepEqual([icu.total, icu.available, icu.occupied, icu.outOfService, icu.notes], [10, 3, 6, 1, 'Ventilator bay 2 down']);
  assert.ok(icu.updatedAt && icu.updatedBy); assert.equal(g.body.wards.find(w => w.type === 'maternity').available, null, 'unrecorded wards are null, not 0');
  assert.equal(Object.keys(g.body.types).length, 5);
  const f = db.getStaffFacility(ASILO); assert.deepEqual([f.icuBeds, f.totalIcuBeds], [3, 10]);
  assert.ok((await json('GET', '/api/facilities')).body.facilities.find(x => x.id === ASILO).icuBeds === 3, 'public directory shows the ward figure');
  await put('maternity', { total: 8, available: 4 });
  assert.equal(db.getFacility(ASILO).icuBeds, 3, 'wards without a public counterpart do not touch the facility counts');
  assert.equal((await put('maternity', { total: 8, available: 4, occupied: null })).body.ward.occupied, null);
  const act = (await json('GET', '/api/staff/activity?limit=20', undefined, m.cookie)).body.items;
  assert.ok(act.some(a => a.action === 'ward_updated' && a.detail.ward === 'ICU' && a.detail.after.available === 3));
});

test('crowd and waiting time: validated, quick re-verify, outdated after 2 hours, feeds the patient crowd estimate', async () => {
  const m = await staff(MARGAO);
  assert.equal((await json('GET', '/api/staff/crowd', undefined, m.cookie)).body.current, null);
  assert.equal((await call('POST', '/api/staff/crowd/verify', {}, m.cookie)).status, 409);
  assert.equal((await call('POST', '/api/staff/crowd', { level: 'Packed' }, m.cookie)).status, 400);
  assert.equal((await call('POST', '/api/staff/crowd', { level: 'Busy', waitMinutes: 999 }, m.cookie)).status, 400);
  assert.equal((await call('POST', '/api/staff/crowd', { level: 'Busy', queueCount: -3 }, m.cookie)).status, 400);
  const r = await json('POST', '/api/staff/crowd', { level: 'Very Busy', waitMinutes: 70, queueCount: 38 }, m.cookie);
  assert.equal(r.status, 201); assert.equal(r.body.current.level, 'Very Busy'); assert.equal(r.body.current.stale, false);
  assert.equal((await json('GET', '/api/crowd')).body.waits[MARGAO].minutes, 70, 'the wait reaches the patient crowd estimate');
  const v = await json('POST', '/api/staff/crowd/verify', {}, m.cookie);
  assert.equal(v.status, 200); assert.equal(v.body.current.queueCount, 38);
  assert.equal((await json('GET', '/api/staff/crowd', undefined, m.cookie)).body.history.length, 2);
  db.raw.exec("UPDATE crowd_updates SET verified_at = '2020-01-01T00:00:00Z'");
  assert.equal((await json('GET', '/api/staff/crowd', undefined, m.cookie)).body.current.stale, true);
  assert.ok((await json('GET', '/api/staff/overview', undefined, m.cookie)).body.alerts.some(a => /Outdated: the crowd/.test(a.text)));
  const pub = (await json('GET', '/api/public/operations')).body.hospitals[MARGAO].crowd;
  assert.equal(pub.outdated, true); assert.match(pub.source, /Not a live sensor feed/);
});

test('costs, services, stores and assets: CRUD, validation, duplicates, hospital isolation, audit', async () => {
  const a = await staff(GMC), b = await staff(ASILO);
  const costs = '/api/staff/costs';
  assert.equal((await call('POST', costs, { serviceName: 'X-ray', minCost: 500, maxCost: 100 }, a.cookie)).status, 400, 'min > max');
  assert.equal((await call('POST', costs, { serviceName: 'X-ray', minCost: -5, maxCost: 100 }, a.cookie)).status, 400);
  assert.equal((await call('POST', costs, { serviceName: '', minCost: 1, maxCost: 100 }, a.cookie)).status, 400);
  const c = await json('POST', costs, { serviceName: 'Chest X-ray', minCost: 250, maxCost: 600, notes: 'Public rate' }, a.cookie);
  assert.equal(c.status, 201); assert.equal(c.body.item.estimate, true);
  assert.equal((await call('POST', costs, { serviceName: 'chest x-ray', minCost: 1, maxCost: 2 }, a.cookie)).status, 409);
  assert.equal((await call('PUT', `${costs}/${c.body.item.id}`, { serviceName: 'Hacked', minCost: 1, maxCost: 2 }, b.cookie)).status, 404, 'other hospital');
  assert.equal((await call('DELETE', `${costs}/${c.body.item.id}`, undefined, b.cookie)).status, 404);
  assert.equal((await json('PUT', `${costs}/${c.body.item.id}`, { serviceName: 'Chest X-ray', minCost: 300, maxCost: 700 }, a.cookie)).body.item.maxCost, 700);
  assert.equal((await json('GET', costs, undefined, b.cookie)).body.items.length, 0);
  // services
  assert.equal((await call('POST', '/api/staff/services', { name: 'Cardiology', kind: 'ward' }, a.cookie)).status, 400);
  assert.equal((await call('POST', '/api/staff/services', { name: 'Cardiology', kind: 'department' }, a.cookie)).status, 201);
  assert.equal((await call('POST', '/api/staff/services', { name: 'cardiology', kind: 'department' }, a.cookie)).status, 409);
  // stores: verification is explicit and resets when the note changes
  const st = '/api/staff/stores';
  assert.equal((await call('POST', st, { name: 'Jan Aushadhi', availabilityVerified: true }, a.cookie)).status, 400, 'cannot verify an empty note');
  assert.equal((await call('POST', st, { name: 'Jan Aushadhi', contact: 'not a number' }, a.cookie)).status, 400);
  const s1 = (await json('POST', st, { name: 'Jan Aushadhi', location: 'Ground floor', contact: '+91 832 100 2000', hours: '8-8', availabilityNote: 'Paracetamol in stock', availabilityVerified: true }, a.cookie)).body.item;
  assert.ok(s1.availabilityVerifiedAt && s1.availabilityVerifiedBy);
  assert.equal((await json('PUT', `${st}/${s1.id}`, { name: 'Jan Aushadhi', availabilityNote: 'Paracetamol out of stock' }, a.cookie)).body.item.availabilityVerifiedAt, null, 'edited note is no longer verified');
  assert.equal((await json('PUT', `${st}/${s1.id}`, { name: 'Jan Aushadhi', availabilityNote: 'Paracetamol out of stock', availabilityVerified: true }, a.cookie)).body.item.availabilityVerifiedBy !== null, true);
  // assets
  const as = '/api/staff/assets', asset = { name: 'Ventilator', assetNo: 'GMC/VNT-01', category: 'Medical equipment', acquiredOn: '2022-04-01', condition: 'Good', maintenanceStatus: 'Due soon' };
  assert.equal((await call('POST', as, { ...asset, condition: 'Excellent' }, a.cookie)).status, 400);
  assert.equal((await call('POST', as, { ...asset, acquiredOn: '2999-01-01' }, a.cookie)).status, 400);
  assert.equal((await call('POST', as, { ...asset, assetNo: 'bad<script>' }, a.cookie)).status, 400);
  const asr = await json('POST', as, asset, a.cookie); assert.equal(asr.status, 201);
  assert.equal((await call('POST', as, asset, a.cookie)).status, 409, 'asset numbers are unique per hospital');
  assert.equal((await call('POST', as, asset, b.cookie)).status, 201, 'but may repeat at another hospital');
  assert.equal((await call('DELETE', `${as}/${asr.body.item.id}`, undefined, a.cookie)).status, 200);
  assert.equal((await json('GET', as, undefined, a.cookie)).body.items.length, 0);
  const acts = (await json('GET', '/api/staff/activity?limit=50', undefined, a.cookie)).body.items.map(x => x.action);
  for (const x of ['cost_created', 'cost_updated', 'service_created', 'store_created', 'asset_created', 'asset_deleted']) assert.ok(acts.includes(x), x);
});

test('doctors: add, edit, archive; duty and appointment availability reach the patient side', async () => {
  const m = await staff(GMC), other = await staff(ASILO), p = await register({ role: 'patient', staffCode: undefined });
  await call('POST', '/api/me/consent', { accept: true }, p.cookie);
  const good = { name: 'Dr. Meera Kamat', spec: 'Dermatology', department: 'Skin OPD', timings: '10:00 AM - 1:00 PM', room: 'OPD 21', dutyStatus: 'On Duty', acceptsAppointments: true, contact: 'meera@example.org' };
  for (const bad of [{ name: 'M' }, { spec: '' }, { timings: '' }, { dutyStatus: 'Napping' }, { contact: 'call me maybe' }]) assert.equal((await call('POST', '/api/staff/doctors', { ...good, ...bad }, m.cookie)).status, 400);
  const c = await json('POST', '/api/staff/doctors', good, m.cookie); assert.equal(c.status, 201);
  const id = c.body.doctor.id;
  assert.equal(c.body.doctor.facilityId, GMC); assert.equal(c.body.doctor.status, 'Available');
  assert.ok((await json('GET', '/api/doctors')).body.doctors.some(d => d.id === id), 'new doctors appear on the patient list');
  assert.equal((await call('PUT', `/api/staff/doctors/${id}`, good, other.cookie)).status, 404);
  assert.equal((await call('DELETE', `/api/staff/doctors/${id}`, undefined, other.cookie)).status, 404);
  assert.equal((await json('PUT', `/api/staff/doctors/${id}`, { ...good, room: 'OPD 22' }, m.cookie)).body.doctor.room, 'OPD 22');
  // on leave shows as such to patients and never as Available
  await json('PUT', `/api/staff/doctors/${id}`, { ...good, dutyStatus: 'On Leave' }, m.cookie);
  assert.equal((await json('GET', '/api/doctors')).body.doctors.find(d => d.id === id).status, 'On Leave');
  assert.equal((await json('GET', '/api/staff/doctors', undefined, m.cookie)).body.doctors.find(d => d.id === id).status, 'Available', 'staff still see the live status');
  // appointment availability off: booking is refused
  await json('PUT', `/api/staff/doctors/${id}`, { ...good, acceptsAppointments: false }, m.cookie);
  const tomorrow = new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
  const bk = await json('POST', '/api/me/appointments', { key: 'd:' + id, date: tomorrow, time: '10:00' }, p.cookie);
  assert.equal(bk.status, 409); assert.match(bk.body.error, /not taking appointments/);
  // archive: gone from lists and cannot be booked, record kept
  assert.equal((await call('DELETE', `/api/staff/doctors/${id}`, undefined, m.cookie)).status, 200);
  assert.ok(!(await json('GET', '/api/doctors')).body.doctors.some(d => d.id === id));
  assert.ok(!(await json('GET', '/api/staff/doctors', undefined, m.cookie)).body.doctors.some(d => d.id === id));
  assert.equal((await call('POST', '/api/me/appointments', { key: 'd:' + id, date: tomorrow, time: '10:00' }, p.cookie)).status, 404);
  assert.ok(db.getDoctor(id).archived);
});

test('hospital profile: hours, languages, facilities, emergency availability and location are validated and verification resets', async () => {
  const m = await staff(ASILO), ad = await admin();
  const base = { phone: '+91 832 226 2372', address: 'Peddem, Mapusa, Goa 403507', specialties: ['Orthopedics'] };
  assert.equal((await call('PUT', '/api/staff/hospital', { ...base, emergencyAvailable: 'yes' }, m.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/staff/hospital', { ...base, lat: 999 }, m.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/staff/hospital', { ...base, languages: 'English' }, m.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/staff/hospital', { ...base, name: 'A' }, m.cookie)).status, 400);
  await call('PUT', `/api/admin/facilities/${ASILO}/verify`, {}, ad.cookie);
  const r = await json('PUT', '/api/staff/hospital', { ...base, name: 'North Goa District Hospital (Asilo)', emergencyAvailable: true, operatingHours: 'OPD 8 AM - 2 PM; Emergency 24x7', languages: ['English', 'Konkani', 'Hindi'], amenities: ['Pharmacy', 'Blood bank'], lat: 15.6, lng: 73.82 }, m.cookie);
  assert.equal(r.status, 200); assert.equal(r.body.facility.emergencyAvailable, true); assert.deepEqual(r.body.facility.languages, ['English', 'Konkani', 'Hindi']); assert.equal(r.body.facility.infoVerifiedAt, null);
  assert.equal((await json('PUT', '/api/staff/hospital', { ...base, emergencyAvailable: null }, m.cookie)).body.facility.emergencyAvailable, null, 'unknown is allowed');
  // fields left out keep their old values
  assert.deepEqual((await json('GET', '/api/staff/hospital', undefined, m.cookie)).body.facility.languages, ['English', 'Konkani', 'Hindi']);
});

test('public feed: staff-entered data only, demo rows and staff names excluded, verified notes only, outdated flags', async () => {
  const m = await staff(GMC), ad = await admin();
  await call('PUT', '/api/staff/wards/emergency', { total: 12, available: 4, occupied: 8 }, m.cookie);
  await call('POST', '/api/staff/costs', { serviceName: 'MRI brain', minCost: 4000, maxCost: 9000 }, m.cookie);
  await call('POST', '/api/staff/services', { name: 'Cardiology', kind: 'department' }, m.cookie).catch(() => 0);
  await call('POST', '/api/staff/stores', { name: 'Hidden Store', availabilityNote: 'Not verified yet' }, m.cookie);
  // demo rows are inserted straight into the tables, as the demo loader does
  db.raw.exec(`INSERT INTO treatment_costs (facility_id, service_name, min_cost, max_cost, is_demo) VALUES ('${GMC}', 'DEMO ONLY', 1, 2, 1)`);
  db.raw.exec(`INSERT INTO wards (facility_id, ward_type, total_beds, available_beds, is_demo) VALUES ('${GMC}', 'paediatric', 30, 29, 1)`);
  const res = await call('GET', '/api/public/operations'); assert.equal(res.status, 200); assert.ok(res.headers.get('etag'));
  const raw = await res.text(), h = JSON.parse(raw).hospitals[GMC];
  assert.ok(h.beds.wards.some(w => w.type === 'emergency' && w.available === 4)); assert.ok(!h.beds.wards.some(w => w.type === 'paediatric'));
  assert.ok(h.costs.some(c => c.service === 'MRI brain' && c.estimate === true)); assert.ok(!raw.includes('DEMO ONLY'));
  assert.equal(h.beds.outdated, false);
  const hidden = h.stores.find(s => s.name === 'Hidden Store'); assert.equal(hidden.availability, null, 'unverified availability is not published');
  assert.ok(!raw.includes('manager ' + GMC) && !/updatedBy|password|salt/i.test(raw), 'no staff names or secrets');
  assert.equal(h.profile.verification, 'not-confirmed');
  await call('PUT', '/api/staff/hospital', { phone: '', address: 'Bambolim, Tiswadi, Goa 403202', specialties: ['Cardiology'] }, m.cookie);
  assert.equal((await json('GET', '/api/public/operations')).body.hospitals[GMC].profile.verification, 'staff-reported');
  await call('PUT', `/api/admin/facilities/${GMC}/verify`, {}, ad.cookie);
  assert.equal((await json('GET', '/api/public/operations')).body.hospitals[GMC].profile.verification, 'verified');
  db.raw.exec("UPDATE wards SET updated_at = '2020-01-01T00:00:00Z' WHERE is_demo = 0");
  assert.equal((await json('GET', '/api/public/operations')).body.hospitals[GMC].beds.outdated, true);
  // staff pages show demo rows, flagged
  assert.ok((await json('GET', '/api/staff/costs', undefined, m.cookie)).body.items.some(c => c.demo));
});

test('administrators manage the directory but never beds, crowd or appointments; password change works', async () => {
  const ad = await admin(), m = await staff(ASILO);
  assert.equal((await call('POST', '/api/staff/costs', { serviceName: 'ECG', minCost: 100, maxCost: 300 }, ad.cookie)).status, 400, 'admin must name the hospital');
  assert.equal((await call('POST', '/api/staff/costs', { serviceName: 'ECG', minCost: 100, maxCost: 300, facilityId: ASILO }, ad.cookie)).status, 201);
  assert.equal((await call('PUT', '/api/staff/wards/icu', { total: 5, available: 1, facilityId: ASILO }, ad.cookie)).status, 403);
  assert.equal((await call('POST', '/api/staff/crowd', { level: 'Low', facilityId: ASILO }, ad.cookie)).status, 403);
  assert.equal((await call('GET', '/api/staff/crowd?facilityId=' + ASILO, undefined, ad.cookie)).status, 200);
  assert.equal((await call('POST', '/api/staff/doctors', { name: 'Dr. Admin Added', spec: 'ENT', timings: '9-1', room: 'R9', facilityId: ASILO }, ad.cookie)).status, 201);
  // password
  const me = m.user, login = pw => call('POST', '/api/auth/login', { phone: me.phone, password: pw });
  assert.equal((await call('PUT', '/api/auth/password', { current: 'wrong', next: 'newsecret' }, m.cookie)).status, 403);
  assert.equal((await call('PUT', '/api/auth/password', { current: 'secret1', next: '123' }, m.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/auth/password', { current: 'secret1', next: 'newsecret' }, m.cookie)).status, 200);
  assert.equal((await login('secret1')).status, 401); assert.equal((await login('newsecret')).status, 200);
  assert.equal((await call('GET', '/api/auth/me', undefined, m.cookie)).status, 200, 'this session stays signed in');
  assert.equal((await call('PUT', '/api/auth/password', { current: 'x', next: 'newsecret' })).status, 401);
});
