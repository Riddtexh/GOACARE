// Thin wrapper around fetch() for the GoaCare server (same origin, cookie session).
(function () {
    async function request(method, path, body) {
        let res;
        try {
            res = await fetch('/api' + path, {
                method, credentials: 'same-origin',
                headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
        } catch (e) {
            const err = new Error('Cannot reach the GoaCare server. Check your connection (or start it with "npm start").');
            err.network = true;
            throw err;
        }
        let data = null;
        try { data = await res.json(); } catch (e) { /* empty body */ }
        if (!res.ok) {
            const err = new Error((data && data.error) || 'Request failed (' + res.status + ').');
            err.status = res.status; err.code = data && data.code;
            throw err;
        }
        return data;
    }
    const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v != null && v !== '') p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };

    window.GoaAPI = {
        call: (method, path, body) => request(method, path, body),   // generic: GoaAPI.call('GET', '/staff/costs')
        qs,
        publicOperations: () => request('GET', '/public/operations'),
        // accounts
        register: body => request('POST', '/auth/register', body),
        login: (phone, password) => request('POST', '/auth/login', { phone, password }),
        logout: () => request('POST', '/auth/logout', {}),
        me: () => request('GET', '/auth/me'),
        // live directory
        facilities: () => request('GET', '/facilities'),
        doctors: () => request('GET', '/doctors'),
        crowd: date => request('GET', '/crowd' + qs({ date })),
        impact: () => request('GET', '/impact'),
        triage: (symptom, loc) => request('GET', '/triage' + qs({ symptom, lat: loc && loc.lat, lng: loc && loc.lng })),
        alternatives: (facilityId, specialty, loc) => request('GET', '/alternatives' + qs({ facilityId, specialty, lat: loc && loc.lat, lng: loc && loc.lng })),
        logRedirect: (from, to) => request('POST', '/redirects', { from, to }),
        reportWait: (facilityId, minutes) => request('POST', '/facilities/' + encodeURIComponent(facilityId) + '/wait', { minutes }),
        // staff
        setBeds: (facilityId, beds) => request('PUT', '/facilities/' + encodeURIComponent(facilityId) + '/beds', beds),
        setDoctor: (id, patch) => request('PUT', '/doctors/' + id + '/status', patch),
        staffAppointments: params => request('GET', '/staff/appointments' + qs(params || {})),
        setAppointmentStatus: (id, status) => request('PUT', '/appointments/' + id + '/status', { status }),
        // admin (admin accounts only)
        adminUsers: (q, role) => request('GET', '/admin/users' + qs({ q, role })),
        adminUser: id => request('GET', '/admin/users/' + id),
        adminAudit: () => request('GET', '/admin/audit'),
        // staff / doctor / admin workspace (staff.html). facilityId is only meaningful for administrators; the server pins everyone else to their own hospital.
        staffOverview: fid => request('GET', '/staff/overview' + qs({ facilityId: fid })),
        staffDoctors: fid => request('GET', '/staff/doctors' + qs({ facilityId: fid })),
        staffHospital: fid => request('GET', '/staff/hospital' + qs({ facilityId: fid })),
        saveHospital: body => request('PUT', '/staff/hospital', body),
        staffActivity: (fid, limit, offset) => request('GET', '/staff/activity' + qs({ facilityId: fid, limit, offset })),
        units: fid => request('GET', '/staff/units' + qs({ facilityId: fid })),
        createUnit: body => request('POST', '/staff/units', body),
        updateUnit: (id, body) => request('PUT', '/staff/units/' + id, body),
        setUnitActive: (id, active) => request('PUT', '/staff/units/' + id + '/active', { active }),
        setUnitDoctors: (id, doctorIds) => request('PUT', '/staff/units/' + id + '/doctors', { doctorIds }),
        adminOverview: () => request('GET', '/admin/overview'),
        adminFacilities: () => request('GET', '/admin/facilities'),
        verifyFacility: id => request('PUT', '/admin/facilities/' + encodeURIComponent(id) + '/verify', {}),
        verifyUnit: id => request('PUT', '/admin/units/' + id + '/verify', {}),
        adminActivity: params => request('GET', '/admin/activity' + qs(params || {})),
        // my data
        myData: () => request('GET', '/me/data'),
        consent: () => request('POST', '/me/consent', { accept: true }),
        saveProfile: p => request('PUT', '/me/profile', p),
        addRecord: r => request('POST', '/me/records', r),
        deleteRecord: id => request('DELETE', '/me/records/' + id),
        addPrescription: r => request('POST', '/me/prescriptions', r),
        deletePrescription: id => request('DELETE', '/me/prescriptions/' + id),
        book: a => request('POST', '/me/appointments', a),
        cancelAppointment: id => request('PUT', '/me/appointments/' + id + '/cancel', {}),
        addClaim: c => request('POST', '/me/claims', c),
        setClaim: (id, stage, note) => request('PUT', '/me/claims/' + id, { stage, note }),
        deleteClaim: id => request('DELETE', '/me/claims/' + id),
        deleteAccount: () => request('DELETE', '/me', { confirm: 'DELETE' })
    };
})();
