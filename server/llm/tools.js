// Herramientas GENÉRICAS que el LLM puede invocar. No dependen del negocio:
// el mismo conjunto sirve para cualquier tenant. Lo específico vive en la config.

// Solo permitimos SELECT de lectura. Bloqueamos escrituras y multi-sentencia.
function isReadOnlySelect(sql) {
  const s = String(sql || '').trim().replace(/;+\s*$/, '');
  if (!s) return false;
  if (s.includes(';')) return false; // nada de múltiples sentencias
  if (!/^\s*(select|with)\b/i.test(s)) return false;
  if (/\b(insert|update|delete|drop|alter|truncate|create|exec|execute|merge|grant|revoke|into|sp_|xp_)\b/i.test(s)) {
    return false;
  }
  return true;
}

function findSqlConnector(runtime) {
  return (runtime.connectors || []).find(
    (c) => typeof c.executeSql === 'function' && (c.configured ? c.configured() : true)
  );
}

function findSalesConnector(runtime) {
  return (runtime.connectors || []).find(
    (c) => typeof c.salesSummary === 'function' && (c.configured ? c.configured() : true)
  );
}

// Almacenes COMERCIALES activos (Central + tienda Claudio Coello). Los demás
// (000000, 001000, '100   '…) son internos y no representan mercancía real.
const ALMACENES_ACTIVOS = "'000100','000004'";

// Temporadas ACTIVAS según el ERP (campo ACTUAL de MAN_TEMPORADAS), en vez de una
// lista fija que se queda obsoleta cada campaña. ACTUAL puede venir como 'S'/'N',
// 1/0 o booleano según el ERP: lo tratamos como verdadero de forma flexible.
const ACTUAL_TRUE = /^(s|si|sí|1|y|yes|true|t)$/i;
async function getActiveSeasons(sql) {
  let rows = [];
  try { rows = await sql.executeSql('SELECT CODIGO, NOMBRE, ACTUAL FROM MAN_TEMPORADAS'); }
  catch { return []; }
  return (rows || [])
    .filter((r) => ACTUAL_TRUE.test(String(r.ACTUAL == null ? '' : r.ACTUAL).trim()))
    .map((r) => ({ codigo: String(r.CODIGO).trim(), nombre: String(r.NOMBRE || '').trim() }));
}

// Construye las definiciones de herramientas para la API de OpenAI, según lo que
// el tenant tenga configurado.
function buildToolDefinitions(runtime) {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'listar_recursos',
        description:
          'Lista las fuentes de datos del cliente y los recursos/entidades disponibles (p. ej. inventory, products, customers, orders). Úsala primero si no sabes qué datos hay.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    {
      type: 'function',
      function: {
        name: 'consultar',
        description:
          'Consulta un recurso/entidad ya configurado del cliente y devuelve sus filas. El "recurso" debe ser uno de los que devuelve listar_recursos.',
        parameters: {
          type: 'object',
          properties: {
            recurso: { type: 'string', description: 'Nombre del recurso a consultar' },
            limite: { type: 'integer', description: 'Máximo de filas a traer (opcional)' }
          },
          required: ['recurso'],
          additionalProperties: false
        }
      }
    }
  ];

  // El agente puede guardar pistas/correcciones duraderas que le enseñe el usuario.
  tools.push({
    type: 'function',
    function: {
      name: 'recordar',
      description:
        'Guarda una PISTA o CORRECCIÓN duradera sobre este cliente para futuras conversaciones: dónde está un dato, cómo se relacionan dos tablas, o una regla de negocio. Úsala cuando el usuario te ENSEÑE o CORRIJA algo reutilizable (ej.: "los precios están en la tabla X unida por Y", "excluye el cliente Z", "las camisas tienen TIPO_PRENDA=CAM"). NO la uses para datos concretos ni para una pregunta puntual.',
      parameters: {
        type: 'object',
        properties: { pista: { type: 'string', description: 'La pista concisa a recordar, en una frase.' } },
        required: ['pista'],
        additionalProperties: false
      }
    }
  });

  // Herramienta de conteo, solo si algún conector sabe contar (p. ej. Shopify /count.json).
  if ((runtime.connectors || []).some((c) => typeof c.count === 'function')) {
    tools.push({
      type: 'function',
      function: {
        name: 'contar',
        description:
          'Devuelve el número TOTAL de registros de un recurso (p. ej. cuántos pedidos, clientes o productos hay). Úsala para "¿cuántos X hay?" en lugar de traer todas las filas.',
        parameters: {
          type: 'object',
          properties: {
            recurso: { type: 'string', description: 'Nombre del recurso a contar' }
          },
          required: ['recurso'],
          additionalProperties: false
        }
      }
    });
  }

  // Ventas B2C desde Shopify (Orders), solo si hay una tienda Shopify configurada.
  if (findSalesConnector(runtime)) {
    tools.push({
      type: 'function',
      function: {
        name: 'ventas_shopify',
        description:
          'Calcula las VENTAS a cliente final (B2C) desde los pedidos (Orders) de Shopify, NO desde Analytics. Suma los canales de venta (Online Store "web" + POS + Draft Orders) y EXCLUYE el canal iF Returns (cambios). Úsala para ventas, ingresos, facturación, ticket medio y su evolución por día o mes. Las fechas son AAAA-MM-DD en hora de España (Europe/Madrid). Devuelve por grupo: pedidos, subtotal, impuestos y total (en euros).',
        parameters: {
          type: 'object',
          properties: {
            desde: { type: 'string', description: 'Fecha inicio AAAA-MM-DD (incluida), hora España' },
            hasta: { type: 'string', description: 'Fecha fin AAAA-MM-DD (incluida), hora España' },
            agrupar: { type: 'string', enum: ['dia', 'mes', 'canal', 'ninguno'], description: 'Cómo desglosar el resultado (por defecto ninguno = un único total)' },
            canal: { type: 'string', enum: ['ventas', 'cambios'], description: '"ventas" = venta facturable (por defecto); "cambios" = solo el canal iF Returns' }
          },
          required: ['desde', 'hasta'],
          additionalProperties: false
        }
      }
    });
    tools.push({
      type: 'function',
      function: {
        name: 'mejores_clientes_shopify',
        description:
          'Devuelve los MEJORES CLIENTES a cliente final (B2C) por gasto en un periodo, desde Shopify. Excluye automáticamente estilistas/cesiones (préstamos de prenda, no ventas reales) e informa de cuántos excluyó. Fechas AAAA-MM-DD en hora España.',
        parameters: {
          type: 'object',
          properties: {
            desde: { type: 'string', description: 'Fecha inicio AAAA-MM-DD (incluida)' },
            hasta: { type: 'string', description: 'Fecha fin AAAA-MM-DD (incluida)' },
            limite: { type: 'integer', description: 'Cuántos clientes devolver (por defecto 10)' }
          },
          required: ['desde', 'hasta'],
          additionalProperties: false
        }
      }
    });
    tools.push({
      type: 'function',
      function: {
        name: 'productos_mas_vendidos_shopify',
        description:
          'Devuelve las PRENDAS/PRODUCTOS más vendidos a cliente final (B2C) en un periodo, desde las líneas de los pedidos de Shopify. Ordena por unidades o por importe. Puede filtrar por temporada (prefijo del SKU, p. ej. "24"). Fechas AAAA-MM-DD en hora España.',
        parameters: {
          type: 'object',
          properties: {
            desde: { type: 'string', description: 'Fecha inicio AAAA-MM-DD (incluida)' },
            hasta: { type: 'string', description: 'Fecha fin AAAA-MM-DD (incluida)' },
            ordenar_por: { type: 'string', enum: ['unidades', 'importe'], description: 'Criterio de ranking (por defecto unidades)' },
            temporada: { type: 'string', description: 'Código de temporada para filtrar (opcional, p. ej. "24" o "25")' },
            limite: { type: 'integer', description: 'Cuántos productos devolver (por defecto 10)' }
          },
          required: ['desde', 'hasta'],
          additionalProperties: false
        }
      }
    });
  }

  // Margen real por producto: cruza Shopify (precio de venta real) × ERP (coste tarifa 10).
  // Solo si el cliente tiene AMBAS fuentes.
  if (findSalesConnector(runtime) && findSqlConnector(runtime)) {
    tools.push({
      type: 'function',
      function: {
        name: 'margen_productos',
        description:
          'Calcula el MARGEN REAL por producto cruzando el precio de venta real de Shopify (lo que paga el cliente, de las líneas de pedido) con el COSTE del ERP (tarifa "Venta Terceros Nacional", código 10). Úsala para "margen", "rentabilidad", "qué prendas dejan más margen". Este es el margen fiable (no uses el ERP solo). Fechas AAAA-MM-DD. Puede ordenar por margen/unidades/importe y filtrar por temporada.',
        parameters: {
          type: 'object',
          properties: {
            desde: { type: 'string', description: 'Fecha inicio AAAA-MM-DD (incluida)' },
            hasta: { type: 'string', description: 'Fecha fin AAAA-MM-DD (incluida)' },
            ordenar_por: { type: 'string', enum: ['margen', 'unidades', 'importe'], description: 'Criterio de ranking (por defecto margen)' },
            temporada: { type: 'string', description: 'Código de temporada para filtrar (opcional, p. ej. "24")' },
            limite: { type: 'integer', description: 'Cuántos productos devolver (por defecto 10)' }
          },
          required: ['desde', 'hasta'],
          additionalProperties: false
        }
      }
    });
    tools.push({
      type: 'function',
      function: {
        name: 'prevision_stock',
        description:
          'PREVISIÓN / COBERTURA DE STOCK: cruza el stock actual del ERP con la velocidad de venta de Shopify (unidades vendidas al día en los últimos meses) para estimar CUÁNTO DURARÁ la mercancía y si es SUFICIENTE hasta una fecha. Úsala para "¿para cuánto tengo?", "¿tengo suficiente de X para acabar el año?", "¿qué se me va a agotar?". Devuelve por artículo: stock, unidades/día, días de cobertura, y si llega hasta la fecha objetivo.',
        parameters: {
          type: 'object',
          properties: {
            articulo: { type: 'string', description: 'Código o nombre de un artículo concreto (opcional; si se omite, lista los artículos que antes se agotarán)' },
            temporada: { type: 'string', description: 'Código(s) de temporada, p. ej. "24" o "24,25" (opcional)' },
            hasta: { type: 'string', description: 'Fecha objetivo AAAA-MM-DD hasta la que se quiere cubrir (opcional; por defecto, fin del año en curso)' },
            dias_historico: { type: 'integer', description: 'Días recientes de ventas para calcular la velocidad (opcional, por defecto 90)' },
            historico_desde: { type: 'string', description: 'Inicio AAAA-MM-DD de un periodo de referencia CONCRETO para la velocidad (p. ej. la misma campaña del año pasado). Si se da junto con historico_hasta, se usa este periodo en vez de los últimos N días.' },
            historico_hasta: { type: 'string', description: 'Fin AAAA-MM-DD del periodo de referencia concreto para la velocidad.' },
            limite: { type: 'integer', description: 'Cuántos artículos devolver (por defecto 15)' }
          },
          additionalProperties: false
        }
      }
    });
  }

  if (findSqlConnector(runtime)) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'listar_tablas',
          description:
            'Descubre las TABLAS REALES de la base de datos del ERP (SQL Server). Devuelve nombres de tabla. Filtra con un patrón (p. ej. "STOCK", "CLIENTE", "ARTICUL", "PEDIDO"). Úsala antes de escribir SQL para saber el nombre real de las tablas.',
          parameters: {
            type: 'object',
            properties: {
              patron: { type: 'string', description: 'Texto que debe contener el nombre de la tabla (opcional)' }
            },
            additionalProperties: false
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'describir_tabla',
          description:
            'Devuelve las COLUMNAS reales (nombre y tipo) de una tabla del ERP. Úsala antes de escribir SQL con esa tabla para conocer sus columnas exactas.',
          parameters: {
            type: 'object',
            properties: {
              tabla: { type: 'string', description: 'Nombre real de la tabla (de listar_tablas)' }
            },
            required: ['tabla'],
            additionalProperties: false
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'ejecutar_sql',
          description:
            'Ejecuta una consulta SQL de SOLO LECTURA (SELECT) sobre la base de datos SQL Server del ERP y devuelve las filas. Úsala sobre TABLAS REALES (las de listar_tablas), NO sobre los nombres de recurso lógicos. Sintaxis T-SQL: usa TOP en vez de LIMIT. Prohibido modificar datos.',
          parameters: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'Consulta SELECT en T-SQL (SQL Server)' }
            },
            required: ['sql'],
            additionalProperties: false
          }
        }
      }
    );
  }

  // Coste y PVP de un artículo concreto (ERP + fallback de PVP a Shopify), si hay ERP.
  if (findSqlConnector(runtime)) {
    tools.push({
      type: 'function',
      function: {
        name: 'precio_producto',
        description:
          'Devuelve el COSTE y el PVP de un artículo (buscando por código o por nombre). El coste es la tarifa "Venta Terceros Nacional" del ERP; el PVP es la tarifa del ERP y, si el ERP no la tiene, el precio REAL de venta en Shopify. Úsala para "¿qué coste/PVP tiene [producto]?". Requiere que el usuario indique un producto concreto.',
        parameters: {
          type: 'object',
          properties: {
            articulo: { type: 'string', description: 'Código exacto o parte del nombre del artículo' }
          },
          required: ['articulo'],
          additionalProperties: false
        }
      }
    });
    tools.push({
      type: 'function',
      function: {
        name: 'temporadas',
        description:
          'Lista las TEMPORADAS del ERP (código y nombre) e indica cuáles están ACTIVAS ahora, según el campo ACTUAL de MAN_TEMPORADAS. Úsala para "¿cuáles son las temporadas activas?" y para saber qué temporadas incluir en el stock por defecto. NUNCA uses una lista fija de temporadas: cambian cada campaña.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    });
    tools.push({
      type: 'function',
      function: {
        name: 'stock_bajo_minimo',
        description:
          'Lista los ARTÍCULOS por debajo de su STOCK MÍNIMO: compara el stock actual del ERP (almacenes activos) con MAN_ARTICULOS.STOCK_MINIMO. Úsala para "¿qué artículos están bajo mínimo?", "¿qué tengo que reponer?". Puede filtrar por temporada.',
        parameters: {
          type: 'object',
          properties: {
            temporada: { type: 'string', description: 'Código(s) de temporada, p. ej. "24" o "24,25" (opcional; por defecto, todas)' },
            limite: { type: 'integer', description: 'Cuántos artículos devolver (por defecto 20)' }
          },
          additionalProperties: false
        }
      }
    });
  }

  return tools;
}

// Leyenda de la respuesta: cada herramienta ANOTA qué datos y criterios usó
// (periodo, tarifas, exclusiones…) y el frontend lo muestra bajo la respuesta.
// Así el usuario sabe en qué se basa la cifra sin tener que preguntarlo.
const fmtFecha = (s) => String(s || '').slice(0, 10).split('-').reverse().join('/');
function nota(ctx, texto) { if (ctx && ctx.notas) ctx.notas.add(texto); }

// Ejecuta una llamada a herramienta. `ctx` acumula filas obtenidas (para mostrarlas
// en el frontend) y registra la fuente usada.
async function runTool(runtime, name, args, ctx) {
  if (name === 'listar_recursos') {
    const fuentes = [];
    for (const c of runtime.connectors || []) {
      const recursos = (await c.listResources?.()) || [];
      fuentes.push({ fuente: c.name, tipo: c.kind, recursos });
    }
    return { fuentes, mappings: runtime.mappings || [] };
  }

  if (name === 'consultar') {
    const recurso = args.recurso;
    const connector = await runtime.getConnectorForResource?.(recurso);
    if (!connector) throw new Error(`No hay ninguna fuente con el recurso "${recurso}".`);
    const limit = Math.min(Number(args.limite) || 20, 100);
    const rows = await connector.runQuery(recurso, { limit });
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    ctx.usedDataSource = ctx.usedDataSource || connector.name;
    // Nos quedamos con el conjunto MÁS GRANDE (no mezclar total + desglose).
    const shaped = rows.slice(0, 100).map((r) => ({ entity: recurso, ...r }));
    if (shaped.length > ctx.collected.length) ctx.collected = shaped;
    return { recurso, filas: rows.length, muestra: rows.slice(0, 25) };
  }

  if (name === 'recordar') {
    const store = require('../data/store');
    const tid = runtime?.tenant?.id;
    const pista = String(args.pista || '').trim();
    if (!tid || !pista) throw new Error('No se pudo guardar la pista.');
    const config = store.getTenantConfigRaw(tid);
    if (config) {
      config.prompt = (config.prompt ? `${config.prompt.trim()}\n` : '') + pista;
      store.saveTenantConfig(config);
    }
    if (ctx) ctx.learned = true;
    return { guardado: true, pista };
  }

  if (name === 'contar') {
    const recurso = args.recurso;
    const connector = (runtime.connectors || []).find((c) => typeof c.count === 'function');
    if (!connector) throw new Error('Ninguna fuente de este cliente admite conteo directo.');
    const total = await connector.count(recurso);
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    ctx.usedDataSource = ctx.usedDataSource || connector.name;
    return { recurso, total };
  }

  if (name === 'ventas_shopify') {
    const connector = findSalesConnector(runtime);
    if (!connector) throw new Error('Este cliente no tiene una tienda Shopify conectada para ventas.');
    const gb = { dia: 'dia', mes: 'mes', canal: 'canal', ninguno: 'none' }[args.agrupar] || 'none';
    const summary = await connector.salesSummary({
      from: args.desde,
      to: args.hasta,
      groupBy: gb,
      channel: args.canal === 'cambios' ? 'cambios' : 'ventas'
    });
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    ctx.usedDataSource = ctx.usedDataSource || connector.name;
    nota(ctx, args.canal === 'cambios'
      ? `Cambios (canal iF Returns) de Shopify del ${fmtFecha(args.desde)} al ${fmtFecha(args.hasta)}.`
      : `Ventas B2C de Shopify (web + POS + pedidos manuales, sin cambios iF Returns) del ${fmtFecha(args.desde)} al ${fmtFecha(args.hasta)}.`);
    const arr = (summary.filas || []).slice(0, 100);
    if (arr.length > ctx.collected.length) ctx.collected = arr;
    return summary;
  }

  if (name === 'mejores_clientes_shopify') {
    const connector = findSalesConnector(runtime);
    if (!connector || typeof connector.topCustomers !== 'function') throw new Error('Este cliente no tiene una tienda Shopify conectada.');
    const summary = await connector.topCustomers({ from: args.desde, to: args.hasta, limit: Math.min(Number(args.limite) || 10, 50) });
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    ctx.usedDataSource = ctx.usedDataSource || connector.name;
    nota(ctx, `Mejores clientes por gasto en Shopify del ${fmtFecha(args.desde)} al ${fmtFecha(args.hasta)}; excluye estilistas/cesiones.`);
    const arr = summary.filas || [];
    if (arr.length > ctx.collected.length) ctx.collected = arr;
    return summary;
  }

  if (name === 'productos_mas_vendidos_shopify') {
    const connector = findSalesConnector(runtime);
    if (!connector || typeof connector.topProducts !== 'function') throw new Error('Este cliente no tiene una tienda Shopify conectada.');
    const summary = await connector.topProducts({
      from: args.desde,
      to: args.hasta,
      limit: Math.min(Number(args.limite) || 10, 50),
      by: args.ordenar_por === 'importe' ? 'importe' : 'unidades',
      temporada: args.temporada
    });
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    ctx.usedDataSource = ctx.usedDataSource || connector.name;
    nota(ctx, `Más vendidos según pedidos de Shopify del ${fmtFecha(args.desde)} al ${fmtFecha(args.hasta)}, por ${args.ordenar_por === 'importe' ? 'importe' : 'unidades'}${args.temporada ? `, temporada ${args.temporada}` : ''}.`);
    const arr = summary.filas || [];
    if (arr.length > ctx.collected.length) ctx.collected = arr;
    return summary;
  }

  if (name === 'margen_productos') {
    const shop = findSalesConnector(runtime);
    const sql = findSqlConnector(runtime);
    if (!shop || typeof shop.productSalesByArticle !== 'function') throw new Error('Este cliente no tiene Shopify para el precio de venta.');
    if (!sql) throw new Error('Este cliente no tiene ERP para el coste.');
    const ventas = await shop.productSalesByArticle({ from: args.desde, to: args.hasta, temporada: args.temporada });
    if (ctx.sources) { ctx.sources.set(shop.name, shop.kind); ctx.sources.set(sql.name, sql.kind); }
    ctx.usedDataSource = ctx.usedDataSource || shop.name;
    nota(ctx, `Margen = precio real de venta en Shopify del ${fmtFecha(args.desde)} al ${fmtFecha(args.hasta)} menos el coste del ERP (tarifa "Venta Terceros Nacional").`);
    if (!ventas.length) return { desde: args.desde, hasta: args.hasta, filas: [], nota: 'Sin ventas en el periodo.' };

    // Costes desde el ERP (tarifa 10 = Venta Terceros Nacional), en una sola consulta.
    const codes = [...new Set(ventas.map((v) => String(v.articulo).replace(/[^A-Za-z0-9]/g, '')).filter(Boolean))];
    const inList = codes.map((c) => `'${c}'`).join(',');
    const costeRows = await sql.executeSql(
      `SELECT ARTICULO, MAX(PRECIO) AS coste FROM MAN_ARTICULOS_TARIFAS WHERE TIPO='C' AND CODIGO='10' AND ARTICULO IN (${inList}) GROUP BY ARTICULO`
    );
    const costeMap = new Map((costeRows || []).map((r) => [String(r.ARTICULO), Number(r.coste)]));

    const r2 = (n) => Math.round(n * 100) / 100;
    const by = args.ordenar_por || 'margen';
    let filas = ventas.map((v) => {
      const coste = costeMap.get(String(v.articulo)) || 0;
      const pv = v.precio_medio;
      const ok = coste > 0 && pv > 0;
      return {
        producto: v.producto,
        unidades: v.unidades,
        precio_venta_medio: pv,
        coste: coste > 0 ? coste : null,
        margen: ok ? r2(pv - coste) : null,
        margen_pct: ok ? r2(((pv - coste) / pv) * 100) : null
      };
    });
    const sinCoste = filas.filter((f) => f.coste == null).length;
    filas.sort((a, b) => {
      if (by === 'unidades') return b.unidades - a.unidades;
      if (by === 'importe') return b.precio_venta_medio * b.unidades - a.precio_venta_medio * a.unidades;
      return (b.margen_pct ?? -1) - (a.margen_pct ?? -1); // margen: nulos al final
    });
    filas = filas.slice(0, Math.min(Number(args.limite) || 10, 50));
    if (filas.length > ctx.collected.length) ctx.collected = filas;
    return { desde: args.desde, hasta: args.hasta, temporada: args.temporada || null, ordenado_por: by, productos_sin_coste: sinCoste, filas };
  }

  if (name === 'precio_producto') {
    const sql = findSqlConnector(runtime);
    if (!sql) throw new Error('Este cliente no tiene ERP para consultar precios.');
    const raw = String(args.articulo || '').trim();
    if (!raw) throw new Error('Indica el artículo (código o nombre).');
    const code = raw.replace(/[^A-Za-z0-9]/g, '');
    // Búsqueda por PALABRAS, no por la frase exacta: el nombre de la web (Shopify) y la
    // DESCRIPCION del ERP no siempre coinciden (orden, palabras de más, acentos). Se
    // puntúa cuántas palabras casan y se tolera que UNA no cuadre.
    const words = [...new Set(raw.split(/\s+/).map((w) => w.replace(/'/g, "''")).filter((w) => w.length >= 3))].slice(0, 8);
    const score = words.length
      ? words.map((w) => `(CASE WHEN a.DESCRIPCION LIKE '%${w}%' THEN 1 ELSE 0 END)`).join('+')
      : '0';
    const minScore = Math.max(1, words.length - 1);
    const rows = await sql.executeSql(
      `SELECT TOP 8 * FROM (SELECT a.CODIGO, a.DESCRIPCION, `
      + `MAX(CASE WHEN t.CODIGO='10' THEN t.PRECIO END) AS coste, `
      + `MAX(CASE WHEN t.CODIGO='01' THEN t.PRECIO END) AS pvp_erp, `
      + `${score} AS score `
      + `FROM MAN_ARTICULOS a LEFT JOIN MAN_ARTICULOS_TARIFAS t ON t.ARTICULO=a.CODIGO AND t.TIPO='C' `
      + `GROUP BY a.CODIGO, a.DESCRIPCION) x `
      + `WHERE x.CODIGO='${code}'${words.length ? ` OR x.score >= ${minScore}` : ''} `
      + `ORDER BY CASE WHEN x.CODIGO='${code}' THEN 1 ELSE 0 END DESC, x.score DESC`
    );
    if (ctx.sources) ctx.sources.set(sql.name, sql.kind);
    ctx.usedDataSource = ctx.usedDataSource || sql.name;

    // Ventas recientes de Shopify: sirven de PVP real cuando el ERP no tiene tarifa PVP,
    // y de puente nombre de la web → código cuando el ERP no encuentra el nombre.
    const shop = findSalesConnector(runtime);
    let ventasShop = [];
    if (shop && typeof shop.productSalesByArticle === 'function') {
      const now = new Date(); const iso = (d) => d.toISOString().slice(0, 10);
      const to = iso(now); const f = new Date(now); f.setUTCDate(f.getUTCDate() - 120);
      ventasShop = await shop.productSalesByArticle({ from: iso(f), to });
      if (ctx.sources) ctx.sources.set(shop.name, shop.kind);
    }
    const shopMap = new Map(ventasShop.map((v) => [String(v.articulo), v]));
    const r2 = (n) => Math.round(n * 100) / 100;
    let filas = (rows || []).map((r) => {
      const pvpErp = Number(r.pvp_erp) || 0;
      const pvpShop = shopMap.get(String(r.CODIGO))?.precio_medio;
      const pvp = pvpErp > 0 ? pvpErp : (pvpShop != null ? pvpShop : null);
      return {
        producto: r.DESCRIPCION,
        articulo: r.CODIGO,
        coste: Number(r.coste) > 0 ? r2(Number(r.coste)) : null,
        pvp: pvp != null ? r2(pvp) : null,
        fuente_pvp: pvpErp > 0 ? 'ERP (tarifa)' : (pvpShop != null ? 'Shopify (precio real)' : 'sin dato')
      };
    });

    // El ERP no encontró el nombre: lo buscamos en los TÍTULOS de Shopify (el nombre que
    // ve el usuario en la web), sacamos su código de artículo y pedimos tarifas por código.
    if (!filas.length && ventasShop.length) {
      const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const nWords = raw.split(/\s+/).map(norm).filter((w) => w.length >= 3);
      const min = Math.max(1, nWords.length - 1);
      const hits = ventasShop
        .map((v) => ({ v, s: nWords.filter((w) => norm(v.producto).includes(w)).length }))
        .filter((h) => h.s >= min)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8);
      if (hits.length) {
        const inList = hits.map((h) => `'${String(h.v.articulo).replace(/[^A-Za-z0-9]/g, '')}'`).join(',');
        const tarifas = await sql.executeSql(
          `SELECT ARTICULO, MAX(CASE WHEN CODIGO='10' THEN PRECIO END) AS coste, `
          + `MAX(CASE WHEN CODIGO='01' THEN PRECIO END) AS pvp_erp `
          + `FROM MAN_ARTICULOS_TARIFAS WHERE TIPO='C' AND ARTICULO IN (${inList}) GROUP BY ARTICULO`
        );
        const tMap = new Map((tarifas || []).map((t) => [String(t.ARTICULO), t]));
        filas = hits.map(({ v }) => {
          const t = tMap.get(String(v.articulo).replace(/[^A-Za-z0-9]/g, '')) || {};
          const pvpErp = Number(t.pvp_erp) || 0;
          return {
            producto: v.producto,
            articulo: v.articulo,
            coste: Number(t.coste) > 0 ? r2(Number(t.coste)) : null,
            pvp: pvpErp > 0 ? r2(pvpErp) : (v.precio_medio != null ? r2(v.precio_medio) : null),
            fuente_pvp: pvpErp > 0 ? 'ERP (tarifa)' : (v.precio_medio != null ? 'Shopify (precio real)' : 'sin dato')
          };
        });
      }
    }
    nota(ctx, 'Coste = tarifa "Venta Terceros Nacional" del ERP; PVP = tarifa PVP del ERP o, si falta, precio real de venta en Shopify (últimos 120 días).');
    if (filas.length > ctx.collected.length) ctx.collected = filas;
    return { articulo_buscado: raw, filas };
  }

  if (name === 'temporadas') {
    const sql = findSqlConnector(runtime);
    if (!sql) throw new Error('Este cliente no tiene ERP para consultar temporadas.');
    const rows = await sql.executeSql('SELECT CODIGO, NOMBRE, ACTUAL, FECHA_INICIO FROM MAN_TEMPORADAS ORDER BY CODIGO');
    if (ctx.sources) ctx.sources.set(sql.name, sql.kind);
    ctx.usedDataSource = ctx.usedDataSource || sql.name;
    const filas = (rows || []).map((r) => ({
      codigo: String(r.CODIGO).trim(),
      temporada: String(r.NOMBRE || '').trim(),
      activa: ACTUAL_TRUE.test(String(r.ACTUAL == null ? '' : r.ACTUAL).trim()) ? 'sí' : 'no',
      inicio: r.FECHA_INICIO || null
    }));
    const activas = filas.filter((f) => f.activa === 'sí');
    nota(ctx, activas.length
      ? `Temporadas activas ahora (MAN_TEMPORADAS.ACTUAL): ${activas.map((a) => `${a.codigo} ${a.temporada}`).join(', ')}.`
      : 'Ninguna temporada aparece marcada como activa en MAN_TEMPORADAS.');
    if (filas.length > ctx.collected.length) ctx.collected = filas;
    return { filas, activas: activas.map((a) => ({ codigo: a.codigo, temporada: a.temporada })) };
  }

  if (name === 'stock_bajo_minimo') {
    const sql = findSqlConnector(runtime);
    if (!sql) throw new Error('Este cliente no tiene ERP para consultar stock.');
    const tFilter = args.temporada
      ? ` AND a.TEMPORADA IN (${String(args.temporada).split(',').map((t) => `'${t.replace(/[^A-Za-z0-9]/g, '')}'`).join(',')})`
      : '';
    const limite = Math.min(Number(args.limite) || 20, 100);
    const rows = await sql.executeSql(
      `SELECT TOP ${limite} a.CODIGO, a.DESCRIPCION, a.STOCK_MINIMO, ISNULL(s.stock,0) AS stock `
      + `FROM MAN_ARTICULOS a `
      + `LEFT JOIN (SELECT ARTICULO, SUM(ENTRADA-SALIDA) AS stock FROM ALM_STOCK WHERE ALMACEN IN (${ALMACENES_ACTIVOS}) GROUP BY ARTICULO) s ON s.ARTICULO = a.CODIGO `
      + `WHERE a.STOCK_MINIMO > 0 AND ISNULL(s.stock,0) < a.STOCK_MINIMO${tFilter} `
      + `ORDER BY (a.STOCK_MINIMO - ISNULL(s.stock,0)) DESC`
    );
    if (ctx.sources) ctx.sources.set(sql.name, sql.kind);
    ctx.usedDataSource = ctx.usedDataSource || sql.name;
    const filas = (rows || []).map((r) => ({
      producto: r.DESCRIPCION,
      articulo: String(r.CODIGO).trim(),
      stock: Number(r.stock) || 0,
      stock_minimo: Number(r.STOCK_MINIMO) || 0,
      faltan: Math.max(0, (Number(r.STOCK_MINIMO) || 0) - (Number(r.stock) || 0))
    }));
    nota(ctx, `Artículos con stock por debajo de su mínimo (MAN_ARTICULOS.STOCK_MINIMO) en los almacenes activos${args.temporada ? `, temporada ${args.temporada}` : ''}.`);
    if (filas.length > ctx.collected.length) ctx.collected = filas;
    return { filas };
  }

  if (name === 'prevision_stock') {
    const shop = findSalesConnector(runtime);
    const sql = findSqlConnector(runtime);
    if (!shop || typeof shop.productSalesByArticle !== 'function') throw new Error('Falta Shopify para la velocidad de venta.');
    if (!sql) throw new Error('Falta el ERP para el stock.');
    const now = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    // Base de la velocidad de venta: periodo de referencia explícito, o últimos N días.
    let from, to, dias;
    if (args.historico_desde && args.historico_hasta) {
      from = args.historico_desde; to = args.historico_hasta;
      dias = Math.max(1, Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1);
    } else {
      dias = Math.max(7, Math.min(Number(args.dias_historico) || 90, 365));
      to = iso(now);
      const fromD = new Date(now); fromD.setUTCDate(fromD.getUTCDate() - dias);
      from = iso(fromD);
    }
    const base = `venta media de ${from} a ${to} (${dias} días)`;

    // Velocidad de venta (Shopify) y stock (ERP).
    const ventas = await shop.productSalesByArticle({ from, to });
    const ventasMap = new Map(ventas.map((v) => [String(v.articulo), v]));
    // Filtro de temporada: si el usuario da una, la usa; si no (y no pide un artículo
    // concreto), se centra en las temporadas ACTIVAS del ERP, no en todo el stock viejo.
    let tFilter = '';
    let activasNota = '';
    if (args.temporada) {
      tFilter = ` AND TEMPORADA IN (${String(args.temporada).split(',').map((t) => `'${t.replace(/[^A-Za-z0-9]/g, '')}'`).join(',')})`;
    } else if (!args.articulo) {
      const act = await getActiveSeasons(sql);
      if (act.length) {
        tFilter = ` AND TEMPORADA IN (${act.map((a) => `'${a.codigo.replace(/[^A-Za-z0-9]/g, '')}'`).join(',')})`;
        activasNota = ` (temporadas activas: ${act.map((a) => a.nombre || a.codigo).join(', ')})`;
      }
    }
    const stockRows = await sql.executeSql(
      `SELECT ARTICULO, SUM(ENTRADA-SALIDA) AS stock FROM ALM_STOCK WHERE ALMACEN IN (${ALMACENES_ACTIVOS})${tFilter} GROUP BY ARTICULO HAVING SUM(ENTRADA-SALIDA) > 0`
    );
    if (ctx.sources) { ctx.sources.set(shop.name, shop.kind); ctx.sources.set(sql.name, sql.kind); }
    ctx.usedDataSource = ctx.usedDataSource || sql.name;

    const hasta = args.hasta || `${now.getUTCFullYear()}-12-31`;
    nota(ctx, `Previsión: stock actual del ERP × velocidad de venta de Shopify del ${fmtFecha(from)} al ${fmtFecha(to)} (${dias} días)${args.temporada ? `, temporada ${args.temporada}` : activasNota}; horizonte hasta el ${fmtFecha(hasta)}. Para usar otro periodo de referencia, pídelo (p. ej. "usando las ventas de la campaña pasada").`);
    const diasHasta = Math.max(0, Math.round((new Date(`${hasta}T00:00:00Z`) - now) / 86400000));
    const r1 = (n) => Math.round(n * 10) / 10;
    const filtro = args.articulo ? String(args.articulo).toLowerCase() : null;

    let filas = (stockRows || []).map((r) => {
      const art = String(r.ARTICULO);
      const v = ventasMap.get(art);
      const stock = Number(r.stock);
      const vendidos = v ? v.unidades : 0;
      const porDia = vendidos / dias;
      return {
        producto: v ? v.producto : art,
        articulo: art,
        stock,
        vendidos_ultimos_dias: vendidos,
        unidades_dia: r1(porDia),
        dias_cobertura: porDia > 0 ? Math.round(stock / porDia) : null,
        necesita_hasta: Math.round(porDia * diasHasta),
        suficiente: porDia > 0 ? (stock >= porDia * diasHasta ? 'sí' : 'no') : 'sin ventas'
      };
    });

    if (filtro) {
      // Búsqueda flexible: el nombre que dice el usuario ("blazer Manhattan") no
      // suele coincidir literal con el ERP/Shopify. Buscamos por palabras y, si nada
      // cuadra con todas, por la MÁS DISTINTIVA (la más larga: el nombre del modelo).
      const has = (f, w) => f.articulo.toLowerCase().includes(w) || String(f.producto).toLowerCase().includes(w);
      const words = filtro.split(/\s+/).filter((w) => w.length >= 3);
      let m = words.length ? filas.filter((f) => words.every((w) => has(f, w))) : [];
      if (!m.length && words.length) {
        const key = words.slice().sort((a, b) => b.length - a.length)[0];
        m = filas.filter((f) => has(f, key));
      }
      if (!m.length) m = filas.filter((f) => has(f, filtro)); // último recurso: término completo (código)
      filas = m;
    }
    else filas = filas.filter((f) => f.unidades_dia > 0); // en general: solo lo que se vende (riesgo de agotarse)
    filas.sort((a, b) => (a.dias_cobertura ?? 1e9) - (b.dias_cobertura ?? 1e9)); // lo que antes se agota, primero
    filas = filas.slice(0, Math.min(Number(args.limite) || 15, 50));

    if (filas.length > ctx.collected.length) ctx.collected = filas;
    return { base, historico_desde: from, historico_hasta: to, horizonte: hasta, dias_hasta: diasHasta, dias_historico: dias, filas };
  }

  if (name === 'listar_tablas') {
    const connector = findSqlConnector(runtime);
    if (!connector) throw new Error('Este cliente no tiene un ERP con acceso SQL.');
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    const p = String(args.patron || '').replace(/[^A-Za-z0-9_]/g, '');
    // sysobjects (vista legacy) NO está bloqueada; information_schema/sys.tables sí.
    const sql = `SELECT TOP 100 name FROM sysobjects WHERE xtype='U'${p ? ` AND name LIKE '%${p}%'` : ''} ORDER BY name`;
    const rows = await connector.executeSql(sql);
    return { tablas: (rows || []).map((r) => r.name) };
  }

  if (name === 'describir_tabla') {
    const connector = findSqlConnector(runtime);
    if (!connector) throw new Error('Este cliente no tiene un ERP con acceso SQL.');
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    const tabla = String(args.tabla || '').replace(/[^A-Za-z0-9_]/g, '');
    if (!tabla) throw new Error('Falta el nombre de la tabla.');
    // syscolumns (vista legacy) tampoco está bloqueada.
    const sql = `SELECT c.name, TYPE_NAME(c.xtype) AS tipo FROM syscolumns c WHERE c.id = OBJECT_ID('${tabla}') ORDER BY c.colid`;
    const rows = await connector.executeSql(sql);
    return { tabla, columnas: rows || [] };
  }

  if (name === 'ejecutar_sql') {
    if (!isReadOnlySelect(args.sql)) {
      throw new Error('Solo se permiten consultas SELECT de lectura (sin INSERT/UPDATE/DELETE/DROP ni ";").');
    }
    const connector = findSqlConnector(runtime);
    if (!connector) throw new Error('Este cliente no tiene un ERP con acceso SQL.');
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    const rows = await connector.executeSql(args.sql);
    if (ctx.sources) ctx.sources.set(connector.name, connector.kind);
    ctx.usedDataSource = ctx.usedDataSource || connector.name;
    const arr = Array.isArray(rows) ? rows.slice(0, 100) : [];
    if (arr.length > ctx.collected.length) ctx.collected = arr;
    return { filas: Array.isArray(rows) ? rows.length : 0, muestra: (rows || []).slice(0, 50) };
  }

  throw new Error(`Herramienta desconocida: ${name}`);
}

module.exports = { buildToolDefinitions, runTool, isReadOnlySelect, findSqlConnector };
