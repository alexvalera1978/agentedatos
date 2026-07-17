class ClientRuntime {
  constructor({ tenant, connectors = [], mappings = [], tools = [], prompt, charts = false, llm = null } = {}) {
    this.tenant = tenant;
    this.connectors = connectors;
    this.mappings = mappings;
    this.tools = tools;
    this.prompt = prompt;
    this.charts = charts; // ¿mostrar gráficos en las respuestas?
    this.llm = llm; // config de LLM propia del cliente (proveedor/modelo/apiKey); null = usar la global (.env)
  }

  getConnector(kind) {
    return this.connectors.find((connector) => connector.kind === kind);
  }

  // Mapping por entidad de origen (p. ej. 'stock').
  getMappingFor(sourceEntity) {
    return this.mappings.find((mapping) => mapping.source === sourceEntity) || null;
  }

  // Mapping por entidad canónica de destino (p. ej. 'inventory' → { source: 'stock', ... }).
  getMappingForTarget(targetEntity) {
    return this.mappings.find((mapping) => mapping.target === targetEntity) || null;
  }

  // Primer conector que expone un recurso; si ninguno lo declara, el primero disponible.
  async getConnectorForResource(resource) {
    for (const connector of this.connectors) {
      const resources = (await connector.listResources?.()) || [];
      if (resources.includes(resource)) return connector;
    }
    return this.connectors[0] || null;
  }

  getToolNames() {
    return this.tools.map((tool) => tool.name);
  }
}

module.exports = { ClientRuntime };
