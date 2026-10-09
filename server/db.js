'use strict';
// SQLite storage (built into Node 22.5+, no npm packages needed).
// Schema + migrations + every query the server uses. Routes never write SQL.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dataDir = process.env.GOACARE_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'goacare.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    login_id      TEXT    NOT NULL UNIQUE,
    phone         TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS facilities (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    care_type     TEXT NOT NULL,
    district      TEXT NOT NULL,
    address       TEXT NOT NULL,
    phone         TEXT NOT NULL DEFAULT '',   -- '' = no verified number (the UI hides the call button)
    lat           REAL NOT NULL,
    lng           REAL NOT NULL,
    icu_beds      INTEGER NOT NULL DEFAULT 0,
    oxygen_beds   INTEGER NOT NULL DEFAULT 0,
    general_beds  INTEGER NOT NULL DEFAULT 0,
    specialties   TEXT NOT NULL DEFAULT '[]',
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS doctors (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    spec       TEXT NOT NULL,
    hospital   TEXT NOT NULL,
    status     TEXT NOT NULL,
    room       TEXT NOT NULL,
    timings    TEXT NOT NULL,
    fee        TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data    TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    facility     TEXT NOT NULL,
    diagnosis    TEXT NOT NULL,
    prescription TEXT NOT NULL,
    followup     TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS prescriptions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date     TEXT NOT NULL,
    doctor   TEXT NOT NULL,
    note     TEXT NOT NULL DEFAULT '',
    img      TEXT NOT NULL                 -- data:image/jpeg;base64,...
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,   -- NULL for simulated demo load
    provider_key  TEXT NOT NULL,           -- 'd:<doctorId>' or 'h:<facilityId>'
    provider_type TEXT NOT NULL,           -- doctor | hospital
    provider_name TEXT NOT NULL,
    place         TEXT NOT NULL,
    map_query     TEXT NOT NULL,
    facility_id   TEXT,
    date          TEXT NOT NULL,
    time          TEXT NOT NULL,
    reason        TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'Requested',   -- Requested | Confirmed | Declined | Cancelled
    source        TEXT NOT NULL DEFAULT 'user',        -- user | demo
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_appt_slot ON appointments(provider_key, date, time);
  CREATE INDEX IF NOT EXISTS idx_appt_user ON appointments(user_id);

  CREATE TABLE IF NOT EXISTS wait_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    minutes     INTEGER NOT NULL,
    by_role     TEXT NOT NULL,             -- patient | doctor | hospital | demo
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_ms  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wait_fac ON wait_reports(facility_id, created_ms);

  CREATE TABLE IF NOT EXISTS claims (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    procedure    TEXT NOT NULL,
    hospital     TEXT NOT NULL,
    amount       INTEGER NOT NULL DEFAULT 0,
    submitted_on TEXT NOT NULL,
    stage        TEXT NOT NULL DEFAULT 'Submitted',
    note         TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS admin_audit (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id       INTEGER,                 -- kept even if the admin account is later deleted
    admin_name     TEXT    NOT NULL,
    action         TEXT    NOT NULL,        -- list_users | view_user
    target_user_id INTEGER,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS redirect_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_ms    INTEGER NOT NULL,
    from_facility TEXT NOT NULL,
    to_facility   TEXT NOT NULL,
    source        TEXT NOT NULL            -- triage | alternative
  );
`);

// ---------- migrations (safe to run on a database created by an older version) ----------
const hasCol = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
const addCol = (table, col, ddl) => { if (!hasCol(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); };
addCol('users', 'role', "TEXT NOT NULL DEFAULT 'patient'");
addCol('users', 'facility_id', 'TEXT');
addCol('users', 'doctor_id', 'INTEGER');
addCol('users', 'consent_at', 'TEXT');
addCol('facilities', 'beds_updated_at', 'TEXT');   // set only when hospital staff change the beds (proves a facility is "live")
addCol('doctors', 'facility_id', 'TEXT');

const readSeed = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', name), 'utf8'));

(function seedAndClean() {
  if (db.prepare('SELECT COUNT(*) AS n FROM facilities').get().n === 0) {
    const ins = db.prepare(`INSERT INTO facilities (id, name, care_type, district, address, phone, lat, lng, icu_beds, oxygen_beds, general_beds, specialties)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of readSeed('facilities.json'))
      ins.run(f.id, f.name, f.careType, f.district, f.address, f.phone || '', f.lat, f.lng, f.icuBeds, f.oxygenBeds, f.generalBeds, JSON.stringify(f.specialties || []));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM doctors').get().n === 0) {
    const ins = db.prepare('INSERT INTO doctors (id, name, spec, hospital, status, room, timings, fee, facility_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const d of readSeed('doctors.json')) ins.run(d.id, d.name, d.spec, d.hospital, d.status, d.room, d.timings, d.fee, d.facilityId);
  }
  // Data-quality fixes for databases created before this version.
  db.prepare("DELETE FROM facilities WHERE id = 'healthway-oldgoa'").run();          // duplicate of healthway-old-goa
  db.prepare("UPDATE facilities SET phone = '' WHERE TRIM(phone) = '108'").run();    // 108 is the ambulance, not the hospital
  const map = readSeed('doctor-facility-map.json');
  const upd = db.prepare('UPDATE doctors SET facility_id = ? WHERE hospital = ? AND facility_id IS NULL');
  for (const [hospital, fid] of Object.entries(map)) upd.run(fid, hospital);
})();

// ---------- row mappers ----------
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";
const facilityRow = r => ({
  id: r.id, name: r.name, careType: r.care_type, district: r.district, address: r.address, phone: r.phone, phoneVerified: !!r.phone,
  lat: r.lat, lng: r.lng, icuBeds: r.icu_beds, oxygenBeds: r.oxygen_beds, generalBeds: r.general_beds,
  specialties: JSON.parse(r.specialties), updatedAt: r.updated_at, staffUpdatedAt: r.beds_updated_at || null
});
const doctorRow = r => ({
  id: r.id, name: r.name, spec: r.spec, hospital: r.hospital, facilityId: r.facility_id, status: r.status, room: r.room,
  timings: r.timings, fee: r.fee, updatedAt: r.updated_at
});
const userRow = r => r && ({
  id: r.id, name: r.name, phone: r.phone, role: r.role, facilityId: r.facility_id || null, doctorId: r.doctor_id || null, consentAt: r.consent_at || null
});
const apptRow = r => ({
  id: r.id, key: r.provider_key, type: r.provider_type, name: r.provider_name, place: r.place, mapQuery: r.map_query,
  facilityId: r.facility_id, date: r.date, time: r.time, reason: r.reason, status: r.status, createdAt: r.created_at
});

const q = {
  listFacilities: db.prepare('SELECT * FROM facilities ORDER BY rowid'),
  facility: db.prepare('SELECT * FROM facilities WHERE id = ?'),
  listDoctors: db.prepare('SELECT * FROM doctors ORDER BY id'),
  doctor: db.prepare('SELECT * FROM doctors WHERE id = ?'),
  setBeds: db.prepare(`UPDATE facilities SET icu_beds = ?, oxygen_beds = ?, general_beds = ?, updated_at = ${NOW}, beds_updated_at = ${NOW} WHERE id = ?`),
  setDoctorStatus: db.prepare(`UPDATE doctors SET status = ?, updated_at = ${NOW} WHERE id = ?`),
  setDoctorRoom: db.prepare(`UPDATE doctors SET room = ?, updated_at = ${NOW} WHERE id = ?`),

  insertUser: db.prepare('INSERT INTO users (login_id, phone, name, password_hash, salt, role, facility_id, doctor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  userByLogin: db.prepare('SELECT * FROM users WHERE login_id = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  setConsent: db.prepare(`UPDATE users SET consent_at = ${NOW} WHERE id = ?`),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  getProfile: db.prepare('SELECT data FROM profiles WHERE user_id = ?'),
  putProfile: db.prepare('INSERT INTO profiles (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data'),
  listRecords: db.prepare('SELECT * FROM records WHERE user_id = ? ORDER BY date DESC, id DESC'),
  insertRecord: db.prepare('INSERT INTO records (user_id, date, facility, diagnosis, prescription, followup) VALUES (?, ?, ?, ?, ?, ?)'),
  deleteRecord: db.prepare('DELETE FROM records WHERE id = ? AND user_id = ?'),
  listRx: db.prepare('SELECT id, date, doctor, note FROM prescriptions WHERE user_id = ? ORDER BY date DESC, id DESC'),
  rxImage: db.prepare('SELECT img FROM prescriptions WHERE id = ? AND user_id = ?'),
  insertRx: db.prepare('INSERT INTO prescriptions (user_id, date, doctor, note, img) VALUES (?, ?, ?, ?, ?)'),
  deleteRx: db.prepare('DELETE FROM prescriptions WHERE id = ? AND user_id = ?'),
  rxCount: db.prepare('SELECT COUNT(*) AS n FROM prescriptions WHERE user_id = ?'),

  insertAppt: db.prepare(`INSERT INTO appointments (user_id, provider_key, provider_type, provider_name, place, map_query, facility_id, date, time, reason, status, source)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  userAppts: db.prepare('SELECT * FROM appointments WHERE user_id = ? ORDER BY date, time'),
  apptById: db.prepare('SELECT * FROM appointments WHERE id = ?'),
  setApptStatus: db.prepare('UPDATE appointments SET status = ? WHERE id = ?'),
  slotCount: db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE provider_key = ? AND date = ? AND time = ? AND status IN ('Requested','Confirmed')"),
  userHasSlot: db.prepare("SELECT 1 AS x FROM appointments WHERE user_id = ? AND provider_key = ? AND date = ? AND time = ? AND status IN ('Requested','Confirmed')"),
  loadForDate: db.prepare("SELECT provider_key AS k, time AS t, COUNT(*) AS n, SUM(source = 'demo') AS demo FROM appointments WHERE date = ? AND status IN ('Requested','Confirmed') GROUP BY provider_key, time"),
  facilityAppts: db.prepare(`SELECT a.*, u.name AS patient FROM appointments a LEFT JOIN users u ON u.id = a.user_id
                             WHERE a.facility_id = ? AND a.date >= ? AND a.source = 'user' ORDER BY a.date, a.time`),
  doctorAppts: db.prepare(`SELECT a.*, u.name AS patient FROM appointments a LEFT JOIN users u ON u.id = a.user_id
                           WHERE a.provider_key = ? AND a.date >= ? AND a.source = 'user' ORDER BY a.date, a.time`),
  deleteDemoAppts: db.prepare("DELETE FROM appointments WHERE source = 'demo'"),

  insertWait: db.prepare('INSERT INTO wait_reports (facility_id, minutes, by_role, user_id, created_ms) VALUES (?, ?, ?, ?, ?)'),
  recentWaits: db.prepare('SELECT facility_id AS f, minutes AS m, by_role AS r, created_ms AS t FROM wait_reports WHERE created_ms > ? ORDER BY created_ms DESC'),
  lastWaitByUser: db.prepare('SELECT created_ms AS t FROM wait_reports WHERE facility_id = ? AND user_id = ? ORDER BY created_ms DESC LIMIT 1'),
  deleteDemoWaits: db.prepare("DELETE FROM wait_reports WHERE by_role = 'demo'"),

  listClaims: db.prepare('SELECT * FROM claims WHERE user_id = ? ORDER BY submitted_on DESC, id DESC'),
  insertClaim: db.prepare('INSERT INTO claims (user_id, procedure, hospital, amount, submitted_on, stage, note) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  setClaim: db.prepare(`UPDATE claims SET stage = ?, note = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ?`),
  deleteClaim: db.prepare('DELETE FROM claims WHERE id = ? AND user_id = ?'),

  // admin (read-only views of registered users; password hashes, salts and session tokens are never selected)
  adminUsers: db.prepare(`
    SELECT u.id, u.login_id, u.name, u.phone, u.role, u.facility_id, u.doctor_id, u.consent_at, u.created_at,
           (SELECT COUNT(*) FROM records       x WHERE x.user_id = u.id) AS n_records,
           (SELECT COUNT(*) FROM prescriptions x WHERE x.user_id = u.id) AS n_prescriptions,
           (SELECT COUNT(*) FROM appointments  x WHERE x.user_id = u.id) AS n_appointments,
           (SELECT COUNT(*) FROM claims        x WHERE x.user_id = u.id) AS n_claims,
           (SELECT COUNT(*) FROM sessions      x WHERE x.user_id = u.id AND x.expires_at > ?) AS n_sessions
    FROM users u
    WHERE (? = '' OR u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.login_id LIKE ? ESCAPE '\\')
    ORDER BY u.id`),
  setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
  insertAudit: db.prepare('INSERT INTO admin_audit (admin_id, admin_name, action, target_user_id) VALUES (?, ?, ?, ?)'),
  recentAudit: db.prepare('SELECT id, admin_name, action, target_user_id, created_at FROM admin_audit ORDER BY id DESC LIMIT ?'),

  insertRedirect: db.prepare('INSERT INTO redirect_events (created_ms, from_facility, to_facility, source) VALUES (?, ?, ?, ?)'),
  redirectsSince: db.prepare('SELECT COUNT(*) AS n FROM redirect_events WHERE created_ms > ?')
};

const claimRow = r => ({ id: r.id, procedure: r.procedure, hospital: r.hospital, amount: r.amount, submittedOn: r.submitted_on, stage: r.stage, note: r.note, updatedAt: r.updated_at });

module.exports = {
  raw: db,
  transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },

  // directory
  listFacilities: () => q.listFacilities.all().map(facilityRow),
  getFacility: id => { const r = q.facility.get(id); return r ? facilityRow(r) : null; },
  listDoctors: () => q.listDoctors.all().map(doctorRow),
  getDoctor: id => { const r = q.doctor.get(id); return r ? doctorRow(r) : null; },
  setBeds: (id, icu, oxygen, general) => q.setBeds.run(icu, oxygen, general, id).changes,
  setDoctorStatus: (id, status) => q.setDoctorStatus.run(status, id).changes,
  setDoctorRoom: (id, room) => q.setDoctorRoom.run(room, id).changes,

  // accounts
  createUser: (loginId, phone, name, hash, salt, role = 'patient', facilityId = null, doctorId = null) =>
    Number(q.insertUser.run(loginId, phone, name, hash, salt, role, facilityId, doctorId).lastInsertRowid),
  findUserByLogin: loginId => q.userByLogin.get(loginId),
  findUserById: id => userRow(q.userById.get(id)),
  createSession: (tokenHash, userId, expiresAt) => q.insertSession.run(tokenHash, userId, expiresAt),
  findUserBySession: tokenHash => userRow(q.sessionUser.get(tokenHash, Date.now())),
  deleteSession: tokenHash => q.deleteSession.run(tokenHash),
  purgeExpiredSessions: () => q.purgeSessions.run(Date.now()),
  setConsent: id => q.setConsent.run(id),
  deleteUser: id => q.deleteUser.run(id).changes,
  userRow,

  // personal data
  getProfile: uid => { const r = q.getProfile.get(uid); return r ? JSON.parse(r.data) : {}; },
  putProfile: (uid, data) => q.putProfile.run(uid, JSON.stringify(data)),
  listRecords: uid => q.listRecords.all(uid).map(r => ({ id: r.id, date: r.date, facility: r.facility, diagnosis: r.diagnosis, prescription: r.prescription, followup: r.followup })),
  addRecord: (uid, r) => Number(q.insertRecord.run(uid, r.date, r.facility, r.diagnosis, r.prescription, r.followup || '').lastInsertRowid),
  deleteRecord: (uid, id) => q.deleteRecord.run(id, uid).changes,
  listPrescriptions: uid => q.listRx.all(uid).map(r => ({ id: r.id, date: r.date, doctor: r.doctor, note: r.note, imgUrl: `/api/me/prescriptions/${r.id}/image` })),
  prescriptionImage: (uid, id) => { const r = q.rxImage.get(id, uid); return r ? r.img : null; },
  addPrescription: (uid, r) => Number(q.insertRx.run(uid, r.date, r.doctor, r.note || '', r.img).lastInsertRowid),
  deletePrescription: (uid, id) => q.deleteRx.run(id, uid).changes,
  prescriptionCount: uid => q.rxCount.get(uid).n,

  // appointments + crowd inputs
  slotCount: (key, date, time) => q.slotCount.get(key, date, time).n,
  userHasSlot: (uid, key, date, time) => !!q.userHasSlot.get(uid, key, date, time),
  addAppointment: a => Number(q.insertAppt.run(a.userId, a.key, a.type, a.name, a.place, a.mapQuery, a.facilityId, a.date, a.time, a.reason, a.status || 'Requested', a.source || 'user').lastInsertRowid),
  userAppointments: uid => q.userAppts.all(uid).map(apptRow),
  getAppointment: id => q.apptById.get(id),
  setAppointmentStatus: (id, status) => q.setApptStatus.run(status, id).changes,
  loadForDate: date => q.loadForDate.all(date),
  facilityAppointments: (fid, fromDate) => q.facilityAppts.all(fid, fromDate).map(r => ({ ...apptRow(r), patient: r.patient || 'Patient' })),
  doctorAppointments: (key, fromDate) => q.doctorAppts.all(key, fromDate).map(r => ({ ...apptRow(r), patient: r.patient || 'Patient' })),
  clearDemo: () => { q.deleteDemoAppts.run(); q.deleteDemoWaits.run(); },

  addWaitReport: (fid, minutes, role, uid, ms = Date.now()) => q.insertWait.run(fid, minutes, role, uid, ms),
  recentWaits: sinceMs => q.recentWaits.all(sinceMs),
  lastWaitByUser: (fid, uid) => { const r = q.lastWaitByUser.get(fid, uid); return r ? r.t : 0; },

  listClaims: uid => q.listClaims.all(uid).map(claimRow),
  addClaim: (uid, c) => Number(q.insertClaim.run(uid, c.procedure, c.hospital, c.amount, c.submittedOn, c.stage, c.note || '').lastInsertRowid),
  setClaim: (uid, id, stage, note) => q.setClaim.run(stage, note || '', id, uid).changes,
  deleteClaim: (uid, id) => q.deleteClaim.run(id, uid).changes,

  addRedirect: (from, to, source) => q.insertRedirect.run(Date.now(), from, to, source),
  redirectsSince: ms => q.redirectsSince.get(ms).n,

  // admin
  adminListUsers: (search = '') => {
    const term = String(search).trim().toLowerCase();
    const like = '%' + term.replace(/[\\%_]/g, c => '\\' + c) + '%';
    return q.adminUsers.all(Date.now(), term, like, like, like).map(r => ({
      id: r.id, name: r.name, phone: r.phone, loginId: r.login_id, role: r.role, facilityId: r.facility_id || null, doctorId: r.doctor_id || null,
      consentAt: r.consent_at || null, registeredAt: r.created_at,
      counts: { records: r.n_records, prescriptions: r.n_prescriptions, appointments: r.n_appointments, claims: r.n_claims, activeSessions: r.n_sessions }
    }));
  },
  setUserRole: (id, role) => q.setRole.run(role, id).changes,
  logAdmin: (admin, action, targetUserId = null) => q.insertAudit.run(admin.id, admin.name, action, targetUserId),
  adminAudit: (limit = 50) => q.recentAudit.all(limit).map(r => ({ id: r.id, admin: r.admin_name, action: r.action, targetUserId: r.target_user_id, at: r.created_at })),

  close: () => db.close()
};
