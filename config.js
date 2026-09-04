// ════════════════════════════════════════
// config.js — Constants, configuration, data
// ════════════════════════════════════════

const AREAS = {
  general:       { label:'General',             scope:'general' },
  igv:           { label:'IGV',                 scope:'igv' },
  renta:         { label:'Impuesto a la Renta', scope:'renta' },
  isc:           { label:'ISC',                 scope:'isc' },
  itf:           { label:'ITF',                 scope:'itf' },
  arancel:       { label:'Arancel',             scope:'arancel' },
  nrus:          { label:'NRUS',                scope:'nrus' },
  vehicular:     { label:'Vehicular',           scope:'vehicular' },
  aduanas:       { label:'Aduanas',             scope:'aduanas' },
  planificacion: { label:'Planificación',       scope:'planificacion' },
  pt:            { label:'Precios Transfer.',   scope:'pt' },
  material:      { label:'D. Material',         scope:'material' },
  formal:        { label:'D. Formal',           scope:'formal' },
  procesal:      { label:'D. Procesal',         scope:'procesal' },
  penal:         { label:'D. Penal',            scope:'penal' },
  constitucional:{ label:'D. Constitucional',   scope:'constitucional' },
  internacional: { label:'D. Internacional',    scope:'internacional' },
  lavado:        { label:'Lavado de Dinero',    scope:'lavado' },
};

const SYS = 'Eres DeclaraFY, un asesor tributario y aduanero experto en Perú. Respondes en español, de forma clara, profesional y concisa. Usas la base legal peruana vigente (Código Tributario, LIR, LIGV, etc.). Si no tienes suficiente información para una respuesta precisa, lo indicas y recomiendas consultar con un contador o abogado tributarista.';

const ADMIN_EMAIL = 'christian@declarafy.com';
const FREE = 30;
const DECLARAFY_PROXY_URL = 'https://us-central1-declarafy-52bc1.cloudfunctions.net/claudeProxy';
const DECLARAFY_FN_BASE = 'https://us-central1-declarafy-52bc1.cloudfunctions.net';
