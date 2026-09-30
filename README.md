# GoaCare – Integrated Healthcare & Emergency Portal

A Node.js back end (no npm packages needed) that also serves the browser client.
Accounts, hospitals (with bed counts) and doctors are stored in a SQLite database on the server; the pages refresh from it every 10 seconds.

## Run it

Requires **Node.js 22.5 or newer** (`node -v` to check).

    npm start

Then open **http://localhost:3000**. Create an account on the "Create Account" tab, sign out, and sign back in.
Do not open `client/index.html` directly from disk – the page needs the server.

**See registered users:** run `npm run users` in a second terminal (shows id, name, phone / Health ID, registration time; never passwords).

**Update the live data** (open pages pick the change up within ~10 seconds):

    npm run facilities                                  list hospitals and bed counts
    npm run doctors                                     list doctors and status
    npm run beds -- gmc-bambolim 12 40 95               set ICU / oxygen / general beds
    npm run doctor-status -- 3 "In Surgery"             Available | In Surgery | On Call
    npm run doctor-room -- 3 "OPD 7"

`npm test` runs the automated API tests. Set `PORT`, `HOST` or `GOACARE_DATA_DIR` to change the port, address or database folder.

## Structure

    goacare/
    ├── package.json
    ├── server/
    │   ├── server.js       HTTP server: /api routes + serves ../client
    │   ├── auth.js         password hashing (scrypt), session tokens, input validation
    │   ├── db.js           SQLite tables: users, sessions, facilities, doctors (file: server/data/goacare.db)
    │   ├── admin.js        command-line tool for hospital beds and doctor status
    │   ├── list-users.js   prints registered users
    │   ├── seed/           facilities.json, doctors.json: loaded into the database on first run only
    │   └── test/auth.test.js
    └── client/
        ├── index.html
        ├── css/            base.css, features.css, auth-gate.css
        └── js/
            ├── api.js      fetch wrapper: GoaAPI.register / login / logout / me
            ├── auth.js     sign-in form, sign-out, session restore, lock screen
            ├── directory.js  loads hospitals and doctors from the server and keeps them fresh
            └── app.js, i18n.js, appointments.js,
                prescriptions.js, stores-insurance.js, session-gate.js, tailwind-config.js

## API

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/api/auth/register` | `{name, phone, password}` | 201 `{user}` + session cookie · 400 invalid · 409 already registered |
| POST | `/api/auth/login` | `{phone, password}` | 200 `{user}` + session cookie · 401 wrong details · 429 too many attempts |
| POST | `/api/auth/logout` | – | 200, cookie cleared |
| GET | `/api/auth/me` | – | 200 `{user}` · 401 not signed in |
| GET | `/api/facilities` | – | 200 `{facilities:[{id, name, careType, district, address, phone, lat, lng, icuBeds, oxygenBeds, generalBeds, specialties, updatedAt}]}` |
| GET | `/api/doctors` | – | 200 `{doctors:[{id, name, spec, hospital, status, room, timings, fee, updatedAt}]}` |

The two directory routes are public and read-only, and support `ETag` / `If-None-Match` so unchanged data answers 304.
Changes are made only through `server/admin.js` on the machine that runs the server.

## Security notes

- Passwords are hashed with scrypt and a per-user salt; they are never stored or returned in plain text.
- The session is a random token in an `HttpOnly`, `SameSite=Lax` cookie; only its SHA-256 hash is stored. Sessions last 7 days.
- Login is limited to 8 failed attempts per ID and address per 15 minutes.
- When you deploy, serve over HTTPS and set `NODE_ENV=production` so the cookie is marked `Secure`.

## Still stored in the browser (next to move to the server)

The user's profile, medical records, appointments and prescriptions.
Each account starts with empty personal data in the browser, so accounts on the same browser do not see each other's information.
