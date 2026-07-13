const { ConnectorBase } = require('./connector-base');

// Datos de ejemplo para modo demo (sin accessToken).
const SAMPLE = {
  orders: [
    { name: '#1001', total_price: '98.00', currency: 'EUR', created_at: '2026-06-28', email: 'ana@example.com' }
  ],
  products: [
    { id: 1, title: 'Camiseta', vendor: 'ACME', product_type: 'Ropa', status: 'active' }
  ],
  customers: [
    { id: 1, first_name: 'Ana', last_name: 'Pérez', email: 'ana@example.com', orders_count: 3, total_spent: '250.00' }
  ]
};

// Canales de venta facturables por defecto (Online Store + POS + Draft Orders).
const DEFAULT_SALES_CHANNELS = ['web', 'pos', 'shopify_draft_order'];
// Canal iF Returns (cambios): NO es venta, solo mueve stock.
const DEFAULT_RETURNS_CHANNEL = '29236166657';

/**
 * Conector Shopify reutilizable (Admin REST API). Un mismo conector sirve a TODAS
 * las tiendas Shopify de cualquier cliente; solo cambian domain y accessToken en la
 * config del tenant. Sin accessToken → modo demo con datos de ejemplo.
 *
 * Además de las lecturas genéricas, ofrece salesSummary(): agrega las VENTAS reales
 * desde los Orders (no Analytics), sumando los canales de venta y excluyendo iF Returns,
 * con las fechas en hora local de la tienda (Europe/Madrid).
 */
class ShopifyConnector extends ConnectorBase {
  constructor({ kind = 'shopify', name, config = {} } = {}) {
    super({ kind, name, config });
  }

  usesSampleData() {
    return this.config.useSampleData === true || !this.config.accessToken;
  }

  configured() {
    return !!(this.config.domain && this.config.accessToken);
  }

  baseUrl() {
    const version = this.config.apiVersion || '2024-10';
    return `https://${this.config.domain}/admin/api/${version}`;
  }

  headers() {
    return { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': this.config.accessToken || '' };
  }

  listResourcesSync() {
    return this.config.resources || ['orders', 'products', 'customers'];
  }

  async listResources() {
    return this.listResourcesSync();
  }

  async testConnection() {
    if (this.usesSampleData()) {
      return { ok: true, message: `Shopify en modo demo: ${this.config.domain || this.name}` };
    }
    try {
      const res = await fetch(`${this.baseUrl()}/shop.json`, { headers: this.headers() });
      const body = res.ok ? await res.json() : null;
      const shop = body && body.shop ? ` — ${body.shop.name}` : '';
      return { ok: res.ok, message: `Shopify HTTP ${res.status} (${this.config.domain})${shop}` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async runQuery(resource, params = {}) {
    if (this.usesSampleData()) {
      return (SAMPLE[resource] || []).map((r) => ({ ...r }));
    }
    const url = new URL(`${this.baseUrl()}/${resource}.json`);
    // Los pedidos requieren status=any para incluir todos.
    if (resource === 'orders' && params.status === undefined) url.searchParams.set('status', 'any');
    url.searchParams.set('limit', String(params.limit || 20));
    // Campos por defecto (configurables por tenant) para no traer objetos enormes.
    const fields = params.fields || (this.config.fields || {})[resource];
    if (fields) url.searchParams.set('fields', fields);
    Object.entries(params).forEach(([k, v]) => {
      if (!['limit', 'fields'].includes(k)) url.searchParams.set(k, String(v));
    });

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`${this.name || this.kind} → ${resource}: HTTP ${res.status}`);
    const body = await res.json();
    return body[resource] || (Array.isArray(body) ? body : [body]);
  }

  // Conteo eficiente vía el endpoint /count.json de Shopify.
  async count(resource) {
    if (this.usesSampleData()) return (SAMPLE[resource] || []).length;
    const url = new URL(`${this.baseUrl()}/${resource}/count.json`);
    if (resource === 'orders') url.searchParams.set('status', 'any');
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`${this.name} → count ${resource}: HTTP ${res.status}`);
    const body = await res.json();
    return body.count;
  }

  // Suma un día al string AAAA-MM-DD (para acolchar el rango antes de filtrar en local).
  static shiftDay(dateStr, days) {
    const dt = new Date(`${dateStr}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  // Trae TODOS los pedidos del rango [from, hasta] paginando con el cabecera Link de Shopify.
  // El rango se acolcha ±1 día y luego se filtra por FECHA LOCAL de la tienda (el created_at
  // ya viene con el offset de la tienda, así que su parte de fecha es hora Europe/Madrid).
  async fetchOrders({ from, to, fields, maxPages = 40 } = {}) {
    if (this.usesSampleData()) return (SAMPLE.orders || []).map((r) => ({ ...r }));
    const flds = fields || 'id,name,created_at,source_name,financial_status,cancelled_at,currency,subtotal_price,total_tax,total_price,total_discounts';
    let url = new URL(`${this.baseUrl()}/orders.json`);
    url.searchParams.set('status', 'any');
    url.searchParams.set('limit', '250');
    url.searchParams.set('fields', flds);
    if (from) url.searchParams.set('created_at_min', `${ShopifyConnector.shiftDay(from, -1)}T00:00:00Z`);
    if (to) url.searchParams.set('created_at_max', `${ShopifyConnector.shiftDay(to, 1)}T00:00:00Z`);

    const out = [];
    let pages = 0;
    let next = url;
    while (next && pages < maxPages) {
      const res = await fetch(next, { headers: this.headers() });
      if (!res.ok) throw new Error(`${this.name} → orders: HTTP ${res.status}`);
      const body = await res.json();
      out.push(...(body.orders || []));
      pages += 1;
      const link = res.headers.get('link') || res.headers.get('Link') || '';
      const m = /<([^>]+)>;\s*rel="next"/.exec(link);
      next = m ? new URL(m[1]) : null; // la URL "next" ya lleva page_info + limit
    }
    this._truncated = !!next; // había más páginas de las permitidas
    return out;
  }

  // Agrega las ventas B2C desde Orders. groupBy: 'dia' | 'mes' | 'canal' | 'none'.
  // channel: 'ventas' (web+pos+draft, sin iF Returns) | 'cambios' (solo iF Returns).
  async salesSummary({ from, to, groupBy = 'none', channel = 'ventas' } = {}) {
    const salesChannels = (this.config.salesChannels || DEFAULT_SALES_CHANNELS).map(String);
    const returnsChannel = String(this.config.returnsChannel || DEFAULT_RETURNS_CHANNEL);
    const orders = await this.fetchOrders({ from, to });

    const localDate = (o) => String(o.created_at || '').slice(0, 10); // hora local de la tienda
    const inRange = (o) => { const d = localDate(o); return (!from || d >= from) && (!to || d <= to); };
    const isReturns = (o) => String(o.source_name) === returnsChannel;
    const wanted = (o) => (channel === 'cambios'
      ? isReturns(o)
      : salesChannels.includes(String(o.source_name)) && !isReturns(o));

    const rows = orders.filter((o) => inRange(o) && !o.cancelled_at && wanted(o));

    const keyOf = (o) => {
      const d = localDate(o);
      if (groupBy === 'dia') return d;
      if (groupBy === 'mes') return d.slice(0, 7);
      if (groupBy === 'canal') return String(o.source_name);
      return 'total';
    };
    const acc = new Map();
    for (const o of rows) {
      const k = keyOf(o);
      const a = acc.get(k) || { pedidos: 0, subtotal: 0, impuestos: 0, total: 0 };
      a.pedidos += 1;
      a.subtotal += Number(o.subtotal_price || 0);
      a.impuestos += Number(o.total_tax || 0);
      a.total += Number(o.total_price || 0);
      acc.set(k, a);
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    const labelKey = groupBy === 'dia' ? 'fecha' : groupBy === 'mes' ? 'mes' : groupBy === 'canal' ? 'canal' : null;
    let filas = [...acc].map(([k, a]) => ({
      ...(labelKey ? { [labelKey]: k } : {}),
      pedidos: a.pedidos,
      subtotal: r2(a.subtotal),
      impuestos: r2(a.impuestos),
      total: r2(a.total)
    }));
    if (labelKey === 'fecha' || labelKey === 'mes') filas.sort((x, y) => (x[labelKey] < y[labelKey] ? -1 : 1));
    else if (labelKey === 'canal') filas.sort((x, y) => y.total - x.total);

    return {
      desde: from,
      hasta: to,
      agrupado_por: groupBy,
      canal: channel,
      pedidos_totales: rows.length,
      total_periodo: r2(rows.reduce((s, o) => s + Number(o.total_price || 0), 0)),
      truncado: this._truncated === true,
      filas
    };
  }

  // ¿Es un pedido de VENTA facturable dentro del rango? (canales de venta, no iF Returns, no cancelado)
  _isSaleOrder(o, { from, to } = {}) {
    const salesChannels = (this.config.salesChannels || DEFAULT_SALES_CHANNELS).map(String);
    const returnsChannel = String(this.config.returnsChannel || DEFAULT_RETURNS_CHANNEL);
    const d = String(o.created_at || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (o.cancelled_at) return false;
    const sn = String(o.source_name);
    return salesChannels.includes(sn) && sn !== returnsChannel;
  }

  // Mejores clientes B2C por gasto en el periodo. Excluye estilistas/cesiones (préstamos, no ventas)
  // y devuelve cuántos se han excluido para poder avisar.
  async topCustomers({ from, to, limit = 10 } = {}) {
    const orders = await this.fetchOrders({ from, to, fields: 'id,created_at,source_name,cancelled_at,total_price,email,customer' });
    const rows = orders.filter((o) => this._isSaleOrder(o, { from, to }));
    const acc = new Map();
    let sinIdentificar = 0;
    for (const o of rows) {
      const cu = o.customer || {};
      // Clave de identidad real: id de cliente o email. Sin ninguno (p. ej. venta POS de
      // mostrador sin cliente registrado) NO se puede atribuir → no lo mezclamos en un
      // falso "sin nombre"; lo contamos aparte y lo dejamos fuera del ranking.
      const key = cu.id ? `id:${cu.id}` : (o.email ? `em:${o.email}` : null);
      if (!key) { sinIdentificar += 1; continue; }
      const nombre = [cu.first_name, cu.last_name].filter(Boolean).join(' ').trim()
        || o.email || (cu.id ? `Cliente ${cu.id}` : 'sin nombre');
      const a = acc.get(key) || { cliente: nombre, email: o.email || '', pedidos: 0, total: 0 };
      a.pedidos += 1;
      a.total += Number(o.total_price || 0);
      acc.set(key, a);
    }
    const esCesion = (a) => /estilist|cesi[oó]n/i.test(`${a.cliente} ${a.email}`);
    const todos = [...acc.values()];
    const excluidos = todos.filter(esCesion).length;
    const r2 = (n) => Math.round(n * 100) / 100;
    const filas = todos
      .filter((a) => !esCesion(a))
      .sort((x, y) => y.total - x.total)
      .slice(0, limit)
      .map((a) => ({ cliente: a.cliente, pedidos: a.pedidos, total: r2(a.total) }));
    return { desde: from, hasta: to, excluidos_estilistas_cesiones: excluidos, pedidos_sin_cliente_identificado: sinIdentificar, truncado: this._truncated === true, filas };
  }

  // Prendas más vendidas en el periodo (por unidades o importe), desde las líneas de los pedidos.
  // El nombre de producto es el mismo que en el ERP. temporada (opcional) filtra por prefijo de SKU.
  async topProducts({ from, to, limit = 10, by = 'unidades', temporada } = {}) {
    const orders = await this.fetchOrders({ from, to, fields: 'id,created_at,source_name,cancelled_at,line_items' });
    const rows = orders.filter((o) => this._isSaleOrder(o, { from, to }));
    const tPref = temporada ? String(temporada) : null;
    const acc = new Map();
    for (const o of rows) {
      for (const li of o.line_items || []) {
        if (tPref && !String(li.sku || '').startsWith(tPref)) continue;
        const producto = li.title || li.name || 'sin nombre';
        const a = acc.get(producto) || { producto, unidades: 0, importe: 0 };
        a.unidades += Number(li.quantity || 0);
        a.importe += Number(li.price || 0) * Number(li.quantity || 0);
        acc.set(producto, a);
      }
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    const filas = [...acc.values()]
      .sort((x, y) => (by === 'importe' ? y.importe - x.importe : y.unidades - x.unidades))
      .slice(0, limit)
      .map((a) => ({ producto: a.producto, unidades: a.unidades, importe: r2(a.importe) }));
    return { desde: from, hasta: to, ordenado_por: by, temporada: temporada || null, truncado: this._truncated === true, filas };
  }

  // Ventas agregadas por CÓDIGO DE ARTÍCULO (2º segmento del SKU "temporada/articulo/color/talla"),
  // con el precio de venta REAL medio. Base para cruzar con el coste del ERP y calcular margen.
  async productSalesByArticle({ from, to, temporada } = {}) {
    const orders = await this.fetchOrders({ from, to, fields: 'id,created_at,source_name,cancelled_at,line_items' });
    const rows = orders.filter((o) => this._isSaleOrder(o, { from, to }));
    const tPref = temporada ? String(temporada) : null;
    const acc = new Map();
    for (const o of rows) {
      for (const li of o.line_items || []) {
        const parts = String(li.sku || '').split('/');
        const temp = (parts[0] || '').trim();
        const articulo = (parts[1] || '').trim();
        if (!articulo) continue;
        if (tPref && temp !== tPref) continue;
        const a = acc.get(articulo) || { articulo, producto: li.title || li.name || articulo, unidades: 0, importe: 0 };
        a.unidades += Number(li.quantity || 0);
        a.importe += Number(li.price || 0) * Number(li.quantity || 0);
        acc.set(articulo, a);
      }
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    return [...acc.values()].map((a) => ({
      articulo: a.articulo,
      producto: a.producto,
      unidades: a.unidades,
      importe: r2(a.importe),
      precio_medio: a.unidades ? r2(a.importe / a.unidades) : 0
    }));
  }
}

module.exports = { ShopifyConnector, SHOPIFY_SAMPLE: SAMPLE };
