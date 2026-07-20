const express = require('express');
const cors = require('cors');
const { buildAgentResponse } = require('./agent');
const { getTenantRuntime, listTenants } = require('./tenants/registry');
const onboarding = require('./onboarding/onboarding');
const auth = require('./auth');
const chatLog = require('./data/chat-log');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Wrapper para rutas async con manejo de errores homogéneo.
const wrap = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((err) =>
    res.status(400).json({ status: 'error', message: err.message })
  );
};

// --- Autenticación (contraseña única) ---

// ¿Hace falta login? (el frontend lo consulta al arrancar). Público.
app.get('/api/auth/status', (_req, res) => {
  res.json({ authRequired: auth.enabled() });
});

// Iniciar sesión con la contraseña compartida → devuelve un token. Público.
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!auth.checkPassword(password)) {
    return res.status(401).json({ status: 'error', message: 'Contraseña incorrecta.' });
  }
  res.json({ token: auth.issueToken() });
});

// A partir de aquí, /api/* exige token válido (salvo login y status, ya definidos
// arriba). El frontend estático y /health quedan públicos.
app.use(auth.middleware);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'AgenteDatos API', tenants: listTenants() });
});

app.get('/api/tenants', (_req, res) => {
  res.json({ tenants: listTenants() });
});

// --- Onboarding: conectar un origen desconocido y adaptarlo ---

// 1) Crear tenant vacío.
app.post('/api/tenants', wrap((req, res) => {
  const config = onboarding.createTenant(req.body || {});
  res.status(201).json(config);
}));

// Leer la config completa de un tenant (para el panel).
app.get('/api/tenants/:id', wrap((req, res) => {
  const config = onboarding.getTenant(req.params.id);
  if (!config) return res.status(404).json({ status: 'error', message: `Tenant no encontrado: ${req.params.id}` });
  res.json(config);
}));

// Actualizar prompt/guía, mappings o datos del tenant.
app.put('/api/tenants/:id', wrap((req, res) => {
  res.json(onboarding.updateTenant(req.params.id, req.body || {}));
}));

// "Aprender sobre la marcha": añadir una pista a la guía del cliente desde el chat.
app.post('/api/tenants/:id/hint', wrap((req, res) => {
  res.json(onboarding.appendHint(req.params.id, (req.body || {}).hint));
}));

// Guardar la API key del LLM del cliente (write-only; se almacena fuera del JSON/git).
app.post('/api/tenants/:id/llm-key', wrap((req, res) => {
  res.json(onboarding.setLlmKey(req.params.id, (req.body || {}).apiKey));
}));

// Descubrir TABLAS/recursos de un origen (SQL: tablas físicas reales; REST: recursos).
app.post('/api/onboarding/tables', wrap(async (req, res) => {
  const { patron, ...source } = req.body || {};
  res.json({ tablas: await onboarding.discoverTables(source, patron) });
}));

// Subir un archivo (Excel/CSV) y obtener su ruta en el servidor.
app.post('/api/onboarding/upload', wrap((req, res) => {
  const { filename, dataBase64 } = req.body || {};
  res.json(onboarding.saveUpload(filename, dataBase64));
}));

// Columnas reales de una tabla/recurso.
app.post('/api/onboarding/columns', wrap(async (req, res) => {
  const { tabla, ...source } = req.body || {};
  res.json({ columnas: await onboarding.describeTable(source, tabla) });
}));

// 2) Probar una config de origen SIN guardarla (¿conecta?).
app.post('/api/onboarding/test', wrap(async (req, res) => {
  res.json(await onboarding.testSource(req.body || {}));
}));

// 3) Descubrir el esquema del origen (tablas/endpoints + columnas).
app.post('/api/onboarding/discover', wrap(async (req, res) => {
  res.json(await onboarding.discoverSchema(req.body || {}));
}));

// 4) Descubrir + proponer mappings a entidades canónicas (para revisar).
app.post('/api/onboarding/suggest', wrap(async (req, res) => {
  res.json(await onboarding.suggestForSource(req.body || {}));
}));

// 5) Añadir el origen al tenant (persistente).
app.post('/api/tenants/:id/sources', wrap((req, res) => {
  res.status(201).json(onboarding.addSource(req.params.id, req.body || {}));
}));

// 5b) Editar un origen ya guardado (sin duplicar).
app.put('/api/tenants/:id/sources/:sourceId', wrap((req, res) => {
  res.json(onboarding.updateSource(req.params.id, req.params.sourceId, req.body || {}));
}));

// 5c) Borrar un origen del tenant.
app.delete('/api/tenants/:id/sources/:sourceId', wrap((req, res) => {
  res.json(onboarding.removeSource(req.params.id, req.params.sourceId));
}));

// 6) Guardar los mappings confirmados.
app.put('/api/tenants/:id/mappings', wrap((req, res) => {
  const mappings = onboarding.saveMappings(req.params.id, (req.body || {}).mappings);
  res.json({ mappings });
}));

// --- Agente ---

app.post('/api/agent/query', wrap(async (req, res) => {
  const { question, tenantId = 'demo', tenant, prompt, history, conversationId } = req.body || {};

  if (!question) {
    return res.status(400).json({ status: 'error', message: 'Falta el campo "question".' });
  }

  const runtime = getTenantRuntime(tenantId);
  if (!runtime) {
    return res.status(404).json({ status: 'error', message: `Tenant no encontrado: ${tenantId}` });
  }

  const t0 = Date.now();
  const response = await buildAgentResponse({
    tenantId,
    question,
    tenant: tenant || runtime.tenant,
    prompt,
    runtime,
    history
  });
  response.elapsedMs = Date.now() - t0; // tiempo de proceso en el servidor

  // Registrar la conversación para poder analizarla después (no bloquea la respuesta).
  chatLog.appendChat(tenantId, {
    conversationId: conversationId || null,
    question,
    answer: response.text || '',
    engine: response.engine || null,
    status: response.status || null,
    sources: (response.sources || []).map((s) => s.name),
    rows: Array.isArray(response.data) ? response.data.length : 0,
    elapsedMs: response.elapsedMs
  });

  res.json(response);
}));

// Exportar las conversaciones de un cliente en CSV (para analizarlas fuera).
app.get('/api/tenants/:id/chats.csv', wrap((req, res) => {
  const csv = chatLog.exportCsv(req.params.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chats-${req.params.id}.csv"`);
  res.send('﻿' + csv); // BOM para que Excel abra bien los acentos
}));

// Servir el frontend compilado (client/dist) DESDE EL MISMO ORIGEN que la API.
// Así todo se expone con un solo puerto (p. ej. `ngrok http 3001`), sin depender del
// proxy de Vite ni de rutas absolutas: las llamadas relativas /api funcionan directas.
const path = require('path');
const clientDist = path.join(__dirname, '..', 'client', 'dist');
// El index.html NUNCA se cachea (así el navegador siempre carga el JS más reciente,
// cuyo nombre lleva un hash). Los assets con hash sí pueden cachearse.
app.use(express.static(clientDist, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));
// Fallback SPA: cualquier ruta que NO sea /api ni /health devuelve el index.html.
app.get(/^\/(?!api\/|health\b).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Frontend no compilado. Ejecuta: npm run build');
  });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  const llmGlobal = process.env.OPENAI_API_KEY
    ? `${process.env.OPENAI_MODEL || 'gpt-4o'} @ ${process.env.OPENAI_BASE_URL || 'OpenAI'}`
    : 'sin clave global (cada cliente puede tener la suya; si no, modo palabras clave)';
  console.log(`LLM global (.env): ${llmGlobal}`);
  console.log(`Login: ${auth.enabled() ? 'ACTIVADO (APP_PASSWORD)' : 'desactivado (sin APP_PASSWORD)'}`);
});
