// Diagnóstico: ¿cómo se llama un artículo en el ERP y lo encuentra la previsión?
// Uso:  node scripts/buscar-articulo.js <palabra> [tenantId]
//   ej: node scripts/buscar-articulo.js manhattan
//       node scripts/buscar-articulo.js mahatan
const { getTenantRuntime } = require('../server/tenants/registry');
const { runTool } = require('../server/llm/tools');

(async () => {
  const kw = (process.argv[2] || '').trim();
  const tid = process.argv[3] || '1';
  if (!kw) { console.log('Uso: node scripts/buscar-articulo.js <palabra> [tenantId]'); return; }
  const rt = getTenantRuntime(tid);
  if (!rt) { console.log('Tenant no encontrado:', tid); return; }
  const sql = (rt.connectors || []).find((c) => typeof c.executeSql === 'function');
  if (!sql) { console.log('Este tenant no tiene ERP con SQL. ¿Lo ejecutas en producción (E:)?'); return; }
  const safe = kw.replace(/[^A-Za-z0-9 ]/g, '');

  console.log(`== ERP: artículos cuyo NOMBRE contiene "${kw}" ==`);
  let rows;
  try {
    rows = await sql.executeSql(
      `SELECT TOP 25 CODIGO, DESCRIPCION, TEMPORADA FROM MAN_ARTICULOS WHERE DESCRIPCION LIKE '%${safe}%'`
    );
  } catch (e) {
    console.log('  ERROR consultando el ERP:', e.message);
    if (/403/.test(e.message)) console.log('  (403 = sin acceso al ERP: ejecútalo en PRODUCCIÓN (E:), no en dev)');
    return;
  }
  if (rows && rows.length) rows.forEach((r) => console.log('  ', r.CODIGO, '|', r.DESCRIPCION, '| temp', r.TEMPORADA));
  else console.log('  (ninguno con ese texto exacto — puede estar escrito distinto)');

  console.log(`\n== prevision_stock(articulo="${kw}") con tus datos reales ==`);
  const ctx = { collected: [], sources: new Map(), notas: new Set() };
  try {
    const r = await runTool(rt, 'prevision_stock', { articulo: kw }, ctx);
    console.log('  filas encontradas:', r.filas.length);
    r.filas.slice(0, 10).forEach((f) => console.log('  -', f.producto, '| stock', f.stock, '| vendidos', f.vendidos_ultimos_dias, '| cobertura', f.dias_cobertura, 'días'));
    if (!r.filas.length) console.log('  (la previsión no encontró nada con esa palabra)');
  } catch (e) { console.log('  ERROR:', e.message); }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
