'use strict';
// GoaCare HTTP server: /api routes + the static client. No npm packages.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
require('./ops-db');   // creates the operational tables (wards, crowd, costs, stores, assets)
require('./gov-db');   // versioned migrations: verification, invitations, approvals, inventory, security
const audit = require('./lib/audit');
const crypto = require('crypto');
const auth = require('./auth');
const metrics = require('./lib/metrics');
const { createRouter } = require('./lib/router');
const { send, fail, readJson, parseCookies, COOKIE } = require('./lib/http');

const CLIENT_DIR = path.resolve(__dirname, '..', 'client');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

const router = createRouter();
['auth', 'directory', 'staff', 'dashboard', 'units', 'ops', 'me', 'admin', 'gov', 'audit', 'inventory', 'settings', 'reports', 'chat'].forEach(name => require('./routes/' + name)(router));

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  return token ? db.findUserBySession(auth.hashToken(token)) : null;
}

// Denied / cross-hospital attempts by a signed-in user are written to the audit chain (throttled so a script cannot flood it).
const recentDenials = new Map();
function recordDenied(user, req, url, e) {
  const action = e.audit || 'unauthorized_action', key = `${user.id}|${action}|${req.method} ${url.pathname}`, now = Date.now();
  if (recentDenials.size > 2000) recentDenials.clear();
  if (now - (recentDenials.get(key) || 0) < 10000) return;
  recentDenials.set(key, now);
  audit.recordFailure(user, { action, resourceType: 'request', resourceId: `${req.method} ${url.pathname}`, outcome: 'blocked', reason: e.error, detail: { status: e.status } });
}

async function handleApi(req, res, url) {
  const started = process.hrtime.bigint();
  const found = router.match(req.method, url.pathname);
  const idem = String(req.headers['idempotency-key'] || '').slice(0, 80) || null;
  return audit.withContext({ requestId: crypto.randomUUID(), idem, ip: String(req.socket.remoteAddress || ''), ua: String(req.headers['user-agent'] || '') }, async () => {
    let user = null;
    try {
      if (!found) return fail(res, router.routes.some(r => r.rx.test(url.pathname)) ? 405 : 404, 'Not found.');
      user = currentUser(req);
      const ctx = { req, res, params: found.params, query: url.searchParams, user, body: (max) => readJson(req, max) };
      await found.handler(ctx);
    } catch (e) {
      if (e && e.status) {
        if (user && (e.status === 403 || e.audit)) recordDenied(user, req, url, e);
        return fail(res, e.status, e.error, e.extra);
      }
      console.error(e);
      fail(res, 500, 'Server error.');
    } finally {
      if (url.pathname === '/api/facilities' || url.pathname === '/api/doctors') metrics.record(Number(process.hrtime.bigint() - started) / 1e6);
    }
  });
}

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
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' };
    if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self)');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    serveStatic(req, res, url.pathname);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  // Hosting platforms (Render, Railway, Fly...) set PORT and need the server reachable from outside, so listen on all interfaces there.
  const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
  db.purgeExpiredSessions();
  setInterval(() => db.purgeExpiredSessions(), 60 * 60 * 1000).unref();
  setInterval(() => { try { audit.checkpoint(null); } catch (e) { console.error('audit checkpoint failed', e.message); } }, 60 * 60 * 1000).unref();
  createServer().listen(port, host, () => {
    console.log(`GoaCare running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (!process.env.GOACARE_STAFF_CODE) {
      if (process.env.NODE_ENV === 'production') console.log('Staff sign-up is CLOSED: set GOACARE_STAFF_CODE to allow doctor / hospital accounts.');
      else console.log(`Staff sign-up code (DEMO default): ${auth.DEMO_STAFF_CODE}   <- set GOACARE_STAFF_CODE before any real deployment`);
    }
  });
}

module.exports = { createServer };
