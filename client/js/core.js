// Shared state and helpers used by every other script.
//   GC.user       signed-in account ({id, name, role, facilityId, doctorId, consentAt, ...}) or null for guests
//   GC.data       this person's server-side data: profile, records, prescriptions, appointments, claims
//   GC.crowd      latest crowd snapshots from the server, by date
//   GC.loc        last known location (only ever sent as query parameters for routing; never stored)
const facilitiesData = [];
const doctorsData = [];
window.GC = { user: null, data: { profile: {}, records: [], prescriptions: [], appointments: [], claims: [] }, crowd: {}, loc: null, impact: null };

(function () {
    const byId = id => document.getElementById(id);
    window.byId = byId;
    window.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = n => String(n).padStart(2, '0');
    window.pad = pad;
    window.isoFromDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    window.todayISO = () => isoFromDate(new Date());
    window.fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
    window.fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    window.ago = iso => {
        if (!iso) return '';
        const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
        return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' d ago';
    };

    // Small toast for confirmations / errors.
    window.toast = function (msg, kind) {
        let box = byId('toastBox');
        if (!box) { box = document.createElement('div'); box.id = 'toastBox'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); box.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] space-y-2 w-[92%] max-w-sm no-print'; document.body.appendChild(box); }
        const el = document.createElement('div');
        el.className = 'px-4 py-3 rounded-xl text-xs font-semibold shadow-lg border ' + (kind === 'error' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-slate-900 text-white border-slate-700');
        el.textContent = msg;
        box.appendChild(el);
        setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
    };

    // One-shot location. Returns null when denied/unavailable, so callers can still work without it.
    window.getLocation = function (force) {
        if (GC.loc && !force) return Promise.resolve(GC.loc);
        if (!navigator.geolocation) return Promise.resolve(null);
        return new Promise(resolve => navigator.geolocation.getCurrentPosition(
            p => { GC.loc = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(GC.loc); },
            () => resolve(null), { timeout: 7000, maximumAge: 120000 }));
    };

    // ---------- crowd: same formula as the server (booked load + reported wait); the server supplies the raw signals ----------
    const WAIT_FULL = 90;
    const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
    const slotOf = min => { const s = Math.floor(min / 30) * 30; return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };
    window.slotOfMinutes = slotOf;
    window.nowHHMM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    window.levelOf = pct => pct < 35 ? 'low' : pct < 60 ? 'moderate' : pct < 80 ? 'high' : 'veryHigh';
    window.LEVEL_STYLE = {
        none: { bar: 'bg-slate-300', chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', text: 'text-slate-600' },
        low: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500', text: 'text-emerald-700' },
        moderate: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', text: 'text-amber-700' },
        high: { bar: 'bg-orange-500', chip: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', text: 'text-orange-700' },
        veryHigh: { bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500', text: 'text-rose-700' }
    };
    // key 'd:3' / 'h:gmc-bambolim'; returns { pct, level, booked, cap, waitMinutes, reports, ageMin, hasSignal }
    window.crowdFor = function (key, type, facilityId, date, hhmm) {
        const snap = GC.crowd[date];
        const cap = (snap && snap.capacity && snap.capacity[type]) || (type === 'doctor' ? 4 : 12);
        if (!snap) return { pct: 0, level: 'none', booked: 0, cap, waitMinutes: null, reports: 0, ageMin: null, hasSignal: false };
        const booked = ((snap.load[key] || {})[slotOf(toMin(hhmm))]) || 0;
        const loadPct = Math.min(100, Math.round(booked / cap * 100));
        const w = date === todayISO() ? snap.waits[facilityId] : null;
        let pct = loadPct;
        if (w) pct = Math.round(0.4 * loadPct + 0.6 * Math.min(100, Math.round(w.minutes / WAIT_FULL * 100)));
        const hasSignal = booked > 0 || !!w;
        return { pct, level: hasSignal ? levelOf(pct) : 'none', booked, cap, waitMinutes: w ? w.minutes : null, reports: w ? w.reports : 0, ageMin: w ? w.ageMin : null, hasSignal, demo: !!(w && w.demo) };
    };
    window.loadCrowd = async function (date) {
        try { GC.crowd[date] = await GoaAPI.crowd(date); return GC.crowd[date]; } catch (e) { return null; }
    };

    // Wait-report dialog (patients and staff).
    window.openWaitReport = function (facilityId, name) {
        if (!GC.user) { toast('Sign in to report a wait time.', 'error'); return; }
        const m = byId('waitModal');
        m.dataset.facility = facilityId;
        byId('waitModalName').textContent = name;
        m.classList.remove('hidden');
        byId('waitModal').querySelector('button[data-min]').focus();
    };
    window.closeWaitReport = () => byId('waitModal').classList.add('hidden');
    window.sendWaitReport = async function (minutes) {
        const id = byId('waitModal').dataset.facility;
        try {
            await GoaAPI.reportWait(id, minutes);
            closeWaitReport();
            toast('Thanks. Your wait report is now part of the crowd number.');
            await loadCrowd(todayISO());
            document.dispatchEvent(new CustomEvent('gc:crowd'));
        } catch (e) { toast(e.message, 'error'); }
    };
})();
