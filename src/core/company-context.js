/* Declarafy shared company context.
 * Framework-agnostic so the legacy app can adopt it incrementally.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'declarafy.companyContext.v1';
  const listeners = new Set();

  const emptyContext = () => ({
    companyId: '',
    ruc: '',
    legalName: '',
    taxRegime: null,
    period: null,
    permissions: [],
    lastUpdatedAt: null
  });

  let state = emptyContext();

  function normalize(input) {
    const next = Object.assign(emptyContext(), input || {});
    next.companyId = String(next.companyId || '').trim();
    next.ruc = String(next.ruc || '').replace(/\D/g, '').slice(0, 11);
    next.legalName = String(next.legalName || '').trim();
    next.taxRegime = next.taxRegime ? String(next.taxRegime) : null;
    next.period = next.period ? String(next.period) : null;
    next.permissions = Array.isArray(next.permissions) ? [...new Set(next.permissions.map(String))] : [];
    next.lastUpdatedAt = new Date().toISOString();
    return next;
  }

  function persist() {
    try { global.localStorage && global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function restore() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (raw) state = normalize(JSON.parse(raw));
    } catch (_) { state = emptyContext(); }
    return get();
  }

  function get() { return Object.freeze(Object.assign({}, state, { permissions: [...state.permissions] })); }

  function set(next) {
    state = normalize(Object.assign({}, state, next || {}));
    persist();
    listeners.forEach(fn => { try { fn(get()); } catch (_) {} });
    if (global.dispatchEvent && global.CustomEvent) {
      global.dispatchEvent(new CustomEvent('declarafy:company-context-changed', { detail: get() }));
    }
    return get();
  }

  function clear() {
    state = emptyContext();
    try { global.localStorage && global.localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    listeners.forEach(fn => { try { fn(get()); } catch (_) {} });
    return get();
  }

  function requireCompany() {
    if (!state.companyId && !state.ruc) throw new Error('Selecciona una empresa antes de continuar.');
    return get();
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = { get, set, clear, restore, requireCompany, subscribe, STORAGE_KEY };
  restore();
  global.DeclarafyCompanyContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
