(function (global) {
  'use strict';

  function result(options) {
    const o = options || {};
    return {
      ok: o.ok !== false,
      data: o.data === undefined ? null : o.data,
      warnings: Array.isArray(o.warnings) ? o.warnings : [],
      sources: Array.isArray(o.sources) ? o.sources : [],
      generatedAt: new Date().toISOString(),
      companyId: o.companyId || null,
      period: o.period || null
    };
  }

  function regulatorySource(input) {
    const s = input || {};
    return {
      authority: String(s.authority || '').trim(),
      documentNumber: String(s.documentNumber || '').trim(),
      title: String(s.title || '').trim(),
      publishedAt: s.publishedAt || null,
      effectiveAt: s.effectiveAt || null,
      officialUrl: s.officialUrl || null,
      retrievedAt: s.retrievedAt || new Date().toISOString()
    };
  }

  function official(value, source) { return { kind:'official', value, source: source || null }; }
  function calculation(value, formula) { return { kind:'calculation', value, formula: formula || null }; }
  function estimate(value, assumptions) { return { kind:'estimate', value, assumptions: assumptions || [] }; }
  function aiAnalysis(value, sources) { return { kind:'ai-analysis', value, sources: sources || [] }; }

  const api = { result, regulatorySource, official, calculation, estimate, aiAnalysis };
  global.DeclarafyResult = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
