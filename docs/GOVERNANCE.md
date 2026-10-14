# GoaCare governance: roles, verification, invitations, audit history

This document describes what was added on top of the existing GoaCare app and what is deliberately **not** done.
Stack unchanged: Node 22, built-in SQLite (`node:sqlite`), vanilla JS client, no npm dependencies.

## Roles and permissions

Roles are server-side. The matrix lives in `server/lib/staff.js` (`CAPS`); every protected route calls `S.authorize(...)` or `requireRole(...)`.
The client only hides what the server already refuses.

| Role | How it exists | Can do |
|---|---|---|
| Public user | `users.role = patient` | Everything in the existing patient portal. Can submit a hospital / doctor registration. Nothing internal. |
| Hospital administrator | `hospital` + staff role `manager` | Own hospital only: profile, beds, doctors, appointments, services, costs, team, invitations, approvals, hospital audit history, reports. |
| Doctor / medical officer | `users.role = doctor` | Own profile + availability at hospitals where an **approved affiliation** exists, their appointments, their own activity. |
| Front desk | staff role `reception` | Appointments (confirm / decline / check-in / reschedule), duty status. No beds, costs, inventory, team. |
| Nurse / ward staff | staff role `nurse` | Beds and ward counts. Large capacity changes go to a manager for approval. Read-only costs / inventory. |
| Pharmacy / inventory | staff role `pharmacy` | Medicine inventory, stock adjustments with reasons, inventory reports. No patient data, beds, doctors, appointments. |
| Finance | staff role `finance` | Propose prices (a manager approves before anything is published). No clinical data. |
| Super administrator | `users.role = admin` | Hospital and doctor verification, suspend / reactivate, cross-hospital audit and security alerts. No access to a hospital's internal stock. Cannot edit audit entries. |

Every request re-reads the account from the database, so deactivating an account or ending an affiliation takes effect on the next request
(sessions are also deleted). A manager can never invite another manager; promotion to manager is an approval request.

## Verification

* **Hospitals**: `pending → approved | rejected`, `approved → suspended`, `suspended → approved | rejected`, `rejected → pending` (reopen).
  Approval issues a permanent `GOC-HOS-00001`-style ID from a counter that only goes up. Suspension and reactivation need a reason and the administrator's password.
* **Existing hospitals** were migrated as `legacy = 1` and `pending`. They stay listed and usable (nothing in the app breaks), but are flagged **untrusted** in the public feed
  (`hospital.trusted = false`). Approve them one by one in *Verification* after checking their licence.
* **New registrations** are *unlisted* and publish nothing until approved. The representative becomes the hospital's first manager only on approval.
* **Doctors**: submit details, ask for an affiliation with an approved hospital, the hospital confirms the affiliation, and a super administrator records that they checked the registration number
  against the official register. Only then does the doctor receive a permanent `GOC-DOC-00001`-style ID and the doctor role. An invitation code alone never verifies a doctor.
* No official registry is connected. The "credentials verified" flag is a human decision with a mandatory note, recorded in the audit history.

## Onboarding from the login page

On the existing register form the *I am a* list now has **Register my hospital (new)** and **Register as a doctor (new)** (the old access-code options remain, relabelled).
`POST /api/auth/register` accepts an optional `onboarding` object for plain patient accounts. Everything is validated first, then the account and the registration are created in one transaction (nothing is created if anything is wrong).
The account is always a patient account; hospital-manager or doctor access appears only after a super administrator approves. An optional licence / certificate can be attached in the same step.
New registrations are limited to 5 per connection per hour.

## Invitations

`POST /api/staff/invitations` creates a token (`gci_` + 256 random bits), stores only its SHA-256, and returns the link once. It is bound to hospital, role and recipient (email, or mobile / Health ID),
expires after `GOACARE_INVITE_TTL_HOURS` (default 48, max 168), can be revoked or regenerated, and is consumed by a single conditional `UPDATE` so parallel redemptions cannot both succeed.
The granted role comes from the invitation, never from the request body. Tokens never appear in logs or the audit history.

## Audit history

Table `audit_events` (see `server/lib/audit.js`): event id, server timestamp, actor id and role (from the session), hospital, action, resource, before / after, outcome
(`success | failure | blocked`), reason, request id, optional idempotency key, `prev_hash`, `hash = SHA-256(prev_hash + canonical JSON of the event)`.

* Written **inside the same transaction** as the business change, so a rolled-back change leaves no event. Denied and cross-hospital attempts are written separately (throttled).
* Database triggers refuse `UPDATE` / `DELETE` on audit tables. The API has no edit / delete route; `PUT / PATCH / DELETE / POST /api/audit/events/:id` are refused **and recorded** as `audit_tamper_attempt`.
* `POST /api/audit/verify` recomputes the whole chain and reports `modified`, `missing`, `reordered`, `chain_break`, `checkpoint_mismatch`, `anchor_mismatch`; the result is stored and a failure raises a security alert.
* Checkpoints (head hash) are stored in the database **and** appended to `audit-anchor.log`. With `GOACARE_AUDIT_KEY` set they are HMAC-signed.
* Passwords, tokens and secrets are redacted from payloads; payloads are size-capped; CSV export neutralises spreadsheet formulas.

### Limits you must know about

* A hash chain **cannot stop** a privileged attacker from rewriting the entire chain. Anyone who can open the database file can drop the triggers (the tests do exactly that to prove detection works).
  What detects a full rewrite is a checkpoint that lives somewhere the attacker cannot change: copy `audit-anchor.log` (and keep `GOACARE_AUDIT_KEY`) to a write-once / separate store.
  SQLite has no per-table privileges; with PostgreSQL you would use a separate audit-writer role.
* No backup system is wired in. The app reports `backup.configured = false` rather than inventing a status.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `GOACARE_DATA_DIR` | database, verification documents, audit anchor | `server/data` |
| `GOACARE_STAFF_CODE` | existing staff sign-up code (unchanged) | existing |
| `GOACARE_INVITE_TTL_HOURS` | invitation lifetime | 48 |
| `GOACARE_AUDIT_KEY` | HMAC key that signs audit checkpoints | unset (checkpoints unsigned) |
| `GOACARE_AUDIT_ANCHOR` | path of the append-only anchor file | `<data dir>/audit-anchor.log` |
| `GOACARE_SUPPORT_CONTACT`, `GOACARE_PRIVACY_URL`, `GOACARE_SECURITY_CONTACT` | shown in Settings → Help. Nothing is shown unless you set it. | unset |

## Migrations

`server/gov-db.js` keeps `schema_migrations`: `2026_10_001_governance_tables` (new tables only) and `2026_10_002_mark_legacy_hospitals` (marks existing hospitals legacy).
New columns on existing tables are added with the project's existing idempotent `addCol` pattern in `server/db.js`. Nothing is dropped or rewritten; existing users keep their roles.

## Manual steps after deploying

1. Review every legacy hospital under *Verification* and approve / reject / suspend.
2. Set `GOACARE_AUDIT_KEY`, and copy `audit-anchor.log` to storage the app user cannot rewrite.
3. Create at least one super administrator (`npm run make-admin`).
4. Set the support / privacy variables if you want them shown.

## Known limitations

* Multi-factor sign-in, self-service password reset (needs an SMS / email provider) and profile photos are not available; Settings says so.
* Notifications are in-app alerts only (no email / SMS). Preferences control which alerts appear; security alerts (and, for managers, pending approvals) cannot be disabled.
* The patient site was deliberately left untouched. The API now exposes `verificationStatus`, `hospitalCode`, `hospital.trusted` and per-hospital `medicines` availability, but the patient pages do not yet render these labels.
* Approval workflow covers: finance price changes, large ward-capacity changes by ward staff, and promotion to manager. Hospital suspension uses password re-entry but no second approver.
  Emergency-contact and hospital-ownership changes are not gated.
* Appointment check-in and reschedule exist as API endpoints (`PUT /api/appointments/:id/checkin|reschedule`); the existing appointments page has no buttons for them yet. Atomic admit / discharge
  (`POST /api/staff/wards/:type/occupancy`) is also API-only; the beds page uses the existing form with the new stale-save protection.
* Doctors do not get a dedicated "patient records" module (the app has none); they only see their own appointments.
