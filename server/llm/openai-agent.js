const OpenAI = require('openai');
const { buildToolDefinitions, runTool } = require('./tools');

// Máximo de rondas de tool-calling por pregunta (evita bucles infinitos).
const MAX_STEPS = 14;

// Proveedores de LLM soportados. Todos hablan la API de OpenAI (nativa o vía su
// endpoint compatible), así que sirve el mismo SDK: solo cambia baseURL y modelo.
const LLM_PROVIDERS = {
  openai: { baseUrl: null, defaultModel: 'gpt-4o' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', defaultModel: 'gemini-2.5-flash' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  deepseek: { baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  custom: { baseUrl: null, defaultModel: 'gpt-4o' }
};

// Config EFECTIVA de LLM. Devuelve:
//  - config usable { apiKey, baseURL, model, provider }
//  - { needsKey: true, provider } si el cliente eligió proveedor propio pero falta su key
//  - null si no hay ninguna (ni cliente ni .env) → sin IA (modo palabras clave)
function resolveLlm(runtime) {
  const t = (runtime && runtime.llm) || {};
  if (t.provider) {
    // El cliente eligió su propio proveedor: EXIGE su key (no mezclar con la global,
    // que sería otro proveedor y daría errores confusos como "cuota de OpenAI").
    if (!t.apiKey) return { needsKey: true, provider: t.provider };
    const p = LLM_PROVIDERS[t.provider] || {};
    const baseURL = (t.provider === 'custom' ? t.baseUrl : p.baseUrl) || undefined;
    return { apiKey: t.apiKey, baseURL, model: t.model || p.defaultModel || 'gpt-4o', provider: t.provider };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      provider: 'global'
    };
  }
  return null;
}

function systemPrompt(runtime, tenantName, prompt) {
  const t = runtime?.tenant || {};
  return [
    `Eres un agente de datos de negocio para el cliente "${tenantName}"${t.business ? ` (${t.business})` : ''}.`,
    prompt || runtime?.prompt || 'Responde como un agente de negocio.',
    `Hoy es ${new Date().toLocaleDateString('es-ES')}. La base de datos contiene datos reales y actualizados, incluido el año en curso.`,
    'Los datos están en la BASE DE DATOS del ERP, NO en tu memoria de entrenamiento. NUNCA te niegues a consultar un año, mes o fecha por tu "fecha de corte de conocimiento", ni digas que no tienes datos futuros o recientes: consulta SIEMPRE la base de datos con las herramientas para cualquier fecha, incluido el año en curso y años recientes.',
    'Respondes en español, de forma clara y concreta.',
    'Basas tus respuestas SOLO en los datos que obtienes con las herramientas: nunca inventes cifras.',
    'La tabla de datos (y el gráfico si aplica) se muestran al usuario aparte, automáticamente. Por eso tu TEXTO debe ser SOLO un resumen breve en prosa: el total, 2-3 valores/clientes destacados y una conclusión corta. NUNCA escribas tablas (ni en markdown con | y -), ni listados fila por fila, ni repitas todos los registros: eso ya está en la tabla.',
    'Si necesitas datos, decide qué herramienta usar. Puedes encadenar varias llamadas.',
    'CRÍTICO: NO anuncies lo que vas a hacer ni escribas frases de relleno como "vamos a ello", "déjame consultar", "un momento" o "ahora lo hago". Si la pregunta requiere datos, tu turno debe ser DIRECTAMENTE una llamada a herramienta (sin texto previo). Solo escribe prosa cuando YA tengas los datos y sea tu respuesta final.',
    'Para preguntas simples usa "consultar" con un recurso. Para agregados, filtros o preguntas nuevas usa "ejecutar_sql".',
    'IMPORTANTE: en ejecutar_sql, los nombres de recurso (inventory, products, customers, orders) NO son tablas reales; son etiquetas lógicas. Debes usar TABLAS REALES del ERP. Si no conoces la tabla o sus columnas, descúbrelas primero con listar_tablas(patron) y describir_tabla(tabla), y luego escribe el SQL.',
    'Es SQL Server / T-SQL: usa TOP en vez de LIMIT. Si un SQL falla (HTTP 400 o error), NO te rindas: corrige el nombre de tabla/columna o la sintaxis (descúbrelos) y reintenta con otra consulta.',
    'CONSISTENCIA: si la guía o el usuario definen reglas de filtrado o exclusión para un tema (p. ej. qué excluir en las ventas), aplícalas SIEMPRE en TODAS las consultas de ese tema — totales, desgloses por mes/cliente/familia, rankings y comparativas — nunca solo en algunas. Antes de dar una cifra agregada, comprueba que has aplicado esas exclusiones; si un total y su desglose no cuadran, revisa el filtro.',
    'EVITA FILAS DUPLICADAS: cuando cruces tablas que tienen varias filas por artículo/entidad (stock por talla/color/almacén, tarifas por talla, líneas de albarán…), AGRUPA con GROUP BY y usa agregados (SUM, MAX). Nunca devuelvas el producto cartesiano con la misma fila repetida muchas veces. Si el resultado tiene filas idénticas repetidas, es que falta agrupar: reescribe la consulta con GROUP BY.',
    'Para CONTAR totales ("¿cuántos X hay?") usa ejecutar_sql con COUNT(*): la herramienta consultar devuelve solo una muestra limitada y NO sirve para contar.',
    'Formatea los importes monetarios en formato europeo con el símbolo €: miles con punto y decimales con coma (ejemplo: 15.966,80 €).',
    'Usa siempre NOMBRES legibles (de cliente, producto, etc.) en lugar de códigos internos cuando estén disponibles; si mencionas una cuenta o entidad, usa su nombre, no su código.',
    'Cuando el usuario te ENSEÑE o CORRIJA algo reutilizable (dónde está un dato, cómo se relacionan tablas, una regla de negocio), usa la herramienta "recordar" para guardarlo y confírmaselo brevemente. Así no tendrá que repetírtelo.',
    runtime?.charts
      ? 'El cliente tiene activada la vista de tabla y gráfico: cuando la pregunta lo permita, además del total en el texto devuelve un DESGLOSE con VARIAS filas (por día, por categoría, por cliente, por marca…) para que la tabla y el gráfico sean informativos; evita devolver una sola fila con un único total.'
      : '',
    t.currency ? `Moneda del negocio: ${t.currency}.` : ''
  ]
    .filter(Boolean)
    .join(' ');
}

// Elimina tablas markdown del texto (el usuario ya ve la tabla de datos aparte).
function stripTables(text) {
  if (!text) return '';
  return String(text)
    .split('\n')
    .filter((line) => !/^\s*\|.*\|\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function buildLlmResponse({ tenantId, question, tenant, prompt, runtime, history }) {
  // Config de LLM del cliente (o la global del .env). Puede apuntar a OpenAI o a
  // cualquier proveedor COMPATIBLE (Gemini, Groq, DeepSeek…): mismo SDK, otra baseURL.
  const llm = resolveLlm(runtime);
  if (!llm || llm.needsKey) throw new Error('No hay ningún LLM utilizable (falta la API key del proveedor del cliente o la global del .env).');
  const client = new OpenAI({ apiKey: llm.apiKey, baseURL: llm.baseURL });
  const model = llm.model;
  const tenantName = tenant?.name || runtime?.tenant?.name || 'cliente';

  const tools = buildToolDefinitions(runtime);
  const messages = [{ role: 'system', content: systemPrompt(runtime, tenantName, prompt) }];
  // Memoria de conversación: últimos intercambios (texto) para que las preguntas
  // de seguimiento ("y agrupado por días?") mantengan el contexto anterior.
  (history || []).slice(-8).forEach((m) => {
    if (m && m.content) messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 4000) });
  });
  messages.push({ role: 'user', content: question });
  // `notas` = leyenda: criterios/periodos que usaron las herramientas (se muestra al usuario).
  const ctx = { collected: [], usedDataSource: null, sources: new Map(), learned: false, notas: new Set() };
  const sourcesList = () => [...ctx.sources].map(([name, kind]) => ({ name, kind }));

  // Algunos modelos (p. ej. Gemini) a veces "anuncian" que van a consultar y no
  // llaman a la herramienta. Si sueltan ese preámbulo sin datos, les insistimos.
  let nudges = 0;
  const looksLikePreamble = (txt) =>
    /(:\s*$|vamos a|voy a|d[eé]jame|un momento|enseguida|procedo|ahora (mismo|lo hago)|empecemos|manos a la obra)/i.test(String(txt || '').trim())
    && String(txt || '').trim().length < 500;

  for (let step = 0; step < MAX_STEPS; step++) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: 'auto'
    });
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // ¿Es un preámbulo ("vamos a ello") sin haber traído datos aún? Insiste una vez.
      if (ctx.collected.length === 0 && nudges < 2 && looksLikePreamble(msg.content)) {
        nudges++;
        messages.push({ role: 'user', content: 'No anuncies lo que vas a hacer: llama YA a las herramientas necesarias para obtener los datos y responde solo cuando los tengas.' });
        continue;
      }
      return {
        tenantId,
        tenantName,
        text: stripTables(msg.content || ''),
        targetEntity: null,
        usedDataSource: ctx.usedDataSource,
        sources: sourcesList(),
        notes: [...ctx.notas],
        learned: ctx.learned,
        prompt: prompt || runtime?.prompt,
        data: ctx.collected.slice(0, 100),
        status: 'ok',
        engine: 'llm'
      };
    }

    for (const call of msg.tool_calls) {
      let result;
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || '{}');
        result = await runTool(runtime, call.function.name, parsedArgs, ctx);
      } catch (err) {
        result = { error: err.message };
      }
      if (process.env.AGENT_DEBUG) {
        console.error(
          `[llm] step ${step} tool=${call.function.name} args=${JSON.stringify(parsedArgs)} -> ${
            result && result.error ? 'ERROR: ' + result.error : 'ok(' + (result.filas ?? '') + ')'
          }`
        );
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 8000)
      });
    }
  }

  return {
    tenantId,
    tenantName,
    text: 'No pude completar la consulta en el número de pasos disponible. Prueba a reformular la pregunta.',
    targetEntity: null,
    usedDataSource: ctx.usedDataSource,
    sources: sourcesList(),
    notes: [...ctx.notas],
    prompt: prompt || runtime?.prompt,
    data: ctx.collected.slice(0, 100),
    status: 'partial',
    engine: 'llm'
  };
}

module.exports = { buildLlmResponse, resolveLlm, LLM_PROVIDERS };
