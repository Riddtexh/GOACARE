'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

const CLIENT_DIR = path.resolve(__dirname, '..', 'client');
const COOKIE = 'gc_session';
const MAX_BODY = 10 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isJson = body !== null && typeof body === 'object';
  const payload = body === null ? '' : isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(payload);
}
const fail = (res, status, error, headers) => send(res, status, { error }, headers);

// JSON with an ETag: unchanged data answers "304 Not Modified" so frequent polling costs almost nothing.
function sendCached(req, res, body) {
  const json = JSON.stringify(body);
  const etag = 'W/"' + crypto.createHash('sha1').update(json).digest('base64url') + '"';
  const headers = { ETag: etag, 'Cache-Control': 'no-cache', 'Content-Type': 'application/json; charset=utf-8' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject({ status: 415, error: 'Content-Type must be application/json.' });
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject({ status: 413, error: 'Request too large.' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { reject({ status: 400, error: 'Invalid JSON.' }); }
    });
    req.on('error', () => reject({ status: 400, error: 'Bad request.' }));
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isSecure(req) {
  return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
}
function sessionCookie(req, token, maxAgeSec) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${isSecure(req) ? '; Secure' : ''}`;
}
function startSession(req, res, userId) {
  const token = auth.newToken();
  db.createSession(auth.hashToken(token), userId, Date.now() + auth.SESSION_TTL_MS);
  return sessionCookie(req, token, Math.floor(auth.SESSION_TTL_MS / 1000));
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  return token ? db.findUserBySession(auth.hashToken(token)) : null;
}

// Login throttling: 8 failed attempts per ID + IP in 15 minutes.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 8;
function throttled(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) { attempts.delete(key); return false; }
  return a.count >= MAX_FAILS;
}
function recordFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

// ---------- API ----------
async function handleApi(req, res, pathname) {
  const route = `${req.method} ${pathname}`;
  try {
    if (route === 'GET /api/health') return send(res, 200, { ok: true });

    // Public, read-only directory data (guests can browse it too). Clients poll these to stay live.
    if (route === 'GET /api/facilities') return sendCached(req, res, { facilities: db.listFacilities() });
    if (route === 'GET /api/doctors') return sendCached(req, res, { doctors: db.listDoctors() });

    if (route === 'GET /api/auth/me') {
      const user = currentUser(req);
      return user ? send(res, 200, { user }) : fail(res, 401, 'Not signed in.');
    }

    if (route === 'POST /api/auth/register') {
      const body = await readJson(req);
      const v = auth.validateRegistration(body);
      if (v.error) return fail(res, 400, v.error);
      if (db.findUserByLogin(v.loginId)) return fail(res, 409, 'An account with this mobile number / Health ID already exists. Please sign in.');
      const { hash, salt } = await auth.hashPassword(body.password);
      let id;
      try { id = Number(db.createUser(v.loginId, v.phone, v.name, hash, salt)); }
      catch (e) { return fail(res, 409, 'An account with this mobile number / Health ID already exists. Please sign in.'); } // lost a race
      const cookie = startSession(req, res, id);
      return send(res, 201, { user: { id, name: v.name, phone: v.phone } }, { 'Set-Cookie': cookie });
    }

    if (route === 'POST /api/auth/login') {
      const body = await readJson(req);
      const loginId = auth.normaliseLoginId(body.phone);
      const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
      const key = `${req.socket.remoteAddress}|${loginId}`;
      if (throttled(key)) return fail(res, 429, 'Too many failed attempts. Please wait 15 minutes and try again.');
      const row = loginId ? db.findUserByLogin(loginId) : null;
      const ok = row ? await auth.verifyPassword(password, row.password_hash, row.salt) : (await auth.burnTime(password), false);
      if (!ok) { recordFail(key); return fail(res, 401, 'Incorrect mobile number / Health ID or password.'); }
      attempts.delete(key);
      const cookie = startSession(req, res, row.id);
      return send(res, 200, { user: { id: row.id, name: row.name, phone: row.phone } }, { 'Set-Cookie': cookie });
    }

    if (route === 'POST /api/auth/logout') {
      const token = parseCookies(req)[COOKIE];
      if (token) db.deleteSession(auth.hashToken(token));
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }

    return fail(res, 404, 'Not found.');
  } catch (e) {
    if (e && e.status) return fail(res, e.status, e.error);
    console.error(e);
    return fail(res, 500, 'Server error.');
  }
}

// ---------- static client ----------
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return send(res, 400, 'Bad request'); }
  if (rel.includes('\0')) return send(res, 400, 'Bad request');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(CLIENT_DIR, '.' + rel);
  if (file !== CLIENT_DIR && !file.startsWith(CLIENT_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    serveStatic(req, res, pathname);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  db.purgeExpiredSessions();
  setInterval(() => db.purgeExpiredSessions(), 60 * 60 * 1000).unref();
  createServer().listen(port, host, () => console.log(`GoaCare running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
}

module.exports = { createServer };
