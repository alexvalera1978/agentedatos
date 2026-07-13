const { RestConnector } = require('./rest-connector');

// Datos de ejemplo para poder demostrar el flujo end-to-end sin credenciales reales.
// Cuando la config trae apiKey real y useSampleData !== true, el conector consulta la API de verdad.
const SAMPLE = {
  stock: [
    { sku: 'SKU-1001', stock: 42, warehouse: 'A1' },
    { sku: 'SKU-1002', stock: 18, warehouse: 'B3' }
  ],
  articles: [
    { sku: 'SKU-2001', name: 'Camiseta básica', category: 'Ropa' },
    { sku: 'SKU-2002', name: 'Chaqueta urbana', category: 'Ropa' }
  ],
  orders: [
    { id: 2001, customer: 'Ana', amount: 1250, date: '2026-06-28' },
    { id: 2002, customer: 'Luis', amount: 980, date: '2026-06-29' }
  ],
  invoices: [
    { id: 5001, customer: 'Marta Ruiz', amount: 3200, date: '2026-06-30' }
  ]
};

/**
 * Conector ERP reutilizable (REST por debajo).
 * Un mismo conector sirve a cualquier cliente con ERP; solo cambian credenciales y endpoints.
 */
class ErpConnector extends RestConnector {
  constructor({ kind = 'erp', name, config = {} } = {}) {
    super({ kind, name, config });
  }

  listResourcesSync() {
    return this.config.resources || ['stock', 'articles', 'orders', 'invoices'];
  }

  usesSampleData() {
    return this.config.useSampleData === true || !this.config.apiKey;
  }

  async testConnection() {
    if (this.usesSampleData()) {
      return { ok: true, message: `ERP en modo demo (datos de ejemplo): ${this.name || this.kind}` };
    }
    return super.testConnection();
  }

  async runQuery(resource, params = {}) {
    if (this.usesSampleData()) {
      return SAMPLE[resource] ? SAMPLE[resource].map((row) => ({ ...row })) : [];
    }
    return super.runQuery(resource, params);
  }
}

module.exports = { ErpConnector, ERP_SAMPLE: SAMPLE };
