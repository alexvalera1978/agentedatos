const test = require('node:test');
const assert = require('node:assert/strict');
const { GlobalApiConnector } = require('./globalapi-connector');

const CONFIG = {
  baseUrl: 'https://erp.example.com/globalapi',
  apiKey: 'SECRET',
  apiKeyHeader: 'X-Api-Key',
  queries: {
    inventory: 'SELECT ARTICULO, ENTRADA, SALIDA FROM ALM_STOCK',
    products: 'SELECT CODIGO, DESCRIPCION FROM MAN_ARTICULOS'
  }
};

// Reemplaza fetch por un stub que registra la llamada y devuelve filas canned.
function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

test('sin apiKey funciona en modo demo con la forma real de las tablas', async () => {
  const connector = new GlobalApiConnector({ kind: 'globalapi', name: 'ERP', config: { queries: CONFIG.queries } });
  assert.equal((await connector.testConnection()).ok, true);
  const rows = await connector.runQuery('inventory');
  assert.ok(rows.length > 0);
  assert.ok('ARTICULO' in rows[0]);
});

test('runQuery envía el SQL del recurso con la cabecera X-Api-Key correcta', async () => {
  let captured;
  const restore = stubFetch(async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => [{ ARTICULO: 'JO0001', ENTRADA: 10, SALIDA: 3 }] };
  });

  try {
    const connector = new GlobalApiConnector({ kind: 'globalapi', name: 'ERP SMTP2', config: CONFIG });
    const rows = await connector.runQuery('inventory');

    assert.equal(captured.url, 'https://erp.example.com/globalapi/api/Query/execute');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers['X-Api-Key'], 'SECRET');
    assert.equal(JSON.parse(captured.options.body).sql, CONFIG.queries.inventory);
    assert.equal(rows[0].ARTICULO, 'JO0001');
  } finally {
    restore();
  }
});

test('un error del gateway { error } se convierte en excepción', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => ({ error: "La tabla 'x' está bloqueada." }) }));
  try {
    const connector = new GlobalApiConnector({ kind: 'globalapi', name: 'ERP', config: CONFIG });
    await assert.rejects(() => connector.runQuery('products'), /bloqueada/);
  } finally {
    restore();
  }
});

test('describeResource infiere columnas reales muestreando una fila', async () => {
  const restore = stubFetch(async () => ({ ok: true, json: async () => [{ CODIGO: 'JO0001', DESCRIPCION: 'JACKET' }] }));
  try {
    const connector = new GlobalApiConnector({ kind: 'globalapi', name: 'ERP', config: CONFIG });
    const columns = await connector.describeResource('products');
    assert.deepEqual(columns.map((c) => c.name), ['CODIGO', 'DESCRIPCION']);
  } finally {
    restore();
  }
});
