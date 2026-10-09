'use strict';
// Grant or remove admin rights.  This only works on the machine that runs the server (it opens the database file directly),
// so nobody can make themselves an admin through the website.
//   npm run make-admin -- <mobile number or Health ID>            promote an existing account to admin
//   npm run make-admin -- <mobile number or Health ID> --revoke   turn an admin back into a patient
//   npm run make-admin -- --list                                  show current admins
// The person must have registered first (sign up as a normal patient), then sign out and in again to see the Admin tab.
const db = require('./db');
const auth = require('./auth');
const die = msg => { console.error(msg); process.exit(1); };
const args = process.argv.slice(2);

if (args.includes('--list')) {
  const admins = db.adminListUsers('').filter(u => u.role === 'admin');
  if (admins.length) console.table(admins.map(u => ({ id: u.id, name: u.name, 'mobile / health id': u.phone })));
  else console.log('No admin accounts yet.');
  process.exit(0);
}
const revoke = args.includes('--revoke');
const target = args.filter(a => !a.startsWith('--')).join(' ');
if (!target) die('Usage: npm run make-admin -- <mobile number or Health ID> [--revoke]   |   npm run make-admin -- --list');

const row = db.findUserByLogin(auth.normaliseLoginId(target));
if (!row) die('No registered account for "' + target + '". Register it in the app first, then run this again.');
if (revoke) {
  if (row.role !== 'admin') die(row.name + ' is not an admin.');
  db.setUserRole(row.id, 'patient');
  console.log(row.name + ' is no longer an admin (now a patient).');
} else {
  if (row.role === 'admin') die(row.name + ' is already an admin.');
  if (row.role !== 'patient') die(row.name + ' is a ' + row.role + ' account. Use a separate patient-type account for admin work.');
  db.setUserRole(row.id, 'admin');
  console.log(row.name + ' is now an admin. Sign out and sign in again to see the Admin tab.');
}
