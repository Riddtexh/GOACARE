'use strict';
// SQLite storage (built into Node 22.5+, no npm packages needed).
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
    login_id      TEXT    NOT NULL UNIQUE,   -- normalised phone / Health ID, used for lookup
    phone         TEXT    NOT NULL,          -- as the user typed it, used for display
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,          -- SHA-256 of the cookie token (raw token is never stored)
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL              -- unix ms
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS facilities (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    care_type     TEXT NOT NULL,          -- Public | Private
    district      TEXT NOT NULL,          -- North Goa | South Goa
    address       TEXT NOT NULL,
    phone         TEXT NOT NULL,
    lat           REAL NOT NULL,
    lng           REAL NOT NULL,
    icu_beds      INTEGER NOT NULL DEFAULT 0,
    oxygen_beds   INTEGER NOT NULL DEFAULT 0,
    general_beds  INTEGER NOT NULL DEFAULT 0,
    specialties   TEXT NOT NULL DEFAULT '[]',   -- JSON array
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    spec       TEXT NOT NULL,
    hospital   TEXT NOT NULL,
    status     TEXT NOT NULL,             -- Available | In Surgery | On Call | ...
    room       TEXT NOT NULL,
    timings    TEXT NOT NULL,
    fee        TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
`);

// First run only: fill the empty tables from server/seed/*.json (the data that used to be hard-coded in the browser).
(function seed() {
  const readSeed = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', name), 'utf8'));
  if (db.prepare('SELECT COUNT(*) AS n FROM facilities').get().n === 0) {
    const ins = db.prepare(`INSERT INTO facilities (id, name, care_type, district, address, phone, lat, lng, icu_beds, oxygen_beds, general_beds, specialties)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of readSeed('facilities.json'))
      ins.run(f.id, f.name, f.careType, f.district, f.address, f.phone, f.lat, f.lng, f.icuBeds, f.oxygenBeds, f.generalBeds, JSON.stringify(f.specialties || []));
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM doctors').get().n === 0) {
    const ins = db.prepare('INSERT INTO doctors (id, name, spec, hospital, status, room, timings, fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const d of readSeed('doctors.json')) ins.run(d.id, d.name, d.spec, d.hospital, d.status, d.room, d.timings, d.fee);
  }
})();

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";
const facilityRow = r => ({
  id: r.id, name: r.name, careType: r.care_type, district: r.district, address: r.address, phone: r.phone, lat: r.lat, lng: r.lng,
  icuBeds: r.icu_beds, oxygenBeds: r.oxygen_beds, generalBeds: r.general_beds, specialties: JSON.parse(r.specialties), updatedAt: r.updated_at
});
const doctorRow = r => ({
  id: r.id, name: r.name, spec: r.spec, hospital: r.hospital, status: r.status, room: r.room, timings: r.timings, fee: r.fee, updatedAt: r.updated_at
});

const q = {
  listFacilities: db.prepare('SELECT * FROM facilities ORDER BY rowid'),
  listDoctors: db.prepare('SELECT * FROM doctors ORDER BY id'),
  setBeds: db.prepare(`UPDATE facilities SET icu_beds = ?, oxygen_beds = ?, general_beds = ?, updated_at = ${NOW} WHERE id = ?`),
  setDoctorStatus: db.prepare(`UPDATE doctors SET status = ?, updated_at = ${NOW} WHERE id = ?`),
  setDoctorRoom: db.prepare(`UPDATE doctors SET room = ?, updated_at = ${NOW} WHERE id = ?`),
  insertUser: db.prepare('INSERT INTO users (login_id, phone, name, password_hash, salt) VALUES (?, ?, ?, ?, ?)'),
  userByLogin: db.prepare('SELECT * FROM users WHERE login_id = ?'),
  userById: db.prepare('SELECT id, name, phone FROM users WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT u.id, u.name, u.phone
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
};

module.exports = {
  listFacilities: () => q.listFacilities.all().map(facilityRow),
  listDoctors: () => q.listDoctors.all().map(doctorRow),
  setBeds: (id, icu, oxygen, general) => q.setBeds.run(icu, oxygen, general, id).changes,
  setDoctorStatus: (id, status) => q.setDoctorStatus.run(status, id).changes,
  setDoctorRoom: (id, room) => q.setDoctorRoom.run(room, id).changes,
  createUser: (loginId, phone, name, hash, salt) => q.insertUser.run(loginId, phone, name, hash, salt).lastInsertRowid,
  findUserByLogin: loginId => q.userByLogin.get(loginId),
  findUserById: id => q.userById.get(id),
  createSession: (tokenHash, userId, expiresAt) => q.insertSession.run(tokenHash, userId, expiresAt),
  findUserBySession: tokenHash => q.sessionUser.get(tokenHash, Date.now()),
  deleteSession: tokenHash => q.deleteSession.run(tokenHash),
  purgeExpiredSessions: () => q.purgeSessions.run(Date.now()),
  close: () => db.close()
};
