'use strict';
// Governance data: hospital + doctor registration and verification, permanent IDs, affiliations, secure staff invitations, approval requests,
// medicine inventory, notification preferences, login history and security alerts. Every SQL statement for these lives here.
// Tables are created by VERSIONED migrations (schema_migrations). Nothing is dropped; legacy rows are only marked (see migration 001).
const crypto = require('crypto');
const db = require('./db');
require('./ops-db');
require('./lib/audit');
const raw = db.raw;
const NOW = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
const MIGRATIONS = [
  { id: '2026_10_001_governance_tables', up: () => raw.exec(`
    CREATE TABLE IF NOT EXISTS id_sequences (name TEXT PRIMARY KEY, last_value INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hospital_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL UNIQUE REFERENCES facilities(id), submitted_by INTEGER NOT NULL REFERENCES users(id),
      rep_name TEXT NOT NULL, rep_title TEXT NOT NULL DEFAULT '', rep_phone TEXT NOT NULL DEFAULT '', rep_email TEXT NOT NULL DEFAULT '',
      hospital_type TEXT NOT NULL, departments TEXT NOT NULL DEFAULT '[]', emergency_contact TEXT NOT NULL DEFAULT '', operating_hours TEXT NOT NULL DEFAULT '',
      license_no TEXT NOT NULL, issuing_authority TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL, decided_at TEXT, decided_by INTEGER, decision_reason TEXT);
    CREATE TABLE IF NOT EXISTS verification_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
      sha256 TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, uploaded_by INTEGER NOT NULL, uploaded_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_vdoc_owner ON verification_documents(owner_type, owner_id);
    CREATE TABLE IF NOT EXISTS doctor_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), full_name TEXT NOT NULL, qualifications TEXT NOT NULL,
      registration_no TEXT NOT NULL, issuing_authority TEXT NOT NULL, specialty TEXT NOT NULL, department TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', credential_status TEXT NOT NULL DEFAULT 'unchecked', credential_note TEXT NOT NULL DEFAULT '',
      doctor_code TEXT UNIQUE, submitted_at TEXT NOT NULL, decided_at TEXT, decided_by INTEGER, decision_reason TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_regno ON doctor_registrations(lower(issuing_authority), lower(registration_no));
    CREATE TABLE IF NOT EXISTS doctor_affiliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id), facility_id TEXT NOT NULL REFERENCES facilities(id), doctor_row_id INTEGER,
      status TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'request', requested_at TEXT NOT NULL, hospital_verified_by INTEGER, hospital_verified_at TEXT,
      approved_at TEXT, ended_at TEXT, ended_by INTEGER, end_reason TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_aff_open ON doctor_affiliations(user_id, facility_id) WHERE status IN ('requested','hospital_verified','approved');
    CREATE TABLE IF NOT EXISTS staff_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id), role TEXT NOT NULL, recipient TEXT NOT NULL, recipient_kind TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, created_by INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      redeemed_by INTEGER, redeemed_at TEXT, revoked_at TEXT, revoked_by INTEGER);
    CREATE INDEX IF NOT EXISTS idx_invite_fac ON staff_invitations(facility_id, id);
    CREATE TABLE IF NOT EXISTS approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id), kind TEXT NOT NULL, summary TEXT NOT NULL,
      payload TEXT NOT NULL, current_value TEXT, requested_by INTEGER NOT NULL, requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      decided_by INTEGER, decided_at TEXT, decision_reason TEXT, applied_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_appr_fac ON approval_requests(facility_id, status, id);
    CREATE TABLE IF NOT EXISTS medicine_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE, name TEXT NOT NULL, strength TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'units', quantity INTEGER NOT NULL CHECK (quantity >= 0), reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
      publish INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS uq_med_name ON medicine_inventory(facility_id, lower(name), lower(strength));
    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES medicine_inventory(id) ON DELETE CASCADE, facility_id TEXT NOT NULL,
      delta INTEGER NOT NULL, qty_before INTEGER NOT NULL, qty_after INTEGER NOT NULL, reason TEXT NOT NULL, by_user INTEGER NOT NULL, by_name TEXT NOT NULL, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_invadj_fac ON inventory_adjustments(facility_id, id);
    CREATE TABLE IF NOT EXISTS notification_prefs (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, key TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (user_id, key));
    CREATE TABLE IF NOT EXISTS login_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, success INTEGER NOT NULL, ip_hint TEXT, user_agent TEXT, at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_login_user ON login_events(user_id, id);
  `) },
  // Existing hospitals are NOT verified by this change. They keep their public listing, are flagged legacy = 1 and stay "pending" until a super administrator reviews them.
  { id: '2026_10_002_mark_legacy_hospitals', up: () => raw.exec("UPDATE facilities SET legacy = 1 WHERE legacy = 0 AND hospital_code IS NULL AND id NOT LIKE 'reg-%'") }
];
for (const m of MIGRATIONS) {
  if (raw.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(m.id)) continue;
  db.transaction(() => { m.up(); raw.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, NOW()); });
}
const migrationStatus = () => raw.prepare('SELECT id, applied_at FROM schema_migrations ORDER BY id').all();

// ---------- permanent identifiers ----------
// Sequential, never reused (the counter only goes up, rows are never deleted), unrelated to any personal data. e.g. GOC-HOS-00001, GOC-DOC-00001.
function nextCode(name, prefix) {
  raw.prepare('INSERT INTO id_sequences (name, last_value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(name);
  raw.prepare('UPDATE id_sequences SET last_value = last_value + 1 WHERE name = ?').run(name);
  return `${prefix}-${String(raw.prepare('SELECT last_value AS n FROM id_sequences WHERE name = ?').get(name).n).padStart(5, '0')}`;
}

// ---------- hospital registration + verification ----------
const regRow = r => r && ({ id: r.id, facilityId: r.facility_id, submittedBy: r.submitted_by, repName: r.rep_name, repTitle: r.rep_title, repPhone: r.rep_phone, repEmail: r.rep_email, hospitalType: r.hospital_type,
  departments: JSON.parse(r.departments || '[]'), emergencyContact: r.emergency_contact, operatingHours: r.operating_hours, licenseNo: r.license_no, issuingAuthority: r.issuing_authority, status: r.status,
  submittedAt: r.submitted_at, decidedAt: r.decided_at, decidedBy: r.decided_by, decisionReason: r.decision_reason });
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'hospital';
function createHospitalRegistration(userId, h) {
  let id = 'reg-' + slug(h.name) + '-' + crypto.randomBytes(3).toString('hex');
  raw.prepare(`INSERT INTO facilities (id, name, care_type, district, address, phone, lat, lng, specialties, listing_status, verification_status, legacy, operating_hours, emergency_available)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unlisted', 'pending', 0, ?, NULL)`).run(id, h.name, h.careType, h.district, h.address, h.phone, h.lat, h.lng, JSON.stringify(h.departments), h.operatingHours);
  raw.prepare(`INSERT INTO hospital_registrations (facility_id, submitted_by, rep_name, rep_title, rep_phone, rep_email, hospital_type, departments, emergency_contact, operating_hours, license_no, issuing_authority, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, h.repName, h.repTitle, h.repPhone, h.repEmail, h.careType, JSON.stringify(h.departments), h.emergencyContact, h.operatingHours, h.licenseNo, h.issuingAuthority, NOW());
  return id;
}
const registrationFor = fid => regRow(raw.prepare('SELECT * FROM hospital_registrations WHERE facility_id = ?').get(fid));
const registrationsBy = uid => raw.prepare('SELECT * FROM hospital_registrations WHERE submitted_by = ? ORDER BY id DESC').all(uid).map(regRow);
const TRANSITIONS = { pending: ['approved', 'rejected'], approved: ['suspended'], suspended: ['approved', 'rejected'], rejected: ['pending'] };
// Returns { from, to, code }. The caller has already checked that the actor is a super administrator and supplied a reason where required.
function setHospitalStatus(fid, to, adminId, reason) {
  const f = raw.prepare('SELECT * FROM facilities WHERE id = ?').get(fid);
  if (!f) return { error: 404, message: 'Unknown hospital.' };
  if (!(TRANSITIONS[f.verification_status] || []).includes(to)) return { error: 409, message: `A ${f.verification_status} hospital cannot be moved to ${to}.` };
  let code = f.hospital_code;
  if (to === 'approved' && !code) code = nextCode('hospital', 'GOC-HOS');
  const listing = to === 'approved' ? 'listed' : (to === 'pending' ? f.listing_status : 'unlisted');
  raw.prepare('UPDATE facilities SET verification_status = ?, hospital_code = ?, listing_status = ?, verification_updated_at = ?, verification_updated_by = ?, verification_note = ? WHERE id = ?').run(to, code, listing, NOW(), adminId, reason || null, fid);
  const reg = raw.prepare('SELECT * FROM hospital_registrations WHERE facility_id = ?').get(fid);
  if (reg) {
    raw.prepare('UPDATE hospital_registrations SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE facility_id = ?').run(to, NOW(), adminId, reason || null, fid);
    // The authorised representative becomes the hospital's first manager ONLY when approved, and only if they are a plain patient account.
    if (to === 'approved') raw.prepare("UPDATE users SET role = 'hospital', facility_id = ?, staff_role = 'manager' WHERE id = ? AND role = 'patient'").run(fid, reg.submitted_by);
  }
  return { from: f.verification_status, to, code };
}
const hospitalQueue = status => raw.prepare(`SELECT f.id, f.name, f.address, f.verification_status AS status, f.hospital_code AS code, f.legacy, f.verification_updated_at AS decided_at, f.verification_note AS note,
  r.submitted_at, r.license_no, r.issuing_authority, r.rep_name, r.rep_phone, r.rep_email, r.hospital_type, r.submitted_by,
  (SELECT COUNT(*) FROM verification_documents d WHERE d.owner_type = 'hospital' AND d.owner_id = f.id) AS n_docs
  FROM facilities f LEFT JOIN hospital_registrations r ON r.facility_id = f.id WHERE (? IS NULL OR f.verification_status = ?) ORDER BY (r.submitted_at IS NULL), r.submitted_at DESC, f.name`).all(status || null, status || null)
  .map(r => ({ id: r.id, name: r.name, address: r.address, status: r.status, hospitalCode: r.code, legacy: !!r.legacy, decidedAt: r.decided_at, note: r.note, registered: !!r.submitted_at, submittedAt: r.submitted_at,
    licenseNo: r.license_no || null, issuingAuthority: r.issuing_authority || null, repName: r.rep_name || null, repPhone: r.rep_phone || null, repEmail: r.rep_email || null, hospitalType: r.hospital_type || null, documents: r.n_docs }));

// ---------- verification documents (files live outside the static folder; metadata here) ----------
const docRow = r => r && ({ id: r.id, ownerType: r.owner_type, ownerId: r.owner_id, name: r.original_name, mime: r.mime, size: r.size, sha256: r.sha256, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at, storedName: r.stored_name });
const addDocument = d => Number(raw.prepare('INSERT INTO verification_documents (owner_type, owner_id, original_name, mime, size, sha256, stored_name, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(d.ownerType, String(d.ownerId), d.name, d.mime, d.size, d.sha256, d.storedName, d.uploadedBy, NOW()).lastInsertRowid);
const documentById = id => docRow(raw.prepare('SELECT * FROM verification_documents WHERE id = ?').get(id));
const documentsFor = (type, id) => raw.prepare('SELECT * FROM verification_documents WHERE owner_type = ? AND owner_id = ? ORDER BY id').all(type, String(id)).map(docRow);

// ---------- doctor registration, permanent Doctor ID, affiliations ----------
const docRegRow = r => r && ({ id: r.id, userId: r.user_id, fullName: r.full_name, qualifications: r.qualifications, registrationNo: r.registration_no, issuingAuthority: r.issuing_authority, specialty: r.specialty,
  department: r.department, status: r.status, credentialStatus: r.credential_status, credentialNote: r.credential_note, doctorCode: r.doctor_code, submittedAt: r.submitted_at, decidedAt: r.decided_at, decisionReason: r.decision_reason });
const doctorRegistration = uid => docRegRow(raw.prepare('SELECT * FROM doctor_registrations WHERE user_id = ?').get(uid));
const doctorRegistrationById = id => docRegRow(raw.prepare('SELECT * FROM doctor_registrations WHERE id = ?').get(id));
const createDoctorRegistration = (uid, d) => Number(raw.prepare(`INSERT INTO doctor_registrations (user_id, full_name, qualifications, registration_no, issuing_authority, specialty, department, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(uid, d.fullName, d.qualifications, d.registrationNo, d.issuingAuthority, d.specialty, d.department, NOW()).lastInsertRowid);
const doctorQueue = status => raw.prepare(`SELECT r.*, u.phone AS login FROM doctor_registrations r JOIN users u ON u.id = r.user_id WHERE (? IS NULL OR r.status = ?) ORDER BY r.id DESC`).all(status || null, status || null)
  .map(r => ({ ...docRegRow(r), login: r.login, affiliations: affiliationsOf(r.user_id), documents: documentsFor('doctor', r.id).length }));
const affRow = r => r && ({ id: r.id, userId: r.user_id, facilityId: r.facility_id, facilityName: r.facility_name || null, doctorRowId: r.doctor_row_id, status: r.status, source: r.source, requestedAt: r.requested_at,
  hospitalVerifiedAt: r.hospital_verified_at, approvedAt: r.approved_at, endedAt: r.ended_at, endReason: r.end_reason, doctorName: r.full_name || null, doctorCode: r.doctor_code || null });
const AFF_SQL = `SELECT a.*, f.name AS facility_name, r.full_name, r.doctor_code FROM doctor_affiliations a JOIN facilities f ON f.id = a.facility_id LEFT JOIN doctor_registrations r ON r.user_id = a.user_id`;
const affiliationsOf = uid => raw.prepare(AFF_SQL + ' WHERE a.user_id = ? ORDER BY a.id').all(uid).map(affRow);
const affiliationsAt = (fid, statuses) => raw.prepare(AFF_SQL + ` WHERE a.facility_id = ? AND a.status IN (${statuses.map(() => '?').join(',')}) ORDER BY a.id`).all(fid, ...statuses).map(affRow);
const affiliation = id => affRow(raw.prepare(AFF_SQL + ' WHERE a.id = ?').get(id));
function requestAffiliation(uid, fid, source, verifiedBy) {
  const st = verifiedBy ? 'hospital_verified' : 'requested';
  return Number(raw.prepare('INSERT INTO doctor_affiliations (user_id, facility_id, status, source, requested_at, hospital_verified_by, hospital_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid, fid, st, source || 'request', NOW(), verifiedBy || null, verifiedBy ? NOW() : null).lastInsertRowid);
}
const hospitalVerifyAffiliation = (id, byUser) => raw.prepare("UPDATE doctor_affiliations SET status = 'hospital_verified', hospital_verified_by = ?, hospital_verified_at = ? WHERE id = ? AND status = 'requested'").run(byUser, NOW(), id).changes;
const rejectAffiliation = (id, byUser, reason) => raw.prepare("UPDATE doctor_affiliations SET status = 'rejected', ended_at = ?, ended_by = ?, end_reason = ? WHERE id = ? AND status IN ('requested','hospital_verified')").run(NOW(), byUser, reason || null, id).changes;
// Creates the public listing row (doctors table) for an approved affiliation. The Doctor ID is shared by all of the doctor's rows.
function activateAffiliation(aff, reg) {
  const f = raw.prepare('SELECT name FROM facilities WHERE id = ?').get(aff.facilityId);
  const id = raw.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM doctors').get().n;
  raw.prepare(`INSERT INTO doctors (id, name, spec, hospital, status, room, timings, fee, facility_id, department, duty_status, accepts_appointments, contact, doctor_code, verification_status)
    VALUES (?, ?, ?, ?, 'Available', 'Not set', 'Not set', 'Not stated', ?, ?, 'Off Duty', 0, '', ?, 'verified')`).run(id, reg.fullName, reg.specialty, f.name, aff.facilityId, reg.department, reg.doctorCode);
  raw.prepare("UPDATE doctor_affiliations SET status = 'approved', approved_at = ?, doctor_row_id = ? WHERE id = ?").run(NOW(), id, aff.id);
  const u = raw.prepare('SELECT role, doctor_id FROM users WHERE id = ?').get(aff.userId);
  if (u.role === 'patient' || u.role === 'doctor') raw.prepare("UPDATE users SET role = 'doctor', doctor_id = COALESCE(doctor_id, ?), facility_id = COALESCE(facility_id, ?) WHERE id = ?").run(id, aff.facilityId, aff.userId);
  return id;
}
// Approved doctor + hospital-verified affiliation at an approved hospital => active. Safe to call repeatedly.
function settleAffiliations(uid) {
  const reg = doctorRegistration(uid); if (!reg || reg.status !== 'approved') return [];
  const out = [];
  for (const a of affiliationsOf(uid)) {
    if (a.status !== 'hospital_verified') continue;
    const f = raw.prepare('SELECT verification_status FROM facilities WHERE id = ?').get(a.facilityId);
    if (!f || f.verification_status !== 'approved') continue;
    out.push({ affiliationId: a.id, doctorRowId: activateAffiliation(a, reg) });
  }
  return out;
}
function decideDoctor(regId, to, adminId, reason, credential) {
  const reg = doctorRegistrationById(regId); if (!reg) return { error: 404, message: 'Unknown registration.' };
  if (reg.status !== 'pending') return { error: 409, message: `This registration is already ${reg.status}.` };
  if (credential) raw.prepare('UPDATE doctor_registrations SET credential_status = ?, credential_note = ? WHERE id = ?').run(credential.status, credential.note || '', regId);
  const cur = doctorRegistrationById(regId);
  if (to === 'approved') {
    if (cur.credentialStatus !== 'verified') return { error: 409, message: 'Professional credentials must be marked as verified (checked against the official registry) before approval.' };
    const code = cur.doctorCode || nextCode('doctor', 'GOC-DOC');
    raw.prepare("UPDATE doctor_registrations SET status = 'approved', doctor_code = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?").run(code, NOW(), adminId, reason || null, regId);
    return { to, code, activated: settleAffiliations(cur.userId) };
  }
  raw.prepare("UPDATE doctor_registrations SET status = 'rejected', decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?").run(NOW(), adminId, reason || null, regId);
  return { to };
}
// Ends one hospital affiliation: the listing row is archived and access to that hospital stops at once. History and the Doctor ID are kept.
function endAffiliation(id, byUser, reason) {
  const a = affiliation(id); if (!a || a.status === 'ended' || a.status === 'rejected') return null;
  raw.prepare("UPDATE doctor_affiliations SET status = 'ended', ended_at = ?, ended_by = ?, end_reason = ? WHERE id = ?").run(NOW(), byUser, reason || null, id);
  if (a.doctorRowId) raw.prepare("UPDATE doctors SET archived = 1, unit_id = NULL, accepts_appointments = 0 WHERE id = ?").run(a.doctorRowId);
  const left = raw.prepare("SELECT doctor_row_id, facility_id FROM doctor_affiliations WHERE user_id = ? AND status = 'approved' ORDER BY id LIMIT 1").get(a.userId);
  if (left) raw.prepare("UPDATE users SET doctor_id = ?, facility_id = ? WHERE id = ? AND role = 'doctor'").run(left.doctor_row_id, left.facility_id, a.userId);
  else raw.prepare("UPDATE users SET role = 'patient', doctor_id = NULL, facility_id = NULL WHERE id = ? AND role = 'doctor'").run(a.userId);
  return a;
}
const doctorCodeOfUser = uid => { const r = raw.prepare("SELECT doctor_code FROM doctor_registrations WHERE user_id = ? AND status = 'approved'").get(uid); return r ? r.doctor_code : null; };
const approvedDoctorRows = uid => raw.prepare("SELECT doctor_row_id AS id, facility_id AS facilityId FROM doctor_affiliations WHERE user_id = ? AND status = 'approved'").all(uid);

// ---------- staff invitations ----------
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');
const newInviteToken = () => 'gci_' + crypto.randomBytes(32).toString('base64url');
const inviteRow = r => r && ({ id: r.id, facilityId: r.facility_id, role: r.role, recipient: r.recipient, recipientKind: r.recipient_kind, createdBy: r.created_by, createdAt: r.created_at, expiresAt: r.expires_at,
  status: r.status === 'pending' && r.expires_at <= NOW() ? 'expired' : r.status, redeemedAt: r.redeemed_at, revokedAt: r.revoked_at });
function createInvitation({ facilityId, role, recipient, kind, createdBy, ttlHours }) {
  const token = newInviteToken(), exp = new Date(Date.now() + ttlHours * 3600000).toISOString().replace(/\.\d+Z$/, 'Z');
  const id = Number(raw.prepare('INSERT INTO staff_invitations (facility_id, role, recipient, recipient_kind, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(facilityId, role, recipient, kind, hashToken(token), createdBy, NOW(), exp).lastInsertRowid);
  return { id, token, expiresAt: exp };   // the token is returned once and never stored in plaintext
}
const invitations = fid => raw.prepare('SELECT * FROM staff_invitations WHERE facility_id = ? ORDER BY id DESC LIMIT 200').all(fid).map(inviteRow);
const invitation = id => inviteRow(raw.prepare('SELECT * FROM staff_invitations WHERE id = ?').get(id));
const revokeInvitation = (id, by) => raw.prepare("UPDATE staff_invitations SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ? AND status = 'pending'").run(NOW(), by, id).changes;
const hasPendingInvite = (fid, recipient, role) => !!raw.prepare("SELECT 1 FROM staff_invitations WHERE facility_id = ? AND recipient = ? AND role = ? AND status = 'pending' AND expires_at > ?").get(fid, recipient, role, NOW());
// Atomically consumes the token. Returns { ok:true, invite } or { error, message }. A used / revoked / expired / wrong-recipient token never changes anything.
function redeemInvitation(token, user, loginId) {
  const row = raw.prepare('SELECT * FROM staff_invitations WHERE token_hash = ?').get(hashToken(String(token || '')));
  if (!row) return { error: 400, message: 'This invitation is not valid.' };
  if (row.status === 'redeemed') return { error: 409, message: 'This invitation has already been used.' };
  if (row.status === 'revoked') return { error: 410, message: 'This invitation was withdrawn. Ask your administrator for a new one.' };
  if (row.expires_at <= NOW()) return { error: 410, message: 'This invitation has expired. Ask your administrator for a new one.' };
  const mine = row.recipient_kind === 'email' ? (user.email && user.email.toLowerCase() === row.recipient) : loginId === row.recipient;
  if (!mine) return { error: 403, message: 'This invitation was issued to a different person.' };
  const f = raw.prepare('SELECT verification_status FROM facilities WHERE id = ?').get(row.facility_id);
  if (!f || f.verification_status !== 'approved') return { error: 409, message: 'This hospital is not currently approved to add staff.' };
  if (row.role !== 'doctor' && user.role !== 'patient' && !(user.role === 'hospital' && user.facilityId === row.facility_id)) return { error: 409, message: 'This account already has a staff role. Use a different account.' };
  const won = raw.prepare("UPDATE staff_invitations SET status = 'redeemed', redeemed_by = ?, redeemed_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?").run(user.id, NOW(), row.id, NOW()).changes;
  if (won !== 1) return { error: 409, message: 'This invitation has already been used.' };
  let affiliationId = null, activated = [];
  if (row.role === 'doctor') {
    const existing = affiliationsOf(user.id).find(a => a.facilityId === row.facility_id && ['requested', 'hospital_verified', 'approved'].includes(a.status));
    if (existing && existing.status === 'requested') { hospitalVerifyAffiliation(existing.id, row.created_by); affiliationId = existing.id; }
    else if (!existing) affiliationId = requestAffiliation(user.id, row.facility_id, 'invitation', row.created_by);   // hospital verified; credentials still need super-administrator approval
    activated = settleAffiliations(user.id);
  } else {
    raw.prepare("UPDATE users SET role = 'hospital', facility_id = ?, staff_role = ? WHERE id = ?").run(row.facility_id, row.role, user.id);
  }
  return { ok: true, invite: inviteRow({ ...row, status: 'redeemed' }), affiliationId, activated };
}

// ---------- approval requests ----------
const apprRow = r => r && ({ id: r.id, facilityId: r.facility_id, kind: r.kind, summary: r.summary, payload: JSON.parse(r.payload), current: r.current_value ? JSON.parse(r.current_value) : null,
  requestedBy: r.requested_by, requestedByName: r.requester_name || null, requestedAt: r.requested_at, status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at, decisionReason: r.decision_reason, appliedAt: r.applied_at });
const APPR_SQL = 'SELECT a.*, u.name AS requester_name FROM approval_requests a LEFT JOIN users u ON u.id = a.requested_by';
const createApproval = ({ facilityId, kind, summary, payload, current, requestedBy }) => Number(raw.prepare('INSERT INTO approval_requests (facility_id, kind, summary, payload, current_value, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(facilityId, kind, summary, JSON.stringify(payload), current == null ? null : JSON.stringify(current), requestedBy, NOW()).lastInsertRowid);
const approvals = (fid, status) => raw.prepare(APPR_SQL + ' WHERE (? IS NULL OR a.facility_id = ?) AND (? IS NULL OR a.status = ?) ORDER BY a.id DESC LIMIT 200').all(fid || null, fid || null, status || null, status || null).map(apprRow);
const approval = id => apprRow(raw.prepare(APPR_SQL + ' WHERE a.id = ?').get(id));
const decideApproval = (id, status, by, reason) => raw.prepare("UPDATE approval_requests SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ? AND status = 'pending'").run(status, by, NOW(), reason || null, id).changes;
const markApplied = id => raw.prepare('UPDATE approval_requests SET applied_at = ? WHERE id = ?').run(NOW(), id);
const pendingApprovalCount = fid => raw.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending' AND (? IS NULL OR facility_id = ?)").get(fid || null, fid || null).n;

// ---------- medicine inventory ----------
const availability = r => (r.quantity === 0 ? 'out' : r.quantity <= r.reorder_level ? 'low' : 'in_stock');
const medRow = r => r && ({ id: r.id, facilityId: r.facility_id, name: r.name, strength: r.strength, unit: r.unit, quantity: r.quantity, reorderLevel: r.reorder_level, availability: availability(r), publish: !!r.publish, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by });
const medicines = fid => raw.prepare('SELECT * FROM medicine_inventory WHERE facility_id = ? ORDER BY name COLLATE NOCASE').all(fid).map(medRow);
const medicine = id => medRow(raw.prepare('SELECT * FROM medicine_inventory WHERE id = ?').get(id));
const createMedicine = (fid, m, by) => { const id = Number(raw.prepare('INSERT INTO medicine_inventory (facility_id, name, strength, unit, quantity, reorder_level, publish, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  .run(fid, m.name, m.strength, m.unit, m.quantity, m.reorderLevel, m.publish ? 1 : 0, NOW(), by.name).lastInsertRowid);
  if (m.quantity > 0) raw.prepare('INSERT INTO inventory_adjustments (item_id, facility_id, delta, qty_before, qty_after, reason, by_user, by_name, at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)').run(id, fid, m.quantity, m.quantity, 'Opening stock', by.id, by.name, NOW());
  return id; };
// Edits details (not quantity). expectedVersion makes a stale form fail instead of silently overwriting someone else's change.
const updateMedicine = (id, m, by, expectedVersion) => raw.prepare('UPDATE medicine_inventory SET name = ?, strength = ?, unit = ?, reorder_level = ?, publish = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND (? IS NULL OR version = ?)')
  .run(m.name, m.strength, m.unit, m.reorderLevel, m.publish ? 1 : 0, NOW(), by.name, id, expectedVersion == null ? null : expectedVersion, expectedVersion == null ? null : expectedVersion).changes;
// Relative stock change in ONE statement, so two people adjusting at once can never drive stock negative or lose an update.
function adjustMedicine(id, delta, reason, by) {
  const before = raw.prepare('SELECT * FROM medicine_inventory WHERE id = ?').get(id); if (!before) return null;
  const ch = raw.prepare('UPDATE medicine_inventory SET quantity = quantity + ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND quantity + ? >= 0').run(delta, NOW(), by.name, id, delta).changes;
  if (ch !== 1) return { error: 'insufficient', quantity: before.quantity };
  const after = raw.prepare('SELECT quantity FROM medicine_inventory WHERE id = ?').get(id).quantity;
  raw.prepare('INSERT INTO inventory_adjustments (item_id, facility_id, delta, qty_before, qty_after, reason, by_user, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, before.facility_id, delta, after - delta, after, reason, by.id, by.name, NOW());
  return { before: after - delta, after };
}
const adjustments = (fid, itemId, limit = 100) => raw.prepare('SELECT a.*, m.name AS item_name, m.strength FROM inventory_adjustments a JOIN medicine_inventory m ON m.id = a.item_id WHERE a.facility_id = ? AND (? IS NULL OR a.item_id = ?) ORDER BY a.id DESC LIMIT ?')
  .all(fid, itemId || null, itemId || null, limit).map(r => ({ id: r.id, itemId: r.item_id, item: r.item_name + (r.strength ? ' ' + r.strength : ''), delta: r.delta, before: r.qty_before, after: r.qty_after, reason: r.reason, by: r.by_name, at: r.at }));
const lowStock = fid => medicines(fid).filter(m => m.availability !== 'in_stock');
// Public availability only: no quantities, and only items the hospital chose to publish.
const publicMedicines = fid => medicines(fid).filter(m => m.publish).map(m => ({ name: m.name + (m.strength ? ' ' + m.strength : ''), availability: m.availability, updatedAt: m.updatedAt }));

// ---------- accounts, sessions, login history, preferences, alerts ----------
function setActive(uid, active, reason) {
  raw.prepare('UPDATE users SET active = ?, deactivated_at = ?, deactivated_reason = ? WHERE id = ?').run(active ? 1 : 0, active ? null : NOW(), active ? null : (reason || null), uid);
  if (!active) raw.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
}
function removeFromHospital(uid) {   // access ends at once; the account stays (as a patient) and every audit record is kept
  raw.prepare("UPDATE users SET role = 'patient', facility_id = NULL, staff_role = 'manager' WHERE id = ? AND role = 'hospital'").run(uid);
  raw.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
}
const setProfile = (uid, name, email) => raw.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email || null, uid);
const sessionsOf = uid => raw.prepare('SELECT substr(token_hash, 1, 12) AS handle, created_ms, user_agent, ip_hint, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_ms DESC').all(uid, Date.now())
  .map(r => ({ handle: r.handle, createdAt: r.created_ms ? new Date(r.created_ms).toISOString() : null, device: r.user_agent, ip: r.ip_hint, expiresAt: new Date(r.expires_at).toISOString() }));
const revokeSession = (uid, handle) => raw.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 12) = ?').run(uid, handle).changes;
const logLogin = (uid, ok, ip, ua) => raw.prepare('INSERT INTO login_events (user_id, success, ip_hint, user_agent, at) VALUES (?, ?, ?, ?, ?)').run(uid || null, ok ? 1 : 0, ip || null, ua ? String(ua).slice(0, 120) : null, new Date().toISOString());
const recentLogins = (uid, n = 10) => raw.prepare('SELECT success, ip_hint, user_agent, at FROM login_events WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(uid, n).map(r => ({ ok: !!r.success, ip: r.ip_hint, device: r.user_agent, at: r.at }));
const prefs = uid => Object.fromEntries(raw.prepare('SELECT key, enabled FROM notification_prefs WHERE user_id = ?').all(uid).map(r => [r.key, !!r.enabled]));
const setPref = (uid, key, on) => raw.prepare('INSERT INTO notification_prefs (user_id, key, enabled) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET enabled = excluded.enabled').run(uid, key, on ? 1 : 0);
const alertsOpen = fid => raw.prepare('SELECT * FROM security_alerts WHERE resolved_at IS NULL AND (? IS NULL OR facility_id = ? OR facility_id IS NULL) ORDER BY id DESC LIMIT 50').all(fid || null, fid || null)
  .map(r => ({ id: r.id, kind: r.kind, facilityId: r.facility_id, summary: r.summary, createdAt: r.created_at }));
const addAlert = (kind, fid, summary, detail) => raw.prepare('INSERT INTO security_alerts (kind, facility_id, summary, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(kind, fid || null, summary, JSON.stringify(detail || {}), new Date().toISOString());
const resolveAlert = (id, by) => raw.prepare('UPDATE security_alerts SET resolved_at = ?, resolved_by = ? WHERE id = ? AND resolved_at IS NULL').run(new Date().toISOString(), by, id).changes;

// ---------- reports (read-only aggregates over real stored data) ----------
const apptStats = (fid, from, to) => raw.prepare("SELECT date, status, COUNT(*) AS n FROM appointments WHERE facility_id = ? AND source = 'user' AND date >= ? AND date <= ? GROUP BY date, status ORDER BY date").all(fid, from, to);
const serviceAvailability = fid => raw.prepare('SELECT kind, available, COUNT(*) AS n FROM hospital_services WHERE facility_id = ? AND is_demo = 0 GROUP BY kind, available').all(fid);

module.exports = { raw, migrationStatus, nextCode, createHospitalRegistration, registrationFor, registrationsBy, setHospitalStatus, hospitalQueue, TRANSITIONS, addDocument, documentById, documentsFor,
  doctorRegistration, doctorRegistrationById, createDoctorRegistration, doctorQueue, affiliationsOf, affiliationsAt, affiliation, requestAffiliation, hospitalVerifyAffiliation, rejectAffiliation, settleAffiliations, decideDoctor, endAffiliation, doctorCodeOfUser, approvedDoctorRows,
  createInvitation, invitations, invitation, revokeInvitation, hasPendingInvite, redeemInvitation,
  createApproval, approvals, approval, decideApproval, markApplied, pendingApprovalCount,
  medicines, medicine, createMedicine, updateMedicine, adjustMedicine, adjustments, lowStock, publicMedicines,
  setActive, removeFromHospital, setProfile, sessionsOf, revokeSession, logLogin, recentLogins, prefs, setPref, alertsOpen, addAlert, resolveAlert, apptStats, serviceAvailability };
