// Hospitals and doctors come from the GoaCare server (GET /api/facilities, /api/doctors) and refresh automatically.
// facilitiesData / doctorsData keep the same names and shape the rest of the app already uses; they are filled in place.
const facilitiesData = [];
const doctorsData = [];

(function () {
    const POLL_MS = 10000;
    const byId = id => document.getElementById(id);
    let signature = '';      // last data received, to skip re-rendering when nothing changed
    let loaded = false;
    let timer = null;

    function replaceAll(target, items) { target.length = 0; items.forEach(x => target.push(x)); }

    // Specialty dropdown: make sure every specialty that exists on the server can be filtered.
    function syncSpecialtyOptions() {
        const sel = byId('doctorSpecFilter');
        if (!sel) return;
        const have = new Set(Array.from(sel.options).map(o => o.value));
        Array.from(new Set(doctorsData.map(d => d.spec))).sort().forEach(spec => {
            if (have.has(spec)) return;
            const o = document.createElement('option'); o.value = spec; o.textContent = spec; sel.appendChild(o);
        });
    }

    function setBadge(state, text) {
        ['Facilities', 'Doctors'].forEach(name => {
            const el = byId('liveStatus' + name);
            if (!el) return;
            const ok = state === 'live';
            el.className = 'inline-flex items-center gap-1.5 mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full ' +
                (ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700');
            el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full ' + (ok ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500') + '"></span>' + text;
        });
    }

    function showMessage(id, text) {
        const el = byId(id);
        if (el) el.innerHTML = '<div class="col-span-full py-8 text-center text-slate-500 text-xs">' + text + '</div>';
    }

    function render() {
        filterHospitals();          // re-applies whatever search / district / type filters the user has set
        filterDoctors();
        if (window.refreshAppointments) window.refreshAppointments();
    }

    async function load() {
        try {
            const [f, d] = await Promise.all([GoaAPI.facilities(), GoaAPI.doctors()]);
            const sig = JSON.stringify([f.facilities, d.doctors]);
            const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            if (sig !== signature) {
                signature = sig;
                replaceAll(facilitiesData, f.facilities);
                replaceAll(doctorsData, d.doctors);
                syncSpecialtyOptions();
                render();
            }
            loaded = true;
            setBadge('live', 'Live from server · checked ' + time);
        } catch (err) {
            if (!loaded) {
                const msg = err.network ? err.message : 'Could not load data from the server. Retrying...';
                showMessage('hospitalGrid', msg);
                showMessage('doctorsList', msg);
            }
            setBadge('offline', loaded ? 'Server unreachable · showing last known data' : 'Server unreachable · retrying');
        }
    }

    function start() {
        load();
        timer = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    }

    // Wait until every script has run (app.js defines the render functions used below).
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
