// Appointments: requests go to the server. Slot numbers and the crowd panel count every user's bookings.
(function () {
    let selSlot = '';
    const to24 = (h, m, ap) => { h = Number(h) % 12; if (/pm/i.test(ap)) h += 12; return h * 60 + Number(m || 0); };
    function windowsOf(p) {
        if (p.type === 'hospital') return [[9 * 60, 13 * 60]];
        const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi, out = []; let m;
        while ((m = re.exec(p.timings || ''))) out.push([to24(m[1], m[2], m[3]), to24(m[4], m[5], m[6])]);
        return out.length ? out : [[9 * 60, 13 * 60]];
    }
    function provider() {
        const key = byId('apptProvider').value; if (!key) return null;
        if (key.startsWith('d:')) { const d = doctorsData.find(x => 'd:' + x.id === key); return d && { key, type: 'doctor', name: d.name, facilityId: d.facilityId, spec: d.spec, timings: d.timings, hospital: d.hospital }; }
        const f = facilitiesData.find(x => 'h:' + x.id === key); return f && { key, type: 'hospital', name: f.name, facilityId: f.id, spec: null, hospital: f.name };
    }
    window.apptFillProviders = function () {
        const sel = byId('apptProvider'), prev = sel.value;
        sel.innerHTML = byId('apptType').value === 'doctor'
            ? doctorsData.map(d => `<option value="d:${d.id}">${esc(d.name)} · ${esc(d.spec)} · ${esc(d.hospital)}</option>`).join('')
            : facilitiesData.map(f => `<option value="h:${esc(f.id)}">${esc(f.name)}</option>`).join('');
        if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
        apptRefresh();
    };
    window.apptQuickBook = function (key) { switchTab('appointments'); byId('apptType').value = key.startsWith('d:') ? 'doctor' : 'hospital'; apptFillProviders(); byId('apptProvider').value = key; apptRefresh(); };

    window.apptRefresh = async function () {
        const date = byId('apptDate').value || todayISO(), p = provider();
        if (!p) return;
        if (date < todayISO()) byId('apptDate').value = todayISO();
        await loadCrowd(date); await loadCrowd(todayISO());
        drawCrowd(p, date); drawSlots(p, date); drawAlt(p);
    };

    function drawCrowd(p, date) {
        const box = byId('apptCrowd'), isToday = date === todayISO();
        const c = crowdFor(p.key, p.type, p.facilityId, date, isToday ? nowHHMM() : '10:00'), st = LEVEL_STYLE[c.level];
        const wait = isToday ? (c.waitMinutes != null ? `Reported wait about <strong>${c.waitMinutes} min</strong> (${c.reports} report${c.reports === 1 ? '' : 's'}${c.ageMin != null ? ', latest ' + c.ageMin + ' min ago' : ''})` : 'No wait reports for this hospital yet.') : 'Wait reports only exist for today.';
        box.innerHTML = `<div class="flex items-center justify-between"><span class="font-bold">${isToday ? 'Crowd right now' : 'Booked load on this day'}</span><span class="px-2 py-0.5 rounded-full font-bold ${st.chip}">${c.level === 'none' ? 'No live data yet' : esc(t('cr_' + c.level)) + ' · ' + c.pct + '%'}</span></div>
            <div class="h-2 bg-slate-200 rounded-full overflow-hidden"><div class="h-full ${st.bar}" style="width:${c.pct}%"></div></div>
            <div class="text-slate-600">Booked in this slot: <strong>${c.booked} / ${c.cap}</strong> · ${wait}</div>
            ${c.demo ? '<div class="text-amber-700 font-semibold">Includes simulated demo wait data.</div>' : ''}
            ${isToday && GC.user ? `<button type="button" onclick="openWaitReport('${esc(p.facilityId)}','${esc(p.hospital).replace(/'/g, '&#39;')}')" class="text-teal-700 font-bold underline">${esc(t('reportWait'))}</button>` : ''}`;
    }
    function drawSlots(p, date) {
        const snap = GC.crowd[date], cap = (snap && snap.capacity[p.type]) || 4, now = new Date(), isToday = date === todayISO(), nowMin = now.getHours() * 60 + now.getMinutes();
        const slots = []; windowsOf(p).forEach(([a, b]) => { for (let m = a; m < b; m += 30) slots.push(m); });
        let best = null;
        const cells = slots.map(m => {
            const hhmm = pad(Math.floor(m / 60)) + ':' + pad(m % 60), booked = ((snap && snap.load[p.key]) || {})[hhmm] || 0;
            const past = isToday && m <= nowMin, full = booked >= cap;
            if (!past && !full && (!best || booked < best.booked)) best = { hhmm, booked };
            return { hhmm, booked, past, full };
        });
        if (selSlot && !cells.some(c => c.hhmm === selSlot && !c.past && !c.full)) selSlot = '';
        byId('apptSlots').innerHTML = cells.map(c => {
            const lv = LEVEL_STYLE[c.booked === 0 ? 'low' : levelOf(c.booked / cap * 100)];
            return `<button type="button" ${c.past || c.full ? 'disabled' : ''} onclick="apptPick('${c.hhmm}')" aria-pressed="${selSlot === c.hhmm}" class="p-2 rounded-xl border text-center ${selSlot === c.hhmm ? 'border-teal-600 bg-teal-50 ring-2 ring-teal-500' : 'border-slate-200 bg-white'} ${c.past || c.full ? 'opacity-40 cursor-not-allowed' : 'hover:border-teal-400'}"><span class="block font-bold">${c.hhmm}</span><span class="block text-[10px]"><span class="inline-block w-1.5 h-1.5 rounded-full ${lv.dot} mr-1"></span>${c.booked}/${cap}${best && best.hhmm === c.hhmm ? ' · quietest' : ''}</span></button>`;
        }).join('') || '<div class="col-span-full text-slate-500">No slots left.</div>';
        const gate = byId('apptGate'); gate.classList.toggle('hidden', !!(GC.user && GC.user.consentAt));
    }
    window.apptPick = h => { selSlot = h; apptRefresh(); };

    // "Less crowded alternative" when this hospital is busy.
    async function drawAlt(p) {
        const box = byId('apptAlt'); box.innerHTML = '';
        const c = crowdFor('h:' + p.facilityId, 'hospital', p.facilityId, todayISO(), nowHHMM());
        if (c.pct < 60) return;
        try {
            const r = await GoaAPI.alternatives(p.facilityId, p.spec, GC.loc);
            if (!r.alternatives.length) return;
            box.innerHTML = `<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1.5 text-amber-900"><div class="font-extrabold"><i class="fa-solid fa-people-arrows mr-1" aria-hidden="true"></i>${esc(r.from.name)} is crowded now. ${esc(t('altTitle'))}</div>${r.alternatives.map(a => `<div class="flex justify-between gap-2"><span>${esc(a.name)} · ${esc(t('altKm', { n: a.distanceKm }))} · ${esc(t('cr_' + a.crowdLevel))}</span><button type="button" onclick="apptQuickBook('h:${esc(a.id)}'); GoaAPI.logRedirect('${esc(p.facilityId)}','${esc(a.id)}')" class="font-bold underline">Book here</button></div>`).join('')}</div>`;
        } catch (e) { /* optional */ }
    }

    window.apptSubmit = async function () {
        if (needSaveAccess()) return;
        const p = provider(), date = byId('apptDate').value;
        if (!p || !selSlot) return toast('Pick a doctor/hospital, a date and a time slot.', 'error');
        try {
            const r = await GoaAPI.book({ key: p.key, date, time: selSlot, reason: byId('apptReason').value });
            GC.data.appointments.push(r.appointment); selSlot = ''; byId('apptReason').value = '';
            toast('Request sent. The hospital will confirm it.'); renderAppts(); apptRefresh();
        } catch (e) { if (e.code === 'consent_required') byId('consentModal').classList.remove('hidden'); else { toast(e.message, 'error'); apptRefresh(); } }
    };
    window.apptCancel = async function (id) {
        if (!confirm('Cancel this appointment?')) return;
        try { await GoaAPI.cancelAppointment(id); GC.data.appointments.find(a => a.id === id).status = 'Cancelled'; renderAppts(); apptRefresh(); } catch (e) { toast(e.message, 'error'); }
    };
    const BADGE = { Requested: 'bg-amber-100 text-amber-800', Confirmed: 'bg-emerald-100 text-emerald-800', Declined: 'bg-rose-100 text-rose-800', Cancelled: 'bg-slate-100 text-slate-500' };
    window.renderAppts = function () {
        const list = GC.data.appointments.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        byId('apptList').innerHTML = list.length ? list.map(a => `<div class="bg-white p-3 rounded-2xl border border-slate-200 text-xs space-y-1">
            <div class="flex justify-between gap-2"><span class="font-bold text-slate-900">${esc(a.name)}</span><span class="px-2 py-0.5 rounded-full font-bold ${BADGE[a.status] || ''}">${esc(a.status === 'Requested' ? 'Awaiting hospital' : a.status)}</span></div>
            <div class="text-slate-600">${esc(fmtDate(a.date))} · ${esc(a.time)} · ${esc(a.place)}</div>${a.reason ? `<div class="text-slate-500">${esc(a.reason)}</div>` : ''}
            <div class="flex gap-3 pt-1"><a target="_blank" rel="noopener" class="text-teal-700 font-bold underline" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.mapQuery)}">Map</a>${a.status === 'Requested' || a.status === 'Confirmed' ? `<button onclick="apptCancel(${a.id})" class="text-rose-600 font-bold">Cancel</button>` : ''}</div></div>`).join('')
            : '<div class="text-xs text-slate-500 bg-white border border-slate-200 rounded-2xl p-6 text-center">No appointments yet.</div>';
    };
    window.showTodayAppointments = function () {
        const today = GC.data.appointments.filter(a => a.date === todayISO() && (a.status === 'Requested' || a.status === 'Confirmed'));
        if (!today.length) return;
        byId('apptTodayList').innerHTML = today.map(a => `<div class="p-2 rounded-xl bg-slate-50 border border-slate-200"><strong>${esc(a.time)}</strong> · ${esc(a.name)}<br><span class="text-slate-500">${esc(a.place)} · ${esc(a.status)}</span></div>`).join('');
        byId('apptTodayModal').classList.remove('hidden');
    };

    document.addEventListener('gc:directory', () => { if (!byId('apptProvider').options.length || (byId('apptType').value === 'doctor' ? doctorsData.length : facilitiesData.length) !== byId('apptProvider').options.length) apptFillProviders(); else if (currentTab() === 'appointments') apptRefresh(); });
    document.addEventListener('gc:crowd', () => { if (currentTab() === 'appointments') apptRefresh(); });
    document.addEventListener('gc:tab', e => { if (e.detail === 'appointments') { renderAppts(); apptRefresh(); } });
    document.addEventListener('gc:polled', async () => {
        if (GC.user && currentTab() === 'appointments') { try { GC.data.appointments = (await GoaAPI.myData()).appointments; renderAppts(); } catch (e) { /* offline */ } }
    });
    document.addEventListener('gc:user', () => { renderAppts(); apptRefresh(); });
})();
