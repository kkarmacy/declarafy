# Revisión frontend — 2026.09.12-2

## Alcance comprobado

- Revisión estructural de las 145 pantallas declaradas y destinos de navegación.
- Comprobación de funciones llamadas por botones inline e identificadores duplicados.
- Comprobación de scripts locales y estructura del paquete Namecheap.
- Revisión de la capa compartida de formularios, contraseñas, tablas, navegación y solicitudes de API.
- 31 pruebas automatizadas superadas, incluyendo regresiones existentes y nuevas comprobaciones de accesibilidad, conexión y actualizaciones del DOM.

## Cambios

- Formularios con campos de ancho completo y etiquetas asociadas a sus controles.
- Mostrar/ocultar contraseñas, sin almacenarlas.
- Foco visible y respeto de la preferencia de movimiento reducido.
- Tablas desplazables y ajustes de diseño móvil para los módulos.
- Encabezado con ubicación actual y regreso al catálogo de 19 módulos.
- Estado explícito cuando la búsqueda no encuentra módulos.
- Validación de las restricciones nativas existentes antes de ejecutar calculadoras.
- Estado ocupado y bloqueo de clics duplicados durante solicitudes API iniciadas desde un botón.
- Solicitudes API sin caché, límite de espera y errores de conexión legibles.
- Rechazo de respuestas JSON inválidas o incompletas, en lugar de aparentar éxito.
- Eliminación de alertas ficticias de las notificaciones iniciales.
- Recursos versionados y service worker v11.

## Límites de verificación

La revisión visual local no pudo completarse: el navegador de la sesión bloqueó la dirección local con ERR_BLOCKED_BY_CLIENT. No se recurrió a otro navegador para eludir ese bloqueo.

Las pruebas estructurales no equivalen a ejecutar individualmente todos los flujos de las 145 pantallas. Quedan pendientes comprobaciones visuales en móvil y escritorio, y pruebas de los flujos autenticados en Namecheap después de instalar el ZIP.

Esta revisión no certifica la vigencia jurídica de cada fórmula tributaria ni habilita credenciales SUNAT, IA o pagos. No modifica config.local.php ni la base de datos.

## Instalación

Extraer el ZIP en public_html, manteniendo api/config.local.php. No reimportar schema.sql para esta mejora de frontend. VERSION.txt debe mostrar 2026.09.12-2. Recargar con Ctrl+Shift+R.
