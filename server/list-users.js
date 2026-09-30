'use strict';
// Prints every registered user (never the password hashes).  Usage: npm run users
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const file = path.join(process.env.GOACARE_DATA_DIR || path.join(__dirname, 'data'), 'goacare.db');
if (!fs.existsSync(file)) {
  console.log('No database yet (' + file + '). Start the server and register a user first.');
  process.exit(0);
}
const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare(`
  SELECT u.id, u.name, u.phone AS "phone / health id", u.created_at AS registered,
         (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS "active sessions"
  FROM users u ORDER BY u.id`).all(Date.now());
if (!rows.length) console.log('No users registered yet.');
else { console.table(rows); console.log(rows.length + ' user(s) in ' + file); }
