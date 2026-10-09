'use strict';
// GoaCare HTTP server: /api routes + the static client. No npm packages.
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
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
['auth', 'directory', 'staff', 'me', 'admin'].forEach(name => require('./routes/' + name)(router));

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  return token ? db.findUserBySession(auth.hashToken(token)) : null;
}

async function handleApi(req, res, url) {
  const started = process.hrtime.bigint();
  const found = router.match(req.method, url.pathname);
  try {
    if (!found) return fail(res, router.routes.some(r => r.rx.test(url.pathname)) ? 405 : 404, 'Not found.');
    const ctx = { req, res, params: found.params, query: url.searchParams, user: currentUser(req), body: () => readJson(req) };
    await found.handler(ctx);
  } catch (e) {
    if (e && e.status) return fail(res, e.status, e.error, e.extra);
    console.error(e);
    fail(res, 500, 'Server error.');
  } finally {
    if (url.pathname === '/api/facilities' || url.pathname === '/api/doctors') metrics.record(Number(process.hrtime.bigint() - started) / 1e6);
  }
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
  const host = process.env.HOST || '127.0.0.1';
  db.purgeExpiredSessions();
  setInterval(() => db.purgeExpiredSessions(), 60 * 60 * 1000).unref();
  createServer().listen(port, host, () => {
    console.log(`GoaCare running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (!process.env.GOACARE_STAFF_CODE) console.log(`Staff sign-up code (DEMO default): ${auth.DEMO_STAFF_CODE}   <- set GOACARE_STAFF_CODE before any real deployment`);
  });
}

module.exports = { createServer };
