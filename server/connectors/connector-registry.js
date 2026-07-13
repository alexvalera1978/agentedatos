const { RestConnector } = require('./rest-connector');
const { SqlConnector } = require('./sql-connector');
const { ErpConnector } = require('./erp-connector');
const { ShopifyConnector } = require('./shopify-connector');
const { GlobalApiConnector } = require('./globalapi-connector');
const { FileConnector } = require('./file-connector');

class ConnectorRegistry {
  constructor() {
    this.factories = new Map();
  }

  register(kind, factory) {
    this.factories.set(kind, factory);
    return this;
  }

  has(kind) {
    return this.factories.has(kind);
  }

  kinds() {
    return [...this.factories.keys()];
  }

  createConnector(kind, source) {
    const factory = this.factories.get(kind);
    if (!factory) {
      throw new Error(`Connector not registered: ${kind}`);
    }
    return factory(source);
  }
}

/**
 * Registro con los conectores reutilizables disponibles.
 * Añadir un nuevo tipo de origen = registrar un conector aquí, sin tocar tenants ni agente.
 */
function defaultRegistry() {
  return new ConnectorRegistry()
    .register('rest', (source) => new RestConnector(source))
    .register('sql', (source) => new SqlConnector(source))
    .register('erp', (source) => new ErpConnector(source))
    .register('shopify', (source) => new ShopifyConnector(source))
    .register('globalapi', (source) => new GlobalApiConnector(source))
    .register('excel', (source) => new FileConnector(source));
}

module.exports = { ConnectorRegistry, defaultRegistry };
