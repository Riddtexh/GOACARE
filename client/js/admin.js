// Administration (admin accounts only): who has registered and what is stored for each account. Read-only.
(function () {
    const root = () => byId('adminRoot');
    let built = false, seq = 0, timer = null;
    const ROLE_LABEL = { patient: 'Patient', doctor: 'Doctor', hospital: 'Hospital staff', admin: 'Admin' };
    const stamp = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    const chip = (text, cls) => `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}">${esc(text)}</span>`;
    const dash = v => (v == null || v === '' ? '-' : esc(v));

    function shell() {
        root().innerHTML = `
            <div><h1 class="text-2xl font-extrabold text-slate-900" data-i18n="navAdmin">Administration</h1>
            <p class="text-xs text-slate-500">Registered users and the data stored for them. Read-only. Password hashes and prescription photos are never shown, and every view is logged.</p></div>
            <div id="adminSummary" class="grid grid-cols-2 sm:grid-cols-4 gap-3"></div>
            <div class="bg-white rounded-2xl border border-slate-200 p-3 flex items-center gap-2">
                <label for="adminSearch" class="sr-only">Search users</label>
                <input id="adminSearch" type="search" placeholder="Search by name, mobile number or Health ID" autocomplete="off" class="flex-1 p-2.5 border border-slate-300 rounded-xl text-sm">
                <button type="button" onclick="adminReload()" class="px-4 py-2.5 bg-slate-100 font-bold rounded-xl text-xs">Refresh</button>
            </div>
            <div id="adminUsers" class="bg-white rounded-2xl border border-slate-200 overflow-x-auto"></div>
            <div id="adminDetail" class="space-y-3"></div>
            <details class="bg-white rounded-2xl border border-slate-200 p-4 text-xs" ontoggle="if(this.open) adminLoadAudit()"><summary class="font-bold cursor-pointer">Admin activity log</summary><div id="adminAudit" class="mt-3"></div></details>`;
        byId('adminSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    }

    async function load() {
        const my = ++seq, box = byId('adminUsers');
        if (!box) return;
        try {
            const r = await GoaAPI.adminUsers(byId('adminSearch').value.trim());
            if (my !== seq) return;   // a newer search is already running
            drawSummary(r);
            box.innerHTML = r.users.length ? `<table class="w-full text-xs text-left"><thead class="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]"><tr>
                <th class="p-3">Name</th><th class="p-3">Role</th><th class="p-3">Mobile / Health ID</th><th class="p-3">Registered</th><th class="p-3">Consent</th><th class="p-3">Stored items</th><th class="p-3"><span class="sr-only">Actions</span></th></tr></thead><tbody>
                ${r.users.map(u => {
                    const c = u.counts, items = c.records + c.prescriptions + c.appointments + c.claims;
                    return `<tr class="border-t border-slate-100"><td class="p-3 font-semibold">${esc(u.name)}</td>
                        <td class="p-3">${chip(ROLE_LABEL[u.role] || u.role, u.role === 'admin' ? 'bg-violet-100 text-violet-800' : u.role === 'patient' ? 'bg-slate-100 text-slate-700' : 'bg-teal-100 text-teal-800')}</td>
                        <td class="p-3 whitespace-nowrap">${esc(u.phone)}</td><td class="p-3 whitespace-nowrap">${esc(stamp(u.registeredAt))}</td>
                        <td class="p-3">${u.consentAt ? chip('Given', 'bg-emerald-100 text-emerald-800') : chip('Not yet', 'bg-amber-100 text-amber-800')}</td>
                        <td class="p-3" title="${c.records} records, ${c.prescriptions} prescriptions, ${c.appointments} appointments, ${c.claims} claims">${items}</td>
                        <td class="p-3"><button type="button" onclick="adminOpen(${u.id})" class="px-3 py-1.5 bg-teal-600 text-white rounded-lg font-bold" aria-label="View ${esc(u.name)}">View</button></td></tr>`;
                }).join('')}</tbody></table>`
                : '<div class="p-6 text-center text-xs text-slate-500">No matching users.</div>';
        } catch (e) { box.innerHTML = `<div class="p-4 text-xs text-rose-700">${esc(e.message)}</div>`; }
    }

    function drawSummary(r) {
        const card = (n, label) => `<div class="bg-white rounded-2xl border border-slate-200 p-3 text-center"><div class="text-2xl font-extrabold text-slate-900">${n}</div><div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${esc(label)}</div></div>`;
        byId('adminSummary').innerHTML = card(r.total, byId('adminSearch').value.trim() ? 'Matching users' : 'Registered users')
            + card(r.byRole.patient || 0, 'Patients') + card((r.byRole.doctor || 0) + (r.byRole.hospital || 0), 'Doctors & hospital staff') + card(r.byRole.admin || 0, 'Admins');
    }

    const section = (title, count, body) => `<div class="bg-white rounded-2xl border border-slate-200 p-4 text-xs space-y-2"><h3 class="font-bold text-slate-900">${esc(title)} <span class="font-normal text-slate-500">(${count})</span></h3>${body}</div>`;
    const empty = '<div class="text-slate-500">Nothing stored.</div>';
    const list = (rows, fn) => rows.length ? `<ul class="divide-y divide-slate-100">${rows.map(r => `<li class="py-2">${fn(r)}</li>`).join('')}</ul>` : empty;

    window.adminOpen = async function (id) {
        const box = byId('adminDetail');
        box.innerHTML = '<div class="text-xs text-slate-500 p-3">Loading…</div>';
        try {
            const d = await GoaAPI.adminUser(id), u = d.user, p = d.profile || {};
            const profileRows = [['Name', p.name], ['Phone', p.phone], ['Emergency contact', p.emergencyContact], ['Blood group', p.bloodGroup], ['DDSSY card', p.ddssyCard], ['Address', p.address], ['Allergies', p.allergies], ['Conditions', p.conditions]];
            box.innerHTML = `<div class="flex items-start justify-between gap-3"><div><h2 class="text-lg font-extrabold text-slate-900">${esc(u.name)}</h2>
                <p class="text-xs text-slate-500">${esc(ROLE_LABEL[u.role] || u.role)} · ${esc(u.phone)} · registered ${esc(stamp(u.registeredAt))}${u.facilityName ? ' · ' + esc(u.facilityName) : ''} · ${u.counts.activeSessions} active session(s)</p></div>
                <button type="button" onclick="byId('adminDetail').innerHTML=''" class="px-3 py-1.5 bg-slate-100 rounded-lg font-bold text-xs">Close</button></div>`
                + section('Profile', profileRows.filter(r => r[1]).length, `<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">${profileRows.map(([k, v]) => `<div class="flex gap-2"><dt class="text-slate-500 w-32 shrink-0">${esc(k)}</dt><dd class="font-semibold">${dash(v)}</dd></div>`).join('')}</dl>`)
                + section('Medical history', d.records.length, list(d.records, r => `<div class="font-semibold">${esc(fmtDate(r.date))} · ${esc(r.diagnosis)}</div><div class="text-slate-600">${esc(r.facility)} · ${esc(r.prescription)}${r.followup ? ' · follow-up ' + esc(fmtDate(r.followup)) : ''}</div>`))
                + section('Prescriptions (photos hidden)', d.prescriptions.length, list(d.prescriptions, r => `<div class="font-semibold">${esc(fmtDate(r.date))} · ${esc(r.doctor)}</div>${r.note ? `<div class="text-slate-600">${esc(r.note)}</div>` : ''}`))
                + section('Appointments', d.appointments.length, list(d.appointments, a => `<div class="font-semibold">${esc(fmtDate(a.date))} ${esc(a.time)} · ${esc(a.name)} · ${esc(a.status)}</div><div class="text-slate-600">${esc(a.reason)}</div>`))
                + section('DDSSY claims', d.claims.length, list(d.claims, c => `<div class="font-semibold">${esc(c.procedure)} · ₹${Number(c.amount).toLocaleString('en-IN')} · ${esc(c.stage)}</div><div class="text-slate-600">${esc(c.hospital)} · submitted ${esc(fmtDate(c.submittedOn))}${c.note ? ' · ' + esc(c.note) : ''}</div>`));
            box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { box.innerHTML = `<div class="text-xs text-rose-700 p-3">${esc(e.message)}</div>`; }
    };

    window.adminLoadAudit = async function () {
        const box = byId('adminAudit'); if (!box) return;
        try {
            const { audit } = await GoaAPI.adminAudit();
            box.innerHTML = audit.length ? `<ul class="divide-y divide-slate-100">${audit.map(a => `<li class="py-1.5">${esc(stamp(a.at))} · <strong>${esc(a.admin)}</strong> ${a.action === 'view_user' ? 'opened user #' + esc(a.targetUserId) : 'listed users'}</li>`).join('')}</ul>` : empty;
        } catch (e) { box.innerHTML = `<div class="text-rose-700">${esc(e.message)}</div>`; }
    };

    window.adminReload = () => { if (built) load(); };
    window.resetAdmin = () => { built = false; seq++; if (root()) root().innerHTML = ''; };

    document.addEventListener('gc:tab', e => {
        if (e.detail !== 'admin' || !GC.user || GC.user.role !== 'admin') return;
        if (!built) { shell(); built = true; }
        load();
    });
})();
