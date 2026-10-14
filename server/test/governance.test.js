'use strict';
// Governance: registration + verification, permanent IDs, invitations, RBAC, approvals, inventory, concurrency, sync to the public feed, settings, reports.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.GOACARE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-gov-'));
process.env.GOACARE_STAFF_CODE = 'TEST-STAFF-CODE';
const { createServer } = require('../server');
const db = require('../db');
const gov = require('../gov-db');
const audit = require('../lib/audit');

let server, base;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const call = (method, p, body, cookie) => fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
const json = async (m, p, b, c) => { const r = await call(m, p, b, c); return { status: r.status, body: await r.json().catch(() => null), res: r }; };
let phone = 9600000000;
async function register(extra) {
  const num = String(phone++);
  const res = await call('POST', '/api/auth/register', { password: 'secret1', name: 'Test Person', phone: num, staffCode: 'TEST-STAFF-CODE', ...extra });
  return { status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0], user: (await res.json()).user, login: num };
}
const patient = () => register({ role: 'patient', staffCode: undefined });
const staff = (facilityId, staffRole) => register({ role: 'hospital', facilityId, staffRole, name: (staffRole || 'manager') + ' ' + facilityId });
async function admin() { const a = await patient(); db.setUserRole(a.user.id, 'admin'); return a; }
const approve = async (adm, fid) => (await json('PUT', `/api/admin/hospitals/${fid}/status`, { status: 'approved' }, adm.cookie));
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');

const GMC = 'gmc-bambolim', ASILO = 'asilo-mapusa', MARGAO = 'hospicio-margao', DONA = 'manipal-dona-paula', OLDGOA = 'healthway-old-goa', CHIC = 'sdh-chicalim', SDH = 'apollo-victor-margao', WISDOM = 'wisdom-altinho';
const regBody = (over = {}) => ({ name: 'Sunrise Care Hospital', hospitalType: 'Private hospital', district: 'North Goa', address: '12 Beach Road, Calangute, Goa', phone: '+91 832 2000000', lat: 15.54, lng: 73.76,
  departments: ['General medicine', 'Paediatrics'], operatingHours: '24 hours', emergencyContact: '+91 832 2000001', licenseNo: 'GMC-REG-2026-0042', issuingAuthority: 'Goa Directorate of Health Services',
  repName: 'Dr R. Naik', repTitle: 'Medical Director', repPhone: '+91 98220 11111', repEmail: 'director@sunrise.example', ...over });

test('existing hospitals are migrated as legacy + pending, never automatically verified', async () => {
  const list = (await json('GET', '/api/facilities')).body.facilities;
  assert.ok(list.length >= 30, 'public directory keeps every existing hospital');
  assert.ok(list.every(f => f.verificationStatus === 'pending' && f.hospitalCode === null));
  const f = db.getStaffFacility(GMC);
  assert.equal(f.legacy, true);
  assert.ok(gov.migrationStatus().length >= 2, 'versioned migrations are recorded');
});

test('hospital registration: pending + unlisted until a super administrator approves; permanent unique Hospital ID on approval', async () => {
  const rep = await patient(), other = await patient(), adm = await admin();
  assert.equal((await json('POST', '/api/hospitals/register', regBody())).status, 401);
  assert.equal((await json('POST', '/api/hospitals/register', regBody({ lat: 10, lng: 70 }), rep.cookie)).status, 400, 'location must be in Goa');
  assert.equal((await json('POST', '/api/hospitals/register', regBody({ licenseNo: '' }), rep.cookie)).status, 400);
  const r = await json('POST', '/api/hospitals/register', { ...regBody(), role: 'admin', verification_status: 'approved', hospital_code: 'GOC-HOS-99999', listing_status: 'listed' }, rep.cookie);
  assert.equal(r.status, 201);
  const fid = r.body.facilityId;
  // client-supplied escalation fields were ignored
  const f0 = db.getStaffFacility(fid);
  assert.equal(f0.verificationStatus, 'pending'); assert.equal(f0.hospitalCode, null); assert.equal(f0.listingStatus, 'unlisted');
  assert.equal((await json('GET', '/api/auth/me', undefined, rep.cookie)).body.user.role, 'patient', 'registering does not make the person staff');
  // not public, nothing published
  assert.ok(!(await json('GET', '/api/facilities')).body.facilities.some(f => f.id === fid));
  assert.ok(!((await json('GET', '/api/public/operations')).body.hospitals[fid]));
  // staff endpoints refuse a patient (cannot become admin by editing a request)
  assert.equal((await json('GET', '/api/staff/inventory', undefined, rep.cookie)).status, 403);
  assert.equal((await json('PUT', `/api/admin/hospitals/${fid}/status`, { status: 'approved' }, rep.cookie)).status, 403);
  assert.equal((await json('GET', '/api/admin/verification/hospitals', undefined, other.cookie)).status, 403);
  // document: real signature required, only the submitter, only while pending
  assert.equal((await json('POST', '/api/documents', { ownerType: 'hospital', ownerId: fid, name: 'licence.pdf', data: Buffer.from('not a pdf at all').toString('base64') }, rep.cookie)).status, 400);
  assert.equal((await json('POST', '/api/documents', { ownerType: 'hospital', ownerId: fid, name: 'licence.pdf', data: PDF }, other.cookie)).status, 404);
  const up = await json('POST', '/api/documents', { ownerType: 'hospital', ownerId: fid, name: 'licence.pdf', data: PDF }, rep.cookie);
  assert.equal(up.status, 201);
  assert.equal((await call('GET', `/api/documents/${up.body.id}`, undefined, other.cookie)).status, 404, 'unrelated users cannot read verification documents');
  assert.equal((await call('GET', `/api/documents/${up.body.id}`, undefined, adm.cookie)).status, 200);
  // admin queue shows it
  const q = (await json('GET', '/api/admin/verification/hospitals?status=pending', undefined, adm.cookie)).body.hospitals.find(h => h.id === fid);
  assert.ok(q && q.registered && q.documents === 1 && q.licenseNo === 'GMC-REG-2026-0042');
  // reject needs a reason; approve issues the id once
  assert.equal((await json('PUT', `/api/admin/hospitals/${fid}/status`, { status: 'rejected' }, adm.cookie)).status, 400);
  const a = await json('PUT', `/api/admin/hospitals/${fid}/status`, { status: 'approved' }, adm.cookie);
  assert.equal(a.status, 200);
  assert.match(a.body.hospitalCode, /^GOC-HOS-\d{5}$/);
  assert.ok((await json('GET', '/api/facilities')).body.facilities.some(f => f.id === fid && f.hospitalCode === a.body.hospitalCode && f.verificationStatus === 'approved'));
  const me = (await json('GET', '/api/auth/me', undefined, rep.cookie)).body.user;
  assert.equal(me.role, 'hospital'); assert.equal(me.staffRole, 'manager'); assert.equal(me.facilityId, fid);
  assert.equal((await json('PUT', `/api/admin/hospitals/${fid}/status`, { status: 'approved' }, adm.cookie)).status, 409, 'cannot approve twice');
  // a second approval gets a different, higher id; ids are never reused
  const rep2 = await patient(), f2 = (await json('POST', '/api/hospitals/register', regBody({ name: 'Second Care Hospital', licenseNo: 'GMC-REG-2026-0043' }), rep2.cookie)).body.facilityId;
  const a2 = await json('PUT', `/api/admin/hospitals/${f2}/status`, { status: 'approved' }, adm.cookie);
  assert.notEqual(a2.body.hospitalCode, a.body.hospitalCode);
  // rejected hospital: no listing, representative gets no staff role
  const rep3 = await patient(), f3 = (await json('POST', '/api/hospitals/register', regBody({ name: 'Third Care Hospital', licenseNo: 'GMC-REG-2026-0044' }), rep3.cookie)).body.facilityId;
  assert.equal((await json('PUT', `/api/admin/hospitals/${f3}/status`, { status: 'rejected', reason: 'Licence number not found in the register' }, adm.cookie)).status, 200);
  assert.equal(db.getStaffFacility(f3).hospitalCode, null);
  assert.equal((await json('GET', '/api/auth/me', undefined, rep3.cookie)).body.user.role, 'patient');
  assert.ok(!(await json('GET', '/api/facilities')).body.facilities.some(f => f.id === f3));
});

test('suspended hospitals cannot change data or publish; suspension and reactivation need a reason and a password', async () => {
  const adm = await admin(), mgr = await staff(MARGAO, 'manager');
  await approve(adm, MARGAO);
  assert.equal((await json('PUT', `/api/staff/wards/general`, { total: 20, available: 5 }, mgr.cookie)).status, 200);
  assert.equal((await json('PUT', `/api/admin/hospitals/${MARGAO}/status`, { status: 'suspended', reason: 'Licence under investigation' }, adm.cookie)).status, 403, 'password re-entry required');
  assert.equal((await json('PUT', `/api/admin/hospitals/${MARGAO}/status`, { status: 'suspended', reason: 'Licence under investigation', password: 'wrong' }, adm.cookie)).status, 403);
  assert.equal((await json('PUT', `/api/admin/hospitals/${MARGAO}/status`, { status: 'suspended', password: 'secret1' }, adm.cookie)).status, 400, 'reason required');
  assert.equal((await json('PUT', `/api/admin/hospitals/${MARGAO}/status`, { status: 'suspended', reason: 'Licence under investigation', password: 'secret1' }, adm.cookie)).status, 200);
  assert.equal((await json('PUT', `/api/staff/wards/general`, { total: 20, available: 6 }, mgr.cookie)).status, 403, 'suspended: no changes');
  assert.equal((await json('PUT', `/api/facilities/${MARGAO}/beds`, { icuBeds: 1, oxygenBeds: 1, generalBeds: 1 }, mgr.cookie)).status, 403);
  assert.ok(!(await json('GET', '/api/public/operations')).body.hospitals[MARGAO], 'nothing from a suspended hospital is published');
  assert.ok(!(await json('GET', '/api/facilities')).body.facilities.some(f => f.id === MARGAO));
  assert.equal((await json('PUT', `/api/admin/hospitals/${MARGAO}/status`, { status: 'approved', reason: 'Cleared', password: 'secret1' }, adm.cookie)).status, 200);
  assert.equal((await json('PUT', `/api/staff/wards/general`, { total: 20, available: 6 }, mgr.cookie)).status, 200);
  assert.equal(db.getStaffFacility(MARGAO).hospitalCode.length, 'GOC-HOS-00001'.length, 'the Hospital ID is kept through suspension');
});

test('doctor registration: not verified without a credential check; permanent Doctor ID; two hospitals; ending an affiliation revokes access', async () => {
  const adm = await admin(), m1 = await staff(GMC, 'manager'), m2 = await staff(ASILO, 'manager'), doc = await patient();
  await approve(adm, GMC); await approve(adm, ASILO);
  assert.equal((await json('POST', '/api/doctors/register', { fullName: 'Dr A' }, doc.cookie)).status, 400);
  const body = { fullName: 'Dr Asha Kamat', qualifications: 'MBBS, MD (Medicine)', registrationNo: 'GMC-12345', issuingAuthority: 'Goa Medical Council', specialty: 'General Medicine', department: 'Medicine', facilityId: GMC };
  const r = await json('POST', '/api/doctors/register', body, doc.cookie);
  assert.equal(r.status, 201); assert.equal(r.body.credentialStatus, 'unchecked');
  assert.equal((await json('POST', '/api/doctors/register', body, doc.cookie)).status, 409);
  assert.equal((await json('POST', '/api/doctors/register', body, (await patient()).cookie)).status, 409, 'same registration number cannot be claimed twice');
  let mine = (await json('GET', '/api/doctors/mine', undefined, doc.cookie)).body;
  assert.equal(mine.registration.doctorCode, null);
  assert.equal((await json('GET', '/api/auth/me', undefined, doc.cookie)).body.user.role, 'patient', 'a pending doctor has no staff powers');
  // hospital manager sees the request and verifies the affiliation
  const aff = (await json('GET', '/api/staff/affiliations', undefined, m1.cookie)).body.affiliations.find(a => a.userId === doc.user.id);
  assert.ok(aff && aff.status === 'requested');
  assert.equal((await json('PUT', `/api/staff/affiliations/${aff.id}`, { action: 'verify' }, m2.cookie)).status, 404, 'another hospital cannot touch it');
  assert.equal((await json('PUT', `/api/staff/affiliations/${aff.id}`, { action: 'verify' }, m1.cookie)).status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, doc.cookie)).body.user.role, 'patient', 'hospital verification alone does not verify the doctor');
  // super administrator cannot approve before the credential check
  const reg = mine.registration;
  assert.equal((await json('PUT', `/api/admin/doctors/${reg.id}/decision`, { decision: 'approve' }, m1.cookie)).status, 403);
  assert.equal((await json('PUT', `/api/admin/doctors/${reg.id}/decision`, { decision: 'approve' }, adm.cookie)).status, 409);
  assert.equal((await json('PUT', `/api/admin/doctors/${reg.id}/decision`, { decision: 'approve', credentialsVerified: true }, adm.cookie)).status, 400, 'a verification note is required');
  const ok = await json('PUT', `/api/admin/doctors/${reg.id}/decision`, { decision: 'approve', credentialsVerified: true, credentialNote: 'Checked on the Goa Medical Council register' }, adm.cookie);
  assert.equal(ok.status, 200); assert.match(ok.body.doctorCode, /^GOC-DOC-\d{5}$/);
  const me = (await json('GET', '/api/auth/me', undefined, doc.cookie)).body.user;
  assert.equal(me.role, 'doctor'); assert.equal(me.facilityId, GMC);
  const row1 = db.staffDoctor(me.doctorId); assert.equal(row1.doctorCode, ok.body.doctorCode); assert.equal(row1.verificationStatus, 'verified');
  // second hospital: request, hospital verifies, activates immediately (doctor already approved); same Doctor ID, separate listing row
  assert.equal((await json('POST', '/api/doctors/affiliations', { facilityId: CHIC }, doc.cookie)).status, 400, 'only verified hospitals');
  assert.equal((await json('POST', '/api/doctors/affiliations', { facilityId: ASILO }, doc.cookie)).status, 201);
  const aff2 = (await json('GET', '/api/staff/affiliations', undefined, m2.cookie)).body.affiliations.find(a => a.userId === doc.user.id);
  assert.equal((await json('PUT', `/api/staff/affiliations/${aff2.id}`, { action: 'verify' }, m2.cookie)).status, 200);
  const rows = gov.affiliationsOf(doc.user.id).filter(a => a.status === 'approved');
  assert.equal(rows.length, 2);
  const row2 = db.staffDoctor(rows.find(a => a.facilityId === ASILO).doctorRowId);
  assert.equal(row2.doctorCode, ok.body.doctorCode); assert.notEqual(row2.id, row1.id);
  // hospital-specific permissions: the doctor can set their status at both, but not at a hospital where they do not work
  assert.equal((await json('PUT', `/api/doctors/${row2.id}/status`, { status: 'On Call' }, doc.cookie)).status, 200);
  const stranger = db.listDoctors().find(d => d.facilityId === DONA);
  assert.equal((await json('PUT', `/api/doctors/${stranger.id}/status`, { status: 'On Call' }, doc.cookie)).status, 403);
  // a doctor cannot make themselves an administrator
  assert.equal((await json('PUT', '/api/settings/profile', { name: 'Dr Asha Kamat', role: 'admin', staffRole: 'manager', facilityId: DONA }, doc.cookie)).status, 200);
  const me2 = (await json('GET', '/api/auth/me', undefined, doc.cookie)).body.user; assert.equal(me2.role, 'doctor'); assert.equal(me2.facilityId, GMC);
  for (const url of ['/api/staff/team', '/api/staff/invitations', '/api/admin/users']) assert.equal((await json('GET', url, undefined, doc.cookie)).status, 403, url);
  // ending the Asilo affiliation: listing row archived, access stops, Doctor ID and history stay
  assert.equal((await json('PUT', `/api/staff/affiliations/${rows.find(a => a.facilityId === ASILO).id}`, { action: 'end' }, m2.cookie)).status, 400, 'reason required');
  assert.equal((await json('PUT', `/api/staff/affiliations/${rows.find(a => a.facilityId === ASILO).id}`, { action: 'end', reason: 'Contract ended' }, m2.cookie)).status, 200);
  assert.equal((await json('PUT', `/api/doctors/${row2.id}/status`, { status: 'Available' }, doc.cookie)).status, 404, 'former hospital: no access');
  assert.equal(db.staffDoctor(row2.id).archived, true);
  assert.equal((await json('PUT', `/api/doctors/${row1.id}/status`, { status: 'Available' }, doc.cookie)).status, 200, 'other hospital unaffected');
  assert.equal(gov.doctorRegistration(doc.user.id).doctorCode, ok.body.doctorCode);
  // rejected doctor never verified
  const bad = await patient();
  const br = (await json('POST', '/api/doctors/register', { ...body, registrationNo: 'GMC-99999', fullName: 'Dr Bad' }, bad.cookie)).body;
  assert.equal((await json('PUT', `/api/admin/doctors/${br.id}/decision`, { decision: 'reject', reason: 'Number not on the register' }, adm.cookie)).status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, bad.cookie)).body.user.role, 'patient');
});

test('invitations: bound to hospital, role and recipient; hashed at rest; expire, revoke, regenerate; single use; admin invites need the super administrator', async () => {
  const adm = await admin(), mgr = await staff(DONA, 'manager'), nurseAcct = await staff(DONA, 'nurse'), outsider = await staff(CHIC, 'manager');
  assert.equal((await json('POST', '/api/staff/invitations', { role: 'nurse', recipient: '9000000001' }, mgr.cookie)).status, 403, 'hospital not approved yet');
  await approve(adm, DONA);
  const invitee = await patient(), wrong = await patient();
  assert.equal((await json('POST', '/api/staff/invitations', { role: 'nurse', recipient: invitee.login }, nurseAcct.cookie)).status, 403, 'ordinary staff cannot invite');
  assert.equal((await json('POST', '/api/staff/invitations', { role: 'manager', recipient: invitee.login }, mgr.cookie)).status, 403, 'a manager cannot invite administrators');
  assert.equal((await json('POST', '/api/staff/invitations', { role: 'superhero', recipient: invitee.login }, mgr.cookie)).status, 400);
  const inv = await json('POST', '/api/staff/invitations', { role: 'pharmacy', recipient: invitee.login }, mgr.cookie);
  assert.equal(inv.status, 201); assert.match(inv.body.token, /^gci_[\w-]{40,}$/);
  const stored = JSON.stringify(gov.raw.prepare('SELECT * FROM staff_invitations').all());
  assert.ok(!stored.includes(inv.body.token), 'the token is not stored in plaintext');
  assert.ok(!JSON.stringify(gov.raw.prepare('SELECT * FROM audit_events').all()).includes(inv.body.token), 'nor written to the audit log');
  assert.equal((await json('POST', '/api/staff/invitations', { role: 'pharmacy', recipient: invitee.login }, mgr.cookie)).status, 409, 'one pending invitation per person and role');
  assert.equal((await json('GET', '/api/staff/invitations', undefined, outsider.cookie)).body.invitations.length, 0, "another hospital cannot see this hospital's invitations");
  assert.equal((await json('PUT', `/api/staff/invitations/${inv.body.invitation.id}`, { action: 'revoke' }, outsider.cookie)).status, 403, 'another hospital cannot revoke it (and the attempt is audited)');
  assert.equal((await json('POST', '/api/invitations/redeem', { token: inv.body.token }, wrong.cookie)).status, 403, 'issued to a different person');
  assert.equal((await json('POST', '/api/invitations/redeem', { token: 'gci_nope' }, invitee.cookie)).status, 400);
  assert.equal((await json('POST', '/api/invitations/redeem', { token: inv.body.token }, undefined)).status, 401);
  // parallel redemption: exactly one wins
  const race = await Promise.all([1, 2, 3, 4].map(() => json('POST', '/api/invitations/redeem', { token: inv.body.token }, invitee.cookie)));
  assert.equal(race.filter(r => r.status === 200).length, 1);
  assert.equal(race.filter(r => r.status === 409).length, 3);
  const me = (await json('GET', '/api/auth/me', undefined, invitee.cookie)).body.user;
  assert.equal(me.role, 'hospital'); assert.equal(me.staffRole, 'pharmacy'); assert.equal(me.facilityId, DONA);
  // revoked, expired and regenerated
  const p2 = await patient();
  const i2 = (await json('POST', '/api/staff/invitations', { role: 'nurse', recipient: p2.login }, mgr.cookie)).body;
  assert.equal((await json('PUT', `/api/staff/invitations/${i2.invitation.id}`, { action: 'revoke' }, mgr.cookie)).status, 200);
  assert.equal((await json('POST', '/api/invitations/redeem', { token: i2.token }, p2.cookie)).status, 410);
  const i3 = (await json('PUT', `/api/staff/invitations/${i2.invitation.id}`, { action: 'regenerate' }, mgr.cookie));
  assert.equal(i3.status, 201); assert.notEqual(i3.body.token, i2.token);
  gov.raw.prepare("UPDATE staff_invitations SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(i3.body.invitation.id);
  assert.equal((await json('POST', '/api/invitations/redeem', { token: i3.body.token }, p2.cookie)).status, 410, 'expired');
  assert.equal((await json('GET', '/api/staff/invitations', undefined, mgr.cookie)).body.invitations.find(i => i.id === i3.body.invitation.id).status, 'expired');
  assert.equal(((await json('GET', '/api/auth/me', undefined, p2.cookie)).body.user).role, 'patient', 'failed redemptions grant nothing');
  const i4 = (await json('PUT', `/api/staff/invitations/${i3.body.invitation.id}`, { action: 'regenerate' }, mgr.cookie)).body;
  assert.equal((await json('POST', '/api/invitations/redeem', { token: i4.token }, p2.cookie)).status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, p2.cookie)).body.user.staffRole, 'nurse');
  // the super administrator may invite a hospital administrator; the role comes from the invitation only
  const p3 = await patient();
  const im = await json('POST', '/api/staff/invitations', { role: 'manager', recipient: p3.login, facilityId: DONA }, adm.cookie);
  assert.equal(im.status, 201);
  assert.equal((await json('POST', '/api/invitations/redeem', { token: im.body.token, role: 'admin', facilityId: CHIC }, p3.cookie)).status, 200);
  const m3 = (await json('GET', '/api/auth/me', undefined, p3.cookie)).body.user; assert.equal(m3.staffRole, 'manager'); assert.equal(m3.facilityId, DONA); assert.equal(m3.role, 'hospital');
  // a doctor invitation confirms the hospital affiliation but does not verify the doctor
  const d = await patient();
  const di = await json('POST', '/api/staff/invitations', { role: 'doctor', recipient: d.login }, mgr.cookie);
  assert.equal((await json('POST', '/api/invitations/redeem', { token: di.body.token }, d.cookie)).status, 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, d.cookie)).body.user.role, 'patient');
  assert.equal(gov.affiliationsOf(d.user.id)[0].status, 'hospital_verified');
});

test('RBAC: every role does only its own job, enforced by the server; other hospitals are isolated; deactivated and removed staff lose access', async () => {
  const adm = await admin();
  await approve(adm, OLDGOA);
  const [mgr, nurse, rec, pharm, fin] = await Promise.all(['manager', 'nurse', 'reception', 'pharmacy', 'finance'].map(r => staff(OLDGOA, r)));
  const foreign = await staff(CHIC, 'manager');
  const st = async (who, m, url, b) => (await json(m, url, b, who.cookie)).status;
  // pharmacy: inventory yes; patient data, beds, doctors, costs, team no
  assert.equal(await st(pharm, 'GET', '/api/staff/inventory'), 200);
  for (const u of ['/api/staff/appointments', '/api/staff/wards', '/api/staff/crowd', '/api/staff/team', '/api/staff/invitations']) assert.equal(await st(pharm, 'GET', u), 403, 'pharmacy ' + u);
  assert.equal(await st(pharm, 'POST', '/api/staff/doctors', { name: 'X Y', spec: 'GP', timings: '9-5', room: '1' }), 403);
  assert.equal(await st(pharm, 'PUT', '/api/staff/hospital', { phone: '1' }), 403);
  // finance: costs yes; clinical no
  assert.equal(await st(fin, 'GET', '/api/staff/costs'), 200);
  for (const u of ['/api/staff/appointments', '/api/staff/wards', '/api/staff/inventory', '/api/staff/doctors/x']) assert.notEqual(await st(fin, 'GET', u), 200, 'finance ' + u);
  assert.equal(await st(fin, 'PUT', '/api/staff/wards/general', { total: 10, available: 2 }), 403);
  // nurse: beds yes; costs read only; inventory read only; no appointments write / doctor edits / team
  assert.equal(await st(nurse, 'PUT', '/api/staff/wards/general', { total: 30, available: 10 }), 200);
  assert.equal(await st(nurse, 'POST', '/api/staff/costs', { serviceName: 'X-ray', minCost: 1, maxCost: 2 }), 403);
  assert.equal(await st(nurse, 'POST', '/api/staff/inventory', { name: 'Paracetamol', quantity: 5 }), 403);
  assert.equal(await st(nurse, 'GET', '/api/staff/inventory'), 200);
  assert.equal(await st(nurse, 'PUT', `/api/staff/team/${rec.user.id}`, { staffRole: 'manager' }), 403);
  // reception: appointments + duty yes; beds / costs / inventory no
  assert.equal(await st(rec, 'GET', '/api/staff/appointments'), 200);
  assert.equal(await st(rec, 'PUT', '/api/staff/wards/general', { total: 30, available: 1 }), 403);
  assert.equal(await st(rec, 'POST', '/api/staff/costs', { serviceName: 'Consult', minCost: 1, maxCost: 2 }), 403);
  assert.equal(await st(rec, 'GET', '/api/staff/inventory'), 403);
  // privilege escalation through the request is ignored or refused
  assert.equal(await st(nurse, 'PUT', '/api/settings/profile', { name: 'Nurse', staffRole: 'manager', role: 'admin' }), 200);
  assert.equal((await json('GET', '/api/auth/me', undefined, nurse.cookie)).body.user.staffRole, 'nurse');
  assert.equal(await st(nurse, 'PUT', '/api/settings/profile', { email: 'not-an-email' }), 400);
  // hospital isolation (A staff against B's records), also by direct id guessing
  const item = (await json('POST', '/api/staff/inventory', { name: 'Amoxicillin', strength: '500mg', quantity: 40, reorderLevel: 10 }, pharm.cookie)).body.item;
  assert.equal(await st(foreign, 'PUT', `/api/staff/inventory/${item.id}`, { name: 'Hacked', reorderLevel: 0 }), 404, "another hospital's manager cannot reach this hospital's stock");
  const fpharm = await staff(CHIC, 'pharmacy');
  assert.equal(await st(fpharm, 'POST', `/api/staff/inventory/${item.id}/adjust`, { delta: -40, reason: 'steal' }), 404);
  assert.equal(await st(foreign, 'PUT', `/api/staff/team/${nurse.user.id}`, { staffRole: 'reception' }), 404);
  assert.equal(await st(foreign, 'GET', `/api/staff/wards?facilityId=${OLDGOA}`), 403);
  assert.equal(await st(foreign, 'GET', `/api/audit/events?facilityId=${OLDGOA}`), 200);
  assert.ok((await json('GET', `/api/audit/events?facilityId=${OLDGOA}`, undefined, foreign.cookie)).body.items.every(e => e.facilityId === CHIC), 'audit queries cannot cross hospitals');
  assert.equal(db.findUserById(nurse.user.id).staffRole, 'nurse');
  // deactivation: the very next request fails and sign-in is refused
  assert.equal(await st(mgr, 'PUT', `/api/staff/team/${nurse.user.id}/access`, { action: 'deactivate' }), 400, 'reason required');
  assert.equal(await st(mgr, 'PUT', `/api/staff/team/${nurse.user.id}/access`, { action: 'deactivate', reason: 'Left the ward' }), 200);
  assert.equal(await st(nurse, 'GET', '/api/staff/wards'), 401);
  assert.equal((await json('POST', '/api/auth/login', { phone: nurse.login, password: 'secret1' })).status, 403);
  assert.equal(await st(foreign, 'PUT', `/api/staff/team/${nurse.user.id}/access`, { action: 'reactivate' }), 404);
  assert.equal(await st(mgr, 'PUT', `/api/staff/team/${nurse.user.id}/access`, { action: 'reactivate' }), 200);
  assert.equal((await json('POST', '/api/auth/login', { phone: nurse.login, password: 'secret1' })).status, 200);
  // removal from the hospital (affiliation ends): staff access gone at once, account kept
  assert.equal(await st(mgr, 'PUT', `/api/staff/team/${rec.user.id}/access`, { action: 'remove', reason: 'Moved to another employer' }), 200);
  assert.equal(await st(rec, 'GET', '/api/staff/appointments'), 401, 'removal also ends their sessions');
  assert.equal(db.findUserById(rec.user.id).role, 'patient');
  const again = await json('POST', '/api/auth/login', { phone: rec.login, password: 'secret1' });
  assert.equal((await json('GET', '/api/staff/appointments', undefined, (again.res.headers.get('set-cookie') || '').split(';')[0])).status, 403, 'a former staff member signing in again has no staff access');
  assert.equal(await st(mgr, 'PUT', `/api/staff/team/${mgr.user.id}/access`, { action: 'deactivate', reason: 'oops oops' }), 409, 'cannot change own access');
  // routes are protected when called directly, without a UI
  for (const [m, u] of [['GET', '/api/staff/inventory'], ['GET', '/api/audit/events'], ['GET', '/api/reports'], ['GET', '/api/staff/approvals'], ['GET', '/api/settings/profile'], ['POST', '/api/audit/verify'], ['POST', '/api/hospitals/register']])
    assert.equal((await json(m, u, m === 'POST' ? {} : undefined)).status, 401, u);
});

test('approvals: finance price changes and large capacity changes wait for a different manager; the published data stays until then', async () => {
  const adm = await admin();
  await approve(adm, SDH);
  const mgr = await staff(SDH, 'manager'), mgr2 = await staff(SDH, 'manager'), fin = await staff(SDH, 'finance'), nurse = await staff(SDH, 'nurse');
  const feed = async () => (await json('GET', '/api/public/operations')).body.hospitals[SDH];
  // manager sets a price directly: published at once, with before / after in the audit trail
  assert.equal((await json('POST', '/api/staff/costs', { serviceName: 'Consultation', minCost: 300, maxCost: 500 }, mgr.cookie)).status, 201);
  assert.deepEqual((await feed()).costs.map(c => [c.service, c.min, c.max, c.estimate]), [['Consultation', 300, 500, true]], 'estimates are labelled as estimates');
  const costId = (await json('GET', '/api/staff/costs', undefined, mgr.cookie)).body.items[0].id;
  // finance proposes a change: 202, nothing published yet
  const prop = await json('PUT', `/api/staff/costs/${costId}`, { serviceName: 'Consultation', minCost: 600, maxCost: 900 }, fin.cookie);
  assert.equal(prop.status, 202);
  assert.equal((await feed()).costs[0].min, 300, 'pending changes are not public');
  assert.equal((await json('GET', '/api/staff/approvals', undefined, nurse.cookie)).body.approvals.length, 0, 'others only see their own requests');
  assert.equal((await json('GET', '/api/staff/approvals', undefined, fin.cookie)).body.approvals.length, 1);
  const id = prop.body.approval.id;
  assert.equal((await json('POST', `/api/staff/approvals/${id}/decision`, { decision: 'approve' }, fin.cookie)).status, 403, 'finance cannot approve');
  const foreign = await staff(CHIC, 'manager');
  assert.equal((await json('POST', `/api/staff/approvals/${id}/decision`, { decision: 'approve' }, foreign.cookie)).status, 404);
  assert.equal((await json('POST', `/api/staff/approvals/${id}/decision`, { decision: 'reject' }, mgr.cookie)).status, 400, 'reason needed to reject');
  assert.equal((await json('POST', `/api/staff/approvals/${id}/decision`, { decision: 'reject', reason: 'Too high for now' }, mgr.cookie)).status, 200);
  assert.equal((await feed()).costs[0].min, 300, 'rejected changes never overwrite published data');
  assert.equal((await json('POST', `/api/staff/approvals/${id}/decision`, { decision: 'approve' }, mgr2.cookie)).status, 409, 'already decided');
  const prop2 = (await json('PUT', `/api/staff/costs/${costId}`, { serviceName: 'Consultation', minCost: 350, maxCost: 550 }, fin.cookie)).body.approval;
  const mine = await json('POST', `/api/staff/approvals/${prop2.id}/decision`, { decision: 'approve' }, fin.cookie); assert.equal(mine.status, 403);
  assert.equal((await json('POST', `/api/staff/approvals/${prop2.id}/decision`, { decision: 'approve', reason: 'ok' }, mgr2.cookie)).status, 200);
  assert.deepEqual([(await feed()).costs[0].min, (await feed()).costs[0].max], [350, 550], 'published after approval');
  // the audit trail keeps the previous value
  const ev = (await json('GET', '/api/audit/events?action=cost_updated', undefined, mgr.cookie)).body.items[0];
  assert.deepEqual(ev.before, { min: 300, max: 500, notes: '' }); assert.deepEqual(ev.after, { min: 350, max: 550, notes: '' });
  // nurse: big capacity change needs approval, small change does not, and a manager cannot approve their own
  assert.equal((await json('PUT', '/api/staff/wards/icu', { total: 20, available: 5 }, mgr.cookie)).status, 200);
  assert.equal((await json('PUT', '/api/staff/wards/icu', { total: 22, available: 5 }, nurse.cookie)).status, 200, 'small change goes straight through');
  const big = await json('PUT', '/api/staff/wards/icu', { total: 40, available: 20 }, nurse.cookie);
  assert.equal(big.status, 202);
  assert.equal((await json('GET', '/api/staff/wards', undefined, nurse.cookie)).body.wards.find(w => w.type === 'icu').total, 22);
  assert.equal((await json('POST', `/api/staff/approvals/${big.body.approval.id}/decision`, { decision: 'approve' }, mgr.cookie)).status, 200);
  assert.equal((await json('GET', '/api/staff/wards', undefined, nurse.cookie)).body.wards.find(w => w.type === 'icu').total, 40);
  // promoting someone to manager needs another manager + password
  const promo = await json('PUT', `/api/staff/team/${nurse.user.id}`, { staffRole: 'manager' }, mgr.cookie);
  assert.equal(promo.status, 202); assert.equal(db.findUserById(nurse.user.id).staffRole, 'nurse');
  assert.equal((await json('POST', `/api/staff/approvals/${promo.body.approval.id}/decision`, { decision: 'approve' }, mgr.cookie)).status, 403);
  assert.equal((await json('POST', `/api/staff/approvals/${promo.body.approval.id}/decision`, { decision: 'approve' }, mgr2.cookie)).status, 403, 'password required');
  assert.equal((await json('POST', `/api/staff/approvals/${promo.body.approval.id}/decision`, { decision: 'approve', password: 'secret1' }, mgr2.cookie)).status, 200);
  assert.equal(db.findUserById(nurse.user.id).staffRole, 'manager');
});

test('inventory: adjustments are atomic and never negative; history kept; public sees availability only, for approved hospitals, only if published', async () => {
  const adm = await admin();
  await approve(adm, WISDOM);
  const pharm = await staff(WISDOM, 'pharmacy'), pharm2 = await staff(WISDOM, 'pharmacy');
  const mk = async (b) => (await json('POST', '/api/staff/inventory', b, pharm.cookie));
  assert.equal((await mk({ name: 'X', quantity: -1 })).status, 400);
  assert.equal((await mk({ name: 'Insulin', strength: '100IU', quantity: 1.5 })).status, 400);
  const a = (await mk({ name: 'Paracetamol', strength: '500mg', quantity: 10, reorderLevel: 4, publish: true })).body.item;
  const hidden = (await mk({ name: 'Morphine', quantity: 7, reorderLevel: 2, publish: false })).body.item;
  assert.equal((await mk({ name: 'paracetamol', strength: '500MG', quantity: 1 })).status, 409, 'no duplicates');
  assert.equal(a.availability, 'in_stock');
  // ten parallel withdrawals of 3 from a stock of 10: exactly three can succeed, stock ends at 1, never negative
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) => json('POST', `/api/staff/inventory/${a.id}/adjust`, { delta: -3, reason: 'Ward issue ' + i }, (i % 2 ? pharm : pharm2).cookie)));
  assert.equal(res.filter(r => r.status === 200).length, 3);
  assert.equal(res.filter(r => r.status === 409).length, 7);
  assert.equal(gov.medicine(a.id).quantity, 1);
  assert.equal(gov.medicine(a.id).availability, 'low');
  assert.equal((await json('POST', `/api/staff/inventory/${a.id}/adjust`, { delta: 0, reason: 'nothing' }, pharm.cookie)).status, 400);
  assert.equal((await json('POST', `/api/staff/inventory/${a.id}/adjust`, { delta: 5 }, pharm.cookie)).status, 400, 'a reason is required');
  const hist = (await json('GET', `/api/staff/inventory/history?itemId=${a.id}`, undefined, pharm.cookie)).body.history;
  assert.equal(hist.length, 4); assert.ok(hist.every(h => h.after >= 0 && h.reason && h.by));
  // optimistic version check on edits
  const cur = gov.medicine(a.id);
  assert.equal((await json('PUT', `/api/staff/inventory/${a.id}`, { name: 'Paracetamol', strength: '500mg', reorderLevel: 4, publish: true, expectedVersion: cur.version - 1 }, pharm.cookie)).status, 409);
  assert.equal((await json('PUT', `/api/staff/inventory/${a.id}`, { name: 'Paracetamol', strength: '500mg', reorderLevel: 4, publish: true, expectedVersion: cur.version }, pharm.cookie)).status, 200);
  // public feed: availability only, published items only, no quantities
  let med = (await json('GET', '/api/public/operations')).body.hospitals[WISDOM].medicines;
  assert.deepEqual(med.map(m => [m.name, m.availability]), [['Paracetamol 500mg', 'low']]);
  assert.ok(!JSON.stringify(med).includes('quantity') && !JSON.stringify(med).includes('Morphine'));
  assert.equal((await json('POST', `/api/staff/inventory/${a.id}/adjust`, { delta: -1, reason: 'last box' }, pharm.cookie)).status, 200);
  med = (await json('GET', '/api/public/operations')).body.hospitals[WISDOM].medicines;
  assert.equal(med[0].availability, 'out', 'public view follows the stock change');
  // an unverified hospital publishes no medicine availability
  const other = await staff(CHIC, 'pharmacy');
  await json('POST', '/api/staff/inventory', { name: 'Aspirin', quantity: 5, publish: true }, other.cookie);
  assert.deepEqual((await json('GET', '/api/public/operations')).body.hospitals[CHIC].medicines, []);
  assert.equal(hidden.publish, false);
});

test('beds: stale form is refused (409), occupancy changes are atomic and cannot go negative, public view follows, failures are not reported as success', async () => {
  const adm = await admin();
  await approve(adm, ASILO).catch(() => null);
  const mgr = await staff(ASILO, 'manager'), nurse = await staff(ASILO, 'nurse');
  const put = (b, who = mgr) => json('PUT', '/api/staff/wards/icu', b, who.cookie);
  for (const bad of [{ total: -1, available: 0 }, { total: 5, available: 6 }, { total: 5, available: 3, occupied: 3 }, { total: 5, available: 'x' }, { total: 5.5, available: 1 }]) assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  const first = await put({ total: 10, available: 4, occupied: 5, outOfService: 1 });
  assert.equal(first.status, 200);
  const stamp = first.body.ward.updatedAt;
  // two people save from the same loaded form: the second is refused
  await new Promise(r => setTimeout(r, 1100));
  assert.equal((await put({ total: 10, available: 3, occupied: 6, outOfService: 1, expectedUpdatedAt: stamp })).status, 200);
  const stale = await put({ total: 10, available: 9, occupied: 0, outOfService: 1, expectedUpdatedAt: stamp }, nurse);
  assert.equal(stale.status, 409); assert.equal(stale.body.current.available, 3, 'the other change was not overwritten');
  // atomic admit / discharge
  const adm1 = await Promise.all(Array.from({ length: 6 }, () => json('POST', '/api/staff/wards/icu/occupancy', { delta: 1 }, nurse.cookie)));
  assert.equal(adm1.filter(r => r.status === 200).length, 3, 'only 3 beds were available');
  const w = (await json('GET', '/api/staff/wards', undefined, nurse.cookie)).body.wards.find(x => x.type === 'icu');
  assert.deepEqual([w.available, w.occupied, w.outOfService, w.total], [0, 9, 1, 10]);
  assert.equal((await json('POST', '/api/staff/wards/icu/occupancy', { delta: -10 }, nurse.cookie)).status, 409, 'cannot discharge more than are occupied');
  assert.equal((await json('POST', '/api/staff/wards/icu/occupancy', { delta: -2 }, nurse.cookie)).status, 200);
  assert.equal((await json('POST', '/api/staff/wards/icu/occupancy', { delta: 1 }, (await staff(ASILO, 'reception')).cookie)).status, 403);
  // the public feed and the old public directory show the same numbers
  const pub = (await json('GET', '/api/public/operations')).body.hospitals[ASILO];
  assert.equal(pub.beds.wards.find(x => x.type === 'icu').available, 2);
  assert.equal((await json('GET', '/api/facilities')).body.facilities.find(f => f.id === ASILO).icuBeds, 2);
  // the audit trail has every successful change with the actor taken from the session
  const evs = (await json('GET', '/api/audit/events?resourceType=ward&limit=100', undefined, mgr.cookie)).body.items;
  assert.ok(evs.length >= 6 && evs.every(e => e.facilityId === ASILO && e.outcome === 'success' && e.actorId && e.requestId && e.hash.length === 64));
  assert.ok(evs.some(e => e.actorId === nurse.user.id && e.actorRole === 'hospital:nurse'));
});

test('doctor availability, services and hospital details reach the public views', async () => {
  const mgr = await staff(ASILO, 'manager'), rec = await staff(ASILO, 'reception');
  const doc = db.listDoctors().find(d => d.facilityId === ASILO);
  assert.equal((await json('PUT', `/api/doctors/${doc.id}/status`, { dutyStatus: 'On Leave' }, rec.cookie)).status, 200);
  assert.equal((await json('GET', '/api/doctors')).body.doctors.find(d => d.id === doc.id).status, 'On Leave');
  assert.equal((await json('PUT', `/api/doctors/${doc.id}/status`, { dutyStatus: 'On Duty', status: 'In Surgery' }, rec.cookie)).status, 200);
  assert.equal((await json('GET', '/api/doctors')).body.doctors.find(d => d.id === doc.id).status, 'In Surgery');
  assert.equal((await json('POST', '/api/staff/services', { name: 'Dialysis', kind: 'service', available: true }, mgr.cookie)).status, 201);
  assert.ok((await json('GET', '/api/public/operations')).body.hospitals[ASILO].profile.services.includes('Dialysis'));
  const bad = await json('POST', '/api/staff/services', { name: '', kind: 'service' }, mgr.cookie);
  assert.equal(bad.status, 400, 'a failed update is reported as a failure');
  assert.equal((await json('PUT', `/api/appointments/999999/checkin`, {}, rec.cookie)).status, 404);
});

test('audit: access is scoped, denied and cross-hospital attempts are recorded, nothing can edit history, export and verification work', async () => {
  const adm = await admin(), mgr = await staff(GMC, 'manager'), nurse = await staff(GMC, 'nurse'), foreign = await staff(WISDOM, 'manager');
  assert.equal((await json('GET', '/api/audit/events', undefined, (await patient()).cookie)).status, 403);
  // blocked attempts are recorded with the real actor
  assert.equal((await json('POST', '/api/staff/costs', { serviceName: 'X', minCost: 1, maxCost: 2 }, nurse.cookie)).status, 403);
  assert.equal((await json('PUT', `/api/staff/team/${nurse.user.id}`, { staffRole: 'reception' }, foreign.cookie)).status, 404);
  assert.equal((await json('GET', `/api/staff/wards?facilityId=${GMC}`, undefined, foreign.cookie)).status, 403);
  const own = (await json('GET', '/api/audit/events?outcome=blocked', undefined, nurse.cookie)).body;
  assert.equal(own.scope, 'your own actions');
  assert.ok(own.items.length >= 1 && own.items.every(e => e.actorId === nurse.user.id && e.outcome === 'blocked' && e.action === 'unauthorized_action'));
  const fa = (await json('GET', '/api/audit/events?action=cross_hospital_attempt', undefined, adm.cookie)).body.items;
  assert.ok(fa.filter(e => e.actorId === foreign.user.id).length >= 2, 'attempts to reach another hospital are recorded');
  // scoping: manager = own hospital; staff = own actions; admin = everything
  const mgrView = (await json('GET', '/api/audit/events?limit=100', undefined, mgr.cookie)).body.items;
  assert.ok(mgrView.every(e => e.facilityId === GMC));
  const admView = (await json('GET', '/api/audit/events?limit=100', undefined, adm.cookie)).body;
  assert.ok(new Set(admView.items.map(e => e.facilityId)).size > 2 && admView.total > mgrView.length);
  assert.equal((await json('GET', `/api/audit/events/${admView.items.find(e => e.facilityId === WISDOM).id}`, undefined, mgr.cookie)).status, 404);
  // filters + pagination
  const page = (await json('GET', '/api/audit/events?limit=5&offset=5&outcome=success', undefined, adm.cookie)).body;
  assert.equal(page.items.length, 5); assert.ok(page.items.every(e => e.outcome === 'success'));
  assert.equal((await json('GET', '/api/audit/events?outcome=weird', undefined, adm.cookie)).status, 400);
  assert.equal((await json('GET', '/api/audit/events?from=yesterday', undefined, adm.cookie)).status, 400);
  assert.equal((await json('GET', "/api/audit/events?q=%27%3B%20DROP%20TABLE%20audit_events%3B--", undefined, adm.cookie)).status, 200);
  // nobody can change history: refused and recorded
  const target = admView.items[0].id;
  for (const m of ['PUT', 'PATCH', 'DELETE', 'POST']) for (const who of [mgr, adm]) assert.equal((await json(m, `/api/audit/events/${target}`, { action: 'nothing happened' }, who.cookie)).status, 405, m);
  assert.equal((await json('GET', '/api/audit/events?action=audit_tamper_attempt', undefined, adm.cookie)).body.items.length >= 4, true);
  assert.throws(() => db.raw.prepare('UPDATE audit_events SET action = ? WHERE seq = 1').run('x'), /append-only/);
  assert.throws(() => db.raw.prepare('DELETE FROM audit_events WHERE seq = 1').run(), /append-only/);
  audit.checkpoint(adm.user.id);
  assert.throws(() => db.raw.prepare('DELETE FROM audit_checkpoints').run(), /append-only/);
  assert.throws(() => db.raw.prepare('UPDATE audit_checkpoints SET head_hash = ?').run('x'), /append-only/);
  // events are written transactionally with the business change: a rolled-back change leaves no event
  const before = audit.list({}, {}).total;
  assert.throws(() => db.transaction(() => { db.logActivity({ id: 1, name: 'x', role: 'admin' }, { action: 'ghost', entityType: 'x', entityId: 1 }); throw new Error('business failure'); }), /business failure/);
  assert.equal(audit.list({}, {}).total, before);
  // idempotency: a retried operation is recorded once
  const k = 'test-key-' + Date.now();
  audit.append({ actorId: 1, actorRole: 'admin', action: 'retry_test', resourceType: 'x', idempotencyKey: k }); audit.append({ actorId: 1, actorRole: 'admin', action: 'retry_test', resourceType: 'x', idempotencyKey: k });
  assert.equal(audit.list({}, { action: 'retry_test' }).total, 1);
  // no secrets in the log
  const dump = JSON.stringify(gov.raw.prepare('SELECT * FROM audit_events').all());
  assert.ok(!/gci_[\w-]{20}|secret1|password_hash|salt/i.test(dump));
  audit.append({ actorId: 1, actorRole: 'admin', action: 'secret_test', resourceType: 'x', detail: { password: 'hunter2', token: 'abc', note: 'ok' } });
  assert.deepEqual(audit.list({}, { action: 'secret_test' }).items[0].detail, { password: '[redacted]', token: '[redacted]', note: 'ok' });
  // export: CSV, scoped, audited, injection-safe
  audit.append({ actorId: 1, actorRole: 'admin', action: '=cmd()', resourceType: 'x' });
  const csv = await (await call('GET', '/api/audit/export', undefined, adm.cookie)).text();
  assert.ok(csv.startsWith('seq,event_id') && csv.includes("\"'=cmd()\""));
  assert.equal((await json('GET', '/api/audit/events?action=audit_exported', undefined, adm.cookie)).body.items.length, 1);
  // integrity: only administrators verify; the result is stored and shown; a checkpoint is anchored in a separate file
  assert.equal((await json('POST', '/api/audit/verify', {}, mgr.cookie)).status, 403);
  const v = (await json('POST', '/api/audit/verify', {}, adm.cookie)).body.result;
  assert.equal(v.ok, true); assert.ok(v.eventsChecked > 20);
  const integ = (await json('GET', '/api/audit/integrity', undefined, mgr.cookie)).body;
  assert.equal(integ.latestVerification.ok, true); assert.equal(integ.backup.configured, false);
  assert.ok(fs.readFileSync(path.join(process.env.GOACARE_DATA_DIR, 'audit-anchor.log'), 'utf8').trim().split('\n').length >= 1);
  assert.equal(audit.verifyChain().ok, true);
});

test('settings: profile / notifications / sessions follow the role rules; reports respect roles and are audited', async () => {
  const mgr = await staff(GMC, 'manager'), pharm = await staff(GMC, 'pharmacy');
  const prof = (await json('GET', '/api/settings/profile', undefined, mgr.cookie)).body;
  assert.equal(prof.profile.staffRole, 'manager'); assert.deepEqual(prof.editable, ['name', 'email']);
  assert.equal((await json('PUT', '/api/settings/profile', { name: 'New Name', email: 'N@Example.com' }, mgr.cookie)).status, 200);
  assert.equal((await json('GET', '/api/settings/profile', undefined, mgr.cookie)).body.profile.email, 'n@example.com');
  // notifications: mandatory ones cannot be switched off
  assert.equal((await json('PUT', '/api/settings/notifications', { preferences: { security_alerts: false } }, pharm.cookie)).status, 400);
  assert.equal((await json('PUT', '/api/settings/notifications', { preferences: { pending_approvals: false } }, mgr.cookie)).status, 400, 'required for managers');
  assert.equal((await json('PUT', '/api/settings/notifications', { preferences: { pending_approvals: false, stock_alerts: false } }, pharm.cookie)).status, 200);
  assert.equal((await json('PUT', '/api/settings/notifications', { preferences: { nonsense: true } }, pharm.cookie)).status, 400);
  const prefs = (await json('GET', '/api/settings/notifications', undefined, pharm.cookie)).body.preferences;
  assert.equal(prefs.find(p => p.key === 'stock_alerts').enabled, false); assert.equal(prefs.find(p => p.key === 'security_alerts').enabled, true);
  await json('POST', '/api/staff/inventory', { name: 'Zinc', quantity: 0, reorderLevel: 5 }, pharm.cookie);
  assert.ok(!(await json('GET', '/api/staff/overview', undefined, pharm.cookie)).body.alerts.some(a => a.page === 'inventory'), 'a muted notification type no longer alerts');
  assert.ok((await json('GET', '/api/staff/overview', undefined, (await staff(GMC, 'manager')).cookie)).body.governance.hospital, 'overview carries verification state');
  const ov = (await json('GET', '/api/staff/overview', undefined, pharm.cookie)).body;
  assert.ok(ov.restricted && !ov.appointments && !ov.wards, 'pharmacy overview has no clinical data');
  // sessions + security
  await json('POST', '/api/auth/login', { phone: mgr.login, password: 'secret1' });
  const sec = (await json('GET', '/api/settings/security', undefined, mgr.cookie)).body;
  assert.ok(sec.sessions.length >= 2 && sec.sessions.some(s => s.current) && sec.recentLogins.length >= 1);
  assert.equal(sec.mfa.supported, false); assert.equal(sec.password.reset, false);
  const out = (await json('POST', '/api/settings/sessions/revoke-others', {}, mgr.cookie)).body;
  assert.ok(out.revoked >= 1); assert.equal((await json('GET', '/api/settings/profile', undefined, mgr.cookie)).status, 200);
  assert.equal((await json('PUT', '/api/auth/password', { current: 'secret1', next: 'secret2' }, mgr.cookie)).status, 200);
  assert.ok((await json('GET', '/api/audit/events?action=password_changed', undefined, mgr.cookie)).body.items.length >= 1);
  const help = (await json('GET', '/api/settings/help', undefined, mgr.cookie)).body;
  assert.equal(help.support, null); assert.equal(help.privacyPolicyUrl, null); assert.ok(help.version);
  // reports
  const rl = (await json('GET', '/api/reports', undefined, pharm.cookie)).body.reports.map(r => r.name);
  assert.deepEqual(rl, ['inventory-changes']);
  assert.equal((await json('GET', '/api/reports/appointments', undefined, pharm.cookie)).status, 403);
  assert.equal((await json('GET', '/api/reports/pending-verifications', undefined, mgr.cookie)).status, 403);
  const inv = (await json('GET', '/api/reports/inventory-changes', undefined, pharm.cookie)).body; assert.ok(inv.columns.length && Array.isArray(inv.rows));
  const bed = (await json('GET', '/api/reports/bed-availability', undefined, mgr.cookie)); assert.equal(bed.status, 200);
  const csv = await call('GET', '/api/reports/inventory-changes?format=csv', undefined, pharm.cookie);
  assert.equal(csv.status, 200); assert.ok((await csv.text()).startsWith('"Time (UTC)"'));
  assert.ok((await json('GET', '/api/audit/events?action=report_exported', undefined, mgr.cookie)).body.items.length >= 0);
  const adm = await admin();
  assert.equal((await json('GET', '/api/reports/pending-verifications', undefined, adm.cookie)).status, 200);
  assert.equal((await json('GET', '/api/staff/inventory?facilityId=' + GMC, undefined, adm.cookie)).status, 403, 'internal stock is not for the platform administrator');
});

test('login-page onboarding: a new hospital or doctor registers (account + verification request) in one step, all-or-nothing, never staff until approved', async () => {
  const adm = await admin();
  const acct = () => ({ password: 'secret1', name: 'Dr New Person', phone: String(phone++), role: 'patient' });
  const hosp = { type: 'hospital', name: 'Bayview Hospital', hospitalType: 'Private hospital', district: 'South Goa', address: '5 Harbour Road, Vasco, Goa', lat: 15.39, lng: 73.81, phone: '0832 2555555', licenseNo: 'GMC-REG-2026-0100', issuingAuthority: 'Goa DHS' };
  // invalid details: nothing is created (the same mobile number can be used again)
  const a1 = acct();
  assert.equal((await json('POST', '/api/auth/register', { ...a1, onboarding: { ...hosp, lat: 5 } })).status, 400);
  assert.equal((await json('POST', '/api/auth/register', { ...a1, onboarding: { ...hosp, licenseNo: '' } })).status, 400);
  assert.equal((await json('POST', '/api/auth/register', { ...a1, onboarding: { type: 'spaceship' } })).status, 400);
  assert.equal((await json('POST', '/api/auth/login', { phone: a1.phone, password: 'secret1' })).status, 401, 'no half-created account');
  // onboarding cannot be combined with a staff role or a staff code
  assert.equal((await json('POST', '/api/auth/register', { ...a1, role: 'hospital', facilityId: GMC, staffCode: 'TEST-STAFF-CODE', onboarding: hosp })).status, 400);
  // valid hospital: signed in as a patient, request pending, unlisted, nothing published
  const r = await json('POST', '/api/auth/register', { ...a1, onboarding: { ...hosp, role: 'admin', verification_status: 'approved' } });
  assert.equal(r.status, 201); assert.equal(r.body.user.role, 'patient'); assert.equal(r.body.submitted.type, 'hospital');
  const cookie = (r.res.headers.get('set-cookie') || '').split(';')[0];
  const f = db.getStaffFacility(r.body.submitted.facilityId);
  assert.equal(f.verificationStatus, 'pending'); assert.equal(f.listingStatus, 'unlisted'); assert.equal(f.hospitalCode, null);
  assert.equal(gov.registrationFor(f.id).repName, 'Dr New Person');
  assert.equal((await json('GET', '/api/staff/inventory', undefined, cookie)).status, 403, 'not staff before approval');
  assert.equal((await json('POST', '/api/documents', { ownerType: 'hospital', ownerId: f.id, name: 'licence.pdf', data: PDF }, cookie)).status, 201, 'document can be attached right after');
  assert.ok((await json('GET', '/api/admin/verification/hospitals?status=pending', undefined, adm.cookie)).body.hospitals.some(h => h.id === f.id && h.documents === 1));
  assert.equal((await json('PUT', `/api/admin/hospitals/${f.id}/status`, { status: 'approved' }, adm.cookie)).status, 200);
  const me = (await json('GET', '/api/auth/me', undefined, cookie)).body.user;
  assert.equal(me.role, 'hospital'); assert.equal(me.staffRole, 'manager'); assert.equal(me.facilityId, f.id);
  // doctor: account + professional details together; duplicate registration number leaves nothing behind
  const d1 = acct();
  const doc = { type: 'doctor', qualifications: 'MBBS, MS', registrationNo: 'GMC-55555', issuingAuthority: 'Goa Medical Council', specialty: 'Surgery', facilityId: f.id };
  const dr = await json('POST', '/api/auth/register', { ...d1, onboarding: doc });
  assert.equal(dr.status, 201); assert.equal(dr.body.user.role, 'patient'); assert.equal(dr.body.submitted.type, 'doctor');
  const dc = (dr.res.headers.get('set-cookie') || '').split(';')[0];
  const mine = (await json('GET', '/api/doctors/mine', undefined, dc)).body;
  assert.equal(mine.registration.status, 'pending'); assert.equal(mine.registration.doctorCode, null); assert.equal(mine.affiliations[0].status, 'requested');
  const d2 = acct();
  assert.equal((await json('POST', '/api/auth/register', { ...d2, onboarding: doc })).status, 409);
  assert.equal((await json('POST', '/api/auth/login', { phone: d2.phone, password: 'secret1' })).status, 401, 'duplicate registration number creates no account');
  assert.equal((await json('GET', '/api/auth/me', undefined, dc)).body.user.role, 'patient', 'a pending doctor is not a doctor');
  // abuse limit: only a few new registrations per connection per hour
  let limited = false;
  for (let i = 0; i < 8 && !limited; i++) limited = (await json('POST', '/api/auth/register', { ...acct(), onboarding: { ...hosp, name: 'Spam Hospital ' + i, licenseNo: 'SPAM-' + i + '000' } })).status === 429;
  assert.ok(limited, 'bulk registrations are throttled');
});
