// Staff workspace shell: session check, role-based navigation, hospital selector, search, notifications, account menu, hash router.
(function () {
    'use strict';
    const S = window.Staff, esc = S.esc, $ = S.$;
    const ROLE_LABEL = { hospital: 'Hospital staff', doctor: 'Doctor', admin: 'Administrator' };
    const ONBOARDING = /^#\/(onboarding|join)\b/;   // a signed-in patient may use the workspace only to register a hospital / doctor or accept an invitation
    // [page, label key, icon, permission needed (hospital staff / admin; hidden when the server says null)]
    const ACCOUNT = [{ h: 'Account' }, ['account', 'account', 'fa-id-badge'], ['settings', 'settings', 'fa-gear'], { logout: true }];
    const NAV = {
        hospital: [['overview', 'dashboard', 'fa-gauge-high'], { h: 'Daily operations' }, ['beds', 'beds', 'fa-bed-pulse', 'beds'], ['doctors', 'doctors', 'fa-user-doctor', 'doctors'], ['appointments', 'appointments', 'fa-calendar-check', 'appointments'], ['crowd', 'crowd', 'fa-people-group', 'crowd'],
            { h: 'Hospital' }, ['hospital', 'hospital', 'fa-hospital', 'info'], ['units', 'units', 'fa-sitemap', 'info'], ['costs', 'costs', 'fa-indian-rupee-sign', 'costs'],
            { h: 'Optional modules' }, ['stores', 'stores', 'fa-pills', 'stores'], ['inventory', 'inventory', 'fa-boxes-stacked', 'inventory'], ['assets', 'assets', 'fa-screwdriver-wrench', 'assets'],
            { h: 'Access & oversight' }, ['staffing', 'staffing', 'fa-user-shield', 'invites'], ['approvals', 'approvals', 'fa-stamp', 'approvals'], ['reports', 'reports', 'fa-chart-column', 'reports'], { h: 'Records' }, ['audit', 'audit', 'fa-shield-halved', 'audit'], ['activity', 'activity', 'fa-clock-rotate-left'], ...ACCOUNT],
        doctor: [['overview', 'dashboard', 'fa-gauge-high'], { h: 'My work' }, ['appointments', 'myAppointments', 'fa-calendar-check'], ['profile', 'availability', 'fa-id-card-clip'], { h: 'Records' }, ['audit', 'audit', 'fa-shield-halved'], ...ACCOUNT],
        patient: [['onboarding', 'onboarding', 'fa-door-open']],
        admin: [['overview', 'dashboard', 'fa-gauge-high'], { h: 'Administration' }, ['verification', 'verification', 'fa-clipboard-check'], ['users', 'users', 'fa-users'], ['hospitals', 'hospitals', 'fa-hospital'], ['audit', 'audit', 'fa-shield-halved'], ['reports', 'reports', 'fa-chart-column'], ['activity', 'activity', 'fa-clock-rotate-left'],
            { h: 'Selected hospital' }, ['hospital', 'hospital', 'fa-file-medical', 'info'], ['units', 'units', 'fa-sitemap', 'info'], ['doctors', 'doctors', 'fa-user-doctor', 'doctors'], ['crowd', 'crowd', 'fa-people-group', 'crowd'], ['costs', 'costs', 'fa-indian-rupee-sign', 'costs'], ['stores', 'stores', 'fa-pills', 'stores'], ['assets', 'assets', 'fa-screwdriver-wrench', 'assets'], ['staffing', 'staffing', 'fa-user-shield', 'invites'], ['approvals', 'approvals', 'fa-stamp', 'approvals'], ...ACCOUNT]
    };
    let current = null, cleanup = null, pending = 0;
    const shell = () => $('#shell');
    const store = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } } };

    // The hospital a page works on. Hospital staff and doctors are pinned to their own; administrators choose one.
    S.fid = () => (S.user.role === 'admin' ? S.facilityId : undefined);   // sent to the API only for administrators (the server pins everyone else)
    S.needFacility = el => {
        if (S.user.role !== 'admin' || S.facilityId) return false;
        el.innerHTML = S.empty({ icon: 'fa-hospital', title: 'Choose a hospital', text: 'Pick a hospital in the bar at the top of the page to work with its details, units and doctors.' });
        return true;
    };
    S.facilityName = () => (S.facilities.find(f => f.id === S.facilityId) || {}).name || S.user.facilityName || '';

    // Page header with breadcrumbs. actions = HTML.
    S.head = (title, desc, actions) => `<div class="crumbs"><a href="#/overview">Workspace</a> / ${esc(title)}</div><div class="page-head"><div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</div><div class="actions">${actions || ''}</div></div>`;

    function parseHash() {
        const raw = (location.hash || '#/overview').replace(/^#\/?/, ''), [name, qs] = raw.split('?');
        return { name: name || 'overview', params: Object.fromEntries(new URLSearchParams(qs || '')) };
    }
    S.go = (name, params) => { const qs = params ? '?' + new URLSearchParams(params).toString() : ''; location.hash = '#/' + name + qs; };

    function renderNav() {
        const items = NAV[S.user.role].filter(i => i.h || i.logout || !i[3] || S.can(i[3]));
        // drop a group heading whose items are all hidden for this role
        const shown = items.filter((i, k) => !i.h || (items[k + 1] && !items[k + 1].h));
        $('#nav').innerHTML = shown.map(i => i.h ? `<div class="nav-h">${esc(i.h)}</div>`
            : i.logout ? `<a href="#/logout" id="navLogout" title="${esc(S.t('logout'))}"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>${esc(S.t('logout'))}</span></a>`
            : `<a href="#/${i[0]}" ${i[0] === current ? 'aria-current="page"' : ''} title="${esc(S.t(i[1]))}"><i class="fa-solid ${i[2]}" aria-hidden="true"></i><span>${esc(S.t(i[1]))}</span>${i[0] === 'appointments' && pending ? `<b class="count" aria-label="${pending} waiting">${pending}</b>` : ''}</a>`).join('');
    }
    async function signOut() { try { await GoaAPI.logout(); } catch (x) { /* leave anyway */ } location.replace('/'); }
    function renderScope() {
        const box = $('#scope');
        if (S.user.role === 'admin') {
            box.innerHTML = `<label class="sr-only" for="facSel">Hospital</label><i class="fa-solid fa-hospital" aria-hidden="true" style="color:#0f766e"></i><select id="facSel" class="in"><option value="">Choose a hospital…</option>${S.facilities.map(f => `<option value="${esc(f.id)}" ${f.id === S.facilityId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
            $('#facSel').addEventListener('change', e => { S.facilityId = e.target.value || null; store.set('gcStaffFacility', S.facilityId); route(); });
        } else box.innerHTML = `<span class="chip" title="${esc(S.user.facilityName || '')}"><i class="fa-solid fa-hospital" aria-hidden="true"></i><span>${esc(S.user.facilityName || 'No hospital')}</span></span>`;
    }

    // ---------- alerts (bell) ----------
    S.refreshAlerts = async function () {
        if (S.user.role === 'patient') return;   // registration-only visit: nothing to refresh
        try {
            if (S.user.role === 'admin') {
                const o = await S.req(() => GoaAPI.adminOverview());
                S.alerts = [];
                if (o.hospitals.awaitingVerification) S.alerts.push({ level: 'info', text: `${S.plural(o.hospitals.awaitingVerification, 'hospital')} awaiting verification.`, page: 'hospitals' });
                if (o.hospitals.bedsNeverConfirmed) S.alerts.push({ level: 'warn', text: `${S.plural(o.hospitals.bedsNeverConfirmed, 'hospital')} never confirmed bed counts.`, page: 'hospitals' });
                if (o.units.total - o.units.verified > 0) S.alerts.push({ level: 'info', text: `${S.plural(o.units.total - o.units.verified, 'unit')} not yet verified.`, page: 'hospitals' });
                pending = 0;
            } else {
                const o = await S.req(() => GoaAPI.staffOverview());
                S.alerts = o.alerts || []; pending = o.appointments.pending || 0;
            }
        } catch (e) { /* the bell just stays as it was */ }
        const pip = $('#bellPip'); pip.textContent = S.alerts.length; pip.classList.toggle('hidden', !S.alerts.length);
        $('#bellBtn').setAttribute('aria-label', S.alerts.length ? `Notifications (${S.alerts.length})` : 'Notifications');
        renderNav();
    };
    function bellHtml() {
        return `<h3>Notifications</h3>${S.alerts.length ? S.alerts.map(a => `<a href="#/${esc(a.page)}"><i class="fa-solid ${a.level === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-info'}" style="color:${a.level === 'warn' ? '#b45309' : '#1d4ed8'};margin-top:.2rem" aria-hidden="true"></i><span>${esc(a.text)}</span></a>`).join('') : '<div class="none">You are all caught up.</div>'}`;
    }

    // ---------- popovers ----------
    const pops = [['bellBtn', 'bellPop', bellHtml], ['userBtn', 'userPop', () => `<div style="padding:.6rem .7rem"><div class="strong">${esc(S.user.name)}</div><div class="muted small">${esc(ROLE_LABEL[S.user.role])}${S.user.doctorName ? ' · ' + esc(S.user.doctorName) : ''}</div>${S.user.facilityName ? `<div class="muted small">${esc(S.user.facilityName)}</div>` : ''}</div><button type="button" class="row" id="signOut"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>Sign out</span></button>`]];
    function closePops(except) { pops.forEach(([b, p]) => { if (p !== except) { $('#' + p).classList.add('hidden'); $('#' + b).setAttribute('aria-expanded', 'false'); } }); $('#searchPop').classList.add('hidden'); }
    function bindPops() {
        pops.forEach(([b, p, html]) => $('#' + b).addEventListener('click', e => {
            e.stopPropagation(); const pop = $('#' + p), open = pop.classList.contains('hidden'); closePops(p);
            if (open) { pop.innerHTML = html(); pop.classList.remove('hidden'); $('#' + b).setAttribute('aria-expanded', 'true'); } else { pop.classList.add('hidden'); $('#' + b).setAttribute('aria-expanded', 'false'); }
        }));
        document.addEventListener('click', e => { if (!e.target.closest('.pop') && !e.target.closest('.search')) closePops(); const a = e.target.closest('.pop a'); if (a) closePops(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePops(); shell().classList.remove('open'); } });
        $('#userPop').addEventListener('click', async e => { if (e.target.closest('#signOut')) signOut(); });
    }

    // ---------- search: doctors, units and appointments ----------
    let searchCache = null;
    async function searchData() {
        if (searchCache && Date.now() - searchCache.at < 60000) return searchCache;
        const out = { at: Date.now(), doctors: [], units: [] };
        if (S.user.role === 'doctor' || (S.user.role === 'admin' && !S.facilityId)) return out;
        try { out.doctors = (await S.req(() => GoaAPI.staffDoctors(S.fid()))).doctors; if (S.user.role !== 'doctor') out.units = (await S.req(() => GoaAPI.units(S.fid()))).units; } catch (e) { /* no suggestions */ }
        searchCache = out; return out;
    }
    S.clearSearchCache = () => { searchCache = null; };
    function bindSearch() {
        const inp = $('#searchInput'), pop = $('#searchPop');
        const run = S.debounce(async () => {
            const q = inp.value.trim().toLowerCase(); closePops('searchPop');
            if (q.length < 2) { pop.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); return; }
            const d = await searchData(), has = (...f) => f.some(x => String(x || '').toLowerCase().includes(q));
            const docs = d.doctors.filter(x => has(x.name, x.spec, x.room, x.unitName)).slice(0, 5), units = d.units.filter(x => has(x.name, S.UNIT_TYPES[x.type])).slice(0, 5), enc = encodeURIComponent(inp.value.trim());
            pop.innerHTML = (docs.length ? `<h3>Doctors</h3>${docs.map(x => `<a href="#/doctors?q=${enc}"><i class="fa-solid fa-user-doctor" aria-hidden="true"></i><span>${esc(x.name)}<br><span class="muted small">${esc(x.spec)} · ${esc(x.room)}</span></span></a>`).join('')}` : '')
                + (units.length ? `<h3>Units</h3>${units.map(x => `<a href="#/units?q=${enc}"><i class="fa-solid fa-sitemap" aria-hidden="true"></i><span>${esc(x.name)}<br><span class="muted small">${esc(S.UNIT_TYPES[x.type] || x.type)}</span></span></a>`).join('')}` : '')
                + (S.user.role !== 'admin' ? `<h3>Appointments</h3><a href="#/appointments?q=${enc}"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i><span>Search appointments for “${esc(inp.value.trim())}”</span></a>` : '')
                + (!docs.length && !units.length && S.user.role === 'admin' ? '<div class="none">No matches. Choose a hospital first to search its doctors and units.</div>' : '');
            pop.classList.remove('hidden'); inp.setAttribute('aria-expanded', 'true');
        }, 200);
        inp.addEventListener('input', run);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = $('a', pop); if (first) { location.hash = first.getAttribute('href'); closePops(); inp.blur(); $('#searchBox').classList.remove('open'); } } });
        $('#searchBtn').addEventListener('click', () => { $('#searchBox').classList.toggle('open'); inp.focus(); });
    }

    // ---------- router ----------
    async function route(first) {
        const { name, params } = parseHash(), def = S.pages[name];
        if (name === 'logout') return signOut();
        if (!def || (def.roles && !def.roles.includes(S.user.role)) || (def.cap && S.user.role !== 'doctor' && !S.can(def.cap))) { location.replace('#/overview'); if (name !== 'overview') return; }
        if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
        S.cleanups.splice(0).forEach(f => { try { f(); } catch (e) { /* ignore */ } });
        current = name; renderNav(); shell().classList.remove('open');
        // A fresh container per page, so event handlers from the previous page can never fire twice.
        const old = $('#page'), el = old.cloneNode(false); old.replaceWith(el); el.innerHTML = S.loading();
        document.title = `${S.pages[name].title} · GoaCare Staff`;
        try { cleanup = await S.pages[name].render(el, params) || null; }
        catch (e) { el.innerHTML = S.errorBox(e.message || 'Could not load this page.', true); const b = $('[data-retry]', el); if (b) b.addEventListener('click', () => route()); }
        if (!first) el.focus({ preventScroll: true });
    }
    S.rerender = () => route();

    async function boot() {
        const boot = $('#boot');
        let me;
        try { me = (await GoaAPI.me()).user; }
        catch (e) {
            if (e.network) { boot.innerHTML = `<i class="fa-solid fa-wifi" style="font-size:1.6rem" aria-hidden="true"></i><div>${esc(e.message)}</div><button type="button" class="btn" onclick="location.reload()">Try again</button>`; return; }
            if (ONBOARDING.test(location.hash)) { try { sessionStorage.setItem('gcStaffNext', location.hash); } catch (x) { /* ignore */ } }   // an invitation link survives the sign-in
            return location.replace('/');   // not signed in: the one GoaCare sign-in is on the home page
        }
        if (!ROLE_LABEL[me.role] && !(me.role === 'patient' && ONBOARDING.test(location.hash))) return location.replace('/');   // patients stay in the patient portal, except for registration / joining
        S.user = me;
        try { S.facilities = (await GoaAPI.facilities()).facilities; } catch (e) { S.facilities = []; }
        S.facilityId = me.role === 'admin' ? (S.facilities.some(f => f.id === store.get('gcStaffFacility')) ? store.get('gcStaffFacility') : null) : me.facilityId;
        $('#roleLabel').textContent = me.role === 'patient' ? 'Registration' : ROLE_LABEL[me.role] + ' workspace';
        $('#userBtn').textContent = me.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        let collapsed = false; try { collapsed = localStorage.getItem('gcStaffCollapsed') === '1'; } catch (e) { /* ignore */ }
        const setCollapsed = c => { shell().classList.toggle('collapsed', c); const b = $('#collapseBtn'); b.setAttribute('aria-pressed', String(c)); $('span', b).textContent = c ? 'Expand menu' : 'Collapse menu'; $('i', b).className = 'fa-solid ' + (c ? 'fa-angles-right' : 'fa-angles-left'); try { localStorage.setItem('gcStaffCollapsed', c ? '1' : '0'); } catch (e) { /* ignore */ } };
        $('#collapseBtn').addEventListener('click', () => setCollapsed(!shell().classList.contains('collapsed')));
        $('#menuBtn').addEventListener('click', () => { if (window.matchMedia('(max-width:860px)').matches) shell().classList.toggle('open'); else setCollapsed(!shell().classList.contains('collapsed')); });
        $('#scrim').addEventListener('click', () => shell().classList.remove('open'));
        bindPops(); bindSearch(); renderScope();
        boot.classList.add('hidden'); shell().classList.remove('hidden'); setCollapsed(collapsed);
        window.addEventListener('hashchange', () => route());
        await route(true);
        S.refreshAlerts();
        setInterval(() => { if (!document.hidden) S.refreshAlerts(); }, 60000);
    }
    document.addEventListener('DOMContentLoaded', boot);
})();
