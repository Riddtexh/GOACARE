// GoaCare assistant widget: floating button + chat panel. Talks only to /api/chat (the Gemini key never reaches the browser).
(function () {
  'use strict';
  const STR = {
    en: { title: 'GoaCare Assistant', sub: 'Beds, doctors & help using GoaCare', open: 'Open GoaCare assistant', close: 'Close assistant', ph: 'Ask about hospitals, beds, doctors…', send: 'Send',
      hello: 'Hi! I can help you find a hospital bed, an available doctor, or use GoaCare. For a medical emergency, call 108 first.',
      note: 'Decision support, not medical advice.', call: 'Emergency? Call 108', err: 'Could not reach the assistant. Please check your connection and try again.',
      chips: [['Nearest ICU bed', 'Which hospital has an ICU bed free right now?'], ['Find a doctor', 'Which doctors are available today?'], ['Less crowded hospital', 'Which hospital is least crowded right now?'], ['I have chest pain', 'I have chest pain']] },
    hi: { title: 'GoaCare सहायक', sub: 'बिस्तर, डॉक्टर और GoaCare में मदद', open: 'GoaCare सहायक खोलें', close: 'सहायक बंद करें', ph: 'अस्पताल, बिस्तर, डॉक्टर के बारे में पूछें…', send: 'भेजें',
      hello: 'नमस्ते! मैं अस्पताल में बिस्तर, उपलब्ध डॉक्टर या GoaCare इस्तेमाल करने में मदद कर सकता हूँ। मेडिकल इमरजेंसी में पहले 108 पर कॉल करें।',
      note: 'यह निर्णय में सहायता है, चिकित्सा सलाह नहीं।', call: 'इमरजेंसी? 108 पर कॉल करें', err: 'सहायक से संपर्क नहीं हो पाया। कृपया कनेक्शन जाँचकर दोबारा कोशिश करें।',
      chips: [['नज़दीकी ICU बिस्तर', 'अभी किस अस्पताल में ICU बिस्तर खाली है?'], ['डॉक्टर खोजें', 'आज कौन से डॉक्टर उपलब्ध हैं?'], ['कम भीड़ वाला अस्पताल', 'अभी सबसे कम भीड़ किस अस्पताल में है?'], ['सीने में दर्द है', 'मुझे सीने में दर्द है']] }
  };
  const lang = () => { try { return (window.getLang && window.getLang()) || 'en'; } catch (e) { return 'en'; } };
  const S = () => STR[lang()] || STR.en;
  const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Tiny, safe formatter: escape first, then allow only **bold**, "- " / "* " bullets and line breaks.
  function format(text) {
    const lines = escHtml(text).split(/\r?\n/);
    let html = '', inList = false;
    lines.forEach(line => {
      const li = /^\s*[-*•]\s+(.*)$/.exec(line);
      const body = (li ? li[1] : line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + body + '</li>'; }
      else { if (inList) { html += '</ul>'; inList = false; } html += body.trim() ? '<p>' + body + '</p>' : ''; }
    });
    return html + (inList ? '</ul>' : '');
  }

  const history = [];           // {role:'user'|'assistant', content}
  let busy = false, built = false, els = {};

  function build() {
    if (built) return; built = true;
    const root = document.createElement('div');
    root.id = 'gcChat';
    root.className = 'no-print';
    root.innerHTML =
      '<button type="button" id="gcChatBtn" class="gcc-fab" aria-haspopup="dialog" aria-expanded="false"><i class="fa-solid fa-comment-medical" aria-hidden="true"></i><span class="sr-only"></span></button>' +
      '<section id="gcChatPanel" class="gcc-panel" role="dialog" aria-modal="false" aria-labelledby="gcChatTitle" hidden>' +
        '<header class="gcc-head"><div class="gcc-av" aria-hidden="true"><i class="fa-solid fa-user-doctor"></i></div><div class="gcc-ht"><strong id="gcChatTitle"></strong><span id="gcChatSub"></span></div>' +
        '<button type="button" id="gcChatClose" class="gcc-x"><i class="fa-solid fa-xmark" aria-hidden="true"></i><span class="sr-only"></span></button></header>' +
        '<div id="gcChatLog" class="gcc-log" role="log" aria-live="polite"></div>' +
        '<div id="gcChatChips" class="gcc-chips"></div>' +
        '<form id="gcChatForm" class="gcc-form" autocomplete="off"><input id="gcChatInput" type="text" maxlength="500"><button type="submit" id="gcChatSend" class="gcc-send"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span class="sr-only"></span></button></form>' +
        '<footer class="gcc-foot"><span id="gcChatNote"></span> <a id="gcChatCall" href="tel:108"></a></footer>' +
      '</section>';
    document.body.appendChild(root);
    ['Btn', 'Panel', 'Close', 'Log', 'Chips', 'Form', 'Input', 'Send', 'Title', 'Sub', 'Note', 'Call'].forEach(k => { els[k] = document.getElementById('gcChat' + k); });
    els.Btn.addEventListener('click', () => toggle());
    els.Close.addEventListener('click', () => toggle(false));
    els.Form.addEventListener('submit', e => { e.preventDefault(); ask(els.Input.value); });
    els.Panel.addEventListener('keydown', e => { if (e.key === 'Escape') { toggle(false); els.Btn.focus(); } });
    document.addEventListener('gc:lang', labels);
    labels();
    bubble('bot', S().hello);
  }

  function labels() {
    const s = S();
    els.Btn.querySelector('.sr-only').textContent = s.open; els.Btn.title = s.open;
    els.Title.textContent = s.title; els.Sub.textContent = s.sub;
    els.Close.querySelector('.sr-only').textContent = s.close;
    els.Input.placeholder = s.ph; els.Input.setAttribute('aria-label', s.ph);
    els.Send.querySelector('.sr-only').textContent = s.send;
    els.Note.textContent = s.note; els.Call.textContent = s.call;
    els.Chips.innerHTML = '';
    s.chips.forEach(([label, q]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'gcc-chip'; b.textContent = label;
      b.addEventListener('click', () => ask(q)); els.Chips.appendChild(b);
    });
  }

  function toggle(force) {
    const open = typeof force === 'boolean' ? force : els.Panel.hidden;
    els.Panel.hidden = !open;
    els.Btn.setAttribute('aria-expanded', String(open));
    els.Btn.classList.toggle('gcc-hide-sm', open);
    if (open) setTimeout(() => els.Input.focus(), 50);
  }

  function bubble(who, text, kind) {
    const d = document.createElement('div');
    d.className = 'gcc-msg gcc-' + who + (kind ? ' gcc-' + kind : '');
    if (who === 'user') d.textContent = text; else d.innerHTML = format(text);
    els.Log.appendChild(d);
    els.Log.scrollTop = els.Log.scrollHeight;
    return d;
  }

  function setBusy(v) { busy = v; els.Send.disabled = v; els.Input.disabled = v; if (!v) els.Input.focus(); }

  async function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    els.Input.value = '';
    bubble('user', text);
    history.push({ role: 'user', content: text });
    setBusy(true);
    const typing = document.createElement('div');
    typing.className = 'gcc-msg gcc-bot gcc-typing'; typing.setAttribute('aria-label', '…'); typing.innerHTML = '<span></span><span></span><span></span>';
    els.Log.appendChild(typing); els.Log.scrollTop = els.Log.scrollHeight;
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-10) }) });
      const data = await r.json().catch(() => ({}));
      typing.remove();
      // Fixed emergency wording (sent by the server, not written by the AI) always comes first.
      if (data.emergency) bubble('bot', data.emergency, 'alert');
      if (r.ok && data.reply) { bubble('bot', data.reply); history.push({ role: 'assistant', content: data.reply }); }
      else { history.pop(); bubble('bot', data.error || S().err, 'error'); }
    } catch (e) {
      typing.remove(); history.pop(); bubble('bot', S().err, 'error');
    }
    setBusy(false);
  }

  function init() { build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
