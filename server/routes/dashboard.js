'use strict';
// Data behind the staff / doctor dashboards. Every figure comes from the database; nothing is estimated or hard-coded.
//   GET /api/staff/overview     hospital staff: beds, doctors, today's requests, units, alerts, recent changes.  doctor: own day.  (admin: ?facilityId=)
//   GET /api/staff/doctors      doctors at the hospital (with their unit); a doctor account gets only themself
//   GET /api/staff/hospital     the hospital's details as staff see them (capacity, verification, who changed what)
//   PUT /api/staff/hospital     edit phone / address / specialties.  Edits are marked "awaiting verification" until an administrator confirms them.
//   GET /api/staff/activity     recent changes at the hospital (?limit=&offset=)
const db = require('../db');
const { send, httpError, todayIST } = require('../lib/http');
const { requireRole } = require('../lib/router');
const S = require('../lib/staff');
const ops = require('../ops-db');
const gov = require('../gov-db');
const audit = require('../lib/audit');

const DAY = 24 * 60 * 60 * 1000;
const PAST = '0000-01-01';

function hospitalOverview({ facilityId, facility }) {
  const today = todayIST();
  const doctors = db.staffDoctors(facilityId), units = db.listUnits(facilityId);
  const appts = db.facilityAppointments(facilityId, today);
  const byStatus = list => list.reduce((o, a) => { o[a.status] = (o[a.status] || 0) + 1; return o; }, {});
  const todays = appts.filter(a => a.date === today);
  const doctorStatus = doctors.reduce((o, d) => { o[d.status] = (o[d.status] || 0) + 1; return o; }, {});
  const unitInfo = units.map(u => ({ ...u, gaps: S.unitGaps(u, u.doctorCount) }));
  const alerts = [];
  const wards = ops.wards(facilityId), crowd = ops.crowdHistory(facilityId, 1)[0] || null, bedsAt = [facility.staffUpdatedAt, ...wards.map(w => w.updatedAt)].filter(Boolean).sort().pop() || null;
  const bedsAge = bedsAt ? Date.now() - Date.parse(bedsAt) : null, crowdAge = crowd ? Date.now() - Date.parse(crowd.verifiedAt) : null;
  if (bedsAge == null) alerts.push({ level: 'warn', text: 'Bed counts have never been confirmed by hospital staff. Patients see them marked as unconfirmed.', page: 'beds' });
  else if (bedsAge > DAY) alerts.push({ level: 'warn', text: 'Outdated: bed counts were last updated more than 24 hours ago.', page: 'beds' });
  if (!crowd) alerts.push({ level: 'info', text: 'No crowd level or waiting time has been entered yet.', page: 'crowd' });
  else if (crowdAge > 2 * 3600000) alerts.push({ level: 'warn', text: `Outdated: the crowd level was last verified ${Math.floor(crowdAge / 3600000)} hours ago.`, page: 'crowd' });
  const pending = appts.filter(a => a.status === 'Requested').length;
  if (pending) alerts.push({ level: 'info', text: `${pending} appointment request${pending === 1 ? '' : 's'} waiting for a decision.`, page: 'appointments' });
  if (!units.length) alerts.push({ level: 'info', text: 'No units have been set up yet. Add the units your hospital runs (ICU, OPD, ...).', page: 'units' });
  const incomplete = unitInfo.filter(u => u.active && u.gaps.length).length;
  if (incomplete) alerts.push({ level: 'info', text: `${incomplete} active unit${incomplete === 1 ? ' has' : 's have'} missing information.`, page: 'units' });
  if (!facility.phoneVerified) alerts.push({ level: 'info', text: 'No verified hospital phone number on file.', page: 'hospital' });
  if (!facility.infoVerifiedAt) alerts.push({ level: 'info', text: 'Hospital details are awaiting administrator verification.', page: 'hospital' });
  return {
    role: 'hospital', today, facility,
    beds: S.bedSummary(facility),
    wards: { list: wards, recorded: wards.length, availableTotal: wards.length ? wards.reduce((n, w) => n + w.available, 0) : null, updatedAt: bedsAt },
    crowd: crowd && { ...crowd, stale: crowdAge > 2 * 3600000 },     doctors: { onDuty: doctors.filter(d => d.dutyStatus === 'On Duty').length, total: doctors.length, byStatus: doctorStatus, unassigned: doctors.filter(d => !d.unitId).length },
    appointments: { today: byStatus(todays), todayTotal: todays.length, upcoming: appts.filter(a => a.date > today).length, pending },
    units: { total: units.length, active: units.filter(u => u.active).length, unverified: units.filter(u => !u.verifiedAt).length, incomplete,
      list: unitInfo.map(u => ({ id: u.id, name: u.name, type: u.type, active: u.active, doctorCount: u.doctorCount, bedCategory: u.bedCategory, verified: !!u.verifiedAt, gaps: u.gaps })) },
    alerts, activity: db.activity({ facilityId, limit: 8 }).items
  };
}

function doctorOverview(user) {
  const doctor = user.doctorId ? db.staffDoctor(user.doctorId) : null;
  if (!doctor) throw httpError(404, 'Your account is not linked to a doctor profile.');
  const facility = doctor.facilityId ? db.getFacility(doctor.facilityId) : null;
  const today = todayIST();
  const appts = db.doctorAppointments('d:' + doctor.id, today);
  const todays = appts.filter(a => a.date === today && (a.status === 'Requested' || a.status === 'Confirmed'));
  const pending = appts.filter(a => a.status === 'Requested');
  const notices = [];
  if (pending.length) notices.push({ level: 'info', text: `${pending.length} appointment request${pending.length === 1 ? '' : 's'} waiting for your decision.`, page: 'appointments' });
  if (doctor.status !== 'Available') notices.push({ level: 'warn', text: `Your status is "${doctor.status}". Patients see this on the doctor list.`, page: 'profile' });
  return {
    role: 'doctor', today,
    doctor: { id: doctor.id, name: doctor.name, spec: doctor.spec, status: doctor.status, room: doctor.room, timings: doctor.timings, fee: doctor.fee, unitName: doctor.unitName, updatedAt: doctor.updatedAt },
    facility: facility && { id: facility.id, name: facility.name, address: facility.address, phone: facility.phone, district: facility.district },
    appointments: { today: todays, todayTotal: todays.length, upcoming: appts.filter(a => a.date > today && a.status !== 'Cancelled' && a.status !== 'Declined').length, pending: pending.length, pendingList: pending.slice(0, 5) },
    alerts: notices
  };
}

// Notification categories a person may switch off. Security alerts and pending approvals addressed to managers are mandatory and cannot be turned off.
const PREF_OF_PAGE = { beds: 'bed_alerts', appointments: 'appointment_changes', inventory: 'stock_alerts' };
const MANDATORY = ['security_alerts'];
function governance(u, scope) {
  const f = scope.facility, g = { hospital: { status: f.verificationStatus, hospitalCode: f.hospitalCode, trusted: f.verificationStatus === 'approved', legacy: f.legacy, note: f.verificationNote } }, extra = [];
  const isMgr = u.role === 'admin' || u.staffRole === 'manager';
  if (S.can(u, 'approvals')) {
    const mine = gov.approvals(scope.facilityId, 'pending').filter(a => isMgr || a.requestedBy === u.id);
    g.pendingApprovals = mine.length;
    if (mine.length && isMgr) extra.push({ level: 'info', text: `${mine.length} change${mine.length === 1 ? '' : 's'} waiting for approval.`, page: 'approvals', pref: 'pending_approvals' });
  }
  if (S.can(u, 'inventory')) {
    const low = gov.lowStock(scope.facilityId); g.lowStock = low.length;
    if (low.length) extra.push({ level: 'warn', text: `${low.length} medicine${low.length === 1 ? ' is' : 's are'} low or out of stock.`, page: 'inventory', pref: 'stock_alerts' });
  }
  if (S.can(u, 'invites') && u.role === 'hospital') {
    g.pendingInvitations = gov.invitations(scope.facilityId).filter(i => i.status === 'pending').length;
    const waiting = gov.affiliationsAt(scope.facilityId, ['requested']).length; g.affiliationRequests = waiting;
    if (waiting) extra.push({ level: 'info', text: `${waiting} doctor${waiting === 1 ? '' : 's'} asked to join this hospital.`, page: 'staffing', pref: 'invitation_status' });
  }
  if (isMgr) { const al = gov.alertsOpen(scope.facilityId); g.securityAlerts = al.length; al.slice(0, 3).forEach(a => extra.push({ level: 'warn', text: a.summary, page: 'audit', pref: 'security_alerts' })); }
  if (f.verificationStatus !== 'approved') extra.unshift({ level: f.verificationStatus === 'pending' ? 'info' : 'warn', text: f.verificationStatus === 'pending' ? 'This hospital has not been verified by GoaCare yet. Patients see its information labelled as unverified.' : `This hospital is ${f.verificationStatus}. Changes are disabled.`, page: 'overview', pref: 'security_alerts' });
  return { g, extra };
}
function decorate(u, data, scope) {
  if (u.role === 'doctor') return data;
  const { g, extra } = governance(u, scope), prefs = gov.prefs(u.id);
  data.governance = g;
  data.alerts = (data.alerts || []).concat(extra).filter(a => { const k = a.pref || PREF_OF_PAGE[a.page]; return !k || MANDATORY.includes(k) || (k === 'pending_approvals' && (u.role === 'admin' || u.staffRole === 'manager')) || prefs[k] !== false; });
  // Pharmacy and finance staff do not get clinical or patient-facing operational data.
  if (u.role === 'hospital' && (u.staffRole === 'pharmacy' || u.staffRole === 'finance')) {
    const keep = u.staffRole === 'pharmacy' ? ['inventory'] : ['costs', 'approvals'];
    data = { role: 'hospital', restricted: keep, today: data.today, facility: { id: data.facility.id, name: data.facility.name, verificationStatus: data.facility.verificationStatus, hospitalCode: data.facility.hospitalCode }, governance: g, alerts: data.alerts.filter(a => ['inventory', 'approvals', 'overview', 'audit', 'costs'].includes(a.page)) };
  }
  return data;
}

module.exports = function (router) {
  router.add('GET', '/api/staff/overview', ctx => {
    const u = requireRole(ctx, 'hospital', 'doctor', 'admin');
    if (u.role === 'doctor') return send(ctx.res, 200, doctorOverview(u));
    const scope = S.scopeFacility(ctx);
    send(ctx.res, 200, decorate(u, hospitalOverview(scope), scope));
  });

  router.add('GET', '/api/staff/doctors', ctx => {
    const u = requireRole(ctx, 'hospital', 'doctor', 'admin');
    if (u.role === 'doctor') {
      const d = u.doctorId ? db.staffDoctor(u.doctorId) : null;
      return send(ctx.res, 200, { doctors: d ? [d] : [] });
    }
    const { facilityId } = S.scopeFacility(ctx);
    send(ctx.res, 200, { facilityId, doctors: db.staffDoctors(facilityId) });
  });

  router.add('GET', '/api/staff/hospital', ctx => {
    const { facility } = S.scopeFacility(ctx, { roles: ['hospital', 'doctor', 'admin'] });
    send(ctx.res, 200, { facility, beds: S.bedSummary(facility), canEdit: ctx.user.role !== 'doctor' });
  });

  router.add('PUT', '/api/staff/hospital', async ctx => {
    const b = await ctx.body();
    const { user, facilityId, facility } = S.authorize(ctx, 'info', 'write', { requested: b.facilityId });
    const name = S.text(b.name === undefined ? facility.name : b.name, 120, 'Hospital name', { required: true, min: 3 });
    const phone = S.text(b.phone, 30, 'Phone number');
    if (phone && !/^\+?[\d][\d\s\-()]{5,28}$/.test(phone)) throw httpError(400, 'Enter a valid phone number (digits, spaces, +, - and brackets only), or leave it blank.');
    if (/^\s*(108|112|102|104)\s*$/.test(phone)) throw httpError(400, '108 / 112 / 102 / 104 are emergency lines, not the hospital number.');
    const address = S.text(b.address, 200, 'Address', { required: true, min: 5 });
    const list = (v, label, max, each) => { if (v === undefined) return null; if (!Array.isArray(v) || v.length > max) throw httpError(400, `${label} must be a list of up to ${max} items.`); return [...new Set(v.map(x => S.text(x, each, label, { required: true })))]; };
    const specialties = list(b.specialties, 'Specialties', 25, 40) || facility.specialties, languages = list(b.languages, 'Languages', 12, 30) || facility.languages, amenities = list(b.amenities, 'Facilities', 30, 60) || facility.amenities;
    const coord = (v, label, lo, hi, old) => { if (v === undefined || v === null || v === '') return old; const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw httpError(400, `${label} must be a number between ${lo} and ${hi}.`); return n; };
    const lat = coord(b.lat, 'Latitude', -90, 90, facility.lat), lng = coord(b.lng, 'Longitude', -180, 180, facility.lng);
    let emergency = facility.emergencyAvailable; if (b.emergencyAvailable !== undefined) { if (b.emergencyAvailable !== null && typeof b.emergencyAvailable !== 'boolean') throw httpError(400, 'Emergency department availability must be yes, no or unknown.'); emergency = b.emergencyAvailable; }
    const hours = b.operatingHours === undefined ? facility.operatingHours : S.text(b.operatingHours, 200, 'Operating hours');
    const next = { name, phone, address, specialties, lat, lng, emergencyAvailable: emergency, operatingHours: hours, languages, amenities };
    db.transaction(() => {
      ops.updateProfile(facilityId, next, user.name);
      const changed = Object.keys(next).filter(k => JSON.stringify(next[k]) !== JSON.stringify(facility[k]));
      db.logActivity(user, { facilityId, action: 'hospital_info_updated', entityType: 'hospital', entityId: facilityId, detail: { changed } });
    });
    const fresh = db.getStaffFacility(facilityId);
    send(ctx.res, 200, { facility: fresh, beds: S.bedSummary(fresh) });
  });

  router.add('GET', '/api/staff/activity', ctx => {
    const { facilityId } = S.scopeFacility(ctx);
    const limit = Math.min(100, Math.max(1, parseInt(ctx.query.get('limit'), 10) || 25)), offset = Math.max(0, parseInt(ctx.query.get('offset'), 10) || 0);
    send(ctx.res, 200, db.activity({ facilityId, limit, offset }));
  });
};
module.exports.PAST = PAST;
