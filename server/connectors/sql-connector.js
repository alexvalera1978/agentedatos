const { ConnectorBase } = require('./connector-base');

// Datos de ejemplo con nombres de tabla/columna NO canónicos, para demostrar
// cómo se adapta un origen desconocido (ventas → orders, importe → amount, etc.).
const SAMPLE = {
  ventas: [
    { id_venta: 3001, cliente: 'Ana', importe: 1250, fecha: '2026-06-28' },
    { id_venta: 3002, cliente: 'Luis', importe: 980, fecha: '2026-06-29' }
  ],
  articulos: [
    { sku: 'A-1', descripcion: 'Camiseta básica', precio: 19.9 },
    { sku: 'A-2', descripcion: 'Chaqueta urbana', precio: 39.9 }
  ]
};

/**
 * Conector SQL genérico (PostgreSQL). Un mismo conector sirve a cualquier cliente
 * con base SQL; solo cambia la connectionString.
 *
 * Descubre el esquema por introspección (information_schema): NO hace falta conocer
 * las tablas de antemano. Requiere el driver `pg` para conexión real
 * (`npm install pg`); sin connectionString/driver funciona en modo demo.
 */
class SqlConnector extends ConnectorBase {
  constructor({ kind = 'sql', name, config = {} } = {}) {
    super({ kind, name, config });
    this._client = null;
  }

  usesSampleData() {
    return this.config.useSampleData === true || !this.config.connectionString;
  }

  async client() {
    if (this._client) return this._client;
    let pg;
    try {
      pg = require('pg');
    } catch {
      throw new Error('Falta la dependencia "pg" para conexión SQL real. Instala con: npm install pg');
    }
    this._client = new pg.Client({ connectionString: this.config.connectionString });
    await this._client.connect();
    return this._client;
  }

  async testConnection() {
    if (this.usesSampleData()) {
      return { ok: true, message: `SQL en modo demo (datos de ejemplo): ${this.name || this.kind}` };
    }
    try {
      const client = await this.client();
      await client.query('SELECT 1');
      return { ok: true, message: 'Conexión SQL correcta.' };
    } catch (err) {
      return { ok: false, message: `No se pudo conectar a SQL: ${err.message}` };
    }
  }

  async listResources() {
    if (this.usesSampleData()) {
      return this.config.resources || Object.keys(SAMPLE);
    }
    const client = await this.client();
    const schema = this.config.schema || 'public';
    const res = await client.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [schema]
    );
    return res.rows.map((row) => row.table_name);
  }

  async describeResource(resource) {
    if (this.usesSampleData()) {
      const [row] = SAMPLE[resource] || [{}];
      return Object.keys(row || {}).map((name) => ({ name, type: typeof row[name] }));
    }
    const client = await this.client();
    const schema = this.config.schema || 'public';
    const res = await client.query(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
      [schema, resource]
    );
    return res.rows.map((row) => ({ name: row.column_name, type: row.data_type }));
  }

  async runQuery(resource, { limit = 100 } = {}) {
    if (this.usesSampleData()) {
      return (SAMPLE[resource] || []).map((row) => ({ ...row }));
    }
    const client = await this.client();
    // resource proviene del esquema descubierto; se acota con comillas dobles.
    const res = await client.query(`SELECT * FROM "${resource}" LIMIT ${Number(limit)}`);
    return res.rows;
  }

  async close() {
    if (this._client) {
      await this._client.end();
      this._client = null;
    }
  }
}

module.exports = { SqlConnector, SQL_SAMPLE: SAMPLE };
