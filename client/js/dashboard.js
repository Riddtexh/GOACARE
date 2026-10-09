// Dashboard: a welcome header, quick actions, and the person's own upcoming appointments. Only real data from the app is shown.
(function () {
    const ACTIONS = [
        ['facilities', 'fa-hospital', 'Find a hospital', 'Beds, routes and phone numbers', 'teal'],
        ['doctors', 'fa-user-doctor', 'Find a doctor', 'Status, OPD timings and room', 'blue'],
        ['appointments', 'fa-calendar-check', 'Book an appointment', 'Pick a quiet 30-minute slot', 'mint'],
        ['emergency', 'fa-truck-medical', 'Emergency & triage', 'Call 108, check symptoms', 'red'],
        ['records', 'fa-file-medical', 'Medical records', 'History and prescriptions', 'blue'],
        ['ddssy', 'fa-shield-halved', 'DDSSY & insurance', 'Indicative estimates', 'teal']
    ];
    const BADGE = { Requested: ['badge-warn', 'fa-hourglass-half', 'Awaiting hospital'], Confirmed: ['badge-ok', 'fa-circle-check', 'Confirmed'] };

    function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

    function render() {
        const root = byId('dashRoot'); if (!root) return;
        const u = GC.user, first = u ? u.name.split(/\s+/)[0] : null;
        const upcoming = GC.data.appointments.filter(a => (a.status === 'Requested' || a.status === 'Confirmed') && a.date >= todayISO())
            .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 4);
        const notes = [];
        if (u && u.role === 'patient' && !u.consentAt) notes.push(['badge-warn', 'fa-shield', 'Your privacy consent is pending, so health data cannot be saved yet.', "byId('consentModal').classList.remove('hidden')", 'Review']);
        upcoming.filter(a => a.status === 'Requested').forEach(a => notes.push(['badge-info', 'fa-hourglass-half', `${a.name} (${fmtDate(a.date)}, ${a.time}) is waiting for the hospital to confirm.`, "switchTab('appointments')", 'View']));
        if (u && u.role === 'admin') notes.push(['badge-info', 'fa-user-shield', 'Open Administration to see registered users and the data stored for them.', "switchTab('admin')", 'Open']);
        else if (u && u.role !== 'patient') notes.push(['badge-info', 'fa-table-columns', 'Open the Staff Dashboard to update beds, doctor status and appointment requests.', "switchTab('staff')", 'Open']);

        root.innerHTML = `
        <div class="hero">
            <div><p class="eyebrow">${esc(greeting())}</p>
            <h1 id="dashTitle" class="hero-title">${first ? 'Welcome, ' + esc(first) : 'Welcome to GoaCare'}</h1>
            <p class="hero-sub">Find a hospital with free beds, see which doctors are available, and book an appointment. In an emergency, call 108 first.</p></div>
            <div class="hero-actions">
                <a href="tel:108" class="btn btn-danger"><i class="fa-solid fa-phone-volume" aria-hidden="true"></i> Call 108</a>
                ${u ? '' : '<button type="button" class="btn btn-secondary" onclick="openAuth()"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Sign in</button>'}
            </div>
        </div>
        <div>
            <h2 class="section-title">Quick actions</h2>
            <div class="action-grid">${ACTIONS.map(([tab, icon, title, desc, tone]) => `
                <button type="button" onclick="switchTab('${tab}')" class="action-card"><span class="chip chip-${tone}"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
                <span class="action-text"><span class="action-title">${esc(title)}</span><span class="action-desc">${esc(desc)}</span></span><i class="fa-solid fa-chevron-right action-go" aria-hidden="true"></i></button>`).join('')}</div>
        </div>
        <div class="two-col">
            <div class="panel"><div class="panel-head"><h2 class="section-title">Upcoming appointments</h2><button type="button" class="link-btn" onclick="switchTab('appointments')">View all</button></div>
                ${upcoming.length ? upcoming.map(a => { const b = BADGE[a.status]; return `<div class="row"><div><div class="row-title">${esc(a.name)}</div><div class="row-sub">${esc(fmtDate(a.date))} · ${esc(a.time)} · ${esc(a.place)}</div></div><span class="badge ${b[0]}"><i class="fa-solid ${b[1]}" aria-hidden="true"></i> ${b[2]}</span></div>`; }).join('')
                    : `<div class="empty"><i class="fa-regular fa-calendar" aria-hidden="true"></i><p>${u ? 'No upcoming appointments.' : 'Sign in to see your appointments.'}</p><button type="button" class="btn btn-secondary btn-sm" onclick="${u ? "switchTab('appointments')" : 'openAuth()'}">${u ? 'Book an appointment' : 'Sign in'}</button></div>`}
            </div>
            <div class="panel"><div class="panel-head"><h2 class="section-title">Notifications</h2></div>
                ${notes.length ? notes.map(([cls, icon, text, act, label]) => `<div class="row"><div class="row-note"><span class="badge ${cls}"><i class="fa-solid ${icon}" aria-hidden="true"></i></span><span>${esc(text)}</span></div><button type="button" class="link-btn" onclick="${act}">${label}</button></div>`).join('')
                    : '<div class="empty"><i class="fa-regular fa-bell" aria-hidden="true"></i><p>You are all caught up.</p></div>'}
                <div class="account-line">${u ? `<i class="fa-solid fa-user" aria-hidden="true"></i> ${esc(u.name)} · ${esc(u.role === 'patient' ? 'Patient' : u.role === 'doctor' ? 'Doctor' : u.role === 'admin' ? 'Administrator' : 'Hospital staff')}` : '<i class="fa-solid fa-user" aria-hidden="true"></i> Browsing as guest'}</div>
            </div>
        </div>`;
    }
    window.renderDashboard = render;
    ['gc:user', 'gc:lang', 'gc:tab'].forEach(ev => document.addEventListener(ev, () => { if (currentTab() === 'dashboard') render(); }));
    document.addEventListener('DOMContentLoaded', render);
})();
