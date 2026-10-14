'use strict';
// Shared rules for the staff / doctor / admin dashboards: who may act on which hospital, and input validation.
const db = require('../db');
const { httpError } = require('./http');
const { requireRole } = require('./router');

const UNIT_TYPES = {
  emergency: 'Emergency / Casualty', icu: 'Intensive Care Unit (ICU)', opd: 'Outpatient Department (OPD)', general_ward: 'General Ward',
  ipd: 'Inpatient Department (IPD)', pediatrics: 'Pediatrics', maternity: 'Maternity & Obstetrics', surgery: 'Surgery & Operating Theatre',
  laboratory: 'Laboratory & Diagnostics', radiology: 'Radiology & Imaging', pharmacy: 'Pharmacy', other: 'Other'
};
const BED_CATEGORIES = ['icu', 'oxygen', 'general'];

// 403 / 404 for "this belongs to another hospital". The audit mark makes server.js record it as an attempt to reach another hospital's records.
const crossHospital = (message, status = 403) => Object.assign(httpError(status, message), { audit: 'cross_hospital_attempt' });
// Rejected and suspended hospitals cannot change anything (administrators reviewing them are not blocked).
function assertOperational(user, facility) {
  if (user.role === 'admin' || !facility) return;
  if (facility.verificationStatus === 'rejected' || facility.verificationStatus === 'suspended')
    throw httpError(403, `This hospital account is ${facility.verificationStatus}. Changes are disabled until a GoaCare administrator reviews it.`);
}

// Resolve the hospital an action applies to. Hospital staff are pinned to their own hospital (a different id is refused, never "corrected");
// administrators must name the hospital; doctors (when allowed) are pinned to the hospital they work at.
function scopeFacility(ctx, { roles = ['hospital', 'admin'], requested } = {}) {
  const u = requireRole(ctx, ...roles);
  const asked = requested != null && requested !== '' ? String(requested) : (ctx.query && ctx.query.get('facilityId')) || null;
  let facilityId;
  if (u.role === 'admin') {
    if (!asked) throw httpError(400, 'Choose a hospital (facilityId).');
    facilityId = asked;
  } else {
    if (!u.facilityId) throw httpError(403, 'Your account is not linked to a hospital.');
    if (asked && asked !== u.facilityId) throw crossHospital('You can only work with your own hospital.');
    facilityId = u.facilityId;
  }
  const facility = db.getStaffFacility(facilityId);
  if (!facility) throw httpError(404, 'Unknown hospital.');
  return { user: u, facilityId, facility };
}

const text = (v, max, label, { required = false, min = 0 } = {}) => {
  if (v != null && typeof v !== 'string' && typeof v !== 'number') throw httpError(400, `${label} must be text.`);
  const s = String(v == null ? '' : v).trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (required && !s) throw httpError(400, `${label} is required.`);
  if (s && s.length < min) throw httpError(400, `${label} must be at least ${min} characters.`);
  if (s.length > max) throw httpError(400, `${label} is too long (max ${max} characters).`);
  return s;
};

function validateUnit(b) {
  const type = String(b.type || '');
  if (!Object.prototype.hasOwnProperty.call(UNIT_TYPES, type)) throw httpError(400, 'Choose a unit type from the list.');
  const bedCategory = b.bedCategory == null || b.bedCategory === '' ? null : String(b.bedCategory);
  if (bedCategory !== null && !BED_CATEGORIES.includes(bedCategory)) throw httpError(400, 'Bed category must be ICU, oxygen, general or none.');
  return {
    name: text(b.name, 80, 'Unit name', { required: true, min: 2 }), type,
    description: text(b.description, 500, 'Description'), location: text(b.location, 100, 'Location (building / floor)'),
    contact: text(b.contact, 60, 'Contact number / extension'), hours: text(b.hours, 80, 'Operating hours'), bedCategory
  };
}

// Capacity is optional. Missing / null / '' means "unknown" (stored as NULL), which is not the same as 0.
const capacity = (v, label) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 5000) throw httpError(400, `${label} must be a whole number from 0 to 5000, or left blank if unknown.`);
  return n;
};
const freeCount = (v, label) => { const n = Number(v); if (v === '' || v == null || !Number.isInteger(n) || n < 0 || n > 5000) throw httpError(400, `${label} must be a whole number from 0 to 5000.`); return n; };

// Occupied beds are only reported when the hospital has stated its capacity: occupied = capacity - free. Otherwise they are unknown (null).
const bedSummary = f => ['icu', 'oxygen', 'general'].map(k => {
  const cap = k === 'icu' ? 'totalIcuBeds' : k === 'oxygen' ? 'totalOxygenBeds' : 'totalGeneralBeds', free = f[k + 'Beds'], total = f[cap];
  return { category: k, available: free, total: total == null ? null : total, occupied: total == null ? null : Math.max(0, total - free) };
});

// What is still missing from a unit's record (shown to staff so they can complete it).
const unitGaps = (u, doctorCount) => {
  const gaps = [];
  if (!u.description) gaps.push('description'); if (!u.location) gaps.push('location'); if (!u.contact) gaps.push('contact'); if (!doctorCount) gaps.push('doctors');
  return gaps;
};

// ---- permissions: what each hospital staff role may see / change. Checked on the server for every request; the dashboard only mirrors this to hide buttons. ----
// manager = Hospital Administrator (their own hospital only). nurse = nurse / ward staff. reception = front desk. pharmacy = pharmacy / inventory. finance = finance staff.
// Doctors have their own account role ('doctor') with separate rules; the GoaCare Super Administrator is the 'admin' account role.
const STAFF_ROLES = ['manager', 'nurse', 'reception', 'pharmacy', 'finance'];
const EVERY = STAFF_ROLES;
const FRONT = ['manager', 'nurse', 'reception'];   // clinical-operations roles: no pharmacy / finance
const CAPS = {
  beds: { view: FRONT, write: ['manager', 'nurse'] },
  doctors: { view: FRONT, write: ['manager'] },            // add / edit / archive doctors
  duty: { view: FRONT, write: ['manager', 'reception'] },  // change a doctor's duty status, availability and room
  appointments: { view: FRONT, write: ['manager', 'reception'] },
  crowd: { view: FRONT, write: FRONT },
  info: { view: EVERY, write: ['manager'] },               // hospital profile, services, units
  costs: { view: ['manager', 'nurse', 'reception', 'finance'], write: ['manager', 'finance'] },   // finance changes go through approval (routes/ops.js)
  stores: { view: ['manager', 'nurse', 'pharmacy'], write: ['manager', 'pharmacy'] },
  inventory: { view: ['manager', 'nurse', 'pharmacy'], write: ['manager', 'pharmacy'] },          // internal medicine stock and adjustments
  assets: { view: ['manager', 'nurse'], write: ['manager'] },
  team: { view: ['manager'], write: ['manager'] },
  invites: { view: ['manager'], write: ['manager'] },
  approvals: { view: ['manager', 'nurse', 'finance'], write: ['manager'] },                       // others see only their own requests
  audit: { view: EVERY, write: [] },                                                              // read only; non-managers see only their own actions
  reports: { view: EVERY, write: [] }
};
// Administrators oversee the directory: they may change the hospital's profile, units, doctors, costs, stores, assets and team roles, but never beds, crowd or appointments.
const ADMIN_HIDDEN = ['inventory'];   // internal stock quantities are not for the platform administrator
const ADMIN_WRITE = ['info', 'doctors', 'duty', 'costs', 'stores', 'assets', 'team', 'invites'];
function capsFor(u) {
  const out = {};
  for (const [cap, m] of Object.entries(CAPS)) {
    if (u.role === 'admin') out[cap] = ADMIN_HIDDEN.includes(cap) ? null : ADMIN_WRITE.includes(cap) ? 'write' : 'view';
    else if (u.role === 'hospital') out[cap] = m.write.includes(u.staffRole) ? 'write' : m.view.includes(u.staffRole) ? 'view' : null;
    else out[cap] = null;
  }
  return out;
}
// One call per request: checks the role and permission, then resolves the hospital (pinned for staff, named for admins).
const can = (u, cap, mode = 'view') => { const c = capsFor(u)[cap]; return c != null && (mode === 'view' || c === 'write'); };
const deny = mode => httpError(403, mode === 'write' ? 'Your role is not allowed to change this.' : 'Your role is not allowed to open this.');
function authorize(ctx, cap, mode = 'view', { requested } = {}) {
  const u = requireRole(ctx, 'hospital', 'admin');
  if (!can(u, cap, mode)) throw deny(mode);
  const scope = scopeFacility(ctx, { requested });
  if (mode === 'write') assertOperational(u, scope.facility);
  return scope;
}

module.exports = { crossHospital, assertOperational, FRONT, STAFF_ROLES, CAPS, capsFor, can, deny, authorize, UNIT_TYPES, BED_CATEGORIES, scopeFacility, text, validateUnit, capacity, freeCount, bedSummary, unitGaps };
