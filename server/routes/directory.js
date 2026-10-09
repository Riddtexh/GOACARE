'use strict';
// Public, read-only live data: hospitals, doctors, crowd, triage routing, alternatives, impact numbers.
const db = require('../db');
const crowd = require('../services/crowd');
const triage = require('../services/triage');
const { doctorsWithSubstitutes } = require('../services/directory');
const { send, fail, sendCached, readJson, istParts, httpError } = require('../lib/http');
const { parseLocation } = require('../lib/geo');
const metrics = require('../lib/metrics');

const DAY = 24 * 60 * 60 * 1000;

module.exports = function (router) {
  router.add('GET', '/api/health', ctx => send(ctx.res, 200, { ok: true }));

  router.add('GET', '/api/facilities', ctx => sendCached(ctx.req, ctx.res, { facilities: db.listFacilities() }));
  router.add('GET', '/api/doctors', ctx => sendCached(ctx.req, ctx.res, { doctors: doctorsWithSubstitutes() }));

  // Booked load per slot + wait reports. ?date=YYYY-MM-DD (defaults to today in Goa)
  router.add('GET', '/api/crowd', ctx => {
    const d = ctx.query.get('date');
    const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : istParts().date;
    sendCached(ctx.req, ctx.res, (({ updatedAt, ...rest }) => rest)(crowd.snapshot(date)));   // updatedAt omitted so unchanged data stays a 304
  });

  // Symptom -> red/amber/green + nearest facility that has the right bed free right now.
  router.add('GET', '/api/triage', ctx => {
    const code = ctx.query.get('symptom');
    if (!triage.PROTOCOL[code]) return fail(ctx.res, 400, 'Unknown symptom. Use one of: ' + Object.keys(triage.PROTOCOL).join(', '));
    send(ctx.res, 200, triage.recommend(code, parseLocation(ctx.query)));
  });

  // "Less crowded alternative": nearest public facility with the same specialty and lower load.
  router.add('GET', '/api/alternatives', ctx => {
    const r = triage.alternatives(ctx.query.get('facilityId') || triage.GMC, ctx.query.get('specialty'), parseLocation(ctx.query));
    if (!r) return fail(ctx.res, 404, 'Unknown facility.');
    send(ctx.res, 200, r);
  });

  // Counts a tap on an alternative suggestion (anonymous, no user id).
  router.add('POST', '/api/redirects', async ctx => {
    const b = await ctx.body();
    const from = db.getFacility(String(b.from || '')), to = db.getFacility(String(b.to || ''));
    if (!from || !to || from.id === to.id) return fail(ctx.res, 400, 'Invalid redirect.');
    db.addRedirect(from.id, to.id, 'alternative');
    send(ctx.res, 201, { ok: true });
  });

  // Numbers for the home strip and the health-department view.
  router.add('GET', '/api/impact', ctx => {
    const facilities = db.listFacilities();
    const now = Date.now();
    const live = facilities.filter(f => f.staffUpdatedAt && now - Date.parse(f.staffUpdatedAt) < DAY).length;
    const total = { icu: 0, oxygen: 0, general: 0 };
    facilities.forEach(f => { total.icu += f.icuBeds; total.oxygen += f.oxygenBeds; total.general += f.generalBeds; });
    const snap = crowd.snapshot(istParts().date);
    const crowded = facilities.filter(f => crowd.nowFor('h:' + f.id, 'hospital', f.id, snap).pct >= 60).map(f => f.name);
    send(ctx.res, 200, {
      facilities: facilities.length,
      facilitiesLive: live,                       // beds changed by hospital staff in the last 24 h
      phonesVerified: facilities.filter(f => f.phoneVerified).length,
      freeBeds: total,
      crowdedNow: crowded,
      redirectsThisWeek: db.redirectsSince(now - 7 * DAY),
      redirectsNote: 'Routing suggestions that sent a person away from GMC Bambolim (triage results and taps on "less crowded alternative"). Not confirmed arrivals.',
      demoData: { bookings: snap.demo.bookings, waitReports: snap.demo.waitReports },
      api: { avgMs: metrics.avg(), requests: metrics.count() }
    });
  });
};
