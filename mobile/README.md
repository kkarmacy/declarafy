# Declarafy Mobile MVP

Aplicación móvil de Declarafy construida con Expo, React Native y TypeScript.

## Estado actual
- Bienvenida, login y restauración de sesión con SecureStore
- Dashboard y perfil
- Permisos por módulo con soporte para `features` entregadas por el backend
- IA Fiscal
- Consulta RUC con validación
- Calendario
- Calculadora de IGV
- TIM con parámetro remoto
- Simulador financiero de fraccionamiento
- Manejo de timeout, errores de red y respuestas 401/403/429
- CI móvil con TypeScript typecheck

## Contrato API esperado por la app
La URL base se configura con `EXPO_PUBLIC_API_BASE_URL`. El valor por defecto actual es `https://declarafy.com/api`, pero debe confirmarse contra el backend PHP real antes de producción.

| Método | Ruta esperada | Uso |
| --- | --- | --- |
| POST | `/auth/login` | Autenticación |
| GET | `/auth/me` | Perfil, plan y permisos |
| GET | `/ruc/:ruc` | Consulta RUC |
| GET | `/calendar` | Calendario |
| POST | `/ai/fiscal` | IA Fiscal |
| GET | `/tax/parameters` | Parámetros tributarios remotos |

Respuesta de usuario esperada:
```json
{
  "id": 1,
  "name": "Usuario",
  "email": "usuario@ejemplo.com",
  "plan": "professional",
  "features": ["ai-fiscal", "calendar", "ruc", "calculators", "tim", "installments"]
}
```

Si `features` viene del servidor, la app usa esa lista como fuente de permisos. La matriz local por plan queda únicamente como fallback temporal. La autorización definitiva debe validarse también en el servidor.

## Pendiente antes de producción
1. Confirmar las rutas y formatos reales del backend PHP.
2. Adaptar estos contratos si el backend usa nombres o sesiones diferentes.
3. Validar permisos en cada endpoint del servidor.
4. Ejecutar pruebas de integración con cuentas Free, Professional y Enterprise.
5. Revisar dependencias y vulnerabilidades reportadas por npm.
6. Generar y probar el build Android.

## Desarrollo
```bash
cd mobile
npm install
npm run typecheck
npm start
```

## Seguridad
El desarrollo móvil permanece aislado en su rama. No fusionar a `main` hasta confirmar el contrato real del backend y completar las pruebas de integración.
