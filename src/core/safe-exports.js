// Isolated print/export hardening for legacy modules. No changes to tax calculations.
(function (global) {
  'use strict';

  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const lineBreaks = value => escapeHtml(value).replace(/\r?\n/g, '<br>');
  const safeColor = value => /^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : '#C9A84C';

  function writeReport(title, body, accent) {
    const popup = global.open('', '_blank');
    if (!popup) {
      if (typeof global.tpToast === 'function') global.tpToast('Permite las ventanas emergentes para imprimir el informe.', 'warn');
      return false;
    }
    // Print content is same-origin about:blank; detach it from the main app.
    try { popup.opener = null; } catch (_) {}
    const color = safeColor(accent);
    popup.document.open();
    popup.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' +
      escapeHtml(title) +
      '</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:38px auto;color:#263044;line-height:1.65;font-size:14px}' +
      'header{border-bottom:3px solid ' + color + ';padding-bottom:12px;margin-bottom:22px}' +
      'h1{font-size:22px;color:' + color + ';margin:0}.meta{color:#677185;font-size:13px;margin-top:7px}' +
      'article{white-space:normal}.item{padding:12px;border:1px solid #ddd;border-radius:7px;margin-bottom:12px}' +
      '.item strong{display:block;margin-bottom:4px}.report-content{white-space:pre-wrap;overflow-wrap:anywhere}' +
      'footer{margin-top:25px;border-top:1px solid #ddd;padding-top:10px;color:#667;font-size:12px}' +
      '@media print{body{margin:15px}}</style></head><body>' +
      body + '</body></html>');
    popup.document.close();
    global.setTimeout(() => popup.print(), 350);
    return true;
  }

  function exportPDF() {
    const messages = global.document.getElementById('messages');
    if (!messages) return;
    let cfg = {};
    try {
      const key = typeof global.WL_KEY === 'function' ? global.WL_KEY() : '';
      if (key) cfg = JSON.parse(global.localStorage.getItem(key) || '{}');
    } catch (_) {}
    const studio = cfg.nombre || global.curUser?.studio || global.curUser?.name || 'DeclaraFY';
    const area = global.AREAS?.[global.curArea]?.label || 'General';
    const date = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
    const body = Array.from(messages.querySelectorAll('.msg')).map(message => {
      const who = message.classList.contains('user') ? 'Consulta' : 'DeclaraFY';
      const text = message.querySelector('.bbl')?.innerText || '';
      return '<div class="item"><strong>' + who + '</strong><div>' + lineBreaks(text) + '</div></div>';
    }).join('');
    const header = '<header><h1>' + escapeHtml(studio) + '</h1><div class="meta">Área: ' +
      escapeHtml(area) + ' · ' + escapeHtml(date) + '</div></header>';
    const footer = '<footer>Documento orientativo generado por Declarafy. Consulta con un profesional para decisiones formales.</footer>';
    if (writeReport(studio + ' — Consulta Tributaria', header + '<article>' + body + '</article>' + footer, cfg.color)) {
      if (typeof global.tpAuditLog === 'function') global.tpAuditLog('export', 'PDF: ' + area);
    }
  }

  function exportInformeMensual() {
    const select = global.document.getElementById('infClienteSel');
    const client = Array.isArray(global.crmClients) ? global.crmClients.find(item => item.id === select?.value) : null;
    const studio = global.document.getElementById('infEstudio')?.value || 'Estudio';
    const preview = global.document.getElementById('infPreview');
    if (!preview) return;
    // Use textContent rather than copying unsanitized rich HTML to a new document.
    const body = preview.innerText || preview.textContent || '';
    const header = '<header><h1>' + escapeHtml(studio) + '</h1><div class="meta">Informe mensual — ' +
      escapeHtml(client?.nombre || 'Cliente') + '</div></header>';
    writeReport('Informe — ' + (client?.nombre || 'Cliente'),
      header + '<article class="report-content">' + escapeHtml(body) + '</article>' +
      '<footer>Documento orientativo generado por Declarafy.</footer>', global.infColor);
  }

  function install() {
    global.exportPDF = exportPDF;
    global.exportInformeMensual = exportInformeMensual;
  }
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(window);
