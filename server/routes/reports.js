'use strict';
// Role-appropriate reports built only from stored data. GET /api/reports/:name?facilityId=&from=&to=&format=csv   (exports are audited)
//   bed-availability (manager, nurse, admin)   appointments (manager, reception)   services (manager, nurse, reception, admin)
//   inventory-changes (manager, pharmacy)      price-changes (manager, finance, admin)   staff-activity (manager, admin)   pending-verifications (admin)
const db = require('../db');
const gov = require('../gov-db');
const ops = require('../ops-db');
const audit = require('../lib/audit');
const S = require('../lib/staff');
const { send, httpError, todayIST } = require('../lib/http');
const { requireRole } = require('../lib/router');

const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
const day = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : null;
const labelOf = u => (u.role === 'hospital' ? u.staffRole : u.role);

const REPORTS = {
  'bed-availability': { title: 'Bed availability history', roles: ['manager', 'nurse', 'admin'], run: (fid, d) => ({
    columns: ['Time (UTC)', 'Ward / category', 'Available', 'Total', 'Occupied', 'Changed by'],
    rows: audit.list({ facilityId: fid }, { resourceType: 'ward', from: d.fromTs, to: d.toTs, outcome: 'success' }, { limit: 500 }).items.filter(e => e.after).map(e => [e.at, e.detail.ward || e.resourceId, e.after.available, e.after.total == null ? '' : e.after.total, e.after.occupied == null ? '' : e.after.occupied, e.actorRole])
      .concat(audit.list({ facilityId: fid }, { resourceType: 'beds', from: d.fromTs, to: d.toTs, outcome: 'success' }, { limit: 200 }).items.map(e => [e.at, 'Hospital beds (ICU/Oxygen/General)', ['icu', 'oxygen', 'general'].map(k => k + ':' + (e.after && e.after['free.' + k])).join(' '), '', '', e.actorRole])) }) },
  'appointments': { title: 'Appointment statistics', roles: ['manager', 'reception'], run: (fid, d) => {
    const rows = gov.apptStats(fid, d.from || '0000-01-01', d.to || '9999-12-31'), by = {};
    rows.forEach(r => { (by[r.date] = by[r.date] || {})[r.status] = r.n; });
    return { columns: ['Date', 'Requested', 'Confirmed', 'Declined', 'Cancelled', 'Total'], rows: Object.keys(by).sort().map(d => { const x = by[d]; return [d, x.Requested || 0, x.Confirmed || 0, x.Declined || 0, x.Cancelled || 0, Object.values(x).reduce((a, b) => a + b, 0)]; }) };
  } },
  'services': { title: 'Service availability', roles: ['manager', 'nurse', 'reception', 'admin'], run: fid => ({ columns: ['Name', 'Type', 'Available', 'Last updated'], rows: ops.services.list(fid).filter(s => !s.demo).map(s => [s.name, s.kind, s.available ? 'yes' : 'no', s.updatedAt]) }) },
  'inventory-changes': { title: 'Inventory changes', roles: ['manager', 'pharmacy'], run: fid => ({ columns: ['Time (UTC)', 'Medicine', 'Change', 'Before', 'After', 'Reason', 'By'], rows: gov.adjustments(fid, null, 500).map(a => [a.at, a.item, a.delta, a.before, a.after, a.reason, a.by]) }) },
  'price-changes': { title: 'Price change history', roles: ['manager', 'finance', 'admin'], run: (fid, d) => ({ columns: ['Time (UTC)', 'Service', 'Before', 'After', 'Approval', 'By role'],
    rows: audit.list({ facilityId: fid }, { resourceType: 'cost', from: d.fromTs, to: d.toTs, outcome: 'success' }, { limit: 500 }).items.map(e => [e.at, e.detail.name || e.resourceId, e.before ? `₹${e.before.min}–₹${e.before.max}` : '(new)', e.after ? `₹${e.after.min}–₹${e.after.max}` : '', e.reason || '', e.actorRole]) }) },
  'staff-activity': { title: 'Staff activity', roles: ['manager', 'admin'], run: (fid, d) => {
    const c = {};   // the newest 100 events are enough for this summary
    for (const e of audit.list({ facilityId: fid }, { from: d.fromTs, to: d.toTs }, { limit: 100 }).items) { const k = (e.actorId == null ? '-' : e.actorId) + '|' + e.actorRole; c[k] = c[k] || { n: 0, blocked: 0, last: e.at }; c[k].n++; if (e.outcome !== 'success') c[k].blocked++; }
    return { columns: ['Account #', 'Role', 'Events (latest 100)', 'Failed / blocked', 'Most recent (UTC)'], rows: Object.entries(c).map(([k, v]) => [...k.split('|'), v.n, v.blocked, v.last]) };
  } },
  'pending-verifications': { title: 'Pending verification requests', roles: ['admin'], global: true, run: () => ({ columns: ['Type', 'Name', 'Submitted', 'Detail'],
    rows: gov.hospitalQueue('pending').filter(h => h.registered).map(h => ['Hospital registration', h.name, h.submittedAt, `${h.documents} document(s), licence ${h.licenseNo}`]).concat(gov.doctorQueue('pending').map(d => ['Doctor registration', d.fullName, d.submittedAt, `${d.specialty}; credentials ${d.credentialStatus}`])).concat(gov.hospitalQueue('pending').filter(h => h.legacy).map(h => ['Legacy hospital (never reviewed)', h.name, '', ''])) }) }
};

module.exports = function (router) {
  router.add('GET', '/api/reports', ctx => {
    const u = requireRole(ctx, 'hospital', 'admin');
    send(ctx.res, 200, { reports: Object.entries(REPORTS).filter(([, r]) => r.roles.includes(labelOf(u))).map(([name, r]) => ({ name, title: r.title, needsHospital: !r.global })) });
  });
  router.add('GET', '/api/reports/:name', ctx => {
    const u = requireRole(ctx, 'hospital', 'admin'), rep = REPORTS[ctx.params.name];
    if (!rep) throw httpError(404, 'Unknown report.');
    if (!rep.roles.includes(labelOf(u))) throw S.deny('view');
    let fid = null, facility = null;
    if (!rep.global) { const sc = S.authorize(ctx, 'reports'); fid = sc.facilityId; facility = sc.facility.name; }
    const from = day(ctx.query.get('from')), to = day(ctx.query.get('to'));
    const out = { name: ctx.params.name, title: rep.title, hospital: facility, from, to, generatedAt: new Date().toISOString(), ...rep.run(fid, { from, to, fromTs: from ? from + 'T00:00:00.000Z' : null, toTs: to ? to + 'T23:59:59.999Z' : null }) };
    if (ctx.query.get('format') === 'csv') {
      audit.append({ actorId: u.id, actorRole: labelOf(u), facilityId: fid, action: 'report_exported', resourceType: 'report', resourceId: ctx.params.name, detail: { rows: out.rows.length } });
      const csv = [out.columns.map(csvCell).join(',')].concat(out.rows.map(r => r.map(csvCell).join(','))).join('\r\n');
      ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="goacare-${ctx.params.name}.csv"`, 'Cache-Control': 'no-store' });
      return ctx.res.end(csv);
    }
    send(ctx.res, 200, out);
  });
};
