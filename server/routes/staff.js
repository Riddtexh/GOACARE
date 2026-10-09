'use strict';
// Actions for hospital and doctor accounts + the "report current wait" button (any signed-in user).
const db = require('../db');
const { send, fail, httpError, todayIST } = require('../lib/http');
const { requireUser, requireRole } = require('../lib/router');

const STATUSES = ['Available', 'In Surgery', 'On Call'];
const bedCount = (v, label) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 5000) throw httpError(400, `${label} must be a whole number from 0 to 5000.`); return n; };

// Which doctors may this staff member change?  A doctor changes themselves; a hospital changes doctors that work at it.
function canManageDoctor(user, doctor) {
  if (user.role === 'doctor') return user.doctorId === doctor.id;
  if (user.role === 'hospital') return user.facilityId === doctor.facilityId;
  return false;
}

module.exports = function (router) {
  // Hospital updates its own beds.  Patients see the change on their next poll (about 10 seconds).
  router.add('PUT', '/api/facilities/:id/beds', async ctx => {
    const u = requireRole(ctx, 'hospital');
    if (u.facilityId !== ctx.params.id) throw httpError(403, 'You can only update the beds of your own hospital.');
    const b = await ctx.body();
    const icu = bedCount(b.icuBeds, 'ICU beds'), oxy = bedCount(b.oxygenBeds, 'Oxygen beds'), gen = bedCount(b.generalBeds, 'General beds');
    if (!db.setBeds(ctx.params.id, icu, oxy, gen)) throw httpError(404, 'Unknown hospital.');
    send(ctx.res, 200, { facility: db.getFacility(ctx.params.id) });
  });

  router.add('PUT', '/api/doctors/:id/status', async ctx => {
    const u = requireRole(ctx, 'doctor', 'hospital');
    const doctor = db.getDoctor(Number(ctx.params.id));
    if (!doctor) throw httpError(404, 'Unknown doctor.');
    if (!canManageDoctor(u, doctor)) throw httpError(403, 'You can only update your own status (or doctors at your hospital).');
    const b = await ctx.body();
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) throw httpError(400, 'Status must be one of: ' + STATUSES.join(', '));
      db.setDoctorStatus(doctor.id, b.status);
    }
    if (b.room !== undefined) {
      const room = String(b.room).trim().slice(0, 60);
      if (!room) throw httpError(400, 'Room cannot be empty.');
      db.setDoctorRoom(doctor.id, room);
    }
    send(ctx.res, 200, { doctor: db.getDoctor(doctor.id) });
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

  // Appointment requests for the staff member's hospital (or doctor).
  router.add('GET', '/api/staff/appointments', ctx => {
    const u = requireRole(ctx, 'doctor', 'hospital');
    const today = todayIST();
    const list = u.role === 'hospital' ? db.facilityAppointments(u.facilityId, today) : db.doctorAppointments('d:' + u.doctorId, today);
    send(ctx.res, 200, { appointments: list });
  });

  router.add('PUT', '/api/appointments/:id/status', async ctx => {
    const u = requireRole(ctx, 'doctor', 'hospital');
    const a = db.getAppointment(Number(ctx.params.id));
    if (!a) throw httpError(404, 'Unknown appointment.');
    const mine = u.role === 'hospital' ? a.facility_id === u.facilityId : a.provider_key === 'd:' + u.doctorId;
    if (!mine) throw httpError(403, 'This appointment is not for your hospital.');
    const b = await ctx.body();
    if (!['Confirmed', 'Declined'].includes(b.status)) throw httpError(400, 'Status must be Confirmed or Declined.');
    if (a.status === 'Cancelled') throw httpError(409, 'The patient already cancelled this appointment.');
    db.setAppointmentStatus(a.id, b.status);
    send(ctx.res, 200, { ok: true });
  });
};
