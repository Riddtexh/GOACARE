'use strict';
// Medicine inventory (internal stock, quantities, adjustment history) and the approval workflow for high-impact changes.
//   GET|POST /api/staff/inventory      PUT /api/staff/inventory/:id      POST /api/staff/inventory/:id/adjust {delta, reason}      GET /api/staff/inventory/history
//   GET /api/staff/approvals?status=   POST /api/staff/approvals/:id/decision {decision: approve|reject, reason, password}
// Public sites only ever see availability (in stock / low / out) of items marked "publish", never quantities (see /api/public/operations).
// Approvals: a finance price change, a large ward-capacity change by ward staff, and promoting someone to manager are requests; nothing
// is applied (and nothing public changes) until a DIFFERENT manager approves.
const db = require('../db');
const gov = require('../gov-db');
const ops = require('../ops-db');
const S = require('../lib/staff');
const { send, httpError } = require('../lib/http');
const { confirmPassword } = require('./gov');

const intIn = (v, label, min, max) => { const n = Number(v); if (typeof v === 'boolean' || v === '' || v == null || !Number.isInteger(n) || n < min || n > max) throw httpError(400, `${label} must be a whole number from ${min} to ${max}.`); return n; };
const parseMed = (b, qty) => ({
  name: S.text(b.name, 100, 'Medicine name', { required: true, min: 2 }), strength: S.text(b.strength, 40, 'Strength'), unit: S.text(b.unit, 20, 'Unit') || 'units',
  quantity: qty ? intIn(b.quantity, 'Quantity', 0, 1000000) : undefined, reorderLevel: intIn(b.reorderLevel == null || b.reorderLevel === '' ? 0 : b.reorderLevel, 'Re-order level', 0, 1000000), publish: b.publish === true
});
const dup = e => { if (/UNIQUE/i.test(String(e && e.message))) throw httpError(409, 'That medicine (name and strength) is already in the inventory.'); throw e; };
const medView = m => ({ ...m });
const snap = m => ({ name: m.name, strength: m.strength, quantity: m.quantity, reorderLevel: m.reorderLevel, availability: m.availability, publish: m.publish });

// ---- applying an approved request (payloads were validated when the request was created) ----
function applyApproval(a, decider) {
  const p = a.payload;
  if (a.kind === 'cost_upsert') {
    const before = p.id ? ops.costs.get(p.id) : null;
    if (p.id && (!before || before.facilityId !== a.facilityId)) throw httpError(409, 'The price entry no longer exists.');
    const v = { service_name: p.service_name, min_cost: p.min_cost, max_cost: p.max_cost, notes: p.notes };
    let id = p.id; try { if (id) ops.costs.update(id, v, a.requestedByName || 'approved change'); else id = ops.costs.insert(a.facilityId, v, a.requestedByName || 'approved change'); } catch (e) { if (/UNIQUE/i.test(e.message)) throw httpError(409, 'A price for that service already exists.'); throw e; }
    db.logActivity(decider, { facilityId: a.facilityId, action: 'cost_updated', entityType: 'cost', entityId: id, reason: 'Approval #' + a.id, detail: { name: v.service_name, approvalId: a.id, before: before && { min: before.minCost, max: before.maxCost, notes: before.notes }, after: { min: v.min_cost, max: v.max_cost, notes: v.notes } } });
  } else if (a.kind === 'ward_capacity') {
    const before = ops.ward(a.facilityId, p.type);
    ops.saveWard(a.facilityId, p.type, p.ward, 'approved change');
    db.logActivity(decider, { facilityId: a.facilityId, action: 'ward_updated', entityType: 'ward', entityId: p.type, reason: 'Approval #' + a.id, detail: { ward: p.label, approvalId: a.id, before: before && { total: before.total, available: before.available, occupied: before.occupied, outOfService: before.outOfService }, after: { ...p.ward } } });
  } else if (a.kind === 'role_assignment') {
    const t = db.findUserById(p.userId);
    if (!t || t.role !== 'hospital' || t.facilityId !== a.facilityId || !t.active) throw httpError(409, 'That staff account is no longer at this hospital.');
    ops.setStaffRole(t.id, p.to);
    db.logActivity(decider, { facilityId: a.facilityId, action: 'team_role_changed', entityType: 'team', entityId: t.id, reason: 'Approval #' + a.id, detail: { name: t.name, from: t.staffRole, to: p.to, approvalId: a.id } });
  } else throw httpError(400, 'Unknown request type.');
  gov.markApplied(a.id);
}

module.exports = function (router) {
  // ====================================================== inventory ======================================================
  router.add('GET', '/api/staff/inventory', ctx => {
    const { facilityId, facility } = S.authorize(ctx, 'inventory');
    const items = gov.medicines(facilityId).map(medView);
    send(ctx.res, 200, { facilityId, publicAvailabilityLive: facility.verificationStatus === 'approved', items, low: items.filter(i => i.availability !== 'in_stock').length });
  });
  router.add('GET', '/api/staff/inventory/history', ctx => {
    const { facilityId } = S.authorize(ctx, 'inventory');
    const item = Number(ctx.query.get('itemId')) || null;
    send(ctx.res, 200, { history: gov.adjustments(facilityId, item, Math.min(500, Number(ctx.query.get('limit')) || 100)) });
  });
  router.add('POST', '/api/staff/inventory', async ctx => {
    const b = await ctx.body(), { user, facilityId } = S.authorize(ctx, 'inventory', 'write', { requested: b.facilityId });
    const m = parseMed(b, true); let id;
    try { id = db.transaction(() => { const n = gov.createMedicine(facilityId, m, user); db.logActivity(user, { facilityId, action: 'inventory_created', entityType: 'inventory', entityId: n, detail: { name: m.name, after: { quantity: m.quantity, reorderLevel: m.reorderLevel, publish: m.publish } } }); return n; }); } catch (e) { dup(e); }
    send(ctx.res, 201, { item: gov.medicine(id) });
  });
  const loadMed = (ctx, mode = 'write') => {
    const { user, facilityId } = S.authorize(ctx, 'inventory', mode);
    const id = Number(ctx.params.id), item = Number.isInteger(id) ? gov.medicine(id) : null;
    if (!item || item.facilityId !== facilityId) throw S.crossHospital('Medicine not found.', 404);
    return { user, facilityId, item };
  };
  router.add('PUT', '/api/staff/inventory/:id', async ctx => {
    const { user, facilityId, item } = loadMed(ctx), b = await ctx.body(), m = parseMed(b, false);
    const expected = b.expectedVersion === undefined ? null : intIn(b.expectedVersion, 'expectedVersion', 1, 1e9);
    let n; try { n = db.transaction(() => {
      const c = gov.updateMedicine(item.id, m, user, expected);
      if (c !== 1) return 0;
      db.logActivity(user, { facilityId, action: 'inventory_updated', entityType: 'inventory', entityId: item.id, detail: { name: m.name, before: snap(item), after: { name: m.name, strength: m.strength, reorderLevel: m.reorderLevel, publish: m.publish } } });
      return 1; }); } catch (e) { dup(e); }
    if (!n) throw httpError(409, 'Someone else changed this item. Reload to see the latest version, then try again.', { current: gov.medicine(item.id) });
    send(ctx.res, 200, { item: gov.medicine(item.id) });
  });
  router.add('POST', '/api/staff/inventory/:id/adjust', async ctx => {
    const { user, facilityId, item } = loadMed(ctx), b = await ctx.body();
    const delta = intIn(b.delta, 'Change', -1000000, 1000000);
    if (delta === 0) throw httpError(400, 'The change cannot be zero.');
    const why = S.text(b.reason, 200, 'Reason', { required: true, min: 3 });
    const r = db.transaction(() => {
      const x = gov.adjustMedicine(item.id, delta, why, user);
      if (x.error) return x;
      const after = gov.medicine(item.id);
      db.logActivity(user, { facilityId, action: 'inventory_adjusted', entityType: 'inventory', entityId: item.id, reason: why, detail: { name: item.name, before: { quantity: x.before, availability: item.availability }, after: { quantity: x.after, availability: after.availability } } });
      if (after.availability !== 'in_stock' && item.availability === 'in_stock') db.logActivity(user, { facilityId, action: after.availability === 'out' ? 'inventory_out_of_stock' : 'inventory_low_stock', entityType: 'inventory', entityId: item.id, detail: { name: item.name, quantity: x.after, reorderLevel: item.reorderLevel } });
      return x;
    });
    if (r.error) throw httpError(409, `Stock cannot go below zero (current quantity ${r.quantity}).`, { quantity: r.quantity });
    send(ctx.res, 200, { item: gov.medicine(item.id) });
  });

  // ====================================================== approvals ======================================================
  router.add('GET', '/api/staff/approvals', ctx => {
    const { user, facilityId } = S.authorize(ctx, 'approvals');
    let list = gov.approvals(facilityId, ctx.query.get('status') || null);
    if (!(user.role === 'admin' || user.staffRole === 'manager')) list = list.filter(a => a.requestedBy === user.id);   // others see only what they asked for
    send(ctx.res, 200, { facilityId, approvals: list.map(a => ({ ...a, canDecide: user.role === 'hospital' && user.staffRole === 'manager' && a.status === 'pending' && a.requestedBy !== user.id })) });
  });
  router.add('POST', '/api/staff/approvals/:id/decision', async ctx => {
    const { user, facilityId } = S.authorize(ctx, 'approvals', 'write'), b = await ctx.body();
    const a = gov.approval(Number(ctx.params.id));
    if (!a || a.facilityId !== facilityId) throw S.crossHospital('Request not found.', 404);
    if (a.requestedBy === user.id) throw httpError(403, 'You cannot approve or reject your own request. Another administrator must decide.');   // separation of duties
    const decision = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : null;
    if (!decision) throw httpError(400, 'decision must be approve or reject.');
    const why = S.text(b.reason, 400, 'Reason', { required: decision === 'rejected', min: decision === 'rejected' ? 5 : 0 });
    if (decision === 'approved' && a.kind === 'role_assignment') await confirmPassword(user, b.password);   // recent authentication for administrator-role changes
    db.transaction(() => {
      if (gov.decideApproval(a.id, decision, user.id, why) !== 1) throw httpError(409, 'This request was already decided.');
      if (decision === 'approved') applyApproval(a, user);
      db.logActivity(user, { facilityId, action: 'approval_' + decision, entityType: 'approval', entityId: a.id, reason: why, detail: { kind: a.kind, summary: a.summary, requestedBy: a.requestedBy } });
    });
    send(ctx.res, 200, { approval: gov.approval(a.id) });
  });
};
module.exports.createApproval = ({ user, facilityId, kind, summary, payload, current }) => {
  const id = db.transaction(() => {
    const n = gov.createApproval({ facilityId, kind, summary, payload, current, requestedBy: user.id });
    db.logActivity(user, { facilityId, action: 'approval_requested', entityType: 'approval', entityId: n, detail: { kind, summary } });
    return n;
  });
  return gov.approval(id);
};
