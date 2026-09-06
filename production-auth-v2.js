// Declarafy production authentication v2 — Firebase Auth + Firestore profile
(function(){
  'use strict';
  const ADMIN='christian@declarafy.com';
  const $=id=>document.getElementById(id);
  function msg(kind,text){
    const err=$('authErr'), ok=$('authOk');
    if(err) err.style.display='none'; if(ok) ok.style.display='none';
    const el=kind==='ok'?ok:err; if(el){el.textContent=text;el.style.display='block';}
  }
  function open(tab,plan){
    const ov=$('authOv'); if(!ov)return;
    ov.classList.remove('hidden'); ov.style.setProperty('display','flex','important');
    if(typeof switchTab==='function') switchTab(tab||'login');
    if(plan&&$('rPlan')){$('rPlan').value=plan; if(typeof onPlanChange==='function')onPlanChange($('rPlan'));}
  }
  window.showAuth=function(tab){open(tab||'login');};
  window.hideAuth=function(){const ov=$('authOv');if(ov){ov.classList.add('hidden');ov.style.removeProperty('display');}};

  async function profile(user, extra){
    const email=(user.email||'').toLowerCase();
    const admin=email===ADMIN;
    const data={uid:user.uid,email,name:extra.name||user.displayName||email.split('@')[0],plan:admin?'empresa':(extra.plan||'basico'),role:admin?'admin':'user',mc:0,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
    const ref=firebase.firestore().collection('users').doc(user.uid);
    const snap=await ref.get();
    if(!snap.exists) await ref.set({...data,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    else { const old=snap.data()||{}; data.plan=admin?'empresa':(old.plan||data.plan); data.mc=old.mc||0; await ref.set(data,{merge:true}); }
    return data;
  }
  function enter(user,data){
    window.curUser={uid:user.uid,email:user.email,name:data.name,plan:data.plan,role:data.role,mc:data.mc||0};
    window.curPlan=data.plan;
    try{localStorage.setItem('tp_current_user',JSON.stringify(window.curUser));}catch(e){}
    window.hideAuth();
    if(typeof showScreen==='function') showScreen('screen-panel');
    if(typeof loadPanel==='function') loadPanel();
  }
  window.doRegisterFB=window.doRegister=async function(){
    const name=$('rName')?.value.trim(), email=$('rEmail')?.value.trim().toLowerCase(), pass=$('rPass')?.value||'', plan=$('rPlan')?.value||'basico';
    if(!name||!email||pass.length<6){msg('err','Completa nombre, correo y una contraseña de al menos 6 caracteres.');return;}
    try{
      const cred=await firebase.auth().createUserWithEmailAndPassword(email,pass);
      await cred.user.updateProfile({displayName:name});
      const data=await profile(cred.user,{name,plan:'basico'});
      msg('ok','Cuenta creada correctamente.'); enter(cred.user,data);
    }catch(e){
      const map={'auth/email-already-in-use':'Ese correo ya tiene una cuenta. Inicia sesión.','auth/operation-not-allowed':'Firebase aún no tiene habilitado el acceso Email/Password.','auth/invalid-email':'El correo no es válido.','auth/weak-password':'La contraseña debe tener al menos 6 caracteres.'};
      msg('err',map[e.code]||('No se pudo crear la cuenta: '+e.message));
    }
  };
  window.doLoginFB=window.doLogin=async function(){
    const email=$('lEmail')?.value.trim().toLowerCase(), pass=$('lPass')?.value||'';
    if(!email||!pass){msg('err','Ingresa correo y contraseña.');return;}
    try{const cred=await firebase.auth().signInWithEmailAndPassword(email,pass);const data=await profile(cred.user,{});enter(cred.user,data);}catch(e){msg('err','Correo o contraseña incorrectos, o el acceso todavía no está habilitado en Firebase.');}
  };
  window.doRecoverFB=window.doRecover=async function(){
    const email=$('recE')?.value.trim().toLowerCase(); if(!email){msg('err','Ingresa tu correo.');return;}
    try{await firebase.auth().sendPasswordResetEmail(email);msg('ok','Te enviamos un enlace para restablecer tu contraseña.');}catch(e){msg('err','No se pudo enviar el correo de recuperación.');}
  };
  document.addEventListener('click',function(e){
    const b=e.target.closest('button,a');if(!b)return;const t=(b.textContent||'').toLowerCase();
    if(t.includes('crear cuenta gratis')||t.includes('regístrate gratis')||t.includes('registrate gratis')){e.preventDefault();open('register','basico');}
    else if(t.includes('iniciar sesión')||t.includes('iniciar sesion')){e.preventDefault();open('login');}
  },true);
})();