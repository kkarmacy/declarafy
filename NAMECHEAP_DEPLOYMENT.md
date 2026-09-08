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
- `anthropic_api_key`: clave de la cuenta Anthropic que pagará las consultas.

No publiques `config.local.php` en GitHub. El `.htaccess` impide descargarlo desde la web.

## 4. Subir y comprobar

Sube el contenido del repositorio a `public_html`. Después abre:

`https://www.declarafy.com/api/index.php?action=health`

Debe responder con `"status":"ok"`. Luego prueba crear una cuenta nueva, cerrar sesión y volver a entrar.
