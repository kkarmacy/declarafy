// Declarafy production interaction fixes
(function(){
  'use strict';

  function openAuth(tab, plan){
    var ov=document.getElementById('authOv');
    if(!ov) return;
    ov.classList.remove('hidden');
    ov.style.display='flex';
    ov.setAttribute('aria-hidden','false');
    try{ if(typeof window.switchTab==='function') window.switchTab(tab||'login'); }catch(e){}
    if(plan){
      var sel=document.getElementById('rPlan');
      if(sel){ sel.value=plan; try{ if(typeof window.onPlanChange==='function') window.onPlanChange(sel); }catch(e){} }
    }
    setTimeout(function(){
      var input=document.getElementById(tab==='register'?'rName':'lEmail');
      if(input) input.focus();
    },60);
  }

  function norm(t){return (t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();}

  document.addEventListener('click',function(e){
    var btn=e.target.closest('button,a');
    if(!btn) return;
    var t=norm(btn.textContent);
    var register = t.includes('crear cuenta gratis') || t.includes('registrate gratis') || t.includes('registrarse gratis');
    var login = t==='iniciar sesion' || t.includes('iniciar sesion');
    var pro = t.includes('s/190') || t.includes('profesional') && t.includes('suscrib');
    var empresa = t.includes('s/750') || t.includes('empresa') && t.includes('suscrib');
    var annual = t.includes('1,900') || t.includes('1900') || t.includes('anual') && t.includes('suscrib');
    if(register || login || pro || empresa || annual){
      e.preventDefault();
      e.stopImmediatePropagation();
      if(login) return openAuth('login');
      if(empresa) return openAuth('register','empresa');
      if(pro || annual) return openAuth('register','profesional');
      return openAuth('register','basico');
    }
  },true);

  // Ensure the modal can always be closed with Escape.
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape') return;
    var ov=document.getElementById('authOv');
    if(ov && !ov.classList.contains('hidden')){
      ov.classList.add('hidden');
      ov.style.display='none';
    }
  });
})();
