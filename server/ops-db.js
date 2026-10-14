'use strict';
// Operational data for the staff workspace: wards, crowd reports, services, treatment costs, medical stores, assets, doctors (create / edit / archive),
// hospital profile and team roles. Every SQL statement for these lives here; routes never write SQL.
// Rows flagged is_demo = 1 are sample data (npm run demo-ops). They are shown with a DEMO label to staff and are NEVER returned by the public API.
const db = require('./db');
const raw = db.raw;
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')";

raw.exec(`
  CREATE TABLE IF NOT EXISTS wards (
    id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    ward_type TEXT NOT NULL, total_beds INTEGER NOT NULL, available_beds INTEGER NOT NULL,
    occupied_beds INTEGER, out_of_service_beds INTEGER,            -- NULL = not recorded (never assumed to be 0)
    notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (${NOW}), updated_by TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0,
    UNIQUE (facility_id, ward_type));
  CREATE TABLE IF NOT EXISTS crowd_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    level TEXT NOT NULL, wait_minutes INTEGER, queue_count INTEGER, verified_at TEXT NOT NULL DEFAULT (${NOW}), by_name TEXT NOT NULL DEFAULT '', is_demo INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS idx_crowd_fac ON crowd_updates(facility_id, id);
  CREATE TABLE IF NOT EXISTS hospital_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    name TEXT NOT NULL, kind TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', available INTEGER NOT NULL DEFAULT 1,
    is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (${NOW}), updated_at TEXT NOT NULL DEFAULT (${NOW}), updated_by TEXT NOT NULL DEFAULT '');
  CREATE UNIQUE INDEX IF NOT EXISTS idx_service_name ON hospital_services(facility_id, kind, lower(name));
  CREATE TABLE IF NOT EXISTS treatment_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    service_name TEXT NOT NULL, min_cost INTEGER NOT NULL, max_cost INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (${NOW}), updated_by TEXT NOT NULL DEFAULT '');
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_name ON treatment_costs(facility_id, lower(service_name));
  CREATE TABLE IF NOT EXISTS medical_stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', hours TEXT NOT NULL DEFAULT '',
    availability_note TEXT NOT NULL DEFAULT '', availability_verified_at TEXT, availability_verified_by TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (${NOW}), updated_at TEXT NOT NULL DEFAULT (${NOW}), updated_by TEXT NOT NULL DEFAULT '');
  CREATE UNIQUE INDEX IF NOT EXISTS idx_store_name ON medical_stores(facility_id, lower(name));
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    name TEXT NOT NULL, asset_no TEXT NOT NULL, category TEXT NOT NULL, acquired_on TEXT NOT NULL DEFAULT '',
    condition TEXT NOT NULL, maintenance_status TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (${NOW}), updated_at TEXT NOT NULL DEFAULT (${NOW}), updated_by TEXT NOT NULL DEFAULT '',
    UNIQUE (facility_id, asset_no));
`);

// ---- tiny CRUD factory: one table, a whitelist of writable columns (snake_case) and a row mapper ----
function crud(table, cols, map) {
  const sel = raw.prepare(`SELECT * FROM ${table} WHERE facility_id = ? ORDER BY id`), one = raw.prepare(`SELECT * FROM ${table} WHERE id = ?`), del = raw.prepare(`DELETE FROM ${table} WHERE id = ?`);
  const ins = raw.prepare(`INSERT INTO ${table} (facility_id, ${cols.join(', ')}, updated_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`);
  const upd = raw.prepare(`UPDATE ${table} SET ${cols.map(c => c + ' = ?').join(', ')}, updated_by = ?, updated_at = ${NOW} WHERE id = ?`);
  return {
    list: fid => sel.all(fid).map(map), get: id => { const r = one.get(id); return r ? map(r) : null; },
    insert: (fid, o, by) => Number(ins.run(fid, ...cols.map(c => o[c]), by).lastInsertRowid),
    update: (id, o, by) => upd.run(...cols.map(c => o[c]), by, id).changes, remove: id => del.run(id).changes
  };
}
const services = crud('hospital_services', ['name', 'kind', 'description', 'available'], r => ({ id: r.id, facilityId: r.facility_id, name: r.name, kind: r.kind, description: r.description, available: !!r.available, demo: !!r.is_demo, updatedAt: r.updated_at, updatedBy: r.updated_by }));
const costs = crud('treatment_costs', ['service_name', 'min_cost', 'max_cost', 'notes'], r => ({ id: r.id, facilityId: r.facility_id, serviceName: r.service_name, minCost: r.min_cost, maxCost: r.max_cost, notes: r.notes, estimate: true, demo: !!r.is_demo, updatedAt: r.updated_at, updatedBy: r.updated_by }));
const stores = crud('medical_stores', ['name', 'location', 'contact', 'hours', 'availability_note', 'availability_verified_at', 'availability_verified_by'], r => ({ id: r.id, facilityId: r.facility_id, name: r.name, location: r.location, contact: r.contact, hours: r.hours, availabilityNote: r.availability_note, availabilityVerifiedAt: r.availability_verified_at, availabilityVerifiedBy: r.availability_verified_by, demo: !!r.is_demo, updatedAt: r.updated_at, updatedBy: r.updated_by }));
const assets = crud('assets', ['name', 'asset_no', 'category', 'acquired_on', 'condition', 'maintenance_status', 'notes'], r => ({ id: r.id, facilityId: r.facility_id, name: r.name, assetNo: r.asset_no, category: r.category, acquiredOn: r.acquired_on, condition: r.condition, maintenanceStatus: r.maintenance_status, notes: r.notes, demo: !!r.is_demo, updatedAt: r.updated_at, updatedBy: r.updated_by }));

// ---- wards ----
const wardRow = r => ({ id: r.id, facilityId: r.facility_id, type: r.ward_type, total: r.total_beds, available: r.available_beds, occupied: r.occupied_beds, outOfService: r.out_of_service_beds, notes: r.notes, updatedAt: r.updated_at, updatedBy: r.updated_by, demo: !!r.is_demo });
const q = {
  wards: raw.prepare('SELECT * FROM wards WHERE facility_id = ?'), ward: raw.prepare('SELECT * FROM wards WHERE facility_id = ? AND ward_type = ?'),
  upsertWard: raw.prepare(`INSERT INTO wards (facility_id, ward_type, total_beds, available_beds, occupied_beds, out_of_service_beds, notes, updated_by, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(facility_id, ward_type) DO UPDATE SET total_beds = excluded.total_beds, available_beds = excluded.available_beds, occupied_beds = excluded.occupied_beds,
    out_of_service_beds = excluded.out_of_service_beds, notes = excluded.notes, updated_by = excluded.updated_by, is_demo = 0, updated_at = ${NOW}`),
  syncBeds: { icu: raw.prepare(`UPDATE facilities SET icu_beds = ?, total_icu_beds = ?, updated_at = ${NOW}, beds_updated_at = ${NOW}, beds_updated_by = ? WHERE id = ?`),
              general: raw.prepare(`UPDATE facilities SET general_beds = ?, total_general_beds = ?, updated_at = ${NOW}, beds_updated_at = ${NOW}, beds_updated_by = ? WHERE id = ?`) },
  latestCrowd: raw.prepare('SELECT * FROM crowd_updates WHERE facility_id = ? ORDER BY id DESC LIMIT ?'),
  insertCrowd: raw.prepare('INSERT INTO crowd_updates (facility_id, level, wait_minutes, queue_count, by_name) VALUES (?, ?, ?, ?, ?)'),
  // doctors
  nextDoctorId: raw.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM doctors'),
  insertDoctor: raw.prepare(`INSERT INTO doctors (id, name, spec, hospital, status, room, timings, fee, facility_id, department, duty_status, accepts_appointments, contact) VALUES (?, ?, ?, ?, 'Available', ?, ?, ?, ?, ?, ?, ?, ?)`),
  updateDoctor: raw.prepare(`UPDATE doctors SET name = ?, spec = ?, department = ?, room = ?, timings = ?, fee = ?, duty_status = ?, accepts_appointments = ?, contact = ?, updated_at = ${NOW} WHERE id = ?`),
  setDuty: raw.prepare(`UPDATE doctors SET duty_status = ?, accepts_appointments = ?, updated_at = ${NOW} WHERE id = ?`),
  archiveDoctor: raw.prepare(`UPDATE doctors SET archived = 1, unit_id = NULL, updated_at = ${NOW} WHERE id = ?`),
  doctorHospitalName: raw.prepare('SELECT hospital FROM doctors WHERE facility_id = ? LIMIT 1'),
  // profile + team
  profile: raw.prepare(`UPDATE facilities SET name = ?, phone = ?, address = ?, specialties = ?, lat = ?, lng = ?, emergency_available = ?, operating_hours = ?, languages = ?, amenities = ?,
    updated_at = ${NOW}, info_updated_at = ${NOW}, info_updated_by = ?, info_verified_at = NULL, info_verified_by = NULL WHERE id = ?`),
  team: raw.prepare("SELECT id, name, phone, staff_role, created_at, active FROM users WHERE role = 'hospital' AND facility_id = ? ORDER BY id"),
  setStaffRole: raw.prepare("UPDATE users SET staff_role = ? WHERE id = ? AND role = 'hospital'"),
  managers: raw.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'hospital' AND facility_id = ? AND staff_role = 'manager'"),
  setPassword: raw.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?'), dropSessions: raw.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
  userRaw: raw.prepare('SELECT password_hash, salt FROM users WHERE id = ?'),
  // demo
  clearDemo: ['wards', 'crowd_updates', 'hospital_services', 'treatment_costs', 'medical_stores', 'assets'].map(t => raw.prepare(`DELETE FROM ${t} WHERE is_demo = 1`))
};

module.exports = {
  services, costs, stores, assets,
  wards: fid => q.wards.all(fid).map(wardRow), ward: (fid, type) => { const r = q.ward.get(fid, type); return r ? wardRow(r) : null; },
  // Saves one ward and, for ICU / General, mirrors available + capacity onto the hospital's bed counts that the public site and triage already read. Call inside db.transaction.
  saveWard: (fid, type, w, by) => {
    q.upsertWard.run(fid, type, w.total, w.available, w.occupied, w.outOfService, w.notes, by);
    if (q.syncBeds[type]) q.syncBeds[type].run(w.available, w.total, by, fid);
  },
  crowdHistory: (fid, n = 10) => q.latestCrowd.all(fid, n).map(r => ({ id: r.id, level: r.level, waitMinutes: r.wait_minutes, queueCount: r.queue_count, verifiedAt: r.verified_at, by: r.by_name, demo: !!r.is_demo })),
  addCrowd: (fid, c, by) => Number(q.insertCrowd.run(fid, c.level, c.waitMinutes, c.queueCount, by).lastInsertRowid),
  createDoctor: (fid, d) => {
    const id = q.nextDoctorId.get().n, h = q.doctorHospitalName.get(fid);
    q.insertDoctor.run(id, d.name, d.spec, h ? h.hospital : d.hospital, d.room, d.timings, d.fee, fid, d.department, d.dutyStatus, d.acceptsAppointments ? 1 : 0, d.contact);
    return id;
  },
  updateDoctor: (id, d) => q.updateDoctor.run(d.name, d.spec, d.department, d.room, d.timings, d.fee, d.dutyStatus, d.acceptsAppointments ? 1 : 0, d.contact, id).changes,
  setDuty: (id, duty, accepts) => q.setDuty.run(duty, accepts ? 1 : 0, id).changes,
  archiveDoctor: id => q.archiveDoctor.run(id).changes,
  updateProfile: (id, p, by) => q.profile.run(p.name, p.phone, p.address, JSON.stringify(p.specialties), p.lat, p.lng, p.emergencyAvailable == null ? null : p.emergencyAvailable ? 1 : 0, p.operatingHours, JSON.stringify(p.languages), JSON.stringify(p.amenities), by, id).changes,
  team: fid => q.team.all(fid).map(r => ({ id: r.id, name: r.name, login: r.phone, staffRole: r.staff_role, joinedAt: r.created_at, active: r.active !== 0 })),
  setStaffRole: (id, role) => q.setStaffRole.run(role, id).changes, managerCount: fid => q.managers.get(fid).n,
  passwordHash: id => q.userRaw.get(id), setPassword: (id, hash, salt, keepTokenHash) => { q.setPassword.run(hash, salt, id); q.dropSessions.run(id, keepTokenHash); },
  clearDemo: () => q.clearDemo.forEach(s => s.run()),
  // Moves beds between available and occupied in ONE statement (admit / discharge). Two people doing it at once can never double-count or go negative.
  adjustOccupancy: (fid, type, delta, by) => {
    const w = raw.prepare('SELECT * FROM wards WHERE facility_id = ? AND ward_type = ?').get(fid, type);
    if (!w) return { error: 'no_ward' };
    const ch = raw.prepare(`UPDATE wards SET available_beds = available_beds - ?1, occupied_beds = COALESCE(occupied_beds, total_beds - available_beds - COALESCE(out_of_service_beds, 0)) + ?1, updated_by = ?2, is_demo = 0, updated_at = ${NOW}
      WHERE facility_id = ?3 AND ward_type = ?4 AND available_beds - ?1 >= 0 AND COALESCE(occupied_beds, total_beds - available_beds - COALESCE(out_of_service_beds, 0)) + ?1 >= 0
        AND available_beds - ?1 + COALESCE(occupied_beds, total_beds - available_beds - COALESCE(out_of_service_beds, 0)) + ?1 + COALESCE(out_of_service_beds, 0) <= total_beds`).run(delta, by, fid, type).changes;
    if (ch !== 1) return { error: 'limit', before: wardRow(w) };
    const after = wardRow(raw.prepare('SELECT * FROM wards WHERE facility_id = ? AND ward_type = ?').get(fid, type));
    if (q.syncBeds[type]) q.syncBeds[type].run(after.available, after.total, by, fid);
    return { before: wardRow(w), after };
  }
};
