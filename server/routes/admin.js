'use strict';
// Read-only admin API: see who has registered and what is stored for each account.  Admin accounts only.
//   GET /api/admin/users?q=<search>     every account with item counts
//   GET /api/admin/users/:id            one account: profile, records, prescriptions (details only, no images), appointments, claims
//   GET /api/admin/audit                the latest admin actions (who looked at whom)
// Never returned: password hashes, salts, session tokens.  Every list / detail view is written to the admin_audit table.
// Admin accounts cannot be created through sign-up. Promote an existing account from the server:  npm run make-admin -- <mobile or Health ID>
const db = require('../db');
const { send, httpError } = require('../lib/http');
const { requireRole } = require('../lib/router');
const S = require('../lib/staff');
const gov = require('../gov-db');

module.exports = function (router) {
  router.add('GET', '/api/admin/users', ctx => {
    const admin = requireRole(ctx, 'admin');
    const role = ctx.query.get('role');
    if (role && !['patient', 'doctor', 'hospital', 'admin'].includes(role)) throw httpError(400, 'Unknown role.');
    const all = db.adminListUsers(ctx.query.get('q') || '');
    const users = role ? all.filter(u => u.role === role) : all;
    db.logAdmin(admin, 'list_users');
    const byRole = {};
    all.forEach(u => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
    send(ctx.res, 200, { total: users.length, byRole, users });
  });

  router.add('GET', '/api/admin/users/:id', ctx => {
    const admin = requireRole(ctx, 'admin');
    const id = Number(ctx.params.id);
    const user = Number.isInteger(id) ? db.findUserById(id) : null;
    if (!user) throw httpError(404, 'No such user.');
    const row = db.adminListUsers('').find(u => u.id === id);
    db.logAdmin(admin, 'view_user', id);
    send(ctx.res, 200, {
      user: { ...row, facilityName: user.facilityId ? (db.getFacility(user.facilityId) || {}).name || null : null },
      profile: db.getProfile(id),
      records: db.listRecords(id),
      prescriptions: db.listPrescriptions(id).map(({ imgUrl, ...rest }) => rest),   // the photo itself stays private
      appointments: db.userAppointments(id),
      claims: db.listClaims(id)
    });
  });

  router.add('GET', '/api/admin/audit', ctx => {
    requireRole(ctx, 'admin');
    send(ctx.res, 200, { audit: db.adminAudit(50) });
  });

  // ---- operational oversight (no patient data in any of these) ----
  router.add('GET', '/api/admin/overview', ctx => {
    requireRole(ctx, 'admin');
    const c = db.adminCounts(), st = db.adminFacilityStats(), facilities = db.listStaffFacilities(), now = Date.now();
    const total = Object.values(c.byRole).reduce((a, b) => a + b, 0);
    send(ctx.res, 200, {
      users: { total, byRole: c.byRole },
      hospitals: { total: facilities.length, verified: facilities.filter(f => f.infoVerifiedAt).length, awaitingVerification: facilities.filter(f => !f.infoVerifiedAt).length,
        bedsConfirmedLast24h: facilities.filter(f => f.staffUpdatedAt && now - Date.parse(f.staffUpdatedAt) < 864e5).length, bedsNeverConfirmed: facilities.filter(f => !f.staffUpdatedAt).length },
      doctors: { total: st.doctorTotal }, units: c.units, appointments: c.appointments,
      verification: { hospitalsPending: facilities.filter(f => f.verificationStatus === 'pending').length, hospitalRegistrationsPending: gov.hospitalQueue('pending').filter(h => h.registered).length, doctorsPending: gov.doctorQueue('pending').length, securityAlerts: gov.alertsOpen(null).length }
    });
  });

  router.add('GET', '/api/admin/facilities', ctx => {
    requireRole(ctx, 'admin');
    const st = db.adminFacilityStats();
    send(ctx.res, 200, { facilities: db.listStaffFacilities().map(f => ({ ...f, doctorCount: st.docs[f.id] || 0, unitCount: st.units[f.id] || 0, unitsUnverified: st.unverified[f.id] || 0 })) });
  });

  router.add('PUT', '/api/admin/facilities/:id/verify', ctx => {
    const admin = requireRole(ctx, 'admin');
    const f = db.getStaffFacility(ctx.params.id);
    if (!f) throw httpError(404, 'Unknown hospital.');
    db.transaction(() => {
      db.verifyFacility(f.id, admin.name);
      db.logActivity(admin, { facilityId: f.id, action: 'hospital_verified', entityType: 'hospital', entityId: f.id, detail: { name: f.name } });
    });
    send(ctx.res, 200, { facility: db.getStaffFacility(f.id) });
  });

  router.add('PUT', '/api/admin/units/:id/verify', ctx => {
    const admin = requireRole(ctx, 'admin');
    const id = Number(ctx.params.id), unit = Number.isInteger(id) ? db.getUnit(id) : null;
    if (!unit) throw httpError(404, 'Unit not found.');
    db.transaction(() => {
      db.verifyUnit(unit.id, admin.name);
      db.logActivity(admin, { facilityId: unit.facilityId, action: 'unit_verified', entityType: 'unit', entityId: unit.id, detail: { name: unit.name } });
    });
    send(ctx.res, 200, { unit: { ...db.getUnit(unit.id), gaps: S.unitGaps(unit, unit.doctorCount) } });
  });

  // System-wide change history (staff, doctor and admin actions). ?facilityId= ?role= ?entityType= ?limit= ?offset=
  router.add('GET', '/api/admin/activity', ctx => {
    requireRole(ctx, 'admin');
    const q = ctx.query, role = q.get('role'), type = q.get('entityType'), fid = q.get('facilityId');
    if (role && !['doctor', 'hospital', 'admin'].includes(role)) throw httpError(400, 'Unknown role.');
    if (type && !['beds', 'ward', 'crowd', 'doctor', 'appointment', 'unit', 'hospital', 'service', 'cost', 'store', 'asset', 'team'].includes(type)) throw httpError(400, 'Unknown activity type.');
    const limit = Math.min(100, Math.max(1, parseInt(q.get('limit'), 10) || 25)), offset = Math.max(0, parseInt(q.get('offset'), 10) || 0);
    send(ctx.res, 200, db.activity({ facilityId: fid || null, role: role || null, entityType: type || null, limit, offset }));
  });
};
