// Staff workspace: shared helpers (escaping, toasts, dialogs, tables, badges, page registry). No framework, no build step.
(function () {
    'use strict';
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const S = window.Staff = { esc, user: null, facilityId: null, facilities: [], pages: {}, alerts: [], cleanups: [] };
    S.$ = (sel, root) => (root || document).querySelector(sel);
    S.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    S.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

    // ---------- language catalogue (English now; add S.messages.kok / .hi / .mr later and offer them in Settings) ----------
    S.lang = 'en';
    S.messages = { en: { dashboard: 'Dashboard', beds: 'Bed Management', doctors: 'Doctors & Staff', appointments: 'Appointments', crowd: 'Crowd & Waiting Time', hospital: 'Hospital Information', units: 'Units & Departments',
        costs: 'Treatment Costs', stores: 'Medical Stores', assets: 'Hospital Assets', activity: 'Change History', account: 'Staff Profile', settings: 'Settings', logout: 'Logout', users: 'Users', hospitals: 'Hospital Directory', myAppointments: 'My Appointments', availability: 'Availability & Profile' } };
    S.t = k => (S.messages[S.lang] && S.messages[S.lang][k]) || S.messages.en[k] || k;
    // what the signed-in account may do, from the server's permission map: null = hidden, 'view' = read only, 'write' = may change
    S.can = (cap, mode) => { const c = S.user && S.user.caps && S.user.caps[cap]; return c != null && (mode !== 'write' || c === 'write'); };
    S.WARD_LABEL = { general: 'General', icu: 'ICU', emergency: 'Emergency', maternity: 'Maternity', paediatric: 'Paediatric' };
    S.demoBadge = d => (d ? ' <span class="badge b-info" title="Sample data for the demo. Never shown to patients.">Demo</span>' : '');

    // ---------- formatting ----------
    S.fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '-';
    S.fmtStamp = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
    S.ago = iso => {
        if (!iso) return 'never';
        const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
        return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' d ago';
    };
    S.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

    // ---------- feedback ----------
    S.toast = (msg, kind) => {
        const box = S.$('#toasts'), el = document.createElement('div');
        el.className = 'toast' + (kind === 'error' ? ' err' : ''); el.textContent = msg; box.appendChild(el);
        setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
    };
    S.badge = (text, tone) => `<span class="badge b-${tone || 'mute'}">${esc(text)}</span>`;
    S.loading = (label) => `<div class="state" role="status"><div class="spin" aria-hidden="true"></div><p>${esc(label || 'Loading…')}</p></div>`;
    S.skeletons = n => `<div class="grid g4 keep2" aria-busy="true" aria-label="Loading">${'<div class="skeleton"></div>'.repeat(n || 4)}</div>`;
    S.empty = ({ icon, title, text, action }) => `<div class="state"><i class="fa-regular ${icon || 'fa-folder-open'}" aria-hidden="true"></i><h3>${esc(title)}</h3><p>${esc(text || '')}</p>${action || ''}</div>`;
    S.errorBox = (msg, retry) => `<div class="state" role="alert"><i class="fa-solid fa-triangle-exclamation" style="color:#b91c1c" aria-hidden="true"></i><h3>Something went wrong</h3><p>${esc(msg)}</p>${retry ? '<button type="button" class="btn" data-retry>Try again</button>' : ''}</div>`;
    // Every API call goes through here: a lapsed session sends the person back to the one GoaCare sign-in.
    S.req = async fn => {
        try { return await fn(); } catch (e) {
            if (e && e.status === 401) { S.toast('Your session has ended. Please sign in again.', 'error'); setTimeout(() => location.replace('/'), 900); }
            throw e;
        }
    };

    // ---------- dialogs (native <dialog>: focus is trapped, Esc closes) ----------
    let dlgSeq = 0;
    S.modal = function ({ title, body, submit = 'Save changes', cancel = 'Cancel', danger, wide, hideSubmit, onSubmit, onOpen }) {
        return new Promise(resolve => {
            const id = 'dlg' + (++dlgSeq), d = document.createElement('dialog');
            d.className = 'dlg' + (wide ? ' wide' : ''); d.setAttribute('aria-labelledby', id + 't');
            d.innerHTML = `<form novalidate><header><h2 id="${id}t">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close dialog"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header>
                <div class="body">${body}<p class="err-text" role="alert" data-err></p></div>
                <footer><button type="button" class="btn" data-close>${esc(cancel)}</button>${hideSubmit ? '' : `<button type="submit" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}">${esc(submit)}</button>`}</footer></form>`;
            let result = null;
            const form = d.querySelector('form'), errEl = d.querySelector('[data-err]');
            d.addEventListener('click', e => { if (e.target.closest('[data-close]')) d.close(); });
            form.addEventListener('submit', async e => {
                e.preventDefault(); errEl.textContent = '';
                if (!form.checkValidity()) { const bad = form.querySelector(':invalid'); bad.setAttribute('aria-invalid', 'true'); errEl.textContent = bad.validationMessage || 'Please check the highlighted field.'; bad.focus(); return; }
                const btn = form.querySelector('[type=submit]'); if (btn) btn.disabled = true;
                try { const r = onSubmit ? await onSubmit(d, new FormData(form)) : true; result = r === undefined ? true : r; d.close(); }
                catch (err) { errEl.textContent = err.message || 'Could not save.'; if (btn) btn.disabled = false; }
            });
            form.addEventListener('input', e => e.target.removeAttribute && e.target.removeAttribute('aria-invalid'));
            d.addEventListener('close', () => { d.remove(); resolve(result); });
            document.body.appendChild(d); d.showModal(); if (onOpen) onOpen(d);
        });
    };
    // message must already be safe HTML (escape any dynamic text with Staff.esc)
    S.confirm = ({ title, message, confirm = 'Confirm', danger }) => S.modal({ title, body: `<p>${message}</p>`, submit: confirm, danger, onSubmit: () => true }).then(r => !!r);

    // ---------- sortable, paged table. Becomes stacked cards on phones (CSS) ----------
    // cols: [{ key, label, sort: true|fn, html: row => string, actions: bool }]
    S.table = function (host, { cols, rows = [], pageSize = 10, sort, empty }) {
        let page = 0, data = rows, sk = sort && sort.key, dir = (sort && sort.dir) || 1;
        const val = (c, r) => (typeof c.sort === 'function' ? c.sort(r) : r[c.key]);
        function draw() {
            const col = cols.find(c => c.key === sk);
            const list = col ? data.slice().sort((a, b) => { const x = val(col, a), y = val(col, b); return (x == null ? 1 : y == null ? -1 : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir; }) : data;
            const pages = Math.max(1, Math.ceil(list.length / pageSize)); page = Math.min(page, pages - 1);
            const slice = list.slice(page * pageSize, page * pageSize + pageSize);
            if (!list.length) { host.innerHTML = `<div class="tbl-wrap">${empty || S.empty({ title: 'Nothing to show' })}</div>`; return; }
            host.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c => `<th scope="col"${c.key === sk ? ` aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c.sort ? `<button type="button" data-sort="${esc(c.key)}">${esc(c.label)} <i class="fa-solid ${c.key === sk ? (dir > 0 ? 'fa-arrow-up' : 'fa-arrow-down') : 'fa-sort'}" aria-hidden="true" style="opacity:.5"></i></button>` : esc(c.label)}</th>`).join('')}</tr></thead>
                <tbody>${slice.map(r => `<tr>${cols.map(c => `<td data-label="${esc(c.actions ? '' : c.label)}"${c.actions ? ' class="cell-actions"' : ''}>${c.html(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>
                <div class="pager"><span>Showing ${page * pageSize + 1}–${page * pageSize + slice.length} of ${list.length}</span><span class="row-flex"><button type="button" class="btn btn-sm" data-pg="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pages}</span><button type="button" class="btn btn-sm" data-pg="1" ${page >= pages - 1 ? 'disabled' : ''}>Next</button></span></div></div>`;
        }
        host.addEventListener('click', e => {
            const s = e.target.closest('[data-sort]'), p = e.target.closest('[data-pg]');
            if (s) { if (sk === s.dataset.sort) dir = -dir; else { sk = s.dataset.sort; dir = 1; } draw(); S.$(`[data-sort="${sk}"]`, host).focus(); }
            if (p && !p.disabled) { page += Number(p.dataset.pg); draw(); }
        });
        draw();
        return { setRows(r) { data = r; page = 0; draw(); }, redraw: draw };
    };

    // ---------- page registry ----------
    // def: { title, icon, roles: [...], group, desc, render(el, params) -> optional cleanup fn }
    S.register = (name, def) => { S.pages[name] = def; };

    // ---------- shared wording ----------
    S.UNIT_TYPES = { emergency: 'Emergency / Casualty', icu: 'Intensive Care Unit (ICU)', opd: 'Outpatient Department (OPD)', general_ward: 'General Ward', ipd: 'Inpatient Department (IPD)', pediatrics: 'Pediatrics', maternity: 'Maternity & Obstetrics', surgery: 'Surgery & Operating Theatre', laboratory: 'Laboratory & Diagnostics', radiology: 'Radiology & Imaging', pharmacy: 'Pharmacy', other: 'Other' };
    S.BED_LABEL = { icu: 'ICU', oxygen: 'Oxygen-supported', general: 'General' };
    S.STATUSES = ['Available', 'In Surgery', 'On Call'];
    S.statusTone = s => (s === 'Available' ? 'ok' : s === 'In Surgery' ? 'bad' : 'warn');
    S.apptTone = s => ({ Requested: 'warn', Confirmed: 'ok', Declined: 'bad', Cancelled: 'mute' }[s] || 'mute');
    S.apptLabel = s => ({ Requested: 'Awaiting decision', Confirmed: 'Confirmed', Declined: 'Declined', Cancelled: 'Cancelled by patient' }[s] || s);
    const fromTo = ([a, b]) => `${a == null ? 'unknown' : a} → ${b == null ? 'unknown' : b}`;
    S.describeActivity = a => {
        const d = a.detail || {};
        switch (a.action) {
            case 'beds_updated': {
                const parts = [];
                ['icu', 'oxygen', 'general'].forEach(k => { if (d.free && d.free[k][0] !== d.free[k][1]) parts.push(`${S.BED_LABEL[k]} free ${fromTo(d.free[k])}`); if (d.capacity && d.capacity[k][0] !== d.capacity[k][1]) parts.push(`${S.BED_LABEL[k]} capacity ${fromTo(d.capacity[k])}`); });
                return 'Updated beds' + (parts.length ? ': ' + parts.join('; ') : ' (no change in numbers)');
            }
            case 'doctor_updated': return `${d.name || 'Doctor'}: ` + [d.status && 'status ' + d.status.join(' → '), d.duty && 'duty ' + d.duty.join(' → '), d.appointments && 'appointments ' + (d.appointments[1] ? 'open' : 'closed'), d.room && 'room ' + d.room.join(' → ')].filter(Boolean).join('; ');
            case 'appointment_confirmed': case 'appointment_declined': return `${a.action === 'appointment_confirmed' ? 'Confirmed' : 'Declined'} request #${a.entityId} (${d.provider || 'provider'}, ${d.date || ''} ${d.time || ''})`;
            case 'unit_created': return `Added unit "${d.name}"`;
            case 'unit_updated': return `Edited unit "${d.name}"` + (d.changed && d.changed.length ? ' (' + d.changed.join(', ') + ')' : '');
            case 'unit_activated': return `Activated unit "${d.name}"`;
            case 'unit_deactivated': return `Deactivated unit "${d.name}"`;
            case 'unit_doctors_changed': return `Doctors in "${d.name}": ${S.plural((d.added || []).length, 'added')}, ${S.plural((d.removed || []).length, 'removed')}`;
            case 'unit_verified': return `Verified unit "${d.name}"`;
            case 'hospital_info_updated': return 'Updated hospital details' + (d.changed && d.changed.length ? ' (' + d.changed.join(', ') + ')' : '');
            case 'hospital_verified': return `Verified hospital details${d.name ? ' for ' + d.name : ''}`;
            case 'ward_updated': { const x = d.after || {}; return `${d.ward} ward: ${x.available} available of ${x.total}${x.occupied != null ? ', ' + x.occupied + ' occupied' : ''}${x.outOfService ? ', ' + x.outOfService + ' out of service' : ''}`; }
            case 'crowd_updated': return `Crowd level set to ${d.level}${d.waitMinutes != null ? ', wait ' + d.waitMinutes + ' min' : ''}${d.queueCount != null ? ', queue ' + d.queueCount : ''}`;
            case 'crowd_verified': return `Re-confirmed crowd level (${d.level})`;
            case 'doctor_created': return `Added doctor ${d.name}`; case 'doctor_edited': return `Edited doctor ${d.name}`; case 'doctor_archived': return `Removed doctor ${d.name} from the listing`;
            case 'team_role_changed': return `${d.name}: role ${d.from} → ${d.to}`;
            default: { const m = /^(service|cost|store|asset)_(created|updated|deleted)$/.exec(a.action); if (m) return `${m[2][0].toUpperCase() + m[2].slice(1)} ${({ service: 'service', cost: 'cost estimate', store: 'medical store', asset: 'asset' })[m[1]]}${d.name ? ' "' + d.name + '"' : ''}`; return a.action.replace(/_/g, ' '); }
        }
    };
    S.activityList = (items, showHospital) => items.length ? `<ul class="list">${items.map(a => `<li><div><div>${esc(S.describeActivity(a))}${showHospital && a.facilityId ? ` <span class="muted small">· ${esc((S.facilities.find(f => f.id === a.facilityId) || {}).name || a.facilityId)}</span>` : ''}</div><div class="muted small">${esc(a.actor)} (${esc(a.role === 'hospital' ? 'hospital staff' : a.role)}) · ${esc(S.fmtStamp(a.at))}</div></div></li>`).join('')}</ul>` : '<p class="muted">No changes recorded yet.</p>';
})();
