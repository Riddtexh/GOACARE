'use strict';
// Settings for staff, doctors and administrators: profile, security, notification preferences, integrity status, help.
//   GET|PUT /api/settings/profile       GET /api/settings/security        DELETE /api/settings/sessions/:handle     POST /api/settings/sessions/revoke-others
//   GET|PUT /api/settings/notifications  GET /api/settings/help
// Nothing here can change a role, a hospital, a verification state or an ID: PUT /profile reads only { name, email } from the request.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const gov = require('../gov-db');
const audit = require('../lib/audit');
const auth = require('../auth');
const S = require('../lib/staff');
const { send, httpError, parseCookies, COOKIE } = require('../lib/http');
const { requireRole } = require('../lib/router');

const WHO = ['hospital', 'doctor', 'admin'];
const PREFS = [
  ['bed_alerts', 'Bed availability alerts'], ['appointment_changes', 'Appointment changes'], ['schedule_changes', 'Doctor schedule changes'], ['stock_alerts', 'Medicine stock alerts'],
  ['pending_approvals', 'Pending approvals'], ['invitation_status', 'Staff invitation status'], ['security_alerts', 'Security alerts']
];
const mandatoryFor = u => ['security_alerts'].concat(u.role === 'admin' || u.staffRole === 'manager' ? ['pending_approvals'] : []);
let version = 'unknown'; try { version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; } catch (e) { /* keep unknown */ }

module.exports = function (router) {
  router.add('GET', '/api/settings/profile', ctx => {
    const u = requireRole(ctx, ...WHO), f = u.facilityId ? db.getStaffFacility(u.facilityId) : null, reg = gov.doctorRegistration(u.id);
    send(ctx.res, 200, { profile: { name: u.name, login: u.phone, email: u.email, role: u.role, staffRole: u.staffRole, facility: f && { id: f.id, name: f.name, hospitalCode: f.hospitalCode, status: f.verificationStatus },
      doctor: reg && { doctorCode: reg.doctorCode, status: reg.status, credentialStatus: reg.credentialStatus }, affiliations: u.role === 'doctor' ? gov.affiliationsOf(u.id).filter(a => a.status === 'approved') : undefined },
      photo: { supported: false, note: 'Profile photos are not supported yet.' }, editable: ['name', 'email'] });
  });
  router.add('PUT', '/api/settings/profile', async ctx => {
    const u = requireRole(ctx, ...WHO), b = await ctx.body();
    const name = S.text(b.name == null ? u.name : b.name, 80, 'Name', { required: true, min: 2 }).replace(/\s+/g, ' ');
    const email = S.text(b.email == null ? (u.email || '') : b.email, 120, 'Email').toLowerCase();
    if (email && !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
    db.transaction(() => {
      gov.setProfile(u.id, name, email);
      db.logActivity(u, { facilityId: u.facilityId, action: 'profile_updated', entityType: 'staff_account', entityId: u.id, detail: { changed: [name !== u.name && 'name', email !== (u.email || '') && 'email'].filter(Boolean) } });
    });
    send(ctx.res, 200, { ok: true });
  });

  router.add('GET', '/api/settings/security', ctx => {
    const u = requireRole(ctx, ...WHO), cur = auth.hashToken(parseCookies(ctx.req)[COOKIE] || '').slice(0, 12);
    send(ctx.res, 200, {
      sessions: gov.sessionsOf(u.id).map(s => ({ ...s, current: s.handle === cur })), recentLogins: gov.recentLogins(u.id, 10),
      alerts: audit.list({ actorId: u.id }, { outcome: 'blocked' }, { limit: 10 }).items.map(e => ({ at: e.at, action: e.action, reason: e.reason })),
      password: { change: true, reset: false, resetNote: 'Self-service reset needs an SMS or email provider, which is not configured. A hospital administrator or GoaCare can arrange a reset.' },
      mfa: { supported: false, note: 'Multi-factor sign-in is not available with the current sign-in system.' }
    });
  });
  router.add('DELETE', '/api/settings/sessions/:handle', ctx => {
    const u = requireRole(ctx, ...WHO);
    if (!gov.revokeSession(u.id, ctx.params.handle)) throw httpError(404, 'Session not found.');
    audit.append({ actorId: u.id, actorRole: u.role, facilityId: u.facilityId, action: 'session_revoked', resourceType: 'session', resourceId: u.id });
    send(ctx.res, 200, { ok: true });
  });
  router.add('POST', '/api/settings/sessions/revoke-others', ctx => {
    const u = requireRole(ctx, ...WHO), cur = auth.hashToken(parseCookies(ctx.req)[COOKIE] || '');
    const n = db.raw.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(u.id, cur).changes;
    audit.append({ actorId: u.id, actorRole: u.role, facilityId: u.facilityId, action: 'other_sessions_revoked', resourceType: 'session', resourceId: u.id, detail: { count: n } });
    send(ctx.res, 200, { revoked: n });
  });

  router.add('GET', '/api/settings/notifications', ctx => {
    const u = requireRole(ctx, ...WHO), p = gov.prefs(u.id), mand = mandatoryFor(u);
    send(ctx.res, 200, { preferences: PREFS.map(([key, label]) => ({ key, label, mandatory: mand.includes(key), enabled: mand.includes(key) ? true : p[key] !== false })) });
  });
  router.add('PUT', '/api/settings/notifications', async ctx => {
    const u = requireRole(ctx, ...WHO), b = await ctx.body(), mand = mandatoryFor(u);
    if (!b.preferences || typeof b.preferences !== 'object') throw httpError(400, 'Send { preferences: { key: true | false } }.');
    for (const [k, v] of Object.entries(b.preferences)) {
      if (!PREFS.some(p => p[0] === k)) throw httpError(400, 'Unknown notification type: ' + String(k).slice(0, 40));
      if (typeof v !== 'boolean') throw httpError(400, 'Each preference must be true or false.');
      if (mand.includes(k) && v === false) throw httpError(400, 'This notification is required for your role and cannot be turned off.');
    }
    db.transaction(() => { for (const [k, v] of Object.entries(b.preferences)) gov.setPref(u.id, k, v); });
    send(ctx.res, 200, { ok: true });
  });

  router.add('GET', '/api/settings/help', ctx => {
    requireRole(ctx, ...WHO);
    // Only values the deployment owner configured are returned. Nothing is invented.
    send(ctx.res, 200, { version, support: process.env.GOACARE_SUPPORT_CONTACT || null, privacyPolicyUrl: process.env.GOACARE_PRIVACY_URL || null, securityContact: process.env.GOACARE_SECURITY_CONTACT || null,
      bugReports: 'Describe the problem to your hospital administrator, or use the "Report suspected tampering" form for security issues.', migrations: gov.migrationStatus().map(m => m.id) });
  });
};
