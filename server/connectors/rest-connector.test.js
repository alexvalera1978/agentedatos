const test = require('node:test');
const assert = require('node:assert/strict');
const { RestConnector } = require('./rest-connector');

test('resourceUrl usa endpoints personalizados o cae al recurso por defecto', () => {
  const connector = new RestConnector({
    name: 'API',
    config: { baseUrl: 'https://api.example.com/', endpoints: { orders: '/v1/orders' } }
  });

  assert.equal(connector.resourceUrl('orders'), 'https://api.example.com/v1/orders');
  assert.equal(connector.resourceUrl('stock'), 'https://api.example.com/stock');
});

test('mapToCanonicalShape renombra campos según el mapping y fija la entidad canónica', async () => {
  const connector = new RestConnector({ kind: 'rest', name: 'API', config: {} });

  const shape = await connector.mapToCanonicalShape(
    { total: 1250, client_id: 'C-1', created_at: '2026-06-28' },
    { source: 'transactions', target: 'orders', fields: { amount: 'total', customerId: 'client_id', date: 'created_at' } }
  );

  assert.equal(shape.entity, 'orders');
  assert.equal(shape.source, 'rest');
  assert.deepEqual(shape.data, { amount: 1250, customerId: 'C-1', date: '2026-06-28' });
});

test('testConnection falla de forma controlada si no hay baseUrl', async () => {
  const connector = new RestConnector({ name: 'API', config: {} });
  const result = await connector.testConnection();
  assert.equal(result.ok, false);
});
