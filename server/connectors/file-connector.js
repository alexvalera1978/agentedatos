const path = require('path');
const XLSX = require('xlsx');
const { ConnectorBase } = require('./connector-base');

/**
 * Conector de archivo (Excel .xlsx / .xls / .csv) reutilizable.
 * Un mismo conector sirve para cualquier cliente que aporte datos en archivo;
 * solo cambia filePath en la config. Cada hoja del Excel es un "recurso".
 * Config: { filePath, resources?, sheet? }
 */
class FileConnector extends ConnectorBase {
  constructor({ kind = 'excel', name, config = {} } = {}) {
    super({ kind, name, config });
    this._wb = null;
  }

  workbook() {
    if (this._wb) return this._wb;
    if (!this.config.filePath) throw new Error('Falta filePath en la configuración del origen de archivo.');
    const abs = path.resolve(process.cwd(), this.config.filePath);
    this._wb = XLSX.readFile(abs);
    return this._wb;
  }

  sheets() {
    return this.workbook().SheetNames;
  }

  resolveSheet(resource) {
    const names = this.sheets();
    return names.includes(resource) ? resource : names[0];
  }

  rowsOf(resource) {
    const wb = this.workbook();
    const sheet = wb.Sheets[this.resolveSheet(resource)];
    return XLSX.utils.sheet_to_json(sheet, { defval: null });
  }

  listResourcesSync() {
    return this.config.resources || this.sheets();
  }

  async listResources() {
    return this.listResourcesSync();
  }

  async testConnection() {
    try {
      const s = this.sheets();
      return { ok: true, message: `Archivo leído. Hojas: ${s.join(', ')}` };
    } catch (err) {
      return { ok: false, message: `No se pudo abrir el archivo: ${err.message}` };
    }
  }

  async runQuery(resource, { limit } = {}) {
    const rows = this.rowsOf(resource);
    return limit ? rows.slice(0, limit) : rows;
  }

  async count(resource) {
    return this.rowsOf(resource).length;
  }
}

module.exports = { FileConnector };
