# SUNAT: prueba de autenticación para ocho servicios

Este cambio añade al endpoint `POST /api/index.php?action=sunat_auth_test` una lista permitida de ocho identificadores de servicio. El usuario debe estar autenticado y ser superadministrador.

## Identificadores disponibles

| Identificador | Servicio | Scope |
|---|---|---|
| `controlcpe` | MIGE Gestión Factoring | `/v1/contribuyente/controlcpe` |
| `controlmsg` | Control de mensajes y alertas | `/v1/contribuyente/controlmsg` |
| `enviossp` | SSPP Receptor XML | `/v1/contribuyente/enviossp` |
| `programacion` | Consulta ACE | `/v1/controladuanero/programacion` |
| `documentossustentatorios` | Transmisión de documentos digitalizados | `/v1/controladuanero/documentossustentatorios` |
| `salida` | Control Aduanero Salida | `/v1/controladuanero/salida` |
| `autorizacionsalida` | Declaraciones asociadas a documentos de transporte | `/v1/controladuanero/autorizacionsalida` |
| `ingreso` | Control Aduanero Ingreso | `/v1/controladuanero/ingreso` |

## Petición esperada

Enviar una petición POST con JSON, seleccionando un solo servicio por petición:

```json
{ "service": "controlmsg" }
```

La autenticación se realiza desde el servidor. No enviar credenciales desde el navegador ni devolver el token de acceso a la interfaz.

## Importante antes de producción

El endpoint de esta rama utiliza el flujo `clientessol` con `grant_type=password`. No se debe asumir que todos los servicios aceptan ese mismo flujo. Antes de desplegar, verificar la documentación y el registro de aplicación de SUNAT para cada servicio. Obtener un token no prueba que se pueda ejecutar una operación de negocio; cada API necesita una prueba funcional específica.

## Configuración de servidor

Las credenciales deben permanecer en `api/config.local.php`, fuera del repositorio. El campo único `sunat_oauth_scope` deja de ser necesario para esta prueba porque el servidor elige el scope desde la lista permitida. No añadir secretos al repositorio ni a los logs.
