(function () {
    const byId = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const inr = n => 'Rs ' + Math.round(n).toLocaleString('en-IN');
    const H = (a, b) => [a * 60, b * 60];
    const AREAS = { 'Panaji': [15.4989, 73.8278], 'Porvorim': [15.5270, 73.8170], 'Mapusa': [15.5937, 73.8060], 'Calangute': [15.5440, 73.7550], 'Margao': [15.2832, 73.9862], 'Vasco': [15.3982, 73.8113], 'Ponda': [15.4027, 74.0151], 'Bambolim': [15.4600, 73.8500], 'Curchorem': [15.2626, 74.1076], 'Canacona': [15.0139, 74.0231], 'Bicholim': [15.5947, 73.9503] };
    const STORES = [
        { n: 'Apollo Pharmacy', a: 'Panaji', k: 'Chain', p: AREAS.Panaji, h: H(8, 22), s: ['Home delivery', 'Prescription meds'] },
        { n: 'MedPlus Pharmacy', a: 'Panaji', k: 'Chain', p: [15.4960, 73.8300], h: H(8, 22), s: ['Home delivery', 'Generic alternatives'] },
        { n: 'GMC Hospital Pharmacy', a: 'Bambolim', k: 'Hospital', p: AREAS.Bambolim, h: '24', s: ['24x7', 'Hospital prescriptions'] },
        { n: 'Jan Aushadhi Kendra', a: 'Panaji', k: 'Jan', p: [15.4930, 73.8270], h: H(9, 19), s: ['Low-cost generics'] },
        { n: 'Porvorim Medical Store', a: 'Porvorim', k: 'Local', p: AREAS.Porvorim, h: H(8, 22), s: ['Prescription meds', 'Baby care'] },
        { n: 'Mapusa Wellness Pharmacy', a: 'Mapusa', k: 'Chain', p: AREAS.Mapusa, h: H(8, 23), s: ['Home delivery'] },
        { n: 'Calangute Night Chemist', a: 'Calangute', k: 'Local', p: AREAS.Calangute, h: '24', s: ['24x7', 'Tourist first-aid'] },
        { n: 'Margao Health Pharmacy', a: 'Margao', k: 'Chain', p: AREAS.Margao, h: H(8, 22), s: ['Home delivery', 'Prescription meds'] },
        { n: 'Jan Aushadhi Kendra', a: 'Margao', k: 'Jan', p: [15.2790, 73.9570], h: H(9, 19), s: ['Low-cost generics'] },
        { n: 'Vasco Medical Hall', a: 'Vasco', k: 'Local', p: AREAS.Vasco, h: H(8, 21), s: ['Prescription meds'] },
        { n: 'Ponda Care Pharmacy', a: 'Ponda', k: 'Local', p: AREAS.Ponda, h: H(8, 21), s: ['Prescription meds', 'Diabetes supplies'] },
        { n: 'Curchorem Jan Aushadhi', a: 'Curchorem', k: 'Jan', p: AREAS.Curchorem, h: H(9, 18), s: ['Low-cost generics'] },
        { n: 'Canacona Medical Store', a: 'Canacona', k: 'Local', p: AREAS.Canacona, h: H(8, 20), s: ['Prescription meds'] },
        { n: 'Bicholim Pharmacy', a: 'Bicholim', k: 'Local', p: AREAS.Bicholim, h: H(8, 21), s: ['Prescription meds'] }
    ];
    let ref = null;
    const km = (a, b) => { const r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]); const q = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(q)); };
    const isOpen = st => { if (st.h === '24') return true; const d = new Date(), m = d.getHours() * 60 + d.getMinutes(); return m >= st.h[0] && m < st.h[1]; };
    const hrs = st => { if (st.h === '24') return 'Open 24 hours'; const f = m => { const h = Math.floor(m / 60); return (h % 12 || 12) + (h >= 12 ? ' PM' : ' AM'); }; return f(st.h[0]) + ' - ' + f(st.h[1]); };
    const note = t => { const m = byId('storeMsg'); m.innerText = t || ''; m.classList.toggle('hidden', !t); };

    window.renderStores = function () {
        const q = byId('storeSearch').value.trim().toLowerCase(), f = byId('storeFilter').value;
        let list = STORES.filter(s => (!q || (s.n + ' ' + s.a).toLowerCase().includes(q)) && (f === 'all' || (f === 'open' && isOpen(s)) || (f === '24' && s.h === '24') || (f === 'jan' && s.k === 'Jan')));
        list = list.map(s => Object.assign({ d: ref ? km(ref, s.p) : null }, s));
        if (ref) list.sort((a, b) => a.d - b.d);
        byId('storeGrid').innerHTML = list.length ? list.map(s => `
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div class="flex justify-between items-start gap-2">
                    <div><div class="text-sm font-bold text-slate-900">${esc(s.n)}</div><div class="text-[11px] text-slate-500"><i class="fa-solid fa-location-dot mr-1"></i>${esc(s.a)}, Goa${s.d != null ? ' &middot; ' + s.d.toFixed(1) + ' km away' : ''}</div></div>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${isOpen(s) ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-rose-100 text-rose-800 border-rose-200'}">${isOpen(s) ? 'Open now' : 'Closed'}</span>
                </div>
                <div class="text-[11px] text-slate-600"><i class="fa-regular fa-clock mr-1"></i>${hrs(s)}</div>
                <div class="flex flex-wrap gap-1">${s.s.map(x => `<span class="text-[10px] bg-teal-50 text-teal-800 border border-teal-200 rounded-full px-2 py-0.5">${esc(x)}</span>`).join('')}</div>
                <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.p[0]},${s.p[1]}" class="block text-center py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-bold"><i class="fa-solid fa-diamond-turn-right mr-1"></i>Directions</a>
            </div>`).join('') : '<div class="col-span-full p-8 text-center text-slate-400 text-xs border border-dashed border-slate-300 rounded-2xl">No stores match your search.</div>';
    };
    window.storeLocate = function () {
        if (!navigator.geolocation) { note('Location is not supported on this browser. Please choose your area instead.'); return; }
        note('Finding your location...');
        navigator.geolocation.getCurrentPosition(p => { ref = [p.coords.latitude, p.coords.longitude]; note(''); byId('storeArea').value = ''; renderStores(); },
            () => note('Could not get your location. Please allow location access or choose your area from the list.'), { timeout: 8000 });
    };
    window.storeAreaPick = function () { const v = byId('storeArea').value; ref = v ? AREAS[v] : null; note(''); renderStores(); };
    window.storeMapsSearch = function () {
        const u = ref ? 'https://www.google.com/maps/search/pharmacy/@' + ref[0] + ',' + ref[1] + ',14z' : 'https://www.google.com/maps/search/pharmacy+near+me';
        window.open(u, '_blank', 'noopener');
    };
    Object.keys(AREAS).forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; byId('storeArea').appendChild(o); });
    renderStores();

    // ---------- DDSSY / Insurance tabs ----------
    window.ddssyTab = function (t) {
        ['ddssy', 'health'].forEach(k => {
            byId('ins-pane-' + k).classList.toggle('hidden', k !== t);
            const b = byId('ins-tab-' + k);
            b.classList.toggle('bg-teal-600', k === t); b.classList.toggle('text-white', k === t);
            b.classList.toggle('text-slate-600', k !== t); b.classList.toggle('hover:bg-slate-100', k !== t);
        });
    };
    window.calcHealthIns = function () {
        const age = Math.min(80, Math.max(18, +byId('hiAge').value || 35)), sum = +byId('hiSum').value, who = +byId('hiWho').value;
        const base = age <= 25 ? 5500 : age <= 35 ? 7000 : age <= 45 ? 10000 : age <= 55 ? 15000 : age <= 65 ? 22000 : 32000;
        let p = base * Math.pow(sum / 5, 0.7) * who;
        if (byId('hiCI').checked) p *= 1.25;
        if (byId('hiMat').checked) p *= 1.2;
        if (byId('hiTop').checked) p *= 0.55;
        const r = byId('hiResult'); r.classList.remove('hidden');
        r.innerHTML = `<div class="font-bold text-sm">Estimated premium: ${inr(p * 0.85)} to ${inr(p * 1.15)} per year</div>
            <div>About ${inr(p / 12)} per month for a Rs ${sum} Lakh cover.</div>
            <div>${byId('hiTop').checked ? 'A super top-up works best alongside your DDSSY cover or a base policy.' : 'DDSSY covers eligible Goa residents at empaneled hospitals; private insurance adds choice of hospital and higher limits.'}</div>`;
    };
    })();
