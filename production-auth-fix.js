// Declarafy production auth/navigation fixes
(function(){
  'use strict';

  // Legacy code expects this object to exist.
  window._focusTraps = window._focusTraps || {};

  function setTab(tab){
    var tabs=document.querySelectorAll('#authOv .mtab');
    tabs.forEach(function(b,i){
      b.classList.toggle('active',(tab==='login'&&i===0)||(tab==='register'&&i===1)||(tab==='recover'&&i===2));
    });
    var login=document.getElementById('fLogin');
    var reg=document.getElementById('fReg');
    var rec=document.getElementById('fRec');
    if(login) login.style.display=tab==='login'?'block':'none';
    if(reg) reg.style.display=tab==='register'?'block':'none';
    if(rec) rec.style.display=tab==='recover'?'block':'none';
    ['authErr','authOk'].forEach(function(id){var el=document.getElementById(id);if(el) el.style.display='none';});
  }

  function openAuth(tab, plan){
    tab=tab||'login';
    var ov=document.getElementById('authOv');
    if(!ov){ console.error('Declarafy: auth modal not found'); return false; }

    ov.classList.remove('hidden');
    ov.style.setProperty('display','flex','important');
    ov.style.setProperty('visibility','visible','important');
    ov.style.setProperty('opacity','1','important');
    ov.style.setProperty('pointer-events','auto','important');
    ov.setAttribute('aria-hidden','false');

    setTab(tab);

    if(plan){
      var sel=document.getElementById('rPlan');
      if(sel){
        sel.value=plan;
        try{ if(typeof window.onPlanChange==='function') window.onPlanChange(sel); }catch(e){}
      }
    }

    window.setTimeout(function(){
      var id=tab==='register'?'rName':tab==='recover'?'recE':'lEmail';
      var input=document.getElementById(id);
      if(input) input.focus();
    },50);
    return false;
  }

  function closeAuth(){
    var ov=document.getElementById('authOv');
    if(!ov) return false;
    ov.classList.add('hidden');
    ov.style.removeProperty('display');
    ov.style.removeProperty('visibility');
    ov.style.removeProperty('opacity');
    ov.style.removeProperty('pointer-events');
    ov.setAttribute('aria-hidden','true');
    return false;
  }

  // IMPORTANT: replace the broken legacy function used by the actual inline buttons.
  window.showAuth=function(tab){ return openAuth(tab||'login', tab==='register'?'basico':null); };
  window.hideAuth=closeAuth;
  window.openDeclarafyLogin=function(){ return openAuth('login'); };
  window.openDeclarafyRegister=function(plan){ return openAuth('register',plan||'basico'); };
  window.openDeclarafyRecover=function(){ return openAuth('recover'); };

  function norm(t){
    return (t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
  }

  function classify(el){
    var text=norm(el.textContent);
    var href=norm(el.getAttribute('href'));
    var onclick=norm(el.getAttribute('onclick'));
    var aria=norm(el.getAttribute('aria-label'));
    var all=[text,href,onclick,aria].join(' ');
    if(all.includes('recuper') || all.includes('forgot')) return {tab:'recover'};
    if(all.includes('iniciar sesion') || all.includes('inicia sesion') || all.includes("showauth('login')")) return {tab:'login'};
    if(all.includes('crear cuenta gratis') || all.includes('crear cuenta') || all.includes('registrate gratis') || all.includes('registrarse gratis') || all.includes('registrate') || all.includes("showauth('register')")) return {tab:'register',plan:'basico'};
    return null;
  }

  // Secondary safety net for every login/register CTA.
  document.addEventListener('click',function(e){
    var el=e.target.closest('button,a,[role="button"]');
    if(!el) return;
    var action=classify(el);
    if(!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openAuth(action.tab,action.plan);
  },true);

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape') closeAuth();
  });
})();
