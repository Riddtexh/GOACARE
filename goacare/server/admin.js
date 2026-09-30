'use strict';
// Command-line tool to view and update the live hospital / doctor data.  Run through npm:
//   npm run facilities                          list hospitals with bed counts
//   npm run doctors                             list doctors with status
//   npm run beds -- <facilityId> <icu> <oxygen> <general>     e.g.  npm run beds -- gmc-bambolim 12 40 95
//   npm run doctor-status -- <doctorId> <status>              e.g.  npm run doctor-status -- 3 Available
//   npm run doctor-room -- <doctorId> <room text>
// The running server and the open web pages pick the change up on their next refresh (about 10 seconds).
const db = require('./db');
const STATUSES = ['Available', 'In Surgery', 'On Call'];
const [cmd, ...args] = process.argv.slice(2);
const die = msg => { console.error(msg); process.exit(1); };
const count = v => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 5000) die('Bed counts must be whole numbers from 0 to 5000 (got "' + v + '").'); return n; };

if (cmd === 'facilities') {
  console.table(db.listFacilities().map(f => ({ id: f.id, name: f.name, type: f.careType, district: f.district, ICU: f.icuBeds, oxygen: f.oxygenBeds, general: f.generalBeds, updated: f.updatedAt })));
} else if (cmd === 'doctors') {
  console.table(db.listDoctors().map(d => ({ id: d.id, name: d.name, spec: d.spec, hospital: d.hospital, status: d.status, room: d.room, updated: d.updatedAt })));
} else if (cmd === 'beds') {
  if (args.length !== 4) die('Usage: npm run beds -- <facilityId> <icu> <oxygen> <general>');
  const [id, icu, oxy, gen] = args;
  if (!db.setBeds(id, count(icu), count(oxy), count(gen))) die('No hospital with id "' + id + '". Run: npm run facilities');
  console.log('Updated beds for ' + id + ': ICU ' + icu + ', oxygen ' + oxy + ', general ' + gen);
} else if (cmd === 'doctor-status') {
  const id = Number(args[0]); const status = args.slice(1).join(' ');
  if (!Number.isInteger(id) || !STATUSES.includes(status)) die('Usage: npm run doctor-status -- <doctorId> <' + STATUSES.join(' | ') + '>');
  if (!db.setDoctorStatus(id, status)) die('No doctor with id ' + id + '. Run: npm run doctors');
  console.log('Doctor ' + id + ' is now "' + status + '"');
} else if (cmd === 'doctor-room') {
  const id = Number(args[0]); const room = args.slice(1).join(' ').trim();
  if (!Number.isInteger(id) || !room) die('Usage: npm run doctor-room -- <doctorId> <room>');
  if (!db.setDoctorRoom(id, room)) die('No doctor with id ' + id + '. Run: npm run doctors');
  console.log('Doctor ' + id + ' room is now "' + room + '"');
} else {
  die('Commands: facilities | doctors | beds | doctor-status | doctor-room  (use through "npm run ...", see the comments at the top of server/admin.js)');
}
