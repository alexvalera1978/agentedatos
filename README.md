# AgenteDatos

Motor de agente **multicliente y multiorigen**. Cada cliente (tenant) se define como
**configuración (datos), no como código**: fuentes de datos, mappings semánticos y prompt.
Ver el plan completo en [SERVICE_REARCHITECTURE_PLAN.md](SERVICE_REARCHITECTURE_PLAN.md).

## Idea clave: onboarding de un origen desconocido

No hace falta conocer el origen ni sus tablas hasta que el cliente contrata. El flujo es:

```
Conectar origen → Descubrir esquema → Auto-sugerir mappings → Revisar y guardar → El agente responde
```

Todo por API y guardado como JSON editable. **No se toca el core para dar de alta un cliente.**

### Endpoints de onboarding

| Paso | Método | Ruta |
|------|--------|------|
| Crear tenant | `POST` | `/api/tenants` |
| Probar un origen (sin guardar) | `POST` | `/api/onboarding/test` |
| Descubrir esquema (tablas + columnas) | `POST` | `/api/onboarding/discover` |
| Descubrir + **sugerir mappings** | `POST` | `/api/onboarding/suggest` |
| Añadir origen al tenant | `POST` | `/api/tenants/:id/sources` |
| Guardar mappings confirmados | `PUT`  | `/api/tenants/:id/mappings` |
| Consultar al agente | `POST` | `/api/agent/query` |

`/api/onboarding/suggest` descubre las tablas y propone a qué entidad canónica
corresponde cada una y qué columna alimenta cada campo, con nivel de confianza.
Ejemplo real (origen SQL con tablas desconocidas):

```
ventas    → orders    { id: id_venta, customer: cliente, amount: importe, date: fecha }  (confianza: alta)
articulos → products  { id: sku, name: descripcion, amount: precio }                      (confianza: alta)
```

## Arquitectura (una sola capa, sin duplicados)

```
Pregunta ─▶ Agente ─▶ Runtime del tenant ─▶ Conector ─▶ Mapping semántico ─▶ Respuesta
```

- `server/connectors/` — conectores **reutilizables por tipo de origen** (un conector sirve a todos los clientes del mismo tipo; solo cambia la config):
  - `connector-base.js` — interfaz común + descubrimiento de esquema (`listResources`, `describeResource`, `getSchema`).
  - `rest-connector.js` — REST genérico (fetch HTTP real).
  - `sql-connector.js` — SQL/PostgreSQL con **introspección** vía `information_schema` (requiere `npm install pg` para conexión real).
  - `globalapi-connector.js` — ERP tipo **gateway SQL sobre HTTP** (`POST /api/Query/execute` con cabecera `X-Api-Key`). Es el que usa el cliente real **SMTP2**: las consultas SQL por recurso viven en la config del tenant.
  - `erp-connector.js`, `shopify-connector.js` — especializados; heredan de REST.
  - `connector-registry.js` — registro; añadir un tipo de origen = registrar aquí.
- `server/mapping/` — `canonical-entities.js` (orders, inventory, products, customers, invoices, tickets, leads) y `suggest.js` (auto-sugerencia).
- `server/data/` — **store de tenants como JSON** (`data/tenants/*.json`) + `store.js`. Editable en runtime.
- `server/onboarding/` — servicio de alta de tenants y orígenes.
- `server/tenants/registry.js` — construye el runtime de un tenant a partir de su config.
- `server/agent.js` — motor genérico: infiere entidad → resuelve mapping → consulta conector → normaliza.
- `server/index.js` — API Express.
- `client/` — frontend React (chat de prueba con selector de tenant).

## Añadir un cliente nuevo

Vía API (ver tabla arriba) o creando a mano `server/data/tenants/<cliente>.json`.
Sin tocar el core ni el agente. Los secretos se referencian como `${VAR}` y se
resuelven desde variables de entorno (nunca se guardan en el JSON).

## Credenciales

Ver [.env.example](.env.example). **Sin credenciales, cada conector arranca en modo demo**
con datos de ejemplo, para poder ver el flujo completo sin integración real.

El cliente **SMTP2 ya consulta datos reales** de su ERP (GES0002, SQL Server) cuando
`SMTP2_ERP_API_KEY` está en `.env`. Recursos mapeados a entidades canónicas:

| Entidad | Tabla real | Consulta |
|---------|-----------|----------|
| `inventory` | `ALM_STOCK` | stock por artículo / color / talla / almacén |
| `products` | `MAN_ARTICULOS` | catálogo de artículos |
| `customers` | `MAN_CLIENTES` | clientes |

Para adaptar/añadir un recurso basta con editar el mapa `queries` en
[server/data/tenants/smtp2.json](server/data/tenants/smtp2.json). Sin tocar código.

## Desarrollo

```bash
npm install
npm run dev        # API (3001) + cliente Vite (5173)
npm test           # suite (node --test)
```

## Próximos pasos (según el plan)

1. Persistencia en PostgreSQL para el store de tenants (hoy es JSON en disco).
2. Sustituir la inferencia por palabras clave por un LLM con tool-calling.
3. Panel de administración (UI) sobre los endpoints de onboarding.
4. Autenticación y roles por tenant.
