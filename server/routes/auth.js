'use strict';
// POST /api/auth/register | login | logout   GET /api/auth/me
const db = require('../db');
const auth = require('../auth');
const { send, fail, readJson, parseCookies, sessionCookie, COOKIE, httpError } = require('../lib/http');
const { requireUser } = require('../lib/router');
const { createThrottle } = require('../lib/throttle');

const loginThrottle = createThrottle(8, 15 * 60 * 1000);      // 8 failed sign-ins per ID + address
const staffThrottle = createThrottle(6, 15 * 60 * 1000);      // 6 wrong staff codes per address

function startSession(req, userId) {
  const token = auth.newToken();
  db.createSession(auth.hashToken(token), userId, Date.now() + auth.SESSION_TTL_MS);
  return sessionCookie(req, token, Math.floor(auth.SESSION_TTL_MS / 1000));
}
const publicUser = u => {
  const f = u.facilityId ? db.getFacility(u.facilityId) : null;
  const d = u.doctorId ? db.getDoctor(u.doctorId) : null;
  return { ...u, facilityName: f ? f.name : d ? d.hospital : null, doctorName: d ? d.name : null };
};

module.exports = function (router) {
  router.add('GET', '/api/auth/me', ctx => { const u = requireUser(ctx); send(ctx.res, 200, { user: publicUser(u) }); });

  router.add('POST', '/api/auth/register', async ctx => {
    const { req, res } = ctx;
    const body = await ctx.body();
    const v = auth.validateRegistration(body);
    if (v.error) return fail(res, 400, v.error);

    let facilityId = null, doctorId = null;
    if (v.role !== 'patient') {
      const key = String(req.socket.remoteAddress);
      if (staffThrottle.blocked(key)) return fail(res, 429, 'Too many wrong staff codes. Please wait 15 minutes.');
      if (!auth.staffCodeOk(body.staffCode)) { staffThrottle.fail(key); return fail(res, 403, 'Staff access code is incorrect. Ask your hospital administrator for the code.'); }
      if (v.role === 'hospital') {
        const f = db.getFacility(String(body.facilityId || ''));
        if (!f) return fail(res, 400, 'Choose the hospital this account manages.');
        facilityId = f.id;
      } else {
        const d = db.getDoctor(Number(body.doctorId));
        if (!d) return fail(res, 400, 'Choose which doctor you are.');
        doctorId = d.id; facilityId = d.facilityId;
      }
    }
    if (db.findUserByLogin(v.loginId)) return fail(res, 409, 'An account with this mobile number / Health ID already exists. Please sign in.');
    const { hash, salt } = await auth.hashPassword(body.password);
    let id;
    try { id = db.createUser(v.loginId, v.phone, v.name, hash, salt, v.role, facilityId, doctorId); }
    catch (e) { return fail(res, 409, 'An account with this mobile number / Health ID already exists. Please sign in.'); }   // lost a race
    const cookie = startSession(req, id);
    send(res, 201, { user: publicUser(db.findUserById(id)) }, { 'Set-Cookie': cookie });
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
    if (!ok) { loginThrottle.fail(key); return fail(res, 401, 'Incorrect mobile number / Health ID or password.'); }
    loginThrottle.clear(key);
    const cookie = startSession(req, row.id);
    send(res, 200, { user: publicUser(db.findUserById(row.id)) }, { 'Set-Cookie': cookie });
  });

  router.add('POST', '/api/auth/logout', ctx => {
    const token = parseCookies(ctx.req)[COOKIE];
    if (token) db.deleteSession(auth.hashToken(token));
    send(ctx.res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(ctx.req, '', 0) });
  });
};
module.exports.publicUser = publicUser;
