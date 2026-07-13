const { ConnectorBase } = require('./connector-base');

// Muestras con la forma REAL de las tablas del ERP (BD GES0002), para modo demo
// offline / tests cuando no hay API key configurada.
const SAMPLE = {
  inventory: [
    { ARTICULO: 'JO0001', COLOR: '0001', TALLA: '01', ALMACEN: '000099', ENTRADA: 10, SALIDA: 10, DISPONIBLE: 0 }
  ],
  products: [
    { CODIGO: 'JO0001', DESCRIPCION: 'MOSAIC OF STORIES JACKET MILITARY GREEN', TEMPORADA: '24', FAMILIA: '0003' }
  ],
  customers: [
    { CODIGO: '000002', DESCRIPCION: 'PRODUCCIONES NUEVA LINEA S.L', POBLACION: 'MADRID', NIF: 'B86619046' }
  ]
};

/**
 * Conector para ERPs que exponen un gateway "SQL sobre HTTP" (patrón GlobalApi:
 * POST /api/Query/execute con { sql } y cabecera X-Api-Key devolviendo filas JSON).
 *
 * Reutilizable: cada cliente define en su config baseUrl, apiKey y el mapa `queries`
 * (recurso semántico → SQL real de sus tablas). Sin código por cliente.
 *
 * Sin apiKey → modo demo con datos de ejemplo (forma real de las tablas).
 */
class GlobalApiConnector extends ConnectorBase {
  constructor({ kind = 'globalapi', name, config = {} } = {}) {
    super({ kind, name, config });
  }

  queries() {
    return this.config.queries || {};
  }

  configured() {
    return Boolean(this.config.baseUrl && this.config.apiKey);
  }

  headers() {
    const header = this.config.apiKeyHeader || 'X-Api-Key';
    return { 'Content-Type': 'application/json', [header]: this.config.apiKey || '' };
  }

  queryUrl() {
    const base = (this.config.baseUrl || '').replace(/\/+$/, '');
    return `${base}${this.config.queryPath || '/api/Query/execute'}`;
  }

  async executeSql(sql) {
    const res = await fetch(this.queryUrl(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ sql, timeoutSeconds: this.config.timeoutSeconds || 30 })
    });
    if (!res.ok) {
      throw new Error(`${this.name || this.kind} → HTTP ${res.status}`);
    }
    const body = await res.json();
    // El gateway devuelve errores como objeto { error: "..." } en vez de un array.
    if (body && !Array.isArray(body) && body.error) {
      throw new Error(`ERP SQL: ${body.error}`);
    }
    return Array.isArray(body) ? body : [body];
  }

  async testConnection() {
    if (!this.configured()) {
      return { ok: true, message: `ERP en modo demo (sin apiKey): ${this.name || this.kind}` };
    }
    try {
      const rows = await this.executeSql('SELECT 1 AS ok');
      return { ok: rows[0]?.ok === 1, message: 'Conexión ERP (GlobalApi) correcta.' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async listResources() {
    return Object.keys(this.queries());
  }

  async runQuery(resource) {
    if (!this.configured()) {
      return SAMPLE[resource] ? SAMPLE[resource].map((row) => ({ ...row })) : [];
    }
    const sql = this.queries()[resource];
    if (!sql) {
      throw new Error(`Recurso no definido en la config del ERP: ${resource}`);
    }
    return this.executeSql(sql);
  }
}

module.exports = { GlobalApiConnector, GLOBALAPI_SAMPLE: SAMPLE };
