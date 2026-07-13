const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestMappings, matchEntity } = require('./suggest');

test('matchEntity reconoce sinónimos en varios idiomas', () => {
  assert.equal(matchEntity('ventas'), 'orders');
  assert.equal(matchEntity('stock'), 'inventory');
  assert.equal(matchEntity('facturas'), 'invoices');
  assert.equal(matchEntity('clientes'), 'customers');
  assert.equal(matchEntity('tabla_rara'), null);
});

test('suggestMappings propone entidad y campos con nivel de confianza', () => {
  const schema = {
    resources: [
      { name: 'ventas', columns: [{ name: 'id_venta' }, { name: 'cliente' }, { name: 'importe' }, { name: 'fecha' }] },
      { name: 'zzz_desconocida', columns: [{ name: 'foo' }] }
    ]
  };

  const result = suggestMappings(schema);

  const ventas = result.find((r) => r.source === 'ventas');
  assert.equal(ventas.target, 'orders');
  assert.equal(ventas.matched, true);
  assert.equal(ventas.confidence, 'alta');
  assert.equal(ventas.fields.importe, 'importe');
  assert.equal(ventas.fields.cliente, 'cliente');
  assert.equal(ventas.fields.id, 'id_venta');

  const unknown = result.find((r) => r.source === 'zzz_desconocida');
  assert.equal(unknown.matched, false);
  assert.equal(unknown.target, 'zzz_desconocida');
  assert.equal(unknown.confidence, 'baja');
});
