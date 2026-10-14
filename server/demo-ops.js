'use strict';
// Loads SAMPLE operational data so the staff workspace can be demonstrated: wards, a crowd report, services, costs, a store and assets for three hospitals.
// Every row is flagged is_demo = 1: staff see a "Demo" label, and the public API (and so the patient website) never returns them.
// Entering real data for the same ward / hospital replaces the demo row. Usage:  npm run demo-ops   |   npm run demo-ops -- --clear
const db = require('./db');
const ops = require('./ops-db');
if (process.argv.includes('--clear')) { ops.clearDemo(); console.log('Demo operational data removed.'); process.exit(0); }
const raw = db.raw, ids = ['gmc-bambolim', 'asilo-mapusa', 'hospicio-margao'].filter(id => db.getFacility(id));
const hrs = h => new Date(Date.now() - h * 3600000).toISOString().replace(/\.\d+Z$/, 'Z');
db.transaction(() => {
  ops.clearDemo();
  ids.forEach((id, i) => {
    const wards = [['general', 120, 40 + i * 5, 75, 5], ['icu', 20, 4 + i, 15, 1], ['emergency', 14, 5, 9, 0], ['maternity', 16, 6, 9, 1], ['paediatric', 18, 7, 11, 0]];
    wards.forEach(([t, tot, av, oc, os]) => raw.prepare("INSERT OR IGNORE INTO wards (facility_id, ward_type, total_beds, available_beds, occupied_beds, out_of_service_beds, updated_by, updated_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, 'Demo data', ?, 1)").run(id, t, tot, av, oc, os, hrs(1 + i * 14)));
    raw.prepare("INSERT INTO crowd_updates (facility_id, level, wait_minutes, queue_count, by_name, verified_at, is_demo) VALUES (?, ?, ?, ?, 'Demo data', ?, 1)").run(id, ['Moderate', 'Busy', 'Low'][i % 3], [25, 50, 10][i % 3], [14, 31, 6][i % 3], hrs(0.5 + i * 2));
    [['Emergency Medicine', 'department'], ['Cardiology', 'department'], ['Pediatrics', 'department'], ['Blood bank', 'service'], ['Dialysis', 'service']].forEach(([n, k]) => raw.prepare("INSERT OR IGNORE INTO hospital_services (facility_id, name, kind, is_demo, updated_by) VALUES (?, ?, ?, 1, 'Demo data')").run(id, n, k));
    [['Consultation (OPD)', 20, 300], ['Chest X-ray', 250, 600], ['Normal delivery', 8000, 25000], ['MRI brain', 4000, 9000]].forEach(([n, a, b]) => raw.prepare("INSERT OR IGNORE INTO treatment_costs (facility_id, service_name, min_cost, max_cost, notes, is_demo, updated_by) VALUES (?, ?, ?, ?, 'Sample estimate for the demo', 1, 'Demo data')").run(id, n, a, b));
    raw.prepare("INSERT OR IGNORE INTO medical_stores (facility_id, name, location, contact, hours, availability_note, is_demo, updated_by) VALUES (?, 'Demo Pharmacy', 'Ground floor, main block', '+91 832 000 0000', '8 AM - 10 PM', 'Sample note, not verified', 1, 'Demo data')").run(id);
    [['Ventilator', 'DEMO/VNT-01', 'Medical equipment', 'Good', 'Due soon'], ['Ambulance', 'DEMO/AMB-02', 'Ambulance / vehicle', 'Fair', 'Overdue'], ['Oxygen concentrator', 'DEMO/OXY-07', 'Medical equipment', 'Good', 'Up to date']].forEach(([n, no, c, co, m]) => raw.prepare("INSERT OR IGNORE INTO assets (facility_id, name, asset_no, category, acquired_on, condition, maintenance_status, is_demo, updated_by) VALUES (?, ?, ?, ?, '2023-06-01', ?, ?, 1, 'Demo data')").run(id, n, no, c, co, m));
  });
});
console.log(`Loaded SAMPLE data for ${ids.join(', ')}. It is labelled "Demo" for staff and is never sent to the patient website.`);
