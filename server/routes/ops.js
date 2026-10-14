'use strict';
// Hospital operations for the staff workspace, plus the public feed the patient website reads.
//   wards       GET /api/staff/wards                PUT /api/staff/wards/:type          (general | icu | emergency | maternity | paediatric)
//   crowd       GET /api/staff/crowd                POST /api/staff/crowd               POST /api/staff/crowd/verify
//   resources   /api/staff/{services,costs,stores,assets}   GET list, POST, PUT /:id, DELETE /:id
//   doctors     POST /api/staff/doctors             PUT|DELETE /api/staff/doctors/:id   (DELETE archives: old appointments keep their reference)
//   team        GET /api/staff/team                 PUT /api/staff/team/:id             (manager changes a colleague's role)
//   public      GET /api/public/operations          verified, non-demo information for the patient website (no staff names, no demo rows)
// Every route checks the role (lib/staff.js CAPS) and the hospital on the server.
const db = require('../db');
const ops = require('../ops-db');
const { send, sendCached, httpError, todayIST } = require('../lib/http');
const { requireRole } = require('../lib/router');
const S = require('../lib/staff');
const gov = require('../gov-db');
const { createApproval } = require('./inventory');

const WARDS = { general: 'General', icu: 'ICU', emergency: 'Emergency', maternity: 'Maternity', paediatric: 'Paediatric' };
const CROWD_LEVELS = ['Low', 'Moderate', 'Busy', 'Very Busy'];
const DUTY = ['On Duty', 'Off Duty', 'On Leave'];
const ASSET_CATEGORIES = ['Medical equipment', 'Ambulance / vehicle', 'IT equipment', 'Furniture', 'Building / utilities', 'Other'];
const ASSET_CONDITIONS = ['New', 'Good', 'Fair', 'Poor', 'Out of service'];
const MAINTENANCE = ['Up to date', 'Due soon', 'Overdue', 'Under maintenance', 'Not applicable'];
const STALE = { bedsHours: 24, crowdMinutes: 120 };
const isStale = (iso, ms) => !iso || Date.now() - Date.parse(iso) > ms;

const num = (v, label, { min = 0, max = 5000, required = true } = {}) => {
  if (v === undefined || v === null || v === '') { if (required) throw httpError(400, `${label} is required.`); return null; }
  const n = Number(v);
  if (typeof v === 'boolean' || !Number.isInteger(n) || n < min || n > max) throw httpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const oneOf = (v, list, label) => { if (!list.includes(v)) throw httpError(400, `${label} must be one of: ${list.join(', ')}.`); return v; };
const contactOk = (v, label) => { if (v && !/^(\+?[\d][\d\s\-().]{4,28}|[\w.+-]+@[\w-]+(\.[\w-]+)+)$/.test(v)) throw httpError(400, `${label} must be a phone number or an email address.`); return v; };

module.exports = function (router) {
  // ------------------------------------------------ wards ------------------------------------------------
  router.add('GET', '/api/staff/wards', ctx => {
    const { facilityId, facility } = S.authorize(ctx, 'beds');
    const have = Object.fromEntries(ops.wards(facilityId).map(w => [w.type, w]));
    send(ctx.res, 200, { facilityId, types: WARDS, staleAfterHours: STALE.bedsHours,
      wards: Object.keys(WARDS).map(t => have[t] || { type: t, total: null, available: null, occupied: null, outOfService: null, notes: '', updatedAt: null, updatedBy: null, demo: false }),
      hospitalCounts: { icu: { available: facility.icuBeds, total: facility.totalIcuBeds }, general: { available: facility.generalBeds, total: facility.totalGeneralBeds }, oxygen: { available: facility.oxygenBeds, total: facility.totalOxygenBeds } } });
  });

  router.add('PUT', '/api/staff/wards/:type', async ctx => {
    const type = ctx.params.type;
    if (!WARDS[type]) throw httpError(404, 'Unknown ward type.');
    const { user, facilityId } = S.authorize(ctx, 'beds', 'write');
    const b = await ctx.body(), label = WARDS[type];
    const w = { total: num(b.total, 'Total beds'), available: num(b.available, 'Available beds'), occupied: num(b.occupied, 'Occupied beds', { required: false }), outOfService: num(b.outOfService, 'Out-of-service beds', { required: false }), notes: S.text(b.notes, 300, 'Notes') };
    for (const [n, v] of [['Available', w.available], ['Occupied', w.occupied], ['Out-of-service', w.outOfService]]) if (v != null && v > w.total) throw httpError(400, `${n} beds (${v}) cannot be more than the total (${w.total}).`);
    const sum = w.available + (w.occupied || 0) + (w.outOfService || 0);
    if (sum > w.total) throw httpError(400, `Available + occupied + out of service (${sum}) cannot be more than the total capacity (${w.total}).`);
    const before = ops.ward(facilityId, type);
    // Optional optimistic lock: the form sends the updatedAt it was loaded with; a newer change by someone else is refused, never silently overwritten.
    if (b.expectedUpdatedAt !== undefined && b.expectedUpdatedAt !== null && (before ? before.updatedAt : null) !== b.expectedUpdatedAt)
      throw httpError(409, 'Someone else has just updated this ward. Reload to see the latest counts, then try again.', { current: before });
    // A big capacity change by ward staff is a request that a manager approves; the published numbers stay as they are until then.
    const bigChange = before && before.total !== w.total && Math.abs(w.total - before.total) >= Math.max(5, Math.ceil(before.total * 0.25));
    if (bigChange && user.role === 'hospital' && user.staffRole !== 'manager') {
      const a = createApproval({ user, facilityId, kind: 'ward_capacity', summary: `${label} ward capacity ${before.total} → ${w.total}`, payload: { type, label, ward: w }, current: { total: before.total, available: before.available } });
      return send(ctx.res, 202, { approval: a, message: 'This is a large capacity change, so it was sent to a hospital administrator for approval. Published bed numbers are unchanged until it is approved.' });
    }
    db.transaction(() => {
      ops.saveWard(facilityId, type, w, user.name);
      db.logActivity(user, { facilityId, action: 'ward_updated', entityType: 'ward', entityId: type, detail: { ward: label, before: before && { total: before.total, available: before.available, occupied: before.occupied, outOfService: before.outOfService }, after: { total: w.total, available: w.available, occupied: w.occupied, outOfService: w.outOfService } } });
    });
    send(ctx.res, 200, { ward: ops.ward(facilityId, type) });
  });
  // Admit (+n) or discharge (-n) beds atomically. Body: { delta: whole number }.
  router.add('POST', '/api/staff/wards/:type/occupancy', async ctx => {
    const type = ctx.params.type;
    if (!WARDS[type]) throw httpError(404, 'Unknown ward type.');
    const { user, facilityId } = S.authorize(ctx, 'beds', 'write'), b = await ctx.body();
    const delta = num(b.delta, 'Change', { min: -500, max: 500 });
    if (!delta) throw httpError(400, 'The change cannot be zero.');
    const r = db.transaction(() => {
      const x = ops.adjustOccupancy(facilityId, type, delta, user.name);
      if (x.error) return x;
      db.logActivity(user, { facilityId, action: 'ward_updated', entityType: 'ward', entityId: type, detail: { ward: WARDS[type], change: delta > 0 ? 'admitted ' + delta : 'discharged ' + -delta, before: { available: x.before.available, occupied: x.before.occupied }, after: { available: x.after.available, occupied: x.after.occupied } } });
      return x;
    });
    if (r.error === 'no_ward') throw httpError(409, 'Record this ward\'s capacity first.');
    if (r.error) throw httpError(409, 'That change would give a negative bed count or more beds than the ward has.', { current: r.before });
    send(ctx.res, 200, { ward: r.after });
  });

  // ------------------------------------------------ crowd and waiting time ------------------------------------------------
  // Staff-reported snapshots. They are NOT live sensor data and are labelled that way everywhere; after two hours they count as outdated.
  const crowdView = c => c && { ...c, stale: isStale(c.verifiedAt, STALE.crowdMinutes * 60000) };
  router.add('GET', '/api/staff/crowd', ctx => {
    const { facilityId } = S.authorize(ctx, 'crowd');
    const history = ops.crowdHistory(facilityId, 10);
    send(ctx.res, 200, { facilityId, levels: CROWD_LEVELS, staleAfterMinutes: STALE.crowdMinutes, current: crowdView(history[0] || null), history,
      note: 'Staff-reported estimate. It is not a live sensor feed and is marked outdated after ' + STALE.crowdMinutes / 60 + ' hours.' });
  });
  const saveCrowd = (user, facilityId, c, action) => db.transaction(() => {
    ops.addCrowd(facilityId, c, user.name);
    if (c.waitMinutes != null) db.addWaitReport(facilityId, c.waitMinutes, 'hospital', user.id);   // feeds the patient site's crowd estimate
    db.logActivity(user, { facilityId, action, entityType: 'crowd', entityId: facilityId, detail: c });
  });
  router.add('POST', '/api/staff/crowd', async ctx => {
    const { user, facilityId } = S.authorize(ctx, 'crowd', 'write');
    const b = await ctx.body();
    const c = { level: oneOf(b.level, CROWD_LEVELS, 'Crowd level'), waitMinutes: num(b.waitMinutes, 'Estimated waiting time (minutes)', { max: 480, required: false }), queueCount: num(b.queueCount, 'Queue count', { required: false }) };
    saveCrowd(user, facilityId, c, 'crowd_updated');
    send(ctx.res, 201, { current: crowdView(ops.crowdHistory(facilityId, 1)[0]) });
  });
  router.add('POST', '/api/staff/crowd/verify', ctx => {
    const { user, facilityId } = S.authorize(ctx, 'crowd', 'write');
    const last = ops.crowdHistory(facilityId, 1)[0];
    if (!last) throw httpError(409, 'There is no earlier update to re-confirm. Enter the current crowd level first.');
    saveCrowd(user, facilityId, { level: last.level, waitMinutes: last.waitMinutes, queueCount: last.queueCount }, 'crowd_verified');
    send(ctx.res, 200, { current: crowdView(ops.crowdHistory(facilityId, 1)[0]) });
  });

  // ------------------------------------------------ services, costs, stores, assets ------------------------------------------------
  const dup = (e, msg) => { if (/UNIQUE/i.test(String(e && e.message))) throw httpError(409, msg); throw e; };
  function resource(path, cap, repo, entity, parse, dupMsg, intercept) {
    router.add('GET', '/api/staff/' + path, ctx => { const { facilityId } = S.authorize(ctx, cap); send(ctx.res, 200, { facilityId, items: repo.list(facilityId) }); });
    router.add('POST', '/api/staff/' + path, async ctx => {
      const b = await ctx.body(), { user, facilityId } = S.authorize(ctx, cap, 'write', { requested: b.facilityId });
      const v = parse(b, null, user);
      if (intercept) { const a = intercept(user, facilityId, v, null); if (a) return send(ctx.res, 202, a); }
      let id; try { id = db.transaction(() => { const n = repo.insert(facilityId, v, user.name); db.logActivity(user, { facilityId, action: entity + '_created', entityType: entity, entityId: n, detail: { name: v.name || v.service_name } }); return n; }); } catch (e) { dup(e, dupMsg); }
      send(ctx.res, 201, { item: repo.get(id) });
    });
    const load = ctx => {
      const u = requireRole(ctx, 'hospital', 'admin'); if (!S.can(u, cap, 'write')) throw S.deny('write');
      const id = Number(ctx.params.id), item = Number.isInteger(id) ? repo.get(id) : null;
      if (!item || (u.role === 'hospital' && item.facilityId !== u.facilityId)) throw S.crossHospital('Not found.', 404);
      return { user: u, item };
    };
    router.add('PUT', `/api/staff/${path}/:id`, async ctx => {
      const { user, item } = load(ctx), v = parse(await ctx.body(), item, user);
      if (intercept) { const a = intercept(user, item.facilityId, v, item); if (a) return send(ctx.res, 202, a); }
      try { db.transaction(() => { repo.update(item.id, v, user.name); db.logActivity(user, { facilityId: item.facilityId, action: entity + '_updated', entityType: entity, entityId: item.id, detail: { name: v.name || v.service_name } }); }); } catch (e) { dup(e, dupMsg); }
      send(ctx.res, 200, { item: repo.get(item.id) });
    });
    router.add('DELETE', `/api/staff/${path}/:id`, ctx => {
      const { user, item } = load(ctx);
      db.transaction(() => { repo.remove(item.id); db.logActivity(user, { facilityId: item.facilityId, action: entity + '_deleted', entityType: entity, entityId: item.id, detail: { name: item.name || item.serviceName } }); });
      send(ctx.res, 200, { ok: true });
    });
  }
  resource('services', 'info', ops.services, 'service', b => ({ name: S.text(b.name, 80, 'Name', { required: true, min: 2 }), kind: oneOf(b.kind, ['department', 'service'], 'Type'), description: S.text(b.description, 300, 'Description'), available: b.available === false ? 0 : 1 }), 'This hospital already lists that department or service.');
  resource('costs', 'costs', ops.costs, 'cost', b => {
    const min = num(b.minCost, 'Lowest estimated cost (₹)', { max: 10000000 }), max = num(b.maxCost, 'Highest estimated cost (₹)', { max: 10000000 });
    if (min > max) throw httpError(400, 'The lowest estimate cannot be more than the highest estimate.');
    return { service_name: S.text(b.serviceName, 120, 'Service or treatment', { required: true, min: 2 }), min_cost: min, max_cost: max, notes: S.text(b.notes, 200, 'Notes') };
  }, 'A cost for that service already exists. Edit it instead.',
  // Finance staff propose price changes; a manager approves them. Published prices do not change before that. Managers edit directly (still audited with before / after).
  (user, facilityId, v, prev) => {
    if (user.role !== 'hospital' || user.staffRole !== 'finance') return null;
    const a = createApproval({ user, facilityId, kind: 'cost_upsert', summary: `${prev ? 'Change' : 'Add'} price estimate for ${v.service_name}: ₹${v.min_cost}–₹${v.max_cost}`, payload: { id: prev ? prev.id : null, ...v }, current: prev && { min: prev.minCost, max: prev.maxCost, notes: prev.notes } });
    return { approval: a, message: 'Sent to a hospital administrator for approval. The published price does not change until it is approved.' };
  });
  resource('stores', 'stores', ops.stores, 'store', (b, prev, user) => {
    const note = S.text(b.availabilityNote, 500, 'Medicine availability note'), want = b.availabilityVerified === true;
    if (want && !note) throw httpError(400, 'Write the verified availability note first, or untick "verified".');
    const keep = prev && want && prev.availabilityVerifiedAt && prev.availabilityNote === note;   // an edited note must be re-verified
    return { name: S.text(b.name, 100, 'Store name', { required: true, min: 2 }), location: S.text(b.location, 160, 'Location'), contact: contactOk(S.text(b.contact, 60, 'Contact'), 'Contact'), hours: S.text(b.hours, 80, 'Operating hours'), availability_note: note,
      availability_verified_at: want ? (keep ? prev.availabilityVerifiedAt : new Date().toISOString().replace(/\.\d+Z$/, 'Z')) : null, availability_verified_by: want ? (keep ? prev.availabilityVerifiedBy : user.name) : null };
  }, 'A store with that name already exists.');
  resource('assets', 'assets', ops.assets, 'asset', b => {
    const acquired = S.text(b.acquiredOn, 10, 'Acquisition date');
    if (acquired && (!/^\d{4}-\d{2}-\d{2}$/.test(acquired) || Number.isNaN(Date.parse(acquired)) || acquired > todayIST())) throw httpError(400, 'Acquisition date must be a past date (YYYY-MM-DD).');
    const no = S.text(b.assetNo, 40, 'Asset number', { required: true, min: 2 });
    if (!/^[A-Za-z0-9._\-/ ]+$/.test(no)) throw httpError(400, 'Asset number may use letters, digits and . _ - / only.');
    return { name: S.text(b.name, 100, 'Asset name', { required: true, min: 2 }), asset_no: no, category: oneOf(b.category, ASSET_CATEGORIES, 'Category'), acquired_on: acquired, condition: oneOf(b.condition, ASSET_CONDITIONS, 'Condition'), maintenance_status: oneOf(b.maintenanceStatus, MAINTENANCE, 'Maintenance status'), notes: S.text(b.notes, 300, 'Notes') };
  }, 'That asset number is already used at this hospital.');
  router.add('GET', '/api/staff/options', ctx => { requireRole(ctx, 'hospital', 'admin'); send(ctx.res, 200, { wardTypes: WARDS, crowdLevels: CROWD_LEVELS, duty: DUTY, assetCategories: ASSET_CATEGORIES, assetConditions: ASSET_CONDITIONS, maintenance: MAINTENANCE, staffRoles: S.STAFF_ROLES }); });

  // ------------------------------------------------ doctors: add / edit / archive ------------------------------------------------
  const parseDoctor = b => ({
    name: S.text(b.name, 80, "Doctor's name", { required: true, min: 2 }), spec: S.text(b.spec, 60, 'Specialization', { required: true, min: 2 }), department: S.text(b.department, 60, 'Department'),
    timings: S.text(b.timings, 60, 'Consultation timings', { required: true }), room: S.text(b.room, 60, 'Room', { required: true }), fee: S.text(b.fee, 60, 'Fee') || 'Not stated',
    dutyStatus: oneOf(b.dutyStatus || 'On Duty', DUTY, 'Duty status'), acceptsAppointments: b.acceptsAppointments !== false, contact: contactOk(S.text(b.contact, 80, 'Professional contact'), 'Professional contact')
  });
  const loadDoctor = ctx => {
    const u = requireRole(ctx, 'hospital', 'admin'); if (!S.can(u, 'doctors', 'write')) throw S.deny('write');
    const id = Number(ctx.params.id), d = Number.isInteger(id) ? db.staffDoctor(id) : null;
    if (!d || d.archived || (u.role === 'hospital' && d.facilityId !== u.facilityId)) throw S.crossHospital('Doctor not found.', 404);
    return { user: u, doctor: d };
  };
  router.add('POST', '/api/staff/doctors', async ctx => {
    const b = await ctx.body(), { user, facilityId, facility } = S.authorize(ctx, 'doctors', 'write', { requested: b.facilityId });
    const d = { ...parseDoctor(b), hospital: facility.name };
    const id = db.transaction(() => { const n = ops.createDoctor(facilityId, d); db.logActivity(user, { facilityId, action: 'doctor_created', entityType: 'doctor', entityId: n, detail: { name: d.name } }); return n; });
    send(ctx.res, 201, { doctor: db.staffDoctor(id) });
  });
  router.add('PUT', '/api/staff/doctors/:id', async ctx => {
    const { user, doctor } = loadDoctor(ctx), d = parseDoctor(await ctx.body());
    db.transaction(() => { ops.updateDoctor(doctor.id, d); db.logActivity(user, { facilityId: doctor.facilityId, action: 'doctor_edited', entityType: 'doctor', entityId: doctor.id, detail: { name: d.name } }); });
    send(ctx.res, 200, { doctor: db.staffDoctor(doctor.id) });
  });
  router.add('DELETE', '/api/staff/doctors/:id', ctx => {
    const { user, doctor } = loadDoctor(ctx);
    db.transaction(() => { ops.archiveDoctor(doctor.id); db.logActivity(user, { facilityId: doctor.facilityId, action: 'doctor_archived', entityType: 'doctor', entityId: doctor.id, detail: { name: doctor.name } }); });
    send(ctx.res, 200, { ok: true });
  });

  // ------------------------------------------------ team roles ------------------------------------------------
  router.add('GET', '/api/staff/team', ctx => { const { facilityId } = S.authorize(ctx, 'team'); send(ctx.res, 200, { facilityId, roles: S.STAFF_ROLES, team: ops.team(facilityId) }); });
  router.add('PUT', '/api/staff/team/:id', async ctx => {
    const u = requireRole(ctx, 'hospital', 'admin'); if (!S.can(u, 'team', 'write')) throw S.deny('write');
    const target = db.findUserById(Number(ctx.params.id));
    if (!target || target.role !== 'hospital' || (u.role === 'hospital' && target.facilityId !== u.facilityId)) throw S.crossHospital('Staff account not found.', 404);
    const role = oneOf((await ctx.body()).staffRole, S.STAFF_ROLES, 'Role');
    S.assertOperational(u, db.getStaffFacility(target.facilityId));
    // Making someone a hospital administrator is a protected change: a manager can only REQUEST it; a different manager approves (the super administrator can do it directly).
    if (u.role === 'hospital' && role === 'manager' && target.staffRole !== 'manager') {
      const a = createApproval({ user: u, facilityId: target.facilityId, kind: 'role_assignment', summary: `Make ${target.name} a hospital administrator`, payload: { userId: target.id, from: target.staffRole, to: 'manager' }, current: { role: target.staffRole } });
      return send(ctx.res, 202, { approval: a, message: 'Sent for approval by another administrator.' });
    }
    if (target.staffRole === 'manager' && role !== 'manager' && ops.managerCount(target.facilityId) <= 1) throw httpError(409, 'Every hospital needs at least one administrator. Make someone else an administrator first.');
    db.transaction(() => { ops.setStaffRole(target.id, role); db.logActivity(u, { facilityId: target.facilityId, action: 'team_role_changed', entityType: 'team', entityId: target.id, detail: { name: target.name, from: target.staffRole, to: role } }); });
    send(ctx.res, 200, { team: ops.team(target.facilityId) });
  });

  // ------------------------------------------------ public feed for the patient website ------------------------------------------------
  // Only staff-entered, non-demo data, each part with its own timestamp, verification status and "outdated" flag. Staff names are never included.
  router.add('GET', '/api/public/operations', ctx => {
    const out = {};
    for (const f of db.listStaffFacilities()) {
      // Suspended / rejected / unlisted hospitals publish nothing. Hospitals that are not (yet) approved are included only as UNTRUSTED (existing directory entries keep working).
      if (f.listingStatus !== 'listed' || f.verificationStatus === 'suspended' || f.verificationStatus === 'rejected') continue;
      const trusted = f.verificationStatus === 'approved';
      const wards = ops.wards(f.id).filter(w => !w.demo), crowd = ops.crowdHistory(f.id, 1).filter(c => !c.demo)[0] || null;
      const svc = ops.services.list(f.id).filter(s => !s.demo && s.available), costs = ops.costs.list(f.id).filter(c => !c.demo), stores = ops.stores.list(f.id).filter(s => !s.demo);
      const bedsAt = wards.map(w => w.updatedAt).sort().pop() || null;
      out[f.id] = {
        id: f.id, name: f.name, hospital: { status: f.verificationStatus, hospitalCode: f.hospitalCode, trusted, note: trusted ? 'Verified by GoaCare.' : 'This hospital has not been verified by GoaCare yet. Information below is reported by hospital staff.' },
        beds: { wards: wards.map(w => ({ type: w.type, label: WARDS[w.type], available: w.available, total: w.total, occupied: w.occupied, outOfService: w.outOfService, updatedAt: w.updatedAt })), updatedAt: bedsAt, outdated: wards.length ? isStale(bedsAt, STALE.bedsHours * 3600000) : null },
        crowd: crowd && { level: crowd.level, waitMinutes: crowd.waitMinutes, queueCount: crowd.queueCount, verifiedAt: crowd.verifiedAt, outdated: isStale(crowd.verifiedAt, STALE.crowdMinutes * 60000), source: 'Reported by hospital staff. Not a live sensor feed.' },
        profile: { phone: f.phone || null, address: f.address, emergencyAvailable: f.emergencyAvailable, operatingHours: f.operatingHours || null, languages: f.languages, amenities: f.amenities,
          departments: svc.filter(s => s.kind === 'department').map(s => s.name), services: svc.filter(s => s.kind === 'service').map(s => s.name),
          verification: f.infoVerifiedAt ? 'verified' : f.infoUpdatedAt ? 'staff-reported' : 'not-confirmed', verifiedAt: f.infoVerifiedAt, updatedAt: f.infoUpdatedAt },
        costs: costs.map(c => ({ service: c.serviceName, min: c.minCost, max: c.maxCost, notes: c.notes, estimate: true, updatedAt: c.updatedAt })),
        medicines: trusted ? gov.publicMedicines(f.id) : [],   // availability only (never quantities), only items the hospital published, only for verified hospitals
        stores: stores.map(s => ({ name: s.name, location: s.location, contact: s.contact, hours: s.hours, availability: s.availabilityVerifiedAt ? s.availabilityNote : null, availabilityVerifiedAt: s.availabilityVerifiedAt }))
      };
    }
    sendCached(ctx.req, ctx.res, { hospitals: out, thresholds: { bedsOutdatedAfterHours: STALE.bedsHours, crowdOutdatedAfterMinutes: STALE.crowdMinutes } });
  });
};
module.exports.STALE = STALE;
