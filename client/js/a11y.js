// Accessibility: text size, high contrast, voice input. Settings are remembered on this device.
(function () {
    const SIZES = [100, 112, 125, 140];
    let size = 0, contrast = false;
    try { size = Number(localStorage.getItem('gcTextSize')) || 0; contrast = localStorage.getItem('gcContrast') === '1'; } catch (e) { /* ignore */ }
    function apply() {
        document.documentElement.style.fontSize = SIZES[size] + '%';
        document.documentElement.classList.toggle('gc-contrast', contrast);
        const b = document.getElementById('contrastBtn'); if (b) b.setAttribute('aria-pressed', String(contrast));
        try { localStorage.setItem('gcTextSize', size); localStorage.setItem('gcContrast', contrast ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    window.a11yText = d => { size = Math.max(0, Math.min(SIZES.length - 1, size + d)); apply(); };
    window.a11yContrast = () => { contrast = !contrast; apply(); };
    apply(); document.addEventListener('DOMContentLoaded', apply);

    // Voice input (Web Speech API; works in Chrome/Edge/Android). Konkani has no speech model, so it falls back to Hindi.
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const LANG = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN', gom: 'hi-IN' };
    document.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-voice]'); if (!btn) return;
        if (!Rec) return toast('Voice input is not supported in this browser. Please type instead.', 'error');
        const input = document.getElementById(btn.dataset.voice), r = new Rec();
        r.lang = LANG[getLang()] || 'en-IN'; r.interimResults = false; r.maxAlternatives = 1;
        btn.classList.add('ring-2', 'ring-rose-500');
        r.onresult = e => { input.value = e.results[0][0].transcript; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('keyup')); if (btn.dataset.voiceSubmit && window[btn.dataset.voiceSubmit]) window[btn.dataset.voiceSubmit](); };
        r.onerror = () => toast('Could not hear that. Please try again.', 'error');
        r.onend = () => btn.classList.remove('ring-2', 'ring-rose-500');
        r.start();
    });

    // PWA install button
    let deferred = null;
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; const b = document.getElementById('installBtn'); if (b) b.classList.remove('hidden'); });
    window.installApp = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; document.getElementById('installBtn').classList.add('hidden'); };
})();
