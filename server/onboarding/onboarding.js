const { defaultRegistry } = require('../connectors/connector-registry');
const { suggestMappings } = require('../mapping/suggest');
const store = require('../data/store');

// Instancia un conector a partir de una config de origen, sin persistir nada.
// Sirve para PROBAR / DESCUBRIR un origen antes de guardarlo.
function instantiate(source) {
  return defaultRegistry().createConnector(source.kind, source);
}

async function testSource(source) {
  return instantiate(source).testConnection();
}

// Descubre el esquema del origen (tablas/endpoints + columnas). No hace falta
// conocer las tablas de antemano.
async function discoverSchema(source) {
  return instantiate(source).getSchema();
}

// Descubre el esquema y propone mappings a entidades canónicas para revisión.
async function suggestForSource(source) {
  const schema = await discoverSchema(source);
  return { schema, suggestions: suggestMappings(schema) };
}

function createTenant({ id, name, business = '', language = 'es', currency = 'EUR', prompt = 'Responde como un agente de negocio.' }) {
  if (!id || !name) throw new Error('Se requieren "id" y "name".');
  if (store.getTenantConfigRaw(id)) throw new Error(`El tenant "${id}" ya existe.`);
  return store.saveTenantConfig({
    tenant: { id, name, business, language, currency },
    sources: [],
    mappings: [],
    tools: [],
    prompt
  });
}

function addSource(tenantId, source) {
  const config = store.getTenantConfigRaw(tenantId);
  if (!config) throw new Error(`Tenant no encontrado: ${tenantId}`);
  if (!source?.kind) throw new Error('El origen requiere "kind".');
  const id = source.id || `${source.kind}-${config.sources.length + 1}`;
  const stored = { id, kind: source.kind, name: source.name || id, config: source.config || {} };
  config.sources.push(stored);
  store.saveTenantConfig(config);
  return stored;
}

// Actualiza un origen ya guardado (nombre / kind / config). Para editarlo sin duplicar.
function updateSource(tenantId, sourceId, patch = {}) {
  const config = store.getTenantConfigRaw(tenantId);
  if (!config) throw new Error(`Tenant no encontrado: ${tenantId}`);
  const src = (config.sources || []).find((s) => s.id === sourceId);
  if (!src) throw new Error(`Origen no encontrado: ${sourceId}`);
  if (patch.name !== undefined) src.name = patch.name;
  if (patch.kind !== undefined) src.kind = patch.kind;
  if (patch.config !== undefined) src.config = patch.config;
  store.saveTenantConfig(config);
  return src;
}

// Elimina un origen del tenant.
function removeSource(tenantId, sourceId) {
  const config = store.getTenantConfigRaw(tenantId);
  if (!config) throw new Error(`Tenant no encontrado: ${tenantId}`);
  const before = (config.sources || []).length;
  config.sources = (config.sources || []).filter((s) => s.id !== sourceId);
  if (config.sources.length === before) throw new Error(`Origen no encontrado: ${sourceId}`);
  store.saveTenantConfig(config);
  return { removed: sourceId, sources: config.sources };
}

// Guarda un archivo subido (Excel/CSV) en server/data/uploads y devuelve su ruta.
function saveUpload(filename, dataBase64) {
  const fs = require('fs');
  const path = require('path');
  const safe = path.basename(String(filename || 'archivo')).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') throw new Error('Nombre de archivo inválido.');
  const dir = path.join(__dirname, '..', 'data', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  const b64 = String(dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw new Error('Archivo vacío.');
  fs.writeFileSync(path.join(dir, safe), Buffer.from(b64, 'base64'));
  return { filePath: `server/data/uploads/${safe}` };
}

// Devuelve la config cruda del tenant (con ${VAR} sin resolver → sin secretos).
// Añade `llmKeySet` (¿hay API key de LLM guardada?) SIN devolver la clave.
function getTenant(tenantId) {
  const raw = store.getTenantConfigRaw(tenantId);
  if (!raw) return null;
  return { ...raw, llmKeySet: !!store.getTenantSecrets(tenantId).llmApiKey };
}

// Actualiza campos editables del tenant (prompt/guía, mappings, datos del tenant, LLM).
function updateTenant(tenantId, patch = {}) {
  const config = store.getTenantConfigRaw(tenantId);
  if (!config) throw new Error(`Tenant no encontrado: ${tenantId}`);
  if (patch.prompt !== undefined) config.prompt = patch.prompt;
  if (patch.mappings !== undefined) config.mappings = patch.mappings;
  if (patch.charts !== undefined) config.charts = patch.charts;
  if (patch.tenant) config.tenant = { ...config.tenant, ...patch.tenant };
  if (patch.llm !== undefined) {
    // Solo la parte NO secreta (proveedor/modelo/URL). La API key va aparte (setLlmKey).
    const l = patch.llm || {};
    config.llm = { provider: l.provider || '', model: l.model || '', baseUrl: l.baseUrl || '' };
  }
  store.saveTenantConfig(config);
  return getTenant(tenantId);
}

// Guarda (o borra, si viene vacía) la API key del LLM del cliente, FUERA del JSON
// (en el store de secretos gitignoreado). No se devuelve nunca al frontend.
function setLlmKey(tenantId, apiKey) {
  if (!store.getTenantConfigRaw(tenantId)) throw new Error(`Tenant no encontrado: ${tenantId}`);
  const key = String(apiKey || '').trim();
  store.saveTenantSecrets(tenantId, { llmApiKey: key });
  return { llmKeySet: !!key };
}

// Lista tablas/recursos del origen. Para SQL (con executeSql) introspecciona las
// TABLAS FÍSICAS reales (sysobjects); para el resto devuelve los recursos.
async function discoverTables(source, pattern) {
  const connector = instantiate(source);
  if (typeof connector.executeSql === 'function') {
    const p = String(pattern || '').replace(/[^A-Za-z0-9_]/g, '');
    const sql = `SELECT TOP 200 name FROM sysobjects WHERE xtype='U'${p ? ` AND name LIKE '%${p}%'` : ''} ORDER BY name`;
    const rows = await connector.executeSql(sql);
    return (rows || []).map((r) => r.name);
  }
  return (await connector.listResources?.()) || [];
}

// Columnas reales de una tabla/recurso.
async function describeTable(source, table) {
  const connector = instantiate(source);
  if (typeof connector.executeSql === 'function') {
    const t = String(table || '').replace(/[^A-Za-z0-9_]/g, '');
    if (!t) throw new Error('Falta el nombre de la tabla.');
    const sql = `SELECT c.name, TYPE_NAME(c.xtype) AS tipo FROM syscolumns c WHERE c.id = OBJECT_ID('${t}') ORDER BY c.colid`;
    return await connector.executeSql(sql);
  }
  const [row] = (await connector.sampleRows?.(table, 1)) || [];
  return Object.keys(row || {}).map((name) => ({ name, tipo: typeof row[name] }));
}

// "Aprender sobre la marcha": añade una pista a la guía del cliente (se acumula).
function appendHint(tenantId, hint) {
  const config = store.getTenantConfigRaw(tenantId);
  if (!config) throw new Error(`Tenant no encontrado: ${tenantId}`);
  const clean = String(hint || '').trim();
  if (!clean) throw new Error('La pista está vacía.');
  config.prompt = (config.prompt ? `${config.prompt.trim()}\n` : '') + clean;
  store.saveTenantConfig(config);
  return { prompt: config.prompt };
}

function saveMappings(tenantId, mappings) {
  const config = store.getTenantConfigRaw(tenantId);
  if (!config) throw new Error(`Tenant no encontrado: ${tenantId}`);
  if (!Array.isArray(mappings)) throw new Error('mappings debe ser un array.');
  config.mappings = mappings.map((m) => ({
    source: m.source,
    target: m.target,
    ...(m.fields ? { fields: m.fields } : {})
  }));
  store.saveTenantConfig(config);
  return config.mappings;
}

module.exports = {
  testSource,
  discoverSchema,
  suggestForSource,
  createTenant,
  addSource,
  updateSource,
  removeSource,
  saveMappings,
  getTenant,
  updateTenant,
  setLlmKey,
  discoverTables,
  describeTable,
  saveUpload,
  appendHint
};
