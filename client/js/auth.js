// Sign in / register (patient, doctor or hospital), session restore, guest mode, sign out.
(function () {
    let mode = 'login';
    const show = (id, on) => byId(id).classList.toggle('hidden', !on);
    const err = msg => { const e = byId('authError'); e.textContent = msg || ''; show('authError', !!msg); };

    window.openAuth = function () { if (GC.user) return switchTab('profile'); byId('authModal').classList.remove('hidden'); byId('authPhone').focus(); };
    function setMode(m) {
        mode = m; err('');
        show('authNameWrap', m === 'register'); show('authRoleWrap', m === 'register'); if (m === 'login') show('authStaffWrap', false); else authRoleChange();
        byId('authSubmit').textContent = m === 'login' ? 'Sign in' : 'Create account';
        byId('authToggle').textContent = m === 'login' ? 'New here? Create an account' : 'Have an account? Sign in';
        byId('authPassword').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    }
    window.authToggleMode = () => setMode(mode === 'login' ? 'register' : 'login');
    window.authRoleChange = function () {
        const role = byId('authRole').value;
        show('authStaffWrap', role !== 'patient'); show('authFacilityWrap', role === 'hospital'); show('authDoctorWrap', role === 'doctor');
        if (role !== 'patient') fillStaffLists();
    };
    async function fillStaffLists() {
        try {
            if (!facilitiesData.length) { const f = await GoaAPI.facilities(), d = await GoaAPI.doctors(); f.facilities.forEach(x => facilitiesData.push(x)); d.doctors.forEach(x => doctorsData.push(x)); }
            byId('authFacility').innerHTML = facilitiesData.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
            byId('authDoctor').innerHTML = doctorsData.map(d => `<option value="${d.id}">${esc(d.name)} · ${esc(d.hospital)}</option>`).join('');
        } catch (e) { err(e.message); }
    }
    window.authSubmit = async function () {
        err('');
        const phone = byId('authPhone').value.trim(), password = byId('authPassword').value;
        const btn = byId('authSubmit'); btn.disabled = true;
        try {
            let r;
            if (mode === 'login') r = await GoaAPI.login(phone, password);
            else {
                const role = byId('authRole').value;
                r = await GoaAPI.register({ name: byId('authName').value, phone, password, role, facilityId: role === 'hospital' ? byId('authFacility').value : undefined, doctorId: role === 'doctor' ? byId('authDoctor').value : undefined, staffCode: byId('authStaffCode').value });
            }
            await signedIn(r.user, true);
        } catch (e) { err(e.message); } finally { btn.disabled = false; }
    };
    window.continueGuest = function () { try { sessionStorage.setItem('gcGuest', '1'); } catch (e) { /* ignore */ } byId('authModal').classList.add('hidden'); };

    async function signedIn(user, fresh) {
        GC.user = user; byId('authModal').classList.add('hidden');
        byId('userName').textContent = user.name; byId('userRole').textContent = user.role === 'patient' ? 'Patient' : user.role === 'doctor' ? 'Doctor' : user.role === 'admin' ? 'Administrator' : 'Hospital staff';
        byId('userInitials').textContent = user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        byId('logoutBtn').classList.remove('hidden');
        try { Object.assign(GC.data, await GoaAPI.myData()); } catch (e) { /* offline */ }
        renderNav(); renderProfile(); renderRecords(); renderPrescriptions(); renderAppts();
        document.dispatchEvent(new CustomEvent('gc:user'));
        if (user.role === 'admin') { resetStaff(); if (window.resetAdmin) resetAdmin(); switchTab('admin'); }
        else if (user.role !== 'patient') { resetStaff(); switchTab('staff'); }
        else { switchTab(currentTab() === 'staff' || currentTab() === 'admin' ? 'dashboard' : currentTab()); if (!user.consentAt && fresh) byId('consentModal').classList.remove('hidden'); else showTodayAppointments(); }
    }
    window.afterSignOut = function () {
        GC.user = null; GC.data = { profile: {}, records: [], prescriptions: [], appointments: [], claims: [] }; resetStaff(); if (window.resetAdmin) resetAdmin();
        byId('userName').textContent = 'Guest'; byId('userRole').textContent = 'Sign in'; byId('userInitials').textContent = 'GC'; byId('logoutBtn').classList.add('hidden');
        setMode('login'); byId('authPassword').value = '';
        renderNav(); renderProfile(); renderRecords(); renderPrescriptions(); renderAppts(); switchTab('dashboard');
        byId('authModal').classList.remove('hidden');
    };
    window.logout = async function () { try { await GoaAPI.logout(); } catch (e) { /* ignore */ } afterSignOut(); };

    document.addEventListener('DOMContentLoaded', async () => {
        setMode('login');
        byId('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); });
        try { const { user } = await GoaAPI.me(); await signedIn(user, false); }
        catch (e) { let guest = false; try { guest = sessionStorage.getItem('gcGuest') === '1'; } catch (x) { /* ignore */ } if (guest || e.network) byId('authModal').classList.add('hidden'); }
    });
})();
