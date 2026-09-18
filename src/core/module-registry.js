(function (global) {
  'use strict';

  const domains = [
    { id:'home', label:'Inicio', modules:['Dashboard'] },
    { id:'companies', label:'Mis Empresas', modules:['Plan Empresa','Plan Anual','Mi Perfil'] },
    { id:'sunat', label:'SUNAT', modules:['Alertas RUC','Consultar SUNAT','Detector PDT','Importar PDT','PDT 621','Multas SUNAT','Fraccionamiento','ITAN','Intereses TIM','Requerimientos','Informes SUNAT','Simulador SUNAT','Ret./Perc.'] },
    { id:'accounting', label:'Contabilidad', modules:['Análisis EEFF','Cierre Contable','Depreciaciones','Liquidación','Utilidades','Facturación','Excel / Sheets','Calculadora','Estadísticas'] },
    { id:'legal', label:'Fiscal & Legal', modules:['Cambios Normativos','Monitor Normas','Biblioteca','CDI','Cripto Legal','Cripto/Digital','D. Comparado','INDECOPI','NIIF','Trib. Fiscal','SUNAFIL','Precios Transfer.'] },
    { id:'ai', label:'IA Fiscal', modules:['IA Fiscal','Comparador','Simulador'] },
    { id:'documents', label:'Documentos', modules:['Generador Docs','Cartas Clientes','Contratos','Informe Ejecutivo','OCR Factura'] },
    { id:'cases', label:'Casos', modules:['Casos','Expediente','Calendario','Historial'] },
    { id:'trade', label:'Comercio Exterior', modules:['Clasificador HS','Drawback'] },
    { id:'economic-data', label:'Datos Económicos', modules:['BCR','SBS','Moneda SBS','SMV'] },
    { id:'tools', label:'Herramientas', modules:['API','Widget'] },
    { id:'admin', label:'Administración', modules:['Dashboard Admin','Privacidad','Términos','Sugerencias'] }
  ];

  const aliases = {
    '🔔 Alertas RUC':'Alertas RUC','📊 Análisis EEFF':'Análisis EEFF','🔌 API':'API','🏛 BCR':'BCR',
    '📜 Cambios Normativos':'Cambios Normativos','✉️ Cartas Clientes':'Cartas Clientes','🗂 Casos':'Casos',
    '🌐 CDI':'CDI','📅 Cierre Contable':'Cierre Contable','📦 Clasificador HS':'Clasificador HS',
    '🔍 Consultar SUNAT':'Consultar SUNAT','📜 Contratos':'Contratos','₿⚖️ Cripto Legal':'Cripto Legal',
    '₿ Cripto/Digital':'Cripto/Digital','🌎 D. Comparado':'D. Comparado','📉 Depreciaciones':'Depreciaciones',
    '🔍 Detector PDT':'Detector PDT','📦 Drawback':'Drawback','📊 Excel / Sheets':'Excel / Sheets','🗂 Expediente':'Expediente',
    '🧾 Facturación':'Facturación','🏦 Fraccionamiento':'Fraccionamiento','🎯 IA Fiscal':'IA Fiscal','📂 Importar PDT':'Importar PDT',
    '🏛 INDECOPI':'INDECOPI','📑 Informe Ejecutivo':'Informe Ejecutivo','📌 Informes SUNAT':'Informes SUNAT',
    '⏱ Intereses TIM':'Intereses TIM','🏛 ITAN':'ITAN','🧾 Liquidación':'Liquidación','💱 Moneda SBS':'Moneda SBS',
    '📡 Monitor Normas':'Monitor Normas','⚖️ Multas SUNAT':'Multas SUNAT','📐 NIIF':'NIIF','📸 OCR Factura':'OCR Factura',
    '🎁 Plan Anual':'Plan Anual','🏢 Plan Empresa':'Plan Empresa','🔗 Precios Transfer.':'Precios Transfer.',
    '📬 Requerimientos':'Requerimientos','🔄 Ret./Perc.':'Ret./Perc.','🏦 SBS':'SBS','🔮 Simulador':'Simulador',
    '📈 SMV':'SMV','💡 Sugerencias':'Sugerencias','👷 SUNAFIL':'SUNAFIL','⚖️ Trib. Fiscal':'Trib. Fiscal',
    '👥 Utilidades':'Utilidades','🔌 Widget':'Widget'
  };

  function canonical(name) { return aliases[name] || String(name || '').trim(); }
  function domainFor(moduleName) {
    const name = canonical(moduleName);
    return domains.find(d => d.modules.includes(name)) || null;
  }
  function all() { return domains.map(d => ({...d, modules:[...d.modules]})); }

  global.DeclarafyModules = { domains: all(), canonical, domainFor, all };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.DeclarafyModules;
})(typeof window !== 'undefined' ? window : globalThis);
