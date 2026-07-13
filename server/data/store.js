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

// Versión resuelta (secretos ya sustituidos) — para EJECUTAR en runtime.
function getTenantConfig(id) {
  const raw = readRaw(id);
  return raw ? resolveEnv(raw) : null;
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
  resolveEnv
};
