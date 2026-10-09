'use strict';
// Command-line tool to view and update the live hospital / doctor data.  Run through npm:
//   npm run facilities                          list hospitals with bed counts
//   npm run doctors                             list doctors with status
//   npm run beds -- <facilityId> <icu> <oxygen> <general>     e.g.  npm run beds -- gmc-bambolim 12 40 95
//   npm run doctor-status -- <doctorId> <status>              e.g.  npm run doctor-status -- 3 Available
//   npm run doctor-room -- <doctorId> <room text>
//   npm run demo-load                                         add SIMULATED bookings + wait reports (clearly flagged "demo" in the app) so the crowd view has something to show
//   npm run demo-clear                                        remove all simulated demo data
// The running server and the open web pages pick the change up on their next refresh (about 10 seconds).
const db = require('./db');
const crowd = require('./services/crowd');
const { istParts } = require('./lib/http');
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
} else if (cmd === 'demo-load') {
  // Simulated data for demos only. Every row is stored with source/by_role = 'demo' and the app shows a "includes simulated demo data" notice.
  const { date, minutes } = istParts();
  const slot = crowd.slotOf(minutes + 30);
  const plan = { 'gmc-bambolim': [10, 75], 'asilo-mapusa': [3, 25], 'hospicio-margao': [2, 20], 'sdh-chicalim': [1, 10] };
  let n = 0;
  for (const [fid, [booked, wait]] of Object.entries(plan)) {
    for (let i = 0; i < booked; i++) {
      db.addAppointment({ userId: null, key: 'h:' + fid, type: 'hospital', name: fid, place: 'demo', mapQuery: 'demo', facilityId: fid, date, time: slot, reason: 'simulated demo booking', status: 'Confirmed', source: 'demo' });
      n++;
    }
    db.addWaitReport(fid, wait, 'demo', null);
  }
  console.log('Added ' + n + ' simulated bookings and ' + Object.keys(plan).length + ' simulated wait reports for ' + date + ' (slot ' + slot + '). Remove with: npm run demo-clear');
} else if (cmd === 'demo-clear') {
  db.clearDemo();
  console.log('Simulated demo bookings and wait reports removed.');
} else {
  die('Commands: facilities | doctors | beds | doctor-status | doctor-room | demo-load | demo-clear  (use through "npm run ...", see the comments at the top of server/admin.js)');
}
