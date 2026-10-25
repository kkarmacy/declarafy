# Despliegue de DeclaraFY en Namecheap

Esta versión usa PHP 8.3 y MariaDB/MySQL del hosting. Firebase ya no participa en el registro, inicio de sesión ni almacenamiento de datos.

## 1. Crear la base de datos

En cPanel abre **MySQL® Databases**:

1. Crea una base llamada `declarafy`.
2. Crea un usuario llamado `declarafy_app` con una contraseña larga generada por cPanel.
3. Agrega el usuario a la base y marca **ALL PRIVILEGES**.
4. Conserva los nombres completos que muestra cPanel; normalmente incluyen el prefijo de la cuenta.

## 2. Crear las tablas

Abre phpMyAdmin, selecciona la base creada, entra a **Importar** y carga `api/schema.sql`.

## 3. Configurar el servidor

En `public_html/api`, copia `config.sample.php` como `config.local.php` y completa:

- `db_name`: nombre completo de la base.
- `db_user`: nombre completo del usuario.
- `db_password`: contraseña generada en cPanel.
- `anthropic_api_key`: opcional por ahora; activa el asistente principal cuando tengas la clave.
- `openai_api_key` y `deepseek_api_key`: opcionales; solo se usan si habilitas esos proveedores alternativos.
- `sunat_client_id`, `sunat_client_secret` y `sunat_query_ruc`: credenciales oficiales para validar CPE. Se generan en SOL, en **Credenciales de API SUNAT**; `sunat_query_ruc` es el RUC propietario de esas credenciales.
- `sunat_api_url` y `sunat_api_token`: opcionales; solo si se contrata además un proveedor externo autorizado.
- `culqi_private_key`: necesaria para verificar pagos y activar planes desde el webhook.

No publiques `config.local.php` en GitHub. El `.htaccess` impide descargarlo desde la web.

## 4. Subir y comprobar

Sube el contenido del repositorio a `public_html`. Después abre:

`https://www.declarafy.com/api/index.php?action=health`

Debe responder con `"status":"ok"` y `"release":"2026.09.12-1"`. Luego prueba crear una cuenta nueva, cerrar sesión y volver a entrar.

Si actualizas una instalación existente, vuelve a importar `api/schema.sql`: todas las sentencias usan `CREATE TABLE IF NOT EXISTS` y añadirán las tablas nuevas sin borrar usuarios. Después fuerza una recarga con `Ctrl+Shift+R`; el service worker v10 reemplaza el frontend antiguo.

## 5. Pagos

Configura en Culqi el webhook:

`https://www.declarafy.com/api/index.php?action=culqi_webhook`

El servidor vuelve a consultar el cargo directamente a Culqi antes de activar un plan. Se reconocen los importes mensuales y anuales publicados en la web; el navegador no puede asignarse un plan por sí mismo.


## 6. Prueba controlada de autenticación OAuth SUNAT

La acción administrativa `POST /api/index.php?action=sunat_auth_test` prueba la obtención de un token sin exponerlo al navegador. Requiere una sesión autenticada de superadministrador y la protección de mutaciones que ya aplica el backend. No modifica datos tributarios ni consulta comprobantes.

Antes de probar:

1. Confirma que `api/config.local.php` existe dentro de `public_html/api/`, devuelve un array PHP válido y conserva la configuración de base de datos que ya permite iniciar sesión. Nunca pegues credenciales en chats, capturas ni código fuente.
2. En el servidor, configura únicamente en `api/config.local.php` los campos `sunat_client_id`, `sunat_client_secret`, `sunat_query_ruc`, `sunat_sol_username` y `sunat_sol_password`. El scope se selecciona en el backend según el servicio; no hace falta configurar `sunat_oauth_scope`.
3. En `sunat_sol_username`, coloca solo el usuario SOL, sin RUC. La prueba concatena el RUC al usuario para formar el identificador OAuth. No todas las APIs SUNAT usan necesariamente el mismo flujo de autenticación; esta prueba solo valida el flujo `clientessol/password`.
4. Invoca la acción desde una sesión de superadministrador con el mecanismo CSRF/seguridad de mutaciones que use la instalación. La respuesta indica únicamente si se recibió token, el estado HTTP y la expiración; nunca devuelve el token ni credenciales.

Este primer test usa el flujo `clientessol/password` de SUNAT para servicios que requieren Clave SOL. Si el servicio seleccionado documenta otro flujo OAuth (por ejemplo, `client_credentials`), no uses esta prueba para ese servicio: debe implementarse el flujo específico antes de probarlo.
