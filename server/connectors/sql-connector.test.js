const test = require('node:test');
const assert = require('node:assert/strict');
const { SqlConnector } = require('./sql-connector');

test('SqlConnector en modo demo conecta y descubre esquema (tablas + columnas)', async () => {
  const connector = new SqlConnector({ kind: 'sql', name: 'BD', config: { useSampleData: true } });

  const conn = await connector.testConnection();
  assert.equal(conn.ok, true);

  const schema = await connector.getSchema();
  const ventas = schema.resources.find((r) => r.name === 'ventas');
  assert.ok(ventas, 'debe descubrir la tabla ventas');
  assert.ok(ventas.columns.some((col) => col.name === 'importe'));
});

test('SqlConnector devuelve filas crudas del recurso descubierto', async () => {
  const connector = new SqlConnector({ kind: 'sql', name: 'BD', config: { useSampleData: true } });
  const rows = await connector.runQuery('ventas');
  assert.ok(rows.length > 0);
  assert.equal(rows[0].importe, 1250);
});
