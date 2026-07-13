# Plan técnico para convertir la app en un servicio multicliente y multiorigen

## 1. Objetivo del proyecto

Convertir la aplicación actual en una plataforma de agente empresarial reutilizable para múltiples clientes, negocios y fuentes de datos.

El producto final debe permitir:
- conectar un cliente nuevo sin reescribir el motor,
- conectar diferentes orígenes de datos sin cambiar la lógica central,
- adaptar el comportamiento del agente por negocio,
- ofrecer una base para revender el producto como servicio.

## 2. Visión de producto

La app debe pasar de ser un asistente especializado en TEC a un motor de negocio configurable.

### Producto final
Un servicio donde cada cliente tenga:
- su propia configuración de negocio,
- sus fuentes de datos conectadas,
- su propio prompt / contexto,
- sus permisos y roles,
- su propio panel o experiencia de chat.

## 3. Principios de diseño

### 3.1. Mínimo cambio por cliente nuevo
Para incorporar un nuevo negocio o fuente de datos, no debe requerirse reescribir el core.

### 3.2. Arquitectura por capas
- Core del agente
- Conectores de datos
- Capa de normalización / semántica
- Configuración por tenant
- UI / experiencia

### 3.3. Configuración antes que código
Cuando sea posible, las diferencias entre negocios deben vivir en configuración y mappings, no en lógica fija.

### 3.4. Extensibilidad incremental
Se debe poder agregar un nuevo origen de datos con un nuevo conector, sin tocar el motor central.

## 4. Arquitectura propuesta

### 4.1. Componentes principales

1. Frontend web
   - chat para usuarios finales
   - panel admin para configurar clientes y fuentes
   - onboarding inicial

2. Backend API
   - autenticación
   - gestión de clientes / tenants
   - gestión de conexiones a datos
   - motor de agente
   - orquestación de herramientas
   - registro de eventos y logs

3. Motor de agente
   - recibe la pregunta del usuario
   - decide si necesita datos
   - ejecuta herramientas desde los conectores
   - genera respuesta natural

4. Conectores de datos
   - SQL (MySQL, PostgreSQL, SQL Server, etc.)
   - REST API
   - Shopify
   - ERP
   - Google Sheets / Airtable / Notion / CSV / Excel
   - CRM y otros sistemas

5. Capa de normalización
   - convierte resultados heterogéneos a un formato común
   - permite al agente trabajar con entidades como ventas, clientes, productos, stock, pedidos, etc.

## 5. Modelo de negocio / tenant

Cada cliente debe ser un tenant independiente.

### Entidades principales
- Tenant
- User
- TenantConnection
- DataSource
- DataMapping
- PromptTemplate
- Conversation
- Message
- ToolPermission

### Ejemplo de modelo
- Tenant: empresa cliente
- DataSource: por ejemplo, Shopify, ERP, MySQL, API REST
- DataMapping: cómo una tabla o endpoint se transforma a entidades del sistema
- PromptTemplate: instrucciones específicas del negocio

### 5.1. Regla central: cada tenant puede tener múltiples orígenes
El modelo no debe asumir un único origen por cliente. Un cliente puede tener, por ejemplo:
- una base SQL interna,
- una API REST del ERP,
- una tienda Shopify,
- una hoja de cálculo o CRM adicional.

Por eso la arquitectura debe soportar:
- Tenant -> 1..N DataSources
- cada DataSource -> un conector concreto (SQL, REST, Shopify, ERP, etc.)
- cada DataSource -> uno o varios DataMappings
- el agente debe decidir automáticamente qué conexión usar según la pregunta y el contexto

## 6. Estrategia para conectar múltiples orígenes con tablas diferentes

Esta es la parte clave del proyecto.

La forma correcta no es crear una herramienta especial por negocio, sino crear una capa abstracta que permita trabajar con datos de forma genérica.

### 6.1. Idea central: capa de adaptadores
Cada fuente de datos se expone mediante un conector con una interfaz común.

Cada conector debe implementar al menos:
- testConnection()
- getSchema()
- listTablesOrResources()
- runQuery(input)
- getSampleRows()
- mapToCanonicalShape(data)

### 6.2. Capa de normalización semántica
El motor del agente no debe trabajar directamente con tablas específicas.

En su lugar, cada conexión debe poder exponer entidades semánticas comunes:
- customers
- orders
- products
- inventory
- sales
- invoices
- leads
- tickets

### 6.3. Mapeo configurable
Cuando una empresa usa una tabla distinta, se define un mapping.

Ejemplo:
- negocio A: tabla sales -> entidad orders
- negocio B: endpoint /transactions -> entidad orders
- negocio C: tabla pedidos_web -> entidad orders

Esto permite conectar una fuente distinta con muy poco desarrollo.

### 6.4. Reutilización por tipo de origen, no por cliente
La idea central es que el código se reutilice por tipo de origen, no por cliente.

Ejemplos:
- un conector Shopify sirve para todos los clientes que usen Shopify; solo cambian credenciales, dominio, y el mapping de campos.
- un conector REST para ERP puede servir a múltiples clientes si cambia la URL base, autenticación y los endpoints.
- un conector SQL puede cubrir muchos clientes si cada uno define su propia conexión y su propio mapping de tablas.

Por tanto, el desarrollo no debe organizarse como:
- cliente A -> integración especial
- cliente B -> integración especial

Sino como:
- tipo de origen Shopify -> conector reutilizable
- tipo de origen SQL -> conector reutilizable
- tipo de origen REST -> conector reutilizable

Y luego, por cada cliente, se configura:
- credenciales,
- endpoints o conexión,
- mappings semánticos,
- permisos y prompt.

### 6.5. La complejidad real está en el mapping semántico
La parte difícil no es conectar Shopify o una API, sino que los datos de cada negocio no tengan la misma semántica.

Ejemplo:
- un cliente puede llamar “orders” a lo que otro llama “transactions”;
- un cliente puede guardar clientes en una tabla distinta;
- un ERP puede usar campos totalmente diferentes para stock, tickets o pedidos.

Por eso la arquitectura necesita dos capas bien separadas:
1. capa de adaptador o conector: extrae datos del origen real,
2. capa de mapping semántico: convierte esos datos a entidades comunes del sistema.

Esto permite que el motor del agente trabaje siempre con entidades estandarizadas como:
- customers
- orders
- products
- inventory
- invoices
- tickets
- leads

### 6.6. Reglas de diseño para minimizar desarrollo
Para cada nuevo cliente:
1. se añade una o varias conexiones nuevas,
2. se define un mapping de tablas/fields por cada conexión,
3. se asigna un prompt base,
4. el agente ya puede operar sobre esa combinación de orígenes.

No hace falta crear nuevas herramientas por negocio. Lo importante es que cada negocio se materialice como una configuración de conectores y mappings, no como una rama distinta de código.

## 7. Capa de conectores recomendada

### 7.1. Conector SQL genérico
Soporta:
- PostgreSQL
- MySQL
- SQL Server
- SQLite

Funciona con:
- introspección de tablas
- consultas SELECT
- mapeo de columnas a entidades

### 7.2. Conector REST API genérico
Soporta:
- endpoints GET/POST
- paginación
- autenticación por token o API key
- transformaciones de payload

### 7.3. Conector Shopify
- pedidos
- productos
- clientes
- inventario
- métricas

### 7.4. Conector ERP
- stock
- artículos
- clientes
- tickets
- transferencias

### 7.5. Conector Google Sheets / Airtable / Notion
- tablas simples
- hojas / bases de datos
- fácil para negocios pequeños o pruebas iniciales

## 8. Diseño del motor del agente

### 8.1. Objetivo del motor
Recibir una pregunta y decidir si necesita consultar datos.

### 8.2. Flujo del agente
1. recibir pregunta del usuario,
2. cargar contexto del tenant,
3. cargar prompt base,
4. cargar schema de datos del tenant,
5. decidir si usa una herramienta,
6. ejecutar herramienta sobre el conector adecuado,
7. construir respuesta en lenguaje natural,
8. guardar historial y trazabilidad.

### 8.3. Herramientas genéricas
En vez de herramientas específicas por negocio, se usarán herramientas genéricas:
- query_data
- get_metrics
- list_records
- search_records
- summarize_dataset
- compare_periods
- explain_trends

## 9. Base de datos recomendada

### Recomendación principal
PostgreSQL.

Motivos:
- mejor para aplicaciones empresariales,
- más sólido que MySQL para este tipo de producto,
- mejor soporte para JSON, escalabilidad y integraciones.

### Tablas recomendadas
- tenants
- users
- tenant_members
- data_sources
- data_source_connections
- data_mappings
- prompt_templates
- conversations
- messages
- audit_logs
- plans
- subscriptions

## 10. Estructura de carpetas recomendada

### Backend
- server/
  - core/
  - auth/
  - tenants/
  - connectors/
  - connectors/sql/
  - connectors/rest/
  - connectors/shopify/
  - connectors/erp/
  - mappings/
  - prompts/
  - agent/
  - tools/
  - telemetry/

### Frontend
- client/src/
  - pages/
  - admin/
  - components/
  - hooks/
  - contexts/

## 11. Fases de implementación

## Fase 1 — Fundación del producto
Objetivo: dejar el proyecto preparado para convertirse en una plataforma.

### Tareas
- crear modelo de tenant,
- separar la lógica de negocio del motor de agente,
- introducir configuración de negocio por cliente,
- preparar una base de datos real y persistente,
- definir estructura de usuarios y roles,
- mover el prompt actual a un template configurable.

### Entregables
- sistema de tenants,
- usuarios por tenant,
- configuración base del negocio,
- estructura de conversaciones independiente del negocio.

### Criterio de aceptación
Un mismo backend puede servir a dos clientes distintos con distinto contexto.

---

## Fase 2 — Capa de conectores de datos
Objetivo: que el sistema pueda leer datos desde orígenes distintos sin tocar el core.

### Tareas
- definir interfaz común para conectores,
- implementar conector SQL genérico,
- implementar conector REST API genérico,
- implementar conector Shopify como ejemplo de conector especializado,
- implementar conector ERP como ejemplo extra.

### Entregables
- un registro de conectores,
- una forma de probar una conexión,
- un método para obtener el schema del origen,
- una forma de ejecutar una consulta simple.

### Criterio de aceptación
Se puede conectar un origen nuevo sin modificar el motor central.

---

## Fase 3 — Capa de mapeo semántico
Objetivo: abstraer tablas y campos heterogéneos a entidades comunes.

### Tareas
- crear modelo de mappings,
- permitir asignar tablas / endpoints a entidades semánticas,
- permitir mapear columnas y campos,
- permitir definir aliases y transformaciones simples,
- soportar tipos básicos como string, number, date, boolean.

### Entregables
- sistema de mappings por tenant,
- mapeos por entidad (customers, orders, products, inventory, etc.),
- documentación básica de cómo crear un mapping nuevo.

### Criterio de aceptación
Un cliente con una tabla distinta puede ser interpretado por el agente como una entidad conocida.

---

## Fase 4 — Refactor del motor del agente
Objetivo: hacer el agente independiente del negocio concreto.

### Tareas
- eliminar dependencias rígidas al contexto de TEC,
- pasar el prompt a un template dinámico por tenant,
- cambiar las herramientas por un sistema genérico y configurable,
- asegurar que el agente pueda consultar distintos conectores según el tenant,
- añadir logging de tool calls y resultados.

### Entregables
- motor genérico,
- prompt configurado por tenant,
- herramientas genéricas disponibles,
- trazabilidad de consultas.

### Criterio de aceptación
El mismo motor puede responder para dos negocios distintos con distinta fuente de datos.

---

## Fase 5 — Panel de administración
Objetivo: que un cliente o administrador pueda configurar el servicio sin tocar código.

### Tareas
- crear CRUD de tenants,
- crear panel para añadir conexiones de datos,
- crear panel para definir mappings,
- crear panel para definir prompt base,
- crear panel para gestionar usuarios y permisos,
- crear panel de pruebas de conexión.

### Entregables
- admin panel mínimo,
- onboarding de cliente,
- configuración visual de orígenes y mappings.

### Criterio de aceptación
Un administrador puede configurar un nuevo cliente y sus fuentes de datos desde la UI.

---

## Fase 6 — Producto y experiencia final
Objetivo: dejar el producto listo para ser vendido.

### Tareas
- mejorar la experiencia de chat,
- permitir cambiar branding por cliente,
- añadir límites por plan,
- preparar auth multiusuario,
- mejorar errores y observabilidad,
- añadir métricas de uso.

### Entregables
- versión usable para clientes reales,
- soporte para múltiples tenants,
- base para white-label.

### Criterio de aceptación
La plataforma puede ser desplegada como SaaS para más de un cliente.

---

## Fase 7 — Seguridad, observabilidad y robustez
Objetivo: dejar el sistema estable para producción.

### Tareas
- logs estructurados,
- trazabilidad de cada consulta,
- rate limiting,
- control de permisos por tenant,
- auditoría de cambios,
- manejo de errores y fallbacks,
- testing end-to-end.

### Entregables
- sistema observables,
- seguridad por tenant,
- pruebas automáticas básicas.

### Criterio de aceptación
El sistema puede operar en producción con varios clientes.

---

## Fase 8 — Monetización y escalado
Objetivo: convertirlo en un producto comercial.

### Tareas
- planes y suscripciones,
- límites por tenant,
- white-label,
- onboarding guiado,
- billing,
- documentación para clientes.

### Entregables
- producto listo para vender.

## 12. Estrategia de implementación para reducir desarrollo

El objetivo es que el desarrollo inicial sea simple y escalable.

### 12.1. Prioridad 1: soporte a 3 fuentes
Implementar primero estas 3:
- SQL genérico,
- REST API genérico,
- Shopify.

Con eso ya se cubre una gran parte de los clientes reales.

### 12.2. Prioridad 2: mappings configurables
No construir herramientas por negocio.

### 12.3. Prioridad 3: prompts por tenant
No hardcodear el negocio dentro del agente.

### 12.4. Prioridad 4: panel de admin mínimo
No empezar por una UX compleja. Empezar con una administración simple pero funcional.

## 13. Recomendación de stack técnico

### Backend
- Node.js + TypeScript
- tRPC o Express/Fastify
- Drizzle ORM
- PostgreSQL
- Redis opcional para cache / colas

### Frontend
- React + TypeScript
- Vite
- shadcn/ui
- Tailwind

### IA / agente
- OpenAI o Azure OpenAI
- tool calling
- arquitecturas de prompts modulares

### Integraciones
- n8n solo como automatización adicional o integración de flujos externos,
- no como núcleo del producto.

## 14. Diseño de los datos del tenant

Cada tenant debe tener un registro con:
- nombre
- industria
- idioma
- moneda
- zona horaria
- prompt base
- datos de conexión
- permisos

El agente debe cargar eso en cada petición.

## 15. Diseño del mapeo de datos

### Ejemplo de mapping
```json
{
  "entity": "orders",
  "source": "sql",
  "table": "sales",
  "fields": {
    "id": "id",
    "customerId": "client_id",
    "amount": "total",
    "date": "created_at"
  }
}
```

Esto hace que el agente nunca necesite saber si el dato viene de una tabla SQL, un endpoint REST o una fuente distinta.

## 16. Cómo se verá el flujo real para un nuevo negocio

### Paso 1
El administrador crea un tenant.

### Paso 2
Añade una conexión de datos.

### Paso 3
Define mappings para las entidades importantes.

### Paso 4
Configura el prompt base.

### Paso 5
El agente ya puede responder sobre ese negocio.

## 17. Recomendación de implementación inicial

### MVP recomendado
Construir en este orden:
1. tenants,
2. conexiones,
3. mappings,
4. prompt por tenant,
5. motor de agente genérico,
6. conectar SQL y REST,
7. probar con 1 cliente real.

## 18. Riesgos a evitar

- empezar por construir herramientas demasiado específicas,
- hardcodear negocio en el prompt,
- acoplar el agente a una sola fuente,
- sobre-diseñar la UI antes de tener la arquitectura base,
- depender de n8n como si fuera la capa central del producto.

## 19. Criterios de éxito

El proyecto será exitoso cuando:
- un nuevo negocio pueda activarse con configuración y mapeos,
- el agente pueda responder sobre datos heterogéneos,
- no sea necesario tocar el core para añadir una nueva fuente,
- el producto sea vendible como servicio.

## 20. Instrucciones para el siguiente agente / conversación de código

Este plan debe ejecutarse en este orden:

1. Crear la arquitectura base de tenants y configuración.
2. Implementar la capa de conectores con SQL y REST.
3. Implementar mappings semánticos.
4. Refactorizar el motor del agente para que use tenant + conectores.
5. Añadir panel de administración mínimo.
6. Probar con un segundo negocio o dataset.

## 21. Resumen ejecutivo

La mejor manera de hacerlo es construir un producto con:
- un core de agente independiente,
- una capa de conectores modular,
- un sistema de mappings configurable,
- un modelo de tenant por cliente,
- un admin simple para configurar nuevas fuentes.

Así, para cada nuevo negocio solo se necesita:
- conectar la fuente,
- mapear sus tablas o endpoints,
- ajustar el prompt base.

Eso permite escalar sin reescribir el sistema.
