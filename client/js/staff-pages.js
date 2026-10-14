// Staff workspace pages for hospital staff and doctors (administrator pages are in staff-admin.js).
(function () {
    'use strict';
    const S = window.Staff, esc = S.esc, $ = S.$, API = window.GoaAPI;
    const ALL = ['hospital', 'doctor', 'admin'], STAFF = ['hospital', 'admin'];
    const field = (id, label, control, hint, err) => `<div class="field"><label for="${id}">${esc(label)}</label>${control}${hint ? `<small id="${id}-h">${esc(hint)}</small>` : ''}<span class="err-text" id="${id}-e" role="alert">${esc(err || '')}</span></div>`;
    const opts = (map, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + Object.entries(map).map(([k, v]) => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const kpi = (icon, label, val, sub) => `<div class="card kpi"><span class="k-ico"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span class="k-label">${esc(label)}</span><span class="k-val">${val}</span><span class="k-sub">${sub || ''}</span></div>`;
    const notices = list => (list && list.length ? `<div class="stack" style="margin-bottom:1rem">${list.map(a => `<div class="notice ${a.level === 'warn' ? 'n-warn' : 'n-info'}"><i class="fa-solid ${a.level === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info'}" aria-hidden="true"></i><span style="flex:1">${esc(a.text)}</span>${a.page ? `<a href="#/${esc(a.page)}" class="strong" style="white-space:nowrap">Open</a>` : ''}</div>`).join('')}</div>` : '');
    const todayLabel = iso => S.fmtDate(iso);
    S.ui = { field, opts, kpi, notices };

    // ===================================================== OVERVIEW =====================================================
    S.register('overview', { title: 'Overview', roles: ALL, async render(el) {
        if (S.user.role === 'admin') return S.adminOverview(el);
        el.innerHTML = S.head('Overview', 'Loading…') + S.skeletons(4);
        const o = await S.req(() => API.staffOverview());
        return o.role === 'doctor' ? doctorOverview(el, o) : hospitalOverview(el, o);
    } });

    const ROLE_NAME = { manager: 'Administrator', nurse: 'Nurse', reception: 'Reception' };
    function hospitalOverview(el, o) {
        const f = o.facility, ap = o.appointments, w = o.wards, c = o.crowd, dst = o.doctors.byStatus;
        const first = S.user.name.split(/\s+/)[0], bedsTotal = w.recorded ? w.availableTotal : o.beds.reduce((n, b) => n + b.available, 0);
        const bedsAt = w.updatedAt, bedsOld = bedsAt && Date.now() - Date.parse(bedsAt) > 864e5;
        const fresh = (iso, old) => iso ? `${esc(S.ago(iso))}${old ? ' ' + S.badge('Outdated', 'warn') : ''}` : 'never';
        const emergency = f.emergencyAvailable === true ? S.badge('Emergency department: open', 'ok') : f.emergencyAvailable === false ? S.badge('Emergency department: not available', 'bad') : S.badge('Emergency department: not recorded', 'mute');
        const ver = f.infoVerifiedAt ? S.badge('Information verified', 'ok') : S.badge('Information awaiting verification', 'warn');
        const actions = [['beds', 'beds', 'fa-bed-pulse', 'Update Bed Availability'], ['doctors', 'doctors', 'fa-user-doctor', 'Manage Doctors'], ['crowd', 'crowd', 'fa-people-group', 'Update Crowd Level'], ['appointments', 'appointments', 'fa-calendar-check', 'Manage Appointments'], ['hospital', 'info', 'fa-hospital', 'Edit Hospital Information']].filter(a => S.can(a[1], a[1] === 'info' || a[1] === 'doctors' ? 'view' : 'view'));
        el.innerHTML = `<section class="hero" aria-labelledby="wel"><div><h1 id="wel">Welcome, ${esc(first)}</h1><p>${esc(f.name)} · ${esc(ROLE_NAME[S.user.staffRole] || 'Staff')} · ${esc(todayLabel(o.today))}</p>
                <div class="row-flex" style="margin-top:.6rem">${emergency}${ver}</div></div>
              <div class="hero-actions" role="group" aria-label="Quick actions">${actions.map(a => `<a class="btn" href="#/${a[0]}"><i class="fa-solid ${a[2]}" aria-hidden="true"></i> ${esc(a[3])}</a>`).join('')}</div></section>`
            + notices(o.alerts)
            + `<div class="grid g4 keep2" style="margin-bottom:1rem">
                ${kpi('fa-bed-pulse', 'Available beds', bedsTotal, `${w.recorded ? 'Across ' + S.plural(w.recorded, 'ward') + ' recorded' : 'Hospital-wide counts'} · updated ${fresh(bedsAt || f.staffUpdatedAt, bedsOld)}`)}
                ${kpi('fa-user-doctor', 'Doctors on duty', `${o.doctors.onDuty}<small class="muted" style="font-size:1rem"> / ${o.doctors.total}</small>`, `${dst.Available || 0} available · ${dst['In Surgery'] || 0} in surgery · ${dst['On Call'] || 0} on call`)}
                ${kpi('fa-calendar-check', "Today's appointments", ap.todayTotal, `${ap.pending} awaiting a decision · ${ap.upcoming} later`)}
                ${kpi('fa-people-group', 'Current patient queue', c && c.queueCount != null ? c.queueCount : '<span class="muted" style="font-size:1.1rem">Not reported</span>', c ? `${esc(c.level)}${c.waitMinutes != null ? ' · about ' + c.waitMinutes + ' min wait' : ''} · verified ${fresh(c.verifiedAt, c.stale)}` : 'No crowd update yet')}
            </div>
            <div class="grid g2" style="margin-bottom:1rem">
              <section class="card" aria-labelledby="ovB"><div class="card-head"><h2 id="ovB">Bed availability</h2>${S.can('beds') ? '<a href="#/beds" class="small strong">Manage</a>' : ''}</div>
                ${w.recorded ? `<ul class="list">${w.list.map(x => `<li><div><span class="strong">${esc(S.WARD_LABEL[x.type])}</span>${x.demo ? ' ' + S.badge('Demo', 'info') : ''}<div class="muted small">${x.occupied != null ? x.occupied + ' occupied' : 'occupied not recorded'}${x.outOfService ? ' · ' + x.outOfService + ' out of service' : ''}</div></div><div><b>${x.available}</b> free of ${x.total}</div></li>`).join('')}</ul>`
                  : o.beds.map(b => `<div style="margin:.55rem 0"><div class="row-flex" style="justify-content:space-between"><span class="strong">${esc(S.BED_LABEL[b.category])}</span><span><b>${b.available}</b> free${b.total != null ? ` of ${b.total}` : ' <span class="muted small">(capacity not recorded)</span>'}</span></div></div>`).join('') + '<p class="muted small">No ward-level records yet. Use Bed Management to record each ward.</p>'}
                <p class="muted small" style="margin:.7rem 0 0">Bed counts are entered by staff. Occupied beds are only shown when recorded.</p></section>
              <section class="card" aria-labelledby="ovA"><div class="card-head"><h2 id="ovA">Today's appointment requests</h2><a href="#/appointments" class="small strong">Open</a></div>
                ${ap.todayTotal ? `<div class="row-flex">${['Requested', 'Confirmed', 'Declined'].filter(x => ap.today[x]).map(x => `<span class="badge b-${S.apptTone(x)}">${ap.today[x]} ${esc(S.apptLabel(x).toLowerCase())}</span>`).join('')}</div>` : S.empty({ icon: 'fa-calendar', title: 'No requests for today', text: 'New requests from patients appear here.' })}
              </section></div>
            <div class="grid g2">
              <section class="card" aria-labelledby="ovU"><div class="card-head"><h2 id="ovU">Units &amp; departments</h2>${S.can('info') ? '<a href="#/units" class="small strong">Manage</a>' : ''}</div>
                ${o.units.list.length ? `<ul class="list">${o.units.list.slice(0, 6).map(u => `<li><div><div class="strong">${esc(u.name)}</div><div class="muted small">${esc(S.UNIT_TYPES[u.type] || u.type)} · ${S.plural(u.doctorCount, 'doctor')}</div></div><div class="row-flex">${u.active ? S.badge('Active', 'ok') : S.badge('Inactive', 'mute')}${u.verified ? '' : S.badge('Unverified', 'warn')}</div></li>`).join('')}</ul>`
                    : S.empty({ icon: 'fa-sitemap', title: 'No units yet', text: 'Add the units your hospital runs, such as ICU, OPD or Emergency.' })}</section>
              <section class="card" aria-labelledby="ovR"><div class="card-head"><h2 id="ovR">Recent changes</h2><a href="#/activity" class="small strong">All history</a></div>${S.activityList(o.activity)}</section></div>`;
    }

    function doctorOverview(el, o) {
        const d = o.doctor, ap = o.appointments;
        el.innerHTML = S.head('Overview', `${d.name} · ${todayLabel(o.today)}`, `<a class="btn" href="#/profile"><i class="fa-solid fa-id-card-clip" aria-hidden="true"></i> Availability &amp; Profile</a>`) + notices(o.alerts)
            + `<div class="grid g4 keep2" style="margin-bottom:1rem">
                ${kpi('fa-calendar-day', "Today's appointments", ap.todayTotal, 'Requested or confirmed')}
                ${kpi('fa-calendar-week', 'Upcoming', ap.upcoming, 'After today, not cancelled')}
                ${kpi('fa-hourglass-half', 'Awaiting your decision', ap.pending, 'Open requests')}
                ${kpi('fa-circle-check', 'Availability', S.badge(d.status, S.statusTone(d.status)), `${esc(d.room)}${d.unitName ? ' · ' + esc(d.unitName) : ''}`)}
            </div>
            <div class="grid g2"><section class="card" aria-labelledby="dS"><div class="card-head"><h2 id="dS">Today's schedule</h2><a class="small strong" href="#/appointments">All appointments</a></div>
                ${ap.today.length ? `<ul class="list">${ap.today.map(a => `<li><div><div class="strong">${esc(a.time)} · ${esc(a.patient)}</div><div class="muted small">${esc(a.reason || 'General consultation')}</div></div>${S.badge(S.apptLabel(a.status), S.apptTone(a.status))}</li>`).join('')}</ul>` : S.empty({ icon: 'fa-calendar', title: 'Nothing scheduled today', text: 'Confirmed and requested appointments for today appear here.' })}</section>
              <section class="card" aria-labelledby="dP"><div class="card-head"><h2 id="dP">Requests awaiting action</h2></div>
                ${ap.pendingList.length ? `<ul class="list" id="pend">${ap.pendingList.map(a => `<li><div><div class="strong">${esc(a.patient)}</div><div class="muted small">${esc(S.fmtDate(a.date))} · ${esc(a.time)} · ${esc(a.reason || 'General consultation')}</div></div><div class="row-flex"><button class="btn btn-sm btn-ok" data-act="Confirmed" data-id="${a.id}">Confirm</button><button class="btn btn-sm btn-danger" data-act="Declined" data-id="${a.id}">Decline</button></div></li>`).join('')}</ul>` : S.empty({ icon: 'fa-circle-check', title: 'All caught up', text: 'No requests are waiting for you.' })}
                ${ap.pending > ap.pendingList.length ? `<p class="small muted">Showing ${ap.pendingList.length} of ${ap.pending}. <a href="#/appointments?status=Requested">See all</a></p>` : ''}</section></div>`;
        el.addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (b) { if (await decideAppointment(b.dataset.id, b.dataset.act, b.closest('li').querySelector('.strong').textContent)) { S.rerender(); S.refreshAlerts(); } } });
    }

    // ===================================================== APPOINTMENTS =====================================================
    // Confirm / decline with the same rules as the server. Declining asks first because the patient is told.
    async function decideAppointment(id, status, who) {
        if (status === 'Declined' && !(await S.confirm({ title: 'Decline this request?', message: `${esc(who || 'The patient')} will see that the request was declined. This cannot be undone from here.`, confirm: 'Decline request', danger: true }))) return false;
        try { await S.req(() => API.setAppointmentStatus(Number(id), status)); S.toast(status === 'Confirmed' ? 'Appointment confirmed.' : 'Appointment declined.'); return true; }
        catch (e) { S.toast(e.message, 'error'); return false; }
    }

    S.register('appointments', { title: 'Appointments', roles: ['hospital', 'doctor'], cap: 'appointments', async render(el, params) {
        const isHosp = S.user.role === 'hospital';
        const doctors = isHosp ? (await S.req(() => API.staffDoctors())).doctors : [], units = isHosp ? (await S.req(() => API.units())).units : [];
        const st = { q: params.q || '', date: params.date || '', status: params.status || '', doctorId: '', unitId: '', scope: params.scope === 'all' ? 'all' : 'upcoming' };
        el.innerHTML = S.head(isHosp ? 'Appointments' : 'My appointments', isHosp ? 'Requests for your hospital and its doctors. Only the patient\'s name and the reason they gave are shown.' : 'Requests assigned to you. Only the patient\'s name and the reason they gave are shown.')
            + `<form class="filters" id="af" role="search" aria-label="Filter appointments">
                <div class="field grow"><label for="fq">Search</label><input id="fq" class="in" type="search" placeholder="Patient, doctor or reason" value="${esc(st.q)}"></div>
                <div class="field"><label for="fd">Date</label><input id="fd" class="in" type="date" value="${esc(st.date)}"></div>
                <div class="field"><label for="fs">Status</label><select id="fs" class="in">${opts({ Requested: 'Awaiting decision', Confirmed: 'Confirmed', Declined: 'Declined', Cancelled: 'Cancelled by patient' }, st.status, 'All statuses')}</select></div>
                ${isHosp ? `<div class="field"><label for="fdoc">Doctor</label><select id="fdoc" class="in"><option value="">All doctors</option>${doctors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
                <div class="field"><label for="fu">Department / unit</label><select id="fu" class="in"><option value="">All units</option>${units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>` : ''}
                <div class="field"><span class="lbl">Show</span><span class="seg" role="group" aria-label="Date range"><button type="button" data-scope="upcoming" aria-pressed="${st.scope === 'upcoming'}">Today &amp; upcoming</button><button type="button" data-scope="all" aria-pressed="${st.scope === 'all'}">Include past</button></span></div>
                <button type="button" class="btn" id="fclr">Clear filters</button></form>
              <div id="aList" aria-live="polite"></div>`;
        const host = $('#aList', el); let table = null;
        const cols = [
            { key: 'when', label: 'When', sort: r => r.date + r.time, html: r => `<span class="strong">${esc(S.fmtDate(r.date))}</span><br><span class="muted small">${esc(r.time)}${r.date === todayStr ? ' · today' : ''}</span>` },
            { key: 'patient', label: 'Patient', sort: true, html: r => esc(r.patient) },
            { key: 'name', label: isHosp ? 'Doctor / service' : 'Booked with', sort: true, html: r => `${esc(r.name)}${r.unitName ? `<br><span class="muted small">${esc(r.unitName)}</span>` : ''}` },
            { key: 'reason', label: 'Reason', html: r => esc(r.reason || '-') },
            { key: 'status', label: 'Status', sort: true, html: r => S.badge(S.apptLabel(r.status), S.apptTone(r.status)) },
            { key: 'a', label: 'Actions', actions: true, html: r => r.status === 'Requested' && (S.user.role === 'doctor' || S.can('appointments', 'write')) ? `<span class="acts"><button class="btn btn-sm btn-ok" data-act="Confirmed" data-id="${r.id}" aria-label="Confirm request from ${esc(r.patient)}">Confirm</button><button class="btn btn-sm btn-danger" data-act="Declined" data-id="${r.id}" aria-label="Decline request from ${esc(r.patient)}">Decline</button></span>` : '<span class="muted small">-</span>' }];
        let todayStr = '', rows = [];
        async function load() {
            const reqId = ++load.n;
            try {
                const r = await S.req(() => API.staffAppointments({ scope: st.scope === 'all' ? 'all' : '', date: st.date, status: st.status, doctorId: st.doctorId, unitId: st.unitId, q: st.q }));
                if (reqId !== load.n) return; todayStr = r.today; rows = r.appointments;
                if (!table) table = S.table(host, { cols, rows, pageSize: 12, sort: { key: 'when', dir: st.scope === 'all' ? -1 : 1 }, empty: S.empty({ icon: 'fa-calendar', title: 'No appointments match', text: Object.values(st).some(Boolean) && (st.q || st.date || st.status || st.doctorId || st.unitId) ? 'Try clearing a filter.' : 'New appointment requests will appear here.' }) });
                else table.setRows(rows);
                if (r.total > r.appointments.length) host.insertAdjacentHTML('beforeend', `<p class="muted small">Showing the first ${r.appointments.length} of ${r.total}. Narrow the filters to see the rest.</p>`);
            } catch (e) { host.innerHTML = S.errorBox(e.message, true); const b = $('[data-retry]', host); if (b) b.addEventListener('click', load); }
        }
        load.n = 0;
        const reload = S.debounce(load, 250);
        $('#af', el).addEventListener('submit', e => e.preventDefault());
        el.addEventListener('input', e => { const m = { fq: 'q', fd: 'date', fs: 'status', fdoc: 'doctorId', fu: 'unitId' }[e.target.id]; if (m) { st[m] = e.target.value; reload(); } });
        el.addEventListener('click', async e => {
            const sc = e.target.closest('[data-scope]'); if (sc) { st.scope = sc.dataset.scope; $$all('[data-scope]', el).forEach(b => b.setAttribute('aria-pressed', String(b === sc))); table = null; load(); return; }
            if (e.target.closest('#fclr')) { Object.assign(st, { q: '', date: '', status: '', doctorId: '', unitId: '' }); ['fq', 'fd', 'fs', 'fdoc', 'fu'].forEach(i => { const x = $('#' + i, el); if (x) x.value = ''; }); load(); return; }
            const b = e.target.closest('[data-act]'); if (!b) return;
            b.disabled = true; const ok = await decideAppointment(b.dataset.id, b.dataset.act, b.closest('tr').children[1].textContent); if (ok) { await load(); S.refreshAlerts(); } else b.disabled = false;
        });
        await load();
        const t = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) load(); }, 30000);
        return () => clearInterval(t);
    } });
    const $$all = S.$$;

    // ===================================================== UNITS & DEPARTMENTS =====================================================
    S.register('units', { title: 'Units & departments', roles: STAFF, cap: 'info', async render(el, params) {
        if (S.needFacility(el)) return;
        const isAdmin = S.user.role === 'admin';
        let data = await S.req(() => API.units(S.fid())), docs = (await S.req(() => API.staffDoctors(S.fid()))).doctors;
        const st = { q: params.q || '', type: '', status: '' };
        el.innerHTML = S.head('Units & departments', 'The units this hospital actually runs. The unit types are examples: add only what exists here and keep each record complete.', '<button class="btn btn-primary" id="addU"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add Unit</button>')
            + `<div id="uSum" class="row-flex" style="margin-bottom:.8rem"></div>
               <form class="filters" role="search" aria-label="Filter units" onsubmit="return false"><div class="field grow"><label for="uq">Search</label><input id="uq" class="in" type="search" placeholder="Unit name or type" value="${esc(st.q)}"></div>
                <div class="field"><label for="ut">Type</label><select id="ut" class="in">${opts(S.UNIT_TYPES, '', 'All types')}</select></div>
                <div class="field"><label for="us">Show</label><select id="us" class="in">${opts({ active: 'Active only', inactive: 'Inactive only', incomplete: 'Missing information', unverified: 'Not verified' }, '', 'All units')}</select></div></form>
               <div id="uList"></div>`;
        const host = $('#uList', el);
        const GAP = { description: 'description', location: 'location', contact: 'contact number', doctors: 'doctors' };
        const cols = [
            { key: 'name', label: 'Unit', sort: true, html: u => `<span class="strong">${esc(u.name)}</span><br><span class="muted small">${esc(S.UNIT_TYPES[u.type] || u.type)}${u.location ? ' · ' + esc(u.location) : ''}</span>` },
            { key: 'doctorCount', label: 'Doctors', sort: true, html: u => `${u.doctorCount}` },
            { key: 'beds', label: 'Linked beds', html: u => u.beds ? `${esc(S.BED_LABEL[u.beds.category])}: <b>${u.beds.available}</b> free<br><span class="muted small">hospital-wide${u.beds.sharedWithUnits > 1 ? ', shared by ' + u.beds.sharedWithUnits + ' units' : ''}</span>` : '<span class="muted small">Not linked</span>' },
            { key: 'active', label: 'Status', sort: u => (u.active ? 0 : 1), html: u => `${u.active ? S.badge('Active', 'ok') : S.badge('Inactive', 'mute')}<br>${u.verifiedAt ? S.badge('Verified', 'ok') : S.badge('Not verified', 'warn')}` },
            { key: 'gaps', label: 'Missing info', html: u => u.gaps.length ? `<span class="small" style="color:#92400e"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${esc(u.gaps.map(g => GAP[g]).join(', '))}</span>` : '<span class="muted small">Complete</span>' },
            { key: 'a', label: 'Actions', actions: true, html: u => `<span class="acts"><button class="btn btn-sm" data-u="edit" data-id="${u.id}" aria-label="Edit ${esc(u.name)}">Edit</button><button class="btn btn-sm" data-u="docs" data-id="${u.id}" aria-label="Assign doctors to ${esc(u.name)}">Doctors</button><button class="btn btn-sm ${u.active ? 'btn-danger' : ''}" data-u="${u.active ? 'off' : 'on'}" data-id="${u.id}" aria-label="${u.active ? 'Deactivate' : 'Activate'} ${esc(u.name)}">${u.active ? 'Deactivate' : 'Activate'}</button>${isAdmin && !u.verifiedAt ? `<button class="btn btn-sm btn-ok" data-u="verify" data-id="${u.id}" aria-label="Verify ${esc(u.name)}">Verify</button>` : ''}</span>` }];
        const table = S.table(host, { cols, rows: [], pageSize: 10, sort: { key: 'active', dir: 1 }, empty: '' });
        function filtered() { const q = st.q.toLowerCase(); return data.units.filter(u => (!q || u.name.toLowerCase().includes(q) || (S.UNIT_TYPES[u.type] || '').toLowerCase().includes(q)) && (!st.type || u.type === st.type) && (!st.status || (st.status === 'active' ? u.active : st.status === 'inactive' ? !u.active : st.status === 'incomplete' ? u.gaps.length : !u.verifiedAt))); }
        function draw() {
            const s = data.summary;
            $('#uSum', el).innerHTML = `${S.badge(S.plural(s.total, 'unit') + ' in total', 'brand')}${S.badge(s.active + ' active', 'ok')}${s.unverified ? S.badge(s.unverified + ' not verified', 'warn') : ''}${s.incomplete ? S.badge(s.incomplete + ' missing information', 'warn') : ''}`;
            const rows = filtered();
            if (!data.units.length) host.innerHTML = `<div class="tbl-wrap">${S.empty({ icon: 'fa-sitemap', title: 'No units yet', text: 'Add the units your hospital runs, for example Emergency, ICU, OPD, Pediatrics or Pharmacy. Nothing is assumed: only units you add are shown.', action: '<button class="btn btn-primary" data-u="add">Add Unit</button>' })}</div>`;
            else if (!rows.length) host.innerHTML = `<div class="tbl-wrap">${S.empty({ icon: 'fa-magnifying-glass', title: 'No units match', text: 'Try a different search or clear the filters.' })}</div>`;
            else { if (!$('table', host)) host.innerHTML = ''; table.setRows(rows); }
        }
        async function reload() { [data, docs] = await Promise.all([S.req(() => API.units(S.fid())), S.req(() => API.staffDoctors(S.fid())).then(r => r.doctors)]); S.clearSearchCache(); draw(); S.refreshAlerts(); }

        function unitForm(u) {
            const suggest = { icu: 'icu', general_ward: 'general' };
            return `${field('uName', 'Unit name', `<input id="uName" name="name" class="in" required minlength="2" maxlength="80" value="${esc(u ? u.name : '')}">`)}
                ${field('uType', 'Unit type', `<select id="uType" name="type" class="in" required>${opts(S.UNIT_TYPES, u ? u.type : '', 'Choose a type…')}</select>`, 'Examples only. Pick the closest type.')}
                ${field('uDesc', 'Description', `<textarea id="uDesc" name="description" class="in" maxlength="500">${esc(u ? u.description : '')}</textarea>`)}
                <div class="grid g2">${field('uLoc', 'Location', `<input id="uLoc" name="location" class="in" maxlength="100" placeholder="Block / floor" value="${esc(u ? u.location : '')}">`)}${field('uCon', 'Contact number / extension', `<input id="uCon" name="contact" class="in" maxlength="60" value="${esc(u ? u.contact : '')}">`)}</div>
                ${field('uHrs', 'Operating hours', `<input id="uHrs" name="hours" class="in" maxlength="80" placeholder="e.g. 24x7 or 9 AM - 1 PM" value="${esc(u ? u.hours : '')}">`)}
                ${field('uBed', 'Link to hospital bed counts', `<select id="uBed" name="bedCategory" class="in">${opts({ icu: 'ICU beds', oxygen: 'Oxygen-supported beds', general: 'General beds' }, u ? u.bedCategory || '' : '', 'Not linked')}</select>`, 'Shows the hospital-wide count for that bed type. No numbers are copied into the unit.')}
                ${u ? '<div class="notice n-info"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Editing a unit marks it as not verified until an administrator confirms it again.</span></div>' : ''}`;
        }
        const formBody = d => Object.fromEntries(new FormData(d.querySelector('form')).entries());
        async function openForm(u) {
            const done = await S.modal({ title: u ? 'Edit unit' : 'Add unit', body: unitForm(u), submit: u ? 'Save Changes' : 'Add Unit',
                onOpen: d => { if (!u) $('#uType', d).addEventListener('change', e => { const n = $('#uName', d), b = $('#uBed', d); if (!n.value.trim() && e.target.value) n.value = S.UNIT_TYPES[e.target.value].replace(/ \(.*\)/, ''); if (!b.value) b.value = { icu: 'icu', general_ward: 'general' }[e.target.value] || ''; }); },
                onSubmit: async d => { const b = formBody(d); if (u) await S.req(() => API.updateUnit(u.id, b)); else await S.req(() => API.createUnit({ ...b, facilityId: S.fid() })); } });
            if (done) { S.toast(u ? 'Unit saved.' : 'Unit added.'); await reload(); }
        }
        async function assign(u) {
            const done = await S.modal({ title: 'Doctors in ' + u.name, wide: true, submit: 'Save Assignments',
                body: docs.length ? `<p class="muted small">Tick the doctors who work in this unit. A doctor belongs to one unit, so ticking a doctor from another unit moves them here.</p><div class="checks" role="group" aria-label="Doctors">${docs.map(d => `<label><input type="checkbox" name="doc" value="${d.id}" ${d.unitId === u.id ? 'checked' : ''}><span><b>${esc(d.name)}</b> <span class="muted small">${esc(d.spec)}${d.unitId && d.unitId !== u.id ? ' · currently in ' + esc(d.unitName) + ' (will be moved)' : ''}</span></span></label>`).join('')}</div>` : S.empty({ icon: 'fa-user-doctor', title: 'No doctors at this hospital', text: 'Doctors appear here once they are linked to the hospital.' }),
                onSubmit: async d => { const ids = Array.from(d.querySelectorAll('[name=doc]:checked')).map(i => Number(i.value)); await S.req(() => API.setUnitDoctors(u.id, ids)); } });
            if (done) { S.toast('Doctor assignments saved.'); await reload(); }
        }
        el.addEventListener('click', async e => {
            const b = e.target.closest('[data-u]'); if (!b) return;
            const u = data.units.find(x => x.id === Number(b.dataset.id)), a = b.dataset.u;
            if (a === 'add') return openForm(null); if (!u) return;
            if (a === 'edit') return openForm(u); if (a === 'docs') return assign(u);
            try {
                if (a === 'off') { if (!(await S.confirm({ title: 'Deactivate this unit?', message: `<b>${esc(u.name)}</b> will be marked inactive. ${u.doctorCount ? S.plural(u.doctorCount, 'doctor') + ' stay assigned to it. ' : ''}You can activate it again at any time.`, confirm: 'Deactivate', danger: true }))) return; await S.req(() => API.setUnitActive(u.id, false)); S.toast('Unit deactivated.'); }
                else if (a === 'on') { await S.req(() => API.setUnitActive(u.id, true)); S.toast('Unit activated.'); }
                else if (a === 'verify') { if (!(await S.confirm({ title: 'Verify this unit?', message: `Confirm that the details of <b>${esc(u.name)}</b> have been checked.`, confirm: 'Verify' }))) return; await S.req(() => API.verifyUnit(u.id)); S.toast('Unit verified.'); }
                await reload();
            } catch (err) { S.toast(err.message, 'error'); }
        });
        $('#addU', el).addEventListener('click', () => openForm(null));
        el.addEventListener('input', e => { const m = { uq: 'q', ut: 'type', us: 'status' }[e.target.id]; if (m) { st[m] = e.target.value; draw(); } });
        draw();
        if (params.new) openForm(null);
    } });

    // ===================================================== DOCTOR: AVAILABILITY & PROFILE =====================================================
    S.register('profile', { title: 'Availability & profile', roles: ['doctor'], async render(el) {
        const [dr, hr] = await Promise.all([S.req(() => API.staffDoctors()), S.req(() => API.staffHospital())]);
        let d = dr.doctors[0]; const f = hr.facility;
        if (!d) { el.innerHTML = S.head('Availability & profile') + S.empty({ icon: 'fa-id-card-clip', title: 'No doctor profile linked', text: 'Ask your hospital staff to link your account to your doctor profile.' }); return; }
        const paint = () => {
            el.innerHTML = S.head('Availability & profile', 'Update your own availability and room. Patients see these on the doctor list.')
                + `<div class="grid g2"><section class="card stack" aria-labelledby="av"><h2 id="av">Availability</h2>
                    <div><span class="lbl" id="stl">Current status</span><div class="seg" role="group" aria-labelledby="stl" style="margin-top:.35rem">${S.STATUSES.map(s => `<button type="button" data-s="${s}" aria-pressed="${d.status === s}">${s}</button>`).join('')}</div></div>
                    <form id="rf" novalidate>${field('mRoom', 'Room', `<input id="mRoom" class="in" maxlength="60" required value="${esc(d.room)}">`, 'The room patients are directed to.')}<div class="row-flex" style="margin-top:.7rem"><button class="btn btn-primary" type="submit">Save Room</button></div></form>
                    <p class="muted small" style="margin:0">Last updated ${esc(S.fmtStamp(d.updatedAt))}.</p></section>
                  <section class="card" aria-labelledby="pf"><h2 id="pf">Professional profile</h2>
                    <dl class="kv"><dt>Name</dt><dd>${esc(d.name)}</dd><dt>Specialty</dt><dd>${esc(d.spec)}</dd><dt>Unit / department</dt><dd>${d.unitName ? esc(d.unitName) : 'Not assigned yet'}</dd><dt>OPD timings</dt><dd>${esc(d.timings)}</dd><dt>Fee</dt><dd>${esc(d.fee)}</dd>
                    <dt>Hospital</dt><dd>${esc(f.name)}</dd><dt>Address</dt><dd>${esc(f.address)}</dd><dt>Hospital phone</dt><dd>${f.phone ? esc(f.phone) : 'Not on file'}</dd></dl>
                    <div class="notice n-info" style="margin-top:.8rem"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Your name, specialty, timings and fee are managed by hospital staff. You can only change your own availability and room.</span></div></section></div>`;
        };
        paint();
        async function save(patch, ok) { try { const r = await S.req(() => API.setDoctor(d.id, patch)); d = r.staff; S.toast(ok); paint(); S.refreshAlerts(); } catch (e) { S.toast('Not saved: ' + e.message, 'error'); } }
        el.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b && b.dataset.s !== d.status) save({ status: b.dataset.s }, 'Availability set to ' + b.dataset.s + '.'); });
        el.addEventListener('submit', e => { if (e.target.id !== 'rf') return; e.preventDefault(); const v = $('#mRoom', el).value.trim(); if (!v) { $('#mRoom-e', el).textContent = 'Enter your room.'; return $('#mRoom', el).focus(); } save({ room: v }, 'Room saved.'); });
    } });

    // ===================================================== CHANGE HISTORY =====================================================
    S.register('activity', { title: 'Change history', roles: STAFF, async render(el) {
        if (S.user.role === 'admin') return S.adminActivity(el);
        let offset = 0; const size = 20;
        async function draw() {
            const r = await S.req(() => API.staffActivity(undefined, size, offset));
            el.innerHTML = S.head('Change history', 'Who changed what at this hospital. Patient names and health details are never recorded here.')
                + `<section class="card">${S.activityList(r.items)}<div class="pager" style="margin:.6rem -1rem -1rem;border-radius:0 0 12px 12px"><span>${r.total ? `Showing ${offset + 1}–${offset + r.items.length} of ${r.total}` : 'No entries'}</span><span class="row-flex"><button class="btn btn-sm" data-o="-1" ${offset === 0 ? 'disabled' : ''}>Newer</button><button class="btn btn-sm" data-o="1" ${offset + size >= r.total ? 'disabled' : ''}>Older</button></span></div></section>`;
        }
        el.addEventListener('click', async e => { const b = e.target.closest('[data-o]'); if (b && !b.disabled) { offset = Math.max(0, offset + Number(b.dataset.o) * size); await draw(); el.focus({ preventScroll: true }); } });
        await draw();
    } });
})();
