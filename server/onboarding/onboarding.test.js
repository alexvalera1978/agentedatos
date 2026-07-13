const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');

// Aísla el store en un directorio temporal (node ejecuta cada archivo de test en su propio proceso).
const DATA_DIR = path.join(os.tmpdir(), 'agentedatos-test-onboarding');
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.AGENTEDATOS_DATA_DIR = DATA_DIR;

const onboarding = require('./onboarding');
const { getTenantRuntime } = require('../tenants/registry');
const { buildAgentResponse } = require('../agent');

test('onboarding end-to-end de un origen SQL con tablas desconocidas', async () => {
  // 1) crear tenant vacío
  onboarding.createTenant({ id: 'nuevo', name: 'Cliente Nuevo' });

  // 2) añadir un origen SQL (no conocemos sus tablas de antemano)
  const source = onboarding.addSource('nuevo', {
    kind: 'sql',
    name: 'BD Cliente',
    config: { useSampleData: true }
  });
  assert.equal(source.kind, 'sql');

  // 3) probar conexión
  assert.equal((await onboarding.testSource(source)).ok, true);

  // 4) descubrir esquema + proponer mappings
  const { schema, suggestions } = await onboarding.suggestForSource(source);
  assert.ok(schema.resources.map((r) => r.name).includes('ventas'));

  const ventas = suggestions.find((s) => s.source === 'ventas');
  assert.equal(ventas.target, 'orders');
  assert.equal(ventas.fields.importe, 'importe');
  assert.equal(ventas.fields.cliente, 'cliente');

  // 5) guardar los mappings confirmados
  onboarding.saveMappings(
    'nuevo',
    suggestions.map(({ source: s, target, fields }) => ({ source: s, target, fields }))
  );

  // 6) el agente ya responde para ese cliente, normalizado a entidades canónicas
  const runtime = getTenantRuntime('nuevo');
  const response = await buildAgentResponse({ tenantId: 'nuevo', question: 'Quiero ver las ventas', runtime });

  assert.equal(response.targetEntity, 'orders');
  assert.equal(response.data[0].entity, 'orders');
  assert.equal(response.data[0].importe, 1250);
  assert.equal(response.data[0].cliente, 'Ana');
});

test('createTenant no permite ids duplicados', () => {
  onboarding.createTenant({ id: 'dup', name: 'Dup' });
  assert.throws(() => onboarding.createTenant({ id: 'dup', name: 'Dup 2' }), /ya existe/);
});
