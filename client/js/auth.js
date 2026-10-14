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
        const role = byId('authRole').value, legacyStaff = role === 'hospital' || role === 'doctor';
        show('authStaffWrap', legacyStaff); show('authFacilityWrap', role === 'hospital'); show('authStaffRoleWrap', role === 'hospital'); show('authDoctorWrap', role === 'doctor');
        show('authNewHospitalWrap', role === 'new_hospital'); show('authNewDoctorWrap', role === 'new_doctor');
        if (legacyStaff || role === 'new_doctor') fillStaffLists();
    };
    // New hospital / doctor registration: the account and the verification request are sent together (the server creates both or neither).
    const val = id => byId(id).value.trim();
    const fileB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Could not read the document.')); r.readAsDataURL(f); });
    function pickDoc(id) { const f = byId(id).files[0]; if (!f) return null; if (f.size > 2 * 1024 * 1024) throw new Error('The document must be 2 MB or smaller.'); if (!/^(application\/pdf|image\/png|image\/jpeg)$/.test(f.type)) throw new Error('The document must be a PDF, PNG or JPEG.'); return f; }
    function onboardingFor(role) {
        if (role === 'new_hospital') {
            const need = [['nhName', 'the hospital name'], ['nhAddress', 'the address'], ['nhDistrict', 'the district'], ['nhLat', 'the latitude'], ['nhLng', 'the longitude'], ['nhPhone', 'the hospital phone'], ['nhLicense', 'the licence number'], ['nhAuthority', 'who issued the licence']];
            for (const [id, label] of need) if (!val(id)) throw new Error('Please enter ' + label + '.');
            return { doc: pickDoc('nhDoc'), body: { type: 'hospital', name: val('nhName'), hospitalType: byId('nhType').value, district: val('nhDistrict'), address: val('nhAddress'), lat: Number(val('nhLat')), lng: Number(val('nhLng')), phone: val('nhPhone'), emergencyContact: val('nhEmergency'), licenseNo: val('nhLicense'), issuingAuthority: val('nhAuthority'), departments: val('nhDepartments') } };
        }
        for (const [id, label] of [['ndQual', 'your qualifications'], ['ndReg', 'your medical registration number'], ['ndAuthority', 'who issued it'], ['ndSpecialty', 'your specialty']]) if (!val(id)) throw new Error('Please enter ' + label + '.');
        return { doc: pickDoc('ndDoc'), body: { type: 'doctor', qualifications: val('ndQual'), registrationNo: val('ndReg'), issuingAuthority: val('ndAuthority'), specialty: val('ndSpecialty'), department: val('ndDepartment'), facilityId: byId('ndFacility').value || undefined } };
    }
    document.addEventListener('click', e => {
        if (e.target.id !== 'nhLocate') return;
        if (!navigator.geolocation) return err('Your browser cannot share its location. Enter the coordinates by hand.');
        navigator.geolocation.getCurrentPosition(p => { byId('nhLat').value = p.coords.latitude.toFixed(5); byId('nhLng').value = p.coords.longitude.toFixed(5); }, () => err('Location was not shared. Enter the coordinates by hand (right-click the hospital on a map).'), { timeout: 8000 });
    });
    async function fillStaffLists() {
        try {
            if (!facilitiesData.length) { const f = await GoaAPI.facilities(), d = await GoaAPI.doctors(); f.facilities.forEach(x => facilitiesData.push(x)); d.doctors.forEach(x => doctorsData.push(x)); }
            byId('authFacility').innerHTML = facilitiesData.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
            byId('authDoctor').innerHTML = doctorsData.map(d => `<option value="${d.id}">${esc(d.name)} · ${esc(d.hospital)}</option>`).join('');
            byId('ndFacility').innerHTML = '<option value="">I will choose later</option>' + facilitiesData.filter(f => f.verificationStatus === 'approved').map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
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
                if (role === 'new_hospital' || role === 'new_doctor') {
                    if (!byId('authName').value.trim()) throw new Error('Please enter your full name.');
                    const ob = onboardingFor(role);   // validated here first; the server validates again and creates nothing if anything is wrong
                    r = await GoaAPI.register({ name: byId('authName').value, phone, password, role: 'patient', onboarding: ob.body });
                    let note = 'Submitted for verification.';
                    if (ob.doc && r.submitted) { try { await GoaAPI.call('POST', '/documents', { ownerType: r.submitted.type, ownerId: r.submitted.facilityId, name: ob.doc.name, data: await fileB64(ob.doc) }); } catch (de) { note = 'Submitted, but the document was not uploaded (' + de.message + '). You can add it on the next page.'; } }
                    try { sessionStorage.setItem('gcStaffNext', '#/onboarding'); sessionStorage.setItem('gcOnboardNote', note); } catch (x) { /* ignore */ }
                    await signedIn(r.user, true);
                    return;
                }
                r = await GoaAPI.register({ name: byId('authName').value, phone, password, role, facilityId: role === 'hospital' ? byId('authFacility').value : undefined, staffRole: role === 'hospital' ? byId('authStaffRole').value : undefined, doctorId: role === 'doctor' ? byId('authDoctor').value : undefined, staffCode: byId('authStaffCode').value });
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
        // Hospital staff, doctors and administrators work in their own workspace (staff.html). Same account, same session cookie.
        // Someone who opened an invitation / registration link before signing in continues there after sign-in (set by staff-boot.js).
        const next = (() => { try { const n = sessionStorage.getItem('gcStaffNext'); sessionStorage.removeItem('gcStaffNext'); return n; } catch (e) { return null; } })();
        if (next && /^#\/(onboarding|join)\b/.test(next)) { location.replace('/staff.html' + next); return; }
        if (user.role !== 'patient') { location.replace('/staff.html'); return; }
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
