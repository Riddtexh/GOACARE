'use strict';
// Symptom triage = decision support, NOT diagnosis.
// A deliberately small red / amber / green scheme:
//   RED    life-threatening red flag  -> call 108 now, go to the nearest facility that has the right bed free
//   AMBER  needs a doctor today       -> nearest facility with a free bed and the right department
//   GREEN  can usually wait for OPD   -> a public facility with the lowest crowd
// Red flags follow widely used first-aid screening rules (e.g. the FAST check for stroke, chest pain with sweating or lasting
// more than a few minutes, severe breathlessness, labour). A clinician should review the rules before any real-world use.
// The user-facing wording lives in the client (translated); this module returns codes + live facility recommendations.
const db = require('../db');
const crowd = require('./crowd');
const { distanceKm } = require('../lib/geo');
const { istParts } = require('../lib/http');

const GMC = 'gmc-bambolim';
const CRITICAL_REGEX = /Cardio|Critical Care|Emergency|Casualty|Trauma/i;

const PROTOCOL = {
  chest_pain: { level: 'red',   call108: true,  bed: 'icu',     spec: /Cardio|Critical Care|Emergency|Casualty/i },
  stroke:     { level: 'red',   call108: true,  bed: 'icu',     spec: /Neuro|Critical Care|Emergency|Casualty/i },
  breath:     { level: 'red',   call108: true,  bed: 'oxygen',  spec: /Pulmo|Critical Care|Emergency|Casualty|General Medicine/i },
  maternity:  { level: 'red',   call108: false, bed: 'general', spec: /Maternity|Gynecology/i },
  trauma:     { level: 'amber', call108: false, bed: 'general', spec: /Trauma|Orthop|Casualty|Emergency|Surgery/i },
  fever:      { level: 'amber', call108: false, bed: 'general', spec: /General Medicine|Pediatrics|Casualty/i },
  minor:      { level: 'green', call108: false, bed: 'general', spec: /General Medicine/i }
};
const BED_FIELD = { icu: 'icuBeds', oxygen: 'oxygenBeds', general: 'generalBeds' };

function recommend(code, loc) {
  const p = PROTOCOL[code];
  if (!p) return null;
  const snap = crowd.snapshot(istParts().date);
  const field = BED_FIELD[p.bed];
  const candidates = db.listFacilities()
    .filter(f => f[field] > 0 && f.specialties.some(s => p.spec.test(s)))
    .filter(f => p.level === 'green' ? f.careType === 'Public' : true)
    .map(f => {
      const c = crowd.nowFor('h:' + f.id, 'hospital', f.id, snap);
      const km = loc ? distanceKm(loc.lat, loc.lng, f.lat, f.lng) : null;
      // Cost used for ranking (lower is better). Distance dominates; GMC gets a penalty when it is crowded and the case is not critical.
      let cost = (km == null ? 0 : km) - Math.min(f[field], 20) * 0.2;
      if (f.id === GMC && p.level !== 'red' && c.pct >= 60) cost += 15;
      if (p.level === 'green') cost += c.pct * 0.1;
      return { f, c, km, cost };
    })
    .sort((a, b) => a.cost - b.cost);

  const top = candidates.slice(0, 3).map(({ f, c, km }) => ({
    id: f.id, name: f.name, careType: f.careType, district: f.district, address: f.address, phone: f.phone, phoneVerified: f.phoneVerified,
    lat: f.lat, lng: f.lng, distanceKm: km == null ? null : Math.round(km * 10) / 10,
    freeBeds: { icu: f.icuBeds, oxygen: f.oxygenBeds, general: f.generalBeds }, bedType: p.bed,
    crowdPct: c.pct, crowdLevel: c.level, bedsUpdatedAt: f.staffUpdatedAt || f.updatedAt, staffVerified: !!f.staffUpdatedAt
  }));

  // "Redirect" = GMC could have treated this case, but the app sent the person somewhere else.
  const gmcEligible = candidates.some(x => x.f.id === GMC);
  let redirectedFromGmc = false;
  if (top.length && top[0].id !== GMC && gmcEligible) {
    redirectedFromGmc = true;
    db.addRedirect(GMC, top[0].id, 'triage');
  }
  return {
    symptom: code, level: p.level, call108: p.call108, need: p.bed, recommendations: top, redirectedFromGmc,
    locationUsed: !!loc, disclaimer: 'decision-support-only'
  };
}

// Nearest public facility with the same specialty and a lower crowd than the crowded one.
function alternatives(facilityId, specialty, loc) {
  const from = db.getFacility(facilityId);
  if (!from) return null;
  const snap = crowd.snapshot(istParts().date);
  const base = crowd.nowFor('h:' + from.id, 'hospital', from.id, snap);
  const ref = loc || { lat: from.lat, lng: from.lng };
  const list = db.listFacilities()
    .filter(f => f.id !== from.id && f.careType === 'Public' && f.generalBeds > 0)
    .filter(f => !specialty || f.specialties.some(s => s.toLowerCase() === String(specialty).toLowerCase()))
    .map(f => ({ f, c: crowd.nowFor('h:' + f.id, 'hospital', f.id, snap), km: distanceKm(ref.lat, ref.lng, f.lat, f.lng) }))
    .filter(x => x.c.pct < base.pct || base.pct >= 60)
    .sort((a, b) => a.km - b.km)
    .slice(0, 3)
    .map(({ f, c, km }) => ({ id: f.id, name: f.name, district: f.district, phone: f.phone, phoneVerified: f.phoneVerified, address: f.address, distanceKm: Math.round(km * 10) / 10, crowdPct: c.pct, crowdLevel: c.level, generalBeds: f.generalBeds }));
  return { from: { id: from.id, name: from.name, crowdPct: base.pct, crowdLevel: base.level }, specialty: specialty || null, crowded: base.pct >= 60, alternatives: list };
}

module.exports = { PROTOCOL, recommend, alternatives, GMC };
