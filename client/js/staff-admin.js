// Staff workspace: administrator pages (overview, users, hospital directory + verification, system activity).
(function () {
    'use strict';
    const S = window.Staff, esc = S.esc, $ = S.$, API = window.GoaAPI;
    const ROLE = { patient: 'Patient', doctor: 'Doctor', hospital: 'Hospital staff', admin: 'Administrator' };
    const roleTone = r => (r === 'admin' ? 'info' : r === 'patient' ? 'mute' : 'brand');
    const kpi = (icon, label, val, sub) => `<div class="card kpi"><span class="k-ico"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span class="k-label">${esc(label)}</span><span class="k-val">${val}</span><span class="k-sub">${sub || ''}</span></div>`;

    S.adminOverview = async function (el) {
        el.innerHTML = S.head('Overview', 'System-wide view for administrators.') + S.skeletons(4);
        const [o, act] = await Promise.all([S.req(() => API.adminOverview()), S.req(() => API.adminActivity({ limit: 8 }))]);
        const r = o.users.byRole, ap = o.appointments;
        el.innerHTML = S.head('Overview', 'System-wide view for administrators. Hospital staff and doctors manage their own hospital; administrators verify and oversee.', '<a class="btn btn-primary" href="#/hospitals"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Verify Hospital Data</a>')
            + (S.alerts.length ? `<div class="stack" style="margin-bottom:1rem">${S.alerts.map(a => `<div class="notice ${a.level === 'warn' ? 'n-warn' : 'n-info'}"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span style="flex:1">${esc(a.text)}</span><a class="strong" href="#/${esc(a.page)}">Review</a></div>`).join('')}</div>` : '')
            + `<div class="grid g4 keep2" style="margin-bottom:1rem">
                ${kpi('fa-users', 'Registered users', o.users.total, `${r.patient || 0} patients · ${r.doctor || 0} doctors · ${r.hospital || 0} hospital staff · ${r.admin || 0} admins`)}
                ${kpi('fa-hospital', 'Hospitals', o.hospitals.total, `${o.hospitals.verified} verified · ${o.hospitals.awaitingVerification} awaiting`)}
                ${kpi('fa-user-doctor', 'Doctors in directory', o.doctors.total, `${o.hospitals.bedsConfirmedLast24h} hospitals confirmed beds in 24 h`)}
                ${kpi('fa-sitemap', 'Units', o.units.total, `${o.units.active} active · ${o.units.verified} verified`)}</div>
              <div class="grid g2"><section class="card" aria-labelledby="aa"><h2 id="aa">Appointment requests <small>(all hospitals, counts only)</small></h2>
                <div class="row-flex">${['Requested', 'Confirmed', 'Declined', 'Cancelled'].map(s => `<span class="badge b-${S.apptTone(s)}">${ap[s] || 0} ${esc(S.apptLabel(s).toLowerCase())}</span>`).join('')}</div>
                <p class="muted small">Patient details are not shown on this page.</p></section>
              <section class="card" aria-labelledby="ar"><div class="card-head"><h2 id="ar">Recent changes</h2><a class="small strong" href="#/activity">All activity</a></div>${S.activityList(act.items, true)}</section></div>`;
    };

    // ---------------- users ----------------
    S.register('users', { title: 'Users', roles: ['admin'], async render(el) {
        const st = { q: '', role: '' };
        el.innerHTML = S.head('Users', 'Registered accounts. Opening an account is read-only and every view is written to the access log. Password hashes and prescription photos are never shown.')
            + `<div id="uSum" class="row-flex" style="margin-bottom:.8rem"></div>
               <form class="filters" role="search" aria-label="Filter users" onsubmit="return false"><div class="field grow"><label for="uq">Search</label><input id="uq" class="in" type="search" placeholder="Name, mobile number or Health ID"></div>
               <div class="field"><label for="ur">Role</label><select id="ur" class="in"><option value="">All roles</option>${Object.entries(ROLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></form><div id="uList"></div>`;
        const host = $('#uList', el);
        const table = S.table(host, { pageSize: 12, sort: { key: 'registeredAt', dir: -1 }, rows: [], empty: S.empty({ icon: 'fa-users', title: 'No matching users', text: 'Try a different search or role.' }), cols: [
            { key: 'name', label: 'Name', sort: true, html: u => `<span class="strong">${esc(u.name)}</span>` },
            { key: 'role', label: 'Role', sort: true, html: u => S.badge(ROLE[u.role] || u.role, roleTone(u.role)) },
            { key: 'phone', label: 'Mobile / Health ID', html: u => esc(u.phone) },
            { key: 'registeredAt', label: 'Registered', sort: true, html: u => `<span class="small">${esc(S.fmtStamp(u.registeredAt))}</span>` },
            { key: 'consentAt', label: 'Consent', sort: u => u.consentAt || '', html: u => u.consentAt ? S.badge('Given', 'ok') : S.badge('Not yet', 'warn') },
            { key: 'items', label: 'Stored items', sort: u => u.counts.records + u.counts.prescriptions + u.counts.appointments + u.counts.claims, html: u => u.counts.records + u.counts.prescriptions + u.counts.appointments + u.counts.claims },
            { key: 'a', label: 'Actions', actions: true, html: u => `<span class="acts"><button class="btn btn-sm" data-v="${u.id}" aria-label="View ${esc(u.name)}">View</button></span>` }] });
        let seq = 0;
        async function load() {
            const my = ++seq;
            try {
                const r = await S.req(() => API.adminUsers(st.q.trim(), st.role)); if (my !== seq) return;
                $('#uSum', el).innerHTML = S.badge(S.plural(r.total, 'matching user'), 'brand') + Object.entries(r.byRole).map(([k, n]) => S.badge(`${n} ${(ROLE[k] || k).toLowerCase()}${n === 1 ? '' : 's'}`, roleTone(k))).join('');
                table.setRows(r.users); host.lastUsers = r.users;
            } catch (e) { host.innerHTML = S.errorBox(e.message, true); const b = $('[data-retry]', host); if (b) b.addEventListener('click', load); }
        }
        const reload = S.debounce(load, 250);
        el.addEventListener('input', e => { if (e.target.id === 'uq') st.q = e.target.value; else if (e.target.id === 'ur') st.role = e.target.value; else return; reload(); });
        el.addEventListener('click', async e => {
            const b = e.target.closest('[data-v]'); if (!b) return; b.disabled = true;
            try { const d = await S.req(() => API.adminUser(Number(b.dataset.v))); userDialog(d); } catch (err) { S.toast(err.message, 'error'); } finally { b.disabled = false; }
        });
        await load();
    } });
    function userDialog(d) {
        const u = d.user, p = d.profile || {}, dash = v => (v == null || v === '' ? '-' : esc(v));
        const sec = (t, n, body) => `<section class="card" style="margin-top:.8rem"><h2>${esc(t)} <small>(${n})</small></h2>${body}</section>`, none = '<p class="muted">Nothing stored.</p>';
        const list = (rows, fn) => rows.length ? `<ul class="list">${rows.map(r => `<li><div>${fn(r)}</div></li>`).join('')}</ul>` : none;
        S.modal({ title: u.name, wide: true, hideSubmit: true, cancel: 'Close',
            body: `<p class="muted small">${esc(ROLE[u.role] || u.role)} · ${esc(u.phone)} · registered ${esc(S.fmtStamp(u.registeredAt))}${u.facilityName ? ' · ' + esc(u.facilityName) : ''} · ${u.counts.activeSessions} active session(s). <b>This view was logged.</b></p>`
                + sec('Profile', 8, `<dl class="kv">${[['Name', p.name], ['Phone', p.phone], ['Emergency contact', p.emergencyContact], ['Blood group', p.bloodGroup], ['DDSSY card', p.ddssyCard], ['Address', p.address], ['Allergies', p.allergies], ['Conditions', p.conditions]].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${dash(v)}</dd>`).join('')}</dl>`)
                + sec('Medical history', d.records.length, list(d.records, r => `<b>${esc(S.fmtDate(r.date))} · ${esc(r.diagnosis)}</b><div class="muted small">${esc(r.facility)} · ${esc(r.prescription)}</div>`))
                + sec('Prescriptions (photos hidden)', d.prescriptions.length, list(d.prescriptions, r => `<b>${esc(S.fmtDate(r.date))} · ${esc(r.doctor)}</b>${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}`))
                + sec('Appointments', d.appointments.length, list(d.appointments, a => `<b>${esc(S.fmtDate(a.date))} ${esc(a.time)} · ${esc(a.name)}</b> ${S.badge(S.apptLabel(a.status), S.apptTone(a.status))}<div class="muted small">${esc(a.reason)}</div>`))
                + sec('DDSSY claims', d.claims.length, list(d.claims, c => `<b>${esc(c.procedure)} · ₹${Number(c.amount).toLocaleString('en-IN')} · ${esc(c.stage)}</b><div class="muted small">${esc(c.hospital)}</div>`)) });
    }

    // ---------------- hospital directory and verification ----------------
    S.register('hospitals', { title: 'Hospital directory', roles: ['admin'], async render(el) {
        let list = (await S.req(() => API.adminFacilities())).facilities; const st = { q: '', f: '' };
        el.innerHTML = S.head('Hospital directory', 'Check and verify what hospitals have entered. “Manage” opens that hospital\'s units, doctors and details.')
            + `<form class="filters" role="search" aria-label="Filter hospitals" onsubmit="return false"><div class="field grow"><label for="hq">Search</label><input id="hq" class="in" type="search" placeholder="Hospital name or district"></div>
               <div class="field"><label for="hf">Show</label><select id="hf" class="in"><option value="">All hospitals</option><option value="unverified">Details awaiting verification</option><option value="nobeds">Bed counts never confirmed</option><option value="units">Units not verified</option></select></div></form><div id="hList"></div>`;
        const host = $('#hList', el);
        const table = S.table(host, { pageSize: 12, sort: { key: 'name', dir: 1 }, rows: [], empty: S.empty({ icon: 'fa-hospital', title: 'No hospitals match', text: 'Try a different search or filter.' }), cols: [
            { key: 'name', label: 'Hospital', sort: true, html: f => `<span class="strong">${esc(f.name)}</span><br><span class="muted small">${esc(f.careType)} · ${esc(f.district)}</span>` },
            { key: 'doctorCount', label: 'Doctors', sort: true, html: f => f.doctorCount },
            { key: 'unitCount', label: 'Units', sort: true, html: f => `${f.unitCount}${f.unitsUnverified ? `<br><span class="small" style="color:#92400e">${f.unitsUnverified} unverified</span>` : ''}` },
            { key: 'staffUpdatedAt', label: 'Bed counts', sort: f => f.staffUpdatedAt || '', html: f => f.staffUpdatedAt ? `<span class="small">${esc(S.ago(f.staffUpdatedAt))}${f.bedsUpdatedBy ? '<br><span class="muted">by ' + esc(f.bedsUpdatedBy) + '</span>' : ''}</span>` : S.badge('Never confirmed', 'warn') },
            { key: 'infoVerifiedAt', label: 'Details', sort: f => f.infoVerifiedAt || '', html: f => `${f.infoVerifiedAt ? S.badge('Verified', 'ok') : S.badge('Awaiting', 'warn')}<br>${f.phoneVerified ? '<span class="muted small">Phone on file</span>' : '<span class="small" style="color:#92400e">No phone</span>'}` },
            { key: 'a', label: 'Actions', actions: true, html: f => `<span class="acts"><button class="btn btn-sm" data-m="${esc(f.id)}" aria-label="Manage ${esc(f.name)}">Manage</button>${f.infoVerifiedAt ? '' : `<button class="btn btn-sm btn-ok" data-ver="${esc(f.id)}" aria-label="Verify ${esc(f.name)}">Verify</button>`}</span>` }] });
        function draw() { const q = st.q.toLowerCase(); table.setRows(list.filter(f => (!q || f.name.toLowerCase().includes(q) || f.district.toLowerCase().includes(q)) && (!st.f || (st.f === 'unverified' ? !f.infoVerifiedAt : st.f === 'nobeds' ? !f.staffUpdatedAt : f.unitsUnverified > 0)))); }
        el.addEventListener('input', e => { if (e.target.id === 'hq') st.q = e.target.value; else if (e.target.id === 'hf') st.f = e.target.value; else return; draw(); });
        el.addEventListener('click', async e => {
            const m = e.target.closest('[data-m]'), v = e.target.closest('[data-ver]');
            if (m) { S.facilityId = m.dataset.m; try { sessionStorage.setItem('gcStaffFacility', S.facilityId); } catch (x) { /* ignore */ } const sel = $('#facSel'); if (sel) sel.value = S.facilityId; S.clearSearchCache(); S.go('units'); }
            if (v) {
                const f = list.find(x => x.id === v.dataset.ver);
                if (!(await S.confirm({ title: 'Verify hospital details?', message: `Confirm that the phone number, address and specialties of <b>${esc(f.name)}</b> have been checked.`, confirm: 'Mark as Verified' }))) return;
                try { const r = await S.req(() => API.verifyFacility(f.id)); Object.assign(f, r.facility); S.toast('Hospital details verified.'); draw(); S.refreshAlerts(); } catch (err) { S.toast(err.message, 'error'); }
            }
        });
        draw();
    } });

    // ---------------- system activity (+ the existing access log) ----------------
    S.adminActivity = async function (el) {
        const st = { role: '', entityType: '', facilityId: '', offset: 0 }, size = 20;
        el.innerHTML = S.head('System activity', 'Changes made by hospital staff, doctors and administrators. Patient names and health details are never recorded here.')
            + `<form class="filters" aria-label="Filter activity" onsubmit="return false"><div class="field"><label for="ar">Who</label><select id="ar" class="in"><option value="">Everyone</option><option value="hospital">Hospital staff</option><option value="doctor">Doctors</option><option value="admin">Administrators</option></select></div>
               <div class="field"><label for="at">What</label><select id="at" class="in"><option value="">Everything</option><option value="beds">Bed counts</option><option value="unit">Units</option><option value="doctor">Doctor status</option><option value="appointment">Appointment decisions</option><option value="hospital">Hospital details</option></select></div>
               <div class="field"><label for="af">Hospital</label><select id="af" class="in"><option value="">All hospitals</option>${S.facilities.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select></div></form>
             <section class="card" id="aBox" aria-live="polite"></section>
             <details class="card" style="margin-top:1rem"><summary class="strong" style="cursor:pointer">Administrator access log (who opened which account)</summary><div id="aLog" style="margin-top:.7rem">${S.loading()}</div></details>`;
        async function draw() {
            const box = $('#aBox', el);
            try {
                const r = await S.req(() => API.adminActivity({ role: st.role, entityType: st.entityType, facilityId: st.facilityId, limit: size, offset: st.offset }));
                box.innerHTML = S.activityList(r.items, true) + `<div class="pager" style="margin:.6rem -1rem -1rem;border-radius:0 0 12px 12px"><span>${r.total ? `Showing ${st.offset + 1}–${st.offset + r.items.length} of ${r.total}` : 'No entries'}</span><span class="row-flex"><button class="btn btn-sm" data-o="-1" ${st.offset === 0 ? 'disabled' : ''}>Newer</button><button class="btn btn-sm" data-o="1" ${st.offset + size >= r.total ? 'disabled' : ''}>Older</button></span></div>`;
            } catch (e) { box.innerHTML = S.errorBox(e.message, true); const b = $('[data-retry]', box); if (b) b.addEventListener('click', draw); }
        }
        el.addEventListener('change', e => { const m = { ar: 'role', at: 'entityType', af: 'facilityId' }[e.target.id]; if (m) { st[m] = e.target.value; st.offset = 0; draw(); } });
        el.addEventListener('click', e => { const b = e.target.closest('[data-o]'); if (b && !b.disabled) { st.offset = Math.max(0, st.offset + Number(b.dataset.o) * size); draw(); } });
        $('details', el).addEventListener('toggle', async e => {
            if (!e.target.open) return;
            try { const { audit } = await S.req(() => API.adminAudit()); $('#aLog', el).innerHTML = audit.length ? `<ul class="list">${audit.map(a => `<li><div><b>${esc(a.admin)}</b> ${a.action === 'view_user' ? 'opened user #' + esc(a.targetUserId) : 'listed users'}<div class="muted small">${esc(S.fmtStamp(a.at))}</div></div></li>`).join('')}</ul>` : '<p class="muted">No entries.</p>'; }
            catch (err) { $('#aLog', el).innerHTML = S.errorBox(err.message); }
        });
        await draw();
    };
})();
