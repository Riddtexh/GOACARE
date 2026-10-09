// Service worker: makes GoaCare installable and keeps the emergency screen usable offline.
//  - app shell: cached on install
//  - Tailwind / Font Awesome CDN files: cached the first time they load (stale-while-revalidate)
//  - live data (/api/facilities, doctors, impact, crowd): network first, last copy used when offline
//  - everything else under /api (sign in, personal data): never cached
const VERSION = 'goacare-v3';
const SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/icons/icon.svg', '/css/base.css', '/css/features.css',
  '/js/tailwind-config.js', '/js/core.js', '/js/i18n.js', '/js/api.js', '/js/a11y.js', '/js/directory.js', '/js/triage.js', '/js/app.js',
  '/js/appointments.js', '/js/prescriptions.js', '/js/stores-insurance.js', '/js/staff.js', '/js/admin.js', '/js/auth.js'];
const LIVE = ['/api/facilities', '/api/doctors', '/api/impact', '/api/crowd'];

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) {
      if (!LIVE.some(p => url.pathname === p)) return;                       // personal data: network only
      e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; }).catch(() => caches.match(req)));
      return;
    }
    if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('/index.html').then(r => r || caches.match('/offline.html')))); return; }
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req)));
    return;
  }
  if (/cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(caches.open('goacare-cdn').then(c => c.match(req).then(hit => { const net = fetch(req).then(r => { c.put(req, r.clone()); return r; }).catch(() => hit); return hit || net; })));
  }
});
