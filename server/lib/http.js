'use strict';
// Small HTTP helpers shared by every route module.
const crypto = require('crypto');

const COOKIE = 'gc_session';

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
const fail = (res, status, error, extra = {}) => send(res, status, { error, ...extra });

// JSON with an ETag: unchanged data answers 304 so frequent polling costs almost nothing.
function sendCached(req, res, body) {
  const json = JSON.stringify(body);
  const etag = 'W/"' + crypto.createHash('sha1').update(json).digest('base64url') + '"';
  const headers = { ETag: etag, 'Cache-Control': 'no-cache', 'Content-Type': 'application/json; charset=utf-8' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, headers);
  res.end(json);
}

function readJson(req, maxBytes = 10 * 1024) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject({ status: 415, error: 'Content-Type must be application/json.' });
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { reject({ status: 413, error: 'Request too large.' }); req.destroy(); return; }
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
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* ignore bad cookie */ } }
  });
  return out;
}
const isSecure = req => process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
const sessionCookie = (req, token, maxAgeSec) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${isSecure(req) ? '; Secure' : ''}`;

// Errors thrown by route code: throw httpError(403, '...') and the router turns it into a JSON response.
const httpError = (status, error, extra) => Object.assign(new Error(error), { status, error, extra });

// Date helpers in Goa time (IST), so "today" is the same for the server and the people using the app.
const istParts = (d = new Date()) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
};
const todayIST = () => istParts().date;

module.exports = { COOKIE, send, fail, sendCached, readJson, parseCookies, sessionCookie, httpError, istParts, todayIST };
