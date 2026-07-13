const { mapToCanonicalEntity } = require('../mapping/canonical-entities');

/**
 * Interfaz común a todos los conectores. Un conector expone un origen de datos
 * concreto (SQL, REST, ERP, Shopify…) con la misma API, de modo que el agente
 * nunca depende de tablas ni endpoints específicos.
 *
 * Métodos clave para el onboarding de un origen desconocido:
 *  - testConnection(): ¿podemos conectar?
 *  - listResources(): ¿qué tablas / endpoints hay?
 *  - describeResource(name): ¿qué columnas tiene?
 *  - getSchema(): descubrimiento completo (recursos + columnas)
 *  - runQuery(resource): leer datos
 *  - mapToCanonicalShape(row, mapping): normalizar a entidad canónica
 */
class ConnectorBase {
  constructor({ kind, name, config = {} } = {}) {
    this.kind = kind;
    this.name = name;
    this.config = config;
  }

  async testConnection() {
    return { ok: true, message: 'Connection not implemented' };
  }

  async listResources() {
    return [];
  }

  async runQuery() {
    return [];
  }

  async sampleRows(resource, limit = 5) {
    const rows = await this.runQuery(resource);
    return Array.isArray(rows) ? rows.slice(0, limit) : [];
  }

  // Columnas inferidas a partir de una fila de muestra. Los conectores con
  // introspección real (SQL) sobreescriben esto.
  async describeResource(resource) {
    const [row] = await this.sampleRows(resource, 1);
    return Object.keys(row || {}).map((name) => ({ name, type: typeof row[name] }));
  }

  // Descubrimiento completo del origen: recursos + sus columnas.
  async getSchema() {
    const names = await this.listResources();
    const resources = [];
    for (const name of names) {
      resources.push({ name, columns: await this.describeResource(name) });
    }
    return { resources };
  }

  async mapToCanonicalShape(row, mappingConfig = {}) {
    const entity = mapToCanonicalEntity(
      row.entity || row.resource || mappingConfig.source || 'orders',
      mappingConfig
    );
    const fields = mappingConfig.fields;
    const data = fields
      ? Object.fromEntries(Object.entries(fields).map(([canonical, src]) => [canonical, row[src]]))
      : row;
    return { entity, source: this.kind, data };
  }
}

module.exports = { ConnectorBase };
