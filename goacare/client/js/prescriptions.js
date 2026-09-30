(function () {
    const KEY = 'goaCarePrescriptions';
    const byId = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pad = n => String(n).padStart(2, '0');
    const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    let rx = [];
    try { rx = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { rx = []; }
    let pending = null;

    function msg(t) { const m = byId('rxMsg'); m.innerText = t || ''; m.classList.toggle('hidden', !t); }

    function renderRx() {
        byId('rxCount').innerText = rx.length;
        const grid = byId('rxGrid');
        if (!rx.length) {
            grid.innerHTML = `<div class="col-span-full p-8 text-center text-slate-400 text-xs border border-dashed border-slate-300 rounded-2xl"><i class="fa-solid fa-file-prescription text-2xl mb-2 block"></i>No prescription images yet. Click 'Add Prescription Image' to add your first one.</div>`;
            return;
        }
        grid.innerHTML = rx.map(p => `
            <div class="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden flex flex-col">
                <button type="button" onclick="viewRx(${p.id})" class="block bg-white">
                    <img src="${p.img}" alt="Prescription" class="w-full h-36 object-cover hover:opacity-90 transition">
                </button>
                <div class="p-3 space-y-1 flex-1">
                    <div class="text-xs font-bold text-slate-900 leading-snug">${esc(p.doctor)}</div>
                    <div class="text-[11px] text-slate-500"><i class="fa-regular fa-calendar mr-1"></i>${fmtDate(p.date)}</div>
                    ${p.note ? `<div class="text-[11px] text-slate-600">${esc(p.note)}</div>` : ''}
                </div>
                <div class="px-3 pb-3 flex gap-2">
                    <button type="button" onclick="viewRx(${p.id})" class="flex-1 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-bold transition"><i class="fa-solid fa-expand mr-1"></i>View</button>
                    <button type="button" onclick="deleteRx(${p.id})" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-bold transition" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>`).join('');
    }

    function compress(img, max) {
        let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const s = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * s); h = Math.round(h * s);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
        x.drawImage(img, 0, 0, w, h);
        return c.toDataURL('image/jpeg', 0.78);
    }

    window.openRxModal = function () {
        pending = null; msg('');
        byId('rxForm').reset();
        byId('rxDate').value = todayISO();
        byId('rxPreviewWrap').classList.add('hidden');
        byId('rxModal').classList.remove('hidden');
    };
    window.closeRxModal = function () { byId('rxModal').classList.add('hidden'); };

    window.rxFileChosen = function (input) {
        const file = input.files && input.files[0];
        if (!file) return;
        msg('');
        if (!/^image\//.test(file.type)) { msg('Please choose an image file (JPG, PNG, etc.).'); input.value = ''; return; }
        if (file.size > 20 * 1024 * 1024) { msg('That image is too large. Please choose one under 20 MB.'); input.value = ''; return; }
        const reader = new FileReader();
        reader.onerror = () => msg('Could not read that file. Please try another image.');
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => msg('That file could not be opened as an image.');
            img.onload = () => {
                try {
                    pending = compress(img, 1400);
                    byId('rxPreview').src = pending;
                    byId('rxPreviewWrap').classList.remove('hidden');
                } catch (e) { msg('Could not process that image. Please try another one.'); }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
        input.value = '';
    };

    window.saveRx = function (e) {
        e.preventDefault();
        if (!pending) { msg('Please add a prescription photo first.'); return; }
        const entry = {
            id: Date.now(), date: byId('rxDate').value, doctor: byId('rxDoctor').value.trim(),
            note: byId('rxNote').value.trim(), img: pending
        };
        rx.unshift(entry);
        try {
            localStorage.setItem(KEY, JSON.stringify(rx));
        } catch (err) {
            rx.shift();
            msg('Browser storage is full. Delete an older prescription image and try again.');
            return;
        }
        pending = null;
        renderRx();
        closeRxModal();
    };

    window.deleteRx = function (id) {
        if (!confirm('Delete this prescription image?')) return;
        rx = rx.filter(p => p.id !== id);
        try { localStorage.setItem(KEY, JSON.stringify(rx)); } catch (e) {}
        renderRx();
    };

    window.viewRx = function (id) {
        const p = rx.find(x => x.id === id);
        if (!p) return;
        byId('rxViewTitle').innerText = p.doctor;
        byId('rxViewMeta').innerText = fmtDate(p.date) + (p.note ? ' · ' + p.note : '');
        byId('rxViewImg').src = p.img;
        byId('rxViewDownload').href = p.img;
        byId('rxViewModal').classList.remove('hidden');
    };
    window.closeRxView = function () { byId('rxViewModal').classList.add('hidden'); };

    window.addEventListener('load', renderRx);
})();
