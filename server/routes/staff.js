'use strict';
// Actions for hospital and doctor accounts + the "report current wait" button (any signed-in user).
const db = require('../db');
const { send, fail, httpError, todayIST } = require('../lib/http');
const { requireUser, requireRole } = require('../lib/router');
const S = require('../lib/staff');
const ops = require('../ops-db');
const gov = require('../gov-db');
const DUTY = ['On Duty', 'Off Duty', 'On Leave'];

const STATUSES = ['Available', 'In Surgery', 'On Call'];
const bedCount = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 5000) throw httpError(400, `${label} must be a whole number from 0 to 5000.`); return n; };

// Which doctors may this staff member change?  A doctor changes themselves; a hospital changes doctors that work at it.
function canManageDoctor(user, doctor) {
  // A doctor changes their own listing rows: the one on their account, plus rows at other hospitals where they hold an approved affiliation (same permanent Doctor ID).
  if (user.role === 'doctor') return user.doctorId === doctor.id || gov.approvedDoctorRows(user.id).some(r => r.id === doctor.id);
  if (user.role === 'hospital') return user.facilityId === doctor.facilityId;
  return false;
}

module.exports = function (router) {
  // Hospital updates its own beds.  Patients see the change on their next poll (about 10 seconds).
  // icuBeds / oxygenBeds / generalBeds = beds FREE now (as before). totalIcuBeds / ... = optional capacity (null or '' = unknown).
  // Occupied beds are never stored: the dashboard derives capacity - free, and only where capacity is known.
  router.add('PUT', '/api/facilities/:id/beds', async ctx => {
    const u = requireRole(ctx, 'hospital');
    if (!S.can(u, 'beds', 'write')) throw S.deny('write');
    if (u.facilityId !== ctx.params.id) throw S.crossHospital('You can only update the beds of your own hospital.');
    const b = await ctx.body();
    const icu = bedCount(b.icuBeds, 'ICU beds'), oxy = bedCount(b.oxygenBeds, 'Oxygen beds'), gen = bedCount(b.generalBeds, 'General beds');
    const f = db.getStaffFacility(ctx.params.id);
    if (!f) throw httpError(404, 'Unknown hospital.');
    S.assertOperational(u, f);
    const pick = (given, label, old) => { const c = S.capacity(given, label); return c === undefined ? old : c; };
    const totals = { totalIcu: pick(b.totalIcuBeds, 'ICU capacity', f.totalIcuBeds), totalOxygen: pick(b.totalOxygenBeds, 'Oxygen capacity', f.totalOxygenBeds), totalGeneral: pick(b.totalGeneralBeds, 'General capacity', f.totalGeneralBeds) };
    [['ICU', icu, totals.totalIcu], ['Oxygen', oxy, totals.totalOxygen], ['General', gen, totals.totalGeneral]].forEach(([n, free, cap]) => {
      if (cap != null && free > cap) throw httpError(400, `${n} free beds (${free}) cannot be more than the ${n} capacity (${cap}).`);
    });
    db.transaction(() => {
      db.setBedsFull(f.id, { icu, oxygen: oxy, general: gen, ...totals }, u.name);
      db.logActivity(u, { facilityId: f.id, action: 'beds_updated', entityType: 'beds', entityId: f.id, detail: {
        free: { icu: [f.icuBeds, icu], oxygen: [f.oxygenBeds, oxy], general: [f.generalBeds, gen] },
        capacity: { icu: [f.totalIcuBeds, totals.totalIcu], oxygen: [f.totalOxygenBeds, totals.totalOxygen], general: [f.totalGeneralBeds, totals.totalGeneral] } } });
    });
    send(ctx.res, 200, { facility: db.getFacility(ctx.params.id), staff: db.getStaffFacility(ctx.params.id), beds: S.bedSummary(db.getStaffFacility(ctx.params.id)) });
  });

  // A doctor changes themselves; hospital staff with the "duty" permission (manager, reception) change doctors at their hospital.
  // Accepts: status (Available | In Surgery | On Call), room, dutyStatus (On Duty | Off Duty | On Leave), acceptsAppointments (true | false).
  router.add('PUT', '/api/doctors/:id/status', async ctx => {
    const u = requireRole(ctx, 'doctor', 'hospital');
    const doctor = db.staffDoctor(Number(ctx.params.id));   // raw values, not the public "On Leave shows through" status
    if (!doctor || doctor.archived) throw httpError(404, 'Unknown doctor.');
    if (!canManageDoctor(u, doctor)) throw Object.assign(httpError(403, 'You can only update your own status (or doctors at your hospital).'), { audit: 'cross_hospital_attempt' });
    if (u.role === 'hospital' && !S.can(u, 'duty', 'write')) throw S.deny('write');
    const b = await ctx.body();
    if (['status', 'room', 'dutyStatus', 'acceptsAppointments'].every(k => b[k] === undefined)) throw httpError(400, 'Nothing to change: send a status, room, dutyStatus or acceptsAppointments.');
    if (b.status !== undefined && !STATUSES.includes(b.status)) throw httpError(400, 'Status must be one of: ' + STATUSES.join(', '));
    if (b.dutyStatus !== undefined && !DUTY.includes(b.dutyStatus)) throw httpError(400, 'Duty status must be one of: ' + DUTY.join(', '));
    if (b.acceptsAppointments !== undefined && typeof b.acceptsAppointments !== 'boolean') throw httpError(400, 'acceptsAppointments must be true or false.');
    const room = b.room === undefined ? undefined : String(b.room).trim().slice(0, 60);
    if (room !== undefined && !room) throw httpError(400, 'Room cannot be empty.');
    db.transaction(() => {
      const changed = {};
      if (b.status !== undefined && b.status !== doctor.status) { db.setDoctorStatus(doctor.id, b.status); changed.status = [doctor.status, b.status]; }
      if (room !== undefined && room !== doctor.room) { db.setDoctorRoom(doctor.id, room); changed.room = [doctor.room, room]; }
      const duty = b.dutyStatus === undefined ? doctor.dutyStatus : b.dutyStatus, acc = b.acceptsAppointments === undefined ? doctor.acceptsAppointments : b.acceptsAppointments;
      if (duty !== doctor.dutyStatus || acc !== doctor.acceptsAppointments) { ops.setDuty(doctor.id, duty, acc); if (duty !== doctor.dutyStatus) changed.duty = [doctor.dutyStatus, duty]; if (acc !== doctor.acceptsAppointments) changed.appointments = [doctor.acceptsAppointments, acc]; }
      if (Object.keys(changed).length) db.logActivity(u, { facilityId: doctor.facilityId, action: 'doctor_updated', entityType: 'doctor', entityId: doctor.id, detail: { name: doctor.name, ...changed } });
    });
    send(ctx.res, 200, { doctor: db.getDoctor(doctor.id), staff: db.staffDoctor(doctor.id) });
  });

  // "Report current wait": patients and staff. One report per person per facility per 10 minutes.
  router.add('POST', '/api/facilities/:id/wait', async ctx => {
    const u = requireUser(ctx);
    const f = db.getFacility(ctx.params.id);
    if (!f) throw httpError(404, 'Unknown hospital.');
    const b = await ctx.body();
    const minutes = Number(b.minutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480) throw httpError(400, 'Wait must be 0 to 480 minutes.');
    if (Date.now() - db.lastWaitByUser(f.id, u.id) < 10 * 60 * 1000) throw httpError(429, 'You already reported for this hospital a moment ago. Please try again in a few minutes.');
    db.addWaitReport(f.id, minutes, u.role, u.id);
    send(ctx.res, 201, { ok: true });
  });

  // Appointment requests for the staff member's hospital (or doctor). Default: from today onwards (as before).
  // Optional filters: scope=all (include past), date=YYYY-MM-DD, status=, doctorId=, unitId=, q= (patient / doctor / reason).
  router.add('GET', '/api/staff/appointments', ctx => {
    const u = requireRole(ctx, 'doctor', 'hospital');
    if (u.role === 'hospital' && !S.can(u, 'appointments', 'view')) throw S.deny('view');   // pharmacy / finance never see patient names
    const today = todayIST(), qy = ctx.query;
    const from = qy.get('scope') === 'all' ? '0000-01-01' : today;
    const rows = u.role === 'hospital' ? db.facilityAppointments(u.facilityId, from) : db.doctorAppointments('d:' + u.doctorId, from);
    const doctors = new Map(db.staffDoctors(u.facilityId || '').map(d => [d.id, d]));
    const date = qy.get('date'), status = qy.get('status'), doctorId = Number(qy.get('doctorId')) || null, unitId = Number(qy.get('unitId')) || null;
    const term = String(qy.get('q') || '').trim().toLowerCase().slice(0, 60);
    const list = rows.map(a => {
      const dId = a.key.startsWith('d:') ? Number(a.key.slice(2)) : null, d = dId ? doctors.get(dId) : null;
      return { ...a, doctorId: dId, unitId: d ? d.unitId : null, unitName: d ? d.unitName : null, spec: d ? d.spec : null };
    }).filter(a => (!date || a.date === date) && (!status || a.status === status) && (!doctorId || a.doctorId === doctorId) && (!unitId || a.unitId === unitId)
      && (!term || [a.patient, a.name, a.reason].some(x => String(x || '').toLowerCase().includes(term))));
    send(ctx.res, 200, { appointments: list.slice(0, 500), total: list.length, today });
  });

  router.add('PUT', '/api/appointments/:id/status', async ctx => {
    const u = requireRole(ctx, 'doctor', 'hospital');
    const a = db.getAppointment(Number(ctx.params.id));
    if (!a) throw httpError(404, 'Unknown appointment.');
    const mine = u.role === 'hospital' ? a.facility_id === u.facilityId : a.provider_key === 'd:' + u.doctorId;
    if (!mine) throw S.crossHospital('This appointment is not for your hospital.');
    if (u.role === 'hospital' && !S.can(u, 'appointments', 'write')) throw S.deny('write');
    const b = await ctx.body();
    if (!['Confirmed', 'Declined'].includes(b.status)) throw httpError(400, 'Status must be Confirmed or Declined.');
    if (a.status === 'Cancelled') throw httpError(409, 'The patient already cancelled this appointment.');
    if (a.status === b.status) return send(ctx.res, 200, { ok: true, status: a.status });
    db.transaction(() => {
      db.setAppointmentStatus(a.id, b.status);
      db.logActivity(u, { facilityId: a.facility_id, action: 'appointment_' + b.status.toLowerCase(), entityType: 'appointment', entityId: a.id, detail: { from: a.status, to: b.status, provider: a.provider_name, date: a.date, time: a.time } });   // no patient name or reason
    });
    send(ctx.res, 200, { ok: true, status: b.status });
  });

  // Front desk: patient check-in (manager, reception, or the doctor concerned) and rescheduling to another free slot.
  const loadAppt = (ctx, cap) => {
    const u = requireRole(ctx, 'doctor', 'hospital');
    const a = db.getAppointment(Number(ctx.params.id));
    if (!a) throw httpError(404, 'Unknown appointment.');
    const mine = u.role === 'hospital' ? a.facility_id === u.facilityId : a.provider_key === 'd:' + u.doctorId;
    if (!mine) throw S.crossHospital('This appointment is not for your hospital.');
    if (u.role === 'hospital') { if (!S.can(u, 'appointments', 'write')) throw S.deny('write'); S.assertOperational(u, db.getStaffFacility(u.facilityId)); }
    return { u, a };
  };
  router.add('PUT', '/api/appointments/:id/checkin', async ctx => {
    const { u, a } = loadAppt(ctx), b = await ctx.body();
    if (a.status !== 'Confirmed') throw httpError(409, 'Only a confirmed appointment can be checked in.');
    const on = b.checkedIn !== false;
    db.transaction(() => {
      gov.raw.prepare('UPDATE appointments SET checked_in_at = ? WHERE id = ?').run(on ? new Date().toISOString() : null, a.id);
      db.logActivity(u, { facilityId: a.facility_id, action: on ? 'appointment_checked_in' : 'appointment_checkin_undone', entityType: 'appointment', entityId: a.id, detail: { provider: a.provider_name, date: a.date, time: a.time } });
    });
    send(ctx.res, 200, { ok: true, checkedIn: on });
  });
  router.add('PUT', '/api/appointments/:id/reschedule', async ctx => {
    const { u, a } = loadAppt(ctx), b = await ctx.body();
    if (!['Requested', 'Confirmed'].includes(a.status)) throw httpError(409, 'Only an open appointment can be rescheduled.');
    const date = String(b.date || ''), time = String(b.time || ''), now = require('../lib/http').istParts();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw httpError(400, 'Choose a valid date.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || ![0, 30].includes(Number(time.slice(3)))) throw httpError(400, 'Choose a valid 30-minute time slot.');
    if (date < now.date || (date === now.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= now.minutes)) throw httpError(400, 'That time has already passed.');
    const crowd = require('../services/crowd');
    db.transaction(() => {
      if (db.slotCount(a.provider_key, date, time) >= crowd.SLOT_CAPACITY[a.provider_type]) throw httpError(409, 'That slot is full. Please pick another.');
      gov.raw.prepare('UPDATE appointments SET date = ?, time = ?, checked_in_at = NULL WHERE id = ?').run(date, time, a.id);
      db.logActivity(u, { facilityId: a.facility_id, action: 'appointment_rescheduled', entityType: 'appointment', entityId: a.id, detail: { provider: a.provider_name, before: { date: a.date, time: a.time }, after: { date, time } } });
    });
    send(ctx.res, 200, { ok: true, date, time });
  });
};
