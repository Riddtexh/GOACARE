// Staff dashboard: hospital accounts update beds, doctor status and appointment requests; doctor accounts update their own status.
(function () {
    let draft = null, built = '';
    const root = () => byId('staffRoot');
    const STATUSES = ['Available', 'In Surgery', 'On Call'];

    function stepper(key, label) {
        return `<div class="bg-white rounded-2xl border border-slate-200 p-4 text-center space-y-2"><div class="text-xs font-extrabold uppercase tracking-wider text-slate-500">${esc(label)}</div>
            <div class="flex items-center justify-center gap-3"><button type="button" onclick="bedStep('${key}',-1)" class="w-12 h-12 rounded-xl bg-slate-100 text-2xl font-bold" aria-label="Decrease ${esc(label)}">−</button>
            <input id="bed-${key}" type="number" min="0" max="5000" value="${draft[key]}" oninput="draft_set('${key}', this.value)" class="w-20 text-center text-3xl font-extrabold border border-slate-200 rounded-xl p-1" aria-label="${esc(label)} beds free">
            <button type="button" onclick="bedStep('${key}',1)" class="w-12 h-12 rounded-xl bg-teal-600 text-white text-2xl font-bold" aria-label="Increase ${esc(label)}">+</button></div></div>`;
    }
    window.draft_set = (k, v) => { draft[k] = Math.max(0, Math.min(5000, parseInt(v, 10) || 0)); };
    window.bedStep = (k, d) => { draft[k] = Math.max(0, draft[k] + d); byId('bed-' + k).value = draft[k]; };
    window.saveBeds = async function () {
        try { const r = await GoaAPI.setBeds(GC.user.facilityId, { icuBeds: draft.icuBeds, oxygenBeds: draft.oxygenBeds, generalBeds: draft.generalBeds }); toast('Beds saved. Patients see this within about 10 seconds.'); const i = facilitiesData.findIndex(f => f.id === r.facility.id); if (i >= 0) facilitiesData[i] = r.facility; byId('bedsSaved').textContent = 'Saved ' + fmtTime(r.facility.staffUpdatedAt); reloadDirectory(); } catch (e) { toast(e.message, 'error'); }
    };
    window.setDoctor = async function (id, patch) { try { await GoaAPI.setDoctor(id, patch); toast('Doctor updated.'); reloadDirectory(); } catch (e) { toast(e.message, 'error'); } };
    window.reportOwnWait = m => { GoaAPI.reportWait(GC.user.facilityId, m).then(() => { toast('Wait reported.'); loadCrowd(todayISO()); }).catch(e => toast(e.message, 'error')); };

    function build() {
        const u = GC.user;
        if (!u || (u.role !== 'doctor' && u.role !== 'hospital')) { root().innerHTML = ''; built = ''; return; }
        const f = facilitiesData.find(x => x.id === u.facilityId);
        if (u.role === 'hospital' && !f) return;
        const sig = u.id + ':' + u.role;
        if (built === sig) return;
        built = sig;
        let html = `<div><h1 class="text-2xl font-extrabold text-slate-900" data-i18n="navStaff">Staff Dashboard</h1><p class="text-xs text-slate-500">Signed in as ${esc(u.name)} · ${esc(u.role === 'hospital' ? 'hospital staff' : u.doctorName || 'doctor')} · ${esc(u.facilityName || '')}</p></div>`;
        if (u.role === 'hospital') {
            draft = { icuBeds: f.icuBeds, oxygenBeds: f.oxygenBeds, generalBeds: f.generalBeds };
            html += `<div class="space-y-3"><h2 class="font-bold text-slate-900">Free beds at ${esc(f.name)}</h2>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">${stepper('icuBeds', 'ICU')}${stepper('oxygenBeds', 'Oxygen')}${stepper('generalBeds', 'General')}</div>
                <div class="flex items-center gap-3"><button onclick="saveBeds()" class="px-6 py-3 bg-teal-600 text-white font-bold rounded-xl">Save beds</button><span id="bedsSaved" class="text-xs text-slate-500">${f.staffUpdatedAt ? 'Last saved ' + esc(fmtTime(f.staffUpdatedAt)) : 'Not updated by staff yet'}</span></div></div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 space-y-2 text-xs"><div class="font-bold">Report the current OPD wait</div><div class="flex flex-wrap gap-2">${[[5, 'Under 10 min'], [20, '~20 min'], [45, '~45 min'], [90, '90+ min']].map(([m, l]) => `<button onclick="reportOwnWait(${m})" class="px-3 py-2 rounded-xl bg-slate-100 font-bold">${l}</button>`).join('')}</div></div>
                <div class="space-y-2"><h2 class="font-bold text-slate-900">Doctors at this hospital</h2><div id="staffDoctors" class="grid grid-cols-1 md:grid-cols-2 gap-3"></div></div>`;
        } else {
            html += `<div class="space-y-2"><h2 class="font-bold text-slate-900">My status</h2><div id="staffDoctors" class="grid grid-cols-1 md:grid-cols-2 gap-3"></div></div>`;
        }
        html += `<div class="space-y-2"><h2 class="font-bold text-slate-900">Appointment requests</h2><div id="staffAppts" class="space-y-2"></div></div>`;
        root().innerHTML = html;
        drawDoctors(); loadAppts();
    }
    function drawDoctors() {
        const u = GC.user, box = byId('staffDoctors'); if (!box) return;
        const list = doctorsData.filter(d => u.role === 'doctor' ? d.id === u.doctorId : d.facilityId === u.facilityId);
        box.innerHTML = list.map(d => `<div class="bg-white p-3 rounded-2xl border border-slate-200 text-xs space-y-2"><div class="font-bold">${esc(d.name)} <span class="font-normal text-slate-500">· ${esc(d.spec)}</span></div>
            <div class="flex flex-wrap gap-1.5" role="group" aria-label="Status for ${esc(d.name)}">${STATUSES.map(s => `<button onclick="setDoctor(${d.id}, {status:'${s}'})" aria-pressed="${d.status === s}" class="px-3 py-1.5 rounded-lg font-bold ${d.status === s ? 'bg-teal-600 text-white' : 'bg-slate-100'}">${s}</button>`).join('')}</div>
            <label class="flex items-center gap-2">Room <input value="${esc(d.room)}" onchange="setDoctor(${d.id}, {room:this.value})" class="flex-1 p-1.5 border border-slate-300 rounded-lg"></label></div>`).join('');
    }
    async function loadAppts() {
        const box = byId('staffAppts'); if (!box) return;
        try {
            const { appointments } = await GoaAPI.staffAppointments();
            box.innerHTML = appointments.length ? appointments.map(a => `<div class="bg-white p-3 rounded-2xl border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2"><div><div class="font-bold">${esc(a.patient)} · ${esc(fmtDate(a.date))} ${esc(a.time)}</div><div class="text-slate-500">${esc(a.name)}${a.reason ? ' · ' + esc(a.reason) : ''} · <strong>${esc(a.status)}</strong></div></div>
                ${a.status === 'Requested' ? `<div class="flex gap-2"><button onclick="staffAppt(${a.id},'Confirmed')" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-bold">Confirm</button><button onclick="staffAppt(${a.id},'Declined')" class="px-3 py-1.5 bg-slate-100 rounded-lg font-bold">Decline</button></div>` : ''}</div>`).join('')
                : '<div class="text-xs text-slate-500 bg-white border border-slate-200 rounded-2xl p-5 text-center">No upcoming requests.</div>';
        } catch (e) { box.innerHTML = `<div class="text-xs text-rose-700">${esc(e.message)}</div>`; }
    }
    window.staffAppt = async function (id, status) { try { await GoaAPI.setAppointmentStatus(id, status); loadAppts(); } catch (e) { toast(e.message, 'error'); } };
    window.resetStaff = () => { built = ''; root().innerHTML = ''; };

    document.addEventListener('gc:tab', e => { if (e.detail === 'staff') { build(); loadAppts(); } });
    document.addEventListener('gc:directory', () => { if (currentTab() === 'staff') { build(); drawDoctors(); } });
    document.addEventListener('gc:polled', () => { if (currentTab() === 'staff' && GC.user) loadAppts(); });
})();
