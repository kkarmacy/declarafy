# Informe de auditoría técnica — Declarafy

**Fecha:** 23 de septiembre de 2026  
**Base auditada:** `main`, commit `807decd62f0083c945e7713f5b65b59b5925ff15`  
**Alcance:** inspección del código y revisión del diagnóstico local facilitado por el propietario. Los resultados de la ejecución local pertenecen a dicho diagnóstico; la verificación independiente de este informe se realizó contra el código de GitHub y los resultados publicados de GitHub Actions.

## Resumen

La aplicación principal usa PHP/MySQL en Namecheap; no carga el SDK de Firebase en el HTML de producción. No se identificó un error general de sintaxis ni una caída de CI: Security Check, Browser Tests y Production Smoke Test del commit base figuran aprobados en GitHub Actions. **Esto no acredita que cada módulo tributario sea legalmente correcto ni que se hayan probado autenticación, pagos y SUNAT con credenciales reales.**

El informe recibido identificó correctamente código heredado, duplicaciones y una prueba E2E sensible al tiempo, pero confundía una clave pública VAPID con un secreto y un identificador comercial de plan con una incompatibilidad demostrada. Además, omitía problemas de mayor prioridad en la exportación HTML y en contenido regulatorio estático.

## Hallazgos y estado

| Prioridad | Hallazgo | Evidencia | Impacto y recomendación |
|---|---|---|---|
| **Alta** | Exportaciones a una ventana nueva interpolaban texto no escapado | `app.js:8419–8460`, `app.js:6774–6782`; también la previsualización white-label en `app.js` | Riesgo de inyección de HTML si el contenido proviene de mensajes, clientes o campos editables. En la rama de corrección se añadió `src/core/safe-exports.js` para sobrescribir exportación PDF y el informe mensual, escapando datos y validando colores. Queda pendiente auditar y corregir por separado la previsualización white-label y comprobar el comportamiento visual. |
| **Alta — integridad de información** | Afirmaciones tributarias o de cumplimiento precargadas sin prueba de situación del contribuyente | `app.js:6754–6761` muestra «Obligaciones del período al día» y «Sin contingencias tributarias significativas identificadas» en una plantilla de demostración; `app.js:400–414` contiene un calendario con fechas genéricas | No presentar resultados de cumplimiento o vencimientos individuales como verificados. Reemplazar ejemplos por estados explícitos «pendiente de verificación» y obtener fechas por cronograma vigente y último dígito de RUC. Determinar mediante prueba de interfaz si la plantilla demo es accesible en producción. |
| **Media** | Código Firebase retirado permanece en la raíz | `index.js`, `secure-index.js`, `final-index.js`, `push-notifications.js`, `firebase.json` | Complica mantenimiento y permite desplegar accidentalmente una arquitectura antigua. El frontend real carga `server-api.js` y `firebase-sync.js` como **adaptador de compatibilidad** PHP: no borrar este último sin sustituir sus llamadas. Archivar o retirar entrypoints antiguos tras auditar referencias y procedimientos de despliegue. |
| **Media** | La ruta de IA alternativa cuenta consultas sin reserva atómica | `api/index.php:571–603` | La ruta primaria `ai` sí reserva y revierte la cuota; la alternativa solo incrementa tras la respuesta. Los planes de pago actualmente usan otro criterio, por lo que **no está demostrado un exceso de cuota gratuita**. Antes de comercializar otros límites, consolidar reserva atómica y tests de concurrencia/reintentos. |
| **Media** | Funciones duplicadas y capas de wrappers | `app.js:3862` y `:7991` (`showAuthLoading`); `:432` y `:8419` (`exportPDF`); `:1573` y `:6782` (`copyInforme`); múltiples envoltorios de `setPTab` y `sendMsg` | La última definición prevalece; cambios en una versión antigua pueden no producir efecto. Además, `copyInforme` usa `event.target` implícito en la segunda implementación. Separar responsabilidades por módulo sin sustituir `app.js` masivo en una sola operación. |
| **Media** | Tipo de cambio fijo del portafolio cripto | `app.js:12358–12390`: `tc=3.75`; `src/modules/final-safety-enhancements.js` añade advertencia | La cifra en soles puede no reflejar el cambio del día ni el tipo aplicable fiscalmente. Obtener valor y fecha de una fuente adecuada, permitir corrección manual y mostrar fuente/hora; en ausencia de dato fiable, ocultar o etiquetar claramente la conversión PEN. |
| **Media** | CSP no se aplica de forma preventiva | `.htaccess`: `Content-Security-Policy-Report-Only` y `'unsafe-inline'` | Endurecer gradualmente, después de migrar los numerosos manejadores `onclick` y estilos en línea; activar una CSP estricta de inmediato rompería la interfaz. |
| **Baja–media** | Una prueba E2E de 17 módulos agota el tiempo global | `playwright.config.js`: 45 s; `tests/e2e/modules.spec.js:68`; diagnóstico local informa ~52,7 s y ejecución exitosa con 180 s | Corregido en la rama de auditoría con 120 s **solo para el caso lento**; conservar 45 s como límite global y comprobar CI. |
| **Baja** | Nombres comerciales de planes distintos de los identificadores internos | `index.html:180–184` usa `profesional`; `api/schema.sql` usa `pro`; `app.js:3820–3835` redirige el plan elegido a Culqi tras crear una cuenta `basico` | Esto **no demuestra un fallo de base de datos**: PHP registra inicialmente un usuario básico y la activación depende del pago. Documentar y probar la secuencia Free → checkout → webhook → Pro/Empresa, con estados claros y comprobación de cobros reales. |
| **Baja** | Clave VAPID pública incrustada en un archivo heredado | `push-notifications.js` | Una **clave VAPID pública no es un secreto** y su presencia por sí sola no es filtración de credenciales. Retirar el archivo si las notificaciones FCM han sido discontinuadas; nunca introducir la clave privada en frontend. |
| **Baja** | Comentario obsoleto de ruta | `app.js:2–3` dice `/js/config.js`; `index.html` carga `/config.js` | Corregir el comentario en la próxima extracción de funciones de `app.js`. |

### Nota sobre Markdown y XSS

`app.js:86` aún contiene un formateador Markdown legado que solo rechaza ciertos esquemas de URL. `config.js:48–65` lo reemplaza en `DOMContentLoaded` mediante escape y DOMPurify, de modo que **no hay demostración de explotación en el chat normal**. La exportación HTML a nuevas ventanas, en cambio, sí copiaba valores no escapados y por ello recibió la corrección prioritaria.

### Nota sobre el estado de las pruebas

El diagnóstico local facilitado informa que `npm test`, `php -l` y `node --check` pasaron, y que la prueba de los 17 módulos tardó ~52,7 s y pasó al ampliar el timeout. La ejecución de GitHub Actions sobre `807decd` también mostraba verdes Security Check, Browser Tests y Production Smoke Test. Los E2E de panel emplean respuestas API simuladas, y el inicio de sesión real de producción es opcional cuando faltan secretos; estas verificaciones no sustituyen pruebas de extremo a extremo de facturación, correo, SUNAT o proveedores IA.

## Cambios incluidos en `audit-hardening-20260923`

- Timeout específico de 120 s para `los 17 módulos especializados abren contenido real`.
- `src/core/safe-exports.js`: reemplazos acotados de `exportPDF` y `exportInformeMensual` con escape de datos de usuario, validación de color y contenido textual seguro.
- `frontend-ui.js`: carga del módulo de exportación segura sin editar íntegramente `app.js`.
- `tests/safe-exports.test.js`: regresiones contra contenido HTML malicioso en mensajes, nombres de clientes y branding.
- `security-check.yml`: comprobación sintáctica de `src/core/*.js`.

**Fuera de alcance de esta corrección:** eliminar todos los archivos legacy, rehacer la arquitectura de `app.js`, endurecer inmediatamente CSP y afirmar que todos los cálculos regulatorios históricos están actualizados. Cada uno requiere pruebas funcionales y, para datos legales/tributarios, validación en fuentes oficiales antes de presentarlos como vigentes.

## Orden de trabajo siguiente

1. Ejecutar CI de la rama y probar exportación/impresión visualmente en móvil y escritorio.
2. Remover o neutralizar afirmaciones de cumplimiento demo y fechas genéricas antes de que se presenten como información verificada.
3. Verificar pagos y activación de planes con cuenta de pruebas, sin exponer credenciales, y la ruta alternativa de IA con fallos/reintentos controlados.
4. Sustituir la conversión PEN fija del portafolio y revisar todos los datos regulatorios estáticos.
5. Retirar el backend Firebase no utilizado después de verificar referencias, mantener el adaptador PHP compatible y descomponer gradualmente `app.js`.

**Despliegue:** aprobar CI en GitHub no instala automáticamente archivos nuevos en Namecheap; actualizar el servidor y ejecutar el Production Smoke Test para confirmar que `safe-exports.js` se sirve correctamente.

## Actualización de remediación en rama de auditoría

Los siguientes cambios están implementados **en la rama**, no necesariamente desplegados en Namecheap:

- Se retiraron los entrypoints Firebase antiguos (`index.js`, `secure-index.js`, `final-index.js`, `push-notifications.js`) y la configuración Firebase/Firestore obsoleta. Se conservaron `firebase-sync.js` y `server-api.js` porque el frontend aún depende del adaptador de compatibilidad PHP.
- Se añadió escape de contenido en exportaciones PDF, informes mensuales y vista previa white-label. Los informes demo ahora advierten expresamente que no se ha verificado la situación tributaria.
- El calendario oculta fechas genéricas y el panel de alertas no presenta el contenido estático histórico como monitoreo real. La conexión a un feed normativo oficial **sigue pendiente**.
- El portafolio cripto ya no presenta el tipo de cambio fijo de 3.75 como conversión válida: pide un TC manual y muestra «TC pendiente» si falta. **La conexión automática a una fuente oficial y la determinación del tipo fiscal aplicable siguen pendientes.**
- La ruta alternativa de IA valida mensajes, reserva consumo con transacción y revierte la reserva si falla el proveedor. No se ha realizado una prueba de carga con proveedores reales ni verificado el coste por tokens.
- Se añadió CSP preventiva de bajo riesgo para `base-uri`, `object-src` y `frame-ancestors`. La política completa permanece en modo `Report-Only` hasta retirar handlers inline.
- El contrato de planes y la verificación previa a activar cobros se documentan en `docs/CONTRATO_PLANES_Y_PAGOS.md`. No se ejecutaron pagos de prueba reales ni se configuró el webhook externo.

**Deuda técnica no resuelta:** las múltiples implementaciones y wrappers de `app.js` requieren extracción gradual y pruebas de cada ruta; los reemplazos seguros de exportación reducen riesgo sin prometer que el monolito está completamente deduplicado. Las integraciones externas reales de SUNAT, Culqi, fuentes de TC y proveedores de IA dependen de credenciales y validación operativa en el hosting.

**Antes de fusionar o desplegar:** exigir Security Check y Browser Tests aprobados en el commit final; probar la impresión en navegadores reales; verificar que Namecheap publique `src/core/safe-exports.js` y `src/core/audit-remediations.js` y que el cache del navegador cargue `frontend-ui.js` actualizado.
