const { getTenantRuntime } = require('./tenants/registry');
const { buildLlmResponse, resolveLlm } = require('./llm/openai-agent');

// Detección simple de intención por palabras clave → entidad canónica.
// (Placeholder hasta enchufar un LLM con tool-calling en la Fase 4 del plan.)
// Palabras clave en forma ASCII (sin acentos); la pregunta se normaliza igual.
const ENTITY_KEYWORDS = [
  { entity: 'inventory', words: ['stock', 'inventario', 'inventory', 'existencias'] },
  { entity: 'invoices', words: ['factur', 'invoice'] },
  { entity: 'products', words: ['articulo', 'producto', 'product', 'referencia', 'prenda'] },
  { entity: 'customers', words: ['cliente', 'customer'] },
  { entity: 'orders', words: ['venta', 'pedido', 'order', 'ticket'] }
];

// Minúsculas + sin diacríticos, para que "artículos" case con "articulo".
function normalizeText(text = '') {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function inferEntity(question = '') {
  const q = normalizeText(question);
  for (const { entity, words } of ENTITY_KEYWORDS) {
    if (words.some((word) => q.includes(word))) return entity;
  }
  return 'orders';
}

// Respuesta clara cuando la IA está configurada pero su llamada falla (no degradar
// a palabras clave). Distingue el caso de CUOTA agotada (429) para dar un mensaje útil.
function llmUnavailableResponse(params, activeRuntime, err) {
  const msg = String(err && err.message || '');
  const quota = /quota|429|billing|insufficient|exceeded/i.test(msg);
  return {
    tenantId: params.tenantId,
    tenantName: params.tenant?.name || activeRuntime?.tenant?.name || 'cliente',
    text: quota
      ? 'El asistente de IA no está disponible ahora mismo: la cuenta de OpenAI ha agotado su cuota o crédito. Revisa el plan y la facturación en platform.openai.com; en cuanto haya crédito, volveré a responder con normalidad.'
      : 'El asistente de IA no está disponible ahora mismo por un problema temporal de conexión con OpenAI. Inténtalo de nuevo en unos minutos.',
    targetEntity: null,
    usedDataSource: null,
    sources: [],
    data: [],
    status: 'error',
    engine: 'llm_unavailable'
  };
}

/**
 * Punto de entrada del motor. Si hay un LLM configurado (OPENAI_API_KEY), lo usa
 * para interpretar CUALQUIER pregunta vía tool-calling. Si no, cae al motor por
 * palabras clave (fallback offline, sin coste), para que la app nunca se rompa.
 */
async function buildAgentResponse(params) {
  const activeRuntime = params.runtime || getTenantRuntime(params.tenantId) || getTenantRuntime('demo');
  const enriched = { ...params, runtime: activeRuntime };

  let response;
  let llmError = null;
  // ¿Hay IA disponible para este cliente? (su propia config, o la global del .env)
  const hasLlm = !!resolveLlm(activeRuntime);
  if (hasLlm) {
    try {
      response = await buildLlmResponse(enriched);
    } catch (err) {
      llmError = err;
      console.error('[agent] LLM falló:', err.message);
    }
  }
  if (!response) {
    if (llmError) {
      // La IA ESTÁ configurada pero la llamada falló (cuota/429, red, API caída…).
      // NO degradamos a palabras clave: ese motor da resultados sin sentido para
      // preguntas analíticas (volcaría la tabla cruda de pedidos con cifras absurdas).
      // Mejor un aviso claro de que la IA no está disponible ahora mismo.
      response = llmUnavailableResponse(params, activeRuntime, llmError);
    } else {
      // No hay clave de IA configurada: modo offline por palabras clave (a propósito).
      response = await buildKeywordResponse(enriched);
    }
  }

  // Flag de gráficos del tenant, para que el frontend decida si graficar.
  response.charts = !!(activeRuntime && activeRuntime.charts);
  return response;
}

/**
 * Motor por palabras clave (fallback): infiere la entidad y consulta el conector.
 * No interpreta lenguaje libre; es el modo sin LLM.
 */
async function buildKeywordResponse({ tenantId, question, tenant, prompt, runtime }) {
  const activeRuntime = runtime || getTenantRuntime(tenantId) || getTenantRuntime('demo');
  const tenantName = tenant?.name || activeRuntime?.tenant?.name || 'Sin nombre';

  const targetEntity = inferEntity(question || '');
  const mapping = activeRuntime.getMappingForTarget?.(targetEntity)
    || { source: targetEntity, target: targetEntity };
  const resource = mapping.source;

  const connector = await activeRuntime.getConnectorForResource?.(resource);
  if (!connector) {
    return {
      tenantId,
      tenantName,
      text: 'Este tenant no tiene ninguna fuente de datos configurada.',
      targetEntity,
      usedDataSource: null,
      prompt: prompt || activeRuntime?.prompt,
      data: [],
      status: 'no_source'
    };
  }

  // Si la entidad no está configurada para este origen, respondemos con lo que SÍ hay,
  // en vez de reventar con un error técnico.
  const available = (await connector.listResources?.()) || [];
  if (available.length && !available.includes(resource)) {
    const canonical = [...new Set((activeRuntime.mappings || []).map((m) => m.target))];
    return {
      tenantId,
      tenantName,
      text: `Todavía no tengo configurada la entidad "${mapping.target}" para ${tenantName}. `
        + `Ahora mismo puedo consultar: ${canonical.join(', ')}.`,
      targetEntity: mapping.target,
      usedDataSource: connector.name,
      prompt: prompt || activeRuntime?.prompt,
      data: [],
      status: 'unsupported_entity'
    };
  }

  let rows;
  try {
    rows = await connector.runQuery(resource);
  } catch (err) {
    return {
      tenantId,
      tenantName,
      text: `No se pudo consultar "${resource}" en ${connector.name}: ${err.message}`,
      targetEntity: mapping.target,
      usedDataSource: connector.name,
      prompt: prompt || activeRuntime?.prompt,
      data: [],
      status: 'source_error'
    };
  }

  const shaped = await Promise.all(
    rows.map((row) => connector.mapToCanonicalShape(row, mapping))
  );
  // Aplanamos para la tabla del frontend: { entity, ...campos canónicos }.
  const data = shaped.map((shape) => ({ entity: shape.entity, ...shape.data }));

  const text = `He interpretado tu consulta como una solicitud de "${mapping.target}". `
    + `Consulté el recurso "${resource}" en ${connector.name} y encontré ${data.length} registro(s).`;

  return {
    tenantId,
    tenantName,
    text,
    targetEntity: mapping.target,
    usedDataSource: connector.name,
    sources: [{ name: connector.name, kind: connector.kind }],
    prompt: prompt || activeRuntime?.prompt,
    data,
    status: 'ok',
    engine: 'keyword'
  };
}

module.exports = { buildAgentResponse, inferEntity };
