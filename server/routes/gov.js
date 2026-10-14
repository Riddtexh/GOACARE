'use strict';
// Hospital + doctor registration and verification, permanent IDs, affiliations, secure staff invitations, account deactivation.
//   POST /api/hospitals/register                 any signed-in account: submit a hospital for verification (stays pending; unlisted)
//   GET  /api/hospitals/mine                     my submissions and their status
//   GET  /api/admin/verification/hospitals       super administrator: queue (?status=)      PUT /api/admin/hospitals/:id/status {status, reason, password}
//   POST /api/doctors/register                   signed-in account: professional details (pending)   POST /api/doctors/affiliations {facilityId}
//   GET  /api/admin/verification/doctors         PUT /api/admin/doctors/:id/decision {decision, reason, credentialsVerified, credentialNote}
//   GET  /api/staff/affiliations                 hospital manager: doctors asking to join / working here     PUT /api/staff/affiliations/:id {action: verify|reject|end}
//   POST|GET /api/staff/invitations              PUT /api/staff/invitations/:id {action: revoke|regenerate}       POST /api/invitations/redeem {token}
//   PUT  /api/staff/team/:id/access {action: deactivate|reactivate|remove}
//   POST /api/documents (upload)  GET /api/documents/:id (download, authorised only)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const gov = require('../gov-db');
const auth = require('../auth');
const audit = require('../lib/audit');
const S = require('../lib/staff');
const { send, httpError } = require('../lib/http');
const { requireUser, requireRole } = require('../lib/router');

const dataDir = process.env.GOACARE_DATA_DIR || path.join(__dirname, '..', 'data');
const docDir = path.join(dataDir, 'verification-docs');   // outside client/, never served statically
const INVITE_TTL_HOURS = () => Math.min(168, Math.max(1, Number(process.env.GOACARE_INVITE_TTL_HOURS) || 48));
const MAX_DOC = 2 * 1024 * 1024;
const DOC_TYPES = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] };   // checked against the real file bytes, not the client's claim

const text = S.text;
const reason = (v, required) => text(v, 500, 'Reason', { required, min: required ? 5 : 0 });
const phoneOk = (v, label) => { if (v && !/^\+?[\d][\d\s\-().]{4,28}$/.test(v)) throw httpError(400, `${label} must be a phone number.`); return v; };
const emailOk = (v, label) => { if (v && !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v)) throw httpError(400, `${label} must be an email address.`); return v.toLowerCase(); };
const log = (user, e) => db.logActivity(user, e);

// Step-up authentication: the person must type their password again for the most sensitive actions.
async function confirmPassword(user, given) {
  const row = require('../ops-db').passwordHash(user.id);
  if (typeof given !== 'string' || !given || !(await auth.verifyPassword(given, row.password_hash, row.salt))) throw httpError(403, 'Please confirm your password to continue.', { code: 'reauth_required' });
}

// ---- shared by "Register a hospital" (signed-in) and the login-page registration (creates the account in the same transaction) ----
function parseHospital(b) {
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!(lat >= 14.8 && lat <= 15.9 && lng >= 73.6 && lng <= 74.4)) throw httpError(400, 'The hospital location must be inside Goa (latitude 14.8–15.9, longitude 73.6–74.4).');
  const departments = (Array.isArray(b.departments) ? b.departments : String(b.departments || '').split(',')).map(x => text(x, 60, 'Department')).filter(Boolean).slice(0, 30);
  return {
    name: text(b.name, 120, 'Official hospital name', { required: true, min: 3 }), careType: text(b.hospitalType, 40, 'Hospital type', { required: true }), district: text(b.district, 40, 'District', { required: true }),
    address: text(b.address, 240, 'Address', { required: true, min: 8 }), phone: phoneOk(text(b.phone, 30, 'Official phone', { required: true }), 'Official phone'), lat, lng, departments,
    operatingHours: text(b.operatingHours, 120, 'Operating hours'), emergencyContact: phoneOk(text(b.emergencyContact, 30, 'Emergency contact'), 'Emergency contact'),
    licenseNo: text(b.licenseNo, 60, 'Registration / licence number', { required: true, min: 4 }), issuingAuthority: text(b.issuingAuthority, 100, 'Issuing authority', { required: true, min: 3 }),
    repName: text(b.repName, 80, 'Authorised representative name', { required: true, min: 2 }), repTitle: text(b.repTitle, 60, 'Representative role'), repPhone: phoneOk(text(b.repPhone, 30, 'Representative phone'), 'Representative phone'), repEmail: emailOk(text(b.repEmail, 120, 'Representative email'), 'Representative email')
  };
}
function submitHospital(u, h) {
  const fid = gov.createHospitalRegistration(u.id, h);
  log(u, { facilityId: fid, action: 'hospital_registration_submitted', entityType: 'hospital', entityId: fid, detail: { name: h.name, hospitalType: h.careType, licenceSubmitted: true } });
  return fid;
}
function parseDoctor(b) {
  return { fullName: text(b.fullName, 80, 'Full name', { required: true, min: 3 }), qualifications: text(b.qualifications, 200, 'Qualifications', { required: true, min: 2 }),
    registrationNo: text(b.registrationNo, 40, 'Medical registration number', { required: true, min: 3 }), issuingAuthority: text(b.issuingAuthority, 100, 'Issuing authority', { required: true, min: 3 }),
    specialty: text(b.specialty, 60, 'Specialty', { required: true, min: 2 }), department: text(b.department, 60, 'Department') };
}
// Returns the registration id. Throws 409 if the registration number is already claimed.
function submitDoctor(u, d, facilityId) {
  let id;
  try { id = gov.createDoctorRegistration(u.id, d); }
  catch (e) { if (/UNIQUE/i.test(e.message)) throw httpError(409, 'That registration number is already in use for this authority.'); throw e; }
  log(u, { action: 'doctor_registration_submitted', entityType: 'doctor_registration', entityId: id, detail: { specialty: d.specialty, issuingAuthority: d.issuingAuthority } });
  const f = facilityId ? db.getStaffFacility(String(facilityId)) : null;
  if (f && f.verificationStatus === 'approved') gov.requestAffiliation(u.id, f.id, 'request');
  return id;
}

module.exports = function (router) {
  // ============================================================ hospital registration ============================================================
  router.add('POST', '/api/hospitals/register', async ctx => {
    const u = requireUser(ctx);
    if (u.role !== 'patient') throw httpError(403, 'Only a personal (patient) account can submit a new hospital. Staff accounts already belong to a hospital.');
    const open = gov.registrationsBy(u.id).filter(r => r.status === 'pending');
    if (open.length >= 3) throw httpError(429, 'You already have several registrations waiting for review.');
    const h = parseHospital(await ctx.body());
    const id = db.transaction(() => submitHospital(u, h));
    send(ctx.res, 201, { facilityId: id, status: 'pending', message: 'Submitted. The hospital stays unlisted and unverified until a GoaCare administrator reviews it.' });
  });

  router.add('GET', '/api/hospitals/mine', ctx => {
    const u = requireUser(ctx);
    send(ctx.res, 200, { registrations: gov.registrationsBy(u.id).map(r => ({ ...r, documents: gov.documentsFor('hospital', r.facilityId).map(d => ({ id: d.id, name: d.name, size: d.size })), hospital: (({ name, verificationStatus, hospitalCode }) => ({ name, verificationStatus, hospitalCode }))(db.getFacility(r.facilityId)) })) });
  });

  // ---- documents: JSON upload (base64, 2 MB max, PDF / PNG / JPEG verified by file signature), stored outside the web root under a random name ----
  router.add('POST', '/api/documents', async ctx => {
    const u = requireUser(ctx), b = await ctx.body(3 * 1024 * 1024);
    const type = b.ownerType === 'doctor' ? 'doctor' : b.ownerType === 'hospital' ? 'hospital' : null;
    if (!type) throw httpError(400, 'ownerType must be hospital or doctor.');
    let ownerId;
    if (type === 'hospital') {
      const reg = gov.registrationFor(String(b.ownerId || ''));
      if (!reg || reg.submittedBy !== u.id) throw httpError(404, 'Registration not found.');
      if (reg.status !== 'pending') throw httpError(409, 'Documents can only be added while the registration is pending.');
      ownerId = reg.facilityId;
    } else {
      const reg = gov.doctorRegistration(u.id);
      if (!reg || reg.status !== 'pending') throw httpError(409, 'Submit your professional details first (and only while they are pending).');
      ownerId = String(reg.id);
    }
    if (gov.documentsFor(type, ownerId).length >= 5) throw httpError(400, 'At most 5 documents per registration.');
    const buf = Buffer.from(String(b.data || ''), 'base64');
    if (!buf.length || buf.length > MAX_DOC) throw httpError(400, 'The file must be between 1 byte and 2 MB.');
    const mime = Object.keys(DOC_TYPES).find(m => DOC_TYPES[m].every((byte, i) => buf[i] === byte));
    if (!mime) throw httpError(400, 'Only PDF, PNG or JPEG documents are accepted.');
    fs.mkdirSync(docDir, { recursive: true, mode: 0o700 });
    const stored = crypto.randomBytes(24).toString('hex') + '.bin';
    fs.writeFileSync(path.join(docDir, stored), buf, { mode: 0o600 });
    const name = text(b.name, 120, 'File name', { required: true }).replace(/[^\w.\- ()]/g, '_');
    const id = db.transaction(() => {
      const n = gov.addDocument({ ownerType: type, ownerId, name, mime, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), storedName: stored, uploadedBy: u.id });
      log(u, { facilityId: type === 'hospital' ? ownerId : null, action: 'verification_document_uploaded', entityType: 'document', entityId: n, detail: { ownerType: type, size: buf.length, mime } });
      return n;
    });
    send(ctx.res, 201, { id, name, size: buf.length, mime });
  });
  router.add('GET', '/api/documents/:id', ctx => {
    const u = requireUser(ctx), d = gov.documentById(Number(ctx.params.id));
    let allowed = false;
    if (d) {
      if (u.role === 'admin') allowed = true;
      else if (d.uploadedBy === u.id) allowed = true;
    }
    if (!d || !allowed) { if (d) audit.recordFailure(u, { action: 'document_access_denied', resourceType: 'document', resourceId: d.id, outcome: 'blocked', reason: 'Not the uploader or a super administrator.' }); throw httpError(404, 'Document not found.'); }
    if (u.role === 'admin') audit.append({ actorId: u.id, actorRole: 'admin', action: 'verification_document_viewed', resourceType: 'document', resourceId: d.id, detail: { ownerType: d.ownerType } });
    const buf = fs.readFileSync(path.join(docDir, d.storedName));
    ctx.res.writeHead(200, { 'Content-Type': d.mime, 'Content-Length': buf.length, 'Content-Disposition': `attachment; filename="${d.name.replace(/"/g, '')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(buf);
  });

  // ---- super administrator: hospital review ----
  router.add('GET', '/api/admin/verification/hospitals', ctx => {
    requireRole(ctx, 'admin');
    const st = ctx.query.get('status');
    if (st && !Object.keys(gov.TRANSITIONS).includes(st)) throw httpError(400, 'Unknown status.');
    send(ctx.res, 200, { hospitals: gov.hospitalQueue(st).map(h => ({ ...h, documentList: gov.documentsFor('hospital', h.id).map(d => ({ id: d.id, name: d.name, size: d.size })) })) });
  });
  router.add('PUT', '/api/admin/hospitals/:id/status', async ctx => {
    const admin = requireRole(ctx, 'admin'), b = await ctx.body();
    const to = String(b.status || ''), f = db.getStaffFacility(ctx.params.id);
    if (!f) throw httpError(404, 'Unknown hospital.');
    if (!['approved', 'rejected', 'suspended', 'pending'].includes(to)) throw httpError(400, 'Status must be approved, rejected, suspended or pending.');
    const why = reason(b.reason, to === 'rejected' || to === 'suspended' || f.verificationStatus === 'suspended');
    if (to === 'suspended' || (to === 'approved' && f.verificationStatus === 'suspended')) await confirmPassword(admin, b.password);   // suspension / reactivation: recent authentication
    const r = db.transaction(() => {
      const x = gov.setHospitalStatus(f.id, to, admin.id, why);
      if (x.error) return x;
      log(admin, { facilityId: f.id, action: 'hospital_' + (to === 'approved' && x.from === 'suspended' ? 'reactivated' : to), entityType: 'hospital', entityId: f.id, reason: why, detail: { name: f.name, before: { status: x.from }, after: { status: to, hospitalCode: x.code } } });
      return x;
    });
    if (r.error) throw httpError(r.error, r.message);
    send(ctx.res, 200, { facility: db.getStaffFacility(f.id), hospitalCode: r.code });
  });

  // ============================================================ doctors ============================================================
  router.add('POST', '/api/doctors/register', async ctx => {
    const u = requireUser(ctx);
    if (u.role !== 'patient' && u.role !== 'doctor') throw httpError(403, 'Hospital staff accounts cannot register as a doctor. Use a separate personal account.');
    if (gov.doctorRegistration(u.id)) throw httpError(409, 'You have already submitted your professional details.');
    const b = await ctx.body();
    const id = db.transaction(() => submitDoctor(u, parseDoctor(b), b.facilityId));
    send(ctx.res, 201, { id, status: 'pending', credentialStatus: 'unchecked', message: 'Submitted. You are not a verified doctor until your credentials are checked and an administrator approves.' });
  });
  router.add('GET', '/api/doctors/mine', ctx => {
    const u = requireUser(ctx);
    send(ctx.res, 200, { registration: gov.doctorRegistration(u.id), affiliations: gov.affiliationsOf(u.id) });
  });
  router.add('POST', '/api/doctors/affiliations', async ctx => {
    const u = requireUser(ctx), reg = gov.doctorRegistration(u.id);
    if (!reg || reg.status === 'rejected') throw httpError(409, 'Submit your professional details first.');
    const f = db.getStaffFacility(String((await ctx.body()).facilityId || ''));
    if (!f || f.verificationStatus !== 'approved') throw httpError(400, 'Choose a hospital that is verified on GoaCare.');
    if (gov.affiliationsOf(u.id).some(a => a.facilityId === f.id && ['requested', 'hospital_verified', 'approved'].includes(a.status))) throw httpError(409, 'You already have an open request or affiliation with this hospital.');
    const id = db.transaction(() => { const n = gov.requestAffiliation(u.id, f.id, 'request'); log(u, { facilityId: f.id, action: 'affiliation_requested', entityType: 'affiliation', entityId: n, detail: { hospital: f.name } }); return n; });
    send(ctx.res, 201, { id, status: 'requested' });
  });
  router.add('GET', '/api/admin/verification/doctors', ctx => { requireRole(ctx, 'admin'); send(ctx.res, 200, { doctors: gov.doctorQueue(ctx.query.get('status') || null) }); });
  router.add('PUT', '/api/admin/doctors/:id/decision', async ctx => {
    const admin = requireRole(ctx, 'admin'), b = await ctx.body();
    const decision = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : null;
    if (!decision) throw httpError(400, 'decision must be approve or reject.');
    const why = reason(b.reason, decision === 'rejected');
    // credentialsVerified = "I checked this registration number against the official register". Nothing is verified automatically (no registry is connected).
    const cred = b.credentialsVerified === true ? { status: 'verified', note: text(b.credentialNote, 300, 'Verification note', { required: true, min: 5 }) } : b.credentialsVerified === false ? { status: 'failed', note: text(b.credentialNote, 300, 'Verification note') } : null;
    const r = db.transaction(() => {
      const x = gov.decideDoctor(Number(ctx.params.id), decision, admin.id, why, cred);
      if (x.error) return x;
      const reg = gov.doctorRegistrationById(Number(ctx.params.id));
      log(admin, { action: 'doctor_' + decision, entityType: 'doctor_registration', entityId: reg.id, reason: why, detail: { after: { status: decision, doctorCode: x.code || null, credentials: reg.credentialStatus }, activatedAffiliations: (x.activated || []).length } });
      return x;
    });
    if (r.error) throw httpError(r.error, r.message);
    send(ctx.res, 200, { registration: gov.doctorRegistrationById(Number(ctx.params.id)), doctorCode: r.code || null });
  });

  // ---- hospital manager: affiliations at their own hospital ----
  router.add('GET', '/api/staff/affiliations', ctx => {
    const { facilityId } = S.authorize(ctx, 'team');
    send(ctx.res, 200, { facilityId, affiliations: gov.affiliationsAt(facilityId, ['requested', 'hospital_verified', 'approved']) });
  });
  router.add('PUT', '/api/staff/affiliations/:id', async ctx => {
    const { user, facilityId } = S.authorize(ctx, 'team', 'write'), b = await ctx.body();
    const a = gov.affiliation(Number(ctx.params.id));
    if (!a || a.facilityId !== facilityId) throw S.crossHospital('Affiliation not found.', 404);
    const action = String(b.action || '');
    const done = db.transaction(() => {
      let ok = false, extra = {};
      if (action === 'verify') { ok = gov.hospitalVerifyAffiliation(a.id, user.id) === 1; if (ok) extra.activated = gov.settleAffiliations(a.userId).length; }
      else if (action === 'reject') ok = gov.rejectAffiliation(a.id, user.id, reason(b.reason, true)) === 1;
      else if (action === 'end') ok = !!gov.endAffiliation(a.id, user.id, reason(b.reason, true));
      else throw httpError(400, 'action must be verify, reject or end.');
      if (!ok) throw httpError(409, 'That affiliation cannot be changed from its current state.');
      log(user, { facilityId, action: 'affiliation_' + (action === 'verify' ? 'verified' : action === 'reject' ? 'rejected' : 'ended'), entityType: 'affiliation', entityId: a.id, reason: b.reason, detail: { before: { status: a.status }, ...extra } });
      return extra;
    });
    send(ctx.res, 200, { affiliation: gov.affiliation(a.id), ...done });
  });

  // ============================================================ invitations ============================================================
  const INVITABLE = S.STAFF_ROLES.concat(['doctor']);
  router.add('GET', '/api/staff/invitations', ctx => {
    const { facilityId } = S.authorize(ctx, 'invites');
    send(ctx.res, 200, { facilityId, ttlHours: INVITE_TTL_HOURS(), roles: INVITABLE, invitations: gov.invitations(facilityId) });
  });
  async function makeInvitation(ctx, b, replaces) {
    const { user, facilityId, facility } = S.authorize(ctx, 'invites', 'write', { requested: b.facilityId });
    if (facility.verificationStatus !== 'approved') throw httpError(403, 'Only an approved hospital can invite staff.');
    const role = String(b.role || '');
    if (!INVITABLE.includes(role)) throw httpError(400, 'Choose a valid role.');
    // Only the GoaCare super administrator may invite a hospital administrator ("manager"): a manager cannot mint more managers.
    if (role === 'manager' && user.role !== 'admin') throw httpError(403, 'Only a GoaCare administrator can invite another hospital administrator.');
    const raw = text(b.recipient, 120, 'Recipient email or mobile number / Health ID', { required: true, min: 4 });
    const isEmail = raw.includes('@'), recipient = isEmail ? emailOk(raw, 'Recipient email') : auth.normaliseLoginId(raw);
    if (!isEmail && !/^\+?[a-z0-9]{4,32}$/.test(recipient)) throw httpError(400, 'Enter an email address or a valid mobile number / Health ID.');
    if ((!replaces || replaces.none) && gov.hasPendingInvite(facilityId, recipient, role)) throw httpError(409, 'There is already a pending invitation for this person and role. Revoke or regenerate it.');
    const inv = db.transaction(() => {
      if (replaces) gov.revokeInvitation(replaces.id, user.id);
      const i = gov.createInvitation({ facilityId, role, recipient, kind: isEmail ? 'email' : 'login', createdBy: user.id, ttlHours: INVITE_TTL_HOURS() });
      log(user, { facilityId, action: replaces ? 'invitation_regenerated' : 'invitation_created', entityType: 'invitation', entityId: i.id, detail: { role, recipientKind: isEmail ? 'email' : 'login', expiresAt: i.expiresAt, replaces: replaces ? replaces.id : undefined } });   // the token itself is never logged
      return i;
    });
    return { invitation: gov.invitation(inv.id), token: inv.token, link: `/staff.html#/join?token=${inv.token}`, note: 'Copy the link now. For security it cannot be shown again.' };
  }
  router.add('POST', '/api/staff/invitations', async ctx => send(ctx.res, 201, await makeInvitation(ctx, await ctx.body())));
  router.add('PUT', '/api/staff/invitations/:id', async ctx => {
    const b = await ctx.body(), id = Number(ctx.params.id), inv = Number.isInteger(id) ? gov.invitation(id) : null;
    const { user, facilityId } = S.authorize(ctx, 'invites', 'write', { requested: inv ? inv.facilityId : undefined });
    if (!inv || inv.facilityId !== facilityId) throw S.crossHospital('Invitation not found.', 404);
    if (b.action === 'revoke') {
      const n = db.transaction(() => { const c = gov.revokeInvitation(inv.id, user.id); if (c) log(user, { facilityId, action: 'invitation_revoked', entityType: 'invitation', entityId: inv.id, detail: { role: inv.role } }); return c; });
      if (!n) throw httpError(409, 'Only a pending invitation can be revoked.');
      return send(ctx.res, 200, { invitation: gov.invitation(inv.id) });
    }
    if (b.action === 'regenerate') {
      if (inv.status === 'redeemed') throw httpError(409, 'This invitation was already used.');
      return send(ctx.res, 201, await makeInvitation(ctx, { facilityId, role: inv.role, recipient: inv.recipient }, inv.status === 'pending' ? inv : { id: inv.id, none: true }));
    }
    throw httpError(400, 'action must be revoke or regenerate.');
  });
  // Redeeming needs a signed-in account whose mobile number / Health ID (or email) matches the invitation. The role comes from the invitation, never from the request.
  const redeemThrottle = require('../lib/throttle').createThrottle(10, 15 * 60 * 1000);
  router.add('POST', '/api/invitations/redeem', async ctx => {
    const u = requireUser(ctx), key = String(u.id);
    if (redeemThrottle.blocked(key)) throw httpError(429, 'Too many attempts. Please wait a few minutes.');
    const b = await ctx.body();
    const r = db.transaction(() => {
      const x = gov.redeemInvitation(b.token, u, auth.normaliseLoginId(u.phone));
      if (x.ok) log(u, { facilityId: x.invite.facilityId, action: 'invitation_redeemed', entityType: 'invitation', entityId: x.invite.id, idempotencyKey: 'invite-redeemed:' + x.invite.id, detail: { role: x.invite.role, after: { role: x.invite.role } } });
      return x;
    });
    if (!r.ok) { redeemThrottle.fail(key); audit.recordFailure(u, { action: 'invitation_redeem_rejected', resourceType: 'invitation', outcome: 'blocked', reason: r.message }); throw httpError(r.error, r.message); }
    const me = db.findUserById(u.id);
    send(ctx.res, 200, { ok: true, role: me.role, staffRole: me.staffRole, facilityId: me.facilityId, message: r.invite.role === 'doctor' ? 'Hospital affiliation confirmed. You become a verified doctor only after your professional credentials are approved.' : 'Welcome aboard.' });
  });

  // ============================================================ account control ============================================================
  router.add('PUT', '/api/staff/team/:id/access', async ctx => {
    const u = requireRole(ctx, 'hospital', 'admin');
    if (!S.can(u, 'team', 'write')) throw S.deny('write');
    const b = await ctx.body(), target = db.findUserById(Number(ctx.params.id));
    if (!target || target.role !== 'hospital' || (u.role === 'hospital' && target.facilityId !== u.facilityId)) throw S.crossHospital('Staff account not found.', 404);
    if (target.id === u.id) throw httpError(409, 'You cannot change your own access. Ask another administrator.');
    const action = String(b.action || ''), why = reason(b.reason, action !== 'reactivate');
    if (!['deactivate', 'reactivate', 'remove'].includes(action)) throw httpError(400, 'action must be deactivate, reactivate or remove.');
    if (target.staffRole === 'manager' && action !== 'reactivate' && require('../ops-db').managerCount(target.facilityId) <= 1) throw httpError(409, 'Every hospital needs at least one administrator. Make someone else an administrator first.');
    db.transaction(() => {
      if (action === 'remove') gov.removeFromHospital(target.id); else gov.setActive(target.id, action === 'reactivate', why);
      log(u, { facilityId: target.facilityId, action: 'account_' + (action === 'deactivate' ? 'deactivated' : action === 'reactivate' ? 'reactivated' : 'removed_from_hospital'), entityType: 'staff_account', entityId: target.id, reason: why, detail: { name: target.name, role: target.staffRole } });
    });
    send(ctx.res, 200, { ok: true, team: require('../ops-db').team(target.facilityId).map(m => ({ ...m, active: db.findUserById(m.id).active })) });
  });
};
module.exports.confirmPassword = confirmPassword;
module.exports.parseHospital = parseHospital;
module.exports.submitHospital = submitHospital;
module.exports.parseDoctor = parseDoctor;
module.exports.submitDoctor = submitDoctor;
