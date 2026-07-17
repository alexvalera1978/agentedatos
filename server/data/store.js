const fs = require('fs');
const path = require('path');

// Store de configuraciones de tenant como DATOS (JSON), no como código.
// Así se puede dar de alta / editar un cliente en runtime (o vía API) sin redeploy.
// El directorio es configurable para poder aislarlo en tests.
function dir() {
  return process.env.AGENTEDATOS_DATA_DIR || path.join(__dirname, 'tenants');
}

function ensureDir() {
  fs.mkdirSync(dir(), { recursive: true });
}

function fileFor(id) {
  return path.join(dir(), `${id}.json`);
}

// Reemplaza ${VAR} por process.env.VAR (secretos fuera del JSON).
function resolveEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(resolveEnv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnv(v)]));
  }
  return value;
}

function readRaw(id) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

// Versión cruda (con ${VAR} intactos) — para MUTAR y volver a guardar.
function getTenantConfigRaw(id) {
  return readRaw(id);
}

// --- Secretos por cliente (API keys de LLM, etc.) ---
// Se guardan APARTE del JSON del tenant, en un fichero gitignoreado, para que las
// claves NO acaben en git (el JSON del tenant sí viaja por git en el despliegue).
function secretsFile() {
  return path.join(dir(), 'secrets.json');
}
function readSecrets() {
  try { return JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch { return {}; }
}
function getTenantSecrets(id) {
  return readSecrets()[id] || {};
}
function saveTenantSecrets(id, patch) {
  ensureDir();
  const all = readSecrets();
  all[id] = { ...(all[id] || {}), ...patch };
  fs.writeFileSync(secretsFile(), `${JSON.stringify(all, null, 2)}\n`);
  return all[id];
}

// Versión resuelta (secretos ya sustituidos) — para EJECUTAR en runtime.
function getTenantConfig(id) {
  const raw = readRaw(id);
  if (!raw) return null;
  const cfg = resolveEnv(raw);
  // Inyecta la API key del LLM (guardada aparte) en la config del LLM del tenant.
  const secrets = getTenantSecrets(id);
  if (secrets.llmApiKey) cfg.llm = { ...(cfg.llm || {}), apiKey: secrets.llmApiKey };
  return cfg;
}

function listTenantConfigs() {
  ensureDir();
  return fs.readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => resolveEnv(JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8'))));
}

function saveTenantConfig(config) {
  ensureDir();
  fs.writeFileSync(fileFor(config.tenant.id), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function deleteTenantConfig(id) {
  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getTenantConfig,
  getTenantConfigRaw,
  listTenantConfigs,
  saveTenantConfig,
  deleteTenantConfig,
  resolveEnv,
  getTenantSecrets,
  saveTenantSecrets
};
