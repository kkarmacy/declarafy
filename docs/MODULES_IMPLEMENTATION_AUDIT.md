# Auditoría de módulos mencionados

Fecha: 2026-09-17
Rama: implement-mentioned-modules

## Objetivo
Convertir las entradas del catálogo señaladas por el usuario en herramientas reales y coherentes. No se considerará "implementado" un módulo solo porque tenga nombre, tab o texto descriptivo.

## Criterio de terminado por módulo
1. Pantalla propia y comprensible.
2. Entradas con etiquetas, ayuda y validación.
3. Acción o cálculo funcional, o flujo documental cuando no corresponda calcular.
4. Resultado estructurado con estado vacío/error.
5. Parámetros normativos identificados; no inventar tasas vigentes.
6. Fuente/base legal y fecha cuando el resultado dependa de normativa.
7. Responsive y accesible.
8. Prueba automatizada de presencia/contrato mínimo.
9. Sin romper navegación, login, IA ni módulos existentes.

## Hallazgos iniciales
La auditoría confirma tres estados distintos:
- **Desarrollados pero requieren revisión normativa/UI:** AFP Comisiones, Asignación Familiar, Cierre Fiscal, TIM Histórico, Compensación, Exoneración Detracción, Horas Extras, Régimen Agrario/MYPE y Arbitrios, entre otros.
- **Desarrollados con interfaz sustancial:** Portafolio Cripto y varios módulos especializados.
- **Entradas sin implementación independiente claramente localizable:** varios nombres del catálogo requieren construcción o vinculación correcta.

## Riesgos detectados que bloquean considerar algunos módulos listos
- AFP Comisiones contiene la misma comisión y prima codificada para todas las AFP; debe usar parámetros verificables/configurables.
- Asignación Familiar aplica un criterio de tope salarial en la lógica que debe revisarse contra la regla vigente antes de producir una conclusión.
- TIM Histórico usa una tabla de tasas codificada; debe documentarse y verificarse por período/fuente.
- Exoneración Detracción/SPOT contiene topes, categorías y tasas codificadas que requieren validación normativa.
- Régimen Agrario/MYPE mezcla parámetros tributarios y laborales codificados y referencias históricas; requiere separar régimen, período y fuente.
- Arbitrios usa valores distritales explícitamente referenciales; no debe presentarlos como liquidación municipal oficial.

## Orden de trabajo
### Fase A — Seguridad normativa y UX
AFP Comisiones; AFP vs ONP; Asignación Familiar; Cierre Fiscal; TIM Histórico; Moras SUNAT; SPOT/Exoneración Detracción; Régimen Agrario/MYPE; Arbitrios.

### Fase B — Tributario/contable
Amazonía; Compensación Deudas; Conciliación; Conversor Tasas; CTS/Gratificación; Dividendos; Flujo Caja; Gen. PDT; Importación; IR 5ta; ISC; ITF; Percepciones; Renta Anual; RMT vs RER; RUS; Saldo Favor Exportador; Selector Régimen; Suspensión; T-Registro; TEA Multas; Val. Fact. Elect.; WHT Tax.

### Fase C — Legal/compliance
Analizador Contratos; Cobranza Coactiva; Compliance; Docs. Legales; Donaciones; Lavado Activos; No Domiciliados; Radar Norm.; Rectif. PDT; Recurso Multa SUNAT; Royalties; Sucesiones; Verificador RUC.

### Fase D — Finanzas y operaciones
Análisis Avanzado; Leasing Financiero/Operativo; Minería/Regalías; Nómina; Pérdida Arrastrable; Portafolio Cripto; Proyección AFP; Guías Remisión; Notas Crédito; ONP; ESSALUD/SENATI; Horas Extras; Validador.

## Regla de integración
Los cambios se harán en esta rama y pasarán CI/browser tests antes de crear/autorizar el PR de merge. No se modifica `main` directamente.
