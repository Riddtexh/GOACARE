# GoaCare

Goa health portal: live hospital beds, doctor status, symptom triage that routes to the nearest hospital with the right bed free, appointments. Node 22.5+ only, no npm packages.

## Run
```
npm start                       # http://localhost:3000
npm test                        # server tests
npm run demo-load               # add SIMULATED bookings + wait reports (flagged "demo" in the UI)
npm run demo-clear              # remove them
```
Staff sign-up needs a staff code. The demo default is `GOA-STAFF-DEMO` (printed at start-up). Set `GOACARE_STAFF_CODE` before any real use. Other env: `PORT`, `HOST`, `GOACARE_DATA_DIR`.

## Admin: see who has registered and what is stored
Admin accounts cannot be created from the website (sign-up refuses the `admin` role). Promote an account from the machine that runs the server:
```
npm run make-admin -- <mobile number or Health ID>            # the person must have registered first; they then reload the page to see the Admin tab
npm run make-admin -- <mobile number or Health ID> --revoke   # back to a normal patient account
npm run make-admin -- --list                                  # current admins
npm run users                                                 # plain command-line list of every registered user (no app needed)
```
The admin sees an **Administration** tab (`client/js/admin.js`): every account with role, mobile / Health ID, registration time, consent status and item counts, a search box, and a detail view with the profile, medical history, prescription details, appointments and DDSSY claims. It is read-only. Password hashes, salts, session tokens and prescription photos are never sent to the admin. Every list / detail view is written to the `admin_audit` table and shown in the "Admin activity log". API: `GET /api/admin/users?q=`, `GET /api/admin/users/:id`, `GET /api/admin/audit` (admin role only, in `server/routes/admin.js`).
The consent dialog tells patients that the programme administrator can view their stored account data. Keep that wording true if you change this feature.

## Demo flow (two phones)
1. Phone A: create a **Hospital staff** account (pick a hospital, enter the staff code) -> Staff Dashboard -> change ICU beds -> Save.
2. Phone B (patient or guest): the hospital card changes within ~10 s. Try Symptom Triage > Severe Chest Pain: it lists the nearest hospital with an ICU bed free, not just GMC Bambolim.

## Backend layout
```
server/
  server.js            HTTP bootstrap, static files, router wiring
  db.js                schema, migrations, every SQL query
  auth.js              scrypt hashing, session tokens, roles, staff code
  routes/              auth.js  directory.js  staff.js  me.js  admin.js
  services/            crowd.js (booked load + reported wait)  triage.js (red/amber/green + routing)  directory.js (doctor substitutes)
  lib/                 http.js  router.js  throttle.js  geo.js  metrics.js
  seed/                facilities.json  doctors.json  doctor-facility-map.json
  test/                auth.test.js  api.test.js
  admin.js  list-users.js  make-admin.js   command-line tools
```

## What is real and what is simulated
- Real: accounts + roles, bed counts (changed by hospital staff), doctor status, appointments, crowd = booked load + reported wait, triage routing from live beds, server-side records with consent / export / delete.
- Seed data: the starting bed counts and doctor list are placeholders until staff update them. Hospitals show "not yet confirmed by the hospital" until then. 26 of 35 phone numbers were placeholders (108) and are now blank ("phone not verified"); add real numbers in `server/seed/facilities.json`.
- Simulated only when you run `npm run demo-load`; the UI then says so.
- Triage is decision support, not diagnosis; the red-flag rules need clinician review.
- DDSSY: an indicative estimate and a health-insurance estimate. Not connected to the scheme.
- Konkani / Hindi / Marathi strings (emergency, triage, hospital cards, navigation) are machine-translated and need native-speaker review (see the header of `client/js/i18n.js`).
- Offline: first online visit caches the app (service worker). The 108/104 buttons and `offline.html` work with no connection at all.
