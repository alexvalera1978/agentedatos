const test = require('node:test');
const assert = require('node:assert/strict');
const { ClientRuntime } = require('./client-runtime');
const { ErpConnector } = require('../connectors/erp-connector');

function buildRuntime() {
  return new ClientRuntime({
    tenant: { id: 'smtp2', name: 'SMTP2' },
    connectors: [new ErpConnector({ kind: 'erp', name: 'ERP SMTP2', config: {} })],
    mappings: [
      { source: 'stock', target: 'inventory' },
      { source: 'orders', target: 'orders' }
    ],
    tools: [{ name: 'erp_query_stock' }]
  });
}

test('ClientRuntime expone conectores, mappings (ambos sentidos) y herramientas', async () => {
  const runtime = buildRuntime();

  assert.equal(runtime.tenant.name, 'SMTP2');
  assert.equal(runtime.getConnector('erp').kind, 'erp');
  assert.equal(runtime.getMappingFor('stock').target, 'inventory');
  assert.equal(runtime.getMappingForTarget('inventory').source, 'stock');
  assert.ok(runtime.getToolNames().includes('erp_query_stock'));
});

test('getConnectorForResource elige el conector que declara el recurso', async () => {
  const runtime = buildRuntime();
  const connector = await runtime.getConnectorForResource('stock');
  assert.equal(connector.kind, 'erp');
});
