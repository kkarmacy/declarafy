(function(global){
  'use strict';
  function normalize(x){ x=x||{}; return { id:x.id||null, authority:String(x.authority||'').trim(), documentNumber:String(x.documentNumber||'').trim(), title:String(x.title||'').trim(), publishedAt:x.publishedAt||null, effectiveAt:x.effectiveAt||null, topic:String(x.topic||'General'), summary:String(x.summary||''), impact:String(x.impact||''), recommendedActions:Array.isArray(x.recommendedActions)?x.recommendedActions:[], officialUrl:x.officialUrl||null, affectedCompanyIds:Array.isArray(x.affectedCompanyIds)?x.affectedCompanyIds:[], retrievedAt:x.retrievedAt||new Date().toISOString() }; }
  function validate(item){ const errors=[]; if(!item.authority)errors.push('Falta entidad emisora.'); if(!item.title)errors.push('Falta título.'); if(!item.officialUrl)errors.push('Falta fuente oficial.'); return {valid:errors.length===0,errors}; }
  function affects(item,companyId){ return !!companyId && item.affectedCompanyIds.includes(companyId); }
  global.DeclarafyRegulatoryCenter={normalize,validate,affects};
  if(typeof module!=='undefined'&&module.exports)module.exports=global.DeclarafyRegulatoryCenter;
})(typeof window!=='undefined'?window:globalThis);
