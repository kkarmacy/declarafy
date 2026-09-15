# Declarafy — Core Modules Redesign

## Objetivo
Transformar los módulos existentes en una plataforma integrada, centrada en empresa/contribuyente, evitando pantallas aisladas y duplicación de datos.

## Principio central: contexto único de empresa
Todo módulo funcional debe consumir un `companyContext` común con, como mínimo: `companyId`, `ruc`, `legalName`, `taxRegime`, `period`, `permissions` y `lastUpdatedAt`. El usuario selecciona una empresa una vez y el contexto se conserva al navegar.

## Navegación objetivo
1. Inicio
2. Mis Empresas
3. SUNAT
4. Contabilidad
5. Fiscal & Legal
6. IA Fiscal
7. Documentos
8. Casos
9. Comercio Exterior
10. Datos Económicos
11. Herramientas
12. Administración

Los módulos actuales se conservan como submódulos para no romper rutas existentes.

## Dominios

### SUNAT & Cumplimiento
Alertas RUC, Consultar SUNAT, Detector PDT, Importar PDT, PDT 621, Multas SUNAT, Fraccionamiento, ITAN, Intereses TIM, Requerimientos, Informes SUNAT, Simulador SUNAT y Retenciones/Percepciones.

Flujo objetivo: empresa -> obligaciones -> declaraciones -> alertas -> requerimientos -> expediente -> informe.

### Contabilidad & Finanzas
Análisis EEFF, Cierre Contable, Depreciaciones, Liquidación, Utilidades, Facturación, Excel/Sheets, Calculadora y Estadísticas.

Análisis EEFF debe normalizar Balance y Estado de Resultados y calcular liquidez, endeudamiento, cobertura, márgenes, ROA, ROE, capital de trabajo, EBITDA, Altman Z-Score y tendencias.

### IA Tributaria
IA Fiscal, Informe Ejecutivo, Comparador, Simulador, Generador Docs, Cartas Clientes y Contratos.

IA Fiscal debe utilizar el contexto de empresa y producir respuestas con diagnóstico, riesgo, fundamento/fuente, fecha de vigencia y acciones recomendadas. No debe presentar una inferencia de IA como norma vigente.

### Normativa & Legal
Cambios Normativos, Monitor Normas, Biblioteca, CDI, Cripto Legal, Cripto/Digital, Derecho Comparado, INDECOPI, NIIF, Tribunal Fiscal y SUNAFIL.

Cambios Normativos y Monitor Normas comparten una sola fuente normalizada: entidad emisora, número, publicación, vigencia, tema, resumen, impacto, fuente oficial y empresas potencialmente afectadas.

### Comercio Exterior
Clasificador HS y Drawback. Clasificación asistida debe conservar sustento, historial y cálculo relacionado.

### Datos Económicos
BCR, SBS, Moneda SBS y SMV comparten una capa de datos y caché. Las pantallas son vistas especializadas del mismo servicio.

### Gestión del cliente
Casos, Expediente, Calendario, Historial, Mi Perfil, Plan Anual y Plan Empresa.

Requerimiento -> Caso -> Expediente es un flujo único con documentos, fechas, tareas, responsables, notas, estado y respuestas.

### Plataforma
API, Widget, Dashboard Admin, Privacidad, Términos y Sugerencias. Incorporar permisos, auditoría, métricas, configuración y contratos estables de API.

## Contratos compartidos

### companyContext
```js
{
  companyId: string,
  ruc: string,
  legalName: string,
  taxRegime: string|null,
  period: string|null,
  permissions: string[],
  lastUpdatedAt: string|null
}
```

### moduleResult
```js
{
  ok: boolean,
  data: unknown,
  warnings: [],
  sources: [],
  generatedAt: string,
  companyId: string|null,
  period: string|null
}
```

### regulatorySource
```js
{
  authority: string,
  documentNumber: string,
  title: string,
  publishedAt: string|null,
  effectiveAt: string|null,
  officialUrl: string|null,
  retrievedAt: string
}
```

## Reglas de UX
- No volver a pedir RUC si existe empresa activa.
- Mostrar empresa y periodo activos en módulos dependientes de contexto.
- Distinguir `dato oficial`, `cálculo`, `estimación` y `análisis IA`.
- Toda operación destructiva requiere confirmación.
- Errores deben indicar qué ocurrió y cómo recuperarse.
- Estados mínimos: loading, empty, success, partial y error.
- Mantener rutas legacy durante la migración.

## Prioridad de implementación
P0: contexto único de empresa, navegación y contratos compartidos.
P1: Centro SUNAT/PDT y Alertas RUC.
P1: IA Fiscal contextual.
P1: Análisis EEFF e Informe Ejecutivo.
P2: Casos/Expediente/Requerimientos.
P2: Normativa/Monitor/Biblioteca.
P2: Generación documental.
P3: BCR/SBS/SMV y módulos especializados.

## Restricción técnica
`app.js` supera aproximadamente 1 MB en la rama de partida. No se deben añadir nuevos dominios directamente al monolito. Las nuevas implementaciones deben vivir en módulos separados y exponerse gradualmente mediante adaptadores compatibles con las rutas existentes.
