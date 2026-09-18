(function (global) {
  'use strict';

  const scripts = [
    '/src/core/company-context.js',
    '/src/core/module-result.js',
    '/src/core/module-registry.js',
    '/src/modules/financial-analysis.js',
    '/src/modules/case-workflow.js',
    '/src/modules/regulatory-center.js'
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-declarafy-core="${src}"]`);
      if (existing) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.dataset.declarafyCore = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
  }

  async function load() {
    if (typeof document === 'undefined') return false;
    for (const src of scripts) await loadScript(src);
    global.dispatchEvent(new CustomEvent('declarafy:core-ready'));
    return true;
  }

  global.DeclarafyCoreLoader = { load, scripts: scripts.slice() };
})(typeof window !== 'undefined' ? window : globalThis);
