'use strict';
// The signed-in person's own data: profile, medical history, prescriptions, appointments, DDSSY claims, consent, export, delete.
// Nothing here is readable by other users.  Saving anything requires the privacy consent first.
const db = require('../db');
const crowd = require('../services/crowd');
const { send, fail, httpError, readJson, todayIST, istParts } = require('../lib/http');
const { requireUser, requireConsent } = require('../lib/router');

const str = (v, max, label, required = false) => {
  const s = String(v == null ? '' : v).trim();
  if (required && !s) throw httpError(400, `${label} is required.`);
  if (s.length > max) throw httpError(400, `${label} is too long (max ${max} characters).`);
  return s;
};
const isoDate = (v, label, required = true) => {
  const s = String(v || '').trim();
  if (!s && !required) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw httpError(400, `${label} must be a date (YYYY-MM-DD).`);
  return s;
};
const PROFILE_FIELDS = ['name', 'phone', 'emergencyContact', 'bloodGroup', 'ddssyCard', 'address', 'allergies', 'conditions'];
const CLAIM_STAGES = ['Submitted', 'Documents verified', 'Approved', 'Paid', 'Rejected'];
const MAX_IMG = 1_800_000;   // characters of base64 data URL (~1.3 MB image)

function allData(u) {
  return {
    profile: db.getProfile(u.id), records: db.listRecords(u.id), prescriptions: db.listPrescriptions(u.id),
    appointments: db.userAppointments(u.id), claims: db.listClaims(u.id), consentAt: u.consentAt
  };
}

module.exports = function (router) {
  router.add('GET', '/api/me/data', ctx => { const u = requireUser(ctx); send(ctx.res, 200, allData(u)); });

  router.add('POST', '/api/me/consent', async ctx => {
    const u = requireUser(ctx);
    const b = await ctx.body();
    if (b.accept !== true) throw httpError(400, 'Consent must be accepted to store health data.');
    db.setConsent(u.id);
    send(ctx.res, 200, { consentAt: db.findUserById(u.id).consentAt });
  });

  router.add('PUT', '/api/me/profile', async ctx => {
    const u = requireConsent(ctx);
    const b = await ctx.body();
    const data = {};
    for (const k of PROFILE_FIELDS) data[k] = str(b[k], k === 'address' ? 200 : 120, k);
    db.putProfile(u.id, data);
    send(ctx.res, 200, { profile: data });
  });

  router.add('POST', '/api/me/records', async ctx => {
    const u = requireConsent(ctx);
    const b = await ctx.body();
    const rec = {
      date: isoDate(b.date, 'Date'), facility: str(b.facility, 160, 'Facility / doctor', true), diagnosis: str(b.diagnosis, 200, 'Diagnosis', true),
      prescription: str(b.prescription, 1000, 'Treatment', true), followup: isoDate(b.followup, 'Follow-up date', false)
    };
    send(ctx.res, 201, { record: { id: db.addRecord(u.id, rec), ...rec } });
  });
  router.add('DELETE', '/api/me/records/:id', ctx => {
    const u = requireUser(ctx);
    if (!db.deleteRecord(u.id, Number(ctx.params.id))) throw httpError(404, 'Record not found.');
    send(ctx.res, 200, { ok: true });
  });

  router.add('POST', '/api/me/prescriptions', async ctx => {
    const u = requireConsent(ctx);
    const b = await readJson(ctx.req, 2_500_000);
    if (typeof b.img !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.img)) throw httpError(400, 'Prescription image must be a JPEG.');
    if (b.img.length > MAX_IMG) throw httpError(413, 'That image is too large. Please use a smaller photo.');
    if (db.prescriptionCount(u.id) >= 30) throw httpError(409, 'You can store up to 30 prescription images. Delete an old one first.');
    const rx = { date: isoDate(b.date, 'Date'), doctor: str(b.doctor, 160, 'Doctor / facility', true), note: str(b.note, 200, 'Note'), img: b.img };
    send(ctx.res, 201, { prescription: { id: db.addPrescription(u.id, rx), date: rx.date, doctor: rx.doctor, note: rx.note } });
  });
  router.add('DELETE', '/api/me/prescriptions/:id', ctx => {
    const u = requireUser(ctx);
    if (!db.deletePrescription(u.id, Number(ctx.params.id))) throw httpError(404, 'Prescription not found.');
    send(ctx.res, 200, { ok: true });
  });
  router.add('GET', '/api/me/prescriptions/:id/image', ctx => {
    const u = requireUser(ctx);
    const img = db.prescriptionImage(u.id, Number(ctx.params.id));
    if (!img) throw httpError(404, 'Prescription not found.');
    const buf = Buffer.from(img.split(',')[1], 'base64');
    ctx.res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=3600' });
    ctx.res.end(buf);
  });

  // ----- appointments: stored on the server so the crowd numbers count every booking -----
  router.add('POST', '/api/me/appointments', async ctx => {
    const u = requireConsent(ctx);
    const b = await ctx.body();
    const key = String(b.key || '');
    let p;
    if (key.startsWith('d:')) {
      const d = db.getDoctor(Number(key.slice(2)));
      if (!d) throw httpError(404, 'Unknown doctor.');
      p = { type: 'doctor', name: d.name, place: d.hospital + ' · ' + d.room, mapQuery: d.hospital + ', Goa', facilityId: d.facilityId, key: 'd:' + d.id };
    } else if (key.startsWith('h:')) {
      const f = db.getFacility(key.slice(2));
      if (!f) throw httpError(404, 'Unknown hospital.');
      p = { type: 'hospital', name: f.name, place: f.address, mapQuery: f.name + ', ' + f.address, facilityId: f.id, key: 'h:' + f.id };
    } else throw httpError(400, 'Choose a doctor or a hospital.');

    const date = isoDate(b.date, 'Date');
    const time = String(b.time || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || ![0, 30].includes(Number(time.slice(3)))) throw httpError(400, 'Choose a valid 30-minute time slot.');
    const now = istParts();
    if (date < now.date || (date === now.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= now.minutes)) throw httpError(400, 'That time has already passed.');
    if (date > new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10)) throw httpError(400, 'Appointments can be requested up to 120 days ahead.');

    const reason = str(b.reason, 200, 'Reason') || 'General consultation';
    const id = db.transaction(() => {
      if (db.userHasSlot(u.id, p.key, date, time)) throw httpError(409, 'You already requested this slot.');
      if (db.slotCount(p.key, date, time) >= crowd.SLOT_CAPACITY[p.type]) throw httpError(409, 'That slot is full. Please pick another.', { code: 'slot_full' });
      return db.addAppointment({ userId: u.id, ...p, date, time, reason });
    });
    send(ctx.res, 201, { appointment: db.userAppointments(u.id).find(a => a.id === id) });
  });
  router.add('PUT', '/api/me/appointments/:id/cancel', ctx => {
    const u = requireUser(ctx);
    const a = db.getAppointment(Number(ctx.params.id));
    if (!a || a.user_id !== u.id) throw httpError(404, 'Appointment not found.');
    db.setAppointmentStatus(a.id, 'Cancelled');
    send(ctx.res, 200, { ok: true });
  });

  // ----- DDSSY reimbursement tracker (self-reported; the app does not talk to the scheme) -----
  router.add('POST', '/api/me/claims', async ctx => {
    const u = requireConsent(ctx);
    const b = await ctx.body();
    const amount = Number(b.amount || 0);
    if (!Number.isInteger(amount) || amount < 0 || amount > 100000000) throw httpError(400, 'Amount must be a whole number of rupees.');
    const c = {
      procedure: str(b.procedure, 160, 'Procedure', true), hospital: str(b.hospital, 160, 'Hospital', true), amount,
      submittedOn: isoDate(b.submittedOn || todayIST(), 'Submitted date'), stage: 'Submitted', note: str(b.note, 300, 'Note')
    };
    send(ctx.res, 201, { claim: { id: db.addClaim(u.id, c), ...c, updatedAt: new Date().toISOString() } });
  });
  router.add('PUT', '/api/me/claims/:id', async ctx => {
    const u = requireConsent(ctx);
    const b = await ctx.body();
    if (!CLAIM_STAGES.includes(b.stage)) throw httpError(400, 'Stage must be one of: ' + CLAIM_STAGES.join(', '));
    if (!db.setClaim(u.id, Number(ctx.params.id), b.stage, str(b.note, 300, 'Note'))) throw httpError(404, 'Claim not found.');
    send(ctx.res, 200, { ok: true });
  });
  router.add('DELETE', '/api/me/claims/:id', ctx => {
    const u = requireUser(ctx);
    if (!db.deleteClaim(u.id, Number(ctx.params.id))) throw httpError(404, 'Claim not found.');
    send(ctx.res, 200, { ok: true });
  });

  // ----- your data, your control -----
  router.add('GET', '/api/me/export', ctx => {
    const u = requireUser(ctx);
    const rx = db.listPrescriptions(u.id).map(r => ({ ...r, image: db.prescriptionImage(u.id, r.id) }));
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), account: { name: u.name, phone: u.phone, role: u.role }, ...allData(u), prescriptions: rx }, null, 2);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="goacare-my-data.json"', 'Cache-Control': 'no-store' });
    ctx.res.end(body);
  });

  // Delete my data: removes the account and everything stored for it (profile, history, prescriptions, appointments, claims, sessions).
  router.add('DELETE', '/api/me', async ctx => {
    const u = requireUser(ctx);
    const b = await ctx.body();
    if (b.confirm !== 'DELETE') throw httpError(400, 'Send {"confirm":"DELETE"} to delete your account and all stored data.');
    db.deleteUser(u.id);
    send(ctx.res, 200, { ok: true }, { 'Set-Cookie': require('../lib/http').sessionCookie(ctx.req, '', 0) });
  });
};
