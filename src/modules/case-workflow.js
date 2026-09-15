(function (global) {
  'use strict';
  function id(prefix){ return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
  function createRequirement(input){
    const x=input||{};
    return { id:id('req'), companyId:x.companyId||null, authority:x.authority||'SUNAT', reference:x.reference||'', receivedAt:x.receivedAt||new Date().toISOString(), dueAt:x.dueAt||null, status:'open', severity:x.severity||'medium', documents:[] };
  }
  function openCase(requirement, input){
    if(!requirement||!requirement.id) throw new Error('Se requiere un requerimiento válido.');
    const x=input||{};
    return { id:id('case'), companyId:requirement.companyId, requirementId:requirement.id, title:x.title||`Requerimiento ${requirement.reference||requirement.id}`, status:'open', owner:x.owner||null, createdAt:new Date().toISOString(), tasks:[], notes:[], expediente:{id:id('exp'), documents:[], events:[]} };
  }
  function addTask(caseFile, task){
    if(!caseFile) throw new Error('Caso inválido.');
    caseFile.tasks.push({id:id('task'), title:String(task.title||'Tarea'), dueAt:task.dueAt||null, owner:task.owner||null, status:'pending'}); return caseFile;
  }
  function addDocument(caseFile, document){
    caseFile.expediente.documents.push({id:id('doc'), name:String(document.name||'Documento'), type:document.type||null, url:document.url||null, addedAt:new Date().toISOString()}); return caseFile;
  }
  global.DeclarafyCaseWorkflow={createRequirement,openCase,addTask,addDocument};
  if(typeof module!=='undefined'&&module.exports) module.exports=global.DeclarafyCaseWorkflow;
})(typeof window!=='undefined'?window:globalThis);
