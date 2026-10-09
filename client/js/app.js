// Navigation, profile, medical records, DDSSY estimate, privacy controls.
(function () {
    // [id, icon, i18n key, group, breadcrumb label]
    const TABS = [
        ['dashboard', 'fa-table-cells-large', 'navHome', 'Overview'], ['facilities', 'fa-hospital', 'navFac', 'Find care'], ['doctors', 'fa-user-doctor', 'navDoc', 'Find care'],
        ['appointments', 'fa-calendar-check', 'navAppt', 'Find care'], ['records', 'fa-file-medical', 'navRecords', 'My health'], ['ddssy', 'fa-shield-halved', 'navDdssy', 'My health'],
        ['profile', 'fa-user', 'navProfile', 'My health'], ['emergency', 'fa-truck-medical', 'navSos', 'Emergency'], ['stores', 'fa-pills', 'navStore', 'Services'],
        ['staff', 'fa-table-columns', 'navStaff', 'Hospital staff'], ['admin', 'fa-user-shield', 'navAdmin', 'Administration']
    ];
    const BOTTOM = ['dashboard', 'facilities', 'appointments', 'emergency'];
    let current = 'dashboard';
    const visibleTabs = () => TABS.filter(([k]) => k === 'staff' ? (GC.user && (GC.user.role === 'doctor' || GC.user.role === 'hospital')) : k === 'admin' ? (GC.user && GC.user.role === 'admin') : true);
    const hashTab = () => { const k = (location.hash || '').slice(1); return TABS.some(x => x[0] === k) ? k : 'dashboard'; };

    function navHtml(prefix) {
        let group = '', out = '';
        visibleTabs().forEach(([k, icon, key, g]) => {
            if (g !== group && g !== 'Overview') out += `<div class="nav-group">${esc(g)}</div>`;
            group = g;
            out += `<button type="button" id="${prefix}-${k}" onclick="switchTab('${k}')" class="nav-item ${k === 'emergency' ? 'nav-item-urgent' : ''}" ${k === current ? 'aria-current="page"' : ''}><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${esc(t(key))}</span></button>`;
        });
        return out;
    }
    window.renderNav = function () {
        byId('navDesktop').innerHTML = navHtml('nav'); byId('mobileMenu').innerHTML = navHtml('mnav');
        byId('bottomNav').innerHTML = BOTTOM.map(k => { const [, icon, key] = TABS.find(x => x[0] === k); return `<button type="button" onclick="switchTab('${k}')" class="bn-item ${k === 'emergency' ? 'bn-urgent' : ''}" ${k === current ? 'aria-current="page"' : ''}><i class="fa-solid ${icon}" aria-hidden="true"></i><span>${esc(t(key))}</span></button>`; }).join('')
            + '<button type="button" onclick="openDrawer()" class="bn-item" aria-label="More menu"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span>More</span></button>';
    };
    function renderCrumbs() {
        const tab = TABS.find(x => x[0] === current), label = t(tab[2]);
        byId('breadcrumb').innerHTML = current === 'dashboard' ? `<li aria-current="page">${esc(t('navHome'))}</li>`
            : `<li><button type="button" onclick="switchTab('dashboard')">${esc(t('navHome'))}</button></li><li class="sep" aria-hidden="true">/</li><li>${esc(tab[3])}</li><li class="sep" aria-hidden="true">/</li><li aria-current="page">${esc(label)}</li>`;
        byId('backBtn').classList.toggle('hidden', current === 'dashboard');
        document.title = label + ' · GoaCare';
    }
    window.openDrawer = () => { byId('drawer').classList.remove('hidden'); document.body.classList.add('no-scroll'); };
    window.closeDrawer = () => { byId('drawer').classList.add('hidden'); document.body.classList.remove('no-scroll'); };
    window.switchTab = function (tab, fromHistory) {
        if (!visibleTabs().some(([k]) => k === tab)) tab = 'dashboard';
        current = tab;
        TABS.forEach(([k]) => { const s = byId('section-' + k); if (s) s.classList.toggle('hidden', k !== tab); });
        closeDrawer(); renderNav(); renderCrumbs();
        if (!fromHistory && hashTab() !== tab) history.pushState({ tab }, '', '#' + tab);   // browser back / forward keep working
        window.scrollTo({ top: 0 });
        document.dispatchEvent(new CustomEvent('gc:tab', { detail: tab }));
    };
    window.addEventListener('popstate', () => switchTab(hashTab(), true));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
    window.currentTab = () => current;
    window.initialRoute = () => { current = hashTab(); history.replaceState({ tab: current }, '', '#' + current); switchTab(current, true); };
    window.openModal = id => { const m = byId(id); if (id === 'addRecordModal') byId('rcDate').value = todayISO(); if (id === 'rxModal') byId('rxDate').value = todayISO(); if (needSaveAccess()) return; m.classList.remove('hidden'); };
    window.closeModal = id => byId(id).classList.add('hidden');

    // Saving personal data needs a signed-in account + consent.
    window.needSaveAccess = function () {
        if (!GC.user) { toast('Sign in to save your data.', 'error'); openAuth(); return true; }
        if (!GC.user.consentAt) { byId('consentModal').classList.remove('hidden'); return true; }
        return false;
    };
    const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e.code === 'consent_required') { GC.user.consentAt = null; byId('consentModal').classList.remove('hidden'); } else toast(e.message, 'error'); } };

    // ---------- profile ----------
    const PF = { name: 'pfName', phone: 'pfPhone', emergencyContact: 'pfEmergency', bloodGroup: 'pfBlood', ddssyCard: 'pfDdssy', address: 'pfAddress', allergies: 'pfAllergies', conditions: 'pfConditions' };
    window.renderProfile = function () {
        const p = GC.data.profile || {};
        Object.entries(PF).forEach(([k, id]) => { byId(id).value = p[k] != null && p[k] !== '' ? p[k] : (k === 'name' && GC.user ? GC.user.name : k === 'phone' && GC.user ? GC.user.phone : ''); });
        byId('profileGate').classList.toggle('hidden', !!GC.user);
        byId('consentStatus').textContent = !GC.user ? 'Sign in to manage your data.' : GC.user.consentAt ? 'You agreed to store your health data on the server on ' + new Date(GC.user.consentAt).toLocaleDateString('en-IN') + '.' : 'You have not agreed to store health data yet, so nothing is saved.';
        byId('recordsOwner').textContent = (GC.user ? GC.user.name : 'Guest') + (p.bloodGroup ? ' · Blood group ' + p.bloodGroup : '');
        byId('recordsGate').classList.toggle('hidden', !!(GC.user && GC.user.consentAt));
    };
    window.saveProfile = guard(async function () {
        if (needSaveAccess()) return;
        const body = {}; Object.entries(PF).forEach(([k, id]) => { body[k] = byId(id).value; });
        GC.data.profile = (await GoaAPI.saveProfile(body)).profile; renderProfile(); toast('Profile saved.');
    });

    // ---------- records ----------
    window.renderRecords = function () {
        const rows = GC.data.records;
        byId('recordsBody').innerHTML = rows.length ? rows.map(r => `<tr class="border-t border-slate-100"><td data-label="Date" class="p-3 whitespace-nowrap">${esc(fmtDate(r.date))}</td><td data-label="Doctor / facility" class="p-3">${esc(r.facility)}</td><td data-label="Diagnosis" class="p-3 font-semibold">${esc(r.diagnosis)}</td><td data-label="Treatment" class="p-3">${esc(r.prescription)}</td><td data-label="Follow-up" class="p-3">${r.followup ? esc(fmtDate(r.followup)) : '-'}</td><td class="p-3 no-print"><button onclick="deleteRecord(${r.id})" class="text-rose-600 font-bold" aria-label="Delete record"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td></tr>`).join('')
            : '<tr><td colspan="6" class="p-6 text-center text-slate-500">No records yet.</td></tr>';
    };
    window.saveRecord = guard(async function () {
        const r = await GoaAPI.addRecord({ date: byId('rcDate').value, facility: byId('rcFacility').value, diagnosis: byId('rcDiagnosis').value, prescription: byId('rcRx').value, followup: byId('rcFollow').value });
        GC.data.records.unshift(r.record); GC.data.records.sort((a, b) => b.date.localeCompare(a.date));
        ['rcFacility', 'rcDiagnosis', 'rcRx', 'rcFollow'].forEach(i => { byId(i).value = ''; });
        closeModal('addRecordModal'); renderRecords();
    });
    window.deleteRecord = guard(async function (id) { if (!confirm('Delete this record?')) return; await GoaAPI.deleteRecord(id); GC.data.records = GC.data.records.filter(r => r.id !== id); renderRecords(); });

    // ---------- DDSSY: indicative estimate only ----------
    const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
    window.calculateDDSSY = function () {
        const cap = parseInt(byId('ddssyFamily').value, 10), type = byId('ddssyHospType').value, cost = parseInt(byId('ddssyProcedure').value, 10);
        const covered = type === 'Govt' ? cost : Math.min(cap, cost);
        const out = Math.max(0, cost - covered);
        const box = byId('ddssyResult'); box.classList.remove('hidden');
        box.innerHTML = `<div class="font-bold text-sm">Indicative estimate</div>
            <div>Typical procedure cost: <strong>${inr(cost)}</strong></div>
            <div>Possibly covered: <strong>${inr(covered)}</strong> · Possible out-of-pocket: <strong>${inr(out)}</strong></div>
            <div class="text-[11px] text-teal-800">This is not the scheme's decision. Real DDSSY uses procedure packages, empanelled hospitals and pre-authorisation. Ask the hospital's DDSSY desk and check the official scheme pages linked above.</div>`;
    };

    // ---------- privacy ----------
    window.consentAccept = async function () {
        try { const r = await GoaAPI.consent(); GC.user.consentAt = r.consentAt; byId('consentModal').classList.add('hidden'); renderProfile(); document.dispatchEvent(new CustomEvent('gc:user')); toast('Thanks. You can now save your data.'); } catch (e) { toast(e.message, 'error'); }
    };
    window.consentLater = () => byId('consentModal').classList.add('hidden');
    window.deleteAccount = async function () {
        if (!GC.user) return;
        if (prompt('This permanently deletes your account, records, prescriptions, appointments and claims. Type DELETE to confirm.') !== 'DELETE') return;
        try { await GoaAPI.deleteAccount(); toast('Your account and data were deleted.'); afterSignOut(); } catch (e) { toast(e.message, 'error'); }
    };

    // ---------- emergency screen: static symptom buttons + offline hospital list ----------
    const SYMPTOMS = [['chest_pain', 'fa-heart-pulse'], ['stroke', 'fa-brain'], ['breath', 'fa-lungs'], ['maternity', 'fa-baby'], ['trauma', 'fa-bone'], ['fever', 'fa-temperature-high'], ['minor', 'fa-head-side-cough']];
    function renderEmergency() {
        byId('symptomButtons').innerHTML = SYMPTOMS.map(([c, i]) => `<button type="button" onclick="assessTriage('${c}')" class="p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-rose-50 text-left flex items-center gap-2"><i class="fa-solid ${i} text-rose-600" aria-hidden="true"></i>${esc(t('s_' + c))}</button>`).join('');
        let saved = null; try { saved = JSON.parse(localStorage.getItem('gcLastFacilities')); } catch (e) { /* none */ }
        byId('emLastList').innerHTML = saved && saved.facilities.length
            ? saved.facilities.filter(f => f.phone).map(f => `<li><strong>${esc(f.name)}</strong> · <a class="text-teal-700 underline" href="tel:${esc(f.phone.replace(/[^+\d]/g, ''))}">${esc(f.phone)}</a></li>`).join('') + `<li class="text-[10px] text-slate-500">Saved ${esc(new Date(saved.at).toLocaleString('en-IN'))}. Hospitals without a verified phone number are not listed.</li>`
            : `<li>${esc(t('emLastNone'))}</li>`;
    }
    document.addEventListener('gc:lang', () => { renderNav(); renderCrumbs(); renderEmergency(); });
    document.addEventListener('gc:directory', renderEmergency);
    document.addEventListener('DOMContentLoaded', () => { initialRoute(); renderEmergency(); renderProfile(); renderRecords(); byId('apptDate').value = todayISO(); });
})();
