const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

// Test aislado: siembra su propio tenant en un dir temporal (no depende de los
// clientes reales, que el usuario puede borrar). Fuerza el motor por palabras clave.
const DIR = path.join(os.tmpdir(), 'agentedatos-test-agent');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.AGENTEDATOS_DATA_DIR = DIR;
delete process.env.OPENAI_API_KEY;
fs.writeFileSync(path.join(DIR, 'demo.json'), JSON.stringify({
  tenant: { id: 'demo', name: 'Demo' },
  sources: [{ id: 'shop', kind: 'shopify', name: 'Shop', config: { resources: ['orders', 'products', 'inventory', 'customers'] } }],
  mappings: [{ source: 'orders', target: 'orders' }, { source: 'inventory', target: 'inventory' }],
  prompt: 'demo'
}));

const { buildAgentResponse, inferEntity } = require('./agent');
const { getTenantRuntime } = require('./tenants/registry');

test('inferEntity mapea palabras clave a entidades canónicas', () => {
  assert.equal(inferEntity('¿Cuál es el stock?'), 'inventory');
  assert.equal(inferEntity('Quiero ver las ventas'), 'orders');
  assert.equal(inferEntity('lista de clientes'), 'customers');
});

test('el agente responde pasando por conector y mapping', async () => {
  const runtime = getTenantRuntime('demo');
  const response = await buildAgentResponse({ tenantId: 'demo', question: 'quiero ver las ventas', runtime });

  assert.equal(response.tenantName, 'Demo');
  assert.equal(response.targetEntity, 'orders');
  assert.equal(response.usedDataSource, 'Shop');
  assert.ok(response.data.length > 0);
  assert.equal(response.data[0].entity, 'orders');
});

test('el agente resuelve el tenant por id cuando no se pasa runtime', async () => {
  const response = await buildAgentResponse({ tenantId: 'demo', question: 'quiero ver las ventas' });
  assert.equal(response.tenantName, 'Demo');
  assert.equal(response.targetEntity, 'orders');
});
