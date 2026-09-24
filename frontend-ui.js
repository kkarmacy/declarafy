// Shared usability layer. No credentials, permissions or tax rules are changed here.
'use strict';

function enhanceFrontend(root = document) {
  root.querySelectorAll('.field, .fi').forEach(group => {
    const label = group.querySelector('label');
    const control = group.querySelector('input[id], select[id], textarea[id]');
    if (label && control && !label.htmlFor) label.htmlFor = control.id;
  });
  root.querySelectorAll('button:not([type])').forEach(button => { button.type = 'button'; });
  root.querySelectorAll('.pbody table').forEach(table => {
    if (table.parentElement.classList.contains('table-scroll')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Tabla de resultados; desplázate horizontalmente para ver todas las columnas');
    table.before(wrapper);
    wrapper.appendChild(table);
  });
  root.querySelectorAll('.pbody [id$="Result"], .pbody [id$="result"], #authErr, #authOk').forEach(result => {
    result.setAttribute('aria-live', 'polite');
    result.setAttribute('aria-atomic', 'true');
  });
  root.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.revealReady) return;
    input.dataset.revealReady = 'true';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'password-reveal';
    button.textContent = 'Mostrar contraseña';
    button.setAttribute('aria-controls', input.id);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.textContent = reveal ? 'Ocultar contraseña' : 'Mostrar contraseña';
      button.setAttribute('aria-pressed', String(reveal));
    });
    input.after(button);
  });
}

function syncPanelAccessibility() {
  const active = document.querySelector('.pnav .pntab.active');
  document.querySelectorAll('.pnav .pntab').forEach(button => {
    button.setAttribute('aria-current', button === active ? 'page' : 'false');
    button.setAttribute('aria-selected', String(button === active));
  });
  const title = document.getElementById('currentModuleTitle');
  const text = active?.textContent.trim() || 'Panel';
  if (title && title.textContent !== text) title.textContent = text;
}

function sortPanelNavigation(nav) {
  const buttons = Array.from(nav.querySelectorAll(':scope > .pntab'));
  const home = buttons.find(button => /setPTab\('inicio'/.test(button.getAttribute('onclick') || ''));
  const featured = buttons.find(button => button.classList.contains('pntab-featured'));
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const label = button => button.textContent
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^[^A-Za-zÁÉÍÓÚÜÑ0-9]+/u, '').trim();
  buttons.filter(button => button !== home && button !== featured)
    .sort((a, b) => collator.compare(label(a), label(b)))
    .forEach(button => nav.appendChild(button));
  const search = nav.querySelector('.pnav-search');
  if (home) search ? search.after(home) : nav.prepend(home);
  if (featured) home ? home.after(featured) : (search ? search.after(featured) : nav.prepend(featured));
}

function installFrontendUsability() {
  enhanceFrontend();
  const originalApi = declarafyApi;
  const pendingButtons = new WeakMap();
  declarafyApi = async function(action, options) {
    const button = document.activeElement?.closest('button');
    if (button) {
      pendingButtons.set(button, (pendingButtons.get(button) || 0) + 1);
      button.setAttribute('aria-busy', 'true');
    }
    try { return await originalApi(action, options); }
    finally {
      if (button) {
        const count = Math.max(0, (pendingButtons.get(button) || 1) - 1);
        pendingButtons.set(button, count);
        if (!count) button.removeAttribute('aria-busy');
      }
    }
  };
  const email = document.getElementById('lEmail');
  if (email) email.autocomplete = 'username';
  const password = document.getElementById('lPass');
  if (password) password.autocomplete = 'current-password';
  document.querySelectorAll('#fRegister input[type="password"], #fReg input[type="password"]').forEach(input => { input.autocomplete = 'new-password'; });
  const nav = document.querySelector('.pnav');
  if (nav) {
    sortPanelNavigation(nav);
    nav.setAttribute('aria-label', 'Módulos de DeclaraFY');
    const empty = document.createElement('div');
    empty.id = 'panelSearchEmpty';
    empty.className = 'navigation-empty';
    empty.hidden = true;
    empty.setAttribute('role', 'status');
    empty.textContent = 'No encontramos ese módulo. Prueba otro nombre.';
    nav.appendChild(empty);
    document.getElementById('panelModuleSearch')?.addEventListener('input', () => {
      empty.hidden = Array.from(nav.querySelectorAll('.pntab')).some(button => !button.hidden && button.style.display !== 'none');
    });
    nav.addEventListener('click', () => syncPanelAccessibility());
  }
  const content = document.querySelector('#screen-panel > .pnav + div');
  if (content) {
    const bar = document.createElement('div');
    bar.className = 'module-location';
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = '← Ver los 19 módulos';
    back.addEventListener('click', () => {
      const search = document.getElementById('panelModuleSearch');
      if (search) { search.value = ''; filterPanelNavigation(''); }
      const empty = document.getElementById('panelSearchEmpty');
      if (empty) empty.hidden = true;
      setPTab('especializados');
      syncPanelAccessibility();
    });
    const title = document.createElement('span');
    title.id = 'currentModuleTitle';
    bar.append(back, title);
    content.prepend(bar);
    new MutationObserver(records => {
      if (records.some(record => record.addedNodes.length)) enhanceFrontend(content);
      syncPanelAccessibility();
    }).observe(content, { childList: true, subtree: true });
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.getAttribute('aria-busy') === 'true') {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (!/\bcalc\w*\(/.test(button.getAttribute('onclick') || '')) return;
    const section = button.closest('.pbody');
    const invalid = section && Array.from(section.querySelectorAll('input, select, textarea'))
      .find(input => input.getClientRects().length && !input.disabled && !input.checkValidity());
    if (invalid) { event.preventDefault(); event.stopImmediatePropagation(); invalid.reportValidity(); }
  }, true);
  syncPanelAccessibility();
}

function bootstrapDeclarafyCore() {
  if (window.DeclarafyCoreLoader) return window.DeclarafyCoreLoader.load();
  if (document.querySelector('script[data-declarafy-core-bootstrap]')) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/src/core/core-loader.js';
    script.dataset.declarafyCoreBootstrap = 'true';
    script.onload = () => window.DeclarafyCoreLoader ? window.DeclarafyCoreLoader.load().then(resolve, reject) : reject(new Error('DeclarafyCoreLoader no disponible'));
    script.onerror = () => reject(new Error('No se pudo cargar el core modular'));
    document.head.appendChild(script);
  });
}

function loadAuditedModuleEnhancements() {
  if (document.querySelector('script[data-declarafy-audited-modules]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/pension-labor-enhancements.js';
  script.dataset.declarafyAuditedModules = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras auditadas');
  document.head.appendChild(script);
}

function loadAuditedTaxEnhancements() {
  if (document.querySelector('script[data-declarafy-tax-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/tax-close-sunat-enhancements.js';
  script.dataset.declarafyTaxAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras SUNAT auditadas');
  document.head.appendChild(script);
}

function loadAuditedBusinessEnhancements() {
  if (document.querySelector('script[data-declarafy-business-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/business-tools-enhancements.js';
  script.dataset.declarafyBusinessAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras de negocio auditadas');
  document.head.appendChild(script);
}

function loadAuditedAccountingTaxEnhancements() {
  if (document.querySelector('script[data-declarafy-accounting-tax-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/accounting-tax-enhancements.js';
  script.dataset.declarafyAccountingTaxAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras contables/tributarias');
  document.head.appendChild(script);
}

function loadAuditedPayrollLaborEnhancements() {
  if (document.querySelector('script[data-declarafy-payroll-labor-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/payroll-labor-enhancements.js';
  script.dataset.declarafyPayrollLaborAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras laborales auditadas');
  document.head.appendChild(script);
}

function loadAuditedInternationalTaxTradeEnhancements() {
  if (document.querySelector('script[data-declarafy-intl-tax-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/international-tax-trade-enhancements.js';
  script.dataset.declarafyIntlTaxAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras de comercio/impuestos internacionales');
  document.head.appendChild(script);
}

function loadAuditedIncomeRegimeEnhancements() {
  if (document.querySelector('script[data-declarafy-income-regime-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/income-regime-enhancements.js';
  script.dataset.declarafyIncomeRegimeAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras de renta/regímenes');
  document.head.appendChild(script);
}

function loadAuditedLegalComplianceEnhancements() {
  if (document.querySelector('script[data-declarafy-legal-compliance-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/legal-compliance-enhancements.js';
  script.dataset.declarafyLegalComplianceAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras legal/compliance');
  document.head.appendChild(script);
}

function loadAuditedSpecializedValidationEnhancements() {
  if (document.querySelector('script[data-declarafy-specialized-audit]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/specialized-validation-enhancements.js';
  script.dataset.declarafySpecializedAudit = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las mejoras especializadas');
  document.head.appendChild(script);
}

function loadFinalSafetyEnhancements() {
  if (document.querySelector('script[data-declarafy-final-safety]')) return;
  const script = document.createElement('script');
  script.src = '/src/modules/final-safety-enhancements.js';
  script.dataset.declarafyFinalSafety = 'true';
  script.onerror = () => console.warn('[Declarafy modules] No se pudieron cargar las correcciones finales');
  document.head.appendChild(script);
}

function loadSafeExports() {
  if (document.querySelector('script[data-declarafy-safe-exports]')) return;
  const script = document.createElement('script');
  script.src = '/src/core/safe-exports.js';
  script.dataset.declarafySafeExports = 'true';
  script.onerror = () => console.warn('[Declarafy] No se pudo cargar la exportación segura');
  document.head.appendChild(script);
}

function loadAuditRemediations() {
  if (document.querySelector('script[data-declarafy-audit-remediations]')) return;
  const script = document.createElement('script');
  script.src = '/src/core/audit-remediations.js';
  script.dataset.declarafyAuditRemediations = 'true';
  script.onerror = () => console.warn('[Declarafy] No se pudieron cargar las correcciones auditadas');
  document.head.appendChild(script);
}


// Final navigation guard: the legacy app wraps setPTab several times. This guard
// normalizes the target section and guarantees that a real user click leaves one
// module visible instead of only changing the title/navigation state.
function installModuleVisibilityGuard() {
  if (window.__declarafyModuleVisibilityGuard || typeof window.setPTab !== 'function') return;
  window.__declarafyModuleVisibilityGuard = true;
  const legacySetPTab = window.setPTab;
  window.setPTab = function(tab, btn) {
    const result = legacySetPTab.apply(this, arguments);
    const targetId = typeof window._ptSectionId === 'function'
      ? window._ptSectionId(tab)
      : 'pt' + String(tab || '').split('_').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join('');
    const target = document.getElementById(targetId);
    if (target) {
      // Legacy styles use !important; normal inline display cannot override them.
      const panel = document.getElementById('screen-panel');
      if (panel && !panel.classList.contains('active')) panel.classList.add('active');
      document.querySelectorAll('#screen-panel .pbody').forEach(section => {
        const selected = section === target;
        section.hidden = !selected;
        section.style.setProperty('display', selected ? 'block' : 'none', 'important');
        section.setAttribute('aria-hidden', String(!selected));
      });
      target.hidden = false;
      target.style.setProperty('display', 'block', 'important');
      target.removeAttribute('aria-hidden');
    }
    syncPanelAccessibility();
    return result;
  };
}

function startDeclarafyFrontend() {
  installFrontendUsability();
  installModuleVisibilityGuard();
  bootstrapDeclarafyCore().catch(error => console.warn('[Declarafy core]', error.message));
  loadAuditedModuleEnhancements();
  loadAuditedTaxEnhancements();
  loadAuditedBusinessEnhancements();
  loadAuditedAccountingTaxEnhancements();
  loadAuditedPayrollLaborEnhancements();
  loadAuditedInternationalTaxTradeEnhancements();
  loadAuditedIncomeRegimeEnhancements();
  loadAuditedLegalComplianceEnhancements();
  loadAuditedSpecializedValidationEnhancements();
  loadFinalSafetyEnhancements();
  loadSafeExports();
  loadAuditRemediations();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startDeclarafyFrontend);
else startDeclarafyFrontend();
