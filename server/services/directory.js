'use strict';
// Directory helpers: doctor list with a ready-made "substitute" for doctors who cannot see patients right now.
const db = require('../db');
const { distanceKm } = require('../lib/geo');

function doctorsWithSubstitutes() {
  const facilities = Object.fromEntries(db.listFacilities().map(f => [f.id, f]));
  const doctors = db.listDoctors();
  const available = doctors.filter(d => d.status === 'Available');
  return doctors.map(d => {
    if (d.status === 'Available') return { ...d, substitute: null };
    const home = facilities[d.facilityId];
    const pool = available.filter(x => x.id !== d.id && x.spec === d.spec);
    pool.sort((a, b) => {
      const sameA = a.facilityId === d.facilityId ? 0 : 1, sameB = b.facilityId === d.facilityId ? 0 : 1;
      if (sameA !== sameB) return sameA - sameB;                       // same hospital first
      const fa = facilities[a.facilityId], fb = facilities[b.facilityId];
      if (!home || !fa || !fb) return 0;
      return distanceKm(home.lat, home.lng, fa.lat, fa.lng) - distanceKm(home.lat, home.lng, fb.lat, fb.lng);   // then nearest
    });
    const s = pool[0];
    return { ...d, substitute: s ? { id: s.id, name: s.name, hospital: s.hospital, facilityId: s.facilityId, room: s.room, timings: s.timings, sameHospital: s.facilityId === d.facilityId } : null };
  });
}

module.exports = { doctorsWithSubstitutes };
