const { ConnectorBase } = require('./connector-base');

/**
 * Conector REST genérico y reutilizable.
 * Sirve para cualquier API por HTTP: solo cambian baseUrl, auth y endpoints en la config.
 * Los conectores especializados (ERP, Shopify, etc.) extienden de este.
 */
class RestConnector extends ConnectorBase {
  constructor({ kind = 'rest', name, config = {} } = {}) {
    super({ kind, name, config });
  }

  headers() {
    const base = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) {
      base.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return { ...base, ...(this.config.headers || {}) };
  }

  resourceUrl(resource) {
    const baseUrl = (this.config.baseUrl || '').replace(/\/+$/, '');
    const endpoints = this.config.endpoints || {};
    const path = endpoints[resource] || `/${resource}`;
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  listResourcesSync() {
    if (Array.isArray(this.config.resources)) return this.config.resources;
    if (this.config.endpoints) return Object.keys(this.config.endpoints);
    return [];
  }

  async listResources() {
    return this.listResourcesSync();
  }

  async testConnection() {
    if (!this.config.baseUrl) {
      return { ok: false, message: 'Falta baseUrl en la configuración del conector.' };
    }
    try {
      const res = await fetch(this.config.baseUrl, { method: 'GET', headers: this.headers() });
      return { ok: res.ok, message: `HTTP ${res.status} desde ${this.config.baseUrl}` };
    } catch (err) {
      return { ok: false, message: `No se pudo conectar: ${err.message}` };
    }
  }

  async runQuery(resource, params = {}) {
    const url = new URL(this.resourceUrl(resource));
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const res = await fetch(url, { method: 'GET', headers: this.headers() });
    if (!res.ok) {
      throw new Error(`${this.name || this.kind} → ${resource}: HTTP ${res.status}`);
    }
    const body = await res.json();
    return Array.isArray(body) ? body : [body];
  }
}

module.exports = { RestConnector };
