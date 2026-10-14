'use strict';
// Audit History (read only). There is deliberately NO route that edits or deletes an audit event: any attempt is refused AND recorded.
//   GET  /api/audit/events?facilityId=&actorId=&action=&resourceType=&outcome=success|failure|blocked&from=&to=&q=&limit=&offset=
//   GET  /api/audit/events/:id            one event with before / after
//   GET  /api/audit/export                CSV of the same filters (the export itself is audited)
//   GET  /api/audit/integrity             latest verification, latest checkpoint, open security alerts, backup status
//   POST /api/audit/verify                (administrators) re-computes the hash chain, stores the result
//   POST /api/audit/checkpoint            (administrators) anchors the current head hash (database + append-only anchor file)
//   POST /api/audit/report                any staff / doctor account: report suspected tampering (creates a security alert)
//   GET  /api/security/alerts   PUT /api/security/alerts/:id/resolve
// Visibility: super administrator = everything; hospital manager = their hospital; every other staff account and doctor = only their own actions.
const audit = require('../lib/audit');
const gov = require('../gov-db');
const { send, httpError } = require('../lib/http');
const { requireRole } = require('../lib/router');
const S = require('../lib/staff');

const OUTCOMES = ['success', 'failure', 'blocked'];
function scopeFor(u) {
  if (u.role === 'admin') return {};
  if (u.role === 'hospital' && u.staffRole === 'manager') return { facilityId: u.facilityId };
  return { actorId: u.id };
}
const viewer = ctx => requireRole(ctx, 'hospital', 'doctor', 'admin');
function filters(q) {
  const o = {};
  for (const k of ['facilityId', 'actorId', 'action', 'resourceType', 'outcome', 'from', 'to', 'q']) { const v = q.get(k); if (v) o[k] = String(v).slice(0, 120); }
  if (o.outcome && !OUTCOMES.includes(o.outcome)) throw httpError(400, 'outcome must be success, failure or blocked.');
  for (const k of ['from', 'to']) if (o[k] && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(o[k])) throw httpError(400, `${k} must be a date (YYYY-MM-DD).`);
  if (o.actorId && !/^\d+$/.test(o.actorId)) throw httpError(400, 'actorId must be a number.');
  return o;
}
const csvCell = v => { let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };   // spreadsheet formula injection guard

module.exports = function (router) {
  router.add('GET', '/api/audit/events', ctx => {
    const u = viewer(ctx), q = ctx.query;
    const limit = Math.min(100, Math.max(1, parseInt(q.get('limit'), 10) || 25)), offset = Math.max(0, parseInt(q.get('offset'), 10) || 0);
    const r = audit.list(scopeFor(u), filters(q), { limit, offset });
    send(ctx.res, 200, { ...r, limit, offset, scope: u.role === 'admin' ? 'all hospitals' : u.role === 'hospital' && u.staffRole === 'manager' ? 'your hospital' : 'your own actions', actions: audit.actions(scopeFor(u)), latestVerification: audit.latestVerification() });
  });

  router.add('GET', '/api/audit/events/:id', ctx => {
    const u = viewer(ctx), e = audit.get(ctx.params.id), sc = scopeFor(u);
    if (!e || (sc.facilityId && e.facilityId !== sc.facilityId) || (sc.actorId && e.actorId !== sc.actorId)) {
      if (e) throw Object.assign(httpError(404, 'Event not found.'), { audit: 'cross_hospital_attempt' });
      throw httpError(404, 'Event not found.');
    }
    send(ctx.res, 200, { event: e });
  });

  // Nobody can change history. Every attempt is refused and written to the chain.
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST']) router.add(method, '/api/audit/events/:id', ctx => {
    const u = ctx.user;
    if (!u) throw httpError(401, 'Please sign in.');
    audit.recordFailure(u, { action: 'audit_tamper_attempt', resourceType: 'audit_event', resourceId: ctx.params.id, outcome: 'blocked', reason: `${method} refused: audit events are append-only`, detail: { method } });
    try { gov.addAlert('audit_tamper_attempt', u.facilityId, `${method} on an audit event was refused (account #${u.id}).`, { method, eventId: ctx.params.id }); } catch (e) { /* alert is best effort */ }
    throw httpError(405, 'Audit history is append-only. Events cannot be changed or deleted.');
  });

  router.add('GET', '/api/audit/export', ctx => {
    const u = viewer(ctx), sc = scopeFor(u), f = filters(ctx.query);
    const rows = audit.list(sc, f, { limit: 5000, offset: 0 }).items;
    const head = ['seq', 'event_id', 'time_utc', 'actor_id', 'actor_role', 'hospital_id', 'action', 'resource_type', 'resource_id', 'outcome', 'reason', 'before', 'after', 'request_id', 'hash'];
    const csv = [head.join(',')].concat(rows.map(e => [e.seq, e.id, e.at, e.actorId, e.actorRole, e.facilityId, e.action, e.resourceType, e.resourceId, e.outcome, e.reason, e.before, e.after, e.requestId, e.hash].map(csvCell).join(','))).join('\r\n');
    audit.append({ actorId: u.id, actorRole: u.role, facilityId: u.facilityId, action: 'audit_exported', resourceType: 'audit', outcome: 'success', detail: { rows: rows.length, filters: f, scope: Object.keys(sc).join(',') || 'all' } });
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="goacare-audit.csv"', 'Cache-Control': 'no-store' });
    ctx.res.end(csv);
  });

  router.add('GET', '/api/audit/integrity', ctx => {
    const u = viewer(ctx);
    send(ctx.res, 200, {
      latestVerification: audit.latestVerification(), latestCheckpoint: audit.latestCheckpoint(), signedCheckpoints: !!process.env.GOACARE_AUDIT_KEY,
      alerts: u.role === 'admin' ? gov.alertsOpen(null) : (u.role === 'hospital' && u.staffRole === 'manager' ? gov.alertsOpen(u.facilityId) : []),
      // No backup system is wired into this application, so none is reported. Nothing here is estimated or invented.
      backup: { configured: false, note: 'No backup integration is configured. Back up the data folder (goacare.db and audit-anchor.log) with your hosting provider.' },
      canVerify: u.role === 'admin'
    });
  });
  router.add('POST', '/api/audit/verify', ctx => { const u = requireRole(ctx, 'admin'); send(ctx.res, 200, { result: audit.verify(u) }); });
  router.add('POST', '/api/audit/checkpoint', ctx => { const u = requireRole(ctx, 'admin'); send(ctx.res, 201, { checkpoint: audit.checkpoint(u.id) }); });
  router.add('POST', '/api/audit/report', async ctx => {
    const u = viewer(ctx), b = await ctx.body();
    const why = S.text(b.description, 800, 'Description', { required: true, min: 10 });
    audit.append({ actorId: u.id, actorRole: u.role, facilityId: u.facilityId, action: 'tamper_reported', resourceType: 'audit', outcome: 'success', reason: why });
    gov.addAlert('tamper_reported', u.facilityId, 'A staff member reported suspected tampering.', { by: u.id });
    send(ctx.res, 201, { ok: true, message: 'Thank you. A GoaCare administrator will review this report.' });
  });

  router.add('GET', '/api/security/alerts', ctx => {
    const u = requireRole(ctx, 'hospital', 'admin');
    if (u.role === 'hospital' && u.staffRole !== 'manager') throw S.deny('view');
    send(ctx.res, 200, { alerts: gov.alertsOpen(u.role === 'admin' ? null : u.facilityId) });
  });
  router.add('PUT', '/api/security/alerts/:id/resolve', ctx => {
    const u = requireRole(ctx, 'admin');
    if (!gov.resolveAlert(Number(ctx.params.id), u.id)) throw httpError(404, 'Alert not found or already resolved.');
    audit.append({ actorId: u.id, actorRole: 'admin', action: 'security_alert_resolved', resourceType: 'security_alert', resourceId: ctx.params.id });
    send(ctx.res, 200, { ok: true });
  });
};
