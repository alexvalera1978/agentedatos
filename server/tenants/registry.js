const { defaultRegistry } = require('../connectors/connector-registry');
const { ClientRuntime } = require('../runtime/client-runtime');
const store = require('../data/store');

/**
 * Construye un runtime ejecutable a partir de una config de tenant (datos planos).
 * Instancia los conectores vía el registro reutilizable.
 */
function buildRuntime(config) {
  const registry = defaultRegistry();
  const connectors = (config.sources || []).map((source) =>
    registry.createConnector(source.kind, source)
  );
  return new ClientRuntime({
    tenant: config.tenant,
    connectors,
    mappings: config.mappings || [],
    tools: config.tools || [],
    prompt: config.prompt,
    charts: config.charts === true
  });
}

function getTenantRuntime(tenantId) {
  const config = store.getTenantConfig(tenantId);
  if (!config) return null;
  return buildRuntime(config);
}

function listTenants() {
  return store.listTenantConfigs().map((config) => ({
    id: config.tenant.id,
    name: config.tenant.name
  }));
}

module.exports = { buildRuntime, getTenantRuntime, listTenants };
