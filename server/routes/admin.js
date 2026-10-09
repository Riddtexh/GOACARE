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

module.exports = function (router) {
  router.add('GET', '/api/admin/users', ctx => {
    const admin = requireRole(ctx, 'admin');
    const users = db.adminListUsers(ctx.query.get('q') || '');
    db.logAdmin(admin, 'list_users');
    const byRole = {};
    users.forEach(u => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
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
};
