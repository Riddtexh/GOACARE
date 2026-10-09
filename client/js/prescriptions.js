// Prescription photos: resized in the browser, stored on the server for this account only.
(function () {
    function render() {
        const grid = byId('rxGrid'), list = GC.data.prescriptions;
        grid.innerHTML = list.length ? list.map(p => `<div class="bg-white rounded-2xl border border-slate-200 overflow-hidden text-[11px]">
            <button type="button" onclick="viewRx('${esc(p.imgUrl)}')" class="block w-full aspect-[4/3] bg-slate-100" aria-label="View prescription from ${esc(p.doctor)}"><img src="${esc(p.imgUrl)}" alt="" loading="lazy" class="w-full h-full object-cover"></button>
            <div class="p-2"><div class="font-bold">${esc(p.doctor)}</div><div class="text-slate-500">${esc(fmtDate(p.date))}${p.note ? ' · ' + esc(p.note) : ''}</div><button onclick="deleteRx(${p.id})" class="text-rose-600 font-bold mt-1 no-print">Delete</button></div></div>`).join('')
            : '<div class="col-span-full text-xs text-slate-500 text-center py-6">No prescription photos yet.</div>';
    }
    window.renderPrescriptions = render;
    window.viewRx = url => { byId('rxViewImg').src = url; byId('rxViewModal').classList.remove('hidden'); };
    function toJpeg(file) {
        return new Promise((resolve, reject) => {
            const img = new Image(), url = URL.createObjectURL(file);
            img.onload = () => { const s = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.75)); };
            img.onerror = () => reject(new Error('That file is not a readable image.')); img.src = url;
        });
    }
    window.saveRx = async function () {
        const f = byId('rxFile').files[0];
        if (!f) return toast('Choose a photo first.', 'error');
        try {
            const r = await GoaAPI.addPrescription({ date: byId('rxDate').value, doctor: byId('rxDoctor').value, note: byId('rxNote').value, img: await toJpeg(f) });
            GC.data.prescriptions.unshift({ ...r.prescription, imgUrl: '/api/me/prescriptions/' + r.prescription.id + '/image' });
            byId('rxFile').value = ''; byId('rxDoctor').value = ''; byId('rxNote').value = ''; closeModal('rxModal'); render();
        } catch (e) { if (e.code === 'consent_required') byId('consentModal').classList.remove('hidden'); else toast(e.message, 'error'); }
    };
    window.deleteRx = async function (id) { if (!confirm('Delete this prescription photo?')) return; try { await GoaAPI.deletePrescription(id); GC.data.prescriptions = GC.data.prescriptions.filter(p => p.id !== id); render(); } catch (e) { toast(e.message, 'error'); } };
})();
