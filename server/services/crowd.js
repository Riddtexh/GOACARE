'use strict';
// Crowd = booked load + reported wait.  No random numbers and no time-of-day curve.
//   load  : appointments booked in the same 30-minute slot, as a share of that provider's slot capacity (from our own database)
//   wait  : median of "current wait" reports (patients + staff) for the facility in the last 3 hours
// When both exist they are blended (40% load, 60% wait: a real wait report is the stronger signal); otherwise whichever exists is used.
const db = require('../db');
const { istParts } = require('../lib/http');

const SLOT_CAPACITY = { doctor: 4, hospital: 12 };
const WAIT_WINDOW_MS = 3 * 60 * 60 * 1000;
const WAIT_FULL_MINUTES = 90;        // a reported wait of 90 min or more counts as "100% crowded"

const median = arr => { const s = arr.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const pad = n => String(n).padStart(2, '0');
const slotOf = minutes => { const s = Math.floor(minutes / 30) * 30; return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };

function levelOf(pct) { return pct < 35 ? 'low' : pct < 60 ? 'moderate' : pct < 80 ? 'high' : 'veryHigh'; }

// Wait reports per facility: { facilityId: { minutes, reports, staffReports, ageMin, demo } }
function waitSummary(now = Date.now()) {
  const by = {};
  for (const r of db.recentWaits(now - WAIT_WINDOW_MS)) (by[r.f] = by[r.f] || []).push(r);
  const out = {};
  for (const [f, list] of Object.entries(by)) {
    out[f] = {
      minutes: median(list.map(x => x.m)), reports: list.length,
      staffReports: list.filter(x => x.r === 'doctor' || x.r === 'hospital').length,
      ageMin: Math.round((now - list[0].t) / 60000), demo: list.some(x => x.r === 'demo')
    };
  }
  return out;
}

// Bookings for one date: { 'h:gmc-bambolim': { '10:00': 3 } }, plus a count of simulated demo bookings.
function loadSummary(date) {
  const load = {}; let demo = 0;
  for (const r of db.loadForDate(date)) { (load[r.k] = load[r.k] || {})[r.t] = r.n; demo += r.demo || 0; }
  return { load, demo };
}

function snapshot(date) {
  const { load, demo } = loadSummary(date);
  const waits = waitSummary();
  const demoWaits = Object.values(waits).filter(w => w.demo).length;
  return { date, updatedAt: new Date().toISOString(), load, waits, capacity: SLOT_CAPACITY, demo: { bookings: demo, waitReports: demoWaits }, formula: 'crowd = 40% booked load + 60% reported wait (load only if no wait reports)' };
}

// Crowd percentage for a provider right now (used by routing). Returns { pct, level, source, waitMinutes }.
function nowFor(providerKey, providerType, facilityId, snap) {
  const { date, minutes } = istParts();
  snap = snap || snapshot(date);
  const cap = SLOT_CAPACITY[providerType] || 4;
  const booked = ((snap.load[providerKey] || {})[slotOf(minutes)]) || 0;
  const loadPct = Math.min(100, Math.round(booked / cap * 100));
  const w = snap.waits[facilityId];
  if (!w) return { pct: loadPct, level: levelOf(loadPct), source: booked ? 'booked' : 'none', waitMinutes: null, booked };
  const waitPct = Math.min(100, Math.round(w.minutes / WAIT_FULL_MINUTES * 100));
  const pct = Math.round(0.4 * loadPct + 0.6 * waitPct);
  return { pct, level: levelOf(pct), source: 'booked+reported', waitMinutes: w.minutes, booked };
}

module.exports = { SLOT_CAPACITY, WAIT_FULL_MINUTES, snapshot, nowFor, levelOf, slotOf };
