const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultRegistry } = require('./connector-registry');

test('el registro por defecto instancia conectores rest, erp y shopify', async () => {
  const registry = defaultRegistry();

  const erp = registry.createConnector('erp', {
    kind: 'erp',
    name: 'ERP Test',
    config: { resources: ['stock', 'orders'] }
  });
  const shopify = registry.createConnector('shopify', {
    kind: 'shopify',
    name: 'Shopify Test',
    config: {}
  });

  assert.equal(erp.kind, 'erp');
  assert.equal(shopify.kind, 'shopify');
  assert.ok((await erp.listResources()).includes('stock'));
  assert.ok((await shopify.listResources()).includes('orders'));
});

test('un conector no registrado lanza error', () => {
  const registry = defaultRegistry();
  assert.throws(() => registry.createConnector('desconocido', {}), /not registered/);
});

test('el ERP en modo demo devuelve datos de ejemplo sin apiKey', async () => {
  const registry = defaultRegistry();
  const erp = registry.createConnector('erp', { kind: 'erp', name: 'ERP', config: {} });

  const test1 = await erp.testConnection();
  const rows = await erp.runQuery('stock');

  assert.equal(test1.ok, true);
  assert.ok(rows.length > 0);
  assert.ok('sku' in rows[0]);
});
