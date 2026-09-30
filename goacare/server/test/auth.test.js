'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.GOACARE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-test-'));
const { createServer } = require('../server');

let server, base;
test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = (p, body, cookie) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body)
});
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];

test('serves the client', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /GoaCare/);
  assert.equal((await fetch(base + '/../server/db.js')).status === 200, false);
  assert.equal((await fetch(base + '/%2e%2e/server/db.js')).status === 200, false);
});

test('register -> me -> logout -> login', async () => {
  const reg = await post('/api/auth/register', { name: 'Asha  Naik', phone: '+91 98221 44832', password: 'secret1' });
  assert.equal(reg.status, 201);
  const user = (await reg.json()).user;
  assert.equal(user.name, 'Asha Naik');
  const c1 = cookieOf(reg);
  assert.match(reg.headers.get('set-cookie'), /HttpOnly/);

  const me = await fetch(base + '/api/auth/me', { headers: { Cookie: c1 } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.id, user.id);

  assert.equal((await post('/api/auth/logout', {}, c1)).status, 200);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Cookie: c1 } })).status, 401);

  // same account, written differently
  const login = await post('/api/auth/login', { phone: '+919822144832', password: 'secret1' });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.id, user.id);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { Cookie: cookieOf(login) } })).status, 200);
});

test('rejects bad input, duplicates and wrong passwords', async () => {
  assert.equal((await post('/api/auth/register', { name: 'A', phone: '12', password: 'x' })).status, 400);
  assert.equal((await post('/api/auth/register', { name: 'Asha Naik', phone: '9822144832', password: 'secret1' })).status, 201);
  assert.equal((await post('/api/auth/register', { name: 'Other', phone: '9822144832', password: 'secret2' })).status, 409);
  const bad = await post('/api/auth/login', { phone: '9822144832', password: 'wrong-one' });
  assert.equal(bad.status, 401);
  assert.equal((await post('/api/auth/login', { phone: 'nobody1234', password: 'whatever' })).status, 401);
  assert.equal((await fetch(base + '/api/auth/me')).status, 401);
});

test('refuses non-JSON posts and locks out repeated failures', async () => {
  const form = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'phone=1&password=2' });
  assert.equal(form.status, 415);
  await post('/api/auth/register', { name: 'Ravi Kamat', phone: 'GOA-8842-2026', password: 'goodpass' });
  let last;
  for (let i = 0; i < 9; i++) last = await post('/api/auth/login', { phone: 'goa88422026', password: 'nope' + i });
  assert.equal(last.status, 429);
  assert.equal((await post('/api/auth/login', { phone: 'goa88422026', password: 'goodpass' })).status, 429);
});

test('serves live hospital and doctor data, with ETag revalidation', async () => {
  const f = await fetch(base + '/api/facilities');
  assert.equal(f.status, 200);
  const facilities = (await f.json()).facilities;
  assert.ok(facilities.length >= 30);
  assert.equal(typeof facilities[0].icuBeds, 'number');
  assert.ok(Array.isArray(facilities[0].specialties));
  const d = (await (await fetch(base + '/api/doctors')).json()).doctors;
  assert.ok(d.length >= 20);
  assert.equal(d[0].id, 1);

  const etag = f.headers.get('etag');
  assert.equal((await fetch(base + '/api/facilities', { headers: { 'If-None-Match': etag } })).status, 304);

  // a change made through the admin layer shows up immediately, with a new ETag
  const db = require('../db');
  db.setBeds('gmc-bambolim', 1, 2, 3);
  const again = await fetch(base + '/api/facilities', { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 200);
  const gmc = (await again.json()).facilities.find(x => x.id === 'gmc-bambolim');
  assert.deepEqual([gmc.icuBeds, gmc.oxygenBeds, gmc.generalBeds], [1, 2, 3]);
  db.setDoctorStatus(1, 'In Surgery');
  assert.equal((await (await fetch(base + '/api/doctors')).json()).doctors[0].status, 'In Surgery');
});
