const CANONICAL_ENTITIES = {
  orders: 'orders',
  inventory: 'inventory',
  products: 'products',
  invoices: 'invoices',
  customers: 'customers',
  tickets: 'tickets'
};

function mapToCanonicalEntity(sourceEntity, mappingConfig = {}) {
  const key = sourceEntity.toLowerCase();
  return mappingConfig.target || CANONICAL_ENTITIES[key] || key;
}

module.exports = { CANONICAL_ENTITIES, mapToCanonicalEntity };
