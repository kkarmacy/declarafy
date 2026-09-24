// Targeted remediation of unsafe legacy demo claims, white-label preview and crypto FX.
(function (global) {
  'use strict';
  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const color = value => /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : '#C9A84C';

  function buildInformeDemo(estudio, firmante, periodo, cliente, notas, accent) {
    const name = esc(cliente?.nombre || 'Cliente');
    const alerts = Array.isArray(cliente?.alertas) ? cliente.alertas : [];
    const notes = notas ? '<p><strong>Notas aportadas (sin verificación):</strong> ' + esc(notas) + '</p>' : '';
    return '<div class="inf-header"><div class="inf-logo" style="color:' + color(accent) + '">' +
      esc(estudio) + '</div></div>' +
      '<div><strong>' + name + '</strong> — RUC ' + esc(cliente?.ruc || 'Sin verificar') +
      '<br>Informe preliminar · ' + esc(periodo) + '</div>' +
      '<div class="inf-alert">⚠️ Plantilla de demostración: no se ha comprobado la situación tributaria, ' +
      'la ausencia de contingencias ni los vencimientos específicos del contribuyente.</div>' +
      '<p><strong>Régimen declarado:</strong> ' + esc(cliente?.regimen || 'Pendiente') +
      ' · <strong>Sector:</strong> ' + esc(cliente?.sector || 'Pendiente') + '</p>' +
      alerts.map(item => '<div class="inf-alert">⚠️ Alerta informada, pendiente de validar: ' + esc(item) + '</div>').join('') +
      notes + '<p>Para completar el informe, contrasta las declaraciones, deuda, notificaciones ' +
      'y el cronograma oficial vigente de SUNAT según el RUC.</p>' +
      '<p>Atentamente,<br>' + esc(firmante) + '<br>' + esc(estudio) + '</p>';
  }

  function buildInformeHTML(estudio, firmante, periodo, cliente, body, accent) {
    const safeText = esc(body).replace(/\r?\n/g, '<br>');
    return '<div class="inf-header"><div class="inf-logo" style="color:' + color(accent) + '">' +
      esc(estudio) + '</div></div>' +
      '<div><strong>' + esc(cliente?.nombre || 'Cliente') + '</strong> — RUC ' +
      esc(cliente?.ruc || 'Pendiente') + '<br>Informe mensual · ' + esc(periodo) + '</div>' +
      '<div class="inf-alert">Contenido generado por IA: verificar normas, fechas, declaraciones ' +
      'y situación del contribuyente antes de entregar o firmar.</div>' +
      '<div style="white-space:normal">' + safeText + '</div>' +
      '<p>Atentamente,<br>' + esc(firmante) + '<br>' + esc(estudio) + '</p>';
  }

  function previewWLFull() {
    const studio = global.document.getElementById('wlNombre')?.value || 'Tu Estudio';
    const slogan = global.document.getElementById('wlSlogan')?.value || 'Asesoría tributaria';
    const background = typeof wlColor !== 'undefined' ? color(wlColor) : '#1A1A2E';
    const accent = typeof wlAccent !== 'undefined' ? color(wlAccent) : '#C9A84C';
    const popup = global.open('', '_blank');
    if (!popup) return;
    try { popup.opener = null; } catch (_) {}
    popup.document.open();
    popup.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' +
      esc(studio) + '</title><style>body{font-family:system-ui;background:' + background +
      ';color:white;text-align:center;padding:10vh 24px}.card{max-width:420px;margin:auto;' +
      'padding:40px;border:1px solid ' + accent + ';border-radius:16px}' +
      'h1{color:' + accent + '}</style></head><body><div class="card"><h1>' +
      esc(studio) + '</h1><p>' + esc(slogan) +
      '</p><p>Vista previa de marca — no representa una página publicada.</p></div></body></html>');
    popup.document.close();
  }

  function installCryptoFX() {
    if (typeof global.calcPortfolio !== 'function' || typeof global.renderPortfolio !== 'function') return;
    const originalCalc = global.calcPortfolio;
    const originalRender = global.renderPortfolio;
    const panel = global.document.getElementById('ptCriptoPortfolio') ||
      Array.from(global.document.querySelectorAll('[id^="pt"]')).find(el =>
        el.id.toLowerCase().replace(/[^a-z0-9]/g, '') === 'ptcriptoportfolio');
    if (!panel || global.document.getElementById('cryptoFxInput')) return;
    const wrapper = global.document.createElement('div');
    wrapper.id = 'cryptoFxControl';
    const label = global.document.createElement('label');
    label.htmlFor = 'cryptoFxInput';
    label.textContent = 'Tipo de cambio USD/PEN (ingreso manual y referencial)';
    const input = global.document.createElement('input');
    input.id = 'cryptoFxInput';
    input.type = 'number'; input.step = '0.0001'; input.min = '0.0001'; input.max = '100';
    input.placeholder = 'Ej.: 3.75 (verifica fuente y fecha)';
    const warning = global.document.createElement('p');
    warning.textContent = 'Sin TC verificado no se mostrará la conversión a soles. El P&L de mercado no es una liquidación tributaria.';
    wrapper.append(label, input, warning);
    panel.prepend(wrapper);
    const rate = () => {
      const n = Number(input.value);
      return input.value.trim() && Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
    };
    global.calcPortfolio = function () {
      const result = originalCalc.apply(this, arguments);
      return { ...result, tc: rate() || 0 };
    };
    global.renderPortfolio = function () {
      const result = originalRender.apply(this, arguments);
      const pen = global.document.getElementById('cpValPEN');
      if (pen && rate() === null) pen.textContent = 'TC pendiente';
      return result;
    };
    input.addEventListener('input', () => global.renderPortfolio());
    global.renderPortfolio();
  }

  function install() {
    global.buildInformeDemo = buildInformeDemo;
    global.buildInformeHTML = buildInformeHTML;
    global.previewWLFull = previewWLFull;
    installCryptoFX();
  }
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', install, { once: true });
  } else install();
})(window);
