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
  formal:        { label:'D. Formal',            scope:'formal' },
  procesal:      { label:'D. Procesal',          scope:'procesal' },
  penal:         { label:'D. Penal',             scope:'penal' },
  constitucional:{ label:'D. Constitucional',    scope:'constitucional' },
  internacional: { label:'D. Internacional',     scope:'internacional' },
  lavado:        { label:'Lavado de Dinero',     scope:'lavado' },
};

const SYS = 'Eres DeclaraFY, un asesor tributario y aduanero experto en Perú. Respondes en español, de forma clara, profesional y concisa. Usas la base legal peruana vigente (Código Tributario, LIR, LIGV, etc.). Si no tienes suficiente información para una respuesta precisa, lo indicas y recomiendas consultar con un contador o abogado tributarista.';

const ADMIN_EMAIL = 'christian@declarafy.com';
const FREE = 30;
const DECLARAFY_PROXY_URL = 'https://us-central1-declarafy-52bc1.cloudfunctions.net/claudeProxy';
const DECLARAFY_FN_BASE = 'https://us-central1-declarafy-52bc1.cloudfunctions.net';

// Never persist a provider credential in the browser. app.js uses any truthy
// non-sk-ant value as a signal to use the authenticated Cloud Function proxy.
try {
  const storedAnthropicKey = localStorage.getItem('tp_anthropic_key');
  if (!storedAnthropicKey || storedAnthropicKey.startsWith('sk-ant-')) {
    localStorage.setItem('tp_anthropic_key', 'declarafy-proxy');
  }
} catch (_) {}

// app.js is a legacy monolith. Apply narrow runtime overrides after all classic
// scripts have loaded, without changing the million-byte bundle in-place.
window.addEventListener('DOMContentLoaded', () => {
  // Sanitize AFTER Markdown expansion, which closes the old link-attribute XSS.
  if (typeof DOMPurify !== 'undefined' && typeof _escapeHtml === 'function') {
    _mdFormat = function(text) {
      const escaped = _escapeHtml(String(text));
      const expanded = escaped
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => {
          const u = String(url).trim();
          if (!/^https?:\/\//i.test(u)) return txt;
          const safeUrl = _escapeHtml(u);
          return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
        })
        .replace(/\n/g, '<br>');
      return DOMPurify.sanitize(expanded, {
        ALLOWED_TAGS: ['strong', 'em', 'br', 'a'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
        ALLOWED_URI_REGEXP: /^https?:\/\//i
      });
    };
  }

  // File names are untrusted input; render them through textContent, not HTML.
  renderChips = function() {
    const el = document.getElementById('chips');
    if (!el) return;
    el.replaceChildren();
    attached.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.appendChild(document.createTextNode(`📎 ${file.name}`));
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Quitar archivo');
      button.textContent = '×';
      button.addEventListener('click', () => removeChip(index));
      chip.appendChild(button);
      el.appendChild(chip);
    });
  };

  // BYOK in localStorage made a successful XSS equivalent to API-key theft.
  // Keep the product on the server-side proxy and erase keys entered in legacy UI.
  saveKey = function() {
    try { localStorage.setItem('tp_anthropic_key', 'declarafy-proxy'); } catch (_) {}
    const inp = document.getElementById('apiInp');
    if (inp) inp.value = '';
    const errEl = document.getElementById('apiErr');
    if (errEl) errEl.textContent = '';
    document.getElementById('apiOv')?.classList.add('hidden');
    if (typeof addNotif === 'function') addNotif('🔐', 'Conexión segura activa', 'DeclaraFY usa el proxy autenticado; no guarda claves de proveedor en el navegador.');
  };

  // 2026 ONP corrections.
  // D.S. 330-2025-EF set the SNP maximum pension at S/ 1,000 from January 2026.
  // Ley 31301 allows proportional pensions with 10-14 and 15-19 years of contributions.
  if (typeof calcOnp === 'function') {
    calcOnp = function() {
      const sueldo = parseFloat(document.getElementById('onp_sueldo')?.value) || 0;
      const edad = parseInt(document.getElementById('onp_edad')?.value, 10) || 30;
      const jubilacion = parseInt(document.getElementById('onp_jubilacion')?.value, 10) || 65;
      const anios = parseInt(document.getElementById('onp_anios')?.value, 10) || 0;
      const fondo = parseFloat(document.getElementById('onp_fondo')?.value) || 0;
      const aporte = sueldo * 0.13;
      const aporteAnual = aporte * 12;
      const fondoReferencial = fondo + aporteAnual * Math.max(0, jubilacion - edad);
      const div = document.getElementById('onpResult');
      const aporteInput = document.getElementById('onp_aporte');
      if (aporteInput) aporteInput.value = `S/ ${aporte.toFixed(2)}`;
      if (!div) return;
      if (!sueldo) { div.style.display = 'none'; return; }

      let pensionText = 'Cálculo oficial requerido';
      let requisito = '';
      if (anios >= 20) {
        pensionText = 'Hasta S/ 1,000/mes';
        requisito = 'Régimen general: 20+ años de aportes. El monto exacto lo determina la ONP.';
      } else if (anios >= 15) {
        pensionText = 'S/ 400/mes';
        requisito = 'Pensión proporcional especial: 15 a menos de 20 años de aportes.';
      } else if (anios >= 10) {
        pensionText = 'S/ 300/mes';
        requisito = 'Pensión proporcional especial: 10 a menos de 15 años de aportes.';
      } else {
        requisito = `Aún no alcanza el mínimo de 10 años para pensión proporcional; faltan ${10 - anios} año(s).`;
      }

      div.style.display = '';
      div.innerHTML = '<div class="res-table"><table>' +
        '<tr><td>Aporte mensual ONP (13%)</td><td style="text-align:right">S/ ' + aporte.toFixed(2) + '</td></tr>' +
        '<tr><td>Años cotizados</td><td style="text-align:right">' + anios + '</td></tr>' +
        '<tr><td>Referencia de pensión</td><td style="text-align:right;font-weight:600;color:var(--green)">' + pensionText + '</td></tr>' +
        '<tr><td>Aportes proyectados hasta jubilación</td><td style="text-align:right">S/ ' + fondoReferencial.toFixed(2) + '</td></tr>' +
        '<tr><td colspan="2" style="font-size:14px;color:var(--muted);text-align:center">ℹ️ ' + requisito + ' Máximo SNP vigente desde enero de 2026: S/ 1,000.</td></tr>' +
        '</table></div>';
    };
  }

  if (typeof calcAfpOnp === 'function') {
    const legacyCalcAfpOnp = calcAfpOnp;
    calcAfpOnp = function() {
      legacyCalcAfpOnp();
      const div = document.getElementById('afponpResult');
      if (!div) return;
      div.innerHTML = div.innerHTML
        .replace(/S\/\s*893(?:\.00)?\/mes/g, 'S/ 1,000.00/mes')
        .replace(/Pensión estimada ONP \(máx\)/g, 'Referencia máxima ONP 2026')
        .replace(/Te faltan ([0-9]+) años para pensión mínima ONP \(20 años\)/g, 'Existe pensión proporcional ONP desde 10 años; para régimen general se requieren 20 años');
    };
  }
});
