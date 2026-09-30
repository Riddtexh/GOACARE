(function () {
    const APPT_KEY = 'goaCareAppointments';
    const byId = id => document.getElementById(id);

    // ---------- helpers ----------
    const pad = n => String(n).padStart(2, '0');
    const isoFromDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const todayISO = () => isoFromDate(new Date());
    const addDaysISO = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoFromDate(d); };
    const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function fmt12(hhmm) {
        const [h, m] = hhmm.split(':').map(Number);
        return (h % 12 || 12) + ':' + pad(m) + ' ' + (h >= 12 ? 'PM' : 'AM');
    }
    const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    const nowHHMM = () => fromMin(nowMinutes());

    // ---------- providers (doctors + hospitals, reusing existing data) ----------
    function getProviders(type) {
        if (type === 'doctor') {
            return doctorsData.map((d, i) => ({
                key: 'd' + i, type: 'doctor', name: d.name, sub: d.spec, place: d.hospital + ' · ' + d.room,
                mapQuery: d.hospital + ', Goa', timings: d.timings, fee: d.fee, status: d.status
            }));
        }
        return facilitiesData.map(f => ({
            key: 'h:' + f.id, type: 'hospital', name: f.name, sub: f.careType + ' · ' + f.district, place: f.address,
            mapQuery: f.name + ', ' + f.address, timings: 'OPD 08:00 AM - 06:00 PM',
            fee: f.careType === 'Public' ? 'Free (Govt)' : 'DDSSY / Empaneled', careType: f.careType
        }));
    }
    const allProviders = () => getProviders('doctor').concat(getProviders('hospital'));
    const findProvider = key => allProviders().find(p => p.key === key);

    function parseTimings(t) {
        if (/24 hours/i.test(t)) return [0, 24 * 60];
        const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!m) return [8 * 60, 20 * 60];
        const conv = (h, mi, ap) => { h = (+h) % 12; if (ap.toUpperCase() === 'PM') h += 12; return h * 60 + (+mi); };
        return [conv(m[1], m[2], m[3]), conv(m[4], m[5], m[6])];
    }
    function slotsFor(p) {
        let [s, e] = parseTimings(p.timings);
        if (s === 0 && e === 24 * 60) { s = 8 * 60; e = 20 * 60; }
        const out = [];
        for (let t = s; t + 30 <= e; t += 30) out.push(fromMin(t));
        return out;
    }
    function isOpenNow(p) {
        const [s, e] = parseTimings(p.timings);
        const n = nowMinutes();
        return n >= s && n < e;
    }

    // ---------- crowd model ----------
    function hashStr(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
    function crowdPct(p, dateISO, hhmm) {
        const h = hashStr(p.key);
        let v = 38 + (h % 26);
        if (p.type === 'hospital') v += p.careType === 'Public' ? 14 : -8;
        else v += /Free/.test(p.fee) ? 8 : -6;
        const hf = toMin(hhmm) / 60;
        v += 24 * Math.exp(-Math.pow((hf - 10.5) / 2.2, 2)) + 10 * Math.exp(-Math.pow((hf - 17) / 1.5, 2)) - 14;
        const dow = new Date(dateISO + 'T00:00:00').getDay();
        v += dow === 1 ? 10 : dow === 6 ? -6 : dow === 0 ? -18 : 0;
        v += (hashStr(p.key + dateISO) % 15) - 7;
        if (dateISO === todayISO()) v += Math.sin(Date.now() / 240000 + (h % 20)) * 5;
        return Math.max(6, Math.min(98, Math.round(v)));
    }
    function crowdLevel(v) {
        if (v < 35) return { label: 'Low', bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500', text: 'text-emerald-700' };
        if (v < 60) return { label: 'Moderate', bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', text: 'text-amber-700' };
        if (v < 80) return { label: 'High', bar: 'bg-orange-500', chip: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', text: 'text-orange-700' };
        return { label: 'Very Crowded', bar: 'bg-rose-500', chip: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500', text: 'text-rose-700' };
    }
    const waitMin = v => Math.max(5, Math.round(v * 0.9 / 5) * 5);

    // ---------- storage ----------
    function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
    let appts = readJSON(APPT_KEY);
    const saveAppts = () => localStorage.setItem(APPT_KEY, JSON.stringify(appts));

    if (!appts) {
        let t = Math.ceil((nowMinutes() + 45) / 30) * 30;
        if (t < 9 * 60 || t > 12 * 60 + 30) t = 10 * 60 + 30;
        appts = [
            { id: Date.now() - 100000, key: 'd0', type: 'doctor', name: 'Dr. Amol Tilve', place: 'GMC Bambolim · OPD 12 (Cardio)', mapQuery: 'GMC Bambolim, Goa', date: todayISO(), time: fromMin(t), reason: 'Hypertension follow-up', status: 'Confirmed' },
            { id: Date.now() - 90000, key: 'h:asilo-mapusa', type: 'hospital', name: 'North Goa District Hospital (Asilo)', place: 'Peddem, Mapusa, Goa 403507', mapQuery: 'North Goa District Hospital (Asilo), Peddem, Mapusa, Goa 403507', date: addDaysISO(14), time: '10:00', reason: 'General check-up', status: 'Confirmed' }
        ];
        saveAppts();
    }
    // requests older than a few seconds are treated as answered by the provider
    appts.forEach(a => { if (a.status === 'Requested' && Date.now() - a.id > 4000) a.status = 'Confirmed'; });
    saveAppts();

    // ==========================================================
    //  APPOINTMENTS
    // ==========================================================
    const apptState = { type: 'doctor', providerKey: null, date: todayISO(), slot: null };
    const curProvider = () => findProvider(apptState.providerKey);

    function updateTypeButtons() {
        const on = 'bg-teal-600 text-white border-teal-600 shadow-sm';
        const off = 'bg-white text-slate-600 border-slate-300 hover:border-teal-400';
        byId('apptTypeDoctor').className = 'py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ' + (apptState.type === 'doctor' ? on : off);
        byId('apptTypeHospital').className = 'py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ' + (apptState.type === 'hospital' ? on : off);
        byId('apptProviderLabel').innerText = apptState.type === 'doctor' ? 'Select Doctor' : 'Select Hospital';
    }

    function renderProviderSelect() {
        const list = getProviders(apptState.type);
        if (!list.length) { apptState.providerKey = null; byId('apptProvider').innerHTML = ''; return; }   // server data not loaded yet
        if (!list.some(p => p.key === apptState.providerKey)) apptState.providerKey = list[0].key;
        byId('apptProvider').innerHTML = list.map(p =>
            `<option value="${esc(p.key)}" ${p.key === apptState.providerKey ? 'selected' : ''}>${esc(p.name)} — ${esc(p.sub)}</option>`).join('');
    }

    function slotState(p, date, t) {
        const today = todayISO();
        const past = date < today || (date === today && toMin(t) <= nowMinutes());
        const booked = appts.some(a => a.key === p.key && a.date === date && a.time === t && a.status !== 'Cancelled');
        return { past, booked };
    }

    function renderSlots() {
        const p = curProvider();
        const box = byId('apptSlots');
        if (!p) { box.innerHTML = ''; return; }
        const slots = slotsFor(p);
        box.innerHTML = slots.map(t => {
            const st = slotState(p, apptState.date, t);
            const pct = crowdPct(p, apptState.date, t);
            const lvl = crowdLevel(pct);
            const disabled = st.past || st.booked;
            let cls = 'bg-white border-slate-300 hover:border-teal-500 text-slate-700';
            if (apptState.slot === t) cls = 'bg-teal-600 border-teal-600 text-white shadow-sm';
            if (disabled) cls = 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed';
            return `<button type="button" ${disabled ? 'disabled' : ''} onclick="apptPickSlot('${t}')" class="px-1.5 py-1.5 rounded-lg border text-[11px] font-semibold text-center leading-tight transition ${cls}">
                <span class="block">${fmt12(t)}</span>
                <span class="flex items-center justify-center gap-1 text-[10px] font-medium">${st.booked ? 'Booked' : st.past ? 'Passed' : `<span class="w-1.5 h-1.5 rounded-full ${lvl.dot}"></span>${pct}%`}</span>
            </button>`;
        }).join('');
    }

    function renderCrowdPanel() {
        const p = curProvider();
        const el = byId('apptCrowdPanel');
        if (!p) { el.innerHTML = ''; return; }
        const date = apptState.date;
        const isToday = date === todayISO();
        const slots = slotsFor(p);
        let pct, headline, closed = false;
        if (isToday && isOpenNow(p)) {
            pct = crowdPct(p, date, nowHHMM());
            headline = 'Right now';
        } else if (isToday) {
            closed = true;
            pct = crowdPct(p, date, slots[0] || '09:00');
            headline = 'When OPD opens';
        } else {
            const vals = slots.map(t => crowdPct(p, date, t));
            pct = Math.round(vals.reduce((a, b) => a + b, 0) / (vals.length || 1));
            headline = 'Typical on ' + fmtDate(date);
        }
        const lvl = crowdLevel(pct);
        const avail = slots.filter(t => { const s = slotState(p, date, t); return !s.past && !s.booked; });
        let extra = '';
        if (avail.length) {
            const scored = avail.map(t => ({ t, v: crowdPct(p, date, t) }));
            const quiet = scored.reduce((a, b) => (b.v < a.v ? b : a));
            const busy = scored.reduce((a, b) => (b.v > a.v ? b : a));
            extra = `<div class="text-[11px] text-slate-500"><i class="fa-solid fa-leaf text-emerald-500 mr-1"></i>Quietest: <strong class="text-slate-700">${fmt12(quiet.t)}</strong> (${quiet.v}%) · Busiest: <strong class="text-slate-700">${fmt12(busy.t)}</strong> (${busy.v}%)</div>`;
        } else {
            extra = `<div class="text-[11px] text-amber-700 font-semibold"><i class="fa-solid fa-circle-info mr-1"></i>No free slots left on this date. Try another day.</div>`;
        }
        let sel = '';
        if (apptState.slot) {
            const sv = crowdPct(p, date, apptState.slot);
            const sl = crowdLevel(sv);
            sel = `<div class="text-[11px] font-semibold ${sl.text} border-t border-slate-200 pt-2"><i class="fa-solid fa-clock mr-1"></i>At ${fmt12(apptState.slot)}: ${sl.label} (${sv}% full) · est. wait ~${waitMin(sv)} min</div>`;
        }
        el.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Crowd · ${esc(headline)}</span>
                <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${closed ? 'bg-slate-200 text-slate-700' : lvl.chip}">${closed ? 'Closed now' : lvl.label}</span>
            </div>
            <div class="h-2.5 bg-slate-200 rounded-full overflow-hidden"><div class="h-full ${lvl.bar} transition-all" style="width:${pct}%"></div></div>
            <div class="flex justify-between text-[11px] text-slate-600"><span><strong>${pct}%</strong> full</span><span>Est. wait ~${waitMin(pct)} min</span></div>
            <div class="text-[11px] text-slate-500"><i class="fa-regular fa-clock mr-1"></i>OPD: ${esc(p.timings.replace(/^OPD\s*/, ''))} · Fee: ${esc(p.fee)}</div>
            ${extra}${sel}`;
    }

    function renderApptForm() {
        updateTypeButtons();
        renderProviderSelect();
        const di = byId('apptDate');
        di.min = todayISO();
        di.value = apptState.date;
        renderCrowdPanel();
        renderSlots();
    }

    window.apptSetType = function (t) { apptState.type = t; apptState.providerKey = null; apptState.slot = null; renderApptForm(); renderCrowdGrid(); };
    window.apptSelectProvider = function (key) { apptState.providerKey = key; apptState.slot = null; renderCrowdPanel(); renderSlots(); };
    window.apptPickDate = function (v) {
        if (!v || v < todayISO()) v = todayISO();
        apptState.date = v; apptState.slot = null; byId('apptDate').value = v; renderCrowdPanel(); renderSlots();
    };
    window.apptPickSlot = function (t) { apptState.slot = t; renderCrowdPanel(); renderSlots(); };

    function showApptMsg(html, ok) {
        const m = byId('apptMsg');
        m.className = 'text-xs font-semibold ' + (ok ? 'text-emerald-700' : 'text-rose-600');
        m.innerHTML = html;
    }

    window.apptSubmit = function () {
        const p = curProvider();
        if (!p) return showApptMsg('<i class="fa-solid fa-circle-exclamation mr-1"></i>Please choose a doctor or hospital.', false);
        if (!apptState.date || apptState.date < todayISO()) return showApptMsg('<i class="fa-solid fa-circle-exclamation mr-1"></i>Please choose today or a future date.', false);
        if (!apptState.slot) return showApptMsg('<i class="fa-solid fa-circle-exclamation mr-1"></i>Please pick a time slot.', false);
        const st = slotState(p, apptState.date, apptState.slot);
        if (st.past || st.booked) return showApptMsg('<i class="fa-solid fa-circle-exclamation mr-1"></i>That slot is no longer available. Please pick another.', false);

        const a = {
            id: Date.now(), key: p.key, type: p.type, name: p.name, place: p.place, mapQuery: p.mapQuery,
            date: apptState.date, time: apptState.slot,
            reason: byId('apptReason').value.trim() || 'General consultation', status: 'Requested'
        };
        appts.push(a);
        saveAppts();
        if (a.date === todayISO()) sessionStorage.setItem('gcApptSeen_' + a.id + '_' + a.date, '1');
        byId('apptReason').value = '';
        apptState.slot = null;
        showApptMsg('<i class="fa-solid fa-circle-check mr-1"></i>Request sent to ' + esc(p.name) + ' for ' + fmtDate(a.date) + ' at ' + fmt12(a.time) + '. Waiting for confirmation...', true);
        renderCrowdPanel(); renderSlots(); renderMyAppts(); updateNavDot();
        setTimeout(() => {
            const cur = appts.find(x => x.id === a.id);
            if (cur && cur.status === 'Requested') { cur.status = 'Confirmed'; saveAppts(); renderMyAppts(); }
        }, 3000);
    };

    window.apptCancel = function (id) {
        if (!confirm('Cancel this appointment?')) return;
        const a = appts.find(x => x.id === id);
        if (a) { a.status = 'Cancelled'; saveAppts(); }
        renderMyAppts(); renderSlots(); renderCrowdPanel(); updateNavDot();
    };

    window.apptQuickBook = function (key) {
        const p = findProvider(key);
        if (!p) return;
        apptState.type = p.type; apptState.providerKey = key; apptState.slot = null;
        renderApptForm();
        byId('apptFormCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    function statusChip(s) {
        const map = { Confirmed: 'bg-emerald-100 text-emerald-800', Requested: 'bg-amber-100 text-amber-800', Cancelled: 'bg-slate-200 text-slate-600' };
        return `<span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${map[s] || map.Requested}">${s}</span>`;
    }

    function apptCard(a, upcoming) {
        const p = findProvider(a.key);
        const isToday = a.date === todayISO() && a.status !== 'Cancelled';
        let crowd = '';
        if (p && upcoming && a.status !== 'Cancelled') {
            const v = crowdPct(p, a.date, a.time);
            const l = crowdLevel(v);
            crowd = `<span class="inline-flex items-center gap-1 text-[11px] font-semibold ${l.text}"><span class="w-1.5 h-1.5 rounded-full ${l.dot}"></span>Expected crowd: ${l.label} (${v}%) · ~${waitMin(v)} min wait</span>`;
        }
        const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.mapQuery || a.place)}`;
        return `
            <div class="p-4 rounded-2xl border ${isToday ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-slate-50'} space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="font-bold text-slate-900 text-sm">${esc(a.name)}</h4>
                            ${isToday ? '<span class="px-2 py-0.5 text-[10px] font-extrabold rounded-full bg-rose-500 text-white animate-pulse">TODAY</span>' : ''}
                        </div>
                        <p class="text-[11px] text-slate-500"><i class="fa-solid ${a.type === 'doctor' ? 'fa-user-doctor' : 'fa-hospital'} text-slate-400 mr-1"></i>${esc(a.place)}</p>
                    </div>
                    ${statusChip(a.status)}
                </div>
                <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700 font-semibold">
                    <span><i class="fa-regular fa-calendar text-teal-600 mr-1"></i>${fmtDate(a.date)}</span>
                    <span><i class="fa-regular fa-clock text-teal-600 mr-1"></i>${fmt12(a.time)}</span>
                </div>
                <p class="text-[11px] text-slate-500">Reason: ${esc(a.reason)}</p>
                ${crowd ? `<div>${crowd}</div>` : ''}
                ${upcoming && a.status !== 'Cancelled' ? `
                <div class="flex gap-2 pt-1">
                    <a href="${dir}" target="_blank" class="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition"><i class="fa-solid fa-location-arrow"></i> Directions</a>
                    <button onclick="apptCancel(${a.id})" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-bold transition"><i class="fa-solid fa-xmark mr-1"></i>Cancel</button>
                </div>` : ''}
            </div>`;
    }

    function renderMyAppts() {
        const today = todayISO();
        const sorted = appts.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
        const upcoming = sorted.filter(a => a.date >= today && a.status !== 'Cancelled');
        const rest = sorted.filter(a => !(a.date >= today && a.status !== 'Cancelled')).reverse();
        let html = '';
        if (!upcoming.length) html += `<div class="p-6 text-center text-slate-400 text-xs border border-dashed border-slate-300 rounded-2xl">No upcoming appointments. Use the form to request one.</div>`;
        else html += upcoming.map(a => apptCard(a, true)).join('');
        if (rest.length) {
            html += `<div class="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pt-2">Past & Cancelled</div>`;
            html += rest.map(a => apptCard(a, false)).join('');
        }
        byId('myAppointmentsList').innerHTML = html;
    }

    window.renderCrowdGrid = function () {
        const q = (byId('crowdSearch').value || '').toLowerCase().trim();
        const list = getProviders(apptState.type).filter(p =>
            !q || p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q) || p.place.toLowerCase().includes(q));
        const grid = byId('crowdGrid');
        if (!list.length) { grid.innerHTML = `<div class="col-span-full py-8 text-center text-slate-500 text-xs">Nothing matches your search.</div>`; return; }
        grid.innerHTML = list.map(p => {
            const open = isOpenNow(p);
            const pct = crowdPct(p, todayISO(), open ? nowHHMM() : (slotsFor(p)[0] || '09:00'));
            const lvl = crowdLevel(pct);
            const [s] = parseTimings(p.timings);
            return `
                <div class="p-4 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-white transition flex flex-col justify-between shadow-xs space-y-3">
                    <div class="space-y-1.5">
                        <div class="flex items-start justify-between gap-2">
                            <h4 class="font-bold text-slate-900 text-sm">${esc(p.name)}</h4>
                            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap ${open ? lvl.chip : 'bg-slate-200 text-slate-700'}">${open ? lvl.label : 'Closed now'}</span>
                        </div>
                        <p class="text-xs text-teal-700 font-extrabold"><i class="fa-solid ${p.type === 'doctor' ? 'fa-user-doctor' : 'fa-hospital'} mr-1"></i>${esc(p.sub)}</p>
                        <p class="text-xs text-slate-600"><i class="fa-solid fa-location-dot text-slate-400 mr-1"></i>${esc(p.place)}</p>
                        <p class="text-[11px] text-slate-500"><i class="fa-solid fa-clock text-slate-400 mr-1"></i>${esc(p.timings)}</p>
                    </div>
                    <div class="space-y-1">
                        <div class="h-2 bg-slate-200 rounded-full overflow-hidden"><div class="h-full ${open ? lvl.bar : 'bg-slate-400'} transition-all" style="width:${open ? pct : 0}%"></div></div>
                        <div class="flex justify-between text-[11px] text-slate-600">
                            ${open ? `<span><strong>${pct}%</strong> full</span><span>~${waitMin(pct)} min wait</span>` : `<span>OPD opens ${fmt12(fromMin(s))}</span><span>Usual crowd: ${pct}%</span>`}
                        </div>
                    </div>
                    <button onclick="apptQuickBook('${p.key}')" class="w-full py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition">
                        <i class="fa-solid fa-calendar-plus"></i> Request Appointment
                    </button>
                </div>`;
        }).join('');
    };

    function refreshAppointments() {
        renderApptForm();
        renderMyAppts();
        renderCrowdGrid();
        byId('crowdUpdated').innerText = fmt12(nowHHMM());
    }

    window.refreshAppointments = refreshAppointments;

    // ---------- appointment-day popup ----------
    let popupIds = [];
    function updateNavDot() {
        const has = appts.some(a => a.date === todayISO() && a.status !== 'Cancelled');
        byId('apptNavDot').classList.toggle('hidden', !has);
    }
    function countdownText(a) {
        const diff = toMin(a.time) - nowMinutes();
        if (diff > 60) return 'Starts in ' + Math.floor(diff / 60) + 'h ' + (diff % 60) + 'm';
        if (diff > 0) return 'Starts in ' + diff + ' min';
        if (diff > -30) return 'Starting now';
        return 'Scheduled time has passed';
    }
    function checkTodayPopup() {
        updateNavDot();
        const modal = byId('apptTodayModal');
        const authOpen = !byId('authModal').classList.contains('hidden');
        if (authOpen || !modal.classList.contains('hidden')) return;
        const pending = appts.filter(a => a.date === todayISO() && a.status !== 'Cancelled' && !sessionStorage.getItem('gcApptSeen_' + a.id + '_' + a.date))
                             .sort((a, b) => a.time.localeCompare(b.time));
        if (!pending.length) return;
        popupIds = pending.map(a => a.id + '_' + a.date);
        byId('apptTodayList').innerHTML = pending.map(a => {
            const p = findProvider(a.key);
            let crowd = '';
            if (p) { const v = crowdPct(p, a.date, a.time); const l = crowdLevel(v); crowd = `<div class="text-[11px] font-semibold ${l.text}"><span class="inline-block w-1.5 h-1.5 rounded-full ${l.dot} mr-1"></span>Expected crowd: ${l.label} (${v}%) · ~${waitMin(v)} min wait</div>`; }
            const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.mapQuery || a.place)}`;
            return `
                <div class="p-4 rounded-xl bg-teal-50 border border-teal-200 space-y-1.5">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-lg font-extrabold text-teal-800">${fmt12(a.time)}</span>
                        <span class="text-[11px] font-bold text-rose-600">${countdownText(a)}</span>
                    </div>
                    <div class="font-bold text-sm text-slate-900">${esc(a.name)}</div>
                    <div class="text-[11px] text-slate-600"><i class="fa-solid fa-location-dot text-slate-400 mr-1"></i>${esc(a.place)}</div>
                    <div class="text-[11px] text-slate-500">Reason: ${esc(a.reason)}</div>
                    ${crowd}
                    <a href="${dir}" target="_blank" class="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-bold"><i class="fa-solid fa-location-arrow"></i> Get Directions</a>
                </div>`;
        }).join('');
        modal.classList.remove('hidden');
    }
    window.apptDismissToday = function () {
        popupIds.forEach(k => sessionStorage.setItem('gcApptSeen_' + k, '1'));
        popupIds = [];
        byId('apptTodayModal').classList.add('hidden');
    };

    // ==========================================================
    //  WIRING (wraps existing functions, leaves originals intact)
    // ==========================================================
    const origSwitchTab = window.switchTab;
    window.switchTab = function (tabId) {
        origSwitchTab(tabId);
        ['appointments', 'stores'].forEach(t => {
            if (t !== tabId) {
                byId('section-' + t)?.classList.add('hidden');
                byId('tab-' + t)?.classList.remove('tab-active');
            }
        });
        if (tabId === 'appointments') refreshAppointments();
        if (tabId === 'stores' && window.renderStores) window.renderStores();
    };

    const extraI18n = {
        en: { appt: 'Appointments', store: 'Medical Stores Nearby' },
        gom: { appt: 'अपॉइंटमेंट', store: 'लागींचीं औशदां दुकानां' },
        hi: { appt: 'अपॉइंटमेंट', store: 'पास की दवा दुकानें' },
        mr: { appt: 'अपॉइंटमेंट', store: 'जवळची औषध दुकाने' }
    };
    const origChangeLanguage = window.changeLanguage;
    window.changeLanguage = function (lang) {
        origChangeLanguage(lang);
        const d = extraI18n[lang] || extraI18n.en;
        byId('nav-appt').innerText = d.appt;
        byId('nav-store').innerText = d.store;
    };

    window.addEventListener('load', function () {
        renderApptForm();
        renderMyAppts();
        renderCrowdGrid();
        byId('crowdUpdated').innerText = fmt12(nowHHMM());
        updateNavDot();
        setTimeout(checkTodayPopup, 600);
        setInterval(checkTodayPopup, 3000);
        setInterval(function () {
            byId('crowdUpdated').innerText = fmt12(nowHHMM());
            renderCrowdGrid();
            renderCrowdPanel();
        }, 20000);
    });
})();
