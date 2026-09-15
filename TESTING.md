# Pruebas de Declarafy

## Qué comprueban

- La portada carga con CSS y JavaScript, sin errores críticos.
- El formulario de registro valida los datos antes de enviarlos.
- La portada no se desborda en un teléfono.
- Cada botón de la navegación apunta a un módulo existente.
- Los 19 módulos especializados abren contenido visible.
- Historial y Referidos conservan el diseño actualizado.
- La API de producción responde correctamente.
- La versión publicada coincide con la versión del repositorio.
- El inicio y cierre de sesión real se prueba únicamente si GitHub dispone de una cuenta E2E separada.

## Ejecutar en una computadora

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

El informe visual queda en `playwright-report/index.html`.

## Comprobar producción

```bash
PLAYWRIGHT_BASE_URL=https://declarafy.com npm run test:e2e
```

GitHub ejecuta automáticamente las pruebas locales en cada cambio. El flujo **Production smoke test** puede ejecutarse manualmente desde la pestaña **Actions** y también se ejecuta una vez al día.

Para habilitar la prueba de login real, crear una cuenta exclusiva para pruebas y guardar sus datos como secretos de GitHub llamados `E2E_USER_EMAIL` y `E2E_USER_PASSWORD`. Nunca usar la contraseña del superadministrador.
