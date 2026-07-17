const { test } = require('node:test');
const assert = require('node:assert');
const { resolveLlm } = require('./openai-agent');

test('resolveLlm usa la config del cliente (Gemini) cuando tiene proveedor y key', () => {
  const r = resolveLlm({ llm: { provider: 'gemini', apiKey: 'k-123', model: '' } });
  assert.strictEqual(r.apiKey, 'k-123');
  assert.strictEqual(r.baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai/');
  assert.strictEqual(r.model, 'gemini-2.0-flash'); // modelo por defecto del proveedor
});

test('resolveLlm respeta el modelo elegido y el baseUrl en "custom"', () => {
  const r = resolveLlm({ llm: { provider: 'custom', apiKey: 'k', model: 'mi-modelo', baseUrl: 'https://x/v1' } });
  assert.strictEqual(r.model, 'mi-modelo');
  assert.strictEqual(r.baseURL, 'https://x/v1');
});

test('resolveLlm cae a la config global (.env) si el cliente no tiene proveedor+key', () => {
  const prev = { k: process.env.OPENAI_API_KEY, m: process.env.OPENAI_MODEL, b: process.env.OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = 'env-key';
  process.env.OPENAI_MODEL = 'gpt-4o';
  delete process.env.OPENAI_BASE_URL;
  try {
    const r = resolveLlm({ llm: { provider: 'gemini' } }); // proveedor sin key -> global
    assert.strictEqual(r.apiKey, 'env-key');
    assert.strictEqual(r.baseURL, undefined);
  } finally {
    process.env.OPENAI_API_KEY = prev.k; process.env.OPENAI_MODEL = prev.m;
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
