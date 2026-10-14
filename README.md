# GoaCare

Goa health portal: live hospital beds, doctor status, symptom triage that routes to the nearest hospital with the right bed free, appointments. Node 22.5+ only, no npm packages.

## Run
```
npm start                       # http://localhost:3000
npm test                        # server tests
npm run demo-load               # add SIMULATED bookings + wait reports (flagged "demo" in the UI)
npm run demo-clear              # remove them
```
Staff sign-up needs a staff code. The demo default is `GOA-STAFF-DEMO` (printed at start-up). Set `GOACARE_STAFF_CODE` before any real use. Other env: `PORT`, `HOST` (defaults to 0.0.0.0 when `PORT` is set, e.g. on Render, otherwise 127.0.0.1), `GOACARE_DATA_DIR`.

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

## Staff workspace (hospital staff, doctors, administrators)
Signing in with a `hospital`, `doctor` or `admin` account sends you to **`/staff.html`**, a separate workspace with its own sidebar, top bar, search and notifications. It uses the same login and session cookie as the patient portal; patients are sent back to the portal if they open it. Patient pages are unchanged apart from that redirect.
- **Hospital staff** (own hospital only): Overview (real counts, alerts, recent changes), Hospital details (phone / address / specialties, with a verification state), Bed management (free beds + optional capacity; occupied beds are only shown when capacity is entered, otherwise "not recorded"), Units & departments (add / edit / activate / deactivate, assign doctors, link a unit to a bed category), Doctors (search, filter, status, room), Appointments (filters, confirm / decline), Change history.
- **Doctors**: own overview, own appointments (confirm / decline), own availability (`Available`, `In Surgery`, `On Call`) and room.
- **Administrators**: overview counts, users (search, role filter, existing read-only detail view and access log), hospital directory with verification, system activity log; they pick a hospital in the top bar to manage its units, details and doctors. Admin accounts are still only created with `npm run make-admin`.
- API additions: `GET /api/staff/{overview,doctors,hospital,activity,units}`, `PUT /api/staff/hospital`, `POST|PUT /api/staff/units[/:id[/active|/doctors]]`, `GET /api/admin/{overview,facilities,activity}`, `PUT /api/admin/{facilities/:id,units/:id}/verify`; `PUT /api/facilities/:id/beds` also accepts optional `totalIcuBeds / totalOxygenBeds / totalGeneralBeds`; `GET /api/staff/appointments` accepts filters. New tables: `units`, `audit_log` (never stores patient names or health details); new nullable columns on `facilities` and `doctors`, added by safe migrations.
- Staff sign-up with the built-in demo code is refused when `NODE_ENV=production`; set `GOACARE_STAFF_CODE`.
- Try it: `npm start`, register a "Hospital staff" account (code printed at start-up), sign in, and you land in the workspace. `npm test` runs 28 tests (auth, API, staff workspace).

### Hospital operations (second iteration)
- **Staff roles** (hospital accounts): `manager` (full access to their hospital), `nurse` (beds, crowd; view doctors, appointments, costs, stores, assets), `reception` (appointments, doctor duty / availability, crowd). Chosen at sign-up (default `manager`, so older accounts keep working); managers change colleagues' roles in **Settings → Team and roles** (a hospital always keeps one manager). The permission table is `CAPS` in `server/lib/staff.js` and is enforced on every route; the sidebar only mirrors it. Administrators manage the directory (profile, units, doctors, costs, stores, assets, roles) but never beds, crowd or appointments.
- **Bed Management** is per ward (General, ICU, Emergency, Maternity, Paediatric): total, available, optional occupied / out-of-service (blank = not recorded), notes. Available + occupied + out-of-service may not exceed the total. ICU and General also update the hospital counts the patient site and triage already use.
- **Crowd & Waiting Time**: staff-reported level (Low / Moderate / Busy / Very Busy), wait, queue, one-click re-verify. It is labelled as a staff report, never live data, and marked outdated after 2 hours (beds after 24 hours). A reported wait also feeds the patient crowd estimate.
- **Doctors & Staff**: add / edit / remove (archive) doctors with department, timings, duty status (On Duty / Off Duty / On Leave), appointment availability and optional work contact. Off Duty / On Leave shows to patients instead of the live status; bookings are refused when appointments are closed.
- **Hospital Information** (hours, languages, facilities, emergency availability, location, departments and services), **Treatment Costs** (always labelled estimates), **Medical Stores** (availability published only when verified), **Hospital Assets** (internal).
- **Patient website integration**: `GET /api/public/operations` returns verified, non-demo, per-hospital data with timestamps, verification status and `outdated` flags, and no staff names. The patient hospital card now shows a small "Staff report" line from it. Nothing else on the patient site changed except a grey badge for Off Duty / On Leave doctors.
- **Demo data**: `npm run demo-ops` loads clearly flagged sample wards, crowd report, costs, services, store and assets ("Demo" badge for staff, never returned by the public API); `npm run demo-ops -- --clear` removes it. Saving real data for a ward replaces its demo row.
- **Language**: workspace text goes through `Staff.t()` and `Staff.messages` in `client/js/staff-ui.js`. To add Konkani / Hindi / Marathi, add `Staff.messages.kok` etc., then enable the option in Settings. Only the navigation labels are catalogued so far; page text is English.
- Tests: `npm test` (now 36).

## Demo flow (two phones)
1. Phone A: create a **Hospital staff** account (pick a hospital, enter the staff code) -> Staff Dashboard -> change ICU beds -> Save.
2. Phone B (patient or guest): the hospital card changes within ~10 s. Try Symptom Triage > Severe Chest Pain: it lists the nearest hospital with an ICU bed free, not just GMC Bambolim.

## Backend layout
```
server/
  server.js            HTTP bootstrap, static files, router wiring
  db.js                schema, migrations, every SQL query
  auth.js              scrypt hashing, session tokens, roles, staff code
  routes/              auth.js  directory.js  staff.js  dashboard.js  units.js  me.js  admin.js
  services/            crowd.js (booked load + reported wait)  triage.js (red/amber/green + routing)  directory.js (doctor substitutes)
  lib/                 http.js  router.js  throttle.js  geo.js  metrics.js  staff.js (hospital scoping + validation)
  seed/                facilities.json  doctors.json  doctor-facility-map.json
  test/                auth.test.js  api.test.js  staff.test.js
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


## Governance, verification and audit history

Roles, hospital / doctor verification, secure invitations, approvals, medicine inventory, reports, settings and the tamper-evident audit history are documented in
[docs/GOVERNANCE.md](docs/GOVERNANCE.md). `npm test` runs the original suites plus `governance.test.js` and `audit.test.js`.
New hospitals and doctors register **on the login page**: choose *Create an account*, then *Register my hospital (new)* or *Register as a doctor (new)*. The account and the verification request are created together and the person lands on a status page. Invitation links open `/staff.html#/join`.

## AI assistant (Gemini chatbot)

A floating chat button on the patient site (`index.html`) answers questions about hospitals, beds, doctors, crowd levels and how to use GoaCare, using the live public data.

- Files: `server/routes/chat.js` (endpoint `POST /api/chat`), `client/js/chatbot.js`, `client/css/chatbot.css`.
- **Setup:** create a key in Google AI Studio, then set it on the server only: `GEMINI_API_KEY=your-key` (an environment variable, or a line in a git-ignored `.env` file next to `package.json`). Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`), `CHAT_DAILY_LIMIT` (default 1500 questions per day).
- The key is never sent to the browser. Do not paste it into client files or commit it.
- It reads only public data (facilities, doctors, crowd). It never reads accounts, records, prescriptions or staff endpoints, and it cannot book anything.
- Emergency wording (108, Tele-MANAS 14416) is hard-coded on the server and shown even if the AI is off or rate-limited. The AI does not diagnose or advise on medicines.
- Limits: 20 questions per visitor per 10 minutes, plus the daily cap above.
- Without a key the chat shows "The assistant is not set up yet" and the rest of the site is unaffected.
