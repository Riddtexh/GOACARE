'use strict';
// Staff / doctor / admin dashboards: hospital isolation, role checks, bed capacity, units, appointments, audit trail.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-staff-'));
process.env.GOACARE_DATA_DIR = dataDir;
process.env.GOACARE_STAFF_CODE = 'TEST-STAFF-CODE';
const { createServer } = require('../server');
const db = require('../db');
const auth = require('../auth');

let server, base;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

const call = (method, p, body, cookie) => fetch(base + p, {
  method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined
});
const json = async (method, p, body, cookie) => { const r = await call(method, p, body, cookie); return { status: r.status, body: await r.json().catch(() => null), res: r }; };
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
let phone = 9100000000;
async function register(extra) {
  const res = await call('POST', '/api/auth/register', { password: 'secret1', name: 'Test Person', phone: String(phone++), staffCode: 'TEST-STAFF-CODE', ...extra });
  return { cookie: cookieOf(res), user: (await res.json()).user };
}
const hospital = facilityId => register({ role: 'hospital', facilityId, name: 'Staff ' + facilityId });
const doctorAcct = doctorId => register({ role: 'doctor', doctorId, name: 'Doctor ' + doctorId });
const patient = () => register({ role: 'patient', staffCode: undefined });
async function admin() { const a = await patient(); db.setUserRole(a.user.id, 'admin'); return a; }
const tomorrow = () => new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);

const GMC = 'gmc-bambolim', ASILO = 'asilo-mapusa';
const docAt = fid => db.listDoctors().filter(d => d.facilityId === fid);

test('dashboard endpoints reject guests, patients and the wrong role', async () => {
  const p = await patient(), d = await doctorAcct(1), h = await hospital(GMC);
  for (const url of ['/api/staff/overview', '/api/staff/units', '/api/staff/doctors', '/api/staff/hospital', '/api/staff/activity', '/api/admin/overview', '/api/admin/facilities', '/api/admin/activity'])
    assert.equal((await call('GET', url)).status, 401, url + ' (guest)');
  for (const url of ['/api/staff/overview', '/api/staff/units', '/api/staff/doctors', '/api/staff/hospital', '/api/staff/activity'])
    assert.equal((await call('GET', url, undefined, p.cookie)).status, 403, url + ' (patient)');
  for (const url of ['/api/admin/overview', '/api/admin/facilities', '/api/admin/activity', '/api/admin/users'])
    for (const who of [p, d, h]) assert.equal((await call('GET', url, undefined, who.cookie)).status, 403, url + ' (' + who.user.role + ')');
  // doctors may read their own overview and doctor list, but not manage units or the hospital record
  assert.equal((await call('GET', '/api/staff/overview', undefined, d.cookie)).status, 200);
  assert.equal((await call('GET', '/api/staff/units', undefined, d.cookie)).status, 403);
  assert.equal((await call('PUT', '/api/staff/hospital', { phone: '', address: 'Somewhere 12345', specialties: [] }, d.cookie)).status, 403);
  assert.equal((await call('POST', '/api/staff/units', { name: 'Doctor unit', type: 'opd' }, d.cookie)).status, 403);
});

test('hospital overview is real data, scoped to the staff member\'s own hospital', async () => {
  const h = await hospital(ASILO);
  const r = await json('GET', '/api/staff/overview', undefined, h.cookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.facility.id, ASILO);
  assert.equal(r.body.doctors.total, docAt(ASILO).length);
  const f = db.getFacility(ASILO);
  assert.deepEqual(r.body.beds.map(b => b.available), [f.icuBeds, f.oxygenBeds, f.generalBeds]);
  assert.ok(r.body.beds.every(b => b.total === null && b.occupied === null), 'capacity unknown must be null, never 0');
  assert.ok(r.body.alerts.some(a => /never been confirmed/.test(a.text)));
  // another hospital's id is refused, not silently replaced
  assert.equal((await call('GET', '/api/staff/overview?facilityId=' + GMC, undefined, h.cookie)).status, 403);
  assert.equal((await call('GET', '/api/staff/units?facilityId=' + GMC, undefined, h.cookie)).status, 403);
  const docs = (await json('GET', '/api/staff/doctors', undefined, h.cookie)).body.doctors;
  assert.ok(docs.length && docs.every(d => d.facilityId === ASILO));
  assert.ok(!JSON.stringify(r.body).match(/password|salt|token_hash/i));
});

test('beds: capacity is validated, occupied is only derived when capacity is known, changes are audited and persisted', async () => {
  const h = await hospital(GMC);
  const url = `/api/facilities/${GMC}/beds`;
  const ok = { icuBeds: 5, oxygenBeds: 10, generalBeds: 40 };
  assert.equal((await call('PUT', url, { ...ok, totalIcuBeds: 4 }, h.cookie)).status, 400, 'free beds cannot exceed capacity');
  assert.equal((await call('PUT', url, { ...ok, totalIcuBeds: -2 }, h.cookie)).status, 400);
  assert.equal((await call('PUT', url, { ...ok, generalBeds: 'lots' }, h.cookie)).status, 400);
  assert.equal((await call('PUT', url, { ...ok, totalIcuBeds: 20, totalGeneralBeds: 100 }, h.cookie)).status, 200);
  let o = (await json('GET', '/api/staff/overview', undefined, h.cookie)).body;
  const by = Object.fromEntries(o.beds.map(b => [b.category, b]));
  assert.deepEqual([by.icu.total, by.icu.available, by.icu.occupied], [20, 5, 15]);
  assert.deepEqual([by.general.total, by.general.occupied], [100, 60]);
  assert.equal(by.oxygen.total, null); assert.equal(by.oxygen.occupied, null);   // unknown, not zero
  assert.ok(o.facility.staffUpdatedAt);
  // updating only the free counts keeps the capacity; an explicit blank resets it to unknown
  assert.equal((await call('PUT', url, { icuBeds: 6, oxygenBeds: 10, generalBeds: 40 }, h.cookie)).status, 200);
  assert.equal(db.getStaffFacility(GMC).totalIcuBeds, 20);
  assert.equal((await call('PUT', url, { icuBeds: 6, oxygenBeds: 10, generalBeds: 40, totalIcuBeds: '' }, h.cookie)).status, 200);
  assert.equal(db.getStaffFacility(GMC).totalIcuBeds, null);
  // audit trail records who and what
  const act = (await json('GET', '/api/staff/activity', undefined, h.cookie)).body;
  assert.ok(act.items.some(a => a.action === 'beds_updated' && a.actor === 'Staff ' + GMC));
  // public directory still has the old shape and exposes no staff-only fields
  const pub = (await (await call('GET', '/api/facilities')).json()).facilities.find(f => f.id === GMC);
  assert.equal(pub.icuBeds, 6); assert.ok(!('totalIcuBeds' in pub) && !('bedsUpdatedBy' in pub));
  // persisted on disk, readable by a separate connection
  const other = new DatabaseSync(path.join(dataDir, 'goacare.db'));
  assert.equal(other.prepare('SELECT icu_beds FROM facilities WHERE id = ?').get(GMC).icu_beds, 6);
  other.close();
});

test('hospital details: validated, saved, and marked awaiting verification until an admin confirms', async () => {
  const h = await hospital(ASILO), a = await admin();
  const good = { phone: '+91 832 111 2222', address: 'Peddem, Mapusa, Goa 403507', specialties: ['Orthopedics', 'Pediatrics', 'Orthopedics'] };
  assert.equal((await call('PUT', '/api/staff/hospital', { ...good, phone: '108' }, h.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/staff/hospital', { ...good, phone: 'call me' }, h.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/staff/hospital', { ...good, address: '' }, h.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/staff/hospital', { ...good, specialties: 'x' }, h.cookie)).status, 400);
  assert.equal((await call('PUT', '/api/staff/hospital', { ...good, facilityId: GMC }, h.cookie)).status, 403, 'cannot edit another hospital');
  const saved = await json('PUT', '/api/staff/hospital', good, h.cookie);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.facility.specialties, ['Orthopedics', 'Pediatrics']);
  assert.equal(saved.body.facility.infoVerifiedAt, null);
  assert.equal((await call('PUT', `/api/admin/facilities/${ASILO}/verify`, {}, h.cookie)).status, 403);
  const v = await json('PUT', `/api/admin/facilities/${ASILO}/verify`, {}, a.cookie);
  assert.equal(v.status, 200); assert.ok(v.body.facility.infoVerifiedAt);
  await call('PUT', '/api/staff/hospital', { ...good, phone: '+91 832 111 3333' }, h.cookie);
  assert.equal(db.getStaffFacility(ASILO).infoVerifiedAt, null, 'an edit clears verification');
  assert.equal((await call('PUT', `/api/admin/facilities/nope/verify`, {}, a.cookie)).status, 404);
});

test('units: create, list, edit, deactivate, duplicates and validation', async () => {
  const h = await hospital(GMC);
  assert.equal((await call('POST', '/api/staff/units', { name: 'X', type: 'opd' }, h.cookie)).status, 400, 'name too short');
  assert.equal((await call('POST', '/api/staff/units', { name: 'Cardiac Care', type: 'wizardry' }, h.cookie)).status, 400, 'unknown type');
  assert.equal((await call('POST', '/api/staff/units', { name: 'Cardiac Care', type: 'icu', bedCategory: 'vip' }, h.cookie)).status, 400, 'unknown bed category');
  const c = await json('POST', '/api/staff/units', { name: 'Cardiac ICU', type: 'icu', bedCategory: 'icu', description: 'Heart patients', location: 'Block B, floor 2', contact: 'Ext 214', hours: '24x7' }, h.cookie);
  assert.equal(c.status, 201);
  const id = c.body.unit.id;
  assert.equal(c.body.unit.facilityId, GMC); assert.equal(c.body.unit.active, true); assert.equal(c.body.unit.verifiedAt, null); assert.deepEqual(c.body.unit.gaps, ['doctors']);
  assert.equal((await call('POST', '/api/staff/units', { name: 'cardiac icu', type: 'icu' }, h.cookie)).status, 409, 'names are unique per hospital, case-insensitive');
  // the same name is fine at another hospital
  const h2 = await hospital(ASILO);
  assert.equal((await call('POST', '/api/staff/units', { name: 'Cardiac ICU', type: 'icu' }, h2.cookie)).status, 201);
  // list shows only own units, with bed figures that come from the hospital's own counts
  const list = (await json('GET', '/api/staff/units', undefined, h.cookie)).body;
  assert.ok(list.units.every(u => u.facilityId === GMC)); assert.ok(list.types.opd);
  const mine = list.units.find(u => u.id === id);
  assert.equal(mine.beds.category, 'icu'); assert.equal(mine.beds.available, db.getFacility(GMC).icuBeds);
  // other hospital cannot see / edit / deactivate it: indistinguishable from "not found"
  for (const [m, p, b] of [['PUT', `/api/staff/units/${id}`, { name: 'Hacked', type: 'opd' }], ['PUT', `/api/staff/units/${id}/active`, { active: false }], ['PUT', `/api/staff/units/${id}/doctors`, { doctorIds: [] }]])
    assert.equal((await call(m, p, b, h2.cookie)).status, 404, p);
  assert.equal((await call('PUT', '/api/staff/units/99999', { name: 'Nope', type: 'opd' }, h.cookie)).status, 404);
  assert.equal((await call('PUT', '/api/staff/units/abc', { name: 'Nope', type: 'opd' }, h.cookie)).status, 404);
  // edit
  const e = await json('PUT', `/api/staff/units/${id}`, { name: 'Cardiac ICU (CCU)', type: 'icu', bedCategory: 'icu', description: 'Heart patients', location: 'Block B, floor 2', contact: 'Ext 214', hours: '24x7' }, h.cookie);
  assert.equal(e.status, 200); assert.equal(e.body.unit.name, 'Cardiac ICU (CCU)');
  // deactivate / reactivate with a boolean only
  assert.equal((await call('PUT', `/api/staff/units/${id}/active`, { active: 'no' }, h.cookie)).status, 400);
  assert.equal((await json('PUT', `/api/staff/units/${id}/active`, { active: false }, h.cookie)).body.unit.active, false);
  assert.equal((await json('PUT', `/api/staff/units/${id}/active`, { active: true }, h.cookie)).body.unit.active, true);
  // persisted + audited
  assert.equal(db.getUnit(id).name, 'Cardiac ICU (CCU)');
  const acts = (await json('GET', '/api/staff/activity?limit=50', undefined, h.cookie)).body.items.map(a => a.action);
  for (const a of ['unit_created', 'unit_updated', 'unit_deactivated', 'unit_activated']) assert.ok(acts.includes(a), a);
});

test('unit doctor assignment references real doctors of the same hospital and is all-or-nothing', async () => {
  const h = await hospital(GMC);
  const unit = (await json('POST', '/api/staff/units', { name: 'Cardiology OPD', type: 'opd' }, h.cookie)).body.unit;
  const mine = docAt(GMC).map(d => d.id), foreign = docAt(ASILO)[0].id;
  assert.ok(mine.length >= 1);
  const url = `/api/staff/units/${unit.id}/doctors`;
  assert.equal((await call('PUT', url, { doctorIds: [mine[0], foreign] }, h.cookie)).status, 400, 'doctor of another hospital');
  assert.equal(db.staffDoctor(mine[0]).unitId, null, 'nothing was changed by the failed request');
  assert.equal((await call('PUT', url, { doctorIds: [mine[0], 999999] }, h.cookie)).status, 400, 'unknown doctor');
  assert.equal((await call('PUT', url, { doctorIds: 'all' }, h.cookie)).status, 400);
  assert.equal((await call('PUT', url, { doctorIds: ['x'] }, h.cookie)).status, 400);
  const ok = await json('PUT', url, { doctorIds: [mine[0]] }, h.cookie);
  assert.equal(ok.status, 200); assert.equal(ok.body.unit.doctorCount, 1);
  assert.equal(db.staffDoctor(mine[0]).unitName, 'Cardiology OPD');
  assert.ok(!(await json('GET', '/api/staff/units', undefined, h.cookie)).body.units.find(u => u.id === unit.id).gaps.includes('doctors'));
  const docs = (await json('GET', '/api/staff/doctors', undefined, h.cookie)).body.doctors;
  assert.equal(docs.find(d => d.id === mine[0]).unitId, unit.id);
  assert.equal((await json('PUT', url, { doctorIds: [] }, h.cookie)).body.unit.doctorCount, 0);
  assert.equal(db.staffDoctor(mine[0]).unitId, null);
  // the public doctor directory is unchanged by units
  assert.ok(!('unitId' in (await (await call('GET', '/api/doctors')).json()).doctors[0]));
});

test('admin can manage any hospital\'s units when naming it, and verify them; editing clears verification', async () => {
  const a = await admin(), h = await hospital(ASILO);
  assert.equal((await call('POST', '/api/staff/units', { name: 'Radiology', type: 'radiology' }, a.cookie)).status, 400, 'admin must name the hospital');
  assert.equal((await call('POST', '/api/staff/units', { name: 'Radiology', type: 'radiology', facilityId: 'nope' }, a.cookie)).status, 404);
  const c = await json('POST', '/api/staff/units', { name: 'Radiology', type: 'radiology', facilityId: ASILO }, a.cookie);
  assert.equal(c.status, 201); assert.equal(c.body.unit.facilityId, ASILO);
  const id = c.body.unit.id;
  assert.equal((await call('PUT', `/api/admin/units/${id}/verify`, {}, h.cookie)).status, 403, 'staff cannot verify');
  assert.ok((await json('PUT', `/api/admin/units/${id}/verify`, {}, a.cookie)).body.unit.verifiedAt);
  const e = await json('PUT', `/api/staff/units/${id}`, { name: 'Radiology & Imaging', type: 'radiology' }, h.cookie);
  assert.equal(e.body.unit.verifiedAt, null);
  const list = (await json('GET', `/api/staff/units?facilityId=${ASILO}`, undefined, a.cookie)).body;
  assert.ok(list.summary.unverified >= 1);
});

test('doctor account: own overview, own status and room only', async () => {
  const mine = docAt(GMC)[0], other = docAt(GMC)[1] || docAt(ASILO)[0];
  const d = await doctorAcct(mine.id);
  const o = (await json('GET', '/api/staff/overview', undefined, d.cookie)).body;
  assert.equal(o.role, 'doctor'); assert.equal(o.doctor.id, mine.id); assert.equal(o.facility.id, GMC);
  assert.equal((await json('GET', '/api/staff/doctors', undefined, d.cookie)).body.doctors.length, 1);
  assert.equal((await call('PUT', `/api/doctors/${mine.id}/status`, {}, d.cookie)).status, 400, 'nothing to change');
  assert.equal((await call('PUT', `/api/doctors/${mine.id}/status`, { status: 'On Call', room: 'OPD 99' }, d.cookie)).status, 200);
  assert.equal(db.getDoctor(mine.id).status, 'On Call'); assert.equal(db.getDoctor(mine.id).room, 'OPD 99');
  assert.equal((await call('PUT', `/api/doctors/${mine.id}/status`, { room: '  ' }, d.cookie)).status, 400);
  assert.equal((await call('PUT', `/api/doctors/${other.id}/status`, { status: 'Available' }, d.cookie)).status, 403);
  const h = await hospital(GMC);
  assert.equal((await call('PUT', `/api/doctors/${mine.id}/status`, { status: 'Available' }, h.cookie)).status, 200);
  const acts = (await json('GET', '/api/staff/activity?limit=50', undefined, h.cookie)).body.items.filter(a => a.action === 'doctor_updated');
  assert.ok(acts.length >= 2 && acts.some(a => a.detail.status));
  // unknown fields are ignored: a doctor cannot change another detail through this endpoint
  await call('PUT', `/api/doctors/${mine.id}/status`, { status: 'Available', fee: 'Free', name: 'Hacked' }, d.cookie);
  assert.notEqual(db.getDoctor(mine.id).name, 'Hacked');
});

test('appointments: scoped filters, status changes and an audit trail without patient details', async () => {
  const date = tomorrow(), gmcDoc = docAt(GMC)[0], asiloDoc = docAt(ASILO)[0];
  const p = await patient(); await call('POST', '/api/me/consent', { accept: true }, p.cookie);
  await db.raw.exec("UPDATE users SET name = 'Zed Patientson' WHERE id = " + p.user.id);
  const booked = await json('POST', '/api/me/appointments', { key: 'd:' + gmcDoc.id, date, time: '11:00', reason: 'headache' }, p.cookie);
  assert.equal(booked.status, 201);
  const apptId = booked.body.appointment.id;
  const other = await json('POST', '/api/me/appointments', { key: 'd:' + asiloDoc.id, date, time: '11:30', reason: 'cough' }, p.cookie);
  const h = await hospital(GMC), h2 = await hospital(ASILO), d = await doctorAcct(gmcDoc.id), d2 = await doctorAcct(asiloDoc.id);
  const list = async (who, qs = '') => (await json('GET', '/api/staff/appointments' + qs, undefined, who.cookie)).body;
  let r = await list(h);
  assert.ok(r.appointments.some(a => a.id === apptId) && !r.appointments.some(a => a.id === other.body.appointment.id), 'hospital sees only its own');
  const row = r.appointments.find(a => a.id === apptId);
  assert.equal(row.patient, 'Zed Patientson'); assert.equal(row.doctorId, gmcDoc.id);
  assert.ok(!('phone' in row) && !('user_id' in row) && !('userId' in row), 'no extra patient data');
  assert.equal((await list(h, '?status=Declined')).appointments.length, 0);
  assert.equal((await list(h, '?date=' + date + '&q=zed')).appointments.length >= 1, true);
  assert.equal((await list(h, '?q=nobody-here')).appointments.length, 0);
  assert.equal((await list(h, '?doctorId=' + gmcDoc.id)).appointments.every(a => a.doctorId === gmcDoc.id), true);
  assert.equal((await list(d)).appointments.every(a => a.doctorId === gmcDoc.id), true, 'doctor sees only own');
  assert.equal((await list(d2)).appointments.some(a => a.id === apptId), false);
  // permissions
  assert.equal((await call('PUT', `/api/appointments/${apptId}/status`, { status: 'Confirmed' }, h2.cookie)).status, 403);
  assert.equal((await call('PUT', `/api/appointments/${apptId}/status`, { status: 'Confirmed' }, d2.cookie)).status, 403);
  assert.equal((await call('PUT', `/api/appointments/${apptId}/status`, { status: 'Confirmed' }, p.cookie)).status, 403);
  assert.equal((await call('PUT', `/api/appointments/${apptId}/status`, { status: 'Done' }, h.cookie)).status, 400);
  assert.equal((await call('PUT', `/api/appointments/${apptId}/status`, { status: 'Confirmed' }, d.cookie)).status, 200);
  assert.equal((await json('GET', '/api/me/data', undefined, p.cookie)).body.appointments.find(a => a.id === apptId).status, 'Confirmed');
  // a cancelled appointment stays cancelled
  await call('PUT', `/api/me/appointments/${other.body.appointment.id}/cancel`, {}, p.cookie);
  assert.equal((await call('PUT', `/api/appointments/${other.body.appointment.id}/status`, { status: 'Confirmed' }, h2.cookie)).status, 409);
  const acts = (await json('GET', '/api/staff/activity?limit=100', undefined, h.cookie)).body.items;
  const ev = acts.find(a => a.action === 'appointment_confirmed' && a.entityId === String(apptId));
  assert.ok(ev && ev.role === 'doctor');
  assert.ok(!JSON.stringify(acts).includes('Zed') && !JSON.stringify(acts).includes('headache'), 'audit log holds no patient name or reason');
});

test('admin dashboard: overview, directory, activity log, user filters; admin role cannot be self-assigned', async () => {
  const a = await admin(), h = await hospital(GMC);
  const o = (await json('GET', '/api/admin/overview', undefined, a.cookie)).body;
  assert.ok(o.users.total >= 5 && o.users.byRole.hospital >= 1 && o.users.byRole.admin >= 1);
  assert.equal(o.hospitals.total, db.listFacilities().length); assert.equal(o.doctors.total, db.listDoctors().length);
  assert.ok(o.units.total >= 1);
  const fac = (await json('GET', '/api/admin/facilities', undefined, a.cookie)).body.facilities;
  const gmc = fac.find(f => f.id === GMC);
  assert.equal(gmc.doctorCount, docAt(GMC).length); assert.ok('infoVerifiedAt' in gmc);
  assert.ok(!JSON.stringify(fac).match(/password|salt/i));
  const act = (await json('GET', '/api/admin/activity?role=hospital&limit=5', undefined, a.cookie)).body;
  assert.ok(act.total >= 1 && act.items.length <= 5 && act.items.every(i => i.role === 'hospital'));
  assert.equal((await call('GET', '/api/admin/activity?role=hacker', undefined, a.cookie)).status, 400);
  assert.equal((await call('GET', '/api/admin/activity?entityType=users', undefined, a.cookie)).status, 400);
  const users = (await json('GET', '/api/admin/users?role=hospital', undefined, a.cookie)).body;
  assert.ok(users.users.length >= 1 && users.users.every(u => u.role === 'hospital')); assert.ok(users.byRole.patient >= 1);
  assert.equal((await call('GET', '/api/admin/users?role=root', undefined, a.cookie)).status, 400);
  assert.ok(!JSON.stringify(users).match(/password_hash|"salt"|token/i));
  assert.ok((await json('GET', '/api/admin/audit', undefined, a.cookie)).body.audit.some(x => x.action === 'list_users'), 'existing admin audit still works');
  // nobody can create or promote an admin through the API
  const bad = await call('POST', '/api/auth/register', { name: 'Evil Admin', phone: '9199999999', password: 'secret1', role: 'admin', staffCode: 'TEST-STAFF-CODE' });
  assert.equal(bad.status, 400);
  assert.ok([404, 405].includes((await call('PUT', '/api/admin/users/' + h.user.id, { role: 'admin' }, h.cookie)).status), 'no API exists to change a role');
  assert.equal(db.findUserById(h.user.id).role, 'hospital');
});

test('staff sign-up is closed in production unless a staff code is configured', () => {
  const saved = { code: process.env.GOACARE_STAFF_CODE, env: process.env.NODE_ENV };
  try {
    delete process.env.GOACARE_STAFF_CODE; process.env.NODE_ENV = 'production';
    assert.equal(auth.staffCodeOk(auth.DEMO_STAFF_CODE), false);
    assert.equal(auth.staffCodeOk(''), false);
    process.env.GOACARE_STAFF_CODE = 'real-code'; assert.equal(auth.staffCodeOk('real-code'), true);
    delete process.env.GOACARE_STAFF_CODE; process.env.NODE_ENV = 'test'; assert.equal(auth.staffCodeOk(auth.DEMO_STAFF_CODE), true);
  } finally { process.env.GOACARE_STAFF_CODE = saved.code; if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env; }
});

test('a database created by the previous version is migrated without losing data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-old-'));
  const old = new DatabaseSync(path.join(dir, 'goacare.db'));
  old.exec(`CREATE TABLE facilities (id TEXT PRIMARY KEY, name TEXT NOT NULL, care_type TEXT NOT NULL, district TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lng REAL NOT NULL,
    icu_beds INTEGER NOT NULL DEFAULT 0, oxygen_beds INTEGER NOT NULL DEFAULT 0, general_beds INTEGER NOT NULL DEFAULT 0, specialties TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT 'x', beds_updated_at TEXT);
    INSERT INTO facilities (id, name, care_type, district, address, phone, lat, lng, icu_beds) VALUES ('legacy', 'Legacy Hospital', 'Public', 'North Goa', 'Somewhere 1', '+91 1', 1, 1, 9);
    CREATE TABLE doctors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, spec TEXT NOT NULL, hospital TEXT NOT NULL, status TEXT NOT NULL, room TEXT NOT NULL, timings TEXT NOT NULL, fee TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT 'x', facility_id TEXT);`);
  old.close();
  const { spawnSync } = require('child_process');
  const script = `process.env.GOACARE_DATA_DIR=${JSON.stringify(dir)}; const db=require(${JSON.stringify(path.join(__dirname, '..', 'db.js'))});
    const f=db.getStaffFacility('legacy'); console.log(JSON.stringify({icu:f.icuBeds,total:f.totalIcuBeds,units:db.listUnits('legacy').length})); db.close();`;
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { icu: 9, total: null, units: 0 });
});
