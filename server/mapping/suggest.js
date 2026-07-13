// Heurística de auto-sugerencia de mappings: dado un esquema descubierto
// (recursos + columnas), propone a qué entidad canónica corresponde cada tabla/endpoint
// y qué columna alimenta cada campo canónico. El humano solo revisa y confirma.

const ENTITY_SYNONYMS = {
  orders: ['order', 'orders', 'venta', 'ventas', 'sale', 'sales', 'pedido', 'pedidos', 'transaction', 'transactions', 'transaccion'],
  inventory: ['inventory', 'stock', 'existencias', 'almacen', 'warehouse'],
  products: ['product', 'products', 'producto', 'productos', 'article', 'articles', 'articulo', 'articulos', 'item', 'items', 'sku'],
  customers: ['customer', 'customers', 'cliente', 'clientes', 'client', 'clients', 'contact', 'contacts'],
  invoices: ['invoice', 'invoices', 'factura', 'facturas', 'facturacion', 'billing'],
  tickets: ['ticket', 'tickets', 'incidencia', 'incidencias', 'soporte', 'support'],
  leads: ['lead', 'leads', 'prospecto', 'prospectos', 'oportunidad', 'oportunidades']
};

// Vocabulario canónico ampliado: cada clave es un "campo común" del negocio y su
// lista de sinónimos habituales en las columnas reales de cualquier origen.
const FIELD_SYNONYMS = {
  id: ['id', 'code', 'ref', 'reference', 'idreg'],
  codigo: ['codigo', 'sku', 'referencia', 'matricula', 'ean'],
  documento: ['albaran', 'factura', 'pedido', 'ticket', 'documento', 'invoice', 'numalbaran'],
  fecha: ['fecha', 'date', 'createdat', 'created', 'timestamp', 'fechaoperacion', 'fechaventa'],
  fecha_prevista: ['fechaprevista', 'fechaentrega', 'deliverydate', 'vencimiento'],
  importe: ['importe', 'total', 'amount', 'price', 'precio', 'valor', 'monto', 'value', 'totalprice', 'precioventa'],
  precio_unitario: ['preciounitario', 'pvp', 'unitprice', 'preciounidad'],
  coste: ['coste', 'cost', 'costo', 'preciocompra', 'preciocoste'],
  descuento: ['descuento', 'discount', 'dto'],
  impuestos: ['impuestos', 'impuesto', 'iva', 'tax', 'importeiva'],
  margen: ['margen', 'margin', 'beneficio', 'profit'],
  moneda: ['moneda', 'currency', 'divisa'],
  cantidad: ['cantidad', 'quantity', 'qty', 'unidades', 'units', 'cantprendas'],
  stock: ['stock', 'existencias', 'disponible', 'available', 'enstock'],
  cliente: ['cliente', 'customer', 'client', 'comprador', 'clientid', 'customerid'],
  proveedor: ['proveedor', 'supplier'],
  comercial: ['comercial', 'vendedor', 'salesperson', 'operario', 'representante'],
  producto: ['producto', 'product', 'articulo', 'modelo', 'descripcion', 'description', 'title', 'nombre', 'name'],
  categoria: ['categoria', 'category', 'familia'],
  marca: ['marca', 'brand', 'vendor', 'fabricante'],
  variante: ['talla', 'color', 'variante', 'size'],
  ubicacion: ['almacen', 'tienda', 'sucursal', 'warehouse', 'store', 'centro'],
  region: ['provincia', 'region', 'pais', 'country', 'poblacion', 'ciudad', 'city'],
  canal: ['canal', 'channel', 'subcanal'],
  tipo: ['tipo', 'type'],
  estado: ['estado', 'status', 'financialstatus'],
  forma_pago: ['formapago', 'pago', 'payment', 'paymentmethod']
};

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Trocea en palabras (por espacios, guiones, guiones_bajos…), sin acentos.
function tokenize(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Empareja por palabra completa (token), no por subcadena, para evitar falsos
// positivos como "inventario" ↔ "venta". Solo permite subcadena en los extremos.
function matchBySynonyms(candidate, synonyms) {
  const n = normalize(candidate);
  const tokens = tokenize(candidate);
  return synonyms.some((syn) => {
    const s = normalize(syn);
    return n === s || tokens.includes(s) || n.startsWith(s) || n.endsWith(s);
  });
}

function matchEntity(resourceName) {
  for (const [entity, synonyms] of Object.entries(ENTITY_SYNONYMS)) {
    if (matchBySynonyms(resourceName, synonyms)) return entity;
  }
  return null;
}

function matchFields(columns = []) {
  const fields = {};
  for (const [canonical, synonyms] of Object.entries(FIELD_SYNONYMS)) {
    const col = columns.find((c) => matchBySynonyms(c.name, synonyms));
    if (col) fields[canonical] = col.name;
  }
  return fields;
}

/**
 * @param {{ resources: Array<{ name: string, columns?: Array<{name:string}> }> }} schema
 * @returns mappings propuestos con nivel de confianza para revisión humana.
 */
function suggestMappings(schema = {}) {
  const resources = schema.resources || [];
  return resources.map((resource) => {
    const target = matchEntity(resource.name);
    const fields = matchFields(resource.columns || []);
    const confidence = !target ? 'baja' : Object.keys(fields).length ? 'alta' : 'media';
    return {
      source: resource.name,
      target: target || resource.name,
      fields,
      matched: Boolean(target),
      confidence
    };
  });
}

module.exports = { suggestMappings, matchEntity, matchFields };
