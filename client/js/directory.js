// Hospitals, doctors, crowd and impact numbers come from the server and refresh every 10 seconds.
// This file also draws the hospital and doctor cards.
(function () {
    const POLL_MS = 10000;
    let signature = '', loaded = false;
    const LAST_KEY = 'gcLastFacilities';   // saved for the offline emergency screen

    const replaceAll = (target, items) => { target.length = 0; items.forEach(x => target.push(x)); };

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
            el.className = 'inline-flex items-center gap-1.5 mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full ' + (ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700');
            el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full ' + (ok ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500') + '"></span>' + esc(text);
        });
        const off = byId('offlineBanner');
        if (off) off.classList.toggle('hidden', state === 'live');
    }

    // ---------- hospital cards ----------
    function crowdChip(f) {
        const c = crowdFor('h:' + f.id, 'hospital', f.id, todayISO(), nowHHMM());
        const st = LEVEL_STYLE[c.level];
        const wait = c.waitMinutes != null ? ' · ~' + c.waitMinutes + ' min' : '';
        return { c, html: `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${st.chip}">${esc(t('crowdLabel'))}: ${esc(c.level === 'none' ? t('cr_none') : t('cr_' + c.level) + wait)}</span>` };
    }

    function renderHospitals(list) {
        const grid = byId('hospitalGrid');
        if (!list.length) { grid.innerHTML = '<div class="col-span-full py-8 text-center text-slate-500 text-xs">Nothing matches your search.</div>'; return; }
        const crowdedIds = [];
        grid.innerHTML = list.map(f => {
            const route = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(f.name + ', ' + f.address)}`;
            const chip = crowdChip(f);
            if (chip.c.pct >= 60) crowdedIds.push(f.id);
            const verified = !!f.staffUpdatedAt;
            return `
            <article class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between space-y-4" aria-label="${esc(f.name)}">
                <div class="space-y-3">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md ${f.careType === 'Public' ? 'bg-teal-100 text-teal-800' : 'bg-purple-100 text-purple-800'}">${esc(t('ct_' + f.careType))}</span>
                        <span class="text-[11px] font-bold text-slate-500"><i class="fa-solid fa-map-pin text-rose-500 mr-1" aria-hidden="true"></i>${esc(t('d_' + f.district))}</span>
                    </div>
                    <h3 class="text-base font-bold text-slate-900 leading-snug">${esc(f.name)}</h3>
                    <p class="text-xs text-slate-500"><i class="fa-solid fa-location-dot text-slate-400 mr-1" aria-hidden="true"></i>${esc(f.address)}</p>
                    <div class="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <div class="flex items-center justify-between mb-1.5 gap-2">
                            <span class="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">${esc(t('liveBeds'))}</span>
                            <span class="text-[9px] text-slate-400">${esc(t('updated'))} ${esc(fmtTime(f.staffUpdatedAt || f.updatedAt))}</span>
                        </div>
                        <div class="grid grid-cols-3 gap-2 text-center text-xs">
                            <div class="bg-white p-1.5 rounded-lg border border-slate-200"><span class="block text-slate-500 text-[10px]">${esc(t('bICU'))}</span><span class="font-extrabold ${f.icuBeds > 0 ? 'text-teal-700' : 'text-rose-600'}">${f.icuBeds}</span></div>
                            <div class="bg-white p-1.5 rounded-lg border border-slate-200"><span class="block text-slate-500 text-[10px]">${esc(t('bOxygen'))}</span><span class="font-extrabold ${f.oxygenBeds > 0 ? 'text-teal-700' : 'text-rose-600'}">${f.oxygenBeds}</span></div>
                            <div class="bg-white p-1.5 rounded-lg border border-slate-200"><span class="block text-slate-500 text-[10px]">${esc(t('bGeneral'))}</span><span class="font-extrabold ${f.generalBeds > 0 ? 'text-teal-700' : 'text-rose-600'}">${f.generalBeds}</span></div>
                        </div>
                        <p class="mt-2 text-[10px] font-semibold ${verified ? 'text-emerald-700' : 'text-amber-700'}"><i class="fa-solid ${verified ? 'fa-circle-check' : 'fa-triangle-exclamation'} mr-1" aria-hidden="true"></i>${esc(verified ? t('staffVerified') + ' · ' + ago(f.staffUpdatedAt) : t('staffUnverified'))}</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${chip.html}
                        <button type="button" onclick="openWaitReport('${esc(f.id)}', '${esc(f.name).replace(/'/g, '&#39;')}')" class="text-[10px] font-bold text-teal-700 underline underline-offset-2">${esc(t('reportWait'))}</button>
                    </div>
                    <div id="alt-${esc(f.id)}"></div>
                    <div class="flex flex-wrap gap-1 pt-1">${f.specialties.map(s => `<span class="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-medium">${esc(s)}</span>`).join('')}</div>
                </div>
                <div class="space-y-2 pt-2 border-t border-slate-100">
                    <a href="${route}" target="_blank" rel="noopener" class="w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition"><i class="fa-solid fa-location-arrow text-emerald-300" aria-hidden="true"></i> ${esc(t('mapRoute'))}</a>
                    ${f.phoneVerified
                        ? `<a href="tel:${esc(f.phone.replace(/[^+\d]/g, ''))}" class="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"><i class="fa-solid fa-phone text-teal-600" aria-hidden="true"></i> ${esc(t('callHospital'))}: ${esc(f.phone)}</a>`
                        : `<p class="text-[11px] text-slate-500 text-center"><i class="fa-solid fa-phone-slash mr-1" aria-hidden="true"></i>${esc(t('phoneNA'))}</p>`}
                </div>
            </article>`;
        }).join('');
        crowdedIds.slice(0, 6).forEach(loadAlternatives);   // "less crowded alternative" for crowded facilities
    }

    async function loadAlternatives(id) {
        const slot = byId('alt-' + id);
        if (!slot) return;
        try {
            const r = await GoaAPI.alternatives(id, null, GC.loc);
            if (!r.crowded || !r.alternatives.length) return;
            slot.innerHTML = `<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                <div class="text-[11px] font-extrabold text-amber-900"><i class="fa-solid fa-people-arrows mr-1" aria-hidden="true"></i>${esc(t('altTitle'))}</div>
                ${r.alternatives.map(a => `<div class="flex items-center justify-between gap-2 text-[11px] text-amber-900">
                    <span class="font-semibold">${esc(a.name)} <span class="font-normal">· ${esc(t('altKm', { n: a.distanceKm }))} · ${esc(t('cr_' + a.crowdLevel))}</span></span>
                    <a target="_blank" rel="noopener" onclick="GoaAPI.logRedirect('${esc(id)}','${esc(a.id)}')" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.name + ', ' + a.address)}" class="shrink-0 px-2 py-1 bg-amber-600 text-white rounded-lg font-bold">${esc(t('altGo'))}</a></div>`).join('')}
            </div>`;
        } catch (e) { /* alternatives are a bonus; ignore errors */ }
    }

    window.filterHospitals = function () {
        const query = byId('hospitalSearch').value.toLowerCase().trim();
        const district = byId('districtFilter').value, careType = byId('careTypeFilter').value;
        renderHospitals(facilitiesData.filter(f =>
            (f.name.toLowerCase().includes(query) || f.address.toLowerCase().includes(query)) &&
            (district === 'all' || f.district === district) && (careType === 'all' || f.careType === careType)));
    };

    // ---------- doctor cards (with "next available" substitute) ----------
    function renderDoctors(list) {
        const box = byId('doctorsList');
        if (!list.length) { box.innerHTML = '<div class="col-span-full py-8 text-center text-slate-500 text-xs">No doctor found matching your search. Try "Cardiology", "Orthopedics" or a doctor name.</div>'; return; }
        box.innerHTML = list.map(d => {
            let bg = 'bg-emerald-100 text-emerald-800';
            if (d.status === 'In Surgery') bg = 'bg-amber-100 text-amber-800';
            if (d.status === 'On Call') bg = 'bg-blue-100 text-blue-800';
            const sub = d.status !== 'Available' ? (d.substitute
                ? `<div class="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-[11px] text-emerald-900"><i class="fa-solid fa-user-check mr-1" aria-hidden="true"></i><strong>Next available:</strong> ${esc(d.substitute.name)} · ${esc(d.substitute.hospital)}${d.substitute.sameHospital ? ' (same hospital)' : ''} · ${esc(d.substitute.room)}
                    <button type="button" onclick="apptQuickBook('d:${d.substitute.id}')" class="ml-1 underline font-bold">Book</button></div>`
                : `<div class="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-900">No other ${esc(d.spec)} doctor is available right now.</div>`) : '';
            return `
            <article class="p-4 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-white transition flex flex-col justify-between space-y-3">
                <div class="space-y-1.5">
                    <div class="flex items-start justify-between gap-2"><h4 class="font-bold text-slate-900 text-sm">${esc(d.name)}</h4><span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${bg}">${esc(d.status)}</span></div>
                    <p class="text-xs text-teal-700 font-extrabold"><i class="fa-solid fa-user-doctor mr-1" aria-hidden="true"></i>${esc(d.spec)}</p>
                    <p class="text-xs text-slate-600"><i class="fa-solid fa-hospital text-slate-400 mr-1" aria-hidden="true"></i>${esc(d.hospital)}</p>
                    <p class="text-[11px] text-slate-500"><i class="fa-solid fa-clock text-slate-400 mr-1" aria-hidden="true"></i>OPD: ${esc(d.timings)}</p>
                    <p class="text-[11px] text-slate-500"><i class="fa-solid fa-door-open text-slate-400 mr-1" aria-hidden="true"></i>${esc(d.room)}</p>
                </div>
                ${sub}
                <div class="pt-2 border-t border-slate-200 flex justify-between items-center text-[11px]"><span class="text-slate-500 font-medium">Fee:</span><span class="font-bold text-slate-800">${esc(d.fee)}</span></div>
            </article>`;
        }).join('');
    }
    window.filterDoctors = function () {
        const query = byId('doctorSearch').value.toLowerCase().trim(), spec = byId('doctorSpecFilter').value;
        renderDoctors(doctorsData.filter(d => (d.name.toLowerCase().includes(query) || d.spec.toLowerCase().includes(query) || d.hospital.toLowerCase().includes(query)) && (spec === 'all' || d.spec === spec)));
    };

    // Only a label for simulated demo data (never a statistic): crowd numbers must not pass simulated rows off as real.
    function renderImpact() {
        const i = GC.impact, el = byId('demoNotice');
        if (!el) return;
        const demo = i && i.demoData && (i.demoData.bookings || i.demoData.waitReports);
        el.innerHTML = demo ? '<p class="notice notice-warn"><i class="fa-solid fa-flask" aria-hidden="true"></i><span>Crowd numbers include <strong>simulated demo data</strong>. These are not real patients.</span></p>' : '';
    }

    function render() { filterHospitals(); filterDoctors(); renderImpact(); document.dispatchEvent(new CustomEvent('gc:directory')); }
    document.addEventListener('gc:lang', render);
    document.addEventListener('gc:crowd', () => { filterHospitals(); renderImpact(); });

    async function load() {
        try {
            const [f, d, i] = await Promise.all([GoaAPI.facilities(), GoaAPI.doctors(), GoaAPI.impact().catch(() => null), loadCrowd(todayISO())]);
            const sig = JSON.stringify([f.facilities, d.doctors, i, GC.crowd[todayISO()]]);
            if (sig !== signature) {
                signature = sig;
                replaceAll(facilitiesData, f.facilities); replaceAll(doctorsData, d.doctors);
                GC.impact = i;
                try { localStorage.setItem(LAST_KEY, JSON.stringify({ at: new Date().toISOString(), facilities: f.facilities.map(x => ({ id: x.id, name: x.name, district: x.district, phone: x.phone, address: x.address, careType: x.careType })) })); } catch (e) { /* storage full */ }
                syncSpecialtyOptions(); render();
            }
            loaded = true;
            setBadge('live', 'Connected · updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        } catch (err) {
            if (!loaded) { const msg = err.network ? err.message : 'Could not load data from the server. Retrying...'; byId('hospitalGrid').innerHTML = `<div class="col-span-full py-8 text-center text-slate-500 text-xs">${esc(msg)}</div>`; byId('doctorsList').innerHTML = `<div class="col-span-full py-8 text-center text-slate-500 text-xs">${esc(msg)}</div>`; }
            setBadge('offline', loaded ? 'Offline · showing last saved data' : 'Offline · retrying');
        }
        document.dispatchEvent(new CustomEvent('gc:polled'));
    }
    window.reloadDirectory = load;

    function start() { load(); setInterval(() => { if (!document.hidden) load(); }, POLL_MS); document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); }); window.addEventListener('online', load); window.addEventListener('offline', () => setBadge('offline', 'Offline · showing last saved data')); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
