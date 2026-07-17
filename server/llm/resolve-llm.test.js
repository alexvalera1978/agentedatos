const { test } = require('node:test');
const assert = require('node:assert');
const { resolveLlm } = require('./openai-agent');

test('resolveLlm usa la config del cliente (Gemini) cuando tiene proveedor y key', () => {
  const r = resolveLlm({ llm: { provider: 'gemini', apiKey: 'k-123', model: '' } });
  assert.strictEqual(r.apiKey, 'k-123');
  assert.strictEqual(r.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai/');
  assert.strictEqual(r.model, 'gemini-2.5-flash'); // modelo por defecto del proveedor
});

test('resolveLlm respeta el modelo elegido y el baseUrl en "custom"', () => {
  const r = resolveLlm({ llm: { provider: 'custom', apiKey: 'k', model: 'mi-modelo', baseUrl: 'https://x/v1' } });
  assert.strictEqual(r.model, 'mi-modelo');
  assert.strictEqual(r.baseURL, 'https://x/v1');
});

test('resolveLlm marca needsKey si el cliente eligió proveedor pero NO puso key (no usa la global)', () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'env-key'; // aunque haya global, no se debe usar con otro proveedor
  try {
    const r = resolveLlm({ llm: { provider: 'gemini' } });
    assert.deepStrictEqual(r, { needsKey: true, provider: 'gemini' });
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
  }
});

test('resolveLlm usa la global (.env) cuando el cliente NO eligió proveedor (provider vacío)', () => {
  const prev = { k: process.env.OPENAI_API_KEY, b: process.env.OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = 'env-key';
  delete process.env.OPENAI_BASE_URL;
  try {
    const r = resolveLlm({ llm: { provider: '' } });
    assert.strictEqual(r.apiKey, 'env-key');
    assert.strictEqual(r.provider, 'global');
  } finally {
    process.env.OPENAI_API_KEY = prev.k;
    if (prev.b === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = prev.b;
  }
});

test('resolveLlm devuelve null si no hay ni cliente ni .env', () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.strictEqual(resolveLlm({ llm: {} }), null);
    assert.strictEqual(resolveLlm({}), null);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prev;
  }
});
