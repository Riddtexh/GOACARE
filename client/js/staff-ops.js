// Staff workspace: hospital information, bed management (wards), doctors, crowd & waiting time, costs, stores, assets, staff profile and settings.
(function () {
    'use strict';
    const S = window.Staff, esc = S.esc, $ = S.$, API = window.GoaAPI, U = S.ui, field = U.field, opts = U.opts;
    const STAFF = ['hospital', 'admin'], fq = () => (S.fid() ? '?facilityId=' + encodeURIComponent(S.fid()) : '');
    const call = (m, p, b) => S.req(() => API.call(m, p, b));
    const ro = cap => !S.can(cap, 'write');
    const roNote = what => `<div class="notice n-info" style="margin-bottom:1rem"><i class="fa-solid fa-lock" aria-hidden="true"></i><span>Your role can view ${esc(what)} but not change it.</span></div>`;
    const money = n => '₹' + Number(n).toLocaleString('en-IN');
    const freshBadge = (iso, hours) => (!iso ? S.badge('Never updated', 'warn') : Date.now() - Date.parse(iso) > hours * 3600000 ? S.badge('Outdated · ' + S.ago(iso), 'warn') : S.badge('Updated ' + S.ago(iso), 'ok'));
    const list = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);

    // ====================================================== generic list + add / edit / delete ======================================================
    // cfg: { api, cap, noun, fields:[{name,label,type,options,required,hint,max,placeholder}], cols:[{key,label,sort,html}], emptyTitle, emptyText, toForm?, note? }
    function resourceList(el, cfg) {
        const writable = !ro(cfg.cap); let items = [];
        el.innerHTML = `<div class="row-flex" style="justify-content:space-between;margin-bottom:.8rem"><span id="rcount" class="muted small" role="status"></span>${writable ? `<button type="button" class="btn btn-primary" id="rAdd"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add ${esc(cfg.noun)}</button>` : ''}</div><div id="rList"></div>`;
        const host = $('#rList', el);
        const cols = cfg.cols.concat([{ key: 'a', label: 'Actions', actions: true, html: r => writable ? `<span class="acts"><button class="btn btn-sm" data-e="${r.id}" aria-label="Edit ${esc(r.name || r.serviceName)}">Edit</button><button class="btn btn-sm btn-danger" data-d="${r.id}" aria-label="Delete ${esc(r.name || r.serviceName)}">Delete</button></span>` : '<span class="muted small">View only</span>' }]);
        const table = S.table(host, { cols, rows: [], pageSize: 10, sort: cfg.sort, empty: '' });
        const draw = () => {
            $('#rcount', el).textContent = S.plural(items.length, cfg.noun);
            if (!items.length) host.innerHTML = `<div class="tbl-wrap">${S.empty({ icon: cfg.icon || 'fa-folder-open', title: cfg.emptyTitle, text: cfg.emptyText, action: writable ? `<button class="btn btn-primary" data-add>Add ${esc(cfg.noun)}</button>` : '' })}</div>`;
            else { if (!$('table', host)) host.innerHTML = ''; table.setRows(items); }
        };
        const load = async () => { items = (await call('GET', '/staff/' + cfg.api + fq())).items; draw(); };
        const input = (f, v) => {
            const id = 'f-' + f.name, req = f.required ? ' required' : '', val = v == null ? '' : v;
            if (f.type === 'select') return `<select id="${id}" name="${f.name}" class="in"${req}>${opts(f.options, String(val), f.required ? 'Choose…' : 'Not set')}</select>`;
            if (f.type === 'textarea') return `<textarea id="${id}" name="${f.name}" class="in" maxlength="${f.max || 300}"${req}>${esc(val)}</textarea>`;
            if (f.type === 'checkbox') return `<label class="row-flex" style="font-weight:600"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.checkLabel || f.label)}</label>`;
            return `<input id="${id}" name="${f.name}" class="in" type="${f.type || 'text'}" ${f.type === 'number' ? 'inputmode="numeric" min="0" step="1"' : ''} maxlength="${f.max || 120}" placeholder="${esc(f.placeholder || '')}" value="${esc(val)}"${req}>`;
        };
        const body = item => cfg.fields.map(f => (f.type === 'checkbox' ? `<div class="field">${input(f, item ? item[f.name] : f.default)}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>` : field('f-' + f.name, f.label + (f.required ? ' *' : ''), input(f, item ? item[f.name] : f.default), f.hint))).join('');
        const toBody = d => { const out = {}; cfg.fields.forEach(f => { const e = d.querySelector('[name="' + f.name + '"]'); out[f.name] = f.type === 'checkbox' ? e.checked : f.type === 'number' ? (e.value === '' ? undefined : Number(e.value)) : e.value; }); return out; };
        async function open(item) {
            const done = await S.modal({ title: (item ? 'Edit ' : 'Add ') + cfg.noun, body: (cfg.formNote || '') + body(item), submit: item ? 'Save Changes' : 'Add ' + cfg.noun, wide: cfg.wide,
                onSubmit: async d => { const b = toBody(d); if (item) await call('PUT', '/staff/' + cfg.api + '/' + item.id, b); else await call('POST', '/staff/' + cfg.api, { ...b, facilityId: S.fid() }); } });
            if (done) { S.toast(cfg.noun[0].toUpperCase() + cfg.noun.slice(1) + (item ? ' saved.' : ' added.')); await load(); if (cfg.onChange) cfg.onChange(); S.refreshAlerts(); }
        }
        el.addEventListener('click', async e => {
            if (e.target.closest('#rAdd') || e.target.closest('[data-add]')) return open(null);
            const ed = e.target.closest('[data-e]'), de = e.target.closest('[data-d]');
            if (ed) return open(items.find(i => i.id === Number(ed.dataset.e)));
            if (de) {
                const it = items.find(i => i.id === Number(de.dataset.d)), nm = it.name || it.serviceName;
                if (!(await S.confirm({ title: `Delete this ${cfg.noun}?`, message: `<b>${esc(nm)}</b> will be removed permanently. This cannot be undone.`, confirm: 'Delete', danger: true }))) return;
                try { await call('DELETE', '/staff/' + cfg.api + '/' + it.id); S.toast(cfg.noun[0].toUpperCase() + cfg.noun.slice(1) + ' deleted.'); await load(); S.refreshAlerts(); } catch (err) { S.toast(err.message, 'error'); }
            }
        });
        return load();
    }
    function resourcePage(name, cfg) {
        S.register(name, { title: cfg.title, roles: STAFF, cap: cfg.cap, async render(el) {
            if (S.needFacility(el)) return;
            el.innerHTML = S.head(cfg.title, cfg.desc) + (ro(cfg.cap) ? roNote(cfg.title.toLowerCase()) : '') + (cfg.note || '') + '<div id="rBox"></div>';
            await resourceList($('#rBox', el), cfg);
        } });
    }
    S.resourceList = resourceList;

    // ====================================================== treatment costs, stores, assets ======================================================
    resourcePage('costs', { title: 'Treatment Costs', cap: 'costs', api: 'costs', noun: 'cost estimate', icon: 'fa-indian-rupee-sign', sort: { key: 'serviceName', dir: 1 },
        desc: 'Estimated costs patients see for selected services. Always shown to patients as estimates, never as a fixed price.',
        note: '<div class="notice n-warn" style="margin-bottom:1rem"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>These are <b>estimates</b>. Final charges depend on the patient\'s condition, tests and stay. Keep them up to date.</span></div>',
        emptyTitle: 'No cost estimates yet', emptyText: 'Add the services patients ask about most, for example consultation, X-ray or delivery.',
        fields: [{ name: 'serviceName', label: 'Service or treatment', required: true, max: 120 }, { name: 'minCost', label: 'Lowest estimate (₹)', type: 'number', required: true, max: 8 }, { name: 'maxCost', label: 'Highest estimate (₹)', type: 'number', required: true, max: 8 }, { name: 'notes', label: 'Notes', max: 200, hint: 'For example: public rate, excludes medicines.' }],
        cols: [{ key: 'serviceName', label: 'Service', sort: true, html: r => `<span class="strong">${esc(r.serviceName)}</span>${S.demoBadge(r.demo)}` }, { key: 'minCost', label: 'Estimated cost', sort: true, html: r => `${money(r.minCost)} – ${money(r.maxCost)} ${S.badge('Estimate', 'info')}` }, { key: 'notes', label: 'Notes', html: r => esc(r.notes || '-') }, { key: 'updatedAt', label: 'Updated', sort: true, html: r => `<span class="small">${esc(S.ago(r.updatedAt))}${r.updatedBy ? '<br><span class="muted">by ' + esc(r.updatedBy) + '</span>' : ''}</span>` }] });
    resourcePage('stores', { title: 'Medical Stores', cap: 'stores', api: 'stores', noun: 'store', icon: 'fa-pills', sort: { key: 'name', dir: 1 },
        desc: 'Pharmacies and medical stores linked to this hospital. Medicine availability is only published when you tick "verified".',
        emptyTitle: 'No medical stores yet', emptyText: 'Optional. Add a store to list its location, contact and hours.',
        fields: [{ name: 'name', label: 'Store name', required: true, max: 100 }, { name: 'location', label: 'Location', max: 160, placeholder: 'Block, floor or street' }, { name: 'contact', label: 'Contact', max: 60, hint: 'Phone number or email.' }, { name: 'hours', label: 'Operating hours', max: 80 },
            { name: 'availabilityNote', label: 'Medicine availability', type: 'textarea', max: 500, hint: 'Only write what you have checked.' }, { name: 'availabilityVerified', label: '', type: 'checkbox', checkLabel: 'I have verified this availability today', hint: 'Unverified notes are never shown to patients. Changing the note clears this tick.' }],
        cols: [{ key: 'name', label: 'Store', sort: true, html: r => `<span class="strong">${esc(r.name)}</span>${S.demoBadge(r.demo)}<br><span class="muted small">${esc(r.location || '')}</span>` }, { key: 'contact', label: 'Contact', html: r => esc(r.contact || '-') }, { key: 'hours', label: 'Hours', html: r => esc(r.hours || '-') },
            { key: 'availabilityNote', label: 'Medicine availability', html: r => r.availabilityNote ? (r.availabilityVerifiedAt ? `${S.badge('Verified ' + S.ago(r.availabilityVerifiedAt), 'ok')}<br><span class="small">${esc(r.availabilityNote)}</span>` : `${S.badge('Not verified (hidden from patients)', 'warn')}<br><span class="small">${esc(r.availabilityNote)}</span>`) : '<span class="muted small">None</span>' }] });
    const CAT = ['Medical equipment', 'Ambulance / vehicle', 'IT equipment', 'Furniture', 'Building / utilities', 'Other'], COND = ['New', 'Good', 'Fair', 'Poor', 'Out of service'], MAINT = ['Up to date', 'Due soon', 'Overdue', 'Under maintenance', 'Not applicable'];
    const toMap = a => Object.fromEntries(a.map(x => [x, x]));
    resourcePage('assets', { title: 'Hospital Assets', cap: 'assets', api: 'assets', noun: 'asset', icon: 'fa-screwdriver-wrench', sort: { key: 'name', dir: 1 }, wide: true,
        desc: 'Equipment and other assets, with their condition and maintenance status. This module is for internal use and is not shown to patients.',
        emptyTitle: 'No assets recorded', emptyText: 'Optional. Add equipment such as ventilators or ambulances to track condition and maintenance.',
        fields: [{ name: 'name', label: 'Asset name', required: true, max: 100 }, { name: 'assetNo', label: 'Asset number', required: true, max: 40, hint: 'Unique at this hospital. Letters, digits . _ - /' }, { name: 'category', label: 'Category', type: 'select', options: toMap(CAT), required: true }, { name: 'acquiredOn', label: 'Acquisition date', type: 'date' },
            { name: 'condition', label: 'Current condition', type: 'select', options: toMap(COND), required: true }, { name: 'maintenanceStatus', label: 'Maintenance status', type: 'select', options: toMap(MAINT), required: true }, { name: 'notes', label: 'Notes', type: 'textarea', max: 300 }],
        cols: [{ key: 'name', label: 'Asset', sort: true, html: r => `<span class="strong">${esc(r.name)}</span>${S.demoBadge(r.demo)}<br><span class="muted small">${esc(r.assetNo)} · ${esc(r.category)}</span>` }, { key: 'acquiredOn', label: 'Acquired', sort: true, html: r => r.acquiredOn ? esc(S.fmtDate(r.acquiredOn)) : '-' },
            { key: 'condition', label: 'Condition', sort: true, html: r => S.badge(r.condition, { New: 'ok', Good: 'ok', Fair: 'warn', Poor: 'bad', 'Out of service': 'bad' }[r.condition]) }, { key: 'maintenanceStatus', label: 'Maintenance', sort: true, html: r => S.badge(r.maintenanceStatus, { 'Up to date': 'ok', 'Due soon': 'warn', Overdue: 'bad', 'Under maintenance': 'info' }[r.maintenanceStatus] || 'mute') }] });

    // ====================================================== hospital information ======================================================
    S.register('hospital', { title: 'Hospital Information', roles: STAFF, cap: 'info', async render(el) {
        if (S.needFacility(el)) return;
        const r = await S.req(() => API.staffHospital(S.fid())), f = r.facility, isAdmin = S.user.role === 'admin', locked = ro('info');
        const dis = locked ? ' disabled' : '';
        el.innerHTML = S.head('Hospital Information', 'What patients see about this hospital. Changes are saved to the live directory and reviewed by an administrator.', isAdmin && !f.infoVerifiedAt ? '<button class="btn btn-ok" id="verify"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Mark as Verified</button>' : '')
            + (locked ? roNote('the hospital profile') : '')
            + `<div class="grid g2"><form class="card stack" id="hf" novalidate aria-label="Hospital profile">
                ${field('hName', 'Hospital name', `<input id="hName" class="in" maxlength="120" required value="${esc(f.name)}"${dis}>`)}
                ${field('hPhone', 'Contact number', `<input id="hPhone" class="in" inputmode="tel" maxlength="30" value="${esc(f.phone)}" autocomplete="off"${dis}>`, 'The number patients should call. Leave blank if there is no verified number. Do not use emergency numbers (108, 112).')}
                ${field('hAddr', 'Address', `<textarea id="hAddr" class="in" maxlength="200" required${dis}>${esc(f.address)}</textarea>`)}
                <div class="grid g2">${field('hLat', 'Latitude', `<input id="hLat" class="in" inputmode="decimal" value="${esc(f.lat)}"${dis}>`, 'Used for distance and routing.')}${field('hLng', 'Longitude', `<input id="hLng" class="in" inputmode="decimal" value="${esc(f.lng)}"${dis}>`)}</div>
                ${field('hEm', 'Emergency department', `<select id="hEm" class="in"${dis}><option value="" ${f.emergencyAvailable == null ? 'selected' : ''}>Not recorded</option><option value="yes" ${f.emergencyAvailable === true ? 'selected' : ''}>Available</option><option value="no" ${f.emergencyAvailable === false ? 'selected' : ''}>Not available</option></select>`)}
                ${field('hHrs', 'Operating hours', `<textarea id="hHrs" class="in" maxlength="200" placeholder="e.g. OPD 8 AM - 2 PM; Emergency 24x7"${dis}>${esc(f.operatingHours)}</textarea>`)}
                ${field('hLang', 'Languages supported', `<input id="hLang" class="in" value="${esc(f.languages.join(', '))}"${dis}>`, 'Separate with commas, for example: English, Konkani, Hindi, Marathi.')}
                ${field('hAm', 'Available facilities', `<input id="hAm" class="in" value="${esc(f.amenities.join(', '))}"${dis}>`, 'For example: Blood bank, Pharmacy, Parking, Ambulance.')}
                ${field('hSpec', 'Specialties', `<input id="hSpec" class="in" value="${esc(f.specialties.join(', '))}"${dis}>`, 'Separate with commas.')}
                ${locked ? '' : '<div class="row-flex"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save Changes</button><span id="hMsg" class="small" role="status"></span></div>'}</form>
              <div class="stack"><section class="card stack" aria-labelledby="hv"><h2 id="hv">Verification</h2>
                <div class="row-flex">${f.infoVerifiedAt ? S.badge('Verified ' + S.ago(f.infoVerifiedAt), 'ok') : S.badge('Awaiting verification', 'warn')}${f.phone ? S.badge('Phone on file', 'ok') : S.badge('No phone number', 'warn')}</div>
                <dl class="kv"><dt>Details last changed</dt><dd>${f.infoUpdatedAt ? esc(S.fmtStamp(f.infoUpdatedAt)) + (f.infoUpdatedBy ? ' by ' + esc(f.infoUpdatedBy) : '') : 'Never changed by staff'}</dd><dt>Verified</dt><dd>${f.infoVerifiedAt ? esc(S.fmtStamp(f.infoVerifiedAt)) + (f.infoVerifiedBy ? ' by ' + esc(f.infoVerifiedBy) : '') : 'Not yet'}</dd></dl>
                <div class="notice n-info"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Any edit puts the details back to “awaiting verification” until an administrator confirms them. Patients keep seeing the saved details meanwhile.</span></div></section>
              <section class="card" aria-labelledby="sv"><h2 id="sv">Departments and medical services</h2><p class="muted small" style="margin-top:0">Listed to patients on the hospital page.</p><div id="svBox"></div></section></div></div>`;
        S.resourceList($('#svBox', el), { api: 'services', cap: 'info', noun: 'service', icon: 'fa-notes-medical', emptyTitle: 'Nothing listed yet', emptyText: 'Add the departments and services patients can use here.', sort: { key: 'name', dir: 1 },
            fields: [{ name: 'name', label: 'Name', required: true, max: 80 }, { name: 'kind', label: 'Type', type: 'select', options: { department: 'Department', service: 'Medical service' }, required: true }, { name: 'description', label: 'Description', type: 'textarea', max: 300 }, { name: 'available', label: '', type: 'checkbox', checkLabel: 'Currently available to patients', default: true }],
            cols: [{ key: 'name', label: 'Name', sort: true, html: r => `<span class="strong">${esc(r.name)}</span>${S.demoBadge(r.demo)}` }, { key: 'kind', label: 'Type', sort: true, html: r => S.badge(r.kind === 'department' ? 'Department' : 'Service', 'brand') }, { key: 'available', label: 'Status', html: r => r.available ? S.badge('Available', 'ok') : S.badge('Not available', 'mute') }] });
        if (locked) return;
        const form = $('#hf', el), msg = $('#hMsg', el);
        form.addEventListener('submit', async e => {
            e.preventDefault(); msg.textContent = '';
            const name = $('#hName', el).value.trim(), phone = $('#hPhone', el).value.trim(), address = $('#hAddr', el).value.trim(), em = $('#hEm', el).value;
            let bad = null; const flag = (id, t) => { $('#' + id + '-e', el).textContent = t; $('#' + id, el).toggleAttribute('aria-invalid', !!t); if (t) bad = bad || id; };
            flag('hName', name.length < 3 ? 'Enter the hospital name.' : ''); flag('hAddr', address.length < 5 ? 'Enter the hospital address.' : '');
            flag('hPhone', phone && !/^\+?\d[\d\s\-()]{5,28}$/.test(phone) ? 'Use digits, spaces, + - and brackets only.' : /^(108|112|102|104)$/.test(phone) ? 'That is an emergency line, not the hospital number.' : '');
            flag('hLat', Number.isNaN(Number($('#hLat', el).value)) || Math.abs(Number($('#hLat', el).value)) > 90 ? 'Latitude must be between -90 and 90.' : ''); flag('hLng', Number.isNaN(Number($('#hLng', el).value)) || Math.abs(Number($('#hLng', el).value)) > 180 ? 'Longitude must be between -180 and 180.' : '');
            if (bad) return $('#' + bad, el).focus();
            const btn = $('[type=submit]', form); btn.disabled = true;
            try { await call('PUT', '/staff/hospital', { facilityId: S.fid(), name, phone, address, lat: Number($('#hLat', el).value), lng: Number($('#hLng', el).value), emergencyAvailable: em === '' ? null : em === 'yes', operatingHours: $('#hHrs', el).value, languages: list($('#hLang', el).value), amenities: list($('#hAm', el).value), specialties: list($('#hSpec', el).value) }); S.toast('Hospital information saved. Awaiting administrator verification.'); S.rerender(); S.refreshAlerts(); }
            catch (err) { msg.textContent = err.message; msg.className = 'small err-text'; S.toast(err.message, 'error'); btn.disabled = false; }
        });
        const v = $('#verify', el);
        if (v) v.addEventListener('click', async () => { if (!(await S.confirm({ title: 'Mark details as verified?', message: `Confirm that you have checked the details of <b>${esc(f.name)}</b>.`, confirm: 'Mark as Verified' }))) return; try { await S.req(() => API.verifyFacility(f.id)); S.toast('Hospital details verified.'); S.rerender(); S.refreshAlerts(); } catch (e) { S.toast(e.message, 'error'); } });
    } });

    // ====================================================== bed management (wards) ======================================================
    S.register('beds', { title: 'Bed Management', roles: ['hospital'], cap: 'beds', async render(el) {
        const g = await call('GET', '/staff/wards'), locked = ro('beds'), dis = locked ? ' disabled' : '';
        let wards = g.wards, sel = (wards.find(w => w.updatedAt) || wards[0]).type;
        const paint = () => {
            el.innerHTML = S.head('Bed Management', 'Record each ward separately. ICU and General figures also update the bed counts patients and triage see. Occupied and out-of-service beds are optional: leave them blank if you do not track them (blank means "not recorded", never zero).') + (locked ? roNote('bed counts') : '')
                + `<div class="grid g2"><form class="card stack" id="wf" novalidate aria-label="Update a ward">
                    ${field('wType', 'Ward type', `<select id="wType" class="in">${opts(g.types, sel)}</select>`)}
                    <div class="grid g2">${field('wTot', 'Total beds *', `<input id="wTot" class="in" inputmode="numeric" required${dis}>`)}${field('wAv', 'Available beds *', `<input id="wAv" class="in" inputmode="numeric" required${dis}>`)}${field('wOc', 'Occupied beds', `<input id="wOc" class="in" inputmode="numeric" placeholder="Not recorded"${dis}>`)}${field('wOs', 'Out of service', `<input id="wOs" class="in" inputmode="numeric" placeholder="Not recorded"${dis}>`)}</div>
                    <div id="wCheck" class="small" role="status" aria-live="polite"></div>
                    ${field('wNotes', 'Notes', `<textarea id="wNotes" class="in" maxlength="300" placeholder="Optional, e.g. ventilator bay closed"${dis}></textarea>`)}
                    <p id="wMeta" class="muted small" style="margin:0"></p>
                    ${locked ? '' : '<div class="row-flex"><button class="btn btn-primary" type="submit" id="wSave"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save Ward</button><span id="wMsg" class="small" role="status"></span></div>'}</form>
                  <section class="card" aria-labelledby="wa"><h2 id="wa">All wards</h2><ul class="list">${wards.map(w => `<li><div><button type="button" class="btn btn-sm" data-w="${w.type}" ${w.type === sel ? 'aria-current="true"' : ''}>${esc(g.types[w.type])}</button>${S.demoBadge(w.demo)}<div class="muted small" style="margin-top:.3rem">${w.updatedAt ? `${w.available} available of ${w.total}${w.occupied != null ? ' · ' + w.occupied + ' occupied' : ''}${w.outOfService != null ? ' · ' + w.outOfService + ' out of service' : ''}<br>${esc(w.updatedBy || '')}` : 'Not recorded yet'}</div></div><div>${freshBadge(w.updatedAt, 24)}</div></li>`).join('')}</ul></section></div>
                  <section class="card" style="margin-top:1rem" aria-labelledby="ox"><h2 id="ox">Oxygen-supported beds (hospital-wide)</h2><p class="muted small" style="margin-top:0">Not a ward type, so it is recorded for the whole hospital. Free now: <b>${g.hospitalCounts.oxygen.available}</b>${g.hospitalCounts.oxygen.total != null ? ' of ' + g.hospitalCounts.oxygen.total : ''}.</p>
                  ${locked ? '' : `<form class="row-flex" id="of" novalidate><label class="sr-only" for="oxFree">Free oxygen beds</label><input id="oxFree" class="in" style="max-width:8rem" inputmode="numeric" value="${g.hospitalCounts.oxygen.available}"><button class="btn" type="submit">Save Oxygen Beds</button><span id="oxMsg" class="small" role="status"></span></form>`}</section>`;
            fill();
        };
        const num = id => { const v = $('#' + id, el).value.trim(); return v === '' ? null : /^\d+$/.test(v) ? Number(v) : NaN; };
        function fill() {
            const w = wards.find(x => x.type === sel);
            $('#wTot', el).value = w.total == null ? '' : w.total; $('#wAv', el).value = w.available == null ? '' : w.available; $('#wOc', el).value = w.occupied == null ? '' : w.occupied; $('#wOs', el).value = w.outOfService == null ? '' : w.outOfService; $('#wNotes', el).value = w.notes || '';
            $('#wMeta', el).innerHTML = w.updatedAt ? `Last updated ${esc(S.fmtStamp(w.updatedAt))} by ${esc(w.updatedBy)} ${freshBadge(w.updatedAt, 24)}${w.demo ? S.demoBadge(true) : ''}` : 'This ward has not been recorded yet.'; check();
        }
        function check() {
            const t = num('wTot'), a = num('wAv'), o = num('wOc'), s = num('wOs'), out = $('#wCheck', el); let err = '';
            const vals = { 'Total beds': t, 'Available beds': a, 'Occupied beds': o, 'Out-of-service beds': s };
            for (const [k, v] of Object.entries(vals)) if (Number.isNaN(v) || (v != null && v > 5000)) err = `${k} must be a whole number from 0 to 5000.`;
            if (!err && t != null && a != null) { const sum = a + (o || 0) + (s || 0); if ([a, o, s].some(v => v != null && v > t)) err = 'No count can be more than the total beds.'; else if (sum > t) err = `Available + occupied + out of service (${sum}) is more than the total (${t}).`; else out.innerHTML = `<span style="color:#047857">Accounted for: ${sum} of ${t} beds${sum < t ? ` · ${t - sum} not classified` : ''}.</span>`; }
            if (err) out.innerHTML = `<span class="err-text">${esc(err)}</span>`; else if (t == null || a == null) out.textContent = '';
            return !err && t != null && a != null;
        }
        paint();
        el.addEventListener('change', e => { if (e.target.id === 'wType') { sel = e.target.value; fill(); } });
        el.addEventListener('input', e => { if (/^w(Tot|Av|Oc|Os)$/.test(e.target.id)) check(); });
        el.addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) { sel = b.dataset.w; $('#wType', el).value = sel; fill(); $('#wTot', el).focus(); } });
        el.addEventListener('submit', async e => {
            e.preventDefault();
            if (e.target.id === 'of') { const v = $('#oxFree', el).value.trim(), m = $('#oxMsg', el); if (!/^\d+$/.test(v) || Number(v) > 5000) { m.className = 'small err-text'; m.textContent = 'Enter a whole number from 0 to 5000.'; return; } const h = g.hospitalCounts; try { await call('PUT', `/facilities/${S.user.facilityId}/beds`, { icuBeds: h.icu.available, oxygenBeds: Number(v), generalBeds: h.general.available }); S.toast('Oxygen beds saved.'); S.rerender(); } catch (x) { m.className = 'small err-text'; m.textContent = x.message; } return; }
            if (e.target.id !== 'wf') return;
            if (!check()) { S.toast('Please fix the bed counts first.', 'error'); return $('#wTot', el).focus(); }
            const btn = $('#wSave', el), msg = $('#wMsg', el); btn.disabled = true; msg.className = 'small muted'; msg.textContent = 'Saving…';
            try { const cur = wards.find(w => w.type === sel); const r = await call('PUT', '/staff/wards/' + sel, { total: num('wTot'), available: num('wAv'), occupied: num('wOc'), outOfService: num('wOs'), notes: $('#wNotes', el).value, expectedUpdatedAt: cur ? cur.updatedAt : undefined });   // expectedUpdatedAt: a colleague's newer change is never silently overwritten
                if (r.approval) { S.toast(r.message); msg.textContent = ''; btn.disabled = false; S.refreshAlerts(); return; }   // large capacity change: sent to an administrator, published numbers unchanged
                wards = wards.map(w => (w.type === sel ? r.ward : w)); S.toast(`${g.types[sel]} ward saved.`); paint(); S.refreshAlerts(); }
            catch (err) { msg.className = 'small err-text'; msg.textContent = 'Not saved: ' + err.message; S.toast(err.message, 'error'); btn.disabled = false; }
        });
    } });

    // ====================================================== crowd and waiting time ======================================================
    S.register('crowd', { title: 'Crowd & Waiting Time', roles: ['hospital', 'admin'], cap: 'crowd', async render(el) {
        if (S.needFacility(el)) return;
        const d = await call('GET', '/staff/crowd' + fq()), locked = ro('crowd'), tone = { Low: 'ok', Moderate: 'info', Busy: 'warn', 'Very Busy': 'bad' };
        const cur = d.current; let level = cur ? cur.level : '';
        el.innerHTML = S.head('Crowd & Waiting Time', 'A quick staff update that patients see on the hospital page.') + (locked ? roNote('crowd information') : '')
            + `<div class="notice n-info" style="margin-bottom:1rem"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${esc(d.note)} Patients are told it is a staff report, and it is marked outdated if not re-verified.</span></div>
              <div class="grid g2"><section class="card stack" aria-labelledby="cc"><h2 id="cc">Current report</h2>
                ${cur ? `<div class="row-flex"><span class="badge b-${tone[cur.level]}" style="font-size:1rem;padding:.25rem .8rem">${esc(cur.level)}</span>${cur.stale ? S.badge('Outdated', 'warn') : S.badge('Fresh', 'ok')}</div>
                  <dl class="kv"><dt>Waiting time</dt><dd>${cur.waitMinutes != null ? 'About ' + cur.waitMinutes + ' min' : 'Not reported'}</dd><dt>Queue count</dt><dd>${cur.queueCount != null ? cur.queueCount : 'Not reported'}</dd><dt>Last verified</dt><dd>${esc(S.fmtStamp(cur.verifiedAt))} (${esc(S.ago(cur.verifiedAt))}) by ${esc(cur.by)}${S.demoBadge(cur.demo)}</dd></dl>
                  ${cur.stale ? `<div class="notice n-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>This report is more than ${d.staleAfterMinutes / 60} hours old. Patients see it marked outdated.</span></div>` : ''}
                  ${locked ? '' : '<button type="button" class="btn btn-ok" id="reverify"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Still accurate: re-verify now</button>'}`
                : S.empty({ icon: 'fa-people-group', title: 'No crowd update yet', text: 'Patients see "not reported" until staff enter the current crowd level.' })}</section>
              <form class="card stack" id="cf" novalidate aria-label="Update crowd level"><h2>Update now</h2>
                <fieldset style="border:0;padding:0;margin:0" ${locked ? 'disabled' : ''}><legend class="lbl">Crowd level *</legend><div class="seg" role="radiogroup" aria-label="Crowd level" style="margin-top:.35rem;flex-wrap:wrap">${d.levels.map(l => `<button type="button" role="radio" data-l="${esc(l)}" aria-checked="${l === level}" aria-pressed="${l === level}">${esc(l)}</button>`).join('')}</div><span class="err-text" id="cl-e" role="alert"></span></fieldset>
                <div class="grid g2">${field('cWait', 'Estimated waiting time (minutes)', `<input id="cWait" class="in" inputmode="numeric" placeholder="Optional" value="${cur && cur.waitMinutes != null ? cur.waitMinutes : ''}" ${locked ? 'disabled' : ''}>`, '0 to 480')}${field('cQ', 'Queue count', `<input id="cQ" class="in" inputmode="numeric" placeholder="If available" value="${cur && cur.queueCount != null ? cur.queueCount : ''}" ${locked ? 'disabled' : ''}>`)}</div>
                ${locked ? '' : '<div class="row-flex"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save Update</button><span id="cMsg" class="small" role="status"></span></div>'}</form></div>
              <section class="card" style="margin-top:1rem" aria-labelledby="ch"><h2 id="ch">Recent updates</h2>${d.history.length ? `<ul class="list">${d.history.map(h => `<li><div><span class="badge b-${tone[h.level]}">${esc(h.level)}</span> <span class="small">${h.waitMinutes != null ? '~' + h.waitMinutes + ' min' : ''}${h.queueCount != null ? ' · queue ' + h.queueCount : ''}</span>${S.demoBadge(h.demo)}</div><div class="muted small">${esc(S.fmtStamp(h.verifiedAt))} · ${esc(h.by)}</div></li>`).join('')}</ul>` : '<p class="muted">No updates yet.</p>'}</section>`;
        if (locked) return;
        el.addEventListener('click', async e => {
            const b = e.target.closest('[data-l]'); if (b) { level = b.dataset.l; $$('[data-l]', el).forEach(x => { x.setAttribute('aria-checked', String(x === b)); x.setAttribute('aria-pressed', String(x === b)); }); $('#cl-e', el).textContent = ''; return; }
            if (e.target.closest('#reverify')) { try { await call('POST', '/staff/crowd/verify' + fq(), {}); S.toast('Crowd report re-verified.'); S.rerender(); S.refreshAlerts(); } catch (x) { S.toast(x.message, 'error'); } }
        });
        $('#cf', el).addEventListener('submit', async e => {
            e.preventDefault(); const w = $('#cWait', el).value.trim(), q = $('#cQ', el).value.trim(), msg = $('#cMsg', el);
            if (!level) { $('#cl-e', el).textContent = 'Choose the current crowd level.'; return; }
            if ((w && (!/^\d+$/.test(w) || Number(w) > 480)) || (q && (!/^\d+$/.test(q) || Number(q) > 5000))) { msg.className = 'small err-text'; msg.textContent = 'Waiting time must be 0 to 480 and queue count a whole number.'; return; }
            try { await call('POST', '/staff/crowd', { level, waitMinutes: w === '' ? undefined : Number(w), queueCount: q === '' ? undefined : Number(q) }); S.toast('Crowd update saved.'); S.rerender(); S.refreshAlerts(); }
            catch (err) { msg.className = 'small err-text'; msg.textContent = err.message; S.toast(err.message, 'error'); }
        });
    } });
    const $$ = S.$$;

    // ====================================================== doctors and staff ======================================================
    S.register('doctors', { title: 'Doctors & Staff', roles: STAFF, cap: 'doctors', async render(el, params) {
        if (S.needFacility(el)) return;
        const manage = S.can('doctors', 'write'), duty = S.can('duty', 'write'), DUTY = ['On Duty', 'Off Duty', 'On Leave'];
        let docs = (await S.req(() => API.staffDoctors(S.fid()))).doctors; const st = { q: params.q || '', unit: '', spec: '', duty: '' };
        const dutyTone = x => ({ 'On Duty': 'ok', 'Off Duty': 'mute', 'On Leave': 'warn' }[x]);
        el.innerHTML = S.head('Doctors & Staff', manage ? 'Add, edit and manage the doctors listed for your hospital.' : 'Doctors at this hospital.', manage ? '<button class="btn btn-primary" id="addD"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add Doctor</button>' : '')
            + (manage || duty ? '' : roNote('doctors')) + `<form class="filters" role="search" aria-label="Filter doctors" onsubmit="return false"><div class="field grow"><label for="dq">Search</label><input id="dq" class="in" type="search" placeholder="Name, specialization, department or room" value="${esc(st.q)}"></div>
              <div class="field"><label for="dsp">Specialization</label><select id="dsp" class="in"><option value="">All</option>${[...new Set(docs.map(d => d.spec))].sort().map(n => `<option>${esc(n)}</option>`).join('')}</select></div>
              <div class="field"><label for="ddu">Duty status</label><select id="ddu" class="in"><option value="">All</option>${DUTY.map(n => `<option>${n}</option>`).join('')}</select></div></form><div id="dList"></div>`;
        const host = $('#dList', el);
        const table = S.table(host, { pageSize: 10, sort: { key: 'name', dir: 1 }, rows: [], empty: '', cols: [
            { key: 'name', label: 'Doctor', sort: true, html: d => `<span class="strong">${esc(d.name)}</span><br><span class="muted small">${esc(d.timings)}${d.contact ? ' · ' + esc(d.contact) : ''}</span>` },
            { key: 'spec', label: 'Specialization', sort: true, html: d => `${esc(d.spec)}<br><span class="muted small">${esc(d.department || d.unitName || '')}</span>` },
            { key: 'room', label: 'Room', sort: true, html: d => esc(d.room) },
            { key: 'dutyStatus', label: 'Duty', sort: true, html: d => duty ? `<select class="sel-inline" data-duty="${d.id}" aria-label="Duty status for ${esc(d.name)}">${DUTY.map(x => `<option ${x === d.dutyStatus ? 'selected' : ''}>${x}</option>`).join('')}</select>` : S.badge(d.dutyStatus, dutyTone(d.dutyStatus)) },
            { key: 'acc', label: 'Appointments', sort: d => (d.acceptsAppointments ? 0 : 1), html: d => duty ? `<label class="row-flex"><input type="checkbox" data-acc="${d.id}" ${d.acceptsAppointments ? 'checked' : ''} aria-label="Accepting appointments: ${esc(d.name)}"> <span class="small">${d.acceptsAppointments ? 'Open' : 'Closed'}</span></label>` : (d.acceptsAppointments ? S.badge('Open', 'ok') : S.badge('Closed', 'mute')) },
            { key: 'status', label: 'Live status', sort: true, html: d => S.badge(d.status, S.statusTone(d.status)) },
            { key: 'a', label: 'Actions', actions: true, html: d => manage ? `<span class="acts"><button class="btn btn-sm" data-ed="${d.id}" aria-label="Edit ${esc(d.name)}">Edit</button><button class="btn btn-sm btn-danger" data-rm="${d.id}" aria-label="Remove ${esc(d.name)}">Remove</button></span>` : '' }] });
        function draw() {
            const q = st.q.toLowerCase(), rows = docs.filter(d => (!q || [d.name, d.spec, d.department, d.room, d.unitName].some(x => String(x || '').toLowerCase().includes(q))) && (!st.spec || d.spec === st.spec) && (!st.duty || d.dutyStatus === st.duty));
            if (!docs.length) host.innerHTML = `<div class="tbl-wrap">${S.empty({ icon: 'fa-user-doctor', title: 'No doctors yet', text: manage ? 'Add the doctors who see patients at this hospital.' : 'No doctors are listed for this hospital.', action: manage ? '<button class="btn btn-primary" data-add>Add Doctor</button>' : '' })}</div>`;
            else if (!rows.length) host.innerHTML = `<div class="tbl-wrap">${S.empty({ icon: 'fa-magnifying-glass', title: 'No doctors match', text: 'Try a different search or clear the filters.' })}</div>`;
            else { if (!$('table', host)) host.innerHTML = ''; table.setRows(rows); }
        }
        const form = d => `${field('mName', "Doctor's name *", `<input id="mName" name="name" class="in" required maxlength="80" value="${esc(d ? d.name : '')}">`)}
            <div class="grid g2">${field('mSpec', 'Specialization *', `<input id="mSpec" name="spec" class="in" required maxlength="60" value="${esc(d ? d.spec : '')}">`)}${field('mDep', 'Department', `<input id="mDep" name="department" class="in" maxlength="60" value="${esc(d ? d.department : '')}">`)}
            ${field('mTim', 'Consultation timings *', `<input id="mTim" name="timings" class="in" required maxlength="60" placeholder="e.g. 09:00 AM - 01:00 PM" value="${esc(d ? d.timings : '')}">`)}${field('mRoom', 'Room *', `<input id="mRoom" name="room" class="in" required maxlength="60" value="${esc(d ? d.room : '')}">`)}
            ${field('mDuty', 'Duty status', `<select id="mDuty" name="dutyStatus" class="in">${DUTY.map(x => `<option ${d && d.dutyStatus === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}${field('mFee', 'Consultation fee', `<input id="mFee" name="fee" class="in" maxlength="60" placeholder="Optional" value="${esc(d && d.fee !== 'Not stated' ? d.fee : '')}">`)}</div>
            <div class="field"><label class="row-flex" style="font-weight:600"><input type="checkbox" name="acceptsAppointments" ${!d || d.acceptsAppointments ? 'checked' : ''}> Accepting appointments</label></div>
            ${field('mCon', 'Professional contact (optional)', `<input id="mCon" name="contact" class="in" maxlength="80" value="${esc(d ? d.contact : '')}">`, 'Work phone or email only. Shown on staff pages. Do not enter personal details.')}`;
        async function open(d) {
            const done = await S.modal({ title: d ? 'Edit doctor' : 'Add doctor', body: form(d), submit: d ? 'Save Changes' : 'Add Doctor', wide: true, onSubmit: async dlg => {
                const f = new FormData(dlg.querySelector('form')), b = { name: f.get('name'), spec: f.get('spec'), department: f.get('department'), timings: f.get('timings'), room: f.get('room'), fee: f.get('fee'), dutyStatus: f.get('dutyStatus'), acceptsAppointments: f.get('acceptsAppointments') === 'on', contact: f.get('contact') };
                if (d) await call('PUT', '/staff/doctors/' + d.id, b); else await call('POST', '/staff/doctors', { ...b, facilityId: S.fid() }); } });
            if (done) { S.toast(d ? 'Doctor saved.' : 'Doctor added.'); docs = (await S.req(() => API.staffDoctors(S.fid()))).doctors; S.clearSearchCache(); draw(); }
        }
        const patch = async (id, body, ok, revert) => { const d = docs.find(x => x.id === id); try { const r = await call('PUT', `/doctors/${id}/status`, body); Object.assign(d, r.staff); S.toast(ok(d)); draw(); S.refreshAlerts(); } catch (err) { S.toast('Not saved: ' + err.message, 'error'); revert(); draw(); } };
        el.addEventListener('input', e => { const m = { dq: 'q', dsp: 'spec', ddu: 'duty' }[e.target.id]; if (m) { st[m] = e.target.value; draw(); } });
        el.addEventListener('change', e => {
            const s = e.target.closest('[data-duty]'), a = e.target.closest('[data-acc]');
            if (s) patch(Number(s.dataset.duty), { dutyStatus: s.value }, d => `${d.name} is now ${d.dutyStatus}.`, () => {});
            if (a) patch(Number(a.dataset.acc), { acceptsAppointments: a.checked }, d => `${d.name} is ${d.acceptsAppointments ? 'accepting' : 'not accepting'} appointments.`, () => {});
        });
        el.addEventListener('click', async e => {
            if (e.target.closest('#addD') || e.target.closest('[data-add]')) return open(null);
            const ed = e.target.closest('[data-ed]'), rm = e.target.closest('[data-rm]');
            if (ed) return open(docs.find(x => x.id === Number(ed.dataset.ed)));
            if (rm) { const d = docs.find(x => x.id === Number(rm.dataset.rm)); if (!(await S.confirm({ title: 'Remove this doctor?', message: `<b>${esc(d.name)}</b> will no longer be listed to patients or accept new appointments. Existing appointments and the change history are kept.`, confirm: 'Remove doctor', danger: true }))) return; try { await call('DELETE', '/staff/doctors/' + d.id); docs = docs.filter(x => x.id !== d.id); S.toast('Doctor removed from the listing.'); S.clearSearchCache(); draw(); } catch (err) { S.toast(err.message, 'error'); } }
        });
        draw();
    } });

    // ====================================================== staff profile and settings ======================================================
    const SECTIONS = [['beds', 'Bed Management'], ['doctors', 'Doctors & Staff'], ['duty', 'Doctor duty & availability'], ['appointments', 'Appointments'], ['crowd', 'Crowd & Waiting Time'], ['info', 'Hospital Information & units'], ['costs', 'Treatment Costs'], ['stores', 'Medical Stores'], ['assets', 'Hospital Assets'], ['team', 'Team roles']];
    S.register('account', { title: 'Staff Profile', roles: ['hospital', 'doctor', 'admin'], async render(el) {
        const u = S.user, label = u.role === 'hospital' ? { manager: 'Hospital administrator', nurse: 'Nurse', reception: 'Reception' }[u.staffRole] : u.role === 'doctor' ? 'Doctor' : 'Administrator';
        el.innerHTML = S.head('Staff Profile', 'Your account and what your role allows.')
            + `<div class="grid g2"><section class="card" aria-labelledby="pa"><h2 id="pa">Account</h2><dl class="kv"><dt>Name</dt><dd>${esc(u.name)}</dd><dt>Sign-in ID</dt><dd>${esc(u.phone)}</dd><dt>Role</dt><dd>${esc(label)}</dd>${u.facilityName ? `<dt>Hospital</dt><dd>${esc(u.facilityName)}</dd>` : ''}${u.doctorName ? `<dt>Doctor profile</dt><dd>${esc(u.doctorName)}</dd>` : ''}</dl></section>
              <section class="card" aria-labelledby="pp"><h2 id="pp">What you can do</h2>${u.role === 'doctor' ? '<p class="muted">Doctor accounts manage their own availability, room and appointment requests.</p>' : `<ul class="list">${SECTIONS.map(([k, n]) => `<li><span>${esc(n)}</span>${u.caps[k] === 'write' ? S.badge('Can edit', 'ok') : u.caps[k] === 'view' ? S.badge('View only', 'info') : S.badge('No access', 'mute')}</li>`).join('')}</ul>`}</section></div>`;
    } });

    S.register('settings', { title: 'Settings', roles: ['hospital', 'doctor', 'admin'], async render(el) {
        const manager = S.can('team', 'write') && (S.user.role !== 'admin' || !!S.facilityId);   // an administrator needs a chosen hospital first
        el.innerHTML = S.head('Settings', 'Language, security and team access.')
            + `<div class="grid g2"><section class="card stack" aria-labelledby="sl"><h2 id="sl">Language</h2>${field('lang', 'Display language', `<select id="lang" class="in"><option value="en" selected>English</option><option disabled>Konkani (planned)</option><option disabled>Hindi (planned)</option><option disabled>Marathi (planned)</option></select>`, 'The workspace is built to take translated message catalogues. English is available now.')}
                <h2 style="margin-top:.6rem">Data freshness</h2><p class="muted small" style="margin:0">Bed counts are marked outdated after 24 hours and crowd reports after 2 hours. Patients see the same warnings.</p></section>
              <form class="card stack" id="pw" novalidate aria-label="Change password"><h2>Change password</h2>${field('pwC', 'Current password', '<input id="pwC" type="password" class="in" autocomplete="current-password" required>')}${field('pwN', 'New password', '<input id="pwN" type="password" class="in" autocomplete="new-password" minlength="6" required>', 'At least 6 characters. Other devices are signed out.')}
                <div class="row-flex"><button class="btn btn-primary" type="submit">Change Password</button><span id="pwM" class="small" role="status"></span></div></form></div>
              ${manager ? '<section class="card" style="margin-top:1rem" aria-labelledby="st"><h2 id="st">Team and roles</h2><p class="muted small" style="margin-top:0">Administrators can change what each colleague may do. A hospital always keeps at least one manager.</p><div id="team"></div></section>' : ''}`;
        $('#pw', el).addEventListener('submit', async e => {
            e.preventDefault(); const m = $('#pwM', el), c = $('#pwC', el).value, n = $('#pwN', el).value;
            if (!c || n.length < 6) { m.className = 'small err-text'; m.textContent = 'Enter your current password and a new one of at least 6 characters.'; return; }
            try { await call('PUT', '/auth/password', { current: c, next: n }); $('#pw', el).reset(); m.className = 'small'; m.textContent = ''; S.toast('Password changed. Other devices were signed out.'); } catch (err) { m.className = 'small err-text'; m.textContent = err.message; }
        });
        if (!manager) return;
        const box = $('#team', el); let t = await call('GET', '/staff/team' + fq());
        const drawT = () => { box.innerHTML = t.team.length ? `<ul class="list">${t.team.map(m => `<li><div><span class="strong">${esc(m.name)}</span>${m.id === S.user.id ? ' ' + S.badge('You', 'brand') : ''}<div class="muted small">${esc(m.login)} · joined ${esc(S.fmtDate(m.joinedAt.slice(0, 10)))}</div></div><select class="sel-inline" data-m="${m.id}" aria-label="Role for ${esc(m.name)}">${t.roles.map(r => `<option value="${r}" ${r === m.staffRole ? 'selected' : ''}>${({ manager: 'Administrator', nurse: 'Nurse', reception: 'Front desk', pharmacy: 'Pharmacy', finance: 'Finance' })[r] || r}</option>`).join('')}</select></li>`).join('')}</ul>` : '<p class="muted">No staff accounts for this hospital yet.</p>'; };
        drawT();
        box.addEventListener('change', async e => {
            const s = e.target.closest('[data-m]'); if (!s) return; const m = t.team.find(x => x.id === Number(s.dataset.m));
            if (!(await S.confirm({ title: 'Change this role?', message: `<b>${esc(m.name)}</b> will become <b>${esc(s.value)}</b> and their access changes immediately.`, confirm: 'Change role' }))) { s.value = m.staffRole; return; }
            try { t = { ...t, ...(await call('PUT', '/staff/team/' + m.id, { staffRole: s.value })) }; S.toast('Role updated.'); drawT(); } catch (err) { S.toast(err.message, 'error'); s.value = m.staffRole; }
        });
    } });
})();
