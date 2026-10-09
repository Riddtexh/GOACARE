// Symptom triage: red / amber / green + the nearest facility that has the right bed free right now (from the server).
// Decision support only. The advice text is in i18n.js (a_*), the routing is GET /api/triage.
(function () {
    const STYLE = {
        red: { box: 'bg-rose-100 border-rose-300 text-rose-900', head: 'text-rose-800', icon: 'fa-triangle-exclamation' },
        amber: { box: 'bg-amber-100 border-amber-300 text-amber-900', head: 'text-amber-800', icon: 'fa-circle-exclamation' },
        green: { box: 'bg-emerald-100 border-emerald-300 text-emerald-900', head: 'text-emerald-800', icon: 'fa-circle-check' }
    };
    let last = null;   // { code, result } so the card can be re-drawn when the language changes

    // Plain keyword matching for the "describe it in your own words" box (works offline, also fed by voice input).
    const WORDS = {
        chest_pain: /chest|heart|seena|sine|chhati|छाती|सीने|सीना|छातीत|हृदय|हार्ट/i,
        stroke: /stroke|numb|paraly|face|slur|speech|लकवा|पक्षाघात|बधिर|सुन्न|तोंड|चेहरा/i,
        breath: /breath|breathing|asthma|saans|dam |श्वास|सांस|दम/i,
        maternity: /pregnan|labou?r|deliver|maternity|baby|प्रसव|प्रसूती|वेणा|गर्भ|डिलीवरी/i,
        trauma: /fractur|broke|bone|accident|injur|bleed|cut|fall|हड्डी|हाड|चोट|दुखापत|इजा|अपघात|खून|रक्त|रगत/i,
        fever: /fever|dengue|temperature|bukhar|buhar|ताप|बुखार|डेंग्यू|ज्वर/i,
        minor: /cough|cold|sneez|throat|mild|खांसी|खोकला|खोंक|सर्दी|जुकाम/i
    };
    window.matchSymptom = function (text) { for (const [code, rx] of Object.entries(WORDS)) if (rx.test(text)) return code; return null; };

    function mapLink(r) { return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(r.name + ', ' + r.address); }

    function facilityRow(r, bedType) {
        const free = r.freeBeds[bedType];
        return `<li class="p-3 bg-white/80 rounded-xl border border-white space-y-1">
            <div class="flex items-start justify-between gap-2">
                <span class="font-bold text-slate-900 text-xs">${esc(r.name)}</span>
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 whitespace-nowrap">${esc(t('trFree', { n: free }))} ${esc(t('bed_' + bedType))}</span>
            </div>
            <div class="text-[11px] text-slate-600">${r.distanceKm != null ? esc(t('trKm', { n: r.distanceKm })) + ' · ' : ''}${esc(t('d_' + r.district))} · ${esc(t('crowdLabel'))}: ${esc(t('cr_' + r.crowdLevel))}</div>
            <div class="text-[10px] ${r.staffVerified ? 'text-emerald-700' : 'text-amber-700'}">${esc(r.staffVerified ? t('trBedsStaff') : t('trBedsOld'))}</div>
            <div class="flex gap-2 pt-1">
                <a target="_blank" rel="noopener" href="${mapLink(r)}" class="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-[11px] font-bold"><i class="fa-solid fa-location-arrow mr-1" aria-hidden="true"></i>${esc(t('trDirections'))}</a>
                ${r.phoneVerified ? `<a href="tel:${esc(r.phone.replace(/[^+\d]/g, ''))}" class="px-3 py-1.5 bg-slate-100 text-slate-800 rounded-lg text-[11px] font-bold"><i class="fa-solid fa-phone mr-1" aria-hidden="true"></i>${esc(t('trCall'))} ${esc(r.phone)}</a>` : ''}
            </div>
        </li>`;
    }

    function draw() {
        const box = byId('triageResult');
        if (!last) return;
        const { code, result: r } = last;
        const s = STYLE[r.level];
        box.className = 'mt-4 p-4 rounded-xl border text-xs space-y-3 ' + s.box;
        box.innerHTML = `
            <div class="font-bold text-sm ${s.head}"><i class="fa-solid ${s.icon} mr-1" aria-hidden="true"></i>${esc(t('lvl_' + r.level))}</div>
            <div>${esc(t('a_' + code))}</div>
            ${r.call108 ? `<a href="tel:108" class="inline-flex items-center gap-2 px-4 py-2.5 bg-rose-600 text-white rounded-lg font-extrabold text-sm"><i class="fa-solid fa-phone-volume" aria-hidden="true"></i> ${esc(t('call108'))}</a>` : ''}
            <div class="space-y-2">
                <div class="font-bold">${esc(t('trNearest', { bed: t('bed_' + r.need) }))}</div>
                ${r.recommendations.length ? `<ul class="space-y-2">${r.recommendations.map(x => facilityRow(x, r.need)).join('')}</ul>` : `<div class="font-semibold">${esc(t('trNoBeds'))}</div>`}
                ${r.redirectedFromGmc && r.recommendations.length ? `<div class="text-[11px] font-semibold"><i class="fa-solid fa-route mr-1" aria-hidden="true"></i>${esc(t('trRerouted'))}</div>` : ''}
                ${!r.locationUsed ? `<div class="text-[11px]">${esc(t('trNoLoc'))} <button type="button" onclick="triageUseLocation()" class="underline font-bold">${esc(t('trUseLoc'))}</button></div>` : ''}
            </div>
            ${r.level !== 'red' && !r.call108 ? `<a href="tel:108" class="inline-block text-[11px] underline font-bold">${esc(t('call108'))}</a>` : ''}
            <div class="text-[10px] opacity-80 border-t border-black/10 pt-2">${esc(t('trDisclaimer'))}</div>`;
    }

    window.assessTriage = async function (code) {
        const box = byId('triageResult');
        box.classList.remove('hidden');
        box.className = 'mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600';
        box.textContent = t('trLoading');
        const loc = GC.loc || await getLocation();
        try {
            last = { code, result: await GoaAPI.triage(code, loc) };
            draw();
        } catch (e) {
            // No server: still give the safe, fixed advice.
            const level = ['chest_pain', 'stroke', 'breath', 'maternity'].includes(code) ? 'red' : code === 'minor' ? 'green' : 'amber';
            last = { code, result: { level, call108: level === 'red' && code !== 'maternity', need: 'general', recommendations: [], redirectedFromGmc: false, locationUsed: !!loc } };
            draw();
            box.insertAdjacentHTML('beforeend', `<div class="font-bold text-[11px] mt-2">${esc(t('trOffline'))}</div>`);
        }
        box.setAttribute('tabindex', '-1'); box.focus({ preventScroll: false });
    };
    window.triageUseLocation = async function () { await getLocation(true); if (last) assessTriage(last.code); };
    window.triageFromText = function () {
        const v = byId('triageText').value.trim();
        const code = matchSymptom(v);
        if (!code) { const b = byId('triageResult'); b.classList.remove('hidden'); b.className = 'mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700'; b.textContent = t('trNoMatch'); return; }
        assessTriage(code);
    };
    document.addEventListener('gc:lang', () => { if (last) draw(); });
})();
