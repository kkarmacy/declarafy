// Declarafy production auth/navigation fixes
(function(){
  'use strict';

  function setTab(tab){
    if(typeof window.switchTab==='function'){
      window.switchTab(tab);
      return;
    }
    var login=document.getElementById('fLogin');
    var reg=document.getElementById('fReg');
    var rec=document.getElementById('fRec');
    if(login) login.style.display=tab==='login'?'block':'none';
    if(reg) reg.style.display=tab==='register'?'block':'none';
    if(rec) rec.style.display=tab==='recover'?'block':'none';
    document.querySelectorAll('#authOv .mtab').forEach(function(b,i){
      b.classList.toggle('active',(tab==='login'&&i===0)||(tab==='register'&&i===1)||(tab==='recover'&&i===2));
    });
  }

  function openAuth(tab, plan){
    var ov=document.getElementById('authOv');
    if(!ov){ console.error('Declarafy: auth modal not found'); return false; }
    ov.classList.remove('hidden');
    ov.style.setProperty('display','flex','important');
    ov.setAttribute('aria-hidden','false');
    setTab(tab||'login');
    if(plan){
      var sel=document.getElementById('rPlan');
      if(sel){
        sel.value=plan;
        if(typeof window.onPlanChange==='function') try{ window.onPlanChange(sel); }catch(e){}
      }
    }
    window.setTimeout(function(){
      var id=tab==='register'?'rName':tab==='recover'?'recE':'lEmail';
      var input=document.getElementById(id);
      if(input) input.focus();
    },80);
    return false;
  }

  // Expose stable entry points so inline buttons and future links can use them.
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
    if(all.includes('iniciar sesion') || all.includes('inicia sesion') || all.includes('login') || all.includes("showauth('login')")) return {tab:'login'};
    if(all.includes('crear cuenta gratis') || all.includes('crear cuenta') || all.includes('registrate gratis') || all.includes('registrarse gratis') || all.includes('registrate') || all.includes('registro gratis') || all.includes("showauth('register')")) return {tab:'register',plan:'basico'};
    if((all.includes('s/750') || all.includes('plan empresa')) && (all.includes('suscrib') || all.includes('empezar') || all.includes('crear'))) return {tab:'register',plan:'empresa'};
    if((all.includes('s/190') || all.includes('plan profesional')) && (all.includes('suscrib') || all.includes('empezar') || all.includes('crear'))) return {tab:'register',plan:'profesional'};
    if((all.includes('1,900') || all.includes('1900') || all.includes('anual')) && all.includes('suscrib')) return {tab:'register',plan:'profesional'};
    return null;
  }

  // Capture phase makes auth CTAs reliable even if legacy handlers are broken.
  document.addEventListener('click',function(e){
    var el=e.target.closest('button,a,[role="button"]');
    if(!el) return;
    var action=classify(el);
    if(!action) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openAuth(action.tab,action.plan);
  },true);

  // Fix common anchors explicitly after DOM is ready. This also makes keyboard activation reliable.
  function repairAuthLinks(){
    document.querySelectorAll('a,button,[role="button"]').forEach(function(el){
      var action=classify(el);
      if(!action) return;
      if(el.tagName==='A') el.setAttribute('href','#');
      el.setAttribute('data-declarafy-auth',action.tab);
      if(action.plan) el.setAttribute('data-declarafy-plan',action.plan);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',repairAuthLinks);
  else repairAuthLinks();

  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var ov=document.getElementById('authOv');
    if(ov && !ov.classList.contains('hidden')){
      ov.classList.add('hidden');
      ov.style.removeProperty('display');
      ov.setAttribute('aria-hidden','true');
    }
  });
})();
