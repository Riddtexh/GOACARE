// Sign-in flow: registration / login / logout against the server, plus the "locked until signed in" screen.
(function () {
    const byId = id => document.getElementById(id);
    const root = document.documentElement;
    const SESSION_KEY = 'gcSessionAuth';          // sessionStorage: 'user' | 'guest' (only used to avoid a lock-screen flash)
    const OWNER_KEY = 'goaCareProfileOwner';      // localStorage: id of the account whose data is stored in this browser

    // ---------- lock / unlock ----------
    function unlock(mode) {
        try { sessionStorage.setItem(SESSION_KEY, mode); } catch (e) {}
        root.classList.remove('gc-locked');
        byId('authModal').classList.add('hidden');
        window.switchTab('appointments');
        window.scrollTo(0, 0);
    }
    function lock() {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
        root.classList.add('gc-locked');
        byId('authModal').classList.remove('hidden');
        window.switchTab('appointments');
    }

    // ---------- per-account browser data ----------
    // Profile, records, appointments and prescriptions are still kept in this browser (not on the server yet).
    // When a different account signs in, start it with a clean slate so it never sees the previous account's data.
    function claimBrowserData(user) {
        if (localStorage.getItem(OWNER_KEY) === String(user.id)) return false;
        localStorage.setItem(OWNER_KEY, String(user.id));
        localStorage.setItem('goaCareUserProfile', JSON.stringify({
            name: user.name, phone: user.phone, emergencyContact: '', bloodGroup: '', ddssyCard: '', address: '', allergies: '', conditions: ''
        }));
        localStorage.setItem('goaCareMedicalRecords', '[]');
        localStorage.setItem('goaCareAppointments', '[]');
        localStorage.setItem('goaCarePrescriptions', '[]');
        return true;   // page must reload so every module re-reads localStorage
    }

    function signedIn(user) {
        if (claimBrowserData(user)) {
            try { sessionStorage.setItem(SESSION_KEY, 'user'); } catch (e) {}
            location.reload();
            return;
        }
        currentUserProfile.name = user.name;
        currentUserProfile.phone = user.phone;
        saveProfileToStorage();
        loadProfileToUI();
        unlock('user');
    }

    // ---------- form handlers (called from index.html) ----------
    function showError(msg) {
        const el = byId('authError');
        el.innerText = msg || '';
        el.classList.toggle('hidden', !msg);
    }

    window.handleAuthSubmit = async function (e) {
        e.preventDefault();
        showError('');
        const phone = byId('authPhone').value.trim();
        const password = byId('authPassword').value;
        const name = byId('authName').value.trim();
        const btn = byId('authSubmitBtn');
        const label = btn.innerText;

        if (authMode === 'signup') {
            if (name.length < 2) return showError('Please enter your full name.');
            if (password.length < 6) return showError('Password / PIN must be at least 6 characters.');
        }

        btn.disabled = true; btn.innerText = 'Please wait...';
        try {
            const { user } = authMode === 'signup'
                ? await GoaAPI.register(name, phone, password)
                : await GoaAPI.login(phone, password);
            byId('authPassword').value = '';
            signedIn(user);
        } catch (err) {
            showError(err.message);
        } finally {
            btn.disabled = false; btn.innerText = label;
        }
    };

    window.continueAsGuest = function () { showError(''); unlock('guest'); };

    window.logoutUser = async function () {
        try { await GoaAPI.logout(); } catch (e) { /* even if the server is unreachable, lock the screen */ }
        const f = byId('authForm'); if (f && f.reset) f.reset();
        showError('');
        lock();
        window.scrollTo(0, 0);
    };

    // ---------- on page load: restore the session from the server cookie ----------
    window.addEventListener('load', async function () {
        let mode = null;
        try { mode = sessionStorage.getItem(SESSION_KEY); } catch (e) {}
        if (mode === 'guest') { unlock('guest'); return; }
        try {
            const { user } = await GoaAPI.me();
            signedIn(user);
        } catch (err) {
            lock();
            if (err.network) showError(err.message);
        }
    });
})();
