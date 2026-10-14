'use strict';
// Hospital units / departments (Emergency, ICU, OPD, ...). Hospital staff manage their own hospital's units; administrators may manage any.
//   GET  /api/staff/units                  list (hospital: own; admin: ?facilityId=)   -> { units, types, summary }
//   POST /api/staff/units                  create
//   PUT  /api/staff/units/:id              edit details (clears the "verified" mark)
//   PUT  /api/staff/units/:id/active       { active: true|false }  activate / deactivate (units are never deleted)
//   PUT  /api/staff/units/:id/doctors      { doctorIds: [...] }    set exactly which of this hospital's doctors belong to the unit
// Doctors cannot manage units. Bed numbers are never copied into units: bedCategory only links a unit to the hospital's existing bed counts.
const db = require('../db');
const { send, httpError } = require('../lib/http');
const { requireRole } = require('../lib/router');
const S = require('../lib/staff');

function loadUnit(ctx) {
  const u = requireRole(ctx, 'hospital', 'admin');
  if (!S.can(u, 'info', 'write')) throw S.deny('write');
  const id = Number(ctx.params.id);
  const unit = Number.isInteger(id) ? db.getUnit(id) : null;
  // Same message whether the unit does not exist or belongs to another hospital: no way to probe other hospitals' ids.
  if (!unit || (u.role === 'hospital' && unit.facilityId !== u.facilityId)) throw httpError(404, 'Unit not found.');
  return { user: u, unit };
}
const withGaps = u => ({ ...u, gaps: S.unitGaps(u, u.doctorCount) });

module.exports = function (router) {
  router.add('GET', '/api/staff/units', ctx => {
    const { facilityId, facility } = S.authorize(ctx, 'info');
    const units = db.listUnits(facilityId).map(withGaps);
    const sharedCat = {}; units.filter(u => u.active && u.bedCategory).forEach(u => { sharedCat[u.bedCategory] = (sharedCat[u.bedCategory] || 0) + 1; });
    const beds = Object.fromEntries(S.bedSummary(facility).map(b => [b.category, b]));
    // A unit only shows bed figures through its category, labelled as hospital-wide; it never invents a per-unit split.
    units.forEach(u => { u.beds = u.bedCategory ? { ...beds[u.bedCategory], sharedWithUnits: sharedCat[u.bedCategory] || 0 } : null; });
    send(ctx.res, 200, {
      facilityId, units, types: S.UNIT_TYPES,
      summary: { total: units.length, active: units.filter(u => u.active).length, unverified: units.filter(u => !u.verifiedAt).length, incomplete: units.filter(u => u.gaps.length).length }
    });
  });

  router.add('POST', '/api/staff/units', async ctx => {
    const b = await ctx.body();
    const { user, facilityId } = S.authorize(ctx, 'info', 'write', { requested: b.facilityId });
    const v = S.validateUnit(b);
    if (db.unitNameTaken(facilityId, v.name)) throw httpError(409, 'This hospital already has a unit with that name.');
    const id = db.transaction(() => {
      const newId = db.createUnit(facilityId, v);
      db.logActivity(user, { facilityId, action: 'unit_created', entityType: 'unit', entityId: newId, detail: { name: v.name, type: v.type } });
      return newId;
    });
    send(ctx.res, 201, { unit: withGaps(db.getUnit(id)) });
  });

  router.add('PUT', '/api/staff/units/:id', async ctx => {
    const { user, unit } = loadUnit(ctx);
    const v = S.validateUnit(await ctx.body());
    if (db.unitNameTaken(unit.facilityId, v.name, unit.id)) throw httpError(409, 'This hospital already has a unit with that name.');
    db.transaction(() => {
      db.updateUnit(unit.id, v);
      const changed = Object.keys(v).filter(k => v[k] !== (unit[k] == null ? null : unit[k]));
      db.logActivity(user, { facilityId: unit.facilityId, action: 'unit_updated', entityType: 'unit', entityId: unit.id, detail: { name: v.name, changed } });
    });
    send(ctx.res, 200, { unit: withGaps(db.getUnit(unit.id)) });
  });

  router.add('PUT', '/api/staff/units/:id/active', async ctx => {
    const { user, unit } = loadUnit(ctx);
    const b = await ctx.body();
    if (typeof b.active !== 'boolean') throw httpError(400, 'active must be true or false.');
    db.transaction(() => {
      db.setUnitActive(unit.id, b.active);
      db.logActivity(user, { facilityId: unit.facilityId, action: b.active ? 'unit_activated' : 'unit_deactivated', entityType: 'unit', entityId: unit.id, detail: { name: unit.name } });
    });
    send(ctx.res, 200, { unit: withGaps(db.getUnit(unit.id)) });
  });

  router.add('PUT', '/api/staff/units/:id/doctors', async ctx => {
    const { user, unit } = loadUnit(ctx);
    const b = await ctx.body();
    if (!Array.isArray(b.doctorIds) || b.doctorIds.length > 500) throw httpError(400, 'doctorIds must be a list of doctor ids.');
    const wanted = [...new Set(b.doctorIds.map(Number))];
    if (!wanted.every(Number.isInteger)) throw httpError(400, 'doctorIds must be whole numbers.');
    const result = db.transaction(() => {
      // Every doctor must already work at THIS hospital; a doctor id from another hospital fails the whole change.
      for (const id of wanted) { const d = db.getDoctor(id); if (!d || d.facilityId !== unit.facilityId) throw httpError(400, 'Doctor ' + id + ' does not work at this hospital.'); }
      const current = db.unitDoctorIds(unit.id);
      const removed = current.filter(id => !wanted.includes(id)), added = wanted.filter(id => !current.includes(id));
      removed.forEach(id => db.setDoctorUnit(id, null));
      added.forEach(id => db.setDoctorUnit(id, unit.id));
      if (removed.length || added.length) db.logActivity(user, { facilityId: unit.facilityId, action: 'unit_doctors_changed', entityType: 'unit', entityId: unit.id, detail: { name: unit.name, added, removed } });
      return { added, removed };
    });
    send(ctx.res, 200, { unit: withGaps(db.getUnit(unit.id)), ...result });
  });
};
