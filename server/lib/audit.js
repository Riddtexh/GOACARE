'use strict';
// Immutable audit history: an append-only, hash-chained event store.
//   * Every event gets a server-generated id + timestamp, the actor id and role taken from the authenticated session (never from the client),
//     the hospital, action, resource, before / after values, outcome, a request (correlation) id, and prev_hash + hash.
//   * hash = SHA-256(prev_hash + "\n" + canonical JSON of the event content). verify() recomputes the whole chain and reports modified,
//     missing and reordered events, and compares it with checkpoints (database table + a separate append-only anchor file).
//   * UPDATE and DELETE on audit tables are refused by database triggers. The application exposes no edit / delete route.
// LIMITS (also in docs/GOVERNANCE.md): SQLite has no per-table privileges, so anyone who can open the database file as the same OS user
// can drop the triggers and rewrite the whole chain. A hash chain alone cannot prevent that. The anchor file (GOACARE_AUDIT_ANCHOR) and the
// optional HMAC key (GOACARE_AUDIT_KEY) only help if they are stored somewhere the application user cannot rewrite (WORM bucket, another host).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const db = require('../db');
const raw = db.raw;

const als = new AsyncLocalStorage();
const GENESIS = '0'.repeat(64);
const dataDir = process.env.GOACARE_DATA_DIR || path.join(__dirname, '..', 'data');
const anchorFile = () => process.env.GOACARE_AUDIT_ANCHOR || path.join(dataDir, 'audit-anchor.log');

raw.exec(`
  CREATE TABLE IF NOT EXISTS audit_events (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id        TEXT NOT NULL UNIQUE,
    ts              TEXT NOT NULL,
    actor_id        INTEGER,
    actor_role      TEXT NOT NULL,
    facility_id     TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT,
    outcome         TEXT NOT NULL CHECK (outcome IN ('success','failure','blocked')),
    before_json     TEXT,
    after_json      TEXT,
    detail_json     TEXT NOT NULL DEFAULT '{}',
    reason          TEXT,
    request_id      TEXT,
    idempotency_key TEXT UNIQUE,
    prev_hash       TEXT NOT NULL,
    hash            TEXT NOT NULL UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_audit_ev_fac ON audit_events(facility_id, seq);
  CREATE INDEX IF NOT EXISTS idx_audit_ev_actor ON audit_events(actor_id, seq);
  CREATE INDEX IF NOT EXISTS idx_audit_ev_action ON audit_events(action, seq);
  CREATE TABLE IF NOT EXISTS audit_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, upto_seq INTEGER NOT NULL, event_count INTEGER NOT NULL, head_hash TEXT NOT NULL,
    mac TEXT, created_at TEXT NOT NULL, created_by INTEGER);
  CREATE TABLE IF NOT EXISTS audit_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT NOT NULL, ok INTEGER NOT NULL, events_checked INTEGER NOT NULL,
    head_hash TEXT, problems TEXT NOT NULL DEFAULT '[]', run_by INTEGER);
  CREATE TABLE IF NOT EXISTS security_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, facility_id TEXT, summary TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, resolved_at TEXT, resolved_by INTEGER);
  CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_ckpt_no_update BEFORE UPDATE ON audit_checkpoints BEGIN SELECT RAISE(ABORT, 'audit checkpoints are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_ckpt_no_delete BEFORE DELETE ON audit_checkpoints BEGIN SELECT RAISE(ABORT, 'audit checkpoints are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_ver_no_update BEFORE UPDATE ON audit_verifications BEGIN SELECT RAISE(ABORT, 'audit verification records are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_ver_no_delete BEFORE DELETE ON audit_verifications BEGIN SELECT RAISE(ABORT, 'audit verification records are append-only'); END;
`);

// ---------- request context (request id, client hint, optional Idempotency-Key header) ----------
const withContext = (info, fn) => als.run(info, fn);
const context = () => als.getStore() || {};

// ---------- canonical form + hashing ----------
const canon = v => {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
};
const content = r => ({
  event_id: r.event_id, ts: r.ts, actor_id: r.actor_id == null ? null : r.actor_id, actor_role: r.actor_role, facility_id: r.facility_id || null, action: r.action,
  resource_type: r.resource_type, resource_id: r.resource_id == null ? null : r.resource_id, outcome: r.outcome,
  before: r.before_json == null ? null : JSON.parse(r.before_json), after: r.after_json == null ? null : JSON.parse(r.after_json), detail: JSON.parse(r.detail_json || '{}'),
  reason: r.reason || null, request_id: r.request_id || null, idempotency_key: r.idempotency_key || null
});
const hashOf = (prevHash, row) => crypto.createHash('sha256').update(prevHash + '\n' + canon(content(row))).digest('hex');

// ---------- data minimisation: never store secrets or long free text in audit payloads ----------
const SECRET = /pass(word)?|token|secret|salt|hash|cookie|authorization|otp|pin$/i;
function clean(v, depth = 0) {
  if (v == null || depth > 6) return v == null ? null : '[truncated]';
  if (typeof v === 'string') return v.length > 500 ? v.slice(0, 500) + '…' : v;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => clean(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET.test(k) ? '[redacted]' : clean(x, depth + 1);
  return out;
}
const json = v => { if (v == null) return null; const s = JSON.stringify(clean(v)); return s.length > 8000 ? JSON.stringify({ truncated: true }) : s; };

// The existing code records changes as detail = { free: { icu: [old, new] }, status: [old, new], from, to, before, after }. Split into before / after.
const pair = v => Array.isArray(v) && v.length === 2 && v.every(x => x === null || ['string', 'number', 'boolean'].includes(typeof x));
function splitDetail(d) {
  d = d || {};
  if (d.before !== undefined || d.after !== undefined) { const { before, after, ...rest } = d; return { before: before === undefined ? null : before, after: after === undefined ? null : after, detail: rest }; }
  const before = {}, after = {}, rest = {}; let found = false;
  for (const [k, v] of Object.entries(d)) {
    if ((k === 'free' || k === 'capacity') && v && typeof v === 'object') { for (const [kk, vv] of Object.entries(v)) if (pair(vv)) { before[k + '.' + kk] = vv[0]; after[k + '.' + kk] = vv[1]; found = true; } }
    else if (['status', 'room', 'duty', 'appointments'].includes(k) && pair(v)) { before[k] = v[0]; after[k] = v[1]; found = true; }
    else rest[k] = v;
  }
  if (d.from !== undefined && d.to !== undefined) { before.value = d.from; after.value = d.to; delete rest.from; delete rest.to; found = true; }
  return found ? { before, after, detail: rest } : { before: null, after: null, detail: d };
}

const lastRow = raw.prepare('SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1');
const byIdem = raw.prepare('SELECT 1 AS x FROM audit_events WHERE idempotency_key = ?');
const ins = raw.prepare(`INSERT INTO audit_events (event_id, ts, actor_id, actor_role, facility_id, action, resource_type, resource_id, outcome, before_json, after_json, detail_json, reason, request_id, idempotency_key, prev_hash, hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

// Append one event. Inside a business transaction it commits or rolls back with it; outside one it opens its own.
// idempotencyKey: a retried operation with the same key is recorded once.
function append(e) {
  const run = () => {
    if (e.idempotencyKey && byIdem.get(e.idempotencyKey)) return null;
    const last = lastRow.get(), prev = last ? last.hash : GENESIS, ctx = context();
    const row = {
      event_id: crypto.randomUUID(), ts: new Date().toISOString(), actor_id: e.actorId == null ? null : e.actorId, actor_role: e.actorRole || 'anonymous',
      facility_id: e.facilityId || null, action: String(e.action).slice(0, 80), resource_type: String(e.resourceType || 'system').slice(0, 60), resource_id: e.resourceId == null ? null : String(e.resourceId).slice(0, 120),
      outcome: e.outcome || 'success', before_json: json(e.before), after_json: json(e.after), detail_json: json(e.detail || {}) || '{}',
      reason: e.reason ? String(e.reason).slice(0, 500) : null, request_id: ctx.requestId || null, idempotency_key: e.idempotencyKey || null
    };
    // The stored text is what gets hashed, so re-reading it later reproduces the same hash.
    const hash = hashOf(prev, row);
    ins.run(row.event_id, row.ts, row.actor_id, row.actor_role, row.facility_id, row.action, row.resource_type, row.resource_id, row.outcome, row.before_json, row.after_json, row.detail_json, row.reason, row.request_id, row.idempotency_key, prev, hash);
    return row.event_id;
  };
  return db.inTransaction() ? run() : db.transaction(run);
}

function fromActivity(actor, e) {
  const s = splitDetail(e.detail);
  return append({ actorId: actor.id, actorRole: actor.role === 'hospital' && actor.staffRole ? 'hospital:' + actor.staffRole : actor.role, facilityId: e.facilityId, action: e.action, resourceType: e.entityType, resourceId: e.entityId,
    before: s.before, after: s.after, detail: s.detail, reason: e.reason, idempotencyKey: e.idempotencyKey, outcome: e.outcome });
}
// Failures and blocked attempts are recorded on their own (the business transaction did not commit).
function recordFailure(user, e) {
  try {
    return append({ actorId: user ? user.id : null, actorRole: user ? (user.role === 'hospital' && user.staffRole ? 'hospital:' + user.staffRole : user.role) : 'anonymous', facilityId: e.facilityId || (user && user.facilityId) || null,
      action: e.action, resourceType: e.resourceType || 'request', resourceId: e.resourceId, outcome: e.outcome || 'blocked', detail: e.detail, reason: e.reason, idempotencyKey: e.idempotencyKey });
  } catch (err) { console.error('audit failure record failed', err.message); return null; }
}

// ---------- reading ----------
const view = r => ({
  seq: r.seq, id: r.event_id, at: r.ts, actorId: r.actor_id, actorRole: r.actor_role, facilityId: r.facility_id, action: r.action, resourceType: r.resource_type, resourceId: r.resource_id,
  outcome: r.outcome, before: r.before_json == null ? null : JSON.parse(r.before_json), after: r.after_json == null ? null : JSON.parse(r.after_json), detail: JSON.parse(r.detail_json || '{}'),
  reason: r.reason, requestId: r.request_id, prevHash: r.prev_hash, hash: r.hash
});
// scope: { facilityId?, actorId? } are forced by the route from the signed-in user; f carries the user's optional filters. Values are bound parameters.
function list(scope, f = {}, { limit = 25, offset = 0 } = {}) {
  const where = [], args = [];
  const add = (sql, ...a) => { where.push(sql); args.push(...a); };
  if (scope.facilityId) add('facility_id = ?', scope.facilityId);
  if (scope.actorId) add('actor_id = ?', scope.actorId);
  if (f.facilityId && !scope.facilityId) add('facility_id = ?', f.facilityId);
  if (f.actorId && !scope.actorId) add('actor_id = ?', Number(f.actorId));
  if (f.action) add('action = ?', f.action);
  if (f.resourceType) add('resource_type = ?', f.resourceType);
  if (f.outcome) add('outcome = ?', f.outcome);
  if (f.from) add('ts >= ?', f.from);
  if (f.to) add('ts <= ?', f.to.length === 10 ? f.to + 'T23:59:59.999Z' : f.to);
  if (f.q) { const like = '%' + String(f.q).replace(/[\\%_]/g, c => '\\' + c) + '%'; add("(action LIKE ? ESCAPE '\\' OR resource_id LIKE ? ESCAPE '\\' OR detail_json LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\')", like, like, like, like); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = raw.prepare(`SELECT COUNT(*) AS n FROM audit_events ${w}`).get(...args).n;
  const items = raw.prepare(`SELECT * FROM audit_events ${w} ORDER BY seq DESC LIMIT ? OFFSET ?`).all(...args, limit, offset).map(view);
  return { total, items };
}
const get = id => { const r = raw.prepare('SELECT * FROM audit_events WHERE event_id = ?').get(id); return r ? view(r) : null; };
const actions = scope => raw.prepare(`SELECT DISTINCT action FROM audit_events ${scope.facilityId ? 'WHERE facility_id = ?' : ''} ORDER BY action`).all(...(scope.facilityId ? [scope.facilityId] : [])).map(r => r.action);

// ---------- checkpoints + verification ----------
const macOf = (seq, count, head) => process.env.GOACARE_AUDIT_KEY ? crypto.createHmac('sha256', process.env.GOACARE_AUDIT_KEY).update(`${seq}|${count}|${head}`).digest('hex') : null;
function checkpoint(userId) {
  return db.transaction(() => {
    const last = lastRow.get(); if (!last) return null;
    const count = raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, at = new Date().toISOString(), mac = macOf(last.seq, count, last.hash);
    raw.prepare('INSERT INTO audit_checkpoints (upto_seq, event_count, head_hash, mac, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(last.seq, count, last.hash, mac, at, userId || null);
    try { fs.appendFileSync(anchorFile(), JSON.stringify({ seq: last.seq, count, head: last.hash, mac, at }) + '\n', { mode: 0o640 }); } catch (e) { console.error('audit anchor write failed:', e.message); }
    return { seq: last.seq, count, head: last.hash, at, signed: !!mac };
  });
}
function verifyChain() {
  const problems = []; let prev = GENESIS, lastSeq = 0, count = 0, head = null;
  const bySeq = new Map();
  for (const r of raw.prepare('SELECT * FROM audit_events ORDER BY seq').iterate()) {
    count++; bySeq.set(r.seq, r.hash);
    if (r.seq !== lastSeq + 1) problems.push({ type: 'missing', seq: r.seq, detail: `event(s) ${lastSeq + 1}–${r.seq - 1} are missing` });
    const expect = hashOf(r.prev_hash, r);
    if (expect !== r.hash) problems.push({ type: 'modified', seq: r.seq, detail: 'stored hash does not match the event content' });
    if (r.prev_hash !== prev) problems.push({ type: r.seq === lastSeq + 1 ? 'reordered' : 'chain_break', seq: r.seq, detail: 'previous-hash link does not match the preceding event' });
    prev = r.hash; lastSeq = r.seq; head = r.hash;
  }
  // checkpoints (table) and anchors (separate file): the head recorded then must still be in the chain
  const cps = raw.prepare('SELECT * FROM audit_checkpoints ORDER BY id').all();
  for (const c of cps) {
    if (bySeq.get(c.upto_seq) !== c.head_hash) problems.push({ type: 'checkpoint_mismatch', seq: c.upto_seq, detail: 'the chain no longer matches a recorded checkpoint (events changed, removed or truncated)' });
    if (c.mac && process.env.GOACARE_AUDIT_KEY && macOf(c.upto_seq, c.event_count, c.head_hash) !== c.mac) problems.push({ type: 'checkpoint_forged', seq: c.upto_seq, detail: 'checkpoint signature is invalid' });
  }
  let anchors = 0, anchorProblem = null;
  try {
    const lines = fs.readFileSync(anchorFile(), 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      let a; try { a = JSON.parse(l); } catch (e) { problems.push({ type: 'anchor_unreadable', detail: 'an anchor line cannot be read' }); continue; }
      anchors++;
      if (bySeq.get(a.seq) !== a.head) problems.push({ type: 'anchor_mismatch', seq: a.seq, detail: 'the chain no longer matches the externally stored anchor' });
      if (a.mac && process.env.GOACARE_AUDIT_KEY && macOf(a.seq, a.count, a.head) !== a.mac) problems.push({ type: 'anchor_forged', seq: a.seq, detail: 'anchor signature is invalid' });
    }
  } catch (e) { if (e.code !== 'ENOENT') anchorProblem = e.message; }
  return { ok: problems.length === 0, eventsChecked: count, headHash: head, checkpoints: cps.length, anchors, anchorFileUnavailable: anchorProblem, signed: !!process.env.GOACARE_AUDIT_KEY, problems };
}
// Runs verification, stores the result (append-only), writes an audit event and raises a security alert on failure.
function verify(user) {
  const r = verifyChain(), at = new Date().toISOString();
  db.transaction(() => {
    raw.prepare('INSERT INTO audit_verifications (ran_at, ok, events_checked, head_hash, problems, run_by) VALUES (?, ?, ?, ?, ?, ?)').run(at, r.ok ? 1 : 0, r.eventsChecked, r.headHash, JSON.stringify(r.problems.slice(0, 50)), user ? user.id : null);
    append({ actorId: user ? user.id : null, actorRole: user ? user.role : 'system', action: r.ok ? 'audit_integrity_verified' : 'audit_integrity_failed', resourceType: 'audit', outcome: r.ok ? 'success' : 'failure',
      detail: { eventsChecked: r.eventsChecked, problems: r.problems.slice(0, 10).map(p => p.type + '@' + p.seq) } });
    if (!r.ok) raw.prepare("INSERT INTO security_alerts (kind, facility_id, summary, detail, created_at) VALUES ('audit_integrity_failed', NULL, ?, ?, ?)").run(`Audit verification found ${r.problems.length} problem(s).`, JSON.stringify(r.problems.slice(0, 10)), at);
  });
  if (r.ok) { try { checkpoint(user && user.id); } catch (e) { /* checkpoint is best effort */ } }
  return { ...r, ranAt: at };
}
const latestVerification = () => { const r = raw.prepare('SELECT * FROM audit_verifications ORDER BY id DESC LIMIT 1').get(); return r ? { ranAt: r.ran_at, ok: !!r.ok, eventsChecked: r.events_checked, problems: JSON.parse(r.problems) } : null; };
const latestCheckpoint = () => { const r = raw.prepare('SELECT * FROM audit_checkpoints ORDER BY id DESC LIMIT 1').get(); return r ? { at: r.created_at, upToSeq: r.upto_seq, events: r.event_count, signed: !!r.mac } : null; };

module.exports = { GENESIS, withContext, context, append, fromActivity, recordFailure, list, get, actions, checkpoint, verifyChain, verify, latestVerification, latestCheckpoint, splitDetail, canon, hashOf };
