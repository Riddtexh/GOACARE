'use strict';
// Minimal router: add('GET', '/api/facilities/:id/beds', handler). Handlers receive a context object.
const { httpError } = require('./http');

function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, rx, keys, handler });
  };
  const match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.rx.exec(pathname);
      if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { handler: r.handler, params }; }
    }
    return null;
  };
  return { add, match, routes };
}

const requireUser = ctx => { if (!ctx.user) throw httpError(401, 'Please sign in.'); return ctx.user; };
const requireRole = (ctx, ...roles) => {
  const u = requireUser(ctx);
  if (!roles.includes(u.role)) throw httpError(403, 'This action is for ' + roles.join(' / ') + ' accounts.');
  return u;
};
// Personal health data is only stored after the person has given consent.
const requireConsent = ctx => {
  const u = requireUser(ctx);
  if (!u.consentAt) throw httpError(403, 'Please accept the privacy consent before saving health data.', { code: 'consent_required' });
  return u;
};

module.exports = { createRouter, requireUser, requireRole, requireConsent };
