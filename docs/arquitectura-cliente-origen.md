# Arquitectura propuesta: motor original + configuracion por cliente y origen

## Idea central

Queremos mantener el patrón de la herramienta original:
- un motor de agente,
- herramientas reutilizables,
- y un origen de datos concreto por herramienta.

Pero queremos que ese origen sea configurable por cliente.

## Modelo

### 1. Core del agente
El core sigue siendo el mismo para todos los clientes.
No depende de Shopify ni de ERP directamente.

### 2. Conectores por origen
Cada origen de datos implementa una interfaz común:
- SQL
- REST
- Shopify
- ERP

### 3. Runtime por tenant/cliente
Por cada cliente se define un runtime con:
- qué conectores tiene activados,
- qué herramientas están disponibles,
- qué mappings semánticos usa,
- qué prompt/politicas aplica.

## Flujo

1. El usuario hace una pregunta.
2. El motor carga el runtime del cliente.
3. El motor decide qué herramienta usar.
4. La herramienta usa el conector configurado para ese cliente.
5. El resultado vuelve al motor.
6. El motor responde en lenguaje natural.

## Ventaja

Para un cliente nuevo:
- no se reescribe el motor,
- solo se añade un nuevo runtime o se cambia la configuración de conectores.

## Ejemplo

### Cliente A
- ERP
- Shopify

### Cliente B
- solo SQL
- solo REST

El motor sigue siendo el mismo. Solo cambia el runtime.
