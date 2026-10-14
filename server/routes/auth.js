'use strict';
// POST /api/auth/register | login | logout   GET /api/auth/me
const db = require('../db');
const ops = require('../ops-db');
const auth = require('../auth');
const { send, fail, readJson, parseCookies, sessionCookie, COOKIE, httpError } = require('../lib/http');
const { requireUser } = require('../lib/router');
const { createThrottle } = require('../lib/throttle');
const { STAFF_ROLES, capsFor } = require('../lib/staff');
const gov = require('../gov-db');
const audit = require('../lib/audit');
const govRoutes = require('./gov');
const onboardThrottle = require('../lib/throttle').createThrottle(5, 60 * 60 * 1000);   // new hospital / doctor registrations per address per hour

const loginThrottle = createThrottle(8, 15 * 60 * 1000);      // 8 failed sign-ins per ID + address
const staffThrottle = createThrottle(6, 15 * 60 * 1000);      // 6 wrong staff codes per address

// Only a coarse address (last part removed) and a short device label are kept with a session: enough to recognise a sign-in, little personal data.
const ipHint = req => String(req.socket.remoteAddress || '').replace(/(\d+)$/, 'x').replace(/(:[0-9a-f]*)$/i, ':x');
function startSession(req, userId) {
  const token = auth.newToken();
  db.createSession(auth.hashToken(token), userId, Date.now() + auth.SESSION_TTL_MS, { userAgent: String(req.headers['user-agent'] || '').slice(0, 120), ipHint: ipHint(req) });
  return sessionCookie(req, token, Math.floor(auth.SESSION_TTL_MS / 1000));
}
const publicUser = u => {
  const f = u.facilityId ? db.getFacility(u.facilityId) : null;
  const d = u.doctorId ? db.getDoctor(u.doctorId) : null;
  return { ...u, facilityName: f ? f.name : d ? d.hospital : null, doctorName: d ? d.name : null, caps: capsFor(u) };
};

module.exports = function (router) {
  router.add('GET', '/api/auth/me', ctx => { const u = requireUser(ctx); send(ctx.res, 200, { user: publicUser(u) }); });

  router.add('POST', '/api/auth/register', async ctx => {
    const { req, res } = ctx;
    const body = await ctx.body();
    const v = auth.validateRegistration(body);
    if (v.error) return fail(res, 400, v.error);

    let facilityId = null, doctorId = null, staffRole = 'manager';
    if (v.role !== 'patient') {
      const key = String(req.socket.remoteAddress);
      if (staffThrottle.blocked(key)) return fail(res, 429, 'Too many wrong staff codes. Please wait 15 minutes.');
      if (!auth.staffCodeOk(body.staffCode)) { staffThrottle.fail(key); return fail(res, 403, 'Staff access code is incorrect. Ask your hospital administrator for the code.'); }
      if (v.role === 'hospital') {
        const f = db.getFacility(String(body.facilityId || ''));
        if (!f) return fail(res, 400, 'Choose the hospital this account manages.');
        facilityId = f.id;
        if (body.staffRole != null && body.staffRole !== '') { if (!STAFF_ROLES.includes(body.staffRole)) return fail(res, 400, 'Choose administrator, nurse, reception, pharmacy or finance.'); staffRole = body.staffRole; }
      } else {
        const d = db.getDoctor(Number(body.doctorId));
        if (!d) return fail(res, 400, 'Choose which doctor you are.');
        doctorId = d.id; facilityId = d.facilityId;
      }
    }
    // Registering a NEW hospital or doctor from the login page: the account and the verification request are created together or not at all.
    // The account is always a plain patient account; staff powers only come from approval. Everything is validated before anything is written.
    let onboard = null;
    const ob = body.onboarding;
    if (ob !== undefined && ob !== null) {
      if (v.role !== 'patient' || typeof ob !== 'object') return fail(res, 400, 'Registration details are not valid.');
      const key = String(req.socket.remoteAddress);
      if (onboardThrottle.blocked(key)) return fail(res, 429, 'Too many registrations from this connection. Please try again later.');
      if (ob.type === 'hospital') onboard = { type: 'hospital', h: govRoutes.parseHospital({ repName: v.name, repPhone: /^\+?\d[\d\s\-().]{4,28}$/.test(v.phone) ? v.phone : '', ...ob }) };
      else if (ob.type === 'doctor') onboard = { type: 'doctor', d: govRoutes.parseDoctor({ fullName: v.name, ...ob }), facilityId: ob.facilityId };
      else return fail(res, 400, 'Choose whether you are registering a hospital or a doctor.');
    }
    if (db.findUserByLogin(v.loginId)) return fail(res, 409, 'An account with this mobile number / Health ID already exists. Please sign in.');
    const { hash, salt } = await auth.hashPassword(body.password);
    let id, submitted = null;
    try {
      id = db.transaction(() => {
        const uid = db.createUser(v.loginId, v.phone, v.name, hash, salt, v.role, facilityId, doctorId, staffRole);
        if (onboard) {
          const u = db.findUserById(uid);
          submitted = onboard.type === 'hospital' ? { type: 'hospital', facilityId: govRoutes.submitHospital(u, onboard.h) } : { type: 'doctor', registrationId: govRoutes.submitDoctor(u, onboard.d, onboard.facilityId) };
        }
        return uid;
      });
    } catch (e) {
      if (e && e.status) throw e;   // e.g. registration number already used: nothing was created
      return fail(res, 409, 'An account with this mobile number / Health ID already exists. Please sign in.');   // lost a race
    }
    if (onboard) onboardThrottle.fail(String(req.socket.remoteAddress));
    const cookie = startSession(req, id);
    send(res, 201, { user: publicUser(db.findUserById(id)), submitted }, { 'Set-Cookie': cookie });
  });

  router.add('POST', '/api/auth/login', async ctx => {
    const { req, res } = ctx;
    const body = await ctx.body();
    const loginId = auth.normaliseLoginId(body.phone);
    const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
    const key = `${req.socket.remoteAddress}|${loginId}`;
    if (loginThrottle.blocked(key)) return fail(res, 429, 'Too many failed attempts. Please wait 15 minutes and try again.');
    const row = loginId ? db.findUserByLogin(loginId) : null;
    const ok = row ? await auth.verifyPassword(password, row.password_hash, row.salt) : (await auth.burnTime(password), false);
    if (!ok) { loginThrottle.fail(key); gov.logLogin(row && row.id, false, ipHint(req), req.headers['user-agent']); return fail(res, 401, 'Incorrect mobile number / Health ID or password.'); }
    if (row.active === 0) { gov.logLogin(row.id, false, ipHint(req), req.headers['user-agent']); return fail(res, 403, 'This account has been deactivated. Contact your hospital administrator.'); }
    loginThrottle.clear(key);
    gov.logLogin(row.id, true, ipHint(req), req.headers['user-agent']);
    const cookie = startSession(req, row.id);
    send(res, 200, { user: publicUser(db.findUserById(row.id)) }, { 'Set-Cookie': cookie });
  });

  // Change your own password. Other sessions are signed out; this one stays.
  router.add('PUT', '/api/auth/password', async ctx => {
    const u = requireUser(ctx), b = await ctx.body();
    const row = ops.passwordHash(u.id);
    if (typeof b.current !== 'string' || !(await auth.verifyPassword(b.current, row.password_hash, row.salt))) return fail(ctx.res, 403, 'Your current password is not correct.');
    if (typeof b.next !== 'string' || b.next.length < 6 || b.next.length > 128) return fail(ctx.res, 400, 'The new password must be at least 6 characters.');
    const { hash, salt } = await auth.hashPassword(b.next);
    ops.setPassword(u.id, hash, salt, auth.hashToken(parseCookies(ctx.req)[COOKIE] || ''));
    audit.append({ actorId: u.id, actorRole: u.role, facilityId: u.facilityId, action: 'password_changed', resourceType: 'staff_account', resourceId: u.id, detail: { otherSessionsSignedOut: true } });
    send(ctx.res, 200, { ok: true });
  });

  router.add('POST', '/api/auth/logout', ctx => {
    const token = parseCookies(ctx.req)[COOKIE];
    if (token) db.deleteSession(auth.hashToken(token));
    send(ctx.res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(ctx.req, '', 0) });
  });
};
module.exports.publicUser = publicUser;
