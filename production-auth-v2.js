// Declarafy production authentication — single authoritative auth layer
(function(){
  'use strict';
  const ADMIN='christian@declarafy.com';
  const $=id=>document.getElementById(id);
  window._focusTraps=window._focusTraps||{};

  function msg(kind,text){
    const err=$('authErr'),ok=$('authOk');
    if(err)err.style.display='none';
    if(ok)ok.style.display='none';
    const el=kind==='ok'?ok:err;
    if(el){el.textContent=text;el.style.display='block';}
  }

  function setTab(tab){
    const login=$('fLogin'),reg=$('fReg'),rec=$('fRec');
    if(login)login.style.display=tab==='login'?'block':'none';
    if(reg)reg.style.display=tab==='register'?'block':'none';
    if(rec)rec.style.display=tab==='recover'?'block':'none';
    document.querySelectorAll('#authOv .mtab').forEach((b,i)=>{
      b.classList.toggle('active',(tab==='login'&&i===0)||(tab==='register'&&i===1)||(tab==='recover'&&i===2));
    });
    ['authErr','authOk'].forEach(id=>{const el=$(id);if(el)el.style.display='none';});
  }

  function openAuth(tab,plan){
    tab=tab||'login';
    const ov=$('authOv');
    if(!ov){console.error('Declarafy: no existe #authOv');return false;}
    ov.classList.remove('hidden');
    ov.style.setProperty('display','flex','important');
    ov.style.setProperty('visibility','visible','important');
    ov.style.setProperty('opacity','1','important');
    ov.style.setProperty('pointer-events','auto','important');
    ov.style.setProperty('z-index','99999','important');
    ov.setAttribute('aria-hidden','false');
    setTab(tab);
    if(plan&&$('rPlan')){
      $('rPlan').value=plan;
      try{if(typeof window.onPlanChange==='function')window.onPlanChange($('rPlan'));}catch(e){}
    }
    setTimeout(()=>{
      const id=tab==='register'?'rName':tab==='recover'?'recE':'lEmail';
      $(id)?.focus();
    },50);
    return false;
  }

  function closeAuth(){
    const ov=$('authOv');if(!ov)return false;
    ov.classList.add('hidden');
    ['display','visibility','opacity','pointer-events','z-index'].forEach(p=>ov.style.removeProperty(p));
    ov.setAttribute('aria-hidden','true');
    return false;
  }

  // These are the exact functions called by the landing-page inline buttons.
  window.showAuth=function(tab){return openAuth(tab||'login',tab==='register'?'basico':null);};
  window.hideAuth=closeAuth;
  window.switchTab=setTab;
  window.openDeclarafyLogin=()=>openAuth('login');
  window.openDeclarafyRegister=(plan)=>openAuth('register',plan||'basico');
  window.openDeclarafyRecover=()=>openAuth('recover');

  async function profile(user,extra={}){
    const email=(user.email||'').toLowerCase();
    const admin=email===ADMIN;
    const base={uid:user.uid,email,name:extra.name||user.displayName||email.split('@')[0],plan:admin?'empresa':'basico',role:admin?'admin':'user',mc:0,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
    const ref=firebase.firestore().collection('users').doc(user.uid);
    const snap=await ref.get();
    if(!snap.exists) await ref.set({...base,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    else {
      const old=snap.data()||{};
      base.plan=admin?'empresa':(old.plan||'basico');
      base.mc=old.mc||0;
      await ref.set(base,{merge:true});
    }
    return base;
  }

  function enter(user,data){
    window.curUser={uid:user.uid,email:user.email,name:data.name,plan:data.plan,role:data.role,mc:data.mc||0};
    window.curPlan=data.plan;
    try{localStorage.setItem('tp_current_user',JSON.stringify(window.curUser));}catch(e){}
    closeAuth();
    if(typeof window.showScreen==='function')window.showScreen('screen-panel');
    if(typeof window.loadPanel==='function')window.loadPanel();
  }

  window.doRegisterFB=window.doRegister=async function(){
    const name=$('rName')?.value.trim();
    const email=$('rEmail')?.value.trim().toLowerCase();
    const pass=$('rPass')?.value||'';
    if(!name||!email||pass.length<6){msg('err','Completa nombre, correo y una contraseña de al menos 6 caracteres.');return;}
    try{
      if(typeof firebase==='undefined'||!firebase.auth)throw new Error('Firebase no cargó correctamente.');
      const cred=await firebase.auth().createUserWithEmailAndPassword(email,pass);
      await cred.user.updateProfile({displayName:name});
      const data=await profile(cred.user,{name});
      msg('ok','Cuenta creada correctamente.');
      enter(cred.user,data);
    }catch(e){
      const map={'auth/email-already-in-use':'Ese correo ya tiene una cuenta. Inicia sesión.','auth/operation-not-allowed':'El acceso Email/Password todavía no está habilitado en Firebase.','auth/invalid-email':'El correo no es válido.','auth/weak-password':'La contraseña debe tener al menos 6 caracteres.'};
      msg('err',map[e.code]||('No se pudo crear la cuenta: '+e.message));
    }
  };

  window.doLoginFB=window.doLogin=async function(){
    const email=$('lEmail')?.value.trim().toLowerCase();
    const pass=$('lPass')?.value||'';
    if(!email||!pass){msg('err','Ingresa correo y contraseña.');return;}
    try{
      if(typeof firebase==='undefined'||!firebase.auth)throw new Error('Firebase no cargó correctamente.');
      const cred=await firebase.auth().signInWithEmailAndPassword(email,pass);
      const data=await profile(cred.user,{});
      enter(cred.user,data);
    }catch(e){
      msg('err','No se pudo iniciar sesión. Verifica correo/contraseña y que Email/Password esté habilitado en Firebase.');
    }
  };

  window.doRecoverFB=window.doRecover=async function(){
    const email=$('recE')?.value.trim().toLowerCase();
    if(!email){msg('err','Ingresa tu correo.');return;}
    try{await firebase.auth().sendPasswordResetEmail(email);msg('ok','Te enviamos un enlace para restablecer tu contraseña.');}
    catch(e){msg('err','No se pudo enviar el correo de recuperación.');}
  };

  function norm(t){return(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();}
  document.addEventListener('click',function(e){
    const b=e.target.closest('button,a,[role="button"]');if(!b)return;
    const t=norm(b.textContent);
    if(t.includes('crear cuenta gratis')||t.includes('registrarse gratis')||t.includes('registrate gratis')){
      e.preventDefault();e.stopImmediatePropagation();openAuth('register','basico');return;
    }
    if(t.includes('iniciar sesion')){
      e.preventDefault();e.stopImmediatePropagation();openAuth('login');return;
    }
  },true);

  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAuth();});
})();