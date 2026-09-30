// Thin wrapper around fetch() for talking to the GoaCare server (same origin, cookie-based session).
(function () {
    async function request(method, path, body) {
        let res;
        try {
            res = await fetch('/api' + path, {
                method,
                credentials: 'same-origin',
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined
            });
        } catch (e) {
            const err = new Error('Cannot reach the GoaCare server. Start it with "npm start" and open http://localhost:3000');
            err.network = true;
            throw err;
        }
        let data = null;
        try { data = await res.json(); } catch (e) { /* empty body */ }
        if (!res.ok) {
            const err = new Error((data && data.error) || 'Request failed (' + res.status + ').');
            err.status = res.status;
            throw err;
        }
        return data;
    }

    window.GoaAPI = {
        register: (name, phone, password) => request('POST', '/auth/register', { name, phone, password }),
        login: (phone, password) => request('POST', '/auth/login', { phone, password }),
        logout: () => request('POST', '/auth/logout', {}),
        me: () => request('GET', '/auth/me'),
        facilities: () => request('GET', '/facilities'),
        doctors: () => request('GET', '/doctors')
    };
})();
