// â”€â”€ LLAMADAS A IA: exclusivamente mediante el backend PHP seguro â”€â”€
// NOTA: AREAS, SYS, DECLARAFY_PROXY_URL, DECLARAFY_FN_BASE, FREE y ADMIN_EMAIL
// estÃ¡n definidos en /js/config.js â€” NO duplicar aquÃ­.
async function callDeclaraFY(body) {
  // La clave del proveedor nunca llega al navegador ni se guarda en localStorage.
  if (!declarafyCsrfToken) await declarafyLoadSession();
  return fetch(DECLARAFY_PROXY_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'DeclarafyWeb',
      'X-CSRF-Token': declarafyCsrfToken
    },
    body: JSON.stringify({...body, stream:false})
  });
}


function showScreen(id){document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active');s.style.display='none'});const el=document.getElementById(id);if(el){el.classList.add('active');el.style.display='flex';}}

function setArea(btn){
  if(!btn) return;
  document.querySelectorAll('.atab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  curArea = btn.dataset?.area || btn.getAttribute('data-area') || 'general';
}

// â”€â”€ STATE â”€â”€
let apiKey = 'declarafy-proxy';
let curUser=null,curPlan='basico',curArea='general';
// Cuenta de administrador â€” mismo criterio que firestore.rules (isAdmin()).
// ADMIN_EMAIL y FREE ya estÃ¡n en config.js
function isAdminUser() {
  return !!(curUser && (curUser.isAdmin === true || String(curUser.email || '').toLowerCase() === ADMIN_EMAIL));
}
let msgCount=0,attached=[],convHist=[],convId=null;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FUNCIONES DE UI RECONSTRUIDAS
// (no existÃ­an en el archivo recibido, pero se llaman en decenas de lugares;
//  siguen el mismo patrÃ³n de DOM/CSS ya usado por _sendMsgStreamBase,
//  handleMultiFiles y renderHistList)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ showTyp / rem_typ: indicadores de "escribiendo..." â”€â”€
function showTyp() {
  const msgs = document.getElementById('messages');
  if (!msgs) return;
  const existing = document.getElementById('typingIndicator');
  if (existing) return;
  const d = document.createElement('div');
  d.id = 'typingIndicator';
  d.className = 'msg ai';
  d.innerHTML = '<div class="mav">T</div><div class="bbl"><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span></div>';
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}
function remTyp() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

// â”€â”€ Render de mensajes en el chat â”€â”€
function _escapeHtml(str) {
  if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(String(str), {ALLOWED_TAGS: [], ALLOWED_ATTR: []});
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
function _safeToken(value, allowed, fallback) {
  const token = String(value || '');
  return allowed.includes(token) ? token : fallback;
}
function _highlightMatch(text, query) {
  const safe = _escapeHtml(text);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let result = safe;
  words.forEach(w => {
    const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    result = result.replace(re, '<span class="hs-match">$1</span>');
  });
  return result;
}
function _mdFormat(text) {
  const safe = typeof DOMPurify !== 'undefined'
    ? DOMPurify.sanitize(String(text), {ALLOWED_TAGS: ['strong', 'em', 'br', 'a'], ALLOWED_ATTR: ['href']})
    : _escapeHtml(String(text));
  return safe
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => {
      const u = url.trim();
      if (/^javascript:/i.test(u) || /^data:/i.test(u)) return _escapeHtml(txt);
      return `<a href="${u}" target="_blank" rel="noopener">${txt}</a>`;
    })
    .replace(/\n/g, '<br>');
}
function addMsg(role, text) {
  const msgs = document.getElementById('messages');
  if (!msgs) return;
  const d = document.createElement('div'); d.className = 'msg ' + role;
  const av = document.createElement('div'); av.className = 'mav';
  av.textContent = role === 'ai' ? 'T' : (curUser?.name?.charAt(0)?.toUpperCase() || 'U');
  const b = document.createElement('div'); b.className = 'bbl';
  b.innerHTML = _mdFormat(text);
  d.appendChild(av); d.appendChild(b); msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

// â”€â”€ Adjuntar archivo suelto en el chat (zona principal, no modo "caso") â”€â”€
async function readFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'pdf') return await readPDFFile(file);
    if (['txt','csv','xml'].includes(ext)) return await readTextFile(file);
    if (['xlsx','xls'].includes(ext)) return await readExcelFile(file);
    return await readTextFile(file).catch(() => `[Archivo binario: ${file.name} â€” ${(file.size/1024).toFixed(1)} KB]`);
  } catch(e) {
    return `[Error leyendo ${file.name}: ${e.message}]`;
  }
}
function handleFiles(input) {
  const files = Array.from(input.files || []);
  files.forEach(f => { if (!attached.find(x => x.name === f.name) && attached.length < 5) attached.push(f); });
  renderChips();
  input.value = '';
}
function renderChips() {
  const el = document.getElementById('chips'); if (!el) return;
  el.innerHTML = attached.map((f,i) => `<div class="chip">ğŸ“ ${_escapeHtml(f.name)}<button onclick="removeChip(${i})" aria-label="Quitar archivo">Ã—</button></div>`).join('');
}
function removeChip(i) { attached.splice(i,1); renderChips(); }

// â”€â”€ Textarea del chat â”€â”€
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

// â”€â”€ NavegaciÃ³n de pantallas â”€â”€
function goToChat() { showScreen('screen-chat'); setTimeout(() => document.getElementById('userInput')?.focus(), 100); }
function goPanel() { showScreen('screen-panel'); loadPanel(); }
function newChat() {
  convHist = []; convId = null; attached = [];
  const msgs = document.getElementById('messages'); if (msgs) msgs.innerHTML = '';
  renderChips();
  goToChat();
}
function saveAndPanel() {
  if (curUser && convHist.length) {
    const userMsgs = convHist.filter(m => m.role === 'user');
    const title = (userMsgs[0]?.content || 'Consulta').substring(0,60);
    const h = getHist(curUser.email);
    h.push({ title, date: new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'}), area: AREAS[curArea]?.label || 'General', messages: convHist.map(m=>({role:m.role, content:m.content})) });
    saveHist(curUser.email, h);
  }
  goPanel();
}

// â”€â”€ Historial de conversaciones â”€â”€
function renderHist() { if (curUser) renderHistList(getHist(curUser.email)); }
function clearHist() {
  if (!curUser) return;
  if (!confirm('Â¿Borrar todo tu historial de conversaciones? Esta acciÃ³n no se puede deshacer.')) return;
  saveHist(curUser.email, []);
  renderHist();
}
function loadConv(i) {
  if (!curUser) return;
  const h = getHist(curUser.email);
  const c = h[i]; if (!c) return;
  convHist = c.messages.map(m=>({role:m.role, content:m.content})); convId = i;
  const msgs = document.getElementById('messages'); if (msgs) msgs.innerHTML = '';
  convHist.forEach(m => addMsg(m.role, m.content));
  goToChat();
}
function delConv(i, event) {
  event?.stopPropagation();
  if (!curUser) return;
  const h = getHist(curUser.email);
  h.splice(i,1);
  saveHist(curUser.email, h);
  renderHist();
}

// â”€â”€ Modal "ingresa tu API key" â”€â”€
function saveKey() {
  const inp = document.getElementById('apiInp');
  const errEl = document.getElementById('apiErr');
  if (inp) inp.value = '';
  if (errEl) errEl.textContent = 'La clave se configura Ãºnicamente en el servidor.';
  document.getElementById('apiOv')?.classList.add('hidden');
  addNotif('ğŸ”', 'ConexiÃ³n segura', 'DeclaraFY usa la configuraciÃ³n privada del servidor.');
}

// â”€â”€ DB â”€â”€
// Legacy local user accounts are intentionally disabled. Authentication and
// Las cuentas se validan en el backend PHP/MySQL; nunca se guardan contraseÃ±as aquÃ­.
function getUsers(){return {}}
function saveUsers(){/* retired: never persist user accounts in the browser */}
function getHist(e){
  try { const data = JSON.parse(localStorage.getItem('tp_h_'+btoa(e))||'[]'); return Array.isArray(data) ? data : []; } catch { return []; }
}
async function getHistAsync(uid) {
  if(!fbReady||!uid) return getHist(curUser?.email||'');
  try {
    const doc = await fbDb.collection('historial').doc(uid).get();
    if(doc.exists && doc.data().data) {
      const data = doc.data().data;
      // Sync to localStorage
      localStorage.setItem('tp_h_'+btoa(curUser?.email||''), JSON.stringify(data));
      return data;
    }
  } catch(e) { console.warn('getHist Firestore error:', e.message); }
  return getHist(curUser?.email||'');
}
function saveHist(e,h){
  localStorage.setItem('tp_h_'+btoa(e),JSON.stringify(h));
  // Async sync to Firestore
  if(fbReady && curUser?.uid){
    fbDb.collection('historial').doc(curUser.uid).set({data:h,updatedAt:firebase.firestore.FieldValue.serverTimestamp()})
      .catch(err=>console.warn('saveHist sync:',err.message));
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CAPA DE PERSISTENCIA UNIFICADA â€” "Todo a Firestore"
//
// Un KV sync con write-through a localStorage (cachÃ© offline) y
// copia asÃ­ncrona a Firestore bajo users/{uid}/kv/{key}.
// Se usa para TODOS los datos por-usuario, de modo que persisten
// entre dispositivos. localStorage queda sÃ³lo como cachÃ© local.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// CampoS KV capturados por el scope de un usuario autenticado.
// Cada funciÃ³n recibe la clave local ya resuelta (p.ej. 'tp_crm_xxx')
// y el scope determina el documento de Firestore dÃ³nde guardar el valor.
function tpUid(){ return (curUser && curUser.uid) || null; }

// Escribe un valor por-usuario: localStorage (inmediato) + Firestore (async).
function kvPut(lkey, value, scope) {
  const s = JSON.stringify(value);
  localStorage.setItem(lkey, s);
  if (fbReady && curUser?.uid) {
    const path = scope || lkey;
    fbDb.collection('users').doc(curUser.uid).collection('kv').doc(path)
      .set({ v: value, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(err => { if (!/offline|permission/i.test(String(err.message))) console.warn('kvPut sync:', path, err.message); });
  }
}

// Lee: prioriza Firestore (si online) con localStorage como cachÃ©.

// Carga TODOS los scopes de Firestore al iniciar sesiÃ³n (pobla la cachÃ© local).
async function kvLoadAll() {
  if (!fbReady || !curUser?.uid) return;
  try {
    const snap = await fbDb.collection('users').doc(curUser.uid).collection('kv').get();
    snap.forEach(d => {
      const lk = resolveKVLocalKey(d.id);
      if (lk) localStorage.setItem(lk, JSON.stringify(d.data().v));
    });
  } catch(e) { /* offline: usa cachÃ© local */ }
}

// Mapa scope -> clave localStorage correspondiente (para reproyectar desde Firestore).
const KV_SCOPE_TO_LOCAL = {};
function resolveKVLocalKey(scope){ const m = KV_SCOPE_TO_LOCAL[scope]; return typeof m === 'function' ? m() : m || null; }
// scope puede apuntar a una clave fija o a una funciÃ³n que la resuelve en runtime.
function registerKVScope(scope, localKey){ KV_SCOPE_TO_LOCAL[scope] = localKey; }

// â”€â”€ AUTH â”€â”€
function showAuth(tab){
  // Release previous trap if any
  if(window._focusTraps.auth){window._focusTraps.auth.release();delete window._focusTraps.auth;}document.getElementById('authOv').classList.remove('hidden');switchTab(tab);['authErr','authOk'].forEach(id=>document.getElementById(id).style.display='none')}
function hideAuth(){
  if(window._focusTraps.auth){window._focusTraps.auth.release();delete window._focusTraps.auth;}document.getElementById('authOv').classList.add('hidden')}
function switchTab(t){
  document.querySelectorAll('.mtab').forEach((b,i)=>b.classList.toggle('active',(i===0&&t==='login')||(i===1&&t==='register')||(i===2&&t==='recover')));
  document.getElementById('fLogin').style.display=t==='login'?'block':'none';
  document.getElementById('fReg').style.display=t==='register'?'block':'none';
  document.getElementById('fRec').style.display=t==='recover'?'block':'none';
  ['authErr','authOk'].forEach(id=>document.getElementById(id).style.display='none');
}
function aerr(m){const e=document.getElementById('authErr');e.textContent=m;e.style.display='block';document.getElementById('authOk').style.display='none'}
function aok(m){const e=document.getElementById('authOk');e.textContent=m;e.style.display='block';document.getElementById('authErr').style.display='none'}
function doLogin(){
  // Delegated to Firebase version â€” read directly from the form fields
  doLoginFB();
}
function _origDoRegister(){
  // Delegated to Firebase version
  doRegisterFB();
}
function doRecover() {
  // Delegated to Firebase version
  doRecoverFB();
}
function openLegal(tab) {
  if (curUser) { loadPanel(); setTimeout(() => setPTab(tab, null), 100); return; }
  const el = document.getElementById('pt' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (!el) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;z-index:400;padding:16px;overflow-y:auto';
  const mod = document.createElement('div');
  mod.style.cssText = 'background:var(--dark2);border:1px solid var(--border);border-radius:14px;padding:20px;width:100%;max-width:580px;max-height:80vh;overflow-y:auto;margin:auto';
  const closeBtn = document.createElement("div");
  closeBtn.style.cssText = "text-align:right;margin-bottom:10px";
  closeBtn.innerHTML = '<button style="background:transparent;border:1px solid var(--border);color:var(--muted);padding:4px 10px;border-radius:5px;cursor:pointer;font-family:inherit" id="legalCloseBtn">Cerrar</button>';
  closeBtn.querySelector("button").onclick = () => ov.remove();
  mod.appendChild(closeBtn);
  const contentDiv = document.createElement("div");
  contentDiv.innerHTML = el.innerHTML;
  mod.appendChild(contentDiv);
  ov.appendChild(mod); ov.onclick = e => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// QUOTA BARS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function updateQuotaBars() {
  if (!curUser) return;
  const used = curUser.mc || 0, pct = Math.min((used / FREE) * 100, 100);
  const isBasico = !isAdminUser() && curUser.plan === 'basico';
  // panel quota
  const qw = document.getElementById('quotaWrap');
  if (qw) { qw.style.display = isBasico ? 'block' : 'none'; }
  if (isBasico) {
    document.getElementById('quotaTxt').textContent = used + ' / ' + FREE;
    const fill = document.getElementById('quotaFill');
    fill.style.width = pct + '%'; fill.className = 'quota-fill' + (pct >= 80 ? ' warn' : '');
  }
  const ub = document.getElementById('upgBanner');
  if (ub) ub.style.display = (isBasico && used >= FREE) ? 'flex' : 'none';
  // chat quota
  const cqb = document.getElementById('chatQuotaBar');
  if (cqb) cqb.style.display = isBasico ? 'flex' : 'none';
  if (isBasico) {
    document.getElementById('cqTxt').textContent = used + '/' + FREE;
    const cf = document.getElementById('cqFill');
    cf.style.width = pct + '%'; cf.className = 'cq-fill' + (pct >= 80 ? ' warn' : '');
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CALCULADORAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// fmtS â†’ unified formatter above
/**
 * calcIGV â€” Calculadora IGV
 * Base legal: Art. 1 Ley 29646, alÃ­cuota 18% (16% IGV + 2% IPM).
 * Calcula: impuesto bruto, crÃ©dito fiscal y neto a pagar.
 * FÃ³rmula: IGV = base imponible Ã— 0.18
 */
function calcIGV() {
  const base = parseFloat(document.getElementById('igvBase').value) || 0;
  const tipo = document.getElementById('igvTipo').value;
  const r = document.getElementById('igvRes'); r.style.display = 'block';
  if (tipo === 'afecto') {
    const igv = base * 0.18;
    document.getElementById('igvVal').textContent = fmtS(igv);
    document.getElementById('igvDet').textContent = 'Base: ' + fmtS(base) + ' + IGV 18%: ' + fmtS(igv) + ' = Total: ' + fmtS(base + igv);
  } else {
    document.getElementById('igvVal').textContent = 'S/ 0.00';
    document.getElementById('igvDet').textContent = tipo === 'exportacion' ? 'ExportaciÃ³n: tasa 0% â€” Art.33 LIGV. Tiene derecho a saldo a favor del exportador.' : 'OperaciÃ³n exonerada: no genera IGV ni crÃ©dito fiscal.';
  }
}
function calcIR4() {
  const bruto = parseFloat(document.getElementById('ir4Base').value) || 0;
  const conRet = document.getElementById('ir4Ret').value === 'si';
  const r = document.getElementById('ir4Res'); r.style.display = 'block';
  const ded = bruto * 0.20, neto = bruto - ded, uit = 5500;
  const tramos = [[5*uit,0.08],[15*uit,0.14],[20*uit,0.17],[35*uit,0.20],[Infinity,0.30]];
  let imp = 0, rest = neto, prev = 0;
  for (const [lim, tasa] of tramos) { const g = Math.min(rest, lim - prev); imp += g * tasa; rest -= g; prev = lim; if (rest <= 0) break; }
  const ret = conRet ? bruto * 0.08 : 0, porPagar = Math.max(0, imp - ret);
  document.getElementById('ir4Val').textContent = fmtS(porPagar);
  document.getElementById('ir4Det').textContent = 'Renta bruta: ' + fmtS(bruto) + ' | Ded. 20%: ' + fmtS(ded) + ' | Renta neta: ' + fmtS(neto) + ' | Imp.: ' + fmtS(imp) + ' | Ret.: ' + fmtS(ret) + ' | A pagar: ' + fmtS(porPagar);
}
function calcPAC() {
  const base = parseFloat(document.getElementById('pacBase').value) || 0;
  const tasa = parseFloat(document.getElementById('pacSist').value);
  const r = document.getElementById('pacRes'); r.style.display = 'block';
  const pac = base * (tasa / 100);
  document.getElementById('pacVal').textContent = fmtS(pac);
  document.getElementById('pacDet').textContent = fmtS(base) + ' Ã— ' + tasa + '% = ' + fmtS(pac) + ' â€” PDT 621 CÃ³d.301';
}
function calcDet() {
  const base = parseFloat(document.getElementById('detBase').value) || 0;
  const tasa = parseInt(document.getElementById('detTipo').value);
  const r = document.getElementById('detRes'); r.style.display = 'block';
  const det = base * (tasa / 100);
  document.getElementById('detVal').textContent = fmtS(det);
  document.getElementById('detDet').textContent = fmtS(base) + ' Ã— ' + tasa + '% = ' + fmtS(det) + ' â€” Banco de la NaciÃ³n, 5to dÃ­a hÃ¡bil siguiente.';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CALENDARIO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const CAL_YEAR = new Date().getFullYear();
const CAL_DATA = [
  {dia:15,mes:'Ene',nombre:`DeclaraciÃ³n mensual PDT 621 (dic. anterior)`,desc:'Todos los dÃ­gitos RUC. IGV + Pago a cuenta IR',tipo:'mensual',urg:'ok'},
  {dia:31,mes:'Mar',nombre:`DeclaraciÃ³n Jurada Anual IR ${CAL_YEAR-1}`,desc:'Personas naturales y jurÃ­dicas â€” PDT 710',tipo:'anual',urg:'soon'},
  {dia:30,mes:'Abr',nombre:'Vencimiento DJ Anual (plazo especial)',desc:'SegÃºn cronograma SUNAT por dÃ­gito RUC',tipo:'anual',urg:'soon'},
  {dia:15,mes:'May',nombre:`DeclaraciÃ³n mensual PDT 621 (abr)`,desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:30,mes:'Jun',nombre:`Primera cuota ITAN ${CAL_YEAR}`,desc:'Impuesto Temporal a los Activos Netos',tipo:'especial',urg:'ok'},
  {dia:15,mes:'Jul',nombre:'DeclaraciÃ³n mensual PDT 621 (jun)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:31,mes:'Jul',nombre:`Segunda cuota ITAN ${CAL_YEAR}`,desc:'Impuesto Temporal a los Activos Netos',tipo:'especial',urg:'ok'},
  {dia:15,mes:'Sep',nombre:'DeclaraciÃ³n mensual PDT 621 (ago)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:31,mes:'Oct',nombre:'Precios de Transferencia â€” Local File',desc:'Formulario Virtual 3560 (contribuyentes obligados)',tipo:'especial',urg:'soon'},
  {dia:15,mes:'Nov',nombre:'DeclaraciÃ³n mensual PDT 621 (oct)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:15,mes:'Dic',nombre:'DeclaraciÃ³n mensual PDT 621 (nov)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:31,mes:'Dic',nombre:`Cierre contable ejercicio ${CAL_YEAR}`,desc:'Inventarios, depreciaciones y ajustes finales',tipo:'especial',urg:'ok'},
];
function filterCal(tipo, btn) {
  document.querySelectorAll('.cal-ftag').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCalendar(tipo);
}
function renderCalendar(tipo) {
  const el = document.getElementById('calList'); if (!el) return;
  const items = tipo === 'todos' ? CAL_DATA : CAL_DATA.filter(c => c.tipo === tipo);
  const urgLabel = {urgent:'Urgente', soon:'PrÃ³ximo', ok:'Vigente'};
  el.innerHTML = items.map(c => `<div class="cal-item"><div class="cal-date"><div class="cal-day">${c.dia}</div><div class="cal-mon">${c.mes}</div></div><div class="cal-info"><div class="cal-name">${c.nombre}</div><div class="cal-desc">${c.desc}</div></div><span class="cal-badge ${c.urg}">${urgLabel[c.urg]}</span></div>`).join('');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXPORT PDF
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function exportPDF() {
  const msgs = document.getElementById('messages');
  if (!msgs) return;
  const rows = Array.from(msgs.querySelectorAll('.msg')).map(m => {
    const isUser = m.classList.contains('user');
    const text = m.querySelector('.bbl') ? m.querySelector('.bbl').innerText : '';
    return `<div style="margin-bottom:14px;padding:10px 14px;background:${isUser?'#f0f0ff':'#f8f8f0'};border-radius:8px;border-left:3px solid ${isUser?'#555':'#C9A84C'}"><strong style="color:${isUser?'#333':'#8B6914'};font-size:14px">${isUser?'Usuario':'DeclaraFY IA'}</strong><p style="margin:5px 0 0;color:#333;line-height:1.6;font-size:14px">${_escapeHtml(text)}</p></div>`;
  }).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Consulta DeclaraFY</title><style>body{font-family:Arial,sans-serif;max-width:680px;margin:40px auto;color:#333;line-height:1.6}h1{color:#C9A84C;border-bottom:2px solid #C9A84C;padding-bottom:8px;font-size:22px}.meta{font-size:14px;color:#888;margin-bottom:22px}@media print{body{margin:20px}}</style></head><body><h1>DeclaraFY â€” Consulta Tributaria</h1><div class="meta">Usuario: ${_escapeHtml(curUser?.name||'â€”')} | Ãrea: ${_escapeHtml(AREAS[curArea]?.label||'General')} | Fecha: ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div>${rows}<hr style="margin:22px 0;border:1px solid #eee"><p style="font-size:14px;color:#999;text-align:center">Documento generado por Declarafy.com â€” Solo con fines orientativos. Consulta con un profesional para decisiones formales.</p></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXPORT WORD (DOCX) â€” genera .docx desde el chat
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function exportDOCX() {
  const msgs = document.getElementById('messages');
  if (!msgs) return;
  const rows = Array.from(msgs.querySelectorAll('.msg')).map(m => {
    const isUser = m.classList.contains('user');
    const text = m.querySelector('.bbl') ? m.querySelector('.bbl').innerText : '';
    return { role: isUser ? 'Usuario' : 'DeclaraFY IA', text };
  });
  // Build a simple .docx using raw Office Open XML
  const body = rows.map(r =>
    `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="${r.role === 'Usuario' ? '333333' : '8B6914'}"/></w:rPr><w:t xml:space="preserve">${_escapeXml(r.text)}</w:t></w:r></w:p>`
  ).join('');
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:48/><w:color w:val="8B6914"/></w:rPr><w:t>DeclaraFY â€” Consulta Tributaria</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:color w:val="888888"/><w:sz w:20"/></w:rPr><w:t xml:space="preserve">Usuario: ${_escapeXml(curUser?.name || 'â€”')} | Fecha: ${new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'long',year:'numeric'})}</w:t></w:r></w:p>
<w:p><w:r><w:br/></w:r></w:p>
${body}
<w:p><w:r><w:rPr><w:color w:val="999999"/><w:sz w:18"/></w:rPr><w:t xml:space="preserve">Documento generado por Declarafy.com â€” Solo con fines orientativos.</w:t></w:r></w:p>
</w:body></w:document>`;
  // Generate an .html file that Word can open (no JSZip dependency needed)
  const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Consulta DeclaraFY</title><style>
body{font-family:'Calibri',sans-serif;max-width:680px;margin:40px auto;color:#333;line-height:1.6}
h1{color:#C9A84C;border-bottom:2px solid #C9A84C;padding-bottom:8px;font-size:22px}
.meta{font-size:14px;color:#888;margin-bottom:22px}
.msg-user{background:#f0f0ff;padding:10px 14px;border-radius:8px;border-left:3px solid #555;margin-bottom:14px}
.msg-ai{background:#f8f8f0;padding:10px 14px;border-radius:8px;border-left:3px solid #C9A84C;margin-bottom:14px}
.role{font-weight:bold;font-size:14px;margin-bottom:4px}
.role-user{color:#333}
.role-ai{color:#8B6914}
@media print{body{margin:20px}}</style></head><body>
<h1>DeclaraFY â€” Consulta Tributaria</h1>
<div class="meta">Usuario: ${_escapeHtml(curUser?.name || 'â€”')} | Ãrea: ${_escapeHtml(AREAS[curArea]?.label || 'General')} | Fecha: ${new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'long',year:'numeric'})}</div>
${rows.map(r => `<div class="${r.role === 'Usuario' ? 'msg-user' : 'msg-ai'}"><div class="role ${r.role === 'Usuario' ? 'role-user' : 'role-ai'}">${r.role}</div><p>${_escapeHtml(r.text)}</p></div>`).join('')}
<hr><p style="font-size:14px;color:#999;text-align:center">Documento generado por Declarafy.com â€” Solo con fines orientativos.</p>
</body></html>`;
  const blob = new Blob([htmlContent], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'Consulta_DeclaraFY.doc'; a.click();
  URL.revokeObjectURL(url);
}
function _escapeXml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DARK / LIGHT MODE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-mode');
  document.body.classList.remove('light-mode');
  localStorage.setItem('tp_theme', isDark ? 'dark' : 'light');
  document.querySelectorAll('[id^="themeBtn"]').forEach(b => {
    b.textContent = isDark ? 'â˜€ï¸' : 'ğŸŒ™';
    b.setAttribute('aria-label', isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    b.setAttribute('aria-pressed', String(isDark));
  });
}
(function applyTheme() {
  const isDark = localStorage.getItem('tp_theme') === 'dark';
  document.body.classList.toggle('dark-mode', isDark);
  document.body.classList.remove('light-mode');
  document.querySelectorAll('[id^="themeBtn"]').forEach(b => {
    b.textContent = isDark ? 'â˜€ï¸' : 'ğŸŒ™';
    b.setAttribute('aria-label', isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    b.setAttribute('aria-pressed', String(isDark));
  });
})();

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// NOTIFICATIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const DEFAULT_NOTIFS = [
  { id:4, icon:'ğŸ””', title:'Bienvenido a DeclaraFY', desc:'Consulta tus herramientas en el panel. Los vencimientos deben confirmarse con el cronograma oficial de SUNAT.', time:'Bienvenida', read:false },
];
function getNotifs() {
  try {
    const stored = JSON.parse(localStorage.getItem('tp_notifs') || 'null');
    if (stored === null) return DEFAULT_NOTIFS.map(item => ({ ...item }));
    if (!Array.isArray(stored)) return DEFAULT_NOTIFS.map(item => ({ ...item }));
    // Versions antiguas guardaban tres avisos regulatorios de demostraciÃ³n.
    return stored.filter(item => item && typeof item === 'object' && ![1, 2, 3].includes(Number(item.id)));
  } catch { return DEFAULT_NOTIFS.map(item => ({ ...item })); }
}
function saveNotifs(n) { localStorage.setItem('tp_notifs', JSON.stringify(n)); }
function renderNotifs() {
  const notifs = getNotifs();
  const unread = notifs.filter(n => !n.read).length;
  document.querySelectorAll('.notif-dot').forEach(d => { d.style.display = unread > 0 ? 'flex' : 'none'; d.textContent = unread; });
  const list = document.getElementById('notifList'); if (!list) return;
  if (!notifs.length) { list.innerHTML = '<div class="notif-empty">No tienes notificaciones</div>'; return; }
  list.innerHTML = notifs.map(n => {
    const id = Number.isFinite(Number(n.id)) ? Math.trunc(Number(n.id)) : 0;
    return `<div class="notif-item${n.read ? '' : ' unread'}" onclick="readNotif(${id})"><div class="notif-icon">${_escapeHtml(n.icon || 'ğŸ””')}</div><div class="notif-body"><div class="notif-title">${_escapeHtml(n.title || 'NotificaciÃ³n')}</div><div class="notif-desc">${_escapeHtml(n.desc || '')}</div><div class="notif-time">${_escapeHtml(n.time || '')}</div></div></div>`;
  }).join('') + '<div class="notif-mark-all" onclick="markAllRead()">Marcar todo como leÃ­do</div>';
}
function readNotif(id) { const n = getNotifs(); const item = n.find(x => x.id === id); if (item) { item.read = true; saveNotifs(n); renderNotifs(); } }
function markAllRead() { const n = getNotifs(); n.forEach(x => x.read = true); saveNotifs(n); renderNotifs(); }
function toggleNotifs() {
  const panel = document.getElementById('notifPanel'); if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) renderNotifs();
  document.removeEventListener('click', closeNotifOutside);
  if (!isOpen) document.addEventListener('click', closeNotifOutside);
}
function closeNotifOutside(e) {
  const panel = document.getElementById('notifPanel'); if (!panel) return;
  if (!panel.contains(e.target) && !e.target.closest('.notif-bell')) {
    panel.style.display = 'none'; document.removeEventListener('click', closeNotifOutside);
  }
}
function addNotif(icon, title, desc) {
  const n = getNotifs();
  n.unshift({ id: Date.now(), icon, title, desc, time: 'Ahora', read: false });
  saveNotifs(n.slice(0, 20)); renderNotifs();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PERFIL DE USUARIO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadProfileForm() {
  if (!curUser) return;
  const pn = {basico:'Plan BÃ¡sico', pro:'Plan Profesional', empresa:'Plan Empresa'};
  document.getElementById('profAv').textContent = (curUser.name || curUser.email || '?').charAt(0).toUpperCase();
  document.getElementById('profName').textContent = curUser.name || '';
  document.getElementById('profPlan').textContent = isAdminUser() ? 'Superadministrador' : (pn[curUser.plan] || 'Plan BÃ¡sico');
  document.getElementById('profEmail').textContent = curUser.email;
  document.getElementById('pName').value = curUser.name || '';
  document.getElementById('pRuc').value = curUser.ruc || '';
  const reg = document.getElementById('pRegimen'); if (reg) reg.value = curUser.regimen || '';
  const sec = document.getElementById('pSector'); if (sec) sec.value = curUser.sector || '';
}
function showProfMsg(type, msg) {
  const ok = document.getElementById('profOk'), err = document.getElementById('profErr');
  if (type === 'ok') { ok.textContent = msg; ok.style.display = 'block'; err.style.display = 'none'; setTimeout(() => ok.style.display = 'none', 3000); }
  else { err.textContent = msg; err.style.display = 'block'; ok.style.display = 'none'; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BÃšSQUEDA EN HISTORIAL â€” full-text mejorada
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function searchHist(query) {
  if (!curUser) return;
  const h = getHist(curUser.email);
  const q = query.toLowerCase().trim();
  if (!q) { renderHistList(h); return; }
  // Multi-word: all words must match somewhere in the conversation
  const words = q.split(/\s+/).filter(Boolean);
  const filtered = h.filter(c => {
    const title = (c.title || '').toLowerCase();
    const area = (c.area || '').toLowerCase();
    const allText = (c.messages || []).map(m => m.content.toLowerCase()).join(' ');
    const combined = title + ' ' + area + ' ' + allText;
    return words.every(w => combined.includes(w));
  });
  renderHistList(filtered, q);
}
function renderHistList(h, highlight) {
  const l = document.getElementById('histList'); if (!l) return;
  const summary = document.getElementById('histSummary');
  const total = Array.isArray(h) ? h.length : 0;
  if (summary) summary.textContent = total === 1 ? '1 conversaciÃ³n encontrada' : `${total} conversaciones encontradas`;
  if (!h.length) {
    const searching = Boolean((document.getElementById('histSearch')?.value || '').trim());
    l.innerHTML = searching
      ? '<div class="module-empty-state"><span aria-hidden="true">ğŸ”</span><strong>No encontramos coincidencias</strong><p>Prueba con otra palabra, Ã¡rea tributaria o parte de tu consulta.</p></div>'
      : '<div class="module-empty-state"><span aria-hidden="true">ğŸ’¬</span><strong>AÃºn no tienes conversaciones</strong><p>Realiza tu primera consulta y podrÃ¡s retomarla desde este espacio.</p><button type="button" class="module-primary-action" onclick="newChat()">Iniciar una consulta</button></div>';
    return;
  }
  const allH = getHist(curUser.email);
  l.innerHTML = '';
  [...h].reverse().forEach(c => {
    const i = allH.findIndex(x => x.title === c.title && x.date === c.date);
    const d = document.createElement('div'); d.className = 'hitem';
    const fu = c.messages?.find(m => m.role === 'user');
    const prev = fu ? fu.content.substring(0, 70) : 'Consulta';
    const titleHtml = highlight ? _highlightMatch(c.title || 'Consulta', highlight) : _escapeHtml(c.title || 'Consulta');
    const prevHtml = highlight ? _highlightMatch(prev, highlight) : _escapeHtml(prev);
    d.innerHTML = `<div class="hl"><div class="ht">${titleHtml}</div><div class="hp">${prevHtml}${prev.length>=70?'â€¦':''}</div></div><div class="hm"><div class="ha">${_escapeHtml(c.area||'General')}</div><div class="hd">${_escapeHtml(c.date||'')}</div></div><button type="button" class="hdel" aria-label="Eliminar conversaciÃ³n">Ã—</button>`;
    d.querySelector('.hl')?.addEventListener('click', () => loadConv(i));
    d.querySelector('.hdel')?.addEventListener('click', event => delConv(i, event));
    l.appendChild(d);
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SIMULADOR FISCALIZACIÃ“N SUNAT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function runSimulator() {
  const regimen = document.getElementById('simRegimen').value;
  const ingresos = parseFloat(document.getElementById('simIngresos').value) || 0;
  const checks = {
    gastos: document.getElementById('simGastos').checked,
    cf: document.getElementById('simCF').checked,
    libros: document.getElementById('simLibros').checked,
    vinc: document.getElementById('simOperVinc').checked,
    perdidas: document.getElementById('simPerdidas').checked,
    caja: document.getElementById('simCaja').checked,
    det: document.getElementById('simDet').checked,
  };
  const obs = [];
  if (checks.gastos) obs.push({tipo:'alto', txt:'<strong>Gastos sin sustento (Art.44 LIR):</strong> SUNAT repararÃ¡ los gastos sin comprobante de pago. Multa: 50% del tributo omitido. Subsana obteniendo los comprobantes o emitiendo una declaraciÃ³n rectificatoria.'});
  if (checks.cf) obs.push({tipo:'alto', txt:'<strong>CrÃ©dito fiscal observado (Art.18-19 LIGV):</strong> Si la factura fue emitida por un proveedor no habido o con baja de RUC, SUNAT desconocerÃ¡ el crÃ©dito fiscal. Verificar el estado del proveedor en SUNAT.'});
  if (checks.libros) obs.push({tipo:'medio', txt:'<strong>Atraso en libros contables (Art.175 CT):</strong> Multa entre 0.3% y 3% de los ingresos netos segÃºn el tipo de libro. Subsanable antes del requerimiento con reducciÃ³n del 90%.'});
  if (checks.vinc) obs.push({tipo:'medio', txt:'<strong>Operaciones con vinculadas (Art.32-A LIR):</strong> SUNAT puede ajustar los precios al valor de mercado. Si las operaciones superan 400 UIT, puede ser obligatorio presentar el Local File (Form. 3560).'});
  if (checks.perdidas) obs.push({tipo:'medio', txt:'<strong>PÃ©rdidas reiteradas (Indicador de riesgo SUNAT):</strong> 3+ aÃ±os de pÃ©rdidas activan auditorÃ­as por presunciÃ³n de ingresos omitidos o gastos irregulares. Documentar la causalidad de todos los gastos.'});
  if (checks.caja) obs.push({tipo:'alto', txt:'<strong>Saldo de caja elevado (Art.67 CT â€” PresunciÃ³n):</strong> SUNAT puede aplicar presunciÃ³n de ingresos si el saldo de caja no tiene respaldo. Riesgo de determinaciÃ³n sobre base presunta.'});
  if (checks.det) obs.push({tipo:'alto', txt:'<strong>Detracciones pendientes (D.Leg.940):</strong> La falta de depÃ³sito de la detracciÃ³n genera multa del 50% del monto no depositado e impide el uso del crÃ©dito fiscal del perÃ­odo.'});
  if (ingresos > 2300 * 5500 && !checks.vinc) obs.push({tipo:'medio', txt:'<strong>Posible obligaciÃ³n PT (D.S.008-2023-EF):</strong> Con ingresos superiores a 2,300 UIT y operaciones con vinculadas, podrÃ­a ser obligatorio presentar documentaciÃ³n de precios de transferencia.'});
  const nivel = obs.filter(o => o.tipo === 'alto').length >= 2 ? 'alto' : obs.filter(o => o.tipo === 'medio').length >= 2 ? 'medio' : obs.length === 0 ? 'bajo' : 'medio';
  const nivelLabel = {alto:'Alto riesgo de fiscalizaciÃ³n', medio:'Riesgo moderado', bajo:'Riesgo bajo'};
  const res = document.getElementById('simulResult');
  res.style.display = 'block';
  if (obs.length === 0) {
    res.innerHTML = '<div class="simul-result"><h4>âœ… Sin observaciones detectadas</h4><p style="font-size:14px;color:var(--muted)">Basado en la informaciÃ³n proporcionada, no se detectaron contingencias tributarias de alto riesgo. Recuerda mantener siempre documentaciÃ³n de respaldo para todos tus gastos.</p></div>';
  } else {
    res.innerHTML = `<div class="simul-result"><span class="risk-badge ${nivel}">${nivel === 'alto' ? 'ğŸ”´' : nivel === 'medio' ? 'ğŸŸ¡' : 'ğŸŸ¢'} ${nivelLabel[nivel]}</span><h4>${obs.length} observaciÃ³n(es) detectada(s)</h4>${obs.map(o => `<div class="simul-obs${o.tipo==='medio'?' warn':o.tipo==='ok'?' ok':''}">${o.txt}</div>`).join('')}<p style="font-size:14px;color:var(--muted);margin-top:12px">âš ï¸ Esta simulaciÃ³n es orientativa. Consulta con un contador o abogado tributarista para una evaluaciÃ³n formal.</p></div>`;
  }
  addNotif('ğŸ”', 'SimulaciÃ³n completada', `Se detectaron ${obs.length} observaciones tributarias. Nivel: ${nivelLabel[nivel]}`);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GENERADOR DE DOCUMENTOS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let selectedDocType = '';
const DOC_FIELDS = {
  reclamacion: { title:'Recurso de ReclamaciÃ³n SUNAT', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'RazÃ³n social / Nombre',ph:'Empresa S.A.C.'},{id:'resolucion',label:'NÂ° de ResoluciÃ³n a impugnar',ph:'R.D. 001-2024/SUNAT-050'},{id:'monto',label:'Monto del tributo en disputa S/',ph:'15000'},{id:'argumento',label:'Argumento principal',ph:'La deuda fue pagada oportunamente, adjunto voucher...'}] },
  carta_descargo: { title:'Carta de Descargo / Respuesta a Esquela', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'RazÃ³n social / Nombre',ph:'Empresa S.A.C.'},{id:'esquela',label:'NÂ° de Esquela o Requerimiento',ph:'ESQ-001-2024'},{id:'periodo',label:'PerÃ­odo tributario observado',ph:'Enero - Diciembre 2023'},{id:'descargo',label:'Descargo y sustento',ph:'Los gastos observados corresponden a...'}] },
  fraccionamiento: { title:'Solicitud de Fraccionamiento Art. 36 CT', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'RazÃ³n social / Nombre',ph:'Empresa S.A.C.'},{id:'deuda',label:'Monto total de la deuda S/',ph:'25000'},{id:'cuotas',label:'NÂ° de cuotas solicitadas',ph:'12'},{id:'motivo',label:'Motivo del fraccionamiento',ph:'Dificultades de liquidez por...'}] },
  informe_pt: { title:'Estructura Informe Local â€” Precios de Transferencia', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'RazÃ³n social',ph:'Empresa S.A.C.'},{id:'vinculada',label:'Nombre de la parte vinculada',ph:'Casa Matriz Corp.'},{id:'pais',label:'PaÃ­s de la parte vinculada',ph:'EspaÃ±a'},{id:'operacion',label:'Tipo de operaciÃ³n analizada',ph:'PrÃ©stamo intercompany de USD 500,000'},{id:'metodo',label:'MÃ©todo PT seleccionado',ph:'TNMM â€” Margen Neto Transaccional'}] },
  cert_residencia: { title:'Carta SustentaciÃ³n RetenciÃ³n No Domiciliado', fields:[{id:'proveedor',label:'Nombre del proveedor no domiciliado',ph:'Tech Services Ltd.'},{id:'pais',label:'PaÃ­s de residencia del proveedor',ph:'Estados Unidos'},{id:'servicio',label:'Tipo de servicio prestado',ph:'Licencia de software'},{id:'monto',label:'Monto del servicio USD',ph:'10000'},{id:'tasa',label:'Tasa de retenciÃ³n aplicada %',ph:'30'}] },
  informe_legal: { title:'Informe Legal Tributario', fields:[{id:'cliente',label:'Cliente',ph:'Empresa S.A.C.'},{id:'materia',label:'Materia a analizar',ph:'Deducibilidad de gastos de representaciÃ³n'},{id:'contexto',label:'DescripciÃ³n de la situaciÃ³n',ph:'La empresa realizÃ³ gastos de atenciÃ³n a clientes por S/ 50,000...'},{id:'pregunta',label:'Pregunta o consulta especÃ­fica',ph:'Â¿Son deducibles estos gastos? Â¿Existe algÃºn lÃ­mite?'}] },
};
function selectDoc(type, card) {
  selectedDocType = type;
  document.querySelectorAll('.docgen-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  const cfg = DOC_FIELDS[type]; if (!cfg) return;
  const form = document.getElementById('docgenForm'); form.classList.add('active');
  document.getElementById('docgenTitle').textContent = cfg.title;
  document.getElementById('docgenFields').innerHTML = cfg.fields.map(f => `<div class="fi"><label>${f.label}</label><input type="text" id="dg_${f.id}" placeholder="${f.ph}"></div>`).join('');
  document.getElementById('docgenPreview').style.display = 'none';
  document.getElementById('docgenCopyBtn').style.display = 'none';
  form.scrollIntoView({behavior:'smooth', block:'start'});
}
async function generateDoc() {
  if (!selectedDocType) return;
  const cfg = DOC_FIELDS[selectedDocType]; if (!cfg) return;
  const fields = {};
  cfg.fields.forEach(f => { fields[f.label] = document.getElementById('dg_' + f.id)?.value || 'â€”'; });
  const prompt = `Genera un documento tributario formal en espaÃ±ol peruano del tipo: "${cfg.title}". Datos: ${JSON.stringify(fields)}. El documento debe ser profesional, citar la base legal correcta del CÃ³digo Tributario o LIR peruana, y estar listo para presentar ante SUNAT. Incluye: membrete bÃ¡sico, fecha, nÃºmero de expediente (si aplica), cuerpo del documento con argumentos legales, petitorio y firma. Solo devuelve el texto del documento sin explicaciones adicionales.`;
  document.getElementById('docgenLoading').style.display = 'block';
  document.getElementById('docgenPreview').style.display = 'none';
  document.getElementById('docgenCopyBtn').style.display = 'none';
  if (!apiKey) {
    setTimeout(() => {
      document.getElementById('docgenLoading').style.display = 'none';
      const prev = document.getElementById('docgenPreview');
      prev.style.display = 'block';
      prev.textContent = `[DEMO - Se necesita API Key para generar documentos reales]\n\n${cfg.title}\nFecha: ${new Date().toLocaleDateString('es-PE')}\n\n${Object.entries(fields).map(([k,v]) => `${k}: ${v}`).join('\n')}\n\nConecta tu API Key de Claude para generar el documento completo con base legal.`;
      document.getElementById('docgenCopyBtn').style.display = 'block';
    }, 800);
    return;
  }
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5', max_tokens:2000, system:'Eres un abogado tributarista peruano experto. Redactas documentos tributarios formales con base legal correcta.', messages:[{role:'user',content:prompt}]});
    const data = await res.json();
    const text = data.content?.[0]?.text || 'Error generando documento.';
    document.getElementById('docgenLoading').style.display = 'none';
    const prev = document.getElementById('docgenPreview'); prev.style.display = 'block'; prev.textContent = text;
    document.getElementById('docgenCopyBtn').style.display = 'block';
    addNotif('ğŸ“„', 'Documento generado', `"${cfg.title}" generado exitosamente.`);
  } catch(e) {
    document.getElementById('docgenLoading').style.display = 'none';
    document.getElementById('docgenPreview').style.display = 'block';
    document.getElementById('docgenPreview').textContent = 'Error: ' + e.message;
  }
}
function copyDoc() {
  const text = document.getElementById('docgenPreview').textContent;
  navigator.clipboard.writeText(text).then(() => { document.getElementById('docgenCopyBtn').textContent = 'âœ… Copiado!'; setTimeout(() => document.getElementById('docgenCopyBtn').textContent = 'ğŸ“‹ Copiar documento', 2000); });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STREAMING CHAT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function _sendMsgStreamBase(txt) {
  const inp = document.getElementById('userInput');
  const msg = txt || inp.value.trim();
  if (!msg && !attached.length) return;
  if (!isAdminUser() && curUser?.plan === 'basico' && (curUser?.mc || 0) >= FREE) {
    addMsg('ai', `Has alcanzado el lÃ­mite de **${FREE} consultas** del plan gratuito.\n\nActualiza al **Plan Profesional por S/190/mes** para consultas ilimitadas.`);
    return;
  }
  let disp = msg, full = msg;
  if (attached.length) {
    const ns = attached.map(f => 'ğŸ“ ' + f.name).join(' ');
    disp = `${ns}${msg ? '\n' + msg : ''}`;
    const cs = await Promise.all(attached.map(readFile));
    full = `${msg || 'Analiza este archivo tributariamente.'}${cs.map((c,i) => `\n\n[ARCHIVO: ${attached[i].name}]\n${c.substring(0,3000)}`).join('')}`;
    attached = []; renderChips();
  }
  if (!txt) { inp.value = ''; inp.style.height = 'auto'; }
  addMsg('user', disp || 'Archivo adjunto');
  // NOTE: msgCount is incremented in the sendMsg wrapper, not here â€” avoid double-counting
  convHist.push({ role:'user', content: full + (AREAS[curArea] ? `\n[Ãrea: ${AREAS[curArea].label}]` : '') });
  if (!apiKey) { addMsg('ai','Para activar respuestas reales ingresa tu **API Key**.'); setTimeout(() => document.getElementById('apiOv').classList.remove('hidden'), 400); return; }
  // Create streaming message bubble
  const msgs = document.getElementById('messages');
  const d = document.createElement('div'); d.className = 'msg ai';
  const av = document.createElement('div'); av.className = 'mav'; av.textContent = 'T';
  const b = document.createElement('div'); b.className = 'bbl';
  const cursor = document.createElement('span'); cursor.className = 'stream-cursor';
  b.appendChild(cursor); d.appendChild(av); d.appendChild(b); msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5', max_tokens:1024, stream:true, system:SYS, messages:convHist});
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message||'Error API'); }
    const payload = await res.json();
    const fullText = String(payload?.content?.[0]?.text || '');
    if (!fullText) throw new Error(payload?.error?.message || 'El proveedor devolviÃ³ una respuesta vacÃ­a.');
    cursor.remove();
    b.innerHTML = _escapeHtml(fullText).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    convHist.push({ role:'assistant', content: fullText });
    // Guardar en cachÃ© offline (Ãºltima pregunta del historial de conversaciÃ³n)
    const lastUser = convHist.filter(m => m.role === 'user').slice(-1)[0];
    if (lastUser) tpSaveOfflineResponse(lastUser.content.substring(0, 200), fullText.substring(0, 1500));
  } catch(err) {
    cursor.remove(); b.innerHTML = `<strong>Error:</strong> ${_escapeHtml(err.message)}`;
    if (err.message.includes('401')) { addNotif('âš ï¸', 'SesiÃ³n expirada', 'Vuelve a iniciar sesiÃ³n para continuar.'); setTimeout(() => { if (typeof showAuth === 'function') showAuth('login'); }, 400); }
  }
}

// Override sendMsg to use streaming
let _sendMsgGuard = false;
const _origSendMsg = sendMsg;
async function _sendMsgLayer1(txt) {
  if (_sendMsgGuard) return;
  _sendMsgGuard = true;
  try {
    if (apiKey) { return await sendMsgStream(txt); }
    const inp = document.getElementById('userInput');
    const msg = txt || inp?.value?.trim() || '';
    if (msg) {
      addMsg('user', msg);
      addMsg('ai', 'Para activar respuestas reales ingresa tu **API Key**.');
      setTimeout(() => document.getElementById('apiOv')?.classList.remove('hidden'), 400);
      if (inp) { inp.value = ''; inp.style.height = 'auto'; }
      convHist.push({ role:'user', content: msg + (AREAS[curArea] ? `\n[Ãrea: ${AREAS[curArea].label}]` : '') });
    }
  } finally {
    _sendMsgGuard = false;
  }
}

// Update setPTab to load profile form when visiting perfil tab
const PT_TAB_NAMES = ['admin','alertas','api_access','bcr','biblioteca','calculadora','calendario','cartas','casos','cdi','cierre','comparado','comparador','contratos','contratos_gen','cripto','cripto_legal','depreciacion','detector_pdt','drawback','eeff','empresa_hub','especializados','estadisticas','excel_int','expediente','facturacion','favoritos','fraccionamiento','generador','historial','hs_clasificador','ia_fisc','indecopi','informe','inicio','itan','lavado','liquidacion','moneda','monitor','multas','niif','ocr_factura','pdt621','pdt_xml','perfil','plan_anual','privacidad','pt_modulo','referidos','requerimiento','ret_perc','rtf','sbs','simulador','simulador_esc','smv','sugerencias','sunafil','sunat_api','sunat_inf','sunat_live','terminos','tim','timeline','utilidades','widget','zonas','nomina','moras_sunat','calendario_fiscal','importacion','selector_regimen','pdt_gen','score_fin','radar_norm','bal_comprob','libro_diario','concil_banc','cts_gratif','contratos_gen2','docs_legales','withholding','analisis_avanz','compliance','spot','arbitrios','renta_anual','perdida','despido','tregistro','suspension','flujo_caja','van_tir','comp_fin','guias_remision','validador','precios_transf','tea_multas','rmt_rer','amazonia','itan_detalle','rus','cierre_fiscal','tim_historico','compensacion','exon_detraccion','recurso_multa','saldo_export','horas_extras','reg_agrario','afp_comisiones','asignacion_fam','ratios_fin','amortizacion','dep_acelerada','leasing','conversor_tasas','isc','mineria','cierre_empresa','poder_notarial','verificador_ruc','proyeccion_afp','analizador_contratos','chat_sesiones','generador_informes','itf','ir_5ta','dividendos','no_domiciliados','cas','royalties','afp_onp','percepciones','notas_credito','factura_electronica','rectificatoria','essalud_senati','onp','cobranza_coactiva','donaciones','sucesiones','cripto_portfolio'];
function _ptKey(value) { return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function _ptSectionId(tab) {
  const legacyId = 'pt' + tab.charAt(0).toUpperCase() + tab.slice(1);
  if (document.getElementById(legacyId)) return legacyId;
  const wanted = _ptKey(tab);
  const match = Array.from(document.querySelectorAll('[id^="pt"]'))
    .find(el => _ptKey(el.id.slice(2)) === wanted);
  return match?.id || legacyId;
}
function setPTab(tab, btn) {
  PT_TAB_NAMES.forEach(t => {
    const el = document.getElementById(_ptSectionId(t));
    if (el) el.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('.pntab').forEach(b => b.classList.remove('active'));
  if (btn) { btn.classList.add('active'); }
  else {
    const match = document.querySelector(`.pntab[onclick*="'${tab}'"]`);
    if (match) match.classList.add('active');
  }
  if (tab === 'perfil') loadProfileForm();
  if (tab === 'historial') { const s = document.getElementById('histSearch'); if(s) s.value=''; renderHist(); }
  if (tab === 'chat_sesiones') calcChat();
  if (tab === 'sunat_live' || tab === 'sunat_api') loadSunatStatus();
  const content = document.querySelector('#screen-panel > .pnav + div');
  if (content) content.scrollTop = 0;
}

function _normalizeModuleSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function filterPanelNavigation(value) {
  const query = _normalizeModuleSearch(value);
  document.querySelectorAll('.pnav .pntab').forEach(button => {
    button.hidden = Boolean(query) && !_normalizeModuleSearch(button.textContent).includes(query);
  });
}

function openSpecializedModule(tab) {
  setPTab(tab, null);
}

function filterSpecializedModules(value) {
  const query = _normalizeModuleSearch(value);
  let visible = 0;
  document.querySelectorAll('#specializedModuleGrid .specialized-card').forEach(card => {
    const matches = !query || _normalizeModuleSearch(card.dataset.moduleName + ' ' + card.textContent).includes(query);
    card.hidden = !matches;
    if (matches) visible += 1;
  });
  const empty = document.getElementById('specializedModuleEmpty');
  if (empty) empty.hidden = visible !== 0;
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ONBOARDING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let onbData = {step:0, regimen:'', topics:[]};
function showOnboarding() {
  document.getElementById('onbOverlay').style.display='flex';
  onbData={step:0,regimen:'',topics:[]};
  [0,1,2].forEach(i=>{
    document.getElementById('onbS'+i).classList.toggle('active',i===0);
    document.getElementById('onbD'+i).classList.toggle('active',i===0);
  });
}
function selectOnb(step, val) {
  document.querySelectorAll('#onbOpts'+step+' .onb-opt').forEach(o=>o.classList.remove('sel'));
  event.target.classList.add('sel');
  if(step===0) onbData.regimen=val;
}
function toggleOnb(el, val) {
  el.classList.toggle('sel');
  const idx=onbData.topics.indexOf(val);
  if(idx>-1) onbData.topics.splice(idx,1); else onbData.topics.push(val);
}
function onbNext(step) {
  if (step === 1 && !onbData.regimen) { tpToast('Selecciona tu rÃ©gimen.', 'warn'); return; }
  [0,1,2].forEach(i=>{
    document.getElementById('onbS'+i).classList.toggle('active',i===step);
    document.getElementById('onbD'+i).classList.toggle('active',i===step);
  });
  onbData.step=step;
}
async function finishOnboarding() {
  document.getElementById('onbOverlay').style.display='none';
  if(!curUser) return;
  const updates = {
    regimen: onbData.regimen || curUser.regimen || '',
    topics: onbData.topics,
    onboarded: true
  };
  Object.assign(curUser, updates);
  if (fbReady && curUser.uid) {
    await fbDb.collection('users').doc(curUser.uid).update(updates)
      .catch(e => console.warn('Onboarding sync error:', e.message));
  }
  addNotif('ğŸ¯','Perfil configurado','Tu experiencia ha sido personalizada segÃºn tu rÃ©gimen y temas de interÃ©s.');
  newChat();
  // Auto-arrancar tour justo despuÃ©s del onboarding
  if (!curUser.tourDone) setTimeout(() => maybeStartTour(), 800);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// REFERIDOS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function getRefCode(email) { return 'REF'+btoa(email).substring(0,8).toUpperCase().replace(/[^A-Z0-9]/g,'X'); }
async function loadReferidos() {
  if(!curUser) return;
  let overview;
  try {
    overview = await declarafyApi('referrals_overview', {method:'GET'});
  } catch (error) {
    console.warn('No se pudo cargar Referidos:', error.message);
    const lb=document.getElementById('refLeaderList');
    if(lb) lb.innerHTML='<div class="ref-empty ref-empty-error">No se pudieron cargar los referidos. Intenta nuevamente.</div>';
    return;
  }
  const code=overview.code || getRefCode(curUser.email);
  const link=overview.link || ('https://declarafy.com/?ref='+encodeURIComponent(code));
  const el=document.getElementById('refLink');
  if(el) el.textContent=link.replace(/^https?:\/\//,'');
  if(document.getElementById('refTotal')) document.getElementById('refTotal').textContent=overview.total||0;
  if(document.getElementById('refActive')) document.getElementById('refActive').textContent=overview.active||0;
  if(document.getElementById('refMeses')) document.getElementById('refMeses').textContent=overview.rewardMonths||0;
  const sorted=Array.isArray(overview.leaders)?overview.leaders:[];
  const lb=document.getElementById('refLeaderList');
  if(lb){ if(!sorted.length){lb.innerHTML='<div class="ref-empty">AÃºn no hay referidores. Â¡SÃ© el primero!</div>';return;}
    lb.innerHTML=sorted.map((entry,i)=>`<div class="ref-row"><span class="ref-rank">${i===0?'ğŸ¥‡':i===1?'ğŸ¥ˆ':i===2?'ğŸ¥‰':i+1}</span><span class="ref-name">${_escapeHtml(entry.code||'')}</span><span class="ref-count">${Number(entry.total)||0} referidos</span></div>`).join(''); }
}
async function copyRefLink(event) {
  const btn = event?.currentTarget;
  const shown = document.getElementById('refLink')?.textContent?.trim();
  const link = shown ? (/^https?:\/\//i.test(shown) ? shown : `https://${shown}`) : `https://declarafy.com/?ref=${encodeURIComponent(getRefCode(curUser.email))}`;
  try {
    await navigator.clipboard.writeText(link);
    if(btn) { btn.textContent='âœ“ Enlace copiado'; setTimeout(()=>btn.textContent='Copiar enlace',2000); }
    addNotif('ğŸ”—','Enlace copiado','Tu enlace de referido fue copiado al portapapeles.');
  } catch (_) {
    tpToast('No se pudo copiar automÃ¡ticamente. Selecciona el enlace y cÃ³pialo manualmente.','warn');
  }
}
// Check ref code on register â€” persist URL param to localStorage
function checkRefCode() {
  const url=window.location.search; const params=new URLSearchParams(url);
  const urlRef = params.get('ref');
  if (urlRef) {
    localStorage.setItem('tp_ref', urlRef);
    return urlRef;
  }
  return localStorage.getItem('tp_ref')||'';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FAVORITOS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function getFavs(email) { try{return JSON.parse(localStorage.getItem('tp_fav_'+btoa(email))||'[]')}catch{return[]} }
function saveFavs(email,favs) { kvPut('tp_fav_'+btoa(email), favs, 'favs'); }
registerKVScope('favs',()=>'tp_fav_'+btoa(curUser?.email||''));
function saveFavorite(question, answer) {
  if(!curUser) return;
  const favs=getFavs(curUser.email);
  favs.unshift({id:Date.now(), q:question.substring(0,100), a:answer, area:AREAS[curArea]?.label||'General', date:new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'short'})});
  saveFavs(curUser.email, favs.slice(0,50));
  addNotif('â­','Respuesta guardada','La respuesta fue agregada a tus favoritos.');
}
function renderFavoritos() {
  if(!curUser) return;
  const favs=getFavs(curUser.email);
  const el=document.getElementById('favList'); if(!el) return;
  if(!favs.length){el.innerHTML='<div class="hempty">No tienes respuestas guardadas.<br>En el chat, presiona â­ en cualquier respuesta.</div>';return;}
  el.innerHTML=favs.map((f,i)=>`<div class="fav-item"><div class="fav-item-body"><div class="fav-item-q">â“ ${_escapeHtml(f.q)}</div><div class="fav-item-a">${_escapeHtml(String(f.a || '').replace(/<[^>]*>/g,'').substring(0,120))}â€¦</div><div class="fav-item-meta">${_escapeHtml(f.area)} Â· ${_escapeHtml(f.date)}</div></div><button class="fav-del" aria-label="Eliminar favorito" onclick="delFav(${i})">Ã—</button></div>`).join('');
}
function delFav(i) { const f=getFavs(curUser.email); f.splice(i,1); saveFavs(curUser.email,f); renderFavoritos(); }

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ESTADÃSTICAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderEstadisticas() {
  if(!curUser) return;
  const hist=getHist(curUser.email);
  const favs=getFavs(curUser.email);
  const totalMsgs=curUser.mc||0;
  const joinedAt=curUser.createdAt ? new Date(curUser.createdAt) : null;
  const memberDays=joinedAt && !Number.isNaN(joinedAt.getTime())
    ? Math.max(1, Math.floor((Date.now()-joinedAt.getTime())/86400000)+1)
    : 'â€”';
  const cards=document.getElementById('statsCards');
  if(cards) cards.innerHTML=`
    <div class="stat-card"><div class="stat-v">${totalMsgs}</div><div class="stat-l">Consultas totales</div></div>
    <div class="stat-card"><div class="stat-v">${hist.length}</div><div class="stat-l">Conversaciones</div></div>
    <div class="stat-card"><div class="stat-v">${favs.length}</div><div class="stat-l">Respuestas guardadas</div></div>
    <div class="stat-card"><div class="stat-v">${memberDays}</div><div class="stat-l">DÃ­as como miembro</div></div>`;
  // Sin una serie mensual persistida, solo se representa el total del mes actual.
  const months=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
  const now=new Date().getMonth();
  const data=months.map((_,i)=>i===now?totalMsgs:0);
  const maxVal=Math.max(...data,1);
  const bc=document.getElementById('barChart');
  if(bc) bc.innerHTML=data.map((v,i)=>`<div class="bar-col"><span class="bar-val">${v||''}</span><div class="bar-inner" style="height:${Math.max((v/maxVal)*100,v>0?5:0)}%"></div><span class="bar-lbl">${months[i]}</span></div>`).join('');
  // Topic distribution from history
  const topicCount={};
  hist.forEach(c=>{ const k=c.area||'General'; topicCount[k]=(topicCount[k]||0)+1; });
  const sorted=Object.entries(topicCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const tp=document.getElementById('topicPie');
  const total2=sorted.reduce((s,[,v])=>s+v,0)||1;
  if(tp) tp.innerHTML=sorted.length?sorted.map(([k,v])=>`<div class="topic-row"><span class="topic-nm">${k}</span><div class="topic-track"><div class="topic-bar" style="width:${Math.round((v/total2)*100)}%"></div></div><span class="topic-pct">${Math.round((v/total2)*100)}%</span></div>`).join(''):'<div style="font-size:14px;color:var(--muted)">AÃºn no hay datos suficientes. Â¡Empieza consultando!</div>';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMPARADOR DE REGÃMENES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function runComparador() {
  const ing=parseFloat(document.getElementById('cmpIngresos')?.value)||0;
  const gas=parseFloat(document.getElementById('cmpGastos')?.value)||0;
  const trab=parseInt(document.getElementById('cmpTrab')?.value)||0;
  if(!ing){document.getElementById('compResult').innerHTML='';return;}
  const uit=TAX_RULES.uit[TAX_RULES.currentYear], uti=Math.max(ing-gas,0);
  const resultados=[
    { name:'NRUS', eligible:ing<=96000&&trab===0, tax:ing/12<=5000?20:ing/12<=8000?50:null, detail:'Cuota mensual segÃºn promedio de ventas. La elegibilidad real tambiÃ©n depende de compras, activos, actividad y comprobantes emitidos.', code:'nrus' },
    { name:'RER', eligible:ing<=525000, tax:ing*0.015, detail:`IR: 1.5% de los ingresos netos anuales ingresados. La elegibilidad real tambiÃ©n depende de compras, activos y actividad.`, code:'rer' },
    { name:'RMT', eligible:ing<=1700*uit, tax:uti<=15*uit?uti*0.10:15*uit*0.10+(uti-15*uit)*0.295, detail:`IR: 10% hasta 15 UIT de utilidad, 29.5% por el exceso. Pago a cuenta desde 1%.`, code:'rmt' },
    { name:'RÃ©gimen General', eligible:true, tax:uti*0.295, detail:`IR: 29.5% sobre utilidad neta. Sin lÃ­mite de ingresos. Permite compensar pÃ©rdidas.`, code:'rg' },
  ];
  const eligible=resultados.filter(r=>r.eligible&&r.tax!==null);
  const minTax=Math.min(...eligible.map(r=>r.tax));
  const maxTax=Math.max(...eligible.map(r=>r.tax));
  const res=document.getElementById('compResult');
  res.innerHTML=resultados.map(r=>{
    const isBest=r.eligible&&r.tax!==null&&r.tax===minTax;
    const isWorst=r.eligible&&r.tax!==null&&r.tax===maxTax&&r.tax!==minTax;
    return `<div class="comp-card${isBest?' best':isWorst?' worst':''}">
      <div class="comp-name">${r.name}</div>
      ${r.eligible&&r.tax!==null?`<div class="comp-tax${isBest?' best':''}">${r.name==='NRUS'?`S/${r.tax}/mes`:`S/${Math.round(r.tax).toLocaleString()}/aÃ±o`}</div>`:'<div style="font-size:14px;color:var(--red)">No elegible</div>'}
      <div class="comp-detail">${r.detail}</div>
      ${isBest?'<span class="comp-badge rec">Menor IR estimado</span>':''}
      ${!r.eligible?'<span class="comp-badge no">No aplica para ti</span>':''}
    </div>`;
  }).join('');
  const best=eligible.find(r=>r.tax===minTax);
  const rec=document.getElementById('compRec');
  if(rec&&best){rec.style.display='block';rec.innerHTML=`ğŸ’¡ <strong>ComparaciÃ³n referencial:</strong> ${best.name} muestra el menor IR estimado con estos datos. No constituye una recomendaciÃ³n de acogimiento: faltan actividad, compras, activos, comprobantes y exclusiones legales.`;}
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PDT 621 WIZARD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let wizStep=0;
function wizGo(step) {
  [0,1,2,3].forEach(i=>{
    document.getElementById('wizP'+i).classList.toggle('active',i===step);
    const lbl=document.getElementById('wizLbl'+i);
    if(lbl){lbl.classList.toggle('active',i===step);lbl.classList.toggle('done',i<step);}
  });
  wizStep=step;
}
function wizCalculate() {
  const ventGrav=parseFloat(document.getElementById('wizVentasGrav')?.value)||0;
  const ventExon=parseFloat(document.getElementById('wizVentasExon')?.value)||0;
  const exportaciones=parseFloat(document.getElementById('wizExport')?.value)||0;
  const compGrav=parseFloat(document.getElementById('wizCompGrav')?.value)||0;
  const saldoAnt=parseFloat(document.getElementById('wizSaldoAnt')?.value)||0;
  const ingNeto=parseFloat(document.getElementById('wizIngNeto')?.value)||0;
  const coef=parseFloat(document.getElementById('wizCoef')?.value)||1.5;
  const mes=document.getElementById('wizMes')?.value||'este mes';
  const igvVentas=ventGrav*0.18;
  const igvCompras=compGrav*0.18;
  const debitoFiscal=igvVentas;
  const creditoFiscal=igvCompras;
  const igvAPagar=Math.max(0,debitoFiscal-creditoFiscal-saldoAnt);
  const saldoFavor=Math.max(0,creditoFiscal+saldoAnt-debitoFiscal);
  const pacIR=ingNeto*(coef/100);
  const totalPagar=igvAPagar+pacIR;
  const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  document.getElementById('wizResult').innerHTML=`
    <h4>Resumen declaraciÃ³n ${mes}</h4>
    <div class="wiz-row"><span class="wiz-row-lbl">Ventas gravadas</span><span class="wiz-row-val">${fmtS(ventGrav)}</span></div>
    <div class="wiz-row"><span class="wiz-row-lbl">IGV dÃ©bito fiscal (18%)</span><span class="wiz-row-val">${fmtS(debitoFiscal)}</span></div>
    <div class="wiz-row"><span class="wiz-row-lbl">IGV crÃ©dito fiscal</span><span class="wiz-row-val">${fmtS(creditoFiscal)}</span></div>
    ${saldoAnt>0?`<div class="wiz-row"><span class="wiz-row-lbl">Saldo a favor anterior</span><span class="wiz-row-val green">${fmtS(saldoAnt)}</span></div>`:''}
    <div class="wiz-row" style="border-top:1px solid var(--gold);margin-top:6px;padding-top:10px"><span class="wiz-row-lbl"><strong>IGV a pagar</strong></span><span class="wiz-row-val gold"><strong>${fmtS(igvAPagar)}</strong></span></div>
    ${saldoFavor>0?`<div class="wiz-row"><span class="wiz-row-lbl">Saldo a favor generado</span><span class="wiz-row-val green">${fmtS(saldoFavor)}</span></div>`:''}
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"></div>
    <div class="wiz-row"><span class="wiz-row-lbl">Ingresos netos del mes</span><span class="wiz-row-val">${fmtS(ingNeto)}</span></div>
    <div class="wiz-row"><span class="wiz-row-lbl">Pago a cuenta IR (${coef}%)</span><span class="wiz-row-val">${fmtS(pacIR)}</span></div>
    <div class="wiz-row" style="background:rgba(201,168,76,.08);padding:10px;border-radius:8px;margin-top:8px"><span class="wiz-row-lbl"><strong>TOTAL A PAGAR PDT 621</strong></span><span class="wiz-row-val gold" style="font-size:18px"><strong>${fmtS(totalPagar)}</strong></span></div>
    <p style="font-size:14px;color:var(--muted);margin-top:12px">âš ï¸ Este cÃ¡lculo es orientativo. Verifica en SUNAT Virtual con tu Clave SOL antes de presentar.</p>`;
  wizGo(3);
}
function wizExport() {
  const win=window.open('','_blank');
  const res=document.getElementById('wizResult')?.innerHTML||'';
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PDT 621 â€” DeclaraFY</title><style>body{font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#333}h1{color:#C9A84C;border-bottom:2px solid #C9A84C;padding-bottom:8px}.wiz-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eee;font-size:14px}.wiz-row-lbl{color:#666}.gold{color:#C9A84C;font-weight:bold}</style></head><body><h1>Resumen PDT 621 â€” DeclaraFY</h1><p style="font-size:14px;color:#888">Generado: ${new Date().toLocaleDateString('es-PE')} Â· Usuario: ${_escapeHtml(curUser?.name||'â€”')}</p>${res}</body></html>`);
  win.document.close(); setTimeout(()=>win.print(),500);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BIBLIOTECA DE NORMAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const BIB_DATA = [
  {id:1,name:'CÃ³digo Tributario â€” TUO D.S. 133-2013-EF',cat:'ct',tag:'CÃ³digo Tributario',desc:'Norma fundamental del sistema tributario peruano. Regula la relaciÃ³n jurÃ­dica tributaria, obligaciones formales, infracciones y procedimientos.',resumen:`Art. 1: La obligaciÃ³n tributaria nace cuando se realiza el hecho previsto en la ley como generador de dicha obligaciÃ³n.\nArt. 28: La deuda tributaria estÃ¡ constituida por el tributo, las multas y los intereses.\nArt. 33: La TIM es fijada por SUNAT; la tasa vigente en moneda nacional es 0.9% mensual desde el 01/04/2021.\nArt. 43: La acciÃ³n de la AdministraciÃ³n para determinar deuda prescribe a los 4 aÃ±os (contribuyentes que presentan declaraciÃ³n) o 6 aÃ±os (los que no presentan).\nArt. 87: Obligaciones formales: inscribirse en RUC, emitir comprobantes, llevar libros contables, permitir fiscalizaciones.\nArt. 166: El rÃ©gimen de gradualidad permite reducir sanciones por subsanaciÃ³n voluntaria.`},
  {id:2,name:'TUO Ley del IGV â€” D.S. 055-99-EF',cat:'igv',tag:'IGV',desc:'Regula el Impuesto General a las Ventas. Tasa vigente 18% (16% IGV + 2% IPM). Incluye crÃ©dito fiscal, exoneraciones y rÃ©gimen de percepciones/detracciones.',resumen:`Art. 1: Son operaciones gravadas: venta de bienes, prestaciÃ³n de servicios, contratos de construcciÃ³n, primera venta de inmuebles e importaciÃ³n.\nArt. 3: El crÃ©dito fiscal se aplica sobre el IGV de las adquisiciones que sean permitidas como gasto/costo y destinadas a operaciones gravadas.\nArt. 18-19: Requisitos sustanciales y formales del crÃ©dito fiscal. La factura debe estar a nombre del contribuyente y el IGV discriminado.\nArt. 33: Las exportaciones estÃ¡n gravadas con tasa 0% y generan saldo a favor del exportador.\nArt. 44: No generan crÃ©dito fiscal: gastos personales, cigarrillos, bebidas alcohÃ³licas (salvo giro del negocio), multas.`},
  {id:3,name:'TUO Ley del IR â€” D.S. 179-2004-EF',cat:'lir',tag:'Impuesto a la Renta',desc:'Regula el Impuesto a la Renta de todas las categorÃ­as. Incluye gastos deducibles, depreciaciones, pagos a cuenta y declaraciÃ³n anual.',resumen:`Art. 6: EstÃ¡n sujetas al IR las personas naturales y jurÃ­dicas domiciliadas y no domiciliadas (por rentas de fuente peruana).\nArt. 36: Las personas naturales aplican la deducciÃ³n del 20% sobre rentas de 4ta categorÃ­a (mÃ­nimo hasta 7 UIT de renta neta).\nArt. 37: Gastos deducibles 3ra categorÃ­a: remuneraciones, depreciaciones, intereses, castigos, donaciones, gastos de representaciÃ³n (0.5% ingresos, mÃ¡x. 40 UIT), entre otros.\nArt. 44: No deducibles: gastos personales, sanciones, multas, IR propio, donaciones no autorizadas.\nArt. 55: Tasa IR RÃ©gimen General: 29.5%. RMT: 10% hasta 15 UIT de renta neta, 29.5% por el exceso.\nArt. 57: Principio del devengado: los ingresos se reconocen en el perÃ­odo en que se ganan, no cuando se cobran.`},
  {id:4,name:'Arancel de Aduanas â€” D.S. 342-2016-EF',cat:'aduanas',tag:'Aduanas',desc:'Nomenclatura y tasas arancelarias para importaciones. Basado en el Sistema Armonizado. Ad valorem vigente: 0%, 6% y 11%.',resumen:`El Arancel de Aduanas clasifica todas las mercancÃ­as segÃºn la Nomenclatura del Sistema Armonizado (SA). Las tasas Ad Valorem en PerÃº son: 0% (mayorÃ­a de bienes), 6% y 11% (bienes sensibles como textiles, calzado, arroz).\n\nAdemÃ¡s del arancel se aplican:\n- IGV: 16% sobre el valor CIF + Ad Valorem\n- IPM: 2%\n- ISC: segÃºn tablas (combustibles, autos, bebidas)\n- Derechos antidumping (si aplica)\n- PercepciÃ³n del IGV: 3.5% o 10%\n\nEl valor en aduana se determina por el MÃ©todo del Valor de TransacciÃ³n (Art. VII GATT).`},
  {id:5,name:'Precios de Transferencia â€” D.S. 008-2023-EF',cat:'reglamentos',tag:'Precios Transfer.',desc:'Reglamento de precios de transferencia. Regula operaciones entre partes vinculadas. Obliga a cumplir el principio Arm\'s Length.',resumen:`El D.S. 008-2023-EF reglamenta el Art. 32-A de la LIR sobre precios de transferencia.\n\nObligados a presentar documentaciÃ³n:\n- Local File: contribuyentes con ingresos â‰¥ 2,300 UIT y operaciones vinculadas â‰¥ 100 UIT\n- Master File: grupos con ingresos consolidados â‰¥ 20,000 UIT\n- Country by Country Report: grupos con ingresos â‰¥ 2,700 millones de soles\n\nMÃ©todos permitidos (en orden de preferencia):\n1. Precio Comparable No Controlado (CUP)\n2. Precio de Reventa\n3. Costo Incrementado\n4. Margen Neto Transaccional (TNMM) â€” el mÃ¡s usado\n5. ParticiÃ³n de Utilidades\n\nRango de plena competencia: si el precio cae fuera del rango intercuartil, SUNAT ajusta a la mediana.`},
  {id:6,name:'Reglamento de Comprobantes de Pago â€” R.S. 007-99/SUNAT',cat:'reglamentos',tag:'Comprobantes',desc:'Regula los tipos de comprobantes, obligados a emitir, requisitos mÃ­nimos y facturaciÃ³n electrÃ³nica.',resumen:`Tipos de comprobantes de pago:\n- Facturas: operaciones con empresas o personas que necesiten sustentar costo/gasto\n- Boletas de venta: consumidores finales\n- Tickets: mÃ¡quinas registradoras autorizadas\n- Liquidaciones de compra: adquisiciones a personas sin RUC\n- Notas de crÃ©dito/dÃ©bito: ajustes a comprobantes emitidos\n\nFacturaciÃ³n electrÃ³nica obligatoria desde 2019 para la mayorÃ­a de contribuyentes.\nSistemas: SEE-SOL (gratuito), SEE-Contribuyente (propio) u OSE (tercerizado).\nLa factura electrÃ³nica es vÃ¡lida cuando SUNAT la acepta (CDR de aceptaciÃ³n).`},
  {id:7,name:'D.Leg. 813 â€” Ley Penal Tributaria',cat:'ct',tag:'Derecho Penal',desc:'Tipifica los delitos tributarios. DefraudaciÃ³n tributaria, elaboraciÃ³n de comprobantes falsos y otros ilÃ­citos con penas de cÃ¡rcel.',resumen:`Art. 1: DefraudaciÃ³n tributaria: el que deja de pagar tributos usando engaÃ±o, ardid o falsedad. Pena: 5 a 8 aÃ±os de cÃ¡rcel.\nArt. 2: Formas agravadas (8 a 12 aÃ±os): uso de facturas falsas, utilizaciÃ³n fraudulenta de beneficios, obtener devoluciones indebidas.\nArt. 5: ElaboraciÃ³n y comercializaciÃ³n de facturas falsas: 5 a 8 aÃ±os.\n\nDiferencia clave:\n- InfracciÃ³n tributaria (CÃ³digo Tributario): responsabilidad civil/administrativa, se paga con multas\n- Delito tributario (D.Leg. 813): responsabilidad penal, puede implicar prisiÃ³n efectiva\n\nLa regularizaciÃ³n tributaria antes de la investigaciÃ³n fiscal puede extinguir la acciÃ³n penal (Art. 8 D.Leg. 813).`},
  {id:8,name:'NRUS â€” D.Leg. 937',cat:'lir',tag:'NRUS',desc:'RÃ©gimen simplificado para pequeÃ±os negocios. Cuota fija mensual de S/20 o S/50. Sin obligaciÃ³n de llevar libros contables.',resumen:`El Nuevo RÃ©gimen Ãšnico Simplificado estÃ¡ dirigido a personas naturales y sucesiones indivisas con pequeÃ±os negocios.\n\nCategorÃ­as:\n- CategorÃ­a 1: Ingresos/compras hasta S/5,000/mes â†’ Cuota: S/20/mes\n- CategorÃ­a 2: Ingresos/compras hasta S/8,000/mes â†’ Cuota: S/50/mes\n\nVentajas: Sin obligaciÃ³n de llevar libros contables. Sin declaraciÃ³n anual de IR. Pago Ãºnico mensual.\n\nRestricciones: Solo pueden emitir boletas de venta y tickets. No pueden tener mÃ¡s de 1 establecimiento. No pueden contratar mÃ¡s de 10 trabajadores. No realizan importaciones superiores a S/8,000/mes.\n\nExclusiones: Actividades profesionales, transporte de carga (mÃ¡s de 2 ton), bares, casinos, discotecas.`},
];
let bibFilter='todos';
function filterBib(cat,btn) {
  document.querySelectorAll('.bib-cat').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  bibFilter=cat; renderBib('');
  const s=document.getElementById('bibSearch'); if(s)s.value='';
}
function searchBib(q) { renderBib(q.toLowerCase().trim()); }
function renderBib(q) {
  const el=document.getElementById('bibList'); if(!el)return;
  let items=bibFilter==='todos'?BIB_DATA:BIB_DATA.filter(b=>b.cat===bibFilter);
  if(q) items=items.filter(b=>b.name.toLowerCase().includes(q)||b.desc.toLowerCase().includes(q)||b.resumen.toLowerCase().includes(q));
  if(!items.length){el.innerHTML='<div class="hempty">No se encontraron normas.</div>';return;}
  el.innerHTML=items.map(b=>`
    <div class="bib-item" onclick="toggleBibDetail(${b.id})">
      <div class="bib-item-top"><span class="bib-item-name">${b.name}</span><span class="bib-item-tag">${b.tag}</span></div>
      <div class="bib-item-desc">${b.desc}</div>
      <div class="bib-detail" id="bibD${b.id}"><pre style="white-space:pre-wrap;font-family:inherit;font-size:14px">${b.resumen}</pre>
        <button class="bib-ask-btn" onclick="askAboutNorm(event,'${b.name.replace(/'/g,"\\'")}')">ğŸ’¬ Preguntarle a la IA sobre esta norma</button>
      </div>
    </div>`).join('');
}
function toggleBibDetail(id) {
  const el=document.getElementById('bibD'+id); if(!el)return;
  el.classList.toggle('open');
}
function askAboutNorm(e,normName) {
  e.stopPropagation();
  convHist=[]; convId=null;
  goToChat();
  setTimeout(()=>sendMsg(`ExplÃ­came en detalle la norma: ${normName} y cÃ³mo me afecta como contribuyente peruano`),300);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// OVERRIDE setPTab TO LOAD DATA
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Capture the implementation that exists at this point. Referencing
// `_origSetPTab` here is unsafe because that `const` is declared much later in
// this bundled file; even `typeof` throws while a lexical binding is in its
// temporal dead zone and aborts the whole application during startup.
const _origSetPTab2 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTab2(tab, btn);
  if(tab==='estadisticas') renderEstadisticas();
  if(tab==='referidos') loadReferidos();
  if(tab==='favoritos') renderFavoritos();
  if(tab==='biblioteca') { renderBib(''); }
  if(tab==='perfil') loadProfileForm();
  if(tab==='historial') { const s=document.getElementById('histSearch');if(s)s.value=''; renderHist(); }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TEXT TO SPEECH (TTS)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let ttsUtterance = null;
let ttsActive = false;

function speakText(text, btn) {
  if (!('speechSynthesis' in window)) {
    tpToast('Tu navegador no soporta texto a voz. Prueba con Chrome o Edge.', 'warn');
    return;
  }
  // Stop if already playing
  if (ttsActive) { stopTTS(); if (btn) { btn.textContent = 'ğŸ”Š Escuchar'; } return; }
  const clean = text.replace(/[#*_`]/g, '').trim();
  ttsUtterance = new SpeechSynthesisUtterance(clean);
  ttsUtterance.lang = 'es-PE';
  ttsUtterance.rate = 0.95;
  ttsUtterance.pitch = 1.0;
  // Try to find a Spanish voice
  const voices = speechSynthesis.getVoices();
  const esVoice = voices.find(v => v.lang.startsWith('es')) || voices[0];
  if (esVoice) ttsUtterance.voice = esVoice;
  ttsActive = true;
  const bar = document.getElementById('ttsGlobalBar');
  if (bar) bar.classList.add('active');
  if (btn) { btn.textContent = 'â¹ Detener'; btn.classList.add('playing'); }
  let startTime = Date.now();
  const words = clean.split(' ').length;
  const estDuration = (words / 130) * 60 * 1000; // ~130 wpm
  const timer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min((elapsed / estDuration) * 100, 99);
    const fill = document.getElementById('ttsFill');
    const timeEl = document.getElementById('ttsTime');
    if (fill) fill.style.width = pct + '%';
    if (timeEl) { const secs = Math.floor(elapsed/1000); timeEl.textContent = Math.floor(secs/60)+':'+(secs%60).toString().padStart(2,'0'); }
  }, 200);
  ttsUtterance.onend = () => {
    clearInterval(timer); ttsActive = false;
    if (bar) bar.classList.remove('active');
    if (btn) { btn.textContent = 'ğŸ”Š Escuchar'; btn.classList.remove('playing'); }
    const fill = document.getElementById('ttsFill'); if (fill) fill.style.width = '100%';
    setTimeout(() => { if (fill) fill.style.width = '0%'; }, 500);
  };
  ttsUtterance.onerror = () => { clearInterval(timer); ttsActive = false; if (bar) bar.classList.remove('active'); };
  speechSynthesis.speak(ttsUtterance);
}

function stopTTS() {
  speechSynthesis.cancel();
  ttsActive = false;
  const bar = document.getElementById('ttsGlobalBar');
  if (bar) bar.classList.remove('active');
  const fill = document.getElementById('ttsFill');
  if (fill) fill.style.width = '0%';
}

// Read last AI message with Ctrl+R
function readLastMessage() {
  const msgs = document.querySelectorAll('.msg.ai .bbl');
  if (!msgs.length) return;
  const last = msgs[msgs.length - 1];
  speakText(last.innerText, null);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KEYBOARD SHORTCUTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
document.addEventListener('keydown', function(e) {
  const tag = document.activeElement.tagName.toLowerCase();
  const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';
  // ESC: close any open overlay
  if (e.key === 'Escape') {
    ['kbdOverlay','authOv','authOverlay','apiOv','onbOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden') && el.style.display !== 'none') {
        el.classList.add('hidden'); el.style.display = 'none';
      }
    });
    stopTTS();
    return;
  }
  // ? key: show keyboard shortcuts
  if (e.key === '?' && !isTyping) {
    document.getElementById('kbdOverlay').classList.remove('hidden');
    return;
  }
  if (!e.ctrlKey && !e.metaKey) return;
  // Ctrl shortcuts
  switch(e.key.toLowerCase()) {
    case 'n':
      e.preventDefault();
      if (curUser) newChat();
      break;
    case 's':
      e.preventDefault();
      if (document.getElementById('screen-chat').classList.contains('active')) saveAndPanel();
      break;
    case 'p':
      e.preventDefault();
      if (document.getElementById('screen-chat').classList.contains('active')) exportPDF();
      break;
    case 'h':
      e.preventDefault();
      if (curUser) goPanel();
      break;
    case 'f':
      e.preventDefault();
      if (curUser) {
        goPanel();
        setTimeout(() => { setPTab('historial', null); const s = document.getElementById('histSearch'); if(s) s.focus(); }, 200);
      }
      break;
    case 'd':
      e.preventDefault();
      toggleTheme();
      break;
    case 'r':
      e.preventDefault();
      if (document.getElementById('screen-chat').classList.contains('active')) readLastMessage();
      break;
    case '/':
      e.preventDefault();
      const inp = document.getElementById('userInput'); if (inp) inp.focus();
      break;
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TOUR GUIADO INTERACTIVO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TOUR STEPS â€” CHAT (when first opening chat)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const TOUR_STEPS = [
  { selector:'.abar,#areaTabs', title:'ğŸ“‹ 17 Ãreas tributarias especializadas', position:'bottom',
    desc:'Selecciona el Ã¡rea antes de consultar: IGV, Renta, ISC, ITF, Aranceles, Aduanas, Precios de Transferencia, NRUS, Vehicular y las 6 ramas del Derecho Tributario. La IA ajusta su anÃ¡lisis a la norma especÃ­fica del Ã¡rea â€” recibes asesorÃ­a especializada, no respuestas genÃ©ricas.' },
  { selector:'#casoHeaderBar,.caso-header-bar', title:'ğŸ—‚ Casos Tributarios Particulares', position:'bottom',
    desc:'Para casos complejos (fiscalizaciones, recursos de apelaciÃ³n, PT, contratos) activa un expediente. Adjunta hasta 8 documentos: PDFs con extracciÃ³n real de texto, Excel, Word y XML. La IA cruza toda la informaciÃ³n y genera un Informe de Conclusiones formal con base legal exacta lista para presentar.' },
  { selector:'#multiFilePanel,.uprow', title:'ğŸ“ AnÃ¡lisis multi-documento', position:'top',
    desc:'Sube PDFs, Excel, Word o XML. La IA extrae texto real de los PDFs, cruza datos entre documentos y detecta inconsistencias tributarias. Ideal para analizar balances + contratos + resoluciones SUNAT simultÃ¡neamente.' },
  { selector:'.chat-quota-bar,#chatQuotaBar', title:'ğŸ“Š Consumo y sincronizaciÃ³n segura', position:'bottom',
    desc:'Monitorea tu consumo mensual. Plan BÃ¡sico: 30 consultas. Plan Pro: ilimitadas. La barra cambia a rojo al 80% de uso. Tus conversaciones se guardan en tu cuenta y estÃ¡n disponibles desde cualquier dispositivo.' },
  { selector:'.chr,.chat-header-right', title:'âš¡ Acciones rÃ¡pidas del chat', position:'bottom',
    desc:'"ğŸ“„ PDF" exporta con formato profesional. "ğŸ’¾" guarda en tu cuenta. "ğŸ”Š" lee la respuesta en voz alta. Atajos: Ctrl+S guardar, Ctrl+P exportar, Ctrl+R escuchar, Ctrl+N nueva consulta, Ctrl+H ir al panel. Presiona "?" para ver todos.' },
  { selector:'#userInput,.ci', title:'âœï¸ Consulta cualquier tema tributario', position:'top',
    desc:'Pregunta sobre IGV, Renta, ITAN, Drawback, CDIs, Precios de Transferencia, NIIF/NIC, SBS, SMV, SUNAFIL, INDECOPI, BCR, Zonas Especiales, Cripto y mÃ¡s. Enter para enviar, Shift+Enter para nueva lÃ­nea.' },
];

const PANEL_TOUR_STEPS = [
  { selector:'.pnav,#panelNav', title:'ğŸ§­ 145 mÃ³dulos y herramientas tributarias', position:'bottom',
    desc:'El panel integra: Calculadoras (IGV, IR, ITAN, Drawback 3% FOB, Detracciones, Retenciones, Percepciones, Fraccionamiento Art.36 CT, Utilidades D.Leg.892, TIM), Normativa (SBS Ley 26702, SMV D.Leg.861, Tribunal Fiscal RTFs, Informes SUNAT, SUNAFIL, INDECOPI, BCR), MÃ³dulos avanzados (PT con 7 herramientas, NIIF/NIC, 8 CDIs, Zonas Especiales, Criptomonedas, Derecho Comparado) y herramientas operativas (Cierre Contable, Expediente FiscalizaciÃ³n, Contratos optimizados, Respuesta a Requerimientos SUNAT).' },
  { selector:'.pnav button', title:'ğŸ—‚ Casos y Expedientes', position:'bottom',
    desc:'Crea expedientes para casos complejos con wizard de 4 pasos. Constructor de Expediente de FiscalizaciÃ³n con 26 documentos organizados por prioridad CRÃTICO/IMPORTANTE/Normal. Genera el Ã­ndice formal del expediente listo para presentar ante SUNAT.' },
  { selector:'.pnav', title:'ğŸ”— MÃ³dulo Precios de Transferencia', position:'bottom',
    desc:'7 herramientas especializadas: Detector de umbrales Local File/Master File/CbCR (D.S. 008-2023-EF), Selector de mÃ©todo OCDE con justificaciÃ³n legal y RTFs, AnÃ¡lisis funcional F/R/A automÃ¡tico con plantillas OCDE 2022, Calculadora de rango intercuartil P25-P75, Checklist de fiscalizaciÃ³n (26 puntos con riesgo ALTO/MEDIO/BAJO), Asistente de Local File y Generador de Informe PT en PDF.' },
  { selector:'.pnav', title:'âœˆï¸ Drawback â€” MÃ³dulo completo', position:'bottom',
    desc:'Calculadora de restituciÃ³n (3% del FOB exportado), verificaciÃ³n del ratio insumos/FOB â‰¤50%, pronÃ³stico mensual con estacionalidad, requisitos del D.S.104-95-EF, proceso de 7 pasos con plazos, documentos requeridos y tratamiento tributario completo (las NCN son ingreso gravado con IR pero no con IGV).' },
  { selector:'.pnav', title:'ğŸ“ NIIF vs NIC y CDIs', position:'bottom',
    desc:'MÃ³dulo NIIF/NIC: tabla de 8 diferencias clave (NIIF 16 arrendamientos, NIIF 15 ingresos, NIIF 9 deterioro, NIC 36, NIC 37, NIC 12 IR diferido) con tipo temporaria/permanente y base legal. Calculadora de conciliaciÃ³n contable-tributaria con IR diferido. CDIs: anÃ¡lisis de los 8 convenios vigentes de PerÃº (Chile, EspaÃ±a, CanadÃ¡, Brasil, MÃ©xico, Portugal, Suiza, Corea) con tasas reales y ahorro calculado.' },
];

let tourStep = 0;
let tourActive = false;

function startTour(type) {
  // type: 'chat' (default) or 'panel'
  tourActive = true; tourStep = 0;
  activeTourSteps = (type === 'panel') ? PANEL_TOUR_STEPS : TOUR_STEPS;
  showTourStep(0);
}
let activeTourSteps = TOUR_STEPS;

function showTourStep(step) {
  // Remove existing tour elements
  document.querySelectorAll('.tour-spotlight,.tour-tooltip').forEach(el => el.remove());
  if (step >= activeTourSteps.length) { endTour(); return; }
  const cfg = activeTourSteps[step];
  const target = document.querySelector(cfg.selector);
  if (!target) { showTourStep(step + 1); return; }
  const rect = target.getBoundingClientRect();
  const pad = 6;
  // Spotlight
  const spot = document.createElement('div');
  spot.className = 'tour-spotlight';
  spot.style.cssText = `top:${rect.top-pad}px;left:${rect.left-pad}px;width:${rect.width+pad*2}px;height:${rect.height+pad*2}px`;
  document.body.appendChild(spot);
  // Tooltip
  const tip = document.createElement('div');
  tip.className = 'tour-tooltip arrow-' + (cfg.position === 'bottom' ? 'top' : 'bottom');
  tip.innerHTML = `
    <div class="tour-title">${cfg.title}</div>
    <div class="tour-desc">${cfg.desc}</div>
    <div class="tour-nav">
      <span class="tour-counter">${step+1} / ${activeTourSteps.length}</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="tour-btn-skip" onclick="endTour()">Omitir tour</button>
        <button class="tour-btn-next" onclick="showTourStep(${step+1})">${step === activeTourSteps.length-1 ? 'Â¡Listo!' : 'Siguiente â†’'}</button>
      </div>
    </div>`;
  const tipTop = cfg.position === 'bottom' ? rect.bottom + pad + 10 : rect.top - 160 - pad;
  const tipLeft = Math.max(10, Math.min(rect.left, window.innerWidth - 320));
  tip.style.cssText = `top:${tipTop}px;left:${tipLeft}px`;
  document.body.appendChild(tip);
}

function endTour() {
  tourActive = false;
  document.querySelectorAll('.tour-spotlight,.tour-tooltip').forEach(el => el.remove());
  if (curUser) {
    curUser.tourDone = true;
    if (fbReady && curUser.uid) {
      fbDb.collection('users').doc(curUser.uid).update({ tourDone: true })
        .catch(e => console.warn('Tour sync error:', e.message));
    }
    addNotif('ğŸ‰', 'Tour completado', 'Ya conoces todas las funciones principales. Â¡Empieza a consultar!');
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ALERTAS DE VENCIMIENTO POR RUC
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function getDigitoRuc(ruc) { return ruc ? parseInt(ruc.slice(-1)) : 0; }

function loadAlerts() {
  const ruc = document.getElementById('alertRuc')?.value?.trim() || '';
  const regimen = document.getElementById('alertRegimen')?.value || 'rmt';
  if (ruc.length < 11) { tpToast('Ingresa un RUC vÃ¡lido de 11 dÃ­gitos.', 'warn'); return; }
  const digito = getDigitoRuc(ruc);
  // SUNAT 2025 - vencimiento segÃºn Ãºltimo dÃ­gito RUC (dÃ­as hÃ¡biles aproximados)
  const diasExtra = [0,1,2,3,4,5,6,7,8,9][digito];
  const today = new Date();
  const year = today.getFullYear();
  // PrÃ³ximos vencimientos basados en el dÃ­gito RUC
  const baseDay = 12 + diasExtra; // dÃ­gito 0=dÃ­a 12, 1=dÃ­a 13... 9=dÃ­a 21
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
  const proxVenc = [];
  for (let m = today.getMonth(); m < Math.min(today.getMonth() + 4, 12); m++) {
    const vencDate = new Date(year, m + 1, baseDay); // mes siguiente, dÃ­a baseDay
    const diff = Math.round((vencDate - today) / (1000 * 60 * 60 * 24));
    const urg = diff <= 5 ? 'urgent' : diff <= 15 ? 'soon' : 'ok';
    const urgLabel = diff <= 0 ? 'Vencido' : diff === 0 ? 'Hoy' : `En ${diff} dÃ­as`;
    proxVenc.push({
      icon: diff <= 5 ? 'ğŸ”´' : diff <= 15 ? 'ğŸŸ¡' : 'ğŸŸ¢',
      name: `DeclaraciÃ³n PDT 621 â€” ${months[m]} ${year}`,
      sub: `RUC dÃ­gito ${digito} Â· Vence: ${baseDay} ${months[(m+1)%12]}`,
      days: urgLabel, urg
    });
  }
  // Annual obligations
  const anualObs = [
    { icon:'ğŸ“‹', name:`DJ Anual IR ${year-1}`, sub:'DeclaraciÃ³n Jurada Anual â€” PDT 710', days:`Marzo-Abril ${year}`, urg:'soon' },
    { icon:'ğŸ¦', name:'ITAN 2025 â€” Cuotas', sub:'Impuesto Temporal a los Activos Netos', days:'Jun / Jul 2025', urg:'ok' },
  ];
  if (regimen === 'rg' || regimen === 'rmt') {
    anualObs.push({ icon:'ğŸ”—', name:'Precios de Transferencia', sub:'Local File â€” Form. 3560 (si obligado)', days:'Octubre 2025', urg:'ok' });
  }
  document.getElementById('alertRucBadge').textContent = 'RUC: ' + ruc.slice(0,-4) + '****';
  const alertList = document.getElementById('alertList');
  alertList.innerHTML = proxVenc.map(a => `
    <div class="alert-item ${a.urg}">
      <span class="alert-icon">${a.icon}</span>
      <div class="alert-info"><div class="alert-name">${a.name}</div><div class="alert-sub">${a.sub}</div></div>
      <span class="alert-days ${a.urg}">${a.days}</span>
    </div>`).join('');
  const alertAnual = document.getElementById('alertAnual');
  alertAnual.innerHTML = anualObs.map(a => `
    <div class="alert-item ${a.urg}">
      <span class="alert-icon">${a.icon}</span>
      <div class="alert-info"><div class="alert-name">${a.name}</div><div class="alert-sub">${a.sub}</div></div>
      <span class="alert-days ${a.urg}">${a.days}</span>
    </div>`).join('');
  document.getElementById('alertsResult').style.display = 'block';
  // Save RUC to user profile
  if (curUser) {
    if (!curUser.ruc) {
      curUser.ruc = ruc;
      if (fbReady && curUser.uid) {
        fbDb.collection('users').doc(curUser.uid).update({ ruc })
          .catch(e => console.warn('RUC sync error:', e.message));
      }
    }
    addNotif('ğŸ””', 'Alertas configuradas', `Vencimientos para RUC ${ruc.slice(0,4)}... cargados. DÃ­gito ${digito} â†’ vence dÃ­a ${baseDay} de cada mes.`);
  }
}

// Auto-fill RUC from profile
function initAlerts() {
  if (curUser?.ruc) {
    const inp = document.getElementById('alertRuc');
    if (inp) { inp.value = curUser.ruc; }
  }
  if (curUser?.regimen) {
    const sel = document.getElementById('alertRegimen');
    if (sel) sel.value = curUser.regimen;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GENERADOR DE INFORME EJECUTIVO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function generateInforme() {
  const empresa = document.getElementById('infEmpresa')?.value?.trim() || 'Empresa';
  const regimen = document.getElementById('infRegimen')?.value || 'RMT';
  const sector = document.getElementById('infSector')?.value || 'servicios';
  const ingresos = document.getElementById('infIngresos')?.value || '0';
  const utilidad = document.getElementById('infUtilidad')?.value || '0';
  const contingencias = document.getElementById('infContingencias')?.value?.trim() || 'Sin contingencias identificadas';
  const objetivo = document.getElementById('infObjetivo')?.value || 'directorio';
  const objetivoLabel = {directorio:'Presentar al directorio',auditoria:'PreparaciÃ³n para auditorÃ­a SUNAT',banco:'Solicitud de crÃ©dito bancario',inversionista:'Due diligence / inversores',general:'RevisiÃ³n interna general'}[objetivo];

  const loading = document.getElementById('informeLoading');
  const preview = document.getElementById('informePreview');
  const expBtn = document.getElementById('infExportBtn');
  const cpyBtn = document.getElementById('infCopyBtn');

  loading.style.display = 'block';
  preview.style.display = 'none';
  if (expBtn) expBtn.style.display = 'none';
  if (cpyBtn) cpyBtn.style.display = 'none';

  const prompt = `Genera un informe ejecutivo tributario profesional en espaÃ±ol para:
Empresa: ${empresa}
RÃ©gimen: ${regimen}
Sector: ${sector}
Ingresos anuales: S/ ${parseInt(ingresos).toLocaleString()}
Utilidad neta: S/ ${parseInt(utilidad).toLocaleString()}
Contingencias identificadas: ${contingencias}
Objetivo del informe: ${objetivoLabel}
Fecha: ${new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'long',year:'numeric'})}

Estructura el informe con estas secciones:
1. Resumen ejecutivo
2. SituaciÃ³n tributaria actual (rÃ©gimen, obligaciones, carga tributaria efectiva)
3. AnÃ¡lisis de contingencias y riesgos
4. Indicadores tributarios clave (IR efectivo, IGV, ratios)
5. Recomendaciones de optimizaciÃ³n
6. Conclusiones

Usa base legal peruana vigente (LIR, LIGV, CT). SÃ© profesional y conciso. MÃ¡ximo 600 palabras.`;

  if (!apiKey) {
    loading.style.display = 'none';
    preview.style.display = 'block';
    preview.innerHTML = `<h3>INFORME EJECUTIVO TRIBUTARIO â€” DEMO</h3>
<h4>1. Resumen ejecutivo</h4>
<p><em>${empresa}</em> opera bajo el ${regimen} en el sector ${sector}. Los ingresos anuales ascienden a S/ ${parseInt(ingresos).toLocaleString()} con una utilidad neta de S/ ${parseInt(utilidad).toLocaleString()}.</p>
<h4>2. SituaciÃ³n tributaria</h4>
<p>RÃ©gimen: <strong>${regimen}</strong>. Carga tributaria estimada: ${regimen==='RMT'?'10% hasta 15 UIT, 29.5% excedente':'29.5% sobre utilidad neta'}.</p>
<h4>âš ï¸ Demo</h4>
<p>Conecta tu API Key de Claude para generar el informe completo con anÃ¡lisis detallado, base legal y recomendaciones personalizadas.</p>`;
    if (expBtn) expBtn.style.display = 'block';
    if (cpyBtn) cpyBtn.style.display = 'block';
    return;
  }

  try {
    const res = await callDeclaraFY({ model:'claude-sonnet-4-5', max_tokens:2000, system:'Eres un experto tributarista peruano. Redactas informes ejecutivos profesionales con base legal exacta del sistema tributario peruano.', messages:[{role:'user',content:prompt}] });
    const data = await res.json();
    const text = data.content?.[0]?.text || 'Error generando informe.';
    loading.style.display = 'none';
    preview.style.display = 'block';
    // Render markdown-like formatting
    preview.innerHTML = _escapeHtml(text)
      .replace(/^### (.*$)/gm,'<h4>$1</h4>')
      .replace(/^## (.*$)/gm,'<h3>$1</h3>')
      .replace(/^# (.*$)/gm,'<h3>$1</h3>')
      .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
      .replace(/\n\n/g,'</p><p>')
      .replace(/\n/g,'<br>');
    if (expBtn) expBtn.style.display = 'block';
    if (cpyBtn) cpyBtn.style.display = 'block';
    addNotif('ğŸ“‘','Informe generado',`Informe ejecutivo de "${empresa}" generado exitosamente.`);
  } catch(err) {
    loading.style.display = 'none';
    preview.style.display = 'block';
    preview.innerHTML = '<p style="color:var(--red)">Error: ' + _escapeHtml(err.message) + '</p>';
  }
}

function exportInforme() {
  const win = window.open('','_blank');
  const empresa = document.getElementById('infEmpresa')?.value || 'Empresa';
  const content = document.getElementById('informePreview')?.innerHTML || '';
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Informe Tributario â€” ${_escapeHtml(empresa)}</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#333;line-height:1.7}h1{color:#C9A84C;border-bottom:2px solid #C9A84C;padding-bottom:8px}h3,h4{color:#8B6914;margin:16px 0 6px}p{margin-bottom:10px;font-size:14px}strong{color:#555}@media print{body{margin:20px}}</style></head><body><h1>Informe Ejecutivo Tributario</h1><p style="font-size:14px;color:#888;margin-bottom:24px">Generado por DeclaraFY Â· ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</p>${content}<hr style="margin:24px 0"><p style="font-size:14px;color:#999;text-align:center">Declarafy.com â€” Documento orientativo. Consulta con un profesional para decisiones formales.</p></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function copyInforme() {
  const text = document.getElementById('informePreview')?.innerText || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('infCopyBtn');
    if (btn) { btn.textContent = 'âœ… Copiado!'; setTimeout(() => btn.textContent = 'ğŸ“‹ Copiar texto', 2000); }
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PATCH setPTab TO LOAD ALERTS & TOUR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _origSetPTabFinal = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabFinal(tab, btn);
  if (tab === 'alertas') initAlerts();
  if (tab === 'informe') {
    const expBtn = document.getElementById('infExportBtn');
    const cpyBtn = document.getElementById('infCopyBtn');
    if (expBtn) expBtn.style.display = 'none';
    if (cpyBtn) cpyBtn.style.display = 'none';
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TOUR â€” auto start for new users
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function maybeStartTour() {
  if (!curUser) return;
  if (!curUser.tourDone) {
    setTimeout(() => startTour('chat'), 900);
  }
}

function startPanelTour() {
  startTour('panel');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// OFFLINE MODE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const TP_OFFLINE_KEY = 'tp_offline_last';
const TP_OFFLINE_MAX = 5; // Ãºltimas 5 respuestas guardadas

function tpSaveOfflineResponse(question, answer) {
  try {
    const saved = JSON.parse(localStorage.getItem(TP_OFFLINE_KEY) || '[]');
    saved.unshift({ q: question, a: answer, ts: Date.now() });
    if (saved.length > TP_OFFLINE_MAX) saved.length = TP_OFFLINE_MAX;
    localStorage.setItem(TP_OFFLINE_KEY, JSON.stringify(saved));
  } catch(e) { console.warn('Offline save error:', e); }
}

function tpShowOfflineCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(TP_OFFLINE_KEY) || '[]');
    if (!saved.length) { tpToast('No hay consultas guardadas aÃºn', 'info'); return; }
    const msgs = document.getElementById('messages');
    if (!msgs) return;
    msgs.innerHTML = '';
    saved.forEach(item => {
      const d = new Date(item.ts).toLocaleString('es-PE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      addMsg('user', `ğŸ“¦ [Guardada el ${d}] ${item.q}`);
      addMsg('ai', item.a);
    });
    tpToast(`${saved.length} consulta(s) cargada(s) desde cachÃ©`, 'ok');
  } catch(e) { tpToast('Error al cargar cachÃ©', 'err'); }
}

function tpInitOfflineMonitor() {
  const banner = document.getElementById('tp-offline-banner');
  if (!banner) return;
  const update = () => {
    if (navigator.onLine) { banner.classList.remove('visible'); }
    else { banner.classList.add('visible'); }
  };
  update();
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
}

// Inicializar monitor al cargar
document.addEventListener('DOMContentLoaded', tpInitOfflineMonitor);


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PDT XML ANALYZER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let xmlContent = '';
let xmlFileName = '';

function handleXmlFile(input) {
  const file = input.files[0];
  if (!file) return;
  xmlFileName = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    xmlContent = e.target.result;
    analyzeXML(xmlContent, file.name);
  };
  reader.readAsText(file);
}

// Drag and drop
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('xmlDropZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) { xmlFileName = file.name; const r = new FileReader(); r.onload = ev => { xmlContent = ev.target.result; analyzeXML(xmlContent, file.name); }; r.readAsText(file); }
  });
});

function analyzeXML(content, filename) {
  const analysis = document.getElementById('xmlAnalysis');
  if (!analysis) return;
  analysis.style.display = 'block';
  // Parse key values from XML (simplified parser for SUNAT PDT format)
  const getVal = (tag) => { const m = content.match(new RegExp('<' + tag + '[^>]*>([^<]*)</' + tag + '>', 'i')); return m ? m[1].trim() : null; };
  const ventas = parseFloat(getVal('VENTAS_GRAVADAS') || getVal('TOTAL_VENTAS') || '0');
  const igvVentas = parseFloat(getVal('IGV_VENTAS') || getVal('DEBITO_FISCAL') || '0');
  const compras = parseFloat(getVal('COMPRAS_GRAVADAS') || getVal('TOTAL_COMPRAS') || '0');
  const igvCompras = parseFloat(getVal('IGV_COMPRAS') || getVal('CREDITO_FISCAL') || '0');
  const periodo = getVal('PERIODO') || getVal('PERIODO_TRIBUTARIO') || 'No especificado';
  const rucPDT = getVal('RUC') || getVal('NUM_RUC') || 'No especificado';
  const igvRate = ventas > 0 ? (igvVentas / ventas) * 100 : 0;
  // Summary cards
  document.getElementById('xmlSummary').innerHTML = `
    <div class="xml-stat"><div class="xml-stat-v">${filename.split('.').pop().toUpperCase()}</div><div class="xml-stat-l">Tipo de archivo</div></div>
    <div class="xml-stat"><div class="xml-stat-v">${periodo}</div><div class="xml-stat-l">PerÃ­odo</div></div>
    <div class="xml-stat"><div class="xml-stat-v">${rucPDT}</div><div class="xml-stat-l">RUC</div></div>
    <div class="xml-stat"><div class="xml-stat-v">${(content.length/1024).toFixed(1)}KB</div><div class="xml-stat-l">TamaÃ±o</div></div>`;
  // Findings
  const findings = [];
  // Check IGV rate
  if (ventas > 0 && igvVentas > 0) {
    if (Math.abs(igvRate - 18) < 0.5) findings.push({type:'ok', title:'Tasa IGV correcta', desc:`IGV aplicado: ${igvRate.toFixed(2)}% â€” Correcto (tasa vigente 18%)`});
    else findings.push({type:'error', title:'Tasa IGV incorrecta', desc:`IGV calculado: ${igvRate.toFixed(2)}% â€” Esperado: 18%. Revisar cÃ¡lculo del dÃ©bito fiscal.`});
  }
  // Credit fiscal vs debit
  if (igvCompras > igvVentas && igvVentas > 0) findings.push({type:'warn', title:'CrÃ©dito fiscal supera dÃ©bito fiscal', desc:`CrÃ©dito: S/${igvCompras.toLocaleString()} > DÃ©bito: S/${igvVentas.toLocaleString()}. GenerarÃ¡ saldo a favor. Verificar que sea correcto.`});
  // Check if XML has required nodes
  if (!content.includes('RUC') && !content.includes('ruc')) findings.push({type:'error', title:'RUC no encontrado en el XML', desc:'El archivo no contiene el nodo RUC. Verifica que sea un PDT exportado correctamente desde SUNAT.'});
  if (!content.includes('PERIODO') && !content.includes('periodo') && !content.includes('Periodo')) findings.push({type:'warn', title:'PerÃ­odo no identificado', desc:'No se encontrÃ³ el perÃ­odo tributario en el archivo. Verifica la estructura del XML.'});
  // Generic checks
  if (ventas === 0 && compras === 0) findings.push({type:'warn', title:'Sin datos de ventas/compras', desc:'No se detectaron montos de ventas ni compras. El archivo puede estar en un formato no reconocido o ser una declaraciÃ³n en cero.'});
  else findings.push({type:'ok', title:'Estructura XML vÃ¡lida', desc:`Archivo procesado correctamente. ${content.split('<').length - 1} nodos XML detectados.`});
  if (findings.length === 0) findings.push({type:'ok', title:'Sin observaciones detectadas', desc:'El anÃ¡lisis bÃ¡sico no encontrÃ³ problemas evidentes. Usa "Analizar con IA" para un anÃ¡lisis profundo.'});
  document.getElementById('xmlFindings').innerHTML = findings.map(f => `<div class="xml-finding ${f.type}"><div class="xml-finding-title">${f.type === 'error' ? 'ğŸ”´' : f.type === 'warn' ? 'ğŸŸ¡' : 'ğŸŸ¢'} ${f.title}</div><div class="xml-finding-desc">${f.desc}</div></div>`).join('');
}

async function askAIAboutXML() {
  if (!xmlContent) return;
  const prompt = `Analiza este archivo PDT de SUNAT en formato XML y proporciona:\n1. Resumen de los datos tributarios encontrados\n2. Errores o inconsistencias detectados\n3. ComparaciÃ³n con tasas y normas vigentes\n4. Oportunidades de optimizaciÃ³n tributaria\n5. Observaciones que SUNAT podrÃ­a hacer en una fiscalizaciÃ³n\n\nArchivo: ${xmlFileName}\nContenido (primeros 2000 chars): ${xmlContent.substring(0, 2000)}`;
  convHist = []; convId = null;
  goToChat();
  setTimeout(() => sendMsg(prompt), 300);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SUNAT API CONSULTOR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let sunatActiveTab = 'ruc';
function setSunatTab(tab, btn) {
  sunatActiveTab = tab;
  document.querySelectorAll('.sunat-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('sunatResult').style.display = 'none';
}

async function querySunat() {
  const ruc = document.getElementById('sunatRuc')?.value?.trim() || '';
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) { tpToast('Ingresa un RUC vÃ¡lido de 11 dÃ­gitos.', 'warn'); return; }
  const loading = document.getElementById('sunatLoading');
  const result = document.getElementById('sunatResult');
  loading.style.display = 'none';
  result.style.display = 'block';
  if (sunatActiveTab === 'ruc') {
    result.innerHTML = '<div class="sunat-api-result"><strong>Consulta pÃºblica oficial</strong><p style="margin-top:8px;color:var(--muted)">SUNAT puede solicitar una verificaciÃ³n antes de mostrar los datos.</p></div>';
    window.open(SUNAT_RUC_PUBLIC_URL, '_blank', 'noopener,noreferrer');
    return;
  }
  if (sunatActiveTab === 'deudas') {
    result.innerHTML = '<div class="sunat-api-result"><strong>InformaciÃ³n privada</strong><p style="margin-top:8px;color:var(--muted)">Las deudas requieren que el titular ingrese con su Clave SOL.</p></div>';
    window.open(SUNAT_SOL_URL, '_blank', 'noopener,noreferrer');
    return;
  }
  result.innerHTML = '<div class="sunat-api-result"><strong>ValidaciÃ³n individual disponible</strong><p style="margin-top:8px;color:var(--muted)">Usa â€œConsulta SUNATâ€ â†’ â€œValidar comprobanteâ€ e ingresa serie, nÃºmero, fecha y monto.</p></div>';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TIMELINE NORMATIVO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const TIMELINE_DATA = [
  {date:'Ene 2026', title:'UIT 2026 fijada en S/5,500', desc:'Mediante D.S. NÂ° 301-2025-EF se aprobÃ³ la UIT 2026 en S/5,500, incremento de S/150 respecto a 2025 (S/5,350).', tag:'sunat', important:true},
  {date:'Ene 2025', title:'UIT 2025 fijada en S/5,350', desc:'Mediante D.S. 008-2025-EF se aprobÃ³ la UIT 2025 en S/5,350, incremento de S/200 respecto a 2024 (S/5,150).', tag:'sunat', important:true},
  {date:'Oct 2024', title:'Prorroga del drawback al 3%', desc:'SUNAT extendiÃ³ la tasa de restituciÃ³n del drawback al 3% para exportadores no tradicionales por el aÃ±o fiscal 2025.', tag:'aduanas', important:false},
  {date:'Jul 2024', title:'Nuevo reglamento precios de transferencia', desc:'D.S. 008-2023-EF entrÃ³ en plena vigencia. Nuevas obligaciones de documentaciÃ³n: Local File, Master File y Country-by-Country Report.', tag:'ir', important:true},
  {date:'Ene 2024', title:'Tasa del IGV se mantiene en 18%', desc:'La tasa del IGV (16%) mÃ¡s el IPM (2%) continÃºa en 18%. No hubo modificaciones respecto al D.S. 055-99-EF.', tag:'igv', important:false},
  {date:'Ene 2024', title:'UIT 2024 fijada en S/5,150', desc:'D.S. 309-2023-EF estableciÃ³ la UIT 2024 en S/5,150, incremento de S/200 sobre la UIT 2023 (S/4,950).', tag:'sunat', important:true},
  {date:'Ago 2023', title:'Reforma del rÃ©gimen de fraccionamiento', desc:'Se modificaron las condiciones del fraccionamiento Art. 36 CT. Nuevas tasas de interÃ©s y plazos mÃ¡ximos de 72 cuotas.', tag:'ct', important:false},
  {date:'Jun 2023', title:'FacturaciÃ³n electrÃ³nica obligatoria NRUS', desc:'A partir de junio 2023, los contribuyentes del NRUS estÃ¡n obligados a emitir tickets electrÃ³nicos en reemplazo de boletas de venta manuales.', tag:'sunat', important:false},
  {date:'Ene 2023', title:'UIT 2023 en S/4,950', desc:'D.S. 314-2022-EF fijÃ³ la UIT 2023 en S/4,950, incremento de S/350 sobre la UIT 2022 (S/4,600).', tag:'sunat', important:false},
  {date:'Dic 2022', title:'Tasa IR no domiciliados: dividendos al 5%', desc:'Se confirmÃ³ la tasa de retenciÃ³n del 5% sobre dividendos para sujetos no domiciliados, segÃºn el Art. 54 de la LIR.', tag:'ir', important:false},
  {date:'Ene 2022', title:'SubcapitalizaciÃ³n: nuevo lÃ­mite deuda/patrimonio', desc:'Se redujo el lÃ­mite de endeudamiento con partes vinculadas de 3x a 3x el patrimonio neto (se mantiene ratio pero con nuevas reglas de cÃ³mputo).', tag:'ir', important:true},
  {date:'Sep 2021', title:'Norma XVI â€” ClÃ¡usula antielusiva reactivada', desc:'El TC ratificÃ³ la plena vigencia de la Norma XVI del CT (clÃ¡usula antielusiva general). SUNAT puede desconocer actos sin sustancia econÃ³mica.', tag:'ct', important:true},
  {date:'Ene 2020', title:'RÃ©gimen MYPE Tributario consolidado', desc:'El RMT del D.Leg. 1269 se consolida como el rÃ©gimen mÃ¡s adoptado por pymes peruanas. Tasa 10% hasta 15 UIT, 29.5% por el exceso.', tag:'ir', important:false},
  {date:'Jul 2018', title:'DeducciÃ³n adicional 7 UIT personas naturales', desc:'Personas naturales de 4ta y 5ta categorÃ­a pueden deducir hasta 7 UIT adicionales por gastos como arrendamientos, honorarios mÃ©dicos e intereses hipotecarios.', tag:'ir', important:false},
  {date:'Ene 2017', title:'ReducciÃ³n tasa IR general al 29.5%', desc:'D.Leg. 1261 redujo definitivamente la tasa del IR empresarial al 29.5%. Anteriormente la tasa era 28% en 2015-2016, con reducciÃ³n gradual desde 30%.', tag:'ir', important:true},
];

let tlFilter = 'todos';
function filterTlTag(tag, btn) {
  document.querySelectorAll('.tl-ftag').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  tlFilter = tag;
  renderTimeline('');
  const s = document.getElementById('tlSearch'); if (s) s.value = '';
}
function filterTimeline(q) { renderTimeline(q.toLowerCase().trim()); }
function renderTimeline(q) {
  const el = document.getElementById('timelineList'); if (!el) return;
  let items = tlFilter === 'todos' ? TIMELINE_DATA : TIMELINE_DATA.filter(t => t.tag === tlFilter);
  if (q) items = items.filter(t => t.title.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.date.toLowerCase().includes(q));
  if (!items.length) { el.innerHTML = '<div class="hempty">No se encontraron cambios normativos.</div>'; return; }
  el.innerHTML = items.map(t => `<div class="tl-item${t.important?' important':''}">
    <div class="tl-date">${t.date}</div>
    <div class="tl-title">${t.title}</div>
    <div class="tl-desc">${t.desc}</div>
    <span class="tl-tag ${t.tag}">${{igv:'IGV',ir:'Renta',ct:'CÃ³d. Tributario',sunat:'SUNAT',aduanas:'Aduanas'}[t.tag]}</span>
  </div>`).join('');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXCEL / SHEETS SIMULATOR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function runExcelSim() {
  const inp = document.getElementById('excelSimInput');
  const res = document.getElementById('excelSimResult');
  if (!inp || !res) return;
  let formula = inp.value.trim();
  // Extract query from formula
  const match = formula.match(/DECLARAFY\s*\(\s*["'](.+?)["']\s*\)/i);
  const query = match ? match[1] : formula.replace(/^=?DECLARAFY\s*\(/i,'').replace(/\)$/,'').replace(/['"]/g,'').trim();
  if (!query) { res.textContent = '// Error: Ingresa una consulta vÃ¡lida'; return; }
  res.textContent = '// Procesando...';
  if (!apiKey) {
    await new Promise(r => setTimeout(r, 800));
    const demos = {igv:'18% (16% IGV + 2% IPM) â€” TUO D.S.055-99-EF', uit:'S/5,500 para 2026 â€” D.S.301-2025-EF', rmt:'10% hasta 15 UIT, 29.5% excedente â€” D.Leg.1269'};
    const key = Object.keys(demos).find(k => query.toLowerCase().includes(k));
    res.textContent = key ? demos[key] : '// Conecta tu API Key para respuestas reales. Demo: La tasa del IGV es 18%.';
    return;
  }
  try {
    const r = await callDeclaraFY({ model:'claude-sonnet-4-5', max_tokens:150, system:'Asesor tributario peruano. Responde en mÃ¡ximo 2 lÃ­neas, directo y conciso.', messages:[{role:'user', content:query}] });
    const d = await r.json();
    res.textContent = d.content?.[0]?.text || '// Sin respuesta';
  } catch(e) { res.textContent = '// Error: ' + e.message; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BILLING TOGGLE (Plan Anual)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let billingMode = 'mensual';
function setBilling(mode, btn) {
  billingMode = mode;
  document.querySelectorAll('.billing-opt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderBillingCards();
}
function renderBillingCards() {
  const el = document.getElementById('billingCards'); if (!el) return;
  const plans = [
    { name:'Profesional', monthly:190, annual:1900, link_m:'https://express.culqi.com/pago/053F161D3A', link_a:'https://express.culqi.com/pago/6BD4230619', featured:true,
      features:['Consultas ilimitadas con IA','Excel, Word, PDF adjuntos','Todas las Ã¡reas tributarias','Historial de conversaciones','Calculadora y PDT 621','Biblioteca de normas'] },
    { name:'Empresa', monthly:750, annual:7500, link_m:'https://express.culqi.com/pago/593B4B3F8D', link_a:'https://express.culqi.com/pago/DA4029174B', featured:false,
      features:['Todo del plan Pro','Hasta 10 usuarios','Local File y Master File PT','Dashboard administraciÃ³n','Reportes exportables','API access'] },
  ];
  el.innerHTML = plans.map(p => {
    const price = billingMode === 'anual' ? p.annual : p.monthly;
    const period = billingMode === 'anual' ? '/aÃ±o' : '/mes';
    const savings = billingMode === 'anual' ? `<div style="font-size:14px;color:var(--green);margin-top:3px">2 meses gratis â€” ahorras S/${Math.round(p.monthly*2).toLocaleString()}</div>` : '';
    const link = billingMode === 'anual' ? p.link_a : p.link_m;
    return `<div style="background:var(--surface);border:1px solid ${p.featured?'var(--gold)':'var(--border)'};border-radius:13px;padding:20px;${p.featured?'background:rgba(201,168,76,.07)':''}">
      <div style="font-size:14px;letter-spacing:.1em;color:var(--muted);margin-bottom:4px;text-transform:uppercase">${p.name}</div>
      <div style="font-size:28px;font-weight:300;color:var(--gold)">S/${price.toLocaleString()}<span style="font-size:14px;color:var(--muted)">${period}</span></div>
      ${savings}
      <ul style="list-style:none;margin:12px 0 16px">
        ${p.features.map(f=>`<li style="font-size:14px;padding:3px 0;color:#CCC;display:flex;align-items:flex-start;gap:5px"><span style="color:var(--gold);flex-shrink:0">âœ“</span>${f}</li>`).join('')}
      </ul>
      <button onclick="window.open('${link}','_blank')" style="width:100%;padding:9px;border-radius:7px;background:var(--gold);border:none;color:var(--dark);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit">
        ${billingMode==='anual'?'Suscribirse anualmente':'Suscribirse mensual'}
      </button>
    </div>`;
  }).join('');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PATCH setPTab FOR NEW SECTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _origSetPTabV6 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV6(tab, btn);
  if (tab === 'timeline') renderTimeline('');
  if (tab === 'plan_anual') renderBillingCards();
  if (tab === 'sunat_api') {
    document.getElementById('sunatResult').style.display = 'none';
    const s = document.getElementById('sunatRuc');
    if (s && curUser?.ruc) s.value = curUser.ruc;
  }
  if (tab === 'pdt_xml') {
    document.getElementById('xmlAnalysis').style.display = 'none';
    document.getElementById('xmlDropZone')?.classList.remove('dragover');
  }
  if (tab === 'excel_int') {
    const s = document.getElementById('excelSimResult');
    if (s) s.textContent = '// El resultado aparecerÃ¡ aquÃ­...';
  }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INTERESES MORATORIOS TIM
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function calcTIM() {
  const deuda = parseFloat(document.getElementById('timDeuda')?.value) || 0;
  const venc = document.getElementById('timFechaVenc')?.value;
  const pago = document.getElementById('timFechaPago')?.value;
  const rebaja = parseFloat(document.getElementById('timRebaja')?.value) || 0;
  const tributo = document.getElementById('timTributo')?.value || 'Tributo';
  const res = document.getElementById('timResult');
  if (!deuda || !venc || !pago) { if(res) res.style.display='none'; return; }
  const dVenc = new Date(venc), dPago = new Date(pago);
  if (dPago <= dVenc) { if(res) res.style.display='none'; return; }
  const dias = Math.floor((dPago - dVenc) / (1000*60*60*24));
  const tasaDiaria = TAX_RULES.timDailyPercent / 100;
  const interes = deuda * tasaDiaria * dias;
  const total = (deuda + interes) * (1 - rebaja);
  const fmtS = n => 'S/ ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  res.style.display = 'block';
  document.getElementById('timTributoLbl').textContent = tributo + ' â€” ' + dias + ' dÃ­as de mora';
  document.getElementById('timTotal').textContent = fmtS(total);
  document.getElementById('timDeudaVal').textContent = fmtS(deuda);
  document.getElementById('timDias').textContent = dias + ' dÃ­as (' + Math.floor(dias/30) + ' meses ' + (dias%30) + ' dÃ­as)';
  document.getElementById('timIntereses').textContent = fmtS(interes) + (rebaja > 0 ? ' (con rebaja ' + (rebaja*100) + '%)' : '');
  document.getElementById('timTotalRow').innerHTML = '<strong>' + fmtS(total) + '</strong>';
  // Timeline by months
  const tl = document.getElementById('timTimeline');
  const meses = Math.min(Math.ceil(dias/30), 12);
  let tlHtml = '<div style="font-size:14px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.07em">EvoluciÃ³n mensual</div>';
  for (let m = 1; m <= meses; m++) {
    const dM = m * 30;
    const iM = deuda * tasaDiaria * dM;
    const pct = Math.min((iM/deuda)*100, 100);
    const color = pct < 5 ? 'var(--green)' : pct < 15 ? 'var(--gold)' : 'var(--red)';
    tlHtml += `<div class="tim-tl-item"><div class="tim-tl-dot" style="background:${color}"></div><span style="min-width:60px;color:var(--muted)">Mes ${m}</span><span style="flex:1">+${fmtS(iM)} intereses</span><span style="color:${color}">${pct.toFixed(1)}%</span></div>`;
  }
  tl.innerHTML = tlHtml;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DEPRECIACIONES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function calcDep() {
  const tipo = document.getElementById('depTipo');
  const tasaMax = parseFloat(tipo?.value) || 10;
  // Auto-fill tasa when tipo changes
  const tasaInp = document.getElementById('depTasa');
  if (tasaInp && document.activeElement !== tasaInp) tasaInp.value = tasaMax;
  const tasa = parseFloat(tasaInp?.value) || tasaMax;
  const costo = parseFloat(document.getElementById('depCosto')?.value) || 0;
  const anio = parseInt(document.getElementById('depAnio')?.value) || new Date().getFullYear();
  const res = document.getElementById('depResult');
  if (!costo || !res) return;
  if (tasa > tasaMax) { tasaInp.value = tasaMax; return; }
  const vidaUtil = Math.ceil(100 / tasa);
  const depAnual = costo * (tasa / 100);
  const fmtS = n => 'S/ ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let html = `<div class="sec-title" style="margin-bottom:12px">Tabla de depreciaciÃ³n â€” ${tipo?.options[tipo.selectedIndex]?.text || ''}</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
    <div style="background:var(--dark3);border-radius:8px;padding:10px;text-align:center"><div style="font-size:14px;color:var(--muted)">DepreciaciÃ³n anual</div><div style="font-size:16px;font-weight:300;color:var(--gold)">${fmtS(depAnual)}</div></div>
    <div style="background:var(--dark3);border-radius:8px;padding:10px;text-align:center"><div style="font-size:14px;color:var(--muted)">Vida Ãºtil estimada</div><div style="font-size:16px;font-weight:300;color:var(--gold)">${vidaUtil} aÃ±os</div></div>
    <div style="background:var(--dark3);border-radius:8px;padding:10px;text-align:center"><div style="font-size:14px;color:var(--muted)">Tasa aplicada</div><div style="font-size:16px;font-weight:300;color:var(--gold)">${tasa}% anual</div></div>
  </div>`;
  let acum = 0;
  for (let y = 1; y <= Math.min(vidaUtil, 10); y++) {
    const dep = y < vidaUtil ? depAnual : costo - acum;
    acum += dep;
    const pct = ((acum / costo) * 100);
    html += `<div class="dep-year-row">
      <span class="dep-year-lbl">${anio + y - 1}</span>
      <div style="flex:1"><div class="dep-bar-wrap"><div class="dep-bar" style="width:${pct}%"></div></div></div>
      <span class="dep-year-val">${fmtS(dep)}</span>
      <span style="font-size:14px;color:var(--muted);min-width:70px;text-align:right">Val. neto: ${fmtS(costo - acum)}</span>
    </div>`;
  }
  if (vidaUtil > 10) html += `<div style="font-size:14px;color:var(--muted);margin-top:6px">... y ${vidaUtil - 10} aÃ±os mÃ¡s hasta depreciar completamente.</div>`;
  res.style.display = 'block';
  res.innerHTML = html;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SIMULADOR MULTAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const MULTAS_CFG = {
  no_declarar: { titulo:'No presentar declaraciÃ³n jurada', art:'Art. 176 num.1 CT', base:'1_uit', baseLabel:'(Base: 1 UIT = S/5,500)', formula: (uit) => uit, desc:'Multa fija de 1 UIT por no presentar la declaraciÃ³n mensual o anual.' },
  declarar_incorrectamente: { titulo:'Declarar cifras o datos incorrectos', art:'Art. 178 num.1 CT', base:'tributo', baseLabel:'Tributo omitido S/', formula: (base) => base * 0.50, desc:'50% del tributo omitido. Aplica cuando se declara un monto menor al correcto.' },
  no_comprobante: { titulo:'No emitir comprobante de pago', art:'Art. 174 num.1 CT', base:'1_uit', baseLabel:'(Base: 1 UIT = S/5,500)', formula: (uit) => uit, desc:'Multa de 1 UIT. Primera infracciÃ³n: cierre del local (o multa en sustituciÃ³n).' },
  atraso_libros: { titulo:'Atraso en libros y registros contables', art:'Art. 175 num.5 CT', base:'ingresos', baseLabel:'Ingresos netos anuales S/', formula: (base) => base * 0.003, desc:'0.3% de los ingresos netos anuales. MÃ­nimo 10% de la UIT.' },
  no_detraccion: { titulo:'No depositar detracciÃ³n SPOT', art:'Art. 12 D.Leg. 940', base:'operacion', baseLabel:'Monto de la operaciÃ³n S/', formula: (base) => base * 0.50, desc:'50% del monto no depositado. Sin gradualidad en ciertos casos.' },
  no_ruc: { titulo:'No inscribirse en RUC', art:'Art. 173 num.1 CT', base:'1_uit', baseLabel:'(Base: 1 UIT = S/5,500)', formula: (uit) => uit, desc:'Multa de 1 UIT por no obtener RUC estando obligado.' },
};
const GRAD_RATES = {
  voluntaria_antes: 0.10, voluntaria_despues: 0.30, inducida_antes: 0.50, inducida_despues: 0.75, sin_subsanar: 1.0
};
const GRAD_LABELS = {
  voluntaria_antes:'Voluntaria antes de notificaciÃ³n (rebaja 90%)', voluntaria_despues:'Voluntaria despuÃ©s de notificaciÃ³n (rebaja 70%)',
  inducida_antes:'Inducida antes del cierre (rebaja 50%)', inducida_despues:'Inducida despuÃ©s del cierre (rebaja 25%)', sin_subsanar:'Sin subsanar (0% rebaja â€” multa completa)'
};
let selectedMulta = '';
function selectMulta(tipo, card) {
  selectedMulta = tipo;
  document.querySelectorAll('.multa-card').forEach(c => c.classList.remove('sel'));
  card.classList.add('sel');
  const cfg = MULTAS_CFG[tipo];
  const form = document.getElementById('multaForm'); form.style.display = 'block';
  const lbl = document.getElementById('multaBaseLbl');
  const field = document.getElementById('multaBaseField');
  if (cfg.base === '1_uit') {
    field.style.display = 'none';
  } else {
    field.style.display = 'block';
    lbl.textContent = cfg.baseLabel;
  }
  document.getElementById('multaBase').value = '';
  document.getElementById('multaResult').style.display = 'none';
}
function calcMulta() {
  if (!selectedMulta) return;
  const cfg = MULTAS_CFG[selectedMulta];
  const uit = 5500;
  const baseVal = cfg.base === '1_uit' ? uit : parseFloat(document.getElementById('multaBase')?.value) || 0;
  if (!baseVal && cfg.base !== '1_uit') return;
  const subsana = document.getElementById('multaSubsana')?.value || 'sin_subsanar';
  const multaBruta = cfg.formula(cfg.base === '1_uit' ? uit : baseVal);
  const multaMinima = uit * 0.05;
  const multaFinal = Math.max(multaBruta, multaMinima);
  const factor = GRAD_RATES[subsana];
  const multaConGrad = multaFinal * factor;
  const fmtS = n => 'S/ ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const res = document.getElementById('multaResult');
  res.style.display = 'block';
  res.innerHTML = `
    <div style="font-size:14px;font-weight:500;margin-bottom:4px">${cfg.titulo}</div>
    <div style="font-size:14px;color:var(--muted);margin-bottom:14px">${cfg.art} Â· ${cfg.desc}</div>
    <div class="tim-row"><span class="tim-row-lbl">Multa calculada (sin gradualidad)</span><span class="tim-row-val">${fmtS(multaFinal)}</span></div>
    <div class="tim-row"><span class="tim-row-lbl">RÃ©gimen de gradualidad aplicado</span><span class="tim-row-val">${GRAD_LABELS[subsana]}</span></div>
    <div class="tim-row" style="border-top:1px solid var(--gold);padding-top:8px"><span class="tim-row-lbl"><strong>Multa a pagar</strong></span><span class="tim-row-val gold" style="font-size:17px"><strong>${fmtS(multaConGrad)}</strong></span></div>
    <div class="grad-steps" style="margin-top:12px">
      ${Object.entries(GRAD_RATES).map(([k,v]) => {
        const amt = multaFinal * v;
        const isActive = k === subsana;
        return `<div class="grad-step ${isActive?'active':'inactive'}">
          <span class="grad-step-lbl">${GRAD_LABELS[k]}</span>
          <span class="grad-step-amt">${fmtS(amt)}</span>
        </div>`;
      }).join('')}
    </div>
    <p style="font-size:14px;color:var(--muted);margin-top:12px">Base legal: RÃ©gimen de Gradualidad R.S. 063-2007/SUNAT. UIT 2026: S/5,500.</p>`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONVERSOR MONEDA SBS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let fxRates = { USD_PEN_buy:null, USD_PEN_sell:null, EUR_PEN_buy:null, EUR_PEN_sell:null };
let fxDirection = 'USD_PEN';
async function refreshFX() {
  const fmt = n => Number.isFinite(n) ? n.toFixed(3) : 'â€”';
  const el = (id) => document.getElementById(id);
  if(el('fxFecha')) el('fxFecha').textContent = 'Consultando fuente oficial BCRPâ€¦';
  try {
    const payload = await declarafyApi('consultabcrtiposcambio', { method: 'GET' });
    const latest = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (!latest || (!Number.isFinite(Number(latest.compra)) && !Number.isFinite(Number(latest.venta)))) throw new Error('El BCRP no devolviÃ³ una cotizaciÃ³n vÃ¡lida.');
    fxRates.USD_PEN_buy = Number.isFinite(Number(latest.compra)) ? Number(latest.compra) : Number(latest.venta);
    fxRates.USD_PEN_sell = Number.isFinite(Number(latest.venta)) ? Number(latest.venta) : Number(latest.compra);
    fxRates.EUR_PEN_buy = null;
    fxRates.EUR_PEN_sell = null;
    if(el('fxUSDComp')) el('fxUSDComp').textContent = fmt(fxRates.USD_PEN_buy);
    if(el('fxUSDVenta')) el('fxUSDVenta').textContent = fmt(fxRates.USD_PEN_sell);
    if(el('fxEURVenta')) el('fxEURVenta').textContent = 'No disponible';
    if(el('fxFecha')) el('fxFecha').textContent = `BCRP Â· ${latest.fecha || new Date().toLocaleDateString('es-PE')}`;
    renderFXHistory();
    convertFX();
  } catch (error) {
    fxRates = { USD_PEN_buy:null, USD_PEN_sell:null, EUR_PEN_buy:null, EUR_PEN_sell:null };
    if(el('fxUSDComp')) el('fxUSDComp').textContent = 'â€”';
    if(el('fxUSDVenta')) el('fxUSDVenta').textContent = 'â€”';
    if(el('fxEURVenta')) el('fxEURVenta').textContent = 'No disponible';
    if(el('fxFecha')) el('fxFecha').textContent = 'No se pudo obtener el tipo de cambio oficial.';
    renderFXHistory();
    convertFX();
  }
}
function renderFXHistory() {
  const el = document.getElementById('fxHistory'); if(!el) return;
  const fmt = n => Number.isFinite(n) ? n.toFixed(3) : 'â€”';
  const pairs = [
    {pair:'USD/PEN Compra', rate:fxRates.USD_PEN_buy},
    {pair:'USD/PEN Venta', rate:fxRates.USD_PEN_sell},
  ];
  el.innerHTML = pairs.map(p => `<div class="fx-hist-item"><div class="fx-hist-pair">${p.pair}</div><div class="fx-hist-rate">${fmt(p.rate)}</div><div class="fx-hist-date">BCRP</div></div>`).join('');
}
function changeFXPair() {
  fxDirection = document.getElementById('fxPar')?.value || 'USD_PEN';
  const labels = {
    USD_PEN:['Monto en USD','Equivalente en PEN','DÃ³lares americanos (USD)','Soles peruanos (PEN)'],
    PEN_USD:['Monto en PEN','Equivalente en USD','Soles peruanos (PEN)','DÃ³lares americanos (USD)'],
    EUR_PEN:['Monto en EUR','Equivalente en PEN','Euros (EUR)','Soles peruanos (PEN)'],
    PEN_EUR:['Monto en PEN','Equivalente en EUR','Soles peruanos (PEN)','Euros (EUR)'],
    USD_EUR:['Monto en USD','Equivalente en EUR','DÃ³lares americanos (USD)','Euros (EUR)'],
    EUR_USD:['Monto en EUR','Equivalente en USD','Euros (EUR)','DÃ³lares americanos (USD)'],
  };
  const l = labels[fxDirection] || labels['USD_PEN'];
  ['fxFromLbl','fxToLbl','fxFromCurr','fxToCurr'].forEach((id,i) => { const el=document.getElementById(id); if(el) el.textContent=l[i]; });
  convertFX();
}
function convertFX() {
  const amt = parseFloat(document.getElementById('fxAmount')?.value) || 0;
  const rateMap = {
    USD_PEN: fxRates.USD_PEN_sell, PEN_USD: 1/fxRates.USD_PEN_sell,
    EUR_PEN: fxRates.EUR_PEN_sell, PEN_EUR: 1/fxRates.EUR_PEN_sell,
    USD_EUR: fxRates.USD_PEN_sell/fxRates.EUR_PEN_sell,
    EUR_USD: fxRates.EUR_PEN_sell/fxRates.USD_PEN_sell,
  };
  const rate = rateMap[fxDirection] || fxRates.USD_PEN_sell;
  const result = amt * rate;
  const el = document.getElementById('fxResult');
  if(el) el.textContent = amt > 0 && Number.isFinite(result) ? result.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',') : 'â€”';
}
function swapFX() {
  const pairs = {USD_PEN:'PEN_USD',PEN_USD:'USD_PEN',EUR_PEN:'PEN_EUR',PEN_EUR:'EUR_PEN',USD_EUR:'EUR_USD',EUR_USD:'USD_EUR'};
  const sel = document.getElementById('fxPar');
  if(sel) { sel.value = pairs[fxDirection]||'PEN_USD'; changeFXPair(); }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FACTURACIÃ“N Y PAGOS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function renderBillingPanel() {
  if (!curUser) return;
  const pn = {basico:'BÃ¡sico',pro:'Profesional',empresa:'Empresa'};
  const pp = {basico:'S/0',pro:'S/190',empresa:'S/750'};
  document.getElementById('facPlanName').textContent = isAdminUser() ? 'Superadministrador' : ('Plan ' + (pn[curUser.plan]||'BÃ¡sico'));
  document.getElementById('facPlanPrice').innerHTML = isAdminUser()
    ? 'Acceso total<span style="font-size:14px;color:var(--muted)"> Â· sin cuota comercial</span>'
    : (pp[curUser.plan]||'S/0') + '<span style="font-size:14px;color:var(--muted)">/mes</span>';
  const hist = document.getElementById('billingHist'); if(!hist) return;
  hist.innerHTML = '<div class="hempty">Cargando pagosâ€¦</div>';
  try {
    const data = await declarafyApi('payments_list', { method: 'GET' });
    const items = Array.isArray(data?.items) ? data.items : [];
    const subscription = data?.subscription;
    const paid = items.filter(item => item.status === 'paid');
    const total = paid.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0) / 100;
    document.getElementById('facTotal').textContent = 'S/' + total.toFixed(2);
    document.getElementById('facMeses').textContent = String(paid.length);
    document.getElementById('facNextBill').textContent = 'No configurado';
    const end = subscription?.current_period_end ? new Date(subscription.current_period_end.replace(' ', 'T')) : null;
    document.getElementById('facPlanRenew').textContent = subscription?.status === 'cancel_requested'
      ? `CancelaciÃ³n solicitada Â· acceso hasta ${end && !Number.isNaN(end.valueOf()) ? end.toLocaleDateString('es-PE') : 'fin del perÃ­odo'}`
      : subscription?.status === 'active' && end && !Number.isNaN(end.valueOf())
        ? 'Vigencia del plan hasta: ' + end.toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})
        : 'Sin renovaciÃ³n programada';
    if (!items.length) { hist.innerHTML = '<div class="hempty">Sin pagos registrados.</div>'; return; }
    hist.replaceChildren();
    items.forEach(item => {
      const amount = Number(item.amount_cents || 0) / 100;
      const date = new Date((item.paid_at || item.created_at || '').replace(' ', 'T'));
      const row = document.createElement('div');
      row.className = 'bill-item';
      row.innerHTML = `<div class="bill-icon">ğŸ§¾</div><div class="bill-info"><div class="bill-title">Plan ${_escapeHtml(pn[item.plan] || item.plan || '')}</div><div class="bill-sub">${_escapeHtml(Number.isNaN(date.valueOf()) ? 'Fecha no disponible' : date.toLocaleDateString('es-PE'))} Â· ${_escapeHtml(item.provider_charge_id || '')}</div><span class="bill-status ${item.status === 'paid' ? 'paid' : ''}">${_escapeHtml(item.status || '')}</span></div><div class="bill-amount">${_escapeHtml(item.currency || 'PEN')} ${amount.toFixed(2)}</div>`;
      hist.appendChild(row);
    });
  } catch (error) {
    hist.innerHTML = `<div class="hempty">No se pudo cargar la facturaciÃ³n: ${_escapeHtml(error.message)}</div>`;
  }
}
async function confirmCancel() {
  if (confirm('Â¿EstÃ¡s seguro de que deseas cancelar tu suscripciÃ³n? PerderÃ¡s acceso al plan al final del perÃ­odo pagado.')) {
    try {
      const data = await declarafyApi('subscription_cancel', { body: {} });
      if (!data?.requested) throw new Error('No existe una suscripciÃ³n activa para cancelar.');
      addNotif('âš ï¸','CancelaciÃ³n solicitada','Tu suscripciÃ³n serÃ¡ cancelada al vencer el perÃ­odo actual.');
      tpToast('CancelaciÃ³n registrada. Tu acceso se mantendrÃ¡ hasta el fin del perÃ­odo pagado.', 'warn');
      renderBillingPanel();
    } catch (error) {
      tpToast(error.message, 'err');
    }
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ANÃLISIS DE CONTRATOS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function analyzeContract() {
  const text = document.getElementById('contractText')?.value?.trim() || '';
  const tipo = document.getElementById('contractTipo')?.value || 'servicios';
  const partes = document.getElementById('contractPartes')?.value || 'nacionales';
  if (!text) { tpToast('Ingresa el texto del contrato a analizar.', 'warn'); return; }
  const loading = document.getElementById('contractLoading');
  const findings = document.getElementById('contractFindings');
  loading.style.display = 'block'; findings.innerHTML = '';
  // Quick static analysis while AI processes
  const quickFindings = [];
  if (text.toLowerCase().includes('usd') || text.toLowerCase().includes('dÃ³lar') || text.toLowerCase().includes('dolar'))
    quickFindings.push({risk:'medio', title:'OperaciÃ³n en moneda extranjera', desc:'El contrato menciona USD. Para efectos del IR, los importes deben convertirse al tipo de cambio SBS de la fecha de la operaciÃ³n (Art. 50 RLIR). Documentar el tipo de cambio utilizado.'});
  if (partes === 'no_domiciliado')
    quickFindings.push({risk:'alto', title:'Contraparte no domiciliada â€” RetenciÃ³n requerida', desc:'Las rentas pagadas a sujetos no domiciliados estÃ¡n sujetas a retenciÃ³n en la fuente. Tasa: 30% general, salvo CDI aplicable. Verificar si el paÃ­s del proveedor tiene CDI con PerÃº (Art. 76 LIR).'});
  if (partes === 'vinculadas')
    quickFindings.push({risk:'alto', title:'OperaciÃ³n entre partes vinculadas â€” Precios de Transferencia', desc:'Las operaciones entre partes vinculadas deben realizarse a valor de mercado (Art. 32-A LIR). Si supera 100 UIT, puede requerir documentaciÃ³n de PT. Asegurarse de que el precio sea consistente con el mercado.'});
  if (tipo === 'arrendamiento')
    quickFindings.push({risk:'medio', title:'Arrendamiento â€” Renta de 1ra categorÃ­a o 3ra categorÃ­a', desc:'Si el arrendador es persona natural: renta de 1ra categorÃ­a (tasa efectiva 5%). Si es empresa: 3ra categorÃ­a. El arrendatario debe exigir comprobante de pago para deducir el gasto (Art. 37 LIR).'});
  if (tipo === 'licencia')
    quickFindings.push({risk:'medio', title:'RegalÃ­as â€” Tratamiento tributario especial', desc:'Las regalÃ­as pagadas a domiciliados son renta de 2da categorÃ­a (tasa 5%). A no domiciliados: retenciÃ³n 30% salvo CDI. Las regalÃ­as pagadas son deducibles como gasto (Art. 37 h) LIR).'});
  if (text.toLowerCase().includes('penalidad') || text.toLowerCase().includes('clÃ¡usula penal'))
    quickFindings.push({risk:'bajo', title:'ClÃ¡usula de penalidad â€” Deducibilidad fiscal', desc:'Las penalidades recibidas son ingresos gravados. Las penalidades pagadas son deducibles como gasto (Art. 37 LIR) si son consecuencia de la actividad del negocio y estÃ¡n correctamente documentadas.'});
  if (!quickFindings.length)
    quickFindings.push({risk:'bajo', title:'AnÃ¡lisis bÃ¡sico completado', desc:'No se detectaron clÃ¡usulas de alto riesgo en el anÃ¡lisis automÃ¡tico. La IA realizarÃ¡ un anÃ¡lisis mÃ¡s profundo.'});
  if (!apiKey) {
    loading.style.display = 'none';
    findings.innerHTML = quickFindings.map(f => `<div class="contract-finding risk-${f.risk}"><div class="contract-finding-head"><span class="contract-finding-title">${f.risk==='alto'?'ğŸ”´':f.risk==='medio'?'ğŸŸ¡':'ğŸŸ¢'} ${f.title}</span><span class="contract-finding-badge">${f.risk.toUpperCase()}</span></div><div>${f.desc}</div></div>`).join('');
    findings.innerHTML += '<div style="margin-top:12px;font-size:14px;color:var(--muted);padding:12px;background:var(--dark3);border-radius:8px">ğŸ’¡ Conecta tu API Key para un anÃ¡lisis profundo personalizado de cada clÃ¡usula del contrato.</div>';
    addNotif('ğŸ“','Contrato analizado','Se encontraron ' + quickFindings.length + ' observaciones tributarias.');
    return;
  }
  const prompt = `Analiza las implicancias tributarias peruanas del siguiente contrato de tipo "${tipo}" entre partes "${partes}". Identifica: 1) ClÃ¡usulas con impacto tributario 2) Riesgos fiscales 3) Obligaciones de retenciÃ³n 4) Recomendaciones. Para cada hallazgo indica el nivel de riesgo (ALTO/MEDIO/BAJO) y la base legal peruana.\n\nContrato: ${text.substring(0,3000)}`;
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:1500,system:'Eres un abogado tributarista peruano experto. Analizas contratos e identificas implicancias tributarias segÃºn la legislaciÃ³n peruana vigente.',messages:[{role:'user',content:prompt}]});
    const data = await res.json(); const reply = data.content?.[0]?.text || '';
    loading.style.display = 'none';
    // Show static + AI findings
    findings.innerHTML = quickFindings.map(f=>`<div class="contract-finding risk-${f.risk}"><div class="contract-finding-head"><span class="contract-finding-title">${f.risk==='alto'?'ğŸ”´':f.risk==='medio'?'ğŸŸ¡':'ğŸŸ¢'} ${f.title}</span><span class="contract-finding-badge">${f.risk.toUpperCase()}</span></div><div>${f.desc}</div></div>`).join('');
    findings.innerHTML += `<div style="margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px"><div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">âœ¨ AnÃ¡lisis IA profundo</div><div style="font-size:14px;line-height:1.7;color:#C8C8DC">${_escapeHtml(reply).replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--gold)">$1</strong>')}</div></div>`;
    addNotif('ğŸ“','Contrato analizado con IA','AnÃ¡lisis profundo completado. Revisa los hallazgos.');
  } catch(e) { loading.style.display='none'; findings.innerHTML='<div class="contract-finding risk-alto"><div>Error: '+safeHTML(e.message)+'</div></div>'; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// WIDGET EMBEBIBLE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function genWidgetKey() {
  if (!curUser) return;
  const key = 'WK-' + btoa(curUser.email).substring(0,12).toUpperCase().replace(/[^A-Z0-9]/g,'X') + '-' + Math.random().toString(36).substring(2,7).toUpperCase();
  const code = document.getElementById('widgetCode');
  if (code) code.textContent = code.textContent.replace('TU_WIDGET_KEY', key);
  addNotif('ğŸ”‘','Widget Key generada','Tu Widget Key Ãºnica fue generada. GuÃ¡rdala en un lugar seguro.');
  tpToast('Widget Key generada: ' + key + '\n\nCÃ³piala y reemplaza TU_WIDGET_KEY en el cÃ³digo de instalaciÃ³n.', 'success');
}
function copyWidgetCode() {
  const code = document.getElementById('widgetCode')?.textContent || '';
  const btn = event.currentTarget;
  navigator.clipboard.writeText(code).then(() => {
    if(btn) { btn.textContent = 'âœ… Copiado!'; setTimeout(() => btn.textContent = 'ğŸ“‹ Copiar cÃ³digo', 2000); }
  });
}
const widgetResponses = [
  'La tasa del IGV en PerÃº es 18% (16% IGV + 2% IPM). Base legal: TUO D.S. 055-99-EF.',
  'La UIT 2026 es S/5,500 segÃºn D.S. 301-2025-EF.',
  'El plazo para presentar el PDT 621 depende de tu Ãºltimo dÃ­gito de RUC segÃºn el cronograma SUNAT.',
  'Para 4ta categorÃ­a, la retenciÃ³n es 8% sobre honorarios. La deducciÃ³n es 20% sobre ingresos brutos.',
  'El rÃ©gimen RMT aplica tasa de 10% sobre las primeras 15 UIT de renta neta, 29.5% sobre el exceso.',
];
let widgetSimCount = 0;
function sendWidgetSim() {
  const inp = document.getElementById('widgetSimInp');
  const msgs = document.getElementById('widgetSimMsgs');
  if (!inp || !msgs || !inp.value.trim()) return;
  const userMsg = document.createElement('div');
  userMsg.className = 'widget-sim-msg user';
  userMsg.textContent = inp.value.trim();
  msgs.appendChild(userMsg);
  inp.value = '';
  setTimeout(() => {
    const aiMsg = document.createElement('div');
    aiMsg.className = 'widget-sim-msg ai';
    aiMsg.textContent = widgetResponses[widgetSimCount % widgetResponses.length];
    widgetSimCount++;
    msgs.appendChild(aiMsg);
    msgs.scrollTop = msgs.scrollHeight;
  }, 700);
  msgs.scrollTop = msgs.scrollHeight;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PATCH setPTab FOR NEW TABS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _origSetPTabV7 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV7(tab, btn);
  if (tab === 'tim') { const hoy = new Date().toISOString().split('T')[0]; const inp=document.getElementById('timFechaPago'); if(inp&&!inp.value) inp.value=hoy; }
  if (tab === 'moneda') { refreshFX(); }
  if (tab === 'facturacion') { renderBillingPanel(); }
  if (tab === 'multas') { document.getElementById('multaResult').style.display='none'; document.getElementById('multaForm').style.display='none'; }
  if (tab === 'contratos') { document.getElementById('contractFindings').innerHTML=''; document.getElementById('contractLoading').style.display='none'; }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SBS â€” DATA
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const SBS_DATA = {
  normas: [
    {id:'sbs1', cat:'leyes', titulo:'Ley General del Sistema Financiero â€” Ley 26702', tipo:'Ley', fecha:'Dic 1996', badge:'blue', desc:'Marco regulatorio principal del sistema bancario, financiero y de seguros del PerÃº. Establece los requisitos de capital, gestiÃ³n de riesgos, supervisiÃ³n y sanciones.',
     detalle:`<h4>Aspectos clave â€” Ley 26702</h4>
<div class="reg-detail-art">Art. 16: Capital mÃ­nimo para bancos â€” S/454.8 millones (actualizable por SBS).</div>
<div class="reg-detail-art">Art. 18: RazÃ³n de apalancamiento â€” El patrimonio efectivo debe cubrir al menos 10% de activos ponderados por riesgo.</div>
<div class="reg-detail-art">Art. 65: LÃ­mite individual de crÃ©dito â€” MÃ¡ximo 10% del patrimonio efectivo a un solo deudor o grupo econÃ³mico.</div>
<div class="reg-detail-art">Art. 95: Reserva de encaje â€” Las empresas deben mantener encaje mÃ­nimo legal del 6% sobre obligaciones sujetas a encaje.</div>
<div class="reg-detail-art">Art. 132: Secreto bancario â€” La informaciÃ³n de operaciones pasivas es confidencial, salvo orden judicial o requerimiento SBS/SUNAT por materia tributaria.</div>
<strong>Implicancia tributaria:</strong> El secreto bancario (Art. 132) puede ser levantado por SUNAT para investigaciones tributarias mediante solicitud judicial (Art. 62 CT).`},
    {id:'sbs2', cat:'ley_itf', titulo:'Ley del ITF â€” Ley 28194', tipo:'Ley', fecha:'Mar 2004', badge:'gold', desc:'Establece el Impuesto a las Transacciones Financieras. Tasa 0.005% sobre dÃ©bitos y crÃ©ditos en cuentas. Obliga a bancarizar pagos superiores a S/2,000 o USD 500.',
     detalle:`<h4>Ley 28194 â€” Impuesto a las Transacciones Financieras</h4>
<div class="reg-detail-art">Art. 9: Tasa del ITF â€” 0.005% sobre el monto de cada operaciÃ³n afecta.</div>
<div class="reg-detail-art">Art. 3: Operaciones gravadas â€” DÃ©bitos y crÃ©ditos en cuentas del sistema financiero nacional.</div>
<div class="reg-detail-art">Art. 8: Medios de pago obligatorios â€” Pagos â‰¥ S/2,000 o USD 500 deben realizarse por el sistema financiero para ser deducibles tributariamente.</div>
<div class="reg-detail-art">Art. 8: Consecuencia del incumplimiento â€” Gastos pagados en efectivo por montos â‰¥ S/2,000 NO son deducibles como gasto ni costo para el IR (Art. 44 inc. i) LIR).</div>
<strong>CasuÃ­stica frecuente:</strong> Proveedores que exigen efectivo â†’ el comprador pierde la deducciÃ³n del gasto. SUNAT repara el gasto en fiscalizaciÃ³n.`},
    {id:'sbs3', cat:'afp', titulo:'Sistema Privado de Pensiones â€” D.Leg. 25897', tipo:'D.Legislativo', fecha:'Nov 1992', badge:'blue', desc:'Crea el Sistema Privado de AdministraciÃ³n de Fondos de Pensiones (AFP). Regula las aportaciones, prestaciones y administraciÃ³n de fondos previsionales.',
     detalle:`<h4>D.Leg. 25897 â€” SPP y AFPs</h4>
<div class="reg-detail-art">Art. 30: Aporte obligatorio â€” 10% de la remuneraciÃ³n del trabajador + comisiÃ³n AFP (1.6%-1.9%) + seguro de invalidez y sobrevivencia (~1.4%).</div>
<div class="reg-detail-art">Art. 32: Tipos de fondo â€” Fondo 0 (capital protegido), Fondo 1 (preservaciÃ³n capital), Fondo 2 (mixto), Fondo 3 (crecimiento).</div>
<strong>Tratamiento tributario:</strong><br>
â€¢ Los aportes AFP son deducibles de la renta de 5ta categorÃ­a (descuento en planilla, no declaraciÃ³n separada).<br>
â€¢ Las pensiones recibidas son renta de 4ta categorÃ­a (salvo exoneraciÃ³n de 7 UIT).<br>
â€¢ El retiro de fondos AFP (Ley 31017) tributÃ³ con tasas escalonadas segÃºn monto retirado (caso especial 2020-2021).`},
    {id:'sbs4', cat:'seguros', titulo:'Reglamento de Empresas de Seguros â€” Res. SBS 3198-2013', tipo:'ResoluciÃ³n', fecha:'May 2013', badge:'gray', desc:'Regula los requisitos de organizaciÃ³n, funcionamiento, solvencia y operaciones de las empresas de seguros y reaseguros en el PerÃº.',
     detalle:`<h4>Res. SBS 3198-2013 â€” Seguros</h4>
<div class="reg-detail-art">Capital mÃ­nimo seguros de vida: S/8.7 millones. Seguros generales: S/6.1 millones.</div>
<div class="reg-detail-art">Margen de solvencia: Las aseguradoras deben mantener patrimonio efectivo â‰¥ al requerimiento patrimonial por riesgos.</div>
<strong>TributaciÃ³n de seguros:</strong><br>
â€¢ Primas de seguro pagadas son deducibles como gasto si estÃ¡n vinculadas a la actividad empresarial (Art. 37 LIR).<br>
â€¢ Indemnizaciones por seguros de daÃ±os: no gravadas si no superan el valor del bien siniestrado.<br>
â€¢ Seguros de vida del trabajador: deducible hasta el lÃ­mite del Art. 37 inc. c) LIR.<br>
â€¢ IGV: Los servicios de seguros estÃ¡n exonerados del IGV (ApÃ©ndice II Ley del IGV).`},
    {id:'sbs5', cat:'reglamentos', titulo:'Reglamento de GestiÃ³n de Riesgos â€” Res. SBS 272-2017', tipo:'ResoluciÃ³n', fecha:'Ene 2017', badge:'blue', desc:'Establece los lineamientos para la gestiÃ³n integral de riesgos en empresas supervisadas por la SBS: riesgo crediticio, liquidez, mercado, operacional y otros.',
     detalle:`<h4>Res. SBS 272-2017 â€” GestiÃ³n de Riesgos</h4>
<div class="reg-detail-art">Riesgo crediticio: Provisiones genÃ©ricas (0.7%-2%) y especÃ­ficas segÃºn categorÃ­a del deudor (Normal, CPP, Deficiente, Dudoso, PÃ©rdida).</div>
<div class="reg-detail-art">Riesgo de liquidez: Ratio de cobertura de liquidez (LCR) â‰¥ 100% segÃºn Basilea III.</div>
<strong>Implicancia tributaria de las provisiones:</strong><br>
â€¢ Provisiones bancarias son deducibles para IR solo si cumplen requisitos del Art. 37 inc. h) LIR.<br>
â€¢ Las provisiones genÃ©ricas NO son deducibles para IR. Solo las especÃ­ficas de deudas incobrables.<br>
â€¢ Las recuperaciones de provisiones deducidas son ingreso gravado en el perÃ­odo de recuperaciÃ³n.`},
    {id:'sbs6', cat:'reglamentos', titulo:'PrevenciÃ³n de Lavado de Activos â€” Ley 27693 / Res. SBS 2660-2015', tipo:'Ley + Reglamento', fecha:'Abr 2002', badge:'red', desc:'Sistema Anti Lavado de Activos y Financiamiento del Terrorismo (LAFT). Obligaciones de debida diligencia, reporte de operaciones sospechosas (ROS) y perfil del cliente.',
     detalle:`<h4>LAFT â€” Sistema Anti Lavado</h4>
<div class="reg-detail-art">Art. 9 Ley 27693: Empresas obligadas a reportar operaciones sospechosas (ROS) a la UIF-PerÃº.</div>
<div class="reg-detail-art">Umbral de reporte automÃ¡tico: Operaciones en efectivo â‰¥ USD 10,000 o equivalente.</div>
<div class="reg-detail-art">KYC (Know Your Customer): Las entidades financieras deben identificar al beneficiario final de personas jurÃ­dicas.</div>
<strong>VÃ­nculo tributario:</strong><br>
â€¢ Los bienes provenientes de delitos tributarios (defraudaciÃ³n fiscal) son activos de origen ilÃ­cito bajo la Ley de Lavado.<br>
â€¢ Las facturas falsas que generan crÃ©dito fiscal indebido pueden configurar lavado de activos (D.Leg. 1106).<br>
â€¢ SUNAT coordina con la UIF en casos de defraudaciÃ³n tributaria vinculada a lavado.`},
  ],
  casuistica: [
    {num:'SBS-CASO-001', titulo:'Levantamiento de secreto bancario por SUNAT', desc:'Empresa comercial con inconsistencias entre ingresos declarados y movimientos bancarios detectados en fiscalizaciÃ³n.', resultado:`<div class="caso-resolucion">ResoluciÃ³n: El Juzgado Civil autorizÃ³ a SUNAT el levantamiento del secreto bancario conforme al Art. 62 num. 8 del CT y Art. 143 de la Ley 26702. Se determinÃ³ que los depÃ³sitos bancarios no declarados constituyeron ingresos omitidos gravados con IGV e IR. Deuda determinada: S/285,000 + intereses TIM + multas.</div><strong>LecciÃ³n:</strong> Los movimientos bancarios son un indicador clave en fiscalizaciones. SUNAT puede solicitar judicialmente el levantamiento del secreto bancario cuando existan presunciones fundadas de evasiÃ³n.`, area:'Secreto bancario / SUNAT'},
    {num:'SBS-CASO-002', titulo:'BancarizaciÃ³n â€” Gasto no deducible por pago en efectivo', desc:'Empresa constructora pagÃ³ honorarios de S/45,000 en efectivo al arquitecto. SUNAT reparÃ³ el gasto en fiscalizaciÃ³n.', resultado:`<div class="caso-resolucion">ResoluciÃ³n: RTF 8534-3-2019 â€” El Tribunal Fiscal confirmÃ³ el reparo. El Art. 8 de la Ley 28194 exige que pagos â‰¥ S/2,000 se realicen por medios de pago del sistema financiero. Al hacerse en efectivo, el gasto pierde su deducibilidad tributaria (Art. 44 inc. i) LIR) aunque el servicio haya sido real.</div><strong>LecciÃ³n:</strong> La bancarizaciÃ³n no es solo formalismo; su incumplimiento tiene impacto directo en el IR. Documentar siempre el medio de pago.`, area:'ITF / BancarizaciÃ³n'},
    {num:'SBS-CASO-003', titulo:'AFP â€” Retiro de fondos y tributaciÃ³n (Ley 31017)', desc:'Trabajador retirÃ³ S/250,000 de su AFP durante la pandemia 2020. SUNAT notificÃ³ por diferencia en declaraciÃ³n anual.', resultado:`<div class="caso-resolucion">ResoluciÃ³n: El retiro de fondos AFP bajo Ley 31017 tuvo tasas diferenciadas: hasta 4 UIT exonerado, entre 4-12 UIT: 5%, entre 12-24 UIT: 17.5%, mÃ¡s de 24 UIT: 30%. La AFP debÃ­a retener y el trabajador debÃ­a declarar en el DDJJ anual. Muchos contribuyentes omitieron la declaraciÃ³n generando deuda.</div><strong>LecciÃ³n:</strong> Los retiros extraordinarios de AFP son renta de 4ta categorÃ­a. La AFP retiene, pero el contribuyente debe verificar si debe presentar declaraciÃ³n anual por el total de sus ingresos.`, area:'AFP / IR 4ta categorÃ­a'},
    {num:'SBS-CASO-004', titulo:'ProvisiÃ³n bancaria y deducibilidad IR', desc:'Banco solicitÃ³ deducir provisiones genÃ©ricas por S/12M en la DJ Anual. SUNAT observÃ³ el 100% del importe.', resultado:`<div class="caso-resolucion">ResoluciÃ³n: RTF 1317-1-2020 â€” Tribunal Fiscal confirmÃ³ que las provisiones genÃ©ricas (constituidas preventivamente por la banca) NO son deducibles para efectos del IR. Solo son deducibles las provisiones especÃ­ficas por deudas de recuperaciÃ³n difÃ­cil, cumpliendo los requisitos del Art. 37 inc. h) LIR y del Reglamento.</div><strong>LecciÃ³n:</strong> Las provisiones bancarias SBS-requeridas no equivalen automÃ¡ticamente a gastos tributariamente deducibles. Requieren sustento individual por deuda incobrable.`, area:'Provisiones / IR bancario'},
  ]
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SMV â€” DATA
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const SMV_DATA = {
  normas: [
    {id:'smv1', cat:'lmv', titulo:'Ley del Mercado de Valores â€” D.Leg. 861', tipo:'D.Legislativo', fecha:'Oct 1996', badge:'green', desc:'Marco legal del mercado de valores peruano. Regula la oferta pÃºblica de valores, intermediarios, bolsas de valores, fondos de inversiÃ³n y el papel de la SMV.',
     detalle:`<h4>D.Leg. 861 â€” Ley del Mercado de Valores</h4>
<div class="reg-detail-art smv-art">Art. 4: Oferta pÃºblica de valores â€” Toda invitaciÃ³n a mÃ¡s de 100 personas o por montos > S/1M requiere inscripciÃ³n en el Registro PÃºblico del Mercado de Valores (RPMV).</div>
<div class="reg-detail-art smv-art">Art. 12: Hechos de importancia â€” Los emisores inscritos deben reportar hechos relevantes a la SMV en 1 dÃ­a hÃ¡bil de ocurridos.</div>
<div class="reg-detail-art smv-art">Art. 40: Insider trading â€” ProhibiciÃ³n de operar con informaciÃ³n privilegiada. SanciÃ³n: multa hasta 700 UIT + inhabilitaciÃ³n.</div>
<strong>TributaciÃ³n en el mercado de valores:</strong><br>
â€¢ Ganancias de capital en BVL: 6.25% sobre la ganancia neta (2da categorÃ­a, Art. 54 LIR).<br>
â€¢ Dividendos de acciones listadas: 5% de retenciÃ³n (Art. 24-A LIR).<br>
â€¢ PÃ©rdidas en BVL: Compensables con ganancias de la misma fuente en el mismo ejercicio.`},
    {id:'smv2', cat:'emisores', titulo:'Reglamento de Hechos de Importancia â€” Res. SMV 005-2014', tipo:'ResoluciÃ³n', fecha:'2014', badge:'green', desc:'Define quÃ© informaciÃ³n constituye hecho de importancia y los plazos para su divulgaciÃ³n. Aplica a empresas con valores inscritos en la BVL.',
     detalle:`<h4>Res. SMV 005-2014 â€” Hechos de Importancia</h4>
<div class="reg-detail-art smv-art">Plazo de reporte: 1 dÃ­a hÃ¡bil desde que el emisor toma conocimiento del hecho.</div>
<div class="reg-detail-art smv-art">Hechos tÃ­picos: Cambio de accionistas mayoritarios, fusiones, adquisiciones, resultados financieros relevantes, cambios en directorio, litigios significativos, cambios contables.</div>
<strong>Implicancia tributaria:</strong> Los hechos de importancia que involucran reorganizaciones societarias (fusiones, escisiones) deben cumplir requisitos tanto de la LMV como de la LIR (Arts. 68-69 LIR) para mantener la neutralidad tributaria.`},
    {id:'smv3', cat:'fondos', titulo:'Reglamento de Fondos de InversiÃ³n â€” Res. SMV 029-2014', tipo:'ResoluciÃ³n', fecha:'2014', badge:'green', desc:'Regula la constituciÃ³n, operaciÃ³n y liquidaciÃ³n de fondos de inversiÃ³n en el PerÃº. Incluye fondos abiertos, cerrados y de inversiÃ³n en bienes raÃ­ces (FIBRAs).',
     detalle:`<h4>Fondos de InversiÃ³n â€” TributaciÃ³n</h4>
<div class="reg-detail-art smv-art">Rendimientos de fondos: Califican como renta de 2da categorÃ­a para personas naturales (5% si son dividendos, 6.25% si son ganancias de capital).</div>
<div class="reg-detail-art smv-art">Fondos para personas jurÃ­dicas: Los rendimientos se integran a la base imponible del IR (29.5% RG).</div>
<div class="reg-detail-art smv-art">FIBRAs (Real Estate Investment Trusts): RÃ©gimen especial con distribuciÃ³n mÃ­nima del 95% de utilidades. TributaciÃ³n a nivel del inversionista.</div>
<strong>Ventajas tributarias de fondos:</strong> Los fondos de inversiÃ³n no pagan IR a nivel del vehÃ­culo (son transparentes). El impuesto se aplica cuando el partÃ­cipe recibe la distribuciÃ³n.`},
    {id:'smv4', cat:'sanciones', titulo:'Reglamento de Sanciones SMV â€” Res. SMV 033-2015', tipo:'ResoluciÃ³n', fecha:'2015', badge:'red', desc:'Establece el rÃ©gimen sancionador de la SMV: tipos de infracciones, escala de multas y procedimientos para emisores, intermediarios e inversionistas.',
     detalle:`<h4>Sanciones SMV</h4>
<div class="reg-detail-art smv-art">Infracciones muy graves: Hasta 700 UIT de multa + inhabilitaciÃ³n temporal o permanente.</div>
<div class="reg-detail-art smv-art">Insider trading (Art. 40 LMV): Hasta 700 UIT + inhabilitaciÃ³n + responsabilidad penal (Ley 30424).</div>
<div class="reg-detail-art smv-art">No reportar hechos de importancia: Hasta 25 UIT por cada incumplimiento.</div>
<strong>VinculaciÃ³n penal-tributaria:</strong> La manipulaciÃ³n de estados financieros para inflar precio de acciones puede configurar estafa (CP), defraudaciÃ³n tributaria (D.Leg. 813) y fraude en el mercado de valores simultÃ¡neamente.`},
    {id:'smv5', cat:'lmv', titulo:'TributaciÃ³n de valores mobiliarios â€” Art. 54 y 57 LIR', tipo:'Norma tributaria', fecha:'Permanente', badge:'gold', desc:'Tratamiento tributario especÃ­fico de rentas de 2da categorÃ­a provenientes de valores: dividendos, intereses de bonos, ganancias de capital en BVL y regalÃ­as.',
     detalle:`<h4>TributaciÃ³n de valores â€” Art. 54 LIR</h4>
<div class="reg-detail-art smv-art">Dividendos personas naturales domiciliadas: 5% de retenciÃ³n definitiva (Art. 24-A LIR).</div>
<div class="reg-detail-art smv-art">Dividendos no domiciliados: 5% de retenciÃ³n en fuente (Art. 54 LIR).</div>
<div class="reg-detail-art smv-art">Ganancias de capital BVL (PN domiciliada): 6.25% sobre ganancia neta, con deducciÃ³n del 20%.</div>
<div class="reg-detail-art smv-art">Intereses de bonos corporativos: 5% si son personas naturales; se integran al IR si son personas jurÃ­dicas.</div>
<div class="reg-detail-art smv-art">Intereses pagados a no domiciliados: 4.99% si cumplen condiciones del Art. 56 LIR; 30% en caso contrario.</div>`},
  ],
  casuistica: [
    {num:'SMV-CASO-001', titulo:'Ganancias de capital BVL â€” DeclaraciÃ³n y pago IR 2da categorÃ­a', desc:'Persona natural vendiÃ³ acciones de minera en la BVL obteniendo ganancia neta de S/380,000. No presentÃ³ declaraciÃ³n anual.', resultado:`<div class="caso-resolucion">ResoluciÃ³n: SUNAT detectÃ³ la ganancia mediante informaciÃ³n cruzada con la CAVALI. La ganancia de capital tributa con tasa efectiva del 5% (6.25% sobre el 80% de la ganancia neta). Impuesto omitido: S/19,000 + TIM + multa por no declarar (1 UIT). El contribuyente debÃ­a presentar DJ anual de 2da categorÃ­a.</div><strong>LecciÃ³n:</strong> Las ganancias en BVL son declarables aunque CAVALI retenga. Si hay pÃ©rdidas compensables del mismo aÃ±o, deben incluirse en la DJ. La SUNAT cruza informaciÃ³n con la BVL y CAVALI.`, area:'Ganancias capital / BVL'},
    {num:'SMV-CASO-002', titulo:'Insider trading y responsabilidad tributaria', desc:'Directivo de empresa listada comprÃ³ acciones 3 dÃ­as antes del anuncio de adquisiciÃ³n. Obtuvo ganancia de S/2.1M.', resultado:`<div class="caso-resolucion">ResoluciÃ³n SMV 184-2021: Multa de 350 UIT + inhabilitaciÃ³n 2 aÃ±os por insider trading (Art. 40 D.Leg.861). Adicionalmente, SUNAT iniciÃ³ procedimiento: la ganancia de S/2.1M tributÃ³ como renta de 2da categorÃ­a (tasa efectiva 5%). El impuesto sobre ganancia ilÃ­cita es igualmente exigible (Art. 1 CT: hecho imponible puede ser ilÃ­cito).</div><strong>LecciÃ³n:</strong> Los ingresos de actividades ilÃ­citas tambiÃ©n son gravados con IR en PerÃº (principio de capacidad contributiva). La ilicitud de la ganancia no la exime del tributo.`, area:'Insider trading / IR 2da'},
    {num:'SMV-CASO-003', titulo:'ReorganizaciÃ³n societaria listada â€” FusiÃ³n con impacto bursÃ¡til', desc:'Empresa listada en BVL se fusionÃ³ con empresa no listada. Accionistas minoristas preguntaron si el canje de acciones genera IR.', resultado:`<div class="caso-resolucion">Consulta SMV / SUNAT: En fusiones con neutralidad tributaria (Art. 68 LIR), el canje de acciones NO genera ganancia de capital en el momento del canje. El costo computable de las nuevas acciones es el de las antiguas. El IR se difiere hasta la venta posterior de las nuevas acciones. La operaciÃ³n debe reportarse a SMV como hecho de importancia y cumplir plazos del D.Leg. 861.</div><strong>LecciÃ³n:</strong> Las reorganizaciones societarias pueden hacerse tributariamente neutras si cumplen los Arts. 68-69 LIR. Pero deben comunicarse a la SMV oportunamente.`, area:'ReorganizaciÃ³n / BVL'},
    {num:'SMV-CASO-004', titulo:'FIBRAs â€” TributaciÃ³n del fondo inmobiliario', desc:'Inversionista persona natural recibiÃ³ distribuciÃ³n de S/85,000 de un FIBRA listado en la BVL. ConsultÃ³ cÃ³mo declararlo.', resultado:`<div class="caso-resolucion">Criterio SMV/SUNAT: Las distribuciones de FIBRAs califican como dividendos para personas naturales, sujetos a retenciÃ³n del 5% definitiva. Si el FIBRA distribuye rentas provenientes de alquileres (1ra categorÃ­a), podrÃ­an calificar distinto segÃºn la estructura. La retenciÃ³n la hace el fideicomiso. El inversionista no declara separadamente si la retenciÃ³n fue definitiva.</div><strong>LecciÃ³n:</strong> Los FIBRAs son vehÃ­culos eficientes tributariamente: el impuesto se paga solo cuando se distribuye (transparencia fiscal). La retenciÃ³n del 5% en fuente es definitiva para PN domiciliadas.`, area:'FIBRAs / IR 2da'},
  ]
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SBS â€” FUNCTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let sbsFilterCat = 'todos', sbsTab = 'normas';

function setSBSTab(tab, btn) {
  sbsTab = tab;
  document.querySelectorAll('#ptSbs .reg-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['sbsNormas','sbsCasuistica','sbsConsultor','sbsTasas'].forEach(id => {
    const el = document.getElementById(id); if(el) el.style.display = 'none';
  });
  const showId = { normas:'sbsNormas', casuistica:'sbsCasuistica', consultor:'sbsConsultor', tasas:'sbsTasas' }[tab];
  const showEl = document.getElementById(showId);
  if (showEl) showEl.style.display = 'block';
  if (tab === 'normas') renderSBSNormas('');
  if (tab === 'casuistica') renderSBSCasuistica();
  if (tab === 'consultor') renderSBSQuickQ();
}

function filterSBS(cat, btn) {
  sbsFilterCat = cat;
  document.querySelectorAll('#ptSbs .reg-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSBSNormas('');
  const s = document.getElementById('sbsSearch'); if(s) s.value = '';
}

function searchSBS(q) { renderSBSNormas(q.toLowerCase().trim()); }

function renderSBSNormas(q) {
  const el = document.getElementById('sbsNormas'); if (!el) return;
  let items = sbsFilterCat === 'todos' ? SBS_DATA.normas : SBS_DATA.normas.filter(n => n.cat === sbsFilterCat);
  if (q) items = items.filter(n => n.titulo.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q));
  if (!items.length) { el.innerHTML = '<div class="hempty">No se encontraron normas.</div>'; return; }
  el.innerHTML = items.map(n => `<div class="reg-card" onclick="toggleRegDetail('${n.id}')">
    <div class="reg-card-top">
      <div class="reg-card-title">${n.titulo}</div>
      <div class="reg-card-badges"><span class="reg-badge ${n.badge}">${n.tipo}</span></div>
    </div>
    <div class="reg-card-desc">${n.desc}</div>
    <div class="reg-card-meta"><span>ğŸ“… ${n.fecha}</span><span>ğŸ¦ SBS</span></div>
    <div class="reg-detail" id="detail_${n.id}">${n.detalle}
      <button class="reg-ask-btn" onclick="askAboutRegulation(event,'SBS: ${n.titulo.replace(/'/g,"\\'")}')">ğŸ’¬ Consultar IA sobre esta norma</button>
    </div>
  </div>`).join('');
}

function renderSBSCasuistica() {
  const el = document.getElementById('sbsCasuistica'); if(!el) return;
  el.innerHTML = SBS_DATA.casuistica.map(c => `<div class="caso-item" onclick="toggleCasoDetail('caso_${c.num}')">
    <div class="caso-num">${c.num} Â· ${c.area}</div>
    <div class="caso-title">${c.titulo}</div>
    <div class="caso-desc">${c.desc}</div>
    <div class="caso-result" id="caso_${c.num}">${c.resultado}
      <button class="reg-ask-btn" style="margin-top:10px" onclick="askAboutRegulation(event,'SBS Caso: ${c.titulo.replace(/'/g,"\\'")}')">ğŸ’¬ Profundizar con IA</button>
    </div>
  </div>`).join('');
}

function renderSBSQuickQ() {
  const el = document.getElementById('sbsQuickQ'); if(!el) return;
  const qs = ['Â¿CÃ³mo afecta el secreto bancario a una fiscalizaciÃ³n de SUNAT?','Â¿QuÃ© operaciones estÃ¡n exoneradas del ITF?','Â¿Son deducibles las primas de seguro para el IR?','Â¿CÃ³mo tributan los retiros de AFP?','Â¿QuÃ© son las provisiones bancarias deducibles?'];
  el.innerHTML = qs.map(q => `<button class="reg-filter-btn" onclick="document.getElementById('sbsConsultaText').value='${q}'">${q}</button>`).join('');
}

async function consultSBSAI() {
  const query = document.getElementById('sbsConsultaText')?.value?.trim() || '';
  if (!query) { tpToast('Escribe una consulta.', 'warn'); return; }
  const resultEl = document.getElementById('sbsConsultaResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:var(--muted)">Consultando normativa SBS...</div>';
  if (!apiKey) { resultEl.innerHTML = '<div style="color:var(--muted)">Conecta tu API Key para respuestas reales. Demo: La Ley 28194 establece la tasa del ITF en 0.005%.</div>'; return; }
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un experto en regulaciÃ³n financiera y tributaria peruana, especializado en normativa SBS (Ley 26702, Ley 28194, SPP), con enfoque en las implicancias tributarias. Cita siempre la norma exacta.',messages:[{role:'user',content:query}]});
    const d = await res.json();
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  } catch(e) { resultEl.innerHTML = '<div style="color:var(--red)">Error: '+safeHTML(e.message)+'</div>'; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LAVADO DE DINERO / PREVENCIÃ“N LAFT â€” DATA
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const LAVADO_DATA = {
  normas: [
    {id:'lav1', cat:'leyes', titulo:'Ley de Lavado de Activos â€” Ley 27693', tipo:'Ley', fecha:'Abr 2002', badge:'red', desc:'Ley que crea la Unidad de Inteligencia Financiera (UIF-PerÃº) y establece el marco legal contra el lavado de activos y el financiamiento del terrorismo. Define sujetos obligados, ROS, KYC y sanciones.',
     detalle:`<h4>Ley 27693 â€” Sistema Antilavado de Activos</h4>
<div class="reg-detail-art">Art. 3: CreaciÃ³n de la UIF-PerÃº como unidad especializada de la SBS encargada de recibir, analizar y transmitir informaciÃ³n sobre operaciones sospechosas (ROS).</div>
<div class="reg-detail-art">Art. 9: Sujetos obligados â€” Bancos, financieras, seguros, AFP, casas de cambio, notarios, concesionarios mineros, inmobiliarias, casinos, abogados, contadores y otros.</div>
<div class="reg-detail-art">Art. 10: Reporte de Operaciones Sospechosas (ROS) â€” Toda operaciÃ³n que por su monto, frecuencia o caracterÃ­sticas no corresponda al perfil del cliente o supere umbrales debe reportarse a la UIF en 30 dÃ­as hÃ¡biles.</div>
<div class="reg-detail-art">Art. 12: Reporte de operaciones en efectivo â€” Operaciones en efectivo â‰¥ USD 10,000 o equivalentes deben reportarse a la UIF en 15 dÃ­as hÃ¡biles.</div>
<div class="reg-detail-art">Art. 13: Reserva del ROS â€” El reporte y su contenido son estrictamente confidenciales. Su revelaciÃ³n al cliente es infracciÃ³n grave sancionable.</div>
<strong>VÃ­nculo tributario con Lavado de Activos:</strong><br>
â€¢ La defraudaciÃ³n tributaria (D.Leg. 813) es delito precedente del lavado de activos (Art. 10 Ley 27693 modificado por D.Leg. 1249).<br>
â€¢ SUNAT remite a la UIF los casos de defraudaciÃ³n tributaria agravada con indicios de lavado.<br>
â€¢ Los bienes adquiridos con evasiÃ³n tributaria pueden ser objeto de decomiso (pÃ©rdida de dominio, D.Leg. 1373).`},
    {id:'lav2', cat:'leyes', titulo:'Decreto Legislativo 1106 â€” Lucha contra el Lavado de Activos', tipo:'D.Legislativo', fecha:'Abr 2012', badge:'red', desc:'D.Leg. 1106 â€” Ley de lucha contra el lavado de activos y financiamiento del terrorismo. Tipifica los delitos de lavado, conversiÃ³n, transferencia, ocultamiento y tenencia de activos ilÃ­citos.',
     detalle:`<h4>D.Leg. 1106 â€” Delitos de Lavado de Activos</h4>
<div class="reg-detail-art">Art. 2: Actos de conversiÃ³n, transferencia y ocultamiento de activos de origen ilÃ­cito. Pena: 6-15 aÃ±os de prisiÃ³n.</div>
<div class="reg-detail-art">Art. 3: Actos de tenencia de activos de origen ilÃ­cito. Pena: 6-15 aÃ±os de prisiÃ³n.</div>
<div class="reg-detail-art">Art. 4: Actos de transporte, traslado, ingreso o salida del paÃ­s de dinero o tÃ­tulos valores ilÃ­citos. Pena: 8-15 aÃ±os.</div>
<div class="reg-detail-art">Art. 5: Actos de ocultamiento de activos ilÃ­citos mediante operaciones de comercio exterior, triangulaciÃ³n de bienes o servicios. Pena: 8-15 aÃ±os.</div>
<div class="reg-detail-art">Art. 7: Personas jurÃ­dicas â€” Las empresas que participan en lavado de activos pueden ser sancionadas con multas, inhabilitaciÃ³n, disoluciÃ³n y decomiso de bienes.</div>
<strong>VÃ­nculo tributario:</strong><br>
â€¢ Las facturas falsas y la sobrefacturaciÃ³n de importaciones son mÃ©todos de lavado de activos (Art. 5 D.Leg. 1106).<br>
â€¢ La subfacturaciÃ³n de exportaciones permite repatriar fondos ilÃ­citos como ingresos lÃ­citos.<br>
â€¢ El testaferrato (prestanombres) es una forma de ocultamiento de activos tipificada en este D.Leg.<br>
â€¢ La ausencia de respaldo patrimonial lÃ­cito es indicio de lavado en fiscalizaciones de SUNAT.`},
    {id:'lav3', cat:'leyes', titulo:'Decreto Legislativo 1373 â€” ExtinciÃ³n de Dominio', tipo:'D.Legislativo', fecha:'Ago 2018', badge:'red', desc:'Establece el proceso autÃ³nomo de pÃ©rdida de dominio sobre bienes de origen ilÃ­cito sin necesidad de condena penal. Aplica a bienes provenientes de lavado, narcotrÃ¡fico, corrupciÃ³n y defraudaciÃ³n tributaria.',
     detalle:`<h4>D.Leg. 1373 â€” PÃ©rdida de Dominio</h4>
<div class="reg-detail-art">Art. 1: La pÃ©rdida de dominio es una consecuencia patrimonial autÃ³noma de actividades ilÃ­citas, independiente del proceso penal.</div>
<div class="reg-detail-art">Art. 4: Bienes sujetos â€” Dinero, inmuebles, vehÃ­culos, acciones, criptoactivos y cualquier derecho real o personal vinculado a actividades ilÃ­citas.</div>
<div class="reg-detail-art">Art. 7: No se requiere condena penal â€” Basta con demostrar que el bien proviene de actividad ilÃ­cita (carga de la prueba invertida).</div>
<div class="reg-detail-art">Art. 34: Delitos precedentes â€” Lavado de activos, defraudaciÃ³n tributaria, corrupciÃ³n, narcotrÃ¡fico, minerÃ­a ilegal, trata de personas y otros delitos graves.</div>
<strong>Implicancia tributaria:</strong><br>
â€¢ SUNAT puede iniciar procesos de pÃ©rdida de dominio sobre bienes adquiridos con evasiÃ³n tributaria.<br>
â€¢ El decomiso tributario (Art. 175 CÃ³digo Tributario) es distinto a la extinciÃ³n de dominio, pero pueden concurrir.<br>
â€¢ Los bienes pÃ©rdidos de dominio se destinan al Estado para fines sociales y educaciÃ³n.`},
    {id:'lav4', cat:'leyes', titulo:'Decreto Legislativo 1492 â€” Lavado y Criptoactivos (PSAV)', tipo:'D.Legislativo', fecha:'May 2020', badge:'red', desc:'Regula a los Proveedores de Servicios de Activos Virtuales (PSAV) en PerÃº. Exige registro ante la UIF, implementaciÃ³n de programas PLA/FT y reporte de operaciones sospechosas con criptoactivos.',
     detalle:`<h4>D.Leg. 1492 â€” PSAV y Antilavado</h4>
<div class="reg-detail-art">Art. 3: DefiniciÃ³n de PSAV â€” Toda persona natural o jurÃ­dica que intercambie, transfiera, custodie o administre activos virtuales por cuenta de terceros.</div>
<div class="reg-detail-art">Art. 5: Registro obligatorio â€” Los PSAV deben registrarse ante la UIF-PerÃº y actualizar su informaciÃ³n anualmente.</div>
<div class="reg-detail-art">Art. 7: Obligaciones â€” Implementar programa PLA/FT, designar oficial de cumplimiento, realizar debida diligencia (KYC/KYV), monitorear transacciones, reportar ROS.</div>
<div class="reg-detail-art">Res. UIF 035-2023: Reglamento complementario que detalla los requisitos tÃ©cnicos del programa PLA/FT para PSAV.</div>
<strong>Implicancia tributaria:</strong><br>
â€¢ Las ganancias por criptoactivos tributan como renta de 2da categorÃ­a (PN) o 3ra categorÃ­a (PJ).<br>
â€¢ Los PSAV deben reportar a SUNAT las operaciones de sus usuarios (intercambio de informaciÃ³n tributaria).<br>
â€¢ El uso de criptoactivos para evasiÃ³n tributaria puede configurar lavado si el monto es significativo.`},
    {id:'lav5', cat:'uif', titulo:'Unidad de Inteligencia Financiera (UIF-PerÃº) â€” Funciones y estructura', tipo:'Organismo', fecha:'2002-actual', badge:'blue', desc:'La UIF-PerÃº es la unidad de inteligencia financiera peruana, adscrita a la SBS. Recibe, analiza y transmite informaciÃ³n sobre operaciones sospechosas de lavado de activos y financiamiento del terrorismo.',
     detalle:`<h4>UIF-PerÃº â€” Funciones Clave</h4>
<div class="reg-detail-art">RecepciÃ³n de ROS: Recibe mÃ¡s de 20,000 Reportes de Operaciones Sospechosas al aÃ±o de mÃ¡s de 300 sujetos obligados.</div>
<div class="reg-detail-art">AnÃ¡lisis estratÃ©gico: Produce informes de inteligencia financiera con tipologÃ­as de lavado y tendencias delictivas.</div>
<div class="reg-detail-art">CooperaciÃ³n internacional: Intercambia informaciÃ³n con unidades de inteligencia financiera de otros paÃ­ses (GAFI/SUD/Grupo Egmont).</div>
<div class="reg-detail-art">Congelamiento administrativo de fondos: Puede disponer el congelamiento inmediato de activos vinculados al terrorismo o su financiamiento (Res. UIF 017-2017).</div>
<strong>CoordinaciÃ³n con SUNAT:</strong><br>
â€¢ La UIF y SUNAT tienen un convenio de cooperaciÃ³n interinstitucional para compartir informaciÃ³n sobre defraudaciÃ³n tributaria con indicios de lavado.<br>
â€¢ SUNAT puede solicitar informaciÃ³n de la UIF para fiscalizaciones tributarias.<br>
â€¢ La UIF recibe de SUNAT reportes de operaciones tributarias atÃ­picas.`},
    {id:'lav6', cat:'sujetos', titulo:'Sujetos Obligados â€” Reporte de Operaciones Sospechosas (ROS)', tipo:'Obligaciones', fecha:'Vigente', badge:'gold', desc:'Los sujetos obligados deben implementar sistemas de prevenciÃ³n LAFT, designar Oficial de Cumplimiento, elaborar manuales PLA/FT y reportar ROS a la UIF.',
     detalle:`<h4>Sujetos Obligados y sus Obligaciones (Art. 9 Ley 27693)</h4>
<div class="reg-detail-art">Entidades financieras y bancarias: Deben reportar operaciones en efectivo â‰¥ USD 10,000 dentro de 15 dÃ­as hÃ¡biles. ROS dentro de 30 dÃ­as hÃ¡biles.</div>
<div class="reg-detail-art">Notarios: Deben reportar compraventa de inmuebles, constituciÃ³n de empresas y fideicomisos que superen umbrales establecidos.</div>
<div class="reg-detail-art">Concesionarios mineros y de joyerÃ­a: Reportar operaciones en efectivo â‰¥ USD 10,000 y cualquier operaciÃ³n sospechosa.</div>
<div class="reg-detail-art">Casinos y tragamonedas: Reportar fichas canjeadas por â‰¥ USD 3,000 y cualquier operaciÃ³n atÃ­pica.</div>
<div class="reg-detail-art">Inmobiliarias y agentes: Reportar compraventa de inmuebles â‰¥ 50 UIT y operaciones sospechosas independientemente del monto.</div>
<div class="reg-detail-art">Abogados y contadores: Cuando intervienen en constituciÃ³n de sociedades, fideicomisos, compraventa de inmuebles o manejo de cuentas bancarias de terceros.</div>
<strong>No reportar un ROS teniendo indicios de lavado es infracciÃ³n grave:</strong> Multa de hasta 50 UIT + inhabilitaciÃ³n temporal del sujeto obligado.`},
    {id:'lav7', cat:'tipologias', titulo:'TipologÃ­as de Lavado de Activos en el Sector Tributario', tipo:'AnÃ¡lisis', fecha:'Permanente', badge:'blue', desc:'Principales mÃ©todos de lavado de activos con vinculaciÃ³n tributaria. IdentificaciÃ³n de seÃ±ales de alerta para profesionales tributarios y sujetos obligados.',
     detalle:`<h4>TipologÃ­as â€” Lavado con VÃ­nculo Tributario</h4>
<div class="reg-detail-art">1. FacturaciÃ³n falsa (sobrefacturaciÃ³n): Empresa emite facturas por operaciones inexistentes para que el comprador justifique salidas de dinero ilÃ­cito como gasto tributario. SeÃ±al: proveedores sin capacidad operativa real.</div>
<div class="reg-detail-art">2. SubfacturaciÃ³n de exportaciones: Exportador factura menos del valor real, recibe la diferencia en el exterior como fondos ilÃ­citos repatriados. SeÃ±al: precios muy inferiores al mercado internacional.</div>
<div class="reg-detail-art">3. Testaferrato o prestanombres: Personas interpuestas figuran como socios de empresas que canalizan fondos ilÃ­citos. SeÃ±al: socios sin capacidad econÃ³mica ni perfil empresarial.</div>
<div class="reg-detail-art">4. Empresas fachada ("front companies"): Empresas con actividad real mÃ­nima que emiten facturas por montos muy superiores a su capacidad. SeÃ±al: personal mÃ­nimo vs. facturaciÃ³n millonaria.</div>
<div class="reg-detail-art">5. PrÃ©stamos simulados: Persona recibe fondos ilÃ­citos como "prÃ©stamo" con documento privado sin ejecuciÃ³n real. SeÃ±al: prÃ©stamos sin garantÃ­a ni historial de pagos.</div>
<div class="reg-detail-art">6. Bienes suntuarios sin respaldo: AdquisiciÃ³n de inmuebles, vehÃ­culos o joyas con efectivo sin justificaciÃ³n patrimonial. SeÃ±al: ingresos declarados no guardan relaciÃ³n con el nivel de vida.</div>
<strong>Indicios de alerta para contadores y abogados:</strong> Clientes que buscan estructuras complejas sin razÃ³n comercial, se niegan a revelar beneficiario final, o realizan operaciones contradictorias con la actividad declarada.`},
    {id:'lav8', cat:'sanciones', titulo:'RÃ©gimen Sancionador â€” Lavado de Activos y PLA/FT', tipo:'Sanciones', fecha:'Vigente', badge:'red', desc:'Infracciones y sanciones para sujetos obligados y personas naturales que incumplan la normativa antilavado. Incluye multas, inhabilitaciones y responsabilidad penal.',
     detalle:`<h4>Sanciones Administrativas (UIF / SBS)</h4>
<div class="reg-detail-art">No implementar sistema PLA/FT: Multa de hasta 50 UIT (S/275,000 en 2026) + inhabilitaciÃ³n del Oficial de Cumplimiento.</div>
<div class="reg-detail-art">No reportar ROS teniendo indicios: Multa de 10-100 UIT segÃºn gravedad + posible cancelaciÃ³n de autorizaciÃ³n de funcionamiento.</div>
<div class="reg-detail-art">Revelar al cliente la existencia de un ROS: InfracciÃ³n muy grave. Multa de hasta 200 UIT + cese del sujeto obligado.</div>
<div class="reg-detail-art">No llevar registro de operaciones en efectivo â‰¥ USD 10,000: Multa de 1-5 UIT por operaciÃ³n no registrada.</div>
<h4>Sanciones Penales (D.Leg. 1106)</h4>
<div class="reg-detail-art">Lavado de activos doloso: Pena privativa de libertad de 6 a 15 aÃ±os + multa de 60-365 dÃ­as.</div>
<div class="reg-detail-art">Lavado de activos agravado (organizaciÃ³n criminal, funcionarios pÃºblicos): Pena 10-20 aÃ±os + inhabilitaciÃ³n.</div>
<div class="reg-detail-art">OmisiÃ³n de reporte de operaciÃ³n sospechosa: Pena de 2-5 aÃ±os para el Oficial de Cumplimiento que deliberadamente no reporta.</div>
<div class="reg-detail-art">Decomiso de bienes: Todos los activos vinculados al lavado son decomisados (D.Leg. 1373).</div>
<strong>Personas jurÃ­dicas (Art. 7 D.Leg. 1106):</strong> Las empresas pueden ser sancionadas con multas de hasta S/5M + disoluciÃ³n + inhabilitaciÃ³n definitiva para contratar con el Estado.`},
    {id:'lav9', cat:'uif', titulo:'CooperaciÃ³n Internacional â€” GAFI, Grupo Egmont, Wolfsberg', tipo:'EstÃ¡ndares', fecha:'Permanente', badge:'blue', desc:'EstÃ¡ndares internacionales antilavado que PerÃº debe implementar. Recomendaciones del GAFI (FATF), Grupo Egmont de UIFs y Principios Wolfsberg para banca corporativa.',
     detalle:`<h4>EstÃ¡ndares Internacionales Aplicables al PerÃº</h4>
<div class="reg-detail-art">GAFI (FATF) â€” 40 Recomendaciones: EstÃ¡ndar internacional en materia antilavado. PerÃº es miembro desde 2023. Las recomendaciones cubren evaluaciÃ³n de riesgos, medidas preventivas, transparencia de personas jurÃ­dicas, decomiso y cooperaciÃ³n internacional.</div>
<div class="reg-detail-art">EvaluaciÃ³n Mutua GAFI 2023: PerÃº fue evaluado por GAFILAT. Principales hallazgos: necesidad de mejorar supervisiÃ³n de sujetos obligados no financieros (abogados, contadores, inmobiliarias) y fortalecer la aplicaciÃ³n de la extinciÃ³n de dominio.</div>
<div class="reg-detail-art">Grupo Egmont: Red global de 170+ UIFs. UIF-PerÃº es miembro desde 2005. Permite intercambio de inteligencia financiera entre paÃ­ses para rastrear activos transfronterizos.</div>
<div class="reg-detail-art">Principios Wolfsberg: GuÃ­as de mejores prÃ¡cticas para banca corporativa en materia de debida diligencia, KYC y prevenciÃ³n de corrupciÃ³n. Adoptados por la banca peruana como estÃ¡ndar de cumplimiento.</div>
<strong>Implicancia para profesionales tributarios:</strong> La cooperaciÃ³n internacional permite a SUNAT acceder a informaciÃ³n bancaria y financiera de contribuyentes en el extranjero mediante intercambio automÃ¡tico de informaciÃ³n (CRS) y acuerdos de intercambio de informaciÃ³n tributaria (TIEA).`},
    {id:'lav10', cat:'tipologias', titulo:'SeÃ±ales de Alerta (Red Flags) para Profesionales Tributarios', tipo:'GuÃ­a', fecha:'Permanente', badge:'gold', desc:'Indicadores de alerta temprana que contadores, abogados y asesores tributarios deben considerar para detectar posibles operaciones de lavado de activos en sus clientes.',
     detalle:`<h4>Red Flags en el Ejercicio Profesional</h4>
<div class="reg-detail-art">Estructura societaria inusualmente compleja: Sociedades con mÃºltiples capas, en diferentes jurisdicciones, sin justificaciÃ³n econÃ³mica real.</div>
<div class="reg-detail-art">Beneficiario final no identificable: Clientes que se niegan a revelar quiÃ©n realmente controla la empresa o el patrimonio.</div>
<div class="reg-detail-art">Operaciones sin sustento econÃ³mico: Compraventa de bienes a precios notoriamente superiores o inferiores al valor de mercado.</div>
<div class="reg-detail-art">Incremento patrimonial injustificado: Cliente con ingresos declarados mÃ­nimos pero que adquiere bienes suntuarios (inmuebles, vehÃ­culos de lujo).</div>
<div class="reg-detail-art">Pagos en efectivo de montos significativos: Ofrecimiento de pagar honorarios en efectivo por montos elevados sin justificaciÃ³n.</div>
<div class="reg-detail-art">Cambios frecuentes de asesor: Cliente que cambia constantemente de estudio contable o abogado sin razÃ³n aparente.</div>
<div class="reg-detail-art">Jurisdicciones de riesgo: Operaciones con paraÃ­sos fiscales o paÃ­ses con regulaciÃ³n antilavado dÃ©bil sin vinculaciÃ³n comercial justificada.</div>
<div class="reg-detail-art">DocumentaciÃ³n inconsistente: Facturas que no coinciden con la actividad del proveedor, fechas incongruentes, montos que no encajan con el girÃ³ del negocio.</div>
<strong>ObligaciÃ³n de reporte:</strong> Abogados y contadores son sujetos obligados (Art. 9 Ley 27693). Si detectan indicios de lavado, deben reportar ROS a la UIF. El incumplimiento puede generar responsabilidad administrativa y penal.`},
    {id:'lav11', cat:'sujetos', titulo:'Programa de Cumplimiento PLA/FT â€” ImplementaciÃ³n', tipo:'GuÃ­a', fecha:'Vigente', badge:'gold', desc:'Pasos para implementar un programa de prevenciÃ³n de lavado de activos y financiamiento del terrorismo (PLA/FT) en empresas peruanas obligadas.',
     detalle:`<h4>Pasos para Implementar PLA/FT</h4>
<div class="reg-detail-art">1. EvaluaciÃ³n de Riesgos (Risk Assessment): Identificar y evaluar los riesgos LAFT especÃ­ficos de la empresa segÃºn su sector, tamaÃ±o, clientes y geografÃ­a.</div>
<div class="reg-detail-art">2. Manual PLA/FT: Documento que contiene polÃ­ticas, procedimientos y controles internos para prevenir el lavado de activos. Debe ser aprobado por el Directorio.</div>
<div class="reg-detail-art">3. Oficial de Cumplimiento: Designar un responsable ante la UIF, con nivel jerÃ¡rquico suficiente y autonomÃ­a para reportar directamente al Directorio.</div>
<div class="reg-detail-art">4. Debida Diligencia (KYC/KYV/KYCC): Identificar y verificar la identidad del cliente, del beneficiario final y del origen de fondos. Actualizar datos periÃ³dicamente.</div>
<div class="reg-detail-art">5. Monitoreo de Operaciones: Sistema automÃ¡tico o manual para identificar operaciones que se desvÃ­an del perfil del cliente y generar alertas.</div>
<div class="reg-detail-art">6. CapacitaciÃ³n: Entrenamiento anual a todo el personal sobre prevenciÃ³n LAFT, seÃ±ales de alerta y procedimientos de reporte.</div>
<div class="reg-detail-art">7. Reporte a la UIF: Procedimiento para reportar ROS dentro de 30 dÃ­as hÃ¡biles y operaciones en efectivo en 15 dÃ­as hÃ¡biles.</div>
<strong>Registro de operaciones:</strong> Conservar registros de operaciones y debida diligencia por 5 aÃ±os mÃ­nimos (Art. 13 Reglamento Ley 27693). Riesgo de multas si no se conservan adecuadamente.`},
    {id:'lav12', cat:'sujetos', titulo:'Obligaciones de Notarios y Registradores PÃºblicos', tipo:'Obligaciones', fecha:'Vigente', badge:'gray', desc:'Notarios y registradores tienen obligaciones especÃ­ficas en prevenciÃ³n de lavado: identificar al beneficiario final de personas jurÃ­dicas, reportar operaciones sospechosas y verificar PEPs.',
     detalle:`<h4>Notarios y Lavado de Activos</h4>
<div class="reg-detail-art">IdentificaciÃ³n del cliente: Todo notario debe identificar al otorgante, testigos y partes intervinientes con DNI, carnÃ© de extranjerÃ­a o pasaporte.</div>
<div class="reg-detail-art">Beneficiario final: En constituciÃ³n de sociedades, compraventa de inmuebles y fideicomisos, el notario debe identificar al beneficiario final (persona natural que controla o es titular del 10%+).</div>
<div class="reg-detail-art">Reporte de operaciones: Compraventa de inmuebles â‰¥ 50 UIT, constituciÃ³n de sociedades con capital â‰¥ 50 UIT y cualquier operaciÃ³n sospechosa debe reportarse a la UIF.</div>
<div class="reg-detail-art">Registro de operaciones: Llevar un registro cronolÃ³gico de operaciones susceptibles de lavado con datos del cliente, monto, origen de fondos y medio de pago.</div>
<strong>VÃ­nculo tributario:</strong> El notario debe verificar el pago de impuestos (alcabala, IR 1ra categorÃ­a) para la transferencia de inmuebles. Si hay indicios de subvaluaciÃ³n para evadir impuestos, debe considerar reporte a UIF.`},
  ],
  casuistica: [
    {num:'LVD-CASO-001', titulo:'FacturaciÃ³n falsa y lavado de activos â€” Empresa fachada de transporte', desc:'Empresa de transporte facturÃ³ S/2.3M en servicios a una minera, pero no tenÃ­a flota ni personal operativo real. SUNAT detectÃ³ inconsistencias y remitiÃ³ el caso a la UIF.',
     resultado:`<div class="caso-resolucion">ResoluciÃ³n: SUNAT determinÃ³ defraudaciÃ³n tributaria por S/780,000 (IGV+IR omitidos) y remitiÃ³ antecedentes a la UIF por presunto lavado de activos. La UIF transmitiÃ³ el caso al Ministerio PÃºblico. Se determinÃ³ que la empresa fachada emitÃ­a facturas falsas que la minera usaba para justificar salidas de dinero ilÃ­cito. La minera pagaba en efectivo montos inferiores a S/2,000 (bancarizaciÃ³n) para no dejar rastro bancario. Proceso por lavado en curso.</div><strong>Lecciones:</strong> SUNAT y UIF coordinan activamente. La facturaciÃ³n sin capacidad operativa real es un indicador clave de lavado. La fragmentaciÃ³n de pagos en efectivo para evitar bancarizaciÃ³n es otra seÃ±al de alerta.`, area:'FacturaciÃ³n falsa / SUNAT / UIF'},
    {num:'LVD-CASO-002', titulo:'SubfacturaciÃ³n de exportaciones â€” Lavado mediante comercio exterior', desc:'Exportador de textiles declarÃ³ exportaciones por USD 3.1M a una empresa vinculada en PanamÃ¡. InvestigaciÃ³n revelÃ³ que el valor real era USD 8.7M.',
     resultado:`<div class="caso-resolucion">ResoluciÃ³n: SUNAT detectÃ³ la subfacturaciÃ³n mediante precios de transferencia y anÃ¡lisis de comparables. La diferencia de USD 5.6M se repatriaba como "inversiÃ³n extranjera" a otra empresa del grupo en PerÃº, completando el ciclo de lavado. D.Leg. 1106 Art. 4 (transporte de activos ilÃ­citos) y Art. 5 (ocultamiento mediante comercio exterior). SDNAT determinÃ³ deuda tributaria de S/4.2M + multas. La UIF congelÃ³ cuentas bancarias. Ministerio PÃºblico abriÃ³ investigaciÃ³n por lavado agravado.</div><strong>Lecciones:</strong> Precios de transferencia es la herramienta clave para detectar subfacturaciÃ³n. El comercio exterior es uno de los mÃ©todos mÃ¡s usados para lavado de activos en PerÃº. Las empresas vinculadas en paraÃ­sos fiscales son un fuerte indicador de riesgo.`, area:'Comercio exterior / Precios de transferencia'},
    {num:'LVD-CASO-003', titulo:'Testaferrato de bienes inmuebles â€” Prestanombre en compraventa', desc:'Empresa adquiriÃ³ 4 inmuebles de lujo por S/12M en efectivo fragmentado en 12 operaciones. Los socios figuraban con ingresos anuales menores a S/60,000.',
     resultado:`<div class="caso-resolucion">ResoluciÃ³n: SUNAT determinÃ³ incremento patrimonial no justificado (Art. 52 LIR) y defraudaciÃ³n tributaria por S/3.6M. Adicionalmente, la UIF determinÃ³ que los socios eran testaferros de una organizaciÃ³n criminal dedicada a la minerÃ­a ilegal. Los inmuebles fueron sometidos a extinciÃ³n de dominio (D.Leg. 1373). La organizaciÃ³n usaba el sistema de prÃ©stamos simulados entre las empresas fachada y los testaferros para justificar el origen del dinero en las compras inmobiliarias.</div><strong>Lecciones:</strong> El incremento patrimonial no justificado es la principal herramienta de SUNAT para detectar lavado en personas naturales. Los notarios deben reportar compraventas sin sustento de ingresos. La extinciÃ³n de dominio permite decomisar bienes sin necesidad de condena penal.`, area:'Inmuebles / Testaferrato / ExtinciÃ³n de dominio'},
    {num:'LVD-CASO-004', titulo:'Criptoactivos â€” Exchange no registrado y lavado de activos', desc:'PSAV (Proveedor de Servicios de Activos Virtuales) operÃ³ sin registro ante la UIF durante 18 meses, moviendo el equivalente a USD 4.5M en USDT (BEP-20).',
     resultado:`<div class="caso-resolucion">ResoluciÃ³n: UIF detectÃ³ al PSAV mediante monitoreo de blockchain (anÃ¡lisis de transacciones en BSCScan). El exchange operaba desde PerÃº sin registrarse ante la UIF (infracciÃ³n D.Leg. 1492 + Res. UIF 035-2023). Se identificaron transferencias vinculadas a direcciones seÃ±aladas por ransomware y darknet markets. La UIF dispuso el congelamiento administrativo de los fondos. SUNAT determinÃ³ deuda tributaria por omisiÃ³n de declaraciÃ³n de rentas de 2da categorÃ­a de los usuarios. El caso fue remitido a la FiscalÃ­a Especializada en Lavado de Activos.</div><strong>Lecciones:</strong> Las transacciones en blockchain son rastreables (aunque seudÃ³nimas). Los PSAV no registrados operan ilegalmente. La UIF puede congelar fondos sin orden judicial en casos de terrorismo/lavado. Los exchanges deben implementar KYC/KYV obligatorio.`, area:'Criptoactivos / PSAV / UIF'},
    {num:'LVD-CASO-005', titulo:'Contador cÃ³mplice â€” InfracciÃ³n por omisiÃ³n de reporte ROS', desc:'Contador independiente detectÃ³ que su cliente realizaba operaciones sin sustento por S/800,000 en un aÃ±o. No reportÃ³ a la UIF y continuÃ³ preparando las declaraciones tributarias.',
     resultado:`<div class="caso-resolucion">ResoluciÃ³n: UIF sancionÃ³ al contador con multa de 30 UIT (S/165,000) por omisiÃ³n de reporte de operaciÃ³n sospechosa (Art. 9 Ley 27693 + Reglamento Res. SBS 2660-2015). El contador alegÃ³ que confiaba en su cliente y que "solo preparaba declaraciones". La UIF determinÃ³ que los contadores son sujetos obligados cuando intervienen en operaciones societarias, patrimoniales o financieras de sus clientes. El contador tambiÃ©n fue inhabilitado por 2 aÃ±os para ejercer como profesional.</div><strong>LecciÃ³n crÃ­tica:</strong> Los contadores y abogados son sujetos obligados ante la UIF. El "asesoramiento puramente tributario" no exime de reportar ROS detectados. La confianza en el cliente no es excusa. Ignorar las seÃ±ales de alerta no exime de responsabilidad. El lema es: "Si lo ves, repÃ³rtalo."`, area:'Contador / Sujeto obligado / ROS'},
    {num:'LVD-CASO-006', titulo:'PrÃ©stamo simulado â€” FiscalizaciÃ³n cruzada SUNAT-UIF', desc:'Persona natural recibiÃ³ "prÃ©stamo" de S/1.5M de un familiar en el extranjero sin contrato, sin garantÃ­a y sin pago de intereses. UsÃ³ el dinero para comprar 2 departamentos.',
     resultado:`<div class="caso-resolucion">ResoluciÃ³n: SUNAT detectÃ³ el prÃ©stamo en la DJ Anual como pasivo. Al fiscalizar, encontrÃ³ que el "familiar en el extranjero" era una empresa offshore en las Islas VÃ­rgenes BritÃ¡nicas. No habÃ­a historial de pagos de intereses, ni amortizaciÃ³n del principal, ni garantÃ­a real. SUNAT recalificÃ³ el prÃ©stamo como ingreso gravado (incremento patrimonial no justificado, Art. 52 LIR) determinando IR de S/495,000 + multas. La UIF abriÃ³ investigaciÃ³n por presunto lavado de activos mediante prÃ©stamo simulado (tipologÃ­a testaferrato + simulaciÃ³n).</div><strong>LecciÃ³n:</strong> Los prÃ©stamos simulados son una tipologÃ­a de lavado. Para que un prÃ©stamo sea vÃ¡lido tributariamente debe tener: contrato escrito, tasa de interÃ©s de mercado, calendario de pagos y garantÃ­a. Los prÃ©stamos de offshores sin sustento real son fiscalizados de oficio por SUNAT y UIF.`, area:'PrÃ©stamos simulados / SUNAT / UIF'},
  ]
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LAVADO DE DINERO â€” FUNCTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let lavFilterCat = 'todos', lavTab = 'normas';

function setLavadoTab(tab, btn) {
  lavTab = tab;
  document.querySelectorAll('#ptLavado .reg-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['lavNormas','lavCasuistica','lavConsultor'].forEach(id => {
    const el = document.getElementById(id); if(el) el.style.display = 'none';
  });
  const showId = { normas:'lavNormas', casuistica:'lavCasuistica', consultor:'lavConsultor' }[tab];
  const showEl = document.getElementById(showId);
  if (showEl) showEl.style.display = 'block';
  if (tab === 'normas') renderLavadoNormas('');
  if (tab === 'casuistica') renderLavadoCasuistica();
  if (tab === 'consultor') renderLavadoQuickQ();
}

function filterLavado(cat, btn) {
  lavFilterCat = cat;
  document.querySelectorAll('#ptLavado .reg-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderLavadoNormas('');
  const s = document.getElementById('lavSearch'); if(s) s.value = '';
}

function searchLavado(q) { renderLavadoNormas(q.toLowerCase().trim()); }

function renderLavadoNormas(q) {
  const el = document.getElementById('lavNormas'); if (!el) return;
  let items = lavFilterCat === 'todos' ? LAVADO_DATA.normas : LAVADO_DATA.normas.filter(n => n.cat === lavFilterCat);
  if (q) items = items.filter(n => n.titulo.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q));
  if (!items.length) { el.innerHTML = '<div class="hempty">No se encontraron resultados.</div>'; return; }
  el.innerHTML = items.map(n => `<div class="reg-card" onclick="toggleRegDetail('${n.id}')">
    <div class="reg-card-top">
      <div class="reg-card-title">${n.titulo}</div>
      <div class="reg-card-badges"><span class="reg-badge ${n.badge}">${n.tipo}</span></div>
    </div>
    <div class="reg-card-desc">${n.desc}</div>
    <div class="reg-card-meta"><span>ğŸ“… ${n.fecha}</span><span>ğŸ”’ Lavado de Activos</span></div>
    <div class="reg-detail" id="detail_${n.id}">${n.detalle}
      <button class="reg-ask-btn" onclick="askAboutRegulation(event,'LAFT: ${n.titulo.replace(/'/g,"\\'")}')">ğŸ’¬ Consultar IA sobre este tema</button>
    </div>
  </div>`).join('');
}

function renderLavadoCasuistica() {
  const el = document.getElementById('lavCasuistica'); if(!el) return;
  el.innerHTML = LAVADO_DATA.casuistica.map(c => `<div class="caso-item" onclick="toggleCasoDetail('caso_${c.num}')">
    <div class="caso-num">${c.num} Â· ${c.area}</div>
    <div class="caso-title">${c.titulo}</div>
    <div class="caso-desc">${c.desc}</div>
    <div class="caso-result" id="caso_${c.num}">${c.resultado}
      <button class="reg-ask-btn" style="margin-top:10px" onclick="askAboutRegulation(event,'Lavado Caso: ${c.titulo.replace(/'/g,"\\'")}')">ğŸ’¬ Profundizar con IA</button>
    </div>
  </div>`).join('');
}

function renderLavadoQuickQ() {
  const el = document.getElementById('lavQuickQ'); if(!el) return;
  const qs = ['Â¿QuÃ© delitos son precedentes del lavado de activos en PerÃº?','Â¿CuÃ¡ndo debo reportar un ROS a la UIF?','Â¿CÃ³mo afecta la Ley 27693 a los contadores?','Â¿QuÃ© es la extinciÃ³n de dominio y cÃ³mo se relaciona con SUNAT?','Â¿Los criptoactivos estÃ¡n regulados contra el lavado?','Â¿QuÃ© sanciones aplican por no reportar operaciones sospechosas?'];
  el.innerHTML = qs.map(q => `<button class="reg-filter-btn" onclick="document.getElementById('lavConsultaText').value='${q.replace(/'/g,"\\'")}'">${q}</button>`).join('');
}

async function consultLavadoAI() {
  const query = document.getElementById('lavConsultaText')?.value?.trim() || '';
  if (!query) { tpToast('Escribe una consulta.', 'warn'); return; }
  const resultEl = document.getElementById('lavConsultaResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:var(--muted)">Consultando normativa antilavado...</div>';
  if (!apiKey) { resultEl.innerHTML = '<div style="color:var(--muted)">Conecta tu API Key para respuestas reales. Demo: La Ley 27693 regula el sistema de prevenciÃ³n de lavado de activos en PerÃº.</div>'; return; }
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un abogado peruano experto en prevenciÃ³n de lavado de activos (LAFT). Conoces la Ley 27693, D.Leg. 1106, D.Leg. 1373, D.Leg. 1492, las resoluciones UIF, las recomendaciones GAFI y la jurisprudencia peruana. Cita siempre la norma exacta y el artÃ­culo.',messages:[{role:'user',content:query}]});
    const d = await res.json();
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  } catch(e) { resultEl.innerHTML = '<div style="color:var(--red)">Error: '+safeHTML(e.message)+'</div>'; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SMV â€” FUNCTIONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let smvFilterCat = 'todos', smvTab = 'normas';

function setSMVTab(tab, btn) {
  smvTab = tab;
  document.querySelectorAll('#ptSmv .reg-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['smvNormas','smvCasuistica','smvConsultor','smvMercado'].forEach(id => {
    const el = document.getElementById(id); if(el) el.style.display = 'none';
  });
  const showId = { normas:'smvNormas', casuistica:'smvCasuistica', consultor:'smvConsultor', mercado:'smvMercado' }[tab];
  const showEl = document.getElementById(showId);
  if (showEl) showEl.style.display = 'block';
  if (tab === 'normas') renderSMVNormas('');
  if (tab === 'casuistica') renderSMVCasuistica();
  if (tab === 'consultor') renderSMVQuickQ();
}

function filterSMV(cat, btn) {
  smvFilterCat = cat;
  document.querySelectorAll('#ptSmv .reg-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderSMVNormas('');
  const s = document.getElementById('smvSearch'); if(s) s.value = '';
}

function searchSMV(q) { renderSMVNormas(q.toLowerCase().trim()); }

function renderSMVNormas(q) {
  const el = document.getElementById('smvNormas'); if(!el) return;
  let items = smvFilterCat === 'todos' ? SMV_DATA.normas : SMV_DATA.normas.filter(n => n.cat === smvFilterCat);
  if (q) items = items.filter(n => n.titulo.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q));
  if (!items.length) { el.innerHTML = '<div class="hempty">No se encontraron normas.</div>'; return; }
  el.innerHTML = items.map(n => `<div class="reg-card smv" onclick="toggleRegDetail('smv_${n.id}')">
    <div class="reg-card-top">
      <div class="reg-card-title">${n.titulo}</div>
      <div class="reg-card-badges"><span class="reg-badge green">${n.tipo}</span></div>
    </div>
    <div class="reg-card-desc">${n.desc}</div>
    <div class="reg-card-meta"><span>ğŸ“… ${n.fecha}</span><span>ğŸ“ˆ SMV</span></div>
    <div class="reg-detail smv-detail" id="detail_smv_${n.id}">${n.detalle}
      <button class="reg-ask-btn smv-ask" onclick="askAboutRegulation(event,'SMV: ${n.titulo.replace(/'/g,"\\'")}')">ğŸ’¬ Consultar IA sobre esta norma</button>
    </div>
  </div>`).join('');
}

function renderSMVCasuistica() {
  const el = document.getElementById('smvCasuistica'); if(!el) return;
  el.innerHTML = SMV_DATA.casuistica.map(c => `<div class="caso-item" onclick="toggleCasoDetail('smvcaso_${c.num}')">
    <div class="caso-num" style="color:#4CAF50">${c.num} Â· ${c.area}</div>
    <div class="caso-title">${c.titulo}</div>
    <div class="caso-desc">${c.desc}</div>
    <div class="caso-result" id="smvcaso_${c.num}">${c.resultado}
      <button class="reg-ask-btn smv-ask" style="margin-top:10px" onclick="askAboutRegulation(event,'SMV Caso: ${c.titulo.replace(/'/g,"\\'")}')">ğŸ’¬ Profundizar con IA</button>
    </div>
  </div>`).join('');
}

function renderSMVQuickQ() {
  const el = document.getElementById('smvQuickQ'); if(!el) return;
  const qs = ['Â¿CÃ³mo tributan las ganancias de capital en la BVL?','Â¿QuÃ© es un hecho de importancia SMV?','Â¿CÃ³mo funciona la tributaciÃ³n de los FIBRAs?','Â¿CuÃ¡l es la tasa de retenciÃ³n sobre dividendos?','Â¿QuÃ© pasa tributariamente en una fusiÃ³n de empresa listada?'];
  el.innerHTML = qs.map(q => `<button class="reg-filter-btn smv-active" style="background:rgba(76,175,80,.1)" onclick="document.getElementById('smvConsultaText').value='${q}'">${q}</button>`).join('');
}

async function consultSMVAI() {
  const query = document.getElementById('smvConsultaText')?.value?.trim() || '';
  if (!query) { tpToast('Escribe una consulta.', 'warn'); return; }
  const resultEl = document.getElementById('smvConsultaResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:var(--muted)">Consultando normativa SMV...</div>';
  if (!apiKey) { resultEl.innerHTML = '<div style="color:var(--muted)">Conecta tu API Key para respuestas reales. Demo: Las ganancias en BVL tributan al 6.25% sobre ganancia neta.</div>'; return; }
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un experto en mercado de valores y tributaciÃ³n bursÃ¡til peruana, especializado en normativa SMV (D.Leg. 861, LMV, FIBRAs, BVL) y la tributaciÃ³n de rentas de 2da categorÃ­a. Cita siempre la norma exacta.',messages:[{role:'user',content:query}]});
    const d = await res.json();
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  } catch(e) { resultEl.innerHTML = '<div style="color:var(--red)">Error: '+safeHTML(e.message)+'</div>'; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SHARED HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function toggleRegDetail(id) {
  const el = document.getElementById('detail_' + id);
  if (el) el.classList.toggle('open');
}
function toggleCasoDetail(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}
function askAboutRegulation(e, normName) {
  e.stopPropagation();
  convHist = []; convId = null;
  goToChat();
  setTimeout(() => sendMsg('ExplÃ­came detalladamente la siguiente norma y sus implicancias tributarias en PerÃº: ' + normName), 350);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PATCH setPTab
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _origSetPTabV8 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV8(tab, btn);
  if (tab === 'sbs') { setSBSTab('normas', null); setTimeout(()=>document.querySelector('#ptSbs .reg-tab')?.classList.add('active'),50); }
  if (tab === 'smv') { setSMVTab('normas', null); setTimeout(()=>document.querySelector('#ptSmv .reg-tab')?.classList.add('active'),50); }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SISTEMA DE SUGERENCIAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Storage helpers â”€â”€
function getAllSugs() {
  try { return JSON.parse(localStorage.getItem('tp_sugs') || '[]'); } catch { return []; }
}
function saveAllSugs(arr) {
  localStorage.setItem('tp_sugs', JSON.stringify(arr));
}

// â”€â”€ State â”€â”€
let sugCatSel = '';
let sugPrioSel = 'media';
let sugTabActive = 'nueva';
let misSugFilter = 'todas';
let todasSugFilter = 'todas';

// â”€â”€ Init suggestions panel â”€â”€
function initSugerencias() {
  if (!curUser) return;
  const isLocked = !isAdminUser() && curUser.plan === 'basico';
  const lock = document.getElementById('sugLock');
  const content = document.getElementById('sugContent');
  if (lock) lock.style.display = isLocked ? 'block' : 'none';
  if (content) content.style.display = isLocked ? 'none' : 'block';
  if (!isLocked) {
    setSugTab('nueva', document.querySelector('#ptSugerencias .reg-tab'));
    renderMisSug();
    renderTodasSug();
  }
}

// â”€â”€ Tab switching â”€â”€
function setSugTab(tab, btn) {
  sugTabActive = tab;
  document.querySelectorAll('#ptSugerencias .reg-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['sugNueva','sugMis','sugTodas'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const map = { nueva:'sugNueva', mis:'sugMis', todas:'sugTodas' };
  const el = document.getElementById(map[tab]); if (el) el.style.display = 'block';
  if (tab === 'mis') renderMisSug();
  if (tab === 'todas') renderTodasSug();
}

// â”€â”€ Category selection â”€â”€
function selectSugCat(cat, btn) {
  sugCatSel = cat;
  document.querySelectorAll('.sug-cat').forEach(b => { b.classList.remove('sel','bug','contenido','mejora'); });
  btn.classList.add('sel');
  if (cat === 'bug') btn.classList.add('bug');
  if (cat === 'contenido') btn.classList.add('contenido');
  if (cat === 'mejora') btn.classList.add('mejora');
}

// â”€â”€ Priority selection â”€â”€
function selectSugPrio(prio, btn) {
  sugPrioSel = prio;
  document.querySelectorAll('.sug-prio-btn').forEach(b => { b.classList.remove('sel','baja','media','alta'); });
  btn.classList.add('sel', prio);
}

// â”€â”€ Char counter â”€â”€
function updateSugChar() {
  const inp = document.getElementById('sugTitulo');
  const cnt = document.getElementById('sugCharCount');
  if (inp && cnt) { const n = inp.value.length; cnt.textContent = n + ' / 100'; cnt.style.color = n > 80 ? 'var(--gold)' : 'var(--muted)'; }
}

// â”€â”€ Submit sugerencia â”€â”€
function submitSugerencia() {
  const titulo = document.getElementById('sugTitulo')?.value?.trim() || '';
  const desc = document.getElementById('sugDesc')?.value?.trim() || '';
  const errEl = document.getElementById('sugError');
  const okEl = document.getElementById('sugOk');
  const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; okEl.style.display = 'none'; };
  errEl.style.display = 'none'; okEl.style.display = 'none';
  if (!sugCatSel) { showErr('Selecciona una categorÃ­a para tu sugerencia.'); return; }
  if (!titulo || titulo.length < 5) { showErr('El tÃ­tulo debe tener al menos 5 caracteres.'); return; }
  if (!desc || desc.length < 15) { showErr('La descripciÃ³n debe tener al menos 15 caracteres.'); return; }
  const sug = {
    id: 'SUG-' + Date.now(),
    userId: curUser.email,
    userName: curUser.name,
    plan: curUser.plan,
    cat: sugCatSel,
    titulo,
    desc,
    prioridad: sugPrioSel,
    estado: 'pendiente',
    respuesta: '',
    fecha: new Date().toLocaleDateString('es-PE', {day:'2-digit', month:'short', year:'numeric'}),
    fechaMs: Date.now(),
  };
  const all = getAllSugs();
  all.unshift(sug);
  saveAllSugs(all);
  // Sync individual suggestion doc to Firestore (read back via orderBy('fechaMs'))
  if (fbReady) {
    fbDb.collection('sugerencias').doc(sug.id).set(sug)
      .catch(e => console.warn('save sugerencia Firestore error:', e.message));
  }
  // Reset form
  document.getElementById('sugTitulo').value = '';
  document.getElementById('sugDesc').value = '';
  document.getElementById('sugCharCount').textContent = '0 / 100';
  document.querySelectorAll('.sug-cat').forEach(b => b.classList.remove('sel','bug','contenido','mejora'));
  document.querySelectorAll('.sug-prio-btn').forEach(b => b.classList.remove('sel','baja','media','alta'));
  sugCatSel = ''; sugPrioSel = 'media';
  okEl.textContent = 'âœ… Â¡Sugerencia enviada! Gracias, la revisaremos pronto.';
  okEl.style.display = 'block';
  setTimeout(() => okEl.style.display = 'none', 4000);
  addNotif('ğŸ’¡', 'Sugerencia enviada', '"' + titulo.substring(0, 40) + (titulo.length > 40 ? 'â€¦' : '') + '" fue enviada correctamente.');
}

// â”€â”€ Render helpers â”€â”€
const CAT_LABELS = { 'nueva-funcion':'â­ Nueva funciÃ³n', mejora:'ğŸ”§ Mejora', contenido:'ğŸ“š Contenido', bug:'ğŸ› Bug', otro:'ğŸ’¬ Otro' };
const ESTADO_LABELS = { pendiente:'Pendiente', revision:'En revisiÃ³n', implementado:'âœ… Implementado', rechazado:'Rechazado' };
const PRIO_ICONS = { alta:'ğŸ”´', media:'ğŸŸ¡', baja:'ğŸŸ¢' };

function renderSugItem(s, showUser) {
  const plan = _safeToken(s.plan, ['basico','pro','empresa'], 'basico');
  const cat = _safeToken(s.cat, Object.keys(CAT_LABELS), 'otro');
  const estado = _safeToken(s.estado, Object.keys(ESTADO_LABELS), 'pendiente');
  const prioridad = _safeToken(s.prioridad, Object.keys(PRIO_ICONS), 'media');
  const planBadge = plan === 'empresa' ? '<span style="font-size:14px;background:rgba(58,134,255,.13);border:1px solid rgba(58,134,255,.22);color:#3A86FF;padding:1px 6px;border-radius:6px">Empresa</span>' : plan === 'pro' ? '<span style="font-size:14px;background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.22);color:var(--gold);padding:1px 6px;border-radius:6px">Pro</span>' : '';
  const replyHtml = s.respuesta ? `<div class="sug-reply-box"><div class="sug-reply-label">ğŸ’¬ Respuesta del equipo DeclaraFY</div>${_escapeHtml(s.respuesta)}</div>` : '';
  return `<div class="sug-item">
    <div class="sug-item-top">
      <div class="sug-priority-dot ${prioridad}"></div>
      <div class="sug-item-left">
        <div class="sug-item-title">${_escapeHtml(s.titulo||'Sin tÃ­tulo')}</div>
        <div class="sug-item-desc">${_escapeHtml(s.desc||'')}</div>
        ${replyHtml}
      </div>
    </div>
    <div class="sug-item-meta">
      <span class="sug-badge ${cat}">${_escapeHtml(CAT_LABELS[cat] || cat)}</span>
      <span class="sug-status ${estado}">${_escapeHtml(ESTADO_LABELS[estado] || estado)}</span>
      ${showUser ? `<span class="sug-item-user">ğŸ‘¤ ${_escapeHtml(s.userName||'Usuario')} ${planBadge}</span>` : ''}
      <span class="sug-item-date">ğŸ“… ${_escapeHtml(s.fecha||'')}</span>
      <span style="font-size:14px;color:var(--muted)">${PRIO_ICONS[prioridad]} ${prioridad.charAt(0).toUpperCase()+prioridad.slice(1)}</span>
    </div>
  </div>`;
}

function renderMisSug() {
  const el = document.getElementById('misSugList'); if (!el || !curUser) return;
  const all = getAllSugs().filter(s => s.userId === curUser.email);
  const filtered = misSugFilter === 'todas' ? all : all.filter(s => s.estado === misSugFilter);
  if (!filtered.length) {
    el.innerHTML = `<div class="sug-empty">No tienes sugerencias${misSugFilter !== 'todas' ? ' en este estado' : ''}.<br>Â¡EnvÃ­a tu primera idea con el formulario!</div>`;
    return;
  }
  el.innerHTML = filtered.map(s => renderSugItem(s, false)).join('');
}

function filterMisSug(f, btn) {
  misSugFilter = f;
  document.querySelectorAll('#sugMis .sug-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderMisSug();
}

function renderTodasSug() {
  const el = document.getElementById('todasSugList'); if (!el) return;
  let all = getAllSugs().filter(s => s.userId !== curUser?.email); // exclude own
  if (todasSugFilter === 'implementado') all = getAllSugs().filter(s => s.estado === 'implementado');
  else if (todasSugFilter !== 'todas') all = all.filter(s => s.cat === todasSugFilter);
  // Only show non-rejected for public view
  all = all.filter(s => s.estado !== 'rechazado');
  if (!all.length) {
    el.innerHTML = `<div class="sug-empty">No hay sugerencias${todasSugFilter !== 'todas' ? ' en esta categorÃ­a' : ''} todavÃ­a.<br>Â¡SÃ© el primero en enviar una!</div>`;
    return;
  }
  el.innerHTML = all.map(s => renderSugItem(s, true)).join('');
}

function filterTodasSug(f, btn) {
  todasSugFilter = f;
  document.querySelectorAll('#sugTodas .sug-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTodasSug();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ADMIN â€” GESTIÃ“N DE SUGERENCIAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderAdminSugs() {
  const wrap = document.getElementById('adminSugWrap'); if (!wrap) return;
  const all = getAllSugs();
  if (!all.length) {
    wrap.innerHTML = '<div class="sug-empty">No hay sugerencias enviadas aÃºn.</div>';
    return;
  }
  // Stats
  const stats = { pendiente:0, revision:0, implementado:0, rechazado:0 };
  all.forEach(s => stats[s.estado] = (stats[s.estado]||0)+1);
  const byPlan = { pro: all.filter(s=>s.plan==='pro').length, empresa: all.filter(s=>s.plan==='empresa').length };
  wrap.innerHTML = `
    <div class="pcards" style="margin-bottom:16px">
      <div class="pcard"><div class="pcard-l">Total</div><div class="pcard-v gold">${all.length}</div><div class="pcard-s">sugerencias</div></div>
      <div class="pcard"><div class="pcard-l">Pendientes</div><div class="pcard-v">${stats.pendiente}</div><div class="pcard-s">por revisar</div></div>
      <div class="pcard"><div class="pcard-l">En revisiÃ³n</div><div class="pcard-v" style="color:var(--gold)">${stats.revision}</div><div class="pcard-s">en proceso</div></div>
      <div class="pcard"><div class="pcard-l">Implementadas</div><div class="pcard-v" style="color:var(--green)">${stats.implementado}</div><div class="pcard-s">completadas</div></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      <button class="sug-filter active" onclick="filterAdmSug('todas',this)">Todas (${all.length})</button>
      <button class="sug-filter" onclick="filterAdmSug('pendiente',this)">Pendientes (${stats.pendiente})</button>
      <button class="sug-filter" onclick="filterAdmSug('revision',this)">En revisiÃ³n (${stats.revision})</button>
      <button class="sug-filter" onclick="filterAdmSug('implementado',this)">Implementadas (${stats.implementado})</button>
      <button class="sug-filter" onclick="filterAdmSug('alta',this)">ğŸ”´ Alta prioridad</button>
      <button class="sug-filter" onclick="filterAdmSug('pro',this)">Plan Pro (${byPlan.pro})</button>
      <button class="sug-filter" onclick="filterAdmSug('empresa',this)">Plan Empresa (${byPlan.empresa})</button>
    </div>
    <div id="admSugItems">${renderAdmSugItems(all)}</div>`;
}

function filterAdmSug(f, btn) {
  document.querySelectorAll('#adminSugWrap .sug-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const all = getAllSugs();
  let filtered = all;
  if (f === 'pendiente' || f === 'revision' || f === 'implementado' || f === 'rechazado') filtered = all.filter(s => s.estado === f);
  else if (f === 'alta') filtered = all.filter(s => s.prioridad === 'alta');
  else if (f === 'pro' || f === 'empresa') filtered = all.filter(s => s.plan === f);
  document.getElementById('admSugItems').innerHTML = renderAdmSugItems(filtered);
}

function renderAdmSugItems(list) {
  if (!list.length) return '<div class="sug-empty">No hay sugerencias en este filtro.</div>';
  return list.map((s, i) => {
    const realIdx = getAllSugs().findIndex(x => x.id === s.id);
    return `<div class="adm-sug-item">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:6px">
        <div class="sug-priority-dot ${s.prioridad}" style="margin-top:4px"></div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:500;margin-bottom:2px">${s.titulo}</div>
          <div style="font-size:14px;color:var(--muted);margin-bottom:6px">${s.desc}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:14px">
            <span class="sug-badge ${s.cat}">${CAT_LABELS[s.cat]||s.cat}</span>
            <span class="sug-status ${s.estado}">${ESTADO_LABELS[s.estado]||s.estado}</span>
            <span style="color:var(--muted)">ğŸ‘¤ ${s.userName} (${s.plan})</span>
            <span style="color:var(--muted)">ğŸ“… ${s.fecha}</span>
            <span style="color:var(--muted)">${PRIO_ICONS[s.prioridad]} ${s.prioridad}</span>
          </div>
          ${s.respuesta ? `<div class="sug-reply-box" style="margin-top:8px"><div class="sug-reply-label">Tu respuesta actual</div>${s.respuesta}</div>` : ''}
        </div>
      </div>
      <input class="adm-sug-reply" id="admReply_${s.id}" placeholder="Escribe una respuesta para el usuario (opcional)..." value="${s.respuesta||''}">
      <div class="adm-sug-actions">
        <button class="adm-sug-action review" onclick="updateSugEstado('${s.id}','revision')">ğŸ” En revisiÃ³n</button>
        <button class="adm-sug-action approve" onclick="updateSugEstado('${s.id}','implementado')">âœ… Implementar</button>
        <button class="adm-sug-action reject" onclick="updateSugEstado('${s.id}','rechazado')">âŒ Rechazar</button>
        <button class="adm-sug-action" onclick="updateSugEstado('${s.id}','pendiente')">â†© Pendiente</button>
      </div>
    </div>`;
  }).join('');
}

function updateSugEstado(id, newEstado) {
  const all = getAllSugs();
  const idx = all.findIndex(s => s.id === id);
  if (idx < 0) return;
  const reply = document.getElementById('admReply_' + id)?.value?.trim() || '';
  all[idx].estado = newEstado;
  all[idx].respuesta = reply;
  saveAllSugs(all);
  // Sync to Firestore
  if (fbReady) {
    fbDb.collection('sugerencias').doc(id).update({ estado: newEstado, respuesta: reply })
      .catch(e => console.warn('Update sug Firestore error:', e.message));
  }
  // Notify the user if implemented
  if (newEstado === 'implementado' && curUser && all[idx].userId === curUser.email) {
    addNotif('ğŸ‰', 'Â¡Tu sugerencia fue implementada!', '"' + all[idx].titulo.substring(0,40) + '" ya estÃ¡ disponible en DeclaraFY.');
  } else if (newEstado === 'revision') {
    addNotif('ğŸ”', 'Sugerencia en revisiÃ³n', '"' + all[idx].titulo.substring(0,40) + '" estÃ¡ siendo revisada por el equipo.');
  }
  renderAdminSugs();
  renderMisSug();
  renderTodasSug();
  // Small feedback
  const estados = { implementado:'âœ… Marcada como implementada', revision:'ğŸ” Marcada en revisiÃ³n', rechazado:'âŒ Rechazada', pendiente:'â†© Vuelta a pendiente' };
  addNotif('âš™ï¸', 'Sugerencia actualizada', estados[newEstado] || 'Estado actualizado.');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INJECT ADMIN SUGS SECTION INTO ADMIN TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function renderAdmin() {
  if (!isAdminUser()) return;
  const admEl = document.getElementById('admCards');
  const tbody = document.getElementById('admTbody');
  const topicsEl = document.getElementById('topTopics');
  if (admEl) admEl.innerHTML = '<div class="hempty">Cargando informaciÃ³n administrativaâ€¦</div>';
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">Cargando usuariosâ€¦</td></tr>';
  try {
    const overview = await declarafyApi('admin_overview', { method: 'GET' });
    const uArr = Array.isArray(overview?.users) ? overview.users : [];
    const totals = overview?.totals || {};
    const plans = totals.plans || {};
    const total = Number(totals.users || uArr.length);
    const pro = Number(plans.pro || 0);
    const emp = Number(plans.empresa || 0);
    const ingresos = Number(totals.estimatedMonthlyRevenue || 0);
    const totalMsgs = Number(totals.messages || 0);
  if (admEl) admEl.innerHTML = `
    <div class="adm-c"><div class="adm-c-l">Usuarios totales</div><div class="adm-c-v">${total}</div><div class="adm-c-s">registrados</div></div>
    <div class="adm-c"><div class="adm-c-l">Plan Pro</div><div class="adm-c-v">${pro}</div><div class="adm-c-s">suscriptores</div></div>
    <div class="adm-c"><div class="adm-c-l">Plan Empresa</div><div class="adm-c-v">${emp}</div><div class="adm-c-s">suscriptores</div></div>
    <div class="adm-c"><div class="adm-c-l">Ingresos est./mes</div><div class="adm-c-v" style="font-size:15px">S/${ingresos.toLocaleString()}</div><div class="adm-c-s">planes activos</div></div>
    <div class="adm-c"><div class="adm-c-l">Total consultas</div><div class="adm-c-v">${totalMsgs}</div><div class="adm-c-s">realizadas</div></div>
    <div class="adm-c"><div class="adm-c-l">Sugerencias</div><div class="adm-c-v" style="color:var(--gold)">${getAllSugs().length}</div><div class="adm-c-s">recibidas</div></div>`;
    const topics = Array.isArray(overview?.topics) ? overview.topics : [];
    const topicTotal = topics.reduce((sum, topic) => sum + Number(topic.count || 0), 0) || 1;
    if (topicsEl) topicsEl.innerHTML = topics.length
      ? topics.map(topic => { const pct = Math.round(Number(topic.count || 0) * 100 / topicTotal); return `<div class="topic-row"><span class="topic-nm">${_escapeHtml(topic.name||'General')}</span><div class="topic-track"><div class="topic-bar" style="width:${pct}%"></div></div><span class="topic-pct">${pct}%</span></div>`; }).join('')
      : '<div class="hempty">TodavÃ­a no hay conversaciones suficientes para calcular temas.</div>';
    if (tbody) tbody.innerHTML = uArr.map(u => `<tr><td>${_escapeHtml(u.name||'')}</td><td style="color:var(--muted);font-size:14px">${_escapeHtml(u.email||'')}</td><td><span class="pp ${_escapeHtml(u.plan||'')}">${_escapeHtml(u.plan||'')}</span></td><td>${Number(u.mc||0)}</td><td style="color:var(--muted)">${_escapeHtml(u.since||'â€”')}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">No hay usuarios aÃºn</td></tr>';
  } catch (error) {
    if (admEl) admEl.innerHTML = `<div class="hempty" style="color:var(--red)">${_escapeHtml(error.message)}</div>`;
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">No se pudo cargar la lista.</td></tr>';
    if (topicsEl) topicsEl.innerHTML = '<div class="hempty">No se pudieron cargar los temas.</div>';
  }
  // Sugerencias section in admin
  let admSugSection = document.getElementById('adminSugSection');
  if (!admSugSection) {
    admSugSection = document.createElement('div');
    admSugSection.id = 'adminSugSection';
    admSugSection.style.marginTop = '24px';
    admSugSection.innerHTML = `<div class="sec-title" style="margin-bottom:12px">ğŸ’¡ GestiÃ³n de sugerencias</div><div id="adminSugWrap"></div>`;
    document.getElementById('ptAdmin')?.appendChild(admSugSection);
  }
  renderAdminSugs();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PATCH setPTab
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _origSetPTabV9 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV9(tab, btn);
  if (tab === 'sugerencias') initSugerencias();
  if (tab === 'admin') renderAdmin();
}

// Auto-notify users when their suggestion status changes
// (checked on panel load)
function checkSugNotifications() {
  if (!curUser) return;
  const all = getAllSugs().filter(s => s.userId === curUser.email);
  const lastCheck = parseInt(localStorage.getItem('tp_sug_check_' + btoa(curUser.email)) || '0');
  all.forEach(s => {
    if (s.fechaMs > lastCheck) return; // new ones already notified
    if (s.estado === 'implementado' && s.fechaMs > lastCheck) {
      addNotif('ğŸ‰', 'Â¡Sugerencia implementada!', '"' + s.titulo.substring(0,40) + '" ya estÃ¡ en DeclaraFY.');
    }
  });
  localStorage.setItem('tp_sug_check_' + btoa(curUser.email), Date.now());
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CASOS TRIBUTARIOS PARTICULARES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ State â”€â”€
let cwStep = 0;
let cwFiles = [];
let cwFilesContent = [];
let activeCasoId = null;
let multiFiles = [];
let multiFilesContent = [];
let casoFilterActive = 'todos';

const CW_STEPS = 4;
const TIPO_LABELS = {
  fiscalizacion:'FiscalizaciÃ³n SUNAT', planificacion:'PlanificaciÃ³n tributaria',
  recurso:'Recurso reclamaciÃ³n/apelaciÃ³n', contrato:'AnÃ¡lisis de contrato',
  reorganizacion:'ReorganizaciÃ³n societaria', pt:'Precios de transferencia',
  aduanas:'Caso aduanero', otro:'Otro'
};
const URGENCIA_COLORS = { normal:'var(--muted)', urgente:'var(--gold)', critico:'var(--red)' };

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// WIZARD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function openCasoWizard() {
  cwStep = 0; cwFiles = []; cwFilesContent = [];
  document.getElementById('casoWizard').classList.remove('hidden');
  renderCWStep(0);
  // Reset fields
  ['cwNombre','cwPeriodo','cwEmpresa','cwRuc','cwIngresos','cwHechos','cwObjetivo','cwMonto'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('cwFileList').innerHTML = '';
  document.getElementById('cwError').style.display = 'none';
  // Drag/drop
  const zone = document.getElementById('cwDropZone');
  if (zone) {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); handleCWFiles({files: e.dataTransfer.files}); });
  }
}
function closeCasoWizard() { document.getElementById('casoWizard').classList.add('hidden'); }

function renderCWStep(step) {
  [0,1,2,3].forEach(i => {
    const panel = document.getElementById('cwPanel' + i);
    if (panel) panel.style.display = i === step ? 'block' : 'none';
    const stepEl = document.getElementById('cwStep' + i);
    if (stepEl) { stepEl.className = 'caso-wiz-step' + (i < step ? ' done' : i === step ? ' active' : ''); }
  });
  const back = document.getElementById('cwBtnBack');
  const next = document.getElementById('cwBtnNext');
  if (back) back.style.display = step > 0 ? 'block' : 'none';
  if (next) next.textContent = step === CW_STEPS - 1 ? 'âœ¨ Iniciar anÃ¡lisis' : 'Siguiente â†’';
}

function cwGoStep(dir) {
  const errEl = document.getElementById('cwError');
  errEl.style.display = 'none';
  // Validate current step before proceeding
  if (dir > 0) {
    if (cwStep === 0) {
      const nombre = document.getElementById('cwNombre')?.value?.trim();
      if (!nombre || nombre.length < 3) { errEl.textContent = 'Ingresa un nombre para el caso.'; errEl.style.display = 'block'; return; }
    }
    if (cwStep === 2) {
      const hechos = document.getElementById('cwHechos')?.value?.trim();
      const objetivo = document.getElementById('cwObjetivo')?.value?.trim();
      if (!hechos || hechos.length < 20) { errEl.textContent = 'Describe los hechos del caso (mÃ­nimo 20 caracteres).'; errEl.style.display = 'block'; return; }
      if (!objetivo || objetivo.length < 10) { errEl.textContent = 'Indica el objetivo o consulta del anÃ¡lisis.'; errEl.style.display = 'block'; return; }
    }
    if (cwStep === CW_STEPS - 1) { startCasoAnalysis(); return; }
  }
  cwStep = Math.max(0, Math.min(CW_STEPS - 1, cwStep + dir));
  renderCWStep(cwStep);
}

function handleCWFiles(input) {
  const files = input.files || input;
  Array.from(files).forEach(f => {
    if (!cwFiles.find(x => x.name === f.name) && cwFiles.length < 5) cwFiles.push(f);
  });
  renderCWFileList();
}

function renderCWFileList() {
  const el = document.getElementById('cwFileList'); if (!el) return;
  const total = document.getElementById('cwFileTotal');
  if (!cwFiles.length) { el.innerHTML = ''; if(total) total.style.display='none'; return; }
  const totalSize = cwFiles.reduce((s,f) => s+f.size, 0);
  el.innerHTML = cwFiles.map((f,i) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const icon = ext === 'pdf' ? 'ğŸ“•' : ['xlsx','xls','csv'].includes(ext) ? 'ğŸ“Š' : ['doc','docx'].includes(ext) ? 'ğŸ“„' : 'ğŸ“';
    return `<div class="multi-file-item"><span class="multi-file-item-icon">${icon}</span><div class="multi-file-item-info"><div class="multi-file-item-name">${f.name}</div><div class="multi-file-item-size">${(f.size/1024).toFixed(1)} KB</div></div><button class="multi-file-del" onclick="removeCWFile(${i})">Ã—</button></div>`;
  }).join('');
  if (total) { total.style.display = 'block'; total.textContent = `${cwFiles.length} archivo(s) Â· ${(totalSize/1024).toFixed(1)} KB total`; }
}

function removeCWFile(i) { cwFiles.splice(i, 1); renderCWFileList(); }

// â”€â”€ Start caso analysis â”€â”€
async function startCasoAnalysis() {
  closeCasoWizard();
  const casoData = {
    id: 'CASO-' + Date.now(),
    nombre: document.getElementById('cwNombre')?.value?.trim() || 'Caso tributario',
    tipo: document.getElementById('cwTipo')?.value || 'otro',
    urgencia: document.getElementById('cwUrgencia')?.value || 'normal',
    periodo: document.getElementById('cwPeriodo')?.value?.trim() || '',
    empresa: document.getElementById('cwEmpresa')?.value?.trim() || '',
    ruc: document.getElementById('cwRuc')?.value?.trim() || '',
    regimen: document.getElementById('cwRegimen')?.value || 'RG',
    sector: document.getElementById('cwSector')?.value || 'servicios',
    ingresos: document.getElementById('cwIngresos')?.value || '',
    hechos: document.getElementById('cwHechos')?.value?.trim() || '',
    objetivo: document.getElementById('cwObjetivo')?.value?.trim() || '',
    monto: document.getElementById('cwMonto')?.value || '',
    fecha: new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'short',year:'numeric'}),
    fechaMs: Date.now(),
    archivos: cwFiles.map(f => f.name),
    mensajes: 0,
  };
  // Save caso
  const casos = getCasos();
  casos.unshift(casoData);
  saveCasos(casos);
  activeCasoId = casoData.id;
  // Open chat in caso mode
  convHist = []; convId = null;
  goToChat();
  // Show caso mode UI
  setTimeout(async () => {
    showCasoMode(casoData);
    // Read files
    let fileContext = '';
    if (cwFiles.length > 0) {
      showPDFProgress(true);
      const contents = await readMultipleFiles(cwFiles, (i, total) => updatePDFProgress(i, total, cwFiles[i-1]?.name || ''));
      fileContext = contents.map((c,i) => `\n\n[DOCUMENTO ${i+1}: ${cwFiles[i].name}]\n${c.substring(0,4000)}`).join('');
      showPDFProgress(false);
    }
    // Build comprehensive prompt
    const prompt = buildCasoPrompt(casoData, fileContext);
    convHist = [];
    await sendMsg(prompt);
  }, 400);
}

function buildCasoPrompt(caso, fileContext) {
  return `CASO TRIBUTARIO PARA ANÃLISIS FORMAL
â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
Caso: ${caso.nombre}
Tipo: ${TIPO_LABELS[caso.tipo]||caso.tipo}
Urgencia: ${caso.urgencia.toUpperCase()}
PerÃ­odo: ${caso.periodo||'No especificado'}

CONTRIBUYENTE:
â€¢ Empresa: ${caso.empresa||'No especificado'}
â€¢ RUC: ${caso.ruc||'No especificado'}
â€¢ RÃ©gimen: ${caso.regimen}
â€¢ Sector: ${caso.sector}
â€¢ Ingresos anuales aprox: S/${parseInt(caso.ingresos||0).toLocaleString()}
${caso.monto ? `â€¢ Monto en disputa: S/${parseInt(caso.monto).toLocaleString()}` : ''}

HECHOS DEL CASO:
${caso.hechos}

OBJETIVO DEL ANÃLISIS:
${caso.objetivo}
${fileContext ? '\n\nDOCUMENTOS ADJUNTOS PARA ANÃLISIS:' + fileContext : ''}

â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
Por favor realiza un anÃ¡lisis tributario formal y completo considerando:
1. AnÃ¡lisis legal del caso con base en la normativa peruana vigente
2. IdentificaciÃ³n de riesgos y contingencias tributarias
3. Argumentos a favor del contribuyente (si aplica)
4. Recomendaciones concretas y prÃ³ximos pasos
5. Base legal citada (artÃ­culos y normas especÃ­ficas)
${fileContext ? '6. AnÃ¡lisis cruzado de los documentos adjuntos' : ''}

Responde de forma estructurada, profesional y detallada.`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CASO MODE IN CHAT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function showCasoMode(casoData) {
  const bar = document.getElementById('casoHeaderBar');
  const name = document.getElementById('casoHeaderName');
  const mfPanel = document.getElementById('multiFilePanel');
  if (bar) bar.style.display = 'flex';
  if (name) name.textContent = casoData.nombre + ' Â· ' + (TIPO_LABELS[casoData.tipo]||casoData.tipo);
  if (mfPanel) mfPanel.style.display = 'block';
  activeCasoId = casoData.id;
}

function closeCasoMode() {
  const bar = document.getElementById('casoHeaderBar');
  const mfPanel = document.getElementById('multiFilePanel');
  if (bar) bar.style.display = 'none';
  if (mfPanel) mfPanel.style.display = 'none';
  activeCasoId = null;
  multiFiles = []; multiFilesContent = [];
  document.getElementById('multiFileList').innerHTML = '';
  document.getElementById('multiFileSummary').style.display = 'none';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MULTI-FILE READING (PDF + others)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function handleMultiFiles(input) {
  const files = Array.from(input.files || []);
  files.forEach(f => { if (!multiFiles.find(x => x.name === f.name) && multiFiles.length < 8) multiFiles.push(f); });
  renderMultiFileList();
  input.value = '';
}

function removeMultiFile(i) {
  multiFiles.splice(i, 1);
  multiFilesContent.splice(i, 1);
  renderMultiFileList();
}

function renderMultiFileList() {
  const el = document.getElementById('multiFileList'); if (!el) return;
  const sumEl = document.getElementById('multiFileSummary');
  if (!multiFiles.length) { el.innerHTML = ''; if(sumEl) sumEl.style.display='none'; return; }
  el.innerHTML = multiFiles.map((f,i) => {
    const ext = f.name.split('.').pop().toLowerCase();
    const icon = ext === 'pdf' ? 'ğŸ“•' : ['xlsx','xls','csv'].includes(ext) ? 'ğŸ“Š' : ['doc','docx'].includes(ext) ? 'ğŸ“„' : 'ğŸ“';
    return `<div class="multi-file-item"><span class="multi-file-item-icon">${icon}</span><div class="multi-file-item-info"><div class="multi-file-item-name">${f.name}</div><div class="multi-file-item-size">${(f.size/1024).toFixed(1)} KB</div></div><span class="multi-file-item-status ok">Listo</span><button class="multi-file-del" onclick="removeMultiFile(${i})">Ã—</button></div>`;
  }).join('');
  if (sumEl) { sumEl.style.display = 'block'; document.getElementById('multiFileSummaryText').textContent = `${multiFiles.length} archivo(s) cargados`; }
}

function showPDFProgress(show) {
  const el = document.getElementById('pdfProgress');
  if (el) el.style.display = show ? 'block' : 'none';
}
function updatePDFProgress(current, total, filename) {
  const fill = document.getElementById('pdfProgressFill');
  const text = document.getElementById('pdfProgressText');
  if (fill) fill.style.width = ((current/total)*100) + '%';
  if (text) text.textContent = `Leyendo ${filename} (${current}/${total})...`;
}

// â”€â”€ Real file reading with PDF.js â”€â”€
async function readMultipleFiles(files, onProgress) {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (onProgress) onProgress(i+1, files.length, f.name);
    const ext = f.name.split('.').pop().toLowerCase();
    let content = '';
    try {
      if (ext === 'pdf') {
        content = await readPDFFile(f);
      } else if (['txt','csv','xml'].includes(ext)) {
        content = await readTextFile(f);
      } else if (['xlsx','xls'].includes(ext)) {
        content = await readExcelFile(f);
      } else {
        content = await readTextFile(f).catch(() => `[Archivo binario: ${f.name} â€” ${(f.size/1024).toFixed(1)} KB]`);
      }
    } catch(e) {
      content = `[Error leyendo ${f.name}: ${e.message}]`;
    }
    results.push(content);
  }
  return results;
}

async function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result?.substring(0, 8000) || '');
    r.onerror = () => reject(new Error('Error de lectura'));
    r.readAsText(file, 'UTF-8');
  });
}

async function readExcelFile(file) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = e => {
      try {
        const data = new Uint8Array(e.target.result);
        // Simple CSV-like extraction without SheetJS
        const text = new TextDecoder('utf-8', {fatal:false}).decode(data);
        const clean = text.replace(/[^\x20-\x7E\n\t\xA0-\xFF]/g, ' ').substring(0, 6000);
        resolve(`[Excel: ${file.name}]\n${clean}`);
      } catch(ex) {
        resolve(`[Excel: ${file.name} â€” ${(file.size/1024).toFixed(1)} KB â€” no se pudo extraer texto]`);
      }
    };
    r.onerror = () => resolve(`[Excel: ${file.name} â€” error de lectura]`);
    r.readAsArrayBuffer(file);
  });
}

async function readPDFFile(file) {
  // Try to extract text from PDF using PDF.js if available, otherwise read raw
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = async (e) => {
      try {
        // Check if PDF.js is available
        if (typeof pdfjsLib !== 'undefined') {
          const pdf = await pdfjsLib.getDocument({data: new Uint8Array(e.target.result)}).promise;
          let text = '';
          const maxPages = Math.min(pdf.numPages, 15);
          for (let p = 1; p <= maxPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            text += content.items.map(i => i.str).join(' ') + '\n';
          }
          resolve(`[PDF: ${file.name} â€” ${pdf.numPages} pÃ¡ginas]\n${text.substring(0, 8000)}`);
        } else {
          // Fallback: try to extract readable text from raw bytes
          const bytes = new Uint8Array(e.target.result);
          const rawText = new TextDecoder('latin1').decode(bytes);
          // Extract strings between BT and ET (PDF text blocks)
          const textBlocks = [];
          const btMatches = rawText.matchAll(/BT\s*([\s\S]*?)\s*ET/g);
          for (const m of btMatches) {
            const strings = m[1].matchAll(/\(([^)]{1,200})\)/g);
            for (const s of strings) {
              const clean = s[1].replace(/\\n/g,' ').replace(/\\/g,'').trim();
              if (clean.length > 2) textBlocks.push(clean);
            }
          }
          if (textBlocks.length > 0) {
            resolve(`[PDF: ${file.name}]\n${textBlocks.join(' ').substring(0,8000)}`);
          } else {
            resolve(`[PDF: ${file.name} â€” ${(file.size/1024).toFixed(1)} KB â€” archivo escaneado o protegido, incluye el contenido relevante en texto]`);
          }
        }
      } catch(ex) {
        resolve(`[PDF: ${file.name} â€” error al leer: ${ex.message}]`);
      }
    };
    r.onerror = () => resolve(`[PDF: ${file.name} â€” error de lectura]`);
    r.readAsArrayBuffer(file);
  });
}

// Load PDF.js dynamically
(function loadPDFjs() {
  if (typeof pdfjsLib !== 'undefined') return;
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  script.onload = () => {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  };
  document.head.appendChild(script);
})();

// â”€â”€ Override sendMsg to include multi-files â”€â”€
const _origSendMsgCasos = _sendMsgLayer1;
async function _sendMsgLayer2(txt) {
  // If in caso mode and there are multi-files not yet sent, include them
  if (activeCasoId && multiFiles.length > 0 && !txt?.includes('[DOCUMENTO')) {
    const inp = document.getElementById('userInput');
    const msg = txt || inp?.value?.trim() || '';
    if (msg || multiFiles.length > 0) {
      showPDFProgress(true);
      const contents = await readMultipleFiles(multiFiles, (i,t,name) => updatePDFProgress(i,t,name));
      showPDFProgress(false);
      const fileCtx = contents.map((c,i) => `\n\n[DOCUMENTO: ${multiFiles[i].name}]\n${c.substring(0,4000)}`).join('');
      const fullMsg = (msg ? msg + '\n' : 'Analiza estos documentos en el contexto del caso:\n') + fileCtx;
      // Clear multi-files after sending
      multiFiles = []; multiFilesContent = [];
      renderMultiFileList();
      if (inp && !txt) { inp.value = ''; inp.style.height = 'auto'; }
      return _origSendMsgCasos(fullMsg);
    }
  }
  return _origSendMsgCasos(txt);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INFORME DE CONCLUSIONES PDF
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function generateCasoInforme() {
  if (!convHist.length) { tpToast('No hay conversaciÃ³n en este caso. Inicia el anÃ¡lisis primero.', 'warn'); return; }
  const casos = getCasos();
  const caso = casos.find(c => c.id === activeCasoId) || { nombre:'Caso tributario', empresa:'â€”', ruc:'â€”', regimen:'â€”' };
  // Build summary prompt
  const histSummary = convHist.slice(-10).map(m => `${m.role === 'user' ? 'CONSULTA' : 'ANÃLISIS IA'}: ${m.content.substring(0,500)}`).join('\n\n');
  const informePrompt = `BasÃ¡ndote en el siguiente anÃ¡lisis del caso "${caso.nombre}", genera un INFORME DE CONCLUSIONES FORMAL con esta estructura exacta:

1. RESUMEN EJECUTIVO (3-4 lÃ­neas)
2. IDENTIFICACIÃ“N DEL CASO (empresa, rÃ©gimen, perÃ­odo, tipo)
3. HECHOS RELEVANTES (puntos clave del caso)
4. ANÃLISIS LEGAL (normas aplicables con artÃ­culos exactos)
5. RIESGOS Y CONTINGENCIAS (ordenados por severidad: ALTO/MEDIO/BAJO)
6. RECOMENDACIONES (acciones concretas con plazos sugeridos)
7. CONCLUSIÃ“N FINAL

AnÃ¡lisis previo del caso:
${histSummary}

Empresa: ${caso.empresa} | RUC: ${caso.ruc} | RÃ©gimen: ${caso.regimen}
Fecha del informe: ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}

Genera el informe en espaÃ±ol formal, con base legal peruana precisa.`;

  addMsg('user', 'ğŸ“„ Generar informe formal de conclusiones del caso');
  showTyp();
  if (!apiKey) {
    remTyp();
    const demoInforme = generateDemoInforme(caso);
    addMsg('ai', demoInforme);
    setTimeout(() => exportCasoInforme(caso, demoInforme), 500);
    return;
  }
  try {
    const res = await callDeclaraFY({ model:'claude-sonnet-4-5', max_tokens:2000, system:'Eres un abogado tributarista peruano senior. Redactas informes formales de anÃ¡lisis de casos tributarios con base legal exacta y recomendaciones accionables.', messages:[{role:'user',content:informePrompt}] });
    const data = await res.json();
    const informe = data.content?.[0]?.text || 'Error generando informe.';
    convHist.push({role:'assistant', content:informe});
    remTyp();
    addMsg('ai', informe);
    setTimeout(() => exportCasoInforme(caso, informe), 800);
    addNotif('ğŸ“„','Informe generado','El informe de conclusiones fue generado y exportado a PDF.');
  } catch(e) {
    remTyp();
    addMsg('ai', '**Error generando informe:** ' + e.message);
  }
}

function generateDemoInforme(caso) {
  return `**INFORME DE CONCLUSIONES TRIBUTARIAS**\n\n**1. RESUMEN EJECUTIVO**\nEl presente informe analiza el caso "${caso.nombre}" correspondiente a ${caso.empresa||'el contribuyente'}. Se identificaron contingencias tributarias que requieren atenciÃ³n inmediata. Se recomienda adoptar las medidas correctivas descritas en las secciones siguientes.\n\n**2. IDENTIFICACIÃ“N DEL CASO**\nâ€¢ Empresa: ${caso.empresa||'â€”'} Â· RUC: ${caso.ruc||'â€”'}\nâ€¢ RÃ©gimen: ${caso.regimen||'â€”'} Â· PerÃ­odo: ${caso.periodo||'â€”'}\nâ€¢ Tipo: ${TIPO_LABELS[caso.tipo]||caso.tipo}\n\n**3. ANÃLISIS LEGAL**\nBase legal aplicable segÃºn normativa peruana vigente: TUO CÃ³digo Tributario (D.S.133-2013-EF), TUO LIR (D.S.179-2004-EF), TUO LIGV (D.S.055-99-EF).\n\n**4. RECOMENDACIONES**\n1. Revisar documentaciÃ³n sustentatoria de las operaciones observadas\n2. Preparar descargos con base legal dentro del plazo legal\n3. Evaluar acogimiento al rÃ©gimen de gradualidad de ser aplicable\n\n**5. CONCLUSIÃ“N**\nConecta tu API Key de Claude para generar un informe completo y personalizado basado en el anÃ¡lisis de tu caso especÃ­fico.\n\n*Informe generado por DeclaraFY â€” ${new Date().toLocaleDateString('es-PE')}*`;
}

function exportCasoInforme(caso, texto) {
  const win = window.open('','_blank');
  const html = _escapeHtml(texto).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Informe â€” ${_escapeHtml(caso.nombre)}</title>
<style>
  body{font-family:'Times New Roman',serif;max-width:720px;margin:40px auto;color:#1a1a2e;line-height:1.8;font-size:14px}
  .header{background:#1a1a2e;color:#C9A84C;padding:24px 28px;border-radius:6px;margin-bottom:28px}
  .header h1{font-size:18px;margin:0 0 4px;font-family:Georgia,serif}
  .header p{margin:0;font-size:14px;color:rgba(201,168,74,.75)}
  .meta{background:#f8f8f2;border:1px solid #ddd;border-radius:6px;padding:12px 16px;margin-bottom:24px;font-size:14px;color:#555}
  .meta span{display:inline-block;margin-right:20px}
  strong{color:#8B6914}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;font-size:14px;color:#999;text-align:center}
  @media print{body{margin:20px}.no-print{display:none}}
</style></head><body>
<div class="header"><h1>Informe de Conclusiones Tributarias</h1><p>DeclaraFY Â· IA Tributaria y Aduanera Â· PerÃº</p></div>
<div class="meta">
  <span><strong>Caso:</strong> ${caso.nombre}</span>
  <span><strong>Empresa:</strong> ${caso.empresa||'â€”'}</span>
  <span><strong>RUC:</strong> ${caso.ruc||'â€”'}</span>
  <span><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</span>
</div>
${html}
<div class="footer">Informe generado por Declarafy.com Â· Solo con fines orientativos Â· Validar con contador o abogado tributarista para decisiones formales</div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CASOS PANEL (list)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderCasos() {
  if (!curUser) return;
  const casos = getCasos();
  const el = document.getElementById('casosList'); if (!el) return;
  let filtered = casoFilterActive === 'todos' ? casos : casos.filter(c => c.tipo === casoFilterActive);
  if (!filtered.length) {
    el.innerHTML = `<div class="sug-empty">No tienes casos${casoFilterActive!=='todos'?' de este tipo':''} registrados.<br>Crea tu primer caso con el botÃ³n de arriba.</div>`;
    return;
  }
  const urgColors = { normal:'var(--muted)', urgente:'var(--gold)', critico:'var(--red)' };
  el.replaceChildren();
  filtered.forEach(c => {
    const tipo = _safeToken(c.tipo, Object.keys(TIPO_LABELS), 'otro');
    const urgencia = _safeToken(c.urgencia, ['normal','urgente','critico'], 'normal');
    const item = document.createElement('div');
    item.className = 'sug-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `
    <div class="sug-item-top">
      <div class="sug-priority-dot" style="background:${urgColors[urgencia]};margin-top:4px;flex-shrink:0"></div>
      <div class="sug-item-left">
        <div class="sug-item-title">${_escapeHtml(c.nombre||'Caso sin nombre')}</div>
        <div class="sug-item-desc">${_escapeHtml(c.empresa ? c.empresa + (c.ruc ? ' Â· RUC ' + c.ruc : '') : 'Sin empresa especificada')} Â· ${_escapeHtml(c.periodo||'PerÃ­odo no especificado')}</div>
        <div class="sug-item-meta" style="margin-top:6px">
          <span class="sug-badge nueva-funcion">${_escapeHtml(TIPO_LABELS[tipo]||tipo)}</span>
          <span class="sug-badge ${urgencia==='critico'?'bug':urgencia==='urgente'?'gold':'otro'}">${urgencia.toUpperCase()}</span>
          ${c.archivos?.length ? `<span style="font-size:14px;color:var(--muted)">ğŸ“ ${c.archivos.length} archivo(s)</span>` : ''}
          <span class="sug-item-date">ğŸ“… ${_escapeHtml(c.fecha||'')}</span>
        </div>
      </div>
    </div>
  `;
    item.addEventListener('click', () => loadCaso(String(c.id||'')));
    el.appendChild(item);
  });
}

function filterCasos(f, btn) {
  casoFilterActive = f;
  document.querySelectorAll('#casosFilterBar .sug-filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCasos();
}

function loadCaso(id) {
  const casos = getCasos();
  const caso = casos.find(c => c.id === id);
  if (!caso) return;
  activeCasoId = id;
  convHist = []; convId = null;
  goToChat();
  setTimeout(() => {
    showCasoMode(caso);
    addMsg('ai', `ğŸ“‚ **Caso cargado:** ${caso.nombre}\n\n**Empresa:** ${caso.empresa||'â€”'} Â· **RUC:** ${caso.ruc||'â€”'} Â· **RÃ©gimen:** ${caso.regimen}\n**Tipo:** ${TIPO_LABELS[caso.tipo]||caso.tipo} Â· **PerÃ­odo:** ${caso.periodo||'â€”'}\n\n**Hechos:** ${caso.hechos?.substring(0,200)||'â€”'}${caso.hechos?.length>200?'â€¦':''}\n\n**Objetivo:** ${caso.objetivo}\n\nÂ¿QuÃ© parte del caso quieres analizar? TambiÃ©n puedes adjuntar nuevos documentos usando el Ã¡rea de archivos arriba.`);
  }, 300);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PATCH setPTab
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const _origSetPTabV10 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV10(tab, btn);
  if (tab === 'casos') renderCasos();
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// NAMECHEAP API COMPATIBILITY INIT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let fbApp, fbAuth, fbDb;
let fbReady = false;

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') {
      throw new Error('El cliente del servidor no estÃ¡ disponible');
    }
    // Check if already initialized
    if (firebase.apps && firebase.apps.length > 0) {
      fbApp = firebase.apps[0];
    } else {
      fbApp = firebase.initializeApp({ backend: 'namecheap-php' });
    }
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    // Enable offline persistence
    fbDb.enablePersistence({synchronizeTabs:true}).catch(() => {});
    fbReady = true;
    console.log('âœ… Servidor DeclaraFY conectado');
    // Show online indicator
    const dots = document.querySelectorAll('.notif-dot, .onl');
    updateFBStatusUI(true);
  } catch(e) {
    console.warn('Error iniciando el servidor:', e.message);
    fbReady = false;
  }
}

function updateFBStatusUI(online) {
  // Update any status indicators
  const statusEl = document.getElementById('statusDot');
  if (statusEl) statusEl.textContent = online ? 'â˜ Sincronizado' : 'IA activa';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FIREBASE AUTH LAYER
// Replaces localStorage auth with Firebase Auth + Firestore
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Override doLogin
async function _doLoginFBFirebaseImpl() {
  const em = (document.getElementById('lEmail')?.value || document.getElementById('lE')?.value || '').trim().toLowerCase();
  const pw = document.getElementById('lPass')?.value || document.getElementById('lP')?.value || '';
  if (!em || !pw) { aerr('Completa todos los campos.'); return; }

  if (fbReady) {
    try {
      showAuthLoading(true);
      const cred = await fbAuth.signInWithEmailAndPassword(em, pw);
      // Load user data from Firestore
      const doc = await fbDb.collection('users').doc(cred.user.uid).get();
      if (doc.exists) {
        curUser = { ...doc.data(), uid: cred.user.uid, email: em };
      } else {
        curUser = { name: cred.user.displayName || em.split('@')[0], email: em, uid: cred.user.uid, plan: 'basico', mc: 0, since: new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'short',year:'numeric'}) };
        await fbDb.collection('users').doc(cred.user.uid).set(curUser);
      }
      localStorage.setItem('tp_s', JSON.stringify({e:em,t:Date.now()}));
      hideAuth();
      await kvLoadAll();
      goPanel();
      showAuthLoading(false);
    } catch(e) {
      showAuthLoading(false);
      const msgs = {
        'auth/user-not-found':'No existe una cuenta con ese correo.',
        'auth/wrong-password':'ContraseÃ±a incorrecta.',
        'auth/invalid-credential':'Correo o contraseÃ±a incorrectos.',
        'auth/invalid-email':'Correo invÃ¡lido.',
        'auth/too-many-requests':'Demasiados intentos. Espera unos minutos.',
        'auth/network-request-failed':'No se pudo conectar con el servidor. Revisa tu conexiÃ³n e intenta nuevamente.',
        'server/database-unavailable':'La base de datos no estÃ¡ disponible temporalmente.'
      };
      aerr(msgs[e.code] || e.message);
    }
  } else {
    aerr('El servicio de autenticaciÃ³n no estÃ¡ disponible. Intenta nuevamente mÃ¡s tarde.');
  }
}

// Override doRegister
async function doRegisterFB() {
  const nm = (document.getElementById('rName')?.value || document.getElementById('rN')?.value || '').trim();
  const em = (document.getElementById('rEmail')?.value || document.getElementById('rE')?.value || '').trim().toLowerCase();
  const pw = document.getElementById('rPass')?.value || document.getElementById('rP')?.value || '';
  const pw2 = document.getElementById('rPass2')?.value || document.getElementById('rP2')?.value || '';
  if (!nm || !em || !pw || !pw2) { aerr('Completa todos los campos.'); return; }
  if (!em.includes('@')) { aerr('Correo invÃ¡lido.'); return; }
  if (pw.length < 8) { aerr('ContraseÃ±a mÃ­nimo 8 caracteres.'); return; }
  if (pw !== pw2) { aerr('Las contraseÃ±as no coinciden.'); return; }

  if (fbReady) {
    try {
      showAuthLoading(true);
      const cred = await fbAuth.createUserWithEmailAndPassword(em, pw);
      await cred.user.updateProfile({ displayName: nm });
      const refCode = localStorage.getItem('tp_ref') || '';
      const userData = {
        name: nm, email: em, uid: cred.user.uid,
        plan: 'basico', mc: 0, since: new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'short',year:'numeric'}),
        refBy: refCode, onboarded: false, regimen: '', sector: '', ruc: ''
      };
      await fbDb.collection('users').doc(cred.user.uid).set(userData);
      if (refCode) localStorage.removeItem('tp_ref');
      curUser = userData;
      localStorage.setItem('tp_s', JSON.stringify({e:em,t:Date.now()}));
      showAuthLoading(false);
      aok('Â¡Cuenta creada! Ingresando...');
      const _CULQI_LINKS = { profesional: 'https://express.culqi.com/pago/053F161D3A', empresa: 'https://express.culqi.com/pago/593B4B3F8D' };
      const _paidLink = _CULQI_LINKS[window._overridePlan];
      if (_paidLink) window.open(_paidLink, '_blank');
      setTimeout(() => { hideAuth(); goPanel(); if (!curUser.onboarded) setTimeout(() => showOnboarding(), 600); }, 900);
    } catch(e) {
      showAuthLoading(false);
      const msgs = {
        'auth/email-already-in-use':'Ya existe una cuenta con ese correo.',
        'auth/weak-password':'ContraseÃ±a muy dÃ©bil.',
        'auth/invalid-email':'Correo invÃ¡lido.',
        'auth/network-request-failed':'No se pudo conectar con el servidor. Revisa tu conexiÃ³n e intenta nuevamente.',
        'server/database-unavailable':'La base de datos no estÃ¡ disponible temporalmente.'
      };
      aerr(msgs[e.code] || e.message);
    }
  } else {
    aerr('El servicio de autenticaciÃ³n no estÃ¡ disponible. No se creÃ³ ninguna cuenta local.');
  }
}

// Override doRecover (password reset via Firebase)
async function doRecoverFB() {
  const em = document.getElementById('recE')?.value?.trim().toLowerCase() || '';
  if (!em) { aerr('Ingresa tu correo.'); return; }
  if (fbReady) {
    try {
      await fbAuth.sendPasswordResetEmail(em);
      aok('âœ… Correo de recuperaciÃ³n enviado a ' + em + '. Revisa tu bandeja de entrada.');
    } catch(e) {
      const msgs = { 'auth/user-not-found':'No existe una cuenta con ese correo.', 'auth/invalid-email':'Correo invÃ¡lido.' };
      aerr(msgs[e.code] || e.message);
    }
  } else {
    aerr('El servicio de recuperaciÃ³n no estÃ¡ disponible. Intenta nuevamente mÃ¡s tarde.');
  }
}

// Override doLogout
async function doLogout() {
  if (fbReady) { try { await fbAuth.signOut(); } catch(e) {} }
  curUser = null; localStorage.removeItem('tp_s'); showScreen('screen-landing');
}

function showAuthLoading(show) {
  const btns = document.querySelectorAll('.btn-p, .bp');
  btns.forEach(b => { if(show) b.setAttribute('disabled','1'); else b.removeAttribute('disabled'); });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FIRESTORE DATA LAYER
// Replaces localStorage for user data, history, sugerencias, casos
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ User profile â”€â”€
async function saveProfile() {
  const name = document.getElementById('pName')?.value?.trim() || '';
  if (!name) { showProfMsg('err','El nombre no puede estar vacÃ­o.'); return; }
  const updates = {
    name,
    ruc: document.getElementById('pRuc')?.value?.trim() || '',
    regimen: document.getElementById('pRegimen')?.value || '',
    sector: document.getElementById('pSector')?.value || ''
  };
  if (fbReady && curUser?.uid) {
    try {
      await fbDb.collection('users').doc(curUser.uid).update(updates);
      Object.assign(curUser, updates);
      document.getElementById('panGreet').textContent = name.split(' ')[0];
      document.getElementById('profAv').textContent = name.charAt(0).toUpperCase();
      document.getElementById('profName').textContent = name;
      showProfMsg('ok','âœ… Perfil guardado en la nube.');
      addNotif('â˜ï¸','Perfil sincronizado','Tu perfil fue guardado en el servidor.');
    } catch(e) { showProfMsg('err','Error: ' + e.message); }
  } else {
    showProfMsg('err','El servicio de perfiles no estÃ¡ disponible. Intenta nuevamente mÃ¡s tarde.');
  }
}

async function changePassword() {
  const old = document.getElementById('pwOld')?.value || '';
  const nw = document.getElementById('pwNew')?.value || '';
  const nw2 = document.getElementById('pwNew2')?.value || '';
  if (!old || !nw || !nw2) { showProfMsg('err','Completa todos los campos.'); return; }
  if (nw.length < 8) { showProfMsg('err','MÃ­nimo 8 caracteres.'); return; }
  if (nw !== nw2) { showProfMsg('err','Las contraseÃ±as no coinciden.'); return; }
  if (fbReady && fbAuth.currentUser) {
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(curUser.email, old);
      await fbAuth.currentUser.reauthenticateWithCredential(cred);
      await fbAuth.currentUser.updatePassword(nw);
      ['pwOld','pwNew','pwNew2'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
      showProfMsg('ok','âœ… ContraseÃ±a actualizada.');
    } catch(e) {
      const msgs = { 'auth/wrong-password':'ContraseÃ±a actual incorrecta.', 'auth/weak-password':'ContraseÃ±a muy dÃ©bil.' };
      showProfMsg('err', msgs[e.code] || e.message);
    }
  } else {
    showProfMsg('err','El servicio de autenticaciÃ³n no estÃ¡ disponible.');
  }
}

// â”€â”€ Chat history (Firestore loaders) â”€â”€
async function loadHistFromFirestore() {
  if (!fbReady || !curUser?.uid) return;
  try {
    const doc = await fbDb.collection('historial').doc(curUser.uid).get();
    if (doc.exists && doc.data().data) {
      const arr = doc.data().data;
      localStorage.setItem('tp_h_' + btoa(curUser.email), JSON.stringify(arr));
      renderHist();
      document.getElementById('pcConvs').textContent = arr.length;
    }
  } catch(e) { console.warn('Load hist error:', e.message); }
}

// â”€â”€ Sugerencias (Firestore loader) â”€â”€
async function loadSugsFromFirestore() {
  if (!fbReady) return;
  try {
    const snap = await fbDb.collection('sugerencias').orderBy('fechaMs','desc').limit(100).get();
    const arr = snap.docs.map(d => d.data());
    localStorage.setItem('tp_sugs', JSON.stringify(arr));
    renderMisSug(); renderTodasSug();
  } catch(e) { console.warn('Load sugs error:', e.message); }
}

// â”€â”€ Casos (Firestore) â”€â”€
function getCasos() {
  try { return JSON.parse(localStorage.getItem('tp_casos_' + btoa(curUser?.email||'')) || '[]'); } catch { return []; }
}
function saveCasos(arr) {
  localStorage.setItem('tp_casos_' + btoa(curUser?.email||''), JSON.stringify(arr));
  if (fbReady && curUser?.uid) {
    fbDb.collection('casos').doc(curUser.uid).set({ data: arr, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(e => console.warn('Casos sync error:', e.message));
  }
}
async function loadCasosFromFirestore() {
  if (!fbReady || !curUser?.uid) return;
  try {
    const doc = await fbDb.collection('casos').doc(curUser.uid).get();
    if (doc.exists && doc.data().data) {
      const arr = doc.data().data;
      localStorage.setItem('tp_casos_' + btoa(curUser.email), JSON.stringify(arr));
    }
  } catch(e) { console.warn('Load casos error:', e.message); }
}

// â”€â”€ Increment message count â”€â”€
async function incrementMsgCount() {
  if (!curUser) return;
  curUser.mc = (curUser.mc || 0) + 1;
  if (fbReady && curUser.uid) {
    fbDb.collection('users').doc(curUser.uid).update({ mc: firebase.firestore.FieldValue.increment(1) })
      .catch(e => console.warn('mc update error:', e.message));
  } else {
    console.warn('El contador no se guardÃ³ porque el servidor no estÃ¡ disponible.');
  }
}

// â”€â”€ Update plan (when Culqi webhook confirms payment) â”€â”€
// NOTA: el plan NO se actualiza desde el cliente. Solo vÃ­a Cloud Functions
// o el workflow n8n (Admin SDK), que ignora las reglas de Firestore.
// (La antigua updateUserPlan se eliminÃ³: las reglas bloquean cambios de
// 'plan' desde el cliente en firestore.rules.)

// â”€â”€ Firebase status badge â”€â”€
function renderFBStatus() {
  const existing = document.getElementById('fbStatusBadge');
  if (existing) existing.remove();
  const badge = document.createElement('div');
  badge.id = 'fbStatusBadge';
  badge.style.cssText = 'position:fixed;bottom:52px;right:16px;font-size:14px;padding:3px 9px;border-radius:8px;z-index:50;pointer-events:none;' + (fbReady ? 'background:rgba(76,175,80,.15);border:1px solid rgba(76,175,80,.25);color:#4CAF50' : 'background:rgba(144,144,168,.1);border:1px solid rgba(144,144,168,.18);color:#9090A8');
  badge.textContent = fbReady ? 'â˜ Servidor conectado' : 'âš  Servidor sin conexiÃ³n';
  document.body.appendChild(badge);
}

// â”€â”€ Patch sendMsg to use incrementMsgCount â”€â”€
const _origSendMsgFB = _sendMsgLayer2;
async function sendMsg(txt) {
  const result = await _origSendMsgFB(txt);
  // El backend ya consumiÃ³ la cuota atÃ³micamente; aquÃ­ solo refrescamos el perfil.
  if (curUser && fbReady) {
    declarafyApi('profile_get', { method: 'GET' }).then(data => {
      if (data?.user) {
        curUser = {...curUser, ...data.user};
        curPlan = curUser.plan || curPlan;
        loadPanel();
      }
    }).catch(error => console.warn('No se pudo refrescar la cuota:', error.message));
  }
  return result;
}

function loadPanel() {
  if (!curUser) return;
  const pn = {basico:'BÃ¡sico',pro:'Profesional',empresa:'Empresa'};
  const el = (id) => document.getElementById(id);
  const admin = isAdminUser();
  if (el('adminTab')) el('adminTab').style.display = admin ? '' : 'none';
  if (el('pcPlan')) el('pcPlan').textContent = admin ? 'Superadministrador' : (pn[curUser.plan] || 'BÃ¡sico');
  if (el('pcPlanD')) el('pcPlanD').textContent = admin ? 'Acceso total Â· sin cuota comercial' : (curUser.plan === 'basico' ? `${FREE} consultas al mes` : 'Consultas ilimitadas');
  if (el('pcTag')) el('pcTag').textContent = admin ? 'Administrador' : 'Activo';
  if (el('pcCount')) el('pcCount').textContent = curUser.mc || 0;
  if (el('pcConvs')) el('pcConvs').textContent = getHist(curUser.email).length;
  if (el('pcSince')) el('pcSince').textContent = curUser.since || 'â€”';
  if (el('chatPlanLbl')) el('chatPlanLbl').textContent = admin ? 'Superadministrador' : ('Plan ' + (pn[curUser.plan] || 'BÃ¡sico'));
  updateQuotaBars();
  renderHist();
  // Async load from Firestore in background
  if (fbReady && curUser?.uid) {
    loadHistFromFirestore();
    loadCasosFromFirestore();
    if (isAdminUser() || curUser.plan !== 'basico') loadSugsFromFirestore();
    // Refresh user data from Firestore
    fbDb.collection('users').doc(curUser.uid).get().then(doc => {
      if (doc.exists) {
        const fresh = doc.data();
        Object.assign(curUser, fresh);
        if (el('pcPlan')) el('pcPlan').textContent = isAdminUser() ? 'Superadministrador' : (pn[fresh.plan]||'BÃ¡sico');
        if (el('pcCount')) el('pcCount').textContent = fresh.mc||0;
        updateQuotaBars();
      }
    }).catch(e => console.warn('Refresh user error:', e.message));
  }
  // Auto-arrancar tour para usuarios que completaron onboarding pero aÃºn no hicieron el tour
  if (curUser && curUser.onboarded && !curUser.tourDone) {
    setTimeout(() => maybeStartTour(), 1200);
  }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” TRIBUNAL FISCAL (RTFs)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const RTF_DATA = [
  {id:'rtf1',cat:'igv',obs:true,num:'RTF 01580-5-2009',titulo:'Fehaciencia de operaciones â€” crÃ©dito fiscal IGV',desc:'El Tribunal Fiscal establece que para sustentar el crÃ©dito fiscal no basta la factura; debe acreditarse la fehaciencia de la operaciÃ³n (existencia real del bien o servicio).',badge:'gold',
   detalle:`<h4>RTF 01580-5-2009 â€” Observancia obligatoria â­</h4><div class="reg-detail-art">Criterio: Para mantener el crÃ©dito fiscal, el contribuyente debe probar que la operaciÃ³n es real y fehaciente, no solo presentar la factura.</div><div class="reg-detail-art">Medios de prueba aceptados: contratos, Ã³rdenes de compra, guÃ­as de remisiÃ³n, correos, comprobantes de pago con medio de pago vÃ¡lido, registros contables.</div><strong>Implicancia prÃ¡ctica:</strong> SUNAT puede desconocer el crÃ©dito fiscal aunque la factura sea electrÃ³nica si no existe evidencia de la operaciÃ³n. Conservar toda la documentaciÃ³n respaldatoria.`},
  {id:'rtf2',cat:'ir',obs:true,num:'RTF 05732-1-2005',titulo:'Principio de causalidad â€” gastos deducibles IR',desc:'Define el principio de causalidad: los gastos deben ser necesarios para producir y/o mantener la fuente generadora de renta. AmplÃ­a el criterio mÃ¡s allÃ¡ del "imprescindibilidad".',badge:'gold',
   detalle:`<h4>RTF 05732-1-2005 â€” Observancia obligatoria â­</h4><div class="reg-detail-art">Criterio: El principio de causalidad debe interpretarse en forma amplia, considerando criterios de razonabilidad y proporcionalidad con los ingresos del negocio.</div><div class="reg-detail-art">No es necesario que el gasto sea "imprescindible" sino que sea "conveniente" para el negocio.</div><strong>Ejemplo:</strong> Gastos de capacitaciÃ³n, atenciÃ³n a clientes, eventos corporativos y RSE pueden ser deducibles si existe vinculaciÃ³n con el negocio.`},
  {id:'rtf3',cat:'procedimiento',obs:false,num:'RTF 04638-1-2005',titulo:'Nulidad de requerimiento por falta de motivaciÃ³n',desc:'Un requerimiento de SUNAT sin motivaciÃ³n suficiente o que no precisa los puntos a verificar es nulo. El contribuyente puede oponerse.',badge:'red',
   detalle:`<h4>RTF 04638-1-2005</h4><div class="reg-detail-art">Criterio: Los requerimientos de fiscalizaciÃ³n deben seÃ±alar de forma precisa y suficiente los puntos a examinar. La imprecisiÃ³n genera nulidad del acto.</div><strong>Consecuencia:</strong> Si SUNAT emite un requerimiento genÃ©rico como "alcance toda la documentaciÃ³n contable" sin mayor precisiÃ³n, puede impugnarse. Esto invalida las observaciones derivadas del requerimiento nulo.`},
  {id:'rtf4',cat:'igv',obs:false,num:'RTF 03942-5-2010',titulo:'BancarizaciÃ³n â€” consecuencia en el crÃ©dito fiscal',desc:'Si el pago de una operaciÃ³n no se realizÃ³ por medio de pago del sistema financiero (Ley 28194), el crÃ©dito fiscal y el gasto son desconocidos aunque la operaciÃ³n sea real.',badge:'red',
   detalle:`<h4>RTF 03942-5-2010</h4><div class="reg-detail-art">Criterio: El incumplimiento de la obligaciÃ³n de bancarizaciÃ³n (pagos â‰¥ S/2,000 por medios del SF) tiene como consecuencia la pÃ©rdida del crÃ©dito fiscal y la no deducibilidad del gasto.</div><strong>La realidad de la operaciÃ³n no subsana el incumplimiento formal.</strong> La bancarizaciÃ³n es un requisito sustancial, no meramente formal.`},
  {id:'rtf5',cat:'pt',obs:true,num:'RTF 02254-5-2014',titulo:'Precios de transferencia â€” comparabilidad de transacciones',desc:'Establece criterios para determinar la comparabilidad entre transacciones controladas y no controladas en el anÃ¡lisis de precios de transferencia.',badge:'gold',
   detalle:`<h4>RTF 02254-5-2014 â€” Precios de Transferencia</h4><div class="reg-detail-art">Criterio: Los ajustes de comparabilidad deben hacerse cuando existen diferencias relevantes entre las transacciones comparadas que afecten el precio o el margen.</div><div class="reg-detail-art">Los comparables internos tienen preferencia sobre los externos cuando estÃ¡n disponibles.</div><strong>Implicancia:</strong> Las empresas con operaciones vinculadas deben documentar adecuadamente la metodologÃ­a de PT y los comparables utilizados.`},
  {id:'rtf6',cat:'procedimiento',obs:false,num:'RTF 01014-1-2008',titulo:'PrescripciÃ³n â€” interrupciÃ³n por reconocimiento de deuda',desc:'El plazo de prescripciÃ³n tributaria se interrumpe cuando el deudor tributario reconoce la deuda, ya sea expresa o tÃ¡citamente.',badge:'blue',
   detalle:`<h4>RTF 01014-1-2008 â€” PrescripciÃ³n</h4><div class="reg-detail-art">Criterio: El reconocimiento expreso o tÃ¡cito de la deuda (como solicitar fraccionamiento) interrumpe el cÃ³mputo del plazo prescriptorio de 4 aÃ±os (tributo declarado) o 6 aÃ±os (no declarado).</div><strong>Consecuencia prÃ¡ctica:</strong> Antes de solicitar fraccionamiento o reconocer una deuda, evaluar si el perÃ­odo ya prescribiÃ³. Un reconocimiento reinicia el plazo desde cero.`},
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” SUNAT INFORMES VINCULANTES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const SUNAT_INF_DATA = [
  {id:'si1',cat:'igv',num:'Informe 026-2003-SUNAT/2B0000',titulo:'IGV en servicios prestados parcialmente en el paÃ­s',desc:'Establece cuÃ¡ndo un servicio prestado por un no domiciliado estÃ¡ gravado con IGV en PerÃº segÃºn la regla del lugar de utilizaciÃ³n econÃ³mica.',badge:'gold',
   detalle:`<h4>Informe 026-2003 â€” IGV servicios no domiciliados</h4><div class="reg-detail-art">Criterio: Los servicios de no domiciliados estÃ¡n gravados con IGV si son utilizados en el PerÃº, independientemente de dÃ³nde se ejecuten fÃ­sicamente.</div><strong>ObligaciÃ³n:</strong> El usuario domiciliado es el responsable del pago del IGV como contribuyente (no como agente de retenciÃ³n). Declara el IGV como dÃ©bito y lo toma como crÃ©dito fiscal simultÃ¡neamente.`},
  {id:'si2',cat:'ir',num:'Informe 045-2023-SUNAT/7T0000',titulo:'TributaciÃ³n de criptomonedas en el IR',desc:'La SUNAT establece su criterio sobre el tratamiento tributario de las ganancias obtenidas por la compraventa de criptomonedas.',badge:'gold',
   detalle:`<h4>Informe 045-2023 â€” Criptomonedas e IR</h4><div class="reg-detail-art">Criterio SUNAT: Las ganancias por venta de criptomonedas califican como renta de 2da categorÃ­a para personas naturales (tasa efectiva 5%), o renta de 3ra categorÃ­a si es actividad habitual/empresarial.</div><div class="reg-detail-art">Las criptomonedas no se consideran moneda extranjera para efectos de la diferencia de cambio.</div><strong>ObligaciÃ³n:</strong> Declarar las ganancias en la DJ Anual. La pÃ©rdida por caÃ­da de precio es compensable con ganancias de la misma fuente en el mismo ejercicio.`},
  {id:'si3',cat:'bancarizacion',num:'Informe 148-2014-SUNAT/5D0000',titulo:'BancarizaciÃ³n â€” pagos a travÃ©s de terceros',desc:'Analiza si el pago mediante tercero (por cuenta del adquirente) cumple con la obligaciÃ³n de bancarizaciÃ³n de la Ley 28194.',badge:'blue',
   detalle:`<h4>Informe 148-2014 â€” BancarizaciÃ³n mediante tercero</h4><div class="reg-detail-art">Criterio: El pago a travÃ©s de un tercero cumple con la obligaciÃ³n de bancarizaciÃ³n si se puede demostrar que el tercero actuÃ³ por cuenta del adquirente y que el pago se realizÃ³ por medios del sistema financiero.</div><strong>Requisito:</strong> Documentar el acuerdo de pago entre el adquirente y el tercero, incluyendo el comprobante de pago bancario.`},
  {id:'si4',cat:'no_domiciliado',num:'Informe 064-2009-SUNAT/2B0000',titulo:'RetenciÃ³n IR a no domiciliados â€” servicios digitales',desc:'Criterio sobre la retenciÃ³n de IR en pagos a proveedores no domiciliados por servicios prestados a travÃ©s de internet.',badge:'red',
   detalle:`<h4>Informe 064-2009 â€” IR servicios digitales no domiciliados</h4><div class="reg-detail-art">Criterio: Los pagos a empresas no domiciliadas por servicios de software, suscripciones online, publicidad digital y similares estÃ¡n sujetos a retenciÃ³n del 30% de IR (tasa general no domiciliados), salvo CDI aplicable.</div><div class="reg-detail-art">El pagador domiciliado es agente de retenciÃ³n obligado (Art. 71 LIR). Si no retiene, asume la deuda.</div><strong>Ejemplo prÃ¡ctico:</strong> Pago de S/10,000 a empresa espaÃ±ola por servicio de software: retener S/3,000 si no hay CDI o verificar si el CDI PerÃº-EspaÃ±a reduce la tasa.`},
  {id:'si5',cat:'igv',num:'Informe 030-2024-SUNAT/7T0000',titulo:'IGV en economÃ­a digital â€” plataformas extranjeras',desc:'La SUNAT establece el tratamiento del IGV para servicios prestados por plataformas digitales extranjeras (Netflix, Spotify, Adobe, etc.).',badge:'gold',
   detalle:`<h4>Informe 030-2024 â€” IGV plataformas digitales</h4><div class="reg-detail-art">Criterio: A partir de octubre 2024, las plataformas digitales extranjeras deben registrarse ante SUNAT e incluir el IGV (18%) en sus precios o tenerlo como retenciÃ³n al momento del pago con tarjeta.</div><div class="reg-detail-art">El banco emisor de la tarjeta actÃºa como agente de retenciÃ³n del IGV en pagos a proveedores digitales no domiciliados.</div><strong>Para empresas:</strong> El IGV retenido puede usarse como crÃ©dito fiscal si el proveedor digital emite comprobante o si el banco emite la constancia de retenciÃ³n.`},
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” SUNAFIL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const SUNAFIL_DATA = [
  {id:'sf1',cat:'essalud',titulo:'EsSalud â€” Aportes y deducibilidad',desc:'El empleador aporta el 9% de la remuneraciÃ³n total al EsSalud. Es gasto deducible para el IR de 3ra categorÃ­a.',badge:'red',
   detalle:`<h4>EsSalud â€” Ley 26790</h4><div class="reg-detail-art">Tasa: 9% de la remuneraciÃ³n mensual (a cargo del empleador).</div><div class="reg-detail-art">Base imponible: RemuneraciÃ³n total (bÃ¡sico + asignaciones + horas extras). Se excluye: CTS, gratificaciones extraordinarias, utilidades, participaciÃ³n en ganancias.</div><div class="reg-detail-art">Tope mÃ­nimo: 9% de la RMV (S/1,025 Ã— 9% = S/92.25/mes).</div><strong>TributaciÃ³n:</strong> El aporte EsSalud es gasto deducible para el IR (Art. 37 inc. j) LIR). No estÃ¡ afecto a IGV.`},
  {id:'sf2',cat:'planilla',titulo:'Gratificaciones â€” Fiestas Patrias y Navidad',desc:'Los trabajadores tienen derecho a 2 gratificaciones al aÃ±o: en julio (Fiestas Patrias) y en diciembre (Navidad), equivalentes a 1 remuneraciÃ³n mensual cada una.',badge:'blue',
   detalle:`<h4>Gratificaciones â€” Ley 27735</h4><div class="reg-detail-art">Monto: 1 remuneraciÃ³n mensual por cada gratificaciÃ³n (julio y diciembre).</div><div class="reg-detail-art">GratificaciÃ³n proporcional: Si no trabajÃ³ todo el semestre, se paga en proporciÃ³n a los meses completos trabajados.</div><div class="reg-detail-art">InafectaciÃ³n: Las gratificaciones estÃ¡n inafectas de AFP/ONP y EsSalud (Ley 29351). Solo estÃ¡n afectas al IR 5ta categorÃ­a.</div><strong>Tratamiento tributario empleador:</strong> Las gratificaciones son gasto deducible para el IR de 3ra categorÃ­a en el ejercicio en que se paguen (criterio del devengado o percibido segÃºn el caso).`},
  {id:'sf3',cat:'beneficios',titulo:'CTS â€” CompensaciÃ³n por Tiempo de Servicios',desc:'La CTS es el beneficio social mÃ¡s importante. Equivale a 1/12 de la remuneraciÃ³n computable por cada mes de trabajo. Se deposita semestralmente.',badge:'blue',
   detalle:`<h4>CTS â€” D.S. 001-97-TR</h4><div class="reg-detail-art">Monto: 1/12 de la remuneraciÃ³n computable mensual por cada mes trabajado.</div><div class="reg-detail-art">DepÃ³sitos: En mayo (por el perÃ­odo novâ€“abr) y en noviembre (por mayoâ€“oct).</div><div class="reg-detail-art">RemuneraciÃ³n computable: BÃ¡sico + asignaciones regulares + 1/6 de las gratificaciones.</div><strong>TributaciÃ³n:</strong> La CTS no estÃ¡ afecta a IR, EsSalud ni AFP/ONP. Para el empleador es gasto deducible en el perÃ­odo de la obligaciÃ³n de depÃ³sito.`},
  {id:'sf4',cat:'infracciones',titulo:'Infracciones SUNAFIL y deducibilidad de multas',desc:'Las multas impuestas por SUNAFIL por infracciones laborales tienen tratamiento tributario especÃ­fico para el IR.',badge:'red',
   detalle:`<h4>Multas SUNAFIL â€” Tratamiento IR</h4><div class="reg-detail-art">Escala de multas 2024: InfracciÃ³n leve: hasta 5 UIT. Grave: hasta 10 UIT. Muy grave: hasta 20 UIT (microempresas tienen topes menores).</div><div class="reg-detail-art">Deducibilidad: Las multas impuestas por entidades pÃºblicas (incluyendo SUNAFIL) NO son deducibles para el IR (Art. 44 inc. c) LIR).</div><div class="reg-detail-art">SubsanaciÃ³n: Corregir la infracciÃ³n antes de la inspecciÃ³n reduce la multa hasta en un 90%.</div><strong>Consecuencia:</strong> Una multa de SUNAFIL de S/25,750 (5 UIT) no es deducible â†’ el costo real para la empresa en RG es S/25,750 + IR no deducido (S/7,596) = S/33,346 de impacto total.`},
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” INDECOPI
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const INDECOPI_DATA = [
  {id:'ind1',cat:'multas',titulo:'Multas INDECOPI â€” Deducibilidad tributaria',desc:'Las multas impuestas por INDECOPI por prÃ¡cticas anticompetitivas o infracciÃ³n al consumidor NO son deducibles para el Impuesto a la Renta.',badge:'red',
   detalle:`<h4>Multas INDECOPI y el IR</h4><div class="reg-detail-art">Base legal: Art. 44 inc. c) LIR â€” No son deducibles las multas, recargos, intereses moratorios previstos en el CT y, en general, sanciones aplicadas por el Sector PÃºblico Nacional.</div><div class="reg-detail-art">Escala INDECOPI: Hasta 450 UIT (S/2,317,500) para infracciones muy graves en competencia desleal. En protecciÃ³n al consumidor hasta 450 UIT.</div><strong>Estrategia tributaria:</strong> Las reparaciones civiles o compensaciones acordadas privadamente (fuera de procedimiento administrativo) SÃ pueden ser deducibles si hay vinculaciÃ³n con el negocio y documentaciÃ³n adecuada.`},
  {id:'ind2',cat:'consumidor',titulo:'Devoluciones por INDECOPI â€” IGV y RUC',desc:'Cuando INDECOPI ordena la devoluciÃ³n de un producto o la reversiÃ³n de un servicio, el tratamiento del IGV requiere emisiÃ³n de nota de crÃ©dito.',badge:'gold',
   detalle:`<h4>Devoluciones ordenadas por INDECOPI</h4><div class="reg-detail-art">Procedimiento: El proveedor debe emitir una Nota de CrÃ©dito por el monto devuelto, reduciendo el dÃ©bito fiscal del IGV del perÃ­odo.</div><div class="reg-detail-art">Para el IR: La devoluciÃ³n reduce los ingresos del perÃ­odo. Si ya se declarÃ³ el ingreso, se puede rectificar la DJ o incluir como menor ingreso en el perÃ­odo de la devoluciÃ³n.</div><strong>DocumentaciÃ³n:</strong> Conservar la resoluciÃ³n de INDECOPI, la nota de crÃ©dito electrÃ³nica y el comprobante de la devoluciÃ³n para sustentar el ajuste ante SUNAT.`},
  {id:'ind3',cat:'competencia',titulo:'Propiedad intelectual â€” Royalties y tratamiento tributario',desc:'Los pagos por licencias, regalÃ­as y uso de marcas registradas en INDECOPI califican como regalÃ­as con tratamiento especÃ­fico en el IR.',badge:'blue',
   detalle:`<h4>RegalÃ­as e IP â€” Art. 27 LIR</h4><div class="reg-detail-art">DefiniciÃ³n: Son regalÃ­as las contraprestaciones por el uso o el privilegio de usar patentes, marcas, diseÃ±os o modelos industriales registrados en INDECOPI.</div><div class="reg-detail-art">Tratamiento pagador (empresa): Las regalÃ­as pagadas son deducibles como gasto (Art. 37 inc. h) LIR) si existe vinculaciÃ³n con la generaciÃ³n de renta y el contrato estÃ¡ registrado.</div><div class="reg-detail-art">Tratamiento receptor PN: Renta de 2da categorÃ­a, tasa 5% vÃ­a retenciÃ³n.</div><strong>No domiciliado:</strong> RegalÃ­as pagadas al exterior tienen retenciÃ³n del 30% (o menor si hay CDI). La marca debe estar registrada en PerÃº para que el pago sea deducible.`},
  {id:'ind4',cat:'pi',titulo:'Barreras burocrÃ¡ticas â€” gastos de cumplimiento deducibles',desc:'Los gastos incurridos para superar barreras burocrÃ¡ticas identificadas por INDECOPI pueden ser deducibles como gastos extraordinarios.',badge:'gold',
   detalle:`<h4>Barreras burocrÃ¡ticas â€” Decreto Legislativo 1256</h4><div class="reg-detail-art">INDECOPI puede inaplicar y eliminar barreras burocrÃ¡ticas ilegales o irrazonables impuestas por entidades del Estado.</div><div class="reg-detail-art">Los gastos legales y administrativos para impugnar barreras burocrÃ¡ticas son deducibles para el IR como gastos vinculados a la actividad empresarial (Art. 37 LIR).</div><strong>Estrategia:</strong> Si tu empresa enfrenta requisitos irrazonables de municipalidades o entidades sectoriales que generan costos, considerar la denuncia ante INDECOPI como herramienta de ahorro tributario indirecto.`},
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” BCR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const BCR_NORMAS = [
  {id:'bcr1',cat:'tc',titulo:'Tipo de cambio para IR â€” Art. 50 RLIR',desc:'Para declarar rentas de fuente extranjera y operaciones en moneda extranjera, se usa el tipo de cambio SBS de la fecha de la operaciÃ³n.',badge:'blue',
   detalle:`<h4>Art. 50 RLIR â€” Tipo de cambio para IR</h4><div class="reg-detail-art">Para convertir rentas de fuente extranjera: Tipo de cambio promedio ponderado SBS de la fecha de devengo de la renta.</div><div class="reg-detail-art">Para activos en moneda extranjera al cierre del aÃ±o: Tipo de cambio de cierre de aÃ±o (31 de diciembre).</div><strong>Diferencias de cambio:</strong> Las diferencias de cambio de activos y pasivos en ME son computables como ganancia o pÃ©rdida tributaria (Art. 61 LIR).`},
  {id:'bcr2',cat:'tc',titulo:'Diferencia de cambio â€” Art. 61 LIR',desc:'Las ganancias o pÃ©rdidas por diferencia de cambio en operaciones propias del giro del negocio son computables para el IR.',badge:'gold',
   detalle:`<h4>Art. 61 LIR â€” Diferencias de cambio</h4><div class="reg-detail-art">Ganancia de cambio: Tributable como ingreso ordinario del ejercicio.</div><div class="reg-detail-art">PÃ©rdida de cambio: Deducible como gasto si es inherente al giro del negocio.</div><div class="reg-detail-art">ExcepciÃ³n: Las diferencias de cambio de activos fijos adquiridos en ME deben activarse y no deducirse directamente.</div><strong>Tipo de cambio a usar:</strong> El tipo de cambio SBS publicado en la fecha de la transacciÃ³n o del cierre contable, segÃºn corresponda.`},
];

const BCR_HIST = [];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” ZONAS ESPECIALES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const ZONAS_DATA = [
  {id:'z1',cat:'amazonia',nombre:'Ley de AmazonÃ­a â€” Ley 27037',region:'Loreto, Ucayali, Madre de Dios, San MartÃ­n, Amazonas (parcial)',badge:'green',
   desc:'ExoneraciÃ³n de IGV y tasa reducida de IR (10%) para empresas que producen y consumen en la AmazonÃ­a. Uno de los mayores beneficios tributarios del PerÃº.',
   beneficios:['ExoneraciÃ³n de IGV en ventas dentro de la AmazonÃ­a','IR al 10% (RG) o 5% (producciÃ³n primaria)','Reintegro tributario del IGV para comerciantes de la regiÃ³n','ExoneraciÃ³n de ISC en combustibles para la regiÃ³n','Vigente hasta el aÃ±o 2048'],
   requisitos:'Domicilio fiscal y actividad productiva en la zona. No basta solo el domicilio â€” la producciÃ³n debe realizarse en la AmazonÃ­a.',
   detalle:`<h4>Ley 27037 â€” Ley de PromociÃ³n de la InversiÃ³n en la AmazonÃ­a</h4><div class="zona-benefit">IGV: Las empresas ubicadas en la AmazonÃ­a que vendan bienes producidos en la regiÃ³n estÃ¡n exoneradas del IGV.</div><div class="zona-benefit">IR: Tasa del 10% para actividades en la AmazonÃ­a (vs 29.5% RG). Tasa del 5% para agricultura, acuicultura, pesca, turismo y actividades primarias.</div><div class="zona-benefit">Reintegro tributario: Los comerciantes de bienes no producidos en la regiÃ³n pueden pedir la devoluciÃ³n del IGV pagado en sus compras fuera.</div><strong>Requisito clave:</strong> La empresa debe tener su domicilio fiscal, producciÃ³n y 70% de sus activos en la zona de AmazonÃ­a.`},
  {id:'z2',cat:'ceticos',nombre:'CETICOS â€” Centros de ExportaciÃ³n y TransformaciÃ³n',region:'Ilo (Moquegua), Paita (Piura), Matarani (Arequipa), Tacna',badge:'blue',
   desc:'Zonas de tratamiento especial para actividades de exportaciÃ³n, manufactura y servicios. Las empresas dentro del CETICOS tienen exoneraciÃ³n tributaria por 20 aÃ±os.',
   beneficios:['ExoneraciÃ³n de IR por 20 aÃ±os','ExoneraciÃ³n de IGV, ISC y aranceles','Libre movimiento de divisas','No aplica el ITF dentro de la zona','RÃ©gimen laboral flexible (negociaciÃ³n directa)'],
   requisitos:'Empresa constituida dentro del CETICOS, mÃ­nimo 92% de producciÃ³n para exportaciÃ³n.',
   detalle:`<h4>CETICOS â€” D.Leg. 704 y normas complementarias</h4><div class="zona-benefit">Los CETICOS son zonas econÃ³micas especiales donde las empresas instaladas gozan de estabilidad jurÃ­dica y tributaria por 20 aÃ±os.</div><div class="zona-benefit">Aranceles: Ingreso de insumos y maquinaria sin pago de arancel para producciÃ³n destinada a exportaciÃ³n.</div><div class="zona-benefit">IR: Las utilidades generadas dentro del CETICOS estÃ¡n exoneradas de IR durante el perÃ­odo de estabilidad.</div><strong>Proceso de instalaciÃ³n:</strong> Solicitar zona ante ZOFRACEN/COPRI, presentar proyecto de inversiÃ³n, firmar contrato de estabilidad.`},
  {id:'z3',cat:'zofratacna',nombre:'ZOFRATACNA â€” Zona Franca de Tacna',region:'Tacna',badge:'gold',
   desc:'RÃ©gimen especial de comercio en Tacna con lÃ­mites de franquicia aduanera para personas naturales y rÃ©gimen simplificado para empresas.',
   beneficios:['Franquicia de hasta USD 1,000 por persona y viaje','Empresas exoneradas de IR, IGV, ISC y aranceles','Libre importaciÃ³n y reexportaciÃ³n de mercancÃ­as','Actividades comerciales, industriales y de servicios'],
   requisitos:'Para franquicia personal: ser mayor de edad y no haber usado el beneficio en los Ãºltimos 30 dÃ­as.',
   detalle:`<h4>ZOFRATACNA â€” Ley 27688</h4><div class="zona-benefit">Franquicia personal: Personas que visiten Tacna pueden internar mercancÃ­as hasta USD 1,000 sin pagar aranceles ni IGV.</div><div class="zona-benefit">Empresas en la ZOFRATACNA: ExoneraciÃ³n de tributos por 25 aÃ±os. Actividades: manufactura, servicios, comercio, logÃ­stica.</div><strong>TributaciÃ³n de la franquicia:</strong> Los bienes comprados en la ZOFRATACNA dentro del lÃ­mite de franquicia no pagan IGV ni aranceles al ingresar al resto del paÃ­s. El exceso tributa aranceles + IGV.`},
  {id:'z4',cat:'sectorial',nombre:'Sector Agrario â€” Ley 31110',region:'Nacional (sector agropecuario)',badge:'green',
   desc:'RÃ©gimen laboral y tributario especial para trabajadores y empresas del sector agrario y riego. Tasa reducida de IR e incentivos en EsSalud.',
   beneficios:['IR al 15% sobre utilidades (vs 29.5% RG)','EsSalud al 9% (igual que rÃ©gimen general desde 2021)','DepreciaciÃ³n acelerada de inversiones en infraestructura de riego','RecuperaciÃ³n anticipada del IGV en proyectos de inversiÃ³n'],
   requisitos:'Empresa con actividad principal agropecuaria certificada por MIDAGRI.',
   detalle:`<h4>Ley 31110 â€” Ley del Trabajador Agrario (2021)</h4><div class="zona-benefit">IR empresarial: Las empresas agrarias tributan al 15% sobre su renta neta anual (antes era 15% bajo Ley 27360).</div><div class="zona-benefit">DepreciaciÃ³n acelerada: Las inversiones en silos, almacenes y obras de infraestructura de riego se deprecian al 20% anual.</div><div class="zona-benefit">RecuperaciÃ³n anticipada IGV: Para proyectos de inversiÃ³n en etapa preproductiva, el IGV pagado en compras puede recuperarse antes de la primera venta.</div><strong>Requisito:</strong> Inscribirse en el Registro de Empleadores de Actividad Agraria ante MIDAGRI.`},
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” CRIPTO / DIGITAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const CRIPTO_DATA = {
  cripto: [
    {id:'cr1',titulo:'Ganancias por venta de criptomonedas',desc:'Tratamiento tributario segÃºn el Informe 045-2023-SUNAT. Las ganancias tributan como renta de 2da o 3ra categorÃ­a.',
     detalle:`<h4>Criptomonedas â€” IR en PerÃº (2024)</h4><div class="reg-detail-art">Persona natural (no habitual): Renta de 2da categorÃ­a. Tasa efectiva 5% (= 6.25% sobre el 80% de la ganancia). Declarar en DJ Anual.</div><div class="reg-detail-art">Persona natural habitual o empresa: Renta de 3ra categorÃ­a. Tasa del rÃ©gimen aplicable (10% RMT hasta 15 UIT, 29.5% excedente en RG).</div><div class="reg-detail-art">Â¿CuÃ¡ndo se considera habitual? SUNAT puede calificarte como habitual si realizas operaciones frecuentes con criptos (mÃ¡s de 2 veces al aÃ±o con ganancias significativas).</div><strong>Costo computable:</strong> El precio de compra original de la cripto, incluyendo comisiones de exchange. Documenta siempre tus operaciones.`},
    {id:'cr2',titulo:'IGV en operaciones con criptomonedas',desc:'Las criptomonedas no son moneda de curso legal, por lo que su venta podrÃ­a estar afecta al IGV como venta de intangibles.',
     detalle:`<h4>IGV y Cripto â€” PosiciÃ³n SUNAT</h4><div class="reg-detail-art">SUNAT considera que las criptomonedas son "bienes intangibles". Si una empresa vende criptomonedas habitualmente, la operaciÃ³n podrÃ­a estar gravada con IGV (18%) como primera venta de bien intangible.</div><div class="reg-detail-art">Personas naturales sin negocio: Generalmente no estÃ¡n afectas al IGV por la venta de criptos ya que no realizan actividad empresarial.</div><strong>Zona gris:</strong> No existe aÃºn una regulaciÃ³n especÃ­fica del IGV para cripto en PerÃº. Se espera pronunciamiento formal de SUNAT en 2025.`},
    {id:'cr3',titulo:'Mining y staking â€” Â¿cÃ³mo tributan?',desc:'Los ingresos por minerÃ­a de criptomonedas (mining) y por staking tienen tratamiento particular aÃºn no definido expresamente.',
     detalle:`<h4>Mining y Staking â€” PosiciÃ³n interpretativa</h4><div class="reg-detail-art">Mining: Los ingresos por minerÃ­a de criptos califican como renta de fuente peruana si la actividad se realiza en PerÃº (servidores en el paÃ­s). Tributan como renta de 3ra categorÃ­a.</div><div class="reg-detail-art">Staking: Los rendimientos por staking podrÃ­an calificar como intereses o dividendos segÃºn la estructura. En ausencia de norma especÃ­fica, SUNAT podrÃ­a asimilarlos a renta de 2da o 3ra categorÃ­a.</div><strong>RecomendaciÃ³n:</strong> Llevar registro detallado de todas las operaciones de mining/staking: fecha, cantidad, valor en PEN al momento de recepciÃ³n.`},
  ],
  plataformas: [
    {id:'pl1',titulo:'Netflix, Spotify, Adobe â€” IGV desde oct. 2024',desc:'Desde octubre de 2024, las plataformas digitales extranjeras estÃ¡n obligadas a cobrar y pagar el IGV en el PerÃº.',
     detalle:`<h4>IGV Plataformas Digitales â€” D.Leg. 1623 (2024)</h4><div class="reg-detail-art">Plataformas obligadas: Netflix, Spotify, Adobe, Microsoft 365, Google Workspace, Meta Ads, Google Ads, LinkedIn, entre otras.</div><div class="reg-detail-art">Mecanismo: La plataforma cobra el IGV (18%) en la suscripciÃ³n o la tarjeta bancaria lo retiene automÃ¡ticamente.</div><div class="reg-detail-art">Para empresas: El IGV pagado en servicios digitales puede usarse como crÃ©dito fiscal si se cuenta con la constancia de pago o el comprobante del proveedor.</div><strong>Impacto en precios:</strong> Netflix bÃ¡sico subiÃ³ de S/24.90 a S/29.38 (incluye IGV). Considerar en presupuestos de TI de empresas.`},
    {id:'pl2',titulo:'Google Ads / Meta Ads â€” RetenciÃ³n y deducibilidad',desc:'Los pagos a plataformas de publicidad digital extranjeras tienen doble tratamiento: IGV (retenciÃ³n bancaria) + RetenciÃ³n IR (30%).',
     detalle:`<h4>Publicidad digital â€” Google/Meta Ads</h4><div class="reg-detail-art">IGV: Retenido automÃ¡ticamente por el banco al debitar la tarjeta (desde oct. 2024). Recuperable como crÃ©dito fiscal.</div><div class="reg-detail-art">IR: El pago a Google/Meta por publicidad califica como renta de fuente peruana de no domiciliado (servicio de difusiÃ³n utilizado en PerÃº). RetenciÃ³n del 30% (Art. 76 LIR).</div><div class="reg-detail-art">PrÃ¡ctica habitual: La mayorÃ­a de empresas NO retienen el IR a Google/Meta. Esto genera riesgo en fiscalizaciones â€” SUNAT puede exigir el 30% al pagador.</div><strong>SoluciÃ³n:</strong> Obtener constancia de la plataforma que confirme que tributa en su paÃ­s con el que PerÃº tiene CDI, reduciendo o eliminando la retenciÃ³n.`},
  ],
  gig: [
    {id:'gg1',titulo:'Rappi, Uber Eats, PedidosYa â€” Repartidores',desc:'Los repartidores de apps son trabajadores independientes que generan renta de 4ta categorÃ­a. Las apps actÃºan como intermediarios.',
     detalle:`<h4>EconomÃ­a Gig â€” Renta 4ta categorÃ­a</h4><div class="reg-detail-art">Los repartidores o conductores son considerados trabajadores independientes (locadores de servicios), no empleados.</div><div class="reg-detail-art">Tributan renta de 4ta categorÃ­a: DeducciÃ³n del 20% + 7 UIT. Si sus ingresos superan S/36,050/aÃ±o (7 UIT), deben declarar.</div><div class="reg-detail-art">La app retiene 8% de IR cuando el pago supera S/1,500 mensuales (RHE).</div><strong>EsSalud:</strong> Los trabajadores independientes de apps no estÃ¡n obligados a EsSalud, aunque pueden afiliarse voluntariamente.`},
    {id:'gg2',titulo:'Influencers y creadores de contenido',desc:'YouTubers, Instagramers y TikTokers que reciben pagos de plataformas extranjeras o sponsors nacionales tienen obligaciones tributarias especÃ­ficas.',
     detalle:`<h4>Influencers â€” TributaciÃ³n en PerÃº</h4><div class="reg-detail-art">Pagos de YouTube/AdSense: Renta de fuente extranjera (2da o 4ta categorÃ­a segÃºn sea habitual o no). Declarar en DJ Anual.</div><div class="reg-detail-art">Sponsors locales: Renta de 4ta categorÃ­a. El sponsor debe exigir RHE (Recibo por Honorarios ElectrÃ³nico). RetenciÃ³n del 8%.</div><div class="reg-detail-art">Canje de productos: El valor de los productos recibidos como pago en especie es renta gravada al valor de mercado.</div><strong>ObligaciÃ³n formal:</strong> Emitir RHE por cada pago de sponsor nacional. Para pagos del exterior, declarar en la casilla 102 de la DJ Anual.`},
  ],
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DATA â€” DERECHO COMPARADO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const COMPARADO_LATAM = [
  {pais:'ğŸ‡µğŸ‡ª PerÃº',ir_corp:'29.5%',igv:'18%',divid:'5%',ganancia_cap:'6.25%',uit_equiv:'S/5,500',cdi:'11 CDIs vigentes',highlight:'mid'},
  {pais:'ğŸ‡¨ğŸ‡± Chile',ir_corp:'27%',igv:'19% (IVA)',divid:'35% global',ganancia_cap:'22% (integrado)',uit_equiv:'UF 0.59/mes',cdi:'35+ CDIs',highlight:'best'},
  {pais:'ğŸ‡¨ğŸ‡´ Colombia',ir_corp:'35%',igv:'19% (IVA)',divid:'10%',ganancia_cap:'10%',uit_equiv:'COP 1,160,000',cdi:'16 CDIs',highlight:'worst'},
  {pais:'ğŸ‡²ğŸ‡½ MÃ©xico',ir_corp:'30%',igv:'16% (IVA)',divid:'10%',ganancia_cap:'Integrado',uit_equiv:'Sin equivalente',cdi:'66+ CDIs',highlight:'mid'},
  {pais:'ğŸ‡§ğŸ‡· Brasil',ir_corp:'34% (CSLL)',igv:'~33% (mÃºltiple)',divid:'0% (exonerado)',ganancia_cap:'15-22.5%',uit_equiv:'Sin equivalente',cdi:'38 CDIs',highlight:'worst'},
  {pais:'ğŸ‡¦ğŸ‡· Argentina',ir_corp:'35%',igv:'21% (IVA)',divid:'7-13%',ganancia_cap:'15%',uit_equiv:'Sin equivalente',cdi:'20 CDIs',highlight:'worst'},
];

const COMPARADO_EUROPA = [
  {pais:'ğŸ‡ªğŸ‡¸ EspaÃ±a',ir_corp:'25%',igv:'21% (IVA)',divid:'19-28%',ganancia_cap:'19-28%',cdi:'CDI con PerÃº vigente',highlight:'best'},
  {pais:'ğŸ‡©ğŸ‡ª Alemania',ir_corp:'30% (KÃ¶rperschaft)',igv:'19% (MwSt)',divid:'25%',ganancia_cap:'25%',cdi:'CDI con PerÃº vigente',highlight:'mid'},
  {pais:'ğŸ‡¬ğŸ‡§ Reino Unido',ir_corp:'25%',igv:'20% (VAT)',divid:'8.75-39.35%',ganancia_cap:'10-20%',cdi:'CDI con PerÃº vigente',highlight:'best'},
  {pais:'ğŸ‡³ğŸ‡± PaÃ­ses Bajos',ir_corp:'25.8%',igv:'21% (BTW)',divid:'15% (retenciÃ³n)',ganancia_cap:'31% (box 3)',cdi:'CDI con PerÃº vigente',highlight:'mid'},
];

const OCDE_BEPS = [
  {num:'Pilar 1',titulo:'RedistribuciÃ³n de utilidades de multinationales',desc:'Las grandes empresas digitales (ingresos > EUR 20B) pagarÃ¡n impuestos en los paÃ­ses donde estÃ¡n sus clientes, no solo donde tienen sede.',impacto:'PerÃº recibirÃ¡ mayor recaudaciÃ³n de empresas como Google y Amazon por sus operaciones locales.',estado:'En negociaciÃ³n â€” 2025-2026'},
  {num:'Pilar 2',titulo:'Impuesto mÃ­nimo global del 15%',desc:'Todas las multinacionales con ingresos > EUR 750M pagarÃ¡n al menos 15% de IR efectivo en todos los paÃ­ses donde operen.',impacto:'Las empresas peruanas con subsidiarias en paraÃ­sos fiscales (tasa < 15%) verÃ¡n aumentar su carga tributaria global.',estado:'Varios paÃ­ses lo adoptaron en 2024. PerÃº evalÃºa implementaciÃ³n.'},
  {num:'BEPS AcciÃ³n 13',titulo:'DocumentaciÃ³n de Precios de Transferencia (CbCR)',desc:'Country-by-Country Reporting: Las multinacionales con ingresos > EUR 750M deben reportar a cada paÃ­s informaciÃ³n paÃ­s por paÃ­s de su actividad y tributos pagados.',impacto:'PerÃº ya implementÃ³ el CbCR (D.S. 008-2023-EF). Empresas locales de grupos multinacionales deben verificar si su casa matriz presenta el informe.',estado:'âœ… Vigente en PerÃº desde 2023'},
  {num:'Intercambio CRS',titulo:'Intercambio automÃ¡tico de informaciÃ³n financiera (CRS)',desc:'PerÃº intercambia automÃ¡ticamente con otros paÃ­ses la informaciÃ³n de cuentas bancarias de no residentes. Elimina el secreto bancario internacional.',impacto:'Las personas con cuentas en el extranjero no declaradas serÃ¡n detectadas. Los bancos peruanos reportan a sus residentes extranjeros a sus paÃ­ses de origen.',estado:'âœ… Vigente en PerÃº desde 2021'},
];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FUNCTIONS â€” GENERIC REGISTRY RENDERER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderRegList(elId, data, searchQ, filterCat, color) {
  const el = document.getElementById(elId); if (!el) return;
  let items = filterCat === 'todos' ? data : data.filter(n => n.cat === filterCat);
  if (searchQ) {
    const q = searchQ.toLowerCase();
    items = items.filter(n => (n.titulo||'').toLowerCase().includes(q) || (n.desc||'').toLowerCase().includes(q) || (n.num||'').toLowerCase().includes(q));
  }
  if (!items.length) { el.innerHTML = '<div class="hempty">No se encontraron resultados.</div>'; return; }
  const c = color || 'var(--gold)';
  el.innerHTML = items.map(n => `<div class="reg-card" onclick="toggleRegDetail('reg_${n.id}')">
    <div class="reg-card-top">
      <div class="reg-card-title">${n.num ? '<span style="font-size:14px;color:'+c+';font-weight:500;display:block;margin-bottom:3px">'+n.num+'</span>' : ''}${n.titulo||n.nombre}</div>
      <div class="reg-card-badges"><span class="reg-badge ${n.badge||'blue'}">${n.obs?'â­ Obs. obligatoria':n.badge==='red'?'CrÃ­tico':n.badge==='gold'?'Importante':'Norma'}</span></div>
    </div>
    <div class="reg-card-desc">${n.desc}</div>
    <div class="reg-detail" id="detail_reg_${n.id}">${n.detalle||''}
      <button class="reg-ask-btn" style="border-color:${c};color:${c}" onclick="askAboutRegulation(event,'${(n.num||n.titulo||n.nombre).replace(/'/g,'\\'+'\'').replace(/"/g,'&quot;')}')">ğŸ’¬ Consultar IA sobre este tema</button>
    </div>
  </div>`).join('');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FUNCTIONS â€” EACH SERVICE TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ RTF â”€â”€
let rtfFilter='todos', rtfTab='rtfs';
function setRTFTab(tab,btn){
  rtfTab=tab;
  document.querySelectorAll('#ptRtf .reg-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  document.getElementById('rtfList').style.display=tab==='rtfs'?'flex':'none';
  document.getElementById('rtfConsultor').style.display=tab==='consultor'?'block':'none';
  if(tab==='rtfs')renderRegList('rtfList',RTF_DATA,'',rtfFilter,'#E8A020');
}
function filterRTF(cat,btn){rtfFilter=cat;document.querySelectorAll('#ptRtf .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderRegList('rtfList',RTF_DATA,'',rtfFilter,'#E8A020');}
function searchRTF(q){renderRegList('rtfList',RTF_DATA,q,rtfFilter,'#E8A020');}

// â”€â”€ SUNAT INF â”€â”€
let siFilter='todos';
function filterSunatInf(cat,btn){siFilter=cat;document.querySelectorAll('#ptSunat_inf .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderRegList('sunatInfList',SUNAT_INF_DATA,'',siFilter,'#E8A020');}
function searchSunatInf(q){renderRegList('sunatInfList',SUNAT_INF_DATA,q,siFilter,'#E8A020');}

// â”€â”€ SUNAFIL â”€â”€
let sfFilter='todos', sfTab='normas';
function setSunafilTab(tab,btn){
  sfTab=tab;
  document.querySelectorAll('#ptSunafil .reg-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  ['sunafilNormas','sunafilCalculadora','sunafilConsultor'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const map={normas:'sunafilNormas',calculadora:'sunafilCalculadora',consultor:'sunafilConsultor'};
  const el=document.getElementById(map[tab]);if(el)el.style.display=tab==='normas'?'flex':'block';
  if(tab==='normas')renderRegList('sunafilNormas',SUNAFIL_DATA,'',sfFilter,'#E05050');
}
function filterSunafil(cat,btn){sfFilter=cat;document.querySelectorAll('#ptSunafil .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderRegList('sunafilNormas',SUNAFIL_DATA,'',sfFilter,'#E05050');}
function searchSunafil(q){renderRegList('sunafilNormas',SUNAFIL_DATA,q,sfFilter,'#E05050');}

function calcLaboral(){
  const sueldo=parseFloat(document.getElementById('sfSueldo')?.value)||0;
  const pension=document.getElementById('sfPension')?.value||'afp';
  const regimen=document.getElementById('sfRegimen')?.value||'general';
  const el=document.getElementById('sfResult');if(!sueldo||!el)return;
  const essalud=regimen==='micro'?0:sueldo*0.09;
  const aportePension=pension==='onp'?sueldo*0.13:sueldo*0.13;// AFP ~13% total
  const irBase=Math.max(0,sueldo*12-(7*5500)-(sueldo*12*0.20));
  const ir5ta=irBase>0?calcIR5ta(irBase)/12:0;
  const neto=sueldo-aportePension-ir5ta;
  const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  el.style.display='block';
  el.innerHTML=`<div class="sec-title" style="margin-bottom:12px">Estructura de costo laboral mensual</div>
  <div class="tim-row"><span class="tim-row-lbl">RemuneraciÃ³n bruta</span><span class="tim-row-val">${fmtS(sueldo)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">EsSalud (empleador 9%)</span><span class="tim-row-val red">${regimen==='micro'?'Exonerado (microempresa)':fmtS(essalud)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Aporte ${pension==='onp'?'ONP 13%':'AFP ~13%'} (trabajador)</span><span class="tim-row-val red">-${fmtS(aportePension)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">RetenciÃ³n IR 5ta categorÃ­a est.</span><span class="tim-row-val red">-${fmtS(ir5ta)}</span></div>
  <div class="tim-row" style="border-top:1px solid var(--gold)"><span class="tim-row-lbl"><strong>Neto al trabajador</strong></span><span class="tim-row-val gold"><strong>${fmtS(neto)}</strong></span></div>
  <div class="tim-row"><span class="tim-row-lbl">Costo total empleador/mes</span><span class="tim-row-val">${fmtS(sueldo+essalud)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">GratificaciÃ³n mensualizada (Ã·12)</span><span class="tim-row-val">${fmtS(sueldo/6)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">CTS mensualizada (Ã·12)</span><span class="tim-row-val">${fmtS(sueldo/12)}</span></div>
  <div class="tim-row" style="border-top:1px solid var(--gold)"><span class="tim-row-lbl"><strong>Costo anual total estimado</strong></span><span class="tim-row-val gold"><strong>${fmtS((sueldo+essalud)*12+sueldo*2+sueldo)}</strong></span></div>
  <p style="font-size:14px;color:var(--muted);margin-top:10px">EstimaciÃ³n referencial. AFP varÃ­a segÃºn comisiÃ³n y prima de seguro. IR 5ta calculado con escala 2024.</p>`;
}
function calcIR5ta(base){
  let t=0;
  const tramos=[[5*5500,0.08],[15*5500,0.14],[25*5500,0.17],[40*5500,0.20],[Infinity,0.30]];
  let prev=0;
  for(const[tope,tasa]of tramos){const hasta=Math.min(base,tope);if(hasta>prev)t+=(hasta-prev)*tasa;prev=tope;if(base<=tope)break;}
  return t;
}

// â”€â”€ INDECOPI â”€â”€
let indFilter='todos';
function filterIndecopi(cat,btn){indFilter=cat;document.querySelectorAll('#ptIndecopi .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderRegList('indecopiList',INDECOPI_DATA,'',indFilter,'#E05050');}
function searchIndecopi(q){renderRegList('indecopiList',INDECOPI_DATA,q,indFilter,'#E05050');}

// â”€â”€ BCR â”€â”€
let bcrTab='historico';
function setBCRTab(tab,btn){
  bcrTab=tab;
  document.querySelectorAll('#ptBcr .reg-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  ['bcrHistorico','bcrCalculadora','bcrNormas'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const el=document.getElementById('bcr'+tab.charAt(0).toUpperCase()+tab.slice(1));
  if(el)el.style.display='block';
  if(tab==='historico')renderBCRTable();
  if(tab==='normas')renderRegList('bcrNormasList',BCR_NORMAS,'','todos','#3A86FF');
}
async function renderBCRRates(){
  const el=document.getElementById('bcrRates');if(!el)return;
  el.innerHTML='<div style="color:var(--muted)">Consultando BCRPâ€¦</div>';
  try{
    const payload=await declarafyApi('consultabcrtiposcambio',{method:'GET'});
    const rows=Array.isArray(payload?.data)?payload.data:[];
    BCR_HIST.splice(0,BCR_HIST.length,...rows.map((row,index)=>({fecha:String(row.fecha||''),compra:row.compra==null?null:Number(row.compra),venta:row.venta==null?null:Number(row.venta),var:index<rows.length-1&&row.venta!=null&&rows[index+1].venta!=null?Number(row.venta)-Number(rows[index+1].venta):0})).filter(row=>Number.isFinite(row.compra)||Number.isFinite(row.venta)));
    const latest=BCR_HIST[0];
    if(!latest)throw new Error('Sin cotizaciones disponibles.');
    const rates=[{lbl:'USD Compra',val:Number.isFinite(latest.compra)?latest.compra.toFixed(3):'â€”',date:latest.fecha},{lbl:'USD Venta',val:Number.isFinite(latest.venta)?latest.venta.toFixed(3):'â€”',date:latest.fecha}];
    el.innerHTML=rates.map(r=>`<div class="bcr-card"><div class="bcr-label">${r.lbl}</div><div class="bcr-rate">${r.val}</div><div class="bcr-date">${_escapeHtml(r.date)}</div></div>`).join('');
    renderBCRTable();
  }catch(error){el.innerHTML=`<div style="color:var(--red)">${_escapeHtml(error.message)}</div>`;renderBCRTable();}
}
function renderBCRTable(){
  const el=document.getElementById('bcrTable');if(!el)return;
  if(!BCR_HIST.length){el.innerHTML='<tbody><tr><td style="color:var(--muted)">Sin datos oficiales cargados.</td></tr></tbody>';return;}
  el.innerHTML='<thead><tr><th>PerÃ­odo</th><th>Compra</th><th>Venta</th><th>VariaciÃ³n</th><th>Uso tributario</th></tr></thead><tbody>'+
  BCR_HIST.map(r=>{
    const varClass=r.var>0?'bcr-positive':r.var<0?'bcr-negative':'bcr-neutral';
    const varStr=(r.var>0?'+':'')+r.var.toFixed(3);
    return `<tr><td>${_escapeHtml(r.fecha)}</td><td>${Number.isFinite(r.compra)?r.compra.toFixed(3):'â€”'}</td><td style="color:var(--gold)">${Number.isFinite(r.venta)?r.venta.toFixed(3):'â€”'}</td><td class="${varClass}">${varStr}</td><td style="color:var(--muted);font-size:14px">Fuente BCRP</td></tr>`;
  }).join('')+'</tbody>';
}
async function calcBCR(){
  const monto=parseFloat(document.getElementById('bcrMonto')?.value)||0;
  const from=document.getElementById('bcrFrom')?.value||'USD';
  const op=document.getElementById('bcrOp')?.value||'venta';
  const el=document.getElementById('bcrResult');if(!monto||!el)return;
  el.style.display='block';
  if(from!=='USD'){
    el.innerHTML='<div style="color:var(--muted)">La fuente oficial configurada solo entrega USD/PEN. No se calcularÃ¡ otra moneda con una tasa inventada.</div>';
    return;
  }
  el.innerHTML='<div style="color:var(--muted)">Consultando BCRPâ€¦</div>';
  try{
    const payload=await declarafyApi('consultabcrtiposcambio',{method:'GET'});
    const latest=Array.isArray(payload?.data)?payload.data[0]:null;
    const tc=Number(op==='compra'?latest?.compra:latest?.venta);
    if(!Number.isFinite(tc))throw new Error('El BCRP no devolviÃ³ una tasa vÃ¡lida.');
    const resultado=monto*tc;
    const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
    el.innerHTML=`<div style="font-size:14px;color:var(--muted);margin-bottom:8px">USD ${op} â€” ${_escapeHtml(latest?.fecha||'Ãºltimo dato BCRP')}</div><div class="tim-total">${fmtS(resultado)}</div><div style="font-size:14px;color:var(--muted);margin-bottom:14px">${monto.toLocaleString()} USD Ã— ${tc.toFixed(3)} = ${fmtS(resultado)}</div><div class="tim-row"><span class="tim-row-lbl">Tipo de cambio BCRP utilizado</span><span class="tim-row-val gold">${tc.toFixed(3)}</span></div><p style="font-size:14px;color:var(--muted);margin-top:8px">Dato oficial BCRP. Para otra fecha, usa la cotizaciÃ³n oficial correspondiente a esa operaciÃ³n.</p>`;
  }catch(error){el.innerHTML=`<div style="color:var(--red)">${_escapeHtml(error.message)}</div>`;}
}

// â”€â”€ ZONAS â”€â”€
let zonasFilter='todos';
function filterZonas(cat,btn){zonasFilter=cat;document.querySelectorAll('#ptZonas .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderZonas('');}
function searchZonas(q){renderZonas(q.toLowerCase());}
function renderZonas(q){
  const el=document.getElementById('zonasList');if(!el)return;
  let items=zonasFilter==='todos'?ZONAS_DATA:ZONAS_DATA.filter(z=>z.cat===zonasFilter);
  if(q)items=items.filter(z=>z.nombre.toLowerCase().includes(q)||z.desc.toLowerCase().includes(q)||(z.region||'').toLowerCase().includes(q));
  if(!items.length){el.innerHTML='<div class="hempty">No se encontraron zonas.</div>';return;}
  el.innerHTML=items.map(z=>`<div class="zona-card" onclick="toggleRegDetail('zona_${z.id}')">
    <div class="zona-card-top"><div><div class="zona-name">${z.nombre}</div><div style="font-size:14px;color:var(--muted);margin-top:2px">ğŸ“ ${z.region}</div></div><span class="reg-badge ${z.badge}">${{amazonia:'ğŸŒ¿ AmazonÃ­a',ceticos:'ğŸ­ CETICOS',zofratacna:'ğŸ” Zona Franca',sectorial:'ğŸ¢ Sectorial'}[z.cat]||z.cat}</span></div>
    <div style="font-size:14px;color:var(--muted);margin-top:6px;line-height:1.5">${z.desc}</div>
    <div class="zona-detail" id="detail_zona_${z.id}">${z.detalle||''}
      <div style="margin-top:10px"><strong style="color:var(--green)">Beneficios principales:</strong>
        ${(z.beneficios||[]).map(b=>`<div class="zona-benefit" style="margin-top:5px">${b}</div>`).join('')}
      </div>
      <div style="margin-top:8px;font-size:14px;color:var(--muted)"><strong>Requisitos:</strong> ${z.requisitos||''}</div>
      <button class="reg-ask-btn smv-ask" onclick="askAboutRegulation(event,'Zona especial: ${z.nombre.replace(/'/g,"\\'")}')" style="margin-top:10px">ğŸ’¬ Consultar IA sobre esta zona</button>
    </div>
  </div>`).join('');
}

// â”€â”€ CRIPTO â”€â”€
let criptoTab='cripto';
function setCriptoTab(tab,btn){
  criptoTab=tab;
  document.querySelectorAll('#ptCripto .reg-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const content=document.getElementById('criptoContent');
  const consultor=document.getElementById('criptoConsultor');
  if(content)content.style.display=tab==='consultor'?'none':'flex';
  if(consultor)consultor.style.display=tab==='consultor'?'block':'none';
  if(tab!=='consultor'){
    const data=CRIPTO_DATA[tab]||CRIPTO_DATA.cripto;
    content.innerHTML=data.map(d=>`<div class="cripto-scenario" onclick="toggleRegDetail('cs_${d.id}')">
      <div class="cripto-scenario-title">${d.titulo}</div>
      <div class="cripto-scenario-desc">${d.desc}</div>
      <div class="cripto-detail" id="detail_cs_${d.id}">${d.detalle||''}
        <button class="reg-ask-btn" style="border-color:#9B59B6;color:#9B59B6;margin-top:10px" onclick="askAboutRegulation(event,'Fiscalidad digital: ${d.titulo.replace(/'/g,"\\'")}')" >ğŸ’¬ Consultar IA</button>
      </div>
    </div>`).join('');
  }
}

// â”€â”€ COMPARADO â”€â”€
let comparadoTab='latam';
function setComparadoTab(tab,btn){
  comparadoTab=tab;
  document.querySelectorAll('#ptComparado .reg-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const content=document.getElementById('comparadoContent');
  const consultor=document.getElementById('comparadoConsultor');
  if(content)content.style.display=tab==='consultor'?'none':'block';
  if(consultor)consultor.style.display=tab==='consultor'?'block':'none';
  if(tab==='latam'&&content) renderComparadoLatam(content);
  if(tab==='europa'&&content) renderComparadoEuropa(content);
  if(tab==='ocde'&&content) renderComparadoOCDE(content);
}
function renderComparadoLatam(el){
  el.innerHTML=`<div class="comp-country-grid">`+
  COMPARADO_LATAM.map(c=>`<div class="comp-country-card">
    <div class="comp-country-flag">${c.pais.substring(0,4)}</div>
    <div class="comp-country-name">${c.pais.substring(4)}</div>
    <div class="comp-country-row"><span class="comp-country-lbl">IR corporativo</span><span class="comp-country-val ${c.highlight}">${c.ir_corp}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">IGV / IVA</span><span class="comp-country-val">${c.igv}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">Dividendos</span><span class="comp-country-val">${c.divid}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">Ganancias capital</span><span class="comp-country-val">${c.ganancia_cap}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">CDIs</span><span class="comp-country-val" style="font-size:14px;color:var(--muted)">${c.cdi}</span></div>
  </div>`).join('')+`</div>
  <p style="font-size:14px;color:var(--muted);margin-top:8px">ğŸ“Œ PerÃº tiene tasas competitivas de dividendos (5%) vs la regiÃ³n. El IR corporativo de 29.5% es mayor al promedio. Se destaca el bajo nÃºmero de CDIs (11) vs Chile (35+).</p>`;
}
function renderComparadoEuropa(el){
  el.innerHTML=`<div class="comp-country-grid">`+
  COMPARADO_EUROPA.map(c=>`<div class="comp-country-card">
    <div class="comp-country-flag">${c.pais.substring(0,4)}</div>
    <div class="comp-country-name">${c.pais.substring(4)}</div>
    <div class="comp-country-row"><span class="comp-country-lbl">IR corporativo</span><span class="comp-country-val ${c.highlight}">${c.ir_corp}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">IGV / IVA</span><span class="comp-country-val">${c.igv}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">Dividendos</span><span class="comp-country-val">${c.divid}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">Ganancias capital</span><span class="comp-country-val">${c.ganancia_cap}</span></div>
    <div class="comp-country-row"><span class="comp-country-lbl">CDI con PerÃº</span><span class="comp-country-val" style="font-size:14px;color:var(--green)">${c.cdi}</span></div>
  </div>`).join('')+`</div>
  <p style="font-size:14px;color:var(--muted);margin-top:8px">ğŸ’¡ EspaÃ±a es el paÃ­s europeo con mayor presencia de inversiÃ³n en PerÃº. El CDI PerÃº-EspaÃ±a (2014) reduce retenciones a 15% en dividendos, 15% en intereses y 10% en regalÃ­as.</p>`;
}
function renderComparadoOCDE(el){
  el.innerHTML=OCDE_BEPS.map(o=>`<div class="reg-card" style="margin-bottom:9px" onclick="toggleRegDetail('ocde_${o.num.replace(/ /g,'_')}')">
    <div class="reg-card-top"><div class="reg-card-title"><span style="font-size:14px;color:#3A86FF;font-weight:500;display:block;margin-bottom:3px">${o.num}</span>${o.titulo}</div><span class="reg-badge blue">${o.estado.startsWith('âœ…')?'Vigente':'En proceso'}</span></div>
    <div class="reg-card-desc">${o.desc}</div>
    <div class="reg-detail" id="detail_ocde_${o.num.replace(/ /g,'_')}">
      <h4>${o.titulo}</h4><div class="reg-detail-art">${o.desc}</div>
      <strong>Impacto en PerÃº:</strong> ${o.impacto}<br><br><strong>Estado:</strong> ${o.estado}
      <button class="reg-ask-btn" style="margin-top:10px" onclick="askAboutRegulation(event,'OCDE BEPS: ${o.titulo.replace(/'/g,"\\'")}')" >ğŸ’¬ Consultar IA</button>
    </div>
  </div>`).join('');
}

// â”€â”€ GENERIC AI CONSULTOR â”€â”€
async function consultRegAI(service){
  const textIds={rtf:'rtfConsultaText',sunafil:'sunafilConsultaText',cripto:'criptoConsultaText',comparado:'comparadoConsultaText'};
  const resultIds={rtf:'rtfConsultaResult',sunafil:'sunafilConsultaResult',cripto:'criptoConsultaResult',comparado:'comparadoConsultaResult'};
  const colors={rtf:'#E8A020',sunafil:'#E05050',cripto:'#9B59B6',comparado:'#3A86FF'};
  const systems={
    rtf:'Eres un especialista en jurisprudencia del Tribunal Fiscal peruano. Citas RTFs exactas y explicas su aplicaciÃ³n prÃ¡ctica.',
    sunafil:'Eres un experto en derecho laboral y tributaciÃ³n de planilla peruana (EsSalud, AFP, ONP, CTS, gratificaciones, SUNAFIL). Citas normas exactas.',
    cripto:'Eres un especialista en fiscalidad digital y criptomonedas en PerÃº. Explicas el tratamiento del IR e IGV segÃºn los informes SUNAT vigentes.',
    comparado:'Eres un experto en derecho tributario internacional y comparado. Analizas diferencias entre sistemas tributarios latinoamericanos y europeos con enfoque en inversores peruanos.',
  };
  const query=document.getElementById(textIds[service])?.value?.trim()||'';
  if(!query){tpToast('Escribe una consulta.', 'warn');return;}
  const resultEl=document.getElementById(resultIds[service]);
  if(!resultEl)return;
  resultEl.style.display='block';
  resultEl.innerHTML=`<div style="color:var(--muted)">Consultando...</div>`;
  resultEl.style.borderColor=`rgba(${service==='rtf'?'232,160,32':service==='sunafil'?'224,80,80':service==='cripto'?'155,89,182':'58,134,255'},.25)`;
  if(!apiKey){resultEl.innerHTML=`<div style="color:var(--muted)">Conecta tu API Key para respuestas en tiempo real. Esta Ã¡rea cubre: ${systems[service].substring(0,80)}...</div>`;return;}
  try{
    const res=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:systems[service],messages:[{role:'user',content:query}]});
    const d=await res.json();
    const color=colors[service]||'var(--gold)';
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red)">Error: ${safeHTML(e.message)}</div>`;}
}

// â”€â”€ PATCH setPTab â”€â”€
const _origSetPTabV11=setPTab;
setPTab = function(tab,btn){
  _origSetPTabV11(tab,btn);
  if(tab==='rtf'){setRTFTab('rtfs',null);setTimeout(()=>document.querySelector('#ptRtf .reg-tab')?.classList.add('active'),50);}
  if(tab==='sunat_inf')renderRegList('sunatInfList',SUNAT_INF_DATA,'',siFilter,'#E8A020');
  if(tab==='sunafil'){setSunafilTab('normas',null);setTimeout(()=>document.querySelector('#ptSunafil .reg-tab')?.classList.add('active'),50);}
  if(tab==='indecopi')renderRegList('indecopiList',INDECOPI_DATA,'',indFilter,'#E05050');
  if(tab==='bcr'){renderBCRRates();setBCRTab('historico',null);setTimeout(()=>document.querySelector('#ptBcr .reg-tab')?.classList.add('active'),50);const hoy=new Date().toISOString().split('T')[0];const fi=document.getElementById('bcrFecha');if(fi&&!fi.value)fi.value=hoy;}
  if(tab==='zonas'){renderZonas('');}
  if(tab==='cripto'){setCriptoTab('cripto',null);setTimeout(()=>document.querySelector('#ptCripto .reg-tab')?.classList.add('active'),50);}
  if(tab==='comparado'){setComparadoTab('latam',null);setTimeout(()=>document.querySelector('#ptComparado .reg-tab')?.classList.add('active'),50);}
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MÃ“DULO PRECIOS DE TRANSFERENCIA
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const UIT = 5500

// â”€â”€ Tab switching â”€â”€
function setPTTab(tab, btn) {
  document.querySelectorAll('.pt-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['ptUmbrales','ptMetodo','ptFra','ptIqr','ptChecklist','ptLocalfile','ptInforme_pt'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const map = { umbrales:'ptUmbrales', metodo:'ptMetodo', fra:'ptFra', iqr:'ptIqr',
    checklist:'ptChecklist', localfile:'ptLocalfile', informe_pt:'ptInforme_pt' };
  const el = document.getElementById(map[tab]); if (el) el.style.display = 'block';
  if (tab === 'checklist') renderChecklist();
  if (tab === 'iqr' && !document.getElementById('iqrCompsList').children.length) initIQR();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1. DETECTOR DE UMBRALES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function calcUmbrales() {
  const ing = parseFloat(document.getElementById('umbIngresos')?.value) || 0;
  const transTotal = parseFloat(document.getElementById('umbTransTotal')?.value) || 0;
  const paraiso = parseFloat(document.getElementById('umbParaiso')?.value) || 0;
  const grupo = document.getElementById('umbGrupo')?.value === 'si';
  const grid = document.getElementById('umbralGrid');
  const resumen = document.getElementById('umbralResumen');
  if (!ing && !transTotal) { grid.style.display = 'none'; resumen.style.display = 'none'; return; }
  const fmtS = n => 'S/ ' + n.toLocaleString();
  // Umbrales D.S. 008-2023-EF
  const U_LF_ING = 2300000;    // > S/2.3M ingresos
  const U_LF_TRANS = 400000;   // > S/400K en transacciones
  const U_MF = 270000000;      // > S/270M ingresos grupo (â‰ˆ EUR 60M)
  const U_CBC = 3375000000;    // > S/3.375B ingresos grupo (â‰ˆ EUR 750M)
  const U_PARAISO = 100000;    // Cualquier monto con paraÃ­sos
  const lf_req = (ing > U_LF_ING && transTotal > U_LF_TRANS) || paraiso > U_PARAISO;
  const mf_req = grupo && ing > U_MF;
  const cbc_req = grupo && ing > U_CBC;
  const decl_req = ing > U_LF_ING || transTotal > U_LF_TRANS;
  const pctLF_ing = Math.min((ing / U_LF_ING) * 100, 100);
  const pctLF_trans = Math.min((transTotal / U_LF_TRANS) * 100, 100);
  const items = [
    { title:'DeclaraciÃ³n Jurada PT â€” Form. 3560', key:'dj', req: decl_req,
      threshold:`Ingresos > ${fmtS(U_LF_ING)} O transacciones vinculadas > ${fmtS(U_LF_TRANS)}`,
      detail:`PresentaciÃ³n anual a SUNAT. Plazo: hasta el dÃ©cimo mes del ejercicio siguiente. El incumplimiento genera multa del 0.6% de ingresos (mÃ­n. 10 UIT).`,
      pct: Math.max(pctLF_ing, pctLF_trans) },
    { title:'Local File (Expediente TÃ©cnico)', key:'lf', req: lf_req,
      threshold:`Ingresos > ${fmtS(U_LF_ING)} Y transacciones > ${fmtS(U_LF_TRANS)}. O cualquier monto con paraÃ­sos fiscales.`,
      detail:`DocumentaciÃ³n completa: anÃ¡lisis funcional, selecciÃ³n de mÃ©todo, anÃ¡lisis de comparabilidad y rango IQR. Presentar ante requerimiento de SUNAT.`,
      pct: Math.min(((ing/U_LF_ING + transTotal/U_LF_TRANS)/2)*100, 100) },
    { title:'Master File (Informe Maestro)', key:'mf', req: mf_req,
      threshold:`Grupo con ingresos consolidados > ${fmtS(U_MF)} aprox. (â‰ˆ EUR 60M)`,
      detail:`DescripciÃ³n global del grupo: estructura organizacional, polÃ­tica de PT del grupo, activos intangibles, actividades financieras intragrupo y posiciones financieras y tributarias globales.`,
      pct: grupo ? Math.min((ing/U_MF)*100, 100) : 0 },
    { title:'Country-by-Country Report (CbCR)', key:'cbc', req: cbc_req,
      threshold:`Grupo con ingresos consolidados > ${fmtS(U_CBC)} aprox. (â‰ˆ EUR 750M)`,
      detail:`Informe paÃ­s por paÃ­s con ingresos, utilidades, impuestos pagados y nÃºmero de empleados por jurisdicciÃ³n. La casa matriz lo presenta; la filial peruana notifica quiÃ©n presenta.`,
      pct: grupo ? Math.min((ing/U_CBC)*100, 100) : 0 },
  ];
  grid.style.display = 'grid';
  grid.innerHTML = items.map(it => {
    const cls = it.req ? 'required' : (it.pct > 50 ? 'optional' : 'na');
    const icon = it.req ? 'ğŸ”´ OBLIGATORIO' : (it.pct > 50 ? 'ğŸŸ¡ VERIFICAR' : 'ğŸŸ¢ No aplica');
    const fillColor = it.req ? 'var(--red)' : it.pct > 50 ? 'var(--gold)' : 'var(--green)';
    return `<div class="umbral-card ${cls}">
      <div class="umbral-card-title">${it.title}</div>
      <div class="umbral-card-threshold">${it.threshold}</div>
      <div class="umbral-card-status">${icon}</div>
      <div class="umbral-progress"><div class="umbral-progress-fill" style="width:${it.pct}%;background:${fillColor}"></div></div>
      <div class="umbral-detail">${it.detail}</div>
    </div>`;
  }).join('');
  const obligaciones = items.filter(i => i.req).map(i => i.title);
  resumen.style.display = 'block';
  resumen.innerHTML = obligaciones.length
    ? `<strong style="color:var(--red)">âš ï¸ Obligaciones aplicables:</strong><br>${obligaciones.map(o=>`â€¢ ${o}`).join('<br>')}<br><br><span style="color:var(--muted)">Base legal: Art. 32-A(k) LIR y D.S. 008-2023-EF. Consulta con tu asesor de PT para confirmar.</span>`
    : `<strong style="color:var(--green)">âœ… No se identifican obligaciones de documentaciÃ³n formal en este ejercicio.</strong><br><span style="color:var(--muted)">Sin embargo, debes conservar documentaciÃ³n que sustente el valor de mercado de todas las transacciones con vinculadas.</span>`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 2. SELECTOR DE MÃ‰TODO PT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const METODOS_PT = [
  { acr:'PCNC', nombre:'Precio Comparable No Controlado', desc:'Compara el precio de la transacciÃ³n controlada con el precio de una transacciÃ³n comparable entre independientes.',
    aplica:['compraventa_bienes','cesion_intangibles','prestamos_financieros'],
    requiere:'Comparables idÃ©nticos o muy similares (internos o externos). Ajustes mÃ­nimos de comparabilidad.' },
  { acr:'PRR', nombre:'Precio de Reventa', desc:'Se parte del precio al que el distribuidor revende el bien a un independiente y se deduce el margen bruto apropiado.',
    aplica:['distribucion','compraventa_bienes'],
    requiere:'El distribuidor agrega poco valor (sin transformaciÃ³n). Funciones limitadas.' },
  { acr:'PC', nombre:'Precio de Costo Adicionado', desc:'Se parte del costo del proveedor y se adiciona un margen bruto apropiado. Ãštil para manufactura y servicios.',
    aplica:['manufactura_contrato','prestacion_servicios'],
    requiere:'Fabricante o prestador de servicios de riesgo limitado. Costos bien definidos.' },
  { acr:'TNMM', nombre:'Margen Neto de la TransacciÃ³n', desc:'Compara el margen operativo neto de la parte analizada con el de comparables independientes. MÃ©todo mÃ¡s flexible.',
    aplica:['distribucion','manufactura_contrato','prestacion_servicios','holding'],
    requiere:'Comparables externos de bases de datos. Menor exigencia de comparabilidad que los mÃ©todos tradicionales.' },
  { acr:'MCU', nombre:'Margen de ContribuciÃ³n / DivisiÃ³n de Utilidades', desc:'Divide la utilidad conjunta entre las partes en funciÃ³n de su contribuciÃ³n relativa. Para intangibles valiosos Ãºnicos.',
    aplica:['cesion_intangibles'],
    requiere:'Intangibles Ãºnicos y valiosos donde no existen comparables. AnÃ¡lisis de contribuciÃ³n muy documentado.' },
];

function evaluarMetodo() {
  const tipo = document.getElementById('metTipo')?.value || '';
  const compInt = document.getElementById('metCompInt')?.value || 'no';
  const riesgos = document.getElementById('metRiesgos')?.value || 'alto';
  const datos = document.getElementById('metDatos')?.value || 'limitado';
  const margen = parseFloat(document.getElementById('metMargen')?.value) || null;
  if (!tipo) { document.getElementById('metodoResult').style.display = 'none'; return; }
  // Score each method
  const scores = METODOS_PT.map(m => {
    let score = 0;
    if (m.aplica.includes(tipo)) score += 3;
    if (m.acr === 'PCNC' && (compInt === 'si_identicos' || compInt === 'si_similares')) score += 3;
    if (m.acr === 'PRR' && tipo === 'distribucion' && riesgos === 'bajo') score += 2;
    if (m.acr === 'PC' && tipo === 'manufactura_contrato' && riesgos === 'bajo') score += 2;
    if (m.acr === 'TNMM' && datos !== 'ninguno') score += 2;
    if (m.acr === 'MCU' && tipo === 'cesion_intangibles' && datos === 'ninguno') score += 2;
    if (m.acr === 'TNMM' && riesgos === 'bajo') score += 1;
    return { ...m, score };
  }).sort((a,b) => b.score - a.score);
  const top = scores[0];
  const res = document.getElementById('metodoResult');
  res.style.display = 'block';
  res.innerHTML = `
    <div style="font-size:14px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.07em">Resultado del anÃ¡lisis â€” MÃ©todo recomendado:</div>
    ${scores.map((m, i) => {
      const cls = i===0?'recommended':m.score>2?'viable':'not-recommended';
      const badge = i===0?'rec':m.score>2?'via':'no';
      const bdgTxt = i===0?'âœ… Recomendado':m.score>2?'Viable':'No recomendado';
      const dots = Array(5).fill(0).map((_,j)=>j<m.score?'<div class="metodo-dot on"></div>':'<div class="metodo-dot off"></div>').join('');
      const just = m.acr==='PCNC'&&i===0?`Aplica por ${compInt==='si_identicos'?'existencia de comparables internos idÃ©nticos':'existencia de comparables similares ajustables'}. Primer mÃ©todo jerÃ¡rquico preferido segÃºn Art. 32-A(e) LIR y GuÃ­a OCDE pÃ¡rr. 2.14.`:
        m.acr==='TNMM'&&i===0?`MÃ©todo mÃ¡s robusto para transacciones de ${tipo} cuando no hay comparables internos. Menor sensibilidad a diferencias de comparabilidad. Ampliamente aceptado por SUNAT en fiscalizaciones (RTF 02254-5-2014).`:
        m.acr==='PRR'&&i===0?`IdÃ³neo para distribuidores que no transforman los bienes. Se analiza el margen bruto del revendedor y se compara con el de distribuidores independientes similares.`:
        m.acr==='PC'&&i===0?`Para fabricantes/prestadores de servicios de riesgo limitado. Se determina el costo y se agrega un margen de utilidad bruta comparable al de empresas similares independientes.`:
        `${m.aplica.includes(tipo)?'Aplica para este tipo de transacciÃ³n.':'No es el mÃ©todo mÃ¡s apropiado para este tipo de transacciÃ³n.'} ${m.requiere}`;
      return `<div class="metodo-card ${cls}">
        <div class="metodo-card-header">
          <div><div class="metodo-name">${m.acr} â€” ${m.nombre}</div><div class="metodo-acr">${m.requiere.substring(0,80)}...</div><div class="metodo-score-bar">${dots}</div></div>
          <span class="metodo-badge ${badge}">${bdgTxt}</span>
        </div>
        <div class="metodo-justificacion">${just}</div>
      </div>`;
    }).join('')}
    <p style="font-size:14px;color:var(--muted);margin-top:8px">Art. 32-A(e) LIR: Los mÃ©todos se aplican siguiendo el principio de mejor mÃ©todo (best method rule). No existe jerarquÃ­a rÃ­gida â€” se elige el que produzca la medida mÃ¡s confiable del resultado arm's length.</p>`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 3. ANÃLISIS F/R/A
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const FRA_TEMPLATES = {
  distribucion: {
    funciones:[
      {fn:'Compra de mercaderÃ­as',A:'Alta',B:'Baja'},
      {fn:'DistribuciÃ³n y logÃ­stica',A:'Alta',B:'Baja'},
      {fn:'Ventas y marketing',A:'Alta',B:'Media'},
      {fn:'GestiÃ³n de crÃ©dito y cobranza',A:'Alta',B:'Nula'},
      {fn:'InvestigaciÃ³n y desarrollo',A:'Baja',B:'Alta'},
      {fn:'ProducciÃ³n / manufactura',A:'Nula',B:'Alta'},
      {fn:'Funciones administrativas',A:'Media',B:'Media'},
    ],
    riesgos:[
      {rsg:'Riesgo de mercado (precio, demanda)',A:'Media',B:'Baja'},
      {rsg:'Riesgo de inventario',A:'Alta',B:'Nula'},
      {rsg:'Riesgo de crÃ©dito / incobrables',A:'Alta',B:'Nula'},
      {rsg:'Riesgo cambiario',A:'Media',B:'Media'},
      {rsg:'Riesgo de responsabilidad por producto',A:'Baja',B:'Alta'},
      {rsg:'Riesgo regulatorio / laboral',A:'Alta',B:'Baja'},
    ],
    activos:[
      {act:'Inventarios',A:'Alta',B:'Baja'},
      {act:'Cuentas por cobrar',A:'Alta',B:'Nula'},
      {act:'Red de distribuciÃ³n / clientes',A:'Alta',B:'Baja'},
      {act:'Marcas y propiedad intelectual',A:'Baja',B:'Alta'},
      {act:'FÃ³rmulas / conocimiento tÃ©cnico',A:'Nula',B:'Alta'},
      {act:'Activos fijos productivos',A:'Baja',B:'Alta'},
    ],
    perfil:'Distribuidor de riesgo limitado (Limited Risk Distributor â€” LRD)',
    metodoSug:'Precio de Reventa (PRR) o TNMM con margen neto sobre ventas',
  },
  manufactura: {
    funciones:[{fn:'Manufactura / transformaciÃ³n',A:'Alta',B:'Baja'},{fn:'Control de calidad',A:'Alta',B:'Media'},{fn:'Compra de insumos',A:'Media',B:'Alta'},{fn:'DiseÃ±o de producto',A:'Baja',B:'Alta'},{fn:'LogÃ­stica de salida',A:'Baja',B:'Alta'},{fn:'Ventas y marketing',A:'Nula',B:'Alta'},{fn:'I+D tecnologÃ­a productiva',A:'Baja',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de capacidad productiva',A:'Media',B:'Baja'},{rsg:'Riesgo de inventario de insumos',A:'Media',B:'Alta'},{rsg:'Riesgo de calidad / devoluciones',A:'Alta',B:'Baja'},{rsg:'Riesgo de obsolescencia tecnolÃ³gica',A:'Baja',B:'Alta'},{rsg:'Riesgo laboral',A:'Alta',B:'Baja'},{rsg:'Riesgo de mercado final',A:'Nula',B:'Alta'}],
    activos:[{act:'Planta y maquinaria',A:'Alta',B:'Baja'},{act:'Know-how productivo',A:'Media',B:'Alta'},{act:'Patentes de proceso',A:'Baja',B:'Alta'},{act:'Fuerza laboral especializada',A:'Alta',B:'Media'},{act:'Marca comercial',A:'Nula',B:'Alta'}],
    perfil:'Fabricante por contrato (Contract Manufacturer)',
    metodoSug:'Precio de Costo Adicionado (PC) o TNMM con margen sobre costos totales (ROTC)',
  },
  servicios: {
    funciones:[{fn:'PrestaciÃ³n del servicio principal',A:'Alta',B:'Nula'},{fn:'GestiÃ³n de personal',A:'Alta',B:'Baja'},{fn:'Desarrollo de metodologÃ­as',A:'Media',B:'Alta'},{fn:'RelaciÃ³n con el cliente',A:'Alta',B:'Baja'},{fn:'FacturaciÃ³n y cobranza',A:'Alta',B:'Nula'},{fn:'Soporte tecnolÃ³gico',A:'Media',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de crÃ©dito',A:'Alta',B:'Nula'},{rsg:'Riesgo de calidad del servicio',A:'Alta',B:'Baja'},{rsg:'Riesgo laboral',A:'Alta',B:'Baja'},{rsg:'Riesgo de confidencialidad',A:'Alta',B:'Media'}],
    activos:[{act:'Capital humano especializado',A:'Alta',B:'Media'},{act:'MetodologÃ­as propietarias',A:'Media',B:'Alta'},{act:'Software / herramientas',A:'Media',B:'Alta'},{act:'Base de clientes',A:'Alta',B:'Baja'}],
    perfil:'Prestador de servicios de riesgo limitado (Low Value-Adding Services)',
    metodoSug:'TNMM con margen neto sobre ventas o PC (costo + margen)',
  },
  licencia: {
    funciones:[{fn:'Desarrollo original del intangible',A:'Nula',B:'Alta'},{fn:'Mantenimiento y actualizaciÃ³n',A:'Baja',B:'Alta'},{fn:'ExplotaciÃ³n comercial',A:'Alta',B:'Baja'},{fn:'Marketing local',A:'Alta',B:'Baja'},{fn:'ProtecciÃ³n legal (registro)',A:'Baja',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de obsolescencia del intangible',A:'Baja',B:'Alta'},{rsg:'Riesgo de desarrollo (I+D)',A:'Nula',B:'Alta'},{rsg:'Riesgo de mercado local',A:'Alta',B:'Baja'},{rsg:'Riesgo de infracciÃ³n IP',A:'Media',B:'Alta'}],
    activos:[{act:'Intangible licenciado (marca/patente)',A:'Nula',B:'Alta'},{act:'Know-how asociado',A:'Baja',B:'Alta'},{act:'Red de distribuciÃ³n local',A:'Alta',B:'Baja'},{act:'Relaciones con clientes',A:'Alta',B:'Baja'}],
    perfil:'Licenciatario de intangibles (IP Licensee)',
    metodoSug:'PCNC (comparables de royalties) o TNMM con margen neto. Para intangibles Ãºnicos: DivisiÃ³n de Utilidades (MCU)',
  },
  prestamo: {
    funciones:[{fn:'Otorgamiento del prÃ©stamo',A:'Nula',B:'Alta'},{fn:'GestiÃ³n de la tesorerÃ­a',A:'Baja',B:'Alta'},{fn:'Uso de los fondos',A:'Alta',B:'Nula'},{fn:'Reembolso del capital',A:'Alta',B:'Nula'}],
    riesgos:[{rsg:'Riesgo crediticio',A:'Nula',B:'Alta'},{rsg:'Riesgo cambiario',A:'Media',B:'Media'},{rsg:'Riesgo de liquidez',A:'Alta',B:'Baja'},{rsg:'Riesgo de tasa de interÃ©s',A:'Media',B:'Media'}],
    activos:[{act:'Capital financiero prestado',A:'Nula',B:'Alta'},{act:'Activos financiados',A:'Alta',B:'Nula'}],
    perfil:'Deudor intragrupo (Intragroup Borrower)',
    metodoSug:'PCNC â€” Tasa de interÃ©s comparable de mercado. Referencia: tasas LIBOR/SOFR + spread crediticio o tasas de crÃ©dito local comparable.',
  },
  holding: {
    funciones:[{fn:'Funciones de holding/control',A:'Nula',B:'Alta'},{fn:'RecepciÃ³n de servicios centralizados',A:'Alta',B:'Nula'},{fn:'Finanzas corporativas',A:'Baja',B:'Alta'},{fn:'RR.HH. corporativos',A:'Baja',B:'Alta'},{fn:'Cumplimiento normativo',A:'Media',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de gestiÃ³n del grupo',A:'Nula',B:'Alta'},{rsg:'Riesgo por servicios no adecuados',A:'Alta',B:'Baja'},{rsg:'Riesgo regulatorio',A:'Media',B:'Alta'}],
    activos:[{act:'Personal local receptor',A:'Alta',B:'Baja'},{act:'Sistemas y plataformas',A:'Baja',B:'Alta'},{act:'MetodologÃ­as de servicio',A:'Nula',B:'Alta'}],
    perfil:'Receptor de servicios intragrupo de bajo valor aÃ±adido (Low-Value Adding Services)',
    metodoSug:'PC o TNMM. Para LVAS: margen del 5% sobre costos segÃºn safe harbor OCDE pÃ¡rr. 7.61',
  },
};

function generarFRA() {
  const partA = document.getElementById('fraPartA')?.value?.trim() || 'Parte Analizada';
  const partB = document.getElementById('fraPartB')?.value?.trim() || 'Parte Vinculada';
  const tipo = document.getElementById('fraTipo')?.value || 'distribucion';
  const tpl = FRA_TEMPLATES[tipo] || FRA_TEMPLATES.distribucion;
  const lvl = {Alta:'high',Media:'med',Baja:'low',Nula:'none'};
  const el = document.getElementById('fraResult');
  const loading = document.getElementById('fraLoading');
  loading.style.display = 'block'; el.style.display = 'none';
  setTimeout(() => {
    loading.style.display = 'none'; el.style.display = 'block';
    el.innerHTML = `
      <div style="font-size:14px;color:rgba(155,89,182,.9);font-weight:500;margin-bottom:12px;text-transform:uppercase;letter-spacing:.08em">Perfil de la Parte Analizada: ${tpl.perfil}</div>
      <div class="fra-section">
        <div class="fra-section-title">âš™ï¸ Funciones
          <div style="display:flex;gap:8px;margin-left:auto;font-size:14px"><span style="background:rgba(230,57,70,.1);padding:2px 8px;border-radius:5px;color:var(--red)">Alta</span><span style="background:rgba(201,168,76,.1);padding:2px 8px;border-radius:5px;color:var(--gold)">Media</span><span style="background:rgba(76,175,80,.08);padding:2px 8px;border-radius:5px;color:var(--green)">Baja</span><span style="background:rgba(144,144,168,.08);padding:2px 8px;border-radius:5px;color:var(--muted)">Nula</span></div>
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr 80px 80px;gap:0;font-size:14px;color:var(--muted);padding:4px 0;margin-bottom:4px"><span></span><span></span><span style="text-align:center;padding:0 4px">${partA.substring(0,18)}</span><span style="text-align:center;padding:0 4px">${partB.substring(0,18)}</span></div>
        ${tpl.funciones.map(f=>`<div class="fra-item"><span style="font-size:8px;color:var(--muted);margin-top:3px">â–¸</span><span class="fra-item-name">${f.fn}</span><span class="fra-item-left ${lvl[f.A]}">${f.A}</span><span class="fra-item-right ${lvl[f.B]}">${f.B}</span></div>`).join('')}
      </div>
      <div class="fra-section">
        <div class="fra-section-title">âš ï¸ Riesgos asumidos</div>
        <div style="display:grid;grid-template-columns:auto 1fr 80px 80px;gap:0;font-size:14px;color:var(--muted);padding:4px 0;margin-bottom:4px"><span></span><span></span><span style="text-align:center;padding:0 4px">${partA.substring(0,18)}</span><span style="text-align:center;padding:0 4px">${partB.substring(0,18)}</span></div>
        ${tpl.riesgos.map(r=>`<div class="fra-item"><span style="font-size:8px;color:var(--muted);margin-top:3px">â–¸</span><span class="fra-item-name">${r.rsg}</span><span class="fra-item-left ${lvl[r.A]}">${r.A}</span><span class="fra-item-right ${lvl[r.B]}">${r.B}</span></div>`).join('')}
      </div>
      <div class="fra-section">
        <div class="fra-section-title">ğŸ¦ Activos empleados</div>
        <div style="display:grid;grid-template-columns:auto 1fr 80px 80px;gap:0;font-size:14px;color:var(--muted);padding:4px 0;margin-bottom:4px"><span></span><span></span><span style="text-align:center;padding:0 4px">${partA.substring(0,18)}</span><span style="text-align:center;padding:0 4px">${partB.substring(0,18)}</span></div>
        ${tpl.activos.map(a=>`<div class="fra-item"><span style="font-size:8px;color:var(--muted);margin-top:3px">â–¸</span><span class="fra-item-name">${a.act}</span><span class="fra-item-left ${lvl[a.A]}">${a.A}</span><span class="fra-item-right ${lvl[a.B]}">${a.B}</span></div>`).join('')}
      </div>
      <div style="background:rgba(155,89,182,.07);border:1px solid rgba(155,89,182,.2);border-radius:9px;padding:12px 14px;font-size:14px;margin-top:6px">
        <strong style="color:#C39CE0">ConclusiÃ³n del anÃ¡lisis F/R/A:</strong><br>
        <strong>${partA}</strong> opera como <em>${tpl.perfil}</em>. La parte analizada realiza las funciones operativas principales con riesgo limitado en las Ã¡reas estratÃ©gicas. La remuneraciÃ³n arm's length debe reflejar este perfil funcional.<br>
        <strong>MÃ©todo sugerido:</strong> ${tpl.metodoSug}.<br>
        <strong>Base legal:</strong> Art. 32-A(c) LIR; GuÃ­as OCDE 2022, CapÃ­tulo I, SecciÃ³n D (anÃ¡lisis de comparabilidad).
      </div>`;
  }, 800);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 4. RANGO INTERCUARTIL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let iqrComps = [];
function initIQR() {
  iqrComps = [null, null, null, null, null, null];
  renderIQRComps();
}
function addIQRComp() {
  if (iqrComps.length >= 20) { tpToast('MÃ¡ximo 20 comparables.', 'error'); return; }
  iqrComps.push(null);
  renderIQRComps();
}
function renderIQRComps() {
  const el = document.getElementById('iqrCompsList'); if (!el) return;
  el.innerHTML = iqrComps.map((v, i) => `<div class="iqr-comparable-row">
    <span class="iqr-comp-lbl">Comparable ${i+1}</span>
    <input class="iqr-comp-inp" type="number" step="0.01" placeholder="ej: 12.5" value="${v||''}" oninput="iqrComps[${i}]=parseFloat(this.value)||null;calcIQR()">
    <button class="iqr-comp-del" onclick="iqrComps.splice(${i},1);renderIQRComps();calcIQR()">Ã—</button>
  </div>`).join('');
}
function calcIQR() {
  const vals = iqrComps.filter(v => v !== null && !isNaN(v)).sort((a,b) => a-b);
  const tested = parseFloat(document.getElementById('iqrTestedVal')?.value);
  const el = document.getElementById('iqrResult'); if (!el) return;
  if (vals.length < 3) { el.style.display = 'none'; return; }
  const n = vals.length;
  const q1Idx = (n-1)*0.25, q3Idx = (n-1)*0.75;
  const q1 = vals[Math.floor(q1Idx)] + (q1Idx%1)*(vals[Math.ceil(q1Idx)]-vals[Math.floor(q1Idx)]);
  const q3 = vals[Math.floor(q3Idx)] + (q3Idx%1)*(vals[Math.ceil(q3Idx)]-vals[Math.floor(q3Idx)]);
  const median = n%2===0 ? (vals[n/2-1]+vals[n/2])/2 : vals[Math.floor(n/2)];
  const mean = vals.reduce((a,b)=>a+b,0)/n;
  const minV = vals[0], maxV = vals[n-1];
  const inside = !isNaN(tested) && tested >= q1 && tested <= q3;
  const fmt = n => n.toFixed(2);
  el.style.display = 'block';
  const chartWidth = 100;
  const range = maxV - minV || 1;
  const q1Pct = ((q1-minV)/range)*chartWidth;
  const q3Pct = ((q3-minV)/range)*chartWidth;
  const medPct = ((median-minV)/range)*chartWidth;
  const testPct = !isNaN(tested) ? Math.max(0,Math.min(100,((tested-minV)/range)*chartWidth)) : -1;
  el.innerHTML = `
    <div class="iqr-stats">
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--red)">${fmt(minV)}</div><div class="iqr-stat-l">MÃ­nimo</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--gold)">${fmt(q1)}</div><div class="iqr-stat-l">P25 (Q1)</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--green)">${fmt(median)}</div><div class="iqr-stat-l">Mediana</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--gold)">${fmt(q3)}</div><div class="iqr-stat-l">P75 (Q3)</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--red)">${fmt(maxV)}</div><div class="iqr-stat-l">MÃ¡ximo</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v">${n}</div><div class="iqr-stat-l">Comparables</div></div>
    </div>
    <div style="font-size:14px;color:var(--muted);margin-bottom:6px">Rango arm's length (P25â€“P75): <strong style="color:var(--green)">${fmt(q1)} â€” ${fmt(q3)}</strong></div>
    <div class="iqr-chart">
      <div class="iqr-axis"></div>
      <div class="iqr-range" style="left:${q1Pct}%;width:${q3Pct-q1Pct}%"></div>
      <div class="iqr-median" style="left:${medPct}%"><div class="iqr-label" style="color:var(--green)">Med ${fmt(median)}</div></div>
      <div class="iqr-label" style="left:${q1Pct}%;bottom:auto;top:-16px;color:var(--gold)">P25</div>
      <div class="iqr-label" style="left:${q3Pct}%;bottom:auto;top:-16px;color:var(--gold)">P75</div>
      ${testPct>=0?`<div class="iqr-tested ${inside?'inside':'outside'}" style="left:${testPct}%"><div class="iqr-label" style="color:${inside?'var(--green)':'var(--red)'};top:-28px;font-weight:500">â–¼ ${fmt(tested)}</div></div>`:''}
    </div>
    ${!isNaN(tested)?`<div class="iqr-verdict ${inside?'inside':'outside'}">
      ${inside?`âœ… La transacciÃ³n analizada (${fmt(tested)}) estÃ¡ DENTRO del rango arm's length (${fmt(q1)}â€“${fmt(q3)}). No se requiere ajuste.`:`âš ï¸ La transacciÃ³n analizada (${fmt(tested)}) estÃ¡ FUERA del rango arm's length. Se debe ajustar a ${tested<q1?'P25 = '+fmt(q1):'P75 = '+fmt(q3)}. Diferencia: ${fmt(Math.abs(tested-(tested<q1?q1:q3)))}.`}
    </div>`:''}
    <p style="font-size:14px;color:var(--muted);margin-top:8px">Base legal: Art. 32-A(e) LIR â€” El resultado arm's length se determina aplicando el mÃ©todo mÃ¡s apropiado dentro del rango intercuartil (P25-P75) de los comparables seleccionados.</p>`;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 5. CHECKLIST FISCALIZACIÃ“N PT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const CHECKLIST_PT = [
  { sec:'Obligaciones formales', items:[
    {t:'Formulario 3560 â€” DJ Anual PT presentada en plazo',r:'alto'},{t:'Todos los campos del Form. 3560 correctamente completados',r:'alto'},{t:'DeclaraciÃ³n rectificatoria presentada si hubo errores',r:'medio'},{t:'Local File archivado en forma impresa y digital',r:'alto'},{t:'Master File disponible si aplica',r:'medio'},
  ]},
  { sec:'AnÃ¡lisis de comparabilidad', items:[
    {t:'AnÃ¡lisis de comparabilidad actualizado al cierre del ejercicio',r:'alto'},{t:'Fuente de comparables documentada (BvD, TP Catalyst, etc.)',r:'alto'},{t:'Criterios de bÃºsqueda de comparables documentados',r:'alto'},{t:'Ajustes de comparabilidad realizados y documentados',r:'medio'},{t:'Rango intercuartil calculado y archivado',r:'alto'},{t:'Los comparables son del mismo aÃ±o fiscal o ciclo econÃ³mico',r:'medio'},
  ]},
  { sec:'DocumentaciÃ³n de transacciones', items:[
    {t:'Contratos escritos para cada tipo de transacciÃ³n intragrupo',r:'alto'},{t:'Los contratos estÃ¡n vigentes y firmados por representantes legales',r:'alto'},{t:'Comprobantes de pago emitidos por cada transacciÃ³n',r:'alto'},{t:'Medios de pago bancarizados para pagos â‰¥ S/2,000',r:'alto'},{t:'Retenciones de IR a no domiciliados declaradas y pagadas',r:'alto'},{t:'El precio pactado coincide con el precio declarado en Form. 3560',r:'alto'},
  ]},
  { sec:'AnÃ¡lisis funcional', items:[
    {t:'AnÃ¡lisis F/R/A documentado para cada parte en cada transacciÃ³n',r:'medio'},{t:'Perfil funcional de la parte analizada claramente definido',r:'medio'},{t:'MÃ©todo PT seleccionado con justificaciÃ³n escrita',r:'alto'},{t:'Consistencia entre el mÃ©todo y el perfil funcional',r:'alto'},
  ]},
  { sec:'Intangibles y servicios intragrupo', items:[
    {t:'Los servicios intragrupo pasan el "benefit test" (beneficio real)',r:'alto'},{t:'Los royalties tienen sustento de uso real del intangible en PerÃº',r:'alto'},{t:'Los intangibles estÃ¡n registrados en INDECOPI si corresponde',r:'bajo'},{t:'Los servicios LVAS se aplica margen del 5% si corresponde',r:'bajo'},
  ]},
  { sec:'Precios de Transferencia financieros', items:[
    {t:'Los prÃ©stamos intragrupo tienen contratos formales',r:'alto'},{t:'La tasa de interÃ©s estÃ¡ en el rango de mercado',r:'alto'},{t:'Ratio deuda/patrimonio cumple lÃ­mite de subcapitalizaciÃ³n (3:1)',r:'alto'},{t:'Los intereses pagados a no domiciliados tienen sustento de tasa de mercado',r:'medio'},
  ]},
];
let chkState = {};
function renderChecklist() {
  const el = document.getElementById('chkContainer'); if (!el) return;
  el.innerHTML = CHECKLIST_PT.map((sec, si) => `
    <div class="chk-section">
      <div class="chk-section-title">${sec.sec}<span style="font-size:14px;color:var(--muted)" id="chkSec${si}Count"></span></div>
      ${sec.items.map((item, ii) => {
        const key = `${si}_${ii}`;
        const checked = chkState[key] || false;
        return `<div class="chk-item" onclick="toggleChk('${key}')">
          <div class="chk-check ${checked?'checked':'risk-'+item.r}" id="chk_${key}">${checked?'âœ“':''}</div>
          <span class="chk-item-text">${item.t}</span>
          <span class="chk-risk ${item.r}">${item.r.toUpperCase()}</span>
        </div>`;
      }).join('')}
    </div>`).join('');
  updateChkScore();
}
function toggleChk(key) {
  chkState[key] = !chkState[key];
  const el = document.getElementById('chk_' + key);
  if (el) { el.classList.toggle('checked', chkState[key]); el.textContent = chkState[key] ? 'âœ“' : ''; }
  updateChkScore();
}
function updateChkScore() {
  const total = CHECKLIST_PT.reduce((s,sec)=>s+sec.items.length,0);
  const checked = Object.values(chkState).filter(Boolean).length;
  const pct = Math.round((checked/total)*100);
  const pctEl = document.getElementById('chkPct'); if(pctEl) pctEl.textContent = pct + '%';
  const fill = document.getElementById('chkFill');
  if(fill){fill.style.width=pct+'%';fill.style.background=pct>=80?'var(--green)':pct>=50?'var(--gold)':'var(--red)';}
  // Alto risk unchecked items
  let altoUnchecked = 0;
  CHECKLIST_PT.forEach((sec,si) => sec.items.forEach((item,ii) => { if(item.r==='alto' && !chkState[`${si}_${ii}`]) altoUnchecked++; }));
}
function resetChecklist() { chkState = {}; renderChecklist(); }

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 6. LOCAL FILE GENERATOR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function generarLocalFile() {
  const empresa = document.getElementById('lfEmpresa')?.value?.trim() || 'Empresa';
  const ruc = document.getElementById('lfRuc')?.value?.trim() || 'â€”';
  const anio = document.getElementById('lfAnio')?.value || '2024';
  const sector = document.getElementById('lfSector')?.value?.trim() || 'â€”';
  const negocio = document.getElementById('lfNegocio')?.value?.trim() || 'â€”';
  const grupo = document.getElementById('lfGrupo')?.value?.trim() || 'â€”';
  const matriz = document.getElementById('lfMatriz')?.value?.trim() || 'â€”';
  const particip = document.getElementById('lfParticip')?.value?.trim() || 'â€”';
  const trans = document.getElementById('lfTransacciones')?.value?.trim() || 'â€”';
  const metodo = document.getElementById('lfMetodo')?.value || 'TNMM';
  const pli = document.getElementById('lfPLI')?.value || 'NCP';
  const valorPLI = document.getElementById('lfValorPLI')?.value || 'â€”';
  const fuente = document.getElementById('lfFuente')?.value || 'Bureau van Dijk (Orbis)';
  const nComp = document.getElementById('lfNComp')?.value || 'â€”';
  const p25 = document.getElementById('lfP25')?.value || 'â€”';
  const p75 = document.getElementById('lfP75')?.value || 'â€”';
  const conclu = document.getElementById('lfConclu')?.value || 'dentro';
  const loading = document.getElementById('lfLoading');
  const preview = document.getElementById('lfPreview');
  const actions = document.getElementById('lfActions');
  loading.style.display = 'block'; preview.style.display = 'none'; if(actions) actions.style.display = 'none';

  if (!apiKey) {
    loading.style.display = 'none';
    preview.style.display = 'block';
    if(actions) actions.style.display = 'flex';
    preview.innerHTML = buildLocalFileHTML(empresa,ruc,anio,sector,negocio,grupo,matriz,particip,trans,metodo,pli,valorPLI,fuente,nComp,p25,p75,conclu, 'DEMO â€” Conecta tu API Key para generar el contenido completo redactado por IA.');
    return;
  }
  try {
    const prompt = `Redacta el contenido del Local File (Expediente TÃ©cnico de Precios de Transferencia) para el ejercicio ${anio} de ${empresa} (RUC ${ruc}).
Datos del grupo: ${grupo}. Matriz: ${matriz} (${particip}).
Negocio: ${negocio}.
Transacciones con vinculadas: ${trans}.
MÃ©todo seleccionado: ${metodo}. PLI: ${pli} = ${valorPLI}%.
Comparables: ${nComp} de ${fuente}. Rango P25=${p25}%, P75=${p75}%.
ConclusiÃ³n: ${conclu==='dentro'?'Dentro del rango arm\'s length':'Fuera del rango, se ajusta a P25/P75'}.

Redacta el texto completo de cada secciÃ³n del Local File segÃºn D.S. 008-2023-EF Anexo I:
1. DescripciÃ³n del grupo empresarial y estructura de propiedad
2. DescripciÃ³n de la actividad y estrategia empresarial de la parte analizada
3. DescripciÃ³n de las transacciones con partes vinculadas
4. AnÃ¡lisis funcional (funciones, riesgos y activos de cada parte)
5. SelecciÃ³n del mÃ©todo de precios de transferencia con justificaciÃ³n
6. AnÃ¡lisis de comparabilidad y selecciÃ³n de comparables
7. DeterminaciÃ³n del rango arm's length y conclusiÃ³n

Usa lenguaje formal tÃ©cnico-jurÃ­dico. Cita artÃ­culos del Art. 32-A LIR y D.S. 008-2023-EF. MÃ¡ximo 800 palabras en total.`;
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:2000,system:'Eres un especialista en Precios de Transferencia peruano. Redactas Local Files formales segÃºn el D.S. 008-2023-EF con lenguaje tÃ©cnico-jurÃ­dico preciso.',messages:[{role:'user',content:prompt}]});
    const d = await res.json();
    const iaText = d.content?.[0]?.text || '';
    loading.style.display = 'none';
    preview.style.display = 'block';
    if(actions) actions.style.display = 'flex';
    preview.innerHTML = buildLocalFileHTML(empresa,ruc,anio,sector,negocio,grupo,matriz,particip,trans,metodo,pli,valorPLI,fuente,nComp,p25,p75,conclu,iaText);
  } catch(e) { loading.style.display='none'; preview.style.display='block'; preview.innerHTML = '<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>'; }
}

function buildLocalFileHTML(empresa,ruc,anio,sector,negocio,grupo,matriz,particip,trans,metodo,pli,valorPLI,fuente,nComp,p25,p75,conclu,iaContent) {
  return `<h2>LOCAL FILE â€” Expediente TÃ©cnico de Precios de Transferencia<br><span style="font-size:14px;font-weight:400">Ejercicio ${anio} | ${empresa} | RUC ${ruc}</span></h2>
  <div class="lf-box"><strong>Sector:</strong> ${sector} | <strong>Moneda:</strong> ${document.getElementById('lfMoneda')?.value||'PEN'} | <strong>MÃ©todo:</strong> ${metodo} | <strong>PLI:</strong> ${pli} = ${valorPLI}%</div>
  <div class="lf-box"><strong>Partes vinculadas:</strong> ${matriz} (${particip})</div>
  <div style="white-space:pre-wrap;margin-top:10px">${iaContent.replace(/\*\*(.*?)\*\*/g,'<strong style="color:#C39CE0">$1</strong>').replace(/^#{1,3} (.*$)/gm,'<h3>$1</h3>').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}</div>
  <div class="lf-box" style="margin-top:14px;background:rgba(155,89,182,.08);border-left:2px solid rgba(155,89,182,.4)"><strong>ConclusiÃ³n:</strong> La(s) transacciÃ³n(es) analizada(s) ${conclu==='dentro'?'se encuentran DENTRO del rango arm\'s length (P25='+p25+'% â€” P75='+p75+'%). No se requiere ajuste de PT para el ejercicio '+anio+'.':'estÃ¡n FUERA del rango arm\'s length. Se procede a ajustar al P25/P75 correspondiente.'}
  <br><strong>Fuente:</strong> ${fuente} | <strong>NÂº comparables:</strong> ${nComp}
  <br><strong>Base legal:</strong> Art. 32-A LIR; D.S. 008-2023-EF; GuÃ­as OCDE 2022.</div>`;
}

function exportLocalFile() {
  const empresa = document.getElementById('lfEmpresa')?.value || 'Empresa';
  const content = document.getElementById('lfPreview')?.innerHTML || '';
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Local File PT â€” ${empresa}</title><style>body{font-family:'Times New Roman',serif;max-width:750px;margin:40px auto;color:#1a1a2e;line-height:1.8;font-size:14px}.header{background:#1a1a2e;color:#C39CE0;padding:24px;border-radius:6px;margin-bottom:24px}h2{font-size:16px;margin:0 0 6px;font-family:Georgia,serif}h3{color:#6B4E9E;margin:16px 0 6px;font-size:14px}.lf-box{background:#f8f7ff;border:1px solid #ddd;border-radius:5px;padding:10px 14px;margin-bottom:8px;font-size:14px}strong{color:#4B3580}@media print{body{margin:20px}}</style></head><body>
  <div class="header"><h2>LOCAL FILE â€” Expediente TÃ©cnico de Precios de Transferencia</h2><p style="margin:0;font-size:14px;color:rgba(195,156,224,.8)">DeclaraFY Â· MÃ³dulo de Precios de Transferencia Â· PerÃº</p></div>
  ${content}
  <hr style="margin:24px 0;border-color:#ddd"><p style="font-size:14px;color:#999;text-align:center">Documento generado por Declarafy.com Â· Solo orientativo Â· Validar con especialista en PT antes de presentar</p>
  </body></html>`);
  win.document.close(); setTimeout(()=>win.print(),500);
}
function copyLF() {
  const text = document.getElementById('lfPreview')?.innerText||'';
  navigator.clipboard.writeText(text).then(()=>{event.target.textContent='âœ… Copiado!';setTimeout(()=>event.target.textContent='ğŸ“‹ Copiar',2000);});
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 7. INFORME PT COMPLETO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function generarInformePT() {
  const firma = document.getElementById('ptInfFirma')?.value?.trim() || 'Especialista PT';
  const fecha = document.getElementById('ptInfFecha')?.value || new Date().toISOString().split('T')[0];
  const uso = document.getElementById('ptInfUso')?.value || 'interno';
  const empresa = document.getElementById('lfEmpresa')?.value?.trim() || 'Empresa';
  const ruc = document.getElementById('lfRuc')?.value?.trim() || 'â€”';
  const anio = document.getElementById('lfAnio')?.value || '2024';
  const loading = document.getElementById('ptInformeLoading');
  const preview = document.getElementById('ptInformePreview');
  const actions = document.getElementById('ptInformeActions');
  loading.style.display = 'block'; preview.style.display = 'none'; if(actions)actions.style.display='none';
  const chkDone = Object.values(chkState).filter(Boolean).length;
  const chkTotal = CHECKLIST_PT.reduce((s,sec)=>s+sec.items.length,0);
  const fraInfo = document.getElementById('fraResult')?.innerText?.substring(0,500)||'AnÃ¡lisis F/R/A no completado aÃºn.';
  const iqrInfo = document.getElementById('iqrResult')?.innerText?.substring(0,300)||'Rango IQR no calculado aÃºn.';
  const metodInfo = document.getElementById('metodoResult')?.innerText?.substring(0,300)||'SelecciÃ³n de mÃ©todo no completada aÃºn.';
  const prompt = `Genera un INFORME EJECUTIVO DE PRECIOS DE TRANSFERENCIA completo y formal para:
Empresa: ${empresa} | RUC: ${ruc} | Ejercicio: ${anio}
Uso del informe: ${uso}
Firmante: ${firma} | Fecha: ${fecha}
Cumplimiento checklist: ${chkDone}/${chkTotal} puntos (${Math.round(chkDone/chkTotal*100)}%)
Resumen F/R/A: ${fraInfo.substring(0,300)}
Resumen mÃ©todo: ${metodInfo.substring(0,200)}
Resumen IQR: ${iqrInfo.substring(0,200)}
Datos del Local File: ${document.getElementById('lfNegocio')?.value?.substring(0,200)||'No completado'}

Estructura el informe con:
1. Portada y datos generales
2. Resumen ejecutivo (key findings)
3. Marco legal aplicable (Art. 32-A LIR, D.S. 008-2023-EF, GuÃ­as OCDE)
4. DescripciÃ³n del grupo y estructura de vinculaciÃ³n
5. AnÃ¡lisis funcional F/R/A (resumen)
6. MetodologÃ­a de PT: mÃ©todo seleccionado y justificaciÃ³n
7. AnÃ¡lisis de comparabilidad y rango arm's length
8. ConclusiÃ³n y dictamen de cumplimiento
9. DeclaraciÃ³n jurada del responsable

Lenguaje formal. Citar normas exactas. MÃ¡ximo 700 palabras.`;
  if (!apiKey) {
    loading.style.display = 'none'; preview.style.display = 'block'; if(actions)actions.style.display='flex';
    preview.innerHTML = `<h2>INFORME EJECUTIVO DE PRECIOS DE TRANSFERENCIA<br><span style="font-size:14px;font-weight:400">Ejercicio ${anio} â€” ${empresa} â€” RUC ${ruc}</span></h2>
    <div class="lf-box">Nivel de cumplimiento detectado: <strong>${Math.round(chkDone/chkTotal*100)}%</strong> (${chkDone}/${chkTotal} puntos del checklist)</div>
    <h3>Conecta tu API Key de Claude</h3><p>Para generar el informe PT completo redactado por IA con anÃ¡lisis detallado, base legal exacta y dictamen de cumplimiento, conecta tu API Key de Anthropic en la configuraciÃ³n.</p>
    <div class="lf-box" style="background:rgba(155,89,182,.08)">Firmante: ${firma} | Fecha: ${fecha} | Uso: ${uso}</div>`;
    return;
  }
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:2000,system:'Eres un especialista senior en Precios de Transferencia peruano. Redactas informes ejecutivos formales para presentar al directorio o a SUNAT.',messages:[{role:'user',content:prompt}]});
    const d = await res.json();
    const text = d.content?.[0]?.text||'';
    loading.style.display='none'; preview.style.display='block'; if(actions)actions.style.display='flex';
    preview.innerHTML=`<h2>INFORME EJECUTIVO DE PRECIOS DE TRANSFERENCIA<br><span style="font-size:14px;font-weight:400">Ejercicio ${anio} â€” ${empresa} â€” RUC ${ruc}</span></h2>
    <div style="white-space:pre-wrap">${text.replace(/\*\*(.*?)\*\*/g,'<strong style="color:#C39CE0">$1</strong>').replace(/^#{1,3} (.*$)/gm,'<h3>$1</h3>').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}</div>
    <hr style="border-color:rgba(155,89,182,.2);margin:16px 0">
    <div class="lf-box" style="background:rgba(155,89,182,.07)"><strong>Firmante:</strong> ${firma}<br><strong>Fecha:</strong> ${fecha}<br><strong>Uso:</strong> ${uso}<br><strong>Nivel de cumplimiento:</strong> ${Math.round(chkDone/chkTotal*100)}% checklist PT</div>`;
    addNotif('ğŸ”—','Informe PT generado','Informe ejecutivo de PT completado para '+empresa+'.');
  } catch(e){loading.style.display='none';preview.style.display='block';preview.innerHTML='<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>';}
}

function exportInformePT() {
  const empresa = document.getElementById('lfEmpresa')?.value||'Empresa';
  const content = document.getElementById('ptInformePreview')?.innerHTML||'';
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Informe PT â€” ${empresa}</title><style>body{font-family:'Times New Roman',serif;max-width:760px;margin:40px auto;color:#1a1a2e;line-height:1.85;font-size:14px}.lf-box{background:#f8f7ff;border:1px solid #ddd;border-radius:5px;padding:10px 14px;margin-bottom:8px;font-size:14px}h2{font-family:Georgia,serif;font-size:17px;color:#4B3580;border-bottom:2px solid #C39CE0;padding-bottom:8px;margin-bottom:16px}h3{color:#6B4E9E;font-size:14px;margin:14px 0 6px}strong{color:#4B3580}@media print{body{margin:20px}}</style></head><body>
  <div style="background:#1a1a2e;color:#C39CE0;padding:20px;border-radius:6px;margin-bottom:20px;font-family:Georgia,serif"><div style="font-size:16px;margin-bottom:4px">Informe Ejecutivo â€” Precios de Transferencia</div><div style="font-size:14px;opacity:.7">Declarafy.com Â· MÃ³dulo PT Â· Art. 32-A LIR Â· D.S. 008-2023-EF</div></div>
  ${content}
  <hr style="margin:20px 0;border-color:#ddd"><p style="font-size:14px;text-align:center;color:#999">Documento generado por Declarafy.com Â· Solo orientativo Â· Validar con especialista en PT antes de presentar a SUNAT</p></body></html>`);
  win.document.close(); setTimeout(()=>win.print(),500);
}

// â”€â”€ PATCH setPTab â”€â”€
const _origSetPTabPT = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabPT(tab, btn);
  if (tab === 'pt_modulo') {
    setPTTab('umbrales', null);
    setTimeout(() => document.querySelector('.pt-tab')?.classList.add('active'), 50);
    const hoy = new Date().toISOString().split('T')[0];
    const fi = document.getElementById('ptInfFecha'); if(fi&&!fi.value) fi.value=hoy;
  }
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1. IA PREDICTIVA DE FISCALIZACIÃ“N SUNAT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const FISC_INDICATORS = [
  { key:'perdida', label:'PÃ©rdidas recurrentes', weight:25,
    calc:(d) => d.resultado==='perdida_recurrente'?100:d.resultado==='perdida_1'?50:0 },
  { key:'igv_credito', label:'IGV crÃ©dito > dÃ©bito', weight:20,
    calc:(d) => d.igv==='frecuente'?80:d.igv==='ocasional'?30:d.igv==='siempre'?10:0 },
  { key:'no_habido', label:'Proveedores no habidos', weight:25,
    calc:(d) => d.noHabido==='si_mucho'?100:d.noHabido==='si_poco'?40:0 },
  { key:'vinc_nodoc', label:'PT sin documentaciÃ³n', weight:15,
    calc:(d) => d.vinc==='si_nodoc'?100:d.vinc==='si_doc'?10:0 },
  { key:'daot', label:'Diferencias con DAOT', weight:10,
    calc:(d) => d.daot==='grandes'?100:d.daot==='pequenas'?30:0 },
  { key:'repres', label:'Gastos de representaciÃ³n elevados', weight:5,
    calc:(d) => d.ingresos>0?(d.repres/d.ingresos)>0.05?80:(d.repres/d.ingresos)>0.02?30:0:0 },
];

function calcFiscRisk() {
  const d = {
    regimen: document.getElementById('fiscRegimen')?.value||'rg',
    sector: document.getElementById('fiscSector')?.value||'comercio',
    ingresos: parseFloat(document.getElementById('fiscIngresos')?.value)||0,
    resultado: document.getElementById('fiscResultado')?.value||'utilidad_normal',
    igv: document.getElementById('fiscIGV')?.value||'no',
    repres: parseFloat(document.getElementById('fiscRepres')?.value)||0,
    vinc: document.getElementById('fiscVinc')?.value||'no',
    noHabido: document.getElementById('fiscNoHabido')?.value||'no',
    daot: document.getElementById('fiscDAOT')?.value||'no',
  };
  if (!d.ingresos) return;
  // Sector multiplier
  const sectorMult = {construccion:1.3,inmobiliaria:1.25,servicios:1.1,mineria:1.2,comercio:1.0,manufactura:0.9,exportacion:0.7}[d.sector]||1.0;
  // Calculate weighted score
  let totalScore = 0;
  const indScores = FISC_INDICATORS.map(ind => {
    const rawScore = ind.calc(d);
    const weighted = (rawScore * ind.weight / 100) * sectorMult;
    totalScore += weighted;
    return { ...ind, rawScore, weighted };
  });
  const finalScore = Math.min(Math.round(totalScore), 98);
  // Display
  const res = document.getElementById('fiscResult');
  res.style.display = 'block';
  // Ring animation
  const circumference = 2 * Math.PI * 56;
  const offset = circumference - (finalScore / 100) * circumference;
  const ring = document.getElementById('fiscRingFill');
  const ringColor = finalScore >= 70 ? '#E05050' : finalScore >= 40 ? '#C9A84C' : '#4CAF50';
  if (ring) { ring.style.stroke = ringColor; setTimeout(() => ring.style.strokeDashoffset = offset, 100); }
  const scoreVal = document.getElementById('fiscScoreVal');
  if (scoreVal) { scoreVal.textContent = finalScore + '%'; scoreVal.style.color = ringColor; }
  const riskLabel = document.getElementById('fiscRiskLabel');
  if (riskLabel) {
    riskLabel.textContent = finalScore >= 70 ? 'ğŸ”´ Riesgo ALTO' : finalScore >= 40 ? 'ğŸŸ¡ Riesgo MEDIO' : 'ğŸŸ¢ Riesgo BAJO';
    riskLabel.style.color = ringColor;
  }
  // Indicators
  const indEl = document.getElementById('fiscIndicators');
  if (indEl) indEl.innerHTML = indScores.map(ind => {
    const pct = Math.min(100, Math.round(ind.rawScore * sectorMult));
    const col = pct >= 70 ? 'var(--red)' : pct >= 40 ? 'var(--gold)' : 'var(--green)';
    return `<div class="fisc-ind-item">
      <div class="fisc-ind-top"><span class="fisc-ind-name">${ind.label}</span><span class="fisc-ind-score" style="color:${col}">${pct}%</span></div>
      <div class="fisc-ind-bar"><div class="fisc-ind-fill" style="width:${pct}%;background:${col}"></div></div>
    </div>`;
  }).join('');
  // Recommendations
  const recs = [];
  if (d.resultado === 'perdida_recurrente') recs.push({icon:'ğŸ”´', text:'PÃ©rdidas por mÃ¡s de 2 aÃ±os consecutivos: SUNAT prioriza fiscalizar. Prepara sustento de causalidad de gastos y proyecciones de negocio.'});
  if (d.noHabido === 'si_mucho') recs.push({icon:'ğŸ”´', text:'Proveedores no habidos: SUNAT desconocerÃ¡ el crÃ©dito fiscal e IR. IdentifÃ­calos y evalÃºa rectificar o preparar sustento de fehaciencia (RTF 01580-5-2009).'});
  if (d.igv === 'frecuente') recs.push({icon:'ğŸŸ¡', text:'CrÃ©dito fiscal recurrentemente mayor al dÃ©bito: activa auditorÃ­as cruzadas de SUNAT. Verifica que todos los comprobantes tengan sustento de operaciÃ³n real.'});
  if (d.vinc === 'si_nodoc') recs.push({icon:'ğŸ”´', text:'Transacciones con vinculadas sin documentaciÃ³n PT: multa del 0.6% de ingresos + ajuste de precios. Elabora el Local File urgente (D.S. 008-2023-EF).'});
  if (d.daot === 'grandes') recs.push({icon:'ğŸŸ¡', text:'Diferencias con DAOT: SUNAT cruza tu declaraciÃ³n con las de tus proveedores/clientes. Revisa declaraciones y considera rectificatoria.'});
  if (d.repres > 0 && d.ingresos > 0 && (d.repres/d.ingresos) > 0.02) recs.push({icon:'ğŸŸ¡', text:`Gastos de representaciÃ³n S/${d.repres.toLocaleString()} = ${((d.repres/d.ingresos)*100).toFixed(1)}% de ingresos. LÃ­mite deducible: 0.5% de ingresos netos. Exceso: S/${Math.max(0,d.repres - d.ingresos*0.005).toLocaleString()} no deducible.`});
  if (recs.length === 0) recs.push({icon:'ğŸŸ¢', text:'No se detectaron factores de riesgo significativos. MantÃ©n tu documentaciÃ³n ordenada y actualiza tu Local File si tienes transacciones vinculadas.'});
  const recEl = document.getElementById('fiscRecs');
  if (recEl) recEl.innerHTML = `<div class="fisc-rec-title">ğŸ“‹ Recomendaciones preventivas</div>`+recs.map(r=>`<div class="fisc-rec-item"><span class="fisc-rec-icon">${r.icon}</span><span class="fisc-rec-text">${r.text}</span></div>`).join('');
  // Store for deep analysis
  window._fiscData = d;
  window._fiscScore = finalScore;
}

async function deepFiscAnalysis() {
  const d = window._fiscData || {};
  const score = window._fiscScore || 0;
  const el = document.getElementById('fiscDeepResult');
  el.style.display = 'block'; el.textContent = 'Analizando con IA...';
  if (!apiKey) { el.innerHTML = '<strong style="color:var(--red)">Conecta tu API Key</strong> para obtener el anÃ¡lisis profundo personalizado de SUNAT sobre tu perfil de riesgo.'; return; }
  const prompt = `Analiza el perfil de riesgo tributario de un contribuyente peruano:
RÃ©gimen: ${d.regimen} | Sector: ${d.sector} | Ingresos: S/${d.ingresos?.toLocaleString()}
Resultado: ${d.resultado} | IGV: ${d.igv} | Vinculadas: ${d.vinc}
Proveedores no habidos: ${d.noHabido} | DAOT: ${d.daot}
Score de riesgo calculado: ${score}%

ActÃºa como un inspector de SUNAT senior. Explica:
1. Â¿CuÃ¡l serÃ­a el primer punto que auditarÃ­as y por quÃ©?
2. Â¿QuÃ© documentos pedirÃ­as en el primer requerimiento?
3. Â¿QuÃ© inconsistencias cruzarÃ­as con la base de datos de SUNAT?
4. Tres acciones preventivas concretas que debe tomar el contribuyente AHORA.
SÃ© especÃ­fico y cita normas exactas.`;
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un inspector senior de SUNAT con 20 aÃ±os de experiencia en fiscalizaciones. Conoces exactamente cÃ³mo SUNAT selecciona y fiscaliza contribuyentes peruanos.',messages:[{role:'user',content:prompt}]});
    const data = await res.json();
    el.innerHTML = _mdFormat(data.content?.[0]?.text || 'Sin respuesta');
  } catch(e) { el.innerHTML = 'Error: '+safeHTML(e.message); }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 2. ASISTENTE DE REQUERIMIENTOS SUNAT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let reqTypeSel = '';
function selectReqType(type, btn) {
  reqTypeSel = type;
  document.querySelectorAll('.req-type-btn').forEach(b=>b.classList.remove('sel'));
  if(btn) btn.classList.add('sel');
}

async function generarRespuestaReq() {
  const texto = document.getElementById('reqTexto')?.value?.trim()||'';
  const numero = document.getElementById('reqNumero')?.value?.trim()||'â€”';
  const fecha = document.getElementById('reqFecha')?.value||new Date().toISOString().split('T')[0];
  const plazo = document.getElementById('reqPlazo')?.value?.trim()||'5 dÃ­as hÃ¡biles';
  if (!texto && !reqTypeSel) { tpToast('Pega el texto del requerimiento o selecciona su tipo.', 'error'); return; }
  const loading = document.getElementById('reqLoading');
  const resp = document.getElementById('reqResponse');
  const actions = document.getElementById('reqActions');
  loading.style.display='block'; resp.style.display='none'; if(actions) actions.style.display='none';

  const tipoLabels = {fiscalizacion_igv:'FiscalizaciÃ³n IGV â€” CrÃ©dito fiscal observado',fiscalizacion_ir:'FiscalizaciÃ³n IR â€” Gastos deducibles',carta_presentacion:'Carta de presentaciÃ³n â€” Inicio de fiscalizaciÃ³n',notificacion_deuda:'NotificaciÃ³n de deuda / Orden de pago',requerimiento_pt:'Requerimiento de Precios de Transferencia',esquela_induccion:'Esquela de inducciÃ³n â€” OmisiÃ³n de declaraciones'};
  const tipo = tipoLabels[reqTypeSel]||'Requerimiento SUNAT';

  if (!apiKey) {
    loading.style.display='none'; resp.style.display='block'; if(actions) actions.style.display='flex';
    resp.innerHTML = buildReqDemo(numero, fecha, plazo, tipo, texto);
    return;
  }
  const prompt = `ActÃºa como un abogado tributarista peruano senior especiÛ½}ÓFòµë(š+myÖR&V6öæö6Vâ6öÖò&VçF7VæFò6R&V6–&Vâ‡&–æ6—–òFRW&6–&–Fò’â6Æ–f–6â6öÖò&VçFFR&F6FVv÷,:Ö†–çFW&W6W2’&âæò†&—GVÂ(i"F6VfV7F—fRRãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#å÷6–6œ;6âÇFW&æF—f†æÆö|:Ö6öâF—f–FVæF÷2“¢Æ2&V6ö×Vç626öâVæf÷&ÖFR'F–6—6œ;6âVâVÂ&÷Fö6öÆòâÖ—6ÖF6VfV7F—fFVÂRR&âãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æó¢7F¶V2UD‚â&V6–&W2ãBUD‚FR&V6ö×Vç6ÖVç7VÂ(˜…2ós’âFV&W2FV6Æ&"2ós6öÖò&VçFFR&F6FVv÷,:ÖVâVÂW,:ÖöFòFR&V6W6œ;6ââ&6RFR6÷7FòFVÂUD‚&V6–&–FòÒ2ós&gWGW&2fVçF2ãÂöF—cà¢Ç7G&öæså&–W6vó¢Â÷7G&öæså5TäBöG,:Ö6öç6–FW&"VRÆ&VçF6RFWfVæv6öçF–çVÖVçFR†æò6öÆòÂ6ö'&"’âÖçFVæW"&Vv—7G&òFWFÆÆFòFR6F&V6ö×Vç6æÒÀ¢²–6öã¢	øËârÂF—FÆS¢u––VÆBf&Ö–æròÆ—V–F—G’Ö–æ–ærrÂ&–W6vó¢vÇFòrÀ¢FW63¢u&÷fVW"Æ—V–FW¢Vâ&÷Fö6öÆòFTf’…Væ—7vÂ7W'fR’’&V6–&—"Fö¶Vç2FR&V6ö×Vç6†v÷fW&ææ6RFö¶Vç2òfVW2’ârÀ¢FWF–Ã¦ÆƒCå––VÆBf&Ö–ær(	BG&FÖ–VçFòG&–'WF&–óÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#äÆ÷2Fö¶Vç2FR&V6ö×Vç6&V6–&–F÷2÷"&÷fVW"Æ—V–FW¢6öâ&VçFVâVÂÖöÖVçFòFR&V6W6œ;6âÂÂfÆ÷"FRÖW&6FòVâ6öÆW2VâW6fV6†ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#äÆ26öÖ—6–öæW2‡G&F–ærfVW2’&V6–&–F2FVÂööÂ6öâ–æw&W6ò÷&F–æ&–òw&fFòãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æó¢&÷fVW2Æ—V–FW¢UD‚õU4EBVâVæ—7vc2â&V6–&W2ã2RFRÆ26öÖ—6–öæW2FVÂööÂVâUD‚’U4EBâ6F6VÖæ&WF—&22óSVâ6öÖ—6–öæW2âFV&W2FV6Æ&"2ó#bÃçVÆW26öÖò&VçFFR&Fò7&6FVv÷,:Ö6V|;¦â†&—GVÆ–FBãÂöF—cà¢Ç7G&öæsä–×W&ÖæVçBÆ÷73£Â÷7G&öæsâÆ:—&F–F÷"–×W&ÖæVçBÆ÷72æòW2Væ:—&F–FG&–'WF&–ÖVçFR&V6öæö6–F†7FVR&WF—&2ÆÆ—V–FW¢‡&–æ6—–òFR&VÆ—¦6œ;6â’â7RG&FÖ–VçFòW2–æ6–W'FòVâW,;¢æÒÀ¢²–6öã¢	øúbrÂF—FÆS¢tÆVæF–ærò&÷'&÷v–ærFTf’„fRÂ6ö×÷VæB’rÂ&–W6vó¢vÖVF–òrÀ¢FW63¢u&W7F"7&—Fò’&V6–&—"–çFW&W6W2ÂòFöÖ",:—7FÖ÷26öÆFW&Æ—¦F÷2Vâ7&—FòârÀ¢FWF–Ã¦ÆƒCäÆVæF–ærFTf’(	BG&FÖ–VçFòG&–'WF&–óÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#ä–çFW&W6W2&V6–&–F÷2÷",:—7FÖ÷2FTf“¢&VçFFR&F6FVv÷,:Ö„'Bâ#B–æ2â"’Ä•"’âF6VfV7F—fRR&âãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#ä–çFW&W6W2vF÷2÷",:—7FÖ÷2FTf“¢6öâFVGV6–&ÆW26öÖòv7Fò6’VÂ,:—7FÖò6RW6&vVæW&"&VçFFR7&6FVv÷,:Ö„'Bâ3r–æ2â’Ä•"’â&âVâ&F6FVv÷,:Ö¢äò6öâFVGV6–&ÆW2ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æó¢FW÷6—F2RÃU4EBVâfR’&V6–&W2‚R’â–çFW&W6W2çVÆW3¢CU4EB(˜‚2óÃC“âFV&W2FV6Æ&"2óÃC“6öÖò&VçFFR&F6FVv÷,:Öâ•"Ò2óÃC“9rƒR9rbã#RRÒ2ósBãSãÂöF—cà¢Ç7G&öæsäÆ—V–F6œ;6â÷"6öÆFW&Ã£Â÷7G&öæsâ6’fRÆ—V–FGR6öÆFW&ÂÂ6R6öç6–FW&VæfVçFf÷'¦F6öâVÂ&V6–òFRÆ—V–F6œ;6ââvVæW&vææ6–ò:—&F–FFR6—FÂG&–'WF&ÆRæÒÀ¢²–6öã¢	ùHBrÂF—FÆS¢t–çFW&6Ö&–ò7&—FòÖ7&—Fò‡7v’rÂ&–W6vó¢vÇFòrÀ¢FW63¢t–çFW&6Ö&–"%D2÷"UD‚Âò7VÇV–W""7&—FòÖ7&—FòÂ–æ6ÇW6òW6æFòVâDU‚…Væ—7vÂ–æ6‚’ârÀ¢FWF–Ã¦ÆƒCå7v7&—FòÖ7&—Fò(	B†V6†ò–×öæ–&ÆSÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#ä6F7vW2VæVæ¦Væ6œ;6âFVÂ7F—fò6VF–Fòâ6RvVæW&vææ6–ò:—&F–FFR6—FÂVâVÂ7F—fòVR'fVæFW2"ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æó¢–çFW&6Ö&–2ã%D2†6÷7Fò2ó"Ã’÷"ãRUD‚‡fÆ÷"2ó#Ã’âvææ6–FR6—FÃ¢2ó’ÃâG&–'WF6öÖò&VçFFR&F6FVv÷,:ÖâVÂ6÷7FòFVÂUD‚GV—&–FòW22ó#ÃãÂöF—cà¢Ç7G&öæså&ö&ÆVÖ,:7F–6ó£Â÷7G&öæsâVâVâ;ò7F—fòFRFTf’VVFW2FVæW"6–VçF÷2FR7v2â6FVæòW2VâWfVçFòG&–'WF&–òâ†W'&Ö–VçF26öÖò¶ö–æÇ’ò6ö–åG&6¶W"VVFVâ—VF"6Æ7VÆ&Æ÷2ÂVçVRFV&VâFF'6RÆæ÷&ÖF—fW'Væà¢Ç7G&öæså&–W6vòÇFó£Â÷7G&öæsâÆÖ–÷,:ÖFRW7V&–÷2æòFV6Æ&âÆ÷27v27&—FòÖ7&—Fòâ5TäBF–VæR66W6ò–æf÷&Ö6œ;6âFRW†6†ævW2VR÷W&âVâW,;¢’VVFR7'W¦"FF÷2æÒÀ¢²–6öã¢	øèrÂF—FÆS¢t—&G&÷2’†&Bf÷&·2rÂ&–W6vó¢vÖVF–òrÀ¢FW63¢u&V6–&—"Fö¶Vç2w&F—2÷"FVæW"Væ7&—FöÖöæVF†—&G&÷’ò÷"Væ&–gW&66œ;6âFVÂ&÷Fö6öÆò††&Bf÷&²’ârÀ¢FWF–Ã¦ÆƒCä—&G&÷2’†&Bf÷&·2(	B&VçFVâVÂÖöÖVçFòFR&V6W6œ;6ãÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#å÷6–6œ;6â5TäB†Æ–6æFò&–æ6—–òvVæW&Â“¢Æ÷2—&G&÷26öâ&VçFw&fFÂÖöÖVçFòFR&V6W6œ;6âÂÂfÆ÷"FRÖW&6FòVâ6öÆW2â6FVv÷,:Ö¢&F…âæò†&—GVÂ’ò7&†V×&W6ö†&—GVÂ’ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#ä†&Bf÷&³¢Æ÷2Fö¶Vç2&V6–&–F÷2÷"†&Bf÷&²†V£¢$4‚÷"FVæVæ6–FR%D2’6RfÆ÷&âÂ&V6–òFRÖW&6FòVâVÂÖöÖVçFòFRÆ&–gW&66œ;6âãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æó¢&V6–&W2Vâ—&G&÷FRÃFö¶Vç2$"„&&—G'VÒ’Vâ##2â&V6–òÂÖöÖVçFòFVÂ—&G&÷¢2óãƒ÷Fö¶Vââ&VçF&V6öæö6–F¢2óÃƒâ7VæFòfVæF2Æ÷2$"ÂVÂ6÷7Fò6ö×WF&ÆRW22óÃƒãÂöF—cà¢Ç7G&öæsä—&G&÷26–âfÆ÷#£Â÷7G&öæsâ6’VÂFö¶VâæòF–VæRÆ—V–FW¢æ’&V6–òFRÖW&6FòÂÖöÖVçFòFVÂ—&G&÷ÂVÂfÆ÷"&V6öæö6–FòW22óâÆ&VçF6R&V6öæö6W,:7VæFò6RVæ¦VæRæÒÀ¥Ó° ¦gVæ7F–öâ&VæFW$FTf’‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFVf•66Væ&–÷2r“²–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒDTd•ôDDæÖ‚†BÆ’’ÓâÆF—b6Æ73Ò&FVf’Ö6&B"öæ6Æ–6³Ò'FövvÆT4ÄFWF–Â‚vFVf•òG¶—Òr’#à¢ÆF—b6Æ73Ò&FVf’Ö6&B×F—FÆR#âG¶Bæ–6öçÒG¶BçF—FÆWÓÇ7â6Æ73Ò&FVf’×&—6²×FrG¶Bç&–W6v÷Ò#å&–W6vòG&–'WF&–ó¢G¶Bç&–W6vòçFõWW$66R‚—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&FVf’Ö6&BÖFW62#âG¶BæFW67ÓÂöF—cà¢ÆF—b6Æ73Ò&FVf’×G&VFÖVçB"–CÒ&6ÄFWF–ÅöFVf•òG¶—Ò#âG¶BæFWF–ÇĞ¢Æ'WGFöâ6Æ73Ò'&VrÖ6²Ö'Fâ"7G–ÆSÒ&Ö&v–â×F÷£ƒ¶&÷&FW"Ö6öÆ÷#§&v&ƒSRÃƒ’Ãƒ"ÂãB“¶6öÆ÷#¢433”4S"öæ6Æ–6³Ò&WfVçBç7F÷&÷vF–öâ‚“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÄFVf•r’çfÇVSÒt6öç7VÇF6ö'&S¢G¶BçF—FÆRç&WÆ6R‚òrörÂ%ÅÂr"—Òs¶6öç7VÇD4Ä’‚vFVf’r’#ï	ù*Â6öç7VÇF"”Âö'WGFöãà¢ÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòRâÔÂòµ”0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BÔÅôÄUdTÅ2Ò°¢²æ—fVÃ¢t$¤òrÂ6Ç3¢v&¦òrÂF—GVÆó¢uW'6öææGW&Â(	BW7V&–òFR7&—FòrÂF‡&W6†öÆC¢uG&ç666–öæW2W'6öæÆW2FR–çfW'6œ;6ârÀ¢&W3¥²tFV6Æ&"vææ6–2VâD¢çVÂ†ö&Æ–v6œ;6âG&–'WF&–ÂæòÔÂ’rÂtæò&W÷'F"F—&V7FÖVçFRÆT”b‡6ÇfòÖ÷f–Ö–VçF÷2–çW7VÆW2VâVÂ&æ6ò’rÀ¢tVÂ&æ6òVVFR&W÷'F"÷W&6–öæW26÷7V6†÷626’FWFV7FG&öæW2–çW7VÆW2rÂt7V×Æ—"6öâµ”2FVÂW†6†ævR„&–ææ6RÂ&—G6òÂ'VF’FöæFR÷W&2uÒÒÀ¢²æ—fVÃ¢tÔTD”òrÂ6Ç3¢vÖVF–òrÂF—GVÆó¢tW†6†ævRò4bWV\;òò7F'GWrÂF‡&W6†öÆC¢uÆFf÷&Ö2VR–çFW&ÖVF–â7&—Fò÷"Væ6&vòFRFW&6W&÷2rÀ¢&W3¥²u&Vv—7G&òçFRT”bÕW,;¢6öÖò7V¦WFòö&Æ–vFò„BäÆVrâC“"²&W2âT”b3RÓ##2’rÂt–×ÆVÖVçF"&öw&ÖÄôeC¢µ”2FR6Æ–VçFW2ÂÖöæ—F÷&VòFRG&ç666–öæW2rÀ¢u&W÷'F"÷W&6–öæW26÷7V6†÷62…$õ2’FVçG&òFRRL:Ö2Œ:&–ÆW2rÂtFW6–væ"öf–6–ÂFR7V×Æ–Ö–VçFòÄçFRÆT”brÂt6öç6W'f"&Vv—7G&÷2÷"R;÷2Ü:Öæ–ÖòrÀ¢tÌ:ÖÖ—FW2FR÷W&6œ;6â6–âµ”3¢vVæW&ÆÖVçFR&7&—Fò‡&–W6vòÇFò÷"td’’uÒÒÀ¢²æ—fVÃ¢tÅDòrÂ6Ç3¢vÇFòrÂF—GVÆó¢tW†6†ævRw&æFRòd56öâföÇVÖVâ6–væ–f–6F—fòrÂF‡&W6†öÆC¢uÆFf÷&Ö26öâ²U4BÒöÖW2VâG&ç666–öæW2rÀ¢&W3¥²uFöF÷2Æ÷2&WV—6—F÷2FVÂæ—fVÂÖVF–ò²rÂtFV&–FF–Æ–vVæ6–&Vf÷'¦F„DE"’&6Æ–VçFW2FRÇFò&–W6vòÂU2’§W&—6F–66–öæW2FR&–W6vòrÀ¢t–×ÆVÖVçF"6—7FVÖFRÖöæ—F÷&VòG&ç666–öæÂWFöÖF—¦Fò…DÕ2’rÂu&W÷'FRFR÷W&6–öæW2VâVfV7F—fò…$ôR’&G&ç666–öæW2âU4BÃWV—fÆVçFRrÀ¢tVF—F÷,:ÖÄô4eBçVÂ÷"f—&Ö–æFWVæF–VçFRrÂt7V×Æ–Ö–VçFò6öâtd’&V6öÖVæF6œ;6âb…G&fVÂ'VÆR“¢G&ç6Ö—F—"FF÷2FR&VÖ—FVçFRö&VæVf–6–&–òVâG&ç6fW&Væ6–2rÀ¢tWfÇV6œ;6âFR&–W6vòFR6Æ–VçFW26öâ†W'&Ö–VçF2&Æö6¶6†–â„6†–æÇ—6—2ÂVÆÆ—F–2’uÒÒÀ¥Ó° ¦gVæ7F–öâ&VæFW$ÔÂ‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖÄÆWfVÇ2r“²–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒÔÅôÄUdTÅ2æÖ†ÂÓâÆF—b6Æ73Ò&ÖÂÖÆWfVÂG¶Âæ6Ç7Ò#à¢ÆF—b6Æ73Ò&ÖÂÖÆWfVÂ×F—FÆR#ãÇ7ãî)ªûˆòæ—fVÂG¶Âææ—fVÇÒ(	BG¶ÂçF—GVÆ÷ÓÂ÷7ããÇ7â6Æ73Ò&6ÂÖ&FvRG¶Âæ6Ç3ÓÓÒv&¦òsòvçVWfòs¦Âæ6Ç3ÓÓÒvÖVF–òsòwf6–òs¢w&–W6vòwÒ#âG¶ÂçF‡&W6†öÆGÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&ÖÂ×&W2#âG¶Âç&W2æÖ‡#ÓæÆF—b6Æ73Ò&ÖÂ×&W#ãÇ7â7G–ÆSÒ&fÆW‚×6‡&–æ³£#âG¶Âæ6Ç3ÓÓÒvÇFòsò	ùKBs¦Âæ6Ç3ÓÓÒvÖVF–òsò	ùús¢	ùú"wÓÂ÷7ããÇ7ãâG·'ÓÂ÷7ããÂöF—cæ’æ¦ö–â‚rr—ÓÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr’²ÆF—b7G–ÆSÒ&&6¶w&÷VæC§&v&ƒS‚Ã3BÃ#SRÂãr“¶&÷&FW#£‚6öÆ–B&v&ƒS‚Ã3BÃ#SRÂã"“¶&÷&FW"×&F—W3£—ƒ·FF–æs£'‚Gƒ¶Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ãs¶6öÆ÷#§f"‚ÒÖ×WFVB’#à¢Ç7G&öær7G–ÆSÒ&6öÆ÷#¢34ƒddb#ï	ù8²&6RÆVvÂÔÂô7&—FòVâW,;££Â÷7G&öæsãÆ'#à¢(
"BäÆVrâC“"ƒ##’(	BÖVF–F2&f÷'FÆV6W"Æ&WfVæ6œ;6âÄô4eCÆ'#à¢(
"ÆW’#sc“2(	BÆW’FRÆVæ–FBFR–çFVÆ–vVæ6–f–ææ6–W&Æ'#à¢(
"&W6öÇV6œ;6â4%2ì+3RÓ##2ÕT”b(	Bö&Æ–v6–öæW2FRÆ÷24g3Æ'#à¢(
"td’w\:Ö7GVÆ—¦F6ö'&R7F—f÷2f—'GVÆW2ƒ##Â##2“Æ'#à¢(
"&VvÆÖVçFòFRvW7Fœ;6âFR&–W6v÷2Äô4eB(	B&W2â4%2#ccÓ#P¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòbâDô´Tâ4Ä54”d”U ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BDô´TåõTU5D”ôå2Ò°¢²¢|+ôÆ÷26ö×&F÷&W2–çf–W'FVâF–æW&òòfÆ÷"6Ö&–òFVÂFö¶VãòrÂ÷G3¥²u<:Ò(	Bvâ&&V6–&—&ÆòrÂtæò(	BÆòö'F–VæVâw&F—2‡W6òF—&V7Fò’uÒÒÀ¢²¢|+ôVÂfÆ÷"FVÂFö¶VâFWVæFRFVÂW6gVW'¦òòG&&¦òFRVâWV—ò&öÖ÷F÷#òrÂ÷G3¥²u<:Ò(	BVÂWV—òÆòFW6'&öÆÆ’ÖçF–VæRrÂtæò(	BgVæ6–öæFRf÷&ÖWL;6æöÖFW6FRVÂ–æ–6–òuÒÒÀ¢²¢|+ôÆ÷26ö×&F÷&W2W7W&âö'FVæW"vææ6–2V6öì;6Ö–62FVÂFö¶VãòrÂ÷G3¥²u<:Ò(	BW7W&âVR7V&FR&V6–òò&V6–&—"F—f–FVæF÷2rÂtæò(	BÆòW6â&66VFW"Vâ6W'f–6–òW7V<:Öf–6òuÒÒÀ¢²¢|+ôVÂFö¶Vâ÷F÷&vFW&V6†÷26ö'&RWF–Æ–FFW2ÂfÇV¦÷2FR6¦ò'F–6—6œ;6âVâÆV×&W6òrÂ÷G3¥²u<:Ò(	BW26öÖòVæ66œ;6âò&öæòrÂtæò(	B6öÆòF66W6ògVæ6–öæÆ–FFW2FVÂ&÷Fö6öÆòuÒÒÀ¥Ó°¦ÆWBFö¶Väç7vW'2Ò·Ó°¦gVæ7F–öâ&VæFW%Fö¶Vä6Æ76–f–W"‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wFö¶Vä6Æ76–f–W"r“²–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒDô´TåõTU5D”ôå2æÖ‚‡Æ’’ÓâÆF—b6Æ73Ò'Fö¶Vâ×FW7B#à¢ÆF—b6Æ73Ò'Fö¶Vâ×FW7B×#âG¶’³ÒâG·çÓÂöF—cà¢ÆF—b6Æ73Ò'Fö¶VâÖ÷G2#âG·æ÷G2æÖ‚†÷BÆ¢“ÓæÆ'WGFöâ6Æ73Ò'Fö¶VâÖ÷BG·Fö¶Väç7vW'5¶•ÓÓÓÖ£òw6VÂs¢rwÒ"öæ6Æ–6³Ò'6WEFö¶Väç7vW"‚G¶—ÒÂG¶§ÒÇF†—2’#âG¶÷GÓÂö'WGFöãæ’æ¦ö–â‚rr—ÓÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°¢WfÅFö¶Vâ‚“°§Ğ¦gVæ7F–öâ6WEFö¶Väç7vW"‡ÂÂ'Fâ’°¢Fö¶Väç7vW'5·ÒÒ°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ†7Fö¶Vä6Æ76–f–W"çFö¶Vâ×FW7C¦çF‚Ö6†–ÆB‚G·³Ò’çFö¶VâÖ÷F’æf÷$V6‚†#Óæ"æ6Æ74Æ—7Bç&VÖ÷fR‚w6VÂr’“°¢–b†'Fâ’'Fâæ6Æ74Æ—7BæFB‚w6VÂr“°¢WfÅFö¶Vâ‚“°§Ğ¦gVæ7F–öâWfÅFö¶Vâ‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wFö¶Vå&W7VÇBr“²–b‚VÂ’&WGW&ã°¢–b„ö&¦V7Bæ¶W—2‡Fö¶Väç7vW'2’æÆVæwF‚ÂDô´TåõTU5D”ôå2æÆVæwF‚’²VÂç7G–ÆRæF—7Æ“ÒvæöæRs²&WGW&ã²Ğ¢6öç7BfÆ÷%6–væÇ2Ò·Fö¶Väç7vW'5³ÓÓÓÓÂFö¶Väç7vW'5³ÓÓÓÓÂFö¶Väç7vW'5³%ÓÓÓÓÂFö¶Väç7vW'5³5ÓÓÓÓÒæf–ÇFW"„&ööÆVâ’æÆVæwFƒ°¢VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–b‡fÆ÷%6–væÇ2ãÒ2’°¢VÂæ6Æ74æÖSÒwFö¶Vâ×&W7VÇBfÆ÷"s°¢VÂæ–ææW$…DÔÃÖÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#ï	ùKB$ô$$ÄRdÄõ"Ôô$”Ä”$”ò(	B&Vv—7G&ò4Õb&WVW&–FóÂ÷7G&öæsãÆ'#ãÆ'#à¢GRFö¶Vâ&W6VçFG·fÆ÷%6–væÇ7ÒóB7&—FW&–÷2FVÂ†÷vW’FW7BFFFòâÇF&ö&&–Æ–FBFRVR6Æ–f—VR6öÖòfÆ÷"Öö&–Æ–&–ò&¦òVÂBäÆVrâƒc„ÆW’FVÂÖW&6FòFRfÆ÷&W2’’VÂ&VvÆÖVçFò4ÕbãÆ'#ãÆ'#à¢Ç7G&öæsä6öç6V7VVæ6–3£Â÷7G&öæsâVÖ—F—"òF—7G&–'V—";¦&Æ–6ÖVçFR6–â&Vv—7G&ò4ÕbW2FVÆ—Fò„'Bâ2BäÆVrâƒc(	BöfW'F;¦&Æ–6æòWF÷&—¦F’â×VÇF†7FsT•B²–æ†&–Æ—F6œ;6âãÆ'#ãÆ'#à¢Ç7G&öæsä66œ;6â&WVW&–F£Â÷7G&öæsâ6öç7VÇF"6öâ&övFòW7V6–Æ—7FVâÖW&6FòFRfÆ÷&W2åDU2FR7VÇV–W"VÖ—6œ;6ââWfÇV"&Vv—7G&ò6öÖòfÆ÷"Öö&–Æ–&–òò&W7G'V7GW&"VÂFö¶Vâ&VÆ–Ö–æ"W‡V7FF—fFRvææ6–2æ°¢ÒVÇ6R–b‡fÆ÷%6–væÇ2ãÒ’°¢VÂæ6Æ74æÖSÒwFö¶Vâ×&W7VÇB†–'&–Fòs°¢VÂæ–ææW$…DÔÃÖÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB’#ï	ùúDô´TâŒ8Ô%$”Dò(	B¦öæw&—2&VwVÆF÷&–Â÷7G&öæsãÆ'#ãÆ'#à¢GRFö¶Vâ&W6VçFG·fÆ÷%6–væÇ7ÒóB7&—FW&–÷2FVÂ†÷vW’FW7BâW7L:Vâ¦öæw&—2VçG&RFö¶VâFRWF–Æ–FB’fÆ÷"Öö&–Æ–&–òãÆ'#ãÆ'#à¢Ç7G&öæså&–W6vó£Â÷7G&öæsâ4ÕböG,:Ö&V6Æ–f–6&Æò6öÖòfÆ÷"Öö&–Æ–&–òVâVæ–ç7V66œ;6ââVÂì:Æ—6—2FV&R†6W'6R66ò÷"66òãÆ'#ãÆ'#à¢Ç7G&öæsä66œ;6â&V6öÖVæFF£Â÷7G&öæsâö'FVæW"÷–æœ;6âÆVvÂW67&—F6ö'&RÆæGW&ÆW¦FVÂFö¶Vââ6öç6–FW&"W7G'V7GW&VR&VgVW&6RVÂ6,:7FW"FR'WF–Æ–FB"‡W6ò&VÂFVÂ6W'f–6–òFW6FRVÂÆç¦Ö–VçFòÂ6–âW‡V7FF—fFRvææ6–2VâVÂv†—FWW"’æ°¢ÒVÇ6R°¢VÂæ6Æ74æÖSÒwFö¶Vâ×&W7VÇBWF–Æ–FBs°¢VÂæ–ææW$…DÔÃÖÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#ï	ùú"Dô´TâDRUD”Ä”DB(	BÖVæ÷"&–W6vò&VwVÆF÷&–ò4ÕcÂ÷7G&öæsãÆ'#ãÆ'#à¢GRFö¶Vâæò&W6VçF†ò&W6VçFÜ:Öæ–ÖÖVçFR’Æ÷27&—FW&–÷2FVÂ†÷vW’FW7Bâ&ö&&ÆVÖVçFR6Æ–f–66öÖòFö¶VâFRWF–Æ–FBÂæò6öÖòfÆ÷"Öö&–Æ–&–òãÆ'#ãÆ'#à¢Ç7G&öæsåG&–'WF6œ;6ã£Â÷7G&öæsâÆ÷2–æw&W6÷2÷"fVçFFRFö¶Vç2FRWF–Æ–FBG&–'WFâ6öÖò&VçFFR7&6FVv÷,:Ö†V×&W6’òGF6FVv÷,:Ö…â’âæòÆ–6Ææ÷&ÖF—fFVÂÖW&6FòFRfÆ÷&W2ãÆ'#ãÆ'#à¢Ç7G&öæsä”uc£Â÷7G&öæsâ6’VÂFö¶VâF66W6ò6W'f–6–÷2F–v—FÆW2ÂÆfVçFVVFRW7F"w&fF6öâ”ubƒ‚R’6öÖò&W7F6œ;6âFR6W'f–6–÷2F–v—FÆW2æ°¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòrâDòDD¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BDõôDDÒ°¢²&Vc¢t<;6F–vò6—f–ÂW'Væò„BäÆVrâ#“R’(	Bf<:Öòæ÷&ÖF—fòrÂF—FÆS¢tæGW&ÆW¦§W,:ÖF–6FRÆ2D÷2VâW,;¢rÀ¢FW63¢tÆ2D÷2æòF–VæVâW'6öæÆ–FB§W,:ÖF–6&V6öæö6–FVâVÂW,;¢âæòW†—7FRVâF—ò6ö6–WF&–òWV—fÆVçFRâW7FòvVæW&&ö&ÆVÖ2FR&W7öç6&–Æ–FBÂG&–'WF6œ;6â’6öçG&F6œ;6âârÀ¢FWF–Ã¦ÆƒCì+õ\:’W2VæDò§W,:ÖF–6ÖVçFRVâW,;£óÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#ä÷6–öæW27GVÆW2&f÷&ÖÆ—¦"VæDòVâW,;£¢ƒ’6ö6–VFBì;6æ–Ö6W'&F…42’(	BÆÜ:26öÜ;¦âW&òæò&VfÆV¦ÆW7G'V7GW&FW66VçG&Æ—¦Fâƒ"’6ö6–6œ;6â6—f–Â(	B&D÷26–âf–æW2FRÇV7&òâƒ2’÷W&"–æf÷&ÖÆÖVçFR(	B&–W6vòÆVvÂ6–væ–f–6F—fòãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#å&W7öç6&–Æ–FBFRÆ÷2Ö–VÖ'&÷3¢ÂæòW†—7F—"f–wW&§W,:ÖF–6W7V<:Öf–6ÂÆ÷2Ö–VÖ'&÷2FRVæDòöG,:ÖâFVæW"&W7öç6&–Æ–FB–Æ–Ö—FF÷"Æ2ö&Æ–v6–öæW2FRÆDò†6öÖòVæ6ö6–VFBFR†V6†òFVÂ<;6F–vò6—f–Â’ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#ä6ö×&6œ;6â–çFW&æ6–öæÃ¢w–öÖ–ær„TUUR’&V6öæö6RÄÄ72&D÷2FW6FR##âÖ'6†ÆÂ—6ÆæG2F–VæRÆW’W7V<:Öf–6âW,;¢æòF–VæRWV—fÆVçFR(	B'&V6†æ÷&ÖF—f6–væ–f–6F—fãÂöF—cà¢Ç7G&öæså&V6öÖVæF6œ;6â,:7F–6£Â÷7G&öæsâ6öç7F—GV—"Væ42VâW,;¢6öâVâW7FGWFòFFFò&&VfÆV¦"Ævö&W&æç¦ÖVF–çFRFö¶Vç2âVÂ6öçG&Fò6ö6–ÂVVFR–æ6÷'÷&"ÖV6æ—6Ö÷2FRf÷F6œ;6âöâÖ6†–âæÒÀ¢²&Vc¢tÄ•"'G2âÂbÂSr(	B&–æ6—–òFRgVVçFR’FöÖ–6–Æ–òrÂF—FÆS¢uG&–'WF6œ;6âFRÆ÷2'F–6—çFW2W'Væ÷2VâD÷2rÀ¢FW63¢uVâ&W6–FVçFRW'VæòVR'F–6—VâVæDòW‡G&æ¦W&’&V6–&RFö¶Vç2òF—7G&–'V6–öæW2FV&RFV6Æ&"W62&VçF2VâW,;¢Â–æFWVæF–VçFVÖVçFRFRL;6æFR÷W&RÆDòârÀ¢FWF–Ã¦ÆƒCì+õG&–'WFâVâW,;¢Æ2vææ6–2FRVæDòW‡G&æ¦W&óÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#å<:ÒâW,;¢w&f7W2&W6–FVçFW2÷"&VçFFRgVVçFR×VæF–Â„'BâbÄ•"’âÆ÷2v÷fW&ææ6RFö¶Vç2&V6–&–F÷26öÖò6ö×Vç66œ;6â÷"G&&¦òVâÆDò6öâ&VçFFRGFòWF6FVv÷,:ÖãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#äÆ2F—7G&–'V6–öæW2FRWF–Æ–FFW2FRÆDò†VâUD‚R÷G&ò7&—Fò’6öâ&VçFFR&F6FVv÷,:Ö&âæò†&—GVÂ†WV—fÆVçFRF—f–FVæF÷2’ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æó¢W'VæòG&&¦6öÖòFW6'&öÆÆF÷"&VæDò’&V6–&RRÃFö¶Vç2FRvö&W&æç¦‡fÆ÷"2ó#RÃ’âFV&RFV6Æ&"2ó#RÃ6öÖò&VçFFRGF6FVv÷,:Öâ7VæFòfVæFÆ÷2Fö¶Vç2ÂG&–'WF,:Ævææ6–F–6–öæÂ6öÖò&F6FVv÷,:ÖãÂöF—cà¢Ç7G&öæså&ö&ÆVÖFRfÆ÷&6œ;6ã£Â÷7G&öæsâÆ÷2v÷fW&ææ6RFö¶Vç2FRD÷2WV\;2VVFVâæòFVæW"&V6–òFRÖW&6FòÌ:×V–FòÂÖöÖVçFòFR&V6W6œ;6ââ6RVVFR&wVÖVçF"VRÆ&VçF6R&V6öæö6RÂÖöÖVçFòFRÆÆ—V–F6œ;6âæÒÀ¥Ó° ¦gVæ7F–öâ&VæFW$Dò‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFôæ÷&Ö2r“²–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒDõôDDæÖ‚†âÆ’’ÓâÆF—b6Æ73Ò&6ÂÖæ÷&Ö"öæ6Æ–6³Ò'FövvÆT4ÄFWF–Â‚vFõòG¶—Òr’#à¢ÆF—b6Æ73Ò&6ÂÖæ÷&Ö×F÷#ãÆF—cãÆF—b6Æ73Ò&6ÂÖæ÷&Ö×&Vb#âG¶âç&VgÓÂöF—cãÆF—b6Æ73Ò&6ÂÖæ÷&Ö×F—FÆR#âG¶âçF—FÆWÓÂöF—cãÂöF—cãÇ7â6Æ73Ò&6ÂÖ&FvRf6–ò#åf<:Öòæ÷&ÖF—fóÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖæ÷&ÖÖFW62#âG¶âæFW67ÓÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖæ÷&ÖÖFWF–Â"–CÒ&6ÄFWF–ÅöFõòG¶—Ò#âG¶âæFWF–ÇĞ¢Æ'WGFöâ6Æ73Ò'&VrÖ6²Ö'Fâ"7G–ÆSÒ&Ö&v–â×F÷£ƒ¶&÷&FW"Ö6öÆ÷#§&v&ƒSRÃƒ’Ãƒ"ÂãB“¶6öÆ÷#¢433”4S"öæ6Æ–6³Ò&WfVçBç7F÷&÷vF–öâ‚“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÄFõr’çfÇVSÒt6öç7VÇF6ö'&S¢G¶âçF—FÆRç&WÆ6R‚òrörÂ%ÅÂr"—Òs¶6öç7VÇD4Ä’‚vFòr’#ï	ù*Â6öç7VÇF"”Âö'WGFöãà¢ÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò‚â4Ô%B4ôåE$5E2DD¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7B4Ô%EôDDÒ°¢²&Vc¢tÆW’#s#c’„ÆW’FRf—&Ö2F–v—FÆW2’²ÆW’3“b„FVÆ—F÷2–æf÷&Ü:F–6÷2’rÂF—FÆS¢ufÆ–FW¢ÆVvÂFRÆ÷26öçG&F÷2–çFVÆ–vVçFW2VâW,;¢rÀ¢FW63¢tÆ÷26Ö'B6öçG&7G26öâl:Æ–F÷2VâW,;¢&¦òVÂ&–æ6—–òFRÆ–&W'FBFRf÷&ÖFVÂ<;6F–vò6—f–ÂÂW&ò6öâÆ–Ö—F6–öæW2–×÷'FçFW2&7F÷2VR&WV–W&Vâf÷&ÖÆ–FBW7V<:Öf–6ârÀ¢FWF–Ã¦ÆƒCì+ôW2l:Æ–FòVâ6öçG&Fò–çFVÆ–vVçFRVâW,;£óÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#ä'Bâ3S"43¢Æ÷26öçG&F÷26RW&fV66–öæâ÷"VÂ6öç6VçF–Ö–VçFòFRÆ2'FW2Â6ÇfòVRÆÆW’W†–¦f÷&ÖFWFW&Ö–æFâVâ6Ö'B6öçG&7BVVFR6W"Vâ6öçG&Fòl:Æ–Fò6’†’öfW'FÂ6WF6œ;6âÂö&¦WFòÌ:Ö6—Fò’66–FBãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#äÆW’#s#c’&V6öæö6RÆf—&ÖF–v—FÂ6öÖòWV—fÆVçFRÆf—&ÖÖçW67&—FÂÆòVRF7W7FVçFòG&ç666–öæW2&Æö6¶6†–âf—&ÖF26öâ6ÆfW2&—fF2ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#äÌ:ÖÖ—FW3¢6öçG&F÷2VR&WV–W&VâW67&—GW&;¦&Æ–6†6ö×&fVçFFR–æ×VV&ÆW2Â6öç7F—GV6œ;6âFR6ö6–VFFW2ÂöFW&W2’äòVVFVâf÷&ÖÆ—¦'6R6öÆòÖVF–çFR6Ö'B6öçG&7Bâ&WV–W&Vâæ÷F,:ÖãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æòl:Æ–Fó¢6öçG&FòFR6W'f–6–÷2&öfW6–öæÆW2V¦V7WFFòWFöÜ:F–6ÖVçFRf–6Ö'B6öçG&7B(	Bl:Æ–Fò&¦ò42âV¦V×Æò–çl:Æ–Fó¢G&ç6fW&Væ6–FR&÷–VFBFRVâ–æ×VV&ÆR6öÆòf–6Ö'B6öçG&7B(	B–çl:Æ–FòÂ&WV–W&RW67&—GW&;¦&Æ–6R–ç67&—6œ;6âVâ%%ãÂöF—cæÒÀ¢²&Vc¢t<;6F–vò6—f–Â„BäÆVrâ#“R’'G2â3BÓ3#rÂF—FÆS¢u&W7öç6&–Æ–FB÷"'Vw2Vâ6Ö'B6öçG&7G2rÀ¢FW63¢u6’Vâ6Ö'B6öçG&7BF–VæRVâW'&÷"FR<;6F–vòVR6W6:—&F–F2Â+÷Vœ:–â&W7öæFSòÆ&W7öç6&–Æ–FBFVÂFW6'&öÆÆF÷"VâW,;¢W2Vâ:&Vö6òW‡Æ÷&FârÀ¢FWF–Ã¦ÆƒCå&W7öç6&–Æ–FBFVÂFW6'&öÆÆF÷"FR6Ö'B6öçG&7G3ÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#å&W7öç6&–Æ–FB6öçG&7GVÂ„'Bâ3B42“¢6’VÂFW6'&öÆÆF÷"7G\;26öâÆF–Æ–vVæ6–÷&F–æ&–&WVW&–F÷"Æ26—&7Vç7Fæ6–2Âæò†’&W7öç6&–Æ–FB÷"7VÇÆWfRâ6’‡V&òFöÆòò7VÇ–æW†7W6&ÆRÂ&W7öæFR÷"FöF÷2Æ÷2F;÷2ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#äVF—F÷,:Ö&Wf–¢Vâ6Ö'B6öçG&7BVF—FFò÷"FW&6W&÷2–æFWVæF–VçFW2&VGV6R6–væ–f–6F—fÖVçFRÆ&W7öç6&–Æ–FBFVÂFW6'&öÆÆF÷"çFR'Vw2÷7BÖFW7Æ–VwVRãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#ä66òDò†6²†æÆö|:Ö“¢6’Vâ†6¶W"W‡Æ÷FVægVÆæW&&–Æ–FBFVÂ<;6F–vòÂVÂFW6'&öÆÆF÷"öG,:Ö6W"&W7öç6&ÆR6’æò–×ÆVÖVçL;2Æ2&V6V6–öæW2Ü:Öæ–Ö2FVÂ'FRâVÂW7V&–òFÖ&œ:–â7VÖR&–W6v÷2Â–çFW&7GV"6öâ<;6F–vòæòVF—FFòãÂöF—cà¢Ç7G&öæså&V6öÖVæF6œ;6ã£Â÷7G&öæsâÆ÷26öçG&F÷26öâW7V&–÷2FR6Ö'B6öçG&7G2FV&Vâ–æ6ÇV—"6Ì:W7VÆ2FRÆ–Ö—F6œ;6âFR&W7öç6&–Æ–FBÂF—66Æ–ÖW'2FR&–W6v÷2FV6æöÌ;6v–6÷2’&&—G&¦R6öÖòÖV6æ—6ÖòFR&W6öÇV6œ;6âFRF—7WF2æÒÀ¥Ó° ¦gVæ7F–öâ&VæFW%6Ö'B‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w6Ö'Dæ÷&Ö2r“²–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒ4Ô%EôDDæÖ‚†âÆ’’ÓâÆF—b6Æ73Ò&6ÂÖæ÷&Ö"öæ6Æ–6³Ò'FövvÆT4ÄFWF–Â‚w6Ö'EòG¶—Òr’#à¢ÆF—b6Æ73Ò&6ÂÖæ÷&Ö×F÷#ãÆF—cãÆF—b6Æ73Ò&6ÂÖæ÷&Ö×&Vb#âG¶âç&VgÓÂöF—cãÆF—b6Æ73Ò&6ÂÖæ÷&Ö×F—FÆR#âG¶âçF—FÆWÓÂöF—cãÂöF—cãÇ7â6Æ73Ò&6ÂÖ&FvRçVWfò#äÆVvÃÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖæ÷&ÖÖFW62#âG¶âæFW67ÓÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖæ÷&ÖÖFWF–Â"–CÒ&6ÄFWF–Å÷6Ö'EòG¶—Ò#âG¶âæFWF–ÇĞ¢Æ'WGFöâ6Æ73Ò'&VrÖ6²Ö'Fâ"7G–ÆSÒ&Ö&v–â×F÷£ƒ¶&÷&FW"Ö6öÆ÷#§&v&ƒSRÃƒ’Ãƒ"ÂãB“¶6öÆ÷#¢433”4S"öæ6Æ–6³Ò&WfVçBç7F÷&÷vF–öâ‚“¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å6Ö'Er’çfÇVSÒt6öç7VÇF6ö'&S¢G¶âçF—FÆRç&WÆ6R‚òrörÂ%ÅÂr"—Òs¶6öç7VÇD4Ä’‚w6Ö'Br’#ï	ù*Â6öç7VÇF"”Âö'WGFöãà¢ÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò’âÔ”äU,8Ô5$•Dò(	B4Ä5TÄDõ$¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BÔ”ä”äuôäõ$Ô2Ò°¢²&Vc¢t'Bâ#"$Ä•"(	BFW&V6–6œ;6âFR7F—f÷2f–¦÷2rÂF—FÆS¢tFW&V6–6œ;6âFRWV—÷2FRÖ–æW,:Ö„4”72ÂuW2’rÀ¢FW63¢tÆ÷2WV—÷2FRÖ–æW,:Ö6Æ–f–6â6öÖò7F—f÷2f–¦÷2â7RFW&V6–6œ;6âG&–'WF&–Ü:†–ÖW2FVÂ#RRçVÂ†ÖV–æ&–’WV—÷2’âÆf–F;§F–Â&VÂVVFR6W"ÖVæ÷"ârÀ¢FWF–Ã¦ÆƒCäFW&V6–6œ;6âG&–'WF&–FRWV—÷2FRÖ–æW,:ÖÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#ä'Bâ#"$Ä•#¢Æ÷2WV—÷2FR&ö6W6Ö–VçFòFRFF÷2„uW2Â4”72’6RFW&V6–âÂ#RRçVÂ6öÖò&WV—÷2FR<;6×WFò"âÇFW&æF—f¢#RçVÂ6öÖò&ÖV–æ&–"ãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æó¢6ö×&24”72÷"2ó#ÃâFW&V6–6œ;6âçVÂG&–'WF&–¢2ó3Ãƒ#RR’âVâB;÷2ÂVÂ7F—fòW7L:F÷FÆÖVçFRFW&V6–Fòâ6’ÆòfVæFW2VâVÂ;ò2÷"2ó#ÃÂF–VæW2Vævææ6–FR6—FÂFR2ó#ÃÒ2ó3Ã‡fÆ÷"VâÆ–'&÷2’Ò:—&F–FFR2óÃãÂöF—cà¢Ç7G&öæsä”ubVâÆ6ö×&£Â÷7G&öæsâ6’6ö×&2Æ÷2WV—÷2Vâ&÷fVVF÷"W'VæòòÆ÷2–×÷'F2Âv2”ubƒ‚R’âW7FR”ubW27,:–F—Fòf—66Â6öçG&VÂ”ubFRGW2÷W&6–öæW2w&fF2FRÖ–æW,:ÖæÒÀ¢²&Vc¢t–æf÷&ÖRCRÓ##2Õ5TäB²'Bâ#‚Ä•"rÂF—FÆS¢|+ô7\:æFòæ6RÆö&Æ–v6œ;6âG&–'WF&–VâÆÖ–æW,:ÖòrÀ¢FW63¢tÆ&VçFFRÆÖ–æW,:Ö7&—Fòæ6RÂÖ–æ"VÂ7F—fò‡&VçFFRgVVçFR&öGV7F—f’ÂæòÂfVæFW&ÆòâW7FW2Æ÷6–6œ;6âÖ–÷&—F&–÷"æÆö|:ÖârÀ¢FWF–Ã¦ÆƒCäÖöÖVçFòFR&V6öæö6–Ö–VçFòFRÆ&VçFFRÖ–æW,:ÖÂöƒCà¢ÆF—b6Æ73Ò&6ÂÖ'B#å÷6–6œ;6â†Ü:26öç6W'fF÷&“¢Æ&VçF6R&V6öæö6RÂÖ–æ"(	BfÆ÷"FRÖW&6FòFVÂ7&—FòÂÖöÖVçFòFRÆW‡G&66œ;6âÒ&VçFFR7&6FVv÷,:Öâ7VæFò6RfVæFRÂÆvææ6–F–6–öæÂW2&VçFFR6—FÂãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖ'B#å÷6–6œ;6â#¢6öÆòÆfVçFvVæW&&VçF‡&–æ6—–òFR&VÆ—¦6œ;6â’âVÂÖ–æ–ærW26öÖò&W‡G&W"VâÖ–æW&Â"(	BÆ&VçF7W&vR7VæFò6RVæ¦VæãÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖV¦V×Æò#äV¦V×Æò÷6–6œ;6â¢Ö–æ2ã%D2‡fÆ÷"2ó2ÃSÂÖ–æ"’â&VçFFR7&¢2ó2ÃSâÇVVvòfVæFW27VæFòfÆR2óRÃâvææ6–F–6–öæÂ2óÃSƒ&Fò7&6V|;¦â6FVv÷,:Ö’âDõDÂG&–'WF&ÆS¢2óRÃãÂöF—cà¢Ç7G&öæså&V6öÖVæF6œ;6ã£Â÷7G&öæsâF÷F"Æ÷6–6œ;6âÜ:26öç6W'fF÷&…÷6–6œ;6â’&Wf—F"6öçF–ævVæ6–2â5TäBæò†VÖ—F–Fò&öçVæ6–Ö–VçFòW7V<:Öf–6òæÒÀ¥Ó° ¦gVæ7F–öâ&VæFW$Ö–æ–ær‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–æ–ætæ÷&Ö2r“²–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒÔ”ä”äuôäõ$Ô2æÖ‚†âÆ’’ÓâÆF—b6Æ73Ò&6ÂÖæ÷&Ö"öæ6Æ–6³Ò'FövvÆT4ÄFWF–Â‚vÖ–æ–æuòG¶—Òr’#à¢ÆF—b6Æ73Ò&6ÂÖæ÷&Ö×F÷#ãÆF—cãÆF—b6Æ73Ò&6ÂÖæ÷&Ö×&Vb#âG¶âç&VgÓÂöF—cãÆF—b6Æ73Ò&6ÂÖæ÷&Ö×F—FÆR#âG¶âçF—FÆWÓÂöF—cãÂöF—cãÇ7â6Æ73Ò&6ÂÖ&FvRçVWfò#äÖ–æW,:ÖÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖæ÷&ÖÖFW62#âG¶âæFW67ÓÂöF—cà¢ÆF—b6Æ73Ò&6ÂÖæ÷&ÖÖFWF–Â"–CÒ&6ÄFWF–ÅöÖ–æ–æuòG¶—Ò#âG¶âæFWF–ÇÓÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°§Ğ ¦gVæ7F–öâ6Æ4Ö–æ–ær‚’°¢6öç7B–ærÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–ä–æw&W6òr“òçfÇVR—ÇÃ°¢6öç7BVÆV2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–äVÆV2r“òçfÇVR—ÇÃ°¢6öç7BWV—÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–äWV—÷2r“òçfÇVR—ÇÃ°¢6öç7Bf–FWF–ÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–åf–FWF–Âr“òçfÇVR—ÇÃC°¢6öç7B÷G&÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–ä÷G&÷4v7F÷2r“òçfÇVR—ÇÃ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–åF—òr“òçfÇVWÇÂw¢s°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–æ–æu&W7VÇBr“²–b‚VÇÇÂ–ær’&WGW&ã°¢6öç7BT•BÒSS°¢6öç7BFW&V6–6–öâÒWV—÷2¢ã#S²òò#RRçVÂÜ:‚à¢6öç7Bv7F÷2ÒVÆV2²FW&V6–6–öâ²÷G&÷3°¢6öç7B&VçFæWFÒÖF‚æÖ‚ƒÂ–ærÒv7F÷2“°¢ÆWB—"ÒÂ6FVrÒrs°¢–b‡F—óÓÓÒw¢wÇÇF—óÓÓÒwåö†&—GVÂr’°¢6FVsÒs7&6FVv÷,:Ös²—#×&VçFæWFÃÓR¥T•C÷&VçFæWF£ã£R¥T•B£ã²‡&VçFæWFÓR¥T•B’£ã#“S°¢ÒVÇ6R°¢6FVsÒs&F6FVv÷,:Ös²—#×&VçFæWF£ã‚£ãc#S°¢Ğ¢6öç7Bf×E2ÒãÓâu2òr´ÖF‚ç&÷VæB†â’çFôÆö6ÆU7G&–ær‚“°¢VÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢VÂæ–ææW$…DÔÃÖÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒC‚Ãg"’“¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£'‚#à¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b#âG¶f×E2†–ær—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#ä–æw&W6÷2÷"Ö–æW,:ÖÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âÒG¶f×E2†v7F÷2—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#äv7F÷2FVGV6–&ÆW3ÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB’#âG¶f×E2‡&VçFæWF—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#å&VçFæWF‚G¶6FVwÒ“ÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âG¶f×E2†—"—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#ä•"v#ÂöF—cãÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£—ƒ·FF–æs£'ƒ¶föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ã‚#à¢ÆF—b6Æ73Ò'F–Ò×&÷r#ãÇ7â6Æ73Ò'F–Ò×&÷rÖÆ&Â#äFW&V6–6œ;6âWV—÷2ƒ#RRö;ò“Â÷7ããÇ7â6Æ73Ò'F–Ò×&÷r×fÂ#âÒG¶f×E2†FW&V6–6–öâ—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò'F–Ò×&÷r#ãÇ7â6Æ73Ò'F–Ò×&÷rÖÆ&Â#äVÆV7G&–6–FCÂ÷7ããÇ7â6Æ73Ò'F–Ò×&÷r×fÂ#âÒG¶f×E2†VÆV2—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò'F–Ò×&÷r#ãÇ7â6Æ73Ò'F–Ò×&÷rÖÆ&Â#ä÷G&÷2v7F÷3Â÷7ããÇ7â6Æ73Ò'F–Ò×&÷r×fÂ#âÒG¶f×E2†÷G&÷2—ÓÂ÷7ããÂöF—cà¢ÆF—b6Æ73Ò'F–Ò×&÷r#ãÇ7â6Æ73Ò'F–Ò×&÷rÖÆ&Â#äÖ&vVâ÷W&F—fòÖ–æW,:ÖÂ÷7ããÇ7â6Æ73Ò'F–Ò×&÷r×fÂ#âG²‚‡&VçFæWFö–ær’£’çFôf—†VBƒ—ÒSÂ÷7ããÂöF—cà¢ÂöF—cà¢Ç7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£‡‚#ä&6RÆVvÃ¢'Bâ#"$Ä•"†FW&V6–6œ;6â’Â–æf÷&ÖRCRÓ##2Õ5TäBâ6öç7VÇF"6öâ6öçFF÷"&66òW7V<:Öf–6òãÂ÷æ°§Ğ ¢òò)H)HvVæW&–2FövvÆRf÷"FWF–ÂæVÇ2)H)H ¦gVæ7F–öâFövvÆT4ÄFWF–Â†–B’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÄFWF–Åòr²–B“°¢–b†VÂ’°¢òò6Æ÷6RÆÂ÷F†W'2–â6ÖR&Vç@¢6öç7B&VçBÒVÂæ6Æ÷6W7B‚ræ6ÂÖæ÷&ÖÂæFVf’Ö6&Br“°¢–b‡&VçB’°¢6öç7BÆÄFWF–Ç2Ò&VçBç&VçDVÆVÖVçBçVW'•6VÆV7F÷$ÆÂ‚ræ6ÂÖæ÷&ÖÖFWF–ÂÂæFVf’×G&VFÖVçBr“°¢ÆÄFWF–Ç2æf÷$V6‚†BÓâ²–b†BÓÖVÂ’Bæ6Æ74Æ—7Bç&VÖ÷fR‚v÷Vâr“²Ò“°¢Ğ¢VÂæ6Æ74Æ—7BçFövvÆR‚v÷Vâr“°¢Ğ§Ğ ¢òò)H)HD4‚6WEF")H)H ¦6öç7Bö÷&–u6WEF$4ÂÒ6WEF#°§6WEF"ÒgVæ7F–öâ‡F"Â'Fâ’°¢ö÷&–u6WEF$4Â‡F"Â'Fâ“°¢–b‡F"ÓÓÒv7&—FõöÆVvÂr’°¢6WD4ÅF"‚w7VæEöwV–rÂçVÆÂ“°¢6WEF–ÖV÷WB‚‚’ÓâFö7VÖVçBçVW'•6VÆV7F÷"‚ræ6Â×F"r“òæ6Æ74Æ—7BæFB‚v7F—fRr’ÂS“°¢Ğ§Ğ  ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòTä”d”TB5U%$Tä5’båTÔ$U"dõ$ÔED”äp¢òòÆÂÖöæWF'’F—7Æ’–âF†RvöW2F‡&÷Vv‚F†W6R†VÇW'2à¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¢ò¢ ¢¢f÷&ÖBçVÖ&W"2W'Wf–â6öÆW2à¢¢&Ò¶çVÖ&W'ÒâÒF†RÖ÷VçBFòf÷&Ö@¢¢&Ò¶çVÖ&W'Ò¶FV3Ó%ÒÒFV6–ÖÂÆ6W2ƒÒ&÷VæBFò6öÆW2¢¢&WGW&ç2·7G&–æwÒRærâ%2ò"Ã3CRãc ¢¢ğ¦gVæ7F–öâf×E2†âÂFV2Ò"’°¢–b†âÓÓÒçVÆÂÇÂâÓÓÒVæFVf–æVBÇÂ—4æâ†â’’&WGW&âu2ò(	Bs°¢&WGW&âu2òr²çVÖ&W"†â’çFôÆö6ÆU7G&–ær‚vW2ÕRrÂ°¢Ö–æ–×VÔg&7F–öäF–v—G3¢FV2À¢Ö†–×VÔg&7F–öäF–v—G3¢FV2À¢Ò“°§Ğ ¢ò¢ ¢¢6ö×7Bf÷&ÖGFW"f÷"Æ&vRÖ÷VçG2„²òÒ7Vff—†W2’à¢¢&Ò¶çVÖ&W'Òà¢¢&WGW&ç2·7G&–æwÒRærâ%2òã$Ò ¢¢ğ¦gVæ7F–öâf×E46ö×7B†â’°¢–b†âÓÓÒçVÆÂÇÂâÓÓÒVæFVf–æVBÇÂ—4æâ†â’’&WGW&âu2ò(	Bs°¢6öç7B'2ÒÖF‚æ'2†â“°¢–b†'2ãÒóó’&WGW&âu2òr²†âòóó’çFôf—†VBƒ’²tÒs°¢–b†'2ãÒó’&WGW&âu2òr²†âòó’çFôf—†VBƒ’²t²s°¢&WGW&âf×E2†âÂ“°§Ğ ¢ò¢ ¢¢f÷&ÖBÆ–âçVÖ&W"v—F‚F†÷W6æB6W&F÷'2†æò7W'&Væ7’7–Ö&öÂ’à¢¢&Ò¶çVÖ&W'Òà¢¢&Ò¶çVÖ&W'Ò¶FV3ÓĞ¢¢ğ¦gVæ7F–öâf×Dâ†âÂFV2Ò’°¢–b†âÓÓÒçVÆÂÇÂâÓÓÒVæFVf–æVBÇÂ—4æâ†â’’&WGW&â~(	Bs°¢&WGW&âçVÖ&W"†â’çFôÆö6ÆU7G&–ær‚vW2ÕRrÂ°¢Ö–æ–×VÔg&7F–öäF–v—G3¢FV2À¢Ö†–×VÔg&7F–öäF–v—G3¢FV2À¢Ò“°§Ğ ¢ò¢ ¢¢f÷&ÖB2W&6VçFvRà¢¢&Ò¶çVÖ&W'ÒâÒfÇVR&WGvVVâæB†RærâãƒR¢¢&Ò¶çVÖ&W'Ò¶FV3ÓĞ¢¢ğ¦gVæ7F–öâf×E7B†âÂFV2Ò’°¢–b†âÓÓÒçVÆÂÇÂâÓÓÒVæFVf–æVBÇÂ—4æâ†â’’&WGW&â~(	BRs°¢&WGW&â†â¢’çFôf—†VB†FV2’²rRs°§Ğ ¢òòÆ–6W2¶WBf÷"&6·v&B6ö×F–&–Æ—G’v—F‚W†—7F–ær6ÆÂ6—FW0¦6öç7Bf÷&ÖD7W'&Væ7’Òf×E3°¦6öç7Bf÷&ÖDçVÖ&W"Òf×Dã°  ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòÄôD”är5”ääU"UD”Ä•D”U0¢òòG7–ææW"‡6†÷rÂÆ&VÂ’(	BvRÖÆWfVÂgVÆÂ÷fW&Æ¢òòG'FäÆöB†'FâÂÆöF–ær’(	BW"Ö'WGFöâ7–ææW"7FFP¢òòG7–æ4'Fâ†'FâÂfâ’(	Bw&7–æ2fâv—F‚'WGFöâ7–ææW ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâG7–ææW"‡6†÷rÂÆ&VÂÒu&ö6W6æFòâââr’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wG×vR×7–ææW"r“°¢6öç7BÆ"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wG×vR×7–ææW"ÖÆ&VÂr“°¢–b‚VÂ’&WGW&ã°¢–b†Æ"’Æ"çFW‡D6öçFVçBÒÆ&VÃ°¢VÂæ6Æ74Æ—7BçFövvÆR‚w6†÷rrÂ6†÷r“°§Ğ ¦gVæ7F–öâG'FäÆöB†'FâÂÆöF–ær’°¢–b‚'Fâ’&WGW&ã°¢'Fâæ6Æ74Æ—7BçFövvÆR‚v'FâÖÆöF–ærrÂÆöF–ær“°¢'FâæF—6&ÆVBÒÆöF–æs°§Ğ ¢òòw&2â7–æ2gVæ7F–öã¢6†÷w2'WGFöâ7–ææW"v†–ÆR'Vææ–ærÀ¢òò6F6†W2W'&÷'22Fö7G2à¦7–æ2gVæ7F–öâG7–æ4'Fâ†'FâÂfâÂÆöDÆ&VÂÒu&ö6W6æFòâââr’°¢G'FäÆöB†'FâÂG'VR“°¢G'’°¢v—Bfâ‚“°¢Ò6F6‚†R’°¢GFö7B†RæÖW76vRÇÂtW'&÷"–æW7W&Fòâ–çFVçFFRçVWfòârÂvW'&÷"r“°¢Òf–æÆÇ’°¢G'FäÆöB†'FâÂfÇ6R“°¢Ğ§Ğ ¢òòF6‚6†÷tWF„ÆöF–ærFòW6R÷W"7–ææW"–ç7FVBöb–æÆ–æR552†6·0¦gVæ7F–öâ6†÷tWF„ÆöF–ær‡6†÷r’°¢G7–ææW"‡6†÷rÂ6†÷ròtWFVçF–6æFòâââr¢rr“°§Ğ   ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4TuU$”DB…52(	B6fT…DÔÂ‚’’&VæFW$•&W7öç6R‚¢òòW6"6–V×&R6fT…DÔÂ‚’VâÇVv"FR–ææW$…DÔÂF—&V7Fò&¢òò6öçFVæ–FòvVæW&Fò÷"Æ”ò–æw&W6Fò÷"VÂW7V&–òà¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6fT…DÔÂ‡7G"’°¢–b‚7G"’&WGW&ârs°¢–b‡G—VöbDôÕW&–g’ÓÒwVæFVf–æVBr’°¢&WGW&âDôÕW&–g’ç6æ—F—¦R‡7G"Â°¢U4Uõ$ôd”ÄU3¢²‡FÖÃ¢G'VRÒÀ¢dõ$$”EõDu3¢²w67&—BrÂv–g&ÖRrÂvö&¦V7BrÂvVÖ&VBuÒÀ¢dõ$$”EôEE#¢²vöæW'&÷"rÂvöæÆöBrÂvöæ6Æ–6²rÂvöæÖ÷W6V÷fW"uĞ¢Ò“°¢Ğ¢òò6’DôÕW&–g’æò6&vÂæò6RW&Ö—FR…DÔÃ¢6R×VW7G&6öÖòFW‡Fòà¢&WGW&âöW66T‡FÖÂ…7G&–ær‡7G"’“°§Ğ ¦gVæ7F–öâ&VæFW$•&W7öç6R†VÂÂ&uFW‡B’°¢–b‚VÂÇÂ&uFW‡B’&WGW&ã°¢òòâW66"…DÔÂæF—fòFVÂFW‡Fğ¢6öç7BW66VBÒ&uFW‡@¢ç&WÆ6R‚òbörÂrf×²r¢ç&WÆ6R‚óÂörÂrfÇC²r¢ç&WÆ6R‚óâörÂrfwC²r“°¢òò"âÆ–6"f÷&ÖFòÖ&¶F÷vâ,:6–6ğ¢6öç7Bf÷&ÖGFVBÒW66V@¢ç&WÆ6R‚õÆâörÂsÆ'#âr¢ç&WÆ6R‚õÂ¥Â¢‚â£ò•Â¥Â¢örÂsÇ7G&öæsâCÂ÷7G&öæsâr¢ç&WÆ6R‚õÂ¢‚â£ò•Â¢örÂsÆVÓâCÂöVÓâr¢ç&WÆ6R‚ö‚â£ò–örÂsÆ6öFR7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã‚“·FF–æs£‚Wƒ¶&÷&FW"×&F—W3£7ƒ¶föçB×6—¦S£G‚#âCÂö6öFSâr“°¢òò2â6æ—F—¦"’6–væ ¢VÂæ–ææW$…DÔÂÒ6fT…DÔÂ†f÷&ÖGFVB“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò44U4”$”Ä”DB(	Bfö7W2G&&ÖöFÆW0¢òòW6ó¢6öç7BG&ÒG&fö7W2†ÖöFÄVÆVÖVçB¢òòG&ç&VÆV6R‚’7VæFò6–W'&W2VÂÖöFÀ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâG&fö7W2†ÖöFÂ’°¢–b‚ÖöFÂ’&WGW&â²&VÆV6S¢‚’Óâ·ÒÓ°¢6öç7Bfö7W6&ÆRÒÖöFÂçVW'•6VÆV7F÷$ÆÂ€¢v'WGFöâÂ¶‡&VeÒÂ–çWBÂ6VÆV7BÂFW‡F&VÂ·F&–æFW…Ó¦æ÷B…·F&–æFWƒÒ"Ó%Ò’p¢“°¢–b‚fö7W6&ÆRæÆVæwF‚’&WGW&â²&VÆV6S¢‚’Óâ·ÒÓ°¢6öç7Bf—'7BÒfö7W6&ÆU³Ó°¢6öç7BÆ7BÒfö7W6&ÆU¶fö7W6&ÆRæÆVæwF‚ÒÓ°¢6öç7B&Wdfö7W2ÒFö7VÖVçBæ7F—fTVÆVÖVçC°¢f—'7Bæfö7W2‚“°¢gVæ7F–öâöä¶W’†R’°¢–b†Ræ¶W’ÓÒuF"r’&WGW&ã°¢–b†Rç6†–gD¶W’’°¢–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒf—'7B’²Rç&WfVçDFVfVÇB‚“²Æ7Bæfö7W2‚“²Ğ¢ÒVÇ6R°¢–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒÆ7B’²Rç&WfVçDFVfVÇB‚“²f—'7Bæfö7W2‚“²Ğ¢Ğ¢Ğ¢ÖöFÂæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂöä¶W’“°¢&WGW&â°¢&VÆV6R‚’°¢ÖöFÂç&VÖ÷fTWfVçDÆ—7FVæW"‚v¶W–F÷vârÂöä¶W’“°¢–b‡&Wdfö7W2bb&Wdfö7W2æfö7W2’&Wdfö7W2æfö7W2‚“°¢Ğ¢Ó°§Ğ ¢òò7F÷&R7F—fRG&26òvR6â&VÆV6RöâÖöFÂ6Æ÷6P§v–æF÷råöfö7W5G&2Ò·Ó° ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòDô5BäõD”d”4D”ôâ5•5DTĞ¢òò&WÆ6W2ÆÂæF—fRÆW'B‚’6ÆÇ2v—F‚æöâÖ&Æö6¶–ærFö7G2à¢òòW6vS¢GFö7B†×6rÂG—SÒv–æfòrÂF—FÆSÒrr’G—S¢–æf÷Ç7V66W77ÆW'&÷'Çv&à¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâGFö7B†×6rÂG—RÒv–æfòrÂF—FÆRÒrr’°¢6öç7Bw&ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wG×Fö7B×w&r“°¢–b‚w&’²6öç6öÆRçv&â†×6r“²&WGW&ã²Ğ ¢òòÖG—RFò–6öâ²FVfVÇBF—FÆP¢6öç7BÖWFÒ°¢–æfó¢²–6öã¢~(KûˆòrÂGC¢t–æf÷&Ö6œ;6ârÒÀ¢7V66W73¢²–6öã¢~)ÈRrÂGC¢tÆ—7FòrÒÀ¢W'&÷#¢²–6öã¢~)ØÂrÂGC¢tW'&÷"rÒÀ¢v&ã¢²–6öã¢~)ªûˆòrÂGC¢tFVæ6œ;6ârÒÀ¢Ó°¢6öç7B²–6öâÂGBÒÒÖWF·G—UÒÇÂÖWFæ–æfó°¢6öç7BF—7Æ•F—FÆRÒF—FÆRÇÂGC° ¢6öç7BVÂÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢VÂæ6Æ74æÖRÒG×Fö7BG·G—WÖ°¢VÂç6WDGG&–'WFR‚w&öÆRrÂvÆW'Br“°¢VÂæ–ææW$…DÔÂÒ ¢ÆF—b6Æ73Ò'G×Fö7BÖ–6öâ"&–Ö†–FFVãÒ'G'VR#âG¶–6öçÓÂöF—cà¢ÆF—b6Æ73Ò'G×Fö7BÖ&öG’#à¢ÆF—b6Æ73Ò'G×Fö7B×F—FÆR#âG¶F—7Æ•F—FÆWÓÂöF—cà¢ÆF—b6Æ73Ò'G×Fö7BÖ×6r#âG¶×6wÓÂöF—cà¢ÂöF—cà¢Æ'WGFöâ6Æ73Ò'G×Fö7BÖ6Æ÷6R"&–ÖÆ&VÃÒ$6W'&"æ÷F–f–66œ;6â"öæ6Æ–6³Ò'GF—6Ö—72‡F†—2ç&VçDVÆVÖVçB’#î)ÉSÂö'WGFöãæ°¢w&æVæD6†–ÆB†VÂ“° ¢òòWFòÖF—6Ö—72gFW"B2†W'&÷'27F’r2¢6öç7BFVÆ’ÒG—RÓÓÒvW'&÷"ròs¢C°¢6WEF–ÖV÷WB‚‚’ÓâGF—6Ö—72†VÂ’ÂFVÆ’“°§Ğ ¦gVæ7F–öâGF—6Ö—72†VÂ’°¢–b‚VÂÇÂVÂæ6Æ74Æ—7Bæ6öçF–ç2‚v†–FRr’’&WGW&ã°¢VÂæ6Æ74Æ—7BæFB‚v†–FRr“°¢6WEF–ÖV÷WB‚‚’ÓâVÂç&VÖ÷fR‚’Â#c“°§Ğ ¢òò)H)H4ôäd•$ÒD”Äôr)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòW6vS¢G6öæf—&Ò‚|+ôVÆ–Ö–æ#òrÂtW7F66œ;6âæò6RVVFRFW6†6W"âr’çF†Vâ†ö²Óâ²–b†ö²’âââÒ¢òò&WGW&ç2&öÖ—6SÆ&ööÆVãà¦gVæ7F–öâG6öæf—&Ò‡F—FÆRÂ×6rÂ–6öâÒ~)ªûˆòrÂö´Æ&VÂÒt6öæf—&Ö"rÂ6æ6VÄÆ&VÂÒt6æ6VÆ"r’°¢&WGW&âæWr&öÖ—6R‡&W6öÇfRÓâ°¢6öç7B÷fW&Æ’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6öæf—&ÒÖ÷fW&Æ’r“°¢6öç7Bö´'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6bÖö²r“°¢6öç7B6ä'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6bÖ6æ6VÂr“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6bÖ–6öâr’çFW‡D6öçFVçBÒ–6öã°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6b×F—FÆRr’çFW‡D6öçFVçBÒF—FÆS°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6bÖ×6rr’çFW‡D6öçFVçBÒ×6s°¢ö´'FâçFW‡D6öçFVçBÒö´Æ&VÃ°¢6ä'FâçFW‡D6öçFVçBÒ6æ6VÄÆ&VÃ°¢÷fW&Æ’æ6Æ74Æ—7BæFB‚w6†÷rr“°¢ö´'Fâæfö7W2‚“° ¢òò6ÆVâWæB&W6öÇfP¢6öç7BFöæRÒ‡fÂ’Óâ°¢÷fW&Æ’æ6Æ74Æ—7Bç&VÖ÷fR‚w6†÷rr“°¢ö´'Fâç&WÆ6Uv—F‚†ö´'Fâæ6ÆöæTæöFR‡G'VR’“²òò&VÖ÷fRöÆBÆ—7FVæW'0¢6ä'Fâç&WÆ6Uv—F‚†6ä'Fâæ6ÆöæTæöFR‡G'VR’“°¢&W6öÇfR‡fÂ“°¢Ó°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6bÖö²r’æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’ÓâFöæR‡G'VR’Â²öæ6S¢G'VRÒ“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6bÖ6æ6VÂr’æFDWfVçDÆ—7FVæW"‚v6Æ–6²rÂ‚’ÓâFöæR†fÇ6R’Â²öæ6S¢G'VRÒ“°¢÷fW&Æ’æFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂRÓâ²–b†Ræ¶W’ÓÓÒtW66Rr’FöæR†fÇ6R“²ÒÂ²öæ6S¢G'VRÒ“°¢Ò“°§Ğ ¢òò&6·v&BÖ6ö×B6†–Ò6òæ÷F†–ær'&V·2–böÆB6öFR6ÆÇ2ÆW'B‚§v–æF÷råöæF—fTÆW'BÒv–æF÷ræÆW'C°§v–æF÷ræÆW'BÒ†×6r’ÓâGFö7B†×6rÂwv&âr“°  ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò44U54”$”Ä•E’UD”Ä•D”U0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¢òò)H)H¶W–&ö&BÖæbFWFV7F–öâ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòFBæ¶"ÖæbFò&öG’v†VâW6W"&W76W2F#²&VÖ÷fRöâÖ÷W6R6Æ–6²à¢òòF†—2Vç7W&W2fö7W2&–æw2öæÇ’V"f÷"¶W–&ö&BW6W'2à¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂRÓâ°¢–b†Ræ¶W’ÓÓÒuF"r’Fö7VÖVçBæ&öG’æ6Æ74Æ—7BæFB‚v¶"Öæbr“°§Ò“°¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚vÖ÷W6VF÷vârÂ‚’Óâ°¢Fö7VÖVçBæ&öG’æ6Æ74Æ—7Bç&VÖ÷fR‚v¶"Öæbr“°§Ò“° ¢òò)H)H†–v‚Ö6öçG&7BFövvÆR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâFövvÆT„2‚’°¢6öç7BöâÒFö7VÖVçBæ&öG’æ6Æ74Æ—7BçFövvÆR‚v†2ÖÖöFRr“°¢Æö6Å7F÷&vRç6WD—FVÒ‚wGö†2rÂöâòsr¢rr“°¢GFö7B†öâòtÖöFòÇFò6öçG&7FR7F—fFòr¢tÖöFòW7L:æF"&W7FW&FòrÂv–æfòr“°¢6öç7B'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v†4'Fâr“°¢–b†'Fâ’'Fâç6WDGG&–'WFR‚v&–×&W76VBrÂ7G&–ær†öâ’“°§Ğ ¢òò&W7F÷&R„2&VfW&Væ6RöâÆö@¢†gVæ7F–öâ&W7F÷&T„2‚’°¢–b†Æö6Å7F÷&vRævWD—FVÒ‚wGö†2r’’°¢Fö7VÖVçBæ&öG’æ6Æ74Æ—7BæFB‚v†2ÖÖöFRr“°¢Ğ§Ò’‚“° ¢òò)H)H&–ÖÆ—fR&Vv–öâ†VÇW")H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢òòææ÷Væ6R6†÷'BÖW76vW2Fò67&VVâ&VFW'2„B’v—F†÷WB6†÷v–ærFö7Bà¦gVæ7F–öâ&–ææ÷Væ6R†×6rÂ&–÷&—G’ÒwöÆ—FRr’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ&–ÖÆ—fRÒr²&–÷&—G’“°¢–b‚VÂ’&WGW&ã°¢VÂçFW‡D6öçFVçBÒrs°¢&WVW7Dæ–ÖF–öäg&ÖR‚‚’Óâ²VÂçFW‡D6öçFVçBÒ×6s²Ò“°§Ğ ¢òò)H)Hfö7W2G&f÷"ÖöFÇ2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¦gVæ7F–öâG&fö7W2†6öçF–æW$VÂ’°¢6öç7Bfö7W6&ÆRÒ6öçF–æW$VÂçVW'•6VÆV7F÷$ÆÂ€¢v¶‡&VeÒÆ'WGFöã¦æ÷B…¶F—6&ÆVEÒ’Æ–çWC¦æ÷B…¶F—6&ÆVEÒ’Ç6VÆV7C¦æ÷B…¶F—6&ÆVEÒ’ÇFW‡F&V¦æ÷B…¶F—6&ÆVEÒ’Å·F&–æFW…Ó¦æ÷B…·F&–æFWƒÒ"Ó%Ò’p¢“°¢–b‚fö7W6&ÆRæÆVæwF‚’&WGW&â‚’Óâ·Ó°¢6öç7Bf—'7BÒfö7W6&ÆU³ÒÂÆ7BÒfö7W6&ÆU¶fö7W6&ÆRæÆVæwF‚ÒÓ°¢6öç7B†æFÆW"Ò†R’Óâ°¢–b†Ræ¶W’ÓÒuF"r’&WGW&ã°¢–b†Rç6†–gD¶W’’²–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒf—'7B’²Rç&WfVçDFVfVÇB‚“²Æ7Bæfö7W2‚“²ÒĞ¢VÇ6R²–b†Fö7VÖVçBæ7F—fTVÆVÖVçBÓÓÒÆ7B’²Rç&WfVçDFVfVÇB‚“²f—'7Bæfö7W2‚“²ÒĞ¢Ó°¢6öçF–æW$VÂæFDWfVçDÆ—7FVæW"‚v¶W–F÷vârÂ†æFÆW"“°¢&WGW&â‚’Óâ6öçF–æW$VÂç&VÖ÷fTWfVçDÆ—7FVæW"‚v¶W–F÷vârÂ†æFÆW"“°§Ğ ¢òòÇ’fö7W2G&FòF†R6öæf—&ÒF–Æöp¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚tDôÔ6öçFVçDÆöFVBrÂ‚’Óâ°¢6öç7B÷fW&Æ’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6öæf—&ÒÖ÷fW&Æ’r“°¢–b†÷fW&Æ’’°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6öæf—&ÒÖ&÷‚r“°¢6öç7Bö'6W'fW"ÒæWr×WFF–öäö'6W'fW"‚‚’Óâ°¢–b†÷fW&Æ’æ6Æ74Æ—7Bæ6öçF–ç2‚w6†÷rr’’°¢6öç7B&VÆV6RÒG&fö7W2†&÷‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGÖ6bÖö²r“òæfö7W2‚“°¢6öç7B7F÷öä†–FRÒ‚’Óâ²&VÆV6R‚“²÷fW&Æ’ç&VÖ÷fTWfVçDÆ—7FVæW"‚v6Æ77&VÖ÷fVBrÂ7F÷öä†–FR“²Ó°¢òòvF6‚f÷"&VÖ÷fÂöbw6†÷rp¢æWr×WFF–öäö'6W'fW"‚…òÂö'2’Óâ°¢–b‚÷fW&Æ’æ6Æ74Æ—7Bæ6öçF–ç2‚w6†÷rr’’²&VÆV6R‚“²ö'2æF—66öææV7B‚“²Ğ¢Ò’æö'6W'fR†÷fW&Æ’Â²GG&–'WFW3¢G'VRÂGG&–'WFTf–ÇFW#¢²v6Æ72uÒÒ“°¢Ğ¢Ò“°¢ö'6W'fW"æö'6W'fR†÷fW&Æ’Â²GG&–'WFW3¢G'VRÂGG&–'WFTf–ÇFW#¢²v6Æ72uÒÒ“°¢Ğ§Ò“°   ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòTä•BDU5E2(	BÖ÷f–F÷2FV6Æ&g’çFW7Bæ§0¢òò&V¦V7WF#¢6&v"W7FR&6†—fò’FV6Æ&g’çFW7Bæ§2VâVÂæfVvF÷"À¢òòÇVVvòÆÆÖ"G'VåFW7G2‚’VâÆ6öç6öÆFVÂFW6'&öÆÆF÷"à¢òòäò6&v"FV6Æ&g’çFW7Bæ§2Vâ&öGV66œ;6âà¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4TuU$”DB(	B&FRÆ–Ö—F–ær†6Æ–VçFR¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BEõ$Åô´U’ÒwG÷&Å÷G2s°¦6öç7BEõ$ÅôÔ‚Ò°¦6öç7BEõ$Åõt”âÒc° ¦gVæ7F–öâG6†V6µ&FTÆ–Ö—B‚’°¢G'’°¢6öç7BG2Ò¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…Eõ$Åô´U’’ÇÂuµÒr“°¢6öç7Bæ÷rÒFFRææ÷r‚“°¢6öç7B&V6VçBÒG2æf–ÇFW"‡BÓâæ÷rÒBÂEõ$Åõt”â“°¢–b‡&V6VçBæÆVæwF‚ãÒEõ$ÅôÔ‚’°¢6öç7Bv—BÒÖF‚æ6V–Â‚…Eõ$Åõt”âÒ†æ÷rÒ&V6VçE³Ò’’ò“°¢GFö7B†Ì:ÖÖ—FRFRfVÆö6–FBÆ6ç¦FòâW7W&G·v—G×2çFW2FRÆ,;7†–Ö6öç7VÇFæÂwv&âr“°¢&WGW&âfÇ6S°¢Ğ¢&V6VçBçW6‚†æ÷r“°¢Æö6Å7F÷&vRç6WD—FVÒ…Eõ$Åô´U’Â¥4ôâç7G&–æv–g’‡&V6VçBç6Æ–6R‚ÕEõ$ÅôÔ‚’’“°¢&WGW&âG'VS°¢Ò6F6‚²&WGW&âG'VS²Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4TuU$”DB(	BfÆ–F6œ;6âFR%T2†Æv÷&—FÖòW'Væò²’¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâGfÆ–FFU%T4f÷&ÖB‡'V2’°¢–b‚'V2ÇÂ'V2æÆVæwF‚ÓÒÇÂõåÆG³ÒBòçFW7B‡'V2’¢&WGW&â²fÆ–C¢fÇ6RÂ×6s¢tVÂ%T2FV&RFVæW"W†7FÖVçFRL:Öv—F÷2çVÜ:—&–6÷2ârÓ°¢–b‚²srÂsRrÂsbrÂsrrÂs#uÒç6öÖR‡Óâ'V2ç7F'G5v—F‚‡’’¢&WGW&â²fÆ–C¢fÇ6RÂ×6s¢u%T2FV&RV×W¦"6öâÂRÂbÂrò#ârÓ°¢6öç7BvV–v‡G2Ò³RÃBÃ2Ã"ÃrÃbÃRÃBÃ2Ã%Ó°¢6öç7B7VÒÒvV–v‡G2ç&VGV6R‚†62ÂrÂ’’Óâ62²r¢'6T–çB‡'V5¶•Ò’Â“°¢ÆWB6†V6²ÒÒ‡7VÒR“°¢–b†6†V6²ÓÓÒ’6†V6²Ò°¢–b†6†V6²ÓÓÒ’6†V6²Ò°¢–b†6†V6²ÓÒ'6T–çB‡'V5³Ò’¢&WGW&â²fÆ–C¢fÇ6RÂ×6s¢tL:Öv—FòFR6öçG&öÂ–çl:Æ–Fòâ&Wf—6VÂ%T2ârÓ°¢&WGW&â²fÆ–C¢G'VRÂF—ó¢'V2ç7F'G5v—F‚‚sr’òuW'6öææGW&Âr¢uW'6öæ§W,:ÖF–6rÓ°§Ğ ¦7–æ2gVæ7F–öâGfÆ–FFU%T4öæÆ–æR‡'V2’°¢6öç7Bf×BÒGfÆ–FFU%T4f÷&ÖB‡'V2“°¢–b‚f×BçfÆ–B’&WGW&âf×C°¢òòÆfW&–f–66œ;6âFRf÷&ÖFò’L:Öv—FòFR6öçG&öÂW2Æö6ÂâÆ6öç7VÇFFP¢òò–FVçF–FB5TäB6öÆò6R×VW7G&VâVÂÜ;6GVÆòVRW6Vâ&÷fVVF÷"WFVçF–6Fòà¢&WGW&â²ââæf×BÂöæÆ–æS¢fÇ6RÂ6÷W&6S¢wfÆ–F6–öâÖÆö6ÂrÓ°§Ğ ¦7–æ2gVæ7F–öâGfÆ–FFU%T4f–VÆB†–çWDVÂÂ&FvT–B’°¢6öç7B'V2Ò–çWDVÂçfÇVRçG&–Ò‚“°¢ÆWB&FvRÒFö7VÖVçBævWDVÆVÖVçD'”–B†&FvT–B“°¢–b‚&FvR’°¢&FvRÒFö7VÖVçBæ7&VFTVÆVÖVçB‚w7âr“°¢&FvRæ–BÒ&FvT–C°¢&FvRç7G–ÆRæ775FW‡BÒvföçB×6—¦S£Gƒ¶Ö&v–âÖÆVgC£gƒ·FF–æs£'‚‡ƒ¶&÷&FW"×&F—W3£‡ƒ·G&ç6—F–öã¦ÆÂã'2s°¢–çWDVÂç&VçDæöFRæVæD6†–ÆB†&FvR“°¢Ğ¢–b‡'V2æÆVæwF‚Â’²&FvRçFW‡D6öçFVçBÒrs²&WGW&ã²Ğ¢&FvRçFW‡D6öçFVçBÒ~)û2fÆ–FæFòâââs²&FvRç7G–ÆRæ6öÆ÷"Òwf"‚ÒÖ×WFVB’s°¢6öç7B&W7VÇBÒv—BGfÆ–FFU%T4öæÆ–æR‡'V2“°¢–b‚&W7VÇBçfÆ–B’°¢&FvRçFW‡D6öçFVçBÒ~)Érr²&W7VÇBæ×6s°¢&FvRç7G–ÆRæ775FW‡BÒvföçB×6—¦S£Gƒ¶Ö&v–âÖÆVgC£gƒ·FF–æs£'‚‡ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC§&v&ƒ#3ÃSrÃsÂã"“¶6öÆ÷#§f"‚Ò×&VB’s°¢ÒVÇ6R°¢6öç7BÆ&VÂÒ&W7VÇBæöæÆ–æRbb&W7VÇBææöÖ'&Rò)É2G·&W7VÇBææöÖ'&WÖ¢)É2%T2l:Æ–Fò+rG·&W7VÇBçF—÷Ö°¢&FvRçFW‡D6öçFVçBÒÆ&VÃ°¢&FvRç7G–ÆRæ775FW‡BÒvföçB×6—¦S£Gƒ¶Ö&v–âÖÆVgC£gƒ·FF–æs£'‚‡ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC§&v&ƒsbÃsRÃƒÂã"“¶6öÆ÷#§f"‚ÒÖw&VVâ’s°¢Ğ§Ğ ¢òò;F—"fÆ–F6œ;6âVâF–V×ò&VÂFöF÷2Æ÷26×÷2%T2FRFö7VÖVçF÷0¦gVæ7F–öâGGF6…%T5fÆ–FF÷'2‚’°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚v–çWE¶Ö†ÆVæwFƒÒ#%Õ·Æ6V†öÆFW"£Ò%%T2%Òr’æf÷$V6‚‚†–çÂ’’Óâ°¢6öç7B&FvT–BÒw'V2Ö&FvRÒr²“°¢–çæFDWfVçDÆ—7FVæW"‚v–çWBrÂ‚’Óâ°¢–b†–ççfÇVRæÆVæwF‚ÓÓÒ’GfÆ–FFU%T4f–VÆB†–çÂ&FvT–B“°¢VÇ6R²6öç7B"ÒFö7VÖVçBævWDVÆVÖVçD'”–B†&FvT–B“²–b†"’"çFW‡D6öçFVçCÒrs²Ğ¢Ò“°¢–çæFDWfVçDÆ—7FVæW"‚v&ÇW"rÂ‚’Óâ²–b†–ççfÇVRæÆVæwF‚ÓÓÒ’GfÆ–FFU%T4f–VÆB†–çÂ&FvT–B“²Ò“°¢Ò“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4TuU$”DB(	BVF—BÆöp¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BEôTD•Eô´U’ÒwGöVF—Bs°¦6öç7BEôTD•EôÔ‚Ò#° ¦gVæ7F–öâGVF—DÆör†7F–öâÂFWF–Â’°¢G'’°¢6öç7BÆörÒ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…EôTD•Eô´U’’ÇÂuµÒr“°¢ÆörçVç6†–gB‡²G3¢FFRææ÷r‚’Â7F–öâÂW6W#¢7W%W6W#òæVÖ–ÂÇÂvæöârÂFWF–Ã¢†FWF–ÇÇÂrr’ç7V'7G&–ærƒÃ#’Ò“°¢–b†ÆöræÆVæwF‚âEôTD•EôÔ‚’ÆöræÆVæwF‚ÒEôTD•EôÔƒ°¢Æö6Å7F÷&vRç6WD—FVÒ…EôTD•Eô´U’Â¥4ôâç7G&–æv–g’†Æör’“°¢Ò6F6‚·Ğ§Ğ ¦gVæ7F–öâG&VæFW$VF—DÆör‚’°¢6öç7BF&öG’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vVF—EF&öG’r“°¢–b‚F&öG’’&WGW&ã°¢G'’°¢6öç7BÆörÒ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…EôTD•Eô´U’’ÇÂuµÒr“°¢–b‚ÆöræÆVæwF‚’°¢F&öG’æ–ææW$…DÔÂÒsÇG#ãÇFB6öÇ7ãÒ#B"7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#§f"‚ÒÖ×WFVB“·FF–æs£‡‚#å6–âWfVçF÷2&Vv—7G&F÷2;¦âãÂ÷FCãÂ÷G#âs°¢&WGW&ã°¢Ğ¢F&öG’æ–ææW$…DÔÂÒÆörç6Æ–6RƒÃc’æÖ†RÓâ°¢6öç7BBÒæWrFFR†RçG2“°¢6öç7BG2ÒBçFôÆö6ÆTFFU7G&–ær‚vW2ÕRrÇ¶F“¢s"ÖF–v—BrÆÖöçFƒ¢w6†÷'BwÒ’²rr²BçFôÆö6ÆUF–ÖU7G&–ær‚vW2ÕRrÇ¶†÷W#¢s"ÖF–v—BrÆÖ–çWFS¢s"ÖF–v—BwÒ“°¢&WGW&âÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“·v†—FR×76S¦æ÷w&#âG¶G7ÓÂ÷FCãÇFCãÇ7â6Æ73Ò&VF—BÖ7F–öâG¶Ræ7F–öçÒ#âG¶Ræ7F–öçÓÂ÷7ããÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#âG¶RçW6W'ÓÂ÷FCãÇFCâG¶RæFWF–ÇÓÂ÷FCãÂ÷G#æ°¢Ò’æ¦ö–â‚rr“°¢Ò6F6‚²F&öG’æ–ææW$…DÔÂÒsÇG#ãÇFB6öÇ7ãÒ#B"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#äW'&÷"6&væFòÆörãÂ÷FCãÂ÷G#âs²Ğ§Ğ ¦gVæ7F–öâG6ÆV$VF—DÆör‚’°¢–b‚6öæf—&Ò‚|+ôÆ–×–"VÂÆörFRVF—F÷,:Öòæò6RVVFRFW6†6W"âr’’&WGW&ã°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ…EôTD•Eô´U’“°¢G&VæFW$VF—DÆör‚“°¢GFö7B‚tÆörÆ–×–FòârÂvö²r“°§Ğ ¢òòf—&V&6R—2F†RöæÇ’WF†VçF–6F–öâWF†÷&—G’à¦6öç7Bö÷&–tFôÆöv–äd$–ææW"ÒöFôÆöv–äd$f—&V&6T–×Ã°¦7–æ2gVæ7F–öâFôÆöv–äd"‚’°¢&WGW&âö÷&–tFôÆöv–äd$–ææW"‚“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòÄåD”ÄÄ2DR4ôå5TÅD…6fVB&ö×G2¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâGvWE&ö×G2‚’°¢G'’²&WGW&â¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚wG÷&ö×G5òr²†7W%W6W#òæVÖ–ÇÇÂrr’’ÇÂuµÒr“²Ğ¢6F6‚²&WGW&âµÓ²Ğ§Ğ¦gVæ7F–öâG6fU&ö×G2†Æ—7B’°¢·eWB‚wG÷&ö×G5òr²†7W%W6W#òæVÖ–ÇÇÂrr’ÂÆ—7BÂw&ö×G2r“°§Ğ§&Vv—7FW$µe66÷R‚w&ö×G2rÂ‚’ÓâwG÷&ö×G5òr²†7W%W6W#òæVÖ–ÇÇÂrr’“°¦gVæ7F–öâG6fT7W'&VçE&ö×B‚’°¢6öç7B–çÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW6W$–çWBr“°¢6öç7BFW‡BÒ–çòçfÇVSòçG&–Ò‚“°¢–b‚FW‡B’²GFö7B‚tW67&–&RVæ6öç7VÇF&–ÖW&ò&wV&F&Æ6öÖòÆçF–ÆÆârÂwv&âr“²&WGW&ã²Ğ¢6öç7B&ö×G2ÒGvWE&ö×G2‚“°¢–b‡&ö×G2ç6öÖR‡ÓâçFW‡BÓÓÒFW‡B’’²GFö7B‚tW7FÆçF–ÆÆ–W7L:wV&FFârÂv–æfòr“²&WGW&ã²Ğ¢&ö×G2çVç6†–gB‡²FW‡BÂG3¢FFRææ÷r‚’Ò“°¢–b‡&ö×G2æÆVæwF‚â3’&ö×G2æÆVæwF‚Ò3°¢G6fU&ö×G2‡&ö×G2“°¢GFö7B‚	ù8ÂÆçF–ÆÆwV&FFrÂvö²r“°¢GVF—DÆör‚wVW'’rÂuÆçF–ÆÆwV&FF¢r²FW‡Bç7V'7G&–ærƒÃc’“°§Ğ¦gVæ7F–öâG&ö×G4÷Vâ‚’°¢G&VæFW%&ö×G4Æ—7B‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wG&ö×G4ÖöFÂr“òæ6Æ74Æ—7Bç&VÖ÷fR‚v†–FFVâr“°§Ğ¦gVæ7F–öâG&ö×G46Æ÷6R‚’°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wG&ö×G4ÖöFÂr“òæ6Æ74Æ—7BæFB‚v†–FFVâr“°§Ğ¦gVæ7F–öâG&VæFW%&ö×G4Æ—7B‚’°¢6öç7BÆ—7BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&ö×G4Æ—7Br“°¢–b‚Æ—7B’&WGW&ã°¢6öç7B&ö×G2ÒGvWE&ö×G2‚“°¢–b‚&ö×G2æÆVæwF‚’°¢Æ—7Bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'G×&ö×BÖV×G’#äæòF–VæW2ÆçF–ÆÆ2wV&FF2ãÆ'#äW67&–&RVæ6öç7VÇFVâVÂ6†B’VÇ6	ù8ÂwV&F"ãÂöF—câs°¢&WGW&ã°¢Ğ¢Æ—7Bæ–ææW$…DÔÂÒ&ö×G2æÖ‚‡Â’’Óâ ¢ÆF—b6Æ73Ò'G×&ö×BÖ—FVÒ"öæ6Æ–6³Ò'GW6U&ö×B‚G¶—Ò’#à¢ÆF—b6Æ73Ò'G×&ö×B×FW‡B#âG·çFW‡Bç7V'7G&–ærƒÃ#—ÒG·çFW‡BæÆVæwFƒã#ò~(
bs¢rwÓÂöF—cà¢Æ'WGFöâ6Æ73Ò'G×&ö×BÖFVÂ"öæ6Æ–6³Ò&WfVçBç7F÷&÷vF–öâ‚“·GFVÆWFU&ö×B‚G¶—Ò’"F—FÆSÒ$VÆ–Ö–æ"ÆçF–ÆÆ#ì9sÂö'WGFöãà¢ÂöF—cæ’æ¦ö–â‚rr“°§Ğ¦gVæ7F–öâGW6U&ö×B†–G‚’°¢6öç7BÒGvWE&ö×G2‚•¶–G…Ó°¢–b‚’&WGW&ã°¢6öç7B–çÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW6W$–çWBr“°¢–b†–ç’²–ççfÇVRÒçFW‡C²–çæfö7W2‚“²–çç7G–ÆRæ†V–v‡CÒvWFòs²–çç7G–ÆRæ†V–v‡CÖ–çç67&öÆÄ†V–v‡B²w‚s²Ğ¢G&ö×G46Æ÷6R‚“°¢–b‚Fö7VÖVçBævWDVÆVÖVçD'”–B‚w67&VVâÖ6†Br“òæ6Æ74Æ—7Bæ6öçF–ç2‚v7F—fRr’bbG—Vöb6†÷u67&VVâÓÓÒvgVæ7F–öâr¢6†÷u67&VVâ‚w67&VVâÖ6†Br“°§Ğ¦gVæ7F–öâGFVÆWFU&ö×B†–G‚’°¢6öç7B&ö×G2ÒGvWE&ö×G2‚“°¢&ö×G2ç7Æ–6R†–G‚Â“°¢G6fU&ö×G2‡&ö×G2“°¢G&VæFW%&ö×G4Æ—7B‚“°¢GFö7B‚uÆçF–ÆÆVÆ–Ö–æFârÂv–æfòr“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòDb4ôâÔTÔ%$UDRDTÂU5ETD”ğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâW‡÷'EDb‚’°¢6öç7B×6w2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖW76vW2r“°¢–b‚×6w2’&WGW&ã°¢6öç7B&÷w2Ò'&’æg&öÒ†×6w2çVW'•6VÆV7F÷$ÆÂ‚ræ×6rr’’æÖ†ÒÓâ°¢6öç7B—5W6W"ÒÒæ6Æ74Æ—7Bæ6öçF–ç2‚wW6W"r“°¢6öç7BFW‡BÒ†ÒçVW'•6VÆV7F÷"‚ræ&&Âr“òæ–ææW%FW‡BÇÂrr’ç&WÆ6R‚õÆâörÂsÆ'#âr“°¢&WGW&âÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£Gƒ·FF–æs£‚Gƒ¶&6¶w&÷VæC¢G¶—5W6W#òr6ccfbs¢r6c†c†cwÓ¶&÷&FW"×&F—W3£‡ƒ¶&÷&FW"ÖÆVgC£7‚6öÆ–BG¶—5W6W#òr3SSRs¢r43”ƒD2wÒ#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#¢G¶—5W6W#òr3332s¢r3„#c“BwÓ¶föçB×6—¦S£G‚#âG¶—5W6W#òt6öç7VÇFs¢tFV6Æ&e’wÓÂ÷7G&öæsãÇ7G–ÆSÒ&Ö&v–ã£W‚¶6öÆ÷#¢3333¶Æ–æRÖ†V–v‡C£ãcS¶föçB×6—¦S£G‚#âG·FW‡GÓÂ÷ãÂöF—cæ°¢Ò’æ¦ö–â‚rr“°¢ÆWBvÄ6frÒ·Ó°¢G'’²vÄ6frÒ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…tÅô´U’‚’’ÇÂw·Òr“²Ò6F6‚…öR’·Ğ¢6öç7BW7GVF–òÒvÄ6frææöÖ'&RÇÂ7W%W6W#òç7GVF–òÇÂ7W%W6W#òææÖRÇÂtFV6Æ&e’s°¢6öç7B6öÆ÷"ÒvÄ6fræ6öÆ÷"ÇÂr43”ƒD2s°¢6öç7BfV6†ÒæWrFFR‚’çFôÆö6ÆTFFU7G&–ær‚vW2ÕRrÇ¶F“¢s"ÖF–v—BrÆÖöçFƒ¢vÆöærrÇ–V#¢vçVÖW&–2wÒ“°¢6öç7B&VÒ$T5¶7W$&VÓòæÆ&VÂÇÂtvVæW&Âs°¢6öç7Bv–âÒv–æF÷ræ÷Vâ‚rrÂuö&Ææ²r“°¢v–âæFö7VÖVçBçw&—FR†ÂDô5E•R‡FÖÃãÆ‡FÖÃãÆ†VCãÆÖWF6†'6WCÒ%UDbÓ‚#ãÇF—FÆSâG¶W7GVF–÷Ò(	B6öç7VÇFG&–'WF&–Â÷F—FÆSà£Ç7G–ÆSà¢&öG—¶föçBÖfÖ–Ç“¢uF–ÖW2æWr&öÖârÇ6W&–c¶Ö‚×v–GFƒ£sƒ¶Ö&v–ã£C‚WFó¶6öÆ÷#¢3&S¶Æ–æRÖ†V–v‡C£ãcS¶föçB×6—¦S£G‡Ğ¢æÆ‡¶&÷&FW"Ö&÷GFöÓ£7‚6öÆ–BG¶6öÆ÷'Ó·FF–ærÖ&÷GFöÓ£'ƒ¶Ö&v–âÖ&÷GFöÓ£#'ƒ¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦fÆW‚ÖVæGĞ¢æÆ‚ÖæÖW¶föçBÖfÖ–Ç“¤vV÷&v–Ç6W&–c¶föçB×6—¦S£#ƒ¶6öÆ÷#¢G¶6öÆ÷'Ó¶föçB×vV–v‡C¦&öÆC¶ÆWGFW"×76–æs¢ã6V×Ğ¢æÆ‚×7V'¶föçB×6—¦S£Gƒ¶6öÆ÷#¢3sss¶Ö&v–â×F÷£7‡Ğ¢æÆ‚ÖFFW¶föçB×6—¦S£Gƒ¶6öÆ÷#¢3“““·FW‡BÖÆ–vã§&–v‡GĞ¢æÖWF×&÷w¶&6¶w&÷VæC¢6c†c†c#¶&÷&FW#£‚6öÆ–B6S†S3ƒ¶&÷&FW"×&F—W3£gƒ·FF–æs£‡‚Gƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#¢3SSS¶Ö&v–âÖ&÷GFöÓ£#ƒ¶F—7Æ“¦fÆWƒ¶v£#'ƒ¶fÆW‚×w&§w&Ğ¢æfö÷FW'¶&÷&FW"×F÷£‚6öÆ–B6FFC¶Ö&v–â×F÷£#Gƒ·FF–ær×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#¢6·FW‡BÖÆ–vã¦6VçFW'Ğ¢ÖVF–&–çG¶&öG—¶Ö&v–ã£#‡×Ğ£Â÷7G–ÆSãÂö†VCãÆ&öG“à¢ÆF—b6Æ73Ò&Æ‚#à¢ÆF—cà¢ÆF—b6Æ73Ò&Æ‚ÖæÖR#âG¶W7GVF–÷ÓÂöF—cà¢ÆF—b6Æ73Ò&Æ‚×7V"#ä6W6÷,:ÖG&–'WF&–+r÷vW&VB'’FV6Æ&e“ÂöF—cà¢ÂöF—cà¢ÆF—b6Æ73Ò&Æ‚ÖFFR#âG¶fV6†ÓÂöF—cà¢ÂöF—cà¢ÆF—b6Æ73Ò&ÖWF×&÷r#à¢Ç7ãï	ùBG¶7W%W6W#òææÖWÇÂ~(	BwÓÂ÷7ãà¢Ç7ãï	ù8"8&V¢G¶&VÓÂ÷7ãà¢Ç7ãï	ù8²,:–v–ÖVã¢G¶7W%W6W#òç&Vv–ÖVãòçFõWW$66R‚—ÇÂ~(	BwÓÂ÷7ãà¢Ç7ãï	ùy2G¶fV6†ÓÂ÷7ãà¢ÂöF—cà¢G·&÷w7Ğ¢ÆF—b6Æ73Ò&fö÷FW"#äFö7VÖVçFòvVæW&Fò÷"G¶W7GVF–÷Òl:ÖFV6Æ&g’æ6öÒ+r6öÆò6öâf–æW2÷&–VçFF—f÷2+r6öç7VÇF6öâVâ&öfW6–öæÂ&FV6—6–öæW2f÷&ÖÆW2ãÂöF—cà£Âö&öG“ãÂö‡FÖÃæ“°¢v–âæFö7VÖVçBæ6Æ÷6R‚“°¢6WEF–ÖV÷WB‚‚’Óâv–âç&–çB‚’Âc“°¢GVF—DÆör‚vW‡÷'BrÂuDb6öâÖVÖ'&WFS¢r²&V“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4ôå5TÅD,8”D(	BfÆöF–ær÷fW&Æ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâGV–6´÷Vâ‚’°¢6öç7B÷bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6´÷br“°¢–b‚÷b’&WGW&ã°¢÷bæ6Æ74Æ—7Bç&VÖ÷fR‚v†–FFVâr“°¢6öç7B&W7ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6µ&W7r“°¢–b‡&W7’²&W7ç7G–ÆRæF—7Æ“ÒvæöæRs²&W7æ–ææW$…DÔÃÒrs²Ğ¢6WEF–ÖV÷WB‚‚’ÓâFö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6´–çr“òæfö7W2‚’Âƒ“°§Ğ¦gVæ7F–öâGV–6´6Æ÷6R‚’°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6´÷br“òæ6Æ74Æ—7BæFB‚v†–FFVâr“°§Ğ¦gVæ7F–öâGV–6´÷VägVÆÂ‚’°¢6öç7BG‡BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6´–çr“òçfÇVSòçG&–Ò‚“°¢GV–6´6Æ÷6R‚“°¢–b‡G—Vöb6†÷u67&VVâÓÓÒvgVæ7F–öâr’6†÷u67&VVâ‚w67&VVâÖ6†Br“°¢–b‡G‡B’°¢6öç7B–çÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW6W$–çWBr“°¢–b†–ç’²–ççfÇVRÒG‡C²–çæfö7W2‚“²Ğ¢Ğ§Ğ¦7–æ2gVæ7F–öâGV–6µ6VæB‚’°¢6öç7B–çÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6´–çr“°¢6öç7BVW'’Ò–çòçfÇVSòçG&–Ò‚“°¢–b‚VW'’’&WGW&ã°¢–b‚G6†V6µ&FTÆ–Ö—B‚’’&WGW&ã°¢6öç7B&W7VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6µ&W7r“°¢&W7VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÂæ–ææW$…DÔÂÒsÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#î)û26öç7VÇFæFòFV6Æ&e’ââãÂ÷7ãâs°¢G'’°¢6öç7B7—5&ö×BÒ‡G—Vöb5•2ÓÒwVæFVf–æVBrò5•2¢rr’ÇÂtW&W2VâW‡W'FòG&–'WF&—7FW'Væòâ&W7öæFRFRf÷&Ö'&WfR’6öæ6—6âs°¢6öç7B&W2Òv—B6ÆÄFV6Æ&e’‡²ÖöFVÃ¢v6ÆVFR×6öææWBÓBÓRrÂÖ…÷Fö¶Vç3£cÂ7—7FVÓ¢7—5&ö×BÂÖW76vW3¥··&öÆS¢wW6W"rÆ6öçFVçC§VW'—ÕÒÒ“°¢6öç7BFFÒv—B&W2æ§6öâ‚“°¢6öç7BFW‡BÒFFòæ6öçFVçCòå³ÓòçFW‡BÇÂu6–â&W7VW7Fâs°¢&W7VÂæ–ææW$…DÔÂÒöÖDf÷&ÖB‡FW‡B“°¢G6fTöffÆ–æU&W7öç6R‡VW'’ÂFW‡B“°¢GVF—DÆör‚wVW'’rÂt6öç7VÇF,:–F¢r²VW'’ç7V'7G&–ærƒÃc’“°¢Ò6F6‚†R’°¢&W7VÂæ–ææW$…DÔÂÒÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#äW'&÷#¢G·6fT…DÔÂ†RæÖW76vR—ÓÂ÷7ãæ°¢Ğ§Ğ¦gVæ7F–öâGWFFUV–6´'Fâ‚’°¢6öç7B'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGV–6´'Fâr“°¢–b‚'Fâ’&WGW&ã°¢6öç7B–ä6†BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w67&VVâÖ6†Br“òæ6Æ74Æ—7Bæ6öçF–ç2‚v7F—fRr“°¢'Fâæ6Æ74Æ—7BçFövvÆR‚v†–FFVârÂ7W%W6W"ÇÂ–ä6†B“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòU4‚äõD”d”4D”ôå2(	BfVæ6–Ö–VçF÷2G&–'WF&–÷0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BEôäõD”eôD•4Ô•54TBÒwGöæ÷F–eöF—6Ö—76VBs°¦6öç7BEôäõD”eôÄ5Eô4„T4²ÒwGöæ÷F–eöÆ7Eö6†V6²s°¦6öç7BEôDTDÄ”äU2Ò°¢ç'W3¢·²Æ&VÃ¢t7V÷FÖVç7VÂå%U2rÂF“£2ÕÒÀ¢&W#¢·²Æ&VÃ¢uEBc#$U"ÖVç7VÂrÂF“£RÒÂ²Æ&VÃ¢tD¢&VçFçVÂ†'"’rÂÖöçFƒ£2ÕÒÀ¢&×C¢·²Æ&VÃ¢uEBc#$ÕBÖVç7VÂrÂF“£RÒÂ²Æ&VÃ¢uv÷27VVçF•"rÂF“£RÒÂ²Æ&VÃ¢t•Dâ†Ö"’rÂÖöçFƒ£"ÕÒÀ¢&s¢·²Æ&VÃ¢uEBc#ÖVç7VÂrÂF“£RÒÂ²Æ&VÃ¢uv÷27VVçF•"rÂF“£RÒÂ²Æ&VÃ¢t•Dâ†Ö"’rÂÖöçFƒ£"ÒÂ²Æ&VÃ¢tD¢&VçFçVÂ†Ö"’rÂÖöçFƒ£"ÕÒÀ¢sGFs¢·²Æ&VÃ¢uEBcb†öæ÷&&–÷2rÂF“£RÕÒÀ¢sWFs¢·²Æ&VÃ¢u&VwVÆ&—¦6œ;6â•"WF†'"’rÂÖöçFƒ£2ÕÒÀ§Ó° ¦gVæ7F–öâG–æ—Dæ÷F–d&ææW"‚’°¢6öç7B&ææW"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGæ÷F–d&ææW"r“°¢–b‚&ææW"ÇÂ7W%W6W"’&WGW&ã°¢–b‚‚tæ÷F–f–6F–öâr–âv–æF÷r’ÇÂæ÷F–f–6F–öâçW&Ö—76–öâÓÓÒvw&çFVBr’&WGW&ã°¢–b†Æö6Å7F÷&vRævWD—FVÒ…EôäõD”eôD•4Ô•54TB’’&WGW&ã°¢&ææW"æ6Æ74Æ—7Bç&VÖ÷fR‚v†–FFVâr“°§Ğ¦gVæ7F–öâGF—6Ö—74æ÷F–d&ææW"‚’°¢Æö6Å7F÷&vRç6WD—FVÒ…EôäõD”eôD•4Ô•54TBÂsr“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGæ÷F–d&ææW"r“òæ6Æ74Æ—7BæFB‚v†–FFVâr“°§Ğ¦7–æ2gVæ7F–öâG&WVW7Dæ÷F–eW&Ö—76–öâ‚’°¢–b‚‚tæ÷F–f–6F–öâr–âv–æF÷r’’²GFö7B‚uGRæfVvF÷"æò6÷÷'Fæ÷F–f–66–öæW2W6‚ârÂwv&âr“²&WGW&ã²Ğ¢6öç7BW&ÒÒv—Bæ÷F–f–6F–öâç&WVW7EW&Ö—76–öâ‚“°¢–b‡W&ÒÓÓÒvw&çFVBr’°¢GF—6Ö—74æ÷F–d&ææW"‚“°¢GFö7B‚~)ÈRæ÷F–f–66–öæW27F—fF2â&V6–&—,:2ÆW'F2FRfVæ6–Ö–VçF÷2G&–'WF&–÷2ârÂvö²r“°¢GVF—DÆör‚vÆöv–ârÂuW6‚æ÷F–f–6F–öç27F—fF2r“°¢G6†V6µF„FVFÆ–æW2‡G'VR“°¢ÒVÇ6R°¢GFö7B‚tæ÷F–f–66–öæW2&Æ÷VVF2â7L:×fÆ2FW6FRÆ6öæf–wW&6œ;6âFVÂæfVvF÷"ârÂwv&âr“°¢Ğ§Ğ¦gVæ7F–öâG6†V6µF„FVFÆ–æW2†f÷&6R’°¢–b‚‚tæ÷F–f–6F–öâr–âv–æF÷r’ÇÂæ÷F–f–6F–öâçW&Ö—76–öâÓÒvw&çFVBr’&WGW&ã°¢6öç7BÆ7D6†V6²Ò'6T–çB†Æö6Å7F÷&vRævWD—FVÒ…EôäõD”eôÄ5Eô4„T4²’ÇÂsr“°¢–b‚f÷&6RbbFFRææ÷r‚’ÒÆ7D6†V6²Â3c’&WGW&ã°¢Æö6Å7F÷&vRç6WD—FVÒ…EôäõD”eôÄ5Eô4„T4²Â7G&–ær„FFRææ÷r‚’’“°¢6öç7B&Vv–ÖVâÒ7W%W6W#òç&Vv–ÖVâÇÂw&rs°¢6öç7BFVFÆ–æW2ÒEôDTDÄ”äU5·&Vv–ÖVåÒÇÂEôDTDÄ”äU5²w&ruÓ°¢6öç7Bæ÷rÒæWrFFR‚“°¢FVFÆ–æW2æf÷$V6‚‚†FÂÂ–G‚’Óâ°¢–b†FÂæF’ÓÒVæFVf–æVB’°¢6öç7BF—4ÆVgBÒFÂæF’Òæ÷rævWDFFR‚“°¢–b†F—4ÆVgBãÒbbF—4ÆVgBÃÒR’°¢6WEF–ÖV÷WB‚‚’Óâ°¢æWræ÷F–f–6F–öâ‚	ù8RFV6Æ&e’(	BfVæ6–Ö–VçFò,;7†–ÖòrÂ°¢&öG“¢G¶FÂæÆ&VÇÒfVæ6RG¶F—4ÆVgBÓÓÒòt„õ’r¢vVâr²F—4ÆVgB²rL:Ö‡2’wÖÀ¢–6öã¢v‡GG3¢òöFV6Æ&g’æ6öÒöff–6öâæ–6òrÀ¢Fs¢wGÖFÂÒr²–G‚À¢Ò“°¢ÒÂ#²–G‚¢S“°¢Ğ¢Ğ¢–b†FÂæÖöçF‚ÓÒVæFVf–æVBbbFÂæÖöçF‚ÓÓÒæ÷rævWDÖöçF‚‚’’°¢6WEF–ÖV÷WB‚‚’Óâ°¢æWræ÷F–f–6F–öâ‚	ù8RFV6Æ&e’(	B&V6÷&FF÷&–òÖVç7VÂrÂ°¢&öG“¢W7FRÖW2fVæ6S¢G¶FÂæÆ&VÇÖÀ¢–6öã¢v‡GG3¢òöFV6Æ&g’æ6öÒöff–6öâæ–6òrÀ¢Fs¢wGÖFÆÒÒr²–G‚À¢Ò“°¢ÒÂ3²–G‚¢S“°¢Ğ¢Ò“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò$4„U2d”äÄU2(	B6öæV7F"FöFò6öâÆöEæVÂò6WEF ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò&FRÆ–Ö—F–ærVâ6VæD×6u7G&VĞ¦6öç7Bö÷&–u4Õ5$ÂÒ÷6VæD×6u7G&VÔ&6S°¦7–æ2gVæ7F–öâ6VæD×6u7G&VÒ‡G‡B’°¢–b‚G6†V6µ&FTÆ–Ö—B‚’’&WGW&ã°¢GVF—DÆör‚wVW'’rÂt”¢r²‡G‡GÇÂrr’ç7V'7G&–ærƒÃƒ’“°¢&WGW&âö÷&–u4Õ5$Â‡G‡B“°§Ğ ¢òò×Æ–"ÆöEæVÂ6öâçVWf2–æ–6–Æ—¦6–öæW0¦6öç7Bö÷&–tÆöEæVÅcbÒÆöEæVÃ°¦ÆöEæVÂÒgVæ7F–öâ‚’°¢ö÷&–tÆöEæVÅcb‚“°¢6WEF–ÖV÷WB‚‚’Óâ°¢G–æ—Dæ÷F–d&ææW"‚“°¢G6†V6µF„FVFÆ–æW2‚“°¢GWFFUV–6´'Fâ‚“°¢GGF6…%T5fÆ–FF÷'2‚“°¢G&VæFW$VF—DÆör‚“°¢GVF—DÆör‚vÆöv–ârÂt66W6òÂæVÂ(	Br²æWrFFR‚’çFôÆö6ÆU7G&–ær‚vW2ÕRr’“°¢ÒÂ““°§Ğ ¢òò×Æ–"6WEF"&7GVÆ—¦"&÷L;6âfÆ÷FçFR’VF—BÆöp¦6öç7Bö÷&–u6WEF%c"ÒG—Vöb6WEF"ÓÓÒvgVæ7F–öârò6WEF"¢çVÆÃ°§6WEF"ÒgVæ7F–öâ‡F"Â'Fâ’°¢–b…ö÷&–u6WEF%c"’ö÷&–u6WEF%c"‡F"Â'Fâ“°¢GWFFUV–6´'Fâ‚“°¢–b‡F"ÓÓÒvFÖ–âr’6WEF–ÖV÷WB‡G&VæFW$VF—DÆörÂ#“°§Ğ ¢òò&6†"FÖ&œ:–â6†÷u67&VVâ&7GVÆ—¦"&÷L;6âfÆ÷FçFP¦6öç7Bö÷&–u6†÷u67&VVåcbÒG—Vöb6†÷u67&VVâÓÓÒvgVæ7F–öârò6†÷u67&VVâ¢çVÆÃ°§6†÷u67&VVâÒgVæ7F–öâ†–B’°¢–b…ö÷&–u6†÷u67&VVåcb’ö÷&–u6†÷u67&VVåcb†–B“°¢GWFFUV–6´'Fâ‚“°§Ó° ¢òò)H)H”ä•B)H)H ¢†gVæ7F–öâ‚—°¢òòVç7W&Rf—&V&6RvÆö&Â—2f–Æ&ÆR&Vf÷&R–æ—@¢–b‡G—Vöbf—&V&6RÓÓÒwVæFVf–æVBr’°¢6öç6öÆRçv&â‚tf—&V&6R4D²æ÷BÆöFVB–WBÂ&WG'––ærâââr“°¢v–æF÷ræFDWfVçDÆ—7FVæW"‚vÆöBrÂgVæ7F–öâ‚’°¢6WEF–ÖV÷WB†gVæ7F–öâ‚’°¢–b‡G—Vöbf—&V&6RÓÒwVæFVf–æVBr’°¢–æ—Df—&V&6R‚“²&VæFW$d%7FGW2‚“²ö&ö÷D‚“°¢ÒVÇ6R°¢&VæFW$d%7FGW2‚“²ö&ö÷D‚“°¢Ğ¢ÒÂS“°¢Ò“°¢&WGW&ã°¢Ğ¢–æ—Df—&V&6R‚“°¢&VæFW$d%7FGW2‚“°¢ö&ö÷D‚“°§Ò’‚“° ¦gVæ7F–öâö&ö÷D‚’°¢–b†f%&VG’bbf$WF‚’°¢f$WF‚æöäWF…7FFT6†ævVB†7–æ2‡W6W"’Óâ°¢–b‡W6W"’°¢G'’°¢6öç7BFö2Òv—Bf$F"æ6öÆÆV7F–öâ‚wW6W'2r’æFö2‡W6W"çV–B’ævWB‚“°¢–b†Fö2æW†—7G2’°¢7W%W6W"Ò²ââæFö2æFF‚’ÂV–C¢W6W"çV–BÓ°¢Æö6Å7F÷&vRç6WD—FVÒ‚wG÷2rÂ7W%W6W"æVÖ–Â“°¢·dÆöDÆÂ‚’çF†Vâ‚‚’ÓâvõæVÂ‚’“°¢&WGW&ã°¢Ğ¢Ò6F6‚†R’²6öç6öÆRçv&â‚tWF‚7FFRW'&÷#¢rÂRæÖW76vR“²Ğ¢Ğ¢öfÆÆ&6´–æ—B‚“°¢Ò“°¢ÒVÇ6R°¢öfÆÆ&6´–æ—B‚“°¢Ğ§Ğ ¦gVæ7F–öâöfÆÆ&6´–æ—B‚’°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ‚wG÷2r“°¢–b‡G—Vöb6†÷u67&VVâÓÓÒvgVæ7F–öâr’6†÷u67&VVâ‚w67&VVâÖÆæF–ærr“°¢VÇ6R²6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w67&VVâÖÆæF–ærr“²–b†VÂ—¶VÂæ6Æ74Æ—7BæFB‚v7F—fRr“¶VÂç7G–ÆRæF—7Æ“ÒvfÆW‚s·ÒĞ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòÄ¥’ÄôD”är(	B–æ–6–Æ—¦6œ;6âF–fW&–FFRÜ;6GVÆ÷2W6F÷0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BöÆ§”ÖöGVÆW2Ò·Ó°¦6öç7BöÆ§”6ÆÆ&6·2Ò°¢6'3¢‚’Óâ²–b‡G—Vöb&VæFW%4%4FFÓÓÒvgVæ7F–öâr’&VæFW%4%4FF‚“²ÒÀ¢6×c¢‚’Óâ²–b‡G—Vöb&VæFW%4ÕdFFÓÓÒvgVæ7F–öâr’&VæFW%4ÕdFF‚“²ÒÀ¢7&—Fó¢‚’Óâ²–b‡G—Vöb&VæFW$7&—FôFFÓÓÒvgVæ7F–öâr’&VæFW$7&—FôFF‚“²ÒÀ¢7&—FõöÆVvÃ¢‚’Óâ²–b‡G—Vöb&VæFW$7&—FôÆVvÄFFÓÓÒvgVæ7F–öâr’&VæFW$7&—FôÆVvÄFF‚“²ÒÀ¢EöÖöGVÆó¢‚’Óâ²–b‡G—Vöb6Æ5VÖ'&ÆW2ÓÓÒvgVæ7F–öâr’6Æ5VÖ'&ÆW2‚“²ÒÀ¢6ö×&Fó¢‚’Óâ²–b‡G—Vöb&VæFW$6ö×&FôFFÓÓÒvgVæ7F–öâr’&VæFW$6ö×&FôFF‚“²ÒÀ¢–öf—63¢‚’Óâ²6Æ4f—65&—6²‚“²ÒÀ¢66÷3¢‚’Óâ²–b‡G—Vöb&VæFW$66÷2ÓÓÒvgVæ7F–öâr’&VæFW$66÷2‚“²ÒÀ¢'Fc¢‚’Óâ²–b‡G—Vöb&VæFW%%DbÓÓÒvgVæ7F–öâr’&VæFW%%Db‚“²ÒÀ¢7VæEö–æc¢‚’Óâ²–b‡G—Vöb&VæFW%7VæD–æbÓÓÒvgVæ7F–öâr’&VæFW%7VæD–æb‚“²ÒÀ¢7Væf–Ã¢‚’Óâ²–b‡G—Vöb&VæFW%7Væf–ÂÓÓÒvgVæ7F–öâr’&VæFW%7Væf–Â‚“²ÒÀ¢–æFV6÷“¢‚’Óâ²–b‡G—Vöb&VæFW$–æFV6÷’ÓÓÒvgVæ7F–öâr’&VæFW$–æFV6÷’‚“²ÒÀ¢&7#¢‚’Óâ²–b‡G—Vöb&VæFW$$5"ÓÓÒvgVæ7F–öâr’&VæFW$$5"‚“²ÒÀ¢¦öæ3¢‚’Óâ²–b‡G—Vöb&VæFW%¦öæ2ÓÓÒvgVæ7F–öâr’&VæFW%¦öæ2‚“²ÒÀ¢V×&W6ö‡V#¢‚’Óâ²–b‡G—Vöb&VæFW$5$Õ7FG2ÓÓÒvgVæ7F–öâr’&VæFW$5$Õ7FG2‚“²ÒÀ§Ó°¢òòF6‚6WEF"FòÆ§’ÖÆöBÖöGVÆW2öâf—'7Bf—6—@¦6öç7Bö÷&–u6WEF$Æ§’Ò6WEF#°§6WEF"ÒgVæ7F–öâ‡F"Â'Fâ’°¢ö÷&–u6WEF$Æ§’‡F"Â'Fâ“°¢–b‡F"bböÆ§”6ÆÆ&6·5·F%ÒbböÆ§”ÖöGVÆW5·F%Ò’°¢öÆ§”ÖöGVÆW5·F%ÒÒG'VS°¢6WEF–ÖV÷WB‚‚’Óâ²G'’²öÆ§”6ÆÆ&6·5·F%Ò‚“²Ò6F6‚†R’·ÒÒÂ“°¢Ğ§Ó° ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò’44U52‡ÆâV×&W6’(	BvVæW&"òÆ—7F"ò&Wfö6"’¶W—0¢òò’ÆÆÖ"Æ26Æ÷VBgVæ7F–öç26÷'&W7öæF–VçFW2à¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¢òòDT4Ä$e•ôdåô$4R–W7L:Vâ6öæf–ræ§0¦ÆWB÷GÆ7DvVæW&FVD¶W’Òrs° ¦7–æ2gVæ7F–öâ÷GWF†VDfWF6‚‡W&ÂÂ÷F–öç2Ò·Ò’°¢–b‚FV6Æ&g”77&eFö¶Vâ’v—BFV6Æ&g”ÆöE6W76–öâ‚“°¢&WGW&âfWF6‚‡W&ÂÂ°¢ââæ÷F–öç2À¢7&VFVçF–Ç3¢w6ÖRÖ÷&–v–ârÀ¢†VFW'3¢°¢t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÀ¢u‚Õ&WVW7FVBÕv—F‚s¢tFV6Æ&g•vV"rÀ¢u‚Ô55$bÕFö¶Vâs¢FV6Æ&g”77&eFö¶VâÀ¢âââ†÷F–öç2æ†VFW'2ÇÂ·Ò’À¢ÒÀ¢Ò“°§Ğ¢òò66–öæW2WFVçF–6F2FVÂ&6¶VæB…à¦7–æ2gVæ7F–öâ÷G6ÆÄgVæ7F–öâ†æÖRÂFFÒ·Ò’°¢6öç7B&W2Òv—B÷GWF†VDfWF6‚†G´DT4Ä$e•ôdåô$4WÒG¶Væ6öFUU$”6ö×öæVçB†æÖR—ÖÂ°¢ÖWF†öC¢uõ5BrÀ¢&öG“¢¥4ôâç7G&–æv–g’†FF’À¢Ò“°¢6öç7BVçfVÆ÷RÒv—B&W2æ§6öâ‚’æ6F6‚‚‚’Óâ‡·Ò’“°¢–b‚&W2æö²ÇÂVçfVÆ÷Ræö²ÓÓÒfÇ6R’°¢6öç7BÖW76vRÒVçfVÆ÷RæÖW76vRÇÂVçfVÆ÷RæW'&÷#òæÖW76vRÇÂW'&÷"ÆÆÖæFòG¶æÖWÖ°¢F‡&÷ræWrW'&÷"†ÖW76vR“°¢Ğ¢&WGW&âVçfVÆ÷RæFF°§Ğ  ¦gVæ7F–öâ&VæFW$”66W75æVÂ‚’°¢6öç7BW6VÆÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v•W6VÆÂr“°¢6öç7BÖævRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v”ÖævRr“°¢–b‚W6VÆÂÇÂÖævR’&WGW&ã° ¢6öç7B—4V×&W6Ò7W%W6W"bb†7W%W6W"çÆâÓÓÒvV×&W6rÇÂ—4FÖ–åW6W"‚’“°¢W6VÆÂç7G–ÆRæF—7Æ’Ò—4V×&W6òvæöæRr¢v&Æö6²s°¢ÖævRç7G–ÆRæF—7Æ’Ò—4V×&W6òv&Æö6²r¢væöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v”æWt¶W”&÷‚r’ç7G–ÆRæF—7Æ’ÒvæöæRs° ¢–b†—4V×&W6’G”Æ—7D¶W—2‚“°§Ğ ¦7–æ2gVæ7F–öâG”vVæW&FT¶W’‚’°¢6öç7BÆ&VÄ–çWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v”¶W”Æ&VÂr“°¢6öç7BÆ&VÂÒÆ&VÄ–çWBòÆ&VÄ–çWBçfÇVRçG&–Ò‚’ÇÂu6–âæöÖ'&Rr¢u6–âæöÖ'&Rs°¢G'’°¢6öç7BFFÒv—B÷G6ÆÄgVæ7F–öâ‚vvVæW&FV–¶W’rÂ²Æ&VÂÒ“°¢÷GÆ7DvVæW&FVD¶W’ÒFFç&t¶W“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v”æWt¶W•fÇVRr’çFW‡D6öçFVçBÒFFç&t¶W“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v”æWt¶W”&÷‚r’ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–b†Æ&VÄ–çWB’Æ&VÄ–çWBçfÇVRÒrs°¢G”Æ—7D¶W—2‚“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wG”vVæW&FT¶W’W'&÷#¢rÂR“°¢FDæ÷F–b‚~)ªûˆòrÂtW'&÷"FR6öæW†œ;6ârÂtæò6RVFòvVæW&"Æ’¶W’âr“°¢Ğ§Ğ ¦gVæ7F–öâG”6÷”¶W’‚’°¢–b‚÷GÆ7DvVæW&FVD¶W’’&WGW&ã°¢æf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B…÷GÆ7DvVæW&FVD¶W’’çF†Vâ‚‚’Óâ°¢FDæ÷F–b‚~)ÈRrÂt6÷–FòrÂt’¶W’6÷–FÂ÷'FVÆW2âr“°¢Ò’æ6F6‚‚‚’Óâ·Ò“°§Ğ ¦7–æ2gVæ7F–öâG”Æ—7D¶W—2‚’°¢6öç7BÆ—7BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v”¶W—4Æ—7Br“°¢–b‚Æ—7B’&WGW&ã°¢Æ—7Bæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#ä6&væFò¶W—2ââãÂöF—câs°¢G'’°¢6öç7BFFÒv—B÷G6ÆÄgVæ7F–öâ‚vÆ—7F–¶W—2r“°¢6öç7B¶W—2Ò„'&’æ—4'&’†FF’òFF¢µÒ’ç6÷'B‚†Â"’ÓâçVÖ&W"†"æ7&VFVDBÇÂ’ÒçVÖ&W"†æ7&VFVDBÇÂ’“°¢–b†¶W—2æÆVæwF‚ÓÓÒ’°¢Æ—7Bæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#ä;¦âæòF–VæW2’¶W—2âvVæW&Æ&–ÖW&'&–&ãÂöF—câs°¢&WGW&ã°¢Ğ¢Æ—7Bæ–ææW$…DÔÂÒ¶W—2æÖ†²Óâ ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£ƒ¶&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‚Gƒ¶Ö&v–âÖ&÷GFöÓ£‡‚#à¢ÆF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S#âGµöW66T‡FÖÂ†²æÆ&VÂÇÂu6–âæöÖ'&Rr—ÒG¶²ç&Wfö¶VBòsÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#â‡&Wfö6F“Â÷7ãâr¢rwÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçBÖfÖ–Ç“¦Ööæ÷76R#âGµöW66T‡FÖÂ†²æ–BÇÂrr—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âG¶²æÆ7EW6VBò|9¦ÇF–ÖòW6ò&Vv—7G&Fòr¢u6–âW6ò;¦âwÓÂöF—cà¢ÂöF—cà¢G²²ç&Wfö¶VBòÆ'WGFöâ7G–ÆSÒ&föçB×6—¦S£Gƒ·FF–æs£W‚ƒ¶&÷&FW"×&F—W3£gƒ¶&6¶w&÷VæC§&v&ƒ#3ÃSrÃsÂã“¶&÷&FW#£‚6öÆ–B&v&ƒ#3ÃSrÃsÂã#R“¶6öÆ÷#§f"‚Ò×&VB“¶7W'6÷#§ö–çFW#¶föçBÖfÖ–Ç“¦–æ†W&—B"öæ6Æ–6³Ò'G•&Wfö¶T¶W’‚rGµöW66T‡FÖÂ†²æ–BÇÂrr—Òr’#å&Wfö6#Âö'WGFöãæ¢rwĞ¢ÂöF—cà¢’æ¦ö–â‚rr“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wG”Æ—7D¶W—2W'&÷#¢rÂR“°¢Æ—7Bæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äW'&÷"FR6öæW†œ;6âÂ6&v"Æ2¶W—2ãÂöF—câs°¢Ğ§Ğ ¦7–æ2gVæ7F–öâG•&Wfö¶T¶W’†¶W”–B’°¢–b‚6öæf—&Ò‚|+õ&Wfö6"W7F’¶W“òÆ2–çFVw&6–öæW2VRÆW6VâFV¦,:âFRgVæ6–öæ"FR–æÖVF–Fòâr’’&WGW&ã°¢G'’°¢v—B÷G6ÆÄgVæ7F–öâ‚w&Wfö¶V–¶W’rÂ²¶W”–BÒ“°¢FDæ÷F–b‚~)ÈRrÂt¶W’&Wfö6FrÂtÆ’¶W’gVR&Wfö6F6÷'&V7FÖVçFRâr“°¢G”Æ—7D¶W—2‚“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wG•&Wfö¶T¶W’W'&÷#¢rÂR“°¢FDæ÷F–b‚~)ªûˆòrÂtW'&÷"FR6öæW†œ;6ârÂtæò6RVFò&Wfö6"Æ’¶W’âr“°¢Ğ§Ğ ¢òò&VÖ÷fVBGWÆ–6FRW66T‡FÖÂ(	BW6RöW66T‡FÖÂ–ç7FVB†FVf–æVBBF÷öbf–ÆR ¢òòÖ÷7G&"÷&VæFW&—¦"VÂæVÂFR’66W72ÂVçG&"W6W7F;¢òò‡W66–væ6œ;6âÂæò&gVæ7F–öâ6WEF""Â&æò&ö×W"Æ6FVæFRw&2¦6öç7Bö÷&–u6WEF$”66W72Ò6WEF#°§6WEF"ÒgVæ7F–öâ‡F"Â'Fâ’°¢ö÷&–u6WEF$”66W72‡F"Â'Fâ“°¢–b‡F"ÓÓÒv•ö66W72r’&VæFW$”66W75æVÂ‚“°§Ó° ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4Ä5TÄDõ$DRÄ•T”D4œ94âDR$TäTd”4”õ24ô4”ÄU0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¦gVæ7F–öâöÆ—f×B†â’°¢&WGW&âu2òr²†—4f–æ—FR†â’òâ¢’çFôÆö6ÆU7G&–ær‚vW2ÕRrÂ²Ö–æ–×VÔg&7F–öäF–v—G3¢"ÂÖ†–×VÔg&7F–öäF–v—G3¢"Ò“°§Ğ ¢òò6ÆVæF"Öv&RÖöçF‡2öF—2&WGvVVâGvòFFW2†CÃÒC"¦gVæ7F–öâöÆ—ÖW6W5”F–2†CÂC"’°¢–b‚†C–ç7Fæ6VöbFFR’ÇÂ†C"–ç7Fæ6VöbFFR’ÇÂ—4æâ†C’ÇÂ—4æâ†C"’ÇÂC"ÂC’&WGW&â²ÖW6W3¢ÂF–3¢Ó°¢ÆWBæ–÷2ÒC"ævWDgVÆÅ–V"‚’ÒCævWDgVÆÅ–V"‚“°¢ÆWBÖW6W2ÒC"ævWDÖöçF‚‚’ÒCævWDÖöçF‚‚“°¢ÆWBF–2ÒC"ævWDFFR‚’ÒCævWDFFR‚“°¢–b†F–2Â’°¢ÖW6W2ÒÓ°¢6öç7B&WdÖöçF‚ÒæWrFFR†C"ævWDgVÆÅ–V"‚’ÂC"ævWDÖöçF‚‚’Â“°¢F–2³Ò&WdÖöçF‚ævWDFFR‚“°¢Ğ¢–b†ÖW6W2Â’²æ–÷2ÒÓ²ÖW6W2³Ò#²Ğ¢&WGW&â²ÖW6W3¢æ–÷2¢"²ÖW6W2ÂF–2Ó°§Ğ ¦gVæ7F–öâöÆ—'6TFFR†–B’°¢6öç7BbÒFö7VÖVçBævWDVÆVÖVçD'”–B†–B“òçfÇVS°¢–b‚b’&WGW&âçVÆÃ°¢6öç7BBÒæWrFFR‡b²uC££r“°¢&WGW&â—4æâ†B’òçVÆÂ¢C°§Ğ ¦Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚v6†ævRrÂ†R’Óâ°¢–b†RçF&vWBbbRçF&vWBæ–BÓÓÒvÆ—Ö÷F—fòr’°¢6öç7Bw&ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—ÖW6W5VæF–VçFW5w&r“°¢–b‡w&’w&ç7G–ÆRæF—7Æ’ÒRçF&vWBçfÇVRÓÓÒv&&—G&&–õ÷Æ¦òròv&Æö6²r¢væöæRs°¢Ğ§Ò“° ¦ÆWBöÆ—VÇF–Öõ&W7VÇFFòÒçVÆÃ° ¦gVæ7F–öâ6Æ4Æ—V–F6–öâ‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—7VVÆFòr“òçfÇVR’ÇÂ°¢6öç7B6–tfÕ6’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—6–tfÒr“òçfÇVRÓÓÒw6’s°¢6öç7B&×bÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—$Õbr“òçfÇVR’ÇÂ3°¢6öç7B–æw&W6òÒöÆ—'6TFFR‚vÆ—–æw&W6òr“°¢6öç7B6W6RÒöÆ—'6TFFR‚vÆ—6W6Rr“°¢6öç7BVÇD5E2ÒöÆ—'6TFFR‚vÆ—VÇD5E2r“°¢6öç7Bf4ÖçVÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—f4F–4ÖçVÂr“òçfÇVR’ÇÂ°¢6öç7BÖ÷F—fòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—Ö÷F—fòr“òçfÇVRÇÂw&VçVæ6–s°¢6öç7BÖW6W5VæF–VçFW2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—ÖW6W5VæF–VçFW2r“òçfÇVR’ÇÂ° ¢6öç7B&W7VÇDF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—&W7VÇBr“°¢6öç7B•w&ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—•w&r“°¢–b‚&W7VÇDF—b’&WGW&ã° ¢–b‚7VVÆFòÇÂ–æw&W6òÇÂ6W6R’°¢&W7VÇDF—bç7G–ÆRæF—7Æ’ÒvæöæRs°¢–b†•w&’•w&ç7G–ÆRæF—7Æ’ÒvæöæRs°¢&WGW&ã°¢Ğ¢–b†6W6RÂ–æw&W6ò’°¢&W7VÇDF—bç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇDF—bæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äÆfV6†FR6W6RæòVVFR6W"çFW&–÷"ÆfV6†FR–æw&W6òãÂöF—câs°¢–b†•w&’•w&ç7G–ÆRæF—7Æ’ÒvæöæRs°¢&WGW&ã°¢Ğ ¢6öç7B6–tfÒÒ6–tfÕ6’ò&×b¢ã¢°¢6öç7B&V×T&6RÒ7VVÆFò²6–tfÓ° ¢òò)H)H5E2G'Væ6)H)H ¢6öç7B–æ–6–ô5E2ÒVÇD5E2bbVÇD5E2ãÒ–æw&W6òòVÇD5E2¢–æw&W6ó°¢6öç7B²ÖW6W3¢7G4ÖW6W2ÂF–3¢7G4F–2ÒÒöÆ—ÖW6W5”F–2†–æ–6–ô5E2Â6W6R“°¢6öç7B&V×T6ö×WF&ÆT5E2Ò&V×T&6R²‡&V×T&6Ròb“²òò–æ6ÇW–RóbFRw&F–f–66œ;6à¢6öç7B7G2Ò‡&V×T6ö×WF&ÆT5E2ò"’¢7G4ÖW6W2²‡&V×T6ö×WF&ÆT5E2ò3c’¢7G4F–3° ¢òò)H)Hw&F–f–66œ;6âG'Væ6‡6VÖW7G&RVâ7W'6ò’)H)H ¢6öç7B6W6TÖöçF‚Ò6W6RævWDÖöçF‚‚“²òòÓ¢ÆWB6VÖW7G&T–æ–6–ó°¢–b†6W6TÖöçF‚ÃÒR’6VÖW7G&T–æ–6–òÒæWrFFR†6W6RævWDgVÆÅ–V"‚’ÂÂ“²òòVæRÖ§Và¢VÇ6R6VÖW7G&T–æ–6–òÒæWrFFR†6W6RævWDgVÆÅ–V"‚’ÂbÂ“²òò§VÂÖF–0¢–b‡6VÖW7G&T–æ–6–òÂ–æw&W6ò’6VÖW7G&T–æ–6–òÒ–æw&W6ó°¢6öç7B²ÖW6W3¢w&DÖW6W2ÂF–3¢w&DF–2ÒÒöÆ—ÖW6W5”F–2‡6VÖW7G&T–æ–6–òÂ6W6R“°¢6öç7Bw&EG'Væ6Ò‡&V×T&6Ròb’¢w&DÖW6W2²‡&V×T&6Ròƒ’¢w&DF–3°¢6öç7B&öæ–dW‡G&÷&F–æ&–Òw&EG'Væ6¢ã“²òòÆW’333BÂ’RW56ÇVBÂ–æfV7F ¢òò)H)Hf66–öæW2G'Væ62)H)H ¢ÆWBf4F–3°¢–b‡f4ÖçVÂâ’°¢f4F–2Òf4ÖçVÃ°¢ÒVÇ6R°¢òò9¦ÇF–Öòæ—fW'6&–òFR–æw&W6òçFW2FVÂ6W6R†–æ–6–òFVÂ,:–6÷&Bf66–öæÂf–vVçFR¢ÆWBVÇDæ—fW'6&–òÒæWrFFR†6W6RævWDgVÆÅ–V"‚’Â–æw&W6òævWDÖöçF‚‚’Â–æw&W6òævWDFFR‚’“°¢–b‡VÇDæ—fW'6&–òâ6W6R’VÇDæ—fW'6&–òç6WDgVÆÅ–V"‡VÇDæ—fW'6&–òævWDgVÆÅ–V"‚’Ò“°¢–b‡VÇDæ—fW'6&–òÂ–æw&W6ò’VÇDæ—fW'6&–òÒæWrFFR†–æw&W6ò“°¢6öç7B²ÖW6W3¢dÖW6W2ÂF–3¢dF–2ÒÒöÆ—ÖW6W5”F–2‡VÇDæ—fW'6&–òÂ6W6R“°¢f4F–2ÒçVÆÃ²òòÖ&6Ö÷2&6Æ7VÆ"Vâ6öÆW2F—&V7FÖVçFR&¦ğ¢f"f5G'Væ656öÆW2Ò‡7VVÆFòò"’¢dÖW6W2²‡7VVÆFòò3c’¢dF–3°¢Ğ¢6öç7Bf66–öæW2Òf4F–2ÓÒçVÆÂbbf4F–2ÓÒVæFVf–æVBò‡7VVÆFòò3’¢f4F–2¢f5G'Væ656öÆW3° ¢òò)H)H–æFVÖæ—¦6œ;6â‡6öÆò6’Æ–6’)H)H ¢ÆWB–æFVÖæ—¦6–öâÒ°¢ÆWB–æFVÔFWFÆÆRÒrs°¢–b†Ö÷F—fòÓÓÒv&&—G&&–õö–æFVbr’°¢6öç7B²ÖW6W3¢F÷FÄÖW6W2ÒÒöÆ—ÖW6W5”F–2†–æw&W6òÂ6W6R“°¢6öç7Bæ–÷46ö×ÆWF÷2ÒÖF‚æfÆö÷"‡F÷FÄÖW6W2ò"“°¢6öç7BÖW6W5&W7FçFW2ÒF÷FÄÖW6W2R#°¢–æFVÖæ—¦6–öâÒÖF‚æÖ–â†æ–÷46ö×ÆWF÷2¢ãR¢7VVÆFò²†ÖW6W5&W7FçFW2ò"’¢ãR¢7VVÆFòÂ"¢7VVÆFò“°¢–æFVÔFWFÆÆRÒãR&V×VæW&6–öæW2÷";ò6ö×ÆWFò‚G¶æ–÷46ö×ÆWF÷7Ò;ò‡2’²G¶ÖW6W5&W7FçFW7ÒÖW2†W2’’ÂF÷R"&V×VæW&6–öæW2æ°¢ÒVÇ6R–b†Ö÷F—fòÓÓÒv&&—G&&–õ÷Æ¦òr’°¢–æFVÖæ—¦6–öâÒÖF‚æÖ–âƒãR¢7VVÆFò¢ÖW6W5VæF–VçFW2Â"¢7VVÆFò“°¢–æFVÔFWFÆÆRÒãR&V×VæW&6–öæW2÷"6FÖW2FV¦FòFRÆ&÷&"‚G¶ÖW6W5VæF–VçFW7ÒÖW2†W2’’ÂF÷R"&V×VæW&6–öæW2æ°¢Ğ ¢6öç7BF÷FÂÒ7G2²w&EG'Væ6²&öæ–dW‡G&÷&F–æ&–²f66–öæW2²–æFVÖæ—¦6–öã° ¢öÆ—VÇF–Öõ&W7VÇFFòÒ²7VVÆFòÂ6–tfÒÂ7G2Â7G4ÖW6W2Â7G4F–2Âw&EG'Væ6Âw&DÖW6W2Âw&DF–2Â&öæ–dW‡G&÷&F–æ&–Âf66–öæW2Â–æFVÖæ—¦6–öâÂ–æFVÔFWFÆÆRÂÖ÷F—fòÂF÷FÂÓ° ¢&W7VÇDF—bç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇDF—bæ–ææW$…DÔÂÒ ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£ƒ·FF–æs£g‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇ7ãä5E2G'Væ6‚G¶7G4ÖW6W7ÖÒG¶7G4F–7ÖB“Â÷7ããÇ7G&öæsâGµöÆ—f×B†7G2—ÓÂ÷7G&öæsãÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇ7ãäw&F–f–66œ;6âG'Væ6‚G¶w&DÖW6W7ÖÒG¶w&DF–7ÖB“Â÷7ããÇ7G&öæsâGµöÆ—f×B†w&EG'Væ6—ÓÂ÷7G&öæsãÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇ7ãä&öæ–f–66œ;6âW‡G&÷&F–æ&–’R„ÆW’333B“Â÷7ããÇ7G&öæsâGµöÆ—f×B†&öæ–dW‡G&÷&F–æ&–—ÓÂ÷7G&öæsãÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇ7ãåf66–öæW2G'Væ63Â÷7ããÇ7G&öæsâGµöÆ—f×B‡f66–öæW2—ÓÂ÷7G&öæsãÂöF—cà¢G¶–æFVÖæ—¦6–öââòÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇ7ãä–æFVÖæ—¦6œ;6â÷"FW7–Fò&&—G&&–óÂ÷7ããÇ7G&öæsâGµöÆ—f×B†–æFVÖæ—¦6–öâ—ÓÂ÷7G&öæsãÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FF–æs£G‚#âG¶–æFVÔFWFÆÆWÓÂöF—cæ¢rwĞ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£‚¶Ö&v–â×F÷£‡ƒ¶&÷&FW"×F÷£'‚6öÆ–Bf"‚ÒÖvöÆB’#ãÇ7â7G–ÆSÒ&föçB×vV–v‡C£c#åF÷FÂÆ—V–F6œ;6ãÂ÷7ããÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB“¶föçB×6—¦S£w‚#âGµöÆ—f×B‡F÷FÂ—ÓÂ÷7G&öæsãÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£‚#à¢<:Æ7VÆò&VfW&Væ6–Â6V|;¦â,:–v–ÖVâÆ&÷&ÂvVæW&ÂFRÆ7F—f–FB&—fF„Bå2âÓ“rÕE"5E2ÂÆW’#ss3Rw&F–f–66–öæW2ÂBäÆVrâs2f66–öæW2ÂBå2â2Ó“rÕE"–æFVÖæ—¦6œ;6â’âfW&–f–66öçfVæ–÷26öÆV7F—f÷2Â&V|:ÖÖVæW2W7V6–ÆW2†w&&–òÂ6öç7G'V66œ;6âÂÖ–7&öV×&W6ÂWF2â’ò&VæVf–6–÷2F–6–öæÆW2VRVVFâÆ–6"GR66òà¢ÂöF—cà¢°¢–b†•w&’•w&ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢6öç7B•&W7VÇBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—•&W7VÇBr“°¢–b†•&W7VÇB’•&W7VÇBç7G–ÆRæF—7Æ’ÒvæöæRs°§Ğ ¦7–æ2gVæ7F–öâGÆ—V–F6–öä”–ç6–v‡B‚’°¢–b‚öÆ—VÇF–Öõ&W7VÇFFò’&WGW&ã°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆ—•&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#ävVæW&æFòW‡Æ–66œ;6âââãÂ÷7ãâs°¢6öç7B"ÒöÆ—VÇF–Öõ&W7VÇFFó°¢6öç7B&ö×BÒW‡Æ–6VâÆVæwV¦R6–×ÆR’6W&6æò‡&VâG&&¦F÷"6–â6öæö6–Ö–VçF÷2ÆVvÆW2ÂæòVâ6öçFF÷"’W7FÆ—V–F6œ;6âFR&VæVf–6–÷26ö6–ÆW2W'Væ ¢Ò5E2G'Væ6¢2òG·"æ7G2çFôf—†VBƒ"—Ğ¢Òw&F–f–66œ;6âG'Væ6¢2òG·"æw&EG'Væ6çFôf—†VBƒ"—Ò²&öæ–f–66œ;6âW‡G&÷&F–æ&–’S¢2òG·"æ&öæ–dW‡G&÷&F–æ&–çFôf—†VBƒ"—Ğ¢Òf66–öæW2G'Væ63¢2òG·"çf66–öæW2çFôf—†VBƒ"—Ğ¢Ò–æFVÖæ—¦6œ;6ã¢2òG·"æ–æFVÖæ—¦6–öâçFôf—†VBƒ"—Ò†Ö÷F—fòFR6W6S¢G·"æÖ÷F—f÷Ò¢ÒF÷FÃ¢2òG·"çF÷FÂçFôf—†VBƒ"—Ğ¤W‡Æ–6'&WfVÖVçFR\:’W26F6öæ6WFò’÷"\:’ÆR6÷'&W7öæFRÂVâBÓRÌ:ÖæV26÷'F2Â6–â¦W&vÆVvÂæ° ¢G'’°¢6öç7B&W2Òv—B6ÆÄFV6Æ&e’‡°¢ÖöFVÃ¢v6ÆVFR×6öææWBÓBÓRrÀ¢Ö…÷Fö¶Vç3¢cÀ¢7—7FVÓ¢tW&W2VâW7V6–Æ—7FVâFW&V6†òÆ&÷&ÂW'VæòVRW‡Æ–6Æ—V–F6–öæW2FRf÷&Ö6Æ&’V×:F–6&G&&¦F÷&W26–â6öæö6–Ö–VçF÷2ÆVvÆW2ârÀ¢ÖW76vW3¢·²&öÆS¢wW6W"rÂ6öçFVçC¢&ö×BÕÒÀ¢Ò“°¢6öç7BFFÒv—B&W2æ§6öâ‚“°¢6öç7BFW‡BÒFFæ6öçFVçCòå³ÓòçFW‡BÇÂtæò6RVFòvVæW&"ÆW‡Æ–66œ;6ââs°¢&÷‚æ–ææW$…DÔÂÒöÖDf÷&ÖB‡FW‡B“°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wGÆ—V–F6–öä”–ç6–v‡BW'&÷#¢rÂR“°¢&÷‚æ–ææW$…DÔÂÒsÇ7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#äW'&÷"vVæW&æFòÆW‡Æ–66œ;6ââ–çFVçFFRçVWfòãÂ÷7ãâs°¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4ôå5TÅD5TäBTâd•dò…%T2²fÆ–F6œ;6âFR6ö×&ö&çFW2¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¦gVæ7F–öâ6WE7VæDÆ—fUF"‡F"Â'Fâ’°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fU'V5æVÂr’ç7G–ÆRæF—7Æ’ÒF"ÓÓÒw'V2ròv&Æö6²r¢væöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fTFWVF2r’ç7G–ÆRæF—7Æ’ÒF"ÓÓÒvFWVF2ròv&Æö6²r¢væöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fUGBr’ç7G–ÆRæF—7Æ’ÒF"ÓÓÒwGBròv&Æö6²r¢væöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fT7Rr’ç7G–ÆRæF—7Æ’ÒF"ÓÓÒv7Rròv&Æö6²r¢væöæRs°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚r77VæDÆ—fUF'2æÖöGVÆR×F"r’æf÷$V6‚†"Óâ²"æ6Æ74Æ—7Bç&VÖ÷fR‚v7F—fRr“²"ç7G–ÆRæ&6¶w&÷VæBÒrs²Ò“°¢–b†'Fâ’²'Fâæ6Æ74Æ—7BæFB‚v7F—fRr“²'Fâç7G–ÆRæ&6¶w&÷VæBÒw&v&ƒS‚Ã3BÃ#SRÂãr’s²Ğ§Ğ ¦6öç7B5TäEõ%T5õT$Ä”5õU$ÂÒv‡GG3¢òöRÖ6öç7VÇF'V2ç7VæBævö"çRòs°¦6öç7B5TäEõ4ôÅõU$ÂÒv‡GG3¢òöRÖÖVçRç7VæBævö"çRòs° ¦gVæ7F–öâ÷fÆ–EW'Wf–å'V2‡'V2’°¢–b‚õâƒÃWÃwÃ#•³Ó•×³—ÒBòçFW7B‡'V2’’&WGW&âfÇ6S°¢6öç7BvV–v‡G2Ò³RÂBÂ2Â"ÂrÂbÂRÂBÂ2Â%Ó°¢6öç7B7VÒÒvV–v‡G2ç&VGV6R‚‡F÷FÂÂvV–v‡BÂ–æFW‚’ÓâF÷FÂ²çVÖ&W"‡'V5¶–æFW…Ò’¢vV–v‡BÂ“°¢6öç7B&VÖ–æFW"Ò7VÒR°¢&WGW&âçVÖ&W"‡'V5³Ò’ÓÓÒ‡&VÖ–æFW"ÓÓÒò¢Ò&VÖ–æFW"“°§Ğ ¦7–æ2gVæ7F–öâÆöE7VæE7FGW2‚’°¢6öç7BF&vWG2ÒFö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚u¶FF×7VæB×7FGW5Òr“°¢–b‚F&vWG2æÆVæwF‚’&WGW&ã°¢G'’°¢6öç7B7FGW2Òv—BFV6Æ&g”’‚w7VæE÷7FGW2rÂ²ÖWF†öC¢ttUBrÒ“°¢6öç7B7RÒ7FGW2æöff–6–Ä7P¢òsÇ7G&öæsî)ÈRfÆ–F6œ;6â5SÂ÷7G&öæsä’öf–6–Â6öæV7FFp¢¢sÇ7G&öæsî)ªûˆòfÆ–F6œ;6â5SÂ÷7G&öæsäfÇFâ7&VFVæ6–ÆW2’5TäBs°¢6öç7B‡FÖÂÒÆF—b6Æ73Ò'7VæB×7FGW2Ö—FVÒ#âG¶7WÓÂöF—cà¢ÆF—b6Æ73Ò'7VæB×7FGW2Ö—FVÒ#ãÇ7G&öæsî)ÈR6öç7VÇF%T3Â÷7G&öæså÷'FÂ;¦&Æ–6òöf–6–ÂF—7öæ–&ÆSÂöF—cà¢ÆF—b6Æ73Ò'7VæB×7FGW2Ö—FVÒ#ãÇ7G&öæsï	ùIFWVF2’ECÂ÷7G&öæsä66W6òW'6öæÂÖVF–çFR6ÆfR4ôÃÂöF—cæ°¢F&vWG2æf÷$V6‚‡F&vWBÓâ²F&vWBæ–ææW$…DÔÂÒ‡FÖÃ²Ò“°¢Ò6F6‚†W'&÷"’°¢F&vWG2æf÷$V6‚‡F&vWBÓâ²F&vWBæ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæB×7FGW2Ö—FVÒ#ãÇ7G&öæsî)ªûˆòW7FFòæòF—7öæ–&ÆSÂ÷7G&öæsâGµöW66T‡FÖÂ†W'&÷"æÖW76vR—ÓÂöF—cæ²Ò“°¢Ğ§Ğ ¦gVæ7F–öâ÷Vå7VæE'V4öff–6–Â‚’°¢6öç7B'V2Ò†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fU'V2r“òçfÇVRÇÂrr’ç&WÆ6R‚õÄBörÂrr“°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fU&W7VÇBr“°¢–b‚÷fÆ–EW'Wf–å'V2‡'V2’’°¢–b†&÷‚’°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#ä–æw&W6Vâ%T2W'Væòl:Æ–FòFRL:Öv—F÷2ãÂöF—câs°¢Ğ¢&WGW&ã°¢Ğ¢–b†&÷‚’°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7G&öæså%T2l:Æ–FòÆö6ÆÖVçFSÂ÷7G&öæsãÇ7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å6R'&œ;2Æ6öç7VÇFöf–6–ÂFR5TäBâ6ö×ÆWFÆÌ:ÒÆfW&–f–66œ;6â6öÆ–6—FF÷"5TäBãÂ÷ãÂöF—câs°¢Ğ¢v–æF÷ræ÷Vâ…5TäEõ%T5õT$Ä”5õU$ÂÂuö&Ææ²rÂvæö÷VæW"Ææ÷&VfW'&W"r“°§Ğ ¦gVæ7F–öâ÷Vå7VæE6öÂ‡6V7F–öâ’°¢6öç7BF&vWD–BÒ6V7F–öâÓÓÒwGBròw7VæEGE&W7VÇBr¢w7VæDFWVF5&W7VÇBs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‡F&vWD–B“°¢–b†&÷‚’°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7G&öæsä66W6ò&÷FVv–Fò÷"5TäCÂ÷7G&öæsãÇ7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å6R'&œ;25TäB÷W&6–öæW2VâÌ:ÖæVâ–æw&W6W'6öæÆÖVçFR6öâGR%T2ÂW7V&–ò’6ÆfR4ôÂãÂ÷ãÂöF—câs°¢Ğ¢v–æF÷ræ÷Vâ…5TäEõ4ôÅõU$ÂÂuö&Ææ²rÂvæö÷VæW"Ææ÷&VfW'&W"r“°§Ğ ¦gVæ7F–öâG6öç7VÇF'V2‚’²÷Vå7VæE'V4öff–6–Â‚“²Ğ ¦7–æ2gVæ7F–öâGfÆ–F$6ö×&ö&çFR‚’°¢6öç7B'V4VÖ—6÷"Ò†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7U'V2r“òçfÇVRÇÂrr’ç&WÆ6R‚õÄBörÂrr“°¢6öç7BF—ô6ö×&ö&çFRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7UF—òr“òçfÇVS°¢6öç7B6W&–RÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7U6W&–Rr“òçfÇVSòçG&–Ò‚“°¢6öç7BçVÖW&òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7TçVÖW&òr“òçfÇVSòçG&–Ò‚“°¢6öç7BfV6†&rÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7TfV6†r“òçfÇVS°¢6öç7BÖöçFòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7TÖöçFòr“òçfÇVS°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7U&W7VÇBr“°¢–b‚&÷‚’&WGW&ã° ¢–b‚'V4VÖ—6÷"ÇÂF—ô6ö×&ö&çFRÇÂ6W&–RÇÂçVÖW&òÇÂfV6†&rÇÂÖöçFòÓÓÒrrÇÂçVÖ&W"æ—4f–æ—FR„çVÖ&W"†ÖöçFò’’ÇÂçVÖ&W"†ÖöçFò’Â’°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#ä6ö×ÆWFFöF÷2Æ÷26×÷2ãÂöF—câs°¢&WGW&ã°¢Ğ¢6öç7B·’ÂÒÂEÒÒfV6†&rç7Æ—B‚rÒr“°¢6öç7BfV6†VÖ—6–öâÒG¶GÒòG¶×ÒòG·—Ö° ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#åfÆ–FæFòçFR5TäBââãÂöF—câs°¢G'’°¢6öç7BFFÒv—BFV6Æ&g”’‚v6öç7VÇF7VæF6ö×&ö&çFW2rÂ²&öG“¢°¢'V3¢'V4VÖ—6÷"À¢F—ó¢v7RrÀ¢6öD6ö×¢F—ô6ö×&ö&çFRÀ¢çVÖW&õ6W&–S¢6W&–RÀ¢çVÖW&òÀ¢fV6†VÖ—6–öâÀ¢ÖöçFó¢çVÖ&W"†ÖöçFò¢×Ò“°¢–b†FFçfW&–f–6FòÓÒG'VR’°¢6öç7BÖW76vRÒFFæÖVç6¦RÇÂFFæW'&÷"ÇÂtæògVR÷6–&ÆRfW&–f–6"VÂ6ö×&ö&çFR6öâÆgVVçFR5Râs°¢&÷‚æ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#î)ªûˆòGµöW66T‡FÖÂ†ÖW76vR—ÓÂöF—cæ°¢&WGW&ã°¢Ğ¢6öç7BfÆ–FòÒFFçfÆ–FòÓÓÒG'VS°¢&÷‚æ–ææW$…DÔÂÒ ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢G·fÆ–Fòòw&v&ƒCbÃ#BÃ2Âã‚’r¢w&v&ƒ#3ÃSrÃsÂã‚’wÓ¶&÷&FW#£‚6öÆ–BG·fÆ–Fòòw&v&ƒCbÃ#BÃ2Âã2’r¢w&v&ƒ#3ÃSrÃsÂã2’wÓ¶&÷&FW"×&F—W3£ƒ·FF–æs£g‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Wƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢G·fÆ–Fòòr3$T43sr¢wf"‚Ò×&VB’wÒ#âG·fÆ–Fòò~)ÈR6ö×&ö&çFRfW&–f–6Fòr¢~)ØÂ6ö×&ö&çFRæòl:Æ–FòwÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶Ö&v–â×F÷£‡ƒ¶Æ–æRÖ†V–v‡C£ã‚#à¢ÆF—cãÇ7G&öæså%T3£Â÷7G&öæsâGµöW66T‡FÖÂ‡'V4VÖ—6÷"—ÓÂöF—cà¢ÆF—cãÇ7G&öæsä6ö×&ö&çFS£Â÷7G&öæsâGµöW66T‡FÖÂ‡F—ô6ö×&ö&çFR—ÒGµöW66T‡FÖÂ‡6W&–R—ÒÒGµöW66T‡FÖÂ†çVÖW&ò—ÓÂöF—cà¢ÆF—cãÇ7G&öæsäfV6†£Â÷7G&öæsâGµöW66T‡FÖÂ†fV6†VÖ—6–öâ—ÓÂöF—cà¢ÆF—cãÇ7G&öæsäW7FFò5S£Â÷7G&öæsâGµöW66T‡FÖÂ†FFæW7FFõö7RÇÂvFW66öæö6–Fòr—ÓÂöF—cà¢ÆF—cãÇ7G&öæsäW7FFò%T3£Â÷7G&öæsâGµöW66T‡FÖÂ†FFæW7FFõ÷'V2ÇÂvFW66öæö6–Fòr—ÓÂöF—cà¢ÆF—cãÇ7G&öæsä6öæF–6œ;6ã£Â÷7G&öæsâGµöW66T‡FÖÂ†FFæ6öæF–6–öå÷'V2ÇÂvFW66öæö6–Fr—ÓÂöF—cà¢ÆF—cãÇ7G&öæsägVVçFS£Â÷7G&öæsâGµöW66T‡FÖÂ†FFægVVçFRÇÂu5TäBr—ÓÂöF—cà¢ÆF—câGµöW66T‡FÖÂ†FFæÖVç6¦RÇÂrr—ÓÂöF—cà¢ÂöF—cà¢ÂöF—cæ°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wGfÆ–F$6ö×&ö&çFRW'&÷#¢rÂR“°¢&÷‚æ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äW'&÷#¢G·6fT…DÔÂ†RæÖW76vR’ÇÂtæò6RVFò6öæV7F"6öâ5TäBâwÓÂöF—cæ°¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòô5"DRd5EU$2(i"4”TåDò4ôåD$ÄP¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¦ÆWBöö7$f7GW&f–ÆTFFÒçVÆÃ²òò²&6ScBÂÖVF–G—RÂ—5FbĞ ¦gVæ7F–öâ÷Gf–ÆUFô&6ScB†f–ÆR’°¢&WGW&âæWr&öÖ—6R‚‡&W6öÇfRÂ&V¦V7B’Óâ°¢6öç7B&VFW"ÒæWrf–ÆU&VFW"‚“°¢&VFW"æöæÆöBÒ‚’Óâ&W6öÇfR‡&VFW"ç&W7VÇBç7Æ—B‚rÂr•³Ò“°¢&VFW"æöæW'&÷"Ò&V¦V7C°¢&VFW"ç&VD4FFU$Â†f–ÆR“°¢Ò“°§Ğ ¦7–æ2gVæ7F–öâGö7$f7GW&&Wf–Wr‚’°¢6öç7B–çWBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&f–ÆRr“°¢6öç7Bf–ÆRÒ–çWCòæf–ÆW3òå³Ó°¢6öç7B&Wf–Wt&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&&Wf–Wt&÷‚r“°¢6öç7B–ÖrÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&&Wf–Wt–Örr“°¢6öç7BFd&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&&Wf–WuFbr“°¢6öç7B'FâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&'Fâr“°¢–b‚f–ÆR’²&Wf–Wt&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²'FâæF—6&ÆVBÒG'VS²&WGW&ã²Ğ ¢6öç7B—5FbÒf–ÆRçG—RÓÓÒvÆ–6F–öâ÷Fbs°¢6öç7B&6ScBÒv—B÷Gf–ÆUFô&6ScB†f–ÆR“°¢öö7$f7GW&f–ÆTFFÒ²&6ScBÂÖVF–G—S¢f–ÆRçG—RÂ—5FbÓ° ¢&Wf–Wt&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–b†—5Fb’°¢–Örç7G–ÆRæF—7Æ’ÒvæöæRs°¢Fd&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢ÒVÇ6R°¢Fd&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs°¢–Örç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–Örç7&2ÒvFF¢r²f–ÆRçG—R²s¶&6ScBÂr²&6ScC°¢Ğ¢'FâæF—6&ÆVBÒfÇ6S°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&&W7VÇBr’ç7G–ÆRæF—7Æ’ÒvæöæRs°§Ğ ¦7–æ2gVæ7F–öâGö7$f7GW&&ö6W6"‚’°¢–b‚öö7$f7GW&f–ÆTFF’&WGW&ã°¢6öç7BÆöF–ærÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&ÆöF–ærr“°¢6öç7B&W7VÇBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vö7$f7GW&&W7VÇBr“°¢ÆöF–ærç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇBç7G–ÆRæF—7Æ’ÒvæöæRs° ¢6öç7B6öçFVçD&Æö6²Òöö7$f7GW&f–ÆTFFæ—5F`¢ò²G—S¢vFö7VÖVçBrÂ6÷W&6S¢²G—S¢v&6ScBrÂÖVF–÷G—S¢vÆ–6F–öâ÷FbrÂFF¢öö7$f7GW&f–ÆTFFæ&6ScBÒĞ¢¢²G—S¢v–ÖvRrÂ6÷W&6S¢²G—S¢v&6ScBrÂÖVF–÷G—S¢öö7$f7GW&f–ÆTFFæÖVF–G—RÂFF¢öö7$f7GW&f–ÆTFFæ&6ScBÒÓ° ¢6öç7B–ç7G'V7F–öç2ÒæÆ—¦W7FR6ö×&ö&çFRFRvòW'Væò†f7GW&ò&öÆWF’âW‡G&RÆ÷2FF÷2’&W7öæFRVâW7FRf÷&ÖFòW†7FòÂVâW7;öÂÂ6–âw&Vv"FW‡FògVW&FRW7F26V66–öæW3  ¢¢¤DDõ2DTÂ4ôÕ$ô$åDR¢ ¢ÒF—ó ¢Ò6W&–R’ì;¦ÖW&ó ¢ÒfV6†FRVÖ—6œ;6ã ¢Ò%T2VÖ—6÷"’&¬;6â6ö6–Ã ¢Ò%T2ôDä’FVÂ6Æ–VçFR‡6’f–wW&“ ¢Ò&6R–×öæ–&ÆR‡6–â”ub“ ¢Ò”ubƒ‚R“ ¢ÒF÷FÃ  ¢¢¥E$DÔ”TåDòE$”%UD$”ò¢ ¢Ò+ôW2FVGV6–&ÆR&VfV7F÷2FVÂ–×VW7FòÆ&VçFò‡<:Òöæò’÷"\:’¢Ò+ô÷F÷&vFW&V6†ò7,:–F—Fòf—66ÂFR”ucò‡<:Òöæò’÷"\:’¢Ò+ôÆ–6FWG&66œ;6â…5õB“ò6’Æ–6Â–æF–6VÂ÷&6VçF¦R’VÂ&–Vâ÷6W'f–6–òFWFV7FFòà¢Òö'6W'f6–öæW2ò&–W6v÷2G&–'WF&–÷2VRæ÷FW2†V¢â6ö×&ö&çFRæòf–FVF–væòÂFF÷2–æ6ö×ÆWF÷2ÂWF2â ¢¢¤4”TåDò4ôåD$ÄR5TtU$”Dò…4tR’¢ ¥&W6VçFVÂ6–VçFòVâVæF&Æ6–×ÆS¢7VVçFÂFVæöÖ–æ6œ;6âÂFV&RÂ†&W&° ¢G'’°¢6öç7B&W2Òv—B6ÆÄFV6Æ&e’‡°¢ÖöFVÃ¢v6ÆVFR×6öææWBÓBÓRrÀ¢Ö…÷Fö¶Vç3¢ƒÀ¢7—7FVÓ¢tW&W2Vâ6öçFF÷"W'VæòW‡W'FòVâG&–'WF6œ;6â’VâVÂÆâ6öçF&ÆRvVæW&ÂV×&W6&–Â…4tR’âæÆ—¦26ö×&ö&çFW2FRvò6öâ&V6—6œ;6â’vVæW&26–VçF÷26öçF&ÆW26÷'&V7F÷2ârÀ¢ÖW76vW3¢·²&öÆS¢wW6W"rÂ6öçFVçC¢¶6öçFVçD&Æö6²Â²G—S¢wFW‡BrÂFW‡C¢–ç7G'V7F–öç2ÕÒÕÒÀ¢Ò“°¢6öç7BFFÒv—B&W2æ§6öâ‚“°¢6öç7BFW‡BÒFFæ6öçFVçCòå³ÓòçFW‡C°¢ÆöF–ærç7G–ÆRæF—7Æ’ÒvæöæRs°¢&W7VÇBç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–b‚FW‡B’°¢&W7VÇBæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äæò6RVFò&ö6W6"VÂ6ö×&ö&çFRâ–çFVçF6öâVæ–ÖvVâÜ:26Æ&ãÂöF—câs°¢&WGW&ã°¢Ğ¢&W7VÇBæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£ƒ·FF–æs£gƒ¶föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ãƒ·v†—FR×76S§&R×w&#âGµöW66T‡FÖÂ‡FW‡B—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£‚#å&W7VÇFFòvVæW&Fò÷"”'F—"FRÆ–ÖvVâõDb7V&–FòâfW&–f–6Æ÷2ÖöçF÷2’Æ6Æ6–f–66œ;6âG&–'WF&–çFW2FR&Vv—7G&"VÂ6–VçFòVâGR6—7FVÖ6öçF&ÆRãÂöF—cæ°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wGö7$f7GW&&ö6W6"W'&÷#¢rÂR“°¢ÆöF–ærç7G–ÆRæF—7Æ’ÒvæöæRs°¢&W7VÇBç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇBæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äW'&÷"&ö6W6æFòVÂ6ö×&ö&çFRâ–çFVçFFRçVWfòãÂöF—câs°¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò4Ä4”d”4Dõ"$ä4TÄ$”ò„…24ôDR’4•5D”Dòõ"”¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¦7–æ2gVæ7F–öâG6Æ6–f–6$…2‚’°¢6öç7BFW67&—6–öâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v‡4FW67&—6–öâr“òçfÇVSòçG&–Ò‚“°¢6öç7BÖFW&–ÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v‡4ÖFW&–Âr“òçfÇVSòçG&–Ò‚“°¢6öç7BW6òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v‡5W6òr“òçfÇVSòçG&–Ò‚“°¢6öç7BfÇV¦òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v‡4fÇV¦òr“òçfÇVS°¢6öç7BÆöF–ærÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v‡4ÆöF–ærr“°¢6öç7B&W7VÇBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v‡5&W7VÇBr“° ¢–b‚FW67&—6–öâ’°¢&W7VÇBç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇBæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äFW67&–&RVÂ&öGV7Fò&–ÖW&òãÂöF—câs°¢&WGW&ã°¢Ğ ¢ÆöF–ærç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇBç7G–ÆRæF—7Æ’ÒvæöæRs° ¢6öç7B&ö×BÒ&öGV7Fò6Æ6–f–6"&æ6VÆ&–ÖVçFR‚G¶fÇV¦òÓÓÒvW‡÷'F6–öâròtU…õ%D4œ94âr¢t”Õõ%D4œ94âwÒVâW,;¢“ ¤FW67&—6œ;6ã¢G¶FW67&—6–öçĞ¢G¶ÖFW&–ÂòÖFW&–Â&–æ6—Ã¢G¶ÖFW&–ÇÖ¢rwĞ¢G·W6òòW6òöFW7F–æó¢G·W6÷Ö¢rwĞ ¥&W7öæFRVâW7FRf÷&ÖFòW†7Fó  ¢¢¥%D”D$ä4TÄ$”5TtU$”D¢ ¢Ò7V''F–Fæ6–öæÂƒL:Öv—F÷2Â&æ6VÂFRGVæ2FVÂW,;¢’Ü:2&ö&&ÆS ¢ÒFW67&—6œ;6âöf–6–ÂFRW67V''F–F ¢Òæ—fVÂFR6öæf–ç¦†ÇFöÖVF–ö&¦’’÷"\:“  ¢¢¤ÅDU$äD•d24ôå4”DU$"¢ ¤Æ—7FÓ"7V''F–F2ÇFW&æF—f26’Æ6Æ6–f–66œ;6âW2Ö&–wVÂ6öâVÂ7&—FW&–òVRÆ2F–fW&Væ6–à ¢¢¥$¤ôäÔ”TåDò¢ ¤W‡Æ–6'&WfVÖVçFRÆ2&VvÆ2vVæW&ÆW2FR–çFW'&WF6œ;6â…$t’’Æ–6F2&ÆÆVv"W7F6Æ6–f–66œ;6âà ¢¢¤$ä4TÄU2DR$TdU$Tä4”¢ ¢ÒBfÆ÷&VÒ‡'F–FvVæW&Â“ ¢Ò+õF–VæR&VfW&Væ6–&æ6VÆ&–VâÆ|;¦âDÄ2&VÆWfçFR&W,;£òÖVæ6–öæ7\:Â6’Æ–6à ¢¢¤”Õõ%DåDR¢ ¤6Æ&VRW7FòW2Væ7VvW&Væ6–FR”’VRÆ6Æ6–f–66œ;6âf–æÂFV&R6öæf—&Ö'6R6öâVâvVçFRFRGVæ2òÖVF–çFR6öç7VÇFFR6Æ6–f–66œ;6â&æ6VÆ&–çFR5TäBô”äDT4õ’æ° ¢G'’°¢6öç7B&W2Òv—B6ÆÄFV6Æ&e’‡°¢ÖöFVÃ¢v6ÆVFR×6öææWBÓBÓRrÀ¢Ö…÷Fö¶Vç3¢SÀ¢7—7FVÓ¢tW&W2VâW7V6–Æ—7FVâ6Æ6–f–66œ;6â&æ6VÆ&–’6öÖW&6–òW‡FW&–÷"W'VæòÂ6öâFöÖ–æ–òFVÂ6—7FVÖ&Ööæ—¦Fò„…2’’VÂ&æ6VÂFRGVæ2FVÂW,;¢ârÀ¢ÖW76vW3¢·²&öÆS¢wW6W"rÂ6öçFVçC¢&ö×BÕÒÀ¢Ò“°¢6öç7BFFÒv—B&W2æ§6öâ‚“°¢6öç7BFW‡BÒFFæ6öçFVçCòå³ÓòçFW‡C°¢ÆöF–ærç7G–ÆRæF—7Æ’ÒvæöæRs°¢&W7VÇBç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–b‚FW‡B’°¢&W7VÇBæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äæò6RVFòvVæW&"Æ6Æ6–f–66œ;6ââ–çFVçFFRçVWfòãÂöF—câs°¢&WGW&ã°¢Ğ¢&W7VÇBæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£ƒ·FF–æs£gƒ¶föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ãƒ·v†—FR×76S§&R×w&#âGµöW66T‡FÖÂ‡FW‡B—ÓÂöF—cæ°¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wG6Æ6–f–6$…2W'&÷#¢rÂR“°¢ÆöF–ærç7G–ÆRæF—7Æ’ÒvæöæRs°¢&W7VÇBç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇBæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£G‚#äW'&÷"vVæW&æFòÆ6Æ6–f–66œ;6ââ–çFVçFFRçVWfòãÂöF—câs°¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò$T4õ$DDõ$”õ2õ"t„E4(	BwV&F"&VfW&Væ6–2FVÂW7V&–ğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¦7–æ2gVæ7F–öâGwV&F%&V6÷&FF÷&–÷2‚’°¢6öç7Bv†G6ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wv†G6r“òçfÇVSòçG&–Ò‚“°¢6öç7Bæ÷F–ev†G6ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wæ÷F–ev†G6r“òçfÇVRÓÓÒw6’s°¢6öç7B'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'V2r“òçfÇVSòçG&–Ò‚“°¢6öç7Bö²ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væ÷F–dö²r“° ¢–b†æ÷F–ev†G6bb‚v†G6ÇÂv†G6ç7F'G5v—F‚‚r²r’’’°¢–b†ö²’²ö²ç7G–ÆRæ6öÆ÷"Òwf"‚Ò×&VB’s²ö²çFW‡D6öçFVçBÒt–æw&W6GRì;¦ÖW&ò6öâ<;6F–vòFR:×2ÂV£¢³S““““““““’s²Ğ¢&WGW&ã°¢Ğ ¢G'’°¢v—B÷G6ÆÄgVæ7F–öâ‚wWFFVæ÷F–g&Vg2rÂ²v†G6Âæ÷F–ev†G6Â'V2Ò“°¢–b†ö²’²ö²ç7G–ÆRæ6öÆ÷"Òrs²ö²çFW‡D6öçFVçBÒæ÷F–ev†G6ò~)ÈR&V6÷&FF÷&–÷27F—fF÷2âFRf—6&VÖ÷2÷"v†G4âr¢~)ÈR&VfW&Væ6–2wV&FF2âs²Ğ¢Ò6F6‚†R’°¢6öç6öÆRæW'&÷"‚wGwV&F%&V6÷&FF÷&–÷2W'&÷#¢rÂR“°¢–b†ö²’²ö²ç7G–ÆRæ6öÆ÷"Òwf"‚Ò×&VB’s²ö²çFW‡D6öçFVçBÒtW'&÷"FR6öæW†œ;6ââs²Ğ¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò“¢5TäB$U5B(	B6ö×&ö&çFW2ÂFWVF2ÂEG0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BEôdåô$4RÒDT4Ä$e•ôdåô$4S° ¦7–æ2gVæ7F–öâGWF„fWF6‚‡W&ÂÂ÷F–öç2Ò·Ò’°¢–b‚FV6Æ&g”77&eFö¶Vâ’v—BFV6Æ&g”ÆöE6W76–öâ‚“°¢&WGW&âfWF6‚‡W&ÂÂ°¢ââæ÷F–öç2À¢7&VFVçF–Ç3¢w6ÖRÖ÷&–v–ârÀ¢†VFW'3¢°¢t66WBs¢vÆ–6F–öâö§6öârÀ¢t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÀ¢u‚Õ&WVW7FVBÕv—F‚s¢tFV6Æ&g•vV"rÀ¢u‚Ô55$bÕFö¶Vâs¢FV6Æ&g”77&eFö¶VâÀ¢âââ†÷F–öç2æ†VFW'2ÇÂ·Ò¢Ğ¢Ò“°§Ğ ¦7–æ2gVæ7F–öâG6öç7VÇF7VæB‡F—ò’°¢ÆWB'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fU'V2r“òçfÇVSòçG&–Ò‚“°¢ÆWBF&vWD–BÒw7VæDÆ—fU&W7VÇBs°¢–b‡F—òÓÓÒvFWVF2r’°¢'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDFWVF5'V2r“òçfÇVSòçG&–Ò‚’ÇÂ'V3°¢F&vWD–BÒw7VæDFWVF5&W7VÇBs°¢ÒVÇ6R–b‡F—òÓÓÒwGBr’°¢'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæEGE'V2r“òçfÇVSòçG&–Ò‚’ÇÂ'V3°¢F&vWD–BÒw7VæEGE&W7VÇBs°¢Ğ¢–b‚'V2ÇÂ'V2æÆVæwF‚ÓÒ’²GFö7B‚t–æw&W6Vâ%T2l:Æ–FòFRL:Öv—F÷2ârÂwv&âr“²&WGW&ã²Ğ¢6öç7B&W7VÇDVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‡F&vWD–B“°¢–b‚&W7VÇDVÂ’&WGW&ã°¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇDVÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#ï	ùHB6öç7VÇFæFò5TäBââãÂöF—câs°¢G'’°¢6öç7B&6¶VæEF—òÒF—òÓÓÒvFWVF2ròvFWVFr¢F—òÓÓÒwGBròwGBr¢w'V2s°¢6öç7BFFÒv—BFV6Æ&g”’‚v6öç7VÇF7VæF6ö×&ö&çFW2rÂ²&öG“¢²'V2ÂF—ó¢&6¶VæEF—òÒÒ“°¢&VæFW%7VæE&W7VÇB†FFÇÂ·ÒÂF—òÂF&vWD–B“°¢Ò6F6‚†R’°¢&W7VÇDVÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#äW'&÷#¢G·6fT…DÔÂ†RæÖW76vR—ÓÂöF—cæ°¢Ğ§Ğ ¦gVæ7F–öâ&VæFW%7VæE&W7VÇB†FFÂF—òÂF&vWD–B’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‡F&vWD–BÇÂw7VæDÆ—fU&W7VÇBr“°¢6öç7BW62ÒfÇVRÓâöW66T‡FÖÂ…7G&–ær‡fÇVRóòrr’“°¢–b‚VÂ’&WGW&ã°¢–b‡F—òÓÓÒvFWVF2r’°¢6öç7BFWVF2ÒFFæFWVF2ÇÂFFæFFÇÂµÓ°¢–b‚'&’æ—4'&’†FWVF2’ÇÂFWVF2æÆVæwF‚’²VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#äÆgVVçFR6öç7VÇFFæò&W÷'L;2FWVF2â6öæf—&ÖVÂ&W7VÇFFòVâ5TäB÷W&6–öæW2VâÌ:ÖæVãÂöF—câs²&WGW&ã²Ğ¢VÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚Ò×&VB“¶Ö&v–âÖ&÷GFöÓ£‡‚#î)ªûˆòG¶FWVF2æÆVæwF‡ÒFWVF‡2’Væ6öçG&F‡2“ÂöF—cæ°¢FWVF2æÖ†BÓâÆF—b7G–ÆSÒ&&6¶w&÷VæC§&v&ƒ#3ÃSrÃsÂã‚“¶&÷&FW#£‚6öÆ–B&v&ƒ#3ÃSrÃsÂã"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£ƒ¶Ö&v–âÖ&÷GFöÓ£‡ƒ¶föçB×6—¦S£G‚#à¢ÆF—cãÇ7G&öæsâG¶W62†Bæ6öEG&–'WFòÇÂBæ6öF–vòÇÂtâôr—ÓÂ÷7G&öæsâ(	BG¶W62†BæFW67&—6–öâÇÂBæFW62ÇÂrr—ÓÂöF—cà¢ÆF—cäÖöçFó¢2òG´çVÖ&W"†BæÖöçFòÇÂBæFWVFÇÂ’çFôf—†VBƒ"—ÒÂW&–öFó¢G¶W62†BçW&–öFòÇÂBæf—66Å÷W&–öBÇÂtâôr—ÓÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°¢ÒVÇ6R–b‡F—òÓÓÒwGBr’°¢6öç7BGG2ÒFFçGG2ÇÂFFæFFÇÂµÓ°¢–b‚'&’æ—4'&’‡GG2’ÇÂGG2æÆVæwF‚’²VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#äÆgVVçFR6öç7VÇFFæò&W÷'L;2EBâ6öæf—&ÖVÂ&W7VÇFFòVâ5TäB÷W&6–öæW2VâÌ:ÖæVãÂöF—câs²&WGW&ã²Ğ¢VÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#¢34ƒddc¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	ù8BEG2Væ6öçG&F÷3ÂöF—cæ°¢GG2æÖ‡ÓâÆF—b7G–ÆSÒ&&6¶w&÷VæC§&v&ƒS‚Ã3BÃ#SRÂãr“¶&÷&FW#£‚6öÆ–B&v&ƒS‚Ã3BÃ#SRÂã"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£ƒ¶Ö&v–âÖ&÷GFöÓ£‡ƒ¶föçB×6—¦S£G‚#à¢ÆF—cãÇ7G&öæsâG¶W62‡æf÷&×VÆ&–òÇÂæ6öF–vòÇÂtâôr—ÓÂ÷7G&öæsâ(	BG¶W62‡æFW67&—6–öâÇÂçW&–öFòÇÂrr—ÓÂöF—cà¢ÆF—cäfV6†&W6VçF6œ;6ã¢G¶W62‡æfV6†&W6VçF6–öâÇÂæfV6†ÇÂtâôr—ÒÂW7FFó¢G¶W62‡æW7FFòÇÂtâôr—ÓÂöF—cà¢ÂöF—cæ’æ¦ö–â‚rr“°¢ÒVÇ6R–b‡F—òÓÓÒv7Rr’°¢6öç7B—FV×2ÒFFæ6ö×&ö&çFW2ÇÂFFæ—FV×2ÇÂFFæFFÇÂµÓ°¢–b‚'&’æ—4'&’†—FV×2’ÇÂ—FV×2æÆVæwF‚’°¢VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#äÆgVVçFR6öç7VÇFFæò&W÷'L;26ö×&ö&çFW2ãÂöF—câs°¢&WGW&ã°¢Ğ¢VÂæ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæB×&W7VÇB×F—FÆR#ä6ö×&ö&çFW2&W÷'FF÷2÷"5TäCÂöF—cãÆF—b6Æ73Ò'7VæBÖ7ÖÆ—7B#âG¶—FV×2ç6Æ–6RƒÂS’æÖ†—FVÒÓâ°¢6öç7BçVÖW&òÒ—FVÒæçVÖW&òÇÂ—FVÒç6W&–TçVÖW&òÇÂ—FVÒæ6ö×&ö&çFRÇÂtâôs°¢6öç7BfV6†Ò—FVÒæfV6†ÇÂ—FVÒæfV6†VÖ—6–öâÇÂtâôs°¢6öç7BÖöçFòÒçVÖ&W"†—FVÒæÖöçFòÇÂ—FVÒçF÷FÂÇÂ“°¢6öç7BW7FFòÒ—FVÒæW7FFòÇÂtâôs°¢&WGW&âÆF—b6Æ73Ò'7VæBÖ7Ö—FVÒ#ãÇ7ãâG¶W62†çVÖW&ò—ÓÂ÷7ããÇ7ãâG¶W62†fV6†—ÓÂ÷7ããÇ7ãå2òG¶ÖöçFòçFôf—†VBƒ"—ÓÂ÷7ããÇ7ãâG¶W62†W7FFò—ÓÂ÷7ããÂöF—cæ°¢Ò’æ¦ö–â‚rr—ÓÂöF—cæ°¢ÒVÇ6R°¢VÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ã‚#à¢ÆF—cãÇ7G&öæså&¬;6â6ö6–Ã£Â÷7G&öæsâG¶W62†FFç&¦öå6ö6–ÂÇÂFFææöÖ'&Uöõ÷&¦öå÷6ö6–ÂÇÂtâôr—ÓÂöF—cà¢ÆF—cãÇ7G&öæså%T3£Â÷7G&öæsâG¶W62†FFç'V2ÇÂFFæçVÖW&ôFö7VÖVçFòÇÂFFæçVÖW&õöFö7VÖVçFòÇÂtâôr—ÓÂöF—cà¢ÆF—cãÇ7G&öæsäW7FFó£Â÷7G&öæsâÇ7â7G–ÆSÒ&6öÆ÷#¢Gµ7G&–ær†FFæW7FFòÇÂrr’çFõWW$66R‚’ÓÓÒt5D•dòròwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’wÒ#âG¶W62†FFæW7FFòÇÂtâôr—ÓÂ÷7ããÂöF—cà¢ÆF—cãÇ7G&öæsä6öæF–6œ;6ã£Â÷7G&öæsâG¶W62†FFæ6öæF–6–öâÇÂtâôr—ÓÂöF—cà¢ÆF—cãÇ7G&öæsäF—&V66œ;6ã£Â÷7G&öæsâG¶W62†FFæF—&V66–öâÇÂFFæFöÖ–6–Æ–ôf—66ÂÇÂtâôr—ÓÂöF—cà¢ÆF—cãÇ7G&öæsåF—ó£Â÷7G&öæsâG¶W62†FFçF—ô6öçG&–'W–VçFRÇÂFFçF—òÇÂtâôr—ÓÂöF—cà¢ÆF—cãÇ7G&öæsä7F—f–FC£Â÷7G&öæsâG¶W62†FFæ7F—f–FDW‡FW&–÷"ÇÂFFæv—&ôæVvö6–òÇÂtâôr—ÓÂöF—cà¢ÂöF—cæ°¢Ğ§Ğ ¦7–æ2gVæ7F–öâG6öç7VÇF'V5&–F‚’°¢6öç7B'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7VæDÆ—fU'V2r“òçfÇVSòçG&–Ò‚“°¢–b‚'V2ÇÂ'V2æÆVæwF‚ÓÒ’²GFö7B‚t–æw&W6Vâ%T2l:Æ–FòârÂwv&âr“²&WGW&ã²Ğ¢G6öç7VÇF7VæB‚v6ö×&ö&çFRr“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò“¢$5"(	BF—÷2FR6Ö&–ğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦7–æ2gVæ7F–öâG6öç7VÇF$5"‚’°¢6öç7B&W7VÇDVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v&7%&W7VÇBr“°¢–b‚&W7VÇDVÂ’&WGW&ã°¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇDVÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#ï	ùHB6öç7VÇFæFò$5%ââãÂöF—câs°¢G'’°¢6öç7BFFÒv—BFV6Æ&g”’‚v6öç7VÇF&7'F—÷66Ö&–òrÂ²ÖWF†öC¢ttUBrÒ“°¢&VæFW$$5%&W7VÇB†FF“°¢Ò6F6‚†R’°¢&W7VÇDVÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#äW'&÷#¢GµöW66T‡FÖÂ†RæÖW76vR—ÓÂöF—cæ°¢Ğ§Ğ ¦gVæ7F–öâ&VæFW$$5%&W7VÇB†FF’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v&7%&W7VÇBr“°¢–b‚VÂ’&WGW&ã°¢6öç7B—FV×2ÒFFòæW7FF—7F–63òå³ÓòæFFÇÂFFòæFFÇÂµÓ°¢–b‚—FV×2æÆVæwF‚’²VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#å6–âFF÷2F—7öæ–&ÆW2ãÂöF—câs²&WGW&ã²Ğ¢VÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&föçB×6—¦S£G‚#à¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#åF—÷2FR6Ö&–ò(	B$5%ÂöF—cà¢G¶—FV×2ç6Æ–6RƒÂ’æÖ†BÓâÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãR’#à¢Ç7ãâGµöW66T‡FÖÂ†BæfV6†ÇÂBç6W&–RÇÂrr—ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB’#å2òG´çVÖ&W"†Bç&V6–òÇÂBçfÆ÷"ÇÂ’çFôf—†VBƒ2—ÓÂ÷7ãà¢ÂöF—cæ’æ¦ö–â‚rr—Ğ¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò“¢4%2(	BVç6–öæW2Â6VwW&÷2Â4ôd”DP¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦7–æ2gVæ7F–öâG6öç7VÇF4%2‡F—ò’°¢6öç7B&W7VÇDVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w6'4•&W7VÇBr“°¢–b‚&W7VÇDVÂ’&WGW&ã°¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢6öç7BÆ&VÂÒF—òÓÓÒwVç6–öæW2rÇÂF—òÓÓÒwVç6–öâròwVç6–öæW2r¢w6VwW&÷2s°¢&W7VÇDVÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ·FF–æs£'ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW"×&F—W3£‡ƒ¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#à¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖ&ÇVR“¶Ö&v–âÖ&÷GFöÓ£g‚#ä6öç7VÇFöf–6–Â4%2(	BGµöW66T‡FÖÂ†Æ&VÂ—ÓÂöF—cà¢Ç7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–ã£‚#äÆ4%2æòög&V6RW7FR&W7VÇFFò6öÖòVæ’;¦&Æ–6W7F&ÆRâ&Wf—F"Ö÷7G&"–æf÷&Ö6œ;6â–æ6ö×ÆWFÂ'&R7R÷'FÂöf–6–ÂãÂ÷à¢Æ6Æ73Ò&'"‡&VcÒ&‡GG3¢ò÷wwrç6'2ævö"çRò"F&vWCÒ%ö&Ææ²"&VÃÒ&æö÷VæW"æ÷&VfW'&W"#ä'&—"÷'FÂöf–6–Â4%2(isÂöà¢ÂöF—cæ°§Ğ ¦gVæ7F–öâ&VæFW%4%4•&W7VÇB†FFÂF—ò’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w6'4•&W7VÇBr“°¢–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ·FF–æs£ƒ¶&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW"×&F—W3£‡ƒ¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#à¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖ&ÇVR“¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	øúbFF÷24%2(	BGµöW66T‡FÖÂ‡F—ò—ÓÂöF—cà¢Ç&R7G–ÆSÒ'v†—FR×76S§&R×w&¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚Ò×FW‡B“¶Ö‚Ö†V–v‡C£3ƒ¶÷fW&fÆ÷r×“¦WFò#âGµöW66T‡FÖÂ„¥4ôâç7G&–æv–g’†FFÂçVÆÂÂ"’—ÓÂ÷&Sà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò“¢v†G4(	BÆW'F2FRfVæ6–Ö–VçF÷0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦7–æ2gVæ7F–öâG6VæEv†G4ÆW'B‡†öæRÂÖW76vR’°¢G'’°¢6öç7BÆW'G2Ò¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚wG÷v†G6öÆW'G2r’ÇÂuµÒr“°¢ÆW'G2çW6‚‡²†öæRÂÖW76vRÂ7FGW3¢wVæF–ærrÂ7&VFVDC¢FFRææ÷r‚’Ò“°¢·eWB‚wG÷v†G6öÆW'G2rÂÆW'G2Âwv†G6öÆW'G2r“°§&Vv—7FW$µe66÷R‚wv†G6öÆW'G2rÂ‚’ÓâwG÷v†G6öÆW'G2r“°¢GFö7B‚	ù;ÆW'FwV&FFâ6RVçf–,:7VæFò6R6öæf–wW&Rv†G4'W6–æW72’ârÂvö²r“°¢&WGW&â²ö³¢G'VRÓ°¢Ò6F6‚†R’°¢GFö7B‚tW'&÷#¢r²RæÖW76vRÂvW'"r“°¢&WGW&âçVÆÃ°¢Ğ§Ğ ¦7–æ2gVæ7F–öâG6öæf–uv†G4‚’°¢6öç7B†öæRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wv†G6†öæRr“òçfÇVSòçG&–Ò‚“°¢–b‚†öæR’²GFö7B‚t–æw&W6GRì;¦ÖW&òFRv†G4ârÂwv&âr“²&WGW&ã²Ğ¢6öç7B6ÆVâÒ†öæRç&WÆ6R‚õÄBörÂrr“°¢–b†6ÆVâæÆVæwF‚Â’’²GFö7B‚tì;¦ÖW&ò–çl:Æ–FòâV¦V×Æó¢““#C““SBrÂwv&âr“²&WGW&ã²Ğ¢G'’°¢·eWB‚wG÷v†G6÷†öæRrÂ†öæRÂwv†G6÷†öæRr“°¢·eWB‚wG÷v†G6öVæ&ÆVBrÂw6’rÂwv†G6öVæ&ÆVBr“°¢&Vv—7FW$µe66÷R‚wv†G6÷†öæRrÂ‚’ÓâwG÷v†G6÷†öæRr“°¢&Vv—7FW$µe66÷R‚wv†G6öVæ&ÆVBrÂ‚’ÓâwG÷v†G6öVæ&ÆVBr“°¢6öç7B'FâÒFö7VÖVçBçVW'•6VÆV7F÷"‚u¶öæ6Æ–6²£Ò'G6öæf–uv†G4%Òr“°¢–b†'Fâ’²'FâçFW‡D6öçFVçBÒ~)ÈR6öæf–wW&Fòs²'Fâç7G–ÆRæ&6¶w&÷VæBÒwf"‚ÒÖw&VVâ’s²Ğ¢GFö7B‚u&VfW&Væ6–wV&FFâVÂVçl:Öò6R†&–Æ—F,:7VæFò6R6öæV7FRv†G4'W6–æW72’ârÂvö²r“°¢Ò6F6‚†R’°¢GFö7B‚tW'&÷#¢r²RæÖW76vRÂvW'"r“°¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò“¢W‡÷'F"55bõ6†VWG0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦7–æ2gVæ7F–öâGW‡÷'EFô55b‡F—FÆRÂFFÂ6öÇVÖç2’°¢–b‚FFÇÂFFæÆVæwF‚’²GFö7B‚tæò†’FF÷2&W‡÷'F"ârÂwv&âr“²&WGW&ã²Ğ¢6öç7B†VFW'2Ò6öÇVÖç2ÇÂö&¦V7Bæ¶W—2†FF³Ò“°¢6öç7B77e&÷w2Ò¶†VFW'2æ¦ö–â‚rÂr•Ó°¢f÷"†6öç7B&÷röbFF’°¢77e&÷w2çW6‚††VFW'2æÖ†‚Óâ"Gµ7G&–ær‡&÷u¶…ÒÇÂrr’ç&WÆ6R‚ò"örÂr""r—Ò&’æ¦ö–â‚rÂr’“°¢Ğ¢6öç7B77bÒ77e&÷w2æ¦ö–â‚uÆâr“°¢6öç7B&Æö"ÒæWr&Æö"…²uÇVfVfbr²77eÒÂ²G—S¢wFW‡Bö77c¶6†'6WC×WFbÓƒ²rÒ“°¢6öç7BW&ÂÒU$Âæ7&VFTö&¦V7EU$Â†&Æö"“°¢6öç7BÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vr“°¢æ‡&VbÒW&Ã²æF÷væÆöBÒG·F—FÆRÇÂvW‡÷'BwÕòG¶æWrFFR‚’çFô•4õ7G&–ær‚’ç7Æ—B‚uBr•³×Òæ77f°¢æ6Æ–6²‚“²U$Âç&Wfö¶Tö&¦V7EU$Â‡W&Â“°¢òò6fRW‡÷'B†—7F÷'’Æö6ÆÇ¢–b†7W%W6W"’°¢6öç7BW‡÷'G2Ò¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚wGöW‡÷'G2r’ÇÂuµÒr“°¢W‡÷'G2çW6‚‡²F—FÆRÂFFS¢æWrFFR‚’çFô•4õ7G&–ær‚’Â&÷w3¢FFæÆVæwF‚Ò“°¢·eWB‚wGöW‡÷'G2rÂW‡÷'G2ÂvW‡÷'G2r“°¢Ğ§&Vv—7FW$µe66÷R‚vW‡÷'G2rÂ‚’ÓâwGöW‡÷'G2r“°¢GFö7B‚	ù8¢&6†—fò55bFW66&vFòârÂvö²r“°§Ğ ¦7–æ2gVæ7F–öâGW‡÷'F$†—7F÷&–Â‚’°¢–b‚7W%W6W"’&WGW&ã°¢6öç7B‚ÒvWD†—7B†7W%W6W"æVÖ–Â“°¢–b‚‚æÆVæwF‚’²GFö7B‚tæò†’†—7F÷&–Â&W‡÷'F"ârÂwv&âr“²&WGW&ã²Ğ¢6öç7BFFÒ‚æÖ†2Óâ‡°¢F—GVÆó¢2çF—FÆRÇÂrrÀ¢fV6†¢2æFFRÇÂrrÀ¢&V¢2æ&VÇÂrrÀ¢ÖVç6¦W3¢†2æÖW76vW2ÇÂµÒ’æÆVæwF‚À¢&–ÖW$ÖVç6¦S¢†2æÖW76vW3òå³Óòæ6öçFVçBÇÂrr’ç7V'7G&–ærƒÂ¢Ò’“°¢GW‡÷'EFô55b‚v†—7F÷&–ÅöFV6Æ&g’rÂFF“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò“¢”ÇFW&æF—f„÷Vä’òFVW6VV²¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦7–æ2gVæ7F–öâ6ÆÄÇFW&æF—fT’‡&÷f–FW"ÂÖW76vW2Â7—7FVÒ’°¢G'’°¢&WGW&âv—BFV6Æ&g”’‚v6ÆÆÇFW&æF—fV’rÂ²&öG“¢²&÷f–FW"ÂÖW76vW2Â7—7FVÒÂÖ…÷Fö¶Vç3¢#C‚ÒÒ“°¢Ò6F6‚†R’°¢&WGW&â²W'&÷#¢RæÖW76vRÇÂtVÂ&÷fVVF÷"FR”ÇFW&æF—fæòW7L:F—7öæ–&ÆRârÓ°¢Ğ§Ğ ¦7–æ2gVæ7F–öâ6VæD×6tFVW6VV²‚’°¢6öç7B–çÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW6W$–çWBr“°¢6öç7B×6rÒ–çòçfÇVSòçG&–Ò‚“°¢6öç7B&÷f–FW"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v•&÷f–FW"r“òçfÇVRÇÂvFVW6VV²s°¢–b‚×6r’&WGW&ã°¢–b‚7W%W6W"ÇÂ‚—4FÖ–åW6W"‚’bb7W%ÆâÓÓÒv&6–6òr’’°¢GFö7B‚t”ÇFW&æF—fF—7öæ–&ÆR&ÆæW2&öfW6–öæÂôV×&W6ârÂwv&âr“²&WGW&ã°¢Ğ¢–ççfÇVRÒrs°¢–çç7G–ÆRæ†V–v‡BÒvWFòs°¢FD×6r‚wW6W"rÂ×6r“°¢6†÷uG—‚“°¢6öç7B&W7VÇBÒv—B6ÆÄÇFW&æF—fT’‡&÷f–FW"Â°¢²&öÆS¢wW6W"rÂ6öçFVçC¢×6r²„$T5¶7W$&VÒòÆå¼8&V¢G´$T5¶7W$&VÒæÆ&VÇÕÖ¢rr’Ğ¢ÒÂ5•2“°¢&VÕG—‚“°¢6öç7BFW‡BÒ&W7VÇBæ6öçFVçCòå³ÓòçFW‡BÇÂ&W7VÇBæW'&÷"ÇÂu6–â&W7VW7Fs°¢FD×6r‚v’rÂFW‡B“°¢6öçd†—7BçW6‚‡²&öÆS¢v76—7FçBrÂ6öçFVçC¢FW‡BÒ“°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòâÄ•T”D4œ94âDRì94Ô”ä¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7BD45ôeÒ²w&–Ös¢ã3BÂw&ögWGW&òs¢ã#ƒrÂv–çFVw&s¢ã#3Âv†&—FBs¢ã#2Ó°¦6öç7BD45ôôåÒ²sSs¢ã2Âscs¢ãÓ° ¦gVæ7F–öâ6Æ4æöÖ–æ‚’°¢6öç7B''WFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væöÔ''WFòr“òçfÇVR’ÇÂ°¢6öç7BF–2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væöÔF–2r“òçfÇVR’ÇÂ3°¢6öç7B&öæòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væöÔ&öæòr“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væöÕ&W7VÇBr“°¢–b‚&÷‚ÇÂ''WFò’&WGW&ã° ¢6öç7B&VÔ''WFòÒ''WFò²&öæó°¢6öç7B&VÔF–&–Ò&VÔ''WFòò3°¢6öç7B&VÕ&÷÷&6–öæÂÒ&VÔF–&–¢F–3° ¢òòW56ÇVBW2÷'FRFVÂV×ÆVF÷#²æò6RFW67VVçFÂG&&¦F÷"à¢6öç7BW76ÇVBÒ&VÕ&÷÷&6–öæÂ¢ã“°¢òò&VfW&Væ6–&Wf—6–öæÃ²ÆF6eW†7FFWVæFRFReö6öÖ—6œ;6â÷6VwW&òà¢6öç7BgÒ&VÕ&÷÷&6–öæÂ¢ã3°¢6öç7BæWFòÒ&VÕ&÷÷&6–öæÂÒg°¢6öç7B6÷7EF÷FÂÒ&VÕ&÷÷&6–öæÂ²W76ÇVC° ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#"#äÆ—V–F6œ;6âFRì;6Ö–æ(	B2óÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCå&V×VæW&6œ;6â''WFÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG·&VÔ''WFòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCâ²&öæ–f–66–öæW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶&öæòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæså&VÒâ&÷÷&6–öæÂ‚G¶F–7ÒL:Ö2“Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òG·&VÕ&÷÷&6–öæÂçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#î(‰"÷'FR&Wf—6–öæÂ&VfW&Væ6–Â‡ã2R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òG¶gçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäW56ÇVB’R†V×ÆVF÷"“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶W76ÇVBçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#äæWFòçFW2FR•"WFÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ“¶föçB×6—¦S£g‚#å2òG¶æWFòçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsä6÷7FòF÷FÂV×&W6Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖvöÆB’#ãÇ7G&öæså2òG¶6÷7EF÷FÂçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢Â÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äW7F–Ö6œ;6â,:6–6¢6VÆV66–öæVÂ6—7FVÖ&Wf—6–öæÂ’W6Æ&÷–V66œ;6âçVÂ6ö×ÆWF&6Æ7VÆ"Væ&WFVæ6œ;6âFRV–çF6FVv÷,:Ö&VÂãÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò"âÔõ$25Tä@¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ4Ö÷&2‚’°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷&ÖöçFòr“òçfÇVR’ÇÂ°¢6öç7BefVâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷&fV6†fVâr“òçfÇVS°¢6öç7BevòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷&fV6†vòr“òçfÇVS°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷&&W7VÇBr“°¢–b‚&÷‚ÇÂÖöçFòÇÂefVâÇÂevò’&WGW&ã° ¢6öç7BCÒæWrFFR†efVâ’ÂC"ÒæWrFFR†evò“°¢6öç7BF–2ÒÖF‚æfÆö÷"‚†C"ÒC’òƒcC“°¢–b‚çVÖ&W"æ—4f–æ—FR†F–2’’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢–b†F–2ÃÒ’²&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s²&÷‚æ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#î)ÈRæò†’Ö÷&âÆfV6†FRvòW2çFW&–÷"ÂfVæ6–Ö–VçFòãÂöF—câs²&WGW&ã²Ğ¢6öç7B–çFW&W7BÒÖöçFò¢…D…õ%TÄU2çF–ÔF–Ç•W&6VçBò’¢F–3°¢6öç7BF÷FÂÒÖöçFò²–çFW&W7C° ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#""7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#ä–çFW,:—2Ö÷&F÷&–ò&VfW&Væ6–ÃÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCäÖöçFò÷&–v–æÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶ÖöçFòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäL:Ö2FRÖ÷&Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG¶F–7ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#â²D”Ò‚GµD…õ%TÄU2çF–ÔF–Ç•W&6VçGÒRF–&–ò“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òG¶–çFW&W7BçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#äFWVFÜ:2–çFW,:—3Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£g‚#å2òG·F÷FÂçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äæò6Rw&VvVæ×VÇFWFöÜ:F–6¢7R–×÷'FRFWVæFRFRÆ–æg&66œ;6âÂ,:–v–ÖVâFRw&GVÆ–FB’fV6†Æ–6&ÆRâ6öæf—&ÖVÂfÆ÷"f–æÂVâ5TäBãÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò2â4ÄTäD$”òd•44À¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ46ÆVæF&–ôf—66Â‚’°¢6öç7B'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å'V2r“òçfÇVSòçG&–Ò‚“°¢6öç7B&Vv–ÖVâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å&Vv–ÖVâr“òçfÇVRÇÂw&×Bs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ÆVæF&–õ&W7VÇBr“°¢–b‚&÷‚ÇÂõåÆG³ÒBòçFW7B‡'V2ÇÂrr’’&WGW&ã°¢6öç7Bö&Æ–vF–öç2Ò°¢&×C¢²t”ubõ&VçFÖVç7VÂrÂuvò7VVçFFVÂ•"rÂtFV6Æ&6œ;6âçVÂ7VæFò6÷'&W7öæFuÒÀ¢&s¢²t”ubõ&VçFÖVç7VÂrÂuvò7VVçFFVÂ•"rÂtFV6Æ&6œ;6âçVÂ7VæFò6÷'&W7öæFuÒÀ¢&W#¢²t”ubõ&VçFÖVç7VÂuÒÀ¢ç'W3¢²t7V÷FÖVç7VÂå%U2uÒÀ¢Õ·&Vv–ÖVåÒÇÂµÓ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	ù8Rö&Æ–v6–öæW2†&—GVÆW2(	B%T2GµöW66T‡FÖÂ‡'V2—ÓÂöF—cà¢ÇVÃâG¶ö&Æ–vF–öç2æÖ†—FVÒÓâÆÆ“âG¶—FV×ÓÂöÆ“æ’æ¦ö–â‚rr—ÓÂ÷VÃà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äFV6Æ&e’æò–çfVçFVæfV6†'F—"FVÂ;¦ÇF–ÖòL:Öv—FòâÆ÷2fVæ6–Ö–VçF÷26Ö&–â÷"W,:ÖöFò’7&öæöw&Ööf–6–Ã²fW&–f–6ÆfV6†W†7FVâ5TäBçFW2FRv"òFV6Æ&"ãÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòBâ”Õõ%D4œ94âòU…õ%D4œ94à¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ4–×÷'F6–öâ‚’°¢6öç7B6–bÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–×6–br“òçfÇVR’ÇÂ°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–×D2r“òçfÇVR’ÇÂ°¢6öç7B&æ6VÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–×&æ6VÂr“òçfÇVR’ÇÂ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–×F—òr“òçfÇVRÇÂvvVæW&Âs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–×&W7VÇBr“°¢–b‚&÷‚ÇÂ6–bÇÂF2’&WGW&ã° ¢6öç7B6–e6öÆW2Ò6–b¢F3° ¢òòFW&V6†òGfÆ÷&VĞ¢6öç7BGfÆ÷&VÒÒ6–e6öÆW2¢†&æ6VÂò“° ¢òò”ub²•Ó¢‚R6ö'&RÆ&6R6–×Æ–f–6F–æw&W6Fà¢6öç7B&6T–wbÒ6–e6öÆW2²GfÆ÷&VÓ°¢6öç7B–wd—ÒÒ&6T–wb¢ãƒ°¢6öç7BF÷FÅG&–'WF÷2ÒGfÆ÷&VÒ²–wd—Ó° ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	ùª"6÷7F÷2FR–×÷'F6œ;6â(	BG·F—÷ÓÂöF—cà¢ÇF&ÆSà¢ÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#äÖöçFóÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCåfÆ÷"4”cÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#åU4BG¶6–bçFôÆö6ÆU7G&–ær‚—Ò…2òG¶6–e6öÆW2çFôf—†VBƒ"—Ò“Â÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#äFW&V6†òGfÆ÷&VÒ‚G¶&æ6VÇÒR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òG¶GfÆ÷&VÒçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#ä”ub²•Òƒ‚R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òG¶–wd—ÒçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#åF÷FÂG&–'WF÷3Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#å2òG·F÷FÅG&–'WF÷2çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äW7F–Ö6œ;6â6–×Æ–f–6Fâæò–æ6ÇW–R•42ÂW&6W6œ;6âÂFW&V6†÷2çF–GV×–ærÂFW76†òÂG&ç7÷'FRÂ6VwW&òÂÆÖ6Væ¦Ræ’÷G&÷26&v÷2VR&WV–W&VâÆ7V''F–F’Fö7VÖVçF÷2&VÆW2ãÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòRâ4TÄT5Dõ"DR,8”t”ÔTà¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ5&Vv–ÖVâ‚’°¢6öç7B–æw&W6÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Vt–æw&W6÷2r“òçfÇVR’ÇÂ°¢6öç7Bv7F÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Vtv7F÷2r“òçfÇVR’ÇÂ°¢6öç7BG&"Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VuG&"r“òçfÇVR’ÇÂ°¢6öç7B7F—f–FBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&Vt7F—f–FBr“òçfÇVRÇÂw6W'f–6–÷2s°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&Vv–ÖVå&W7VÇBr“°¢–b‚&÷‚ÇÂ–æw&W6÷2’&WGW&ã° ¢6öç7BWF–Æ–FBÒÖF‚æÖ‚ƒÂ–æw&W6÷2Òv7F÷2“°¢6öç7BV—BÒD…õ%TÄU2çV—EµD…õ%TÄU2æ7W'&VçE–V%Ó°¢6öç7B&×D–×VW7FòÒÖF‚æÖ–â‡WF–Æ–FBÂR¢V—B’¢ã²ÖF‚æÖ‚ƒÂWF–Æ–FBÒR¢V—B’¢ã#“S°¢6öç7B&t–×VW7FòÒWF–Æ–FB¢ã#“S°¢6öç7B&W$–×VW7FòÒ–æw&W6÷2¢ãS°¢6öç7Bç'W4ÖöçF†Ç”fW&vRÒ–æw&W6÷2ò#°¢6öç7Bç'W4çVÂÒ†ç'W4ÖöçF†Ç”fW&vRÃÒSò#¢ç'W4ÖöçF†Ç”fW&vRÃÒƒòS¢æâ’¢#° ¢6öç7B&Vv–ÖVæW2Ò°¢²æöÖ'&S¢u$ÕBrÂ–×VW7Fó¢&×D–×VW7FòÂVÆ–v–&ÆS¢–æw&W6÷2ÃÒs¢V—BÂFW67&—6–öã¢t•"çVÂ6ö'&RÆ&VçFæWFârÂ&WV—6—F÷3¢t–æw&W6÷2(šBÃsT•BrÂ6öÆ÷#¢r3$T43srÒÀ¢²æöÖ'&S¢u$U"rÂ–×VW7Fó¢&W$–×VW7FòÂVÆ–v–&ÆS¢–æw&W6÷2ÃÒS#SÂFW67&—6–öã¢uvòFVf–æ—F—fòFRãRRFR–æw&W6÷2ârÂ&WV—6—F÷3¢t–æw&W6÷2’6ö×&2(šB2óS#RÃ²&Wf—6"W†6ÇW6–öæW2rÂ6öÆ÷#¢r34ƒddbrÒÀ¢²æöÖ'&S¢u$rrÂ–×VW7Fó¢&t–×VW7FòÂVÆ–v–&ÆS¢G'VRÂFW67&—6–öã¢t•"çVÂ6ö'&RÆ&VçFæWFârÂ&WV—6—F÷3¢u6–âÌ:ÖÖ—FRFR–æw&W6÷2rÂ6öÆ÷#¢r4S„#rÒÀ¢²æöÖ'&S¢tå%U2rÂ–×VW7Fó¢ç'W4çVÂÂVÆ–v–&ÆS¢çVÖ&W"æ—4f–æ—FR†ç'W4çVÂ’bbG&"ÓÓÒÂFW67&—6–öã¢t7V÷FÖVç7VÂ6V|;¦â6FVv÷,:ÖârÂ&WV—6—F÷3¢t†7F2ó‚ÃÖVç7VÆW3²&Wf—6"W†6ÇW6–öæW2rÂ6öÆ÷#¢r3”#S”#brĞ¢Òæf–ÇFW"†—FVÒÓâ—FVÒæVÆ–v–&ÆR“° ¢&Vv–ÖVæW2ç6÷'B‚†Â"’Óâæ–×VW7FòÒ"æ–×VW7Fò“°¢6öç7BÖV¦÷"Ò&Vv–ÖVæW5³Ó° ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	øêò6ö×&F—fFR&V|:ÖÖVæW2G&–'WF&–÷3ÂöF—cà¢ÇF&ÆSà¢ÇG#ãÇFƒå,:–v–ÖVãÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ä–×VW7FòçVÃÂ÷FƒãÇFƒå&WV—6—F÷3Â÷FƒãÂ÷G#à¢G·&Vv–ÖVæW2æÖ‡"ÓâÇG"7G–ÆSÒ"G·"ææöÖ'&RÓÓÒÖV¦÷"ææöÖ'&Ròv&6¶w&÷VæC§&v&ƒCbÃ#BÃ2Âã‚’r¢rwÒ#à¢ÇFCãÇ7â7G–ÆSÒ&6öÆ÷#¢G·"æ6öÆ÷'Ó¶föçB×vV–v‡C£c#âG·"ææöÖ'&WÓÂ÷7ãâG·"ææöÖ'&RÓÓÒÖV¦÷"ææöÖ'&Rò~*Ùr¢rwÓÂ÷FCà¢ÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£S#å2òG·"æ–×VW7FòçFôf—†VBƒ"—ÓÂ÷FCà¢ÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âG·"ç&WV—6—F÷7ÓÂ÷FCà¢Â÷G#æ’æ¦ö–â‚rr—Ğ¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FF–æs£'ƒ¶&6¶w&÷VæC§&v&ƒCbÃ#BÃ2Âã‚“¶&÷&FW#£‚6öÆ–B&v&ƒCbÃ#BÃ2Âã#R“¶&÷&FW"×&F—W3£‡‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#äÖVæ÷"•"W7F–ÖFó¢G¶ÖV¦÷"ææöÖ'&WÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£G‚#âG¶ÖV¦÷"æFW67&—6–öçÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶Ö&v–â×F÷£G‚#äF–fW&Væ6–&VfW&Væ6–Âg&VçFRÂÖ–÷"&W7VÇFFó¢Ç7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#å2òG²‡&Vv–ÖVæW5·&Vv–ÖVæW2æÆVæwF‚ÒÒæ–×VW7FòÒÖV¦÷"æ–×VW7Fò’çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#â¢æòW2Væ&V6öÖVæF6œ;6âFR6Ö&–òFR,:–v–ÖVââÆVÆVv–&–Æ–FBFWVæFRFÖ&œ:–âFR7F—f–FBÂ6ö×&2Â7F—f÷2Â6ö×&ö&çFW2’W†6ÇW6–öæW2ãÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòbâtTäU$Dõ"DREG0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ5EB‚’°¢6öç7B'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGE'V2r“òçfÇVSòçG&–Ò‚“°¢6öç7BW&–öFòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGDvVåW&–öFòr“òçfÇVS°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGEF—òr“òçfÇVRÇÂsc#s°¢6öç7B&Vv–ÖVâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGDvVå&Vv–ÖVâr“òçfÇVRÇÂw&×Bs°¢6öç7B–æw&W6÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGD–æw&W6÷2r“òçfÇVR’ÇÂ°¢6öç7Bv7F÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGDv7F÷2r“òçfÇVR’ÇÂ°¢6öç7B–wevFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGD–wevFòr“òçfÇVR’ÇÂ°¢6öç7B–wd6ö'&FòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wGD–wd6ö'&Fòr“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wGE&W7VÇBr“°¢–b‚&÷‚ÇÂ'V2ÇÂ'V2æÆVæwF‚ÓÒÇÂ–æw&W6÷2’&WGW&ã° ¢ÆWB6öçFVæ–FòÒrs°¢ÆWBfÆ–F6–öæW2ÒµÓ°¢ÆWBW'&÷&W2Ò° ¢–b‡F—òÓÓÒsc#r’°¢6öç7B&VçFÒÖF‚æÖ‚ƒÂ–æw&W6÷2Òv7F÷2“°¢6öç7B–wdæWFòÒ–wd6ö'&FòÒ–wevFó°¢6öç7B–wefVçF2Ò–æw&W6÷2¢ãƒ°¢6öç7B–wd6ö×&2Òv7F÷2¢ãƒ° ¢fÆ–F6–öæW2çW6‚‡²6†V6³¢'V2æÆVæwF‚ÓÓÒÂ×6s¢u%T2l:Æ–FòƒL:Öv—F÷2’rÒ“°¢fÆ–F6–öæW2çW6‚‡²6†V6³¢–wd6ö'&FòâÂ×6s¢t”ub6ö'&FòFV6Æ&FòrÒ“°¢fÆ–F6–öæW2çW6‚‡²6†V6³¢–wevFòâÂ×6s¢t”ubvFòFV6Æ&FòrÒ“°¢fÆ–F6–öæW2çW6‚‡²6†V6³¢ÖF‚æ'2†–wdæWFòÒ†–wefVçF2Ò–wd6ö×&2’’ÂÂ×6s¢t”ubæWFò6öç6—7FVçFRrÒ“° ¢6öçFVæ–FòÒÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#"#åEBc#(	BFV6Æ&6œ;6âÖVç7VÂG·W&–öF÷ÓÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCå%T3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG·'V7ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå,:–v–ÖVãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG·&Vv–ÖVâçFõWW$66R‚—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsä5TE$òÂ÷7G&öæsâ(	BfVçF2w&fF3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶–æw&W6÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä”ubfVçF2ƒ‚R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶–wefVçF2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsä5TE$ò#Â÷7G&öæsâ(	B6ö×&2w&fF3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶v7F÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä”ub6ö×&2ƒ‚R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶–wd6ö×&2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsä7VG&òsÂ÷7G&öæsâ(	B”ubv#Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#¢G¶–wdæWFòâòwf"‚Ò×&VB’r¢wf"‚ÒÖw&VVâ’wÒ#å2òG¶–wdæWFòçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢Â÷F&ÆSæ°¢ÒVÇ6R–b‡F—òÓÓÒsc#"r’°¢6öç7B&VçFçVÂÒÖF‚æÖ‚ƒÂ–æw&W6÷2Òv7F÷2“°¢6öç7BV—BÒD…õ%TÄU2çV—EµD…õ%TÄU2æ7W'&VçE–V%Ó°¢6öç7B–×&VçFÒ&Vv–ÖVâÓÓÒw&×Bp¢òÖF‚æÖ–â‡&VçFçVÂÂR¢V—B’¢ã²ÖF‚æÖ‚ƒÂ&VçFçVÂÒR¢V—B’¢ã#“P¢¢&VçFçVÂ¢ã#“S° ¢fÆ–F6–öæW2çW6‚‡²6†V6³¢'V2æÆVæwF‚ÓÓÒÂ×6s¢u%T2l:Æ–FòrÒ“°¢fÆ–F6–öæW2çW6‚‡²6†V6³¢&VçFçVÂâÂ×6s¢uWF–Æ–FB÷6—F—frÒ“° ¢6öçFVæ–FòÒÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#"#åEBc#"(	BFV6Æ&6œ;6âçVÂG¶æWrFFR‚’ævWDgVÆÅ–V"‚’ÒÓÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCå%T3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG·'V7ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä–æw&W6÷2æWF÷2çVÆW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶–æw&W6÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä6÷7F÷2’v7F÷3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶v7F÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæså&VçFæWFÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òG·&VçFçVÂçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsä–×VW7FòÆ&VçFÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#å2òG¶–×&VçFçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äVÂ6ÆFòf–æÂ&WV–W&Rv÷27VVçFÂ7,:–F—F÷2Â:—&F–F2’F–6–öæW2öFVGV66–öæW2&VÆW2ãÂ÷FCãÂ÷G#à¢Â÷F&ÆSæ°¢ÒVÇ6R°¢òòEBCÒå%U0¢6öç7B7V÷FÒ&Vv–ÖVâÓÓÒvç'W2rò†–æw&W6÷2ÃÒSò#¢–æw&W6÷2ÃÒƒòS¢’¢°¢fÆ–F6–öæW2çW6‚‡²6†V6³¢–æw&W6÷2ÃÒƒÂ×6s¢t–æw&W6÷2ÖVç7VÆW2FVçG&òFVÂÌ:ÖÖ—FRå%U2rÒ“° ¢6öçFVæ–FòÒÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#"#åEBC(	Bå%U2G·W&–öF÷ÓÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCå%T3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG·'V7ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä–æw&W6÷2FVÂÖW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶–æw&W6÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä7V÷FÖVç7VÂå%U3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òG¶7V÷FçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsä7V÷Fv#Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB“¶föçB×6—¦S£W‚#å2òG¶7V÷FçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢Â÷F&ÆSæ°¢Ğ ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢G¶6öçFVæ–F÷Ğ¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FF–æs£ƒ¶&6¶w&÷VæC¢G·fÆ–F6–öæW2æWfW'’‡bÓâbæ6†V6²’òw&v&ƒCbÃ#BÃ2Âã‚’r¢w&v&ƒ#3ÃSrÃsÂã‚’wÓ¶&÷&FW#£‚6öÆ–BG·fÆ–F6–öæW2æWfW'’‡bÓâbæ6†V6²’òw&v&ƒCbÃ#BÃ2Âã#R’r¢w&v&ƒ#3ÃSrÃsÂã#R’wÓ¶&÷&FW"×&F—W3£‡‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶Ö&v–âÖ&÷GFöÓ£g‚#åfÆ–F6–öæW3£ÂöF—cà¢G·fÆ–F6–öæW2æÖ‡bÓâÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢G·bæ6†V6²òwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’wÒ#âG·bæ6†V6²ò~)ÈRr¢~)ØÂwÒG·bæ×6wÓÂöF—cæ’æ¦ö–â‚rr—Ğ¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#â¢f—7F&Wf–÷&–VçFF—f²æòvVæW&æ’&W6VçFVâEBâfW&–f–6Æ÷2–×÷'FW2’FV6Æ&W†6ÇW6—fÖVçFRVâ5TäB÷W&6–öæW2VâÌ:ÖæVãÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòrâ44õ$Rd”ää4”U$ğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ566÷&Tf–â‚’°¢6öç7B7F—fòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6d7F—fòr“òçfÇVR’ÇÂ°¢6öç7B6—fòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6e6—fòr“òçfÇVR’ÇÂ°¢6öç7BG&–Ööæ–òÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6eG&–Ööæ–òr“òçfÇVR’ÇÂ°¢6öç7B–æw&W6÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6d–æw&W6÷2r“òçfÇVR’ÇÂ°¢6öç7BWF–Æ–FBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6eWF–Æ–FBr“òçfÇVR’ÇÂ°¢6öç7BFWVFÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6dFWVFr“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w66÷&U&W7VÇBr“°¢–b‚&÷‚ÇÂ7F—fò’&WGW&ã° ¢òò–æF–6F÷&W0¢6öç7BÆ—V–FW¢Ò7F—fòò6—fó°¢6öç7B6öÇfVæ6–ÒG&–Ööæ–òò7F—fó°¢6öç7B&VçF&–Æ–FBÒWF–Æ–FBò–æw&W6÷3°¢6öç7BÆæ6Ö–VçFòÒ6—fòò7F—fó°¢6öç7B&öRÒG&–Ööæ–òâòWF–Æ–FBòG&–Ööæ–ò¢°¢6öç7B&öÒ7F—fòâòWF–Æ–FBò7F—fò¢°¢6öç7BVæFWVFÖ–VçFòÒ7F—fòâòFWVFò7F—fò¢° ¢òò66÷&–ærƒÓ¢ÆWB66÷&RÒ°¢–b†Æ—V–FW¢ãÒãR’66÷&R³Ò#²VÇ6R–b†Æ—V–FW¢ãÒ’66÷&R³ÒS²VÇ6R–b†Æ—V–FW¢ãÒã‚’66÷&R³Òƒ°¢–b‡6öÇfVæ6–ãÒãR’66÷&R³Ò#²VÇ6R–b‡6öÇfVæ6–ãÒã2’66÷&R³ÒS²VÇ6R–b‡6öÇfVæ6–ãÒãR’66÷&R³Òƒ°¢–b‡&VçF&–Æ–FBãÒãR’66÷&R³Ò#²VÇ6R–b‡&VçF&–Æ–FBãÒã‚’66÷&R³ÒS²VÇ6R–b‡&VçF&–Æ–FBãÒã2’66÷&R³Òƒ°¢–b‡&öRãÒã#’66÷&R³ÒS²VÇ6R–b‡&öRãÒã’66÷&R³Ò²VÇ6R–b‡&öRãÒãR’66÷&R³ÒS°¢–b†VæFWVFÖ–VçFòÃÒã2’66÷&R³ÒS²VÇ6R–b†VæFWVFÖ–VçFòÃÒãR’66÷&R³Ò²VÇ6R–b†VæFWVFÖ–VçFòÃÒãr’66÷&R³ÒS° ¢ÆWBæ—fVÂÂ6öÆ÷"ÂVÖö¦’Â&V6öÖVæF6–öæW2ÒµÓ°¢–b‡66÷&RãÒsR’²æ—fVÂÒtU„4TÄTåDRs²6öÆ÷"Òr3$T43ss²VÖö¦’Ò	ùú"s²Ğ¢VÇ6R–b‡66÷&RãÒSR’²æ—fVÂÒt%TTäòs²6öÆ÷"Òr34ƒddbs²VÖö¦’Ò	ùKRs²Ğ¢VÇ6R–b‡66÷&RãÒ3R’²æ—fVÂÒu$TuTÄ"s²6öÆ÷"Òr4S„#s²VÖö¦’Ò	ùús²Ğ¢VÇ6R²æ—fVÂÒt5,8ÕD”4òs²6öÆ÷"Òr4Sc3“Cbs²VÖö¦’Ò	ùKBs²Ğ ¢–b†Æ—V–FW¢Â’&V6öÖVæF6–öæW2çW6‚‚~)ªGRÆ—V–FW¢W2–ç7Vf–6–VçFRâ6öç6–FW&&VGV6—"6—f÷2FR6÷'FòÆ¦òâr“°¢–b‡6öÇfVæ6–Âã2’&V6öÖVæF6–öæW2çW6‚‚	ù8’6öÇfVæ6–&¦âVÖVçF6—FÂ&÷–òò&VGV6RFWVFâr“°¢–b‡&VçF&–Æ–FBÂãR’&V6öÖVæF6–öæW2çW6‚‚	ù+&VçF&–Æ–FB&¦â&Wf—66÷7F÷2÷W&F—f÷2’&–6–ærâr“°¢–b†VæFWVFÖ–VçFòâãR’&V6öÖVæF6–öæW2çW6‚‚	øúbÇFòVæFWVFÖ–VçFòâ6öç6–FW&&Vf–ææ6–"òÖ÷'F—¦"FWVFâr“°¢–b‡&V6öÖVæF6–öæW2æÆVæwF‚ÓÓÒ’&V6öÖVæF6–öæW2çW6‚‚~)ÈRGRV×&W6F–VæR6ÇVBf–ææ6–W&<;6Æ–Fâr“° ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£'‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£3gƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢G¶6öÆ÷'Ò#âG·66÷&WÒóÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#¢G¶6öÆ÷'Ò#âG¶VÖö¦—ÒG¶æ—fVÇÓÂöF—cà¢ÂöF—cà¢ÇF&ÆSà¢ÇG#ãÇFƒä–æF–6F÷#Â÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#åfÆ÷#Â÷FƒãÇFƒäF–vì;77F–6óÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCäÆ—V–FW¢vVæW&ÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG¶Æ—V–FW¢çFôf—†VBƒ"—ÓÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢G¶Æ—V–FW¢ãÒòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’wÒ#âG¶Æ—V–FW¢ãÒãRòtW†6VÆVçFRr¢Æ—V–FW¢ãÒòtFV7VFr¢tFVf–6–VçFRwÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå6öÇfVæ6–Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG²‡6öÇfVæ6–¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢G·6öÇfVæ6–ãÒã2òwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’wÒ#âG·6öÇfVæ6–ãÒãRòu<;6Æ–Fr¢6öÇfVæ6–ãÒã2òt6WF&ÆRr¢tL:–&–ÂwÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå$ôSÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG²‡&öR¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢G·&öRãÒãòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’wÒ#âG·&öRãÒã"òtÇFr¢&öRãÒãòtÖVF–r¢t&¦wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå$ôÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG²‡&ö¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£G‚#âG·&öãÒã‚òt'VVær¢&öãÒã2òt6WF&ÆRr¢t&¦wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäVæFWVFÖ–VçFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG²†VæFWVFÖ–VçFò¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢G¶VæFWVFÖ–VçFòÃÒãRòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’wÒ#âG¶VæFWVFÖ–VçFòÃÒã2òt&¦òr¢VæFWVFÖ–VçFòÃÒãRòtÖöFW&Fòr¢tÇFòwÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäÖ&vVâæWFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âG²‡&VçF&–Æ–FB¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£G‚#âG·&VçF&–Æ–FBãÒãòu6ÇVF&ÆRr¢&VçF&–Æ–FBãÒã2òt6WF&ÆRr¢t&¦òwÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FF–æs£'ƒ¶&6¶w&÷VæC§&v&ƒS‚Ã3BÃ#SRÂãb“¶&÷&FW#£‚6öÆ–B&v&ƒS‚Ã3BÃ#SRÂã"“¶&÷&FW"×&F—W3£‡‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#¢34ƒddc¶Ö&v–âÖ&÷GFöÓ£g‚#å&V6öÖVæF6–öæW3£ÂöF—cà¢G·&V6öÖVæF6–öæW2æÖ‡"ÓâÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£G‚#âG·'ÓÂöF—cæ’æ¦ö–â‚rr—Ğ¢ÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò‚â$D"äõ$ÔD•dğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦6öç7B$D%ôDDÒ°¢7VæC¢°¢²fV6†¢t§VÂ##brÂF—GVÆó¢tçVWfò7&öæöw&ÖfVæ6–Ö–VçFòEBc#rÂ&W7VÖVã¢t§W7FRVâfV6†2FRfVæ6–Ö–VçFò&6öçG&–'W–VçFW26öâ%T2FW&Ö–æF÷2VârÓ‚Ó’ÓârÂ–×7Fó¢vÖVF–òrÒÀ¢²fV6†¢t§Vâ##brÂF—GVÆó¢tÖöF–f–66œ;6âEU5TäBrÂ&W7VÖVã¢tçVWf2F&–f2’&ö6VF–Ö–VçF÷2VâVÂFW‡Fò9¦æ–6ò&ö6VF–Ö–VçF÷2FÖ–æ—7G&F—f÷25TäBârÂ–×7Fó¢v&¦òrÒÀ¢²fV6†¢t§Vâ##brÂF—GVÆó¢t7GVÆ—¦6œ;6âÆ—7FFR&V6–÷2FRG&ç6fW&Væ6–rÂ&W7VÖVã¢uV&Æ–66œ;6âFRçVWf÷2&æv÷2&÷W&6–öæW2f–æ7VÆF26öâ7V¦WF÷2FVÂW‡FW&–÷"ârÂ–×7Fó¢vÇFòrÒÀ¢²fV6†¢tÖ’##brÂF—GVÆó¢u&W6öÇV6œ;6â5TäB(	BfÆ–F6œ;6â5RrÂ&W7VÖVã¢tçVWf÷2&WV—6—F÷2FRfÆ–F6œ;6âFR6ö×&ö&çFW2FRvòVÆV7G,;6æ–6÷2ârÂ–×7Fó¢vÖVF–òrĞ¢ÒÀ¢6'3¢°¢²fV6†¢t§VÂ##brÂF—GVÆó¢t7GVÆ—¦6œ;6âD”Ò(	BF6FR–çFW,:—2Ö÷&F÷&–rÂ&W7VÖVã¢tÆF6–çFW,:—2Ö÷&F÷&–7V&Rã3RÖVç7VÂ&VÂÖW2FR§VÆ–òârÂ–×7Fó¢vÖVF–òrÒÀ¢²fV6†¢t§Vâ##brÂF—GVÆó¢tçVWf&W6öÇV6œ;6âVæ6¦R&æ6&–òrÂ&W7VÖVã¢t§W7FRFVÂVæ6¦RÜ:Öæ–ÖòÆVvÂFVÂbãRÂbãRR&FW;76—F÷2Æ¦òârÂ–×7Fó¢vÇFòrÒÀ¢²fV6†¢tÖ’##brÂF—GVÆó¢t6—&7VÆ"4%2(	B6VwW&÷2ö&Æ–vF÷&–÷2rÂ&W7VÖVã¢t7GVÆ—¦6œ;6âFR&–Ö2Ü:Öæ–Ö2&6VwW&÷2FRf–F’G&–Ööæ–ÆW2ârÂ–×7Fó¢v&¦òrĞ¢ÒÀ¢ÖVc¢°¢²fV6†¢t§VÂ##brÂF—GVÆó¢tçVWfò&W7WVW7Fò;¦&Æ–6ò##bÓ##rrÂ&W7VÖVã¢t&ö&6œ;6âFVÂÖ&6òÖ7&òÇW&–çVÂFRv7Fò&VÂW&–öFò##bÓ##rârÂ–×7Fó¢vÇFòrÒÀ¢²fV6†¢t§Vâ##brÂF—GVÆó¢t7GVÆ—¦6œ;6âT•B##brÂ&W7VÖVã¢uT•B##b6Rf–¦Vâ2òRÃs‡&÷–V66œ;6â’â–×7F×VÇF2ÂFVGV66–öæW2’Ì:ÖÖ—FW2ârÂ–×7Fó¢vÇFòrÒÀ¢²fV6†¢tÖ’##brÂF—GVÆó¢tÆW’FR6–×Æ–f–66œ;6âG&–'WF&–rÂ&W7VÖVã¢tçVWf2ÖVF–F2FR6–×Æ–f–66œ;6â&Õ•U3¢&VGV66œ;6âFRf÷&×VÆ&–÷2ârÂ–×7Fó¢vÖVF–òrĞ¢Ğ§Ó° ¦ÆWB$D%ôäõ$Õôã„âÒµÓ°¦gVæ7F–öâÆöE&F$æ÷&Ò†gVVçFR’°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&F%&W7VÇBr“°¢–b‚&÷‚’&WGW&ã° ¢6öç7B&VæFW$—FV×2Ò‚’Óâ°¢ÆWB—FV×2ÒµÓ°¢–b†gVVçFRÓÓÒvÆÂr’°¢—FV×2Ò²âââ…$D%ôDDç7VæBÇÂµÒ’Ââââ…$D%ôDDç6'2ÇÂµÒ’Ââââ…$D%ôDDæÖVbÇÂµÒ’Âââå$D%ôäõ$Õôã„åÓ°¢—FV×2ç6÷'B‚†Â"’ÓâæWrFFR†"æfV6†’ÒæWrFFR†æfV6†’“°¢ÒVÇ6R–b†gVVçFRÓÓÒvVÇW'Væòr’°¢—FV×2Ò²ââå$D%ôäõ$Õôã„åÓ°¢ÒVÇ6R°¢—FV×2Ò$D%ôDD¶gVVçFUÒÇÂµÓ°¢Ğ ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒ—FV×2æÖ†—FVÒÓâ°¢6öç7B–×7Fô6öÆ÷"Ò—FVÒæ–×7FòÓÓÒvÇFòròwf"‚Ò×&VB’r¢—FVÒæ–×7FòÓÓÒvÖVF–òròwf"‚ÒÖvöÆB’r¢wf"‚ÒÖw&VVâ’s°¢6öç7B–×7Fô&rÒ—FVÒæ–×7FòÓÓÒvÇFòròw&v&ƒ#3ÃSrÃsÂã‚’r¢—FVÒæ–×7FòÓÓÒvÖVF–òròw&v&ƒ#3"ÃcÃ3"Âã‚’r¢w&v&ƒCbÃ#BÃ2Âã‚’s°¢6öç7BF—GVÆòÒöW66T‡FÖÂ†—FVÒçF—GVÆò“°¢6öç7BF—GVÆô‡FÖÂÒ—FVÒæÆ–æ°¢òÆ‡&VcÒ"GµöW66T‡FÖÂ†—FVÒæÆ–æ²—Ò"F&vWCÒ%ö&Ææ²"&VÃÒ&æö÷VæW"#âG·F—GVÆ÷Ò(isÂöæ ¢¢F—GVÆó°¢&WGW&âÆF—b7G–ÆSÒ&&6¶w&÷VæC¢G¶–×7Fô&wÓ¶&÷&FW#£‚6öÆ–BG¶–×7Fô6öÆ÷'Ó33¶&÷&FW"×&F—W3£ƒ·FF–æs£Gƒ¶Ö&v–âÖ&÷GFöÓ£‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£g‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£c#âG·F—GVÆô‡FÖÇÓÂöF—cà¢Ç7â7G–ÆSÒ&föçB×6—¦S£Gƒ·FF–æs£'‚‡ƒ¶&6¶w&÷VæC¢G¶–×7Fô6öÆ÷'Ó##¶6öÆ÷#¢G¶–×7Fô6öÆ÷'Ó¶&÷&FW"×&F—W3£'ƒ¶föçB×vV–v‡C£S#âG¶—FVÒæ–×7FòçFõWW$66R‚—ÓÂ÷7ãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–âÖ&÷GFöÓ£G‚#âG¶—FVÒæfV6†ÓÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ãb#âGµöW66T‡FÖÂ†—FVÒç&W7VÖVâ—ÓÂöF—cà¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr“°¢Ó° ¢&VæFW$—FV×2‚“° ¢òòæ÷&Ö2FWFV7FF2WFöÜ:F–6ÖVçFR÷"ã†â(i"6öÆV66œ;6â&F%öæ÷&ÖF—fò‡6öÆòÆV7GW&¢–b‚$D%ôäõ$Õôã„âæÆVæwF‚bbG—Vöbf$F"ÓÒwVæFVf–æVBrbbG—Vöbf%&VG’ÓÒwVæFVf–æVBrbbf%&VG’’°¢f$F"æ6öÆÆV7F–öâ‚w&F%öæ÷&ÖF—fòr’æ÷&FW$'’‚v7&VFVDBrÂvFW62r’æÆ–Ö—Bƒ#R’ævWB‚¢çF†Vâ‡6æÓâ°¢6ææf÷$V6‚†BÓâ°¢6öç7BâÒBæFF‚“°¢$D%ôäõ$Õôã„âçW6‚‡²F—GVÆó¢âçF—GVÆòÂ&W7VÖVã¢âç&W7VÖVâÂfV6†¢âæfV6†Â–×7Fó¢âæ–×7FòÇÂvÖVF–òrÂÆ–æ³¢âæÆ–æ²ÇÂrrÒ“°¢Ò“°¢–b…$D%ôäõ$Õôã„âæÆVæwF‚’&VæFW$—FV×2‚“°¢Ò¢æ6F6‚†RÓâ6öç6öÆRçv&â‚w&F%öæ÷&ÖF—fòÆöC¢rÂRæÖW76vR’“°¢Ğ§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòâ$Ää4RDR4ôÕ$ô$4”ôà¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦ÆWB7VVçF4$2ÒµÓ°¦gVæ7F–öâFD7VVçF&÷r†6öF–vòÂæöÖ'&RÂFV&RÂ†&W"’°¢7VVçF4$2çW6‚‡²6öF–vó¢6öF–vòÇÂrrÂæöÖ'&S¢æöÖ'&RÇÂrrÂFV&S¢FV&RÇÂÂ†&W#¢†&W"ÇÂÒ“°¢&VæFW$7VVçF5F&ÆR‚“°§Ğ¦gVæ7F–öâFD7VVçF&W6WB‡F—ò’°¢6öç7B&W6WG2Ò°¢6¦¢²6öF–vó¢srÂæöÖ'&S¢t6¦rÂFV&S¢SÒÀ¢&æ6÷3¢²6öF–vó¢sBrÂæöÖ'&S¢t&æ6÷2rÂFV&S¢#ÒÀ¢fVçF3¢²6öF–vó¢ssrÂæöÖ'&S¢ufVçF2æ6–öæÆW2rÂ†&W#¢#SÒÀ¢6ö×&3¢²6öF–vó¢scrÂæöÖ'&S¢tÖW&6FW&–2rÂFV&S¢ƒĞ¢Ó°¢6öç7BÒ&W6WG5·F—õÓ°¢–b‡’FD7VVçF&÷r‡æ6öF–vòÂææöÖ'&RÂæFV&RÇÂÂæ†&W"ÇÂ“°§Ğ¦gVæ7F–öâ&VÖ÷fT7VVçF&÷r†’’²7VVçF4$2ç7Æ–6R†’Â“²&VæFW$7VVçF5F&ÆR‚“²Ğ¦gVæ7F–öâ&VæFW$7VVçF5F&ÆR‚’°¢6öç7BF&öG’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7VVçF4&öG’r“°¢–b‚F&öG’’&WGW&ã°¢F&öG’æ–ææW$…DÔÂÒ7VVçF4$2æÖ‚†2Â’’ÓâsÇG"7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãR’#âr°¢sÇFB7G–ÆSÒ'FF–æs£G‚#ãÆ–çWBfÇVSÒ"r²2æ6öF–vò²r"öæ6†ævSÒ&7VVçF4$5²r²’²uÒæ6öF–vó×F†—2çfÇVR"7G–ÆSÒ&&6¶w&÷VæC§f"‚ÒÖF&³2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£Gƒ·v–GFƒ£cƒ¶föçB×6—¦S£G‚#ãÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£G‚#ãÆ–çWBfÇVSÒ"r²2ææöÖ'&R²r"öæ6†ævSÒ&7VVçF4$5²r²’²uÒææöÖ'&S×F†—2çfÇVR"7G–ÆSÒ&&6¶w&÷VæC§f"‚ÒÖF&³2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£Gƒ·v–GFƒ£#ƒ¶föçB×6—¦S£G‚#ãÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£G‚#ãÆ–çWBG—SÒ&çVÖ&W""fÇVSÒ"r²†2æFV&WÇÃ’²r"öæ6†ævSÒ&7VVçF4$5²r²’²uÒæFV&S×'6TfÆöB‡F†—2çfÇVR—ÇÃ"7G–ÆSÒ&&6¶w&÷VæC§f"‚ÒÖF&³2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£Gƒ·v–GFƒ£“ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×6—¦S£G‚#ãÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£G‚#ãÆ–çWBG—SÒ&çVÖ&W""fÇVSÒ"r²†2æ†&W'ÇÃ’²r"öæ6†ævSÒ&7VVçF4$5²r²’²uÒæ†&W#×'6TfÆöB‡F†—2çfÇVR—ÇÃ"7G–ÆSÒ&&6¶w&÷VæC§f"‚ÒÖF&³2“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚Ò×FW‡B“·FF–æs£Gƒ·v–GFƒ£“ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×6—¦S£G‚#ãÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£G‚#ãÆ'WGFöâöæ6Æ–6³Ò'&VÖ÷fT7VVçF&÷r‚r²’²r’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×&VB“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£G‚#åƒÂö'WGFöããÂ÷FCâr°¢sÂ÷G#âr’æ¦ö–â‚rr“°§Ğ¦gVæ7F–öâvVä&Ææ6T6ö×‚’°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v&Å&W7VÇBr“°¢–b‚&÷‚ÇÂ7VVçF4$2æÆVæwF‚’&WGW&ã°¢ÆWBF÷FÄFV&RÒÂF÷FÄ†&W"Ò°¢6öç7B&÷w2Ò7VVçF4$2æÖ†gVæ7F–öâ†2’°¢f"BÒ2æFV&RÇÂÂ‚Ò2æ†&W"ÇÂ°¢f"6ÆFòÒBÒƒ°¢F÷FÄFV&R³ÒC²F÷FÄ†&W"³Òƒ°¢&WGW&âsÇG#ãÇFCâr²2æ6öF–vò²sÂ÷FCãÇFCâr²2ææöÖ'&R²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²BçFôf—†VBƒ"’²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²‚çFôf—†VBƒ"’²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢r²‡6ÆFòâòwf"‚Ò×&VB’r¢wf"‚ÒÖw&VVâ’r’²r#å2òr²ÖF‚æ'2‡6ÆFò’çFôf—†VBƒ"’²sÂ÷FCãÇFCâr²‡6ÆFòâòtFWVF÷"r¢t7&VVF÷"r’²sÂ÷FCãÂ÷G#âs°¢Ò’æ¦ö–â‚rr“°¢f"&Ææ6VFòÒÖF‚æ'2‡F÷FÄFV&RÒF÷FÄ†&W"’Âã°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#ä&Ææ6RFR6ö×&ö&6–öãÂöF—cãÇF&ÆSãÇG#ãÇFƒä6öF–vóÂ÷FƒãÇFƒä7VVçFÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#äFV&SÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ä†&W#Â÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å6ÆFóÂ÷FƒãÇFƒåF—óÂ÷FƒãÂ÷G#âr²&÷w2²sÇG"7G–ÆSÒ&föçB×vV–v‡C£c¶&÷&FW"×F÷£'‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇFB6öÇ7ãÒ#"#åDõDÄU3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²F÷FÄFV&RçFôf—†VBƒ"’²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²F÷FÄ†&W"çFôf—†VBƒ"’²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢r²†&Ææ6VFòòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#å2òr²ÖF‚æ'2‡F÷FÄFV&RÒF÷FÄ†&W"’çFôf—†VBƒ"’²sÂ÷FCãÇFCâr²†&Ææ6VFòòtô²r¢tFW67VG&Fòr’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòâÄ”%$òD”$”ğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y §f"6–VçF÷4ÄBÒµÓ°¦gVæ7F–öâFD6–VçFôÄB‚’°¢f"bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆDfV6†r’çfÇVS°¢f"rÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆDvÆ÷6r’çfÇVS°¢f"6BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆD7FFV&—Fòr’çfÇVS°¢f"ÖBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆDÖöçFôFV"r’çfÇVR’ÇÂ°¢f"62ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆD7F7&VF—Fòr’çfÇVS°¢f"Ö2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆDÖöçFô7&VBr’çfÇVR’ÇÂ°¢–b‚rÇÂ6BÇÂ62ÇÂÖB’&WGW&ã°¢6–VçF÷4ÄBçW6‚‡²fV6†¢bÂvÆ÷6¢rÂ7FFV#¢6BÂÖöçFôFV#¢ÖBÂ7F7&VC¢62ÂÖöçFô7&VC¢Ö2Ò“°¢&VæFW$6–VçF÷4ÄB‚“°§Ğ¦gVæ7F–öâ&VæFW$6–VçF÷4ÄB‚’°¢f"VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6–VçF÷4ÄBr“°¢–b‚VÂ’&WGW&ã°¢VÂæ–ææW$…DÔÂÒ6–VçF÷4ÄBæÖ†gVæ7F–öâ†Â’’°¢&WGW&âsÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚ÒÖF&³"“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£‡ƒ·FF–æs£ƒ¶Ö&v–âÖ&÷GFöÓ£‡ƒ¶föçB×6—¦S£G‚#ãÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVâ#ãÇ7G&öæsâr²æfV6†²sÂ÷7G&öæsâÆ'WGFöâöæ6Æ–6³Ò&6–VçF÷4ÄBç7Æ–6R‚r²’²rÃ“·&VæFW$6–VçF÷4ÄB‚’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×&VB“¶7W'6÷#§ö–çFW"#åƒÂö'WGFöããÂöF—cãÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–ã£G‚#âr²ævÆ÷6²sÂöF—cãÆF—cäFV&S¢r²æ7FFV"²rÒ2òr²æÖöçFôFV"çFôf—†VBƒ"’²sÂöF—cãÆF—cä†&W#¢r²æ7F7&VB²rÒ2òr²æÖöçFô7&VBçFôf—†VBƒ"’²sÂöF—cãÂöF—câs°¢Ò’æ¦ö–â‚rr“°§Ğ¦gVæ7F–öâvVäÆ–'&ôF–&–ò‚’°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆE&W7VÇBr“°¢–b‚&÷‚ÇÂ6–VçF÷4ÄBæÆVæwF‚’&WGW&ã°¢f"F÷FÄFV&RÒÂF÷FÄ†&W"Ò°¢f"&÷w2Ò6–VçF÷4ÄBæÖ†gVæ7F–öâ†’°¢F÷FÄFV&R³ÒæÖöçFôFV#²F÷FÄ†&W"³ÒæÖöçFô7&VC°¢&WGW&âsÇG#ãÇFCâr²æfV6†²sÂ÷FCãÇFCâr²ævÆ÷6²sÂ÷FCãÇFCâr²æ7FFV"²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²æÖöçFôFV"çFôf—†VBƒ"’²sÂ÷FCãÇFCâr²æ7F7&VB²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²æÖöçFô7&VBçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs°¢Ò’æ¦ö–â‚rr“°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#äÆ–'&òF–&–óÂöF—cãÇF&ÆSãÇG#ãÇFƒäfV6†Â÷FƒãÇFƒävÆ÷6Â÷FƒãÇFƒä7FFV&—FóÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òFV&—FóÂ÷FƒãÇFƒä7F7&VF—FóÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2ò7&VF—FóÂ÷FƒãÂ÷G#âr²&÷w2²sÇG"7G–ÆSÒ&föçB×vV–v‡C£c¶&÷&FW"×F÷£'‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇFB6öÇ7ãÒ#2#åDõDÄU3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²F÷FÄFV&RçFôf—†VBƒ"’²sÂ÷FCãÇFCãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²F÷FÄ†&W"çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#¢r²„ÖF‚æ'2‡F÷FÄFV&RÒF÷FÄ†&W"’Âãòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âr²„ÖF‚æ'2‡F÷FÄFV&RÒF÷FÄ†&W"’Âãòt6–VçF÷2&Ææ6VF÷2r¢tÆ÷26–VçF÷2äòW7Fâ&Ææ6VF÷2r’²sÂöF—cãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò"â4ôä4”Ä”4”ôâ$ä4$”¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ46öæ6–Â‚’°¢f"6ÆFô&æ6òÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6%6ÆFô&æ6òr’çfÇVR’ÇÂ°¢f"6ÆFôÆ–'&÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6%6ÆFôÆ–'&÷2r’çfÇVR’ÇÂ°¢f"FW÷6—EG&ç2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6$FW÷6—EG&ç2r’çfÇVR’ÇÂ°¢f"6†WVW5VâÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6$6†WVW5Vâr’çfÇVR’ÇÂ°¢f"6öÖ—6–öæW2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6$6öÖ—6–öæW2r’çfÇVR’ÇÂ°¢f"æ÷F47&VBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6$æ÷F47&VBr’çfÇVR’ÇÂ°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öæ6–Å&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢f"6ÆFô§W7FFô&æ6òÒ6ÆFô&æ6ò²FW÷6—EG&ç2Ò6†WVW5Vã°¢f"6ÆFô§W7FFôÆ–'&÷2Ò6ÆFôÆ–'&÷2²6öÖ—6–öæW2Òæ÷F47&VC°¢f"F–fW&Væ6–Ò6ÆFô§W7FFô&æ6òÒ6ÆFô§W7FFôÆ–'&÷3°¢f"6öæ6–Æ–FòÒÖF‚æ'2†F–fW&Væ6–’Âã°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#ä6öæ6–Æ–6–öâ&æ6&–ÂöF—cãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#""7G–ÆSÒ&6öÆ÷#¢34ƒddb#å6ÆFò6VwVâ&æ6óÂ÷FƒãÂ÷G#ãÇG#ãÇFCå6ÆFòW‡G&7FóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²6ÆFô&æ6òçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#â²FW÷6—F÷2VâG&ç6—FóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr²FW÷6—EG&ç2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âÒ6†WVW2VæF–VçFW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr²6†WVW5VâçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæså6ÆFò§W7FFò&æ6óÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òr²6ÆFô§W7FFô&æ6òçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#ãÇG#ãÇF‚6öÇ7ãÒ#""7G–ÆSÒ&6öÆ÷#¢3”#S”#b#å6ÆFò6VwVâÆ–'&÷3Â÷FƒãÂ÷G#ãÇG#ãÇFCå6ÆFòÆ–'&÷3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²6ÆFôÆ–'&÷2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#â²6öÖ—6–öæW2&æ6&–3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr²6öÖ—6–öæW2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#âÒæ÷F2FR7&VF—FóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr²æ÷F47&VBçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæså6ÆFò§W7FFòÆ–'&÷3Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òr²6ÆFô§W7FFôÆ–'&÷2çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öær7G–ÆSÒ&6öÆ÷#¢r²†6öæ6–Æ–Fòòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#äF–fW&Væ6–Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#¢r²†6öæ6–Æ–Fòòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²s¶föçB×6—¦S£g‚#å2òr²F–fW&Væ6–çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#¢r²†6öæ6–Æ–Fòòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âr²†6öæ6–Æ–Fòòt7VVçF6öæ6–Æ–Fr¢tÆ7VVçFäòW7F6öæ6–Æ–Fr’²sÂöF—cãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò2â5E2òu$D”d”44”ôäU2òUD”Ä”DDU0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6Æ4&VæVf–6–÷2‚’°¢f"''WFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v'4''WFòr’çfÇVR’ÇÂ°¢f"F–2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v'4F–2r’çfÇVR’ÇÂ3cS°¢f"F—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v'5F—òr’çfÇVRÇÂvÆÂs°¢f"WF–Æ–FDV×&W6Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v'5WF–Æ–FBr’çfÇVR’ÇÂ°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v'5&W7VÇBr“°¢–b‚&÷‚ÇÂ''WFò’&WGW&ã°¢f"&VÔF–&–Ò''WFòò3°¢f"ÖW6W45E2ÒÖF‚æÖ–â†F–2ò3Â"“°¢f"7G5&VÂÒ†''WFòò"’¢ÖW6W45E3°¢f"ÖW6W4w&BÒÖF‚æÖ–â†F–2ò3Âb“°¢f"w&F–f–66–öâÒ&VÔF–&–¢ƒòb’¢3¢†ÖW6W4w&Bòb“°¢f"F÷UWF–Æ–FBÒ''WFò¢ƒ°¢f"'F–6—6–öâÒÖF‚æÖ–â‡WF–Æ–FDV×&W6¢ãRÂF÷UWF–Æ–FB“°¢f"f66–öæW2Ò''WFó°¢f"6†÷rÒgVæ7F–öâ‡B’²&WGW&âF—òÓÓÒvÆÂrÇÂF—òÓÓÒC²Ó°¢f"‡FÖÂÒsÇF&ÆSãÇG#ãÇFƒä&VæVf–6–óÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#äÖöçFóÂ÷FƒãÇFƒä6Æ7VÆóÂ÷FƒãÂ÷G#âs°¢–b‡6†÷r‚v7G2r’’‡FÖÂ³ÒsÇG#ãÇFCä5E3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òr²7G5&VÂçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å&VÒâò"‚r²ÖW6W45E2çFôf—†VBƒ’²rÖW6W3Â÷FCãÂ÷G#âs°¢–b‡6†÷r‚vw&Br’’‡FÖÂ³ÒsÇG#ãÇFCäw&F–f–66–öãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òr²w&F–f–66–öâçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å&VÒâ‚ób‚r²†ÖW6W4w&Bób£’çFôf—†VBƒ’²rSÂ÷FCãÂ÷G#âs°¢–b‡6†÷r‚wWF–Âr’’‡FÖÂ³ÒsÇG#ãÇFCåWF–Æ–FFW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òr²'F–6—6–öâçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ãRRWF–Æ–FBV×&W6Â÷FCãÂ÷G#âs°¢–b‡6†÷r‚vÆÂr’’‡FÖÂ³ÒsÇG#ãÇFCåf66–öæW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæså2òr²f66–öæW2çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ã&VÒâÖVç7VÃÂ÷FCãÂ÷G#âs°¢f"F÷FÂÒ°¢–b‡6†÷r‚v7G2r’’F÷FÂ³Ò7G5&VÃ°¢–b‡6†÷r‚vw&Br’’F÷FÂ³Òw&F–f–66–öã°¢–b‡6†÷r‚wWF–Âr’’F÷FÂ³Ò'F–6—6–öã°¢–b‡6†÷r‚vÆÂr’’F÷FÂ³Òf66–öæW3°¢‡FÖÂ³ÒsÇG"7G–ÆSÒ&föçB×vV–v‡C£c¶&÷&FW"×F÷£'‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇFCåF÷FÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖvöÆB“¶föçB×6—¦S£W‚#å2òr²F÷FÂçFôf—†VBƒ"’²sÂ÷FCãÇFCãÂ÷FCãÂ÷G#ãÂ÷F&ÆSâs°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#âr²‡FÖÂ²sÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòBâtTäU$Dõ"DR4ôåE$Dõ0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâvVä6öçG&Fò‚’°¢f"F—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçEF—òr’çfÇVRÇÂvÆö66–öâs°¢f"'FTÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçE'FTr’çfÇVRÇÂuõõõõõõõõõõõõõõòs°¢f"'FT"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçE'FT"r’çfÇVRÇÂuõõõõõõõõõõõõõõòs°¢f"ÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçDÖöçFòr’çfÇVR’ÇÂ°¢f"GW&6–öâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçDGW&6–öâr’çfÇVRÇÂuõõõõõõòs°¢f"7F—f–FBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçD7F—f–FBr’çfÇVRÇÂuõõõõõõõõõõõõõõòs°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçE&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢f"F—÷2Ò²Æö66–öã¢t4ôåE$DòDRÄô44”ôâDR4U%d”4”õ2rÂG&&¦ó¢t4ôåE$DòDRE$$¤òrÂ&W7F6–öã¢t4ôåE$DòDR$U5D4”ôâDR4U%d”4”õ2rÂ6öÖöFFó¢t4ôåE$DòDR4ôÔôDDòrÂ'&VæFÖ–VçFó¢t4ôåE$DòDR%$TäDÔ”TåDòrÓ°¢f"†÷’ÒæWrFFR‚’çFôÆö6ÆTFFU7G&–ær‚vW2ÕRrÂ²–V#¢vçVÖW&–2rÂÖöçFƒ¢vÆöærrÂF“¢vçVÖW&–2rÒ“°¢f"6öçFVæ–FòÒrs°¢–b‡F—òÓÓÒvÆö66–öâr’°¢6öçFVæ–FòÒsÇãÇ7G&öæså$”ÔU$¢ô$¤UDòãÂ÷7G&öæsâÆ'FR"6Rö&Æ–v&W7F"6W'f–6–÷2FRr²öW66T‡FÖÂ†7F—f–FB’²rÆ'FRãÂ÷ãÇãÇ7G&öæså4TuTäD¢$TÕTäU$4”ôâãÂ÷7G&öæsâ2òr²ÖöçFòçFôf—†VBƒ"’²rÖVç7VÆW2ÂvFW&÷2FVçG&òFRÆ÷2&–ÖW&÷2RF–2†&–ÆW2ãÂ÷ãÇãÇ7G&öæsåDU$4U$¢Ä¤òãÂ÷7G&öæsâr²öW66T‡FÖÂ†GW&6–öâ’²rãÂ÷ãÇãÇ7G&öæsä5T%D¢4ôäd”DTä4”Ä”DBãÂ÷7G&öæsâÆ'FR"ÖçFVæG&W7G&–7F6öæf–FVæ6–Æ–FBãÂ÷ãÇãÇ7G&öæsåT”åD¢DU$Ô”ä4”ôâãÂ÷7G&öæsâ6öâ3F–2FRçF–6—6–öâ÷"7VÇV–W&FRÆ2'FW2ãÂ÷ãÇãÇ7G&öæså4U…D¢¥U$•4D”44”ôâãÂ÷7G&öæsâG&–'VæÆW2FRÆ–ÖãÂ÷âs°¢ÒVÇ6R–b‡F—òÓÓÒwG&&¦òr’°¢6öçFVæ–FòÒsÇãÇ7G&öæså$”ÔU$¢ô$¤UDòãÂ÷7G&öæsâgVæ6–öæW2FRr²öW66T‡FÖÂ†7F—f–FB’²rÂ&¦ò7V&÷&F–æ6–öâãÂ÷ãÇãÇ7G&öæså4TuTäD¢$TÕTäU$4”ôâãÂ÷7G&öæsâ2òr²ÖöçFòçFôf—†VBƒ"’²r''WFò²&VæVf–6–÷2FRÆW’ãÂ÷ãÇãÇ7G&öæsåDU$4U$¢$TäTd”4”õ2ãÂ÷7G&öæsâ5E2Âw&F–f–66–öæW2ÂWF–Æ–FFW2Âf66–öæW2„BâÆVrâs#‚’ãÂ÷ãÇãÇ7G&öæsä5T%D¢¤õ$äDãÂ÷7G&öæsâ‚†÷&2F–&–2ÂC‚6VÖæÆW2ãÂ÷ãÇãÇ7G&öæsåT”åD¢4U4RãÂ÷7G&öæsâ÷"6W62§W7F2'Bâ#2BâÆVrâs#‚ãÂ÷âs°¢ÒVÇ6R°¢6öçFVæ–FòÒsÇãÇ7G&öæså$”ÔU$¢ô$¤UDòãÂ÷7G&öæsâr²öW66T‡FÖÂ†7F—f–FB’²rãÂ÷ãÇãÇ7G&öæså4TuTäD¢$T4”òãÂ÷7G&öæsâ2òr²ÖöçFòçFôf—†VBƒ"’²rãÂ÷ãÇãÇ7G&öæsåDU$4U$¢Ä¤òãÂ÷7G&öæsâr²öW66T‡FÖÂ†GW&6–öâ’²rãÂ÷ãÇãÇ7G&öæsä5T%D¢ÄU’Ä”4$ÄRãÂ÷7G&öæsâÆW–W2FRÆ&WV&Æ–6FVÂW'RãÂ÷âs°¢Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB"7G–ÆSÒ&föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ã‚#ãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£g‚#ãÆF—b7G–ÆSÒ&föçB×6—¦S£gƒ¶föçB×vV–v‡C£s#âr²F—÷5·F—õÒ²sÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âr²†÷’²sÂöF—cãÂöF—cãÇãÇ7G&öæsä4ôåE$DåDS£Â÷7G&öæsâr²öW66T‡FÖÂ‡'FT’²sÂ÷ãÇãÇ7G&öæsä4ôåE$D•5D£Â÷7G&öæsâr²öW66T‡FÖÂ‡'FT"’²sÂ÷ãÆF—b7G–ÆSÒ&Ö&v–â×F÷£'‚#âr²6öçFVæ–Fò²sÂöF—cãÆF—b7G–ÆSÒ&Ö&v–â×F÷£#Gƒ¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&÷VæB#ãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW"#ãÆF—b7G–ÆSÒ&&÷&FW"×F÷£‚6öÆ–Bf"‚Ò×FW‡B“·v–GFƒ£#ƒ·FF–ær×F÷£Gƒ¶föçB×6—¦S£G‚#ãÇ7G&öæsâr²öW66T‡FÖÂ‡'FT’²sÂ÷7G&öæsãÆ'#ä6öçG&FçFSÂöF—cãÂöF—cãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW"#ãÆF—b7G–ÆSÒ&&÷&FW"×F÷£‚6öÆ–Bf"‚Ò×FW‡B“·v–GFƒ£#ƒ·FF–ær×F÷£Gƒ¶föçB×6—¦S£G‚#ãÇ7G&öæsâr²öW66T‡FÖÂ‡'FT"’²sÂ÷7G&öæsãÆ'#ä6öçG&F—7FÂöF—cãÂöF—cãÂöF—cãÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#â¢&÷'&F÷"Ò&Wf—6"6öâ&övFòçFW2FRf—&Ö"ãÂöF—cãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòRâDô5TÔTåDõ2ÄTtÄU0¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâvVäFö4ÆVvÂ‡F—ò’°¢f"æöÖ'&RÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFÄæöÖ'&Rr’çfÇVRÇÂuõõõõõõõõõõõõõõòs°¢f"'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFÅ'V2r’çfÇVRÇÂuõõõõõõõõõõõõõõòs°¢f"&W6öÇV6–öâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFÅ&W6öÇV6–öâr’çfÇVRÇÂuõõõõõõõõõõõõõõòs°¢f"ÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFÄÖöçFòr’çfÇVR’ÇÂ°¢f"†V6†÷2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFÄ†V6†÷2r’çfÇVRÇÂuõõõõõõõõõõõõõõòs°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFÅ&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢f"†÷’ÒæWrFFR‚’çFôÆö6ÆTFFU7G&–ær‚vW2ÕRrÂ²–V#¢vçVÖW&–2rÂÖöçFƒ¢vÆöærrÂF“¢vçVÖW&–2rÒ“°¢f"F—GVÆ÷2Ò²6'F¢t4%DäõD$”ÂrÂVÆ6–öã¢u$T5U%4òDRTÄ4”ôârÂ&V6ÆÖ6–öã¢u$T4ÄÔ4”ôârÂ6öç7VÇF¢t4ôå5TÅD$Ud”rÓ°¢f"VçF–FFW2Ò²6'F¢tV–Vâ6÷'&W7öæFrÂVÆ6–öã¢uG&–'VæÂf—66ÂrÂ&V6ÆÖ6–öã¢u5TäBrÂ6öç7VÇF¢u5TäBÒDtBrÓ°¢f"6öçFVæ–FòÒrs°¢–b‡F—òÓÓÒvVÆ6–öâr’°¢6öçFVæ–FòÒsÇãÇ7G&öæsä’â„T4„õ3£Â÷7G&öæsãÂ÷ãÇâr²öW66T‡FÖÂ††V6†÷2’²sÂ÷ãÇãÇ7G&öæsä”’âeTäDÔTåDó£Â÷7G&öæsãÂ÷ãÇä'Bâ#rETò6öF–vòG&–'WF&–ò„Bå2â32Ó#2ÔTb’ãÂ÷ãÇãÇ7G&öæsä””’âUD•Dõ$”ó£Â÷7G&öæsãÂ÷ãÇäFV6Æ&"”äeTäDDÆ&W6öÇV6–öâr²öW66T‡FÖÂ‡&W6öÇV6–öâ’²r’çVÆ–FBFR2òr²ÖöçFòçFôf—†VBƒ"’²rãÂ÷âs°¢ÒVÇ6R–b‡F—òÓÓÒw&V6ÆÖ6–öâr’°¢6öçFVæ–FòÒsÇãÇ7G&öæsä’â„T4„õ3£Â÷7G&öæsãÂ÷ãÇâr²öW66T‡FÖÂ††V6†÷2’²sÂ÷ãÇãÇ7G&öæsä”’âeTäDÔTåDó£Â÷7G&öæsãÂ÷ãÇä'BârETò6öF–vòG&–'WF&–òâÆ¦ó¢#F–2†&–ÆW2ãÂ÷âs°¢ÒVÇ6R–b‡F—òÓÓÒv6öç7VÇFr’°¢6öçFVæ–FòÒsÇãÇ7G&öæsä„T4„õ3£Â÷7G&öæsãÂ÷ãÇâr²öW66T‡FÖÂ††V6†÷2’²sÂ÷ãÇå6öÆ–6—Fò&öçVæ6–Ö–VçFò6ö'&RÆ6÷'&V7FÆ–66–öâFRÆæ÷&ÖãÂ÷âs°¢ÒVÇ6R°¢6öçFVæ–FòÒsÇäW7F–ÖFòöÃÂ÷ãÇâr²öW66T‡FÖÂ††V6†÷2’²sÂ÷ãÇåVVFòÆW7W&FR7R&W7VW7FãÂ÷ãÇäFVçFÖVçFRÃÆ'#âr²öW66T‡FÖÂ†æöÖ'&R’²sÂ÷âs°¢Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB"7G–ÆSÒ&föçB×6—¦S£Gƒ¶Æ–æRÖ†V–v‡C£ã‚#ãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£g‚#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Wƒ¶föçB×vV–v‡C£s#âr²F—GVÆ÷5·F—õÒ²sÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âr²†÷’²sÂöF—cãÂöF—cãÇãÇ7G&öæsäFS£Â÷7G&öæsâr²öW66T‡FÖÂ†æöÖ'&R’²rÒ%T2ôDä“¢r²öW66T‡FÖÂ‡'V2’²sÂ÷ãÇãÇ7G&öæsä£Â÷7G&öæsâr²VçF–FFW5·F—õÒ²sÂ÷âr²‡&W6öÇV6–öâÓÒuõõõõõõõõõõõõõõòròsÇãÇ7G&öæså&Vc£Â÷7G&öæsâr²öW66T‡FÖÂ‡&W6öÇV6–öâ’²sÂ÷âr¢rr’²sÆF—b7G–ÆSÒ&Ö&v–â×F÷£'‚#âr²6öçFVæ–Fò²sÂöF—cãÆF—b7G–ÆSÒ&Ö&v–â×F÷£gƒ·FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öæsâr²öW66T‡FÖÂ†æöÖ'&R’²sÂ÷7G&öæsãÂöF—cãÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#â¢&÷'&F÷"Ò&Wf—6"6öâ&övFòG&–'WF&—7FãÂöF—cãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòbât•D„„ôÄD”ärD‚„4D’¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y §f"4D•õ$DU2Ò°¢4Ã¢²F—f–FVæF÷3¢ãRÂ–çFW&W6W3¢ãBÂ&÷–ÇG—3¢ãRÂ6W'f–6–÷3¢ãRÂÆöv—7F–6¢ãRÂæöÖ'&S¢t6†–ÆRrÒÀ¢4ó¢²F—f–FVæF÷3¢ãÂ–çFW&W6W3¢ãÂ&÷–ÇG—3¢ãÂ6W'f–6–÷3¢ãRÂÆöv—7F–6¢ãRÂæöÖ'&S¢t6öÆöÖ&–rÒÀ¢Õƒ¢²F—f–FVæF÷3¢ãÂ–çFW&W6W3¢ãC’Â&÷–ÇG—3¢ãÂ6W'f–6–÷3¢ãRÂÆöv—7F–6¢ãRÂæöÖ'&S¢tÖW†–6òrÒÀ¢U3¢²F—f–FVæF÷3¢ã‚Â–çFW&W6W3¢ãBÂ&÷–ÇG—3¢ãÂ6W'f–6–÷3¢ãRÂÆöv—7F–6¢ãRÂæöÖ'&S¢tW7ærÒÀ¢U3¢²F—f–FVæF÷3¢ãÂ–çFW&W6W3¢ãBÂ&÷–ÇG—3¢ãÂ6W'f–6–÷3¢ãRÂÆöv—7F–6¢ãRÂæöÖ'&S¢tTRåURârÒÀ¢%#¢²F—f–FVæF÷3¢ãRÂ–çFW&W6W3¢ãRÂ&÷–ÇG—3¢ãRÂ6W'f–6–÷3¢ãRÂÆöv—7F–6¢ãRÂæöÖ'&S¢t'&6–ÂrÒÀ¢4ã¢²F—f–FVæF÷3¢ãÂ–çFW&W6W3¢ãÂ&÷–ÇG—3¢ãÂ6W'f–6–÷3¢ãRÂÆöv—7F–6¢ãRÂæöÖ'&S¢t6†–ærÒÀ¢æõö6C¢²F—f–FVæF÷3¢ã3Â–çFW&W6W3¢ã3Â&÷–ÇG—3¢ã3Â6W'f–6–÷3¢ã3ÂÆöv—7F–6¢ã3ÂæöÖ'&S¢u6–â4D’rĞ§Ó°¦gVæ7F–öâ6Æ5t…B‚’°¢f"—2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wv‡E—2r’çfÇVRÇÂvæõö6Bs°¢f"F—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wv‡EF—òr’çfÇVRÇÂvF—f–FVæF÷2s°¢f"ÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wv‡DÖöçFòr’çfÇVR’ÇÂ°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wv‡E&W7VÇBr“°¢–b‚&÷‚ÇÂÖöçFò’&WGW&ã°¢f"6F’Ò4D•õ$DU5·—5ÒÇÂ4D•õ$DU2ææõö6C°¢f"F64D’Ò6F•·F—õÒÇÂã3°¢f"F6Æö6ÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wv‡EF6Æö6Âr’çfÇVR’ÇÂ3°¢f"&WFVæ6–öä4D’ÒÖöçFò¢F64D“°¢f"&WFVæ6–öäÆö6ÂÒÖöçFò¢‡F6Æö6Âò“°¢f"†÷'&òÒ&WFVæ6–öäÆö6ÂÒ&WFVæ6–öä4D“°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#§f"‚ÒÖvöÆB“¶Ö&v–âÖ&÷GFöÓ£‡‚#åt…BÒr²6F’ææöÖ'&R²sÂöF—cãÇF&ÆSãÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#äÖöçFóÂ÷FƒãÂ÷G#ãÇG#ãÇFCäÖöçFòvFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²ÖöçFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&6öÆ÷#¢34ƒddb#å&WFVæ6–öâ6öâ4D’‚r²F—ò²r“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢34ƒddb#å2òr²&WFVæ6–öä4D’çFôf—†VBƒ"’²r‚r²‡F64D’¢’çFôf—†VBƒ’²rR“Â÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#å&WFVæ6–öâ6–â4D’†Æö6Â“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr²&WFVæ6–öäÆö6ÂçFôf—†VBƒ"’²r‚r²F6Æö6Â²rR“Â÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#ä†÷'&ò÷"4D“Â÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ“¶föçB×6—¦S£W‚#å2òr²†÷'&òçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#â¢F626VwVâ4D’W'RÒr²6F’ææöÖ'&R²sÂöF—cãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòrâäÄ•4•2d”ää4”U$òdå¤Dğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¦gVæ7F–öâ6†÷tæÆ—6—5F"‡F"’°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚væÆ—6—4GWöçBr’ç7G–ÆRæF—7Æ’ÒF"ÓÓÒvGWöçBròv&Æö6²r¢væöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚væÆ—6—4WV–Æ–'&–òr’ç7G–ÆRæF—7Æ’ÒF"ÓÓÒvWV–Æ–'&–òròv&Æö6²r¢væöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v'FäGWöçBr’æ6Æ74æÖRÒF"ÓÓÒvGWöçBròv'r¢v&rs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v'FäWV–Æ–'&–òr’æ6Æ74æÖRÒF"ÓÓÒvWV–Æ–'&–òròv'r¢v&rs°§Ğ¦gVæ7F–öâ6Æ4GUöçB‚’°¢f"–æw&W6÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG–æw&W6÷2r’çfÇVR’ÇÂ°¢f"WF–Æ–FBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vGWF–Æ–FBr’çfÇVR’ÇÂ°¢f"7F—f÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vG7F—f÷2r’çfÇVR’ÇÂ°¢f"G&–Ööæ–òÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vGG&–Ööæ–òr’çfÇVR’ÇÂ°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vGWöçE&W7VÇBr“°¢–b‚&÷‚ÇÂ–æw&W6÷2ÇÂ7F—f÷2’&WGW&ã°¢f"Ö&vVäæWFòÒWF–Æ–FBò–æw&W6÷3°¢f"&÷F6–öä7F—f÷2Ò–æw&W6÷2ò7F—f÷3°¢f"ÆWfW&vRÒ7F—f÷2ò‡G&–Ööæ–òÇÂ“°¢f"&öRÒÖ&vVäæWFò¢&÷F6–öä7F—f÷2¢ÆWfW&vS°¢f"æ—fVÂÂ6öÆ÷#°¢–b‡&öRãÒã#’²æ—fVÂÒtU„4TÄTåDRs²6öÆ÷"Òr3$T43ss²Ğ¢VÇ6R–b‡&öRãÒã"’²æ—fVÂÒt%TTäòs²6öÆ÷"Òr34ƒddbs²Ğ¢VÇ6R–b‡&öRãÒãR’²æ—fVÂÒu$TuTÄ"s²6öÆ÷"Òr4S„#s²Ğ¢VÇ6R²æ—fVÂÒt$¤òs²6öÆ÷"Òr4Sc3“Cbs²Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£'‚#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#äæÆ—6—2GRöçCÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£#‡ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢r²6öÆ÷"²s¶Ö&v–â×F÷£‡‚#å$ôRÒr²‡&öR¢’çFôf—†VBƒ’²rSÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢r²6öÆ÷"²r#âr²æ—fVÂ²sÂöF—cãÂöF—cãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶föçB×6—¦S£Gƒ¶Ö&v–âÖ&÷GFöÓ£'ƒ·FF–æs£'ƒ¶&6¶w&÷VæC§&v&ƒS‚Ã3BÃ#SRÂãb“¶&÷&FW"×&F—W3£‡‚#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#¢34ƒddb#âr²†Ö&vVäæWFò¢’çFôf—†VBƒ’²rSÂ÷7G&öæsâ‚Ç7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB’#âr²&÷F6–öä7F—f÷2çFôf—†VBƒ"’²sÂ÷7G&öæsâ‚Ç7G&öær7G–ÆSÒ&6öÆ÷#¢3”#S”#b#âr²ÆWfW&vRçFôf—†VBƒ"’²sÂ÷7G&öæsâÒÇ7G&öær7G–ÆSÒ&6öÆ÷#¢r²6öÆ÷"²r#âr²‡&öR¢’çFôf—†VBƒ’²rSÂ÷7G&öæsãÂöF—cãÇF&ÆSãÇG#ãÇFCäÖ&vVâæWFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢34ƒddb#ãÇ7G&öæsâr²†Ö&vVäæWFò¢’çFôf—†VBƒ’²rSÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÇG#ãÇFCå&÷F6–öâFR7F—f÷3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖvöÆB’#ãÇ7G&öæsâr²&÷F6–öä7F—f÷2çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÇG#ãÇFCåÆæ62f–ææ6–W&3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢3”#S”#b#ãÇ7G&öæsâr²ÆWfW&vRçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæså$ôSÂ÷7G&öæsãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢r²6öÆ÷"²r#ãÇ7G&öæsâr²‡&öR¢’çFôf—†VBƒ’²rSÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å$ôRÒÖ&vVâæWFò‚&÷F6–öâ7F—f÷2‚Ææ63ÂöF—cãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4WV–Æ–'&–ò‚’°¢f"f–¦÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWf–¦÷2r’çfÇVR’ÇÂ°¢f"f&–&ÆRÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWf&–&ÆRr’çfÇVR’ÇÂ°¢f"&V6–òÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vW&V6–òr’çfÇVR’ÇÂ°¢f"föÇVÖVâÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vWföÇVÖVâr’çfÇVR’ÇÂ°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vWV–Æ–'&–õ&W7VÇBr“°¢–b‚&÷‚ÇÂf–¦÷2ÇÂ&V6–ò’&WGW&ã°¢f"Ö&vVåVæ—BÒ&V6–òÒf&–&ÆS°¢f"VçFôWÒÖ&vVåVæ—Bâòf–¦÷2òÖ&vVåVæ—B¢°¢f"VçFôW2ÒVçFôW¢&V6–ó°¢f"–æw&W6ô7GVÂÒföÇVÖVâ¢&V6–ó°¢f"WF–Æ–FD7GVÂÒföÇVÖVâ¢Ö&vVåVæ—BÒf–¦÷3°¢f"Ö&vVå6VrÒÖ&vVåVæ—Bò&V6–ó°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£'‚#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#åVçFòFRWV–Æ–'&–óÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£#‡ƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢34ƒddc¶Ö&v–â×F÷£‡‚#âr²VçFôWçFôf—†VBƒ’²rVæ–FFW3ÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å2òr²VçFôW2çFôf—†VBƒ"’²rVâfVçF3ÂöF—cãÂöF—cãÇF&ÆSãÇG#ãÇFCäÖ&vVâVæ—F&–óÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²Ö&vVåVæ—BçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCäÖ&vVâFR6VwW&–FCÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢r²†Ö&vVå6VrãÒã"òwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âr²†Ö&vVå6Vr¢’çFôf—†VBƒ’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&&÷&FW"Ö&÷GFöÓ¦æöæS·FF–æs£G‚#ãÂ÷FCãÂ÷G#ãÇG#ãÇFCåföÇVÖVâ7GVÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr²föÇVÖVâ²rVæ–FFW3Â÷FCãÂ÷G#ãÇG#ãÇFCä–æw&W6ò7GVÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr²–æw&W6ô7GVÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCåWF–Æ–FB7GVÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢r²‡WF–Æ–FD7GVÂãÒòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#å2òr²WF–Æ–FD7GVÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#åäRâÒ6÷7F÷2f–¦÷2ò…&V6–òÒ6÷7Fòf&–&ÆRVæ—F&–ò“ÂöF—cãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò‚â4ôÕÄ”ä4R4„T4´Ä•5@¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y §f"4ôÕÄ”ä4UôDDÒ°¢7VæC¢°¢²—FVÓ¢tFV6Æ&6–öâ§W&FÖVç7VÂ”ub…EBc#’rÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢tFV6Æ&6–öâ§W&FçVÂFR&VçF…EBc#"’rÂg&V7VVæ6–¢tçVÂrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢uvò÷÷'GVæòFR”ubrÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢tFV6Æ&6–öâFR–æf÷&Ö6–öâÖVç7VÂ…ÄR’rÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢t6öç6W'f6–öâFRÆ–'&÷26öçF&ÆW2ƒæ–÷2’rÂg&V7VVæ6–¢uW&ÖæVçFRrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢tVÖ—6–öâFRf7GW&2VÆV7G&öæ–62rÂg&V7VVæ6–¢t6F÷W&6–öârÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢u&WFVæ6–öæW2’W&6W6–öæW2ÖVç7VÆW2rÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢tD¢FRæöÖ–æVÆV7G&öæ–6…ÄÔR’rÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÖVF–rĞ¢ÒÀ¢Æ&÷&Ã¢°¢²—FVÓ¢tFV6Æ&6–öâ’vòFRW56ÇVBƒ’R’rÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢t÷'FW2eôôårÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢t6ö×Vç66–öâ÷"F–V×òFR6W'f–6–÷2„5E2’rÂg&V7VVæ6–¢u6VÖW7G&ÂrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢tw&F–f–66–öæW2†§VÆ–ò’F–6–VÖ'&R’rÂg&V7VVæ6–¢u6VÖW7G&ÂrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢uWF–Æ–FFW2†Ö'¦òÖ'&–Â’rÂg&V7VVæ6–¢tçVÂrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢uf66–öæW2ƒ3F–2çVÆW2’rÂg&V7VVæ6–¢tçVÂrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢t6öçG&FòFRG&&¦ò÷"W67&—FòrÂg&V7VVæ6–¢tÂ–æ–6–òrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢u6VwW&òFRf–FÆW’ƒBR’rÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÖVF–rĞ¢ÒÀ¢ÖÃ¢°¢²—FVÓ¢u&öw&ÖFR&WfVæ6–öâFRÆfFòFR7F—f÷2rÂg&V7VVæ6–¢uW&ÖæVçFRrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢u&W÷'FRFR÷W&6–öæW26÷7V6†÷62…$õ2’rÂg&V7VVæ6–¢t&¦òFVÖæFrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢u&W÷'FRFRG&ç666–öæW2VâVfV7F—fò…%DR’rÂg&V7VVæ6–¢tÖVç7VÂrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢tGVRF–Æ–vVæ6RFR6Æ–VçFW2„µ”2’rÂg&V7VVæ6–¢tÂ–æ–6–òrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢t–FVçF–f–66–öâFVÂ&VæVf–6–òf–æÂrÂg&V7VVæ6–¢tÂ–æ–6–òrÂ&–÷&–FC¢vÇFrÒÀ¢²—FVÓ¢tWfÇV6–öâFR&–W6vòFR6Æ–VçFW2rÂg&V7VVæ6–¢uW&–öF–6rÂ&–÷&–FC¢vÖVF–rĞ¢ÒÀ¢6÷'÷&F—fó¢°¢²—FVÓ¢tW67&—GW&V&Æ–6’&Vv—7G&òVâ&Vv—7G&÷2V&Æ–6÷2rÂg&V7VVæ6–¢tÂ6öç7F—GV—"rÂ&–÷&–FC¢v&¦rÒÀ¢²—FVÓ¢tÆ–'&òFR7F2FRF—&V7F÷&–òõ6ö6–÷2rÂg&V7VVæ6–¢uW&ÖæVçFRrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢tFV6Æ&6–öâçVÂFRW'6öæ2§W&–F–62„D¥¢’rÂg&V7VVæ6–¢tçVÂrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢t7V×Æ–Ö–VçFòFRæ÷&Ö2ä””bôä”2rÂg&V7VVæ6–¢uW&ÖæVçFRrÂ&–÷&–FC¢vÖVF–rÒÀ¢²—FVÓ¢u&Væ÷f6–öâFRÆ–6Væ6–2FRgVæ6–öæÖ–VçFòrÂg&V7VVæ6–¢tçVÂrÂ&–÷&–FC¢vÖVF–rĞ¢Ğ§Ó°¦gVæ7F–öâvVä6ö×Æ–æ6R†&V’°¢f"—FV×2Ò4ôÕÄ”ä4UôDD¶&VÒÇÂµÓ°¢f"&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×Æ–æ6U&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢f"6öÆ÷&W2Ò²ÇF¢wf"‚Ò×&VB’rÂÖVF–¢wf"‚ÒÖvöÆB’rÂ&¦¢wf"‚ÒÖw&VVâ’rÓ°¢f"Æ&VÇ2Ò²ÇF¢t5$•D”4rÂÖVF–¢tÔTD”rÂ&¦¢t$¤rÓ°¢f"–6öç2Ò²ÇF¢rrÂÖVF–¢wârÂ&¦¢vòrÓ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇFƒäô³Â÷FƒãÇFƒäö&Æ–v6–öãÂ÷FƒãÇFƒäg&V7VVæ6–Â÷FƒãÇFƒå&–÷&–FCÂ÷FƒãÂ÷G#âr²—FV×2æÖ†gVæ7F–öâ†—B’°¢&WGW&âsÇG#ãÇFCãÆ–çWBG—SÒ&6†V6¶&÷‚"öæ6†ævSÒ'F†—2ç&VçDVÆVÖVçBç&VçDVÆVÖVçBç7G–ÆRæ÷6—G“×F†—2æ6†V6¶VCóãS£"7G–ÆSÒ&7W'6÷#§ö–çFW"#ãÂ÷FCãÇFCâr²—Bæ—FVÒ²sÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âr²—Bæg&V7VVæ6–²sÂ÷FCãÇFCãÇ7â7G–ÆSÒ&6öÆ÷#¢r²6öÆ÷&W5¶—Bç&–÷&–FEÒ²s¶föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S#âr²–6öç5¶—Bç&–÷&–FEÒ²rr²Æ&VÇ5¶—Bç&–÷&–FEÒ²sÂ÷7ããÂ÷FCãÂ÷G#âs°¢Ò’æ¦ö–â‚rr’²sÂ÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äÖ&66Fö&Æ–v6–öâ6ö×ÆWFFâ&–÷&–FBÅDÒÆ¦ò–æÖ–æVçFRò×VÇFÇFãÂöF—cãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òòäUr4U%d”4U2(	B$D4‚2ƒr6W'f–6W2¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¢òò)H)Hâ5õB)H)H §f"5õEô4E3×¶FWG&66–öã¥··c¢v§V6"rÆÃ¢t§V6"ƒR’wÒÇ·c¢vÆ6ö†öÂrÆÃ¢tÆ6ö†öÂƒ"R’wÒÇ·c¢w&V7W'6÷5ö†–G&ö&–öÆöv–6÷2rÆÃ¢u&V7W'6÷2†–G&ö&–öÆöv–6÷2ƒ’R’wÒÇ·c¢v'&÷¢rÆÃ¢t'&÷¢ƒrR’wÒÇ·c¢vÖ—¢rÆÃ¢tÖ—¢ƒrR’wÒÇ·c¢vÖ–æW&ÆW5öæõöW&–fW&÷2rÆÃ¢tÖ–æW&ÆW2ÖWFÆ–6÷2æòW&–fW&÷2ƒR’wÒÇ·c¢vÖ–æW&ÆW5öW&–fW&÷2rÆÃ¢tÖ–æW&ÆW2ÖWFÆ–6÷2W&–fW&÷2ƒR’wÒÇ·c¢vÖ–æW&ÆW5öæõöÖWFÆ–6÷2rÆÃ¢tÖ–æW&ÆW2æòÖWFÆ–6÷2ƒR’wÒÇ·c¢v&–VæW5öW†öæW&F÷2rÆÃ¢t&–VæW2W†öæW&F÷2”ubƒãRR’wÒÇ·c¢v÷G&÷5ó"rÆÃ¢t÷G&÷2Ò"RwÒÇ·c¢v÷G&÷5órÆÃ¢t÷G&÷2ÒRwÒÇ·c¢v÷G&÷5óbrÆÃ¢t÷G&÷2ÒbRwÒÇ·c¢v÷G&÷5óBrÆÃ¢t÷G&÷2ÒBRwÒÇ·c¢v÷G&÷5óóRrÆÃ¢t÷G&÷2ÒãRRwÕÒÇW&6W6–öã¥··c¢v6öÖ'W7F–&ÆW2rÆÃ¢t6öÖ'W7F–&ÆW2ƒ"R’wÒÇ·c¢vÆ6ö†öÅöWF–Æ–6òrÆÃ¢tÆ6ö†öÂWF–Æ–6òƒ"R’wÒÇ·c¢v§V6%÷W"rÆÃ¢t§V6"ƒ"R’wÒÇ·c¢vÆvöFöârÆÃ¢tÆvöFöâƒãRR’wÒÇ·c¢v÷G&÷5÷W%órÆÃ¢t÷G&÷2ÒRwÒÇ·c¢v÷G&÷5÷W%óRrÆÃ¢t÷G&÷2ÒRRwÒÇ·c¢v÷G&÷5÷W%ó"rÆÃ¢t÷G&÷2Ò"RwÒÇ·c¢v÷G&÷5÷W%órÆÃ¢t÷G&÷2ÒRwÕÒÇ&WFVæ6–öã¥··c¢vvVçFUó2rÆÃ¢tvVçFW2FR&WFVæ6–öâƒ2R’wÒÇ·c¢vvVçFUóbrÆÃ¢tvVçFW2FR&WFVæ6–öâƒbR’wÒÇ·c¢væõövVçFRrÆÃ¢tæòvVçFRƒR’wÕ×Ó°§f"5õEõ$DU3×¶FWG&66–öã§¶§V6#£ãÆÆ6ö†öÃ£ã"Ç&V7W'6÷5ö†–G&ö&–öÆöv–6÷3£ã’Æ'&÷££ãrÆÖ—££ãrÆÖ–æW&ÆW5öæõöW&–fW&÷3£ãÆÖ–æW&ÆW5öW&–fW&÷3£ãÆÖ–æW&ÆW5öæõöÖWFÆ–6÷3£ãÆ&–VæW5öW†öæW&F÷3£ãRÆ÷G&÷5ó#£ã"Æ÷G&÷5ó£ãÆ÷G&÷5óc£ãbÆ÷G&÷5óC£ãBÆ÷G&÷5óóS£ãWÒÇW&6W6–öã§¶6öÖ'W7F–&ÆW3£ã"ÆÆ6ö†öÅöWF–Æ–6ó£ã"Æ§V6%÷W#£ã"ÆÆvöFöã£ãRÆ÷G&÷5÷W%ó£ãÆ÷G&÷5÷W%óS£ãRÆ÷G&÷5÷W%ó#£ã"Æ÷G&÷5÷W%ó£ãÒÇ&WFVæ6–öã§¶vVçFUó3£ã2ÆvVçFUóc£ãbÆæõövVçFS£ã×Ó°¦gVæ7F–öâWFFU5õD6B‚—·f"CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7÷E÷G—Rr“òçfÇVWÇÂvFWG&66–öâs·f"3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7÷Eö6Br“¶–b‚2—&WGW&ã·2æ–ææW$…DÔÃÒrs²…5õEô4E5·E×ÇÅ5õEô4E2æFWG&66–öâ’æf÷$V6‚†gVæ7F–öâ†2—·f"óÖFö7VÖVçBæ7&VFTVÆVÖVçB‚v÷F–öâr“¶òçfÇVSÖ2çc¶òçFW‡D6öçFVçCÖ2æÃ·2æVæD6†–ÆB†ò“·Ò“·Ğ¦gVæ7F–öâ6Æ55õB‚—·f"CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7÷E÷G—Rr“òçfÇVWÇÂvFWG&66–öâs·f"3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7÷Eö6Br“òçfÇVWÇÂrs·f"Ó×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7÷EöÖöçFòr“òçfÇVR—ÇÃ·f"“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7÷Eö–wbr“òçfÇVWÇÂvæòs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7÷E&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚Ò—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"&6SÖ“ÓÓÒw6’söÒóãƒ¦Ó·f"&FSÕ5õEõ$DU5·EÓõ5õEõ$DU5·EÕ¶5×ÇÃ£·f"7CÒ‡&FR£’çFôf—†VBƒ“·f"ƒÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#"#å&W7VÇFFò5õCÂ÷FƒãÂ÷G#ãÇG#ãÇFCäÖöçFò&6SÂ÷FCãÇFCå2òr¶&6RçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCåF6Æ–6FÂ÷FCãÇFCâr·7B²rSÂ÷FCãÂ÷G#âs¶–b‡CÓÓÒvFWG&66–öâr—·f"CÖ&6R§&FS¶‚³ÒsÇG#ãÇFCäÖöçFòFWG&–FóÂ÷FCãÇFCå2òr¶BçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæsäæWFòv#Â÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr²†&6RÖB’çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#âs·ÖVÇ6R–b‡CÓÓÒwW&6W6–öâr—·f"ÖÒ§&FS¶‚³ÒsÇG#ãÇFCåW&6W6–öâÆ–6FÂ÷FCãÇFCå2òr·çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæsåF÷FÂv#Â÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr²†Ò·’çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#âs·ÖVÇ6W·f"#ÖÒ§&FS¶‚³ÒsÇG#ãÇFCäÖöçFò&WFVæ–FóÂ÷FCãÇFCå2òr·"çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæsäæWFò&V6–&–FóÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr²†Ò×"’çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#âs·Ö‚³ÒsÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#åF62&VfW&Væ6–ÆW25TäCÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÖƒ·Ğ§6WEF–ÖV÷WB†gVæ7F–öâ‚—·G'—·WFFU5õD6B‚“·Ö6F6‚†R—·×ÒÃ“° ¢òò)H)H"â$$•E$”õ2)H)H §f"$$•E$”õ5õ$DU3×¶Ö—&fÆ÷&W3§¶Æ–×–W¦£2ã#Ç'VW3£ãƒÇ6W&Væ¦vó£BãSÇ&–W6vó¢t&¦òwÒÇ6åö—6–G&ó§¶Æ–×–W¦£2ãÇ'VW3£"ãÇ6W&Væ¦vó£Bã#Ç&–W6vó¢t&¦òwÒÇ6åö&÷&¦§¶Æ–×–W¦£"ãƒÇ'VW3£ãcÇ6W&Væ¦vó£2ãƒÇ&–W6vó¢t&¦òwÒÆÆöÖöÆ–æ§¶Æ–×–W¦£"ãSÇ'VW3£"ã#Ç6W&Væ¦vó£2ãSÇ&–W6vó¢t&¦òwÒÇ7W&6ó§¶Æ–×–W¦£"ãcÇ'VW3£ãSÇ6W&Væ¦vó£2ãCÇ&–W6vó¢t&¦òwÒÆ&'&æ6ó§¶Æ–×–W¦£"ã“Ç'VW3£ã“Ç6W&Væ¦vó£BãÇ&–W6vó¢tÖVF–òwÒÆ¦W7W5öÖ&–§¶Æ–×–W¦£"ãCÇ'VW3£ãCÇ6W&Væ¦vó£2ã#Ç&–W6vó¢tÖVF–òwÒÆÆ–æ6S§¶Æ–×–W¦£"ã3Ç'VW3£ã3Ç6W&Væ¦vó£2ãÇ&–W6vó¢tÖVF–òwÒÆÖvFÆVæ§¶Æ–×–W¦£"ã#Ç'VW3£ã#Ç6W&Væ¦vó£"ãƒÇ&–W6vó¢tÖVF–òwÒÇVV&ÆõöÆ–'&S§¶Æ–×–W¦£"ãÇ'VW3£ãÇ6W&Væ¦vó£"ãcÇ&–W6vó¢tÖVF–òwÒÇ6åöÖ–wVVÃ§¶Æ–×–W¦£"ãÇ'VW3£ãÇ6W&Væ¦vó£"ãSÇ&–W6vó¢tÖVF–òwÒÆÆ÷5ööÆ—f÷3§¶Æ–×–W¦£ãƒÇ'VW3£ã“Ç6W&Væ¦vó£"ã3Ç&–W6vó¢tÇFòwÒÇ6¦Ã§¶Æ–×–W¦£ãSÇ'VW3£ãƒÇ6W&Væ¦vó£"ãÇ&–W6vó¢tÇFòwÒÆFS§¶Æ–×–W¦£ãcÇ'VW3£ãƒRÇ6W&Væ¦vó£"ãÇ&–W6vó¢tÇFòwÒÆ6öÖ3§¶Æ–×–W¦£ãCÇ'VW3£ãsÇ6W&Væ¦vó£ã“Ç&–W6vó¢tÇFòwÒÇf–ÆÆöVÅ÷6ÇfF÷#§¶Æ–×–W¦£ã3Ç'VW3£ãcRÇ6W&Væ¦vó£ãƒÇ&–W6vó¢tÇFòwÒÇf–ÆÆöÖ&–§¶Æ–×–W¦£ã3Ç'VW3£ãcRÇ6W&Væ¦vó£ãƒÇ&–W6vó¢tÇFòwÒÆ6&&–ÆÆó§¶Æ–×–W¦£ã#Ç'VW3£ãcÇ6W&Væ¦vó£ãsÇ&–W6vó¢tÇFòwÒÇ6×§¶Æ–×–W¦£ãSÇ'VW3£ãsRÇ6W&Væ¦vó£"ãÇ&–W6vó¢tÇFòwÒÆ–æFWVæFVæ6–§¶Æ–×–W¦£ãsÇ'VW3£ãƒÇ6W&Væ¦vó£"ã#Ç&–W6vó¢tÇFòwÒÆVÅöwW7F–æó§¶Æ–×–W¦£ãCÇ'VW3£ãsÇ6W&Væ¦vó£ã“Ç&–W6vó¢tÇFòwÒÇ&–Ö3§¶Æ–×–W¦£ãcÇ'VW3£ãƒÇ6W&Væ¦vó£"ãÇ&–W6vó¢tÇFòwÒÆ'&Væ§¶Æ–×–W¦£ã“Ç'VW3£ã“RÇ6W&Væ¦vó£"ãCÇ&–W6vó¢tÖVF–òwÒÆ6W&6Fó§¶Æ–×–W¦£"ãÇ'VW3£ãÇ6W&Væ¦vó£"ãSÇ&–W6vó¢tÖVF–òwÒÆ6†÷'&–ÆÆ÷3§¶Æ–×–W¦£"ã#Ç'VW3£ãÇ6W&Væ¦vó£"ãƒÇ&–W6vó¢tÖVF–òwÒÆ&VÆÆf—7F§¶Æ–×–W¦£"ãÇ'VW3£ãRÇ6W&Væ¦vó£"ãcÇ&–W6vó¢tÖVF–òwÒÆ6ÆÆó§¶Æ–×–W¦£"ã3Ç'VW3£ãRÇ6W&Væ¦vó£"ã“Ç&–W6vó¢tÖVF–òwÒÆ÷G&ó§¶Æ–×–W¦£ãƒÇ'VW3£ã“Ç6W&Væ¦vó£"ã3Ç&–W6vó¢tÖVF–òw×Ó°§f"$%õU4ó×·&W6–FVæ6–Ã£ãÆ6öÖW&6–Ã£ãRÆ–æGW7G&–Ã£"ãÆÖ—‡Fó£ã7Ó°§f"$%õD•ó×¶66£ãÆFWFó£ãƒRÆ6öÖW&6–Ã£ãBÆöf–6–æ£ãÇFW'&Væó£ãRÆ–æGW7G&–Ã£ãbÆ÷G&ó£ãÓ°¦gVæ7F–öâ6Æ4&&—G&–÷2‚—·f"CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5öF—7G&—Fòr“òçfÇVWÇÂv÷G&òs·f"CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5÷F—òr“òçfÇVWÇÂv66s·f"SÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5÷W6òr“òçfÇVWÇÂw&W6–FVæ6–Âs·f"×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5ö&Vr“òçfÇVR—ÇÃ·f"Ã×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5ö&VöÆ–'&Rr“òçfÇVR—ÇÃ·f"ã×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5öæ–òr“òçfÇVR—ÇÃ##·f"3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5÷7f72r“òçfÇVWÇÂv6ö×ÆWFòs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v&&—G&–÷5&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"#Ô$$•E$”õ5õ$DU5¶E×ÇÄ$$•E$”õ5õ$DU2æ÷G&ó·f"V3Ô$%õU4õ·U×ÇÃã·f"F3Ô$%õD•õ·E×ÇÃã·f"çCÔÖF‚æÖ‚ƒãrÃÔÖF‚æÖ‚ƒÃ##bÖâ’£ãR“·f"SÖ¶Â£ã3·f"Æ–ÓÓÇ#ÓÇ6W#Ó¶–b‡3ÓÓÒv6ö×ÆWFòwÇÇ3ÓÓÒvÆ–×–W¦r–Æ–Ó×"æÆ–×–W¦¦§V2§F2¦çC¶–b‡3ÓÓÒv6ö×ÆWFòr—#×"ç'VW2¦R§V2§F2¦çC¶–b‡3ÓÓÒv6ö×ÆWFòwÇÇ3ÓÓÒw6W&Væ¦vòr—6W#×"ç6W&Væ¦vò¦§V2§F2¦çC·f"çVÃÖÆ–Ò·"·6W#·f"&–W6vó×"ç&–W6v÷ÇÂtÖVF–òs·f"7#×&–W6vóÓÓÒt&¦òsòr3&SvC3"s§&–W6vóÓÓÒtÖVF–òsòr6cSvcrs¢r63c#ƒ#‚s·f"ƒÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#"#ä&&—G&–÷2Òr¶Bæ6†$Bƒ’çFõWW$66R‚’¶Bç6Æ–6Rƒ’ç&WÆ6R‚õòörÂrr’²sÂ÷FƒãÂ÷G#âs¶–b†Æ–Óã–‚³ÒsÇG#ãÇFCäÆ–×–W¦V&Æ–6Â÷FCãÇFCå2òr¶Æ–ÒçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b‡#ã–‚³ÒsÇG#ãÇFCå'VW2’¦&F–æW3Â÷FCãÇFCå2òr·"çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b‡6W#ã–‚³ÒsÇG#ãÇFCå6W&Væ¦vóÂ÷FCãÇFCå2òr·6W"çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶‚³ÒsÇG#ãÇFCãÇ7G&öæsåF÷FÂçVÃÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr¶çVÂçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÇG#ãÇFCåF÷FÂÖVç7VÃÂ÷FCãÇFCå2òr²†çVÂó"’çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCå&–W6vòF—7G&—FÃÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢r¶7"²s¶föçB×vV–v‡C¦&öÆB#âr·&–W6vò²sÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#åfÆ÷&W2&VfW&Væ6–ÆW3Â÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÖƒ·Ğ ¢òò)H)H2â$TåDåTÂ)H)H §f"$TåDõT•C×²ââåD…õ%TÄU2çV—GÓ°§f"$TåDô%$4´UE3Õ·¶Æ–Ó£RÇ&FS£ã‡ÒÇ¶Æ–Ó£#Ç&FS£ãGÒÇ¶Æ–Ó£3RÇ&FS£ãwÒÇ¶Æ–Ó£CRÇ&FS£ã#ÒÇ¶Æ–Ó¤–æf–æ—G’Ç&FS£ã3ÕÓ°¦gVæ7F–öâ6Æ5&VçFçVÂ‚—·f"—#×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçF÷–V"r“òçfÇVR—ÇÃ##S·f"6CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFö6Br“òçfÇVWÇÂwFW&6W&s·f"–æs×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFö–æw&W6÷2r“òçfÇVR—ÇÃ·f"6÷7C×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFö6÷7F÷2r“òçfÇVR—ÇÃ·f"v7C×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFöv7F÷2r“òçfÇVR—ÇÃ·f"gCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFögr“òçfÇVWÇÂvæòs·f"gÓ×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFögöÖöçFòr“òçfÇVR—ÇÃ·f"FW3×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFöFW2r“òçfÇVR—ÇÃ·f"FVDC×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFöFVGV2r“òçfÇVR—ÇÃ·f"FVD÷C×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçFöFVGV5ö÷G&2r“òçfÇVR—ÇÃ·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&VçF&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚–ær—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"V—CÕ$TåDõT•E·—%×ÇÅ$TåDõT•E³##UÓ·f"FVDcÔÖF‚æÖ–â†FVDBÃ2§V—B“·f"$æWCÖ–ærÖ6÷7BÖv7C¶–b†6CÓÓÒwFW&6W&wÇÆ6CÓÓÒv7V'FwÇÆ6CÓÓÒwV–çFr—$æWBÓÓr§V—C¶–b†gBÓÒvæòr—$æWBÓÖgÓ·$æWBÓÖFVDc·$æWBÓÖFW2£ãR§V—C·$æWBÓÖFVD÷C·$æWCÔÖF‚æÖ‚ƒÇ$æWB“·f"–×Ó·f"'%&÷w3Òrs·f"&WcÓ·f"&VÓ×$æWC¶f÷"‡f"“Ó¶“Å$TåDô%$4´UE2æÆVæwFƒ¶’²²—·f"&³Õ$TåDô%$4´UE5¶•Ó·f"$&6SÔÖF‚æÖ–â„ÖF‚æÖ‚ƒÇ&VÒ’Â†&²æÆ–Ò×&Wb’§V—B“¶–b†$&6Sã—·f"FƒÖ$&6R¦&²ç&FS¶–×³×Fƒ·f"Æ&ÃÖ&²æÆ–ÓÓÓÔ–æf–æ—G“òtÖ2FRr·&Wb²rT•Bs¢t†7Fr¶&²æÆ–Ò²rT•Bs¶'%&÷w2³ÒsÇG#ãÇFCâr¶Æ&Â²r‚r²†&²ç&FR£’çFôf—†VBƒ’²rR“Â÷FCãÇFCå2òr¶$&6RçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·F‚çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs·&VÒÓÖ$&6S·×&WcÖ&²æÆ–Ó¶–b‡&VÓÃÓ–'&V³·×f"Vc×$æWCãò†–×ö–ær£“£·f"ƒÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#2#å&VçFçVÂr·—"²r…T•C¢2òr·V—B²r“Â÷FƒãÂ÷G#ãÇG#ãÇFCä–æw&W6÷2''WF÷3Â÷FCãÇFB6öÇ7ãÒ#"#å2òr¶–ærçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCâ‚Ò’6÷7F÷2FVGV6–&ÆW3Â÷FCãÇFB6öÇ7ãÒ#"#å2òr¶6÷7BçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCâ‚Ò’v7F÷2FVGV6–&ÆW3Â÷FCãÇFB6öÇ7ãÒ#"#å2òr¶v7BçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCâ‚Ò’FVGV2ârT•CÂ÷FCãÇFB6öÇ7ãÒ#"#å2òr²ƒr§V—B’çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b†gBÓÒvæòr–‚³ÒsÇG#ãÇFCâ‚Ò’÷'FW2r¶gBçFõWW$66R‚’²sÂ÷FCãÇFB6öÇ7ãÒ#"#å2òr¶gÒçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b†FVDcã–‚³ÒsÇG#ãÇFCâ‚Ò’FVGV2âF–6–öæÂÖ‚2T•CÂ÷FCãÇFB6öÇ7ãÒ#"#å2òr¶FVDbçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b†FW3ã–‚³ÒsÇG#ãÇFCâ‚Ò’FVGV2âr¶FW2²rFWVæF–VçFR‡2“Â÷FCãÇFB6öÇ7ãÒ#"#å2òr²†FW2£ãR§V—B’çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b†FVD÷Cã–‚³ÒsÇG#ãÇFCâ‚Ò’÷G&2FVGV66–öæW3Â÷FCãÇFB6öÇ7ãÒ#"#å2òr¶FVD÷BçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶‚³ÒsÇG#ãÇFCãÇ7G&öæså&VçFæWF–×öæ–&ÆSÂ÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#"#ãÇ7G&öæså2òr·$æWBçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#âr¶'%&÷w2²sÇG#ãÇFCãÇ7G&öæsä–×VW7Fò6Æ7VÆFóÂ÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#"#ãÇ7G&öæså2òr¶–×çFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÇG#ãÇFCåF6VfV7F—fÂ÷FCãÇFB6öÇ7ãÒ#"#âr¶VbçFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#2"7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#å6–×VÆ6–öâ&VfW&Væ6–ÃÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÖƒ·Ğ ¢òò)H)HBâU$D”D%$5E$$ÄR)H)H ¦gVæ7F–öâ6Æ5W&F–F‚—·f"ã×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–Föæ–òr“òçfÇVR—ÇÃ##C·f"××'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–FöÖöçFòr“òçfÇVR—ÇÃ·f"–æw3Õ·'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–Fö–æsr“òçfÇVR—ÇÃÇ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–Fö–æs"r“òçfÇVR—ÇÃÇ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–Fö–æs2r“òçfÇVR—ÇÃÇ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–Fö–æsBr“òçfÇVR—ÇÃÓ·f"Æ–ÓÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–FöÆ–Ö—FRr“òçfÇVR—ÇÃ’ó·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wW&F–F&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚×ÇÆ–æw2æWfW'’†gVæ7F–öâ‡‚—·&WGW&âƒ·Ò’—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"6ÆFóÖ×ÇF÷FÄ3ÓÆæ–÷4ãÓ·f"ƒÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#B#ä'&7G&RW&F–FÒV¦W&6–6–òr¶â²sÂ÷FƒãÂ÷G#ãÇG#ãÇFƒäæ–óÂ÷FƒãÇFƒä–æw&W6óÂ÷FƒãÇFƒä6ö×Vç6FóÂ÷FƒãÇFƒå6ÆFóÂ÷FƒãÂ÷G#ãÇG#ãÇFCâr¶â²sÂ÷FCãÇFCâÓÂ÷FCãÇFCâÓÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢63c#ƒ#‚#å2òr·6ÆFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶f÷"‡f"“Ó¶“Æ–æw2æÆVæwFƒ¶’²²—·f"–æsÖ–æw5¶•Ó·f"—#Öâ³¶“¶–b‡6ÆFóÃÓ—¶‚³ÒsÇG#ãÇFCâr·—"²sÂ÷FCãÇFCå2òr¶–ærçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òãÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢3&SvC3"#å2òãÂ÷FCãÂ÷G#âs¶6öçF–çVS·×f"6ö×Ó¶–b†–æsã—¶6ö×ÔÖF‚æÖ–â‡6ÆFòÆ–ær¦Æ–Ò“·6ÆFòÓÖ6ö×·F÷FÄ2³Ö6ö×¶æ–÷4â²³·Ö‚³ÒsÇG#ãÇFCâr·—"²sÂ÷FCãÇFCå2òr¶–ærçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr¶6ö×çFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr´ÖF‚æÖ‚ƒÇ6ÆFò’çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs·Ö–b‡6ÆFóÃÓ–‚³ÒsÇG#ãÇFB6öÇ7ãÒ#B"7G–ÆSÒ&6öÆ÷#¢3&SvC3#¶föçB×vV–v‡C¦&öÆB#åW&F–F6ö×Vç6FVâr¶æ–÷4â²ræ–ò‡2“Â÷FCãÂ÷G#âs¶VÇ6R‚³ÒsÇG#ãÇFB6öÇ7ãÒ#B"7G–ÆSÒ&6öÆ÷#¢63c#ƒ#ƒ¶föçB×vV–v‡C¦&öÆB#å6ÆFòVæF–VçFS¢2òr·6ÆFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶‚³ÒsÇG#ãÇFCäÆ–Ö—FSÂ÷FCãÇFB6öÇ7ãÒ#2#âr²†Æ–Ò£’çFôf—†VBƒ’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#B"7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#äÄ•"'BâSÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÖƒ·Ğ ¢òò)H)HRâDU5”Dò)H)H ¦gVæ7F–öâ6Æ4FW7–Fò‚—·f"7VS×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõ÷7VVÆFòr“òçfÇVR—ÇÃ·f"6–sÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõö6–vfÒr“òçfÇVWÇÂvæòs·f"&×c×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõ÷&×br“òçfÇVR—ÇÃ3·f"f“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõö–æw&W6òr“òçfÇVS·f"f3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõö6W6Rr“òçfÇVS·f"6öçG&FóÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõö6öçG&Fòr“òçfÇVWÇÂv–æFVf–æ–Fòs·f"Ö÷F—fóÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–FõöÖ÷F—fòr“òçfÇVWÇÂvFW7–Fõö&&—G&&–òs·f"7G4#×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõö7G2r“òçfÇVR—ÇÃ·f"f3×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõ÷f2r“òçfÇVR—ÇÃ·f"w&F–cÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõöw&F–br“òçfÇVWÇÂvæòs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW7–Fõ&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚7VWÇÂf—ÇÂf2—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"–æsÖæWrFFR†f’’Æ6W3ÖæWrFFR†f2“¶–b†–æsãÖ6W2—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"D×3Ö6W2Ö–ærÇDF–3ÔÖF‚æfÆö÷"†D×2óƒcC’ÇDÖW6W3×DF–2ó3ãC3sRÆæ–÷3ÔÖF‚æfÆö÷"‡DÖW6W2ó"’ÆÖW6W3ÔÖF‚æfÆö÷"‡DÖW6W2S"“·f"6–tÓÖ6–sÓÓÒw6’s÷&×b£ã£Ç&VÔ3×7VR¶6–tÓ·f"w&F–eÖw&F–cÓÓÒvæòsò‡7VRób’¢†ÖW6W2ó"“£Æ7G5CÒ‚‡&VÔ2²‡7VRób’’ó"’§DÖW6W2Æ7G4cÔÖF‚æÖ‚ƒÆ7G5BÖ7G4"’Çf5CÒ‡7VRó3’§f3·f"–æCÓ·f"W4FW3ÖÖ÷F—fóÓÓÒvFW7–Fõö&&—G&&–òwÇÆÖ÷F—fóÓÓÒvFW7–Fõöf–¦òwÇÆÖ÷F—fóÓÓÒv†÷7F–Æ–FBs¶–b†W4FW2––æCÔÖF‚æÖ–âƒãR§7VR¢†æ–÷2¶ÖW6W2ó"’Ã"§7VR“·f"F÷FÃÖ7G4b·f5B¶w&F–e¶–æC·f"ƒÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#"#äÆ—V–F6–öâ&VæVf–6–÷3Â÷FƒãÂ÷G#ãÇG#ãÇFCåW&–öFóÂ÷FCãÇFCâr¶æ–÷2²vr¶ÖW6W2²vÒ‚r·DF–2²vB“Â÷FCãÂ÷G#ãÇG#ãÇFCå&VÒâ6ö×WF&ÆSÂ÷FCãÇFCå2òr·&VÔ2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCä5E2G'Væ6Â÷FCãÇFCå2òr¶7G5BçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b†7G4#ã–‚³ÒsÇG#ãÇFCâ‚Ò’5E2&æ6óÂ÷FCãÇFCå2òr¶7G4"çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶‚³ÒsÇG#ãÇFCãÇ7G&öæsä5E2v#Â÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr¶7G4bçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#âs¶–b‡f3ã–‚³ÒsÇG#ãÇFCåf2âG'Væ62‚r·f2²vB“Â÷FCãÇFCå2òr·f5BçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b†w&F–eãbfw&F–cÓÓÒvæòr–‚³ÒsÇG#ãÇFCäw&F–bâG'Væ6Â÷FCãÇFCå2òr¶w&F–eçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs¶–b†W4FW2–‚³ÒsÇG#ãÇFCãÇ7G&öæsä–æFVÖæ—¦6–öãÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr¶–æBçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#âs¶VÇ6R‚³ÒsÇG#ãÇFCä–æFVÖæ—¦6–öãÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢3ƒƒ‚#äæòÆ–6Â÷FCãÂ÷G#âs¶‚³ÒsÇG#ãÇFCãÇ7G&öæsåF÷FÃÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr·F÷FÂçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÖƒ·Ğ ¢òò)H)HbâBÕ$Tt•5E$ò)H)H ¦gVæ7F–öâ6Æ5E&Vv—7G&ò‚—·f"Fö3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&VuöFö2r“òçfÇVWÇÂtDä’s·f"çVÓÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&VuöçVÒr“òçfÇVWÇÂrs·f"æ3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&Vuöæ2r“òçfÇVWÇÂrs·f"–æsÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&Vuö–æw&W6òr“òçfÇVWÇÂrs·f"VãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&Vu÷Vç6–öâr“òçfÇVWÇÂtes·f"F—óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&Vu÷F—òr“òçfÇVWÇÂtV×ÆVFòs·f"&VÓ×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wG&Vu÷&VÒr“òçfÇVR—ÇÃ·f"W‡CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&VuöW‡G&æ¦W&òr“òçfÇVWÇÂvæòs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wG&Vu&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚çV×ÇÂ–ær—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"ö³ÖfÇ6S¶–b†Fö3ÓÓÒtDä’rbfçVÒæÆVæwFƒÓÓÓ‚bbõåÆG³‡ÒBòçFW7B†çVÒ’–ö³×G'VS¶VÇ6R–b†Fö3ÓÓÒt4RrbfçVÒæÆVæwFƒãÓRbfçVÒæÆVæwFƒÃÓ"–ö³×G'VS¶VÇ6R–b†Fö3ÓÓÒu6÷'FRrbfçVÒæÆVæwFƒãÓR–ö³×G'VS·f"VFCÓ¶–b†æ2–VFCÔÖF‚æfÆö÷"‚†æWrFFR‚’ÖæWrFFR†æ2’’òƒ3cRã#R£ƒcC’“¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#"#åfÆ–F6–öâBÕ&Vv—7G&óÂ÷FƒãÂ÷G#ãÇG#ãÇFCäFö7VÖVçFóÂ÷FCãÇFCâr¶Fö2²s¢r¶çVÒ²rr²†ö³òufÆ–Fòs¢t–çfÆ–Fòr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCäVFCÂ÷FCãÇFCâr²†VFGÇÂrÒr’²ræ–÷2r²†VFCãÓƒòrs¢rÒÖVæ÷"VFBr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCåVç6–öãÂ÷FCãÇFCâr·Vâ²sÂ÷FCãÂ÷G#ãÇG#ãÇFCåF—óÂ÷FCãÇFCâr·F—ò²sÂ÷FCãÂ÷G#ãÇG#ãÇFCå&V×VæW&6–öãÂ÷FCãÇFCå2òr²‡&VÒçFôf—†VBƒ"—ÇÂsãr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCäW‡G&æ¦W&óÂ÷FCãÇFCâr¶W‡B²sÂ÷FCãÂ÷G#ãÇG#ãÇFCåÆ¦ò&Vv—7G&ò5TäCÂ÷FCãÇFCãRF–2†&–ÆW2FVÂ–æw&W6óÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)Hrâ5U5Tå4”ôâ)H)H ¦gVæ7F–öâ6Æ57W7Vç6–öâ‚—·f"F—óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7÷F—òr“òçfÇVWÇÂw7W7Vç6–öâs·f"&VÓ×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7÷&VÒr“òçfÇVR—ÇÃ·f"–æ–6–óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7ö–æ–6–òr“òçfÇVWÇÂrs·f"f–ãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7öf–âr“òçfÇVWÇÂrs·f"F–4Ó×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7öF–2r“òçfÇVR—ÇÃ·f"7G3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7ö7G2r“òçfÇVWÇÂvæö6ö×WFs·f"f3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7÷f2r“òçfÇVWÇÂvæö6ö×WFs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w7W7&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚–æ–6–÷ÇÂf–çÇÂ&VÒ—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"cÖæWrFFR†–æ–6–ò’Æc#ÖæWrFFR†f–â“¶–b†cãÖc"—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"F–fcÔÖF‚ç&÷VæB‚†c"Öc’óƒcC“·f"F–3ÖF–4ÓãöF–4Ó¦F–fc·f"FW63Ò‡&VÒó3’¦F–3·f"Æ&Ç3×²w7W7Vç6–öâs¢u7W7Vç6–öâW&fV7FrÂw&VçFÃs¢tÆ–6Væ6–&VçFÂBrÂw&VçFÃ3s¢tÆ–6Væ6–&VçFÂ3BrÂvVæfW&ÖVFBs¢tFW66ç6òÖVF–6òrÂv66–FVçFRs¢tFW66ç6òÖVF–6ò66–FVçFRrÂw6–ævö6Rs¢tÆ–6Væ6–6–âvö6RrÂvF—66—Æ–æ&–s¢u7W7Vç6–öâF—66—Æ–æ&–rÂv‡VVÆvs¢t‡VVÆvÆVvÂwÓ·f"vÒ‡F—óÓÓÒw&VçFÃwÇÇF—óÓÓÒw&VçFÃ3wÇÇF—óÓÓÒvVæfW&ÖVFBwÇÇF—óÓÓÒv66–FVçFRr“¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#"#âr²†Æ&Ç5·F—õ×ÇÇF—ò’²sÂ÷FƒãÂ÷G#ãÇG#ãÇFCåW&–öFóÂ÷FCãÇFCâr¶–æ–6–ò²rÓâr¶f–â²r‚r¶F–2²rF–2“Â÷FCãÂ÷G#ãÇG#ãÇFCå&V×VæW&6–öãÂ÷FCãÇFCå2òr·&VÒçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCäFW67VVçFóÂ÷FCãÇFCâr²‡vòt6öâvö6Rs¢u2òr¶FW62çFôf—†VBƒ"’’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCädT5D5E3Â÷FCãÇFCâr¶7G2ç&WÆ6R‚væö6ö×WFrÂtæò6ö×WFr’ç&WÆ6R‚w&6–ÂrÂu&6–ÆÖVçFRr’ç&WÆ6R‚væ÷&ÖÂrÂtæ÷&ÖÂr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCädT5Dd44”ôäU3Â÷FCãÇFCâr·f2ç&WÆ6R‚væö6ö×WFrÂtæò6ö×WFr’ç&WÆ6R‚w&6–ÂrÂu&6–ÆÖVçFRr’ç&WÆ6R‚væ÷&ÖÂrÂtæ÷&ÖÂr’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)H‚âdÅT¤ò4¤)H)H ¦gVæ7F–öâ6Æ4fÇV¦ô6¦‚—·f"&6S×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf5ö–æw&W6÷2r“òçfÇVR—ÇÃ·f"7&V3Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf5ö7&V6–Ö–VçFòr“òçfÇVR—ÇÃ’ó·f"6c×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf5ö6÷7F÷5öf–¦÷2r“òçfÇVR—ÇÃ·f"7cÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf5ö6÷7F÷5÷f'2r“òçfÇVR—ÇÃ’ó·f"–çc×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf5ö–çfW'6–öâr“òçfÇVR—ÇÃ·f"Ô–æ“×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vf5öÖW2r“òçfÇVR—ÇÃ·f"W7CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf5öW7F6–öæÆ–FBr“òçfÇVWÇÂvæöæRs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vf5&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚&6R—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"ÖW6W3Õ²tVæRrÂtfV"rÂtÖ"rÂt'"rÂtÖ’rÂt§VârÂt§VÂrÂtvòrÂu6WBrÂtö7BrÂtæ÷brÂtF–2uÓ·f"6f3×²væöæRs¥³ÃÃÃÃÃÃÃÃÃÃÃÒÂv§VÅöF–2s¥³ã‚Ãã‚Ãã’Ãã’ÃÃÃã"Ãã"ÃãÃãÃãÃãÒÂvVæUö§Vâs¥³ã"ÃãÃãÃÃÃÃã’Ãã’Ãã‚Ãã‚Ãã’Ãã•ÒÂvÖ%÷6Ws¥³ã’Ãã’Ãã2ÃÃÃã’Ãã’Ãã’Ãã2ÃÃã’Ãã•ÒÂwf&–&ÆRs¥³Ãã‚Ãã"ÃÃã’ÃãrÃãÃã2Ãã’ÃÃãÃã…×Ó·f"6c×6f5¶W7E×ÇÇ6f2ææöæS·f"&÷w3ÒrrÇF÷D“ÓÇF÷D5cÓÇF÷D4cÓÇF÷ESÓÆ7VÓÒÖ–çc¶f÷"‡f"“Ó¶“Ã#¶’²²—·f"–GƒÒ†Ô–æ’¶’’S#·f"–æsÖ&6R¤ÖF‚ç÷rƒ¶7&V2Æ’’§6e¶–G…Ó·f"7f#Ö–ær¦7c·f"WF–ÃÖ–ærÖ7f"Ö6c¶7VÒ³×WF–Ã·F÷D’³Ö–æs·F÷D5b³Ö7f#·F÷D4b³Ö6c·F÷ER³×WF–Ã·&÷w2³ÒsÇG#ãÇFCâr¶ÖW6W5¶–G…Ò²sÂ÷FCãÇFCå2òr¶–ærçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr¶7f"çFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr¶6bçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·WF–ÂçFôf—†VBƒ"’²sÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢r²†7VÓãÓòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²r#å2òr¶7VÒçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs·Ö"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇFƒäÖW3Â÷FƒãÇFƒä–æw&W6÷3Â÷FƒãÇFƒä6÷7F÷2f#Â÷FƒãÇFƒä6÷7F÷2f–¦÷3Â÷FƒãÇFƒåWF–Æ–FCÂ÷FƒãÇFƒä7V×VÆFóÂ÷FƒãÂ÷G#âr·&÷w2²sÇG"7G–ÆSÒ&föçB×vV–v‡C£c#ãÇFCåF÷FÃÂ÷FCãÇFCå2òr·F÷D’çFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·F÷D5bçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·F÷D4bçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·F÷ERçFôf—†VBƒ"’²sÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢r²†7VÓãÓòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²r#å2òr¶7VÒçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)H’âdâõD•")H)H ¦gVæ7F–öâ6Æ5dåõD•"‚—·f"–çc×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfåö–çfW'6–öâr“òçfÇVR—ÇÃ·f"fÇV¦÷3ÕµÓ¶f÷"‡f"“Ó¶“ÃÓS¶’²²–fÇV¦÷2çW6‚‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfåöfÇV¦òr¶’“òçfÇVR—ÇÃ“·f"F6Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfå÷F6r“òçfÇVR—ÇÃ’ó·f"¶CÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfåö¶Br“òçfÇVR—ÇÃ’ó·f"¶SÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfåö¶Rr“òçfÇVR—ÇÃ’ó·f"E7CÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfåöFWVF÷7Br“òçfÇVR—ÇÃ’ó·f"–×Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wfåö–×VW7Fòr“òçfÇVR—ÇÃ’ó·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfå&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚–çb—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"fãÒÖ–çc·f"f#Òrs¶f÷"‡f"“Ó¶“ÃS¶’²²—·f"fÖfÇV¦÷5¶•ÒôÖF‚ç÷rƒ·F6Æ’³“·fâ³×f·f"³ÒsÇG#ãÇFCâr²†’³’²sÂ÷FCãÇFCå2òr¶fÇV¦÷5¶•ÒçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·fçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âs·×f"F—#ÓÆÆóÓÆ†“ÓRÆ—FW#Ó·v†–ÆR†—FW#Ã—·f"Ö–CÒ†Æò¶†’’ó#·f"çcÒÖ–çc¶f÷"‡f"£Ó¶£ÃS¶¢²²–çb³ÖfÇV¦÷5¶¥ÒôÖF‚ç÷rƒ¶Ö–BÆ¢³“¶–b„ÖF‚æ'2†çb“Ãã—·F—#ÖÖ–C¶'&V³·Ö–b†çcã–ÆóÖÖ–C¶VÇ6R†“ÖÖ–C¶—FW"²³¶–b†—FW#ÓÓÓ“’—F—#ÖÖ–C·×f"v63Ò‚ƒÖE7B’¦¶R’²†E7B¦¶B¢ƒÖ–×’“·f"f“×fãã¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#2#äWfÇV6–öâFR&÷–V7F÷3Â÷FƒãÂ÷G#ãÇG#ãÇFƒäæ–óÂ÷FƒãÇFƒäfÇV¦óÂ÷FƒãÇFƒådÂ÷FƒãÂ÷G#âr·f"²sÇG#ãÇFCãÇ7G&öæsådãÂ÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#""7G–ÆSÒ&6öÆ÷#¢r²‡f“òwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²s¶föçB×vV–v‡C£c#å2òr·fâçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæsåD•#Â÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×vV–v‡C£c#âr²‡F—"£’çFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæsåt43Â÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#"#âr²‡v62£’çFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæså&W7VÇFFóÂ÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#""7G–ÆSÒ&6öÆ÷#¢r²‡f“òwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²s¶föçB×vV–v‡C£c#âr²‡f“òuf–&ÆR…dãã’s¢tæòf–&ÆR…dãÃ’r’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#2"7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#âr²‡F—#çv63òuD•"ât43¢vVæW&fÆ÷"s¢uD•"Ât43¢æò7V'&R6÷7Fò6—FÂr’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)Hâ4ôÕâd”ää4”Ô”TåDò)H)H ¦gVæ7F–öâ6Æ46ö×f–â‚—·f"Ó×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×ÖöçFòr“òçfÇVR—ÇÃ·f"Ã×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×Æ¦òr“òçfÇVR—ÇÃ·f"DÃÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×FVÆV6Rr“òçfÇVR—ÇÃ’ó·f"D3Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×FV7&VF—Br“òçfÇVR—ÇÃ’ó·f"DcÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×F6f7Br“òçfÇVR—ÇÃ’ó·f"÷Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×÷6ö×&r“òçfÇVR—ÇÃ’ó·f"6VsÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×6VwW&òr“òçfÇVWÇÂvæòs·f"6VtÓ×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×6VwW&ôÖöçFòr“òçfÇVR—ÇÃ·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×f–å&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚×ÇÂÂ—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"47V÷F×6VsÓÓÒw6’s÷6VtÓ£·f"FVÔÃÔÖF‚ç÷rƒ·DÂÃó"’Ó·f"FVÔ3ÔÖF‚ç÷rƒ·D2Ãó"’Ó¶gVæ7F–öâ×B‡Æ’Æâ—¶–b†“ÓÓÓ—&WGW&âöã·&WGW&â¦’¤ÖF‚ç÷rƒ¶’Æâ’ò„ÖF‚ç÷rƒ¶’Æâ’Ó“·×f"4Æ#××B†ÒÇFVÔÂÇÂ“·f"÷cÖÒ¦÷·f"4ÃÖ4Æ"·47V÷F·f"DÇCÖ4Â§Â¶÷c·f"43××B†ÒÇFVÔ2ÇÂ’·47V÷F·f"D7CÖ42§Ã·f"dcÖÓ·f"4f#×db§Dc·f"4cÖ4f"·47V÷F·f"DgCÖ4b§Â·dc·f"÷3Õ·¶ã¢tÆV6–ærrÇC§DÇBÆ3§DÇBÖÒÆ7S¦4ÂÆc¦÷gÒÇ¶ã¢t7&VF—FòrÇC§D7BÆ3§D7BÖÒÆ7S¦42Æc£ÒÇ¶ã¢tf7F÷&–ærrÇC§DgBÆ3§DgBÖÒÆ7S¦4bÆc§dgÕÒç6÷'B†gVæ7F–öâ†Æ"—·&WGW&âçBÖ"çGÒ“·f"ÖV£Ö÷5³Òæã¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇFƒäÆV6–æsÂ÷FƒãÇFƒä7&VF—FóÂ÷FƒãÇFƒäf7F÷&–æsÂ÷FƒãÂ÷G#ãÇG#ãÇFCä7V÷FÖVç7VÃÂ÷FCãÇFCå2òr¶4ÂçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr¶42çFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr¶4bçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCåF÷FÂvFóÂ÷FCãÇFCå2òr·DÇBçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·D7BçFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr·DgBçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCä6÷7Fòf–ææ6–W&óÂ÷FCãÇFCå2òr²‡DÇBÖÒ’çFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr²‡D7BÖÒ’çFôf—†VBƒ"’²sÂ÷FCãÇFCå2òr²‡DgBÖÒ’çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCä7V÷F&W6–GVÃÂ÷FCãÇFCå2òr¶÷bçFôf—†VBƒ"’²sÂ÷FCãÇFCâÓÂ÷FCãÇFCå2òr·dbçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB6öÇ7ãÒ#B"7G–ÆSÒ&föçB×vV–v‡C¦&öÆC·FW‡BÖÆ–vã¦6VçFW"#å&V6öÖVæF6–öã¢r¶ÖV¢²r†ÖVæ÷"6÷7FòF÷FÂ“Â÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)HâuT”2$TÔ•4”ôâ)H)H ¦gVæ7F–öâ6Æ4wV–&VÖ—6–öâ‚—·f"CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–F—òr“òçfÇVWÇÂrs·f"%#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–'V5&VÒr“òçfÇVWÇÂrs·f"'¥#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–&¦öå&VÒr“òçfÇVWÇÂrs·f"EÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–F—%'F–Fr“òçfÇVWÇÂrs·f"$CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–'V4FW7Br“òçfÇVWÇÂrs·f"'¤CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–&¦öäFW7Br“òçfÇVWÇÂrs·f"DÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–F—$ÆÆVvFr“òçfÇVWÇÂrs·f"fSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–fV6†r“òçfÇVWÇÂrs·f"ÖóÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–Ö÷F—fòr“òçfÇVWÇÂrs·f"&“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–&–VæW2r“òçfÇVWÇÂrs·f"'SÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–'VÇF÷2r“òçfÇVWÇÂss·f"SÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–W6òr“òçfÇVWÇÂss·f"ÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–Æ6r“òçfÇVWÇÂrs·f"6óÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–6öæGV7F÷"r“òçfÇVWÇÂrs·f"Æ“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–Æ–6Væ6–r“òçfÇVWÇÂrs·f"6“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–6—Gbr“òçfÇVWÇÂrs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vwV–&VÖ—6–öå&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚%'ÇÇ%"æÆVæwF‚ÓÓÇÂ$GÇÇ$BæÆVæwF‚ÓÓ—¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7â7G–ÆSÒ&6öÆ÷#¢4S„##ä6ö×ÆWFRÆ÷2%T2ƒF–v—F÷2“Â÷7ããÂöF—câs·&WGW&ã·Ö"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆƒ27G–ÆSÒ&Ö&v–ã£‚#âr·B²sÂöƒ3ãÇF&ÆSãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#å%T2&VÖ—FVçFSÂ÷FCãÇFCâr·%"²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#å&¦öâ6ö6–ÃÂ÷FCãÇFCâr²‡'¥'ÇÂrÒr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#äF—&V66–öâ'F–FÂ÷FCãÇFCâr²†EÇÂrÒr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#å%T2FW7F–æF&–óÂ÷FCãÇFCâr·$B²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#å&¦öâ6ö6–ÂFW7BãÂ÷FCãÇFCâr²‡'¤GÇÂrÒr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#äF—&V66–öâÆÆVvFÂ÷FCãÇFCâr²†DÇÇÂrÒr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#äfV6†G&6ÆFóÂ÷FCãÇFCâr²†fWÇÂrÒr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#äÖ÷F—fóÂ÷FCãÇFCâr¶Öò²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#ä&–VæW3Â÷FCãÇFCâr²†&—ÇÂrÒr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#ä'VÇF÷2òW6óÂ÷FCãÇFCâr¶'R²ròr·R²r¶sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#åÆ6ò6öæGV7F÷#Â÷FCãÇFCâr²‡ÇÇÂrÒr’²ròr²†6÷ÇÂrÒr’²sÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c#äÆ–6Væ6–ò4•EcÂ÷FCãÇFCâr²†Æ—ÇÂrÒr’²ròr¶6’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)H"âdÄ”DDõ")H)H ¦gVæ7F–öâ6Æ5fÆ–FF÷"‚—·f"CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÅF—ôFö2r“òçfÇVWÇÂu%T2s·f"'V3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÅ'V2r“òçfÇVWÇÂrs·f"å#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÄæöÕ'V2r“òçfÇVWÇÂrs·f"Fæ“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÄFæ’r“òçfÇVWÇÂrs·f"äCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÄæöÔFæ’r“òçfÇVWÇÂrs·f"CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÄTFæ’r“òçfÇVWÇÂrs·f"fW#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÄ6ö–æ6–FVæ6–r“òçfÇVWÇÂtæòs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wfÆ–FF÷%&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚‡CÓÓÒu%T2wÇÇCÓÓÒtÖ&÷2r’bg'V2æÆVæwFƒãbg'V2æÆVæwF‚ÓÓ—¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7â7G–ÆSÒ&6öÆ÷#¢4S„##å%T3¢F–v—F÷2&WVW&–F÷3Â÷7ããÂöF—câs·&WGW&ã·Ö–b‚‡CÓÓÒtDä’wÇÇCÓÓÒtÖ&÷2r’bfFæ’æÆVæwFƒãbfFæ’æÆVæwF‚ÓÓ‚—¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7â7G–ÆSÒ&6öÆ÷#¢4S„##äDä“¢‚F–v—F÷2&WVW&–F÷3Â÷7ããÂöF—câs·&WGW&ã·Ö–b‡CÓÓÒu%T2rbb'V2—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·Ö–b‡CÓÓÒtDä’rbbFæ’—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·Ö–b‡CÓÓÒtÖ&÷2rbb'V2bbFæ’—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"&÷w3Òrs¶–b‡CÓÓÒu%T2wÇÇCÓÓÒtÖ&÷2r—·f"&S×'V2ç7V'7G&–ærƒÃ"“·f"F—ôVçC×&SÓÓÒssòuW'6öææGW&Âs§&SÓÓÒsRsòt6ö6–6–öâs§&SÓÓÒsrsòu6ö6–VFB6öç—VvÂs§&SÓÓÒs#sòuW'6öæ§W&–F–6s¢t÷G&òs·f"&Tö³Õ²srÂsRrÂsrrÂs#uÒæ–æ6ÇVFW2‡&R“·f"7VÖ×'6T–çB‡'V5³Ò’£R·'6T–çB‡'V5³Ò’£B·'6T–çB‡'V5³%Ò’£2·'6T–çB‡'V5³5Ò’£"·'6T–çB‡'V5³EÒ’£r·'6T–çB‡'V5³UÒ’£b·'6T–çB‡'V5³eÒ’£R·'6T–çB‡'V5³uÒ’£B·'6T–çB‡'V5³…Ò’£2·'6T–çB‡'V5³•Ò’£#·f"&W3×7VÖS·f"F–t3×&W3ÓÓÓó£×&W3·f"F–u#×'6T–çB‡'V5³Ò“·f"ö³×&Tö²bfF–t3ÓÓÖF–u#·&÷w2³ÒsÇG#ãÇFCå%T3Â÷FCãÇFCâr·'V2²sÂ÷FCãÇFCâr²†ö³òudÄ”Dòs¢t”ådÄ”Dòr’²sÂ÷FCãÇFCâr·F—ôVçB²sÂ÷FCãÂ÷G#âs·Ö–b‡CÓÓÒtDä’wÇÇCÓÓÒtÖ&÷2r—·f"Dö³ÖFæ’æÆVæwFƒÓÓÓ‚bbõåÆG³‡ÒBòçFW7B†Fæ’“·&÷w2³ÒsÇG#ãÇFCäDä“Â÷FCãÇFCâr¶Fæ’²sÂ÷FCãÇFCâr²†Dö³òudÄ”Dòs¢t”ådÄ”Dòr’²sÂ÷FCãÇFCâr²†Dö³òs‚F–v—F÷2s¢rr’²sÂ÷FCãÂ÷G#âs·×f"6ö–ãÒrs¶–b‡fW#ÓÓÒu6’rbgCÓÓÒtÖ&÷2rbg'V2bfFæ’bfå"bfäBbg'V2ç7V'7G&–ærƒÃ"“ÓÓÒsr—·f"å$ãÖå"çFôÆ÷vW$66R‚’ç&WÆ6R‚õÇ2²örÂrr“·f"äDãÒ†äB²rr¶B’çFôÆ÷vW$66R‚’ç&WÆ6R‚õÇ2²örÂrr“·f"ÖF6ƒÖå$âæ–æ6ÇVFW2†äDâ—ÇÆäDâæ–æ6ÇVFW2†å$â“¶6ö–ãÒsÇG#ãÇFCä6ö–æ6–FVæ6–Â÷FCãÇFB6öÇ7ãÒ#2#âr²†ÖF6ƒòt6ö–æ6–FVâs¢tæò6ö–æ6–FVâr’²sÂ÷FCãÂ÷G#âs·Ö"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇFƒäFö3Â÷FƒãÇFƒäçVÖW&óÂ÷FƒãÇFƒäW7FFóÂ÷FƒãÇFƒäFWFÆÆSÂ÷FƒãÂ÷G#âr·&÷w2¶6ö–â²sÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)H2â$T4”õ2E$å4dU$Tä4”)H)H ¦gVæ7F–öâ6Æ5&V6–÷5G&ç6b‚—·f"Ó×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wDÖöçFòr“òçfÇVR—ÇÃ·f"Ös×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wDÖ&vVâr“òçfÇVR—ÇÃ·f"5&sÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wD6ö×&&ÆW2r“òçfÇVWÇÂrs·f"–çGcÖFö7VÖVçBævWDVÆVÖVçD'”–B‚wD–çFW'fÆòr“òçfÇVWÇÂs“Rs·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚w&V6–÷5G&ç6e&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚×ÇÂÖwÇÂ5&rçG&–Ò‚’—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"çV×3Ö5&rç7Æ—B‚õµÂõÆâÃµÇ5Ò²ò’æÖ†gVæ7F–öâ‡2—·&WGW&â'6TfÆöB‡2çG&–Ò‚’“·Ò’æf–ÇFW"†gVæ7F–öâ†â—·&WGW&â—4æâ†â’bf—4f–æ—FR†â“·Ò“¶–b†çV×2æÆVæwFƒÃ"—¶"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7â7G–ÆSÒ&6öÆ÷#¢4S„##ä–æw&W6RÂÖVæ÷2"6ö×&&ÆW3Â÷7ããÂöF—câs·&WGW&ã·×f"6÷'FVCÕµÒæ6öæ6B†çV×2’ç6÷'B†gVæ7F–öâ†Æ"—·&WGW&âÖ#·Ò“·f"ã×6÷'FVBæÆVæwFƒ·f"Ö–ã×6÷'FVE³ÒÆÖƒ×6÷'FVE¶âÓÓ·f"ÖVCÖâS#ÓÓÓò‡6÷'FVE¶âó"ÓÒ·6÷'FVE¶âó%Ò’ó#§6÷'FVE´ÖF‚æfÆö÷"†âó"•Ó·f"Ç3¶–b†–çGcÓÓÒs“Rr—·f"Óã#R¢†â³’Ç3ÓãsR¢†â³“·×ÓÓÔÖF‚æfÆö÷"‡“÷6÷'FVE·ÓÓ§6÷'FVE´ÖF‚æfÆö÷"‡’ÓÒ²‡ÔÖF‚æfÆö÷"‡’’¢‡6÷'FVE´ÖF‚æfÆö÷"‡•Ò×6÷'FVE´ÖF‚æfÆö÷"‡’ÓÒ“·3×3ÓÓÔÖF‚æfÆö÷"‡2“÷6÷'FVE·2ÓÓ§6÷'FVE´ÖF‚æfÆö÷"‡2’ÓÒ²‡2ÔÖF‚æfÆö÷"‡2’’¢‡6÷'FVE´ÖF‚æfÆö÷"‡2•Ò×6÷'FVE´ÖF‚æfÆö÷"‡2’ÓÒ“·ÖVÇ6W·ÖÖ–ã·3ÖÖƒ·Ö–b†ãÃBbf–çGcÓÓÒs“Rr—·ÖÖ–ã·3ÖÖƒ·×f"FVçG&óÖÖsã×bfÖsÃ×3·f"£Ó¶–b‚FVçG&ò–£ÖÖsÇ÷ÖÖs§2ÖÖs·f"¤ÓÒ†¢ó’¦Ó·f"5&÷w3Òrs¶f÷"‡f"“Ó¶“Ç6÷'FVBæÆVæwFƒ¶’²²—¶5&÷w2³ÒsÇG#ãÇFCâr²†’³’²sÂ÷FCãÇFCâr·6÷'FVE¶•ÒçFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#âs·Ö"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#B#äæÆ—6—2FR&ævò–çFW&7V'F–ÃÂ÷FƒãÂ÷G#ãÇG#ãÇFCäâ6ö×&&ÆW3Â÷FCãÇFCâr¶â²sÂ÷FCãÇFCä–çFW'fÆóÂ÷FCãÇFCâr²†–çGcÓÓÒs“RsòuÕ2s¢tÖ–âÔÖ‚r’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCäÖ–æ–ÖóÂ÷FCãÇFCâr¶Ö–âçFôf—†VBƒ"’²rSÂ÷FCãÇFCäÖ†–ÖóÂ÷FCãÇFCâr¶Ö‚çFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFCåÂ÷FCãÇFCâr·çFôf—†VBƒ"’²rSÂ÷FCãÇFCå3Â÷FCãÇFCâr·2çFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFCäÖVF–æÂ÷FCãÇFB6öÇ7ãÒ#2#âr¶ÖVBçFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#ãÇG#ãÇFCå7RÖ&vVãÂ÷FCãÇFB6öÇ7ãÒ#2#âr¶ÖrçFôf—†VBƒ"’²rSÂ÷FCãÂ÷G#ãÇG"7G–ÆSÒ&&6¶w&÷VæC¢r²†FVçG&óòw&v&ƒsbÃsRÃƒÂã"’s¢w&v&ƒ#CBÃcrÃSBÂã"’r’²r#ãÇFCãÇ7G&öæså&W7VÇFFóÂ÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#2#âr²†FVçG&óòtFVçG&òFVÂ&ævòs¢tgVW&FVÂ&ævòr’²sÂ÷FCãÂ÷G#âr²†£ãòsÇG#ãÇFCä§W7FSÂ÷FCãÇFB6öÇ7ãÒ#2#âr¶¢çFôf—†VBƒ"’²rR…2òr¶¤ÒçFôf—†VBƒ"’²r“Â÷FCãÂ÷G#âs¢rr’²sÇG#ãÇF‚6öÇ7ãÒ#B#ä6ö×&&ÆW3Â÷FƒãÂ÷G#ãÇG#ãÇFƒâ3Â÷FƒãÇFƒåfÆ÷#Â÷FƒãÇF‚6öÇ7ãÒ#"#ãÂ÷FƒãÂ÷G#âr¶5&÷w2²sÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)HBâDTÕTÅD2)H)H ¦gVæ7F–öâ6Æ5DT×VÇF2‚’°¢6öç7B–V"ÒçVÖ&W"†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wFVæ–òr“òçfÇVRÇÂD…õ%TÄU2æ7W'&VçE–V"“°¢6öç7BVæ—G2ÒçVÖ&W"†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wFVV—G2r“òçfÇVRÇÂ“°¢6öç7Bæ÷F–f–VBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wFVfV6†æ÷F–br“òçfÇVRÇÂrs°¢6öç7B–BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wFVfV6†vòr“òçfÇVRÇÂrs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wFV×VÇF5&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢6öç7BV—BÒD…õ%TÄU2çV—E·–V%Ó°¢–b‚Væ—G2ÇÂV—BÇÂæ÷F–f–VBÇÂ–B’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B7F'BÒæWrFFR†æ÷F–f–VB“°¢6öç7BVæBÒæWrFFR‡–B“°¢6öç7BF—2ÒÖF‚æfÆö÷"‚†VæBÒ7F'B’òƒcC“°¢–b†F—2Â’°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7â7G–ÆSÒ&6öÆ÷#¢4S„##äÆfV6†FRvòFV&R6W"÷7FW&–÷"Ææ÷F–f–66œ;6âãÂ÷7ããÂöF—câs°¢&WGW&ã°¢Ğ¢6öç7B&–æ6—ÂÒVæ—G2¢V—C°¢6öç7BW6W4ÆVvÅ&FRÒ7F'BãÒæWrFFR…D…õ%TÄU2æf–æTÆVvÄ–çFW&W7Dg&öÒ²uC££r“°¢6öç7B–çFW&W7BÒW6W4ÆVvÅ&FRòçVÆÂ¢&–æ6—Â¢…D…õ%TÄU2çF–ÔF–Ç•W&6VçBò’¢F—3°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#"#äW7F–Ö6œ;6âFR×VÇFÂ÷FƒãÂ÷G#ãÇG#ãÇFCä;òòT•CÂ÷FCãÇFCâG·–V'Òò2òG·V—BçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#ãÇG#ãÇFCä6—FÃÂ÷FCãÇFCå2òG·&–æ6—ÂçFôf—†VBƒ"—Ò‚G·Væ—G7ÒT•B“Â÷FCãÂ÷G#ãÇG#ãÇFCäL:Ö3Â÷FCãÇFCâG¶F—7ÓÂ÷FCãÂ÷G#ãÇG#ãÇFCä–çFW,:—3Â÷FCãÇFCâG¶–çFW&W7BÓÓÒçVÆÂòu&WV–W&RF6FR–çFW,:—2ÆVvÂr¢u2òr²–çFW&W7BçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæsåF÷FÂW7F–ÖFóÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæsâG¶–çFW&W7BÓÓÒçVÆÂòuVæF–VçFRFRF6ÆVvÂr¢u2òr²‡&–æ6—Â²–çFW&W7B’çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÂ÷F&ÆSâG·W6W4ÆVvÅ&FRòsÇ7G–ÆSÒ&Ö&v–â×F÷£ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äFW6FRVÂóó##BÆD”Òæò6RÆ–6×VÇF3²6÷'&W7öæFRÆF6FR–çFW,:—2ÆVvÂâæò6R–çfVçFVæF6¢6öæf—&ÖVÂF÷FÂVâ5TäBò6öâÆF6ÆVvÂ4%2Æ–6&ÆRãÂ÷âr¢rwÓÂöF—cæ°§Ğ ¢òò)H)HRâ$ÕBe2$U")H)H ¦gVæ7F–öâ6Æ5$ÕE$U"‚’°¢6öç7B–æw&W6÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&×E÷&W%ö–æw&W6÷2r“òçfÇVR’ÇÂ°¢6öç7B6÷7F÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&×E÷&W%ö6÷7F÷2r“òçfÇVR’ÇÂ°¢6öç7B6ö×&2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&×E÷&W%ö6ö×&2r“òçfÇVR’ÇÂ°¢6öç7B7F—f–FDW†6ÇV–FÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&×E÷&W%÷6W'f–6–òr“òçfÇVRÓÓÒw6’s°¢6öç7B7F—f÷4W†6VF–F÷2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&×E÷&W%öf7GW&5öçBr“òçfÇVRÓÓÒw6’s°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&×E÷&W%&W7VÇBr“°¢–b‚&÷‚ÇÂ–æw&W6÷2’²–b†&÷‚’&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BV—BÒD…õ%TÄU2çV—EµD…õ%TÄU2æ7W'&VçE–V%Ó°¢6öç7B&VçFæWFÒÖF‚æÖ‚ƒÂ–æw&W6÷2Ò6÷7F÷2“°¢6öç7B&×D•"ÒÖF‚æÖ–â‡&VçFæWFÂR¢V—B’¢ã²ÖF‚æÖ‚ƒÂ&VçFæWFÒR¢V—B’¢ã#“S°¢6öç7B&W$•"Ò–æw&W6÷2¢ãS°¢6öç7B&×DVÆ–v–&ÆRÒ–æw&W6÷2ÃÒs¢V—C°¢6öç7B&W$VÆ–v–&ÆRÒ–æw&W6÷2ÃÒS#Sbb6ö×&2ÃÒS#Sbb7F—f–FDW†6ÇV–Fbb7F—f÷4W†6VF–F÷3°¢6öç7BF–ffW&Væ6RÒÖF‚æ'2‡&×D•"Ò&W$•"“°¢6öç7BÆ÷vW"Ò&×D•"ÃÒ&W$•"òu$ÕBr¢u$U"s°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSà¢ÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇFƒå$ÕCÂ÷FƒãÇFƒå$U#Â÷FƒãÂ÷G#à¢ÇG#ãÇFCä&6RW6FÂ÷FCãÇFCå&VçFæWF¢2òG·&VçFæWFçFôf—†VBƒ"—ÓÂ÷FCãÇFCä–æw&W6÷3¢2òG¶–æw&W6÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä•"çVÂW7F–ÖFóÂ÷FCãÇFCå2òG·&×D•"çFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·&W$•"çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäVÆVv–&–Æ–FB&VÆ–Ö–æ#Â÷FCãÇFCâG·&×DVÆ–v–&ÆRòtFVçG&òFVÂÌ:ÖÖ—FRFR–æw&W6÷2r¢tW†6VFRÃsT•BwÓÂ÷FCãÇFCâG·&W$VÆ–v–&ÆRòu6–âW†6ÇW6–öæW2FV6Æ&F2r¢tæòVÆVv–&ÆR6öâÆ÷2FF÷2–æw&W6F÷2wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäF–fW&Væ6–FR•#Â÷FCãÇFB6öÇ7ãÒ#"#âG¶Æ÷vW'Ò&W7VÇFÖVæ÷"÷"2òG¶F–ffW&Væ6RçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ·FF–æs£‡ƒ¶&6¶w&÷VæC§f"‚ÒÖF&³"“¶&÷&FW"×&F—W3£gƒ¶föçB×6—¦S£G‚#ä6ö×&6œ;6â&VfW&Væ6–ÂFR•"âVÂ”ubæò6R7VÖ6öÖò6÷7FòFVÂ,:–v–ÖVâ’ÆVÆV66œ;6âW†–vR&Wf—6"7F—f–FBÂ7F—f÷2Â6ö×&2Â6ö×&ö&çFW2’FVÜ:2W†6ÇW6–öæW2ãÂöF—cãÂöF—cæ°§Ğ ¢òò)H)HbâÔ¤ôä”)H)H ¦gVæ7F–öâ6Æ4Ö¦öæ–‚—·f"£ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ¦öæ–÷¦öær“òçfÇVWÇÂvÖ¦öæ–s·f"&cÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ¦öæ–ö&VæVf–6–òr“òçfÇVWÇÂwFöFòs·f"–æs×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ¦öæ–ö–æw&W6÷2r“òçfÇVR—ÇÃ·f"7C×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ¦öæ–÷7Br“òçfÇVR—ÇÃ·f"fVãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ¦öæ–÷fVçFr“òçfÇVWÇÂvæòs·f"6öãÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ¦öæ–ö6öç7F—GV–Fr“òçfÇVWÇÂw6’s·f"&÷ƒÖFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ¦öæ–&W7VÇBr“¶–b‚&÷‚—&WGW&ã¶–b‚–æwÇÂ7B—¶&÷‚ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"•£Ö–ær§7Bó·f"–wdÖ•¢£ã‚óãƒ·f"¦öæ3×¶Ö¦öæ–§¶æöÖ'&S¢tÖ¦öæ–„ÆW’#s3r’rÆ–wc§G'VRÆ—%#§G'VRÆ—$S§G'VRÆ7&VC§G'VRÇF6•#¢sRrÆÆVvÃ¢tÆW’#s3rwÒÆ6WF–6÷3§¶æöÖ'&S¢t4UD”4õ2„ÆW’#scƒ‚’rÆ–wc§G'VRÆ—%#§G'VRÆ—$S¦fÇ6RÆ7&VC¦fÇ6RÇF6•#¢sRRrÆÆVvÃ¢tÆW’#scƒ‚wÒÇ¦ögF6æ§¶æöÖ'&S¢u¤ôe$D4ärÆ–wc§G'VRÆ—%#§G'VRÆ—$S¦fÇ6RÆ7&VC¦fÇ6RÇF6•#¢sRRrÆÆVvÃ¢tE2wÒÆÇFöæF–æ§¶æöÖ'&S¢tÇFöæF–ærÆ–wc¦fÇ6RÆ—%#§G'VRÆ—$S¦fÇ6RÆ7&VC¦fÇ6RÇF6•#¢sÓRRrÆÆVvÃ¢tÆW’#scƒ‚wÒÆg&öçFW&—¦§¶æöÖ'&S¢tg&öçFW&—¦æ÷'FRrÆ–wc§G'VRÆ—%#§G'VRÆ—$S¦fÇ6RÆ7&VC¦fÇ6RÇF6•#¢sRRrÆÆVvÃ¢tÆW’#scƒ‚w×Ó·f"¦ó×¦öæ5·¥×ÇÇ¦öæ2æÖ¦öæ–·f"”uc×¦òæ–wbbb†&cÓÓÒwFöFòwÇÆ&cÓÓÒv–wbr“·f"•#×¦òæ—%"bb†&cÓÓÒwFöFòwÇÆ&cÓÓÒv—%÷&VGV6–Fr“·f"•&Wƒ×¦òæ—$Rbb†&cÓÓÒwFöFòwÇÆ&cÓÓÒv—%öW†öæW&Fòr“·f"7&VC×¦òæ7&VBbb†&cÓÓÒwFöFòwÇÆ&cÓÓÒv7&VF—Fòr“·f"—$ÓÆ—%G‡CÒtæòÆ–6s¶–b†•&W‚bg£ÓÓÒvÖ¦öæ–rbf6öãÓÓÒw6’r—¶—%G‡CÒt•"W†öæW&Fòæ–÷2s¶—$Ö•¢£ã#“S·ÖVÇ6R–b†•"—¶—$Ö•¢¢ƒã#“R×'6TfÆöB‡¦òçF6•"’ó“¶—%G‡CÒuF6&VGV6–F¢r·¦òçF6•#·×f"†÷'&óÒ†”ucö–wd£’¶—$¶&÷‚ç7G–ÆRæF—7Æ“Òv&Æö6²s¶&÷‚æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSãÇG#ãÇF‚6öÇ7ãÒ#"#âr·¦òææöÖ'&R²sÂ÷FƒãÂ÷G#ãÇG#ãÇFCä&6RÆVvÃÂ÷FCãÇFCâr·¦òæÆVvÂ²sÂ÷FCãÂ÷G#ãÇG#ãÇFCä–æw&W6÷2¦öæÂ÷FCãÇFCå2òr¶•¢çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCäW†öæW&6–öâ”ucÂ÷FCãÇFCâr²†”ucòu2òr¶–wdçFôf—†VBƒ"“¢tæòÆ–6r’²sÂ÷FCãÂ÷G#ãÇG#ãÇFCä&VæVf–6–ò•#Â÷FCãÇFCâr¶—%G‡B²sÂ÷FCãÂ÷G#ãÇG#ãÇFCãÇ7G&öæsä†÷'&òF÷FÃÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òr¶†÷'&òçFôf—†VBƒ"’²sÂ÷7G&öæsãÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—câs·Ğ ¢òò)H)Hrâ•DâDUDÄÄR)H)H ¦gVæ7F–öâ6Æ4•DäFWFÆÆR‚—·f"7C×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæEö7F—f÷2r“òçfÇVR—ÇÃ·f"FVC×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæEöFVGV66–öæW2r“òçfÇVR—ÇÃ·f"–æÓ×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæEö–æ×VV&ÆW2r“òçfÇVR—ÇÃ·f"3×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæE÷6—f÷2r“òçfÇVR—ÇÃ·f"ÖÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæEöÖ¦öæ–r“òçfÇVWÇÂvæòs·f"sÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæE÷vòr“òçfÇVWÇÂv6öçFFòs·f"7&VCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæEö7&VF—Fòr“òçfÇVWÇÂw6’s·f"#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v—FæE&W7VÇBr“¶–b‚"—&WGW&ã¶–b‚7B—¶"ç7G–ÆRæF—7Æ“ÒvæöæRs·&WGW&ã·×f"&6SÔÖF‚æÖ‚ƒÆ7BÖFVBÓ“·f"W†óÖÖÓÓÒw6’s·f"—FãÖW†óó¦&6R£ãC·f"ÖW6W3Õ²t'"rÂtÖ’rÂt§VârÂt§VÂrÂtvòrÂu6WBrÂtö7BrÂtæ÷brÂtF–2uÓ·f"7&öãÒrrÇF÷D3Ó¶–b‡sÓÓÒv6öçFFòr—¶7&öãÒsÇG#ãÇFCä'&–ÃÂ÷FCãÇFCå2òr¶—FâçFôf—†VBƒ"’²sÂ÷FCãÇFCåVæ–6óÂ÷FCãÂ÷G#âs·F÷D3Ö—Fã·ÖVÇ6W·f"7VóÖ—Fâó’Ç&VÓÖ—Fã¶f÷"‡f"“Ó¶“Ã“¶’²²—·f"ÖöçFóÖ“ÃƒôÖF‚æfÆö÷"†7Vò£’ó§&VÓ·&VÒÓÖÖöçFó·F÷D2³ÖÖöçFó¶7&öâ³ÒsÇG#ãÇFCâr¶ÖW6W5¶•Ò²sÂ÷FCãÇFCå2òr¶ÖöçFòçFôf—†VBƒ"’²sÂ÷FCãÇFCä7V÷Fr²†’³’²ró“Â÷FCãÂ÷G#âs·×Ö"ç7G–ÆRæF—7Æ“Òv&Æö6²s¶"æ–ææW$…DÔÃÒsÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"g#¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£ƒ·FF–æs£ƒ¶&6¶w&÷VæC§f"‚ÒÖF&³"“¶&÷&FW"×&F—W3£g‚#ãÆF—cãÇ7G&öæsä&6R•DãÂ÷7G&öæsãÆ'#å2òr¶&6RçFôf—†VBƒ"’²sÂöF—cãÆF—cãÇ7G&öæsä•DâãBSÂ÷7G&öæsãÆ'#å2òr¶—FâçFôf—†VBƒ"’²sÂöF—cãÆF—cãÇ7G&öæsä7F—f÷3Â÷7G&öæsãÆ'#å2òr²†7BÖFVB’çFôf—†VBƒ"’²sÂöF—cãÆF—cãÇ7G&öæsäÖ¦öæ–Â÷7G&öæsãÆ'#âr²†W†óòtW†öæW&Fs¢tæòr’²sÂöF—cãÂöF—câr²†W†óòsÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£ƒ·FF–æs£‡ƒ¶&6¶w&÷VæC§&v&ƒsbÃsRÃƒÂã"“¶&÷&FW"×&F—W3£G‚#äW†öæW&Fò•Dâ„ÆW’#s3r“ÂöF—câs¢rr’²sÇF&ÆSãÇG#ãÇFƒäÖW3Â÷FƒãÇFƒäÖöçFóÂ÷FƒãÇFƒä7V÷FÂ÷FƒãÂ÷G#âr¶7&öâ²sÇG"7G–ÆSÒ&föçB×vV–v‡C£c#ãÇFB6öÇ7ãÒ#"#åF÷FÃ¢2òr·F÷D2çFôf—†VBƒ"’²sÂ÷FCãÇFCâr²‡sÓÓÒv6öçFFòsòt6öçFFòs¢s’7V÷F2r’²sÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ·FF–æs£‡ƒ¶&6¶w&÷VæC§f"‚ÒÖF&³"“¶&÷&FW"×&F—W3£gƒ¶föçB×6—¦S£G‚#ä7&VF—Fò6öçG&•#¢r²†7&VCÓÓÒw6’rbf—Fããòu2òr¶—FâçFôf—†VBƒ"“¢tæòÆ–6r’²sÂöF—cãÂöF—câs·Ğ¢òò)H)Hâ%U2)H)H ¦gVæ7F–öâ6Æ5'W2‚’°¢6öç7B–æw&W6÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w'W5ö–æw&W6÷2r“òçfÇVR’ÇÂ°¢6öç7B6D7GVÂÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w'W5ö6FVv÷&–r“òçfÇVR’ÇÂ°¢6öç7B7F—f–FBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'W5ö7F—f–FBr“òçfÇVRÇÂv6öÖW&6–òs°¢6öç7BVÖ—FTf7GW&ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'W5öf7GW&r“òçfÇVRÇÂvæòs°¢6öç7BF–VæTÆö6ÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'W5öÆö6Âr“òçfÇVRÇÂvæòs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'W5&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚–æw&W6÷2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢ÆWB6E7VvW&–FÒÂ7V÷FÒÂF÷RÒ°¢–b†–æw&W6÷2ÃÒS’²6E7VvW&–FÒ²7V÷FÒ#²F÷RÒc²Ğ¢VÇ6R–b†–æw&W6÷2ÃÒƒ’²6E7VvW&–FÒ#²7V÷FÒS²F÷RÒ“c²Ğ¢VÇ6R²6E7VvW&–FÒ²7V÷FÒ²F÷RÒ²Ğ¢6öç7BvõG&–ÖW7G&ÂÒ7V÷F¢3°¢6öç7BvôçVÂÒ7V÷F¢#°¢6öç7B6D7GVÄæöÖ'&RÒ6D7GVÂâòt6Br²6D7GVÂ¢tæò&Vv—7G&Fòs°¢6öç7B6E7VvW&–FæöÖ'&RÒ6E7VvW&–Fâòt6Br²6E7VvW&–F¢tW†6VFRÌ:ÖÖ—FRå%U2s°¢6öç7BVVFT6övW'6RÒ6E7VvW&–FâbbVÖ—FTf7GW&ÓÓÒvæòs°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×vV–v‡C£c¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#§f"‚ÒÖ&r“¶&÷&FW"×&F—W3£g‚g‚"6öÇ7ãÒ#"#å&W7VÇFFò%U2(	B–æw&W6÷22òG¶–æw&W6÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä6FVv÷,:Ö7GVÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#âG¶6D7GVÄæöÖ'&WÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä6FVv÷,:Ö7VvW&–FÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#âG¶6E7VvW&–FæöÖ'&WÓÂ÷FCãÂ÷G#à¢G¶6E7VvW&–Fâò ¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä7V÷FÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG¶7V÷FçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åvòG&–ÖW7G&ÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG·võG&–ÖW7G&ÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åvòçVÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG·vôçVÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åF÷RÜ:‚âf7GW&6œ;6âçVÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG·F÷RçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ì+õVVFR6övW'6SóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢G·VVFT6övW'6Ròwf"‚ÒÖw&VVâ’r¢r6SsF362wÒ#âG·VVFT6övW'6Ròu<:Òr¢tæò†VÖ—FRf7GW&2òW†6VFRÌ:ÖÖ—FR’wÓÂ÷FCãÂ÷G#à¢¢sÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#¢6SsF362"6öÇ7ãÒ#"#î)ª–æw&W6÷2W†6VFVâ2ò‚ÃÖVç7VÆW2(	BæòÆ–6å%U3Â÷FCãÂ÷G#âwĞ¢Â÷F&ÆSà¢ÂöF—cæ°§Ğ ¢òò)H)H"â4”U%$Rd•44Â)H)H ¦gVæ7F–öâ6Æ46–W'&Tf—66Â‚’°¢6öç7Bæ–òÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6eöæ–òr“òçfÇVR’ÇÂ##c°¢6öç7B–æw&W6÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6eö–æw&W6÷2r“òçfÇVR’ÇÂ°¢6öç7B6÷7FòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6eö6÷7Fòr“òçfÇVR’ÇÂ°¢6öç7Bv7F÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6eöv7F÷2r“òçfÇVR’ÇÂ°¢6öç7B–we&öÒÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6eö–wbr“òçfÇVR’ÇÂ°¢6öç7B—%vFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6eö—%÷vFòr“òçfÇVR’ÇÂ°¢6öç7BW&6W6–öæW2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6e÷W&6W6–öæW2r“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6e&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚–æw&W6÷2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BWF–Æ–FBÒ–æw&W6÷2Ò6÷7FòÒv7F÷3°¢6öç7BF6•"Òæ–òãÒ##Bòã#“R¢ã3°¢6öç7B—$6Æ7VÆFòÒÖF‚æÖ‚ƒÂWF–Æ–FB¢F6•"“°¢6öç7BF–d•"Ò—$6Æ7VÆFòÒ—%vFó°¢6öç7B–wdçVÂÒ–we&öÒ¢#°¢6öç7BF÷FÅG&–'WF÷2Ò—$6Æ7VÆFò²–wdçVÂ²W&6W6–öæW3°¢6öç7B&F–õG&–'WF&–òÒ‡F÷FÅG&–'WF÷2ò–æw&W6÷2’¢°¢6öç7B7D•%WF–Æ–FBÒWF–Æ–FBâò†—$6Æ7VÆFòòWF–Æ–FB’¢¢°¢6öç7B6ÆFôff÷"ÒF–d•"ÂòÖF‚æ'2†F–d•"’¢°¢6öç7BFWVFÒF–d•"âòF–d•"¢°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×vV–v‡C£c¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#§f"‚ÒÖ&r“¶&÷&FW"×&F—W3£g‚g‚"6öÇ7ãÒ#"#ä6–W'&Rf—66ÂG¶æ–÷ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åWF–Æ–FBæWFÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG·WF–Æ–FBçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åF6•#Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#âG²‡F6•"¢’çFôf—†VBƒ—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä•"6Æ7VÆFóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG¶—$6Æ7VÆFòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä•"vFóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å2òG¶—%vFòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#äF–fW&Væ6–•#Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢G¶F–d•"ãÒòr6SsF362r¢wf"‚ÒÖw&VVâ’wÒ#âG¶F–d•"ãÒòtFWVF¢2òr²FWVFçFôf—†VBƒ"’¢u6ÆFòff÷#¢2òr²6ÆFôff÷"çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä”ubçVÂW7F–ÖFóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG¶–wdçVÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åW&6W6–öæW3Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å2òG·W&6W6–öæW2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä6&vG&–'WF&–F÷FÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG·F÷FÅG&–'WF÷2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å&F–òG&–'WF&–óÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#âG·&F–õG&–'WF&–òçFôf—†VBƒ"—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#âR•"òWF–Æ–FCÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#âG·7D•%WF–Æ–FBçFôf—†VBƒ"—ÒSÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÂöF—cæ°§Ğ ¢òò)H)H2âD”Ò„•5L95$”4ò)H)H ¦gVæ7F–öâ6Æ5F–Ò‚’°¢6öç7Bæ–òÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wF–Õöæ–òr“òçfÇVR’ÇÂ##c°¢6öç7BÖW4–æ’Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wF–ÕöÖW5ö–æ’r“òçfÇVR’ÇÂ°¢6öç7BÖW4f–âÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wF–ÕöÖW5öf–âr“òçfÇVR’ÇÂ#°¢6öç7BFWVFÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wF–ÕöFWVFr“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wF–Ô†—7E&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚FWVFÇÂÖW4–æ’âÖW4f–â’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BF–Õ&FW2Ò²##c¢ã"Â##S¢ã"Â##C¢ã2Â##3¢ãRÂ###¢ã‚Â##¢ã‚Â##¢"ãÂ#“¢"ã"Â#ƒ¢"ãRÂ#s¢"ã‚Â#c¢2ãÂ#S¢2ãRÓ°¢6öç7BF6D”ÒÒF–Õ&FW5¶æ–õÒÇÂã#°¢6öç7BF6FV6–ÖÂÒF6D”Òò°¢ÆWBF÷FÄ–çFW&W2Ò°¢ÆWB&÷w2Òrs°¢f÷"†ÆWBÒÒÖW4–æ“²ÒÃÒÖW4f–ã²Ò²²’°¢6öç7B–çFW&W4ÖW2ÒFWVF¢F6FV6–ÖÃ°¢F÷FÄ–çFW&W2³Ò–çFW&W4ÖW3°¢6öç7BÖW6W2Ò²tVæW&òrÂtfV'&W&òrÂtÖ'¦òrÂt'&–ÂrÂtÖ–òrÂt§Væ–òrÂt§VÆ–òrÂtv÷7FòrÂu6WF–VÖ'&RrÂtö7GV'&RrÂtæ÷f–VÖ'&RrÂtF–6–VÖ'&RuÓ°¢&÷w2³ÒÇG#ãÇFB7G–ÆSÒ'FF–æs£7‚g‚#âG¶ÖW6W5¶ÒÒ×ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£7‚g‚#âG·F6D”ÒçFôf—†VBƒ—ÒSÂ÷FCãÇFB7G–ÆSÒ'FF–æs£7‚g‚#å2òG¶–çFW&W4ÖW2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#æ°¢Ğ¢6öç7BFWVFF÷FÂÒFWVF²F÷FÄ–çFW&W3°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×vV–v‡C£c¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#§f"‚ÒÖ&r“¶&÷&FW"×&F—W3£g‚g‚"6öÇ7ãÒ#2#åD”ÒG¶æ–÷Ò(	BF6¢G·F6D”×ÒRÖVç7VÃÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c"6öÇ7ãÒ#2#äFWVF÷&–v–æÃ¢2òG¶FWVFçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢G·&÷w7Ğ¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#åF÷FÂ–çFW&W6W3Â÷FCãÇFB6öÇ7ãÒ#""7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢6SsF362#å2òG·F÷FÄ–çFW&W2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#äFWVFF÷FÂ7GVÆ—¦FÂ÷FCãÇFB6öÇ7ãÒ#""7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG¶FWVFF÷FÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÂöF—cæ°§Ğ ¢òò)H)HBâ4ôÕTå44œ94âDUTD2)H)H ¦gVæ7F–öâ6Æ46ö×Vç66–öâ‚’°¢6öç7B6ÆFôff÷"Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×÷6ÆFòr“òçfÇVR’ÇÂ°¢6öç7BFWVF&–æ6—ÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×öFWVFr“òçfÇVR’ÇÂ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×÷F—òr“òçfÇVRÇÂt•"s°¢6öç7B–çFW&W6W2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×ö–çFW&W6W2r“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö×Vç66–öå&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚6ÆFôff÷"ÇÂFWVF&–æ6—Â’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BFWVFF÷FÂÒFWVF&–æ6—Â²–çFW&W6W3°¢6öç7BÖöçFô6ö×Vç6FòÒÖF‚æÖ–â‡6ÆFôff÷"ÂFWVFF÷FÂ“°¢6öç7B6ÆFõVæF–VçFRÒFWVFF÷FÂÒÖöçFô6ö×Vç6Fó°¢6öç7B†÷'&òÒÖöçFô6ö×Vç6Fó°¢6öç7B6ÆFôff÷%&W7FçFRÒ6ÆFôff÷"ÒÖöçFô6ö×Vç6Fó°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×vV–v‡C£c¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#§f"‚ÒÖ&r“¶&÷&FW"×&F—W3£g‚g‚"6öÇ7ãÒ#"#ä6ö×Vç66œ;6â(	BFWVFG·F—÷ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å6ÆFòff÷#Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òG·6ÆFôff÷"çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#äFWVF&–æ6—ÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å2òG¶FWVF&–æ6—ÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä–çFW&W6W2vVæW&F÷3Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å2òG¶–çFW&W6W2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#äFWVFF÷FÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG¶FWVFF÷FÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#äÖöçFò6ö×Vç6FóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òG¶ÖöçFô6ö×Vç6FòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å6ÆFòVæF–VçFSÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢G·6ÆFõVæF–VçFRâòr6SsF362r¢wf"‚ÒÖw&VVâ’wÒ#âG·6ÆFõVæF–VçFRâòu2òr²6ÆFõVæF–VçFRçFôf—†VBƒ"’¢u2òã„6æ6VÆFò’wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä†÷'&ò÷"6ö×Vç66œ;6ãÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òG¶†÷'&òçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å6ÆFòff÷"&W7FçFSÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å2òG·6ÆFôff÷%&W7FçFRçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÂöF—cæ°§Ğ ¢òò)H)HRâU„ôäU$4œ94âDUE$44œ94â)H)H ¦gVæ7F–öâ6Æ4W†öäFWG&66–öâ‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW†öå÷F—òr“òçfÇVRÇÂv&–Vâs°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vW†öåöÖöçFòr“òçfÇVR’ÇÂ°¢6öç7B6FVv÷&–ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW†öåö6FVv÷&–r“òçfÇVRÇÂvÆ–ÖVçF÷2s°¢6öç7B–æ6ÇW–T”ubÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW†öåö–wbr“òçfÇVRÇÂw6’s°¢6öç7BF÷RÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vW†öå÷F÷Rr“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW†öå&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚ÖöçFò’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BF62Ò²&–Vã¢ãÂ6W'f–6–ó¢ã"Â6öç7G'V66–öã¢ãRÓ°¢6öç7BW†öæW&6–öæW2Ò²Æ–ÖVçF÷3¢²F÷S¢sÂW†öæW&Fó¢G'VRÂæöÖ'&S¢tÆ–ÖVçF÷2W&V6–&ÆW2rÒÂ6öÖ'W7F–&ÆW3¢²F÷S¢CÂW†öæW&Fó¢G'VRÂæöÖ'&S¢t6öÖ'W7F–&ÆW2rÒÂ6öÖ—6–öã¢²F÷S¢ÂW†öæW&Fó¢G'VRÂæöÖ'&S¢t6öÖ—6œ;6âÖW&6çF–ÂrÒÂÖ–æW&ÆW3¢²F÷S¢ÂW†öæW&Fó¢fÇ6RÂæöÖ'&S¢tÖ–æW&ÆW2rÒÂG&ç7÷'FS¢²F÷S¢ÂW†öæW&Fó¢fÇ6RÂæöÖ'&S¢uG&ç7÷'FRrÒÂ÷G&÷3¢²F÷S¢ÂW†öæW&Fó¢fÇ6RÂæöÖ'&S¢t÷G&26FVv÷,:Ö2rÒÓ°¢6öç7BW†òÒW†öæW&6–öæW5¶6FVv÷&–ÒÇÂW†öæW&6–öæW2æ÷G&÷3°¢6öç7BÖöçFô&6RÒ–æ6ÇW–T”ubÓÓÒw6’ròÖöçFòòã‚¢ÖöçFó°¢6öç7BW†öæW&FòÒW†òæW†öæW&Fòbb†W†òçF÷RÓÓÒÇÂÖöçFô&6RÃÒW†òçF÷R“°¢6öç7BF6Æ–6&ÆRÒW†öæW&Fòò¢‡F65·F—õÒÇÂã“°¢6öç7BÖöçFôFWG&W"ÒW†öæW&Fòò¢ÖöçFô&6R¢F6Æ–6&ÆS°¢ÆWB&6TÆVvÂÒrs°¢–b†W†öæW&Fòbb6FVv÷&–ÓÓÒvÆ–ÖVçF÷2r’&6TÆVvÂÒu&W2âƒ2Ó#Rõ5TäB(	BÆ–ÖVçF÷2W&V6–&ÆW2Â2òss°¢VÇ6R–b†W†öæW&Fòbb6FVv÷&–ÓÓÒv6öÖ'W7F–&ÆW2r’&6TÆVvÂÒu&W2âƒ2Ó#Rõ5TäB(	B6öÖ'W7F–&ÆW2Â2òCs°¢VÇ6R–b†W†öæW&Fòbb6FVv÷&–ÓÓÒv6öÖ—6–öâr’&6TÆVvÂÒtÆW’#ƒ“B(	B6öÖ—6œ;6âÖW&6çF–ÂW†öæW&Fs°¢VÇ6R&6TÆVvÂÒu&W2âƒ2Ó#Rõ5TäB’æ÷&Ö25õBs°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×vV–v‡C£c¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#§f"‚ÒÖ&r“¶&÷&FW"×&F—W3£g‚g‚"6öÇ7ãÒ#"#äFWG&66œ;6â5õB(	BG·F—òæ6†$Bƒ’çFõWW$66R‚’²F—òç6Æ–6Rƒ—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä6FVv÷,:ÖÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#âG¶W†òææöÖ'&WÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#äÖöçFò&6R‡6–â”ub“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#å2òG¶ÖöçFô&6RçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#ì+ôW†öæW&FóóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶föçB×6—¦S£Wƒ¶6öÆ÷#¢G¶W†öæW&Fòòwf"‚ÒÖw&VVâ’r¢r6SsF362wÒ#âG¶W†öæW&Fòò~)ÈR<8Ò(	BW†öæW&Fòr¢~)ØÂäò(	BÆ–6FWG&66œ;6âwÓÂ÷FCãÂ÷G#à¢G²W†öæW&FòòÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åF6Æ–6&ÆSÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c#âG²‡F6Æ–6&ÆR¢’çFôf—†VBƒ—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢6SsF362#äÖöçFòFWG&W#Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C£c¶6öÆ÷#¢6SsF362#å2òG¶ÖöçFôFWG&W"çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#æ¢rwĞ¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#ä&6RÆVvÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âG¶&6TÆVvÇÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÂöF—cæ°§Ğ ¢òò)H)Hbâ$T5U%4òÕTÅD5TäB)H)H ¦gVæ7F–öâ6Æ5&V7W'6ô×VÇF‚’°¢6öç7BV—G2ÒD…õ%TÄU2çV—C°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&Õ÷F—òr“òçfÇVRÇÂw&V6ÆÖ6–öâs°¢6öç7B×VÇFV—BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Õ÷V—Br“òçfÇVR’ÇÂ°¢6öç7Bæ–òÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Õöæ–òr“òçfÇVR’ÇÂ##S°¢6öç7B–æg&66–öâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&Õö–æg&66–öâr“òçfÇVRÇÂvf÷&ÖÂs°¢6öç7BfV4æ÷F–bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&ÕöfV5öæ÷F–br“òçfÇVRÇÂrs°¢6öç7BfV4–çFW'ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&ÕöfV5ö–çFW'r“òçfÇVRÇÂrs°¢6öç7Bg&66–öâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&Õög&66–öâr“òçfÇVRÇÂvæòs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&Õ&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚×VÇFV—BÇÂfV4æ÷F–bÇÂfV4–çFW'’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BV—EfÆ÷"ÒV—G5¶æ–õÒÇÂS3S°¢6öç7B×VÇF6öÆW2Ò×VÇFV—B¢V—EfÆ÷#°¢6öç7BCÒæWrFFR†fV4æ÷F–b’ÂC"ÒæWrFFR†fV4–çFW'“°¢6öç7BF–feF–ÖRÒÖF‚æ'2†C"ÒC“°¢6öç7BF–fdF—2ÒÖF‚æ6V–Â†F–feF–ÖRòƒ¢c¢c¢#B’“°¢6öç7BF–4†&–ÆW2ÒÖF‚ç&÷VæB†F–fdF—2¢Ròr“°¢6öç7BW6W4ÆVvÅ&FRÒCãÒæWrFFR…D…õ%TÄU2æf–æTÆVvÄ–çFW&W7Dg&öÒ²uC££r“°¢6öç7B–çFW&W2ÒW6W4ÆVvÅ&FRòçVÆÂ¢×VÇF6öÆW2¢…D…õ%TÄU2çF–ÔF–Ç•W&6VçBò’¢F–fdF—3°¢6öç7BF÷FÅv"Ò–çFW&W2ÓÓÒçVÆÂòçVÆÂ¢×VÇF6öÆW2²–çFW&W3°¢6öç7BÆ¦÷2Ò²&V6ÆÖ6–öã¢²Öƒ¢#ÂFW63¢s#L:Ö2Œ:&–ÆW2rÒÂVÆ6–öã¢²Öƒ¢RÂFW63¢sRL:Ö2Œ:&–ÆW2rÒÂVV'&çFÖ–VçFó¢²Öƒ¢ÂFW63¢tæòÆ–6rÒÓ°¢6öç7BÒÆ¦÷5·F—õÓ°¢6öç7BFVçG&õÆ¦òÒæÖ‚ÓÓÒòtâôr¢F–4†&–ÆW2ÃÒæÖ‚ò~)ÈRFVçG&òFRÆ¦òr¢~)ØÂgVW&FRÆ¦òs°¢6öç7B&V5FW‡BÒ²&V6ÆÖ6–öã¢u&V6ÆÖ6œ;6ârÂVÆ6–öã¢tVÆ6œ;6ârÂVV'&çFÖ–VçFó¢uVV'&çFÖ–VçFòrÕ·F—õÓ°¢6öç7B–æeFW‡BÒ²f÷&ÖÃ¢tf÷&ÖÂrÂ7W7Fæ6–Ã¢u7W7Fæ6–ÂrÕ¶–æg&66–öåÓ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆSà¢ÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇFƒåfÆ÷#Â÷FƒãÂ÷G#à¢ÇG#ãÇFCåF—òFR&V7W'6óÂ÷FCãÇFCâG·&V5FW‡GÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåF—òFR–æg&66œ;6ãÂ÷FCãÇFCâG¶–æeFW‡GÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä×VÇFVâT•CÂ÷FCãÇFCâG¶×VÇFV—GÒT•CÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåfÆ÷"T•BG¶æ–÷ÓÂ÷FCãÇFCå2òG·V—EfÆ÷"çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsäÖöçFò×VÇFVâ2óÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG¶×VÇF6öÆW2çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäL:Ö26ÆVæF&–óÂ÷FCãÇFCâG¶F–fdF—7ÒL:Ö3Â÷FCãÂ÷G#à¢ÇG#ãÇFCäL:Ö2Œ:&–ÆW2W7F–ÖF÷3Â÷FCãÇFCâG¶F–4†&–ÆW7ÒL:Ö3Â÷FCãÂ÷G#à¢ÇG#ãÇFCåÆ¦òÜ:†–ÖóÂ÷FCãÇFCâG·æFW67ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäW7FFòFVÂÆ¦óÂ÷FCãÇFCâG¶FVçG&õÆ¦÷ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä–çFW&W6W3Â÷FCãÇFCâG¶–çFW&W2ÓÓÒçVÆÂòu&WV–W&RF6FR–çFW,:—2ÆVvÂr¢u2òr²–çFW&W2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsåF÷FÂW7F–ÖFóÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæsâG·F÷FÅv"ÓÓÒçVÆÂòuVæF–VçFRFRF6ÆVvÂr¢u2òr²F÷FÅv"çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäg&66–öæÖ–VçFóÂ÷FCãÇFCâG¶g&66–öâÓÓÒw6’rò~)ÈR<:Òr¢~)ØÂæòwÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FF–æs£'ƒ¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶&÷&FW"×&F—W3£g‚#âG·W6W4ÆVvÅ&FRòtFW6FRVÂóó##B6÷'&W7öæFR–çFW,:—2ÆVvÂÂæòD”Òâ6öæf—&ÖÆF6’VÂÆ¦òçFW2FR&W6VçF"VÂ&V7W'6òâr¢tÆ÷2L:Ö2Œ:&–ÆW26öâVæ&÷†–Ö6œ;6â’æòFW67VVçFâfW&–F÷2æ’7W7Vç6–öæW2âwÓÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)Hrâ4ÄDòddõ"U…õ%DDõ")H)H ¦gVæ7F–öâ6Æ56ÆFôW‡÷'B‚’°¢6öç7Bfö%W6BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6Uöfö"r“òçfÇVR’ÇÂ°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6U÷F2r“òçfÇVR’ÇÂ°¢6öç7B–ç4–×Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6Uö–ç5ö–×r“òçfÇVR’ÇÂ°¢6öç7B–ç4æ2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6Uö–ç5öæ2r“òçfÇVR’ÇÂ°¢6öç7B–wd6ö×Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6Uö–weö6ö×r“òçfÇVR’ÇÂ°¢6öç7B–wefVçBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6Uö–we÷fVçBr“òçfÇVR’ÇÂ°¢6öç7B7DG&v&6²Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w6UöG&v&6µ÷7Br“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w6U&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚fö%W6BÇÂF2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7Bfö%6öÆW2Òfö%W6B¢F3°¢6öç7B6ÆFôff÷$”ubÒÖF‚æÖ‚ƒÂ–wd6ö×Ò–wefVçB“°¢6öç7BG&v&6²Òfö%6öÆW2¢7DG&v&6²ò°¢6öç7B6÷7EF÷FÂÒ–ç4–×²–ç4æ3°¢6öç7BÆ–Ö—FTG&v&6²Ò6÷7EF÷FÂ¢ãS°¢6öç7B&V7WW&6–öäÖ‚ÒÖF‚æÖ–â†G&v&6²ÂÆ–Ö—FTG&v&6²“°¢6öç7BVVFT6övW'6RÒ6÷7EF÷FÂâbbfö%6öÆW2â°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆSà¢ÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇFƒåfÆ÷#Â÷FƒãÂ÷G#à¢ÇG#ãÇFCåfÆ÷"dô"W‡÷'FFóÂ÷FCãÇFCåU4BG¶fö%W6BçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåfÆ÷"dô"Vâ2ò…D2G·F7Ò“Â÷FCãÇFCå2òG¶fö%6öÆW2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä”ubFRW‡÷'F6œ;6ãÂ÷FCãÇFCãR‡F6“Â÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæså6ÆFòff÷"”ucÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG·6ÆFôff÷$”ubçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäG&v&6²‚G·7DG&v&6·ÒRFRdô"“Â÷FCãÇFCå2òG¶G&v&6²çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä6÷7FòF÷FÂ–ç7VÖ÷3Â÷FCãÇFCå2òG¶6÷7EF÷FÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäÌ:ÖÖ—FRG&v&6²ƒSR“Â÷FCãÇFCå2òG¶Æ–Ö—FTG&v&6²çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæså&V7WW&6œ;6âÜ:†–ÖÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG·&V7WW&6–öäÖ‚çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCì+õVVFR6övW'6SóÂ÷FCãÇFCâG·VVFT6övW'6Rò~)ÈR<:Òr¢~)ØÂæòwÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FF–æs£'ƒ¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶&÷&FW"×&F—W3£gƒ¶föçB×vV–v‡C£c·FW‡BÖÆ–vã¦6VçFW"#âG·VVFT6övW'6Rò)ÈRG&v&6³¢2òG·&V7WW&6–öäÖ‚çFôf—†VBƒ"—Òâ6ÆFò”uc¢2òG·6ÆFôff÷$”ubçFôf—†VBƒ"—Òæ¢~(Kûˆò–æw&W6R6÷7F÷2FR–ç7VÖ÷2wÓÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)H‚â„õ$2U…E$2„DÂƒSB’)H)H ¦gVæ7F–öâ6Æ4†÷&4W‡G&2‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v†U÷7VVÆFòr“òçfÇVR’ÇÂ°¢6öç7B†÷&4F–Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v†Uö†÷&2r“òçfÇVR’ÇÂ°¢6öç7BF–2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v†UöF–2r“òçfÇVR’ÇÂ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v†U÷F—òr“òçfÇVRÇÂw6ö'&WF6ó#Rs°¢6öç7B¦÷&æFÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v†Uö¦÷&æFr“òçfÇVRÇÂw&VwVÆ"s°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v†U&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚7VVÆFòÇÂ†÷&4F–ÇÂF–2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BfÆ÷$†÷&÷&BÒ7VVÆFòò3òƒ°¢6öç7B6ö'&WF62Ò²6ö'&WF6ó#S¢²7C¢#RÂÆ&VÃ¢u6ö'&WF6#RR††7F&‚F—W&æ2’rÒÂ6ö'&WF6ó3S¢²7C¢3RÂÆ&VÃ¢u6ö'&WF63RR†Ü:2FR&‚F—W&æ2’rÒÂæö7GW&æó¢²7C¢ÂÆ&VÃ¢tæö7GW&æRrÒÂFöÖ–æ–6Åó#¢²7C¢#ÂÆ&VÃ¢tFöÖ–æ–6ÂòfW&–Fò#RrÒÓ°¢6öç7B7BÒ6ö'&WF65·F—õÒÇÂ6ö'&WF62ç6ö'&WF6ó#S°¢6öç7BfÆ÷$†÷&W‡G&ÒfÆ÷$†÷&÷&B¢ƒ²7Bç7Bò“°¢6öç7BvôÖVç7VÂÒfÆ÷$†÷&W‡G&¢†÷&4F–¢F–3°¢6öç7B7E7VVÆFòÒ‡vôÖVç7VÂò7VVÆFò’¢°¢6öç7B¦÷&æF2Ò²&VwVÆ#¢u&VwVÆ"ƒ†‚’rÂ&6–Ã¢u&6–ÂƒÂ†‚’rÂæö7GW&æ¢tæö7GW&ærÓ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆSà¢ÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇFƒåfÆ÷#Â÷FƒãÂ÷G#à¢ÇG#ãÇFCå7VVÆFòÖVç7VÃÂ÷FCãÇFCå2òG·7VVÆFòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä¦÷&æFÆ&÷&ÃÂ÷FCãÇFCâG¶¦÷&æF5¶¦÷&æFÒÇÂu&VwVÆ"wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåfÆ÷"†÷&÷&F–æ&–Â÷FCãÇFCå2òG·fÆ÷$†÷&÷&BçFôf—†VBƒB—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåF—òFR†÷&W‡G&Â÷FCãÇFCâG·7BæÆ&VÇÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå6ö'&WF6Æ–6FÂ÷FCãÇFCâG·7Bç7GÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåfÆ÷"†÷&W‡G&Â÷FCãÇFCå2òG·fÆ÷$†÷&W‡G&çFôf—†VBƒB—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsåvòÖVç7VÂ†÷&2W‡G&3Â÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG·vôÖVç7VÂçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCâR6ö'&R7VVÆFóÂ÷FCãÇFCâG·7E7VVÆFòçFôf—†VBƒ"—ÒSÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ·FF–æs£'ƒ¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶&÷&FW"×&F—W3£gƒ¶föçB×vV–v‡C£c·FW‡BÖÆ–vã¦6VçFW"#åF÷FÂÖVç7VÃ¢2òG²‡7VVÆFò²vôÖVç7VÂ’çFôf—†VBƒ"—Ò‡7VVÆFò²†÷&2W‡G&2“ÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)H’â,8”t”ÔTâu$$”ò)H)H ¦gVæ7F–öâ6Æ5&Vtw&&–ò‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷7VVÆFòr“òçfÇVR’ÇÂ°¢6öç7B&Vv–ÖVâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷&Vv–ÖVâr“òçfÇVRÇÂvw&&–òs°¢6öç7BF–&–òÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&öF–&–òr“òçfÇVR’ÇÂ°¢6öç7BF–2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&öF–2r“òçfÇVR’ÇÂ°¢6öç7B7G4–æ6ÇV–FÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&ö7G2r“òçfÇVRÇÂw6’s°¢6öç7Bw&F–d–æ6ÇV–FÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&öw&F–br“òçfÇVRÇÂw6’s°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚7VVÆFòbbF–&–ò’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B&VÔÖVç7VÂÒ7VVÆFòÇÂF–&–ò¢F–3°¢6öç7B&VÔF–&–ÒF–&–òÇÂ7VVÆFòò3°¢ÆWB—"Â7G2Âw&F–bÂW76ÇVBÂ6VæF’Â&öæ–bÂ÷G&÷3°¢ÆWB&Vv–ÖVäÆ&VÂÂæ÷F2Òrs°¢7v—F6‚‡&Vv–ÖVâ’°¢66Rvw&&–òs¢&Vv–ÖVäÆ&VÂÒtw&&–ò„ÆW’#s3c’s²—"Ò&VÔÖVç7VÂ¢ãS²7G2Ò7G4–æ6ÇV–FÓÓÒw6’rò&VÔÖVç7VÂ¢ã“s"¢²w&F–bÒw&F–d–æ6ÇV–FÓÓÒw6’rò&VÔÖVç7VÂ¢ãccb¢²W76ÇVBÒ&VÔÖVç7VÂ¢ãC²6VæF’Ò&VÔÖVç7VÂ¢ãsS²&öæ–bÒ²÷G&÷2Ò²æ÷F2Òt•"RRÂ5E2’ãs"RÂw&F–bbãcbRÂU54ÅTBBRÂ4TäD’ãsRRs²'&V³°¢66Rvw&öW‡÷'FF÷"s¢&Vv–ÖVäÆ&VÂÒtw&öW‡÷'FF÷"s²—"Ò&VÔÖVç7VÂ¢ãS²7G2Ò7G4–æ6ÇV–FÓÓÒw6’rò&VÔÖVç7VÂ¢ã“s"¢²w&F–bÒw&F–d–æ6ÇV–FÓÓÒw6’rò&VÔÖVç7VÂ¢ãccb¢²W76ÇVBÒ&VÔÖVç7VÂ¢ãC²6VæF’Ò²&öæ–bÒ²÷G&÷2Ò²æ÷F2Òt•"RRÂ5E2’ãs"RÂw&F–bbãcbRÂU54ÅTBBRs²'&V³°¢66Rv×—Rs¢&Vv–ÖVäÆ&VÂÒtÕ•Rs²—"Ò&VÔÖVç7VÂ¢ã²7G2Ò7G4–æ6ÇV–FÓÓÒw6’rò&VÔÖVç7VÂ¢ãƒ32¢²w&F–bÒw&F–d–æ6ÇV–FÓÓÒw6’rò&VÔÖVç7VÂ¢ãccb¢²W76ÇVBÒ&VÔÖVç7VÂ¢ãC²6VæF’Ò²&öæ–bÒ²÷G&÷2Ò²æ÷F2Òt•"R††7F3T•B’Â5E2‚ã32RÂw&F–bbãcbRÂU54ÅTBBRs²'&V³°¢66Rv6öç7G'V66–öâs¢&Vv–ÖVäÆ&VÂÒt6öç7G'V66œ;6â6—f–Âs²—"Ò&VÔÖVç7VÂ¢ãS²7G2Ò²w&F–bÒ²W76ÇVBÒ&VÔÖVç7VÂ¢ã²6VæF’Ò&VÔÖVç7VÂ¢ã#²&öæ–bÒ&VÔF–&–¢ã3R¢F–3²÷G&÷2Ò&VÔÖVç7VÂ¢ã²æ÷F2ÒtU54ÅTBRÂ4TäD’"RÂ4Tä4”4òRÂ&öæ–b3RR4%Rs²'&V³°¢FVfVÇC¢&Vv–ÖVäÆ&VÂÒ&Vv–ÖVã²—"Ò²7G2Ò²w&F–bÒ²W76ÇVBÒ²6VæF’Ò²&öæ–bÒ²÷G&÷2Ò°¢Ğ¢6öç7BF÷FÄ&VæVf–6–÷2Ò—"²7G2²w&F–b²W76ÇVB²6VæF’²&öæ–b²÷G&÷3°¢6öç7B6÷7FõG&&¦F÷"Ò&VÔÖVç7VÂ²F÷FÄ&VæVf–6–÷3°¢6öç7B7D6&vÒ‡F÷FÄ&VæVf–6–÷2ò&VÔÖVç7VÂ’¢°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆSà¢ÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇFƒåfÆ÷#Â÷FƒãÂ÷G#à¢ÇG#ãÇFCå,:–v–ÖVãÂ÷FCãÇFCâG·&Vv–ÖVäÆ&VÇÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå&V×VæW&6œ;6âÖVç7VÃÂ÷FCãÇFCå2òG·&VÔÖVç7VÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä•"‡&WFVæ6œ;6â“Â÷FCãÇFCå2òG¶—"çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä5E3Â÷FCãÇFCâG¶7G4–æ6ÇV–FÓÓÒw6’ròu2òr²7G2çFôf—†VBƒ"’¢tæò–æ6ÇV–FwÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäw&F–f–66–öæW3Â÷FCãÇFCâG¶w&F–d–æ6ÇV–FÓÓÒw6’ròu2òr²w&F–bçFôf—†VBƒ"’¢tæò–æ6ÇV–F2wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäU54ÅTCÂ÷FCãÇFCå2òG¶W76ÇVBçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå4TäD“Â÷FCãÇFCâG·6VæF’âòu2òr²6VæF’çFôf—†VBƒ"’¢tæòÆ–6wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä&öæ–f–66œ;6ãÂ÷FCãÇFCâG¶&öæ–bâòu2òr²&öæ–bçFôf—†VBƒ"’¢tæòÆ–6wÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsåF÷FÂ6&v3Â÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG·F÷FÄ&VæVf–6–÷2çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCãÇ7G&öæsä6÷7FòF÷FÂG&&¦F÷#Â÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG¶6÷7FõG&&¦F÷"çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä6&v6ö'&R&VÒãÂ÷FCãÇFCâG·7D6&vçFôf—†VBƒ"—ÒSÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ·FF–æs£‡ƒ¶&6¶w&÷VæC¢6S&c6fc¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#¢3Cƒ¶föçB×6—¦S£G‚#ï	ù8ÂG¶æ÷F7ÓÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)Hâe4ôÔ•4”ôäU2)H)H ¦gVæ7F–öâ6Æ4g6öÖ—6–öæW2‚’°¢6öç7Bg6VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vg÷6VÂr“òçfÇVRÇÂw&–Ös°¢6öç7B&VÒÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vg÷&VÒr“òçfÇVR’ÇÂ°¢6öç7Bæ–÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöæ–÷2r“òçfÇVR’ÇÂ°¢6öç7B&VçE7BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vg÷&VçBr“òçfÇVR’ÇÂ°¢6öç7B7GVÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgö7GVÂr“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vg&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚&VÒÇÂæ–÷2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7Bg2Ò²&–Ö¢²æöÖ'&S¢u&–ÖrÂ6öÖ—6–öã¢ãc’Â&–Ö6Vs¢ã#BÒÂ†&—FC¢²æöÖ'&S¢tŒ:&—FBrÂ6öÖ—6–öã¢ãc’Â&–Ö6Vs¢ã#BÒÂ&ögWGW&ó¢²æöÖ'&S¢u&ögWGW&òrÂ6öÖ—6–öã¢ãc’Â&–Ö6Vs¢ã#BÒÂ–çFVw&¢²æöÖ'&S¢t–çFVw&rÂ6öÖ—6–öã¢ãc’Â&–Ö6Vs¢ã#BÒÓ°¢6öç7BgÒg5¶g6VÅÓ°¢6öç7B÷'FRÒ&VÒ¢ã°¢6öç7B6öÖ—6–öäÖVç7VÂÒ&VÒ¢gæ6öÖ—6–öâò°¢6öç7B&–ÖÖVç7VÂÒ&VÒ¢gç&–Ö6Vrò°¢6öç7BF÷FÄFW62Ò÷'FR²6öÖ—6–öäÖVç7VÂ²&–ÖÖVç7VÃ°¢6öç7BföæFôÖVç7VÂÒ÷'FS°¢6öç7B&VçBÒ&VçE7Bò°¢6öç7BF÷FÄ÷'FW2ÒföæFôÖVç7VÂ¢"¢æ–÷3°¢6öç7BföæFô6öå&VçBÒföæFôÖVç7VÂ¢"¢‚„ÖF‚ç÷rƒ²&VçBÂæ–÷2’Ò’ò&VçB“°¢6öç7Bvææ6–&VçBÒföæFô6öå&VçBÒF÷FÄ÷'FW3°¢ÆWB6ö×&÷w2Òrs°¢f÷"†6öç7B¶W’öbö&¦V7Bæ¶W—2†g2’’°¢6öç7BÒg5¶¶W•Ó°¢6öç7B2Ò&VÒ¢æ6öÖ—6–öâòÂÒ&VÒ¢ç&–Ö6VròÂBÒ÷'FR²2²°¢6öç7BFÒ÷'FR¢"¢æ–÷3°¢6öç7Bf2Ò÷'FR¢"¢‚„ÖF‚ç÷rƒ²&VçBÂæ–÷2’Ò’ò&VçB“°¢6öç7BW56VÂÒ¶W’ÓÓÒg6VÃ°¢6ö×&÷w2³ÒÇG"G¶W56VÂòr7G–ÆSÒ&föçB×vV–v‡C£c¶&6¶w&÷VæC§f"‚ÒÖ66VçB’"r¢rwÓãÇFCâG¶ææöÖ'&WÒG¶W56VÂòr)ÈRr¢rwÓÂ÷FCãÇFCâG¶æ6öÖ—6–öçÒSÂ÷FCãÇFCâG¶ç&–Ö6VwÒSÂ÷FCãÇFCå2òG¶2çFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·çFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·BçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG¶f2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#æ°¢Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"g"g#¶v£ƒ¶Ö&v–âÖ&÷GFöÓ£'ƒ·FF–æs£ƒ¶&6¶w&÷VæC§f"‚ÒÖ6&BÖ&r“¶&÷&FW"×&F—W3£g‚#à¢ÆF—cãÇ7G&öæsäe£Â÷7G&öæsãÆ'#âG¶gææöÖ'&WÓÂöF—cà¢ÆF—cãÇ7G&öæsä÷'FRS£Â÷7G&öæsãÆ'#å2òG¶÷'FRçFôf—†VBƒ"—ÒöÖW3ÂöF—cà¢ÆF—cãÇ7G&öæsä6öÖ—6œ;6â·&–Ö£Â÷7G&öæsãÆ'#å2òG²†6öÖ—6–öäÖVç7VÂ²&–ÖÖVç7VÂ’çFôf—†VBƒ"—ÒöÖW3ÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"g"g#¶v£ƒ¶Ö&v–âÖ&÷GFöÓ£'ƒ·FF–æs£ƒ¶&6¶w&÷VæC§f"‚ÒÖ6&BÖ&r“¶&÷&FW"×&F—W3£g‚#à¢ÆF—cãÇ7G&öæsåF÷FÂFW67VVçFó£Â÷7G&öæsãÆ'#å2òG·F÷FÄFW62çFôf—†VBƒ"—ÓÂöF—cà¢ÆF—cãÇ7G&öæsäföæFò6–â&VçF"ã£Â÷7G&öæsãÆ'#å2òG·F÷FÄ÷'FW2çFôf—†VBƒ"—ÓÂöF—cà¢ÆF—cãÇ7G&öæsäföæFò6öâG·&VçE7GÒS£Â÷7G&öæsãÆ'#å2òG¶föæFô6öå&VçBçFôf—†VBƒ"—ÓÂöF—cà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£'ƒ·FF–æs£ƒ¶&6¶w&÷VæC¢6CFVFF¶&÷&FW"×&F—W3£gƒ¶6öÆ÷#¢3SSs#B#ãÇ7G&öæsï	ù+vææ6–&VçF&–Æ–FC£Â÷7G&öæsâ2òG¶vææ6–&VçBçFôf—†VBƒ"—ÓÂöF—cà¢ÇF&ÆSãÇG#ãÇFƒäeÂ÷FƒãÇFƒä6öÒãÂ÷FƒãÇFƒå&–ÖÂ÷FƒãÇFƒä6öÒâ2óÂ÷FƒãÇFƒå&–Ö2óÂ÷FƒãÇFƒåF÷FÃÂ÷FƒãÇFƒäföæFóÂ÷FƒãÂ÷G#âG¶6ö×&÷w7ÓÂ÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ·FF–æs£‡ƒ¶&6¶w&÷VæC¢6S&c6fc¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#¢3Cƒ¶föçB×6—¦S£G‚#ï	ù8Â&÷–V66œ;6âG¶æ–÷7Ò;÷26öâ&VçF&–Æ–FBFRG·&VçE7GÒRçVÃÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)Hâ4”tä4œ94âdÔ”Ä”")H)H ¦gVæ7F–öâ6Æ46–væ6–öâ‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–u÷7VVÆFòr“òçfÇVR’ÇÂ°¢6öç7B&×bÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–u÷&×br“òçfÇVR’ÇÂ3°¢6öç7B†–¦÷2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–uö†–¦÷2r“òçfÇVR’ÇÂ°¢6öç7B–æw&W6òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6–uö–æw&W6òr“òçfÇVS°¢6öç7BfV6†ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6–uöfV6†r“òçfÇVS°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6–u&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚7VVÆFòÇÂ†–¦÷2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B6–u÷$†–¦òÒ&×b¢ã°¢6öç7BF÷FÄ6–rÒ6–u÷$†–¦ò¢†–¦÷3°¢6öç7BF÷RÒ&×b¢#°¢6öç7BFW&V6†òÒ7VVÆFòÃÒF÷S°¢ÆWB7V×VÆFòÒ~(	Bs°¢–b†–æw&W6òbbfV6†’²6öç7BCÒæWrFFR†–æw&W6ò’ÂC"ÒæWrFFR†fV6†“²6öç7BÖW6W2Ò†C"ævWDgVÆÅ–V"‚’ÒCævWDgVÆÅ–V"‚’’¢"²†C"ævWDÖöçF‚‚’ÒCævWDÖöçF‚‚’“²–b†ÖW6W2â’7V×VÆFòÒu2òr²‡F÷FÄ6–r¢ÖF‚æÖ‚ƒÂÖW6W2’’çFôf—†VBƒ"“²Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#"#ï	ù8²6–væ6œ;6âfÖ–Æ–"(	B&W7VÇFF÷3Â÷FƒãÂ÷G#à¢ÇG#ãÇFCä6–væ6œ;6â÷"†–¦òƒR$Õb“Â÷FCãÇFCãÇ7G&öæså2òG¶6–u÷$†–¦òçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåF÷FÂ6–væ6œ;6âÖVç7VÃÂ÷FCãÇFCãÇ7G&öæså2òG·F÷FÄ6–rçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå$Õb7GVÃÂ÷FCãÇFCå2òG·&×bçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåF÷Rƒ"$Õb“Â÷FCãÇFCå2òG·F÷RçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCì+ôFW&V6†òÂ&VæVf–6–óóÂ÷FCãÇFCãÇ7â7G–ÆSÒ&6öÆ÷#¢G¶FW&V6†òòwf"‚ÒÖ66VçB’r¢w&VBwÓ¶föçB×vV–v‡C£s#âG¶FW&V6†òò~)ÈR<:Òr¢~)ØÂæò(	B7VVÆFòW†6VFR2òr²F÷RçFôf—†VBƒ"—ÓÂ÷7ããÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä6–væ6œ;6â7V×VÆFÂ÷FCãÇFCãÇ7G&öæsâG¶7V×VÆF÷ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä–×7Fò5E2†ÖVç7VÂ“Â÷FCãÇFCå2òG²‡F÷FÄ6–rò"’çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä–×7Fòw&F–f–66œ;6ãÂ÷FCãÇFCå2òG·F÷FÄ6–rçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSãÂöF—cæ°§Ğ ¢òò)H)H"â$D”õ2d”ää4”U$õ2)H)H ¦gVæ7F–öâ6Æ5&F–÷2‚’°¢6öç7B2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Eö2r“òçfÇVR’ÇÂ°¢6öç7B2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&E÷2r“òçfÇVR’ÇÂ°¢6öç7BBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&EöBr“òçfÇVR’ÇÂ°¢6öç7BBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&E÷Br“òçfÇVR’ÇÂ°¢6öç7BBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&E÷Br“òçfÇVR’ÇÂ°¢6öç7BgF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&E÷gF2r“òçfÇVR’ÇÂ°¢6öç7B7bÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Eö7br“òçfÇVR’ÇÂ°¢6öç7BVâÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&E÷Vâr“òçfÇVR’ÇÂ°¢6öç7BVòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&E÷Vòr“òçfÇVR’ÇÂ°¢6öç7BvbÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Eövbr“òçfÇVR’ÇÂ°¢6öç7B–çbÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Eö–çbr“òçfÇVR’ÇÂ°¢6öç7B62Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Eö62r“òçfÇVR’ÇÂ°¢6öç7B7Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&Eö7r“òçfÇVR’ÇÂ°¢6öç7BF–2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&EöF–2r“òçfÇVR’ÇÂ3c°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&E&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B"Ò·Ó°¢"æÆ—V–FW¢Ò2ò†2ò2’¢°¢"çÒ2ò‚†2Ò–çb’ò2’¢°¢"æVæFWVBÒBò‡BòB’¢°¢"ç&öRÒBò‡VâòB’¢°¢"ç&öÒBò‡VâòB’¢°¢"æÖâÒgF2ò‡VâògF2’¢°¢"æÖ"ÒgF2ò‚‡gF2Ò7b’ògF2’¢°¢"ç&÷D–çbÒ7bò†7bò–çb’¢°¢"ç&÷D62ÒgF2ò‡gF2ò62’¢°¢"ç&÷D7Ò7bò†7bò7’¢°¢"æF–4–çbÒ"ç&÷D–çbò†F–2ò"ç&÷D–çb’¢°¢"æF–462Ò"ç&÷D62ò†F–2ò"ç&÷D62’¢°¢"æF–47Ò"ç&÷D7ò†F–2ò"ç&÷D7’¢°¢"æ6–6ÆòÒ"æF–4–çb²"æF–462Ò"æF–47°¢gVæ7F–öâ6öÆ÷"‡fÂÂvööBÂ&B’²–b‚fÂ’&WGW&âwf"‚ÒÖ×WFVB’s²&WGW&âfÂãÒvööBòwf"‚ÒÖ66VçB’r¢fÂÂ&Bòw&VBr¢v÷&ævRs²Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSà¢ÇG#ãÇFƒï	ù8¢&F–óÂ÷FƒãÇFƒåfÆ÷#Â÷FƒãÇFƒå&VbãÂ÷FƒãÇFƒãÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCäÆ—V–FW¢„2õ2“Â÷FCãÇFCâG·"æÆ—V–FW¢çFôf—†VBƒ"—ÓÂ÷FCãÇFCãã^(	32ãÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6öÆ÷"‡"æÆ—V–FW¢ÂãRÂ—Ò#î)xóÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå'VV&:6–FÂ÷FCãÇFCâG·"ççFôf—†VBƒ"—ÓÂ÷FCãÇFCãã(	3ã#Â÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6öÆ÷"‡"çÂã‚ÂãR—Ò#î)xóÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäVæFWVFÖ–VçFóÂ÷FCãÇFCâG²‡"æVæFWVB¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFCâfÇC³cSÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G·"æVæFWVBÃÒãbòwf"‚ÒÖ66VçB’r¢w&VBwÒ#î)xóÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå$ôSÂ÷FCãÇFCâG²‡"ç&öR¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFCâfwC³RSÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6öÆ÷"‡"ç&öRÂãRÂãR—Ò#î)xóÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå$ôÂ÷FCãÇFCâG²‡"ç&ö¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFCâfwC³RSÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6öÆ÷"‡"ç&öÂãRÂ—Ò#î)xóÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäÖ&vVâæWFóÂ÷FCãÇFCâG²‡"æÖâ¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFCâfwC³SÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6öÆ÷"‡"æÖâÂãÂ—Ò#î)xóÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäÖ&vVâ''WFóÂ÷FCãÇFCâG²‡"æÖ"¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFCâfwC³3SÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6öÆ÷"‡"æÖ"Âã2Âã—Ò#î)xóÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå&÷Bâ–çfVçF&–óÂ÷FCãÇFCâG·"ç&÷D–çbçFôf—†VBƒ"—×ƒÂ÷FCãÇFCî(	CÂ÷FCãÇFCî(	CÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå&÷Bâ6ö'&÷3Â÷FCãÇFCâG·"ç&÷D62çFôf—†VBƒ"—×ƒÂ÷FCãÇFCî(	CÂ÷FCãÇFCî(	CÂ÷FCãÂ÷G#à¢ÇG#ãÇFCå&÷Bâv÷3Â÷FCãÇFCâG·"ç&÷D7çFôf—†VBƒ"—×ƒÂ÷FCãÇFCî(	CÂ÷FCãÇFCî(	CÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäL:Ö2–çfVçF&–óÂ÷FCãÇFCâG·"æF–4–çbçFôf—†VBƒ—ÒCÂ÷FCãÇFCî(	CÂ÷FCãÇFCî(	CÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäL:Ö26ö'&÷3Â÷FCãÇFCâG·"æF–462çFôf—†VBƒ—ÒCÂ÷FCãÇFCî(	CÂ÷FCãÇFCî(	CÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäL:Ö2v÷3Â÷FCãÇFCâG·"æF–47çFôf—†VBƒ—ÒCÂ÷FCãÇFCî(	CÂ÷FCãÇFCî(	CÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£s#ä6–6ÆòVfV7F—fóÂ÷FCãÇFB7G–ÆSÒ&föçB×vV–v‡C£s#âG·"æ6–6ÆòçFôf—†VBƒ—ÒCÂ÷FCãÇFCî(	CÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G·"æ6–6ÆòÂcòwf"‚ÒÖ66VçB’r¢"æ6–6ÆòÂ#òv÷&ævRr¢w&VBwÒ#î)xóÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#î)xòfW&FRÒ6ÇVF&ÆR)xòæ&æ¦ÒÆW'F)xò&ö¦òÒ7,:×F–6óÂöF—cãÂöF—cæ°§Ğ ¢òò)H)H2âÔõ%D•¤4œ94âe$ä<8•2e2ÄTÜ8â)H)H ¦gVæ7F–öâ6Æ4Ö÷'F—¦6–öâ‚’°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷'EöÖöçFòr“òçfÇVR’ÇÂ°¢6öç7BÆ¦òÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷'E÷Æ¦òr“òçfÇVR’ÇÂ°¢6öç7BFVÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷'E÷FVr“òçfÇVR’ÇÂ’ò°¢6öç7B6VrÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷'E÷6Vrr“òçfÇVR’ÇÂ°¢6öç7B÷'FW2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷'E÷÷'FW2r“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ÷'E&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚ÖöçFòÇÂÆ¦òÇÂFV’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BFVÒÒÖF‚ç÷rƒ²FVÂò"’Ò°¢6öç7B7V÷FbÒFVÒÓÓÒòÖöçFòòÆ¦ò¢ÖöçFò¢FVÒ¢ÖF‚ç÷rƒ²FVÒÂÆ¦ò’ò„ÖF‚ç÷rƒ²FVÒÂÆ¦ò’Ò“°¢ÆWB6ÆFôbÒÖöçFó²ÆWBF÷FÄ–çDbÒ²6öç7B&÷w4bÒµÓ°¢f÷"†ÆWB’Ò²’ÃÒÖF‚æÖ–âƒ"ÂÆ¦ò“²’²²’²6öç7B–çBÒ6ÆFôb¢FVÓ²6öç7BÖ÷'BÒ7V÷FbÒ–çC²F÷FÄ–çDb³Ò–çC²&÷w4bçW6‚‡²ã¢’Â7V÷F¢7V÷FbÂ–çBÂÖ÷'BÂ6ÆFó¢6ÆFôbÒÖ÷'BÒ“²6ÆFôbÓÒÖ÷'C²Ğ¢6öç7BÖ÷'D2ÒÖöçFòòÆ¦ó²ÆWB6ÆFôÒÖöçFó²ÆWBF÷FÄ–çDÒ²6öç7B&÷w4ÒµÓ°¢f÷"†ÆWB’Ò²’ÃÒÖF‚æÖ–âƒ"ÂÆ¦ò“²’²²’²6öç7B–çBÒ6ÆFô¢FVÓ²6öç7B7V÷FÒÖ÷'D2²–çC²F÷FÄ–çD³Ò–çC²&÷w4çW6‚‡²ã¢’Â7V÷FÂ–çBÂÖ÷'C¢Ö÷'D2Â6ÆFó¢6ÆFôÒÖ÷'D2Ò“²6ÆFôÓÒÖ÷'D3²Ğ¢6öç7B–çEF÷DbÒ†7V÷Fb¢Æ¦òÒÖöçFò“²6öç7B–çEF÷DÒÖöçFò¢FVÒ¢‡Æ¦ò²’ò#°¢6öç7BF÷FÅtbÒ7V÷Fb¢Æ¦ó²6öç7BF÷FÅtÒÖöçFò²–çEF÷D°¢6öç7BF–d–çBÒ–çEF÷DÒ–çEF÷Dc°¢ÆWB‡FÖÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#b#ï	ù8²g&æ<:—2g2ÆVÜ:ãÂ÷FƒãÂ÷G#à¢ÇG#ãÇF‚6öÇ7ãÒ#"#å,:ÖWG&÷3Â÷FƒãÇF‚6öÇ7ãÒ#"#äg&æ<:—3Â÷FƒãÇF‚6öÇ7ãÒ#"#äÆVÜ:ãÂ÷FƒãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#"#åDTÂ÷FCãÇFB6öÇ7ãÒ#"#âG²‡FV¢’çFôf—†VBƒ"—ÒSÂ÷FCãÇFB6öÇ7ãÒ#"#âG²‡FV¢’çFôf—†VBƒ"—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#"#åDTÓÂ÷FCãÇFB6öÇ7ãÒ#"#âG²‡FVÒ¢’çFôf—†VBƒB—ÒSÂ÷FCãÇFB6öÇ7ãÒ#"#âG²‡FVÒ¢’çFôf—†VBƒB—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#"#ä7V÷FÖVç7VÃÂ÷FCãÇFB6öÇ7ãÒ#"#ãÇ7G&öæså2òG¶7V÷FbçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÇFB6öÇ7ãÒ#"#ãÇ7G&öæså2òG·&÷w4³Óòæ7V÷FçFôf—†VBƒ"—Ò(i"2òG·&÷w4´ÖF‚æÖ–âƒÂÆ¦òÒ•Óòæ7V÷FçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#"#åF÷FÂ–çFW&W6W3Â÷FCãÇFB6öÇ7ãÒ#"#å2òG¶–çEF÷DbçFôf—†VBƒ"—ÓÂ÷FCãÇFB6öÇ7ãÒ#"#å2òG¶–çEF÷DçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#"#åF÷FÂvFóÂ÷FCãÇFB6öÇ7ãÒ#"#å2òG·F÷FÅtbçFôf—†VBƒ"—ÓÂ÷FCãÇFB6öÇ7ãÒ#"#å2òG·F÷FÅtçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#"#äF–fW&Væ6–ÃÂ÷FCãÇFB6öÇ7ãÒ#B"7G–ÆSÒ&6öÆ÷#¢G¶F–d–çBãÒòw&VBr¢wf"‚ÒÖ66VçB’wÓ¶föçB×vV–v‡C£s#âG¶F–d–çBãÒòtg&æ<:—2†÷'&r¢tÆVÜ:â†÷'&wÒ2òG´ÖF‚æ'2†F–d–çB’çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÇF&ÆR7G–ÆSÒ&Ö&v–â×F÷£'‚#ãÇG#ãÇF‚6öÇ7ãÒ#b#ï	ù8R&–ÖW&÷2"ÖW6W2(	Bg&æ<:—3Â÷FƒãÂ÷G#à¢ÇG#ãÇFƒâ3Â÷FƒãÇFƒä7V÷FÂ÷FƒãÇFƒä–çFW,:—3Â÷FƒãÇFƒäÖ÷'BãÂ÷FƒãÇFƒå6ÆFóÂ÷FƒãÇFƒå6Vrµ÷'FW3Â÷FƒãÂ÷G#æ°¢f÷"†6öç7B"öb&÷w4b’‡FÖÂ³ÒÇG#ãÇFCâG·"æçÓÂ÷FCãÇFCå2òG·"æ7V÷FçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·"æ–çBçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·"æÖ÷'BçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·"ç6ÆFòçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG²‡6Vr²÷'FW2’çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#æ°¢‡FÖÂ³ÒÂ÷F&ÆSãÇF&ÆR7G–ÆSÒ&Ö&v–â×F÷£'‚#ãÇG#ãÇF‚6öÇ7ãÒ#b#ï	ù8R&–ÖW&÷2"ÖW6W2(	BÆVÜ:ãÂ÷FƒãÂ÷G#à¢ÇG#ãÇFƒâ3Â÷FƒãÇFƒä7V÷FÂ÷FƒãÇFƒä–çFW,:—3Â÷FƒãÇFƒäÖ÷'BãÂ÷FƒãÇFƒå6ÆFóÂ÷FƒãÇFƒå6Vrµ÷'FW3Â÷FƒãÂ÷G#æ°¢f÷"†6öç7B"öb&÷w4’‡FÖÂ³ÒÇG#ãÇFCâG·"æçÓÂ÷FCãÇFCå2òG·"æ7V÷FçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·"æ–çBçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·"æÖ÷'BçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·"ç6ÆFòçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG²‡6Vr²÷'FW2’çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#æ°¢‡FÖÂ³ÒÂ÷F&ÆSãÂöF—cæ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s²&÷‚æ–ææW$…DÔÂÒ‡FÖÃ°§Ğ ¢òò)H)HBâDU$T4”4œ94â4TÄU$D)H)H ¦gVæ7F–öâ6Æ4FW&V6–6–öâ‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW÷F—òr“òçfÇVRÇÂvVF–f–6–òs°¢6öç7BfÆ÷"Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFW÷fÆ÷"r“òçfÇVR’ÇÂ°¢6öç7B&W6–GVÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFW÷&W6–GVÂr“òçfÇVR’ÇÂ°¢6öç7Bf–FÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFW÷f–Fr“òçfÇVR’ÇÂ°¢6öç7BÖWFöFòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFWöÖWFöFòr“òçfÇVRÇÂs7‚s°¢6öç7Bæ–òÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFWöæ–òr“òçfÇVR’ÇÂ##c°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFW6VÅ&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚fÆ÷"ÇÂf–F’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BF64æ÷&ÖÆW2Ò²VF–f–6–ó¢ãRÂÖV–æ&–¢ãÂfV†–7VÆó¢ã#ÂWV—ó¢ã#RÂ×VV&ÆS¢ãÂ6ögGv&S¢ãSÓ°¢6öç7BF6æ÷&ÖÂÒF64æ÷&ÖÆW5·F—õÒÇÂã°¢6öç7B&6TFWÒfÆ÷"Ò&W6–GVÃ°¢6öç7BFWæ÷&ÖÄçVÂÒ&6TFW¢F6æ÷&ÖÃ°¢6öç7Bf–Fæ÷&ÖÂÒÖF‚æ6V–ÂƒòF6æ÷&ÖÂ“°¢ÆWBf7F÷$6VÂÒÖWFöFòÓÓÒs7‚rò2¢ÖWFöFòÓÓÒsW‚ròR¢°¢ÆWBF66VÂÒÖWFöFòÓÓÒvG6Brò"¢F6æ÷&ÖÂ¢ÖF‚æÖ–â‡F6æ÷&ÖÂ¢f7F÷$6VÂÂã“°¢6öç7Bf–F6VÂÒÖF‚æ6V–ÂƒòF66VÂ“°¢6öç7BF6•"Òã#“S°¢6öç7BÖ„æ–÷2ÒÖF‚æÖ‚‡f–Fæ÷&ÖÂÂf–F6VÂÂf–F“°¢ÆWB&÷w2ÒµÓ²ÆWBF÷FÄFWæ÷&ÖÂÒÂF÷FÄFW6VÂÒÂF÷FÄ†÷'&òÒ°¢ÆWB6ÆFô6VÂÒ&6TFW°¢f÷"†ÆWB’Ò²’ÂÖ„æ–÷3²’²²’°¢6öç7Bæ–ô7BÒæ–ò²“°¢ÆWBFWæ÷&ÖÂÒ’Âf–FòFWæ÷&ÖÄçVÂ¢°¢ÆWBFW6VÃ°¢–b†ÖWFöFòÓÓÒvG6Br’²FW6VÂÒ6ÆFô6VÂ¢F66VÃ²–b†’ÓÓÒÖ„æ–÷2ÒÇÂFW6VÂâ6ÆFô6VÂ’FW6VÂÒ6ÆFô6VÃ²6ÆFô6VÂÒÖF‚æÖ‚ƒÂ6ÆFô6VÂÒFW6VÂ“²Ğ¢VÇ6RFW6VÂÒ’Âf–F6VÂò&6TFW¢F66VÂ¢°¢6öç7B†÷'&òÒ†FW6VÂÒFWæ÷&ÖÂ’¢F6•#°¢F÷FÄFWæ÷&ÖÂ³ÒFWæ÷&ÖÃ²F÷FÄFW6VÂ³ÒFW6VÃ²F÷FÄ†÷'&ò³Ò†÷'&ó°¢&÷w2çW6‚‡²æ–ó¢æ–ô7BÂæ÷&ÖÃ¢FWæ÷&ÖÂÂ6VÆW&F¢FW6VÂÂ†÷'&òÒ“°¢Ğ¢ÆWB‡FÖÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#b#î)ªFW&V6–6œ;6â(	BG·F—òæ6†$Bƒ’çFõWW$66R‚’²F—òç6Æ–6Rƒ—Ò‚G¶ÖWFöFòÓÓÒvG6BròtFö&ÆR6ÆFòFV7&V6–VçFRr¢ÖWFöFòÓÓÒs7‚ròs2;÷2r¢sR;÷2wÒ“Â÷FƒãÂ÷G#à¢ÇG#ãÇFB6öÇ7ãÒ#"#ãÇ7G&öæsåF6æ÷&ÖÃ£Â÷7G&öæsâG²‡F6æ÷&ÖÂ¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB6öÇ7ãÒ#"#ãÇ7G&öæsåF66VÆW&F£Â÷7G&öæsâG²‡F66VÂ¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB6öÇ7ãÒ#"#ãÇ7G&öæsä&6S£Â÷7G&öæsâ2òG¶&6TFWçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFƒä;óÂ÷FƒãÇFƒäæ÷&ÖÃÂ÷FƒãÇFƒä6VÆW&FÂ÷FƒãÇFƒäF–fW&Væ6–Â÷FƒãÇFƒä†÷'&ò•#Â÷FƒãÇFƒãÂ÷FƒãÂ÷G#æ°¢ÆWBÖ„&"Ò²f÷"†6öç7B"öb&÷w2’Ö„&"ÒÖF‚æÖ‚†Ö„&"Â"æ6VÆW&F“°¢f÷"†6öç7B"öb&÷w2’²–b‡"ææ÷&ÖÂÓÓÒbb"æ6VÆW&FÓÓÒ’6öçF–çVS²6öç7BF–fbÒ"æ6VÆW&FÒ"ææ÷&ÖÃ²6öç7B7BÒÖ„&"ò‡"æ6VÆW&FòÖ„&"¢’¢²‡FÖÂ³ÒÇG#ãÇFCâG·"ææ–÷ÓÂ÷FCãÇFCå2òG·"ææ÷&ÖÂçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·"æ6VÆW&FçFôf—†VBƒ"—ÓÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶F–fbâòwf"‚ÒÖ66VçB’r¢w&VBwÒ#âG¶F–fbâòr²r¢rwÕ2òG¶F–fbçFôf—†VBƒ"—ÓÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G·"æ†÷'&òâòwf"‚ÒÖ66VçB’r¢v–æ†W&—BwÒ#å2òG·"æ†÷'&òçFôf—†VBƒ"—ÓÂ÷FCãÇFCãÆF—b7G–ÆSÒ'v–GFƒ£Sƒ¶†V–v‡C£'ƒ¶&6¶w&÷VæC§f"‚ÒÖ&s"“¶&÷&FW"×&F—W3£Gƒ¶÷fW&fÆ÷s¦†–FFVâ#ãÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ¢G·7GÒS¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶&÷&FW"×&F—W3£G‚#ãÂöF—cãÂöF—cãÂ÷FCãÂ÷G#æ²Ğ¢‡FÖÂ³ÒÇG"7G–ÆSÒ&föçB×vV–v‡C£s¶&÷&FW"×F÷£'‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇFCåF÷FÆW3Â÷FCãÇFCå2òG·F÷FÄFWæ÷&ÖÂçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·F÷FÄFW6VÂçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG²‡F÷FÄFW6VÂÒF÷FÄFWæ÷&ÖÂ’çFôf—†VBƒ"—ÓÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ66VçB’#å2òG·F÷FÄ†÷'&òçFôf—†VBƒ"—ÓÂ÷FCãÇFCãÂ÷FCãÂ÷G#ãÂ÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ·FF–æs£ƒ¶&6¶w&÷VæC§f"‚ÒÖ&s"“¶&÷&FW"×&F—W3£g‚#ãÇ7G&öæsï	ù*†÷'&òG&–'WF&–òF÷FÃ£Â÷7G&öæsâ2òG·F÷FÄ†÷'&òçFôf—†VBƒ"—Ò‚G²‡F6•"¢’çFôf—†VBƒ—ÒR•"“ÂöF—cãÂöF—cæ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s²&÷‚æ–ææW$…DÔÂÒ‡FÖÃ°§Ğ ¢òò)H)HRâÄT4”är)H)H ¦gVæ7F–öâ6Æ4ÆV6–ær‚’°¢6öç7BfÆ÷"Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6U÷fÆ÷"r“òçfÇVR’ÇÂ°¢6öç7BÆ¦òÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6U÷Æ¦òr“òçfÇVR’ÇÂ°¢6öç7BFVÂÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6U÷FVöÂr“òçfÇVR’ÇÂ’ò°¢6öç7B÷46ö×&Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6Uö÷2r“òçfÇVR’ÇÂ’ò°¢6öç7BFV2Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6U÷FVö2r“òçfÇVR’ÇÂ’ò°¢6öç7BÇ÷Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6UöÇr“òçfÇVR’ÇÂ°¢6öç7BF6•"Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6Uö—"r“òçfÇVR’ÇÂ#’ãR’ò°¢6öç7BFWæ–÷2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6UöFWr“òçfÇVR’ÇÂS°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÆV6U&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚fÆ÷"ÇÂÆ¦ò’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BFVÔÂÒÖF‚ç÷rƒ²FVÂÂò"’Ò²6öç7BFVÔ2ÒÖF‚ç÷rƒ²FV2Âò"’Ò°¢6öç7BfÆ÷$÷2ÒfÆ÷"¢÷46ö×&°¢6öç7B7V÷FÂÒ‡fÆ÷"ÒfÆ÷$÷2’¢FVÔÂ¢ÖF‚ç÷rƒ²FVÔÂÂÆ¦ò’ò„ÖF‚ç÷rƒ²FVÔÂÂÆ¦ò’Ò“°¢6öç7BF÷FÄÂÒ7V÷FÂ¢Æ¦ò²fÆ÷$÷3°¢ÆWB6ÆFôÂÒfÆ÷"ÒfÆ÷$÷3²ÆWB–çDÂÒ°¢f÷"†ÆWB’Ò²’ÂÆ¦ó²’²²’²6öç7B–çBÒ6ÆFôÂ¢FVÔÃ²–çDÂ³Ò–çC²6ÆFôÂÓÒ†7V÷FÂÒ–çB“²Ğ¢6öç7BFWçVÂÒfÆ÷"òFWæ–÷3°¢6öç7BW67VFôÂÒ†FWçVÂ¢Æ¦òò"²–çDÂ’¢F6•#°¢6öç7B6÷7FôÂÒF÷FÄÂÒW67VFôÃ°¢6öç7BF÷FÄ÷ÒÇ÷¢Æ¦ó°¢6öç7BW67VFô÷Ò†FWçVÂ¢Æ¦òò"’¢F6•#°¢6öç7B6÷7Fô÷ÒF÷FÄ÷ÒW67VFô÷°¢6öç7B7V÷F2ÒfÆ÷"¢FVÔ2¢ÖF‚ç÷rƒ²FVÔ2ÂÆ¦ò’ò„ÖF‚ç÷rƒ²FVÔ2ÂÆ¦ò’Ò“°¢6öç7BF÷FÄ2Ò7V÷F2¢Æ¦ó°¢ÆWB6ÆFô2ÒfÆ÷#²ÆWB–çD2Ò°¢f÷"†ÆWB’Ò²’ÂÆ¦ó²’²²’²6öç7B–çBÒ6ÆFô2¢FVÔ3²–çD2³Ò–çC²6ÆFô2ÓÒ†7V÷F2Ò–çB“²Ğ¢6öç7BW67VFô2Ò†FWçVÂ¢Æ¦òò"²–çD2’¢F6•#°¢6öç7B6÷7Fô7&VBÒF÷FÄ2ÒW67VFô3°¢6öç7BÖV¦÷"ÒÖF‚æÖ–â†6÷7FôÂÂ6÷7Fô÷Â6÷7Fô7&VB“°¢6öç7B&V2ÒÖV¦÷"ÓÓÒ6÷7FôÂò~)ÈRÆV6–ærf–ââr¢ÖV¦÷"ÓÓÒ6÷7Fô÷ò~)ÈRÆV6–ær÷âr¢~)ÈR6ö×&F—&V7Fs°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇF&ÆSà¢ÇG#ãÇF‚6öÇ7ãÒ#B#ï	ù©²ÆV6–ærf–ææ6–W&òg2÷W&F—fòg26ö×&Â÷FƒãÂ÷G#à¢ÇG#ãÇFƒä6öæ6WFóÂ÷FƒãÇFƒäÆV6–ærf–âãÂ÷FƒãÇFƒäÆV6–ær÷ãÂ÷FƒãÇFƒä6ö×&F—"ãÂ÷FƒãÂ÷G#à¢ÇG#ãÇFCåfÆ÷"&–VãÂ÷FCãÇFB6öÇ7ãÒ#2"7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW"#å2òG·fÆ÷"çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä7V÷FÖVç7VÃÂ÷FCãÇFCãÇ7G&öæså2òG¶7V÷FÂçFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG¶Ç÷çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÇFCãÇ7G&öæså2òG¶7V÷F2çFôf—†VBƒ"—ÓÂ÷7G&öæsãÂ÷FCãÂ÷G#à¢ÇG#ãÇFCåF÷FÂvFóÂ÷FCãÇFCå2òG·F÷FÄÂçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·F÷FÄ÷çFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG·F÷FÄ2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä÷6œ;6â6ö×&Â÷FCãÇFCå2òG·fÆ÷$÷2çFôf—†VBƒ"—ÓÂ÷FCãÇFCî(	CÂ÷FCãÇFCî(	CÂ÷FCãÂ÷G#à¢ÇG#ãÇFCä–çFW&W6W2F÷FÆW3Â÷FCãÇFCå2òG¶–çDÂçFôf—†VBƒ"—ÓÂ÷FCãÇFCî(	CÂ÷FCãÇFCå2òG¶–çD2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFCäW67VFòf—66ÃÂ÷FCãÇFCå2òG¶W67VFôÂçFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG¶W67VFô÷çFôf—†VBƒ"—ÓÂ÷FCãÇFCå2òG¶W67VFô2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG"7G–ÆSÒ&föçB×vV–v‡C£s¶&÷&FW"×F÷£'‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ãÇFCä6÷7FòæWFòF÷FÃÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6÷7FôÂÓÓÒÖV¦÷"òwf"‚ÒÖ66VçB’r¢v–æ†W&—BwÒ#å2òG¶6÷7FôÂçFôf—†VBƒ"—ÓÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6÷7Fô÷ÓÓÒÖV¦÷"òwf"‚ÒÖ66VçB’r¢v–æ†W&—BwÒ#å2òG¶6÷7Fô÷çFôf—†VBƒ"—ÓÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#¢G¶6÷7Fô7&VBÓÓÒÖV¦÷"òwf"‚ÒÖ66VçB’r¢v–æ†W&—BwÒ#å2òG¶6÷7Fô7&VBçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ·FF–æs£ƒ¶&6¶w&÷VæC§f"‚ÒÖ&s"“¶&÷&FW"×&F—W3£gƒ¶föçB×vV–v‡C£s¶6öÆ÷#§f"‚ÒÖ66VçB’#ï	øøbG·&V7ÓÂöF—cãÂöF—cæ°§Ğ ¢òò)H)Hbâ4ôådU%4õ"D42)H)H ¦gVæ7F–öâ6Æ46öçfW'6÷"‚’°¢6öç7BF6Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçe÷F6r“òçfÇVR’ÇÂ°¢6öç7B÷&–vVâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçeö÷&–vVâr“òçfÇVRÇÂuDTs°¢6öç7BFW7F–æòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçeöFW7F–æòr“òçfÇVRÇÂuDTs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçe&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚F6’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B"ÒF6ò°¢ÆWBFVÂFVÒÂFæÂGÂFVC°¢7v—F6‚†÷&–vVâ’°¢66RuDTs¢FVÒ#²'&V³°¢66RuDTÒs¢FVÒÖF‚ç÷rƒ²"Â"’Ò²'&V³°¢66RuDäs¢FVÒÖF‚ç÷rƒ²‡"ò"’Â"’Ò²'&V³°¢66RuEs¢FVÒÖF‚ç÷rƒ²"ÂB’Ò²'&V³°¢66RuDTBs¢FVÒÖF‚ç÷rƒ²"Â3c’Ò²'&V³°¢Ğ¢FVÒÒÖF‚ç÷rƒ²FVÂò"’Ò°¢FæÒFVÒ¢#°¢GÒÖF‚ç÷rƒ²FVÒÂ2’Ò°¢FVBÒÖF‚ç÷rƒ²FVÒÂò3’Ò°¢ÆWBFW7EfÃ°¢7v—F6‚†FW7F–æò’²66RuDTs¢FW7EfÂÒFV²'&V³²66RuDTÒs¢FW7EfÂÒFVÓ²'&V³²66RuDäs¢FW7EfÂÒFæ²'&V³²66RuEs¢FW7EfÂÒG²'&V³²66RuDTBs¢FW7EfÂÒFVC²'&V³²Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã¦ÆVgC·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#åF6Â÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#åfÆ÷#Â÷FƒãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#å&W7VÇFFò‚G¶FW7F–æ÷Ò“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C¦&öÆC¶6öÆ÷#§f"‚ÒÖ66VçB’#âG²†FW7EfÂ¢’çFôf—†VBƒB—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#åDTÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG²‡FV¢’çFôf—†VBƒB—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#åDTÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG²‡FVÒ¢’çFôf—†VBƒB—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#åDäÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG²‡Fæ¢’çFôf—†VBƒB—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#åEÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG²‡G¢’çFôf—†VBƒB—ÒSÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åDTCÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#âG²‡FVB¢’çFôf—†VBƒB—ÒSÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£‡‚#ä÷&–vVã¢G¶÷&–vVçÒG·F6çFôf—†VBƒ"—ÒSÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)Hrâ•42)H)H ¦gVæ7F–öâ6Æ4—62‚’°¢6öç7BggRÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—65÷ggRr“òçfÇVR’ÇÂ°¢6öç7B6çBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—65ö6çBr“òçfÇVR’ÇÂ°¢6öç7B&–VâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v—65ö&–Vâr“òçfÇVRÇÂv÷G&÷2s°¢6öç7B6—7FVÖÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v—65÷6—7FVÖr“òçfÇVRÇÂwfÆ÷"s°¢6öç7BF6–æw&W6FÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—65÷F6r“òçfÇVR’ÇÂ°¢6öç7B—64W7Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—65öW7r“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v—65&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚ggRÇÂ6çB’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BF65&VÆW2Ò²6öÖ'W7F–&ÆW3¢"ÂÆ6ö†öÃ¢#Â6W'fW¦3¢#RÂ6–v'&–ÆÆ÷3¢SÂv6V÷63¢rÂfV†–7VÆ÷3¢#ÂÆ3¢Â÷G&÷3¢‚Ó°¢6öç7BF6&VÂÒF6–æw&W6FÇÂF65&VÆW5¶&–VåÒÇÂƒ°¢ÆWB—65VæBÒ°¢7v—F6‚‡6—7FVÖ’²66RwfÆ÷"s¢—65VæBÒggR¢‡F6&VÂò“²'&V³²66RvW7V6–f–6òs¢—65VæBÒ—64W7ÇÂã#s²'&V³²66RvÖ—‡Fòs¢—65VæBÒggR¢‡F6&VÂò’²†—64W7ÇÂã#r“²'&V³²Ğ¢6öç7B—65F÷FÂÒ—65VæB¢6çC°¢6öç7B&V6–õfVçF—62Ò‡ggR²—65VæB’¢6çC°¢6öç7B–wbÒ‡ggR²—65VæB’¢6çB¢ãƒ°¢6öç7B&V6–ôf–æÂÒ&V6–õfVçF—62²–wc°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã¦ÆVgC·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#ä6öæ6WFóÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#å2óÂ÷FƒãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ä•42÷"Væ–FCÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG¶—65VæBçFôf—†VBƒB—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ä•42F÷FÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C¦&öÆC¶6öÆ÷#§f"‚ÒÖ66VçB’#âG¶—65F÷FÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#å&V6–ò²•43Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG·&V6–õfVçF—62çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ä”ubƒ‚R“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG¶–wbçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#å&V6–òf–æÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C¦&öÆB#âG·&V6–ôf–æÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£‡‚#ä&–Vã¢G¶&–VçÒÂ6—7FVÖ¢G·6—7FVÖÒÂF6¢G·F6&VÇÒRG¶—64W7òrÂW7ã¢2òr²—64W7¢rwÓÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)H‚âÔ”äU,8Ô)H)H ¦gVæ7F–öâ6Æ4Ö–æW&–‚’°¢6öç7BWF–ÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–å÷WF–Æ–FBr“òçfÇVR’ÇÂ°¢6öç7B&öBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–å÷&öBr“òçfÇVR’ÇÂ°¢6öç7B&Vv–ÖVâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–å÷&Vv–ÖVâr“òçfÇVRÇÂvvVæW&Âs°¢6öç7B6öçG&–"Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–åö6öçG&–"r“òçfÇVR’ÇÂ°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vÖ–å&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚WF–Â’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢ÆWB&VvÆ–F6Ò°¢–b‡&Vv–ÖVâÓÒvvVæW&Âr’²&VvÆ–F6ÒãS²ÒVÇ6R°¢6öç7BÖ&vVâÒWF–Âò‡&öBÇÂ“°¢–b†Ö&vVâÂã’&VvÆ–F6Ò²VÇ6R–b†Ö&vVâÂãR’&VvÆ–F6Ò#²VÇ6R–b†Ö&vVâÂã#’&VvÆ–F6Ò3²VÇ6R–b†Ö&vVâÂã#R’&VvÆ–F6ÒC²VÇ6R–b†Ö&vVâÂã3’&VvÆ–F6ÒS²VÇ6R–b†Ö&vVâÂã3R’&VvÆ–F6Òc²VÇ6R–b†Ö&vVâÂãC’&VvÆ–F6Òs²VÇ6R–b†Ö&vVâÂãCR’&VvÆ–F6Òƒ²VÇ6R–b†Ö&vVâÂãS’&VvÆ–F6Ò“²VÇ6R–b†Ö&vVâÂãSR’&VvÆ–F6Ò²VÇ6R–b†Ö&vVâÂãcR’&VvÆ–F6Ò²VÇ6R–b†Ö&vVâÂãsR’&VvÆ–F6Ò#²VÇ6R–b†Ö&vVâÂãƒR’&VvÆ–F6Ò3²VÇ6R&VvÆ–F6ÒC°¢Ğ¢6öç7B&VvÆ–ÖW2ÒWF–Â¢‡&VvÆ–F6ò“°¢6öç7BÖ&vVä÷ÒWF–Âò‡&öBÇÂ“°¢ÆWB–×W7Ò°¢–b†Ö&vVä÷âã’–×W7ÒWF–Â¢„ÖF‚æÖ–â†Ö&vVä÷¢ãc2ÂãSB’“°¢6öç7Bw&fÖVâÒWF–Â¢ãS°¢6öç7B6öçG&–$ÖöçFòÒWF–Â¢†6öçG&–"ò“°¢6öç7BF÷FÄ6&vÒ&VvÆ–ÖW2²–×W7²w&fÖVâ²6öçG&–$ÖöçFó°¢6öç7BF6VfV7F—fÒ‡F÷FÄ6&vòWF–Â’¢°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã¦ÆVgC·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#ä6öæ6WFóÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#å2óÂ÷FƒãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#å&VvÌ:Ö‚G·&VvÆ–F6ÒR“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG·&VvÆ–ÖW2çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ä–×VW7FòW7V6–ÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG¶–×W7çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#äw&fÖVâƒãRR“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG¶w&fÖVâçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#ä6öçG&–"âföÂâ‚G¶6öçG&–'ÒR“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG¶6öçG&–$ÖöçFòçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶föçB×vV–v‡C¦&öÆB#åF÷FÂ6&vÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C¦&öÆC¶6öÆ÷#§f"‚ÒÖ66VçB’#âG·F÷FÄ6&vçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#åF6VfV7F—fÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C¦&öÆB#âG·F6VfV7F—fçFôf—†VBƒ"—ÒSÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–â×F÷£‡‚#å,:–v–ÖVã¢G·&Vv–ÖVçÒG·&öBòrÂ&öGV66œ;6ã¢r²&öBçFôÆö6ÆU7G&–ær‚’²rDÒr¢rwÓÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)H’â4”U%$RTÕ$U4)H)H ¦gVæ7F–öâ6Æ46–W'&R‚’°¢6öç7B7F—f÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&Uö7F—f÷2r“òçfÇVR’ÇÂ°¢6öç7B6—f÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&U÷6—f÷2r“òçfÇVR’ÇÂ°¢6öç7BG&&¦F÷&W2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&U÷G&&¦F÷&W2r“òçfÇVR’ÇÂ°¢6öç7Bæ–÷2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&Uöæ–÷2r“òçfÇVR’ÇÂ°¢6öç7BFWVF7VæBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&U÷7VæBr“òçfÇVR’ÇÂ°¢6öç7BFWVFÆ&÷&ÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&UöÆ&÷&Âr“òçfÇVR’ÇÂ°¢6öç7B§V–6–÷2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&Uö§V–6–÷2r“òçfÇVRÇÂvæòs°¢6öç7B6÷7Dæ÷F&–ÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&Uöæ÷F&–Âr“òçfÇVR’ÇÂ#°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&U÷F—òr“òçfÇVRÇÂtT•$Âs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6–W'&U&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚7F—f÷2bb6—f÷2’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BG&–Ööæ–òÒ7F—f÷2Ò6—f÷3°¢6öç7BFWVFF÷FÅFW&6W&÷2ÒFWVF7VæB²FWVFÆ&÷&Ã°¢6öç7B6÷7E5Tä%ÒF—òÓÓÒu4rÇÂF—òÓÓÒu4ròƒ¢CS°¢6öç7B6÷7DÆ—V–DÆ&÷&ÂÒG&&¦F÷&W2¢†æ–÷2¢CS²S“°¢6öç7B6÷7E&Vv—7G&ÂÒ3S°¢6öç7B6÷7FõF÷FÂÒ6÷7Dæ÷F&–Â²6÷7E5Tä%²6÷7E&Vv—7G&Â²6÷7DÆ—V–DÆ&÷&Â²FWVF7VæB²FWVFÆ&÷&Ã°¢6öç7BÖW6W4W7BÒB²G&&¦F÷&W2¢ãR²†§V–6–÷2ÓÓÒw6’rò‚¢’²†FWVF7VæBâò2¢“°¢6öç7BfÆT6–W'&RÒG&–Ööæ–òâbb6÷7FõF÷FÂÂG&–Ööæ–ò¢ãRbb§V–6–÷2ÓÓÒvæòs°¢6öç7B6÷2Ò°¢²WF¢t§VçFô7VW&FòF—6öÇV6œ;6ârÂ6÷7Fó¢ÂF–V×ó¢sÓ"ÖW6W2rÒÀ¢²WF¢tæöÖ'&Ö–VçFòÆ—V–FF÷"rÂ6÷7Fó¢ÂF–V×ó¢sÃÖW2rÒÀ¢²WF¢uV&Æ–66œ;6âVF–7F÷2ƒ2’rÂ6÷7Fó¢3SÂF–V×ó¢sÖW2rÒÀ¢²WF¢tÖ–çWF’W67&—GW&rÂ6÷7Fó¢6÷7Dæ÷F&–ÂÂF–V×ó¢sÓ"6VÒrÒÀ¢²WF¢t–ç67&—6œ;6â5Tä%rÂ6÷7Fó¢6÷7E5Tä%ÂF–V×ó¢sÓ"6VÒrÒÀ¢²WF¢tÆ—V–F6œ;6âG&–'WF&–rÂ6÷7Fó¢FWVF7VæBÂF–V×ó¢FWVF7VæBâòs2ÓbÖW6W2r¢sÖW2rÒÀ¢²WF¢tÆ—V–F6œ;6âÆ&÷&ÂrÂ6÷7Fó¢FWVFÆ&÷&ÂÂF–V×ó¢sÓ"ÖW6W2rÒÀ¢²WF¢t&¦5TäBFVf–æ—F—frÂ6÷7Fó¢ÂF–V×ó¢sÖW2rÒÀ¢Ó°¢–b†§V–6–÷2ÓÓÒw6’r’6÷2çW6‚‡²WF¢tW7W&"§V–6–÷2rÂ6÷7Fó¢ÂF–V×ó¢sbÓ‚ÖW6W2rÒ“°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£'ƒ¶föçB×6—¦S£G‚#à¢Ç7G&öæsåG&–Ööæ–òÌ:×V–Fó£Â÷7G&öæsâ2òG·G&–Ööæ–òçFôf—†VBƒ"—ÒÀ¢Ç7G&öæsäFWVFFW&6W&÷3£Â÷7G&öæsâ2òG¶FWVFF÷FÅFW&6W&÷2çFôf—†VBƒ"—ÒÀ¢Ç7G&öæsä6÷7FòF÷FÃ£Â÷7G&öæsâ2òG¶6÷7FõF÷FÂçFôf—†VBƒ"—Ğ¢Æ'#ãÇ7â7G–ÆSÒ&6öÆ÷#¢G·fÆT6–W'&Ròwf"‚ÒÖ66VçB’r¢r6SsF362wÓ¶föçB×vV–v‡C¦&öÆB#âG·fÆT6–W'&Rò~)É2fÆRÆVæ6W'&"r¢~)ÉrWfÌ;¦R&æFöæò÷&VW7G'V7GW&6œ;6âwÓÂ÷7ãà¢Æ'#ãÇ7G&öæsåF–V×ó£Â÷7G&öæsâG¶ÖW6W4W7BçFôf—†VBƒ—ÒÖW6W0¢ÂöF—cà¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C¦&öÆC¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	ù8²6÷3ÂöF—cà¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã¦ÆVgC·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#äWFÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#å2óÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#åF–V×óÂ÷FƒãÂ÷G#à¢G·6÷2æÖ‡ÓâÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#âG·æWFÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG·æ6÷7FòçFôf—†VBƒ—ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG·çF–V×÷ÓÂ÷FCãÂ÷G#æ’æ¦ö–â‚rr—Ğ¢Â÷F&ÆSà¢ÂöF—cæ°§Ğ ¢òò)H)H#âôDU"äõD$”Â)H)H ¦gVæ7F–öâ6Æ5öFW"‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%÷F—òr“òçfÇVRÇÂvvVæW&Âs°¢6öç7B÷F÷&vçFRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%ö÷F÷&vçFRr“òçfÇVRÇÂvæGW&Âs°¢6öç7BçVÖW&òÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%öçVÖW&òr“òçfÇVR’ÇÂ°¢6öç7B6&vôVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%ö6&vòr“òçfÇVRÇÂvvrs°¢6öç7BÆ¦òÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%÷Æ¦òr“òçfÇVR’ÇÂ3cS°¢6öç7Bf7VÇFFW2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%öf7VÇFFW2r“òçfÇVRÇÂrs°¢6öç7B7Væ'ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%÷7Væ'r“òçfÇVRÇÂw6’s°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wöFW%&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢6öç7B6÷7F÷4Ö–çWFÒ²vVæW&Ã¢#ÂW7V6–Ã¢#SÂ&W&W6VçF6–öã¢##ÂFÖ–æ—7G&6–öã¢##Â§VF–6–Ã¢#ƒÂÆ—F–v–ó¢3Ó°¢6öç7B6÷7DVÆWf6–öâÒ²vVæW&Ã¢#ÂW7V6–Ã¢SÂ&W&W6VçF6–öã¢CÂFÖ–æ—7G&6–öã¢CÂ§VF–6–Ã¢ƒÂÆ—F–v–ó¢#Ó°¢6öç7BÖ–çWFÒ†6÷7F÷4Ö–çWF·F—õÒÇÂ#’¢çVÖW&ó°¢6öç7BVÆWf6–öâÒ†6÷7DVÆWf6–öå·F—õÒÇÂ#’¢çVÖW&ó°¢6öç7B&Vv—7G&ÂÒ7Væ'ÓÓÒw6’ròS²†çVÖW&òâò3¢†çVÖW&òÒ’¢’¢°¢6öç7BF÷FÂÒÖ–çWF²VÆWf6–öâ²&Vv—7G&Ã°¢6öç7BF—ôÆ&VÇ2Ò²vVæW&Ã¢tvVæW&ÂrÂW7V6–Ã¢tW7V6–ÂrÂ&W&W6VçF6–öã¢u&W&W6VçF6œ;6ârÂFÖ–æ—7G&6–öã¢tFÖ–æ—7G&6œ;6ârÂ§VF–6–Ã¢t§VF–6–ÂrÂÆ—F–v–ó¢tÆ—F–v–òrÓ°¢6öç7B6&v÷2Ò²vs¢tvW&VçFRvVæW&ÂrÂöFW&Fó¢töFW&FòrÂÆVvÃ¢u&W&W6VçFçFRÆVvÂrÂ&övFó¢t&övFòrÓ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#à¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£'ƒ¶föçB×6—¦S£Gƒ¶föçB×vV–v‡C¦&öÆB#ï	ù9ÂG·F—ôÆ&VÇ5·F—õÒÇÂF—÷Ò(	BG¶6&v÷5¶6&vôVÅÒÇÂ6&vôVÇÓÂöF—cà¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#à¢ÇG#ãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã¦ÆVgC·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#ä6öæ6WFóÂ÷FƒãÇF‚7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C·FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&6¶w&÷VæC§f"‚ÒÖ66VçB“¶6öÆ÷#¢6ffb#å2óÂ÷FƒãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#äÖ–çWFæ÷F&–ÂŒ9rG¶çVÖW&÷Ò“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG¶Ö–çWFçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#äVÆWf6œ;6âW67&—GW&Œ9rG¶çVÖW&÷Ò“Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG¶VÆWf6–öâçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢G·7Væ'ÓÓÒw6’ròÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"’#å&Vv—7G&ò5Tä%Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡B#âG·&Vv—7G&ÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#æ¢rwĞ¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶föçB×vV–v‡C¦&öÆB#åDõDÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C¦&öÆC¶6öÆ÷#§f"‚ÒÖ66VçB’#âG·F÷FÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£G‚#ãÇ7G&öæsäf7VÇFFW3£Â÷7G&öæsãÆ'#ãÆVÒ7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#âG¶f7VÇFFW2ÇÂtæòW7V6–f–6F2wÓÂöVÓãÆ'#ãÆ'#ãÇ7G&öæsåÆ¦ó£Â÷7G&öæsâG·Æ¦÷ÒL:Ö2‚G´ÖF‚ç&÷VæB‡Æ¦òò3—ÒÖW6W2“Æ'#ãÇ7G&öæsä÷F÷&vçFS£Â÷7G&öæsâG¶÷F÷&vçFRÓÓÒvæGW&ÂròuW'6öææGW&Âr¢uW'6öæ§W,:ÖF–6wÒÂÇ7G&öæså5Tä%£Â÷7G&öæsâG·7Væ'ÓÓÒw6’ròu<:Òr¢tæòwÓÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶&6¶w&÷VæC§f"‚ÒÖ6&BÖ&r“·FF–æs£‡ƒ¶&÷&FW"×&F—W3£g‚#ï	ù8²&WV—6—F÷3¢6÷–Dä’ÂFW7F–Ööæ–òW67&—GW&Âf÷&×VÆ&–ò5Tä%Âvò2òG·&Vv—7G&ÂçFôf—†VBƒ—ÓÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)H#âdU$”d”4Dõ"%T2)H)H ¦7–æ2gVæ7F–öâ6Æ5'V2‚’°¢6öç7B'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'V5öçVÒr“òçfÇVRç&WÆ6R‚õÄBörÂrr’ÇÂrs°¢6öç7B6öç7VÇFÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'V5ö6öç7VÇFr“òçfÇVRÇÂw'V2s°¢6öç7BæöÖ'&RÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'V5öæöÖ'&Rr“òçfÇVRÇÂrs°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'V5÷F—òr“òçfÇVRÇÂwâs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w'V5&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‡'V2æÆVæwF‚Â’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B&RÒ'V2ç7V'7G&–ærƒÂ"“°¢6öç7BW6÷2Ò³RÂBÂ2Â"ÂrÂbÂRÂBÂ2Â%Ó°¢ÆWB7VÖÒ°¢f÷"†ÆWB’Ò²’Â²’²²’7VÖ³Ò'6T–çB‡'V5¶•Ò’¢W6÷5¶•Ó°¢6öç7B&W7FòÒ7VÖR°¢6öç7BF–ufW"Ò&W7FòÓÓÒò¢Ò&W7Fó°¢6öç7BfÆ–FòÒ'6T–çB‡'V5³Ò’ÓÓÒF–ufW"bb²srÂsRrÂsrrÂs#uÒæ–æ6ÇVFW2‡&R“°¢6öç7BF—÷2Ò²ss¢uW'6öææGW&ÂrÂsRs¢t6ö6–6œ;6ârÂsrs¢u6ö6–VFB6öç—VvÂrÂs#s¢uW'6öæ§W,:ÖF–6rÓ°¢6öç7BF—ô6öçG&–"ÒF—÷5·&UÒÇÂtFW66öæö6–Fòs°¢–b‚fÆ–Fò’°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB"7G–ÆSÒ&&÷&FW"ÖÆVgC£G‚6öÆ–B6VcCCCC·FF–æs£'ƒ¶&6¶w&÷VæC§&v&ƒ#3’Ãc‚Ãc‚Ãã‚’#ãÇ7G&öær7G–ÆSÒ&6öÆ÷#¢6VcCCCB#å%T2–çl:Æ–FóÂ÷7G&öæsãÇ7â7G–ÆSÒ&föçB×6—¦S£G‚#âL:Öv—FòfW&–f–6F÷"æò6ö–æ6–FRãÂ÷7ããÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶Ö&v–â×F÷£‡ƒ¶föçB×6—¦S£Gƒ¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6R#ãÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äW7W&FóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#âG¶F–ufW'ÓÂ÷FCãÂ÷G#ãÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ä–æw&W6FóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#âG·'V5³×ÓÂ÷FCãÂ÷G#ãÂ÷F&ÆSãÂöF—cæ°¢&WGW&ã°¢Ğ¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB#ãÇ7G&öæsî)ÈR%T26öâL:Öv—FòfW&–f–6F÷"l:Æ–FóÂ÷7G&öæsãÇ7G–ÆSÒ&Ö&v–â×F÷£‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#åF—òFWFV7FFó¢GµöW66T‡FÖÂ‡F—ô6öçG&–"—ÒâÆ&¬;6â6ö6–ÂÂW7FFò’6öæF–6œ;6âFV&Vâ6öæf—&Ö'6RVâÆ6öç7VÇFöf–6–ÂãÂ÷ãÆ'WGFöâ6Æ73Ò&'"G—SÒ&'WGFöâ"7G–ÆSÒ'v–GFƒ¦WFó¶Ö&v–â×F÷£‡‚"öæ6Æ–6³Ò'v–æF÷ræ÷Vâ…5TäEõ%T5õT$Ä”5õU$ÂÂuö&Ææ²rÂvæö÷VæW"Ææ÷&VfW'&W"r’#ä6öç7VÇF"Vâ5TäCÂö'WGFöããÂöF—cæ°§Ğ ¢òò)H)H#"â$õ”T44œ94âe)H)H ¦gVæ7F–öâ6Æ5&÷”g‚’°¢6öç7BVFBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•öVFBr“òçfÇVR’ÇÂ°¢6öç7B§V"Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•ö§V"r“òçfÇVR’ÇÂcS°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷7VVÆFòr“òçfÇVR’ÇÂ°¢6öç7B7&V2Ò‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•ö7&V2r“òçfÇVR’ÇÂ2’ò°¢6öç7B&VçBÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷&VçBr“òçfÇVR’ÇÂRãR’ò°¢6öç7B6öÖ—6–öâÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•ö6öÖ—6–öâr“òçfÇVR’ÇÂãc’’ò°¢6öç7B&–ÖÒ‡'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷&–Ör“òçfÇVR’ÇÂã#B’ò°¢6öç7BföæFô7BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•öföæFòr“òçfÇVR’ÇÂ°¢6öç7Bg6VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷6VÆV7Br“òçfÇVRÇÂw&–Ös°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷”g&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚7VVÆFòÇÂVFB’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7Bææ÷2ÒÖF‚æÖ‚ƒÂ§V"ÒVFB“°¢ÆWBföæFòÒföæFô7BÂ7VVÆFôÖVç7VÂÒ7VVÆFòÂ÷'FTÖVç7VÂÒ7VVÆFò¢ã°¢6öç7BFW65F÷FÂÒ7VVÆFò¢ƒã²6öÖ—6–öâ²&–Ö“°¢6öç7BFV6F2ÒµÓ°¢f÷"†ÆWBÒ²Âææ÷3²²²’°¢f÷"†ÆWBÒÒ²ÒÂ#²Ò²²’föæFòÒföæFò¢ƒ²&VçBò"’²÷'FTÖVç7VÃ°¢7VVÆFôÖVç7VÂ£Òƒ²7&V2“°¢÷'FTÖVç7VÂÒ7VVÆFôÖVç7VÂ¢ã°¢–b‚†²’RÓÓÒÇÂÓÓÒææ÷2Ò’FV6F2çW6‚‡²ææó¢²ÂföæFó¢ÖF‚ç&÷VæB†föæFò’Ò“°¢Ğ¢6öç7BVç6–öâÒföæFò¢ãBò#°¢6öç7BgæöÖ'&W2Ò²&–Ö¢u&–ÖrÂ†&—FC¢tŒ:&—FBrÂ&ögWGW&ó¢u&ögWGW&òrÂ–çFVw&¢t–çFVw&rÓ°¢6öç7B66Væ&–÷2Ò°¢²æöÖ'&S¢t6öç6W'fF÷"rÂF6¢ÖF‚æÖ‚ƒÂ&VçBÒãR’ÒÀ¢²æöÖ'&S¢t&6RrÂF6¢&VçBÒÀ¢²æöÖ'&S¢t÷F–Ö—7FrÂF6¢&VçB²ãRĞ¢Ó°¢6öç7B6ö×2ÒµÓ°¢f÷"†6öç7B66Væ&–òöb66Væ&–÷2’°¢ÆWBbÒföæFô7BÂ6ÒÒ7VVÆFòÂÒ7VVÆFò¢ã°¢f÷"†ÆWBÒ²Âææ÷3²²²’°¢f÷"†ÆWBÒÒ²ÒÂ#²Ò²²’bÒb¢ƒ²66Væ&–òçF6ò"’²°¢6Ò£Òƒ²7&V2“°¢Ò6Ò¢ã°¢Ğ¢6ö×2çW6‚‡²æöÖ'&S¢66Væ&–òææöÖ'&RÂF6¢66Væ&–òçF6ÂföæFó¢ÖF‚ç&÷VæB†b’ÂVç6–öã¢ÖF‚ç&÷VæB†b¢ãBò"’Ò“°¢Ğ¢ÆWBFV4‡FÖÂÒrs°¢f÷"†6öç7BBöbFV6F2’FV4‡FÖÂ³ÒÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#âG¶Bæææ÷Ò;÷3Â÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#å2òG¶BæföæFòçFôÆö6ÆU7G&–ær‚—ÓÂ÷FCãÂ÷G#æ°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB"7G–ÆSÒ'FF–æs£'‚#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶föçB×6—¦S£Gƒ¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6R#à¢ÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ'FF–æs£g‚‡ƒ¶föçB×vV–v‡C£c¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#å&W7VÖVâ(	BG¶gæöÖ'&W5¶g6VÅ×ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ä;÷26÷F—¦6œ;6ãÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#âG¶ææ÷7Ò;÷3Â÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ä÷'FRÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#å2òG²‡7VVÆFò¢ã’çFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äFW67VVçFòF÷FÃÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#å2òG¶FW65F÷FÂçFôf—†VBƒ"—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äföæFò&÷–V7FFóÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ66VçB’#å2òG´ÖF‚ç&÷VæB†föæFò’çFôÆö6ÆU7G&–ær‚—ÓÂ÷FCãÂ÷G#à¢ÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#åVç6œ;6âW7F–ÖFÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c#å2òG´ÖF‚ç&÷VæB‡Vç6–öâ’çFôÆö6ÆU7G&–ær‚—ÒöÖW3Â÷FCãÂ÷G#à¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ¶föçB×vV–v‡C£c¶föçB×6—¦S£G‚#å÷"L:–6FÂöF—cà¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶föçB×6—¦S£Gƒ¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶Ö&v–â×F÷£G‚#à¢ÇG#ãÇF‚7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã¦ÆVgC¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#åW,:ÖöFóÂ÷FƒãÇF‚7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#äföæFóÂ÷FƒãÂ÷G#à¢G¶FV4‡FÖÇĞ¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£'ƒ¶föçB×vV–v‡C£c¶föçB×6—¦S£G‚#äW66Væ&–÷2FR&VçF&–Æ–FCÂöF—cà¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶föçB×6—¦S£Gƒ¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶Ö&v–â×F÷£G‚#à¢ÇG#ãÇF‚7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã¦ÆVgC¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#äW66Væ&–óÂ÷FƒãÇF‚7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#åF6Â÷FƒãÇF‚7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#äföæFóÂ÷FƒãÇF‚7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡C¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#åVç6œ;6ãÂ÷FƒãÂ÷G#à¢G¶6ö×2æÖ†2ÓâÇG#ãÇFB7G–ÆSÒ'FF–æs£G‚‡‚#âG¶2ææöÖ'&WÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#âG²†2çF6¢’çFôf—†VBƒ—ÒSÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#å2òG¶2æföæFòçFôÆö6ÆU7G&–ær‚—ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£G‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#å2òG¶2çVç6–öâçFôÆö6ÆU7G&–ær‚—ÒöÖW3Â÷FCãÂ÷G#æ’æ¦ö–â‚rr—Ğ¢Â÷F&ÆSà¢Ç7G–ÆSÒ&Ö&v–ã£‚‡‚¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£'‚#äW7F–Ö6œ;6â&VfW&Væ6–ÂâÆ&VçF&–Æ–FB’ÆVç6œ;6âgWGW&2æòW7L:âv&çF—¦F2ãÂ÷à¢ÂöF—cæ°§Ğ ¢òò)H)H#2âäÄ•¤Dõ"4ôåE$Dõ2)H)H ¦gVæ7F–öâ6Æ46öçG"‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%÷F—òr“òçfÇVRÇÂv–æFVf–æ–Fòs°¢6öç7B'VV&Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%÷'VV&r“òçfÇVR’ÇÂ°¢6öç7B¦÷&æFÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö¦÷&æFr“òçfÇVR’ÇÂ°¢6öç7B&V×RÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%÷&V×Rr“òçfÇVR’ÇÂ°¢6öç7BGW&6–öâÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%öGW&6–öâr“òçfÇVR’ÇÂ°¢6öç7B6öæf–BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö6öæf–Br“òçfÇVRÇÂvæòs°¢6öç7BW†6ÇW2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%öW†6ÇW2r“òçfÇVRÇÂvæòs°¢6öç7B6ö×WBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö6ö×WBr“òçfÇVRÇÂvæòs°¢6öç7B7G2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö%ö7G2r“òæ6†V6¶VBÇÂfÇ6S°¢6öç7Bw&F–bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö%öw&F–br“òæ6†V6¶VBÇÂfÇ6S°¢6öç7B67G"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö%÷67G"r“òæ6†V6¶VBÇÂfÇ6S°¢6öç7Bf2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö%÷f2r“òæ6†V6¶VBÇÂfÇ6S°¢6öç7B6VrÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö%÷6Vrr“òæ6†V6¶VBÇÂfÇ6S°¢6öç7BW76ÇVBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%ö%öW76ÇVBr“òæ6†V6¶VBÇÂfÇ6S°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6öçG%&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚&V×R’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B&×bÒ#S°¢6öç7Bö²ÒµÒÂÆW'F2ÒµÓ°¢–b‡'VV&âbb'VV&ÃÒ“’ö²çW6‚‚uW,:ÖöFòFR'VV&FVçG&òFVÂÌ:ÖÖ—FR(šC2ÖW6W2’r“°¢–b‡'VV&â“bbF—òÓÒv6öæf–ç¦r’ÆW'F2çW6‚‚uW,:ÖöFòFR'VV&×W’Æ&vò(	BÜ:†–Öò2ÖW6W2r“°¢–b‡'VV&â3cR’ÆW'F2çW6‚‚tW†6VFRÌ:ÖÖ—FRÜ:†–Öòƒ;ò6öÆò6öæf–ç¦’r“°¢–b†¦÷&æFâbb¦÷&æFÃÒC‚’ö²çW6‚‚t¦÷&æFFVçG&òFVÂÌ:ÖÖ—FRƒC‚‚÷6VÒ’r“°¢–b†¦÷&æFâC‚’ÆW'F2çW6‚‚t¦÷&æFW†6VFRÜ:†–ÖòFRC‚‚÷6VÒr“°¢–b‡&V×RÂ&×b’ÆW'F2çW6‚‚u&V×VæW&6œ;6âFV&¦òFVÂÜ:Öæ–Öòf—FÂ…2òr²&×b²r’r“°¢VÇ6Rö²çW6‚‚u&V×VæW&6œ;6â(šRÜ:Öæ–Öòf—FÂr“°¢–b†w&F–b’ö²çW6‚‚tw&F–f–66œ;6â–æ6ÇV–Fr“°¢VÇ6RÆW'F2çW6‚‚tfÇFw&F–f–66œ;6â„ÆW’#ss3R’r“°¢–b†7G2’ö²çW6‚‚t5E2–æ6ÇV–Fr“°¢VÇ6RÆW'F2çW6‚‚tfÇF5E2„ÆW’3Cƒr’r“°¢–b‡f2’ö²çW6‚‚uf66–öæW2–æ6ÇV–F2ƒ3L:Ö2’r“°¢VÇ6RÆW'F2çW6‚‚tfÇFâf66–öæW2†FW&V6†ò—'&VçVæ6–&ÆR’r“°¢–b†W76ÇVB’ö²çW6‚‚tU54ÅTB–æ6ÇV–Fòr“°¢VÇ6RÆW'F2çW6‚‚tfÇFU54ÅTB†ö&Æ–vF÷&–ò’r“°¢–b‡67G"’ö²çW6‚‚u45E"–æ6ÇV–Fòr“°¢–b†6öæf–BÓÓÒw6’r’ö²çW6‚‚t6öæf–FVæ6–Æ–FB–æ6ÇV–Fr“°¢–b†W†6ÇW2ÓÓÒw6’r’ÆW'F2çW6‚‚tW†6ÇW6—f–FB(	BfW&–f–6"VRæòÆ–Ö—FR7F—f–FBÌ:Ö6—Fr“°¢–b†6ö×WBÓÓÒw6’r’ÆW'F2çW6‚‚t6Ì:W7VÆFR6ö×WFVæ6–(	BWfÇV"&¦öæ&–Æ–FBr“°¢–b‡F—òÓÓÒwÆ¦õöf–¦òrbbGW&6–öââc’ÆW'F2çW6‚‚t6öçG&FòÆ¦òf–¦òãR;÷2öG,:ÖFW6æGW&Æ—¦'6Rr“°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB"7G–ÆSÒ'FF–æs£'‚#à¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£c¶föçB×6—¦S£Gƒ¶Ö&v–âÖ&÷GFöÓ£‡‚#âG·F—òç&WÆ6R‚õòörÂrr’ç&WÆ6R‚õÆ%ÇrörÂ2Óâ2çFõWW$66R‚’—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£‡‚#ãÇ7â7G–ÆSÒ&föçB×vV–v‡C£c¶6öÆ÷#¢3#&3SVR#î)É27V×Æ–Ö–VçFò‚G¶ö²æÆVæwF‡Ò“Â÷7ããÂöF—cà¢ÇVÂ7G–ÆSÒ&Ö&v–ã£‡‚gƒ¶föçB×6—¦S£G‚#âG¶ö²æÖ†òÓâÆÆ’7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£G‚#âG¶÷ÓÂöÆ“æ’æ¦ö–â‚rr—ÓÂ÷VÃà¢G¶ÆW'F2æÆVæwF‚òÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£‡‚#ãÇ7â7G–ÆSÒ&föçB×vV–v‡C£c¶6öÆ÷#¢6VcCCCB#î)ªÆW'F2‚G¶ÆW'F2æÆVæwF‡Ò“Â÷7ããÂöF—cãÇVÂ7G–ÆSÒ&Ö&v–ã£‡‚gƒ¶föçB×6—¦S£G‚#âG¶ÆW'F2æÖ†ÓâÆÆ’7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£G‚#âG¶ÓÂöÆ“æ’æ¦ö–â‚rr—ÓÂ÷VÃæ¢rwĞ¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£‡ƒ·FF–æs£‡ƒ¶&6¶w&÷VæC§&v&ƒ3BÃ“rÃ“BÃã‚“¶&÷&FW"×&F—W3£Gƒ¶föçB×6—¦S£G‚#ãÇ7G&öæsä7V×Æ–Ö–VçFó£Â÷7G&öæsâG¶ö²æÆVæwF‚ãÒRò~)ÈRÇFòr¢ö²æÆVæwF‚ãÒ2ò~)ªÖVF–òr¢~)ØÂ&¦òwÓÂöF—cà¢ÂöF—cæ°§Ğ ¢òò)H)H#Bâ4„B4U4”ôäU2)H)H ¦gVæ7F–öâ6Æ46†B‚’°¢6öç7B'W66"Ò†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6†Eö'W66"r“òçfÇVRÇÂrr’çFôÆ÷vW$66R‚“°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6†E&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢6öç7B6W6–öæW2Ò7W%W6W"òvWD†—7B†7W%W6W"æVÖ–Â’æÖ‚‡6W76–öâÂ–æFW‚’Óâ‡²ââç6W76–öâÂö–æFWƒ¢–æFW‚Ò’’¢µÓ°¢–b‚6W6–öæW2æÆVæwF‚’°¢&÷‚æ–ææW$…DÔÂÒsÆF—b6Æ73Ò'7V6–Æ—¦VBÖV×G’×7FFR#ãÇ7G&öæsä;¦âæòF–VæW26öçfW'66–öæW2wV&FF2ãÂ÷7G&öæsãÇ7ãä–æ–6–Væ6öç7VÇF’gVVÇfRÂæVÂ&fW&Æ\:ÒãÂ÷7ããÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&'Fâ×"öæ6Æ–6³Ò&æWt6†B‚’#ä–æ–6–"&–ÖW&6öç7VÇFÂö'WGFöããÂöF—câs°¢&WGW&ã°¢Ğ¢6öç7Bf–ÇG&F2Ò'W66"ò6W6–öæW2æf–ÇFW"‡6W76–öâÓâ°¢6öç7B6öçFVçBÒ‡6W76–öâæÖW76vW2ÇÂµÒ’æÖ†ÖW76vRÓâÖW76vRæ6öçFVçBÇÂrr’æ¦ö–â‚rr“°¢&WGW&â·6W76–öâçF—FÆRÂ6W76–öâæFFRÂ6W76–öâæ&VÂ6öçFVçEÒç6öÖR‡fÇVRÓâ7G&–ær‡fÇVRÇÂrr’çFôÆ÷vW$66R‚’æ–æ6ÇVFW2†'W66"’“°¢Ò’¢6W6–öæW3°¢–b‚f–ÇG&F2æÆVæwF‚’²&÷‚æ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ'FF–æs£'ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äæò†’6öçfW'66–öæW2VR6ö–æ6–Fâ6öâÆ,;§7VVFãÂöF—câs²&WGW&ã²Ğ¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB"7G–ÆSÒ'FF–æs£¶÷fW&fÆ÷s¦†–FFVâ#à¢ÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶föçB×6—¦S£Gƒ¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6R#à¢ÇG#ãÇF‚7G–ÆSÒ'FF–æs£‡ƒ·FW‡BÖÆ–vã¦ÆVgC¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#äfV6†Â÷FƒãÇF‚7G–ÆSÒ'FF–æs£‡ƒ·FW‡BÖÆ–vã¦ÆVgC¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#ä6öçfW'66œ;6ãÂ÷FƒãÇF‚7G–ÆSÒ'FF–æs£‡ƒ·FW‡BÖÆ–vã¦ÆVgC¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#ì8&VÂ÷FƒãÇF‚7G–ÆSÒ'FF–æs£‡ƒ·FW‡BÖÆ–vã§&–v‡C¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#äÖVç6¦W3Â÷FƒãÇF‚7G–ÆSÒ'FF–æs£‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã"’#ãÂ÷FƒãÂ÷G#à¢G¶f–ÇG&F2æÖ‡2ÓâÇG#ãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ·v†—FR×76S¦æ÷w&#âGµöW66T‡FÖÂ‡2æFFRÇÂrÒr—ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£g‚‡‚#ãÆ'WGFöâG—SÒ&'WGFöâ"6Æ73Ò&6†B×6W76–öâÖ÷Vâ"öæ6Æ–6³Ò&ÆöD6öçb‚G·2åö–æFW‡Ò’#âGµöW66T‡FÖÂ‡2çF—FÆRÇÂt6öç7VÇFr—ÓÂö'WGFöããÂ÷FCãÇFB7G–ÆSÒ'FF–æs£g‚‡‚#âGµöW66T‡FÖÂ‡2æ&VÇÂtvVæW&Âr—ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ·FW‡BÖÆ–vã§&–v‡B#âG´'&’æ—4'&’‡2æÖW76vW2’ò2æÖW76vW2æÆVæwF‚¢ÓÂ÷FCãÇFB7G–ÆSÒ'FF–æs£g‚‡ƒ·v†—FR×76S¦æ÷w&#ãÆ'WGFöâöæ6Æ–6³Ò&W‡÷'F%6W6–öâ‚G·2åö–æFW‡Ò’"7G–ÆSÒ&föçB×6—¦S£Gƒ·FF–æs£'‚gƒ¶7W'6÷#§ö–çFW""F—FÆSÒ$W‡÷'F"#ï	ù:SÂö'WGFöãâÆ'WGFöâöæ6Æ–6³Ò&VÆ–Ö–æ%6W6–öâ‚G·2åö–æFW‡Ò’"7G–ÆSÒ&föçB×6—¦S£Gƒ·FF–æs£'‚gƒ¶7W'6÷#§ö–çFW#¶6öÆ÷#¢6VcCCCB"F—FÆSÒ$VÆ–Ö–æ"#ï	ùyÂö'WGFöããÂ÷FCãÂ÷G#æ’æ¦ö–â‚rr—Ğ¢Â÷F&ÆSà¢ÆF—b7G–ÆSÒ'FF–æs£‡ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶&÷&FW"×F÷£‚6öÆ–B&v&ƒ#‚Ã#‚Ã#‚Ãã’#âG¶f–ÇG&F2æÆVæwF‡Ò6W6œ;6â†W2“ÂöF—cà¢ÂöF—cæ°§Ğ¦gVæ7F–öâVÆ–Ö–æ%6W6–öâ†–æFW‚’°¢–b‚7W%W6W"’&WGW&ã°¢6öç7B6W6–öæW2ÒvWD†—7B†7W%W6W"æVÖ–Â“°¢–b‚6W6–öæW5¶–æFW…ÒÇÂ6öæf—&Ò‚|+ôVÆ–Ö–æ"W7F6öçfW'66œ;6ãòr’’&WGW&ã°¢6W6–öæW2ç7Æ–6R†–æFW‚Â“°¢6fT†—7B†7W%W6W"æVÖ–ÂÂ6W6–öæW2“°¢6Æ46†B‚“°§Ğ¦gVæ7F–öâW‡÷'F%6W6–öâ†–æFW‚’°¢–b‚7W%W6W"’&WGW&ã°¢6öç7B6W6–öâÒvWD†—7B†7W%W6W"æVÖ–Â•¶–æFW…Ó°¢–b‚6W6–öâ’&WGW&ã°¢6öç7B&Æö"ÒæWr&Æö"…´¥4ôâç7G&–æv–g’‡6W6–öâÂçVÆÂÂ"•ÒÂ²G—S¢vÆ–6F–öâö§6öârÒ“°¢6öç7BÆ–æ²ÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vr“°¢Æ–æ²æ‡&VbÒU$Âæ7&VFTö&¦V7EU$Â†&Æö"“°¢Æ–æ²æF÷væÆöBÒv6öçfW'66–öåöFV6Æ&g•òr²†–æFW‚²’²ræ§6öâs°¢Æ–æ²æ6Æ–6²‚“°¢U$Âç&Wfö¶Tö&¦V7EU$Â†Æ–æ²æ‡&Vb“°§Ğ ¢òò)H)H#RâtTäU$Dõ"”ädõ$ÔU2)H)H ¦gVæ7F–öâ6Æ4–æb‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–æe÷F—òr“òçfÇVRÇÂw&W7VÖVâs°¢6öç7B–æ–6–òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–æeö–æ–6–òr“òçfÇVRÇÂrs°¢6öç7Bf–âÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–æeöf–âr“òçfÇVRÇÂrs°¢6öç7B'V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–æe÷'V2r“òçfÇVRÇÂrs°¢6öç7BæöÖ'&RÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–æeöæöÖ'&Rr“òçfÇVRÇÂt6öçG&–'W–VçFRs°¢6öç7B&÷‚ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–æe&W7VÇBr“°¢–b‚&÷‚’&WGW&ã°¢–b‚'V2ÇÂæöÖ'&R’²&÷‚ç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BF—÷2Ò²&W7VÖVã¢u&W7VÖVâG&–'WF&–òrÂFV6Æ&6–öã¢tFV6Æ&6œ;6âÖVç7VÂrÂfÇV¦ó¢tfÇV¦ò6¦rÂÆæ–ÆÆ¢uÆæ–ÆÆrÂçVÃ¢t–×VW7F÷2çVÆW2rÂVF—F÷&–¢tVF—F÷,:Ö,:–FrÓ°¢6öç7BfV57G"Ò†–æ–6–òÇÂs##bÓr’²rr²†f–âÇÂs##bÓ"r“°¢&÷‚ç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&÷‚æ–ææW$…DÔÂÒÆF—b6Æ73Ò'7VæBÖ’×&W7VÇB"7G–ÆSÒ'FF–æs£gƒ¶föçB×6—¦S£G‚#ãÇ7G&öæsâGµöW66T‡FÖÂ‡F—÷5·F—õÒÇÂt–æf÷&ÖRr—ÓÂ÷7G&öæsãÇ7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–ã£‡‚#âGµöW66T‡FÖÂ‡'V2—Ò(	BGµöW66T‡FÖÂ†æöÖ'&R—Ò(	BGµöW66T‡FÖÂ†fV57G"—ÓÂ÷ãÇäfÇFâFF÷26öçF&ÆW2fW&–f–6&ÆW2&vVæW&"W7FR–æf÷&ÖRâ–×÷'Fò6öæV7FÆ–'&÷2FRfVçF2Â6ö×&2ÂÆæ–ÆÆ’6ÆF÷3²FV6Æ&e’æòf'&–6,:–æw&W6÷2ÂVw&W6÷2æ’–×VW7F÷2ãÂ÷ãÂöF—cæ°§Ğ¦gVæ7F–öâFW66&v$–æf÷&ÖR‚’°¢6öç7BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&W÷'E&Wf–Wrr“°¢–b‚’&WGW&ã°¢6öç7B‡FÖÂÒsÆ‡FÖÃãÆÖWF6†'6WCÒ%UDbÓ‚#ãÇF—FÆSä–æf÷&ÖRG&–'WF&–óÂ÷F—FÆSãÇ7G–ÆSæ&öG—¶föçBÖfÖ–Ç“¤&–ÂÇ6ç2×6W&–c¶föçB×6—¦S£Gƒ·FF–æs£#ƒ¶Ö‚×v–GFƒ£ƒƒ¶Ö&v–ã£WF÷×F&ÆW·v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6W×FBÇF‡·FF–æs£g‚ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6FFGÓÂ÷7G–ÆSãÆ&öG“âr²æ–ææW$…DÔÂç&WÆ6R‚óÆ'WGFöåµÇ5Å5Ò£óÅÂö'WGFöãâòÂrr’²sÂö&öG“ãÂö‡FÖÃâs°¢6öç7BÒFö7VÖVçBæ7&VFTVÆVÖVçB‚vr“°¢æ‡&VbÒvFF§FW‡Bö‡FÖÃ¶6†'6WC×WFbÓ‚Âr²Væ6öFUU$”6ö×öæVçB†‡FÖÂ“°¢æF÷væÆöBÒv–æf÷&ÖU÷G&–'WF&–õòr²FFRææ÷r‚’²ræ‡FÖÂs°¢æ6Æ–6²‚“°§Ğ ¦gVæ7F–öâ6Æ4—Fb‚’°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—FeöÖöçFòr’çfÇVR’ÇÂ°¢6öç7B÷2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—Feö÷2r’çfÇVR’ÇÂ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v—Fe÷F—òr’çfÇVS°¢6öç7BÆ–7V÷FÒãS°¢6öç7BF÷FÂÒÖöçFò¢Æ–7V÷F¢÷3°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v—Fe&W7VÇBr“°¢–b‚ÖöçFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCäÖöçFòG&ç666œ;6ãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶ÖöçFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF—ò÷W&6œ;6ãÂ÷FCãÇFCâr·F—ò²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäì+÷W&6–öæW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr¶÷2²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä•DbƒãRR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c#å2òr·F÷FÂçFôf—†VBƒB’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#äW7F–Ö6œ;6â&Væ÷W&6œ;6âw&fFâÆ2W†öæW&6–öæW2FWVæFVâFRÆ7VVçF’÷W&6œ;6â&Wf—7F2ÆVvÆÖVçFRÂæò6öÆòFVÂÖöçFòãÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4—#WF‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—#U÷7VVÆFòr’çfÇVR’ÇÂ°¢6öç7BÖW6W2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—#UöÖW6W2r’çfÇVR’ÇÂ#°¢6öç7Bw&F’Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—#Uöw&F’r’çfÇVR’ÇÂ°¢6öç7B&öæòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v—#Uö&öæòr’çfÇVR’ÇÂ°¢6öç7BöçgÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v—#Uööçgr’çfÇVS°¢6öç7BT•BÒD…õ%TÄU2çV—EµD…õ%TÄU2æ7W'&VçE–V%Ó°¢6öç7BFVGV66–öâÒr¢T•C°¢6öç7B–æw&W6ôçVÂÒ7VVÆFò¢ÖW6W2²w&F’²&öæó°¢6öç7B÷'FU&Wf—6–öæÂÒ7VVÆFò¢†öçgÓÓÒvöçròã2¢ã2’¢ÖW6W3°¢6öç7B&VçFæWFÒÖF‚æÖ‚ƒÂ–æw&W6ôçVÂÒFVGV66–öâ“°¢ÆWB–×VW7FòÒ°¢–b‡&VçFæWFâ’°¢–b‡&VçFæWFÃÒR¢T•B’–×VW7FòÒ&VçFæWF¢ãƒ°¢VÇ6R–b‡&VçFæWFÃÒ#¢T•B’–×VW7FòÒR¢T•B¢ã‚²‡&VçFæWFÒR¢T•B’¢ãC°¢VÇ6R–b‡&VçFæWFÃÒ3R¢T•B’–×VW7FòÒR¢T•B¢ã‚²R¢T•B¢ãB²‡&VçFæWFÒ#¢T•B’¢ãs°¢VÇ6R–b‡&VçFæWFÃÒCR¢T•B’–×VW7FòÒR¢T•B¢ã‚²R¢T•B¢ãB²R¢T•B¢ãr²‡&VçFæWFÒ3R¢T•B’¢ã#°¢VÇ6R–×VW7FòÒR¢T•B¢ã‚²R¢T•B¢ãB²R¢T•B¢ãr²¢T•B¢ã#²‡&VçFæWFÒCR¢T•B’¢ã3°¢Ğ¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v—#WF&W7VÇBr“°¢–b‚7VVÆFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCä–æw&W6òçVÂ''WFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶–æw&W6ôçVÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäFVGV66œ;6ârT•B…2òrµT•BçFôf—†VBƒ"’²r2÷R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶FVGV66–öâçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä÷'FR&Wf—6–öæÂ&VfW&Væ6–Â†æò&VGV6RÆ&6R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶÷'FU&Wf—6–öæÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCå&VçFæWF–×öæ–&ÆSÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c#å2òr·&VçFæWFçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä–×VW7Fò6Æ7VÆFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òr¶–×VW7FòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#î(KûˆòF63¢‚R†7FRT•B+rBR†7F#T•B+rrR†7F3RT•B+r#R†7FCRT•B+r3RW†6W6óÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4F—f–FVæF÷2‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vF—e÷F—òr’çfÇVS°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vF—eöÖöçFòr’çfÇVR’ÇÂ°¢6öç7BV¦W&6–6–òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vF—eöV¦W&6–6–òr’çfÇVS°¢ÆWBF6Ò°¢–b‡F—òÓÓÒvæGW&Âr’F6Ò†V¦W&6–6–òÓÓÒs##RrÇÂV¦W&6–6–òÓÓÒs##br’òR¢bãƒ°¢VÇ6R–b‡F—òÓÓÒv§W&–F–6r’F6Ò°¢VÇ6R–b‡F—òÓÓÒvæöFöÒr’F6ÒS°¢6öç7B&WFVæ6–öâÒÖöçFò¢F6ò°¢6öç7BæWFòÒÖöçFòÒ&WFVæ6–öã°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vF—f–FVæF÷5&W7VÇBr“°¢–b‚ÖöçFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCåF—ò6öçG&–'W–VçFSÂ÷FCãÇFCâr·F—ò²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäF—f–FVæFò''WFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶ÖöçFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF6&WFVæ6œ;6ãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr·F6²rSÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCå&WFVæ6œ;6ãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr·&WFVæ6–öâçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäæWFò&V6–&–FóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr¶æWFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4æôFöÒ‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væöE÷F—òr’çfÇVS°¢6öç7BÖöçFõU4BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væöEöÖöçFõ÷W6Br’çfÇVR’ÇÂ°¢6öç7BÖöçFõ6öÆW2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væöEöÖöçFõ÷6öÆW2r’çfÇVR’ÇÂ°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væöE÷F2r’çfÇVR’ÇÂ°¢6öç7B6F•—2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væöEö6F•÷—2r’çfÇVS°¢6öç7B&VæVbÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væöEö&VæVbr’çfÇVS°¢ÆWB&6RÒÖöçFõ6öÆW2ÇÂ‡F2òÖöçFõU4B¢F2¢“°¢ÆWBF6•"Ò3°¢–b‡F—òÓÓÒvF—f–FVæF÷2r’F6•"ÒS°¢VÇ6R–b‡F—òÓÓÒv–çFW&W6W2r’F6•"ÒBã““°¢VÇ6R–b‡F—òÓÓÒw&VvÆ–2r’F6•"Ò3°¢VÇ6R–b‡F—òÓÓÒv6—7FVæ6–÷FV6æ–6r’F6•"ÒS°¢VÇ6R–b‡F—òÓÓÒvvææ6–ö6—FÂr’F6•"ÒS°¢VÇ6R–b‡F—òÓÓÒw&VçFó&rÇÂF—òÓÓÒw&VçFó&FrÇÂF—òÓÓÒw&VçFóGFr’F6•"Ò3°¢–b†6F•—2ÓÒvæ–æwVæòr’F6•"ÒÖF‚æÖ–â‡F6•"ÂR“°¢6öç7B&WFVæ6–öâÒ&6R¢F6•"ò°¢6öç7B–wbÒ‡F—òÓÓÒv6—7FVæ6–÷FV6æ–6rÇÂF—òÓÓÒw&VvÆ–2r’ò&6R¢ã‚¢°¢6öç7BF÷FÂÒ&6RÒ&WFVæ6–öâÒ–wc°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væôFöÕ&W7VÇBr“°¢–b‚&6R’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCåF—ò&VçFÂ÷FCãÇFCâr·F—ò²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä&6R–×öæ–&ÆSÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶&6RçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF6•"Æ–6&ÆSÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr·F6•"²rSÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCå&WFVæ6œ;6â•#Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr·&WFVæ6–öâçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢†–wbòsÇG#ãÇFCä”ubƒ‚R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr¶–wbçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr¢rr’°¢sÇG#ãÇFCäæWFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr·F÷FÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢†6F•—2ÓÒvæ–æwVæòròsÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖvöÆB“·FW‡BÖÆ–vã¦6VçFW"#ï	øÉ4D’Æ–6&ÆR6öâr¶6F•—2²râF6&VGV6–Fr·F6•"²rSÂ÷FCãÂ÷G#âr¢rr’°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ462‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v65÷7VVÆFòr’çfÇVR’ÇÂ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v65÷F—òr’çfÇVS°¢6öç7BÖW6W2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v65öÖW6W2r’çfÇVR’ÇÂ#°¢–b‡F—òÓÓÒw&—fFòr’°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v65&W7VÇBr’ç7G–ÆRæF—7Æ’ÒvæöæRs°¢&WGW&ã°¢Ğ¢ÆWBF6Ò°¢–b‡7VVÆFòÃÒ#’F6Ò°¢VÇ6R–b‡7VVÆFòÃÒC’F6ÒS°¢VÇ6R–b‡7VVÆFòÃÒc’F6Òƒ°¢VÇ6R–b‡7VVÆFòÃÒ’F6Ò#°¢VÇ6RF6ÒS°¢6öç7B÷'FRÒ7VVÆFò¢F6ò°¢6öç7B÷'FTçVÂÒ÷'FR¢ÖW6W3°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v65&W7VÇBr“°¢–b‚7VVÆFòÇÂF—òÓÒwV&Æ–6òr’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCå7VVÆFòÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr·7VVÆFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF643Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr·F6²rSÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä÷'FRÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c#å2òr¶÷'FRçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä÷'FRçVÂW7F–ÖFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òr¶÷'FTçVÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ5&÷–ÇF–W2‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷F—òr’çfÇVS°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•öÖöçFòr’çfÇVR’ÇÂ°¢6öç7BÆ¦òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷Æ¦õ÷F—òr’çfÇVS°¢6öç7B6çBÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷Æ¦õö6çBr’çfÇVR’ÇÂ#°¢6öç7BFöÖ–6–Æ–òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•öFöÖ–6–Æ–òr’çfÇVS°¢6öç7B—2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•÷—2r’çfÇVS°¢6öç7B6F’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•ö6F’r’çfÇVS°¢6öç7BF–v—FÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•öF–v—FÂr’çfÇVS°¢ÆWBÖW6W2ÒÆ¦òÓÓÒvæ–÷2rò6çB¢"¢6çC°¢ÆWBÖ÷'DÖVç7VÂÒÖöçFòâbbÖW6W2âòÖöçFòòÖW6W2¢°¢ÆWBF6&WBÒ3°¢–b†FöÖ–6–Æ–òÓÓÒvFöÖ–6–Æ–Fõ÷¢r’°¢F6&WBÒS°¢ÒVÇ6R–b†FöÖ–6–Æ–òÓÓÒvFöÖ–6–Æ–Fõ÷âr’°¢F6&WBÒbãƒ°¢Ğ¢–b†FöÖ–6–Æ–òÓÓÒvæöFöÖ–6–Æ–Fòrbb6F’ÓÓÒw6’r’°¢–b…²w6ögGv&RrÂwFVçFRuÒæ–æ6ÇVFW2‡F—ò’’F6&WBÒS°¢VÇ6R–b‡F—òÓÓÒv6—7FVæ6–r’F6&WBÒ°¢VÇ6RF6&WBÒS°¢ÒVÇ6R–b†FöÖ–6–Æ–òÓÓÒvæöFöÖ–6–Æ–Fòrbb6F’ÓÓÒvæòr’°¢–b‡F—òÓÓÒv6—7FVæ6–r’F6&WBÒS°¢VÇ6R–b…²'6ögGv&R"Â'FVçFR"Â&¶æ÷v†÷r"Â&Ö&6%Òæ–æ6ÇVFW2‡F—ò’’F6&WBÒ3°¢Ğ¢6öç7B&WFVæ6–öâÒÖ÷'DÖVç7VÂ¢F6&WBò°¢6öç7B–wdÖVç7VÂÒ†FöÖ–6–Æ–òÓÓÒvæöFöÖ–6–Æ–Fòr’òÖ÷'DÖVç7VÂ¢ã‚¢°¢6öç7BF÷FÄÖVç7VÂÒÖ÷'DÖVç7VÂÒ&WFVæ6–öâÒ–wdÖVç7VÃ°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&÷•&W7VÇBr“°¢–b‚ÖöçFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCåF—ò–çFæv–&ÆSÂ÷FCãÇFCâr·F—ò²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäÖöçFò6öçG&FóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶ÖöçFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåÆ¦óÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr¶ÖW6W2²rÖW6W3Â÷FCãÂ÷G#âr°¢sÇG#ãÇFCäÖ÷'F—¦6œ;6âÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶Ö÷'DÖVç7VÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCå&WFVæ6œ;6â•"‚r·F6&WB²rR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr·&WFVæ6–öâçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢†–wdÖVç7VÂòsÇG#ãÇFCä”ubƒ‚R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr¶–wdÖVç7VÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr¢rr’°¢sÇG#ãÇFCäæWFòÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr·F÷FÄÖVç7VÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4göç‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöç÷7VVÆFòr’çfÇVR’ÇÂ°¢6öç7BVFBÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöçöVFBr’çfÇVR’ÇÂ3°¢6öç7B§V&–Æ6–öâÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöçö§V&–Æ6–öâr’çfÇVR’ÇÂcS°¢6öç7BföæFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöçöföæFòr’çfÇVR’ÇÂ°¢6öç7B&VçFÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöç÷&VçFr’çfÇVR’ÇÂS°¢6öç7BgÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vgöçögr’çfÇVS°¢6öç7Bæ–÷4öçÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöçöæ–÷5ööçr’çfÇVR’ÇÂ°¢6öç7B6öÖ—6–öâÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vgöçö6öÖ—6–öâr’çfÇVR’ÇÂãc“°¢6öç7Bæ–÷2Ò§V&–Æ6–öâÒVFC°¢6öç7B÷'FTÖVç7VÂÒ7VVÆFò¢ã°¢6öç7B÷'FTçVÂÒ÷'FTÖVç7VÂ¢#°¢6öç7B&VçFFV2Ò&VçFò°¢6öç7B6öÔFV2Ò6öÖ—6–öâò°¢6öç7BföæFõ&÷–V7FFòÒföæFò¢ÖF‚ç÷rƒ²&VçFFV2Ò6öÔFV2Âæ–÷2’²÷'FTçVÂ¢‚„ÖF‚ç÷rƒ²&VçFFV2Ò6öÔFV2Âæ–÷2’Ò’ò‡&VçFFV2Ò6öÔFV2ÇÂã’“°¢6öç7BVç6–öägÒföæFõ&÷–V7FFò¢‡&VçFFV2Ò6öÔFV2’ò"¢ãƒS°¢6öç7BVç6–öäöçÒÖF‚æÖ–â‡7VVÆFò¢ãsÂƒ“2“°¢6öç7Bæ–÷5&W7FçFW2Òæ–÷4öçãÒ#ò¢#Òæ–÷4öç°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vgöç&W7VÇBr“°¢–b‚7VVÆFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCå7VVÆFòÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr·7VVÆFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä÷'FReÖVç7VÂƒR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶÷'FTÖVç7VÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäföæFò&÷–V7FFòeÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr¶föæFõ&÷–V7FFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåVç6œ;6âW7F–ÖFeÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#¢34ƒddb#å2òr·Vç6–öägçFôf—†VBƒ"’²röÖW3Â÷FCãÂ÷G#âr°¢sÇG#ãÇFCåVç6œ;6âW7F–ÖFôå†Ü:‚“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#¢4S„##å2òr·Vç6–öäöççFôf—†VBƒ"’²röÖW3Â÷FCãÂ÷G#âr°¢†æ–÷5&W7FçFW2âòsÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#î(û2FRfÇFâr¶æ–÷5&W7FçFW2²r;÷2&Vç6œ;6âÜ:Öæ–Öôåƒ#;÷2“Â÷FCãÂ÷G#âr¢rr’°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ5W&6W6–öæW2‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW&6W÷F—òr’çfÇVS°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&6WöÖöçFòr’çfÇVR’ÇÂ°¢6öç7BF66VÂÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚wW&6W÷F6r’çfÇVR’ÇÂ°¢6öç7B6ö×&ö&çFRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW&6Wö6ö×&ö&çFRr’çfÇVS°¢6öç7B–wd–æ6ÇV–FòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW&6Wö–weö–æ6ÇV–Fòr’çfÇVS°¢ÆWB&6RÒ–wd–æ6ÇV–FòÓÓÒw6’ròÖöçFòòã‚¢ÖöçFó°¢ÆWBF6ÒF—òÓÓÒwW&6W6–öâròF66VÂ¢c°¢–b‡F—òÓÓÒw&WFVæ6–öâr’F6Ò6ö×&ö&çFRÓÓÒv&öÆWFrò2¢c°¢6öç7BW&6W6–öâÒ&6R¢F6ò°¢6öç7BF÷FÂÒÖöçFò²W&6W6–öã°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚wW&6W&W7VÇBr“°¢–b‚ÖöçFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCåF—óÂ÷FCãÇFCâr²‡F—òÓÓÒwW&6W6–öâròuW&6W6œ;6âr¢u&WFVæ6œ;6âr’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä&6SÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶&6RçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF6Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr·F6²rSÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCâr²‡F—òÓÓÒwW&6W6–öâròuW&6W6œ;6âr¢u&WFVæ6œ;6âr’²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#¢r²‡F—óÓÓÒwW&6W6–öâsòwf"‚Ò×&VB’s¢wf"‚Ò×&VB’r’²r#å2òr·W&6W6–öâçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF÷FÂv#Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr·F÷FÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4æ÷F47&VF—Fò‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væ5÷F—òr’çfÇVS°¢6öç7BÖöçFô÷&–rÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væ5öÖöçFõö÷&–v–æÂr’çfÇVR’ÇÂ°¢6öç7BÖöçFôÖöBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væ5öÖöçFõöÖöBr’çfÇVR’ÇÂ°¢6öç7BÖ÷F—fòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væ5öÖ÷F—fòr’çfÇVS°¢6öç7B–wd–æ6ÇV–FòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væ5ö–weö–æ6ÇV–Fòr’çfÇVS°¢6öç7BfVçF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚væ5÷fVçF5öçVÆW2r’çfÇVR’ÇÂ#°¢ÆWB&6TÖöBÒ–wd–æ6ÇV–FòÓÓÒw6’ròÖöçFôÖöBòã‚¢ÖöçFôÖöC°¢6öç7B–wdÖöBÒ&6TÖöB¢ãƒ°¢6öç7BF÷FÄÖöBÒF—òÓÓÒv7&VF—FòròÖÖöçFôÖöB¢ÖöçFôÖöC°¢6öç7BÆ–Ö—FTFW67VVçFòÒfVçF2¢ã°¢6öç7BW†6VFTÆ–Ö—FRÒÖ÷F—fòÓÓÒvFW67VVçFòrbbÖF‚æ'2†&6TÖöB’âÆ–Ö—FTFW67VVçFó°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚væ5&W7VÇBr“°¢–b‚ÖöçFô÷&–rÇÂÖöçFôÖöB’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCåF—óÂ÷FCãÇFCâr²‡F—òÓÓÒv7&VF—Fòròtæ÷FFR7,:–F—Fòr¢tæ÷FFRL:–&—Fòr’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäÖöçFòÖöF–f–66œ;6â†&6R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶&6TÖöBçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä”ubÖöF–f–66œ;6ãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶–wdÖöBçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä–×7FòF÷FÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#¢r²‡F—óÓÓÒv7&VF—Fòsòwf"‚Ò×&VB’s¢wf"‚ÒÖw&VVâ’r’²r#âr²‡F—óÓÓÒv7&VF—FòsòrÒs¢r²r’²r2òr´ÖF‚æ'2‡F÷FÄÖöB’çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢†W†6VFTÆ–Ö—FRòsÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖvöÆB“·FW‡BÖÆ–vã¦6VçFW"#î)ªûˆòW†6VFRÌ:ÖÖ—FRRfVçF2çVÆW2…2òr¶Æ–Ö—FTFW67VVçFòçFôf—†VBƒ"’²r“Â÷FCãÂ÷G#âr¢rr’°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4f7GW&VÆV7G&öæ–6‚’°¢6öç7B'V4VÖ’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vfU÷'V5öVÖ—6÷"r’çfÇVS°¢6öç7B'V5&V2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vfU÷'V5÷&V6WF÷"r’çfÇVS°¢6öç7BF—ôFö2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vfU÷F—õöFö2r’çfÇVS°¢6öç7B6W&–RÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vfU÷6W&–Rr’çfÇVS°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vfUöÖöçFõ÷F÷FÂr’çfÇVR’ÇÂ°¢6öç7B–wbÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vfUö–we÷F÷FÂr’çfÇVR’ÇÂ°¢6öç7BÖöæVFÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vfUöÖöæVFr’çfÇVS°¢6öç7B6W&–U&VvW‚Òõå´$eÕ³Ó•×³7ÒBó°¢6öç7B6W&–UfÆ–FÒ6W&–U&VvW‚çFW7B‡6W&–R“°¢6öç7B'V4VÖ•fÆ–FòÒ'V4VÖ’æÆVæwF‚ÓÓÒ°¢6öç7B'V5&V5fÆ–FòÒ'V5&V2æÆVæwF‚ÓÓÒÇÂ'V5&V2æÆVæwF‚ÓÓÒƒ°¢6öç7B–wdW7W&FòÒÖöçFò¢‚òƒ°¢6öç7B–wdö²ÒÖF‚æ'2†–wbÒ–wdW7W&Fò’Âã°¢6öç7BfÆ–F6–öæW2ÒµÓ°¢fÆ–F6–öæW2çW6‚‡¶Æ&VÃ¢u%T2VÖ—6÷"rÂö³¢'V4VÖ•fÆ–FòÂ×6s¢'V4VÖ•fÆ–Fòòul:Æ–FòƒL:Öv—F÷2’r¢tFV&RFVæW"L:Öv—F÷2wÒ“°¢fÆ–F6–öæW2çW6‚‡¶Æ&VÃ¢u%T2&V6WF÷"rÂö³¢'V5&V5fÆ–FòÂ×6s¢'V5&V5fÆ–Fòòul:Æ–Fòr¢tFV&RFVæW"‚òL:Öv—F÷2wÒ“°¢fÆ–F6–öæW2çW6‚‡¶Æ&VÃ¢u6W&–RrÂö³¢6W&–UfÆ–FÂ×6s¢6W&–UfÆ–Fòtf÷&ÖFò6÷'&V7Fòr¢tf÷&ÖFò–çl:Æ–Fò†V£¢c’wÒ“°¢fÆ–F6–öæW2çW6‚‡¶Æ&VÃ¢t”ubrÂö³¢–wdö²Â×6s¢–wdö²òt”ub6÷'&V7Fòƒ‚R’r¢t”ubæò6ö–æ6–FR†W7W&Fò2òr¶–wdW7W&FòçFôf—†VBƒ"’²r’wÒ“°¢6öç7BF÷FÄö²ÒfÆ–F6–öæW2æWfW'’‡bÓâbæö²“°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vfU&W7VÇBr“°¢–b‚ÖöçFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢ÆWB‡FÖÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×vV–v‡C£c·FW‡BÖÆ–vã¦6VçFW"#âr²‡F÷FÄö²ò~)ÈRFö7VÖVçFòl:Æ–Fòr¢~)ØÂFö7VÖVçFò6öâö'6W'f6–öæW2r’²sÂ÷FCãÂ÷G#âs°¢fÆ–F6–öæW2æf÷$V6‚‡bÓâ°¢‡FÖÂ³ÒsÇG#ãÇFCâr·bæÆ&VÂ²sÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#¢r²‡bæö³òwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²r#âr²‡bæö³ò~)ÈRs¢~)ØÂr’·bæ×6r²sÂ÷FCãÂ÷G#âs°¢Ò“°¢‡FÖÂ³ÒsÂ÷F&ÆSãÂöF—câs°¢F—bæ–ææW$…DÔÂÒ‡FÖÃ°§Ğ¦gVæ7F–öâ6Æ5&V7F–f–6F÷&–‚’°¢6öç7BÖW2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7EöÖW2r’çfÇVR’ÇÂ°¢6öç7Bæ–òÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7Eöæ–òr’çfÇVR’ÇÂ##S°¢6öç7BÖöçFô÷&–rÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7EöÖöçFõö÷&–v–æÂr’çfÇVR’ÇÂ°¢6öç7BÖöçFô6÷'"Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7EöÖöçFõö6÷'&Vv–Fòr’çfÇVR’ÇÂ°¢6öç7BG&–'WFòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7E÷G&–'WFòr’çfÇVS°¢6öç7BfV6†÷&–rÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7EöfV6†ö÷&–v–æÂr’çfÇVS°¢6öç7BfV6†&V7BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7EöfV6†÷&V7Br’çfÇVS°¢6öç7B7V'6æÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7E÷7V'6ær’çfÇVS°¢6öç7BöÖ—F–FòÒÖF‚æÖ‚ƒÂÖöçFô6÷'"ÒÖöçFô÷&–r“°¢6öç7BD”ÕôD”Å’ÒD…õ%TÄU2çF–ÔF–Ç•W&6VçBò°¢ÆWBF–2Ò°¢–b†fV6†÷&–rbbfV6†&V7B’°¢F–2ÒÖF‚æÖ‚ƒÂÖF‚æfÆö÷"‚†æWrFFR†fV6†&V7B’ÒæWrFFR†fV6†÷&–r’’òƒ£c£c£#B’’“°¢Ğ¢6öç7B–çFW&W2ÒöÖ—F–Fò¢D”ÕôD”Å’¢F–3°¢6öç7B×VÇF&6RÒöÖ—F–Fò¢ãS°¢6öç7Bw&GVÆ–FBÒ7V'6æÓÓÒw6’ròã“¢†F–2âòãC¢ãc“°¢6öç7B×VÇFf–æÂÒ×VÇF&6R¢ƒÒw&GVÆ–FB“°¢6öç7BF÷FÄFWVFÒöÖ—F–Fò²–çFW&W2²×VÇFf–æÃ°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w&V7E&W7VÇBr“°¢–b‚öÖ—F–Fò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCåW,:ÖöFóÂ÷FCãÇFCâr¶ÖW2²ròr¶æ–ò²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåG&–'WFòöÖ—F–FóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr¶öÖ—F–FòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäL:Ö2FRÖ÷&Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr¶F–2²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä–çFW,:—2D”Òƒã2RF–&–ò“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr¶–çFW&W2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä×VÇFSR†6öâw&GVÆ–FBr²†w&GVÆ–FB£’²rR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr¶×VÇFf–æÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF÷FÂFWVF&V7F–f–6F÷&–Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òr·F÷FÄFWVFçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4W76ÇVE6VæF’‚’°¢6öç7BF—ôV×ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW75÷F—õöV×&W6r’çfÇVS°¢6öç7B6V7F÷"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW75÷6V7F÷"r’çfÇVS°¢6öç7BçVÕG&"Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vW75öçVÕ÷G&&¦F÷&W2r’çfÇVR’ÇÂ°¢6öç7BÆæ–ÆÆÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vW75÷Ææ–ÆÆr’çfÇVR’ÇÂ°¢6öç7B6öç7G'V66–öâÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vW75ö6öç7G'V66–öâr’çfÇVR’ÇÂ°¢6öç7BföÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW75ö÷'FU÷föÇVçF&–òr’çfÇVS°¢6öç7B&–W6vòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW75÷&–W6vòr’çfÇVS°¢ÆWBF6W76ÇVBÒ6V7F÷"ÓÓÒvw&&–òròB¢“°¢–b†föÂÓÓÒw6’r’F6W76ÇVB³Ò°¢ÆWB6VæF’Ò°¢–b‡6V7F÷"ÓÓÒv–æGW7G&–Âr’6VæF’ÒÆæ–ÆÆ¢ãsS°¢ÆWB6Væ6–6òÒ°¢–b‡6V7F÷"ÓÓÒv6öç7G'V66–öâr’6Væ6–6òÒ6öç7G'V66–öâ¢ã#°¢VÇ6R6Væ6–6òÒÆæ–ÆÆ¢ãS°¢ÆWB67G"Ò°¢–b‡&–W6vòÓÓÒv&¦òr’67G"ÒÆæ–ÆÆ¢ãS°¢VÇ6R–b‡&–W6vòÓÓÒvÖVF–òr’67G"ÒÆæ–ÆÆ¢ã#°¢VÇ6R–b‡&–W6vòÓÓÒvÇFòr’67G"ÒÆæ–ÆÆ¢ã#S°¢6öç7BW76ÇVBÒÆæ–ÆÆ¢F6W76ÇVBò°¢6öç7BF÷FÄÖVç7VÂÒW76ÇVB²6VæF’²6Væ6–6ò²67G#°¢6öç7BF÷FÄçVÂÒF÷FÄÖVç7VÂ¢#°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vW75&W7VÇBr“°¢–b‚Ææ–ÆÆ’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCåÆæ–ÆÆÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr·Ææ–ÆÆçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäU54ÅTB‚r·F6W76ÇVB²rR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶W76ÇVBçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢‡6VæF’âòsÇG#ãÇFCå4TäD’ƒãsRR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr·6VæF’çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr¢rr’°¢sÇG#ãÇFCå4Tä4”4óÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr·6Væ6–6òçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢‡67G"âòsÇG#ãÇFCå45E"‚r·&–W6vò²r“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr·67G"çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr¢rr’°¢sÇG#ãÇFCåF÷FÂÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òr·F÷FÄÖVç7VÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF÷FÂçVÂW7F–ÖFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òr·F÷FÄçVÂçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4öç‚’°¢6öç7B7VVÆFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vöç÷7VVÆFòr’çfÇVR’ÇÂ°¢6öç7BVFBÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vöçöVFBr’çfÇVR’ÇÂ3°¢6öç7B§V&–Æ6–öâÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vöçö§V&–Æ6–öâr’çfÇVR’ÇÂcS°¢6öç7Bæ–÷2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vöçöæ–÷2r’çfÇVR’ÇÂ°¢6öç7BföæFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vöçöföæFòr’çfÇVR’ÇÂ°¢6öç7BVäÖ–âÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vöç÷Vç6–öåöÖ–âr’çfÇVS°¢6öç7B÷'FRÒ7VVÆFò¢ã3°¢6öç7B÷'FTçVÂÒ÷'FR¢#°¢6öç7Bæ–÷4fÇFçFW2ÒÖF‚æÖ‚ƒÂ#Òæ–÷2“°¢6öç7BVç6–öä&6RÒÖF‚æÖ–â†÷'FR¢ãs¢"Âƒ“2“°¢6öç7BVç6–öâÒVäÖ–âÓÓÒw6’ròÖF‚æÖ‚‡Vç6–öä&6RÂS’¢Vç6–öä&6S°¢6öç7BföæFôf–æÂÒföæFò²÷'FTçVÂ¢ÖF‚æÖ‚ƒÂ§V&–Æ6–öâÒVFB“°¢6öç7B;÷5&V7WW&6–öâÒföæFôf–æÂâbbVç6–öââòföæFôf–æÂò‡Vç6–öâ¢"’¢°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vöç&W7VÇBr“°¢–b‚7VVÆFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢6öç7B–ç÷'FRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vöçö÷'FRr“°¢–b†–ç÷'FR’–ç÷'FRçfÇVRÒu2òr²÷'FRçFôf—†VBƒ"“°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCå7VVÆFòÖVç7VÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr·7VVÆFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä÷'FRÖVç7VÂôåƒ2R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶÷'FRçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä;÷26÷F—¦F÷3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr¶æ–÷2²sÂ÷FCãÂ÷G#âr°¢†æ–÷4fÇFçFW2âòsÇG#ãÇFCä;÷2fÇFçFW2Ü:Öââ#Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#âr¶æ–÷4fÇFçFW2²sÂ÷FCãÂ÷G#âr¢rr’°¢sÇG#ãÇFCåVç6œ;6âW7F–ÖFÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr·Vç6–öâçFôf—†VBƒ"’²röÖW3Â÷FCãÂ÷G#âr°¢sÇG#ãÇFCä;÷2FR&V7WW&6œ;6â&÷‚ãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr¶;÷5&V7WW&6–öâçFôf—†VBƒ’²r;÷3Â÷FCãÂ÷G#âr°¢sÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã¦6VçFW"#î(KûˆòVç6œ;6âÜ:†–Öôå¢2òƒ“2öÖW2âÜ:Öæ–Öò#;÷2FR÷'FW2ãÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ46ö'&ç¦6ö7F—f‚’°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5öÖöçFòr’çfÇVR’ÇÂ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5÷F—òr’çfÇVS°¢6öç7BF–2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5öF–2r’çfÇVR’ÇÂ°¢6öç7B&Vv–ÖVâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5÷&Vv–ÖVâr’çfÇVS°¢6öç7BVÖ&&vòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5öVÖ&&vòr’çfÇVS°¢6öç7BfV6†æ÷F–bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5öfV6†öæ÷F–br’çfÇVS°¢6öç7BfV6†VÖ&&vòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5öfV6†öVÖ&&vòr’çfÇVS°¢6öç7BfV6†vòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5öfV6†÷vòr’çfÇVS°¢6öç7B–çFW&W2ÒF—òÓÓÒv×VÇFròçVÆÂ¢ÖöçFò¢…D…õ%TÄU2çF–ÔF–Ç•W&6VçBò’¢F–3°¢6öç7BF÷FÂÒ–çFW&W2ÓÓÒçVÆÂòçVÆÂ¢ÖöçFò²–çFW&W3°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6ö5&W7VÇBr“°¢–b‚ÖöçFò’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCäFWVF÷&–v–æÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶ÖöçFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä–çFW,:—3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#âr²†–çFW&W2ÓÓÒçVÆÂòu&WV–W&RF6ÆVvÂr¢u2òr¶–çFW&W2çFôf—†VBƒ"’’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF÷FÂ6–â6÷7F2f&–&ÆW3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#âr²‡F÷FÂÓÓÒçVÆÂòuVæF–VçFRFRF6ÆVvÂr¢u2òr·F÷FÂçFôf—†VBƒ"’’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äÆ26÷7F2Âv7F÷2’6÷7F÷2FRVÖ&&vòFWVæFVâFR7GV6–öæW2&VÆW3²æò6RW7F–Öâ6öÖò÷&6VçF¦W2f–7F–6–÷2ãÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ4Föæ6–öæW2‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFöå÷F—òr’çfÇVS°¢6öç7BF—ôFöâÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFöå÷F—õöFöæ6–öâr’çfÇVS°¢6öç7BÖöçFòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFöåöÖöçFòr’çfÇVR’ÇÂ°¢6öç7BVçF–FBÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFöåöVçF–FBr’çfÇVS°¢6öç7B&VçFÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFöå÷&VçFr’çfÇVR’ÇÂ°¢6öç7BV¦W&2Ò'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚vFöåöV¦W&6–6–òr’çfÇVR’ÇÂ##S°¢6öç7BÖ„FVGV6–&ÆRÒ&VçF¢ã°¢6öç7BÖöçFôFVGV6–&ÆRÒÖF‚æÖ–â†ÖöçFòÂÖ„FVGV6–&ÆR“°¢6öç7B†÷'&ô•"ÒÖöçFôFVGV6–&ÆR¢ã3°¢6öç7BæWFòÒÖöçFòÒ†÷'&ô•#°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚vFöå&W7VÇBr“°¢–b‚ÖöçFòÇÂ&VçF’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCäÖöçFòFöæFóÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶ÖöçFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäÌ:ÖÖ—FRFVGV6–&ÆRƒR&VçF“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶Ö„FVGV6–&ÆRçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäÖöçFòFVGV6–&ÆSÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c#å2òr¶ÖöçFôFVGV6–&ÆRçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä†÷'&ò•"W7F–ÖFòƒ3R“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖw&VVâ“¶föçB×vV–v‡C£c#å2òr¶†÷'&ô•"çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCä6÷7Fò&VÂFRÆFöæ6œ;6ãÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òr¶æWFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ¦gVæ7F–öâ6Æ57V6W6–öæW2‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5÷F—òr’çfÇVS°¢6öç7B†W&VBÒ'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5ö†W&VFW&÷2r’çfÇVR’ÇÂ°¢6öç7BF—ô†W&RÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5÷F—õö†W&VFW&òr’çfÇVS°¢6öç7B–æ×VV&ÆW2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5ö–æ×VV&ÆW2r’çfÇVR’ÇÂ°¢6öç7B×VV&ÆW2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5ö×VV&ÆW2r’çfÇVR’ÇÂ°¢6öç7BVfV7F—fòÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5öVfV7F—fòr’çfÇVR’ÇÂ°¢6öç7BFWVF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5öFWVF2r’çfÇVR’ÇÂ°¢6öç7BF÷FÄÖ6Ò–æ×VV&ÆW2²×VV&ÆW2²VfV7F—fòÒFWVF3°¢6öç7B÷$†W&RÒF÷FÄÖ6ò†W&VC°¢6öç7Bv7F÷4æ÷F&–ÆW2ÒF÷FÄÖ6¢ãS°¢6öç7Bv7F÷5&Vv—7G&ÆW2ÒF÷FÄÖ6¢ãS°¢6öç7BF÷FÄv7F÷2Òv7F÷4æ÷F&–ÆW2²v7F÷5&Vv—7G&ÆW3°¢6öç7BæWFòÒF÷FÄÖ6ÒF÷FÄv7F÷3°¢6öç7BF—bÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7V5&W7VÇBr“°¢–b‚F÷FÄÖ6’²F—bç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢F—bç7G–ÆRæF—7Æ’Òrs°¢F—bæ–ææW$…DÔÂÒsÆF—b6Æ73Ò'&W2×F&ÆR#ãÇF&ÆSâr°¢sÇG#ãÇFCäÖ6†W&VF—F&–F÷FÃÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c#å2òr·F÷FÄÖ6çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäv7F÷2æ÷F&–ÆW2ƒãRR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶v7F÷4æ÷F&–ÆW2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäv7F÷2&Vv—7G&ÆW2ƒãRR“Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#å2òr¶v7F÷5&Vv—7G&ÆW2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCåF÷FÂv7F÷3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚Ò×&VB’#å2òr·F÷FÄv7F÷2çFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäæWFòF—7G&–'V—#Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#§f"‚ÒÖw&VVâ’#å2òr¶æWFòçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFCäì+†W&VFW&÷3Â÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡B#âr¶†W&VB²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFB7G–ÆSÒ&föçB×vV–v‡C£c¶6öÆ÷#¢3”#S”#c¶föçB×6—¦S£G‚#åfÆ÷"÷"†W&VFW&óÂ÷FCãÇFB7G–ÆSÒ'FW‡BÖÆ–vã§&–v‡C¶föçB×vV–v‡C£c¶6öÆ÷#¢3”#S”#c¶föçB×6—¦S£G‚#å2òr·÷$†W&RçFôf—†VBƒ"’²sÂ÷FCãÂ÷G#âr°¢sÇG#ãÇFB6öÇ7ãÒ#""7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FF–ær×F÷£‡ƒ·FW‡BÖÆ–vã¦6VçFW"#î(KûˆòVâW,;¢æò†’–×VW7FòÆ†W&Væ6–†FW&övFò’â6’VÂ†W&VFW&òfVæFR&–Vâ–æ×VV&ÆRçFW2FR";÷2ÂÆ–6•"÷"vææ6–FR6—FÂƒRR6ö'&RF–fW&Væ6–’ãÂ÷FCãÂ÷G#âr°¢sÂ÷F&ÆSãÂöF—câs°§Ğ ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢òò5%•Dò”Õ$õdTÔTåE2(	B6ö–ävV6¶ò’ÂD2Â”ubÂ7F¶–ærÂ&–6Rv–FvWBÂ÷'FföÆ–ğ¢òò)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y  ¦6öç7Bö6t66†RÒ·Ó° ¦7–æ2gVæ7F–öâö6u&–6R†6ö–ä–G2’°¢6öç7B¶W’Ò6ö–ä–G3°¢6öç7B66†VBÒö6t66†U¶¶W•Ó°¢–b†66†VBbbFFRææ÷r‚’Ò66†VBçG2Â3’&WGW&â66†VBæFF°¢G'’°¢6öç7B"Òv—BfWF6‚†‡GG3¢òö’æ6ö–ævV6¶òæ6öÒö’÷c2÷6–×ÆR÷&–6Sö–G3ÒG¶6ö–ä–G7Ògg5ö7W'&Væ6–W3×W6Bf–æ6ÇVFUó#F‡%ö6†ævS×G'VV“°¢–b‚"æö²’&WGW&âçVÆÃ°¢6öç7BFFÒv—B"æ§6öâ‚“°¢ö6t66†U¶¶W•ÒÒ²FFÂG3¢FFRææ÷r‚’Ó°¢&WGW&âFF°¢Ò6F6‚†R’°¢&WGW&âçVÆÃ°¢Ğ§Ğ ¦7–æ2gVæ7F–öâö6t†—7F÷&–6Å&–6R†6ö–ä–BÂFFU7G"’°¢6öç7B¶W’Ò†—7EòG¶6ö–ä–GÕòG¶FFU7G'Ö°¢6öç7B66†VBÒö6t66†U¶¶W•Ó°¢–b†66†VBbbFFRææ÷r‚’Ò66†VBçG2Â3’&WGW&â66†VBæFF°¢G'’°¢6öç7B"Òv—BfWF6‚†‡GG3¢òö’æ6ö–ævV6¶òæ6öÒö’÷c2ö6ö–ç2òG¶6ö–ä–GÒö†—7F÷'“öFFSÒG¶FFU7G'Ö“°¢–b‚"æö²’&WGW&âçVÆÃ°¢6öç7BFFÒv—B"æ§6öâ‚“°¢6öç7B&–6RÒFFòæÖ&¶WEöFFòæ7W'&VçE÷&–6SòçW6C°¢ö6t66†U¶¶W•ÒÒ²FF¢&–6RÂG3¢FFRææ÷r‚’Ó°¢&WGW&â&–6S°¢Ò6F6‚†R’°¢&WGW&âçVÆÃ°¢Ğ§Ğ ¦7–æ2gVæ7F–öâö6u6V&6‚‡VW'’’°¢G'’°¢6öç7B"Òv—BfWF6‚†‡GG3¢òö’æ6ö–ævV6¶òæ6öÒö’÷c2÷6V&6ƒ÷VW'“ÒG¶Væ6öFUU$”6ö×öæVçB‡VW'’—Ö“°¢–b‚"æö²’&WGW&âµÓ°¢6öç7BFFÒv—B"æ§6öâ‚“°¢&WGW&âFFòæ6ö–ç3òç6Æ–6RƒÂ’ÇÂµÓ°¢Ò6F6‚†R’°¢&WGW&âµÓ°¢Ğ§Ğ ¦6öç7Bô4uô”E2Ò°¢t%D2s¢v&—F6ö–ârÂtUD‚s¢vWF†W&WVÒrÂu4ôÂs¢w6öÆærÀ¢uU4EBs¢wFWF†W"rÂuU4D2s¢wW6BÖ6ö–ârÂt$ä"s¢v&–ææ6V6ö–ârÀ¢tDs¢v6&FæòrÂtDõBs¢wöÆ¶F÷BrÂtÔD”2s¢vÖF–2ÖæWGv÷&²rÀ¢tÄ”ä²s¢v6†–æÆ–æ²rÂuTä’s¢wVæ—7vrÂu…%s¢w&—ÆRrÀ¢tD’s¢vF’rÂt$4‚s¢v&—F6ö–âÖ66‚rÂtÅD2s¢vÆ—FV6ö–ârÀ¢tDôtRs¢vFövV6ö–ârÂtd‚s¢vfÆæ6†RÓ"rÂuE%‚s¢wG&öâp§Ó° ¦6öç7Bô4uõDõÒ°¢¶–C¢v&—F6ö–ârÇ7–Ó¢t%D2rÆæÖS¢t&—F6ö–âwÒÇ¶–C¢vWF†W&WVÒrÇ7–Ó¢tUD‚rÆæÖS¢tWF†W&WVÒwÒÀ¢¶–C¢w6öÆærÇ7–Ó¢u4ôÂrÆæÖS¢u6öÆæwÒÇ¶–C¢wFWF†W"rÇ7–Ó¢uU4EBrÆæÖS¢uFWF†W"wÒÀ¢¶–C¢v&–ææ6V6ö–ârÇ7–Ó¢t$ä"rÆæÖS¢t$ä"wÒÇ¶–C¢w&—ÆRrÇ7–Ó¢u…%rÆæÖS¢u…%wÒÀ¢¶–C¢v6&FæòrÇ7–Ó¢tDrÆæÖS¢t6&FæòwÒÇ¶–C¢wöÆ¶F÷BrÇ7–Ó¢tDõBrÆæÖS¢uöÆ¶F÷BwÒÀ¢¶–C¢vfÆæ6†RÓ"rÇ7–Ó¢td‚rÆæÖS¢tfÆæ6†RwÒÇ¶–C¢vFövV6ö–ârÇ7–Ó¢tDôtRrÆæÖS¢tFövV6ö–âwĞ¥Ó° ¦6öç7B÷F466†RÒ·Ó° ¦7–æ2gVæ7F–öâövWED2‚’°¢–b…÷F466†RçF2bbFFRææ÷r‚’Ò÷F466†RçF2çG2Â3c’&WGW&â÷F466†RçF2æFF°¢G'’°¢6öç7B"Òv—BfWF6‚‚v‡GG3¢òö’æ—2ææWBçR÷c÷F—òÖ6Ö&–ò×7VæBr“°¢–b‡"æö²’°¢6öç7BBÒv—B"æ§6öâ‚“°¢6öç7B&W7VÇBÒ²6ö×&¢'6TfÆöB†Bæ6ö×&’ÂfVçF¢'6TfÆöB†BçfVçF’ÂfV6†¢BæfV6†ÇÂæWrFFR‚’çFô•4õ7G&–ær‚’ç7Æ—B‚uBr•³ÒÂ6÷W&6S¢u5TäBl:Ö•2ääUBåRrÓ°¢–b‡&W7VÇBæ6ö×&bb&W7VÇBçfVçF’°¢÷F466†RçF2Ò²FF¢&W7VÇBÂG3¢FFRææ÷r‚’Ó°¢&WGW&â&W7VÇC°¢Ğ¢Ğ¢Ò6F6‚†R’·Ğ¢G'’°¢6öç7B"Òv—BfWF6‚‚v‡GG3¢òö’æW†6†ævW&FRÖ’æ6öÒ÷cBöÆFW7BõU4Br“°¢–b‡"æö²’°¢6öç7BBÒv—B"æ§6öâ‚“°¢6öç7BVâÒBç&FW3òåTã°¢–b‡Vâ’°¢6öç7B&W7VÇBÒ²6ö×&¢VâÂfVçF¢VâÂfV6†¢BæFFRÇÂæWrFFR‚’çFô•4õ7G&–ær‚’ç7Æ—B‚uBr•³ÒÂ6÷W&6S¢uF—òÖVF–ò&VfW&Væ6–ÂrÓ°¢÷F466†RçF2Ò²FF¢&W7VÇBÂG3¢FFRææ÷r‚’Ó°¢&WGW&â&W7VÇC°¢Ğ¢Ğ¢Ò6F6‚†R’·Ğ¢F‡&÷ræWrW'&÷"‚tæò†’VâF—òFR6Ö&–òfW&–f–6&ÆRF—7öæ–&ÆRVâW7FRÖöÖVçFòâr“°§Ğ ¦6öç7B5$•Dõô”ueõD•õ2Ò°¢²fÇVS¢v6ö×&öW‡BrÂÆ&VÃ¢t6ö×&VâW†6†ævRW‡G&æ¦W&òrÂ–wc¢Â&6TÆVvÃ¢tW‡÷'F6œ;6âFR6W'f–6–÷2(	B–æfV7Fò”ub„'Bâ32Ä”ub’â5TäB–æf÷&ÖRCRÓ##2ârÒÀ¢²fÇVS¢v6ö×&÷RrÂÆ&VÃ¢t6ö×&VâW†6†ævRW'VæòrÂ–wc¢ã‚Â&6TÆVvÃ¢tw&fFò6öâ”ub‚RâVÂW†6†ævRW'Væò7L;¦6öÖò–çFW&ÖVF–&–òf–ææ6–W&ò7V¦WFò”ubârÒÀ¢²fÇVS¢wfVçFrÂÆ&VÃ¢ufVçFFR7&—Fò÷"U4BrÂ–wc¢Â&6TÆVvÃ¢tVæ¦Væ6œ;6âFR&–Vâ–çFæv–&ÆRæòw&fF6öâ”ub‡&–æ6—–òFRæWWG&Æ–FBFV6æöÌ;6v–6’ârÒÀ¢²fÇVS¢wfVçF÷RrÂÆ&VÃ¢ufVçFFR7&—Fò÷"6öÆW2rÂ–wc¢Â&6TÆVvÃ¢tÖ—6ÖòG&FÖ–VçFò(	Bæò†’”ubVâfVçFFR7&—FòVçG&RW'6öæ2æGW&ÆW2ârÒÀ¢²fÇVS¢vÖ–æW&–rÂÆ&VÃ¢tÖ–æW,:Ö‡&V6ö×Vç62’rÂ–wc¢Â&6TÆVvÃ¢tæò†’”ubÂ&V6–&—"&V6ö×Vç62FRÖ–æW,:Öâ6’W&W2V×&W6†&—GVÂÂÆ÷2–æw&W6÷2÷"Ö–æW,:ÖW7L:âw&fF÷26öâ•"W&òæò”ubârÒÀ¢²fÇVS¢w7F¶–ærrÂÆ&VÃ¢u7F¶–ærò––VÆBf&Ö–ærrÂ–wc¢Â&6TÆVvÃ¢u&V6ö×Vç62FTf“¢æò6Æ–f–6â6öÖò÷W&6œ;6âw&fF6öâ”ubâG&–'WFâ6öÆò÷"•"ƒ&F6FVv÷,:Ö’ârÒÀ¢²fÇVS¢w7vrÂÆ&VÃ¢u7v7&—FòÖ7&—FòrÂ–wc¢Â&6TÆVvÃ¢t–çFW&6Ö&–òFR7&—F÷2æòW2÷W&6œ;6âw&fF6öâ”ub‡G'VWVRFR&–VæW2–çFæv–&ÆW2(	B–æfV7Fò’ârÒÀ¢²fÇVS¢w'÷RrÂÆ&VÃ¢u%VçG&RW'Væ÷2rÂ–wc¢ã‚Â&6TÆVvÃ¢u6’W2†&—GVÂ’VÂfVæFVF÷"W26öçG&–'W–VçFRFVÂ”ubÂöG,:ÖW7F"w&fFòâW'6öææGW&Âæò†&—GVÃ¢–æfV7FòârÒÀ¢²fÇVS¢vægEö7&V6–öârÂÆ&VÃ¢t7&V6œ;6â’fVçFFRäeBrÂ–wc¢Â&6TÆVvÃ¢täeB6öÖò&–VâF–v—FÂ(	Bæò†’”ub6’VÂ7&VF÷"æòW26öçG&–'W–VçFRâ6’W2V×&W6ƒ7&6FVv÷,:Ö’ÂÆ–6"”ub‚RârÒÀ¢²fÇVS¢v6öÖ—6–öåöW†6†ævRrÂÆ&VÃ¢t6öÖ—6–öæW2÷"G&F–ærrÂ–wc¢ã‚Â&6TÆVvÃ¢tÆ26öÖ—6–öæW26ö'&F2÷"W†6†ævW2W'Væ÷2W7L:âw&fF26öâ”ub6öÖò6W'f–6–÷2F–v—FÆW2ârĞ¥Ó° ¦gVæ7F–öâ–æ—D–wd7&—Fò‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä–wd7&—Fôf÷&Òr“°¢–b‚VÂ’&WGW&ã°¢6öç7B÷G2Ò5$•Dõô”ueõD•õ2æÖ‡BÓâÆ÷F–öâfÇVSÒ"G·BçfÇVWÒ#âG·BæÆ&VÇÓÂö÷F–öãæ’æ¦ö–â‚rr“°¢VÂæ–ææW$…DÔÂÒ ¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"g#¶v£ƒ¶Ö‚×v–GFƒ£SSƒ¶Ö&v–âÖ&÷GFöÓ£G‚#à¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃåF—òFR÷W&6œ;6ãÂöÆ&VÃà¢Ç6VÆV7B–CÒ&–wd7&—FõF—ò"6Æ73Ò'7VæBÖ–çWB"F—FÆSÒ%6VÆV66–öæVÂF—òFR÷W&6œ;6â6öâ7&—FöÖöæVF2&FWFW&Ö–æ"6’Æ–6”ub"öæ6†ævSÒ&öä–wd7&—Fô6†ævR‚’#âG¶÷G7ÓÂ÷6VÆV7Cà¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃäÖöçFòVâU4CÂöÆ&VÃãÆ–çWBG—SÒ&çVÖ&W""–CÒ&–wd7&—FôÖöçFõU4B"6Æ73Ò'7VæBÖ–çWB"F—FÆSÒ$ÖöçFòFRÆ÷W&6œ;6âVâL;6Æ&W2W7FF÷Væ–FVç6W2"öæ–çWCÒ&öä–wd7&—Fô6†ævR‚’"Ö–ãÒ#"7FWÒ#ã"Æ6V†öÆFW#Ò##ãÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃåF—òFR6Ö&–òFö7VÖVçFFò…2ò÷"U4B“ÂöÆ&VÃãÆ–çWBG—SÒ&çVÖ&W""–CÒ&–wd7&—FõD2"6Æ73Ò'7VæBÖ–çWB"F—FÆSÒ%F—òFR6Ö&–ò6öÂöL;6Æ"W6Fò&6öçfW'F—"VÂÖöçFò"öæ–çWCÒ&öä–wd7&—Fô6†ævR‚’"Ö–ãÒ#"7FWÒ#ã"Æ6V†öÆFW#Ò$–æw&W6VÂD2Æ–6&ÆR#ãÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃäÖöçFòVâ6öÆW3ÂöÆ&VÃãÆ–çWBG—SÒ&çVÖ&W""–CÒ&–wd7&—FôÖöçFõ6öÆW2"6Æ73Ò'7VæBÖ–çWB"öæ–çWCÒ&öä–wd7&—Fô6†ævR‚’"Ö–ãÒ#"7FWÒ#ã"Æ6V†öÆFW#Ò#3sS"&VFöæÇ’7G–ÆSÒ&÷6—G“£ãr#ãÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃå:×2FVÂW†6†ævSÂöÆ&VÃà¢Ç6VÆV7B–CÒ&–wd7&—Fõ—2"6Æ73Ò'7VæBÖ–çWB"öæ6†ævSÒ&öä–wd7&—Fô6†ævR‚’#à¢Æ÷F–öâfÇVSÒ'R#åW,;£Âö÷F–öããÆ÷F–öâfÇVSÒ'W2#äW7FF÷2Væ–F÷3Âö÷F–öããÆ÷F–öâfÇVSÒ&÷F†W"#ä÷G&ò‡6–â6öçfVæ–ò“Âö÷F–öãà¢Â÷6VÆV7Cà¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃåF—òFR6öçG&'FSÂöÆ&VÃà¢Ç6VÆV7B–CÒ&–wd7&—Fô6öçG&'FR"6Æ73Ò'7VæBÖ–çWB"öæ6†ævSÒ&öä–wd7&—Fô6†ævR‚’#à¢Æ÷F–öâfÇVSÒ'â#åW'6öææGW&ÃÂö÷F–öããÆ÷F–öâfÇVSÒ'¢#åW'6öæ§W,:ÖF–6†V×&W6“Âö÷F–öããÆ÷F–öâfÇVSÒ&W†6†ævR#äW†6†ævR&Vv—7G&FóÂö÷F–öãà¢Â÷6VÆV7Cà¢ÂöF—cà¢ÂöF—cà¢Æ'WGFöâ6Æ73Ò&'"öæ6Æ–6³Ò&6Æ4–wd7&—Fò‚’"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"Âã‚“¶&÷&FW"Ö6öÆ÷#§&v&ƒSRÃƒ’Ãƒ"ÂãR’#ï	úzâ6Æ7VÆ"”ucÂö'WGFöãà¢ÆF—b–CÒ&–wd7&—Fõ&W7VÇB"7G–ÆSÒ&F—7Æ“¦æöæS¶Ö&v–â×F÷£G‚#ãÂöF—cà¢ÆF—b–CÒ&–wd7&—Fô–æfò"7G–ÆSÒ&Ö&v–â×F÷£Gƒ·FF–æs£'ƒ¶&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"ÂãR“¶&÷&FW"×&F—W3£—ƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Æ–æRÖ†V–v‡C£ãr#ãÂöF—cæ°§Ğ ¦gVæ7F–öâöä–wd7&—Fô6†ævR‚’°¢6öç7BW6BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—FôÖöçFõU4Br“òçfÇVR’ÇÂ°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—FõD2r“òçfÇVR’ÇÂ°¢6öç7B6öÆW4VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—FôÖöçFõ6öÆW2r“°¢–b‡6öÆW4VÂ’6öÆW4VÂçfÇVRÒ‡W6B¢F2’çFôf—†VBƒ"“°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—FõF—òr“òçfÇVRÇÂrs°¢6öç7B–æfòÒ5$•Dõô”ueõD•õ2æf–æB‡BÓâBçfÇVRÓÓÒF—ò“°¢6öç7B–æfôVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—Fô–æfòr“°¢–b†–æfôVÂbb–æfò’°¢–æfôVÂæ–ææW$…DÔÂÒÇ7G&öær7G–ÆSÒ&6öÆ÷#¢433”4S#ä&6RÆVvÃ£Â÷7G&öæsãÆ'#âG¶–æfòæ&6TÆVvÇÖ°¢Ğ§Ğ ¦gVæ7F–öâ6Æ4–wd7&—Fò‚’°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—FõF—òr“òçfÇVRÇÂrs°¢6öç7BÖöçFõU4BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—FôÖöçFõU4Br“òçfÇVR’ÇÂ°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—FõD2r“òçfÇVR’ÇÂ°¢6öç7BÖöçFõ6öÆW2ÒÖöçFõU4B¢F3°¢6öç7B—2ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—Fõ—2r“òçfÇVRÇÂwRs°¢6öç7B6öçG&'FRÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—Fô6öçG&'FRr“òçfÇVRÇÂwâs°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v–wd7&—Fõ&W7VÇBr“°¢–b‚VÂÇÂF—òÇÂÖöçFõU4BÇÂF2’²–b†VÂ’VÂç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7BF—ô–æfòÒ5$•Dõô”ueõD•õ2æf–æB‡BÓâBçfÇVRÓÓÒF—ò“°¢–b‚F—ô–æfò’&WGW&ã°¢ÆWBF6”ubÒF—ô–æfòæ–wc°¢–b‡F—òÓÓÒw'÷Rrbb6öçG&'FRÓÓÒwâr’F6”ubÒ°¢–b‡F—òÓÓÒv6ö×&÷Rrbb—2ÓÒwRr’F6”ubÒ°¢–b‡F—òÓÓÒvægEö7&V6–öârbb6öçG&'FRÓÓÒwâr’F6”ubÒ°¢6öç7B–we6öÆW2ÒÖöçFõ6öÆW2¢F6”uc°¢6öç7BF÷FÅ6öÆW2ÒÖöçFõ6öÆW2²–we6öÆW3°¢6öç7Bf×E2ÒâÓâu2òr²âçFôf—†VBƒ"“°¢6öç7BW†öæW&FòÒF6”ubÓÓÒ°¢VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢VÂæ–ææW$…DÔÂÒ ¢ÆF—b7G–ÆSÒ&&6¶w&÷VæC¢G¶W†öæW&Fòòw&v&ƒsbÃsRÃƒÂã‚’r¢w&v&ƒ#3ÃSrÃsÂãr’wÓ¶&÷&FW#£‚6öÆ–BG¶W†öæW&Fòòw&v&ƒsbÃsRÃƒÂã"’r¢w&v&ƒ#3ÃSrÃsÂã"’wÓ¶&÷&FW"×&F—W3£ƒ·FF–æs£G‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒ#‚Ãg"’“¶v£‡‚#à¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b#âG·F—ô–æfòæÆ&VÇÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#åF—òFR÷W&6œ;6ãÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b#âG¶W†öæW&Fòò~)ÈR”ädT5Dòr¢~)ªûˆòu$dDòwÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#âG¶W†öæW&Fòòtæòv”ubr¢u7V¦WFò”ubwÓÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#¢G¶W†öæW&Fòòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’wÒ#âG¶f×E2†ÖöçFõ6öÆW2—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#ä&6R–×öæ–&ÆSÂöF—cãÂöF—cà¢G²W†öæW&FòòÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#â²G¶f×E2†–we6öÆW2—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#ä”ub‚G²‡F6”ub¢’çFôf—†VBƒ—ÒR“ÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB’#âG¶f×E2‡F÷FÅ6öÆW2—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#åF÷FÂ6öâ”ucÂöF—cãÂöF—cæ¢rwĞ¢ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö&v–â×F÷£ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"Âãb“¶&÷&FW"×&F—W3£wƒ¶föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âG·F—ô–æfòæ&6TÆVvÇÓÂöF—cà¢ÂöF—cæ°§Ğ ¦6öç7B5D´”äuô´U’ÒwG÷7F¶–æuöÆVvÂs° ¦gVæ7F–öâvWE7F¶–ætFF‚’°¢G'’²&WGW&â¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ…5D´”äuô´U’’’ÇÂµÓ²Ò6F6‚†R’²&WGW&âµÓ²Ğ§Ğ ¦gVæ7F–öâ6fU7F¶–ætFF†FF’°¢·eWB…5D´”äuô´U’ÂFFÂw7F¶–æuöÆVvÂr“°§Ğ§&Vv—7FW$µe66÷R‚w7F¶–æuöÆVvÂrÂ‚’Óâ5D´”äuô´U’“° ¦gVæ7F–öâ–æ—E7F¶–æuG&6¶W"‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å7F¶–æuG&6¶W"r“°¢–b‚VÂ’&WGW&ã°¢6öç7BFFÒvWE7F¶–ætFF‚“°¢6öç7BF÷FÅ&Wv&G2ÒFFç&VGV6R‚‡2Â"’Óâ2²"æÖöçFõ6öÆW2Â“°¢6öç7B'•–V"Ò·Ó°¢FFæf÷$V6‚‡"Óâ°¢6öç7B–V"Ò‡"æfV6†ÇÂrr’ç7Æ—B‚rÒr•³ÒÇÂu6–â;òs°¢'•–V%·–V%ÒÒ†'•–V%·–V%ÒÇÂ’²"æÖöçFõ6öÆW3°¢Ò“°¢VÂæ–ææW$…DÔÂÒ ¢ÆF—b7G–ÆSÒ&Ö&v–âÖ&÷GFöÓ£G‚#à¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#¢433”4S¶Ö&v–âÖ&÷GFöÓ£‚#ï	ù8¢&W7VÖVâFR&V6ö×Vç63ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒ‚Ãg"’“¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£'‚#à¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b#âG¶FFæÆVæwF‡ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#å&V6ö×Vç62&Vv—7G&F3ÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#å2òG·F÷FÅ&Wv&G2çFôf—†VBƒ"—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#åF÷FÂ6öÆW3ÂöF—cãÂöF—cà¢ÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB’#å2òG²‡F÷FÅ&Wv&G2¢ãR’çFôf—†VBƒ"—ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#ä•"W7F–ÖFòƒRR“ÂöF—cãÂöF—cà¢ÂöF—cà¢G´ö&¦V7BæVçG&–W2†'•–V"’ç6÷'B‚…¶ÒÅ¶%Ò’Óâ"æÆö6ÆT6ö×&R†’’æÖ‚…·–V"ÂF÷FÅÒ’Óà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£G‚ƒ¶&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"ÂãR“¶&÷&FW"×&F—W3£gƒ¶Ö&v–âÖ&÷GFöÓ£Gƒ¶föçB×6—¦S£G‚#à¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB’#âG·–V'ÓÂ÷7ããÇ7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ“¶föçB×vV–v‡C£S#å2òG·F÷FÂçFôf—†VBƒ"—ÓÂ÷7ãà¢ÂöF—cæ ¢’æ¦ö–â‚rr—Ğ¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒC‚Ãg"’“¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£'‚#à¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃä7&—FòòFö¶VãÂöÆ&VÃà¢Æ–çWBG—SÒ'FW‡B"–CÒ'7F´7&—Fò"6Æ73Ò'7VæBÖ–çWB"F—FÆSÒ$æöÖ'&RFVÂFö¶Vâò7&—FöÖöæVFVRvVæW,;2Æ&V6ö×Vç6"Æ6V†öÆFW#Ò$UD‚Â4ôÂÂDâââ"fÇVSÒ$UD‚#à¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃåÆFf÷&Öò&÷Fö6öÆóÂöÆ&VÃà¢Æ–çWBG—SÒ'FW‡B"–CÒ'7FµÆFf÷&Ö"6Æ73Ò'7VæBÖ–çWB"Æ6V†öÆFW#Ò$Æ–FòÂ&–ææ6RÂfRâââ"fÇVSÒ$Æ–Fò#à¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃäfV6†FR&V6W6œ;6ãÂöÆ&VÃà¢Æ–çWBG—SÒ&FFR"–CÒ'7F´fV6†"6Æ73Ò'7VæBÖ–çWB"fÇVSÒ"G¶æWrFFR‚’çFô•4õ7G&–ær‚’ç7Æ—B‚uBr•³×Ò#à¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃäÖöçFò&Wv&B…U4B“ÂöÆ&VÃà¢Æ–çWBG—SÒ&çVÖ&W""–CÒ'7F´ÖöçFõU4B"6Æ73Ò'7VæBÖ–çWB"F—FÆSÒ%fÆ÷"FRÆ&V6ö×Vç6VâL;6Æ&W2U4BÂÖöÖVçFòFR&V6–&—&Æ"öæ–çWCÒ'7F´6Æ56öÆW2‚’"Ö–ãÒ#"7FWÒ#ã"Æ6V†öÆFW#Ò##à¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃåF—òFR6Ö&–óÂöÆ&VÃà¢Æ–çWBG—SÒ&çVÖ&W""–CÒ'7FµD2"6Æ73Ò'7VæBÖ–çWB"öæ–çWCÒ'7F´6Æ56öÆW2‚’"Ö–ãÒ#"7FWÒ#ã"Æ6V†öÆFW#Ò$–æw&W6VÂD2Æ–6&ÆR#à¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃäÖöçFò6öÆW3ÂöÆ&VÃà¢Æ–çWBG—SÒ&çVÖ&W""–CÒ'7F´ÖöçFõ6öÆW2"6Æ73Ò'7VæBÖ–çWB"&VFöæÇ’7G–ÆSÒ&÷6—G“£ãr#à¢ÂöF—cà¢ÆF—b6Æ73Ò&f’#ãÆÆ&VÃåF—òFR&V6ö×Vç6ÂöÆ&VÃà¢Ç6VÆV7B–CÒ'7FµF—ò"6Æ73Ò'7VæBÖ–çWB#à¢Æ÷F–öâfÇVSÒ'7F¶–ær#å7F¶–æsÂö÷F–öãà¢Æ÷F–öâfÇVSÒ'––VÆB#å––VÆBf&Ö–æsÂö÷F–öãà¢Æ÷F–öâfÇVSÒ&ÆVæF–ær#äÆVæF–ærò,:—7FÖ÷3Âö÷F–öãà¢Æ÷F–öâfÇVSÒ&Ç#äÆ—V–F—G’ööÃÂö÷F–öãà¢Æ÷F–öâfÇVSÒ&—&G&÷#ä—&G&÷Âö÷F–öãà¢Â÷6VÆV7Cà¢ÂöF—cà¢ÂöF—cà¢Æ'WGFöâ6Æ73Ò&'"öæ6Æ–6³Ò&FE7F¶–æu&Wv&B‚’"7G–ÆSÒ&&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"Âã‚“¶&÷&FW"Ö6öÆ÷#§&v&ƒSRÃƒ’Ãƒ"ÂãR“¶Ö&v–âÖ&÷GFöÓ£G‚#â²&Vv—7G&"&V6ö×Vç6Âö'WGFöãà¢ÆF—b–CÒ'7F´†—7F÷'’#ãÂöF—cæ°¢&VæFW%7F¶–æt†—7F÷'’‚“°§Ğ ¦gVæ7F–öâ7F´6Æ56öÆW2‚’°¢6öç7BW6BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7F´ÖöçFõU4Br“òçfÇVR’ÇÂ°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7FµD2r“òçfÇVR’ÇÂ°¢6öç7B6öÆW4VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7F´ÖöçFõ6öÆW2r“°¢–b‡6öÆW4VÂ’6öÆW4VÂçfÇVRÒ‡W6B¢F2’çFôf—†VBƒ"“°§Ğ ¦gVæ7F–öâFE7F¶–æu&Wv&B‚’°¢6öç7B7&—FòÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7F´7&—Fòr“òçfÇVSòçG&–Ò‚“°¢6öç7BÆFf÷&ÖÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7FµÆFf÷&Ör“òçfÇVSòçG&–Ò‚“°¢6öç7BfV6†ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7F´fV6†r“òçfÇVS°¢6öç7BÖöçFõU4BÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7F´ÖöçFõU4Br“òçfÇVR’ÇÂ°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚w7FµD2r“òçfÇVR’ÇÂ°¢6öç7BF—òÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7FµF—òr“òçfÇVRÇÂw7F¶–ærs°¢–b‚7&—FòÇÂfV6†ÇÂÖöçFõU4B’²GFö7B‚t6ö×ÆWFFöF÷2Æ÷26×÷2&WVW&–F÷2ârÂwv&âr“²&WGW&ã²Ğ¢6öç7BFFÒvWE7F¶–ætFF‚“°¢FFçW6‚‡²7&—FòÂÆFf÷&ÖÂfV6†ÂÖöçFõU4BÂF2ÂÖöçFõ6öÆW3¢ÖöçFõU4B¢F2ÂF—òÂ–C¢FFRææ÷r‚’Ò“°¢6fU7F¶–ætFF†FF“°¢GFö7B‚u&V6ö×Vç6&Vv—7G&F6÷'&V7FÖVçFRârÂvö²r“°¢–æ—E7F¶–æuG&6¶W"‚“°§Ğ ¦gVæ7F–öâ&VÖ÷fU7F¶–æu&Wv&B†–B’°¢ÆWBFFÒvWE7F¶–ætFF‚“°¢FFÒFFæf–ÇFW"‡"Óâ"æ–BÓÒ–B“°¢6fU7F¶–ætFF†FF“°¢–æ—E7F¶–æuG&6¶W"‚“°§Ğ ¦gVæ7F–öâ&VæFW%7F¶–æt†—7F÷'’‚’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚w7F´†—7F÷'’r“°¢–b‚VÂ’&WGW&ã°¢6öç7BFFÒvWE7F¶–ætFF‚“°¢–b‚FFæÆVæwF‚’²VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FF–æs£'ƒ·FW‡BÖÆ–vã¦6VçFW"#äæò†’&V6ö×Vç62&Vv—7G&F2;¦âãÂöF—câs²&WGW&ã²Ğ¢6öç7BF—ôÆ&VÇ2Ò²7F¶–æs¢u7F¶–ærrÂ––VÆC¢u––VÆBf&Ö–ærrÂÆVæF–æs¢tÆVæF–ærrÂÇ¢tÆ—V–F—G’ööÂrÂ—&G&÷¢t—&G&÷rÓ°¢VÂæ–ææW$…DÔÂÒ ¢ÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S¶6öÆ÷#¢433”4S¶Ö&v–âÖ&÷GFöÓ£‡‚#ï	ù8²†—7F÷&–ÂFR&V6ö×Vç63ÂöF—cà¢ÆF—b7G–ÆSÒ&Ö‚Ö†V–v‡C£3ƒ¶÷fW&fÆ÷r×“¦WFò#à¢Gµ²ââæFFÒç&WfW'6R‚’æÖ‡"Óâ ¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶Æ–vâÖ—FV×3¦6VçFW#·FF–æs£‡‚ƒ¶&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"ÂãB“¶&÷&FW"×&F—W3£wƒ¶Ö&v–âÖ&÷GFöÓ£Gƒ¶föçB×6—¦S£G‚#à¢ÆF—b7G–ÆSÒ&fÆWƒ£#à¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚Ò×FW‡B“¶föçB×vV–v‡C£S#âG·"æ7&—F÷ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–âÖÆVgC£g‚#âG·"çÆFf÷&ÖÇÂrwÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–âÖÆVgC£g‚#âG·"æfV6†ÇÂrwÓÂ÷7ãà¢Ç7â6Æ73Ò&6ÂÖ&FvRG·"çF—òÓÓÒw7F¶–ærròvçVWfòr¢"çF—òÓÓÒw––VÆBròw&–W6vòr¢wf6–òwÒ"7G–ÆSÒ&Ö&v–âÖÆVgC£gƒ¶föçB×6—¦S£—‚#âG·F—ôÆ&VÇ5·"çF—õÒÇÂ"çF—÷ÓÂ÷7ãà¢ÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡‚#à¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ“¶föçB×vV–v‡C£S#å2òG·"æÖöçFõ6öÆW2çFôf—†VBƒ"—ÓÂ÷7ãà¢Ç7â7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#åU4BG·"æÖöçFõU4BçFôf—†VBƒ"—ÓÂ÷7ãà¢Æ'WGFöâöæ6Æ–6³Ò'&VÖ÷fU7F¶–æu&Wv&B‚G·"æ–GÒ’"7G–ÆSÒ&&6¶w&÷VæC¦æöæS¶&÷&FW#¦æöæS¶6öÆ÷#§f"‚Ò×&VB“¶7W'6÷#§ö–çFW#¶föçB×6—¦S£Gƒ·FF–æs£G‚#ì9sÂö'WGFöãà¢ÂöF—cà¢ÂöF—cà¢’æ¦ö–â‚rr—Ğ¢ÂöF—cæ°§Ğ ¦gVæ7F–öâ6Æ57F¶–æuF÷FÂ‚’°¢6öç7BFFÒvWE7F¶–ætFF‚“°¢6öç7BF÷FÅU4BÒFFç&VGV6R‚‡2Â"’Óâ2²"æÖöçFõU4BÂ“°¢6öç7BF÷FÅ6öÆW2ÒFFç&VGV6R‚‡2Â"’Óâ2²"æÖöçFõ6öÆW2Â“°¢6öç7B—$W7F–ÖFòÒF÷FÅ6öÆW2¢ãS°¢6öç7B'•–V"Ò·Ó°¢FFæf÷$V6‚‡"Óâ°¢6öç7B–V"Ò‡"æfV6†ÇÂrr’ç7Æ—B‚rÒr•³ÒÇÂu6–â;òs°¢'•–V%·–V%ÒÒ†'•–V%·–V%ÒÇÂ’²"æÖöçFõ6öÆW3°¢Ò“°¢&WGW&â²F÷FÅU4BÂF÷FÅ6öÆW2Â—$W7F–ÖFòÂ'•–V"Â6÷VçC¢FFæÆVæwF‚Ó°§Ğ ¦7–æ2gVæ7F–öâÆöD7&—Fõ&V6–÷2‚’°¢6öç7Bw&–BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å&V6–÷4w&–Br“°¢6öç7BW'$VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å&V6–÷4W'&÷"r“°¢–b‚w&–B’&WGW&ã°¢w&–Bæ–ææW$…DÔÂÒô4uõDõæÖ†2ÓâÆF—b6Æ73Ò&g&62Ö6&B#ãÆF—b6Æ73Ò&g&62Ö6&BÖÂ#âG¶2ç7–×ÓÂöF—cãÆF—b6Æ73Ò&g&62Ö6&B×b"7G–ÆSÒ&föçB×6—¦S£G‚"–CÒ'%òG¶2æ–GÒ#î(	CÂöF—cãÆF—b6Æ73Ò&g&62Ö6&BÖÂ"7G–ÆSÒ&föçB×6—¦S£—‚"–CÒ'##EòG¶2æ–GÒ#ãÂöF—cãÂöF—cæ’æ¦ö–â‚rr“°¢6öç7B–G2Òô4uõDõæÖ†2Óâ2æ–B’æ¦ö–â‚rÂr“°¢6öç7BFFÒv—Bö6u&–6R†–G2“°¢–b‚FF’°¢–b†W'$VÂ’W'$VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&WGW&ã°¢Ğ¢–b†W'$VÂ’W'$VÂç7G–ÆRæF—7Æ’ÒvæöæRs°¢6öç7BF2Òv—BövWED2‚“°¢6öç7BF5fVçFÒçVÖ&W"‡F2çfVçF’ÇÂ°¢f÷"†6öç7B2öbô4uõDõ’°¢6öç7B&–6RÒFF¶2æ–EÓòçW6C°¢6öç7B6†ævRÒFF¶2æ–EÓòçW6Eó#F…ö6†ævS°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B†%òG¶2æ–GÖ“°¢6öç7BVÃ#BÒFö7VÖVçBævWDVÆVÖVçD'”–B†##EòG¶2æ–GÖ“°¢–b†VÂ’°¢6öç7B6öÆW2Ò&–6RbbF5fVçFò&–6R¢F5fVçF¢°¢VÂæ–ææW$…DÔÂÒÇ7â7G–ÆSÒ&föçB×6—¦S£G‚#âBG·&–6Rò&–6RçFôÆö6ÆU7G&–ær‡VæFVf–æVBÇ¶Ö†–×VÔg&7F–öäF–v—G3£'Ò’¢~(	BwÓÂ÷7ããÆ'#ãÇ7â7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òG·6öÆW2ò6öÆW2çFôÆö6ÆU7G&–ær‡VæFVf–æVBÇ¶Ö†–×VÔg&7F–öäF–v—G3£'Ò’¢~(	BwÓÂ÷7ãæ°¢Ğ¢–b†VÃ#B’°¢–b†6†ævRÒçVÆÂ’°¢VÃ#BçFW‡D6öçFVçBÒG¶6†ævRãÒòr²r¢rwÒG¶6†ævRçFôf—†VBƒ—ÒV°¢VÃ#Bç7G–ÆRæ6öÆ÷"Ò6†ævRãÒòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’s°¢ÒVÇ6R°¢VÃ#BçFW‡D6öçFVçBÒrs°¢Ğ¢Ğ¢Ğ§Ğ ¦7–æ2gVæ7F–öâöä7&—Fõ&V6–õ6V&6‚‚’°¢6öç7BVW'’ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å&V6–õ6V&6‚r“òçfÇVSòçG&–Ò‚“°¢6öç7B&W7VÇDVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å&V6–õ&W7VÇBr“°¢–b‚&W7VÇDVÂ’&WGW&ã°¢–b‚VW'’ÇÂVW'’æÆVæwF‚Â"’²&W7VÇDVÂç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B&W7VÇG2Òv—Bö6u6V&6‚‡VW'’“°¢–b‚&W7VÇG2æÆVæwF‚’°¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇDVÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å6–â&W7VÇFF÷2â–çFVçF6öâ÷G&òL:—&Ö–æòãÂöF—câs°¢&WGW&ã°¢Ğ¢6öç7B–G2Ò&W7VÇG2ç6Æ–6RƒÂR’æÖ‡"Óâ"æ–B’æ¦ö–â‚rÂr“°¢6öç7B&–6W2Òv—Bö6u&–6R†–G2“°¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇDVÂæ–ææW$…DÔÂÒ&W7VÇG2ç6Æ–6RƒÂR’æÖ‡"Óâ°¢6öç7BÒ&–6W3òå·"æ–EÓòçW6C°¢&WGW&âÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£W‚‡ƒ¶&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"ÂãB“¶&÷&FW"×&F—W3£gƒ¶Ö&v–âÖ&÷GFöÓ£7ƒ¶föçB×6—¦S£G‚#à¢Ç7ããÆ–Ör7&3Ò"G·"çF‡VÖ"ÇÂrwÒ"7G–ÆSÒ'v–GFƒ£Gƒ¶†V–v‡C£Gƒ·fW'F–6ÂÖÆ–vã¦Ö–FFÆS¶Ö&v–â×&–v‡C£G‚"öæW'&÷#Ò'F†—2ç7G–ÆRæF—7Æ“ÒvæöæRr#âG·"ææÖWÒ‚G·"ç7–Ö&öÇÒ“Â÷7ãà¢Ç7â7G–ÆSÒ&föçB×vV–v‡C£S#âG·òrBr²çFôÆö6ÆU7G&–ær‚’¢~(	BwÓÂ÷7ãà¢ÂöF—cæ°¢Ò’æ¦ö–â‚rr“°§Ğ ¦7–æ2gVæ7F–öâöä7&—Fõ&V6–õ6VÆV7B‚’°¢6öç7B6VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å&V6–õ6VÆV7Br“°¢6öç7B&W7VÇDVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å&V6–õ&W7VÇBr“°¢–b‚6VÂÇÂ&W7VÇDVÂ’&WGW&ã°¢6öç7B6ö–ä–BÒ6VÂçfÇVS°¢–b‚6ö–ä–B’²&W7VÇDVÂç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B&–6W2Òv—Bö6u&–6R†6ö–ä–B“°¢6öç7BÒ&–6W3òå¶6ö–ä–EÓòçW6C°¢6öç7BF2Òv—BövWED2‚“°¢6öç7BF5fVçFÒçVÖ&W"‡F2çfVçF’ÇÂ°¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–b‡’°¢6öç7B6öÆW2ÒF5fVçFò¢F5fVçF¢çVÆÃ°¢&W7VÇDVÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ'FF–æs£ƒ¶&6¶w&÷VæC§&v&ƒsbÃsRÃƒÂãb“¶&÷&FW"×&F—W3£‡ƒ¶föçB×6—¦S£G‚#à¢ÆF—b7G–ÆSÒ&föçB×vV–v‡C£S¶6öÆ÷#§f"‚Ò×FW‡B“¶Ö&v–âÖ&÷GFöÓ£G‚#âG¶6ö–ä–Bæ6†$Bƒ’çFõWW$66R‚’²6ö–ä–Bç6Æ–6Rƒ—ÓÂöF—cà¢ÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£g‚#à¢Ç7ãåU4C¢Ç7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#âBG·çFôÆö6ÆU7G&–ær‡VæFVf–æVBÇ¶Ö†–×VÔg&7F–öäF–v—G3£'Ò—ÓÂ÷7G&öæsãÂ÷7ãà¢Ç7ãå6öÆW3¢Ç7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖvöÆB’#âG·6öÆW2ÓÓÒçVÆÂòuD2æòF—7öæ–&ÆRr¢u2òr²6öÆW2çFôÆö6ÆU7G&–ær‡VæFVf–æVBÇ¶Ö†–×VÔg&7F–öäF–v—G3£'Ò—ÓÂ÷7G&öæsãÂ÷7ãà¢Ç7ãåD3¢G·F5fVçFòu2òr²F5fVçFçFôf—†VBƒ2’¢væòF—7öæ–&ÆRwÓÂ÷7ãà¢ÂöF—cà¢ÂöF—cæ°¢ÒVÇ6R°¢&W7VÇDVÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äæò6RVFòö'FVæW"VÂ&V6–òãÂöF—câs°¢Ğ§Ğ ¦7–æ2gVæ7F–öâÆöD7&—Fô†—7E&–6R‚’°¢6öç7B6ö–ä–BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä†—7D6ö–âr“òçfÇVSòçG&–Ò‚’çFôÆ÷vW$66R‚’ÇÂv&—F6ö–âs°¢6öç7BFFU7G"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä†—7DFFRr“òçfÇVSòçG&–Ò‚“°¢6öç7B&W7VÇDVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä†—7E&W7VÇBr“°¢–b‚&W7VÇDVÂÇÂFFU7G"’²GFö7B‚t–æw&W6VæfV6†Vâf÷&ÖFòDBÔÔÒÕ•••’ârÂwv&âr“²&WGW&ã²Ğ¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W7VÇDVÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ä6öç7VÇFæFò&V6–ò†—7L;7&–6òââãÂöF—câs°¢6öç7B&–6RÒv—Bö6t†—7F÷&–6Å&–6R†6ö–ä–BÂFFU7G"“°¢–b‡&–6R’°¢&W7VÇDVÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ'FF–æs£ƒ¶&6¶w&÷VæC§&v&ƒS‚Ã3BÃ#SRÂãb“¶&÷&FW"×&F—W3£‡ƒ¶föçB×6—¦S£G‚#à¢Ç7G&öæsâG¶6ö–ä–Bæ6†$Bƒ’çFõWW$66R‚’²6ö–ä–Bç6Æ–6Rƒ—ÓÂ÷7G&öæsâ(	B&V6–òÂG¶FFU7G'Ó¢Ç7G&öær7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#âBG·&–6RçFôÆö6ÆU7G&–ær‡VæFVf–æVBÇ¶Ö†–×VÔg&7F–öäF–v—G3£'Ò—ÓÂ÷7G&öæsà¢ÂöF—cæ°¢ÒVÇ6R°¢&W7VÇDVÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚Ò×&VB’#äæò6RVæ6öçG,;2&V6–ò&W6fV6†âfW&–f–6VÂ”BFRÆ7&—Fò’VÂf÷&ÖFòDBÔÔÒÕ•••’ãÂöF—câs°¢Ğ§Ğ ¦7–æ2gVæ7F–öâöä7&—Fô6öçb‚’°¢6öç7B6çBÒ'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä6öçd6çBr“òçfÇVR’ÇÂ°¢6öç7B6ö–ä–BÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä6öçd6ö–âr“òçfÇVRÇÂv&—F6ö–âs°¢6öç7BF2Ò'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä6öçeD2r“òçfÇVR’ÇÂ°¢6öç7B&W7VÇDVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v6Ä6öçe&W7VÇBr“°¢–b‚&W7VÇDVÂ’&WGW&ã°¢–b‚6çBÇÂ6çBÃÒÇÂF2’²&W7VÇDVÂç7G–ÆRæF—7Æ’ÒvæöæRs²&WGW&ã²Ğ¢6öç7B&–6W2Òv—Bö6u&–6R†6ö–ä–B“°¢6öç7BW6E&–6RÒ&–6W3òå¶6ö–ä–EÓòçW6C°¢&W7VÇDVÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢–b‡W6E&–6R’°¢6öç7BW6EfÇVRÒ6çB¢W6E&–6S°¢6öç7B6öÆW5fÇVRÒW6EfÇVR¢F3°¢&W7VÇDVÂæ–ææW$…DÔÂÒÆF—b7G–ÆSÒ'FF–æs£ƒ¶&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"Âãb“¶&÷&FW"×&F—W3£‡ƒ¶föçB×6—¦S£G‚#à¢ÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"g"g#¶v£ƒ·FW‡BÖÆ–vã¦6VçFW"#à¢ÆF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£3¶6öÆ÷#§f"‚ÒÖvöÆB’#âG¶6çGÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âG¶6ö–ä–Bæ6†$Bƒ’çFõWW$66R‚’²6ö–ä–Bç6Æ–6Rƒ—ÓÂöF—cãÂöF—cà¢ÆF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£3¶6öÆ÷#§f"‚ÒÖw&VVâ’#âBG·W6EfÇVRçFôÆö6ÆU7G&–ær‡VæFVf–æVBÇ¶Ö†–×VÔg&7F–öäF–v—G3£'Ò—ÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#åU4CÂöF—cãÂöF—cà¢ÆF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶föçB×vV–v‡C£3¶6öÆ÷#§f"‚ÒÖvöÆB’#å2òG·6öÆW5fÇVRçFôÆö6ÆU7G&–ær‡VæFVf–æVBÇ¶Ö†–×VÔg&7F–öäF–v—G3£'Ò—ÓÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#å6öÆW2…D2G·F2çFôf—†VBƒ2—Ò“ÂöF—cãÂöF—cà¢ÂöF—cà¢ÂöF—cæ°¢ÒVÇ6R°¢&W7VÇDVÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äæò6RVFòö'FVæW"VÂ&V6–òâ–çFVçFFRçVWfòãÂöF—câs°¢Ğ§Ğ ¢òò)H)H÷'FföÆ–ò7&—FògVæ7F–öç2)H)H ¦ÆWB÷÷'D76WG2ÒµÓ°¦ÆWB÷÷'E7F¶–ærÒµÓ°¦ÆWB÷÷'E&–6W2Ò·Ó°¦ÆWBö77e'6VE&÷w2ÒµÓ° ¦6öç7Bõõ%Eô5%•DõôÔÒ°¢&—F6ö–ã¢t&—F6ö–â„%D2’rÆWF†W&WVÓ¢tWF†W&WVÒ„UD‚’rÇFWF†W#¢uFWF†W"…U4EB’rÇ6öÆæ¢u6öÆæ…4ôÂ’rÀ¢&–ææ6V6ö–ã¢t$ä"rÇ&—ÆS¢u…%rÆ6&Fæó¢t6&Fæò„D’rÆFövV6ö–ã¢tFövV6ö–â„DôtR’rÀ¢öÆ¶F÷C¢uöÆ¶F÷B„DõB’rÆÖF–6æWGv÷&³¢uöÇ–vöâ„ÔD”2’rÆ6†–æÆ–æ³¢t6†–æÆ–æ²„Ä”ä²’rÀ¢fÆæ6†S#¢tfÆæ6†R„d‚’rÆÆ—FV6ö–ã¢tÆ—FV6ö–â„ÅD2’rÆ&—F6ö–æ66ƒ¢t&—F6ö–â66‚„$4‚’rÀ¢7FVÆÆ#¢u7FVÆÆ"…„ÄÒ’rÆ6÷6Ö÷3¢t6÷6Ö÷2„DôÒ’rÇG&öã¢uE$ôâ…E%‚’rÇW6F6ö–ã¢uU4D2rÀ¢F“¢tF’„D’’rÆæV#¢täT"&÷Fö6öÂrÇWS¢uWR…UR’p§Ó° ¦gVæ7F–öâ÷÷'D6ö–ä–B†æÖR’°¢6öç7BSÔö&¦V7BæVçG&–W2…õõ%Eô5%•DõôÔ“°¢f÷"†ÆWE¶²ÇeÖöbR—¶–b‡cÓÓÖæÖWÇÆ³ÓÓÖæÖR—&WGW&â·Ğ¢&WGW&âæÖRçFôÆ÷vW$66R‚’ç&WÆ6R‚õÇ2²örÂrr’ç&WÆ6R‚õµæ×£Ó•ÒörÂrr“°§Ğ ¦gVæ7F–öâ÷÷'DæÖR†6ö–ä–B’°¢6öç7B6ÆVãÖ6ö–ä–Bç&WÆ6R‚õµæ×£Ó•ÒörÂrr“°¢f÷"†6öç7E¶²ÇeÖöbö&¦V7BæVçG&–W2…õõ%Eô5%•DõôÔ’—°¢–b†³ÓÓÖ6ÆVçÇÆ²ç&WÆ6R‚õµæ×£Ó•ÒörÂrr“ÓÓÖ6ÆVâ—&WGW&â`¢Ğ¢6öç7B7V6–Ç3×¶'F3¢t&—F6ö–â„%D2’rÆWFƒ¢tWF†W&WVÒ„UD‚’rÇW6GC¢uFWF†W"…U4EB’rÇ6öÃ¢u6öÆæ…4ôÂ’rÀ¢F¢t6&Fæò„D’rÆFövS¢tFövV6ö–â„DôtR’rÆF÷C¢uöÆ¶F÷B„DõB’rÆÖF–3¢uöÇ–vöâ„ÔD”2’rÀ¢Æ–æ³¢t6†–æÆ–æ²„Ä”ä²’rÆfƒ¢tfÆæ6†R„d‚’rÆÇF3¢tÆ—FV6ö–â„ÅD2’rÆ&6ƒ¢t&—F6ö–â66‚„$4‚’rÀ¢†ÆÓ¢u7FVÆÆ"…„ÄÒ’rÆFöÓ¢t6÷6Ö÷2„DôÒ’rÇG'ƒ¢uE$ôâ…E%‚’rÆæV#¢täT"&÷Fö6öÂrÀ¢WS¢uWR…UR’rÆ&æ#¢t$ä"rÇ‡'¢u…%rÆF“¢tF’„D’’rÇW6F3¢uU4D2wÓ°¢&WGW&â7V6–Ç5¶6ö–ä–BçFôÆ÷vW$66R‚•×ÇÆ6ö–ä–Bæ6†$Bƒ’çFõWW$66R‚’¶6ö–ä–Bç6Æ–6Rƒ“°§Ğ ¦gVæ7F–öâÆöE÷'FföÆ–ò‚’°¢G'—µ÷÷'D76WG3Ô¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚wG÷÷'FföÆ–òr—ÇÂuµÒr—Ö6F6‡µ÷÷'D76WG3Õµ×Ğ¢G'—µ÷÷'E7F¶–æsÔ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚wG÷7F¶–ærr—ÇÂuµÒr—Ö6F6‡µ÷÷'E7F¶–æsÕµ×Ğ¢÷÷'E&–6W3×·Ó°¢6WEF–ÖV÷WB‚‚“Óå÷÷'DfWF6…&–6W2‚’Ã“°§Ğ ¦gVæ7F–öâ6fU÷'FföÆ–ò‚’°¢·eWB‚wG÷÷'FföÆ–òrÂ÷÷'D76WG2Âw÷'FföÆ–òr“°¢·eWB‚wG÷7F¶–ærrÂ÷÷'E7F¶–ærÂw7F¶–ærr“°§Ğ§&Vv—7FW$µe66÷R‚w÷'FföÆ–òrÂ‚’ÓâwG÷÷'FföÆ–òr“°§&Vv—7FW$µe66÷R‚w7F¶–ærrÂ‚’ÓâwG÷7F¶–ærr“° ¦7–æ2gVæ7F–öâ÷÷'DfWF6…&–6W2‚’°¢6öç7B–G3Õ²ââææWr6WB…÷÷'D76WG2æf–ÇFW"†Óææ6ö–ä–B’æÖ†Óææ6ö–ä–B’•Ó°¢–b‚–G2æÆVæwF‚—&WGW&ã°¢G'’°¢6öç7B&–6W3Öv—Bö6u&–6R†–G2“°¢–b‡&–6W2bgG—Vöb&–6W3ÓÓÒvö&¦V7Br—°¢f÷"†6öç7E¶–BÆFFÖöbö&¦V7BæVçG&–W2‡&–6W2’—°¢÷÷'E&–6W5¶–EÓ×·W6C¦FFçW6GÇÃÆÆ7EWFFVC¤FFRææ÷r‚—Ó°¢Ğ¢Ğ¢Ö6F6‚†R—¶6öç6öÆRçv&â‚tW'&÷"fWF6†–ær&–6W3¢rÆRæÖW76vR—Ğ¢&VæFW%÷'FföÆ–ò‚“°§Ğ ¦gVæ7F–öâ6Æ5÷'FföÆ–ò‚’°¢ÆWBF÷FÅU4CÓÇF÷FÄ–çfW7FVEU4CÓÆ6÷VçCÓ°¢6öç7BÆÆö3×·Ó°¢6öç7BF3Ó2ãsS°¢f÷"†6öç7Böb÷÷'D76WG2—°¢6öç7BG“×'6TfÆöB†æ6çF–FB—ÇÃ°¢6öç7B'W•&–6S×'6TfÆöB†ç&V6–ô6ö×&U4B—ÇÃ°¢6öç7B7W'%&–6SÕ÷÷'E&–6W5¶æ6ö–ä–EÓòçW6GÇÆ'W•&–6WÇÃ°¢6öç7BfÅU4C×G’¦7W'%&–6S°¢6öç7B–çeU4C×G’¦'W•&–6S°¢F÷FÅU4B³×fÅU4C°¢F÷FÄ–çfW7FVEU4B³Ö–çeU4C°¢–b‡G“ãbf7W'%&–6Sã—¶ÆÆö5¶æ6ö–ä–GÇÆæ7F—fõÓÒ†ÆÆö5¶æ6ö–ä–GÇÆæ7F—fõ×ÇÃ’·fÅU4GĞ¢6÷VçB²³°¢Ğ¢6öç7BæÅU4C×F÷FÅU4B×F÷FÄ–çfW7FVEU4C°¢6öç7BæÅ7C×F÷FÄ–çfW7FVEU4Cãò‚‡æÅU4B÷F÷FÄ–çfW7FVEU4B’£“£°¢&WGW&ç·F÷FÅU4BÇF÷FÄ–çfW7FVEU4BÇæÅU4BÇæÅ7BÆ6÷VçBÆÆÆö2ÇF7Ó°§Ğ ¦gVæ7F–öâ&VæFW%÷'FföÆ–ò‚’°¢6öç7B6Æ3Ö6Æ5÷'FföÆ–ò‚“°¢6öç7BF3Ö6Æ2çF3°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7fÅU4Br’çFW‡D6öçFVçCÒrBr¶6Æ2çF÷FÅU4BçFôf—†VBƒ"“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7fÅTâr’çFW‡D6öçFVçCÒu2òr²†6Æ2çF÷FÅU4B§F2’çFôf—†VBƒ"“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7–çfW7FVBr’çFW‡D6öçFVçCÒrBr¶6Æ2çF÷FÄ–çfW7FVEU4BçFôf—†VBƒ"“°¢6öç7BæÄVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7äÂr“°¢æÄVÂçFW‡D6öçFVçCÒrBr¶6Æ2çæÅU4BçFôf—†VBƒ"“°¢æÄVÂç7G–ÆRæ6öÆ÷#Ö6Æ2çæÅU4CãÓòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’s°¢6öç7BæÅ7DVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7äÅ7Br“°¢æÅ7DVÂçFW‡D6öçFVçCÒ†6Æ2çæÅ7CãÓòr²s¢rr’¶6Æ2çæÅ7BçFôf—†VBƒ"’²rRs°¢æÅ7DVÂç7G–ÆRæ6öÆ÷#Ö6Æ2çæÅ7CãÓòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’s°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v76÷VçBr’çFW‡D6öçFVçCÖ6Æ2æ6÷VçC° ¢6öç7BÆÆö4VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7ÆÆö6F–öâr“°¢6öç7BVçG&–W3Ôö&¦V7BæVçG&–W2†6Æ2æÆÆö2“°¢–b‚VçG&–W2æÆVæwF‚—°¢ÆÆö4VÂæ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#·FF–æs£ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#å6–â7F—f÷2&Ö÷7G&"6–væ6œ;6âãÂöF—câs°¢ÖVÇ6W°¢6öç7BF÷FÃÔö&¦V7BçfÇVW2†6Æ2æÆÆö2’ç&VGV6R‚‡2Çb“Óç2·bÃ“°¢6öç7B6öÆ÷'3Õ²r3”#S”#brÂr34ƒddbrÂr4S„#rÂr3D4cSrÂr4Sc3“CbrÂr433”4SrÂr3$4CBrÂr4dc“ƒrÂr3„$33DrÂr4cCC33brÂr3ctC„"rÂr4dd3rrÂr3”3#t#rÂr34”cBrÂr3s“SSC‚rÂr4S“Sc2rÂr3“cƒ‚rÂr44DD33’rÂr3t3DDdbrÂr4dcdCuÓ°¢6öç7B6÷'FVCÖVçG&–W2ç6÷'B‚†Æ"“Óæ%³ÒÖ³Ò“°¢ÆÆö4VÂæ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£‚#âr°¢6÷'FVBæÖ‚…¶–BÇfÅÒÆ’“Óç°¢6öç7B7C×F÷FÃãò‡fÂ÷F÷FÂ’££°¢6öç7BæÖSÕ÷÷'DæÖR†–B“°¢&WGW&âsÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#ƒ¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ·FF–æs£g‚ƒ¶&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã2“¶&÷&FW"×&F—W3£w‚#âr°¢sÆF—b7G–ÆSÒ'v–GFƒ£ƒ¶†V–v‡C£ƒ¶&÷&FW"×&F—W3£7ƒ¶&6¶w&÷VæC¢r¶6öÆ÷'5¶’V6öÆ÷'2æÆVæwF…Ò²s¶fÆW‚×6‡&–æ³£#ãÂöF—câr°¢sÆF—b7G–ÆSÒ&fÆWƒ£¶Ö–â×v–GFƒ£#ãÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ·v†—FR×76S¦æ÷w&¶÷fW&fÆ÷s¦†–FFVã·FW‡BÖ÷fW&fÆ÷s¦VÆÆ—6—2#âr¶æÖR²sÂöF—câr°¢sÆF—b7G–ÆSÒ&†V–v‡C£Gƒ¶&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂãr“¶&÷&FW"×&F—W3£'ƒ¶Ö&v–â×F÷£7ƒ¶÷fW&fÆ÷s¦†–FFVâ#âr°¢sÆF—b7G–ÆSÒ&†V–v‡C£S·v–GFƒ¢r·7BçFôf—†VBƒ’²rS¶&6¶w&÷VæC¢r¶6öÆ÷'5¶’V6öÆ÷'2æÆVæwF…Ò²s¶&÷&FW"×&F—W3£'‚#ãÂöF—cãÂöF—cãÂöF—câr°¢sÆF—b7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FW‡BÖÆ–vã§&–v‡B#ãÆF—câr·7BçFôf—†VBƒ’²rSÂöF—cãÆF—câBr·fÂçFôf—†VBƒ’²sÂöF—cãÂöF—cãÂöF—câs°¢Ò’æ¦ö–â‚rr’²sÂöF—câs°¢Ğ ¢6öç7BF&öG“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v776WG4&öG’r“°¢6öç7BV×G“ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v776WG4V×G’r“°¢–b‚÷÷'D76WG2æÆVæwF‚—°¢F&öG’æ–ææW$…DÔÃÒrs°¢V×G’ç7G–ÆRæF—7Æ“Òv&Æö6²s°¢&WGW&ã°¢Ğ¢V×G’ç7G–ÆRæF—7Æ“ÒvæöæRs°¢F&öG’æ–ææW$…DÔÃÕ÷÷'D76WG2æÖ‚†Æ’“Óç°¢6öç7BG“×'6TfÆöB†æ6çF–FB—ÇÃ°¢6öç7B'W•&–6S×'6TfÆöB†ç&V6–ô6ö×&U4B—ÇÃ°¢6öç7B7W'%&–6SÕ÷÷'E&–6W5¶æ6ö–ä–EÓòçW6GÇÆ'W•&–6WÇÃ°¢6öç7B7W'%&–6UTãÖ7W'%&–6R§F3°¢6öç7BfÅTã×G’¦7W'%&–6UTã°¢6öç7B–çeTã×G’¦'W•&–6R§F3°¢6öç7BæÅTã×fÅTâÖ–çeTã°¢6öç7BæÅ7CÖ–çeTããò‚‡æÅTâö–çeTâ’£“£°¢6öç7BæÖSÕ÷÷'DæÖR†æ6ö–ä–GÇÆæ7F—fò“°¢&WGW&âsÇG#âr°¢sÇFCãÇ7G&öæsâr¶æÖR²sÂ÷7G&öæsâr²†æW†6†ævSòsÆ'#ãÇ7â7G–ÆSÒ&föçB×6—¦S£—ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âr¶æW†6†ævR²sÂ÷7ãâs¢rr’²sÂ÷FCâr°¢sÇFCâr·G’çFôf—†VBƒb’²sÂ÷FCâr°¢sÇFCâBr¶'W•&–6RçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFCâBr¶7W'%&–6RçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFCå2òr¶7W'%&–6UTâçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFCå2òr·fÅTâçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFCå2òr¶–çeTâçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ&6öÆ÷#¢r²‡æÅTããÓòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²r#âr²‡æÅTããÓòr²s¢rr’²u2òr·æÅTâçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ&6öÆ÷#¢r²‡æÅ7CãÓòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²r#âr²‡æÅ7CãÓòr²s¢rr’·æÅ7BçFôf—†VBƒ"’²rSÂ÷FCâr°¢sÇFCãÆ'WGFöâöæ6Æ–6³Ò&VF—E÷'D76WB‚r¶’²r’"7G–ÆSÒ&&6¶w&÷VæC§G&ç7&VçC¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FF–æs£7‚wƒ¶föçB×6—¦S£Gƒ¶7W'6÷#§ö–çFW#¶föçBÖfÖ–Ç“¦–æ†W&—B#î)ÈşûˆóÂö'WGFöãâr°¢sÆ'WGFöâöæ6Æ–6³Ò'&VÖ÷fU÷'D76WB‚r¶’²r’"7G–ÆSÒ&&6¶w&÷VæC§G&ç7&VçC¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FF–æs£7‚wƒ¶föçB×6—¦S£Gƒ¶7W'6÷#§ö–çFW#¶föçBÖfÖ–Ç“¦–æ†W&—B#ï	ùyÂö'WGFöããÂ÷FCâr°¢sÂ÷G#âs°¢Ò’æ¦ö–â‚rr“°¢&VæFW$×VÇF•–V$F6†&ö&B‚“°¢÷÷'E÷VÆFT÷6÷7E6VÆV7G2‚“°§Ğ ¦gVæ7F–öâFE÷'D76WB‚’°¢6öç7B6ö–ä–CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v776WE6VÆV7Br’çfÇVS°¢ÆWB7F—fóÖ6ö–ä–C°¢–b†6ö–ä–CÓÓÒv÷G&òwÇÂ6ö–ä–B—°¢6öç7B÷F†W#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v776WD÷F†W"r’çfÇVRçG&–Ò‚“°¢–b‚÷F†W"—·GFö7B‚t–æw&W6VÂæöÖ'&RFVÂ7F—fòârÂwv&âr“·&WGW&çĞ¢7F—fóÖ÷F†W#°¢6ö–ä–CÕ÷÷'D6ö–ä–B†÷F†W"“°¢ÖVÇ6R–b‚6ö–ä–B—°¢GFö7B‚u6VÆV66–öæVâ7F—fòârÂwv&âr“·&WGW&ã°¢Ğ¢6öç7B6çF–FC×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v76çF–FBr’çfÇVR“°¢–b‚6çF–FGÇÆ6çF–FCÃÓ—·GFö7B‚t–æw&W6Væ6çF–FBl:Æ–FârÂwv&âr“·&WGW&çĞ¢6öç7B&V6–ô6ö×&×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7&V6–ô6ö×&r’çfÇVR“°¢–b‚&V6–ô6ö×&ÇÇ&V6–ô6ö×&ÃÓ—·GFö7B‚t–æw&W6Vâ&V6–òFR6ö×&l:Æ–FòârÂwv&âr“·&WGW&çĞ¢6öç7BfV6†6ö×&ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7fV6†6ö×&r’çfÇVWÇÆæWrFFR‚’çFô•4õ7G&–ær‚’ç6Æ–6RƒÃ“°¢6öç7BW†6†ævSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7W†6†ævRr’çfÇVRçG&–Ò‚“°¢6öç7Bæ÷F3ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7æ÷F2r’çfÇVRçG&–Ò‚“°¢6öç7B–GƒÕ÷÷'D76WG2æf–æD–æFW‚†Óææ6ö–ä–CÓÓÖ6ö–ä–BbdÖF‚æ'2†ç&V6–ô6ö×&U4B×&V6–ô6ö×&“Ãã“°¢–b†–GƒãÓ—°¢6öç7BW†—7F–æsÕ÷÷'D76WG5¶–G…Ó°¢6öç7BF÷FÅG“×'6TfÆöB†W†—7F–æræ6çF–FB’¶6çF–FC°¢6öç7BF÷FÄ6÷7C×'6TfÆöB†W†—7F–æræ6çF–FB’¦W†—7F–ærç&V6–ô6ö×&U4B¶6çF–FB§&V6–ô6ö×&°¢W†—7F–æræ6çF–FC×F÷FÅG“°¢W†—7F–ærç&V6–ô6ö×&U4C×F÷FÄ6÷7B÷F÷FÅG“°¢–b†fV6†6ö×&ÆW†—7F–æræfV6†6ö×&–W†—7F–æræfV6†6ö×&ÖfV6†6ö×&°¢–b†W†6†ævRbbW†—7F–æræW†6†ævR–W†—7F–æræW†6†ævSÖW†6†ævS°¢ÖVÇ6W°¢÷÷'D76WG2çW6‚‡¶–C¤FFRææ÷r‚’Æ6ö–ä–BÆ7F—fòÆ6çF–FBÇ&V6–ô6ö×&U4C§&V6–ô6ö×&ÆfV6†6ö×&ÆW†6†ævRÆæ÷F7Ò“°¢Ğ¢6fU÷'FföÆ–ò‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v76çF–FBr’çfÇVSÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7&V6–ô6ö×&r’çfÇVSÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7fV6†6ö×&r’çfÇVSÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7W†6†ævRr’çfÇVSÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7æ÷F2r’çfÇVSÒrs°¢GFö7B‚~)ÈRrµ÷÷'DæÖR†6ö–ä–B’²rw&VvFòÂ÷'FföÆ–òârÂvö²r“°¢÷÷'DfWF6…&–6W2‚“°§Ğ ¦gVæ7F–öâVF—E÷'D76WB†–G‚’°¢6öç7BÕ÷÷'D76WG5¶–G…Ó°¢–b‚—&WGW&ã°¢6öç7BæWuG“×&ö×B‚tçVWf6çF–FB&rµ÷÷'DæÖR†æ6ö–ä–GÇÆæ7F—fò’²s¢rÆæ6çF–FB“°¢–b†æWuG“ÓÓÖçVÆÂ—&WGW&ã°¢6öç7BG“×'6TfÆöB†æWuG’“°¢–b†—4æâ‡G’—ÇÇG“Ã—·GFö7B‚t6çF–FB–çl:Æ–FârÂwv&âr“·&WGW&çĞ¢6öç7BæWu&–6S×&ö×B‚tçVWfò&V6–òFR6ö×&U4C¢rÆç&V6–ô6ö×&U4B“°¢–b†æWu&–6SÓÓÖçVÆÂ—&WGW&ã°¢6öç7B&–6S×'6TfÆöB†æWu&–6R“°¢–b†—4æâ‡&–6R—ÇÇ&–6SÃ—·GFö7B‚u&V6–ò–çl:Æ–FòârÂwv&âr“·&WGW&çĞ¢æ6çF–FC×G“°¢ç&V6–ô6ö×&U4C×&–6S°¢6fU÷'FföÆ–ò‚“°¢÷÷'DfWF6…&–6W2‚“°¢GFö7B‚~)ÈR7F—fò7GVÆ—¦FòârÂvö²r“°§Ğ ¦gVæ7F–öâ&VÖ÷fU÷'D76WB†–G‚’°¢6öç7BÕ÷÷'D76WG5¶–G…Ó°¢–b‚—&WGW&ã°¢–b‚6öæf—&Ò‚|+ôVÆ–Ö–æ"rµ÷÷'DæÖR†æ6ö–ä–GÇÆæ7F—fò’²rFVÂ÷'FföÆ–óòr’—&WGW&ã°¢÷÷'D76WG2ç7Æ–6R†–G‚Ã“°¢6fU÷'FföÆ–ò‚“°¢÷÷'DfWF6…&–6W2‚“°¢GFö7B‚	ùy7F—fòVÆ–Ö–æFòârÂvö²r“°§Ğ ¦gVæ7F–öâ6ÆV%÷'FföÆ–ò‚’°¢–b‚÷÷'D76WG2æÆVæwF‚—·GFö7B‚tVÂ÷'FföÆ–ò–W7L:f<:ÖòârÂv–æfòr“·&WGW&çĞ¢–b‚6öæf—&Ò‚|+ôVÆ–Ö–æ"DôDõ2Æ÷27F—f÷2FVÂ÷'FföÆ–óòW7F66œ;6âæò6RVVFRFW6†6W"âr’—&WGW&ã°¢÷÷'D76WG3ÕµÓ°¢÷÷'E7F¶–æsÕµÓ°¢6fU÷'FföÆ–ò‚“°¢&VæFW%÷'FföÆ–ò‚“°¢GFö7B‚	ùy÷'FföÆ–òÆ–×–FòârÂvö²r“°§Ğ ¦gVæ7F–öâ÷÷'Df×E2†â—·&WGW&âu2òr¶âçFôf—†VBƒ"’ç&WÆ6R‚õÄ"ƒóÒ…ÆG³7Ò’²ƒòÆB’’örÂrÂr—Ğ¦gVæ7F–öâ÷÷'Df×EU4B†â—·&WGW&ârBr¶âçFôf—†VBƒ"’ç&WÆ6R‚õÄ"ƒóÒ…ÆG³7Ò’²ƒòÆB’’örÂrÂr—Ğ ¦gVæ7F–öâ–×÷'D55b‚’°¢6öç7Bf–ÆSÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v755df–ÆRr’æf–ÆW5³Ó°¢–b‚f–ÆR—·GFö7B‚u6VÆV66–öæVâ&6†—fò55bârÂwv&âr“·&WGW&çĞ¢6öç7Bf÷&ÖCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v755df÷&ÖBr’çfÇVS°¢6öç7B&VFW#ÖæWrf–ÆU&VFW"‚“°¢&VFW"æöæÆöCÖgVæ7F–öâ†R—°¢6öç7BFW‡CÖRçF&vWBç&W7VÇC°¢ÆWB&÷w3°¢–b†f÷&ÖCÓÓÒv&–ææ6RwÇÂ‚f÷&ÖGÇÆf÷&ÖCÓÓÒvWFòr’bgFW‡Bæ–æ6ÇVFW2‚tFFR…UD2’ÄÖ&¶WBr’—°¢&÷w3×'6T&–ææ6T55b‡FW‡B“°¢ÖVÇ6R–b†f÷&ÖCÓÓÒv6ö–æ&6RwÇÂ‚f÷&ÖGÇÆf÷&ÖCÓÓÒvWFòr’bgFW‡Bæ–æ6ÇVFW2‚uF–ÖW7F×ÅG&ç67F–öâG—Rr’—°¢&÷w3×'6T6ö–æ&6T55b‡FW‡B“°¢ÖVÇ6R–b†f÷&ÖCÓÓÒv·V6ö–âwÇÂ‚f÷&ÖGÇÆf÷&ÖCÓÓÒvWFòr’bgFW‡Bæ–æ6ÇVFW2‚tFFRÅF–ÖRÅG—RÅ6—¦RÅ&–6RÄ6÷7BÄfVRr’—°¢&÷w3×'6T·T6ö–ä55b‡FW‡B“°¢ÖVÇ6R–b†f÷&ÖCÓÓÒv·&¶VâwÇÂ‚f÷&ÖGÇÆf÷&ÖCÓÓÒvWFòr’bgFW‡Bæ–æ6ÇVFW2‚wG†–BÇ&Vf–BÇF–ÖRÇG—RÆ76WBÇG’Ç&–6RÆfVRr’—°¢&÷w3×'6T·&¶Vä55b‡FW‡B“°¢ÖVÇ6R–b†f÷&ÖCÓÓÒv'–&—BwÇÂ‚f÷&ÖGÇÆf÷&ÖCÓÓÒvWFòr’bgFW‡Bæ–æ6ÇVFW2‚uG&ç67F–öâ”BÅF–ÖRÅG—RÄ6ö–âÅ6—¦RÅ&–6RÄfVRr’—°¢&÷w3×'6T'–&—D55b‡FW‡B“°¢ÖVÇ6R–b†f÷&ÖCÓÓÒv7'—Fö6öÒwÇÂ‚f÷&ÖGÇÆf÷&ÖCÓÓÒvWFòr’bgFW‡Bæ–æ6ÇVFW2‚uF–ÖW7F×…UD2’ÅG&ç67F–öâFW67&—F–öâr’—°¢&÷w3×'6T7'—Fö6öÔ55b‡FW‡B“°¢ÖVÇ6W°¢&÷w3×'6TvVæW&–455b‡FW‡B“°¢Ğ¢–b‚&÷w7ÇÂ&÷w2æÆVæwF‚—·GFö7B‚tæò6RVF–W&öâ'6V"G&ç666–öæW2FVÂ55bâfW&–f–6VÂf÷&ÖFòârÂwv&âr“·&WGW&çĞ¢ö77e'6VE&÷w3×&÷w3°¢6†÷t55e&Wf–Wr‡&÷w2“°¢Ó°¢&VFW"ç&VD5FW‡B†f–ÆR“°§Ğ ¦gVæ7F–öâ'6T&–ææ6T55b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃb–6öçF–çVS°¢6öç7BFFS×'G5³ÒçG&–Ò‚“°¢6öç7BÖ&¶WC×'G5³ÒçG&–Ò‚“°¢6öç7BG—S×'G5³%ÒçG&–Ò‚’çFõWW$66R‚“°¢6öç7B&–6S×'6TfÆöB‡'G5³5Ò—ÇÃ°¢6öç7BÖ÷VçC×'6TfÆöB‡'G5³EÒ—ÇÃ°¢6öç7BF÷FÃ×'6TfÆöB‡'G5³UÒ—ÇÃ°¢6öç7BfVS×'6TfÆöB‡'G5³eÒ—ÇÃ°¢6öç7B¶&6RÇV÷FUÓÖÖ&¶WBç7Æ—B‚õµÂõÂÕÒò“°¢–b‚&6WÇÂV÷FR–6öçF–çVS°¢&W7VÇG2çW6‚‡°¢fV6†¦FFRç7Æ—B‚rr•³ÒÆ7F—fó¦&6RÇF—ó§G—SÓÓÒt%U’sòv6ö×&s¢wfVçFrÀ¢6çF–FC¦Ö÷VçBÇ&V6–õU4C§&–6RÇF÷FÅU4C§F÷FÂÆ6öÖ—6–öåU4C¦fVRÀ¢W†6†ævS¢t&–ææ6RrÇV÷FRÇ&s¦Æ–æW5¶•Ğ¢Ò“°¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ'6T6ö–æ&6T55b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃb–6öçF–çVS°¢6öç7BF–ÖW7F××'G5³ÒçG&–Ò‚“°¢6öç7BG…G—S×'G5³ÒçG&–Ò‚“°¢6öç7B76WC×'G5³%ÒçG&–Ò‚“°¢6öç7BG•G&ç67FVC×'6TfÆöB‡'G5³5Ò—ÇÃ°¢6öç7B7÷E&–6S×'6TfÆöB‡'G5³EÒ—ÇÃ°¢6öç7BW6E7÷C×'6TfÆöB‡'G5³UÒ—ÇÃ°¢6öç7BF÷FÃÔÖF‚æ'2‡G•G&ç67FVB’§7÷E&–6S°¢6öç7B—4'W“×G…G—RçFôÆ÷vW$66R‚’æ–æ6ÇVFW2‚v'W’r—ÇÇG•G&ç67FVCã°¢–b‡G…G—RçFôÆ÷vW$66R‚’æ–æ6ÇVFW2‚w6VæBr—ÇÇG…G—RçFôÆ÷vW$66R‚’æ–æ6ÇVFW2‚w&V6V—fRr’–6öçF–çVS°¢&W7VÇG2çW6‚‡°¢fV6†§F–ÖW7F×ç7Æ—B‚uBr•³ÒÆ7F—fó¦76WBÇF—ó¦—4'W“òv6ö×&s¢wfVçFrÀ¢6çF–FC¤ÖF‚æ'2‡G•G&ç67FVB’Ç&V6–õU4C§7÷E&–6RÀ¢F÷FÅU4C§F÷FÂÆ6öÖ—6–öåU4C£ÆW†6†ævS¢t6ö–æ&6RrÇ&s¦Æ–æW5¶•Ğ¢Ò“°¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ'6TvVæW&–455b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B†VFW#ÖÆ–æW5³ÒçFôÆ÷vW$66R‚“°¢6öç7B6öÇ3×·Ó°¢6öç7B…'G3ÖÆ–æW5³Òç7Æ—B‚rÂr“°¢6öç7Bf–VÆDÖ×¶fV6†¥²vfV6†rÂvFFRrÂvfV6‚rÂwF–ÖW7F×rÂwF–V×òuÒÆ7F—fó¥²v7F—fòrÂv76WBrÂv7&—FòrÂvÖöæVFrÂv6ö–ârÂw7–Ö&öÂrÂvÖ&¶WBrÂv7'—FòrÂvæöÖ'&RuÒÀ¢F—ó¥²wF—òrÂwG—RrÂwG&ç67F–öârÂwG‚rÂw6–FRrÂv÷W&F–öâuÒÆ6çF–FC¥²v6çF–FBrÂvÖ÷VçBrÂwVçF—G’rÂwG’rÂwföÇVÖVârÂwföÇVÖRuÒÀ¢&V6–ó¥²w&V6–òrÂw&–6RrÂw&V6–õ÷Væ—F&–òrÂwVæ—E÷&–6RrÂw7÷BrÂw&FRuÒÀ¢6öÖ—6–öã¥²v6öÖ—6–öârÂvfVRrÂv6öÖÖ—76–öârÂv6öÖ—6œ;6ârÂvfVUöÖ÷VçBrÂvv7F÷2uÒÀ¢F÷FÃ¥²wF÷FÂrÂwF÷FÅ÷W6BrÂvÖöçFòrÂv–×÷'FRrÂwfÆ÷"rÂvÖ÷VçE÷W6BrÂwW6E÷F÷FÂu×Ó°¢f÷"†ÆWB3Ó¶3Æ…'G2æÆVæwFƒ¶2²²—°¢6öç7BƒÖ…'G5¶5ÒçG&–Ò‚’çFôÆ÷vW$66R‚’ç&WÆ6R‚õµæ×£Ó•õÒörÂrr“°¢f÷"†6öç7E¶¶W’ÆÆ–6W5Ööbö&¦V7BæVçG&–W2†f–VÆDÖ’—°¢–b†Æ–6W2ç6öÖR†Óæ‚æ–æ6ÇVFW2†’’—¶6öÇ5¶¶W•ÓÖ3¶'&V·Ğ¢Ğ¢Ğ¢–b†6öÇ2æfV6†ÓÓ×VæFVf–æVGÇÆ6öÇ2æ7F—fóÓÓ×VæFVf–æVGÇÆ6öÇ2æ6çF–FCÓÓ×VæFVf–æVB—·&WGW&â'6U6–×ÆT55b‡FW‡B—Ğ¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃ"–6öçF–çVS°¢6öç7BfV6†Ò‡'G5¶6öÇ2æfV6†×ÇÂrr’çG&–Ò‚’ç7Æ—B‚rr•³Ó°¢6öç7B7F—fóÒ‡'G5¶6öÇ2æ7F—fõ×ÇÂrr’çG&–Ò‚“°¢6öç7BF—õ&sÒ‡'G5¶6öÇ2çF—õ×ÇÂrr’çG&–Ò‚’çFôÆ÷vW$66R‚“°¢6öç7BF—ó×F—õ&ræ–æ6ÇVFW2‚wfVçBr—ÇÇF—õ&ræ–æ6ÇVFW2‚w6VÆÂr“òwfVçFs¢v6ö×&s°¢6öç7B6çF–FCÔÖF‚æ'2‡'6TfÆöB‡'G5¶6öÇ2æ6çF–FEÒ—ÇÃ“°¢6öç7B&V6–ó×'6TfÆöB‡'G5¶6öÇ2ç&V6–õÒ—ÇÃ°¢6öç7B6öÖ—6–öãÖ6öÇ2æ6öÖ—6–öâÓ×VæFVf–æVCò‡'6TfÆöB‡'G5¶6öÇ2æ6öÖ—6–öåÒ—ÇÃ“£°¢6öç7BF÷FÃÖ6öÇ2çF÷FÂÓ×VæFVf–æVCò‡'6TfÆöB‡'G5¶6öÇ2çF÷FÅÒ—ÇÃ“¦6çF–FB§&V6–ó°¢–b‚6çF–FGÇÂ7F—fò–6öçF–çVS°¢&W7VÇG2çW6‚‡¶fV6†Æ7F—fòÇF—òÆ6çF–FBÇ&V6–õU4C§&V6–òÇF÷FÅU4C§F÷FÂÆ6öÖ—6–öåU4C¦6öÖ—6–öâÆW†6†ævS¢t–×÷'FFòrÇ&s¦Æ–æW5¶•×Ò“°¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ'6U6–×ÆT55b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr’æf–ÇFW"†ÃÓæÂçG&–Ò‚’“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃ2–6öçF–çVS°¢6öç7BfV6†×'G5³ÒçG&–Ò‚’ç7Æ—B‚rr•³Ó°¢6öç7B7F—fó×'G5³ÒçG&–Ò‚“°¢6öç7BF—ó×'G2æÆVæwFƒã#÷'G5³%ÒçG&–Ò‚’çFôÆ÷vW$66R‚“¢v6ö×&s°¢6öç7B6çF–FCÔÖF‚æ'2‡'6TfÆöB‡'G5³5Ò—ÇÃ“°¢6öç7B&V6–ó×'6TfÆöB‡'G5³EÒ—ÇÃ°¢6öç7B6öÖ—6–öã×'G2æÆVæwFƒãSò‡'6TfÆöB‡'G5³UÒ—ÇÃ“£°¢–b‚6çF–FGÇÂ7F—fò–6öçF–çVS°¢&W7VÇG2çW6‚‡¶fV6†Æ7F—fòÇF—ó§F—òæ–æ6ÇVFW2‚wfVçBr“òwfVçFs¢v6ö×&rÆ6çF–FBÇ&V6–õU4C§&V6–òÇF÷FÅU4C¦6çF–FB§&V6–òÆ6öÖ—6–öåU4C¦6öÖ—6–öâÆW†6†ævS¢t–×÷'FFòrÇ&s¦Æ–æW5¶•×Ò“°¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ'6T·T6ö–ä55b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B…'G3ÖÆ–æW5³Òç7Æ—B‚rÂr“°¢6öç7B6ö–ä–GƒÖ…'G2æf–æD–æFW‚†ƒÓâö6ö–çÇ7–Ö&öÇÇ—'ÆÖ&¶WBö’çFW7B†‚çG&–Ò‚’’“°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃr–6öçF–çVS°¢6öç7BFFS×'G5³ÒçG&–Ò‚“°¢6öç7BG—S×'G5³%ÒçG&–Ò‚’çFõWW$66R‚“°¢6öç7B6—¦S×'6TfÆöB‡'G5³5Ò—ÇÃ°¢6öç7B&–6S×'6TfÆöB‡'G5³EÒ—ÇÃ°¢6öç7B6÷7C×'6TfÆöB‡'G5³UÒ—ÇÃ°¢6öç7BfVS×'6TfÆöB‡'G5³eÒ—ÇÃ°¢ÆWB7F—fóÒrs°¢–b†6ö–ä–GƒãÓbg'G5¶6ö–ä–G…Ò—°¢7F—fó×'G5¶6ö–ä–G…ÒçG&–Ò‚’ç&WÆ6R‚õÂòâ¢BòÂrr’ç&WÆ6R‚òÒâ¢BòÂrr“°¢ÖVÇ6R–b‡'G2æÆVæwFƒãrbg'G5³uÒ—°¢7F—fó×'G5³uÒçG&–Ò‚’ç&WÆ6R‚õÂòâ¢BòÂrr’ç&WÆ6R‚òÒâ¢BòÂrr“°¢Ğ¢–b‚6—¦WÇÂ&–6R–6öçF–çVS°¢&W7VÇG2çW6‚‡¶fV6†¦FFRç7Æ—B‚rr•³ÒÆ7F—fòÇF—ó§G—SÓÓÒt%U’sòv6ö×&s¢wfVçFrÆ6çF–FC§6—¦RÇ&V6–õU4C§&–6RÇF÷FÅU4C¦6÷7BÆ6öÖ—6–öåU4C¦fVRÆW†6†ævS¢t·T6ö–ârÇ&s¦Æ–æW5¶•×Ò“°¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ'6T·&¶Vä55b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃ‚–6öçF–çVS°¢6öç7BF–ÖS×'G5³%ÒçG&–Ò‚“°¢6öç7BG—S×'G5³5ÒçG&–Ò‚’çFõWW$66R‚“°¢ÆWB76WC×'G5³EÒçG&–Ò‚“°¢6öç7BG“×'6TfÆöB‡'G5³UÒ—ÇÃ°¢6öç7B&–6S×'6TfÆöB‡'G5³eÒ—ÇÃ°¢6öç7BfVS×'6TfÆöB‡'G5³uÒ—ÇÃ°¢–b†76WBç7F'G5v—F‚‚u‚r—ÇÆ76WBç7F'G5v—F‚‚u¢r’–76WCÖ76WBç6Æ–6Rƒ“°¢–b†76WCÓÓÒu„%Br–76WCÒt%D2s°¢–b†76WCÓÓÒu„UD‚r–76WCÒtUD‚s°¢6öç7BF÷FÃ×G’§&–6S°¢–b‚G—ÇÂ&–6R–6öçF–çVS°¢6öç7BG3×'6TfÆöB‡F–ÖR“°¢6öç7BfV6†Ò—4æâ‡G2’bgG3ãöæWrFFR‡G2£’çFô•4õ7G&–ær‚’ç7Æ—B‚uBr•³Ó§F–ÖRç7Æ—B‚rr•³Ó°¢&W7VÇG2çW6‚‡¶fV6†Æ7F—fó¦76WBÇF—ó§G—SÓÓÒt%U’sòv6ö×&s¢wfVçFrÆ6çF–FC§G’Ç&V6–õU4C§&–6RÇF÷FÅU4C§F÷FÂÆ6öÖ—6–öåU4C¦fVRÆW†6†ævS¢t·&¶VârÇ&s¦Æ–æW5¶•×Ò“°¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ'6T'–&—D55b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃr–6öçF–çVS°¢6öç7BF–ÖS×'G5³ÒçG&–Ò‚“°¢6öç7BG—S×'G5³%ÒçG&–Ò‚’çFõWW$66R‚“°¢6öç7B6ö–ã×'G5³5ÒçG&–Ò‚“°¢6öç7B6—¦S×'6TfÆöB‡'G5³EÒ—ÇÃ°¢6öç7B&–6S×'6TfÆöB‡'G5³UÒ—ÇÃ°¢6öç7BfVS×'6TfÆöB‡'G5³eÒ—ÇÃ°¢–b‚6—¦WÇÂ&–6R–6öçF–çVS°¢&W7VÇG2çW6‚‡¶fV6†§F–ÖRç7Æ—B‚rr•³ÒÆ7F—fó¦6ö–âÇF—ó§G—SÓÓÒt%U’sòv6ö×&s¢wfVçFrÆ6çF–FC§6—¦RÇ&V6–õU4C§&–6RÇF÷FÅU4C§6—¦R§&–6RÆ6öÖ—6–öåU4C¦fVRÆW†6†ævS¢t'–&—BrÇ&s¦Æ–æW5¶•×Ò“°¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ'6T7'—Fö6öÔ55b‡FW‡B’°¢6öç7BÆ–æW3×FW‡BçG&–Ò‚’ç7Æ—B‚uÆâr“°¢–b†Æ–æW2æÆVæwFƒÃ"—&WGW&åµÓ°¢6öç7B&W7VÇG3ÕµÓ°¢f÷"†ÆWB“Ó¶“ÆÆ–æW2æÆVæwFƒ¶’²²—°¢6öç7B'G3ÖÆ–æW5¶•Òç7Æ—B‚rÂr“°¢–b‡'G2æÆVæwFƒÃ–6öçF–çVS°¢6öç7BF–ÖW7F××'G5³ÒçG&–Ò‚“°¢6öç7B7W'&Væ7“×'G5³%ÒçG&–Ò‚“°¢6öç7BÖ÷VçC×'6TfÆöB‡'G5³5Ò—ÇÃ°¢6öç7BFô7W'&Væ7“×'G5³EÒçG&–Ò‚“°¢6öç7BFôÖ÷VçC×'6TfÆöB‡'G5³UÒ—ÇÃ°¢6öç7BæF—fUU4C×'6TfÆöB‡'G5³…Ò—ÇÃ°¢6öç7B¶–æC×'G5³•ÒçG&–Ò‚’çFôÆ÷vW$66R‚“°¢–b‚7W'&Væ7’–6öçF–çVS°¢6öç7B'4×CÔÖF‚æ'2†Ö÷VçB“°¢–b†¶–æCÓÓÒv7'—Fõ÷W&6†6Rr—°¢6öç7B&–6SÖ'4×CãöæF—fUU4Bö'4×C£°¢&W7VÇG2çW6‚‡¶fV6†§F–ÖW7F×ç7Æ—B‚rr•³ÒÆ7F—fó¦7W'&Væ7’ÇF—ó¢v6ö×&rÆ6çF–FC¦'4×BÇ&V6–õU4C§&–6RÇF÷FÅU4C¦æF—fUU4BÆ6öÖ—6–öåU4C£ÆW†6†ævS¢t7'—Fòæ6öÒrÇ&s¦Æ–æW5¶•×Ò“°¢ÖVÇ6R–b†¶–æCÓÓÒv7'—Fõ÷6VÆÂr—°¢6öç7B&–6SÖ'4×CãöæF—fUU4Bö'4×C£°¢&W7VÇG2çW6‚‡¶fV6†§F–ÖW7F×ç7Æ—B‚rr•³ÒÆ7F—fó¦7W'&Væ7’ÇF—ó¢wfVçFrÆ6çF–FC¦'4×BÇ&V6–õU4C§&–6RÇF÷FÅU4C¦æF—fUU4BÆ6öÖ—6–öåU4C£ÆW†6†ævS¢t7'—Fòæ6öÒrÇ&s¦Æ–æW5¶•×Ò“°¢ÖVÇ6R–b†¶–æCÓÓÒv7'—FõöW†6†ævRr—°¢–b†Ö÷VçCÃbf'4×Cã—°¢6öç7B&–6SÖ'4×CãöæF—fUU4Bö'4×C£°¢&W7VÇG2çW6‚‡¶fV6†§F–ÖW7F×ç7Æ—B‚rr•³ÒÆ7F—fó¦7W'&Væ7’ÇF—ó¢wfVçFrÆ6çF–FC¦'4×BÇ&V6–õU4C§&–6RÇF÷FÅU4C¦æF—fUU4BÆ6öÖ—6–öåU4C£ÆW†6†ævS¢t7'—Fòæ6öÒrÇ&s¦Æ–æW5¶•×Ò“°¢Ğ¢6öç7B'5FóÔÖF‚æ'2‡FôÖ÷VçB“°¢–b‡Fô7W'&Væ7’bf'5Fóã—°¢6öç7B&–6UFóÖ'5FóãöæF—fUU4Bö'5Fó£°¢&W7VÇG2çW6‚‡¶fV6†§F–ÖW7F×ç7Æ—B‚rr•³ÒÆ7F—fó§Fô7W'&Væ7’ÇF—ó¢v6ö×&rÆ6çF–FC¦'5FòÇ&V6–õU4C§&–6UFòÇF÷FÅU4C¦æF—fUU4BÆ6öÖ—6–öåU4C£ÆW†6†ævS¢t7'—Fòæ6öÒrÇ&s¦Æ–æW5¶•×Ò“°¢Ğ¢Ğ¢Ğ¢&WGW&â&W7VÇG3°§Ğ ¦gVæ7F–öâ6†÷t55e&Wf–Wr‡&÷w2’°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v755e&Wf–Wrr“°¢VÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v755d6÷VçBr’çFW‡D6öçFVçC×&÷w2æÆVæwFƒ°¢6öç7Bw&ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v755eF&ÆUw&r“°¢w&æ–ææW$…DÔÃÒsÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#ãÇF†VCãÇG#âr°¢sÇF‚7G–ÆSÒ'FF–æs£g‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã¦ÆVgC¶6öÆ÷#§f"‚ÒÖ×WFVB’#äfV6†Â÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£g‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã¦ÆVgC¶6öÆ÷#§f"‚ÒÖ×WFVB’#ä7F—fóÂ÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£g‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã¦ÆVgC¶6öÆ÷#§f"‚ÒÖ×WFVB’#åF—óÂ÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£g‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖ×WFVB’#ä6çF–FCÂ÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£g‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖ×WFVB’#å&V6–òU4CÂ÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£g‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖ×WFVB’#åF÷FÂU4CÂ÷Fƒâr°¢sÂ÷G#ãÂ÷F†VCãÇF&öG“âr°¢&÷w2ç6Æ–6RƒÃS’æÖ‡#ÓâsÇG#âr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB’#âr²‡"æfV6†ÇÂrr’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB’#âr²‡"æ7F—f÷ÇÂrr’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB“¶6öÆ÷#¢r²‡"çF—óÓÓÒv6ö×&sòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²r#âr²‡"çF—÷ÇÂrr’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB“·FW‡BÖÆ–vã§&–v‡B#âr²‡"æ6çF–FGÇÃ’çFôf—†VBƒb’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB“·FW‡BÖÆ–vã§&–v‡B#âBr²‡"ç&V6–õU4GÇÃ’çFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB“·FW‡BÖÆ–vã§&–v‡B#âBr²‡"çF÷FÅU4GÇÃ’çFôf—†VBƒ"’²sÂ÷FCâr°¢sÂ÷G#âr’æ¦ö–â‚rr’°¢‡&÷w2æÆVæwFƒãSòsÇG#ãÇFB6öÇ7ãÒ#b"7G–ÆSÒ'FF–æs£‡ƒ·FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#ââââ’r²‡&÷w2æÆVæwF‚ÓS’²rÜ:3Â÷FCãÂ÷G#âs¢rr’°¢sÂ÷F&öG“ãÂ÷F&ÆSâs°§Ğ ¦gVæ7F–öâ6öæf—&Ô55d–×÷'B‚’°¢–b‚ö77e'6VE&÷w7ÇÂö77e'6VE&÷w2æÆVæwF‚—·GFö7B‚tæò†’FF÷2&–×÷'F"ârÂwv&âr“·&WGW&çĞ¢ÆWBFFVCÓ°¢f÷"†6öç7B"öbö77e'6VE&÷w2—°¢–b‡"çF—óÓÓÒv6ö×&r—°¢6öç7B6ö–ä–CÕ÷÷'D6ö–ä–B‡"æ7F—fò“°¢6öç7B–GƒÕ÷÷'D76WG2æf–æD–æFW‚†Óææ6ö–ä–CÓÓÖ6ö–ä–B“°¢–b†–GƒãÓ—°¢6öç7BÕ÷÷'D76WG5¶–G…Ó°¢6öç7BöÆEG“×'6TfÆöB†æ6çF–FB“°¢6öç7BöÆD6÷7CÖöÆEG’¦ç&V6–ô6ö×&U4C°¢æ6çF–FCÖöÆEG’·"æ6çF–FC°¢ç&V6–ô6ö×&U4CÒ†öÆD6÷7B·"æ6çF–FB§"ç&V6–õU4B’öæ6çF–FC°¢ÖVÇ6W°¢÷÷'D76WG2çW6‚‡¶–C¤FFRææ÷r‚’´ÖF‚ç&æFöÒ‚’Æ6ö–ä–C¦6ö–ä–GÇÇ"æ7F—fòÆ7F—fó§"æ7F—fòÀ¢6çF–FC§"æ6çF–FBÇ&V6–ô6ö×&U4C§"ç&V6–õU4BÆfV6†6ö×&§"æfV6†ÇÆæWrFFR‚’çFô•4õ7G&–ær‚’ç6Æ–6RƒÃ’À¢W†6†ævS§"æW†6†ævWÇÂt–×÷'FFòrÆæ÷F3¢rwÒ“°¢Ğ¢FFVB²³°¢Ğ¢Ğ¢ö77e'6VE&÷w3ÕµÓ°¢6fU÷'FföÆ–ò‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v755e&Wf–Wrr’ç7G–ÆRæF—7Æ“ÒvæöæRs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v755df–ÆRr’çfÇVSÒrs°¢GFö7B‚~)ÈRr¶FFVB²rG&ç666œ;6â†W2’–×÷'FF‡2’ârÂvö²r“°¢÷÷'DfWF6…&–6W2‚“°§Ğ ¦gVæ7F–öâvVåF…&W÷'B‚’°¢6öç7B–V#×'6T–çB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…–V"r’çfÇVR—ÇÆæWrFFR‚’ævWDgVÆÅ–V"‚“°¢6öç7BÖWF†öCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F„ÖWF†öBr’çfÇVS°¢6öç7BGƒÕ÷÷'D76WG2æf–ÇFW"†Óç°¢6öç7BCÖæWrFFR†æfV6†6ö×&“°¢&WGW&â—4æâ†BævWEF–ÖR‚’’bfBævWDgVÆÅ–V"‚“ÓÓ×–V#°¢Ò“°¢–b‚G‚æÆVæwF‚—°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…&W7VÇBr’ç7G–ÆRæF—7Æ“Òv&Æö6²s°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…&W7VÇBr’æ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#·FF–æs£#ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#äæò†’G&ç666–öæW2Vâr·–V"²rãÂöF—câs°¢&WGW&ã°¢Ğ¢6öç7BF÷FÄ6ö×&3×G‚ç&VGV6R‚‡2Æ“Óç2·'6TfÆöB†æ6çF–FGÇÃ’¦ç&V6–ô6ö×&U4BÃ“°¢6öç7BF÷FÅfVçF3Ó°¢6öç7Bvææ6–''WFÒ×F÷FÄ6ö×&3°¢6öç7B—%ãÔÖF‚æÖ‚ƒÆvææ6–''WF£ãR“°¢6öç7B—%£ÔÖF‚æÖ‚ƒÆvææ6–''WF£ã#“R“°¢6öç7BVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…&W7VÇBr“°¢VÂç7G–ÆRæF—7Æ“Òv&Æö6²s°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…7VÖÖ'’r’æ–ææW$…DÔÃĞ¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#åF÷FÂ6ö×&2U4CÂöF—cãÆF—b6Æ73Ò'6&B×fÂvöÆB#ârµ÷÷'Df×EU4B‡F÷FÄ6ö×&2’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#åF÷FÂfVçF2U4CÂöF—cãÆF—b6Æ73Ò'6&B×fÂ#ârµ÷÷'Df×EU4B‡F÷FÅfVçF2’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ävææ6–õ:—&F–F''WFU4CÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#¢r²†vææ6–''WFãÓòwf"‚ÒÖw&VVâ’s¢wf"‚Ò×&VB’r’²r#âr²†vææ6–''WFãÓòr²s¢rr’µ÷÷'Df×EU4B†vææ6–''WF’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ä•"W7F–ÖFòƒRRâ“ÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#ârµ÷÷'Df×EU4B†—%â’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ä•"W7F–ÖFòƒ#’ãRR¢“ÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#ârµ÷÷'Df×EU4B†—%¢’²sÂöF—cãÂöF—câs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…F&ÆUw&r’æ–ææW$…DÔÃĞ¢sÇF&ÆR6Æ73Ò'&W2×F&ÆR"7G–ÆSÒ'v–GFƒ£S¶föçB×6—¦S£G‚#ãÇF†VCãÇG#âr°¢sÇFƒäfV6†Â÷FƒãÇFƒä7F—fóÂ÷FƒãÇFƒåF—óÂ÷FƒãÇFƒä6çF–FCÂ÷FƒãÇFƒå&V6–òU4CÂ÷FƒãÇFƒåF÷FÂU4CÂ÷FƒãÇFƒäÜ:—FöFóÂ÷FƒãÂ÷G#ãÂ÷F†VCãÇF&öG“âr°¢G‚æÖ†ÓâsÇG#âr°¢sÇFCâr²†æfV6†6ö×&ÇÂrr’²sÂ÷FCâr°¢sÇFCârµ÷÷'DæÖR†æ6ö–ä–GÇÆæ7F—fò’²sÂ÷FCâr°¢sÇFCä6ö×&Â÷FCâr°¢sÇFCâr²‡'6TfÆöB†æ6çF–FB—ÇÃ’çFôf—†VBƒb’²sÂ÷FCâr°¢sÇFCâBr²†ç&V6–ô6ö×&U4GÇÃ’çFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFCâBr²‚‡'6TfÆöB†æ6çF–FB—ÇÃ’¦ç&V6–ô6ö×&U4B’çFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFCâr¶ÖWF†öBçFõWW$66R‚’²sÂ÷FCâr°¢sÂ÷G#âr’æ¦ö–â‚rr’°¢sÂ÷F&öG“ãÂ÷F&ÆSâs°§Ğ ¦gVæ7F–öâ&VæFW%F…&W÷'B‡–V"ÆÖWF†öBÆFF’·Ğ ¦gVæ7F–öâF÷væÆöEF…&W÷'B‚’°¢6öç7B7VÖÖ'”VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…7VÖÖ'’r“°¢6öç7BF&ÆTVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…F&ÆUw&r“°¢–b‚7VÖÖ'”VÇÇÂF&ÆTVÂ—&WGW&ã°¢6öç7B–V#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…–V"r’çfÇVS°¢6öç7BÖWF†öCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F„ÖWF†öBr’çfÇVS°¢6öç7BÖWF†öDÆ&VÇ3×¶f–fó¢td”dòòU2rÆÆ–fó¢tÄ”dòòTU2rÆfs¢t6÷7Fò&öÖVF–òöæFW&FòwÓ°¢6öç7B6&G3×7VÖÖ'”VÂçVW'•6VÆV7F÷$ÆÂ‚rç6&Br“°¢6öç7B7VÖÖ'•&÷w3Ô'&’æg&öÒ†6&G2’æÖ†3Óç°¢6öç7BÆ&ÃÖ2çVW'•6VÆV7F÷"‚rç6&BÖÆ&Âr“òçFW‡D6öçFVçGÇÂrs°¢6öç7BfÃÖ2çVW'•6VÆV7F÷"‚rç6&B×fÂr“òçFW‡D6öçFVçGÇÂrs°¢&WGW&âsÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã·FF–æs£g‚¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6VVS¶föçB×6—¦S£G‚#ãÇ7â7G–ÆSÒ&6öÆ÷#¢3ccb#âr¶Æ&Â²sÂ÷7ããÇ7â7G–ÆSÒ&föçB×vV–v‡C£S#âr·fÂ²sÂ÷7ããÂöF—câs°¢Ò’æ¦ö–â‚rr“°¢6öç7BF&ÆT‡FÖÃ×F&ÆTVÂæ–ææW$…DÔÃ°¢6öç7Bv–ã×v–æF÷ræ÷Vâ‚rrÂuö&Ææ²r“°¢v–âæFö7VÖVçBçw&—FR‚sÂDô5E•R‡FÖÃãÆ‡FÖÃãÆ†VCãÆÖWF6†'6WCÒ%UDbÓ‚#ãÇF—FÆSå&W÷'FRG&–'WF&–ò7&—Fòr·–V"²sÂ÷F—FÆSâr°¢sÇ7G–ÆSæ&öG—¶föçBÖfÖ–Ç“¤&–ÂÇ6ç2×6W&–c¶Ö‚×v–GFƒ£sƒƒ¶Ö&v–ã£C‚WFó¶6öÆ÷#¢3333¶Æ–æRÖ†V–v‡C£ãS·FF–æs£#‡Òr°¢vƒ¶6öÆ÷#¢3”#S”#c¶&÷&FW"Ö&÷GFöÓ£'‚6öÆ–B3”#S”#c·FF–ærÖ&÷GFöÓ£‡ƒ¶föçB×6—¦S£#‡Òr°¢vƒ'¶6öÆ÷#¢3ccc¶föçB×6—¦S£Gƒ¶Ö&v–ã£#‚‡Òr°¢rç7VÖÖ'—¶&6¶w&÷VæC¢6c†cFfc¶&÷&FW#£‚6öÆ–B6CF#Sƒ¶&÷&FW"×&F—W3£‡ƒ·FF–æs£Gƒ¶Ö&v–ã£g‚Òr°¢wF&ÆW·v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£Gƒ¶Ö&v–â×F÷£‡Òr°¢wF‡¶&6¶w&÷VæC¢3”#S”#c¶6öÆ÷#¢6ffc·FF–æs£‡‚ƒ·FW‡BÖÆ–vã¦ÆVgC¶föçB×6—¦S£Gƒ·FW‡B×G&ç6f÷&Ó§WW&66WÒr°¢wFG·FF–æs£w‚ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B6VVWÒr°¢wG#¦†÷fW"FG¶&6¶w&÷VæC¢6cVcfgÒr°¢ræfö÷FW'¶föçB×6—¦S£Gƒ¶6öÆ÷#¢3“““·FW‡BÖÆ–vã¦6VçFW#¶Ö&v–â×F÷£3ƒ¶&÷&FW"×F÷£‚6öÆ–B6VVS·FF–ær×F÷£'‡Òr°¢tÖVF–&–çG¶&öG—¶Ö&v–ã£#‡×ÓÂ÷7G–ÆSãÂö†VCãÆ&öG“âr°¢sÆƒï	ù8¢&W÷'FRG&–'WF&–ò7&—Fò(	Br·–V"²sÂöƒâr°¢sÇ7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢3ƒƒ‚#ävVæW&Fó¢r¶æWrFFR‚’çFôÆö6ÆTFFU7G&–ær‚vW2ÕRrÇ¶F“¢s"ÖF–v—BrÆÖöçFƒ¢vÆöærrÇ–V#¢vçVÖW&–2wÒ’°¢r+rÜ:—FöFó¢r²†ÖWF†öDÆ&VÇ5¶ÖWF†öE×ÇÆÖWF†öBçFõWW$66R‚’’²sÂ÷âr°¢sÆƒ#å&W7VÖVãÂöƒ#ãÆF—b6Æ73Ò'7VÖÖ'’#âr·7VÖÖ'•&÷w2²sÂöF—câr°¢sÆƒ#äFWFÆÆRFRG&ç666–öæW3Âöƒ#âr·F&ÆT‡FÖÂ°¢sÆF—b6Æ73Ò&fö÷FW"#äFö7VÖVçFòvVæW&Fò÷"FV6Æ&g’æ6öÒ(	B6öÆò6öâf–æW2÷&–VçFF—f÷2â6öç7VÇF6öâVâ&öfW6–öæÂ&FV6—6–öæW2f÷&ÖÆW2ãÂöF—câr°¢sÂö&öG“ãÂö‡FÖÃâr“°¢v–âæFö7VÖVçBæ6Æ÷6R‚“°¢6WEF–ÖV÷WB‚‚“Óçv–âç&–çB‚’ÃS“°§Ğ ¦gVæ7F–öâF÷væÆöEF…Db‚’°¢6öç7B–V#ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…–V"r’çfÇVS°¢6öç7BÖWF†öCÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F„ÖWF†öBr’çfÇVS°¢6öç7BÖWF†öDÆ&VÇ3×¶f–fó¢td”dòòU2rÆÆ–fó¢tÄ”dòòTU2rÆfs¢t6÷7Fò&öÖVF–òöæFW&FòwÓ°¢6öç7BÖWF†öDÆ&VÃÖÖWF†öDÆ&VÇ5¶ÖWF†öE×ÇÆÖWF†öBçFõWW$66R‚“°¢–b‡G—Vöb‡FÖÃ'FcÓÓÒwVæFVf–æVBr—·GFö7B‚tÆÆ–'&W,:ÖDbæò†6&vFòâW6$FW66&v"&W÷'FR…DÔÂ"’FW6FRVÂæfVvF÷"VÆ–vR$–×&–Ö—"âwV&F"6öÖòDb"ârÂwv&âr“·&WGW&çĞ¢6öç7BVÃÖFö7VÖVçBæ7&VFTVÆVÖVçB‚vF—br“°¢VÂç7G–ÆRæ775FW‡CÒwFF–æs£3ƒ¶föçBÖfÖ–Ç“¤&–ÂÇ6ç2×6W&–c¶Ö‚×v–GFƒ£sƒƒ¶Ö&v–ã¦WFó¶6öÆ÷#¢3333¶Æ–æRÖ†V–v‡C£ãc¶&6¶w&÷VæC¢6ffbs°¢VÂæ–ææW$…DÔÃĞ¢sÆƒ7G–ÆSÒ&6öÆ÷#¢3”#S”#c¶&÷&FW"Ö&÷GFöÓ£'‚6öÆ–B3”#S”#c·FF–ærÖ&÷GFöÓ£‡ƒ¶föçB×6—¦S£#'‚#ï	ù8¢&W÷'FRG&–'WF&–ò7&—Fò(	Br·–V"²sÂöƒâr°¢sÇ7G–ÆSÒ&föçB×6—¦S£Gƒ¶6öÆ÷#¢3ƒƒ‚#ävVæW&Fó¢r¶æWrFFR‚’çFôÆö6ÆTFFU7G&–ær‚vW2ÕRrÇ¶F“¢s"ÖF–v—BrÆÖöçFƒ¢vÆöærrÇ–V#¢vçVÖW&–2wÒ’°¢r+rÜ:—FöFó¢r¶ÖWF†öDÆ&VÂ²sÂ÷âr°¢sÆF—b7G–ÆSÒ&Ö&v–ã£g‚#âr¶Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…7VÖÖ'’r’æ–ææW$…DÔÂ²sÂöF—câr°¢sÆƒ"7G–ÆSÒ&6öÆ÷#¢3ccc¶föçB×6—¦S£gƒ¶Ö&v–ã£#‚‚#äFWFÆÆRFRG&ç666–öæW3Âöƒ#âr°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…F&ÆUw&r’æ–ææW$…DÔÂ°¢sÇ7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#¢3“““·FW‡BÖÆ–vã¦6VçFW#¶Ö&v–â×F÷£3ƒ¶&÷&FW"×F÷£‚6öÆ–B6VVS·FF–ær×F÷£'‚#äFö7VÖVçFòvVæW&Fò÷"FV6Æ&g’æ6öÒ(	B6öÆò6öâf–æW2÷&–VçFF—f÷2â6öç7VÇF6öâVâ&öfW6–öæÂ&FV6—6–öæW2f÷&ÖÆW2ãÂ÷âs°¢Fö7VÖVçBæ&öG’æVæD6†–ÆB†VÂ“°¢‡FÖÃ'Fb‚’ç6WB‡¶Ö&v–ã¥³ÃÃÃÒÆf–ÆVæÖS¢w&W÷'FU÷G&–'WF&–õö7&—Fõòr·–V"²rçFbrÆ–ÖvS§·G—S¢v§VrrÇVÆ—G“£ã“‡ÒÆ‡FÖÃ&6çf3§·66ÆS£"ÇW6T4õ%3§G'VWÒÆ§5Dc§·Væ—C¢vÖÒrÆf÷&ÖC¢vBrÆ÷&–VçFF–öã¢w÷'G&—Bw×Ò’æg&öÒ†VÂ’ç6fR‚’çF†Vâ‚‚“Óç¶Fö7VÖVçBæ&öG’ç&VÖ÷fT6†–ÆB†VÂ—Ò’æ6F6‚‚‚“Óç¶Fö7VÖVçBæ&öG’ç&VÖ÷fT6†–ÆB†VÂ“·GFö7B‚tW'&÷"ÂvVæW&"Dbâ–çFVçF6öâVÂ&W÷'FR…DÔÂârÂvW'"r—Ò“°§Ğ ¦gVæ7F–öâFE÷'E7F¶–ær‚’°¢6öç7B6ö–ä–CÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–æt76WBr’çfÇVS°¢–b‚6ö–ä–B—·GFö7B‚u6VÆV66–öæVâ7F—fòârÂwv&âr“·&WGW&çĞ¢6öç7B6çF–FC×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–æt6çBr’çfÇVR“°¢–b‚6çF–FGÇÆ6çF–FCÃÓ—·GFö7B‚t–æw&W6Væ6çF–FBl:Æ–FârÂwv&âr“·&WGW&çĞ¢6öç7BfÆ÷%U4C×'6TfÆöB†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–æufÆ÷"r’çfÇVR“°¢6öç7BfV6†ÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–ætfV6†r’çfÇVWÇÆæWrFFR‚’çFô•4õ7G&–ær‚’ç6Æ–6RƒÃ“°¢÷÷'E7F¶–ærçW6‚‡¶–C¤FFRææ÷r‚’Æ6ö–ä–BÆ6çF–FBÇfÆ÷%U4BÆfV6†Ææ÷F3¢rwÒ“°¢6fU÷'FföÆ–ò‚“°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–æt6çBr’çfÇVSÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–æufÆ÷"r’çfÇVSÒrs°¢Fö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–ætfV6†r’çfÇVSÒrs°¢ÆöE÷'E7F¶–ær‚“°¢GFö7B‚~)ÈR&Wv&BFR7F¶–ærw&VvFòârÂvö²r“°§Ğ ¦gVæ7F–öâÆöE÷'E7F¶–ær‚’°¢G'—µ÷÷'E7F¶–æsÔ¥4ôâç'6R†Æö6Å7F÷&vRævWD—FVÒ‚wG÷7F¶–ærr—ÇÂuµÒr—Ö6F6‡µ÷÷'E7F¶–æsÕµ×Ğ¢6öç7BF÷FÅ&Wv&CÕ÷÷'E7F¶–ærç&VGV6R‚‡2Ç"“Óç2²‡'6TfÆöB‡"çfÆ÷%U4B—ÇÃ’Ã“°¢6öç7B—%7F¶–æs×F÷FÅ&Wv&B£ãS°¢6öç7B7VÖÖ'”VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–æu7VÖÖ'’r“°¢7VÖÖ'”VÂæ–ææW$…DÔÃĞ¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#åF÷FÂ&Wv&G2U4CÂöF—cãÆF—b6Æ73Ò'6&B×fÂvöÆB#âBr·F÷FÅ&Wv&BçFôf—†VBƒ"’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ä•"W7F–ÖFòƒRR“ÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âBr¶—%7F¶–ærçFôf—†VBƒ"’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#åG&ç666–öæW3ÂöF—cãÆF—b6Æ73Ò'6&B×fÂ#ârµ÷÷'E7F¶–æræÆVæwF‚²sÂöF—cãÂöF—câs°¢6öç7BÆ—7DVÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v77F¶–ætÆ—7Br“°¢–b‚÷÷'E7F¶–æræÆVæwF‚—°¢Æ—7DVÂæ–ææW$…DÔÃÒsÆF—b7G–ÆSÒ&6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£Gƒ·FF–æs£‡‚#å6–â&Wv&G2&Vv—7G&F÷2ãÂöF—câs°¢ÖVÇ6W°¢Æ—7DVÂæ–ææW$…DÔÃÒsÇF&ÆR7G–ÆSÒ'v–GFƒ£S¶&÷&FW"Ö6öÆÆ6S¦6öÆÆ6S¶föçB×6—¦S£G‚#ãÇF†VCãÇG#âr°¢sÇF‚7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã¦ÆVgC¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×vV–v‡C£C#ä7F—fóÂ÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×vV–v‡C£C#ä6çF–FCÂ÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã§&–v‡C¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×vV–v‡C£C#åfÆ÷"U4CÂ÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã¦ÆVgC¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×vV–v‡C£C#äfV6†Â÷Fƒâr°¢sÇF‚7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FW‡BÖÆ–vã¦6VçFW#¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×vV–v‡C£C#ãÂ÷FƒãÂ÷G#ãÂ÷F†VCãÇF&öG“âr°¢÷÷'E7F¶–æræÖ‚‡"Æ’“ÓâsÇG#âr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB’#ârµ÷÷'DæÖR‡"æ6ö–ä–B’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB“·FW‡BÖÆ–vã§&–v‡B#âr²‡"æ6çF–FGÇÃ’çFôf—†VBƒb’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB“·FW‡BÖÆ–vã§&–v‡B#âBr²‡"çfÆ÷%U4GÇÃ’çFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB’#âr²‡"æfV6†ÇÂrr’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ'FF–æs£W‚‡ƒ¶&÷&FW"Ö&÷GFöÓ£‚6öÆ–B&v&ƒ#SRÃ#SRÃ#SRÂãB“·FW‡BÖÆ–vã¦6VçFW"#âr°¢sÆ'WGFöâöæ6Æ–6³Ò%÷÷'E7F¶–ærç7Æ–6R‚r¶’²rÃ“·6fU÷'FföÆ–ò‚“¶ÆöE÷'E7F¶–ær‚“²"7G–ÆSÒ&&6¶w&÷VæC§G&ç7&VçC¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£Gƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“·FF–æs£'‚gƒ¶föçB×6—¦S£Gƒ¶7W'6÷#§ö–çFW#¶föçBÖfÖ–Ç“¦–æ†W&—B#ï	ùyÂö'WGFöããÂ÷FCâr°¢sÂ÷G#âr’æ¦ö–â‚rr’°¢sÂ÷F&öG“ãÂ÷F&ÆSâs°¢Ğ§Ğ ¢òò)H)H×VÇF’Õ–V"F6†&ö&B)H)H ¦gVæ7F–öâ&VæFW$×VÇF•–V$F6†&ö&B‚’°¢G'’°¢6öç7B–V'2Ò·Ó°¢f÷"†6öç7Böb÷÷'D76WG2’°¢6öç7BBÒæWrFFR†æfV6†6ö×&“°¢–b†—4æâ†BævWEF–ÖR‚’’’6öçF–çVS°¢6öç7B’ÒBævWDgVÆÅ–V"‚“°¢–b‚–V'5·•Ò’–V'5·•ÒÒ²–çfW7FVC¢Â7W'&VçC¢Â6÷VçC¢Ó°¢6öç7BG’Ò'6TfÆöB†æ6çF–FB’ÇÂ°¢6öç7B'Ò'6TfÆöB†ç&V6–ô6ö×&U4B’ÇÂ°¢6öç7B7Ò÷÷'E&–6W5¶æ6ö–ä–EÓòçW6BÇÂ'ÇÂ°¢–V'5·•Òæ–çfW7FVB³ÒG’¢'°¢–V'5·•Òæ7W'&VçB³ÒG’¢7°¢–V'5·•Òæ6÷VçB²³°¢Ğ¢6öç7B5–V'2Ò·Ó°¢f÷"†6öç7B2öb÷÷'E7F¶–ær’°¢6öç7BBÒæWrFFR‡2æfV6†“°¢–b†—4æâ†BævWEF–ÖR‚’’’6öçF–çVS°¢6öç7B’ÒBævWDgVÆÅ–V"‚“°¢5–V'5·•ÒÒ‡5–V'5·•ÒÇÂ’²‡'6TfÆöB‡2çfÆ÷%U4B’ÇÂ“°¢Ğ¢6öç7B6÷'FVBÒö&¦V7Bæ¶W—2‡–V'2’ç6÷'B‚“°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7×VÇF•–V%w&r“°¢–b‚VÂ’&WGW&ã°¢–b‚6÷'FVBæÆVæwF‚’²VÂæ–ææW$…DÔÂÒrs²&WGW&âĞ¢ÆWB‡FÖÂÒsÆF—b6Æ73Ò'6V2×F—FÆR"7G–ÆSÒ&Ö&v–â×F÷£#‚#ï	ù8RF6†&ö&B×VÇF’ÔçVÃÂöF—câs°¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ&÷fW&fÆ÷r×ƒ¦WFó¶Ö&v–âÖ&÷GFöÓ£g‚#ãÇF&ÆR6Æ73Ò'&W2×F&ÆR"7G–ÆSÒ'v–GFƒ£S¶föçB×6—¦S£G‚#ãÇF†VCãÇG#âr°¢sÇFƒä;óÂ÷FƒãÇFƒåF÷FÂ–çfW'F–FóÂ÷FƒãÇFƒåfÆ÷"7GVÃÂ÷FƒãÇFƒävææ6–õ:—&F–FÂ÷FƒãÇFƒå&WF÷&æòSÂ÷FƒãÇFƒå7F¶–ær&Wv&G3Â÷FƒãÇFƒä7F—f÷3Â÷FƒãÂ÷G#ãÂ÷F†VCãÇF&öG“âs°¢f÷"†6öç7B’öb6÷'FVB’°¢6öç7B–çbÒ–V'5·•Òæ–çfW7FVC°¢6öç7B7W"Ò–V'5·•Òæ7W'&VçC°¢6öç7BæÂÒ7W"Ò–çc°¢6öç7B7BÒ–çbâò‡æÂò–çb’¢¢°¢6öç7B7F¶–ærÒ5–V'5·•ÒÇÂ°¢6öç7B6vâÒæÂãÒòr²r¢rs°¢‡FÖÂ³ÒsÇG#âr°¢sÇFCãÇ7G&öæsâr²’²sÂ÷7G&öæsãÂ÷FCâr°¢sÇFCâBr²–çbçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFCâBr²7W"çFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ&6öÆ÷#¢r²‡æÂãÒòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âr²6vâ²rBr²æÂçFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ&6öÆ÷#¢r²‡7BãÒòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âr²6vâ²7BçFôf—†VBƒ"’²rSÂ÷FCâr°¢sÇFCâr²‡7F¶–ærâòrBr²7F¶–ærçFôf—†VBƒ"’¢~(	Br’²sÂ÷FCâr°¢sÇFCâr²–V'5·•Òæ6÷VçB²sÂ÷FCãÂ÷G#âs°¢Ğ¢‡FÖÂ³ÒsÂ÷F&öG“ãÂ÷F&ÆSãÂöF—câs°¢VÂæ–ææW$…DÔÂÒ‡FÖÃ°¢Ò6F6‚†R’²6öç6öÆRçv&â‚w&VæFW$×VÇF•–V$F6†&ö&C¢rÂRæÖW76vR’Ğ§Ğ ¢òò)H)H÷÷'GVæ—G’6÷7B)H)H ¦gVæ7F–öâ÷÷'E÷VÆFT÷6÷7E6VÆV7G2‚’°¢G'’°¢6öç7B6VÄÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7÷6÷7D76WBr“°¢6öç7B6VÄ"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7÷6÷7DÇBr“°¢–b‚6VÄÇÂ6VÄ"’&WGW&ã°¢6VÄæ–ææW$…DÔÂÒsÆ÷F–öâfÇVSÒ"#î(	B6VÆV66–öæ"(	CÂö÷F–öãâr°¢÷÷'D76WG2æÖ†ÓâsÆ÷F–öâfÇVSÒ"r²†æ6ö–ä–BÇÂæ7F—fò’²r#âr²÷÷'DæÖR†æ6ö–ä–BÇÂæ7F—fò’²sÂö÷F–öãâr’æ¦ö–â‚rr“°¢6VÄ"æ–ææW$…DÔÂÒsÆ÷F–öâfÇVSÒ"#î(	B6VÆV66–öæ"(	CÂö÷F–öãâr°¢ö&¦V7BæVçG&–W2…õõ%Eô5%•DõôÔ’æÖ‚…¶²ÂeÒ’ÓâsÆ÷F–öâfÇVSÒ"r²²²r#âr²b²sÂö÷F–öãâr’æ¦ö–â‚rr“°¢Ò6F6‚†R’²6öç6öÆRçv&â‚u÷÷'E÷VÆFT÷6÷7E6VÆV7G3¢rÂRæÖW76vR’Ğ§Ğ ¦7–æ2gVæ7F–öâ6Æ4÷÷'GVæ—G”6÷7B‚’°¢G'’°¢6öç7B6VÄÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7÷6÷7D76WBr“°¢6öç7B6VÄ"ÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7÷6÷7DÇBr“°¢6öç7B&W4VÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7÷6÷7E&W7VÇBr“°¢6öç7B–BÒ6VÄòçfÇVS°¢6öç7B$–BÒ6VÄ#òçfÇVS°¢–b‚–BÇÂ$–B’²GFö7B‚u6VÆV66–öæÖ&÷27F—f÷2ârÂwv&âr“²&WGW&âĞ¢–b†–BÓÓÒ$–B’²GFö7B‚u6VÆV66–öæ7F—f÷2F–fW&VçFW2ârÂwv&âr“²&WGW&âĞ¢6öç7B76WBÒ÷÷'D76WG2æf–æB†Óâæ6ö–ä–BÓÓÒ–B“°¢–b‚76WB’²GFö7B‚t7F—fòæòVæ6öçG&FòârÂwv&âr“²&WGW&âĞ¢6öç7BG’Ò'6TfÆöB†76WBæ6çF–FB’ÇÂ°¢6öç7B'Ò'6TfÆöB†76WBç&V6–ô6ö×&U4B’ÇÂ°¢6öç7B–BÒG’¢'°¢6öç7B7Ò÷÷'E&–6W5¶–EÓòçW6BÇÂ°¢6öç7B7"Ò÷÷'E&–6W5¶$–EÓòçW6BÇÂ°¢6öç7BfÄÒG’¢7°¢6öç7BæÖTÒ÷÷'DæÖR†–B“°¢6öç7BæÖT"Ò÷÷'DæÖR†$–B“°¢6öç7BFFTF—7Æ’Ò76WBæfV6†6ö×&ÇÂvFW66öæö6–Fs°¢ÆWB†—7D"ÒçVÆÃ°¢–b†76WBæfV6†6ö×&’°¢6öç7BÒ76WBæfV6†6ö×&ç7Æ—B‚rÒr“°¢†—7D"Òv—Bö6t†—7F÷&–6Å&–6R†$–BÂ³%Ò²rÒr²³Ò²rÒr²³Ò“°¢Ğ¢ÆWBv÷'F…FöF’Ò–C°¢ÆWB†—7E7G"Òrs°¢–b††—7D"bb†—7D"â’°¢6öç7BG”"Ò–Bò†—7D#°¢v÷'F…FöF’ÒG”"¢7#°¢†—7E7G"ÒrÂ&V6–òr²FFTF—7Æ’²s¢Br²†—7D"çFôf—†VBƒ"“°¢Ğ¢6öç7BF–fbÒv÷'F…FöF’ÒfÄ°¢&W4VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&W4VÂæ–ææW$…DÔÂĞ¢sÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒƒ‚Ãg"’“¶v£ƒ¶Ö&v–â×F÷£'ƒ¶föçB×6—¦S£G‚#âr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ä–çfW'F—7FRVâr²æÖT²sÂöF—cãÆF—b6Æ73Ò'6&B×fÂvöÆB#âBr²–BçFôf—†VBƒ"’²sÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#æVÂr²FFTF—7Æ’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#åfÆ÷"7GVÂFRr²æÖT²sÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#¢r²‡fÄãÒ–Bòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âBr²fÄçFôf—†VBƒ"’²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#å6’6ö×&&2r²æÖT"²sÂöF—cãÆF—b6Æ73Ò'6&B×fÂvöÆB#âBr²v÷'F…FöF’çFôf—†VBƒ"’²sÂöF—cãÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#âr²æÖT"²r†÷“¢Br²7"çFôf—†VBƒ"’²†—7E7G"²sÂöF—cãÂöF—câr°¢sÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#äF–fW&Væ6–ÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#¢r²†F–fbãÒòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âr²†F–fbãÒòr²r¢rr’²rBr²F–fbçFôf—†VBƒ"’²sÂöF—cãÂöF—câr°¢sÂöF—câs°¢Ò6F6‚†R’²GFö7B‚tW'&÷#¢r²RæÖW76vRÂvW'&÷"r’Ğ§Ğ ¢òò)H)HF‚&V6öÖÖVæFF–öâ)H)H ¦gVæ7F–öâvVåF…&V6öÖÖVæFF–öâ‚’°¢G'’°¢6öç7BVÂÒFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…&V6öÖÖVæFF–öâr“°¢–b‚VÂ’&WGW&ã°¢–b‚÷÷'D76WG2æÆVæwF‚’°¢VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#·FF–æs£#ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#äæò†’7F—f÷2VâVÂ÷'FföÆ–ò&æÆ—¦"ãÂöF—câs°¢VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&WGW&ã°¢Ğ¢–b‚ö&¦V7Bæ¶W—2…÷÷'E&–6W2’æÆVæwF‚’°¢VÂæ–ææW$…DÔÂÒsÆF—b7G–ÆSÒ'FW‡BÖÆ–vã¦6VçFW#·FF–æs£#ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶föçB×6—¦S£G‚#î(û2W7W&æFò&V6–÷2âââ&W6–öæ$7GVÆ—¦"&V6–÷2"ãÂöF—câs°¢VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢&WGW&ã°¢Ğ¢6öç7BÆ÷6W'2ÒµÓ°¢6öç7Bv–ææW'2ÒµÓ°¢f÷"†6öç7Böb÷÷'D76WG2’°¢6öç7BG’Ò'6TfÆöB†æ6çF–FB’ÇÂ°¢6öç7B'Ò'6TfÆöB†ç&V6–ô6ö×&U4B’ÇÂ°¢6öç7B7Ò÷÷'E&–6W5¶æ6ö–ä–EÓòçW6BÇÂ'ÇÂ°¢–b‚G’ÇÂ'’6öçF–çVS°¢6öç7B–çbÒG’¢'°¢6öç7B7W"ÒG’¢7°¢6öç7BæÂÒ7W"Ò–çc°¢6öç7B7BÒ'âò‚†7Ò'’ò'’¢¢°¢6öç7B—FVÒÒ²æÖS¢÷÷'DæÖR†æ6ö–ä–BÇÂæ7F—fò’Â–çbÂ7W"ÂæÂÂ7BÂ6ö–ä–C¢æ6ö–ä–BÓ°¢–b‡æÂÂ’Æ÷6W'2çW6‚†—FVÒ“°¢VÇ6R–b‡æÂâ’v–ææW'2çW6‚†—FVÒ“°¢Ğ¢Æ÷6W'2ç6÷'B‚†Â"’Óâç7BÒ"ç7B“°¢v–ææW'2ç6÷'B‚†Â"’Óâ"ç7BÒç7B“°¢6öç7BF÷FÄv–âÒv–ææW'2ç&VGV6R‚‡2Â’Óâ2²çæÂÂ“°¢6öç7BF÷FÄÆ÷72ÒÆ÷6W'2ç&VGV6R‚‡2Â’Óâ2²çæÂÂ“°¢6öç7BæWDv–âÒF÷FÄv–â²F÷FÄÆ÷73°¢6öç7BF…âÒÖF‚æÖ‚ƒÂæWDv–â¢ãR“°¢6öç7BF…¢ÒÖF‚æÖ‚ƒÂæWDv–â¢ã#“R“°¢6öç7B6f–æw2ÒÖF‚æ'2‡F÷FÄÆ÷72’¢ãS° ¢ÆWBÖWF†öBÒvfrs°¢–b†Æ÷6W'2æÆVæwF‚âv–ææW'2æÆVæwF‚bbÆ÷6W'2æÆVæwF‚â"’ÖWF†öBÒvf–fòs°¢VÇ6R–b‡v–ææW'2æÆVæwF‚âÆ÷6W'2æÆVæwF‚bbv–ææW'2æÆVæwF‚â"’ÖWF†öBÒvÆ–fòs°¢6öç7BÔÆ&VÇ2Ò²f–fó¢td”dòòU2rÂÆ–fó¢tÄ”dòòTU2rÂfs¢t6÷7Fò&öÖVF–òrÓ° ¢ÆWB‡FÖÂÒsÆF—b6Æ73Ò'6V2×F—FÆR"7G–ÆSÒ&Ö&v–â×F÷£#‚#ï	ù*&V6öÖVæF6œ;6âG&–'WF&––çFVÆ–vVçFSÂöF—câs°¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ&&6¶w&÷VæC§f"‚Ò×7W&f6R“¶&÷&FW#£‚6öÆ–Bf"‚ÒÖ&÷&FW"“¶&÷&FW"×&F—W3£ƒ·FF–æs£gƒ¶Ö&v–âÖ&÷GFöÓ£g‚#âs° ¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ&F—7Æ“¦fÆWƒ¶v£ƒ¶fÆW‚×w&§w&¶Ö&v–âÖ&÷GFöÓ£Gƒ¶Æ–vâÖ—FV×3¦6VçFW"#âs°¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ'FF–æs£g‚'ƒ¶&6¶w&÷VæC§&v&ƒSRÃƒ’Ãƒ"Âã2“¶&÷&FW"×&F—W3£gƒ¶föçB×6—¦S£Gƒ¶föçB×vV–v‡C£S#ï	ù9Ü:—FöFò7VvW&–Fó¢Ç7G&öæsâr²ÔÆ&VÇ5¶ÖWF†öEÒ²sÂ÷7G&öæsãÂöF—câs°¢–b†ÖWF†öBÓÓÒvf–fòr’‡FÖÂ³ÒsÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ì+rd”dòW&Ö—FRFVGV6—":—&F–F2çF–wV2&–ÖW&óÂöF—câs°¢VÇ6R–b†ÖWF†öBÓÓÒvÆ–fòr’‡FÖÂ³ÒsÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ì+rÄ”dòÖ–æ–Ö—¦vææ6–w&f&ÆR7GVÃÂöF—câs°¢VÇ6R‡FÖÂ³ÒsÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB’#ì+r6'FW&&Ææ6VF(	B6÷7Fò&öÖVF–òöæFW&FóÂöF—câs°¢‡FÖÂ³ÒsÂöF—câs° ¢–b†Æ÷6W'2æÆVæwF‚’°¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Wƒ¶föçB×vV–v‡C£c¶Ö&v–ã£‚‡ƒ¶6öÆ÷#§f"‚Ò×&VB’#ï	ù8’F‚ÔÆ÷72†'fW7F–æsÂöF—câs°¢‡FÖÂ³ÒsÇF&ÆR6Æ73Ò'&W2×F&ÆR"7G–ÆSÒ'v–GFƒ£S¶föçB×6—¦S£Gƒ¶Ö&v–âÖ&÷GFöÓ£‚#ãÇF†VCãÇG#âr°¢sÇFƒä7F—fóÂ÷FƒãÇFƒä–çfW'F–FóÂ÷FƒãÇFƒåfÆ÷"7GVÃÂ÷FƒãÇFƒå:—&F–FÂ÷FƒãÇFƒâSÂ÷FƒãÇFƒå7VvW&Væ6–Â÷FƒãÂ÷G#ãÂ÷F†VCãÇF&öG“âs°¢f÷"†6öç7BöbÆ÷6W'2ç6Æ–6RƒÂR’’°¢6öç7B7VrÒç7BÂÓ#ò~)ªûˆò6öç6–FW&fVæFW"r¢	ù8¢Ööæ—F÷&V"s°¢‡FÖÂ³ÒsÇG#ãÇFCâr²ææÖR²sÂ÷FCãÇFCâBr²æ–çbçFôf—†VBƒ"’²sÂ÷FCãÇFCâBr²æ7W"çFôf—†VBƒ"’²sÂ÷FCâr°¢sÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âÒBr²ÖF‚æ'2†çæÂ’çFôf—†VBƒ"’²sÂ÷FCãÇFB7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âr²ç7BçFôf—†VBƒ"’²rSÂ÷FCãÇFB7G–ÆSÒ&föçB×6—¦S£7‚#âr²7Vr²sÂ÷FCãÂ÷G#âs°¢Ğ¢‡FÖÂ³ÒsÂ÷F&öG“ãÂ÷F&ÆSâs°¢–b†Æ÷6W'2æÆVæwF‚âR’‡FÖÂ³ÒsÆF—b7G–ÆSÒ&föçB×6—¦S£7ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶Ö&v–âÖ&÷GFöÓ£‚#ââââ’r²†Æ÷6W'2æÆVæwF‚ÒR’²rÜ:2ãÂöF—câs°¢Ğ ¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ&föçB×6—¦S£Wƒ¶föçB×vV–v‡C£c¶Ö&v–ã£‚‡‚#ï	ù+–×7FòG&–'WF&–óÂöF—câs°¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ&F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒC‚Ãg"’“¶v£‡ƒ¶Ö&v–âÖ&÷GFöÓ£‚#âs°¢‡FÖÂ³ÒsÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ävææ6–æWFÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#¢r²†æWDv–âãÒòwf"‚ÒÖw&VVâ’r¢wf"‚Ò×&VB’r’²r#âr²†æWDv–âãÒòr²r¢rr’²rBr²æWDv–âçFôf—†VBƒ"’²sÂöF—cãÂöF—câs°¢‡FÖÂ³ÒsÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ä•"RR…â“ÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âBr²F…âçFôf—†VBƒ"’²sÂöF—cãÂöF—câs°¢‡FÖÂ³ÒsÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ä•"#’ãRR…¢“ÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚Ò×&VB’#âBr²F…¢çFôf—†VBƒ"’²sÂöF—cãÂöF—câs°¢–b‡6f–æw2â’‡FÖÂ³ÒsÆF—b6Æ73Ò'6&B#ãÆF—b6Æ73Ò'6&BÖÆ&Â#ä†÷'&òD‚÷FVæ6–ÃÂöF—cãÆF—b6Æ73Ò'6&B×fÂ"7G–ÆSÒ&6öÆ÷#§f"‚ÒÖw&VVâ’#âBr²6f–æw2çFôf—†VBƒ"’²sÂöF—cãÂöF—câs°¢‡FÖÂ³ÒsÂöF—câs° ¢‡FÖÂ³ÒsÆF—b7G–ÆSÒ&föçB×6—¦S£'ƒ¶6öÆ÷#§f"‚ÒÖ×WFVB“¶&÷&FW"×F÷£‚6öÆ–Bf"‚ÒÖ&÷&FW"“·FF–ær×F÷£‡‚#î)ªûˆò&V6öÖVæF6œ;6âWFöÖF—¦Fâ6öç7VÇF6öâVâ6öçFF÷"&FV6—6–öæW2f÷&ÖÆW2ãÂöF—câs°¢‡FÖÂ³ÒsÂöF—câs°¢VÂæ–ææW$…DÔÂÒ‡FÖÃ°¢VÂç7G–ÆRæF—7Æ’Òv&Æö6²s°¢Ò6F6‚†R’²6öç6öÆRçv&â‚vvVåF…&V6öÖÖVæFF–öã¢rÂRæÖW76vR’Ğ§Ğ ¦gVæ7F–öâ÷÷'D–æ—EF…–V'2‚’°¢6öç7B6VÃÖFö7VÖVçBævWDVÆVÖVçD'”–B‚v7F…–V"r“°¢–b‚6VÂ—&WGW&ã°¢6öç7B7W'&VçCÖæWrFFR‚’ævWDgVÆÅ–V"‚“°¢6VÂæ–ææW$…DÔÃÒrs°¢f÷"†ÆWB“Ö7W'&VçC·“ãÓ##·’ÒÒ—°¢6öç7B÷CÖFö7VÖVçBæ7&VFTVÆVÖVçB‚v÷F–öâr“°¢÷BçfÇVS×“¶÷BçFW‡D6öçFVçC×“°¢6VÂæVæD6†–ÆB†÷B“°¢Ğ§Ğ ¦gVæ7F–öâ÷÷'D–æ—B‚’°¢÷÷'D–æ—EF…–V'2‚“°¢ÆöE÷'FföÆ–ò‚“°¢&VæFW%÷'FföÆ–ò‚“°¢ÆöE÷'E7F¶–ær‚“°¢÷÷'E÷VÆFT÷6÷7E6VÆV7G2‚“°¢&VæFW$×VÇF•–V$F6†&ö&B‚“°§Ğ ¦6öç7Bö÷&–u6WEF"Ò6WEF#°§v–æF÷rç6WEF"ÒgVæ7F–öâ‡F"Â'Fâ’°¢ö÷&–u6WEF"‡F"Â'Fâ“°¢–b‡F"ÓÓÒv7&—Fõ÷÷'FföÆ–òr’²÷÷'D–æ—B‚“²Ğ¢–b‡F"ÓÓÒvÆfFòr’²6WDÆfFõF"‚væ÷&Ö2rÂçVÆÂ“²6WEF–ÖV÷WB‚‚’ÓâFö7VÖVçBçVW'•6VÆV7F÷"‚r7DÆfFòç&Vr×F"r“òæ6Æ74Æ—7BæFB‚v7F—fRr’ÂS“²Ğ§Ó° ¦–b†Fö7VÖVçBævWDVÆVÖVçD'”–B‚v6Å7F¶–æuG&6¶W"r’’–æ—E7F¶–æuG&6¶W"‚“°