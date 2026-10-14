'use strict';
// Tamper detection for the audit chain. A privileged attacker is simulated with a SECOND database connection that drops the protective
// triggers and rewrites the data directly. The chain must notice modified, missing, reordered and truncated events.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-audit-'));
process.env.GOACARE_DATA_DIR = dir;
const db = require('../db');
require('../gov-db');
const audit = require('../lib/audit');

const add = (n, extra = {}) => { for (let i = 0; i < n; i++) audit.append({ actorId: 1, actorRole: 'admin', facilityId: 'f' + (i % 2), action: 'test_event', resourceType: 'thing', resourceId: i, before: { v: i }, after: { v: i + 1 }, ...extra }); };
const attacker = () => { const c = new DatabaseSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.db')))); c.exec('DROP TRIGGER IF EXISTS audit_events_no_update; DROP TRIGGER IF EXISTS audit_events_no_delete;'); return c; };

test('a clean chain verifies, has trusted server metadata, and links each event to the previous hash', () => {
  assert.equal(audit.verifyChain().ok, true);
  add(10);
  const items = audit.list({}, {}, { limit: 50 }).items.reverse();
  assert.equal(items[0].prevHash, audit.GENESIS);
  items.forEach((e, i) => { if (i) assert.equal(e.prevHash, items[i - 1].hash); assert.ok(/^[0-9a-f-]{36}$/.test(e.id) && /^\d{4}-\d\d-\d\dT/.test(e.at) && e.hash.length === 64); });
  assert.equal(audit.verifyChain().ok, true);
  assert.equal(audit.canon({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}', 'canonical form is key-order independent');
});

test('modified event: detected', () => {
  add(3); audit.checkpoint(1);
  const a = attacker(); a.prepare("UPDATE audit_events SET after_json = '{\"v\":999}' WHERE seq = 4").run(); a.close();
  const r = audit.verifyChain();
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => p.type === 'modified' && p.seq === 4));
  // the failure is stored, appears as an audit event and raises an alert
  const v = audit.verify({ id: 1, role: 'admin' });
  assert.equal(v.ok, false);
  assert.equal(audit.latestVerification().ok, false);
  assert.ok(audit.list({}, { action: 'audit_integrity_failed' }).total >= 1);
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS n FROM security_alerts WHERE kind = 'audit_integrity_failed'").get().n >= 1);
});

test('rewriting one event and fixing only its own hash is caught by the next link', () => {
  const a = attacker();
  const row = a.prepare('SELECT * FROM audit_events WHERE seq = 4').get();
  a.prepare("UPDATE audit_events SET after_json = '{\"v\":999}' WHERE seq = 4").run();
  a.prepare('UPDATE audit_events SET hash = ? WHERE seq = 4').run(audit.hashOf(row.prev_hash, { ...row, after_json: '{"v":999}' })); a.close();
  const r = audit.verifyChain();
  assert.ok(r.problems.some(p => p.seq === 5 && (p.type === 'chain_break' || p.type === 'reordered')), 'the following event no longer links');
});

test('rewriting the WHOLE chain from the edit onwards (privileged attacker) is caught by the earlier checkpoint and the anchor file', () => {
  const a = attacker();
  let prev = a.prepare('SELECT hash FROM audit_events WHERE seq = 3').get().hash;
  for (const row of a.prepare('SELECT * FROM audit_events WHERE seq >= 4 ORDER BY seq').all()) {
    const edited = row.seq === 4 ? { ...row, after_json: '{"v":1234}' } : row;
    const h = audit.hashOf(prev, { ...edited, prev_hash: prev });
    a.prepare('UPDATE audit_events SET after_json = ?, prev_hash = ?, hash = ? WHERE seq = ?').run(edited.after_json, prev, h, row.seq); prev = h;
  }
  a.close();
  const r = audit.verifyChain();
  assert.ok(!r.problems.some(p => p.type === 'modified' || p.type === 'chain_break'), 'the rewritten chain is internally consistent - a hash chain alone cannot see this');
  assert.ok(r.problems.some(p => p.type === 'checkpoint_mismatch'), 'but the checkpoint recorded earlier no longer matches');
  assert.ok(r.problems.some(p => p.type === 'anchor_mismatch'), 'and neither does the anchor file');
});

test('missing and reordered events: detected (fresh chain)', () => {
  const a = attacker();
  a.exec('DELETE FROM audit_events'); a.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_events'");
  try { a.exec('DROP TRIGGER IF EXISTS audit_ckpt_no_delete; DELETE FROM audit_checkpoints;'); } catch (e) { /* ignore */ }
  a.close(); fs.rmSync(path.join(dir, 'audit-anchor.log'), { force: true });
  add(8);
  assert.equal(audit.verifyChain().ok, true, 'clean again');
  let c = attacker(); c.prepare('DELETE FROM audit_events WHERE seq = 4').run(); c.close();
  let r = audit.verifyChain();
  assert.ok(r.problems.some(p => p.type === 'missing' && p.seq === 5), 'a deleted event leaves a gap');
  assert.ok(r.problems.some(p => p.type === 'chain_break'));
  // reorder: swap two events' positions by exchanging their sequence numbers
  c = attacker(); c.exec('DELETE FROM audit_events'); c.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_events'"); c.close();
  add(6);
  c = attacker();
  c.exec('UPDATE audit_events SET seq = -2 WHERE seq = 2; UPDATE audit_events SET seq = 2 WHERE seq = 3; UPDATE audit_events SET seq = 3 WHERE seq = -2;'); c.close();
  r = audit.verifyChain();
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => p.type === 'reordered' || p.type === 'chain_break'));
});

test('truncation of the newest events is caught by a checkpoint and by the separately stored anchor', () => {
  let c = attacker(); c.exec('DELETE FROM audit_events'); c.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_events'"); c.close();
  fs.rmSync(path.join(dir, 'audit-anchor.log'), { force: true });
  add(6); const ck = audit.checkpoint(1);
  assert.equal(ck.count, 6);
  assert.equal(audit.verifyChain().ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'audit-anchor.log')));
  c = attacker(); c.prepare('DELETE FROM audit_events WHERE seq > 3').run(); c.close();
  const r = audit.verifyChain();
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => p.type === 'checkpoint_mismatch') && r.problems.some(p => p.type === 'anchor_mismatch'));
});

test('signed checkpoints: with GOACARE_AUDIT_KEY a forged checkpoint row is detected', () => {
  let c = attacker(); c.exec('DELETE FROM audit_events'); c.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_events'"); c.exec('DROP TRIGGER IF EXISTS audit_ckpt_no_delete; DROP TRIGGER IF EXISTS audit_ckpt_no_update; DELETE FROM audit_checkpoints;'); c.close();
  fs.rmSync(path.join(dir, 'audit-anchor.log'), { force: true });
  process.env.GOACARE_AUDIT_KEY = 'unit-test-key';
  add(4); audit.checkpoint(1);
  assert.equal(audit.verifyChain().ok, true);
  assert.equal(audit.latestCheckpoint().signed, true);
  c = attacker(); c.exec('DROP TRIGGER IF EXISTS audit_ckpt_no_update'); c.prepare("UPDATE audit_checkpoints SET mac = 'deadbeef'").run(); c.close();
  assert.ok(audit.verifyChain().problems.some(p => p.type === 'checkpoint_forged'));
  delete process.env.GOACARE_AUDIT_KEY;
});
