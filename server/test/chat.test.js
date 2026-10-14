'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.GOACARE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goacare-chat-'));
delete process.env.GEMINI_API_KEY;
const { createServer } = require('../server');

let server, base;
test.before(async () => { server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const chat = (messages, extra) => fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(extra || {}) }, body: JSON.stringify({ messages }) });

test('chat: rejects empty / malformed input', async () => {
  assert.equal((await chat([])).status, 400);
  assert.equal((await chat([{ role: 'assistant', content: 'hi' }])).status, 400);
});

test('chat: without an API key it says so, but red-flag wording is still returned', async () => {
  const r = await chat([{ role: 'user', content: 'I have chest pain and sweating' }]);
  assert.equal(r.status, 503);
  const b = await r.json();
  assert.match(b.emergency, /108/);
  const plain = await (await chat([{ role: 'user', content: 'which hospital has beds' }])).json();
  assert.equal(plain.emergency, null);
});

test('chat: with a key it sends public live data to Gemini and returns the reply; the key is never in the response', async () => {
  process.env.GEMINI_API_KEY = 'test-key-123';
  const realFetch = globalThis.fetch; let seen;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      seen = { url: String(url), opts };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Try **GMC**.' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
  try {
    const r = await chat([{ role: 'user', content: 'Which hospital has an ICU bed?' }], { 'X-Forwarded-For': '10.0.0.9' });
    const raw = await r.text();
    assert.equal(r.status, 200);
    assert.ok(!raw.includes('test-key-123'));
    assert.equal(JSON.parse(raw).reply, 'Try **GMC**.');
    assert.equal(seen.opts.headers['x-goog-api-key'], 'test-key-123');
    const sent = JSON.parse(seen.opts.body);
    assert.match(sent.systemInstruction.parts[0].text, /LIVE DATA/);
    assert.match(sent.systemInstruction.parts[0].text, /gmc-bambolim/);
    assert.ok(!/password|salt|token_hash|consent/i.test(sent.systemInstruction.parts[0].text.split('LIVE DATA')[1]), 'no account fields in the data block');
  } finally { globalThis.fetch = realFetch; }
});

test('chat: Gemini failure gives a friendly 502 and the per-visitor limit kicks in', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => String(url).includes('generativelanguage') ? new Response('boom', { status: 500 }) : realFetch(url, opts);
  try {
    const hdr = { 'X-Forwarded-For': '10.0.0.77' };
    const first = await chat([{ role: 'user', content: 'hello' }], hdr);
    assert.equal(first.status, 502);
    let last;
    for (let i = 0; i < 25; i++) last = await chat([{ role: 'user', content: 'hello' }], hdr);
    assert.equal(last.status, 429);
  } finally { globalThis.fetch = realFetch; delete process.env.GEMINI_API_KEY; }
});
