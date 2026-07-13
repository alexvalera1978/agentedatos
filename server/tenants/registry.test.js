const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

// Aislado: siembra un tenant propio en dir temporal (no depende de clientes reales).
const DIR = path.join(os.tmpdir(), 'agentedatos-test-registry');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.AGENTEDATOS_DATA_DIR = DIR;
fs.writeFileSync(path.join(DIR, 'acme.json'), JSON.stringify({
  tenant: { id: 'acme', name: 'ACME' },
  sources: [{ id: 'erp', kind: 'globalapi', name: 'ERP', config: {} }],
  mappings: [{ source: 'inventory', target: 'inventory' }],
  charts: true,
  prompt: 'x'
}));

const { getTenantRuntime, listTenants } = require('./registry');

test('listTenants incluye el tenant sembrado', () => {
  assert.ok(listTenants().some((t) => t.id === 'acme'));
});

test('getTenantRuntime construye runtime con conector, mapping y flag charts', () => {
  const runtime = getTenantRuntime('acme');
  assert.equal(runtime.tenant.name, 'ACME');
  assert.equal(runtime.getConnector('globalapi').kind, 'globalapi');
  assert.equal(runtime.getMappingForTarget('inventory').source, 'inventory');
  assert.equal(runtime.charts, true);
});

test('getTenantRuntime devuelve null para un tenant inexistente', () => {
  assert.equal(getTenantRuntime('no-existe'), null);
});
