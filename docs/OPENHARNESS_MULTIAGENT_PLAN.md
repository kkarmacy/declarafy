# Plan técnico: coordinación multiagente para Declarafy con OpenHarness

**Estado:** propuesta técnica / solo documentación.  
**Repositorio:** `kkarmacy/declarafy`  
**Rama de trabajo:** `docs/openharness-multiagent-plan`  
**Producción:** no modificada por este cambio.

## 1. Objetivo

Diseñar una primera versión de coordinación multiagente que aproveche patrones de OpenHarness (delegación de tareas, herramientas tipadas, permisos, hooks, trazabilidad y validación), sin copiar ni instalar su runtime Python en el hosting de Declarafy por defecto.

Declarafy actualmente usa frontend HTML/CSS/JavaScript, PHP 8.3 y MySQL/MariaDB en Namecheap/cPanel. La solución inicial debe respetar esa arquitectura y minimizar costes.

## 2. Decisión de arquitectura

### Primera etapa: coordinador PHP, sin servicio Python persistente

Implementar un coordinador del lado servidor en PHP que:
1. autentique al usuario mediante el flujo actual de Declarafy;
2. autorice el módulo solicitado y compruebe plan/cuotas;
3. seleccione un flujo de trabajo permitido mediante una lista explícita de agentes;
4. invoque herramientas internas de solo lectura o cálculos deterministas;
5. valide la salida y registre metadatos mínimos de auditoría;
6. devuelva una respuesta estructurada al frontend.

OpenHarness será inicialmente una referencia de diseño y una fuente de patrones que deben evaluarse. No se debe afirmar compatibilidad directa entre su runtime Python y PHP sin una prueba de concepto.

### Agentes iniciales (roles lógicos, no procesos autónomos)

- **Coordinador:** descompone la petición en pasos predefinidos y limita el número de pasos.
- **Agente tributario:** consulta reglas y fuentes oficiales aprobadas; identifica fecha y jurisdicción de la fuente.
- **Agente documental:** interpreta metadatos y resultados de importación; no ejecuta archivos ni código suministrado por el usuario.
- **Agente validador:** comprueba coherencia, cálculos, campos obligatorios y referencias; puede devolver “requiere revisión”.
- **Agente de informe:** compone la respuesta final a partir de resultados ya validados.

En la primera versión los roles deben ser funciones controladas por el servidor. No deben tener acceso arbitrario a shell, sistema de archivos, SQL, credenciales, red ni endpoints administrativos.

## 3. Flujo de petición

1. Recibir una petición autenticada desde el frontend existente.
2. Validar método HTTP, CSRF/origen según los mecanismos actuales, tamaño y esquema de entrada.
3. Resolver la identidad de usuario en el servidor; ignorar cualquier `user_id`, rol o plan enviado como autoridad por el navegador.
4. Comprobar permiso del módulo, plan, cuota y rate limit.
5. Construir un contexto mínimo y aislado del usuario actual.
6. Ejecutar los roles autorizados en secuencia o con paralelismo limitado solo si resulta seguro.
7. Validar salida, referencias, límites de longitud y formato.
8. Registrar identificador de solicitud, agentes ejecutados, tiempos, consumo aproximado, resultado y errores sin guardar secretos ni documentos fiscales completos innecesariamente.
9. Responder con JSON estable; fallar de forma segura ante timeout, proveedor caído o salida inválida.

## 4. Límites de seguridad obligatorios

- No modificar `api/config.local.php` ni incluir secretos en Git.
- No enviar contraseñas, tokens SUNAT, claves Culqi ni credenciales completas a un modelo.
- No permitir que un agente active planes, procese pagos, cambie roles, modifique usuarios o ejecute consultas SQL arbitrarias.
- No ejecutar código, comandos de shell, macros ni instrucciones contenidas en archivos cargados.
- Tratar documentos, textos recuperados y resultados de herramientas como datos no confiables; ignorar instrucciones embebidas que intenten cambiar permisos.
- Aplicar autorización del lado servidor a cada herramienta y cada acceso a datos; aislamiento estricto por usuario/tenant.
- Validar URLs contra SSRF, deshabilitar redirecciones no confiables y usar allowlists para fuentes externas.
- Establecer límites de tiempo, tamaño, pasos, concurrencia y coste por petición; cancelar al alcanzar límites.
- Mantener secretos fuera de logs y devolver errores genéricos al usuario.
- Mantener la función deshabilitada por defecto mediante una bandera de configuración del lado servidor hasta superar las pruebas.

## 5. Compatibilidad con Namecheap/cPanel y coste

- No asumir que el plan de hosting admite procesos Python persistentes, workers o servicios ASGI.
- Evitar una dependencia obligatoria de un microservicio externo para la primera prueba.
- No introducir un proveedor de IA de pago nuevo por defecto. Reutilizar únicamente la configuración de proveedor que ya exista y aplicar límites de uso.
- Si después se demuestra que OpenHarness necesita su runtime Python completo, evaluar primero una prueba aislada y un presupuesto explícito. No desplegar un servicio externo sin aprobación.
- No añadir cron, colas persistentes ni nuevas tablas a producción en esta fase.

## 6. Plan de implementación por fases

### Fase A — Auditoría de solo lectura
- Mapear los módulos y endpoints actuales que podrían exponerse como herramientas.
- Revisar autenticación, CSRF, cuotas, proveedores de IA, logs y pruebas existentes.
- Confirmar versión de PHP y capacidades reales de cPanel desde información disponible; no asumirlas.
- Identificar rutas de lectura seguras y acciones que deben quedar excluidas.

### Fase B — Prototipo aislado
- Crear el coordinador detrás de una bandera desactivada por defecto.
- Definir contratos JSON de entrada/salida y una allowlist pequeña de herramientas de solo lectura.
- Simular proveedores y datos fiscales en pruebas unitarias; no usar datos reales de clientes.
- Añadir roles deterministas antes de permitir llamadas a modelos.

### Fase C — Pruebas funcionales y de seguridad
- Pruebas unitarias para enrutamiento, validación y límites.
- Pruebas de integración con proveedores simulados y fallos/timeout.
- Pruebas de autorización: usuario A no puede leer datos de usuario B; plan insuficiente no puede ejecutar la tarea.
- Pruebas de prompt injection desde solicitudes y documentos.
- Pruebas de SSRF, payloads grandes, salida JSON malformada, rate limiting y coste máximo.
- Ejecutar `npm test` y las pruebas E2E disponibles; agregar pruebas PHP si el repositorio no tiene cobertura suficiente.
- Ejecutar análisis de dependencias y revisión manual del diff.

### Fase D — Revisión previa a cualquier despliegue
- Abrir PR borrador y mantenerlo sin fusionar hasta revisar CI, diff y riesgos.
- Hacer pruebas en local/entorno de prueba con datos sintéticos.
- Confirmar respaldo y procedimiento de reversión antes de cualquier despliegue futuro.
- Solicitar autorización explícita antes de fusionar o tocar Namecheap/cPanel.
- No importar `api/schema.sql`, no recrear tablas y no modificar archivos de configuración de producción como parte de esta iniciativa.

## 7. Criterios de aceptación

- La rama y el PR contienen inicialmente documentación, no cambios funcionales.
- Ninguna ruta nueva queda expuesta en producción.
- Los roles no pueden acceder a herramientas no incluidas en la allowlist.
- Toda operación está ligada a una sesión autenticada y autorización del servidor.
- Los tests demuestran aislamiento entre usuarios y fallo seguro.
- Se conoce el coste máximo por solicitud o la función permanece deshabilitada.
- CI está verde y un revisor confirma el diff antes de habilitar cualquier función.

## 8. Decisión pendiente

Tras la auditoría de código, decidir si la coordinación se implementa enteramente en PHP o si un prototipo separado justifica un runtime Python. La segunda opción no se debe seleccionar hasta verificar compatibilidad real de hosting, seguridad, coste y mantenimiento.

## Referencias

- OpenHarness: https://github.com/HKUDS/OpenHarness
- Arquitectura y despliegue de Declarafy: `README.md`, `NAMECHEAP_DEPLOYMENT.md`, `TESTING.md`
