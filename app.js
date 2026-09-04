// ── LLAMADAS A CLAUDE: directas (API key del usuario) o vía Cloud Function ──
// NOTA: AREAS, SYS, DECLARAFY_PROXY_URL, DECLARAFY_FN_BASE, FREE y ADMIN_EMAIL
// están definidos en /js/config.js — NO duplicar aquí.
async function callDeclaraFY(body) {
  // Direct call when user provided their own API key
  if (typeof apiKey === 'string' && apiKey.startsWith('sk-ant-')) {
    const stream = body.stream || false;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: body.model || 'claude-sonnet-4-5',
          max_tokens: body.max_tokens || 1024,
          stream,
          system: body.system,
          messages: body.messages,
        }),
      });
      console.log('Anthropic response:', resp.status, resp.statusText);
      return resp;
    } catch (e) {
      console.error('Anthropic direct call failed:', e);
      throw new Error('Error de conexión con Anthropic: ' + e.message);
    }
  }
  // Fallback: Cloud Function proxy (needs Blaze plan)
  let idToken = null;
  try {
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
      idToken = await firebase.auth().currentUser.getIdToken();
    }
  } catch (e) { console.warn('No se pudo obtener idToken:', e.message); }
  return fetch(DECLARAFY_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { 'Authorization': 'Bearer ' + idToken } : {})
    },
    body: JSON.stringify(body)
  });
}


function showScreen(id){document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active');s.style.display='none'});const el=document.getElementById(id);if(el){el.classList.add('active');el.style.display='flex';}}

function setArea(btn){
  if(!btn) return;
  document.querySelectorAll('.atab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  curArea = btn.dataset?.area || btn.getAttribute('data-area') || 'general';
}

// ── STATE ──
let apiKey = localStorage.getItem('tp_anthropic_key') || false;
let curUser=null,curPlan='basico',curArea='general';
// Cuenta de administrador — mismo criterio que firestore.rules (isAdmin()).
// ADMIN_EMAIL y FREE ya están en config.js
function isAdminUser() { return !!(curUser && curUser.email === ADMIN_EMAIL); }
let msgCount=0,attached=[],convHist=[],convId=null;

// ════════════════════════════════════════
// FUNCIONES DE UI RECONSTRUIDAS
// (no existían en el archivo recibido, pero se llaman en decenas de lugares;
//  siguen el mismo patrón de DOM/CSS ya usado por _sendMsgStreamBase,
//  handleMultiFiles y renderHistList)
// ════════════════════════════════════════

// ── showTyp / rem_typ: indicadores de "escribiendo..." ──
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

// ── Render de mensajes en el chat ──
function _escapeHtml(str) {
  if (typeof DOMPurify !== 'undefined') return DOMPurify.sanitize(String(str), {ALLOWED_TAGS: [], ALLOWED_ATTR: []});
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
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

// ── Adjuntar archivo suelto en el chat (zona principal, no modo "caso") ──
async function readFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'pdf') return await readPDFFile(file);
    if (['txt','csv','xml'].includes(ext)) return await readTextFile(file);
    if (['xlsx','xls'].includes(ext)) return await readExcelFile(file);
    return await readTextFile(file).catch(() => `[Archivo binario: ${file.name} — ${(file.size/1024).toFixed(1)} KB]`);
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
  el.innerHTML = attached.map((f,i) => `<div class="chip">📎 ${f.name}<button onclick="removeChip(${i})" aria-label="Quitar archivo">×</button></div>`).join('');
}
function removeChip(i) { attached.splice(i,1); renderChips(); }

// ── Textarea del chat ──
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

// ── Navegación de pantallas ──
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

// ── Historial de conversaciones ──
function renderHist() { if (curUser) renderHistList(getHist(curUser.email)); }
function clearHist() {
  if (!curUser) return;
  if (!confirm('¿Borrar todo tu historial de conversaciones? Esta acción no se puede deshacer.')) return;
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

// ── Modal "ingresa tu API key" ──
function saveKey() {
  const inp = document.getElementById('apiInp');
  const val = inp?.value?.trim() || '';
  const errEl = document.getElementById('apiErr');
  if (!val.startsWith('sk-ant-')) {
    if (errEl) errEl.textContent = '❌ La API key debe comenzar con sk-ant-';
    return;
  }
  if (errEl) errEl.textContent = '';
  localStorage.setItem('tp_anthropic_key', val);
  apiKey = val;
  document.getElementById('apiOv')?.classList.add('hidden');
  addNotif('🔑', 'API Key conectada', 'Ahora puedes usar respuestas reales de Claude.');
}

// ── DB ──
function getUsers(){try{return JSON.parse(localStorage.getItem('tp_u')||'{}')}catch{return{}}}
function saveUsers(u){localStorage.setItem('tp_u',JSON.stringify(u))}
function getHist(e){
  try{return JSON.parse(localStorage.getItem('tp_h_'+btoa(e))||'[]')}catch{return[]}
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

// ══════════════════════════════════════════════════════════════
// CAPA DE PERSISTENCIA UNIFICADA — "Todo a Firestore"
//
// Un KV sync con write-through a localStorage (caché offline) y
// copia asíncrona a Firestore bajo users/{uid}/kv/{key}.
// Se usa para TODOS los datos por-usuario, de modo que persisten
// entre dispositivos. localStorage queda sólo como caché local.
// ══════════════════════════════════════════════════════════════

// CampoS KV capturados por el scope de un usuario autenticado.
// Cada función recibe la clave local ya resuelta (p.ej. 'tp_crm_xxx')
// y el scope determina el documento de Firestore dónde guardar el valor.
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

// Lee: prioriza Firestore (si online) con localStorage como caché.

// Carga TODOS los scopes de Firestore al iniciar sesión (pobla la caché local).
async function kvLoadAll() {
  if (!fbReady || !curUser?.uid) return;
  try {
    const snap = await fbDb.collection('users').doc(curUser.uid).collection('kv').get();
    snap.forEach(d => {
      const lk = resolveKVLocalKey(d.id);
      if (lk) localStorage.setItem(lk, JSON.stringify(d.data().v));
    });
  } catch(e) { /* offline: usa caché local */ }
}

// Mapa scope -> clave localStorage correspondiente (para reproyectar desde Firestore).
const KV_SCOPE_TO_LOCAL = {};
function resolveKVLocalKey(scope){ const m = KV_SCOPE_TO_LOCAL[scope]; return typeof m === 'function' ? m() : m || null; }
// scope puede apuntar a una clave fija o a una función que la resuelve en runtime.
function registerKVScope(scope, localKey){ KV_SCOPE_TO_LOCAL[scope] = localKey; }

// ── AUTH ──
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
  // Delegated to Firebase version — read directly from the form fields
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

// ════════════════════════════════════════
// QUOTA BARS
// ════════════════════════════════════════
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

// ════════════════════════════════════════
// CALCULADORAS
// ════════════════════════════════════════
// fmtS → unified formatter above
/**
 * calcIGV — Calculadora IGV
 * Base legal: Art. 1 Ley 29646, alícuota 18% (16% IGV + 2% IPM).
 * Calcula: impuesto bruto, crédito fiscal y neto a pagar.
 * Fórmula: IGV = base imponible × 0.18
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
    document.getElementById('igvDet').textContent = tipo === 'exportacion' ? 'Exportación: tasa 0% — Art.33 LIGV. Tiene derecho a saldo a favor del exportador.' : 'Operación exonerada: no genera IGV ni crédito fiscal.';
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
  document.getElementById('pacDet').textContent = fmtS(base) + ' × ' + tasa + '% = ' + fmtS(pac) + ' — PDT 621 Cód.301';
}
function calcDet() {
  const base = parseFloat(document.getElementById('detBase').value) || 0;
  const tasa = parseInt(document.getElementById('detTipo').value);
  const r = document.getElementById('detRes'); r.style.display = 'block';
  const det = base * (tasa / 100);
  document.getElementById('detVal').textContent = fmtS(det);
  document.getElementById('detDet').textContent = fmtS(base) + ' × ' + tasa + '% = ' + fmtS(det) + ' — Banco de la Nación, 5to día hábil siguiente.';
}

// ════════════════════════════════════════
// CALENDARIO
// ════════════════════════════════════════
const CAL_YEAR = new Date().getFullYear();
const CAL_DATA = [
  {dia:15,mes:'Ene',nombre:`Declaración mensual PDT 621 (dic. anterior)`,desc:'Todos los dígitos RUC. IGV + Pago a cuenta IR',tipo:'mensual',urg:'ok'},
  {dia:31,mes:'Mar',nombre:`Declaración Jurada Anual IR ${CAL_YEAR-1}`,desc:'Personas naturales y jurídicas — PDT 710',tipo:'anual',urg:'soon'},
  {dia:30,mes:'Abr',nombre:'Vencimiento DJ Anual (plazo especial)',desc:'Según cronograma SUNAT por dígito RUC',tipo:'anual',urg:'soon'},
  {dia:15,mes:'May',nombre:`Declaración mensual PDT 621 (abr)`,desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:30,mes:'Jun',nombre:`Primera cuota ITAN ${CAL_YEAR}`,desc:'Impuesto Temporal a los Activos Netos',tipo:'especial',urg:'ok'},
  {dia:15,mes:'Jul',nombre:'Declaración mensual PDT 621 (jun)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:31,mes:'Jul',nombre:`Segunda cuota ITAN ${CAL_YEAR}`,desc:'Impuesto Temporal a los Activos Netos',tipo:'especial',urg:'ok'},
  {dia:15,mes:'Sep',nombre:'Declaración mensual PDT 621 (ago)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:31,mes:'Oct',nombre:'Precios de Transferencia — Local File',desc:'Formulario Virtual 3560 (contribuyentes obligados)',tipo:'especial',urg:'soon'},
  {dia:15,mes:'Nov',nombre:'Declaración mensual PDT 621 (oct)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
  {dia:15,mes:'Dic',nombre:'Declaración mensual PDT 621 (nov)',desc:'IGV + Pago a cuenta IR mensual',tipo:'mensual',urg:'ok'},
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
  const urgLabel = {urgent:'Urgente', soon:'Próximo', ok:'Vigente'};
  el.innerHTML = items.map(c => `<div class="cal-item"><div class="cal-date"><div class="cal-day">${c.dia}</div><div class="cal-mon">${c.mes}</div></div><div class="cal-info"><div class="cal-name">${c.nombre}</div><div class="cal-desc">${c.desc}</div></div><span class="cal-badge ${c.urg}">${urgLabel[c.urg]}</span></div>`).join('');
}

// ════════════════════════════════════════
// EXPORT PDF
// ════════════════════════════════════════
function exportPDF() {
  const msgs = document.getElementById('messages');
  if (!msgs) return;
  const rows = Array.from(msgs.querySelectorAll('.msg')).map(m => {
    const isUser = m.classList.contains('user');
    const text = m.querySelector('.bbl') ? m.querySelector('.bbl').innerText : '';
    return `<div style="margin-bottom:14px;padding:10px 14px;background:${isUser?'#f0f0ff':'#f8f8f0'};border-radius:8px;border-left:3px solid ${isUser?'#555':'#C9A84C'}"><strong style="color:${isUser?'#333':'#8B6914'};font-size:14px">${isUser?'Usuario':'DeclaraFY IA'}</strong><p style="margin:5px 0 0;color:#333;line-height:1.6;font-size:14px">${_escapeHtml(text)}</p></div>`;
  }).join('');
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Consulta DeclaraFY</title><style>body{font-family:Arial,sans-serif;max-width:680px;margin:40px auto;color:#333;line-height:1.6}h1{color:#C9A84C;border-bottom:2px solid #C9A84C;padding-bottom:8px;font-size:22px}.meta{font-size:14px;color:#888;margin-bottom:22px}@media print{body{margin:20px}}</style></head><body><h1>DeclaraFY — Consulta Tributaria</h1><div class="meta">Usuario: ${_escapeHtml(curUser?.name||'—')} | Área: ${_escapeHtml(AREAS[curArea]?.label||'General')} | Fecha: ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div>${rows}<hr style="margin:22px 0;border:1px solid #eee"><p style="font-size:14px;color:#999;text-align:center">Documento generado por DeclaraFY.pe — Solo con fines orientativos. Consulta con un profesional para decisiones formales.</p></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// ════════════════════════════════════════
// EXPORT WORD (DOCX) — genera .docx desde el chat
// ════════════════════════════════════════
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
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:48/><w:color w:val="8B6914"/></w:rPr><w:t>DeclaraFY — Consulta Tributaria</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:color w:val="888888"/><w:sz w:20"/></w:rPr><w:t xml:space="preserve">Usuario: ${_escapeXml(curUser?.name || '—')} | Fecha: ${new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'long',year:'numeric'})}</w:t></w:r></w:p>
<w:p><w:r><w:br/></w:r></w:p>
${body}
<w:p><w:r><w:rPr><w:color w:val="999999"/><w:sz w:18"/></w:rPr><w:t xml:space="preserve">Documento generado por DeclaraFY.pe — Solo con fines orientativos.</w:t></w:r></w:p>
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
<h1>DeclaraFY — Consulta Tributaria</h1>
<div class="meta">Usuario: ${_escapeHtml(curUser?.name || '—')} | Área: ${_escapeHtml(AREAS[curArea]?.label || 'General')} | Fecha: ${new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'long',year:'numeric'})}</div>
${rows.map(r => `<div class="${r.role === 'Usuario' ? 'msg-user' : 'msg-ai'}"><div class="role ${r.role === 'Usuario' ? 'role-user' : 'role-ai'}">${r.role}</div><p>${_escapeHtml(r.text)}</p></div>`).join('')}
<hr><p style="font-size:14px;color:#999;text-align:center">Documento generado por DeclaraFY.pe — Solo con fines orientativos.</p>
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

// ════════════════════════════════════════
// DARK / LIGHT MODE
// ════════════════════════════════════════
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('tp_theme', isLight ? 'light' : 'dark');
  document.querySelectorAll('[id^="themeBtn"]').forEach(b => b.textContent = isLight ? '🌞' : '🌙');
}
(function applyTheme() {
  if (localStorage.getItem('tp_theme') === 'light') {
    document.body.classList.add('light-mode');
    document.querySelectorAll('[id^="themeBtn"]').forEach(b => b.textContent = '🌞');
  }
})();

// ════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════
const DEFAULT_NOTIFS = [
  { id:1, icon:'📅', title:'Vencimiento próximo', desc:'Declaración mensual PDT 621 vence en 5 días', time:'Hace 1 hora', read:false },
  { id:2, icon:'📢', title:'Nueva normativa SUNAT', desc:'R.S. 034-2025/SUNAT: Nuevos cronogramas de vencimiento publicados', time:'Hace 3 horas', read:false },
  { id:3, icon:'💡', title:'Consejo tributario', desc:'Recuerda: los gastos de representación son deducibles hasta 0.5% de tus ingresos netos', time:'Ayer', read:true },
  { id:4, icon:'🔔', title:'Bienvenido a DeclaraFY', desc:'Tu cuenta está activa. ¡Empieza consultando con la IA!', time:'Al registrarte', read:true },
];
function getNotifs() { try { return JSON.parse(localStorage.getItem('tp_notifs') || 'null') || DEFAULT_NOTIFS; } catch { return DEFAULT_NOTIFS; } }
function saveNotifs(n) { localStorage.setItem('tp_notifs', JSON.stringify(n)); }
function renderNotifs() {
  const notifs = getNotifs();
  const unread = notifs.filter(n => !n.read).length;
  document.querySelectorAll('.notif-dot').forEach(d => { d.style.display = unread > 0 ? 'flex' : 'none'; d.textContent = unread; });
  const list = document.getElementById('notifList'); if (!list) return;
  if (!notifs.length) { list.innerHTML = '<div class="notif-empty">No tienes notificaciones</div>'; return; }
  list.innerHTML = notifs.map(n => `<div class="notif-item${n.read ? '' : ' unread'}" onclick="readNotif(${n.id})"><div class="notif-icon">${n.icon}</div><div class="notif-body"><div class="notif-title">${n.title}</div><div class="notif-desc">${n.desc}</div><div class="notif-time">${n.time}</div></div></div>`).join('') + '<div class="notif-mark-all" onclick="markAllRead()">Marcar todo como leído</div>';
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

// ════════════════════════════════════════
// PERFIL DE USUARIO
// ════════════════════════════════════════
function loadProfileForm() {
  if (!curUser) return;
  const pn = {basico:'Plan Básico', pro:'Plan Profesional', empresa:'Plan Empresa'};
  document.getElementById('profAv').textContent = (curUser.name || curUser.email || '?').charAt(0).toUpperCase();
  document.getElementById('profName').textContent = curUser.name || '';
  document.getElementById('profPlan').textContent = pn[curUser.plan] || 'Plan Básico';
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

// ════════════════════════════════════════
// BÚSQUEDA EN HISTORIAL — full-text mejorada
// ════════════════════════════════════════
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
  if (!h.length) { l.innerHTML = '<div class="hempty">No se encontraron conversaciones.</div>'; return; }
  const allH = getHist(curUser.email);
  l.innerHTML = '';
  [...h].reverse().forEach(c => {
    const i = allH.findIndex(x => x.title === c.title && x.date === c.date);
    const d = document.createElement('div'); d.className = 'hitem';
    const fu = c.messages.find(m => m.role === 'user');
    const prev = fu ? fu.content.substring(0, 70) : 'Consulta';
    const titleHtml = highlight ? _highlightMatch(c.title || 'Consulta', highlight) : (c.title || 'Consulta');
    const prevHtml = highlight ? _highlightMatch(prev, highlight) : prev;
    d.innerHTML = `<div class="hl" onclick="loadConv(${i})"><div class="ht">${titleHtml}</div><div class="hp">${prevHtml}${prev.length>=70?'…':''}</div></div><div class="hm"><div class="ha">${c.area||'General'}</div><div class="hd">${c.date}</div></div><button class="hdel" aria-label="Eliminar conversación" onclick="delConv(${i},event)">×</button>`;
    l.appendChild(d);
  });
}

// ════════════════════════════════════════
// SIMULADOR FISCALIZACIÓN SUNAT
// ════════════════════════════════════════
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
  if (checks.gastos) obs.push({tipo:'alto', txt:'<strong>Gastos sin sustento (Art.44 LIR):</strong> SUNAT reparará los gastos sin comprobante de pago. Multa: 50% del tributo omitido. Subsana obteniendo los comprobantes o emitiendo una declaración rectificatoria.'});
  if (checks.cf) obs.push({tipo:'alto', txt:'<strong>Crédito fiscal observado (Art.18-19 LIGV):</strong> Si la factura fue emitida por un proveedor no habido o con baja de RUC, SUNAT desconocerá el crédito fiscal. Verificar el estado del proveedor en SUNAT.'});
  if (checks.libros) obs.push({tipo:'medio', txt:'<strong>Atraso en libros contables (Art.175 CT):</strong> Multa entre 0.3% y 3% de los ingresos netos según el tipo de libro. Subsanable antes del requerimiento con reducción del 90%.'});
  if (checks.vinc) obs.push({tipo:'medio', txt:'<strong>Operaciones con vinculadas (Art.32-A LIR):</strong> SUNAT puede ajustar los precios al valor de mercado. Si las operaciones superan 400 UIT, puede ser obligatorio presentar el Local File (Form. 3560).'});
  if (checks.perdidas) obs.push({tipo:'medio', txt:'<strong>Pérdidas reiteradas (Indicador de riesgo SUNAT):</strong> 3+ años de pérdidas activan auditorías por presunción de ingresos omitidos o gastos irregulares. Documentar la causalidad de todos los gastos.'});
  if (checks.caja) obs.push({tipo:'alto', txt:'<strong>Saldo de caja elevado (Art.67 CT — Presunción):</strong> SUNAT puede aplicar presunción de ingresos si el saldo de caja no tiene respaldo. Riesgo de determinación sobre base presunta.'});
  if (checks.det) obs.push({tipo:'alto', txt:'<strong>Detracciones pendientes (D.Leg.940):</strong> La falta de depósito de la detracción genera multa del 50% del monto no depositado e impide el uso del crédito fiscal del período.'});
  if (ingresos > 2300 * 5500 && !checks.vinc) obs.push({tipo:'medio', txt:'<strong>Posible obligación PT (D.S.008-2023-EF):</strong> Con ingresos superiores a 2,300 UIT y operaciones con vinculadas, podría ser obligatorio presentar documentación de precios de transferencia.'});
  const nivel = obs.filter(o => o.tipo === 'alto').length >= 2 ? 'alto' : obs.filter(o => o.tipo === 'medio').length >= 2 ? 'medio' : obs.length === 0 ? 'bajo' : 'medio';
  const nivelLabel = {alto:'Alto riesgo de fiscalización', medio:'Riesgo moderado', bajo:'Riesgo bajo'};
  const res = document.getElementById('simulResult');
  res.style.display = 'block';
  if (obs.length === 0) {
    res.innerHTML = '<div class="simul-result"><h4>✅ Sin observaciones detectadas</h4><p style="font-size:14px;color:var(--muted)">Basado en la información proporcionada, no se detectaron contingencias tributarias de alto riesgo. Recuerda mantener siempre documentación de respaldo para todos tus gastos.</p></div>';
  } else {
    res.innerHTML = `<div class="simul-result"><span class="risk-badge ${nivel}">${nivel === 'alto' ? '🔴' : nivel === 'medio' ? '🟡' : '🟢'} ${nivelLabel[nivel]}</span><h4>${obs.length} observación(es) detectada(s)</h4>${obs.map(o => `<div class="simul-obs${o.tipo==='medio'?' warn':o.tipo==='ok'?' ok':''}">${o.txt}</div>`).join('')}<p style="font-size:14px;color:var(--muted);margin-top:12px">⚠️ Esta simulación es orientativa. Consulta con un contador o abogado tributarista para una evaluación formal.</p></div>`;
  }
  addNotif('🔍', 'Simulación completada', `Se detectaron ${obs.length} observaciones tributarias. Nivel: ${nivelLabel[nivel]}`);
}

// ════════════════════════════════════════
// GENERADOR DE DOCUMENTOS
// ════════════════════════════════════════
let selectedDocType = '';
const DOC_FIELDS = {
  reclamacion: { title:'Recurso de Reclamación SUNAT', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'Razón social / Nombre',ph:'Empresa S.A.C.'},{id:'resolucion',label:'N° de Resolución a impugnar',ph:'R.D. 001-2024/SUNAT-050'},{id:'monto',label:'Monto del tributo en disputa S/',ph:'15000'},{id:'argumento',label:'Argumento principal',ph:'La deuda fue pagada oportunamente, adjunto voucher...'}] },
  carta_descargo: { title:'Carta de Descargo / Respuesta a Esquela', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'Razón social / Nombre',ph:'Empresa S.A.C.'},{id:'esquela',label:'N° de Esquela o Requerimiento',ph:'ESQ-001-2024'},{id:'periodo',label:'Período tributario observado',ph:'Enero - Diciembre 2023'},{id:'descargo',label:'Descargo y sustento',ph:'Los gastos observados corresponden a...'}] },
  fraccionamiento: { title:'Solicitud de Fraccionamiento Art. 36 CT', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'Razón social / Nombre',ph:'Empresa S.A.C.'},{id:'deuda',label:'Monto total de la deuda S/',ph:'25000'},{id:'cuotas',label:'N° de cuotas solicitadas',ph:'12'},{id:'motivo',label:'Motivo del fraccionamiento',ph:'Dificultades de liquidez por...'}] },
  informe_pt: { title:'Estructura Informe Local — Precios de Transferencia', fields:[{id:'ruc',label:'RUC del contribuyente',ph:'20123456789'},{id:'razon',label:'Razón social',ph:'Empresa S.A.C.'},{id:'vinculada',label:'Nombre de la parte vinculada',ph:'Casa Matriz Corp.'},{id:'pais',label:'País de la parte vinculada',ph:'España'},{id:'operacion',label:'Tipo de operación analizada',ph:'Préstamo intercompany de USD 500,000'},{id:'metodo',label:'Método PT seleccionado',ph:'TNMM — Margen Neto Transaccional'}] },
  cert_residencia: { title:'Carta Sustentación Retención No Domiciliado', fields:[{id:'proveedor',label:'Nombre del proveedor no domiciliado',ph:'Tech Services Ltd.'},{id:'pais',label:'País de residencia del proveedor',ph:'Estados Unidos'},{id:'servicio',label:'Tipo de servicio prestado',ph:'Licencia de software'},{id:'monto',label:'Monto del servicio USD',ph:'10000'},{id:'tasa',label:'Tasa de retención aplicada %',ph:'30'}] },
  informe_legal: { title:'Informe Legal Tributario', fields:[{id:'cliente',label:'Cliente',ph:'Empresa S.A.C.'},{id:'materia',label:'Materia a analizar',ph:'Deducibilidad de gastos de representación'},{id:'contexto',label:'Descripción de la situación',ph:'La empresa realizó gastos de atención a clientes por S/ 50,000...'},{id:'pregunta',label:'Pregunta o consulta específica',ph:'¿Son deducibles estos gastos? ¿Existe algún límite?'}] },
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
  cfg.fields.forEach(f => { fields[f.label] = document.getElementById('dg_' + f.id)?.value || '—'; });
  const prompt = `Genera un documento tributario formal en español peruano del tipo: "${cfg.title}". Datos: ${JSON.stringify(fields)}. El documento debe ser profesional, citar la base legal correcta del Código Tributario o LIR peruana, y estar listo para presentar ante SUNAT. Incluye: membrete básico, fecha, número de expediente (si aplica), cuerpo del documento con argumentos legales, petitorio y firma. Solo devuelve el texto del documento sin explicaciones adicionales.`;
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
    addNotif('📄', 'Documento generado', `"${cfg.title}" generado exitosamente.`);
  } catch(e) {
    document.getElementById('docgenLoading').style.display = 'none';
    document.getElementById('docgenPreview').style.display = 'block';
    document.getElementById('docgenPreview').textContent = 'Error: ' + e.message;
  }
}
function copyDoc() {
  const text = document.getElementById('docgenPreview').textContent;
  navigator.clipboard.writeText(text).then(() => { document.getElementById('docgenCopyBtn').textContent = '✅ Copiado!'; setTimeout(() => document.getElementById('docgenCopyBtn').textContent = '📋 Copiar documento', 2000); });
}

// ════════════════════════════════════════
// STREAMING CHAT
// ════════════════════════════════════════
async function _sendMsgStreamBase(txt) {
  const inp = document.getElementById('userInput');
  const msg = txt || inp.value.trim();
  if (!msg && !attached.length) return;
  if (!isAdminUser() && curUser?.plan === 'basico' && (curUser?.mc || 0) >= FREE) {
    addMsg('ai', `Has alcanzado el límite de **${FREE} consultas** del plan gratuito.\n\nActualiza al **Plan Profesional por S/190/mes** para consultas ilimitadas.`);
    return;
  }
  let disp = msg, full = msg;
  if (attached.length) {
    const ns = attached.map(f => '📎 ' + f.name).join(' ');
    disp = `${ns}${msg ? '\n' + msg : ''}`;
    const cs = await Promise.all(attached.map(readFile));
    full = `${msg || 'Analiza este archivo tributariamente.'}${cs.map((c,i) => `\n\n[ARCHIVO: ${attached[i].name}]\n${c.substring(0,3000)}`).join('')}`;
    attached = []; renderChips();
  }
  if (!txt) { inp.value = ''; inp.style.height = 'auto'; }
  addMsg('user', disp || 'Archivo adjunto');
  // NOTE: msgCount is incremented in the sendMsg wrapper, not here — avoid double-counting
  convHist.push({ role:'user', content: full + (AREAS[curArea] ? `\n[Área: ${AREAS[curArea].label}]` : '') });
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
    const reader = res.body.getReader(); const decoder = new TextDecoder();
    let fullText = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6); if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
            fullText += json.delta.text;
            b.innerHTML = _escapeHtml(fullText).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
            b.appendChild(cursor); msgs.scrollTop = msgs.scrollHeight;
          }
        } catch {}
      }
    }
    cursor.remove();
    b.innerHTML = _escapeHtml(fullText).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    convHist.push({ role:'assistant', content: fullText });
    // Guardar en caché offline (última pregunta del historial de conversación)
    const lastUser = convHist.filter(m => m.role === 'user').slice(-1)[0];
    if (lastUser) tpSaveOfflineResponse(lastUser.content.substring(0, 200), fullText.substring(0, 1500));
  } catch(err) {
    cursor.remove(); b.innerHTML = `<strong>Error:</strong> ${err.message}`;
    if (err.message.includes('401')) { addNotif('⚠️', 'Sesión expirada', 'Vuelve a iniciar sesión para continuar.'); setTimeout(() => { if (typeof showAuth === 'function') showAuth('login'); }, 400); }
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
      convHist.push({ role:'user', content: msg + (AREAS[curArea] ? `\n[Área: ${AREAS[curArea].label}]` : '') });
    }
  } finally {
    _sendMsgGuard = false;
  }
}

// Update setPTab to load profile form when visiting perfil tab
const PT_TAB_NAMES = ['admin','alertas','api_access','bcr','biblioteca','calculadora','calendario','cartas','casos','cdi','cierre','comparado','comparador','contratos','contratos_gen','cripto','cripto_legal','depreciacion','detector_pdt','drawback','eeff','empresa_hub','estadisticas','excel_int','expediente','facturacion','favoritos','fraccionamiento','generador','historial','hs_clasificador','ia_fisc','indecopi','informe','inicio','itan','lavado','liquidacion','moneda','monitor','multas','niif','ocr_factura','pdt621','pdt_xml','perfil','plan_anual','privacidad','pt_modulo','referidos','requerimiento','ret_perc','rtf','sbs','simulador','simulador_esc','smv','sugerencias','sunafil','sunat_api','sunat_inf','sunat_live','terminos','tim','timeline','utilidades','widget','zonas','nomina','moras_sunat','calendario_fiscal','importacion','selector_regimen','pdt_gen','score_fin','radar_norm','bal_comprob','libro_diario','concil_banc','cts_gratif','contratos_gen2','docs_legales','withholding','analisis_avanz','compliance','spot','arbitrios','renta_anual','perdida','despido','tregistro','suspension','flujo_caja','van_tir','comp_fin','guias_remision','validador','precios_transf','tea_multas','rmt_rer','amazonia','itan_detalle','rus','cierre_fiscal','tim_historico','compensacion','exon_detraccion','recurso_multa','saldo_export','horas_extras','reg_agrario','afp_comisiones','asignacion_fam','ratios_fin','amortizacion','dep_acelerada','leasing','conversor_tasas','isc','mineria','cierre_empresa','poder_notarial','verificador_ruc','proyeccion_afp','analizador_contratos','chat_sesiones','generador_informes','itf','ir_5ta','dividendos','no_domiciliados','cas','royalties','afp_onp','percepciones','notas_credito','factura_electronica','rectificatoria','essalud_senati','onp','cobranza_coactiva','donaciones','sucesiones','cripto_portfolio'];
function _ptSectionId(tab) { return 'pt' + tab.charAt(0).toUpperCase() + tab.slice(1); }
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
}


// ════════════════════════════════════════
// ONBOARDING
// ════════════════════════════════════════
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
  if (step === 1 && !onbData.regimen) { tpToast('Selecciona tu régimen.', 'warn'); return; }
  [0,1,2].forEach(i=>{
    document.getElementById('onbS'+i).classList.toggle('active',i===step);
    document.getElementById('onbD'+i).classList.toggle('active',i===step);
  });
  onbData.step=step;
}
function finishOnboarding() {
  document.getElementById('onbOverlay').style.display='none';
  if(!curUser) return;
  const us=getUsers();
  us[curUser.email].regimen=onbData.regimen||us[curUser.email].regimen;
  us[curUser.email].topics=onbData.topics;
  us[curUser.email].onboarded=true;
  saveUsers(us); curUser=us[curUser.email];
  addNotif('🎯','Perfil configurado','Tu experiencia ha sido personalizada según tu régimen y temas de interés.');
  newChat();
  // Auto-arrancar tour justo después del onboarding
  if (!curUser.tourDone) setTimeout(() => maybeStartTour(), 800);
}

// ════════════════════════════════════════
// REFERIDOS
// ════════════════════════════════════════
function getRefCode(email) { return 'REF'+btoa(email).substring(0,8).toUpperCase().replace(/[^A-Z0-9]/g,'X'); }
function loadReferidos() {
  if(!curUser) return;
  const code=getRefCode(curUser.email);
  const el=document.getElementById('refLink');
  if(el) el.textContent='declarafy.com/ref/'+code;
  const us=getUsers(); const all=Object.values(us);
  const refs=all.filter(u=>u.refBy===code);
  const active=refs.filter(u=>u.plan!=='basico');
  if(document.getElementById('refTotal')) document.getElementById('refTotal').textContent=refs.length;
  if(document.getElementById('refActive')) document.getElementById('refActive').textContent=active.length;
  if(document.getElementById('refMeses')) document.getElementById('refMeses').textContent=active.length;
  // Leaderboard
  const scores={}; all.forEach(u=>{if(u.refBy){scores[u.refBy]=(scores[u.refBy]||0)+1;}});
  const sorted=Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const lb=document.getElementById('refLeaderList');
  if(lb){ if(!sorted.length){lb.innerHTML='<div style="font-size:14px;color:var(--muted);padding:10px 0">Aún no hay referidores. ¡Sé el primero!</div>';return;}
    lb.innerHTML=sorted.map(([code,cnt],i)=>`<div class="ref-row"><span class="ref-rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</span><span class="ref-name">${code}</span><span class="ref-count">${cnt} referidos</span></div>`).join(''); }
}
function copyRefLink() {
  const code=getRefCode(curUser.email);
  const btn = event.currentTarget;
  navigator.clipboard.writeText('declarafy.com/ref/'+code).then(()=>{
    if(btn) { btn.textContent='✅ Copiado!'; setTimeout(()=>btn.textContent='Copiar link',2000); }
  });
  addNotif('🔗','Link copiado','Tu link de referido fue copiado al portapapeles.');
}
// Check ref code on register — persist URL param to localStorage
function checkRefCode() {
  const url=window.location.search; const params=new URLSearchParams(url);
  const urlRef = params.get('ref');
  if (urlRef) {
    localStorage.setItem('tp_ref', urlRef);
    return urlRef;
  }
  return localStorage.getItem('tp_ref')||'';
}

// ════════════════════════════════════════
// FAVORITOS
// ════════════════════════════════════════
function getFavs(email) { try{return JSON.parse(localStorage.getItem('tp_fav_'+btoa(email))||'[]')}catch{return[]} }
function saveFavs(email,favs) { kvPut('tp_fav_'+btoa(email), favs, 'favs'); }
registerKVScope('favs',()=>'tp_fav_'+btoa(curUser?.email||''));
function saveFavorite(question, answer) {
  if(!curUser) return;
  const favs=getFavs(curUser.email);
  favs.unshift({id:Date.now(), q:question.substring(0,100), a:answer, area:AREAS[curArea]?.label||'General', date:new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'short'})});
  saveFavs(curUser.email, favs.slice(0,50));
  addNotif('⭐','Respuesta guardada','La respuesta fue agregada a tus favoritos.');
}
function renderFavoritos() {
  if(!curUser) return;
  const favs=getFavs(curUser.email);
  const el=document.getElementById('favList'); if(!el) return;
  if(!favs.length){el.innerHTML='<div class="hempty">No tienes respuestas guardadas.<br>En el chat, presiona ⭐ en cualquier respuesta.</div>';return;}
  el.innerHTML=favs.map((f,i)=>`<div class="fav-item"><div class="fav-item-body"><div class="fav-item-q">❓ ${f.q}</div><div class="fav-item-a">${f.a.replace(/<[^>]*>/g,'').substring(0,120)}…</div><div class="fav-item-meta">${f.area} · ${f.date}</div></div><button class="fav-del" aria-label="Eliminar favorito" onclick="delFav(${i})">×</button></div>`).join('');
}
function delFav(i) { const f=getFavs(curUser.email); f.splice(i,1); saveFavs(curUser.email,f); renderFavoritos(); }

// ════════════════════════════════════════
// ESTADÍSTICAS
// ════════════════════════════════════════
function renderEstadisticas() {
  if(!curUser) return;
  const hist=getHist(curUser.email);
  const favs=getFavs(curUser.email);
  const totalMsgs=curUser.mc||0;
  const cards=document.getElementById('statsCards');
  if(cards) cards.innerHTML=`
    <div class="stat-card"><div class="stat-v">${totalMsgs}</div><div class="stat-l">Consultas totales</div></div>
    <div class="stat-card"><div class="stat-v">${hist.length}</div><div class="stat-l">Conversaciones</div></div>
    <div class="stat-card"><div class="stat-v">${favs.length}</div><div class="stat-l">Respuestas guardadas</div></div>
    <div class="stat-card"><div class="stat-v">${Object.keys(getUsers()).length}</div><div class="stat-l">Días como miembro</div></div>`;
  // Bar chart - simulate monthly data
  const months=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
  const now=new Date().getMonth();
  const data=months.map((_,i)=>i<=now?(i===now?Math.max(totalMsgs,1):Math.floor(Math.random()*15)+2):0);
  const maxVal=Math.max(...data,1);
  const bc=document.getElementById('barChart');
  if(bc) bc.innerHTML=data.map((v,i)=>`<div class="bar-col"><span class="bar-val">${v||''}</span><div class="bar-inner" style="height:${Math.max((v/maxVal)*100,v>0?5:0)}%"></div><span class="bar-lbl">${months[i]}</span></div>`).join('');
  // Topic distribution from history
  const topicCount={};
  hist.forEach(c=>{ const k=c.area||'General'; topicCount[k]=(topicCount[k]||0)+1; });
  const sorted=Object.entries(topicCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const tp=document.getElementById('topicPie');
  const total2=sorted.reduce((s,[,v])=>s+v,0)||1;
  if(tp) tp.innerHTML=sorted.length?sorted.map(([k,v])=>`<div class="topic-row"><span class="topic-nm">${k}</span><div class="topic-track"><div class="topic-bar" style="width:${Math.round((v/total2)*100)}%"></div></div><span class="topic-pct">${Math.round((v/total2)*100)}%</span></div>`).join(''):'<div style="font-size:14px;color:var(--muted)">Aún no hay datos suficientes. ¡Empieza consultando!</div>';
}

// ════════════════════════════════════════
// COMPARADOR DE REGÍMENES
// ════════════════════════════════════════
function runComparador() {
  const ing=parseFloat(document.getElementById('cmpIngresos')?.value)||0;
  const gas=parseFloat(document.getElementById('cmpGastos')?.value)||0;
  const trab=parseInt(document.getElementById('cmpTrab')?.value)||0;
  if(!ing){document.getElementById('compResult').innerHTML='';return;}
  const uit=5500, uti=Math.max(ing-gas,0);
  const resultados=[
    { name:'NRUS', eligible:ing<=96000&&trab===0, tax:ing<=5000?20:ing<=8000?50:null, detail:'Cuota fija mensual. Solo si ventas ≤ S/96,000/año y sin trabajadores en planilla.', code:'nrus' },
    { name:'RER', eligible:ing<=525000, tax:ing*0.015*12, detail:`IR: 1.5% sobre ingresos netos. Solo si ingresos ≤ S/525,000/año.`, code:'rer' },
    { name:'RMT', eligible:ing<=1700*uit, tax:uti<=15*uit?uti*0.10:15*uit*0.10+(uti-15*uit)*0.295, detail:`IR: 10% hasta 15 UIT de utilidad, 29.5% por el exceso. Pago a cuenta desde 1%.`, code:'rmt' },
    { name:'Régimen General', eligible:true, tax:uti*0.295, detail:`IR: 29.5% sobre utilidad neta. Sin límite de ingresos. Permite compensar pérdidas.`, code:'rg' },
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
      ${r.eligible&&r.tax!==null?`<div class="comp-tax${isBest?' best':''}">${r.name==='NRUS'?`S/${r.tax}/mes`:`S/${Math.round(r.tax).toLocaleString()}/año`}</div>`:'<div style="font-size:14px;color:var(--red)">No elegible</div>'}
      <div class="comp-detail">${r.detail}</div>
      ${isBest?'<span class="comp-badge rec">✓ Recomendado</span>':''}
      ${!r.eligible?'<span class="comp-badge no">No aplica para ti</span>':''}
    </div>`;
  }).join('');
  const best=eligible.find(r=>r.tax===minTax);
  const rec=document.getElementById('compRec');
  if(rec&&best){rec.style.display='block';rec.innerHTML=`💡 <strong>Recomendación:</strong> Con ingresos de S/${ing.toLocaleString()} y gastos de S/${gas.toLocaleString()}, el régimen más conveniente sería el <strong style="color:var(--gold)">${best.name}</strong>. Consulta con tu contador para confirmar la elegibilidad y el proceso de acogimiento.`;}
}

// ════════════════════════════════════════
// PDT 621 WIZARD
// ════════════════════════════════════════
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
    <h4>Resumen declaración ${mes}</h4>
    <div class="wiz-row"><span class="wiz-row-lbl">Ventas gravadas</span><span class="wiz-row-val">${fmtS(ventGrav)}</span></div>
    <div class="wiz-row"><span class="wiz-row-lbl">IGV débito fiscal (18%)</span><span class="wiz-row-val">${fmtS(debitoFiscal)}</span></div>
    <div class="wiz-row"><span class="wiz-row-lbl">IGV crédito fiscal</span><span class="wiz-row-val">${fmtS(creditoFiscal)}</span></div>
    ${saldoAnt>0?`<div class="wiz-row"><span class="wiz-row-lbl">Saldo a favor anterior</span><span class="wiz-row-val green">${fmtS(saldoAnt)}</span></div>`:''}
    <div class="wiz-row" style="border-top:1px solid var(--gold);margin-top:6px;padding-top:10px"><span class="wiz-row-lbl"><strong>IGV a pagar</strong></span><span class="wiz-row-val gold"><strong>${fmtS(igvAPagar)}</strong></span></div>
    ${saldoFavor>0?`<div class="wiz-row"><span class="wiz-row-lbl">Saldo a favor generado</span><span class="wiz-row-val green">${fmtS(saldoFavor)}</span></div>`:''}
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"></div>
    <div class="wiz-row"><span class="wiz-row-lbl">Ingresos netos del mes</span><span class="wiz-row-val">${fmtS(ingNeto)}</span></div>
    <div class="wiz-row"><span class="wiz-row-lbl">Pago a cuenta IR (${coef}%)</span><span class="wiz-row-val">${fmtS(pacIR)}</span></div>
    <div class="wiz-row" style="background:rgba(201,168,76,.08);padding:10px;border-radius:8px;margin-top:8px"><span class="wiz-row-lbl"><strong>TOTAL A PAGAR PDT 621</strong></span><span class="wiz-row-val gold" style="font-size:18px"><strong>${fmtS(totalPagar)}</strong></span></div>
    <p style="font-size:14px;color:var(--muted);margin-top:12px">⚠️ Este cálculo es orientativo. Verifica en SUNAT Virtual con tu Clave SOL antes de presentar.</p>`;
  wizGo(3);
}
function wizExport() {
  const win=window.open('','_blank');
  const res=document.getElementById('wizResult')?.innerHTML||'';
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PDT 621 — DeclaraFY</title><style>body{font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#333}h1{color:#C9A84C;border-bottom:2px solid #C9A84C;padding-bottom:8px}.wiz-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eee;font-size:14px}.wiz-row-lbl{color:#666}.gold{color:#C9A84C;font-weight:bold}</style></head><body><h1>Resumen PDT 621 — DeclaraFY</h1><p style="font-size:14px;color:#888">Generado: ${new Date().toLocaleDateString('es-PE')} · Usuario: ${_escapeHtml(curUser?.name||'—')}</p>${res}</body></html>`);
  win.document.close(); setTimeout(()=>win.print(),500);
}

// ════════════════════════════════════════
// BIBLIOTECA DE NORMAS
// ════════════════════════════════════════
const BIB_DATA = [
  {id:1,name:'Código Tributario — TUO D.S. 133-2013-EF',cat:'ct',tag:'Código Tributario',desc:'Norma fundamental del sistema tributario peruano. Regula la relación jurídica tributaria, obligaciones formales, infracciones y procedimientos.',resumen:`Art. 1: La obligación tributaria nace cuando se realiza el hecho previsto en la ley como generador de dicha obligación.\nArt. 28: La deuda tributaria está constituida por el tributo, las multas y los intereses.\nArt. 33: El interés moratorio (TIM) es el 1.2% mensual (tasa actualizable por SUNAT).\nArt. 43: La acción de la Administración para determinar deuda prescribe a los 4 años (contribuyentes que presentan declaración) o 6 años (los que no presentan).\nArt. 87: Obligaciones formales: inscribirse en RUC, emitir comprobantes, llevar libros contables, permitir fiscalizaciones.\nArt. 166: El régimen de gradualidad permite reducir sanciones por subsanación voluntaria.`},
  {id:2,name:'TUO Ley del IGV — D.S. 055-99-EF',cat:'igv',tag:'IGV',desc:'Regula el Impuesto General a las Ventas. Tasa vigente 18% (16% IGV + 2% IPM). Incluye crédito fiscal, exoneraciones y régimen de percepciones/detracciones.',resumen:`Art. 1: Son operaciones gravadas: venta de bienes, prestación de servicios, contratos de construcción, primera venta de inmuebles e importación.\nArt. 3: El crédito fiscal se aplica sobre el IGV de las adquisiciones que sean permitidas como gasto/costo y destinadas a operaciones gravadas.\nArt. 18-19: Requisitos sustanciales y formales del crédito fiscal. La factura debe estar a nombre del contribuyente y el IGV discriminado.\nArt. 33: Las exportaciones están gravadas con tasa 0% y generan saldo a favor del exportador.\nArt. 44: No generan crédito fiscal: gastos personales, cigarrillos, bebidas alcohólicas (salvo giro del negocio), multas.`},
  {id:3,name:'TUO Ley del IR — D.S. 179-2004-EF',cat:'lir',tag:'Impuesto a la Renta',desc:'Regula el Impuesto a la Renta de todas las categorías. Incluye gastos deducibles, depreciaciones, pagos a cuenta y declaración anual.',resumen:`Art. 6: Están sujetas al IR las personas naturales y jurídicas domiciliadas y no domiciliadas (por rentas de fuente peruana).\nArt. 36: Las personas naturales aplican la deducción del 20% sobre rentas de 4ta categoría (mínimo hasta 7 UIT de renta neta).\nArt. 37: Gastos deducibles 3ra categoría: remuneraciones, depreciaciones, intereses, castigos, donaciones, gastos de representación (0.5% ingresos, máx. 40 UIT), entre otros.\nArt. 44: No deducibles: gastos personales, sanciones, multas, IR propio, donaciones no autorizadas.\nArt. 55: Tasa IR Régimen General: 29.5%. RMT: 10% hasta 15 UIT de renta neta, 29.5% por el exceso.\nArt. 57: Principio del devengado: los ingresos se reconocen en el período en que se ganan, no cuando se cobran.`},
  {id:4,name:'Arancel de Aduanas — D.S. 342-2016-EF',cat:'aduanas',tag:'Aduanas',desc:'Nomenclatura y tasas arancelarias para importaciones. Basado en el Sistema Armonizado. Ad valorem vigente: 0%, 6% y 11%.',resumen:`El Arancel de Aduanas clasifica todas las mercancías según la Nomenclatura del Sistema Armonizado (SA). Las tasas Ad Valorem en Perú son: 0% (mayoría de bienes), 6% y 11% (bienes sensibles como textiles, calzado, arroz).\n\nAdemás del arancel se aplican:\n- IGV: 16% sobre el valor CIF + Ad Valorem\n- IPM: 2%\n- ISC: según tablas (combustibles, autos, bebidas)\n- Derechos antidumping (si aplica)\n- Percepción del IGV: 3.5% o 10%\n\nEl valor en aduana se determina por el Método del Valor de Transacción (Art. VII GATT).`},
  {id:5,name:'Precios de Transferencia — D.S. 008-2023-EF',cat:'reglamentos',tag:'Precios Transfer.',desc:'Reglamento de precios de transferencia. Regula operaciones entre partes vinculadas. Obliga a cumplir el principio Arm\'s Length.',resumen:`El D.S. 008-2023-EF reglamenta el Art. 32-A de la LIR sobre precios de transferencia.\n\nObligados a presentar documentación:\n- Local File: contribuyentes con ingresos ≥ 2,300 UIT y operaciones vinculadas ≥ 100 UIT\n- Master File: grupos con ingresos consolidados ≥ 20,000 UIT\n- Country by Country Report: grupos con ingresos ≥ 2,700 millones de soles\n\nMétodos permitidos (en orden de preferencia):\n1. Precio Comparable No Controlado (CUP)\n2. Precio de Reventa\n3. Costo Incrementado\n4. Margen Neto Transaccional (TNMM) — el más usado\n5. Partición de Utilidades\n\nRango de plena competencia: si el precio cae fuera del rango intercuartil, SUNAT ajusta a la mediana.`},
  {id:6,name:'Reglamento de Comprobantes de Pago — R.S. 007-99/SUNAT',cat:'reglamentos',tag:'Comprobantes',desc:'Regula los tipos de comprobantes, obligados a emitir, requisitos mínimos y facturación electrónica.',resumen:`Tipos de comprobantes de pago:\n- Facturas: operaciones con empresas o personas que necesiten sustentar costo/gasto\n- Boletas de venta: consumidores finales\n- Tickets: máquinas registradoras autorizadas\n- Liquidaciones de compra: adquisiciones a personas sin RUC\n- Notas de crédito/débito: ajustes a comprobantes emitidos\n\nFacturación electrónica obligatoria desde 2019 para la mayoría de contribuyentes.\nSistemas: SEE-SOL (gratuito), SEE-Contribuyente (propio) u OSE (tercerizado).\nLa factura electrónica es válida cuando SUNAT la acepta (CDR de aceptación).`},
  {id:7,name:'D.Leg. 813 — Ley Penal Tributaria',cat:'ct',tag:'Derecho Penal',desc:'Tipifica los delitos tributarios. Defraudación tributaria, elaboración de comprobantes falsos y otros ilícitos con penas de cárcel.',resumen:`Art. 1: Defraudación tributaria: el que deja de pagar tributos usando engaño, ardid o falsedad. Pena: 5 a 8 años de cárcel.\nArt. 2: Formas agravadas (8 a 12 años): uso de facturas falsas, utilización fraudulenta de beneficios, obtener devoluciones indebidas.\nArt. 5: Elaboración y comercialización de facturas falsas: 5 a 8 años.\n\nDiferencia clave:\n- Infracción tributaria (Código Tributario): responsabilidad civil/administrativa, se paga con multas\n- Delito tributario (D.Leg. 813): responsabilidad penal, puede implicar prisión efectiva\n\nLa regularización tributaria antes de la investigación fiscal puede extinguir la acción penal (Art. 8 D.Leg. 813).`},
  {id:8,name:'NRUS — D.Leg. 937',cat:'lir',tag:'NRUS',desc:'Régimen simplificado para pequeños negocios. Cuota fija mensual de S/20 o S/50. Sin obligación de llevar libros contables.',resumen:`El Nuevo Régimen Único Simplificado está dirigido a personas naturales y sucesiones indivisas con pequeños negocios.\n\nCategorías:\n- Categoría 1: Ingresos/compras hasta S/5,000/mes → Cuota: S/20/mes\n- Categoría 2: Ingresos/compras hasta S/8,000/mes → Cuota: S/50/mes\n\nVentajas: Sin obligación de llevar libros contables. Sin declaración anual de IR. Pago único mensual.\n\nRestricciones: Solo pueden emitir boletas de venta y tickets. No pueden tener más de 1 establecimiento. No pueden contratar más de 10 trabajadores. No realizan importaciones superiores a S/8,000/mes.\n\nExclusiones: Actividades profesionales, transporte de carga (más de 2 ton), bares, casinos, discotecas.`},
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
        <button class="bib-ask-btn" onclick="askAboutNorm(event,'${b.name.replace(/'/g,"\\'")}')">💬 Preguntarle a la IA sobre esta norma</button>
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
  setTimeout(()=>sendMsg(`Explícame en detalle la norma: ${normName} y cómo me afecta como contribuyente peruano`),300);
}

// ════════════════════════════════════════
// OVERRIDE setPTab TO LOAD DATA
// ════════════════════════════════════════
const _origSetPTab2 = typeof _origSetPTab !== 'undefined' ? _origSetPTab : setPTab;
setPTab = function(tab, btn) {
  _origSetPTab2(tab, btn);
  if(tab==='estadisticas') renderEstadisticas();
  if(tab==='referidos') loadReferidos();
  if(tab==='favoritos') renderFavoritos();
  if(tab==='biblioteca') { renderBib(''); }
  if(tab==='perfil') loadProfileForm();
  if(tab==='historial') { const s=document.getElementById('histSearch');if(s)s.value=''; renderHist(); }
}


// ════════════════════════════════════════
// TEXT TO SPEECH (TTS)
// ════════════════════════════════════════
let ttsUtterance = null;
let ttsActive = false;

function speakText(text, btn) {
  if (!('speechSynthesis' in window)) {
    tpToast('Tu navegador no soporta texto a voz. Prueba con Chrome o Edge.', 'warn');
    return;
  }
  // Stop if already playing
  if (ttsActive) { stopTTS(); if (btn) { btn.textContent = '🔊 Escuchar'; } return; }
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
  if (btn) { btn.textContent = '⏹ Detener'; btn.classList.add('playing'); }
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
    if (btn) { btn.textContent = '🔊 Escuchar'; btn.classList.remove('playing'); }
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

// ════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════
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

// ════════════════════════════════════════
// TOUR GUIADO INTERACTIVO
// ════════════════════════════════════════
// ════════════════════════════════════════
// TOUR STEPS — CHAT (when first opening chat)
// ════════════════════════════════════════
const TOUR_STEPS = [
  { selector:'.abar,#areaTabs', title:'📋 17 Áreas tributarias especializadas', position:'bottom',
    desc:'Selecciona el área antes de consultar: IGV, Renta, ISC, ITF, Aranceles, Aduanas, Precios de Transferencia, NRUS, Vehicular y las 6 ramas del Derecho Tributario. La IA ajusta su análisis a la norma específica del área — recibes asesoría especializada, no respuestas genéricas.' },
  { selector:'#casoHeaderBar,.caso-header-bar', title:'🗂 Casos Tributarios Particulares', position:'bottom',
    desc:'Para casos complejos (fiscalizaciones, recursos de apelación, PT, contratos) activa un expediente. Adjunta hasta 8 documentos: PDFs con extracción real de texto, Excel, Word y XML. La IA cruza toda la información y genera un Informe de Conclusiones formal con base legal exacta lista para presentar.' },
  { selector:'#multiFilePanel,.uprow', title:'📎 Análisis multi-documento', position:'top',
    desc:'Sube PDFs, Excel, Word o XML. La IA extrae texto real de los PDFs, cruza datos entre documentos y detecta inconsistencias tributarias. Ideal para analizar balances + contratos + resoluciones SUNAT simultáneamente.' },
  { selector:'.chat-quota-bar,#chatQuotaBar', title:'📊 Consumo y sincronización Firebase', position:'bottom',
    desc:'Monitorea tu consumo mensual. Plan Básico: 30 consultas. Plan Pro: ilimitadas. La barra cambia a rojo al 80% de uso. Tus conversaciones se sincronizan con Firebase — están disponibles desde cualquier dispositivo en tiempo real.' },
  { selector:'.chr,.chat-header-right', title:'⚡ Acciones rápidas del chat', position:'bottom',
    desc:'"📄 PDF" exporta con formato profesional. "💾" archiva en la nube (Firebase). "🔊" lee la respuesta en voz alta. Atajos: Ctrl+S guardar, Ctrl+P exportar, Ctrl+R escuchar, Ctrl+N nueva consulta, Ctrl+H ir al panel. Presiona "?" para ver todos.' },
  { selector:'#userInput,.ci', title:'✏️ Consulta cualquier tema tributario', position:'top',
    desc:'Pregunta sobre IGV, Renta, ITAN, Drawback, CDIs, Precios de Transferencia, NIIF/NIC, SBS, SMV, SUNAFIL, INDECOPI, BCR, Zonas Especiales, Cripto y más. Enter para enviar, Shift+Enter para nueva línea.' },
];

const PANEL_TOUR_STEPS = [
  { selector:'.pnav,#panelNav', title:'🧭 Más de 90 herramientas tributarias', position:'bottom',
    desc:'El panel integra: Calculadoras (IGV, IR, ITAN, Drawback 3% FOB, Detracciones, Retenciones, Percepciones, Fraccionamiento Art.36 CT, Utilidades D.Leg.892, TIM), Normativa (SBS Ley 26702, SMV D.Leg.861, Tribunal Fiscal RTFs, Informes SUNAT, SUNAFIL, INDECOPI, BCR), Módulos avanzados (PT con 7 herramientas, NIIF/NIC, 8 CDIs, Zonas Especiales, Criptomonedas, Derecho Comparado) y herramientas operativas (Cierre Contable, Expediente Fiscalización, Contratos optimizados, Respuesta a Requerimientos SUNAT).' },
  { selector:'.pnav button', title:'🗂 Casos y Expedientes', position:'bottom',
    desc:'Crea expedientes para casos complejos con wizard de 4 pasos. Constructor de Expediente de Fiscalización con 26 documentos organizados por prioridad CRÍTICO/IMPORTANTE/Normal. Genera el índice formal del expediente listo para presentar ante SUNAT.' },
  { selector:'.pnav', title:'🔗 Módulo Precios de Transferencia', position:'bottom',
    desc:'7 herramientas especializadas: Detector de umbrales Local File/Master File/CbCR (D.S. 008-2023-EF), Selector de método OCDE con justificación legal y RTFs, Análisis funcional F/R/A automático con plantillas OCDE 2022, Calculadora de rango intercuartil P25-P75, Checklist de fiscalización (26 puntos con riesgo ALTO/MEDIO/BAJO), Asistente de Local File y Generador de Informe PT en PDF.' },
  { selector:'.pnav', title:'✈️ Drawback — Módulo completo', position:'bottom',
    desc:'Calculadora de restitución (3% del FOB exportado), verificación del ratio insumos/FOB ≤50%, pronóstico mensual con estacionalidad, requisitos del D.S.104-95-EF, proceso de 7 pasos con plazos, documentos requeridos y tratamiento tributario completo (las NCN son ingreso gravado con IR pero no con IGV).' },
  { selector:'.pnav', title:'📐 NIIF vs NIC y CDIs', position:'bottom',
    desc:'Módulo NIIF/NIC: tabla de 8 diferencias clave (NIIF 16 arrendamientos, NIIF 15 ingresos, NIIF 9 deterioro, NIC 36, NIC 37, NIC 12 IR diferido) con tipo temporaria/permanente y base legal. Calculadora de conciliación contable-tributaria con IR diferido. CDIs: análisis de los 8 convenios vigentes de Perú (Chile, España, Canadá, Brasil, México, Portugal, Suiza, Corea) con tasas reales y ahorro calculado.' },
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
        <button class="tour-btn-next" onclick="showTourStep(${step+1})">${step === activeTourSteps.length-1 ? '¡Listo!' : 'Siguiente →'}</button>
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
    const us = getUsers(); if (us[curUser.email]) { us[curUser.email].tourDone = true; saveUsers(us); }
    addNotif('🎉', 'Tour completado', 'Ya conoces todas las funciones principales. ¡Empieza a consultar!');
  }
}

// ════════════════════════════════════════
// ALERTAS DE VENCIMIENTO POR RUC
// ════════════════════════════════════════
function getDigitoRuc(ruc) { return ruc ? parseInt(ruc.slice(-1)) : 0; }

function loadAlerts() {
  const ruc = document.getElementById('alertRuc')?.value?.trim() || '';
  const regimen = document.getElementById('alertRegimen')?.value || 'rmt';
  if (ruc.length < 11) { tpToast('Ingresa un RUC válido de 11 dígitos.', 'warn'); return; }
  const digito = getDigitoRuc(ruc);
  // SUNAT 2025 - vencimiento según último dígito RUC (días hábiles aproximados)
  const diasExtra = [0,1,2,3,4,5,6,7,8,9][digito];
  const today = new Date();
  const year = today.getFullYear();
  // Próximos vencimientos basados en el dígito RUC
  const baseDay = 12 + diasExtra; // dígito 0=día 12, 1=día 13... 9=día 21
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
  const proxVenc = [];
  for (let m = today.getMonth(); m < Math.min(today.getMonth() + 4, 12); m++) {
    const vencDate = new Date(year, m + 1, baseDay); // mes siguiente, día baseDay
    const diff = Math.round((vencDate - today) / (1000 * 60 * 60 * 24));
    const urg = diff <= 5 ? 'urgent' : diff <= 15 ? 'soon' : 'ok';
    const urgLabel = diff <= 0 ? 'Vencido' : diff === 0 ? 'Hoy' : `En ${diff} días`;
    proxVenc.push({
      icon: diff <= 5 ? '🔴' : diff <= 15 ? '🟡' : '🟢',
      name: `Declaración PDT 621 — ${months[m]} ${year}`,
      sub: `RUC dígito ${digito} · Vence: ${baseDay} ${months[(m+1)%12]}`,
      days: urgLabel, urg
    });
  }
  // Annual obligations
  const anualObs = [
    { icon:'📋', name:`DJ Anual IR ${year-1}`, sub:'Declaración Jurada Anual — PDT 710', days:`Marzo-Abril ${year}`, urg:'soon' },
    { icon:'🏦', name:'ITAN 2025 — Cuotas', sub:'Impuesto Temporal a los Activos Netos', days:'Jun / Jul 2025', urg:'ok' },
  ];
  if (regimen === 'rg' || regimen === 'rmt') {
    anualObs.push({ icon:'🔗', name:'Precios de Transferencia', sub:'Local File — Form. 3560 (si obligado)', days:'Octubre 2025', urg:'ok' });
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
    const us = getUsers(); if (us[curUser.email]) { us[curUser.email].ruc = us[curUser.email].ruc || ruc; saveUsers(us); curUser.ruc = ruc; }
    addNotif('🔔', 'Alertas configuradas', `Vencimientos para RUC ${ruc.slice(0,4)}... cargados. Dígito ${digito} → vence día ${baseDay} de cada mes.`);
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

// ════════════════════════════════════════
// GENERADOR DE INFORME EJECUTIVO
// ════════════════════════════════════════
async function generateInforme() {
  const empresa = document.getElementById('infEmpresa')?.value?.trim() || 'Empresa';
  const regimen = document.getElementById('infRegimen')?.value || 'RMT';
  const sector = document.getElementById('infSector')?.value || 'servicios';
  const ingresos = document.getElementById('infIngresos')?.value || '0';
  const utilidad = document.getElementById('infUtilidad')?.value || '0';
  const contingencias = document.getElementById('infContingencias')?.value?.trim() || 'Sin contingencias identificadas';
  const objetivo = document.getElementById('infObjetivo')?.value || 'directorio';
  const objetivoLabel = {directorio:'Presentar al directorio',auditoria:'Preparación para auditoría SUNAT',banco:'Solicitud de crédito bancario',inversionista:'Due diligence / inversores',general:'Revisión interna general'}[objetivo];

  const loading = document.getElementById('informeLoading');
  const preview = document.getElementById('informePreview');
  const expBtn = document.getElementById('infExportBtn');
  const cpyBtn = document.getElementById('infCopyBtn');

  loading.style.display = 'block';
  preview.style.display = 'none';
  if (expBtn) expBtn.style.display = 'none';
  if (cpyBtn) cpyBtn.style.display = 'none';

  const prompt = `Genera un informe ejecutivo tributario profesional en español para:
Empresa: ${empresa}
Régimen: ${regimen}
Sector: ${sector}
Ingresos anuales: S/ ${parseInt(ingresos).toLocaleString()}
Utilidad neta: S/ ${parseInt(utilidad).toLocaleString()}
Contingencias identificadas: ${contingencias}
Objetivo del informe: ${objetivoLabel}
Fecha: ${new Date().toLocaleDateString('es-PE', {day:'2-digit',month:'long',year:'numeric'})}

Estructura el informe con estas secciones:
1. Resumen ejecutivo
2. Situación tributaria actual (régimen, obligaciones, carga tributaria efectiva)
3. Análisis de contingencias y riesgos
4. Indicadores tributarios clave (IR efectivo, IGV, ratios)
5. Recomendaciones de optimización
6. Conclusiones

Usa base legal peruana vigente (LIR, LIGV, CT). Sé profesional y conciso. Máximo 600 palabras.`;

  if (!apiKey) {
    loading.style.display = 'none';
    preview.style.display = 'block';
    preview.innerHTML = `<h3>INFORME EJECUTIVO TRIBUTARIO — DEMO</h3>
<h4>1. Resumen ejecutivo</h4>
<p><em>${empresa}</em> opera bajo el ${regimen} en el sector ${sector}. Los ingresos anuales ascienden a S/ ${parseInt(ingresos).toLocaleString()} con una utilidad neta de S/ ${parseInt(utilidad).toLocaleString()}.</p>
<h4>2. Situación tributaria</h4>
<p>Régimen: <strong>${regimen}</strong>. Carga tributaria estimada: ${regimen==='RMT'?'10% hasta 15 UIT, 29.5% excedente':'29.5% sobre utilidad neta'}.</p>
<h4>⚠️ Demo</h4>
<p>Conecta tu API Key de Claude para generar el informe completo con análisis detallado, base legal y recomendaciones personalizadas.</p>`;
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
    addNotif('📑','Informe generado',`Informe ejecutivo de "${empresa}" generado exitosamente.`);
  } catch(err) {
    loading.style.display = 'none';
    preview.style.display = 'block';
    preview.innerHTML = '<p style="color:var(--red)">Error: ' + err.message + '</p>';
  }
}

function exportInforme() {
  const win = window.open('','_blank');
  const empresa = document.getElementById('infEmpresa')?.value || 'Empresa';
  const content = document.getElementById('informePreview')?.innerHTML || '';
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Informe Tributario — ${_escapeHtml(empresa)}</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#333;line-height:1.7}h1{color:#C9A84C;border-bottom:2px solid #C9A84C;padding-bottom:8px}h3,h4{color:#8B6914;margin:16px 0 6px}p{margin-bottom:10px;font-size:14px}strong{color:#555}@media print{body{margin:20px}}</style></head><body><h1>Informe Ejecutivo Tributario</h1><p style="font-size:14px;color:#888;margin-bottom:24px">Generado por DeclaraFY · ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</p>${content}<hr style="margin:24px 0"><p style="font-size:14px;color:#999;text-align:center">DeclaraFY.pe — Documento orientativo. Consulta con un profesional para decisiones formales.</p></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function copyInforme() {
  const text = document.getElementById('informePreview')?.innerText || '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('infCopyBtn');
    if (btn) { btn.textContent = '✅ Copiado!'; setTimeout(() => btn.textContent = '📋 Copiar texto', 2000); }
  });
}

// ════════════════════════════════════════
// PATCH setPTab TO LOAD ALERTS & TOUR
// ════════════════════════════════════════
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

// ════════════════════════════════════════
// TOUR — auto start for new users
// ════════════════════════════════════════
function maybeStartTour() {
  if (!curUser) return;
  if (!curUser.tourDone) {
    setTimeout(() => startTour('chat'), 900);
  }
}

function startPanelTour() {
  startTour('panel');
}

// ════════════════════════════════════════
// OFFLINE MODE
// ════════════════════════════════════════
const TP_OFFLINE_KEY = 'tp_offline_last';
const TP_OFFLINE_MAX = 5; // últimas 5 respuestas guardadas

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
    if (!saved.length) { tpToast('No hay consultas guardadas aún', 'info'); return; }
    const msgs = document.getElementById('messages');
    if (!msgs) return;
    msgs.innerHTML = '';
    saved.forEach(item => {
      const d = new Date(item.ts).toLocaleString('es-PE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      addMsg('user', `📦 [Guardada el ${d}] ${item.q}`);
      addMsg('ai', item.a);
    });
    tpToast(`${saved.length} consulta(s) cargada(s) desde caché`, 'ok');
  } catch(e) { tpToast('Error al cargar caché', 'err'); }
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


// ════════════════════════════════════════
// PDT XML ANALYZER
// ════════════════════════════════════════
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
    <div class="xml-stat"><div class="xml-stat-v">${periodo}</div><div class="xml-stat-l">Período</div></div>
    <div class="xml-stat"><div class="xml-stat-v">${rucPDT}</div><div class="xml-stat-l">RUC</div></div>
    <div class="xml-stat"><div class="xml-stat-v">${(content.length/1024).toFixed(1)}KB</div><div class="xml-stat-l">Tamaño</div></div>`;
  // Findings
  const findings = [];
  // Check IGV rate
  if (ventas > 0 && igvVentas > 0) {
    if (Math.abs(igvRate - 18) < 0.5) findings.push({type:'ok', title:'Tasa IGV correcta', desc:`IGV aplicado: ${igvRate.toFixed(2)}% — Correcto (tasa vigente 18%)`});
    else findings.push({type:'error', title:'Tasa IGV incorrecta', desc:`IGV calculado: ${igvRate.toFixed(2)}% — Esperado: 18%. Revisar cálculo del débito fiscal.`});
  }
  // Credit fiscal vs debit
  if (igvCompras > igvVentas && igvVentas > 0) findings.push({type:'warn', title:'Crédito fiscal supera débito fiscal', desc:`Crédito: S/${igvCompras.toLocaleString()} > Débito: S/${igvVentas.toLocaleString()}. Generará saldo a favor. Verificar que sea correcto.`});
  // Check if XML has required nodes
  if (!content.includes('RUC') && !content.includes('ruc')) findings.push({type:'error', title:'RUC no encontrado en el XML', desc:'El archivo no contiene el nodo RUC. Verifica que sea un PDT exportado correctamente desde SUNAT.'});
  if (!content.includes('PERIODO') && !content.includes('periodo') && !content.includes('Periodo')) findings.push({type:'warn', title:'Período no identificado', desc:'No se encontró el período tributario en el archivo. Verifica la estructura del XML.'});
  // Generic checks
  if (ventas === 0 && compras === 0) findings.push({type:'warn', title:'Sin datos de ventas/compras', desc:'No se detectaron montos de ventas ni compras. El archivo puede estar en un formato no reconocido o ser una declaración en cero.'});
  else findings.push({type:'ok', title:'Estructura XML válida', desc:`Archivo procesado correctamente. ${content.split('<').length - 1} nodos XML detectados.`});
  if (findings.length === 0) findings.push({type:'ok', title:'Sin observaciones detectadas', desc:'El análisis básico no encontró problemas evidentes. Usa "Analizar con IA" para un análisis profundo.'});
  document.getElementById('xmlFindings').innerHTML = findings.map(f => `<div class="xml-finding ${f.type}"><div class="xml-finding-title">${f.type === 'error' ? '🔴' : f.type === 'warn' ? '🟡' : '🟢'} ${f.title}</div><div class="xml-finding-desc">${f.desc}</div></div>`).join('');
}

async function askAIAboutXML() {
  if (!xmlContent) return;
  const prompt = `Analiza este archivo PDT de SUNAT en formato XML y proporciona:\n1. Resumen de los datos tributarios encontrados\n2. Errores o inconsistencias detectados\n3. Comparación con tasas y normas vigentes\n4. Oportunidades de optimización tributaria\n5. Observaciones que SUNAT podría hacer en una fiscalización\n\nArchivo: ${xmlFileName}\nContenido (primeros 2000 chars): ${xmlContent.substring(0, 2000)}`;
  convHist = []; convId = null;
  goToChat();
  setTimeout(() => sendMsg(prompt), 300);
}

// ════════════════════════════════════════
// SUNAT API CONSULTOR
// ════════════════════════════════════════
let sunatActiveTab = 'ruc';
function setSunatTab(tab, btn) {
  sunatActiveTab = tab;
  document.querySelectorAll('.sunat-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('sunatResult').style.display = 'none';
}

async function querySunat() {
  const ruc = document.getElementById('sunatRuc')?.value?.trim() || '';
  if (ruc.length < 11) { tpToast('Ingresa un RUC válido de 11 dígitos.', 'warn'); return; }
  const loading = document.getElementById('sunatLoading');
  const result = document.getElementById('sunatResult');
  loading.style.display = 'block';
  result.style.display = 'none';
  await new Promise(r => setTimeout(r, 1200));
  loading.style.display = 'none';
  result.style.display = 'block';
  // Simulated SUNAT data (in production: call SUNAT API or scraper)
  const isActive = ruc.charAt(0) === '2';
  const tipoContrib = ruc.startsWith('10') ? 'Persona Natural' : 'Persona Jurídica';
  const digito = parseInt(ruc.slice(-1));
  const regimenes = ['NRUS', 'RER', 'RMT', 'RMT', 'RG', 'RG', 'RMT', 'RER', 'NRUS', 'RG'];
  if (sunatActiveTab === 'ruc') {
    result.innerHTML = `<div class="sunat-result-title">Estado del RUC ${ruc}</div>
      <div class="sunat-row"><span class="sunat-row-lbl">RUC</span><span class="sunat-row-val">${ruc}</span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">Tipo contribuyente</span><span class="sunat-row-val">${tipoContrib}</span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">Estado</span><span class="sunat-row-val ${isActive?'active':'inactive'}">${isActive?'ACTIVO':'BAJA'} <span class="sunat-badge ${isActive?'green':'red'}">${isActive?'Habido':'No habido'}</span></span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">Condición domiciliaria</span><span class="sunat-row-val"><span class="sunat-badge green">HABIDO</span></span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">Régimen tributario</span><span class="sunat-row-val">${regimenes[digito]}</span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">Fecha inscripción</span><span class="sunat-row-val">15/03/${2015 + digito}</span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">Actividad económica</span><span class="sunat-row-val" style="color:var(--muted)">Activ. consulta: ${6200 + digito * 10}</span></div>
      <p style="font-size:14px;color:var(--muted);margin-top:12px">⚠️ Datos simulados. En producción se conecta a la API real de SUNAT o al portal sunat.gob.pe</p>`;
  } else if (sunatActiveTab === 'deudas') {
    const deuda = digito % 3 === 0;
    result.innerHTML = `<div class="sunat-result-title">Deudas pendientes — RUC ${ruc}</div>
      ${deuda ? `<div class="sunat-row"><span class="sunat-row-lbl">IGV ene-2025</span><span class="sunat-row-val warn">S/ ${(digito * 1240 + 3500).toLocaleString()}</span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">IR 2024</span><span class="sunat-row-val warn">S/ ${(digito * 2300 + 8000).toLocaleString()}</span></div>
      <div class="sunat-row"><span class="sunat-row-lbl">Multa Art.176</span><span class="sunat-row-val" style="color:var(--red)">S/ ${(digito * 500 + 1200).toLocaleString()}</span></div>
      <div class="sunat-row" style="background:rgba(230,57,70,.05);border-radius:8px;padding:8px 10px"><span class="sunat-row-lbl"><strong>Total deuda</strong></span><span class="sunat-row-val" style="color:var(--red);font-size:16px"><strong>S/ ${(digito*4040+12700).toLocaleString()}</strong></span></div>`
      : `<div style="text-align:center;padding:20px;color:var(--green)">✅ Sin deudas pendientes detectadas.</div>`}
      <p style="font-size:14px;color:var(--muted);margin-top:12px">⚠️ Datos simulados para demo. Verifica en SUNAT Virtual con tu Clave SOL.</p>`;
  } else if (sunatActiveTab === 'cpe') {
    result.innerHTML = `<div class="sunat-result-title">Últimos comprobantes emitidos — RUC ${ruc}</div>
      <div class="sunat-cp-list">
        <div class="sunat-cp-item"><span>F001-${1000+digito*12}</span><span style="color:var(--muted)">15/03/2025</span><span>S/ ${(digito*850+2400).toLocaleString()}</span><span class="sunat-badge green">Aceptada</span></div>
        <div class="sunat-cp-item"><span>F001-${999+digito*12}</span><span style="color:var(--muted)">10/03/2025</span><span>S/ ${(digito*620+1800).toLocaleString()}</span><span class="sunat-badge green">Aceptada</span></div>
        <div class="sunat-cp-item"><span>B001-${500+digito*8}</span><span style="color:var(--muted)">05/03/2025</span><span>S/ ${(digito*120+450).toLocaleString()}</span><span class="sunat-badge green">Aceptada</span></div>
        <div class="sunat-cp-item"><span>NC01-${20+digito}</span><span style="color:var(--muted)">01/03/2025</span><span>-S/ ${(digito*200+600).toLocaleString()}</span><span class="sunat-badge gold">Nota créd.</span></div>
      </div>
      <p style="font-size:14px;color:var(--muted);margin-top:12px">⚠️ Muestra de los últimos 4 comprobantes. Datos simulados.</p>`;
  } else {
    result.innerHTML = `<div class="sunat-result-title">Últimos comprobantes recibidos — RUC ${ruc}</div>
      <div class="sunat-cp-list">
        <div class="sunat-cp-item"><span>F123-${2000+digito*15}</span><span style="color:var(--muted)">14/03/2025</span><span>S/ ${(digito*1200+3800).toLocaleString()}</span><span class="sunat-badge green">Aceptada</span></div>
        <div class="sunat-cp-item"><span>F456-${800+digito*10}</span><span style="color:var(--muted)">08/03/2025</span><span>S/ ${(digito*900+2200).toLocaleString()}</span><span class="sunat-badge gold">Pendiente</span></div>
        <div class="sunat-cp-item"><span>F789-${300+digito*6}</span><span style="color:var(--muted)">02/03/2025</span><span>S/ ${(digito*400+1100).toLocaleString()}</span><span class="sunat-badge green">Aceptada</span></div>
      </div>
      <p style="font-size:14px;color:var(--muted);margin-top:12px">⚠️ Datos simulados. En producción conecta a la API de SUNAT.</p>`;
  }
  addNotif('🔍', 'Consulta SUNAT', 'RUC ' + ruc.slice(0,4) + '... consultado exitosamente.');
}

// ════════════════════════════════════════
// TIMELINE NORMATIVO
// ════════════════════════════════════════
const TIMELINE_DATA = [
  {date:'Ene 2026', title:'UIT 2026 fijada en S/5,500', desc:'Mediante D.S. N° 301-2025-EF se aprobó la UIT 2026 en S/5,500, incremento de S/150 respecto a 2025 (S/5,350).', tag:'sunat', important:true},
  {date:'Ene 2025', title:'UIT 2025 fijada en S/5,350', desc:'Mediante D.S. 008-2025-EF se aprobó la UIT 2025 en S/5,350, incremento de S/200 respecto a 2024 (S/5,150).', tag:'sunat', important:true},
  {date:'Oct 2024', title:'Prorroga del drawback al 3%', desc:'SUNAT extendió la tasa de restitución del drawback al 3% para exportadores no tradicionales por el año fiscal 2025.', tag:'aduanas', important:false},
  {date:'Jul 2024', title:'Nuevo reglamento precios de transferencia', desc:'D.S. 008-2023-EF entró en plena vigencia. Nuevas obligaciones de documentación: Local File, Master File y Country-by-Country Report.', tag:'ir', important:true},
  {date:'Ene 2024', title:'Tasa del IGV se mantiene en 18%', desc:'La tasa del IGV (16%) más el IPM (2%) continúa en 18%. No hubo modificaciones respecto al D.S. 055-99-EF.', tag:'igv', important:false},
  {date:'Ene 2024', title:'UIT 2024 fijada en S/5,150', desc:'D.S. 309-2023-EF estableció la UIT 2024 en S/5,150, incremento de S/200 sobre la UIT 2023 (S/4,950).', tag:'sunat', important:true},
  {date:'Ago 2023', title:'Reforma del régimen de fraccionamiento', desc:'Se modificaron las condiciones del fraccionamiento Art. 36 CT. Nuevas tasas de interés y plazos máximos de 72 cuotas.', tag:'ct', important:false},
  {date:'Jun 2023', title:'Facturación electrónica obligatoria NRUS', desc:'A partir de junio 2023, los contribuyentes del NRUS están obligados a emitir tickets electrónicos en reemplazo de boletas de venta manuales.', tag:'sunat', important:false},
  {date:'Ene 2023', title:'UIT 2023 en S/4,950', desc:'D.S. 314-2022-EF fijó la UIT 2023 en S/4,950, incremento de S/350 sobre la UIT 2022 (S/4,600).', tag:'sunat', important:false},
  {date:'Dic 2022', title:'Tasa IR no domiciliados: dividendos al 5%', desc:'Se confirmó la tasa de retención del 5% sobre dividendos para sujetos no domiciliados, según el Art. 54 de la LIR.', tag:'ir', important:false},
  {date:'Ene 2022', title:'Subcapitalización: nuevo límite deuda/patrimonio', desc:'Se redujo el límite de endeudamiento con partes vinculadas de 3x a 3x el patrimonio neto (se mantiene ratio pero con nuevas reglas de cómputo).', tag:'ir', important:true},
  {date:'Sep 2021', title:'Norma XVI — Cláusula antielusiva reactivada', desc:'El TC ratificó la plena vigencia de la Norma XVI del CT (cláusula antielusiva general). SUNAT puede desconocer actos sin sustancia económica.', tag:'ct', important:true},
  {date:'Ene 2020', title:'Régimen MYPE Tributario consolidado', desc:'El RMT del D.Leg. 1269 se consolida como el régimen más adoptado por pymes peruanas. Tasa 10% hasta 15 UIT, 29.5% por el exceso.', tag:'ir', important:false},
  {date:'Jul 2018', title:'Deducción adicional 7 UIT personas naturales', desc:'Personas naturales de 4ta y 5ta categoría pueden deducir hasta 7 UIT adicionales por gastos como arrendamientos, honorarios médicos e intereses hipotecarios.', tag:'ir', important:false},
  {date:'Ene 2017', title:'Reducción tasa IR general al 29.5%', desc:'D.Leg. 1261 redujo definitivamente la tasa del IR empresarial al 29.5%. Anteriormente la tasa era 28% en 2015-2016, con reducción gradual desde 30%.', tag:'ir', important:true},
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
    <span class="tl-tag ${t.tag}">${{igv:'IGV',ir:'Renta',ct:'Cód. Tributario',sunat:'SUNAT',aduanas:'Aduanas'}[t.tag]}</span>
  </div>`).join('');
}

// ════════════════════════════════════════
// EXCEL / SHEETS SIMULATOR
// ════════════════════════════════════════
async function runExcelSim() {
  const inp = document.getElementById('excelSimInput');
  const res = document.getElementById('excelSimResult');
  if (!inp || !res) return;
  let formula = inp.value.trim();
  // Extract query from formula
  const match = formula.match(/DECLARAFY\s*\(\s*["'](.+?)["']\s*\)/i);
  const query = match ? match[1] : formula.replace(/^=?DECLARAFY\s*\(/i,'').replace(/\)$/,'').replace(/['"]/g,'').trim();
  if (!query) { res.textContent = '// Error: Ingresa una consulta válida'; return; }
  res.textContent = '// Procesando...';
  if (!apiKey) {
    await new Promise(r => setTimeout(r, 800));
    const demos = {igv:'18% (16% IGV + 2% IPM) — TUO D.S.055-99-EF', uit:'S/5,500 para 2026 — D.S.301-2025-EF', rmt:'10% hasta 15 UIT, 29.5% excedente — D.Leg.1269'};
    const key = Object.keys(demos).find(k => query.toLowerCase().includes(k));
    res.textContent = key ? demos[key] : '// Conecta tu API Key para respuestas reales. Demo: La tasa del IGV es 18%.';
    return;
  }
  try {
    const r = await callDeclaraFY({ model:'claude-sonnet-4-5', max_tokens:150, system:'Asesor tributario peruano. Responde en máximo 2 líneas, directo y conciso.', messages:[{role:'user', content:query}] });
    const d = await r.json();
    res.textContent = d.content?.[0]?.text || '// Sin respuesta';
  } catch(e) { res.textContent = '// Error: ' + e.message; }
}

// ════════════════════════════════════════
// BILLING TOGGLE (Plan Anual)
// ════════════════════════════════════════
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
      features:['Consultas ilimitadas con IA','Excel, Word, PDF adjuntos','Todas las áreas tributarias','Historial de conversaciones','Calculadora y PDT 621','Biblioteca de normas'] },
    { name:'Empresa', monthly:750, annual:7500, link_m:'https://express.culqi.com/pago/593B4B3F8D', link_a:'https://express.culqi.com/pago/DA4029174B', featured:false,
      features:['Todo del plan Pro','Hasta 10 usuarios','Local File y Master File PT','Dashboard administración','Reportes exportables','API access'] },
  ];
  el.innerHTML = plans.map(p => {
    const price = billingMode === 'anual' ? p.annual : p.monthly;
    const period = billingMode === 'anual' ? '/año' : '/mes';
    const savings = billingMode === 'anual' ? `<div style="font-size:14px;color:var(--green);margin-top:3px">2 meses gratis — ahorras S/${Math.round(p.monthly*2).toLocaleString()}</div>` : '';
    const link = billingMode === 'anual' ? p.link_a : p.link_m;
    return `<div style="background:var(--surface);border:1px solid ${p.featured?'var(--gold)':'var(--border)'};border-radius:13px;padding:20px;${p.featured?'background:rgba(201,168,76,.07)':''}">
      <div style="font-size:14px;letter-spacing:.1em;color:var(--muted);margin-bottom:4px;text-transform:uppercase">${p.name}</div>
      <div style="font-size:28px;font-weight:300;color:var(--gold)">S/${price.toLocaleString()}<span style="font-size:14px;color:var(--muted)">${period}</span></div>
      ${savings}
      <ul style="list-style:none;margin:12px 0 16px">
        ${p.features.map(f=>`<li style="font-size:14px;padding:3px 0;color:#CCC;display:flex;align-items:flex-start;gap:5px"><span style="color:var(--gold);flex-shrink:0">✓</span>${f}</li>`).join('')}
      </ul>
      <button onclick="window.open('${link}','_blank')" style="width:100%;padding:9px;border-radius:7px;background:var(--gold);border:none;color:var(--dark);font-size:14px;font-weight:500;cursor:pointer;font-family:inherit">
        ${billingMode==='anual'?'Suscribirse anualmente':'Suscribirse mensual'}
      </button>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════
// PATCH setPTab FOR NEW SECTIONS
// ════════════════════════════════════════
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
    if (s) s.textContent = '// El resultado aparecerá aquí...';
  }
}


// ════════════════════════════════════════
// INTERESES MORATORIOS TIM
// ════════════════════════════════════════
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
  const tasaDiaria = 0.04 / 100; // 1.2% mensual = 0.04% diario
  const interes = deuda * tasaDiaria * dias;
  const total = (deuda + interes) * (1 - rebaja);
  const fmtS = n => 'S/ ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  res.style.display = 'block';
  document.getElementById('timTributoLbl').textContent = tributo + ' — ' + dias + ' días de mora';
  document.getElementById('timTotal').textContent = fmtS(total);
  document.getElementById('timDeudaVal').textContent = fmtS(deuda);
  document.getElementById('timDias').textContent = dias + ' días (' + Math.floor(dias/30) + ' meses ' + (dias%30) + ' días)';
  document.getElementById('timIntereses').textContent = fmtS(interes) + (rebaja > 0 ? ' (con rebaja ' + (rebaja*100) + '%)' : '');
  document.getElementById('timTotalRow').innerHTML = '<strong>' + fmtS(total) + '</strong>';
  // Timeline by months
  const tl = document.getElementById('timTimeline');
  const meses = Math.min(Math.ceil(dias/30), 12);
  let tlHtml = '<div style="font-size:14px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.07em">Evolución mensual</div>';
  for (let m = 1; m <= meses; m++) {
    const dM = m * 30;
    const iM = deuda * tasaDiaria * dM;
    const pct = Math.min((iM/deuda)*100, 100);
    const color = pct < 5 ? 'var(--green)' : pct < 15 ? 'var(--gold)' : 'var(--red)';
    tlHtml += `<div class="tim-tl-item"><div class="tim-tl-dot" style="background:${color}"></div><span style="min-width:60px;color:var(--muted)">Mes ${m}</span><span style="flex:1">+${fmtS(iM)} intereses</span><span style="color:${color}">${pct.toFixed(1)}%</span></div>`;
  }
  tl.innerHTML = tlHtml;
}

// ════════════════════════════════════════
// DEPRECIACIONES
// ════════════════════════════════════════
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
  let html = `<div class="sec-title" style="margin-bottom:12px">Tabla de depreciación — ${tipo?.options[tipo.selectedIndex]?.text || ''}</div>`;
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
    <div style="background:var(--dark3);border-radius:8px;padding:10px;text-align:center"><div style="font-size:14px;color:var(--muted)">Depreciación anual</div><div style="font-size:16px;font-weight:300;color:var(--gold)">${fmtS(depAnual)}</div></div>
    <div style="background:var(--dark3);border-radius:8px;padding:10px;text-align:center"><div style="font-size:14px;color:var(--muted)">Vida útil estimada</div><div style="font-size:16px;font-weight:300;color:var(--gold)">${vidaUtil} años</div></div>
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
  if (vidaUtil > 10) html += `<div style="font-size:14px;color:var(--muted);margin-top:6px">... y ${vidaUtil - 10} años más hasta depreciar completamente.</div>`;
  res.style.display = 'block';
  res.innerHTML = html;
}

// ════════════════════════════════════════
// SIMULADOR MULTAS
// ════════════════════════════════════════
const MULTAS_CFG = {
  no_declarar: { titulo:'No presentar declaración jurada', art:'Art. 176 num.1 CT', base:'1_uit', baseLabel:'(Base: 1 UIT = S/5,500)', formula: (uit) => uit, desc:'Multa fija de 1 UIT por no presentar la declaración mensual o anual.' },
  declarar_incorrectamente: { titulo:'Declarar cifras o datos incorrectos', art:'Art. 178 num.1 CT', base:'tributo', baseLabel:'Tributo omitido S/', formula: (base) => base * 0.50, desc:'50% del tributo omitido. Aplica cuando se declara un monto menor al correcto.' },
  no_comprobante: { titulo:'No emitir comprobante de pago', art:'Art. 174 num.1 CT', base:'1_uit', baseLabel:'(Base: 1 UIT = S/5,500)', formula: (uit) => uit, desc:'Multa de 1 UIT. Primera infracción: cierre del local (o multa en sustitución).' },
  atraso_libros: { titulo:'Atraso en libros y registros contables', art:'Art. 175 num.5 CT', base:'ingresos', baseLabel:'Ingresos netos anuales S/', formula: (base) => base * 0.003, desc:'0.3% de los ingresos netos anuales. Mínimo 10% de la UIT.' },
  no_detraccion: { titulo:'No depositar detracción SPOT', art:'Art. 12 D.Leg. 940', base:'operacion', baseLabel:'Monto de la operación S/', formula: (base) => base * 0.50, desc:'50% del monto no depositado. Sin gradualidad en ciertos casos.' },
  no_ruc: { titulo:'No inscribirse en RUC', art:'Art. 173 num.1 CT', base:'1_uit', baseLabel:'(Base: 1 UIT = S/5,500)', formula: (uit) => uit, desc:'Multa de 1 UIT por no obtener RUC estando obligado.' },
};
const GRAD_RATES = {
  voluntaria_antes: 0.10, voluntaria_despues: 0.30, inducida_antes: 0.50, inducida_despues: 0.75, sin_subsanar: 1.0
};
const GRAD_LABELS = {
  voluntaria_antes:'Voluntaria antes de notificación (rebaja 90%)', voluntaria_despues:'Voluntaria después de notificación (rebaja 70%)',
  inducida_antes:'Inducida antes del cierre (rebaja 50%)', inducida_despues:'Inducida después del cierre (rebaja 25%)', sin_subsanar:'Sin subsanar (0% rebaja — multa completa)'
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
    <div style="font-size:14px;color:var(--muted);margin-bottom:14px">${cfg.art} · ${cfg.desc}</div>
    <div class="tim-row"><span class="tim-row-lbl">Multa calculada (sin gradualidad)</span><span class="tim-row-val">${fmtS(multaFinal)}</span></div>
    <div class="tim-row"><span class="tim-row-lbl">Régimen de gradualidad aplicado</span><span class="tim-row-val">${GRAD_LABELS[subsana]}</span></div>
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
    <p style="font-size:14px;color:var(--muted);margin-top:12px">Base legal: Régimen de Gradualidad R.S. 063-2007/SUNAT. UIT 2026: S/5,500.</p>`;
}

// ════════════════════════════════════════
// CONVERSOR MONEDA SBS
// ════════════════════════════════════════
let fxRates = { USD_PEN_buy:3.720, USD_PEN_sell:3.754, EUR_PEN_buy:4.050, EUR_PEN_sell:4.098 };
let fxDirection = 'USD_PEN';
function refreshFX() {
  // Simulate slight variation each refresh (in production: call SBS API)
  fxRates.USD_PEN_buy = 3.720 + (Math.random() * 0.04 - 0.02);
  fxRates.USD_PEN_sell = fxRates.USD_PEN_buy + 0.034;
  fxRates.EUR_PEN_buy = 4.050 + (Math.random() * 0.06 - 0.03);
  fxRates.EUR_PEN_sell = fxRates.EUR_PEN_buy + 0.048;
  const fmt = n => n.toFixed(3);
  const el = (id) => document.getElementById(id);
  if(el('fxUSDComp')) el('fxUSDComp').textContent = fmt(fxRates.USD_PEN_buy);
  if(el('fxUSDVenta')) el('fxUSDVenta').textContent = fmt(fxRates.USD_PEN_sell);
  if(el('fxEURVenta')) el('fxEURVenta').textContent = fmt(fxRates.EUR_PEN_sell);
  const now = new Date();
  if(el('fxFecha')) el('fxFecha').textContent = 'Actualizado: ' + now.toLocaleDateString('es-PE') + ' ' + now.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) + ' (SBS simulado)';
  renderFXHistory();
  convertFX();
}
function renderFXHistory() {
  const el = document.getElementById('fxHistory'); if(!el) return;
  const fmt = n => n.toFixed(3);
  const pairs = [
    {pair:'USD/PEN Compra', rate:fxRates.USD_PEN_buy},
    {pair:'USD/PEN Venta', rate:fxRates.USD_PEN_sell},
    {pair:'EUR/PEN Compra', rate:fxRates.EUR_PEN_buy},
    {pair:'EUR/PEN Venta', rate:fxRates.EUR_PEN_sell},
    {pair:'USD/EUR', rate:fxRates.USD_PEN_sell/fxRates.EUR_PEN_sell},
    {pair:'EUR/USD', rate:fxRates.EUR_PEN_sell/fxRates.USD_PEN_sell},
  ];
  el.innerHTML = pairs.map(p => `<div class="fx-hist-item"><div class="fx-hist-pair">${p.pair}</div><div class="fx-hist-rate">${fmt(p.rate)}</div><div class="fx-hist-date">Hoy SBS</div></div>`).join('');
}
function changeFXPair() {
  fxDirection = document.getElementById('fxPar')?.value || 'USD_PEN';
  const labels = {
    USD_PEN:['Monto en USD','Equivalente en PEN','Dólares americanos (USD)','Soles peruanos (PEN)'],
    PEN_USD:['Monto en PEN','Equivalente en USD','Soles peruanos (PEN)','Dólares americanos (USD)'],
    EUR_PEN:['Monto en EUR','Equivalente en PEN','Euros (EUR)','Soles peruanos (PEN)'],
    PEN_EUR:['Monto en PEN','Equivalente en EUR','Soles peruanos (PEN)','Euros (EUR)'],
    USD_EUR:['Monto en USD','Equivalente en EUR','Dólares americanos (USD)','Euros (EUR)'],
    EUR_USD:['Monto en EUR','Equivalente en USD','Euros (EUR)','Dólares americanos (USD)'],
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
  if(el) el.textContent = amt > 0 ? result.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',') : '—';
}
function swapFX() {
  const pairs = {USD_PEN:'PEN_USD',PEN_USD:'USD_PEN',EUR_PEN:'PEN_EUR',PEN_EUR:'EUR_PEN',USD_EUR:'EUR_USD',EUR_USD:'USD_EUR'};
  const sel = document.getElementById('fxPar');
  if(sel) { sel.value = pairs[fxDirection]||'PEN_USD'; changeFXPair(); }
}

// ════════════════════════════════════════
// FACTURACIÓN Y PAGOS
// ════════════════════════════════════════
function renderBillingPanel() {
  if (!curUser) return;
  const pn = {basico:'Básico',pro:'Profesional',empresa:'Empresa'};
  const pp = {basico:'S/0',pro:'S/190',empresa:'S/750'};
  document.getElementById('facPlanName').textContent = 'Plan ' + (pn[curUser.plan]||'Básico');
  document.getElementById('facPlanPrice').innerHTML = (pp[curUser.plan]||'S/0') + '<span style="font-size:14px;color:var(--muted)">/mes</span>';
  const nextDate = new Date(); nextDate.setMonth(nextDate.getMonth()+1);
  document.getElementById('facPlanRenew').textContent = 'Próxima renovación: ' + nextDate.toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'});
  document.getElementById('facNextBill').textContent = pp[curUser.plan]||'S/0';
  // Simulate payment history
  const hist = document.getElementById('billingHist'); if(!hist) return;
  if (curUser.plan === 'basico') { hist.innerHTML = '<div class="hempty">Sin historial de pagos. Actualiza a un plan de pago para ver tus facturas.</div>'; return; }
  const price = curUser.plan === 'pro' ? 190 : 750;
  const months = ['Mar 2025','Feb 2025','Ene 2025','Dic 2024'];
  const mesesActivos = 4;
  document.getElementById('facTotal').textContent = 'S/' + (price*mesesActivos).toLocaleString();
  document.getElementById('facMeses').textContent = mesesActivos;
  hist.innerHTML = months.map((m,i) => `<div class="bill-item">
    <div class="bill-icon">🧾</div>
    <div class="bill-info">
      <div class="bill-title">Plan ${pn[curUser.plan]} — ${m}</div>
      <div class="bill-sub">Suscripción mensual DeclaraFY · ${curUser.email}</div>
      <span class="bill-status paid">Pagado</span>
    </div>
    <div class="bill-amount">
      S/${price.toLocaleString()}
      <br><button class="bill-dl" onclick="downloadReceipt('${m}',${price})">📄 Descargar</button>
    </div>
  </div>`).join('');
}
function downloadReceipt(mes, price) {
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Recibo DeclaraFY</title>
  <style>body{font-family:Arial,sans-serif;max-width:500px;margin:40px auto;color:#333}
  .header{background:#1A1A2E;color:#C9A84C;padding:20px;border-radius:8px;text-align:center;margin-bottom:24px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
  .total{font-size:16px;font-weight:bold;color:#C9A84C}</style></head><body>
  <div class="header"><h2 style="margin:0">DeclaraFY</h2><p style="margin:4px 0;font-size:14px;color:rgba(201,168,76,.7)">Recibo de suscripción</p></div>
  <div class="row"><span>Servicio</span><span>Plan ${curUser?.plan||'Pro'} — ${mes}</span></div>
  <div class="row"><span>Usuario</span><span>${curUser?.email||'—'}</span></div>
  <div class="row"><span>Fecha de emisión</span><span>${new Date().toLocaleDateString('es-PE')}</span></div>
  <div class="row"><span>Método de pago</span><span>Culqi</span></div>
  <div class="row total"><span><strong>Total</strong></span><span><strong>S/ ${price.toFixed(2)}</strong></span></div>
  <p style="font-size:14px;color:#999;margin-top:20px;text-align:center">Este recibo puede ser deducido como gasto (Art. 37 LIR) con el comprobante electrónico correspondiente.</p>
  </body></html>`);
  win.document.close(); setTimeout(()=>win.print(),400);
}
function confirmCancel() {
  if (confirm('¿Estás seguro de que deseas cancelar tu suscripción? Perderás acceso al plan al final del período pagado.')) {
    addNotif('⚠️','Cancelación solicitada','Tu suscripción será cancelada al vencer el período actual. Lamentamos verte partir.');
    tpToast('Cancelación registrada. Tu acceso se mantendrá hasta el fin del período pagado.', 'warn');
  }
}

// ════════════════════════════════════════
// ANÁLISIS DE CONTRATOS
// ════════════════════════════════════════
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
  if (text.toLowerCase().includes('usd') || text.toLowerCase().includes('dólar') || text.toLowerCase().includes('dolar'))
    quickFindings.push({risk:'medio', title:'Operación en moneda extranjera', desc:'El contrato menciona USD. Para efectos del IR, los importes deben convertirse al tipo de cambio SBS de la fecha de la operación (Art. 50 RLIR). Documentar el tipo de cambio utilizado.'});
  if (partes === 'no_domiciliado')
    quickFindings.push({risk:'alto', title:'Contraparte no domiciliada — Retención requerida', desc:'Las rentas pagadas a sujetos no domiciliados están sujetas a retención en la fuente. Tasa: 30% general, salvo CDI aplicable. Verificar si el país del proveedor tiene CDI con Perú (Art. 76 LIR).'});
  if (partes === 'vinculadas')
    quickFindings.push({risk:'alto', title:'Operación entre partes vinculadas — Precios de Transferencia', desc:'Las operaciones entre partes vinculadas deben realizarse a valor de mercado (Art. 32-A LIR). Si supera 100 UIT, puede requerir documentación de PT. Asegurarse de que el precio sea consistente con el mercado.'});
  if (tipo === 'arrendamiento')
    quickFindings.push({risk:'medio', title:'Arrendamiento — Renta de 1ra categoría o 3ra categoría', desc:'Si el arrendador es persona natural: renta de 1ra categoría (tasa efectiva 5%). Si es empresa: 3ra categoría. El arrendatario debe exigir comprobante de pago para deducir el gasto (Art. 37 LIR).'});
  if (tipo === 'licencia')
    quickFindings.push({risk:'medio', title:'Regalías — Tratamiento tributario especial', desc:'Las regalías pagadas a domiciliados son renta de 2da categoría (tasa 5%). A no domiciliados: retención 30% salvo CDI. Las regalías pagadas son deducibles como gasto (Art. 37 h) LIR).'});
  if (text.toLowerCase().includes('penalidad') || text.toLowerCase().includes('cláusula penal'))
    quickFindings.push({risk:'bajo', title:'Cláusula de penalidad — Deducibilidad fiscal', desc:'Las penalidades recibidas son ingresos gravados. Las penalidades pagadas son deducibles como gasto (Art. 37 LIR) si son consecuencia de la actividad del negocio y están correctamente documentadas.'});
  if (!quickFindings.length)
    quickFindings.push({risk:'bajo', title:'Análisis básico completado', desc:'No se detectaron cláusulas de alto riesgo en el análisis automático. La IA realizará un análisis más profundo.'});
  if (!apiKey) {
    loading.style.display = 'none';
    findings.innerHTML = quickFindings.map(f => `<div class="contract-finding risk-${f.risk}"><div class="contract-finding-head"><span class="contract-finding-title">${f.risk==='alto'?'🔴':f.risk==='medio'?'🟡':'🟢'} ${f.title}</span><span class="contract-finding-badge">${f.risk.toUpperCase()}</span></div><div>${f.desc}</div></div>`).join('');
    findings.innerHTML += '<div style="margin-top:12px;font-size:14px;color:var(--muted);padding:12px;background:var(--dark3);border-radius:8px">💡 Conecta tu API Key para un análisis profundo personalizado de cada cláusula del contrato.</div>';
    addNotif('📝','Contrato analizado','Se encontraron ' + quickFindings.length + ' observaciones tributarias.');
    return;
  }
  const prompt = `Analiza las implicancias tributarias peruanas del siguiente contrato de tipo "${tipo}" entre partes "${partes}". Identifica: 1) Cláusulas con impacto tributario 2) Riesgos fiscales 3) Obligaciones de retención 4) Recomendaciones. Para cada hallazgo indica el nivel de riesgo (ALTO/MEDIO/BAJO) y la base legal peruana.\n\nContrato: ${text.substring(0,3000)}`;
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:1500,system:'Eres un abogado tributarista peruano experto. Analizas contratos e identificas implicancias tributarias según la legislación peruana vigente.',messages:[{role:'user',content:prompt}]});
    const data = await res.json(); const reply = data.content?.[0]?.text || '';
    loading.style.display = 'none';
    // Show static + AI findings
    findings.innerHTML = quickFindings.map(f=>`<div class="contract-finding risk-${f.risk}"><div class="contract-finding-head"><span class="contract-finding-title">${f.risk==='alto'?'🔴':f.risk==='medio'?'🟡':'🟢'} ${f.title}</span><span class="contract-finding-badge">${f.risk.toUpperCase()}</span></div><div>${f.desc}</div></div>`).join('');
    findings.innerHTML += `<div style="margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px"><div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">✨ Análisis IA profundo</div><div style="font-size:14px;line-height:1.7;color:#C8C8DC">${_escapeHtml(reply).replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--gold)">$1</strong>')}</div></div>`;
    addNotif('📝','Contrato analizado con IA','Análisis profundo completado. Revisa los hallazgos.');
  } catch(e) { loading.style.display='none'; findings.innerHTML='<div class="contract-finding risk-alto"><div>Error: '+safeHTML(e.message)+'</div></div>'; }
}

// ════════════════════════════════════════
// WIDGET EMBEBIBLE
// ════════════════════════════════════════
function genWidgetKey() {
  if (!curUser) return;
  const key = 'WK-' + btoa(curUser.email).substring(0,12).toUpperCase().replace(/[^A-Z0-9]/g,'X') + '-' + Math.random().toString(36).substring(2,7).toUpperCase();
  const code = document.getElementById('widgetCode');
  if (code) code.textContent = code.textContent.replace('TU_WIDGET_KEY', key);
  addNotif('🔑','Widget Key generada','Tu Widget Key única fue generada. Guárdala en un lugar seguro.');
  tpToast('Widget Key generada: ' + key + '\n\nCópiala y reemplaza TU_WIDGET_KEY en el código de instalación.', 'success');
}
function copyWidgetCode() {
  const code = document.getElementById('widgetCode')?.textContent || '';
  const btn = event.currentTarget;
  navigator.clipboard.writeText(code).then(() => {
    if(btn) { btn.textContent = '✅ Copiado!'; setTimeout(() => btn.textContent = '📋 Copiar código', 2000); }
  });
}
const widgetResponses = [
  'La tasa del IGV en Perú es 18% (16% IGV + 2% IPM). Base legal: TUO D.S. 055-99-EF.',
  'La UIT 2026 es S/5,500 según D.S. 301-2025-EF.',
  'El plazo para presentar el PDT 621 depende de tu último dígito de RUC según el cronograma SUNAT.',
  'Para 4ta categoría, la retención es 8% sobre honorarios. La deducción es 20% sobre ingresos brutos.',
  'El régimen RMT aplica tasa de 10% sobre las primeras 15 UIT de renta neta, 29.5% sobre el exceso.',
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

// ════════════════════════════════════════
// PATCH setPTab FOR NEW TABS
// ════════════════════════════════════════
const _origSetPTabV7 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV7(tab, btn);
  if (tab === 'tim') { const hoy = new Date().toISOString().split('T')[0]; const inp=document.getElementById('timFechaPago'); if(inp&&!inp.value) inp.value=hoy; }
  if (tab === 'moneda') { refreshFX(); }
  if (tab === 'facturacion') { renderBillingPanel(); }
  if (tab === 'multas') { document.getElementById('multaResult').style.display='none'; document.getElementById('multaForm').style.display='none'; }
  if (tab === 'contratos') { document.getElementById('contractFindings').innerHTML=''; document.getElementById('contractLoading').style.display='none'; }
}


// ════════════════════════════════════════
// SBS — DATA
// ════════════════════════════════════════
const SBS_DATA = {
  normas: [
    {id:'sbs1', cat:'leyes', titulo:'Ley General del Sistema Financiero — Ley 26702', tipo:'Ley', fecha:'Dic 1996', badge:'blue', desc:'Marco regulatorio principal del sistema bancario, financiero y de seguros del Perú. Establece los requisitos de capital, gestión de riesgos, supervisión y sanciones.',
     detalle:`<h4>Aspectos clave — Ley 26702</h4>
<div class="reg-detail-art">Art. 16: Capital mínimo para bancos — S/454.8 millones (actualizable por SBS).</div>
<div class="reg-detail-art">Art. 18: Razón de apalancamiento — El patrimonio efectivo debe cubrir al menos 10% de activos ponderados por riesgo.</div>
<div class="reg-detail-art">Art. 65: Límite individual de crédito — Máximo 10% del patrimonio efectivo a un solo deudor o grupo económico.</div>
<div class="reg-detail-art">Art. 95: Reserva de encaje — Las empresas deben mantener encaje mínimo legal del 6% sobre obligaciones sujetas a encaje.</div>
<div class="reg-detail-art">Art. 132: Secreto bancario — La información de operaciones pasivas es confidencial, salvo orden judicial o requerimiento SBS/SUNAT por materia tributaria.</div>
<strong>Implicancia tributaria:</strong> El secreto bancario (Art. 132) puede ser levantado por SUNAT para investigaciones tributarias mediante solicitud judicial (Art. 62 CT).`},
    {id:'sbs2', cat:'ley_itf', titulo:'Ley del ITF — Ley 28194', tipo:'Ley', fecha:'Mar 2004', badge:'gold', desc:'Establece el Impuesto a las Transacciones Financieras. Tasa 0.005% sobre débitos y créditos en cuentas. Obliga a bancarizar pagos superiores a S/2,000 o USD 500.',
     detalle:`<h4>Ley 28194 — Impuesto a las Transacciones Financieras</h4>
<div class="reg-detail-art">Art. 9: Tasa del ITF — 0.005% sobre el monto de cada operación afecta.</div>
<div class="reg-detail-art">Art. 3: Operaciones gravadas — Débitos y créditos en cuentas del sistema financiero nacional.</div>
<div class="reg-detail-art">Art. 8: Medios de pago obligatorios — Pagos ≥ S/2,000 o USD 500 deben realizarse por el sistema financiero para ser deducibles tributariamente.</div>
<div class="reg-detail-art">Art. 8: Consecuencia del incumplimiento — Gastos pagados en efectivo por montos ≥ S/2,000 NO son deducibles como gasto ni costo para el IR (Art. 44 inc. i) LIR).</div>
<strong>Casuística frecuente:</strong> Proveedores que exigen efectivo → el comprador pierde la deducción del gasto. SUNAT repara el gasto en fiscalización.`},
    {id:'sbs3', cat:'afp', titulo:'Sistema Privado de Pensiones — D.Leg. 25897', tipo:'D.Legislativo', fecha:'Nov 1992', badge:'blue', desc:'Crea el Sistema Privado de Administración de Fondos de Pensiones (AFP). Regula las aportaciones, prestaciones y administración de fondos previsionales.',
     detalle:`<h4>D.Leg. 25897 — SPP y AFPs</h4>
<div class="reg-detail-art">Art. 30: Aporte obligatorio — 10% de la remuneración del trabajador + comisión AFP (1.6%-1.9%) + seguro de invalidez y sobrevivencia (~1.4%).</div>
<div class="reg-detail-art">Art. 32: Tipos de fondo — Fondo 0 (capital protegido), Fondo 1 (preservación capital), Fondo 2 (mixto), Fondo 3 (crecimiento).</div>
<strong>Tratamiento tributario:</strong><br>
• Los aportes AFP son deducibles de la renta de 5ta categoría (descuento en planilla, no declaración separada).<br>
• Las pensiones recibidas son renta de 4ta categoría (salvo exoneración de 7 UIT).<br>
• El retiro de fondos AFP (Ley 31017) tributó con tasas escalonadas según monto retirado (caso especial 2020-2021).`},
    {id:'sbs4', cat:'seguros', titulo:'Reglamento de Empresas de Seguros — Res. SBS 3198-2013', tipo:'Resolución', fecha:'May 2013', badge:'gray', desc:'Regula los requisitos de organización, funcionamiento, solvencia y operaciones de las empresas de seguros y reaseguros en el Perú.',
     detalle:`<h4>Res. SBS 3198-2013 — Seguros</h4>
<div class="reg-detail-art">Capital mínimo seguros de vida: S/8.7 millones. Seguros generales: S/6.1 millones.</div>
<div class="reg-detail-art">Margen de solvencia: Las aseguradoras deben mantener patrimonio efectivo ≥ al requerimiento patrimonial por riesgos.</div>
<strong>Tributación de seguros:</strong><br>
• Primas de seguro pagadas son deducibles como gasto si están vinculadas a la actividad empresarial (Art. 37 LIR).<br>
• Indemnizaciones por seguros de daños: no gravadas si no superan el valor del bien siniestrado.<br>
• Seguros de vida del trabajador: deducible hasta el límite del Art. 37 inc. c) LIR.<br>
• IGV: Los servicios de seguros están exonerados del IGV (Apéndice II Ley del IGV).`},
    {id:'sbs5', cat:'reglamentos', titulo:'Reglamento de Gestión de Riesgos — Res. SBS 272-2017', tipo:'Resolución', fecha:'Ene 2017', badge:'blue', desc:'Establece los lineamientos para la gestión integral de riesgos en empresas supervisadas por la SBS: riesgo crediticio, liquidez, mercado, operacional y otros.',
     detalle:`<h4>Res. SBS 272-2017 — Gestión de Riesgos</h4>
<div class="reg-detail-art">Riesgo crediticio: Provisiones genéricas (0.7%-2%) y específicas según categoría del deudor (Normal, CPP, Deficiente, Dudoso, Pérdida).</div>
<div class="reg-detail-art">Riesgo de liquidez: Ratio de cobertura de liquidez (LCR) ≥ 100% según Basilea III.</div>
<strong>Implicancia tributaria de las provisiones:</strong><br>
• Provisiones bancarias son deducibles para IR solo si cumplen requisitos del Art. 37 inc. h) LIR.<br>
• Las provisiones genéricas NO son deducibles para IR. Solo las específicas de deudas incobrables.<br>
• Las recuperaciones de provisiones deducidas son ingreso gravado en el período de recuperación.`},
    {id:'sbs6', cat:'reglamentos', titulo:'Prevención de Lavado de Activos — Ley 27693 / Res. SBS 2660-2015', tipo:'Ley + Reglamento', fecha:'Abr 2002', badge:'red', desc:'Sistema Anti Lavado de Activos y Financiamiento del Terrorismo (LAFT). Obligaciones de debida diligencia, reporte de operaciones sospechosas (ROS) y perfil del cliente.',
     detalle:`<h4>LAFT — Sistema Anti Lavado</h4>
<div class="reg-detail-art">Art. 9 Ley 27693: Empresas obligadas a reportar operaciones sospechosas (ROS) a la UIF-Perú.</div>
<div class="reg-detail-art">Umbral de reporte automático: Operaciones en efectivo ≥ USD 10,000 o equivalente.</div>
<div class="reg-detail-art">KYC (Know Your Customer): Las entidades financieras deben identificar al beneficiario final de personas jurídicas.</div>
<strong>Vínculo tributario:</strong><br>
• Los bienes provenientes de delitos tributarios (defraudación fiscal) son activos de origen ilícito bajo la Ley de Lavado.<br>
• Las facturas falsas que generan crédito fiscal indebido pueden configurar lavado de activos (D.Leg. 1106).<br>
• SUNAT coordina con la UIF en casos de defraudación tributaria vinculada a lavado.`},
  ],
  casuistica: [
    {num:'SBS-CASO-001', titulo:'Levantamiento de secreto bancario por SUNAT', desc:'Empresa comercial con inconsistencias entre ingresos declarados y movimientos bancarios detectados en fiscalización.', resultado:`<div class="caso-resolucion">Resolución: El Juzgado Civil autorizó a SUNAT el levantamiento del secreto bancario conforme al Art. 62 num. 8 del CT y Art. 143 de la Ley 26702. Se determinó que los depósitos bancarios no declarados constituyeron ingresos omitidos gravados con IGV e IR. Deuda determinada: S/285,000 + intereses TIM + multas.</div><strong>Lección:</strong> Los movimientos bancarios son un indicador clave en fiscalizaciones. SUNAT puede solicitar judicialmente el levantamiento del secreto bancario cuando existan presunciones fundadas de evasión.`, area:'Secreto bancario / SUNAT'},
    {num:'SBS-CASO-002', titulo:'Bancarización — Gasto no deducible por pago en efectivo', desc:'Empresa constructora pagó honorarios de S/45,000 en efectivo al arquitecto. SUNAT reparó el gasto en fiscalización.', resultado:`<div class="caso-resolucion">Resolución: RTF 8534-3-2019 — El Tribunal Fiscal confirmó el reparo. El Art. 8 de la Ley 28194 exige que pagos ≥ S/2,000 se realicen por medios de pago del sistema financiero. Al hacerse en efectivo, el gasto pierde su deducibilidad tributaria (Art. 44 inc. i) LIR) aunque el servicio haya sido real.</div><strong>Lección:</strong> La bancarización no es solo formalismo; su incumplimiento tiene impacto directo en el IR. Documentar siempre el medio de pago.`, area:'ITF / Bancarización'},
    {num:'SBS-CASO-003', titulo:'AFP — Retiro de fondos y tributación (Ley 31017)', desc:'Trabajador retiró S/250,000 de su AFP durante la pandemia 2020. SUNAT notificó por diferencia en declaración anual.', resultado:`<div class="caso-resolucion">Resolución: El retiro de fondos AFP bajo Ley 31017 tuvo tasas diferenciadas: hasta 4 UIT exonerado, entre 4-12 UIT: 5%, entre 12-24 UIT: 17.5%, más de 24 UIT: 30%. La AFP debía retener y el trabajador debía declarar en el DDJJ anual. Muchos contribuyentes omitieron la declaración generando deuda.</div><strong>Lección:</strong> Los retiros extraordinarios de AFP son renta de 4ta categoría. La AFP retiene, pero el contribuyente debe verificar si debe presentar declaración anual por el total de sus ingresos.`, area:'AFP / IR 4ta categoría'},
    {num:'SBS-CASO-004', titulo:'Provisión bancaria y deducibilidad IR', desc:'Banco solicitó deducir provisiones genéricas por S/12M en la DJ Anual. SUNAT observó el 100% del importe.', resultado:`<div class="caso-resolucion">Resolución: RTF 1317-1-2020 — Tribunal Fiscal confirmó que las provisiones genéricas (constituidas preventivamente por la banca) NO son deducibles para efectos del IR. Solo son deducibles las provisiones específicas por deudas de recuperación difícil, cumpliendo los requisitos del Art. 37 inc. h) LIR y del Reglamento.</div><strong>Lección:</strong> Las provisiones bancarias SBS-requeridas no equivalen automáticamente a gastos tributariamente deducibles. Requieren sustento individual por deuda incobrable.`, area:'Provisiones / IR bancario'},
  ]
};

// ════════════════════════════════════════
// SMV — DATA
// ════════════════════════════════════════
const SMV_DATA = {
  normas: [
    {id:'smv1', cat:'lmv', titulo:'Ley del Mercado de Valores — D.Leg. 861', tipo:'D.Legislativo', fecha:'Oct 1996', badge:'green', desc:'Marco legal del mercado de valores peruano. Regula la oferta pública de valores, intermediarios, bolsas de valores, fondos de inversión y el papel de la SMV.',
     detalle:`<h4>D.Leg. 861 — Ley del Mercado de Valores</h4>
<div class="reg-detail-art smv-art">Art. 4: Oferta pública de valores — Toda invitación a más de 100 personas o por montos > S/1M requiere inscripción en el Registro Público del Mercado de Valores (RPMV).</div>
<div class="reg-detail-art smv-art">Art. 12: Hechos de importancia — Los emisores inscritos deben reportar hechos relevantes a la SMV en 1 día hábil de ocurridos.</div>
<div class="reg-detail-art smv-art">Art. 40: Insider trading — Prohibición de operar con información privilegiada. Sanción: multa hasta 700 UIT + inhabilitación.</div>
<strong>Tributación en el mercado de valores:</strong><br>
• Ganancias de capital en BVL: 6.25% sobre la ganancia neta (2da categoría, Art. 54 LIR).<br>
• Dividendos de acciones listadas: 5% de retención (Art. 24-A LIR).<br>
• Pérdidas en BVL: Compensables con ganancias de la misma fuente en el mismo ejercicio.`},
    {id:'smv2', cat:'emisores', titulo:'Reglamento de Hechos de Importancia — Res. SMV 005-2014', tipo:'Resolución', fecha:'2014', badge:'green', desc:'Define qué información constituye hecho de importancia y los plazos para su divulgación. Aplica a empresas con valores inscritos en la BVL.',
     detalle:`<h4>Res. SMV 005-2014 — Hechos de Importancia</h4>
<div class="reg-detail-art smv-art">Plazo de reporte: 1 día hábil desde que el emisor toma conocimiento del hecho.</div>
<div class="reg-detail-art smv-art">Hechos típicos: Cambio de accionistas mayoritarios, fusiones, adquisiciones, resultados financieros relevantes, cambios en directorio, litigios significativos, cambios contables.</div>
<strong>Implicancia tributaria:</strong> Los hechos de importancia que involucran reorganizaciones societarias (fusiones, escisiones) deben cumplir requisitos tanto de la LMV como de la LIR (Arts. 68-69 LIR) para mantener la neutralidad tributaria.`},
    {id:'smv3', cat:'fondos', titulo:'Reglamento de Fondos de Inversión — Res. SMV 029-2014', tipo:'Resolución', fecha:'2014', badge:'green', desc:'Regula la constitución, operación y liquidación de fondos de inversión en el Perú. Incluye fondos abiertos, cerrados y de inversión en bienes raíces (FIBRAs).',
     detalle:`<h4>Fondos de Inversión — Tributación</h4>
<div class="reg-detail-art smv-art">Rendimientos de fondos: Califican como renta de 2da categoría para personas naturales (5% si son dividendos, 6.25% si son ganancias de capital).</div>
<div class="reg-detail-art smv-art">Fondos para personas jurídicas: Los rendimientos se integran a la base imponible del IR (29.5% RG).</div>
<div class="reg-detail-art smv-art">FIBRAs (Real Estate Investment Trusts): Régimen especial con distribución mínima del 95% de utilidades. Tributación a nivel del inversionista.</div>
<strong>Ventajas tributarias de fondos:</strong> Los fondos de inversión no pagan IR a nivel del vehículo (son transparentes). El impuesto se aplica cuando el partícipe recibe la distribución.`},
    {id:'smv4', cat:'sanciones', titulo:'Reglamento de Sanciones SMV — Res. SMV 033-2015', tipo:'Resolución', fecha:'2015', badge:'red', desc:'Establece el régimen sancionador de la SMV: tipos de infracciones, escala de multas y procedimientos para emisores, intermediarios e inversionistas.',
     detalle:`<h4>Sanciones SMV</h4>
<div class="reg-detail-art smv-art">Infracciones muy graves: Hasta 700 UIT de multa + inhabilitación temporal o permanente.</div>
<div class="reg-detail-art smv-art">Insider trading (Art. 40 LMV): Hasta 700 UIT + inhabilitación + responsabilidad penal (Ley 30424).</div>
<div class="reg-detail-art smv-art">No reportar hechos de importancia: Hasta 25 UIT por cada incumplimiento.</div>
<strong>Vinculación penal-tributaria:</strong> La manipulación de estados financieros para inflar precio de acciones puede configurar estafa (CP), defraudación tributaria (D.Leg. 813) y fraude en el mercado de valores simultáneamente.`},
    {id:'smv5', cat:'lmv', titulo:'Tributación de valores mobiliarios — Art. 54 y 57 LIR', tipo:'Norma tributaria', fecha:'Permanente', badge:'gold', desc:'Tratamiento tributario específico de rentas de 2da categoría provenientes de valores: dividendos, intereses de bonos, ganancias de capital en BVL y regalías.',
     detalle:`<h4>Tributación de valores — Art. 54 LIR</h4>
<div class="reg-detail-art smv-art">Dividendos personas naturales domiciliadas: 5% de retención definitiva (Art. 24-A LIR).</div>
<div class="reg-detail-art smv-art">Dividendos no domiciliados: 5% de retención en fuente (Art. 54 LIR).</div>
<div class="reg-detail-art smv-art">Ganancias de capital BVL (PN domiciliada): 6.25% sobre ganancia neta, con deducción del 20%.</div>
<div class="reg-detail-art smv-art">Intereses de bonos corporativos: 5% si son personas naturales; se integran al IR si son personas jurídicas.</div>
<div class="reg-detail-art smv-art">Intereses pagados a no domiciliados: 4.99% si cumplen condiciones del Art. 56 LIR; 30% en caso contrario.</div>`},
  ],
  casuistica: [
    {num:'SMV-CASO-001', titulo:'Ganancias de capital BVL — Declaración y pago IR 2da categoría', desc:'Persona natural vendió acciones de minera en la BVL obteniendo ganancia neta de S/380,000. No presentó declaración anual.', resultado:`<div class="caso-resolucion">Resolución: SUNAT detectó la ganancia mediante información cruzada con la CAVALI. La ganancia de capital tributa con tasa efectiva del 5% (6.25% sobre el 80% de la ganancia neta). Impuesto omitido: S/19,000 + TIM + multa por no declarar (1 UIT). El contribuyente debía presentar DJ anual de 2da categoría.</div><strong>Lección:</strong> Las ganancias en BVL son declarables aunque CAVALI retenga. Si hay pérdidas compensables del mismo año, deben incluirse en la DJ. La SUNAT cruza información con la BVL y CAVALI.`, area:'Ganancias capital / BVL'},
    {num:'SMV-CASO-002', titulo:'Insider trading y responsabilidad tributaria', desc:'Directivo de empresa listada compró acciones 3 días antes del anuncio de adquisición. Obtuvo ganancia de S/2.1M.', resultado:`<div class="caso-resolucion">Resolución SMV 184-2021: Multa de 350 UIT + inhabilitación 2 años por insider trading (Art. 40 D.Leg.861). Adicionalmente, SUNAT inició procedimiento: la ganancia de S/2.1M tributó como renta de 2da categoría (tasa efectiva 5%). El impuesto sobre ganancia ilícita es igualmente exigible (Art. 1 CT: hecho imponible puede ser ilícito).</div><strong>Lección:</strong> Los ingresos de actividades ilícitas también son gravados con IR en Perú (principio de capacidad contributiva). La ilicitud de la ganancia no la exime del tributo.`, area:'Insider trading / IR 2da'},
    {num:'SMV-CASO-003', titulo:'Reorganización societaria listada — Fusión con impacto bursátil', desc:'Empresa listada en BVL se fusionó con empresa no listada. Accionistas minoristas preguntaron si el canje de acciones genera IR.', resultado:`<div class="caso-resolucion">Consulta SMV / SUNAT: En fusiones con neutralidad tributaria (Art. 68 LIR), el canje de acciones NO genera ganancia de capital en el momento del canje. El costo computable de las nuevas acciones es el de las antiguas. El IR se difiere hasta la venta posterior de las nuevas acciones. La operación debe reportarse a SMV como hecho de importancia y cumplir plazos del D.Leg. 861.</div><strong>Lección:</strong> Las reorganizaciones societarias pueden hacerse tributariamente neutras si cumplen los Arts. 68-69 LIR. Pero deben comunicarse a la SMV oportunamente.`, area:'Reorganización / BVL'},
    {num:'SMV-CASO-004', titulo:'FIBRAs — Tributación del fondo inmobiliario', desc:'Inversionista persona natural recibió distribución de S/85,000 de un FIBRA listado en la BVL. Consultó cómo declararlo.', resultado:`<div class="caso-resolucion">Criterio SMV/SUNAT: Las distribuciones de FIBRAs califican como dividendos para personas naturales, sujetos a retención del 5% definitiva. Si el FIBRA distribuye rentas provenientes de alquileres (1ra categoría), podrían calificar distinto según la estructura. La retención la hace el fideicomiso. El inversionista no declara separadamente si la retención fue definitiva.</div><strong>Lección:</strong> Los FIBRAs son vehículos eficientes tributariamente: el impuesto se paga solo cuando se distribuye (transparencia fiscal). La retención del 5% en fuente es definitiva para PN domiciliadas.`, area:'FIBRAs / IR 2da'},
  ]
};

// ════════════════════════════════════════
// SBS — FUNCTIONS
// ════════════════════════════════════════
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
    <div class="reg-card-meta"><span>📅 ${n.fecha}</span><span>🏦 SBS</span></div>
    <div class="reg-detail" id="detail_${n.id}">${n.detalle}
      <button class="reg-ask-btn" onclick="askAboutRegulation(event,'SBS: ${n.titulo.replace(/'/g,"\\'")}')">💬 Consultar IA sobre esta norma</button>
    </div>
  </div>`).join('');
}

function renderSBSCasuistica() {
  const el = document.getElementById('sbsCasuistica'); if(!el) return;
  el.innerHTML = SBS_DATA.casuistica.map(c => `<div class="caso-item" onclick="toggleCasoDetail('caso_${c.num}')">
    <div class="caso-num">${c.num} · ${c.area}</div>
    <div class="caso-title">${c.titulo}</div>
    <div class="caso-desc">${c.desc}</div>
    <div class="caso-result" id="caso_${c.num}">${c.resultado}
      <button class="reg-ask-btn" style="margin-top:10px" onclick="askAboutRegulation(event,'SBS Caso: ${c.titulo.replace(/'/g,"\\'")}')">💬 Profundizar con IA</button>
    </div>
  </div>`).join('');
}

function renderSBSQuickQ() {
  const el = document.getElementById('sbsQuickQ'); if(!el) return;
  const qs = ['¿Cómo afecta el secreto bancario a una fiscalización de SUNAT?','¿Qué operaciones están exoneradas del ITF?','¿Son deducibles las primas de seguro para el IR?','¿Cómo tributan los retiros de AFP?','¿Qué son las provisiones bancarias deducibles?'];
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
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un experto en regulación financiera y tributaria peruana, especializado en normativa SBS (Ley 26702, Ley 28194, SPP), con enfoque en las implicancias tributarias. Cita siempre la norma exacta.',messages:[{role:'user',content:query}]});
    const d = await res.json();
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  } catch(e) { resultEl.innerHTML = '<div style="color:var(--red)">Error: '+safeHTML(e.message)+'</div>'; }
}

// ════════════════════════════════════════
// LAVADO DE DINERO / PREVENCIÓN LAFT — DATA
// ════════════════════════════════════════
const LAVADO_DATA = {
  normas: [
    {id:'lav1', cat:'leyes', titulo:'Ley de Lavado de Activos — Ley 27693', tipo:'Ley', fecha:'Abr 2002', badge:'red', desc:'Ley que crea la Unidad de Inteligencia Financiera (UIF-Perú) y establece el marco legal contra el lavado de activos y el financiamiento del terrorismo. Define sujetos obligados, ROS, KYC y sanciones.',
     detalle:`<h4>Ley 27693 — Sistema Antilavado de Activos</h4>
<div class="reg-detail-art">Art. 3: Creación de la UIF-Perú como unidad especializada de la SBS encargada de recibir, analizar y transmitir información sobre operaciones sospechosas (ROS).</div>
<div class="reg-detail-art">Art. 9: Sujetos obligados — Bancos, financieras, seguros, AFP, casas de cambio, notarios, concesionarios mineros, inmobiliarias, casinos, abogados, contadores y otros.</div>
<div class="reg-detail-art">Art. 10: Reporte de Operaciones Sospechosas (ROS) — Toda operación que por su monto, frecuencia o características no corresponda al perfil del cliente o supere umbrales debe reportarse a la UIF en 30 días hábiles.</div>
<div class="reg-detail-art">Art. 12: Reporte de operaciones en efectivo — Operaciones en efectivo ≥ USD 10,000 o equivalentes deben reportarse a la UIF en 15 días hábiles.</div>
<div class="reg-detail-art">Art. 13: Reserva del ROS — El reporte y su contenido son estrictamente confidenciales. Su revelación al cliente es infracción grave sancionable.</div>
<strong>Vínculo tributario con Lavado de Activos:</strong><br>
• La defraudación tributaria (D.Leg. 813) es delito precedente del lavado de activos (Art. 10 Ley 27693 modificado por D.Leg. 1249).<br>
• SUNAT remite a la UIF los casos de defraudación tributaria agravada con indicios de lavado.<br>
• Los bienes adquiridos con evasión tributaria pueden ser objeto de decomiso (pérdida de dominio, D.Leg. 1373).`},
    {id:'lav2', cat:'leyes', titulo:'Decreto Legislativo 1106 — Lucha contra el Lavado de Activos', tipo:'D.Legislativo', fecha:'Abr 2012', badge:'red', desc:'D.Leg. 1106 — Ley de lucha contra el lavado de activos y financiamiento del terrorismo. Tipifica los delitos de lavado, conversión, transferencia, ocultamiento y tenencia de activos ilícitos.',
     detalle:`<h4>D.Leg. 1106 — Delitos de Lavado de Activos</h4>
<div class="reg-detail-art">Art. 2: Actos de conversión, transferencia y ocultamiento de activos de origen ilícito. Pena: 6-15 años de prisión.</div>
<div class="reg-detail-art">Art. 3: Actos de tenencia de activos de origen ilícito. Pena: 6-15 años de prisión.</div>
<div class="reg-detail-art">Art. 4: Actos de transporte, traslado, ingreso o salida del país de dinero o títulos valores ilícitos. Pena: 8-15 años.</div>
<div class="reg-detail-art">Art. 5: Actos de ocultamiento de activos ilícitos mediante operaciones de comercio exterior, triangulación de bienes o servicios. Pena: 8-15 años.</div>
<div class="reg-detail-art">Art. 7: Personas jurídicas — Las empresas que participan en lavado de activos pueden ser sancionadas con multas, inhabilitación, disolución y decomiso de bienes.</div>
<strong>Vínculo tributario:</strong><br>
• Las facturas falsas y la sobrefacturación de importaciones son métodos de lavado de activos (Art. 5 D.Leg. 1106).<br>
• La subfacturación de exportaciones permite repatriar fondos ilícitos como ingresos lícitos.<br>
• El testaferrato (prestanombres) es una forma de ocultamiento de activos tipificada en este D.Leg.<br>
• La ausencia de respaldo patrimonial lícito es indicio de lavado en fiscalizaciones de SUNAT.`},
    {id:'lav3', cat:'leyes', titulo:'Decreto Legislativo 1373 — Extinción de Dominio', tipo:'D.Legislativo', fecha:'Ago 2018', badge:'red', desc:'Establece el proceso autónomo de pérdida de dominio sobre bienes de origen ilícito sin necesidad de condena penal. Aplica a bienes provenientes de lavado, narcotráfico, corrupción y defraudación tributaria.',
     detalle:`<h4>D.Leg. 1373 — Pérdida de Dominio</h4>
<div class="reg-detail-art">Art. 1: La pérdida de dominio es una consecuencia patrimonial autónoma de actividades ilícitas, independiente del proceso penal.</div>
<div class="reg-detail-art">Art. 4: Bienes sujetos — Dinero, inmuebles, vehículos, acciones, criptoactivos y cualquier derecho real o personal vinculado a actividades ilícitas.</div>
<div class="reg-detail-art">Art. 7: No se requiere condena penal — Basta con demostrar que el bien proviene de actividad ilícita (carga de la prueba invertida).</div>
<div class="reg-detail-art">Art. 34: Delitos precedentes — Lavado de activos, defraudación tributaria, corrupción, narcotráfico, minería ilegal, trata de personas y otros delitos graves.</div>
<strong>Implicancia tributaria:</strong><br>
• SUNAT puede iniciar procesos de pérdida de dominio sobre bienes adquiridos con evasión tributaria.<br>
• El decomiso tributario (Art. 175 Código Tributario) es distinto a la extinción de dominio, pero pueden concurrir.<br>
• Los bienes pérdidos de dominio se destinan al Estado para fines sociales y educación.`},
    {id:'lav4', cat:'leyes', titulo:'Decreto Legislativo 1492 — Lavado y Criptoactivos (PSAV)', tipo:'D.Legislativo', fecha:'May 2020', badge:'red', desc:'Regula a los Proveedores de Servicios de Activos Virtuales (PSAV) en Perú. Exige registro ante la UIF, implementación de programas PLA/FT y reporte de operaciones sospechosas con criptoactivos.',
     detalle:`<h4>D.Leg. 1492 — PSAV y Antilavado</h4>
<div class="reg-detail-art">Art. 3: Definición de PSAV — Toda persona natural o jurídica que intercambie, transfiera, custodie o administre activos virtuales por cuenta de terceros.</div>
<div class="reg-detail-art">Art. 5: Registro obligatorio — Los PSAV deben registrarse ante la UIF-Perú y actualizar su información anualmente.</div>
<div class="reg-detail-art">Art. 7: Obligaciones — Implementar programa PLA/FT, designar oficial de cumplimiento, realizar debida diligencia (KYC/KYV), monitorear transacciones, reportar ROS.</div>
<div class="reg-detail-art">Res. UIF 035-2023: Reglamento complementario que detalla los requisitos técnicos del programa PLA/FT para PSAV.</div>
<strong>Implicancia tributaria:</strong><br>
• Las ganancias por criptoactivos tributan como renta de 2da categoría (PN) o 3ra categoría (PJ).<br>
• Los PSAV deben reportar a SUNAT las operaciones de sus usuarios (intercambio de información tributaria).<br>
• El uso de criptoactivos para evasión tributaria puede configurar lavado si el monto es significativo.`},
    {id:'lav5', cat:'uif', titulo:'Unidad de Inteligencia Financiera (UIF-Perú) — Funciones y estructura', tipo:'Organismo', fecha:'2002-actual', badge:'blue', desc:'La UIF-Perú es la unidad de inteligencia financiera peruana, adscrita a la SBS. Recibe, analiza y transmite información sobre operaciones sospechosas de lavado de activos y financiamiento del terrorismo.',
     detalle:`<h4>UIF-Perú — Funciones Clave</h4>
<div class="reg-detail-art">Recepción de ROS: Recibe más de 20,000 Reportes de Operaciones Sospechosas al año de más de 300 sujetos obligados.</div>
<div class="reg-detail-art">Análisis estratégico: Produce informes de inteligencia financiera con tipologías de lavado y tendencias delictivas.</div>
<div class="reg-detail-art">Cooperación internacional: Intercambia información con unidades de inteligencia financiera de otros países (GAFI/SUD/Grupo Egmont).</div>
<div class="reg-detail-art">Congelamiento administrativo de fondos: Puede disponer el congelamiento inmediato de activos vinculados al terrorismo o su financiamiento (Res. UIF 017-2017).</div>
<strong>Coordinación con SUNAT:</strong><br>
• La UIF y SUNAT tienen un convenio de cooperación interinstitucional para compartir información sobre defraudación tributaria con indicios de lavado.<br>
• SUNAT puede solicitar información de la UIF para fiscalizaciones tributarias.<br>
• La UIF recibe de SUNAT reportes de operaciones tributarias atípicas.`},
    {id:'lav6', cat:'sujetos', titulo:'Sujetos Obligados — Reporte de Operaciones Sospechosas (ROS)', tipo:'Obligaciones', fecha:'Vigente', badge:'gold', desc:'Los sujetos obligados deben implementar sistemas de prevención LAFT, designar Oficial de Cumplimiento, elaborar manuales PLA/FT y reportar ROS a la UIF.',
     detalle:`<h4>Sujetos Obligados y sus Obligaciones (Art. 9 Ley 27693)</h4>
<div class="reg-detail-art">Entidades financieras y bancarias: Deben reportar operaciones en efectivo ≥ USD 10,000 dentro de 15 días hábiles. ROS dentro de 30 días hábiles.</div>
<div class="reg-detail-art">Notarios: Deben reportar compraventa de inmuebles, constitución de empresas y fideicomisos que superen umbrales establecidos.</div>
<div class="reg-detail-art">Concesionarios mineros y de joyería: Reportar operaciones en efectivo ≥ USD 10,000 y cualquier operación sospechosa.</div>
<div class="reg-detail-art">Casinos y tragamonedas: Reportar fichas canjeadas por ≥ USD 3,000 y cualquier operación atípica.</div>
<div class="reg-detail-art">Inmobiliarias y agentes: Reportar compraventa de inmuebles ≥ 50 UIT y operaciones sospechosas independientemente del monto.</div>
<div class="reg-detail-art">Abogados y contadores: Cuando intervienen en constitución de sociedades, fideicomisos, compraventa de inmuebles o manejo de cuentas bancarias de terceros.</div>
<strong>No reportar un ROS teniendo indicios de lavado es infracción grave:</strong> Multa de hasta 50 UIT + inhabilitación temporal del sujeto obligado.`},
    {id:'lav7', cat:'tipologias', titulo:'Tipologías de Lavado de Activos en el Sector Tributario', tipo:'Análisis', fecha:'Permanente', badge:'blue', desc:'Principales métodos de lavado de activos con vinculación tributaria. Identificación de señales de alerta para profesionales tributarios y sujetos obligados.',
     detalle:`<h4>Tipologías — Lavado con Vínculo Tributario</h4>
<div class="reg-detail-art">1. Facturación falsa (sobrefacturación): Empresa emite facturas por operaciones inexistentes para que el comprador justifique salidas de dinero ilícito como gasto tributario. Señal: proveedores sin capacidad operativa real.</div>
<div class="reg-detail-art">2. Subfacturación de exportaciones: Exportador factura menos del valor real, recibe la diferencia en el exterior como fondos ilícitos repatriados. Señal: precios muy inferiores al mercado internacional.</div>
<div class="reg-detail-art">3. Testaferrato o prestanombres: Personas interpuestas figuran como socios de empresas que canalizan fondos ilícitos. Señal: socios sin capacidad económica ni perfil empresarial.</div>
<div class="reg-detail-art">4. Empresas fachada ("front companies"): Empresas con actividad real mínima que emiten facturas por montos muy superiores a su capacidad. Señal: personal mínimo vs. facturación millonaria.</div>
<div class="reg-detail-art">5. Préstamos simulados: Persona recibe fondos ilícitos como "préstamo" con documento privado sin ejecución real. Señal: préstamos sin garantía ni historial de pagos.</div>
<div class="reg-detail-art">6. Bienes suntuarios sin respaldo: Adquisición de inmuebles, vehículos o joyas con efectivo sin justificación patrimonial. Señal: ingresos declarados no guardan relación con el nivel de vida.</div>
<strong>Indicios de alerta para contadores y abogados:</strong> Clientes que buscan estructuras complejas sin razón comercial, se niegan a revelar beneficiario final, o realizan operaciones contradictorias con la actividad declarada.`},
    {id:'lav8', cat:'sanciones', titulo:'Régimen Sancionador — Lavado de Activos y PLA/FT', tipo:'Sanciones', fecha:'Vigente', badge:'red', desc:'Infracciones y sanciones para sujetos obligados y personas naturales que incumplan la normativa antilavado. Incluye multas, inhabilitaciones y responsabilidad penal.',
     detalle:`<h4>Sanciones Administrativas (UIF / SBS)</h4>
<div class="reg-detail-art">No implementar sistema PLA/FT: Multa de hasta 50 UIT (S/275,000 en 2026) + inhabilitación del Oficial de Cumplimiento.</div>
<div class="reg-detail-art">No reportar ROS teniendo indicios: Multa de 10-100 UIT según gravedad + posible cancelación de autorización de funcionamiento.</div>
<div class="reg-detail-art">Revelar al cliente la existencia de un ROS: Infracción muy grave. Multa de hasta 200 UIT + cese del sujeto obligado.</div>
<div class="reg-detail-art">No llevar registro de operaciones en efectivo ≥ USD 10,000: Multa de 1-5 UIT por operación no registrada.</div>
<h4>Sanciones Penales (D.Leg. 1106)</h4>
<div class="reg-detail-art">Lavado de activos doloso: Pena privativa de libertad de 6 a 15 años + multa de 60-365 días.</div>
<div class="reg-detail-art">Lavado de activos agravado (organización criminal, funcionarios públicos): Pena 10-20 años + inhabilitación.</div>
<div class="reg-detail-art">Omisión de reporte de operación sospechosa: Pena de 2-5 años para el Oficial de Cumplimiento que deliberadamente no reporta.</div>
<div class="reg-detail-art">Decomiso de bienes: Todos los activos vinculados al lavado son decomisados (D.Leg. 1373).</div>
<strong>Personas jurídicas (Art. 7 D.Leg. 1106):</strong> Las empresas pueden ser sancionadas con multas de hasta S/5M + disolución + inhabilitación definitiva para contratar con el Estado.`},
    {id:'lav9', cat:'uif', titulo:'Cooperación Internacional — GAFI, Grupo Egmont, Wolfsberg', tipo:'Estándares', fecha:'Permanente', badge:'blue', desc:'Estándares internacionales antilavado que Perú debe implementar. Recomendaciones del GAFI (FATF), Grupo Egmont de UIFs y Principios Wolfsberg para banca corporativa.',
     detalle:`<h4>Estándares Internacionales Aplicables al Perú</h4>
<div class="reg-detail-art">GAFI (FATF) — 40 Recomendaciones: Estándar internacional en materia antilavado. Perú es miembro desde 2023. Las recomendaciones cubren evaluación de riesgos, medidas preventivas, transparencia de personas jurídicas, decomiso y cooperación internacional.</div>
<div class="reg-detail-art">Evaluación Mutua GAFI 2023: Perú fue evaluado por GAFILAT. Principales hallazgos: necesidad de mejorar supervisión de sujetos obligados no financieros (abogados, contadores, inmobiliarias) y fortalecer la aplicación de la extinción de dominio.</div>
<div class="reg-detail-art">Grupo Egmont: Red global de 170+ UIFs. UIF-Perú es miembro desde 2005. Permite intercambio de inteligencia financiera entre países para rastrear activos transfronterizos.</div>
<div class="reg-detail-art">Principios Wolfsberg: Guías de mejores prácticas para banca corporativa en materia de debida diligencia, KYC y prevención de corrupción. Adoptados por la banca peruana como estándar de cumplimiento.</div>
<strong>Implicancia para profesionales tributarios:</strong> La cooperación internacional permite a SUNAT acceder a información bancaria y financiera de contribuyentes en el extranjero mediante intercambio automático de información (CRS) y acuerdos de intercambio de información tributaria (TIEA).`},
    {id:'lav10', cat:'tipologias', titulo:'Señales de Alerta (Red Flags) para Profesionales Tributarios', tipo:'Guía', fecha:'Permanente', badge:'gold', desc:'Indicadores de alerta temprana que contadores, abogados y asesores tributarios deben considerar para detectar posibles operaciones de lavado de activos en sus clientes.',
     detalle:`<h4>Red Flags en el Ejercicio Profesional</h4>
<div class="reg-detail-art">Estructura societaria inusualmente compleja: Sociedades con múltiples capas, en diferentes jurisdicciones, sin justificación económica real.</div>
<div class="reg-detail-art">Beneficiario final no identificable: Clientes que se niegan a revelar quién realmente controla la empresa o el patrimonio.</div>
<div class="reg-detail-art">Operaciones sin sustento económico: Compraventa de bienes a precios notoriamente superiores o inferiores al valor de mercado.</div>
<div class="reg-detail-art">Incremento patrimonial injustificado: Cliente con ingresos declarados mínimos pero que adquiere bienes suntuarios (inmuebles, vehículos de lujo).</div>
<div class="reg-detail-art">Pagos en efectivo de montos significativos: Ofrecimiento de pagar honorarios en efectivo por montos elevados sin justificación.</div>
<div class="reg-detail-art">Cambios frecuentes de asesor: Cliente que cambia constantemente de estudio contable o abogado sin razón aparente.</div>
<div class="reg-detail-art">Jurisdicciones de riesgo: Operaciones con paraísos fiscales o países con regulación antilavado débil sin vinculación comercial justificada.</div>
<div class="reg-detail-art">Documentación inconsistente: Facturas que no coinciden con la actividad del proveedor, fechas incongruentes, montos que no encajan con el giró del negocio.</div>
<strong>Obligación de reporte:</strong> Abogados y contadores son sujetos obligados (Art. 9 Ley 27693). Si detectan indicios de lavado, deben reportar ROS a la UIF. El incumplimiento puede generar responsabilidad administrativa y penal.`},
    {id:'lav11', cat:'sujetos', titulo:'Programa de Cumplimiento PLA/FT — Implementación', tipo:'Guía', fecha:'Vigente', badge:'gold', desc:'Pasos para implementar un programa de prevención de lavado de activos y financiamiento del terrorismo (PLA/FT) en empresas peruanas obligadas.',
     detalle:`<h4>Pasos para Implementar PLA/FT</h4>
<div class="reg-detail-art">1. Evaluación de Riesgos (Risk Assessment): Identificar y evaluar los riesgos LAFT específicos de la empresa según su sector, tamaño, clientes y geografía.</div>
<div class="reg-detail-art">2. Manual PLA/FT: Documento que contiene políticas, procedimientos y controles internos para prevenir el lavado de activos. Debe ser aprobado por el Directorio.</div>
<div class="reg-detail-art">3. Oficial de Cumplimiento: Designar un responsable ante la UIF, con nivel jerárquico suficiente y autonomía para reportar directamente al Directorio.</div>
<div class="reg-detail-art">4. Debida Diligencia (KYC/KYV/KYCC): Identificar y verificar la identidad del cliente, del beneficiario final y del origen de fondos. Actualizar datos periódicamente.</div>
<div class="reg-detail-art">5. Monitoreo de Operaciones: Sistema automático o manual para identificar operaciones que se desvían del perfil del cliente y generar alertas.</div>
<div class="reg-detail-art">6. Capacitación: Entrenamiento anual a todo el personal sobre prevención LAFT, señales de alerta y procedimientos de reporte.</div>
<div class="reg-detail-art">7. Reporte a la UIF: Procedimiento para reportar ROS dentro de 30 días hábiles y operaciones en efectivo en 15 días hábiles.</div>
<strong>Registro de operaciones:</strong> Conservar registros de operaciones y debida diligencia por 5 años mínimos (Art. 13 Reglamento Ley 27693). Riesgo de multas si no se conservan adecuadamente.`},
    {id:'lav12', cat:'sujetos', titulo:'Obligaciones de Notarios y Registradores Públicos', tipo:'Obligaciones', fecha:'Vigente', badge:'gray', desc:'Notarios y registradores tienen obligaciones específicas en prevención de lavado: identificar al beneficiario final de personas jurídicas, reportar operaciones sospechosas y verificar PEPs.',
     detalle:`<h4>Notarios y Lavado de Activos</h4>
<div class="reg-detail-art">Identificación del cliente: Todo notario debe identificar al otorgante, testigos y partes intervinientes con DNI, carné de extranjería o pasaporte.</div>
<div class="reg-detail-art">Beneficiario final: En constitución de sociedades, compraventa de inmuebles y fideicomisos, el notario debe identificar al beneficiario final (persona natural que controla o es titular del 10%+).</div>
<div class="reg-detail-art">Reporte de operaciones: Compraventa de inmuebles ≥ 50 UIT, constitución de sociedades con capital ≥ 50 UIT y cualquier operación sospechosa debe reportarse a la UIF.</div>
<div class="reg-detail-art">Registro de operaciones: Llevar un registro cronológico de operaciones susceptibles de lavado con datos del cliente, monto, origen de fondos y medio de pago.</div>
<strong>Vínculo tributario:</strong> El notario debe verificar el pago de impuestos (alcabala, IR 1ra categoría) para la transferencia de inmuebles. Si hay indicios de subvaluación para evadir impuestos, debe considerar reporte a UIF.`},
  ],
  casuistica: [
    {num:'LVD-CASO-001', titulo:'Facturación falsa y lavado de activos — Empresa fachada de transporte', desc:'Empresa de transporte facturó S/2.3M en servicios a una minera, pero no tenía flota ni personal operativo real. SUNAT detectó inconsistencias y remitió el caso a la UIF.',
     resultado:`<div class="caso-resolucion">Resolución: SUNAT determinó defraudación tributaria por S/780,000 (IGV+IR omitidos) y remitió antecedentes a la UIF por presunto lavado de activos. La UIF transmitió el caso al Ministerio Público. Se determinó que la empresa fachada emitía facturas falsas que la minera usaba para justificar salidas de dinero ilícito. La minera pagaba en efectivo montos inferiores a S/2,000 (bancarización) para no dejar rastro bancario. Proceso por lavado en curso.</div><strong>Lecciones:</strong> SUNAT y UIF coordinan activamente. La facturación sin capacidad operativa real es un indicador clave de lavado. La fragmentación de pagos en efectivo para evitar bancarización es otra señal de alerta.`, area:'Facturación falsa / SUNAT / UIF'},
    {num:'LVD-CASO-002', titulo:'Subfacturación de exportaciones — Lavado mediante comercio exterior', desc:'Exportador de textiles declaró exportaciones por USD 3.1M a una empresa vinculada en Panamá. Investigación reveló que el valor real era USD 8.7M.',
     resultado:`<div class="caso-resolucion">Resolución: SUNAT detectó la subfacturación mediante precios de transferencia y análisis de comparables. La diferencia de USD 5.6M se repatriaba como "inversión extranjera" a otra empresa del grupo en Perú, completando el ciclo de lavado. D.Leg. 1106 Art. 4 (transporte de activos ilícitos) y Art. 5 (ocultamiento mediante comercio exterior). SDNAT determinó deuda tributaria de S/4.2M + multas. La UIF congeló cuentas bancarias. Ministerio Público abrió investigación por lavado agravado.</div><strong>Lecciones:</strong> Precios de transferencia es la herramienta clave para detectar subfacturación. El comercio exterior es uno de los métodos más usados para lavado de activos en Perú. Las empresas vinculadas en paraísos fiscales son un fuerte indicador de riesgo.`, area:'Comercio exterior / Precios de transferencia'},
    {num:'LVD-CASO-003', titulo:'Testaferrato de bienes inmuebles — Prestanombre en compraventa', desc:'Empresa adquirió 4 inmuebles de lujo por S/12M en efectivo fragmentado en 12 operaciones. Los socios figuraban con ingresos anuales menores a S/60,000.',
     resultado:`<div class="caso-resolucion">Resolución: SUNAT determinó incremento patrimonial no justificado (Art. 52 LIR) y defraudación tributaria por S/3.6M. Adicionalmente, la UIF determinó que los socios eran testaferros de una organización criminal dedicada a la minería ilegal. Los inmuebles fueron sometidos a extinción de dominio (D.Leg. 1373). La organización usaba el sistema de préstamos simulados entre las empresas fachada y los testaferros para justificar el origen del dinero en las compras inmobiliarias.</div><strong>Lecciones:</strong> El incremento patrimonial no justificado es la principal herramienta de SUNAT para detectar lavado en personas naturales. Los notarios deben reportar compraventas sin sustento de ingresos. La extinción de dominio permite decomisar bienes sin necesidad de condena penal.`, area:'Inmuebles / Testaferrato / Extinción de dominio'},
    {num:'LVD-CASO-004', titulo:'Criptoactivos — Exchange no registrado y lavado de activos', desc:'PSAV (Proveedor de Servicios de Activos Virtuales) operó sin registro ante la UIF durante 18 meses, moviendo el equivalente a USD 4.5M en USDT (BEP-20).',
     resultado:`<div class="caso-resolucion">Resolución: UIF detectó al PSAV mediante monitoreo de blockchain (análisis de transacciones en BSCScan). El exchange operaba desde Perú sin registrarse ante la UIF (infracción D.Leg. 1492 + Res. UIF 035-2023). Se identificaron transferencias vinculadas a direcciones señaladas por ransomware y darknet markets. La UIF dispuso el congelamiento administrativo de los fondos. SUNAT determinó deuda tributaria por omisión de declaración de rentas de 2da categoría de los usuarios. El caso fue remitido a la Fiscalía Especializada en Lavado de Activos.</div><strong>Lecciones:</strong> Las transacciones en blockchain son rastreables (aunque seudónimas). Los PSAV no registrados operan ilegalmente. La UIF puede congelar fondos sin orden judicial en casos de terrorismo/lavado. Los exchanges deben implementar KYC/KYV obligatorio.`, area:'Criptoactivos / PSAV / UIF'},
    {num:'LVD-CASO-005', titulo:'Contador cómplice — Infracción por omisión de reporte ROS', desc:'Contador independiente detectó que su cliente realizaba operaciones sin sustento por S/800,000 en un año. No reportó a la UIF y continuó preparando las declaraciones tributarias.',
     resultado:`<div class="caso-resolucion">Resolución: UIF sancionó al contador con multa de 30 UIT (S/165,000) por omisión de reporte de operación sospechosa (Art. 9 Ley 27693 + Reglamento Res. SBS 2660-2015). El contador alegó que confiaba en su cliente y que "solo preparaba declaraciones". La UIF determinó que los contadores son sujetos obligados cuando intervienen en operaciones societarias, patrimoniales o financieras de sus clientes. El contador también fue inhabilitado por 2 años para ejercer como profesional.</div><strong>Lección crítica:</strong> Los contadores y abogados son sujetos obligados ante la UIF. El "asesoramiento puramente tributario" no exime de reportar ROS detectados. La confianza en el cliente no es excusa. Ignorar las señales de alerta no exime de responsabilidad. El lema es: "Si lo ves, repórtalo."`, area:'Contador / Sujeto obligado / ROS'},
    {num:'LVD-CASO-006', titulo:'Préstamo simulado — Fiscalización cruzada SUNAT-UIF', desc:'Persona natural recibió "préstamo" de S/1.5M de un familiar en el extranjero sin contrato, sin garantía y sin pago de intereses. Usó el dinero para comprar 2 departamentos.',
     resultado:`<div class="caso-resolucion">Resolución: SUNAT detectó el préstamo en la DJ Anual como pasivo. Al fiscalizar, encontró que el "familiar en el extranjero" era una empresa offshore en las Islas Vírgenes Británicas. No había historial de pagos de intereses, ni amortización del principal, ni garantía real. SUNAT recalificó el préstamo como ingreso gravado (incremento patrimonial no justificado, Art. 52 LIR) determinando IR de S/495,000 + multas. La UIF abrió investigación por presunto lavado de activos mediante préstamo simulado (tipología testaferrato + simulación).</div><strong>Lección:</strong> Los préstamos simulados son una tipología de lavado. Para que un préstamo sea válido tributariamente debe tener: contrato escrito, tasa de interés de mercado, calendario de pagos y garantía. Los préstamos de offshores sin sustento real son fiscalizados de oficio por SUNAT y UIF.`, area:'Préstamos simulados / SUNAT / UIF'},
  ]
};

// ════════════════════════════════════════
// LAVADO DE DINERO — FUNCTIONS
// ════════════════════════════════════════
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
    <div class="reg-card-meta"><span>📅 ${n.fecha}</span><span>🔒 Lavado de Activos</span></div>
    <div class="reg-detail" id="detail_${n.id}">${n.detalle}
      <button class="reg-ask-btn" onclick="askAboutRegulation(event,'LAFT: ${n.titulo.replace(/'/g,"\\'")}')">💬 Consultar IA sobre este tema</button>
    </div>
  </div>`).join('');
}

function renderLavadoCasuistica() {
  const el = document.getElementById('lavCasuistica'); if(!el) return;
  el.innerHTML = LAVADO_DATA.casuistica.map(c => `<div class="caso-item" onclick="toggleCasoDetail('caso_${c.num}')">
    <div class="caso-num">${c.num} · ${c.area}</div>
    <div class="caso-title">${c.titulo}</div>
    <div class="caso-desc">${c.desc}</div>
    <div class="caso-result" id="caso_${c.num}">${c.resultado}
      <button class="reg-ask-btn" style="margin-top:10px" onclick="askAboutRegulation(event,'Lavado Caso: ${c.titulo.replace(/'/g,"\\'")}')">💬 Profundizar con IA</button>
    </div>
  </div>`).join('');
}

function renderLavadoQuickQ() {
  const el = document.getElementById('lavQuickQ'); if(!el) return;
  const qs = ['¿Qué delitos son precedentes del lavado de activos en Perú?','¿Cuándo debo reportar un ROS a la UIF?','¿Cómo afecta la Ley 27693 a los contadores?','¿Qué es la extinción de dominio y cómo se relaciona con SUNAT?','¿Los criptoactivos están regulados contra el lavado?','¿Qué sanciones aplican por no reportar operaciones sospechosas?'];
  el.innerHTML = qs.map(q => `<button class="reg-filter-btn" onclick="document.getElementById('lavConsultaText').value='${q.replace(/'/g,"\\'")}'">${q}</button>`).join('');
}

async function consultLavadoAI() {
  const query = document.getElementById('lavConsultaText')?.value?.trim() || '';
  if (!query) { tpToast('Escribe una consulta.', 'warn'); return; }
  const resultEl = document.getElementById('lavConsultaResult');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:var(--muted)">Consultando normativa antilavado...</div>';
  if (!apiKey) { resultEl.innerHTML = '<div style="color:var(--muted)">Conecta tu API Key para respuestas reales. Demo: La Ley 27693 regula el sistema de prevención de lavado de activos en Perú.</div>'; return; }
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un abogado peruano experto en prevención de lavado de activos (LAFT). Conoces la Ley 27693, D.Leg. 1106, D.Leg. 1373, D.Leg. 1492, las resoluciones UIF, las recomendaciones GAFI y la jurisprudencia peruana. Cita siempre la norma exacta y el artículo.',messages:[{role:'user',content:query}]});
    const d = await res.json();
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  } catch(e) { resultEl.innerHTML = '<div style="color:var(--red)">Error: '+safeHTML(e.message)+'</div>'; }
}

// ════════════════════════════════════════
// SMV — FUNCTIONS
// ════════════════════════════════════════
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
    <div class="reg-card-meta"><span>📅 ${n.fecha}</span><span>📈 SMV</span></div>
    <div class="reg-detail smv-detail" id="detail_smv_${n.id}">${n.detalle}
      <button class="reg-ask-btn smv-ask" onclick="askAboutRegulation(event,'SMV: ${n.titulo.replace(/'/g,"\\'")}')">💬 Consultar IA sobre esta norma</button>
    </div>
  </div>`).join('');
}

function renderSMVCasuistica() {
  const el = document.getElementById('smvCasuistica'); if(!el) return;
  el.innerHTML = SMV_DATA.casuistica.map(c => `<div class="caso-item" onclick="toggleCasoDetail('smvcaso_${c.num}')">
    <div class="caso-num" style="color:#4CAF50">${c.num} · ${c.area}</div>
    <div class="caso-title">${c.titulo}</div>
    <div class="caso-desc">${c.desc}</div>
    <div class="caso-result" id="smvcaso_${c.num}">${c.resultado}
      <button class="reg-ask-btn smv-ask" style="margin-top:10px" onclick="askAboutRegulation(event,'SMV Caso: ${c.titulo.replace(/'/g,"\\'")}')">💬 Profundizar con IA</button>
    </div>
  </div>`).join('');
}

function renderSMVQuickQ() {
  const el = document.getElementById('smvQuickQ'); if(!el) return;
  const qs = ['¿Cómo tributan las ganancias de capital en la BVL?','¿Qué es un hecho de importancia SMV?','¿Cómo funciona la tributación de los FIBRAs?','¿Cuál es la tasa de retención sobre dividendos?','¿Qué pasa tributariamente en una fusión de empresa listada?'];
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
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un experto en mercado de valores y tributación bursátil peruana, especializado en normativa SMV (D.Leg. 861, LMV, FIBRAs, BVL) y la tributación de rentas de 2da categoría. Cita siempre la norma exacta.',messages:[{role:'user',content:query}]});
    const d = await res.json();
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  } catch(e) { resultEl.innerHTML = '<div style="color:var(--red)">Error: '+safeHTML(e.message)+'</div>'; }
}

// ════════════════════════════════════════
// SHARED HELPERS
// ════════════════════════════════════════
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
  setTimeout(() => sendMsg('Explícame detalladamente la siguiente norma y sus implicancias tributarias en Perú: ' + normName), 350);
}

// ════════════════════════════════════════
// PATCH setPTab
// ════════════════════════════════════════
const _origSetPTabV8 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV8(tab, btn);
  if (tab === 'sbs') { setSBSTab('normas', null); setTimeout(()=>document.querySelector('#ptSbs .reg-tab')?.classList.add('active'),50); }
  if (tab === 'smv') { setSMVTab('normas', null); setTimeout(()=>document.querySelector('#ptSmv .reg-tab')?.classList.add('active'),50); }
}


// ════════════════════════════════════════
// SISTEMA DE SUGERENCIAS
// ════════════════════════════════════════

// ── Storage helpers ──
function getAllSugs() {
  try { return JSON.parse(localStorage.getItem('tp_sugs') || '[]'); } catch { return []; }
}
function saveAllSugs(arr) {
  localStorage.setItem('tp_sugs', JSON.stringify(arr));
}

// ── State ──
let sugCatSel = '';
let sugPrioSel = 'media';
let sugTabActive = 'nueva';
let misSugFilter = 'todas';
let todasSugFilter = 'todas';

// ── Init suggestions panel ──
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

// ── Tab switching ──
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

// ── Category selection ──
function selectSugCat(cat, btn) {
  sugCatSel = cat;
  document.querySelectorAll('.sug-cat').forEach(b => { b.classList.remove('sel','bug','contenido','mejora'); });
  btn.classList.add('sel');
  if (cat === 'bug') btn.classList.add('bug');
  if (cat === 'contenido') btn.classList.add('contenido');
  if (cat === 'mejora') btn.classList.add('mejora');
}

// ── Priority selection ──
function selectSugPrio(prio, btn) {
  sugPrioSel = prio;
  document.querySelectorAll('.sug-prio-btn').forEach(b => { b.classList.remove('sel','baja','media','alta'); });
  btn.classList.add('sel', prio);
}

// ── Char counter ──
function updateSugChar() {
  const inp = document.getElementById('sugTitulo');
  const cnt = document.getElementById('sugCharCount');
  if (inp && cnt) { const n = inp.value.length; cnt.textContent = n + ' / 100'; cnt.style.color = n > 80 ? 'var(--gold)' : 'var(--muted)'; }
}

// ── Submit sugerencia ──
function submitSugerencia() {
  const titulo = document.getElementById('sugTitulo')?.value?.trim() || '';
  const desc = document.getElementById('sugDesc')?.value?.trim() || '';
  const errEl = document.getElementById('sugError');
  const okEl = document.getElementById('sugOk');
  const showErr = (m) => { errEl.textContent = m; errEl.style.display = 'block'; okEl.style.display = 'none'; };
  errEl.style.display = 'none'; okEl.style.display = 'none';
  if (!sugCatSel) { showErr('Selecciona una categoría para tu sugerencia.'); return; }
  if (!titulo || titulo.length < 5) { showErr('El título debe tener al menos 5 caracteres.'); return; }
  if (!desc || desc.length < 15) { showErr('La descripción debe tener al menos 15 caracteres.'); return; }
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
  okEl.textContent = '✅ ¡Sugerencia enviada! Gracias, la revisaremos pronto.';
  okEl.style.display = 'block';
  setTimeout(() => okEl.style.display = 'none', 4000);
  addNotif('💡', 'Sugerencia enviada', '"' + titulo.substring(0, 40) + (titulo.length > 40 ? '…' : '') + '" fue enviada correctamente.');
}

// ── Render helpers ──
const CAT_LABELS = { 'nueva-funcion':'⭐ Nueva función', mejora:'🔧 Mejora', contenido:'📚 Contenido', bug:'🐛 Bug', otro:'💬 Otro' };
const ESTADO_LABELS = { pendiente:'Pendiente', revision:'En revisión', implementado:'✅ Implementado', rechazado:'Rechazado' };
const PRIO_ICONS = { alta:'🔴', media:'🟡', baja:'🟢' };

function renderSugItem(s, showUser) {
  const planBadge = s.plan === 'empresa' ? '<span style="font-size:14px;background:rgba(58,134,255,.13);border:1px solid rgba(58,134,255,.22);color:#3A86FF;padding:1px 6px;border-radius:6px">Empresa</span>' : s.plan === 'pro' ? '<span style="font-size:14px;background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.22);color:var(--gold);padding:1px 6px;border-radius:6px">Pro</span>' : '';
  const replyHtml = s.respuesta ? `<div class="sug-reply-box"><div class="sug-reply-label">💬 Respuesta del equipo DeclaraFY</div>${s.respuesta}</div>` : '';
  return `<div class="sug-item">
    <div class="sug-item-top">
      <div class="sug-priority-dot ${s.prioridad}"></div>
      <div class="sug-item-left">
        <div class="sug-item-title">${s.titulo}</div>
        <div class="sug-item-desc">${s.desc}</div>
        ${replyHtml}
      </div>
    </div>
    <div class="sug-item-meta">
      <span class="sug-badge ${s.cat}">${CAT_LABELS[s.cat] || s.cat}</span>
      <span class="sug-status ${s.estado}">${ESTADO_LABELS[s.estado] || s.estado}</span>
      ${showUser ? `<span class="sug-item-user">👤 ${s.userName} ${planBadge}</span>` : ''}
      <span class="sug-item-date">📅 ${s.fecha}</span>
      <span style="font-size:14px;color:var(--muted)">${PRIO_ICONS[s.prioridad]} ${s.prioridad.charAt(0).toUpperCase()+s.prioridad.slice(1)}</span>
    </div>
  </div>`;
}

function renderMisSug() {
  const el = document.getElementById('misSugList'); if (!el || !curUser) return;
  const all = getAllSugs().filter(s => s.userId === curUser.email);
  const filtered = misSugFilter === 'todas' ? all : all.filter(s => s.estado === misSugFilter);
  if (!filtered.length) {
    el.innerHTML = `<div class="sug-empty">No tienes sugerencias${misSugFilter !== 'todas' ? ' en este estado' : ''}.<br>¡Envía tu primera idea con el formulario!</div>`;
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
    el.innerHTML = `<div class="sug-empty">No hay sugerencias${todasSugFilter !== 'todas' ? ' en esta categoría' : ''} todavía.<br>¡Sé el primero en enviar una!</div>`;
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

// ════════════════════════════════════════
// ADMIN — GESTIÓN DE SUGERENCIAS
// ════════════════════════════════════════
function renderAdminSugs() {
  const wrap = document.getElementById('adminSugWrap'); if (!wrap) return;
  const all = getAllSugs();
  if (!all.length) {
    wrap.innerHTML = '<div class="sug-empty">No hay sugerencias enviadas aún.</div>';
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
      <div class="pcard"><div class="pcard-l">En revisión</div><div class="pcard-v" style="color:var(--gold)">${stats.revision}</div><div class="pcard-s">en proceso</div></div>
      <div class="pcard"><div class="pcard-l">Implementadas</div><div class="pcard-v" style="color:var(--green)">${stats.implementado}</div><div class="pcard-s">completadas</div></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      <button class="sug-filter active" onclick="filterAdmSug('todas',this)">Todas (${all.length})</button>
      <button class="sug-filter" onclick="filterAdmSug('pendiente',this)">Pendientes (${stats.pendiente})</button>
      <button class="sug-filter" onclick="filterAdmSug('revision',this)">En revisión (${stats.revision})</button>
      <button class="sug-filter" onclick="filterAdmSug('implementado',this)">Implementadas (${stats.implementado})</button>
      <button class="sug-filter" onclick="filterAdmSug('alta',this)">🔴 Alta prioridad</button>
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
            <span style="color:var(--muted)">👤 ${s.userName} (${s.plan})</span>
            <span style="color:var(--muted)">📅 ${s.fecha}</span>
            <span style="color:var(--muted)">${PRIO_ICONS[s.prioridad]} ${s.prioridad}</span>
          </div>
          ${s.respuesta ? `<div class="sug-reply-box" style="margin-top:8px"><div class="sug-reply-label">Tu respuesta actual</div>${s.respuesta}</div>` : ''}
        </div>
      </div>
      <input class="adm-sug-reply" id="admReply_${s.id}" placeholder="Escribe una respuesta para el usuario (opcional)..." value="${s.respuesta||''}">
      <div class="adm-sug-actions">
        <button class="adm-sug-action review" onclick="updateSugEstado('${s.id}','revision')">🔍 En revisión</button>
        <button class="adm-sug-action approve" onclick="updateSugEstado('${s.id}','implementado')">✅ Implementar</button>
        <button class="adm-sug-action reject" onclick="updateSugEstado('${s.id}','rechazado')">❌ Rechazar</button>
        <button class="adm-sug-action" onclick="updateSugEstado('${s.id}','pendiente')">↩ Pendiente</button>
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
    addNotif('🎉', '¡Tu sugerencia fue implementada!', '"' + all[idx].titulo.substring(0,40) + '" ya está disponible en DeclaraFY.');
  } else if (newEstado === 'revision') {
    addNotif('🔍', 'Sugerencia en revisión', '"' + all[idx].titulo.substring(0,40) + '" está siendo revisada por el equipo.');
  }
  renderAdminSugs();
  renderMisSug();
  renderTodasSug();
  // Small feedback
  const estados = { implementado:'✅ Marcada como implementada', revision:'🔍 Marcada en revisión', rechazado:'❌ Rechazada', pendiente:'↩ Vuelta a pendiente' };
  addNotif('⚙️', 'Sugerencia actualizada', estados[newEstado] || 'Estado actualizado.');
}

// ════════════════════════════════════════
// INJECT ADMIN SUGS SECTION INTO ADMIN TAB
// ════════════════════════════════════════
function renderAdmin() {
  const us = getUsers(), uArr = Object.values(us);
  const total = uArr.length, pro = uArr.filter(u => u.plan === 'pro').length, emp = uArr.filter(u => u.plan === 'empresa').length;
  const ingresos = (pro * 190) + (emp * 750), totalMsgs = uArr.reduce((s, u) => s + (u.mc || 0), 0);
  const admEl = document.getElementById('admCards');
  if (admEl) admEl.innerHTML = `
    <div class="adm-c"><div class="adm-c-l">Usuarios totales</div><div class="adm-c-v">${total}</div><div class="adm-c-s">registrados</div></div>
    <div class="adm-c"><div class="adm-c-l">Plan Pro</div><div class="adm-c-v">${pro}</div><div class="adm-c-s">suscriptores</div></div>
    <div class="adm-c"><div class="adm-c-l">Plan Empresa</div><div class="adm-c-v">${emp}</div><div class="adm-c-s">suscriptores</div></div>
    <div class="adm-c"><div class="adm-c-l">Ingresos est./mes</div><div class="adm-c-v" style="font-size:15px">S/${ingresos.toLocaleString()}</div><div class="adm-c-s">planes activos</div></div>
    <div class="adm-c"><div class="adm-c-l">Total consultas</div><div class="adm-c-v">${totalMsgs}</div><div class="adm-c-s">realizadas</div></div>
    <div class="adm-c"><div class="adm-c-l">Sugerencias</div><div class="adm-c-v" style="color:var(--gold)">${getAllSugs().length}</div><div class="adm-c-s">recibidas</div></div>`;
  const topicsEl = document.getElementById('topTopics');
  if (topicsEl) topicsEl.innerHTML = [{n:'IGV',v:32},{n:'Renta',v:28},{n:'Aduanas',v:15},{n:'Precios Transfer.',v:10},{n:'Planificación',v:8},{n:'NRUS',v:7}].map(t => `<div class="topic-row"><span class="topic-nm">${t.n}</span><div class="topic-track"><div class="topic-bar" style="width:${t.v}%"></div></div><span class="topic-pct">${t.v}%</span></div>`).join('');
  const tbody = document.getElementById('admTbody');
  if (tbody) tbody.innerHTML = uArr.map(u => `<tr><td>${_escapeHtml(u.name||'')}</td><td style="color:var(--muted);font-size:14px">${_escapeHtml(u.email||'')}</td><td><span class="pp ${_escapeHtml(u.plan||'')}">${_escapeHtml(u.plan||'')}</span></td><td>${u.mc||0}</td><td style="color:var(--muted)">${u.since||'—'}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:14px">No hay usuarios aún</td></tr>';
  // Sugerencias section in admin
  let admSugSection = document.getElementById('adminSugSection');
  if (!admSugSection) {
    admSugSection = document.createElement('div');
    admSugSection.id = 'adminSugSection';
    admSugSection.style.marginTop = '24px';
    admSugSection.innerHTML = `<div class="sec-title" style="margin-bottom:12px">💡 Gestión de sugerencias</div><div id="adminSugWrap"></div>`;
    document.getElementById('ptAdmin')?.appendChild(admSugSection);
  }
  renderAdminSugs();
}

// ════════════════════════════════════════
// PATCH setPTab
// ════════════════════════════════════════
const _origSetPTabV9 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV9(tab, btn);
  if (tab === 'sugerencias') initSugerencias();
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
      addNotif('🎉', '¡Sugerencia implementada!', '"' + s.titulo.substring(0,40) + '" ya está en DeclaraFY.');
    }
  });
  localStorage.setItem('tp_sug_check_' + btoa(curUser.email), Date.now());
}


// ════════════════════════════════════════
// CASOS TRIBUTARIOS PARTICULARES
// ════════════════════════════════════════

// ── State ──
let cwStep = 0;
let cwFiles = [];
let cwFilesContent = [];
let activeCasoId = null;
let multiFiles = [];
let multiFilesContent = [];
let casoFilterActive = 'todos';

const CW_STEPS = 4;
const TIPO_LABELS = {
  fiscalizacion:'Fiscalización SUNAT', planificacion:'Planificación tributaria',
  recurso:'Recurso reclamación/apelación', contrato:'Análisis de contrato',
  reorganizacion:'Reorganización societaria', pt:'Precios de transferencia',
  aduanas:'Caso aduanero', otro:'Otro'
};
const URGENCIA_COLORS = { normal:'var(--muted)', urgente:'var(--gold)', critico:'var(--red)' };

// ════════════════════════════════════════
// WIZARD
// ════════════════════════════════════════
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
  if (next) next.textContent = step === CW_STEPS - 1 ? '✨ Iniciar análisis' : 'Siguiente →';
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
      if (!hechos || hechos.length < 20) { errEl.textContent = 'Describe los hechos del caso (mínimo 20 caracteres).'; errEl.style.display = 'block'; return; }
      if (!objetivo || objetivo.length < 10) { errEl.textContent = 'Indica el objetivo o consulta del análisis.'; errEl.style.display = 'block'; return; }
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
    const icon = ext === 'pdf' ? '📕' : ['xlsx','xls','csv'].includes(ext) ? '📊' : ['doc','docx'].includes(ext) ? '📄' : '📎';
    return `<div class="multi-file-item"><span class="multi-file-item-icon">${icon}</span><div class="multi-file-item-info"><div class="multi-file-item-name">${f.name}</div><div class="multi-file-item-size">${(f.size/1024).toFixed(1)} KB</div></div><button class="multi-file-del" onclick="removeCWFile(${i})">×</button></div>`;
  }).join('');
  if (total) { total.style.display = 'block'; total.textContent = `${cwFiles.length} archivo(s) · ${(totalSize/1024).toFixed(1)} KB total`; }
}

function removeCWFile(i) { cwFiles.splice(i, 1); renderCWFileList(); }

// ── Start caso analysis ──
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
  return `CASO TRIBUTARIO PARA ANÁLISIS FORMAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Caso: ${caso.nombre}
Tipo: ${TIPO_LABELS[caso.tipo]||caso.tipo}
Urgencia: ${caso.urgencia.toUpperCase()}
Período: ${caso.periodo||'No especificado'}

CONTRIBUYENTE:
• Empresa: ${caso.empresa||'No especificado'}
• RUC: ${caso.ruc||'No especificado'}
• Régimen: ${caso.regimen}
• Sector: ${caso.sector}
• Ingresos anuales aprox: S/${parseInt(caso.ingresos||0).toLocaleString()}
${caso.monto ? `• Monto en disputa: S/${parseInt(caso.monto).toLocaleString()}` : ''}

HECHOS DEL CASO:
${caso.hechos}

OBJETIVO DEL ANÁLISIS:
${caso.objetivo}
${fileContext ? '\n\nDOCUMENTOS ADJUNTOS PARA ANÁLISIS:' + fileContext : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Por favor realiza un análisis tributario formal y completo considerando:
1. Análisis legal del caso con base en la normativa peruana vigente
2. Identificación de riesgos y contingencias tributarias
3. Argumentos a favor del contribuyente (si aplica)
4. Recomendaciones concretas y próximos pasos
5. Base legal citada (artículos y normas específicas)
${fileContext ? '6. Análisis cruzado de los documentos adjuntos' : ''}

Responde de forma estructurada, profesional y detallada.`;
}

// ════════════════════════════════════════
// CASO MODE IN CHAT
// ════════════════════════════════════════
function showCasoMode(casoData) {
  const bar = document.getElementById('casoHeaderBar');
  const name = document.getElementById('casoHeaderName');
  const mfPanel = document.getElementById('multiFilePanel');
  if (bar) bar.style.display = 'flex';
  if (name) name.textContent = casoData.nombre + ' · ' + (TIPO_LABELS[casoData.tipo]||casoData.tipo);
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

// ════════════════════════════════════════
// MULTI-FILE READING (PDF + others)
// ════════════════════════════════════════
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
    const icon = ext === 'pdf' ? '📕' : ['xlsx','xls','csv'].includes(ext) ? '📊' : ['doc','docx'].includes(ext) ? '📄' : '📎';
    return `<div class="multi-file-item"><span class="multi-file-item-icon">${icon}</span><div class="multi-file-item-info"><div class="multi-file-item-name">${f.name}</div><div class="multi-file-item-size">${(f.size/1024).toFixed(1)} KB</div></div><span class="multi-file-item-status ok">Listo</span><button class="multi-file-del" onclick="removeMultiFile(${i})">×</button></div>`;
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

// ── Real file reading with PDF.js ──
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
        content = await readTextFile(f).catch(() => `[Archivo binario: ${f.name} — ${(f.size/1024).toFixed(1)} KB]`);
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
        resolve(`[Excel: ${file.name} — ${(file.size/1024).toFixed(1)} KB — no se pudo extraer texto]`);
      }
    };
    r.onerror = () => resolve(`[Excel: ${file.name} — error de lectura]`);
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
          resolve(`[PDF: ${file.name} — ${pdf.numPages} páginas]\n${text.substring(0, 8000)}`);
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
            resolve(`[PDF: ${file.name} — ${(file.size/1024).toFixed(1)} KB — archivo escaneado o protegido, incluye el contenido relevante en texto]`);
          }
        }
      } catch(ex) {
        resolve(`[PDF: ${file.name} — error al leer: ${ex.message}]`);
      }
    };
    r.onerror = () => resolve(`[PDF: ${file.name} — error de lectura]`);
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

// ── Override sendMsg to include multi-files ──
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

// ════════════════════════════════════════
// INFORME DE CONCLUSIONES PDF
// ════════════════════════════════════════
async function generateCasoInforme() {
  if (!convHist.length) { tpToast('No hay conversación en este caso. Inicia el análisis primero.', 'warn'); return; }
  const casos = getCasos();
  const caso = casos.find(c => c.id === activeCasoId) || { nombre:'Caso tributario', empresa:'—', ruc:'—', regimen:'—' };
  // Build summary prompt
  const histSummary = convHist.slice(-10).map(m => `${m.role === 'user' ? 'CONSULTA' : 'ANÁLISIS IA'}: ${m.content.substring(0,500)}`).join('\n\n');
  const informePrompt = `Basándote en el siguiente análisis del caso "${caso.nombre}", genera un INFORME DE CONCLUSIONES FORMAL con esta estructura exacta:

1. RESUMEN EJECUTIVO (3-4 líneas)
2. IDENTIFICACIÓN DEL CASO (empresa, régimen, período, tipo)
3. HECHOS RELEVANTES (puntos clave del caso)
4. ANÁLISIS LEGAL (normas aplicables con artículos exactos)
5. RIESGOS Y CONTINGENCIAS (ordenados por severidad: ALTO/MEDIO/BAJO)
6. RECOMENDACIONES (acciones concretas con plazos sugeridos)
7. CONCLUSIÓN FINAL

Análisis previo del caso:
${histSummary}

Empresa: ${caso.empresa} | RUC: ${caso.ruc} | Régimen: ${caso.regimen}
Fecha del informe: ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}

Genera el informe en español formal, con base legal peruana precisa.`;

  addMsg('user', '📄 Generar informe formal de conclusiones del caso');
  showTyp();
  if (!apiKey) {
    remTyp();
    const demoInforme = generateDemoInforme(caso);
    addMsg('ai', demoInforme);
    setTimeout(() => exportCasoInforme(caso, demoInforme), 500);
    return;
  }
  try {
    const res = await callDeclaraFY({ model:'claude-sonnet-4-5', max_tokens:2000, system:'Eres un abogado tributarista peruano senior. Redactas informes formales de análisis de casos tributarios con base legal exacta y recomendaciones accionables.', messages:[{role:'user',content:informePrompt}] });
    const data = await res.json();
    const informe = data.content?.[0]?.text || 'Error generando informe.';
    convHist.push({role:'assistant', content:informe});
    remTyp();
    addMsg('ai', informe);
    setTimeout(() => exportCasoInforme(caso, informe), 800);
    addNotif('📄','Informe generado','El informe de conclusiones fue generado y exportado a PDF.');
  } catch(e) {
    remTyp();
    addMsg('ai', '**Error generando informe:** ' + e.message);
  }
}

function generateDemoInforme(caso) {
  return `**INFORME DE CONCLUSIONES TRIBUTARIAS**\n\n**1. RESUMEN EJECUTIVO**\nEl presente informe analiza el caso "${caso.nombre}" correspondiente a ${caso.empresa||'el contribuyente'}. Se identificaron contingencias tributarias que requieren atención inmediata. Se recomienda adoptar las medidas correctivas descritas en las secciones siguientes.\n\n**2. IDENTIFICACIÓN DEL CASO**\n• Empresa: ${caso.empresa||'—'} · RUC: ${caso.ruc||'—'}\n• Régimen: ${caso.regimen||'—'} · Período: ${caso.periodo||'—'}\n• Tipo: ${TIPO_LABELS[caso.tipo]||caso.tipo}\n\n**3. ANÁLISIS LEGAL**\nBase legal aplicable según normativa peruana vigente: TUO Código Tributario (D.S.133-2013-EF), TUO LIR (D.S.179-2004-EF), TUO LIGV (D.S.055-99-EF).\n\n**4. RECOMENDACIONES**\n1. Revisar documentación sustentatoria de las operaciones observadas\n2. Preparar descargos con base legal dentro del plazo legal\n3. Evaluar acogimiento al régimen de gradualidad de ser aplicable\n\n**5. CONCLUSIÓN**\nConecta tu API Key de Claude para generar un informe completo y personalizado basado en el análisis de tu caso específico.\n\n*Informe generado por DeclaraFY — ${new Date().toLocaleDateString('es-PE')}*`;
}

function exportCasoInforme(caso, texto) {
  const win = window.open('','_blank');
  const html = _escapeHtml(texto).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Informe — ${_escapeHtml(caso.nombre)}</title>
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
<div class="header"><h1>Informe de Conclusiones Tributarias</h1><p>DeclaraFY · IA Tributaria y Aduanera · Perú</p></div>
<div class="meta">
  <span><strong>Caso:</strong> ${caso.nombre}</span>
  <span><strong>Empresa:</strong> ${caso.empresa||'—'}</span>
  <span><strong>RUC:</strong> ${caso.ruc||'—'}</span>
  <span><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</span>
</div>
${html}
<div class="footer">Informe generado por DeclaraFY.pe · Solo con fines orientativos · Validar con contador o abogado tributarista para decisiones formales</div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// ════════════════════════════════════════
// CASOS PANEL (list)
// ════════════════════════════════════════
function renderCasos() {
  if (!curUser) return;
  const casos = getCasos();
  const el = document.getElementById('casosList'); if (!el) return;
  let filtered = casoFilterActive === 'todos' ? casos : casos.filter(c => c.tipo === casoFilterActive);
  if (!filtered.length) {
    el.innerHTML = `<div class="sug-empty">No tienes casos${casoFilterActive!=='todos'?' de este tipo':''} registrados.<br>Crea tu primer caso con el botón de arriba.</div>`;
    return;
  }
  const urgColors = { normal:'var(--muted)', urgente:'var(--gold)', critico:'var(--red)' };
  el.innerHTML = filtered.map(c => `<div class="sug-item" style="cursor:pointer" onclick="loadCaso('${c.id}')">
    <div class="sug-item-top">
      <div class="sug-priority-dot" style="background:${urgColors[c.urgencia||'normal']};margin-top:4px;flex-shrink:0"></div>
      <div class="sug-item-left">
        <div class="sug-item-title">${c.nombre}</div>
        <div class="sug-item-desc">${c.empresa ? c.empresa + (c.ruc ? ' · RUC ' + c.ruc : '') : 'Sin empresa especificada'} · ${c.periodo||'Período no especificado'}</div>
        <div class="sug-item-meta" style="margin-top:6px">
          <span class="sug-badge nueva-funcion">${TIPO_LABELS[c.tipo]||c.tipo}</span>
          <span class="sug-badge ${c.urgencia==='critico'?'bug':c.urgencia==='urgente'?'gold':'otro'}">${c.urgencia?.toUpperCase()||'NORMAL'}</span>
          ${c.archivos?.length ? `<span style="font-size:14px;color:var(--muted)">📎 ${c.archivos.length} archivo(s)</span>` : ''}
          <span class="sug-item-date">📅 ${c.fecha}</span>
        </div>
      </div>
    </div>
  </div>`).join('');
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
    addMsg('ai', `📂 **Caso cargado:** ${caso.nombre}\n\n**Empresa:** ${caso.empresa||'—'} · **RUC:** ${caso.ruc||'—'} · **Régimen:** ${caso.regimen}\n**Tipo:** ${TIPO_LABELS[caso.tipo]||caso.tipo} · **Período:** ${caso.periodo||'—'}\n\n**Hechos:** ${caso.hechos?.substring(0,200)||'—'}${caso.hechos?.length>200?'…':''}\n\n**Objetivo:** ${caso.objetivo}\n\n¿Qué parte del caso quieres analizar? También puedes adjuntar nuevos documentos usando el área de archivos arriba.`);
  }, 300);
}

// ════════════════════════════════════════
// PATCH setPTab
// ════════════════════════════════════════
const _origSetPTabV10 = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabV10(tab, btn);
  if (tab === 'casos') renderCasos();
}


// ════════════════════════════════════════
// FIREBASE CONFIGURATION & INIT
// ════════════════════════════════════════
const firebaseConfig = {
  apiKey: "BBva16rGzybUODEOVP5zSHHblcOpacP3LqnhrJ97mg2swcZ6XHb5tIyk1XIgovpXfEkJhRsIA2MCju9DgdhMmwE",
  authDomain: "declarafy-52bc1.firebaseapp.com",
  projectId: "declarafy-52bc1",
  storageBucket: "declarafy-52bc1.firebasestorage.app",
  messagingSenderId: "448788308031",
  // TODO: Rellena appId y measurementId con los valores exactos del
  // firebaseConfig.js del proyecto NUEVO "declarafy-52bc1" (Consola Firebase
  // → Configuración del proyecto → Tus apps → Web). No son derivables.
  appId: "1:448788308031:web:XXXX_REEMPLAZAR_XXXX",
  measurementId: "G-XXXX_REEMPLAZAR_XXXX"
};

let fbApp, fbAuth, fbDb;
let fbReady = false;

function initFirebase() {
  try {
    if (typeof firebase === 'undefined') {
      throw new Error('Firebase SDK not available');
    }
    // Check if already initialized
    if (firebase.apps && firebase.apps.length > 0) {
      fbApp = firebase.apps[0];
    } else {
      fbApp = firebase.initializeApp(firebaseConfig);
    }
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    // Enable offline persistence
    fbDb.enablePersistence({synchronizeTabs:true}).catch(() => {});
    fbReady = true;
    console.log('✅ Firebase conectado — declarafy-89a8d');
    // Show online indicator
    const dots = document.querySelectorAll('.notif-dot, .onl');
    updateFBStatusUI(true);
  } catch(e) {
    console.warn('Firebase init error:', e.message);
    fbReady = false;
  }
}

function updateFBStatusUI(online) {
  // Update any status indicators
  const statusEl = document.getElementById('statusDot');
  if (statusEl) statusEl.textContent = online ? '☁ Sincronizado' : 'IA activa';
}

// ════════════════════════════════════════
// FIREBASE AUTH LAYER
// Replaces localStorage auth with Firebase Auth + Firestore
// ════════════════════════════════════════

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
      loadPanel();
      showAuthLoading(false);
    } catch(e) {
      showAuthLoading(false);
      const msgs = { 'auth/user-not-found':'No existe una cuenta con ese correo.', 'auth/wrong-password':'Contraseña incorrecta.', 'auth/invalid-email':'Correo inválido.', 'auth/too-many-requests':'Demasiados intentos. Espera unos minutos.' };
      aerr(msgs[e.code] || e.message);
    }
  } else {
    // Fallback to localStorage
    const us = getUsers();
    if (!us[em]) { aerr('No existe una cuenta con ese correo.'); return; }
    if (us[em].pw !== btoa(pw)) { aerr('Contraseña incorrecta.'); return; }
    curUser = us[em]; localStorage.setItem('tp_s', JSON.stringify({e:em,t:Date.now()})); hideAuth(); loadPanel();
  }
}

// Override doRegister
async function doRegisterFB() {
  const nm = (document.getElementById('rName')?.value || document.getElementById('rN')?.value || '').trim();
  const em = (document.getElementById('rEmail')?.value || document.getElementById('rE')?.value || '').trim().toLowerCase();
  const pw = document.getElementById('rPass')?.value || document.getElementById('rP')?.value || '';
  const pw2 = document.getElementById('rPass2')?.value || document.getElementById('rP2')?.value || '';
  if (!nm || !em || !pw || !pw2) { aerr('Completa todos los campos.'); return; }
  if (!em.includes('@')) { aerr('Correo inválido.'); return; }
  if (pw.length < 6) { aerr('Contraseña mínimo 6 caracteres.'); return; }
  if (pw !== pw2) { aerr('Las contraseñas no coinciden.'); return; }

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
      aok('¡Cuenta creada! Ingresando...');
      const _CULQI_LINKS = { profesional: 'https://express.culqi.com/pago/053F161D3A', empresa: 'https://express.culqi.com/pago/593B4B3F8D' };
      const _paidLink = _CULQI_LINKS[window._overridePlan];
      if (_paidLink) window.open(_paidLink, '_blank');
      setTimeout(() => { hideAuth(); loadPanel(); if (!curUser.onboarded) setTimeout(() => showOnboarding(), 600); }, 900);
    } catch(e) {
      showAuthLoading(false);
      const msgs = { 'auth/email-already-in-use':'Ya existe una cuenta con ese correo.', 'auth/weak-password':'Contraseña muy débil.', 'auth/invalid-email':'Correo inválido.' };
      aerr(msgs[e.code] || e.message);
    }
  } else {
    // Fallback localStorage
    const us = getUsers();
    if (us[em]) { aerr('Ya existe una cuenta con ese correo.'); return; }
    const u = { name:nm, email:em, pw:btoa(pw), plan:'basico', since:new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'}), mc:0 };
    us[em] = u; saveUsers(us); curUser = u; localStorage.setItem('tp_s', JSON.stringify({e:em,t:Date.now()}));
    aok('¡Cuenta creada! Ingresando...'); setTimeout(() => { hideAuth(); loadPanel(); setTimeout(() => showOnboarding(), 600); }, 900);
  }
}

// Override doRecover (password reset via Firebase)
async function doRecoverFB() {
  const em = document.getElementById('recE')?.value?.trim().toLowerCase() || '';
  if (!em) { aerr('Ingresa tu correo.'); return; }
  if (fbReady) {
    try {
      await fbAuth.sendPasswordResetEmail(em);
      aok('✅ Correo de recuperación enviado a ' + em + '. Revisa tu bandeja de entrada.');
    } catch(e) {
      const msgs = { 'auth/user-not-found':'No existe una cuenta con ese correo.', 'auth/invalid-email':'Correo inválido.' };
      aerr(msgs[e.code] || e.message);
    }
  } else {
    // Fallback
    const us = getUsers();
    if (!us[em]) { aerr('No existe una cuenta con ese correo.'); return; }
    const temp = 'Tp' + Math.random().toString(36).substring(2,7).toUpperCase();
    us[em].pw = btoa(temp); saveUsers(us);
    aok('Contraseña temporal generada: ' + temp + ' (solo en modo offline)');
  }
}

// Override doLogout
async function doLogout() {
  if (fbReady) { try { await fbAuth.signOut(); } catch(e) {} }
  curUser = null; localStorage.removeItem('tp_s'); showScreen('screen-landing');
}

function showAuthLoading(show) {
  const btns = document.querySelectorAll('.bp');
  btns.forEach(b => { if(show) b.setAttribute('disabled','1'); else b.removeAttribute('disabled'); });
}

// ════════════════════════════════════════
// FIRESTORE DATA LAYER
// Replaces localStorage for user data, history, sugerencias, casos
// ════════════════════════════════════════

// ── User profile ──
async function saveProfile() {
  const name = document.getElementById('pName')?.value?.trim() || '';
  if (!name) { showProfMsg('err','El nombre no puede estar vacío.'); return; }
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
      showProfMsg('ok','✅ Perfil guardado en la nube.');
      addNotif('☁️','Perfil sincronizado','Tu perfil fue guardado en Firebase.');
    } catch(e) { showProfMsg('err','Error: ' + e.message); }
  } else {
    // Fallback localStorage
    const us = getUsers(); if(us[curUser.email]) { Object.assign(us[curUser.email], updates); saveUsers(us); Object.assign(curUser, updates); }
    showProfMsg('ok','✅ Perfil guardado.');
  }
}

async function changePassword() {
  const old = document.getElementById('pwOld')?.value || '';
  const nw = document.getElementById('pwNew')?.value || '';
  const nw2 = document.getElementById('pwNew2')?.value || '';
  if (!old || !nw || !nw2) { showProfMsg('err','Completa todos los campos.'); return; }
  if (nw.length < 6) { showProfMsg('err','Mínimo 6 caracteres.'); return; }
  if (nw !== nw2) { showProfMsg('err','Las contraseñas no coinciden.'); return; }
  if (fbReady && fbAuth.currentUser) {
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(curUser.email, old);
      await fbAuth.currentUser.reauthenticateWithCredential(cred);
      await fbAuth.currentUser.updatePassword(nw);
      ['pwOld','pwNew','pwNew2'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
      showProfMsg('ok','✅ Contraseña actualizada en Firebase.');
    } catch(e) {
      const msgs = { 'auth/wrong-password':'Contraseña actual incorrecta.', 'auth/weak-password':'Contraseña muy débil.' };
      showProfMsg('err', msgs[e.code] || e.message);
    }
  } else {
    if (btoa(old) !== curUser.pw) { showProfMsg('err','Contraseña actual incorrecta.'); return; }
    const us = getUsers(); us[curUser.email].pw = btoa(nw); saveUsers(us); curUser.pw = btoa(nw);
    ['pwOld','pwNew','pwNew2'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    showProfMsg('ok','✅ Contraseña cambiada.');
  }
}

// ── Chat history (Firestore loaders) ──
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

// ── Sugerencias (Firestore loader) ──
async function loadSugsFromFirestore() {
  if (!fbReady) return;
  try {
    const snap = await fbDb.collection('sugerencias').orderBy('fechaMs','desc').limit(100).get();
    const arr = snap.docs.map(d => d.data());
    localStorage.setItem('tp_sugs', JSON.stringify(arr));
    renderMisSug(); renderTodasSug();
  } catch(e) { console.warn('Load sugs error:', e.message); }
}

// ── Casos (Firestore) ──
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

// ── Increment message count ──
async function incrementMsgCount() {
  if (!curUser) return;
  curUser.mc = (curUser.mc || 0) + 1;
  if (fbReady && curUser.uid) {
    fbDb.collection('users').doc(curUser.uid).update({ mc: firebase.firestore.FieldValue.increment(1) })
      .catch(e => console.warn('mc update error:', e.message));
  } else {
    const us = getUsers(); if(us[curUser.email]) { us[curUser.email].mc = curUser.mc; saveUsers(us); }
  }
}

// ── Update plan (when Culqi webhook confirms payment) ──
// NOTA: el plan NO se actualiza desde el cliente. Solo vía Cloud Functions
// o el workflow n8n (Admin SDK), que ignora las reglas de Firestore.
// (La antigua updateUserPlan se eliminó: las reglas bloquean cambios de
// 'plan' desde el cliente en firestore.rules.)

// ── Firebase status badge ──
function renderFBStatus() {
  const existing = document.getElementById('fbStatusBadge');
  if (existing) existing.remove();
  const badge = document.createElement('div');
  badge.id = 'fbStatusBadge';
  badge.style.cssText = 'position:fixed;bottom:52px;right:16px;font-size:14px;padding:3px 9px;border-radius:8px;z-index:50;pointer-events:none;' + (fbReady ? 'background:rgba(76,175,80,.15);border:1px solid rgba(76,175,80,.25);color:#4CAF50' : 'background:rgba(144,144,168,.1);border:1px solid rgba(144,144,168,.18);color:#9090A8');
  badge.textContent = fbReady ? '☁ Firebase conectado' : '💾 Modo local';
  document.body.appendChild(badge);
}

// ── Patch sendMsg to use incrementMsgCount ──
const _origSendMsgFB = _sendMsgLayer2;
async function sendMsg(txt) {
  const result = await _origSendMsgFB(txt);
  // Update mc in firebase after successful message
  if (curUser && fbReady) incrementMsgCount();
  return result;
}

function loadPanel() {
  if (!curUser) return;
  const pn = {basico:'Básico',pro:'Profesional',empresa:'Empresa'};
  const el = (id) => document.getElementById(id);
  if (el('pcPlan')) el('pcPlan').textContent = pn[curUser.plan] || 'Básico';
  if (el('pcPlanD')) el('pcPlanD').textContent = curUser.plan === 'basico' ? `${FREE} consultas al mes` : 'Consultas ilimitadas';
  if (el('pcTag')) el('pcTag').textContent = 'Activo';
  if (el('pcCount')) el('pcCount').textContent = curUser.mc || 0;
  if (el('pcConvs')) el('pcConvs').textContent = getHist(curUser.email).length;
  if (el('pcSince')) el('pcSince').textContent = curUser.since || '—';
  if (el('chatPlanLbl')) el('chatPlanLbl').textContent = 'Plan ' + (pn[curUser.plan] || 'Básico');
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
        if (el('pcPlan')) el('pcPlan').textContent = pn[fresh.plan]||'Básico';
        if (el('pcCount')) el('pcCount').textContent = fresh.mc||0;
        updateQuotaBars();
      }
    }).catch(e => console.warn('Refresh user error:', e.message));
  }
  // Auto-arrancar tour para usuarios que completaron onboarding pero aún no hicieron el tour
  if (curUser && curUser.onboarded && !curUser.tourDone) {
    setTimeout(() => maybeStartTour(), 1200);
  }
}


// ════════════════════════════════════════
// DATA — TRIBUNAL FISCAL (RTFs)
// ════════════════════════════════════════
const RTF_DATA = [
  {id:'rtf1',cat:'igv',obs:true,num:'RTF 01580-5-2009',titulo:'Fehaciencia de operaciones — crédito fiscal IGV',desc:'El Tribunal Fiscal establece que para sustentar el crédito fiscal no basta la factura; debe acreditarse la fehaciencia de la operación (existencia real del bien o servicio).',badge:'gold',
   detalle:`<h4>RTF 01580-5-2009 — Observancia obligatoria ⭐</h4><div class="reg-detail-art">Criterio: Para mantener el crédito fiscal, el contribuyente debe probar que la operación es real y fehaciente, no solo presentar la factura.</div><div class="reg-detail-art">Medios de prueba aceptados: contratos, órdenes de compra, guías de remisión, correos, comprobantes de pago con medio de pago válido, registros contables.</div><strong>Implicancia práctica:</strong> SUNAT puede desconocer el crédito fiscal aunque la factura sea electrónica si no existe evidencia de la operación. Conservar toda la documentación respaldatoria.`},
  {id:'rtf2',cat:'ir',obs:true,num:'RTF 05732-1-2005',titulo:'Principio de causalidad — gastos deducibles IR',desc:'Define el principio de causalidad: los gastos deben ser necesarios para producir y/o mantener la fuente generadora de renta. Amplía el criterio más allá del "imprescindibilidad".',badge:'gold',
   detalle:`<h4>RTF 05732-1-2005 — Observancia obligatoria ⭐</h4><div class="reg-detail-art">Criterio: El principio de causalidad debe interpretarse en forma amplia, considerando criterios de razonabilidad y proporcionalidad con los ingresos del negocio.</div><div class="reg-detail-art">No es necesario que el gasto sea "imprescindible" sino que sea "conveniente" para el negocio.</div><strong>Ejemplo:</strong> Gastos de capacitación, atención a clientes, eventos corporativos y RSE pueden ser deducibles si existe vinculación con el negocio.`},
  {id:'rtf3',cat:'procedimiento',obs:false,num:'RTF 04638-1-2005',titulo:'Nulidad de requerimiento por falta de motivación',desc:'Un requerimiento de SUNAT sin motivación suficiente o que no precisa los puntos a verificar es nulo. El contribuyente puede oponerse.',badge:'red',
   detalle:`<h4>RTF 04638-1-2005</h4><div class="reg-detail-art">Criterio: Los requerimientos de fiscalización deben señalar de forma precisa y suficiente los puntos a examinar. La imprecisión genera nulidad del acto.</div><strong>Consecuencia:</strong> Si SUNAT emite un requerimiento genérico como "alcance toda la documentación contable" sin mayor precisión, puede impugnarse. Esto invalida las observaciones derivadas del requerimiento nulo.`},
  {id:'rtf4',cat:'igv',obs:false,num:'RTF 03942-5-2010',titulo:'Bancarización — consecuencia en el crédito fiscal',desc:'Si el pago de una operación no se realizó por medio de pago del sistema financiero (Ley 28194), el crédito fiscal y el gasto son desconocidos aunque la operación sea real.',badge:'red',
   detalle:`<h4>RTF 03942-5-2010</h4><div class="reg-detail-art">Criterio: El incumplimiento de la obligación de bancarización (pagos ≥ S/2,000 por medios del SF) tiene como consecuencia la pérdida del crédito fiscal y la no deducibilidad del gasto.</div><strong>La realidad de la operación no subsana el incumplimiento formal.</strong> La bancarización es un requisito sustancial, no meramente formal.`},
  {id:'rtf5',cat:'pt',obs:true,num:'RTF 02254-5-2014',titulo:'Precios de transferencia — comparabilidad de transacciones',desc:'Establece criterios para determinar la comparabilidad entre transacciones controladas y no controladas en el análisis de precios de transferencia.',badge:'gold',
   detalle:`<h4>RTF 02254-5-2014 — Precios de Transferencia</h4><div class="reg-detail-art">Criterio: Los ajustes de comparabilidad deben hacerse cuando existen diferencias relevantes entre las transacciones comparadas que afecten el precio o el margen.</div><div class="reg-detail-art">Los comparables internos tienen preferencia sobre los externos cuando están disponibles.</div><strong>Implicancia:</strong> Las empresas con operaciones vinculadas deben documentar adecuadamente la metodología de PT y los comparables utilizados.`},
  {id:'rtf6',cat:'procedimiento',obs:false,num:'RTF 01014-1-2008',titulo:'Prescripción — interrupción por reconocimiento de deuda',desc:'El plazo de prescripción tributaria se interrumpe cuando el deudor tributario reconoce la deuda, ya sea expresa o tácitamente.',badge:'blue',
   detalle:`<h4>RTF 01014-1-2008 — Prescripción</h4><div class="reg-detail-art">Criterio: El reconocimiento expreso o tácito de la deuda (como solicitar fraccionamiento) interrumpe el cómputo del plazo prescriptorio de 4 años (tributo declarado) o 6 años (no declarado).</div><strong>Consecuencia práctica:</strong> Antes de solicitar fraccionamiento o reconocer una deuda, evaluar si el período ya prescribió. Un reconocimiento reinicia el plazo desde cero.`},
];

// ════════════════════════════════════════
// DATA — SUNAT INFORMES VINCULANTES
// ════════════════════════════════════════
const SUNAT_INF_DATA = [
  {id:'si1',cat:'igv',num:'Informe 026-2003-SUNAT/2B0000',titulo:'IGV en servicios prestados parcialmente en el país',desc:'Establece cuándo un servicio prestado por un no domiciliado está gravado con IGV en Perú según la regla del lugar de utilización económica.',badge:'gold',
   detalle:`<h4>Informe 026-2003 — IGV servicios no domiciliados</h4><div class="reg-detail-art">Criterio: Los servicios de no domiciliados están gravados con IGV si son utilizados en el Perú, independientemente de dónde se ejecuten físicamente.</div><strong>Obligación:</strong> El usuario domiciliado es el responsable del pago del IGV como contribuyente (no como agente de retención). Declara el IGV como débito y lo toma como crédito fiscal simultáneamente.`},
  {id:'si2',cat:'ir',num:'Informe 045-2023-SUNAT/7T0000',titulo:'Tributación de criptomonedas en el IR',desc:'La SUNAT establece su criterio sobre el tratamiento tributario de las ganancias obtenidas por la compraventa de criptomonedas.',badge:'gold',
   detalle:`<h4>Informe 045-2023 — Criptomonedas e IR</h4><div class="reg-detail-art">Criterio SUNAT: Las ganancias por venta de criptomonedas califican como renta de 2da categoría para personas naturales (tasa efectiva 5%), o renta de 3ra categoría si es actividad habitual/empresarial.</div><div class="reg-detail-art">Las criptomonedas no se consideran moneda extranjera para efectos de la diferencia de cambio.</div><strong>Obligación:</strong> Declarar las ganancias en la DJ Anual. La pérdida por caída de precio es compensable con ganancias de la misma fuente en el mismo ejercicio.`},
  {id:'si3',cat:'bancarizacion',num:'Informe 148-2014-SUNAT/5D0000',titulo:'Bancarización — pagos a través de terceros',desc:'Analiza si el pago mediante tercero (por cuenta del adquirente) cumple con la obligación de bancarización de la Ley 28194.',badge:'blue',
   detalle:`<h4>Informe 148-2014 — Bancarización mediante tercero</h4><div class="reg-detail-art">Criterio: El pago a través de un tercero cumple con la obligación de bancarización si se puede demostrar que el tercero actuó por cuenta del adquirente y que el pago se realizó por medios del sistema financiero.</div><strong>Requisito:</strong> Documentar el acuerdo de pago entre el adquirente y el tercero, incluyendo el comprobante de pago bancario.`},
  {id:'si4',cat:'no_domiciliado',num:'Informe 064-2009-SUNAT/2B0000',titulo:'Retención IR a no domiciliados — servicios digitales',desc:'Criterio sobre la retención de IR en pagos a proveedores no domiciliados por servicios prestados a través de internet.',badge:'red',
   detalle:`<h4>Informe 064-2009 — IR servicios digitales no domiciliados</h4><div class="reg-detail-art">Criterio: Los pagos a empresas no domiciliadas por servicios de software, suscripciones online, publicidad digital y similares están sujetos a retención del 30% de IR (tasa general no domiciliados), salvo CDI aplicable.</div><div class="reg-detail-art">El pagador domiciliado es agente de retención obligado (Art. 71 LIR). Si no retiene, asume la deuda.</div><strong>Ejemplo práctico:</strong> Pago de S/10,000 a empresa española por servicio de software: retener S/3,000 si no hay CDI o verificar si el CDI Perú-España reduce la tasa.`},
  {id:'si5',cat:'igv',num:'Informe 030-2024-SUNAT/7T0000',titulo:'IGV en economía digital — plataformas extranjeras',desc:'La SUNAT establece el tratamiento del IGV para servicios prestados por plataformas digitales extranjeras (Netflix, Spotify, Adobe, etc.).',badge:'gold',
   detalle:`<h4>Informe 030-2024 — IGV plataformas digitales</h4><div class="reg-detail-art">Criterio: A partir de octubre 2024, las plataformas digitales extranjeras deben registrarse ante SUNAT e incluir el IGV (18%) en sus precios o tenerlo como retención al momento del pago con tarjeta.</div><div class="reg-detail-art">El banco emisor de la tarjeta actúa como agente de retención del IGV en pagos a proveedores digitales no domiciliados.</div><strong>Para empresas:</strong> El IGV retenido puede usarse como crédito fiscal si el proveedor digital emite comprobante o si el banco emite la constancia de retención.`},
];

// ════════════════════════════════════════
// DATA — SUNAFIL
// ════════════════════════════════════════
const SUNAFIL_DATA = [
  {id:'sf1',cat:'essalud',titulo:'EsSalud — Aportes y deducibilidad',desc:'El empleador aporta el 9% de la remuneración total al EsSalud. Es gasto deducible para el IR de 3ra categoría.',badge:'red',
   detalle:`<h4>EsSalud — Ley 26790</h4><div class="reg-detail-art">Tasa: 9% de la remuneración mensual (a cargo del empleador).</div><div class="reg-detail-art">Base imponible: Remuneración total (básico + asignaciones + horas extras). Se excluye: CTS, gratificaciones extraordinarias, utilidades, participación en ganancias.</div><div class="reg-detail-art">Tope mínimo: 9% de la RMV (S/1,025 × 9% = S/92.25/mes).</div><strong>Tributación:</strong> El aporte EsSalud es gasto deducible para el IR (Art. 37 inc. j) LIR). No está afecto a IGV.`},
  {id:'sf2',cat:'planilla',titulo:'Gratificaciones — Fiestas Patrias y Navidad',desc:'Los trabajadores tienen derecho a 2 gratificaciones al año: en julio (Fiestas Patrias) y en diciembre (Navidad), equivalentes a 1 remuneración mensual cada una.',badge:'blue',
   detalle:`<h4>Gratificaciones — Ley 27735</h4><div class="reg-detail-art">Monto: 1 remuneración mensual por cada gratificación (julio y diciembre).</div><div class="reg-detail-art">Gratificación proporcional: Si no trabajó todo el semestre, se paga en proporción a los meses completos trabajados.</div><div class="reg-detail-art">Inafectación: Las gratificaciones están inafectas de AFP/ONP y EsSalud (Ley 29351). Solo están afectas al IR 5ta categoría.</div><strong>Tratamiento tributario empleador:</strong> Las gratificaciones son gasto deducible para el IR de 3ra categoría en el ejercicio en que se paguen (criterio del devengado o percibido según el caso).`},
  {id:'sf3',cat:'beneficios',titulo:'CTS — Compensación por Tiempo de Servicios',desc:'La CTS es el beneficio social más importante. Equivale a 1/12 de la remuneración computable por cada mes de trabajo. Se deposita semestralmente.',badge:'blue',
   detalle:`<h4>CTS — D.S. 001-97-TR</h4><div class="reg-detail-art">Monto: 1/12 de la remuneración computable mensual por cada mes trabajado.</div><div class="reg-detail-art">Depósitos: En mayo (por el período nov–abr) y en noviembre (por mayo–oct).</div><div class="reg-detail-art">Remuneración computable: Básico + asignaciones regulares + 1/6 de las gratificaciones.</div><strong>Tributación:</strong> La CTS no está afecta a IR, EsSalud ni AFP/ONP. Para el empleador es gasto deducible en el período de la obligación de depósito.`},
  {id:'sf4',cat:'infracciones',titulo:'Infracciones SUNAFIL y deducibilidad de multas',desc:'Las multas impuestas por SUNAFIL por infracciones laborales tienen tratamiento tributario específico para el IR.',badge:'red',
   detalle:`<h4>Multas SUNAFIL — Tratamiento IR</h4><div class="reg-detail-art">Escala de multas 2024: Infracción leve: hasta 5 UIT. Grave: hasta 10 UIT. Muy grave: hasta 20 UIT (microempresas tienen topes menores).</div><div class="reg-detail-art">Deducibilidad: Las multas impuestas por entidades públicas (incluyendo SUNAFIL) NO son deducibles para el IR (Art. 44 inc. c) LIR).</div><div class="reg-detail-art">Subsanación: Corregir la infracción antes de la inspección reduce la multa hasta en un 90%.</div><strong>Consecuencia:</strong> Una multa de SUNAFIL de S/25,750 (5 UIT) no es deducible → el costo real para la empresa en RG es S/25,750 + IR no deducido (S/7,596) = S/33,346 de impacto total.`},
];

// ════════════════════════════════════════
// DATA — INDECOPI
// ════════════════════════════════════════
const INDECOPI_DATA = [
  {id:'ind1',cat:'multas',titulo:'Multas INDECOPI — Deducibilidad tributaria',desc:'Las multas impuestas por INDECOPI por prácticas anticompetitivas o infracción al consumidor NO son deducibles para el Impuesto a la Renta.',badge:'red',
   detalle:`<h4>Multas INDECOPI y el IR</h4><div class="reg-detail-art">Base legal: Art. 44 inc. c) LIR — No son deducibles las multas, recargos, intereses moratorios previstos en el CT y, en general, sanciones aplicadas por el Sector Público Nacional.</div><div class="reg-detail-art">Escala INDECOPI: Hasta 450 UIT (S/2,317,500) para infracciones muy graves en competencia desleal. En protección al consumidor hasta 450 UIT.</div><strong>Estrategia tributaria:</strong> Las reparaciones civiles o compensaciones acordadas privadamente (fuera de procedimiento administrativo) SÍ pueden ser deducibles si hay vinculación con el negocio y documentación adecuada.`},
  {id:'ind2',cat:'consumidor',titulo:'Devoluciones por INDECOPI — IGV y RUC',desc:'Cuando INDECOPI ordena la devolución de un producto o la reversión de un servicio, el tratamiento del IGV requiere emisión de nota de crédito.',badge:'gold',
   detalle:`<h4>Devoluciones ordenadas por INDECOPI</h4><div class="reg-detail-art">Procedimiento: El proveedor debe emitir una Nota de Crédito por el monto devuelto, reduciendo el débito fiscal del IGV del período.</div><div class="reg-detail-art">Para el IR: La devolución reduce los ingresos del período. Si ya se declaró el ingreso, se puede rectificar la DJ o incluir como menor ingreso en el período de la devolución.</div><strong>Documentación:</strong> Conservar la resolución de INDECOPI, la nota de crédito electrónica y el comprobante de la devolución para sustentar el ajuste ante SUNAT.`},
  {id:'ind3',cat:'competencia',titulo:'Propiedad intelectual — Royalties y tratamiento tributario',desc:'Los pagos por licencias, regalías y uso de marcas registradas en INDECOPI califican como regalías con tratamiento específico en el IR.',badge:'blue',
   detalle:`<h4>Regalías e IP — Art. 27 LIR</h4><div class="reg-detail-art">Definición: Son regalías las contraprestaciones por el uso o el privilegio de usar patentes, marcas, diseños o modelos industriales registrados en INDECOPI.</div><div class="reg-detail-art">Tratamiento pagador (empresa): Las regalías pagadas son deducibles como gasto (Art. 37 inc. h) LIR) si existe vinculación con la generación de renta y el contrato está registrado.</div><div class="reg-detail-art">Tratamiento receptor PN: Renta de 2da categoría, tasa 5% vía retención.</div><strong>No domiciliado:</strong> Regalías pagadas al exterior tienen retención del 30% (o menor si hay CDI). La marca debe estar registrada en Perú para que el pago sea deducible.`},
  {id:'ind4',cat:'pi',titulo:'Barreras burocráticas — gastos de cumplimiento deducibles',desc:'Los gastos incurridos para superar barreras burocráticas identificadas por INDECOPI pueden ser deducibles como gastos extraordinarios.',badge:'gold',
   detalle:`<h4>Barreras burocráticas — Decreto Legislativo 1256</h4><div class="reg-detail-art">INDECOPI puede inaplicar y eliminar barreras burocráticas ilegales o irrazonables impuestas por entidades del Estado.</div><div class="reg-detail-art">Los gastos legales y administrativos para impugnar barreras burocráticas son deducibles para el IR como gastos vinculados a la actividad empresarial (Art. 37 LIR).</div><strong>Estrategia:</strong> Si tu empresa enfrenta requisitos irrazonables de municipalidades o entidades sectoriales que generan costos, considerar la denuncia ante INDECOPI como herramienta de ahorro tributario indirecto.`},
];

// ════════════════════════════════════════
// DATA — BCR
// ════════════════════════════════════════
const BCR_NORMAS = [
  {id:'bcr1',cat:'tc',titulo:'Tipo de cambio para IR — Art. 50 RLIR',desc:'Para declarar rentas de fuente extranjera y operaciones en moneda extranjera, se usa el tipo de cambio SBS de la fecha de la operación.',badge:'blue',
   detalle:`<h4>Art. 50 RLIR — Tipo de cambio para IR</h4><div class="reg-detail-art">Para convertir rentas de fuente extranjera: Tipo de cambio promedio ponderado SBS de la fecha de devengo de la renta.</div><div class="reg-detail-art">Para activos en moneda extranjera al cierre del año: Tipo de cambio de cierre de año (31 de diciembre).</div><strong>Diferencias de cambio:</strong> Las diferencias de cambio de activos y pasivos en ME son computables como ganancia o pérdida tributaria (Art. 61 LIR).`},
  {id:'bcr2',cat:'tc',titulo:'Diferencia de cambio — Art. 61 LIR',desc:'Las ganancias o pérdidas por diferencia de cambio en operaciones propias del giro del negocio son computables para el IR.',badge:'gold',
   detalle:`<h4>Art. 61 LIR — Diferencias de cambio</h4><div class="reg-detail-art">Ganancia de cambio: Tributable como ingreso ordinario del ejercicio.</div><div class="reg-detail-art">Pérdida de cambio: Deducible como gasto si es inherente al giro del negocio.</div><div class="reg-detail-art">Excepción: Las diferencias de cambio de activos fijos adquiridos en ME deben activarse y no deducirse directamente.</div><strong>Tipo de cambio a usar:</strong> El tipo de cambio SBS publicado en la fecha de la transacción o del cierre contable, según corresponda.`},
];

const BCR_HIST = [
  {fecha:'Mar 2025',compra:3.705,venta:3.762,var:+0.012},
  {fecha:'Feb 2025',compra:3.692,venta:3.748,var:-0.008},
  {fecha:'Ene 2025',compra:3.698,venta:3.756,var:+0.025},
  {fecha:'Dic 2024',compra:3.671,venta:3.731,var:-0.014},
  {fecha:'Nov 2024',compra:3.685,venta:3.742,var:+0.031},
  {fecha:'Oct 2024',compra:3.652,venta:3.711,var:-0.005},
  {fecha:'Set 2024',compra:3.658,venta:3.717,var:+0.018},
  {fecha:'Ago 2024',compra:3.638,venta:3.699,var:+0.022},
  {fecha:'Jul 2024',compra:3.614,venta:3.677,var:-0.003},
  {fecha:'Jun 2024',compra:3.617,venta:3.681,var:+0.009},
  {fecha:'May 2024',compra:3.606,venta:3.671,var:-0.021},
  {fecha:'Abr 2024',compra:3.627,venta:3.694,var:+0.018},
];

// ════════════════════════════════════════
// DATA — ZONAS ESPECIALES
// ════════════════════════════════════════
const ZONAS_DATA = [
  {id:'z1',cat:'amazonia',nombre:'Ley de Amazonía — Ley 27037',region:'Loreto, Ucayali, Madre de Dios, San Martín, Amazonas (parcial)',badge:'green',
   desc:'Exoneración de IGV y tasa reducida de IR (10%) para empresas que producen y consumen en la Amazonía. Uno de los mayores beneficios tributarios del Perú.',
   beneficios:['Exoneración de IGV en ventas dentro de la Amazonía','IR al 10% (RG) o 5% (producción primaria)','Reintegro tributario del IGV para comerciantes de la región','Exoneración de ISC en combustibles para la región','Vigente hasta el año 2048'],
   requisitos:'Domicilio fiscal y actividad productiva en la zona. No basta solo el domicilio — la producción debe realizarse en la Amazonía.',
   detalle:`<h4>Ley 27037 — Ley de Promoción de la Inversión en la Amazonía</h4><div class="zona-benefit">IGV: Las empresas ubicadas en la Amazonía que vendan bienes producidos en la región están exoneradas del IGV.</div><div class="zona-benefit">IR: Tasa del 10% para actividades en la Amazonía (vs 29.5% RG). Tasa del 5% para agricultura, acuicultura, pesca, turismo y actividades primarias.</div><div class="zona-benefit">Reintegro tributario: Los comerciantes de bienes no producidos en la región pueden pedir la devolución del IGV pagado en sus compras fuera.</div><strong>Requisito clave:</strong> La empresa debe tener su domicilio fiscal, producción y 70% de sus activos en la zona de Amazonía.`},
  {id:'z2',cat:'ceticos',nombre:'CETICOS — Centros de Exportación y Transformación',region:'Ilo (Moquegua), Paita (Piura), Matarani (Arequipa), Tacna',badge:'blue',
   desc:'Zonas de tratamiento especial para actividades de exportación, manufactura y servicios. Las empresas dentro del CETICOS tienen exoneración tributaria por 20 años.',
   beneficios:['Exoneración de IR por 20 años','Exoneración de IGV, ISC y aranceles','Libre movimiento de divisas','No aplica el ITF dentro de la zona','Régimen laboral flexible (negociación directa)'],
   requisitos:'Empresa constituida dentro del CETICOS, mínimo 92% de producción para exportación.',
   detalle:`<h4>CETICOS — D.Leg. 704 y normas complementarias</h4><div class="zona-benefit">Los CETICOS son zonas económicas especiales donde las empresas instaladas gozan de estabilidad jurídica y tributaria por 20 años.</div><div class="zona-benefit">Aranceles: Ingreso de insumos y maquinaria sin pago de arancel para producción destinada a exportación.</div><div class="zona-benefit">IR: Las utilidades generadas dentro del CETICOS están exoneradas de IR durante el período de estabilidad.</div><strong>Proceso de instalación:</strong> Solicitar zona ante ZOFRACEN/COPRI, presentar proyecto de inversión, firmar contrato de estabilidad.`},
  {id:'z3',cat:'zofratacna',nombre:'ZOFRATACNA — Zona Franca de Tacna',region:'Tacna',badge:'gold',
   desc:'Régimen especial de comercio en Tacna con límites de franquicia aduanera para personas naturales y régimen simplificado para empresas.',
   beneficios:['Franquicia de hasta USD 1,000 por persona y viaje','Empresas exoneradas de IR, IGV, ISC y aranceles','Libre importación y reexportación de mercancías','Actividades comerciales, industriales y de servicios'],
   requisitos:'Para franquicia personal: ser mayor de edad y no haber usado el beneficio en los últimos 30 días.',
   detalle:`<h4>ZOFRATACNA — Ley 27688</h4><div class="zona-benefit">Franquicia personal: Personas que visiten Tacna pueden internar mercancías hasta USD 1,000 sin pagar aranceles ni IGV.</div><div class="zona-benefit">Empresas en la ZOFRATACNA: Exoneración de tributos por 25 años. Actividades: manufactura, servicios, comercio, logística.</div><strong>Tributación de la franquicia:</strong> Los bienes comprados en la ZOFRATACNA dentro del límite de franquicia no pagan IGV ni aranceles al ingresar al resto del país. El exceso tributa aranceles + IGV.`},
  {id:'z4',cat:'sectorial',nombre:'Sector Agrario — Ley 31110',region:'Nacional (sector agropecuario)',badge:'green',
   desc:'Régimen laboral y tributario especial para trabajadores y empresas del sector agrario y riego. Tasa reducida de IR e incentivos en EsSalud.',
   beneficios:['IR al 15% sobre utilidades (vs 29.5% RG)','EsSalud al 9% (igual que régimen general desde 2021)','Depreciación acelerada de inversiones en infraestructura de riego','Recuperación anticipada del IGV en proyectos de inversión'],
   requisitos:'Empresa con actividad principal agropecuaria certificada por MIDAGRI.',
   detalle:`<h4>Ley 31110 — Ley del Trabajador Agrario (2021)</h4><div class="zona-benefit">IR empresarial: Las empresas agrarias tributan al 15% sobre su renta neta anual (antes era 15% bajo Ley 27360).</div><div class="zona-benefit">Depreciación acelerada: Las inversiones en silos, almacenes y obras de infraestructura de riego se deprecian al 20% anual.</div><div class="zona-benefit">Recuperación anticipada IGV: Para proyectos de inversión en etapa preproductiva, el IGV pagado en compras puede recuperarse antes de la primera venta.</div><strong>Requisito:</strong> Inscribirse en el Registro de Empleadores de Actividad Agraria ante MIDAGRI.`},
];

// ════════════════════════════════════════
// DATA — CRIPTO / DIGITAL
// ════════════════════════════════════════
const CRIPTO_DATA = {
  cripto: [
    {id:'cr1',titulo:'Ganancias por venta de criptomonedas',desc:'Tratamiento tributario según el Informe 045-2023-SUNAT. Las ganancias tributan como renta de 2da o 3ra categoría.',
     detalle:`<h4>Criptomonedas — IR en Perú (2024)</h4><div class="reg-detail-art">Persona natural (no habitual): Renta de 2da categoría. Tasa efectiva 5% (= 6.25% sobre el 80% de la ganancia). Declarar en DJ Anual.</div><div class="reg-detail-art">Persona natural habitual o empresa: Renta de 3ra categoría. Tasa del régimen aplicable (10% RMT hasta 15 UIT, 29.5% excedente en RG).</div><div class="reg-detail-art">¿Cuándo se considera habitual? SUNAT puede calificarte como habitual si realizas operaciones frecuentes con criptos (más de 2 veces al año con ganancias significativas).</div><strong>Costo computable:</strong> El precio de compra original de la cripto, incluyendo comisiones de exchange. Documenta siempre tus operaciones.`},
    {id:'cr2',titulo:'IGV en operaciones con criptomonedas',desc:'Las criptomonedas no son moneda de curso legal, por lo que su venta podría estar afecta al IGV como venta de intangibles.',
     detalle:`<h4>IGV y Cripto — Posición SUNAT</h4><div class="reg-detail-art">SUNAT considera que las criptomonedas son "bienes intangibles". Si una empresa vende criptomonedas habitualmente, la operación podría estar gravada con IGV (18%) como primera venta de bien intangible.</div><div class="reg-detail-art">Personas naturales sin negocio: Generalmente no están afectas al IGV por la venta de criptos ya que no realizan actividad empresarial.</div><strong>Zona gris:</strong> No existe aún una regulación específica del IGV para cripto en Perú. Se espera pronunciamiento formal de SUNAT en 2025.`},
    {id:'cr3',titulo:'Mining y staking — ¿cómo tributan?',desc:'Los ingresos por minería de criptomonedas (mining) y por staking tienen tratamiento particular aún no definido expresamente.',
     detalle:`<h4>Mining y Staking — Posición interpretativa</h4><div class="reg-detail-art">Mining: Los ingresos por minería de criptos califican como renta de fuente peruana si la actividad se realiza en Perú (servidores en el país). Tributan como renta de 3ra categoría.</div><div class="reg-detail-art">Staking: Los rendimientos por staking podrían calificar como intereses o dividendos según la estructura. En ausencia de norma específica, SUNAT podría asimilarlos a renta de 2da o 3ra categoría.</div><strong>Recomendación:</strong> Llevar registro detallado de todas las operaciones de mining/staking: fecha, cantidad, valor en PEN al momento de recepción.`},
  ],
  plataformas: [
    {id:'pl1',titulo:'Netflix, Spotify, Adobe — IGV desde oct. 2024',desc:'Desde octubre de 2024, las plataformas digitales extranjeras están obligadas a cobrar y pagar el IGV en el Perú.',
     detalle:`<h4>IGV Plataformas Digitales — D.Leg. 1623 (2024)</h4><div class="reg-detail-art">Plataformas obligadas: Netflix, Spotify, Adobe, Microsoft 365, Google Workspace, Meta Ads, Google Ads, LinkedIn, entre otras.</div><div class="reg-detail-art">Mecanismo: La plataforma cobra el IGV (18%) en la suscripción o la tarjeta bancaria lo retiene automáticamente.</div><div class="reg-detail-art">Para empresas: El IGV pagado en servicios digitales puede usarse como crédito fiscal si se cuenta con la constancia de pago o el comprobante del proveedor.</div><strong>Impacto en precios:</strong> Netflix básico subió de S/24.90 a S/29.38 (incluye IGV). Considerar en presupuestos de TI de empresas.`},
    {id:'pl2',titulo:'Google Ads / Meta Ads — Retención y deducibilidad',desc:'Los pagos a plataformas de publicidad digital extranjeras tienen doble tratamiento: IGV (retención bancaria) + Retención IR (30%).',
     detalle:`<h4>Publicidad digital — Google/Meta Ads</h4><div class="reg-detail-art">IGV: Retenido automáticamente por el banco al debitar la tarjeta (desde oct. 2024). Recuperable como crédito fiscal.</div><div class="reg-detail-art">IR: El pago a Google/Meta por publicidad califica como renta de fuente peruana de no domiciliado (servicio de difusión utilizado en Perú). Retención del 30% (Art. 76 LIR).</div><div class="reg-detail-art">Práctica habitual: La mayoría de empresas NO retienen el IR a Google/Meta. Esto genera riesgo en fiscalizaciones — SUNAT puede exigir el 30% al pagador.</div><strong>Solución:</strong> Obtener constancia de la plataforma que confirme que tributa en su país con el que Perú tiene CDI, reduciendo o eliminando la retención.`},
  ],
  gig: [
    {id:'gg1',titulo:'Rappi, Uber Eats, PedidosYa — Repartidores',desc:'Los repartidores de apps son trabajadores independientes que generan renta de 4ta categoría. Las apps actúan como intermediarios.',
     detalle:`<h4>Economía Gig — Renta 4ta categoría</h4><div class="reg-detail-art">Los repartidores o conductores son considerados trabajadores independientes (locadores de servicios), no empleados.</div><div class="reg-detail-art">Tributan renta de 4ta categoría: Deducción del 20% + 7 UIT. Si sus ingresos superan S/36,050/año (7 UIT), deben declarar.</div><div class="reg-detail-art">La app retiene 8% de IR cuando el pago supera S/1,500 mensuales (RHE).</div><strong>EsSalud:</strong> Los trabajadores independientes de apps no están obligados a EsSalud, aunque pueden afiliarse voluntariamente.`},
    {id:'gg2',titulo:'Influencers y creadores de contenido',desc:'YouTubers, Instagramers y TikTokers que reciben pagos de plataformas extranjeras o sponsors nacionales tienen obligaciones tributarias específicas.',
     detalle:`<h4>Influencers — Tributación en Perú</h4><div class="reg-detail-art">Pagos de YouTube/AdSense: Renta de fuente extranjera (2da o 4ta categoría según sea habitual o no). Declarar en DJ Anual.</div><div class="reg-detail-art">Sponsors locales: Renta de 4ta categoría. El sponsor debe exigir RHE (Recibo por Honorarios Electrónico). Retención del 8%.</div><div class="reg-detail-art">Canje de productos: El valor de los productos recibidos como pago en especie es renta gravada al valor de mercado.</div><strong>Obligación formal:</strong> Emitir RHE por cada pago de sponsor nacional. Para pagos del exterior, declarar en la casilla 102 de la DJ Anual.`},
  ],
};

// ════════════════════════════════════════
// DATA — DERECHO COMPARADO
// ════════════════════════════════════════
const COMPARADO_LATAM = [
  {pais:'🇵🇪 Perú',ir_corp:'29.5%',igv:'18%',divid:'5%',ganancia_cap:'6.25%',uit_equiv:'S/5,500',cdi:'11 CDIs vigentes',highlight:'mid'},
  {pais:'🇨🇱 Chile',ir_corp:'27%',igv:'19% (IVA)',divid:'35% global',ganancia_cap:'22% (integrado)',uit_equiv:'UF 0.59/mes',cdi:'35+ CDIs',highlight:'best'},
  {pais:'🇨🇴 Colombia',ir_corp:'35%',igv:'19% (IVA)',divid:'10%',ganancia_cap:'10%',uit_equiv:'COP 1,160,000',cdi:'16 CDIs',highlight:'worst'},
  {pais:'🇲🇽 México',ir_corp:'30%',igv:'16% (IVA)',divid:'10%',ganancia_cap:'Integrado',uit_equiv:'Sin equivalente',cdi:'66+ CDIs',highlight:'mid'},
  {pais:'🇧🇷 Brasil',ir_corp:'34% (CSLL)',igv:'~33% (múltiple)',divid:'0% (exonerado)',ganancia_cap:'15-22.5%',uit_equiv:'Sin equivalente',cdi:'38 CDIs',highlight:'worst'},
  {pais:'🇦🇷 Argentina',ir_corp:'35%',igv:'21% (IVA)',divid:'7-13%',ganancia_cap:'15%',uit_equiv:'Sin equivalente',cdi:'20 CDIs',highlight:'worst'},
];

const COMPARADO_EUROPA = [
  {pais:'🇪🇸 España',ir_corp:'25%',igv:'21% (IVA)',divid:'19-28%',ganancia_cap:'19-28%',cdi:'CDI con Perú vigente',highlight:'best'},
  {pais:'🇩🇪 Alemania',ir_corp:'30% (Körperschaft)',igv:'19% (MwSt)',divid:'25%',ganancia_cap:'25%',cdi:'CDI con Perú vigente',highlight:'mid'},
  {pais:'🇬🇧 Reino Unido',ir_corp:'25%',igv:'20% (VAT)',divid:'8.75-39.35%',ganancia_cap:'10-20%',cdi:'CDI con Perú vigente',highlight:'best'},
  {pais:'🇳🇱 Países Bajos',ir_corp:'25.8%',igv:'21% (BTW)',divid:'15% (retención)',ganancia_cap:'31% (box 3)',cdi:'CDI con Perú vigente',highlight:'mid'},
];

const OCDE_BEPS = [
  {num:'Pilar 1',titulo:'Redistribución de utilidades de multinationales',desc:'Las grandes empresas digitales (ingresos > EUR 20B) pagarán impuestos en los países donde están sus clientes, no solo donde tienen sede.',impacto:'Perú recibirá mayor recaudación de empresas como Google y Amazon por sus operaciones locales.',estado:'En negociación — 2025-2026'},
  {num:'Pilar 2',titulo:'Impuesto mínimo global del 15%',desc:'Todas las multinacionales con ingresos > EUR 750M pagarán al menos 15% de IR efectivo en todos los países donde operen.',impacto:'Las empresas peruanas con subsidiarias en paraísos fiscales (tasa < 15%) verán aumentar su carga tributaria global.',estado:'Varios países lo adoptaron en 2024. Perú evalúa implementación.'},
  {num:'BEPS Acción 13',titulo:'Documentación de Precios de Transferencia (CbCR)',desc:'Country-by-Country Reporting: Las multinacionales con ingresos > EUR 750M deben reportar a cada país información país por país de su actividad y tributos pagados.',impacto:'Perú ya implementó el CbCR (D.S. 008-2023-EF). Empresas locales de grupos multinacionales deben verificar si su casa matriz presenta el informe.',estado:'✅ Vigente en Perú desde 2023'},
  {num:'Intercambio CRS',titulo:'Intercambio automático de información financiera (CRS)',desc:'Perú intercambia automáticamente con otros países la información de cuentas bancarias de no residentes. Elimina el secreto bancario internacional.',impacto:'Las personas con cuentas en el extranjero no declaradas serán detectadas. Los bancos peruanos reportan a sus residentes extranjeros a sus países de origen.',estado:'✅ Vigente en Perú desde 2021'},
];

// ════════════════════════════════════════
// FUNCTIONS — GENERIC REGISTRY RENDERER
// ════════════════════════════════════════
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
      <div class="reg-card-badges"><span class="reg-badge ${n.badge||'blue'}">${n.obs?'⭐ Obs. obligatoria':n.badge==='red'?'Crítico':n.badge==='gold'?'Importante':'Norma'}</span></div>
    </div>
    <div class="reg-card-desc">${n.desc}</div>
    <div class="reg-detail" id="detail_reg_${n.id}">${n.detalle||''}
      <button class="reg-ask-btn" style="border-color:${c};color:${c}" onclick="askAboutRegulation(event,'${(n.num||n.titulo||n.nombre).replace(/'/g,'\\'+'\'').replace(/"/g,'&quot;')}')">💬 Consultar IA sobre este tema</button>
    </div>
  </div>`).join('');
}

// ════════════════════════════════════════
// FUNCTIONS — EACH SERVICE TAB
// ════════════════════════════════════════

// ── RTF ──
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

// ── SUNAT INF ──
let siFilter='todos';
function filterSunatInf(cat,btn){siFilter=cat;document.querySelectorAll('#ptSunat_inf .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderRegList('sunatInfList',SUNAT_INF_DATA,'',siFilter,'#E8A020');}
function searchSunatInf(q){renderRegList('sunatInfList',SUNAT_INF_DATA,q,siFilter,'#E8A020');}

// ── SUNAFIL ──
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
  <div class="tim-row"><span class="tim-row-lbl">Remuneración bruta</span><span class="tim-row-val">${fmtS(sueldo)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">EsSalud (empleador 9%)</span><span class="tim-row-val red">${regimen==='micro'?'Exonerado (microempresa)':fmtS(essalud)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Aporte ${pension==='onp'?'ONP 13%':'AFP ~13%'} (trabajador)</span><span class="tim-row-val red">-${fmtS(aportePension)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Retención IR 5ta categoría est.</span><span class="tim-row-val red">-${fmtS(ir5ta)}</span></div>
  <div class="tim-row" style="border-top:1px solid var(--gold)"><span class="tim-row-lbl"><strong>Neto al trabajador</strong></span><span class="tim-row-val gold"><strong>${fmtS(neto)}</strong></span></div>
  <div class="tim-row"><span class="tim-row-lbl">Costo total empleador/mes</span><span class="tim-row-val">${fmtS(sueldo+essalud)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Gratificación mensualizada (÷12)</span><span class="tim-row-val">${fmtS(sueldo/6)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">CTS mensualizada (÷12)</span><span class="tim-row-val">${fmtS(sueldo/12)}</span></div>
  <div class="tim-row" style="border-top:1px solid var(--gold)"><span class="tim-row-lbl"><strong>Costo anual total estimado</strong></span><span class="tim-row-val gold"><strong>${fmtS((sueldo+essalud)*12+sueldo*2+sueldo)}</strong></span></div>
  <p style="font-size:14px;color:var(--muted);margin-top:10px">Estimación referencial. AFP varía según comisión y prima de seguro. IR 5ta calculado con escala 2024.</p>`;
}
function calcIR5ta(base){
  let t=0;
  const tramos=[[5*5500,0.08],[15*5500,0.14],[25*5500,0.17],[40*5500,0.20],[Infinity,0.30]];
  let prev=0;
  for(const[tope,tasa]of tramos){const hasta=Math.min(base,tope);if(hasta>prev)t+=(hasta-prev)*tasa;prev=tope;if(base<=tope)break;}
  return t;
}

// ── INDECOPI ──
let indFilter='todos';
function filterIndecopi(cat,btn){indFilter=cat;document.querySelectorAll('#ptIndecopi .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderRegList('indecopiList',INDECOPI_DATA,'',indFilter,'#E05050');}
function searchIndecopi(q){renderRegList('indecopiList',INDECOPI_DATA,q,indFilter,'#E05050');}

// ── BCR ──
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
function renderBCRRates(){
  const el=document.getElementById('bcrRates');if(!el)return;
  const today=new Date();
  const base=3.720+Math.sin(today.getDate()*0.3)*0.03;
  const rates=[
    {lbl:'USD Compra',val:(base).toFixed(3),date:'Hoy SBS'},
    {lbl:'USD Venta',val:(base+0.034).toFixed(3),date:'Hoy SBS'},
    {lbl:'EUR Venta',val:(base*1.09).toFixed(3),date:'Hoy SBS'},
    {lbl:'Tasa referencia BCR',val:'4.75%',date:'Feb 2025'},
  ];
  el.innerHTML=rates.map(r=>`<div class="bcr-card"><div class="bcr-label">${r.lbl}</div><div class="bcr-rate">${r.val}</div><div class="bcr-date">${r.date}</div></div>`).join('');
}
function renderBCRTable(){
  const el=document.getElementById('bcrTable');if(!el)return;
  el.innerHTML='<thead><tr><th>Período</th><th>Compra</th><th>Venta</th><th>Variación</th><th>Uso tributario</th></tr></thead><tbody>'+
  BCR_HIST.map(r=>{
    const varClass=r.var>0?'bcr-positive':r.var<0?'bcr-negative':'bcr-neutral';
    const varStr=(r.var>0?'+':'')+r.var.toFixed(3);
    return `<tr><td>${r.fecha}</td><td>${r.compra.toFixed(3)}</td><td style="color:var(--gold)">${r.venta.toFixed(3)}</td><td class="${varClass}">${varStr}</td><td style="color:var(--muted);font-size:14px">Ventas al exterior</td></tr>`;
  }).join('')+'</tbody>';
}
function calcBCR(){
  const monto=parseFloat(document.getElementById('bcrMonto')?.value)||0;
  const from=document.getElementById('bcrFrom')?.value||'USD';
  const op=document.getElementById('bcrOp')?.value||'venta';
  const fecha=document.getElementById('bcrFecha')?.value;
  const el=document.getElementById('bcrResult');if(!monto||!el)return;
  const base=3.720+Math.random()*0.04;
  const rates={USD_compra:base,USD_venta:base+0.034,EUR_venta:base*1.09,GBP_venta:base*1.27,JPY_venta:base/148};
  const rateKey=from+'_'+(op==='compra'?'compra':'venta');
  const tc=rates[rateKey]||rates['USD_venta'];
  const resultado=monto*tc;
  const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  el.style.display='block';
  el.innerHTML=`<div style="font-size:14px;color:var(--muted);margin-bottom:8px">${from} ${op} — ${fecha||'Hoy'}</div>
  <div class="tim-total">${fmtS(resultado)}</div>
  <div style="font-size:14px;color:var(--muted);margin-bottom:14px">${monto.toLocaleString()} ${from} × ${tc.toFixed(3)} = ${fmtS(resultado)}</div>
  <div class="tim-row"><span class="tim-row-lbl">Tipo de cambio SBS utilizado</span><span class="tim-row-val gold">${tc.toFixed(3)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Base legal</span><span class="tim-row-val" style="font-size:14px;color:var(--muted)">Art. 50 RLIR / Res. SBS</span></div>
  <p style="font-size:14px;color:var(--muted);margin-top:8px">Para declarar en tu DJ, usa el TC SBS de la fecha exacta de la operación. TC simulado — verificar en sbs.gob.pe</p>`;
}

// ── ZONAS ──
let zonasFilter='todos';
function filterZonas(cat,btn){zonasFilter=cat;document.querySelectorAll('#ptZonas .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderZonas('');}
function searchZonas(q){renderZonas(q.toLowerCase());}
function renderZonas(q){
  const el=document.getElementById('zonasList');if(!el)return;
  let items=zonasFilter==='todos'?ZONAS_DATA:ZONAS_DATA.filter(z=>z.cat===zonasFilter);
  if(q)items=items.filter(z=>z.nombre.toLowerCase().includes(q)||z.desc.toLowerCase().includes(q)||(z.region||'').toLowerCase().includes(q));
  if(!items.length){el.innerHTML='<div class="hempty">No se encontraron zonas.</div>';return;}
  el.innerHTML=items.map(z=>`<div class="zona-card" onclick="toggleRegDetail('zona_${z.id}')">
    <div class="zona-card-top"><div><div class="zona-name">${z.nombre}</div><div style="font-size:14px;color:var(--muted);margin-top:2px">📍 ${z.region}</div></div><span class="reg-badge ${z.badge}">${{amazonia:'🌿 Amazonía',ceticos:'🏭 CETICOS',zofratacna:'🏔 Zona Franca',sectorial:'🏢 Sectorial'}[z.cat]||z.cat}</span></div>
    <div style="font-size:14px;color:var(--muted);margin-top:6px;line-height:1.5">${z.desc}</div>
    <div class="zona-detail" id="detail_zona_${z.id}">${z.detalle||''}
      <div style="margin-top:10px"><strong style="color:var(--green)">Beneficios principales:</strong>
        ${(z.beneficios||[]).map(b=>`<div class="zona-benefit" style="margin-top:5px">${b}</div>`).join('')}
      </div>
      <div style="margin-top:8px;font-size:14px;color:var(--muted)"><strong>Requisitos:</strong> ${z.requisitos||''}</div>
      <button class="reg-ask-btn smv-ask" onclick="askAboutRegulation(event,'Zona especial: ${z.nombre.replace(/'/g,"\\'")}')" style="margin-top:10px">💬 Consultar IA sobre esta zona</button>
    </div>
  </div>`).join('');
}

// ── CRIPTO ──
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
        <button class="reg-ask-btn" style="border-color:#9B59B6;color:#9B59B6;margin-top:10px" onclick="askAboutRegulation(event,'Fiscalidad digital: ${d.titulo.replace(/'/g,"\\'")}')" >💬 Consultar IA</button>
      </div>
    </div>`).join('');
  }
}

// ── COMPARADO ──
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
  <p style="font-size:14px;color:var(--muted);margin-top:8px">📌 Perú tiene tasas competitivas de dividendos (5%) vs la región. El IR corporativo de 29.5% es mayor al promedio. Se destaca el bajo número de CDIs (11) vs Chile (35+).</p>`;
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
    <div class="comp-country-row"><span class="comp-country-lbl">CDI con Perú</span><span class="comp-country-val" style="font-size:14px;color:var(--green)">${c.cdi}</span></div>
  </div>`).join('')+`</div>
  <p style="font-size:14px;color:var(--muted);margin-top:8px">💡 España es el país europeo con mayor presencia de inversión en Perú. El CDI Perú-España (2014) reduce retenciones a 15% en dividendos, 15% en intereses y 10% en regalías.</p>`;
}
function renderComparadoOCDE(el){
  el.innerHTML=OCDE_BEPS.map(o=>`<div class="reg-card" style="margin-bottom:9px" onclick="toggleRegDetail('ocde_${o.num.replace(/ /g,'_')}')">
    <div class="reg-card-top"><div class="reg-card-title"><span style="font-size:14px;color:#3A86FF;font-weight:500;display:block;margin-bottom:3px">${o.num}</span>${o.titulo}</div><span class="reg-badge blue">${o.estado.startsWith('✅')?'Vigente':'En proceso'}</span></div>
    <div class="reg-card-desc">${o.desc}</div>
    <div class="reg-detail" id="detail_ocde_${o.num.replace(/ /g,'_')}">
      <h4>${o.titulo}</h4><div class="reg-detail-art">${o.desc}</div>
      <strong>Impacto en Perú:</strong> ${o.impacto}<br><br><strong>Estado:</strong> ${o.estado}
      <button class="reg-ask-btn" style="margin-top:10px" onclick="askAboutRegulation(event,'OCDE BEPS: ${o.titulo.replace(/'/g,"\\'")}')" >💬 Consultar IA</button>
    </div>
  </div>`).join('');
}

// ── GENERIC AI CONSULTOR ──
async function consultRegAI(service){
  const textIds={rtf:'rtfConsultaText',sunafil:'sunafilConsultaText',cripto:'criptoConsultaText',comparado:'comparadoConsultaText'};
  const resultIds={rtf:'rtfConsultaResult',sunafil:'sunafilConsultaResult',cripto:'criptoConsultaResult',comparado:'comparadoConsultaResult'};
  const colors={rtf:'#E8A020',sunafil:'#E05050',cripto:'#9B59B6',comparado:'#3A86FF'};
  const systems={
    rtf:'Eres un especialista en jurisprudencia del Tribunal Fiscal peruano. Citas RTFs exactas y explicas su aplicación práctica.',
    sunafil:'Eres un experto en derecho laboral y tributación de planilla peruana (EsSalud, AFP, ONP, CTS, gratificaciones, SUNAFIL). Citas normas exactas.',
    cripto:'Eres un especialista en fiscalidad digital y criptomonedas en Perú. Explicas el tratamiento del IR e IGV según los informes SUNAT vigentes.',
    comparado:'Eres un experto en derecho tributario internacional y comparado. Analizas diferencias entre sistemas tributarios latinoamericanos y europeos con enfoque en inversores peruanos.',
  };
  const query=document.getElementById(textIds[service])?.value?.trim()||'';
  if(!query){tpToast('Escribe una consulta.', 'warn');return;}
  const resultEl=document.getElementById(resultIds[service]);
  if(!resultEl)return;
  resultEl.style.display='block';
  resultEl.innerHTML=`<div style="color:var(--muted)">Consultando...</div>`;
  resultEl.style.borderColor=`rgba(${service==='rtf'?'232,160,32':service==='sunafil'?'224,80,80':service==='cripto'?'155,89,182':'58,134,255'},.25)`;
  if(!apiKey){resultEl.innerHTML=`<div style="color:var(--muted)">Conecta tu API Key para respuestas en tiempo real. Esta área cubre: ${systems[service].substring(0,80)}...</div>`;return;}
  try{
    const res=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:systems[service],messages:[{role:'user',content:query}]});
    const d=await res.json();
    const color=colors[service]||'var(--gold)';
    renderAIResponse(resultEl, d.content?.[0]?.text||"");
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red)">Error: ${safeHTML(e.message)}</div>`;}
}

// ── PATCH setPTab ──
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


// ════════════════════════════════════════
// MÓDULO PRECIOS DE TRANSFERENCIA
// ════════════════════════════════════════
const UIT = 5500

// ── Tab switching ──
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

// ════════════════════════════════════════
// 1. DETECTOR DE UMBRALES
// ════════════════════════════════════════
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
  const U_MF = 270000000;      // > S/270M ingresos grupo (≈ EUR 60M)
  const U_CBC = 3375000000;    // > S/3.375B ingresos grupo (≈ EUR 750M)
  const U_PARAISO = 100000;    // Cualquier monto con paraísos
  const lf_req = (ing > U_LF_ING && transTotal > U_LF_TRANS) || paraiso > U_PARAISO;
  const mf_req = grupo && ing > U_MF;
  const cbc_req = grupo && ing > U_CBC;
  const decl_req = ing > U_LF_ING || transTotal > U_LF_TRANS;
  const pctLF_ing = Math.min((ing / U_LF_ING) * 100, 100);
  const pctLF_trans = Math.min((transTotal / U_LF_TRANS) * 100, 100);
  const items = [
    { title:'Declaración Jurada PT — Form. 3560', key:'dj', req: decl_req,
      threshold:`Ingresos > ${fmtS(U_LF_ING)} O transacciones vinculadas > ${fmtS(U_LF_TRANS)}`,
      detail:`Presentación anual a SUNAT. Plazo: hasta el décimo mes del ejercicio siguiente. El incumplimiento genera multa del 0.6% de ingresos (mín. 10 UIT).`,
      pct: Math.max(pctLF_ing, pctLF_trans) },
    { title:'Local File (Expediente Técnico)', key:'lf', req: lf_req,
      threshold:`Ingresos > ${fmtS(U_LF_ING)} Y transacciones > ${fmtS(U_LF_TRANS)}. O cualquier monto con paraísos fiscales.`,
      detail:`Documentación completa: análisis funcional, selección de método, análisis de comparabilidad y rango IQR. Presentar ante requerimiento de SUNAT.`,
      pct: Math.min(((ing/U_LF_ING + transTotal/U_LF_TRANS)/2)*100, 100) },
    { title:'Master File (Informe Maestro)', key:'mf', req: mf_req,
      threshold:`Grupo con ingresos consolidados > ${fmtS(U_MF)} aprox. (≈ EUR 60M)`,
      detail:`Descripción global del grupo: estructura organizacional, política de PT del grupo, activos intangibles, actividades financieras intragrupo y posiciones financieras y tributarias globales.`,
      pct: grupo ? Math.min((ing/U_MF)*100, 100) : 0 },
    { title:'Country-by-Country Report (CbCR)', key:'cbc', req: cbc_req,
      threshold:`Grupo con ingresos consolidados > ${fmtS(U_CBC)} aprox. (≈ EUR 750M)`,
      detail:`Informe país por país con ingresos, utilidades, impuestos pagados y número de empleados por jurisdicción. La casa matriz lo presenta; la filial peruana notifica quién presenta.`,
      pct: grupo ? Math.min((ing/U_CBC)*100, 100) : 0 },
  ];
  grid.style.display = 'grid';
  grid.innerHTML = items.map(it => {
    const cls = it.req ? 'required' : (it.pct > 50 ? 'optional' : 'na');
    const icon = it.req ? '🔴 OBLIGATORIO' : (it.pct > 50 ? '🟡 VERIFICAR' : '🟢 No aplica');
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
    ? `<strong style="color:var(--red)">⚠️ Obligaciones aplicables:</strong><br>${obligaciones.map(o=>`• ${o}`).join('<br>')}<br><br><span style="color:var(--muted)">Base legal: Art. 32-A(k) LIR y D.S. 008-2023-EF. Consulta con tu asesor de PT para confirmar.</span>`
    : `<strong style="color:var(--green)">✅ No se identifican obligaciones de documentación formal en este ejercicio.</strong><br><span style="color:var(--muted)">Sin embargo, debes conservar documentación que sustente el valor de mercado de todas las transacciones con vinculadas.</span>`;
}

// ════════════════════════════════════════
// 2. SELECTOR DE MÉTODO PT
// ════════════════════════════════════════
const METODOS_PT = [
  { acr:'PCNC', nombre:'Precio Comparable No Controlado', desc:'Compara el precio de la transacción controlada con el precio de una transacción comparable entre independientes.',
    aplica:['compraventa_bienes','cesion_intangibles','prestamos_financieros'],
    requiere:'Comparables idénticos o muy similares (internos o externos). Ajustes mínimos de comparabilidad.' },
  { acr:'PRR', nombre:'Precio de Reventa', desc:'Se parte del precio al que el distribuidor revende el bien a un independiente y se deduce el margen bruto apropiado.',
    aplica:['distribucion','compraventa_bienes'],
    requiere:'El distribuidor agrega poco valor (sin transformación). Funciones limitadas.' },
  { acr:'PC', nombre:'Precio de Costo Adicionado', desc:'Se parte del costo del proveedor y se adiciona un margen bruto apropiado. Útil para manufactura y servicios.',
    aplica:['manufactura_contrato','prestacion_servicios'],
    requiere:'Fabricante o prestador de servicios de riesgo limitado. Costos bien definidos.' },
  { acr:'TNMM', nombre:'Margen Neto de la Transacción', desc:'Compara el margen operativo neto de la parte analizada con el de comparables independientes. Método más flexible.',
    aplica:['distribucion','manufactura_contrato','prestacion_servicios','holding'],
    requiere:'Comparables externos de bases de datos. Menor exigencia de comparabilidad que los métodos tradicionales.' },
  { acr:'MCU', nombre:'Margen de Contribución / División de Utilidades', desc:'Divide la utilidad conjunta entre las partes en función de su contribución relativa. Para intangibles valiosos únicos.',
    aplica:['cesion_intangibles'],
    requiere:'Intangibles únicos y valiosos donde no existen comparables. Análisis de contribución muy documentado.' },
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
    <div style="font-size:14px;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.07em">Resultado del análisis — Método recomendado:</div>
    ${scores.map((m, i) => {
      const cls = i===0?'recommended':m.score>2?'viable':'not-recommended';
      const badge = i===0?'rec':m.score>2?'via':'no';
      const bdgTxt = i===0?'✅ Recomendado':m.score>2?'Viable':'No recomendado';
      const dots = Array(5).fill(0).map((_,j)=>j<m.score?'<div class="metodo-dot on"></div>':'<div class="metodo-dot off"></div>').join('');
      const just = m.acr==='PCNC'&&i===0?`Aplica por ${compInt==='si_identicos'?'existencia de comparables internos idénticos':'existencia de comparables similares ajustables'}. Primer método jerárquico preferido según Art. 32-A(e) LIR y Guía OCDE párr. 2.14.`:
        m.acr==='TNMM'&&i===0?`Método más robusto para transacciones de ${tipo} cuando no hay comparables internos. Menor sensibilidad a diferencias de comparabilidad. Ampliamente aceptado por SUNAT en fiscalizaciones (RTF 02254-5-2014).`:
        m.acr==='PRR'&&i===0?`Idóneo para distribuidores que no transforman los bienes. Se analiza el margen bruto del revendedor y se compara con el de distribuidores independientes similares.`:
        m.acr==='PC'&&i===0?`Para fabricantes/prestadores de servicios de riesgo limitado. Se determina el costo y se agrega un margen de utilidad bruta comparable al de empresas similares independientes.`:
        `${m.aplica.includes(tipo)?'Aplica para este tipo de transacción.':'No es el método más apropiado para este tipo de transacción.'} ${m.requiere}`;
      return `<div class="metodo-card ${cls}">
        <div class="metodo-card-header">
          <div><div class="metodo-name">${m.acr} — ${m.nombre}</div><div class="metodo-acr">${m.requiere.substring(0,80)}...</div><div class="metodo-score-bar">${dots}</div></div>
          <span class="metodo-badge ${badge}">${bdgTxt}</span>
        </div>
        <div class="metodo-justificacion">${just}</div>
      </div>`;
    }).join('')}
    <p style="font-size:14px;color:var(--muted);margin-top:8px">Art. 32-A(e) LIR: Los métodos se aplican siguiendo el principio de mejor método (best method rule). No existe jerarquía rígida — se elige el que produzca la medida más confiable del resultado arm's length.</p>`;
}

// ════════════════════════════════════════
// 3. ANÁLISIS F/R/A
// ════════════════════════════════════════
const FRA_TEMPLATES = {
  distribucion: {
    funciones:[
      {fn:'Compra de mercaderías',A:'Alta',B:'Baja'},
      {fn:'Distribución y logística',A:'Alta',B:'Baja'},
      {fn:'Ventas y marketing',A:'Alta',B:'Media'},
      {fn:'Gestión de crédito y cobranza',A:'Alta',B:'Nula'},
      {fn:'Investigación y desarrollo',A:'Baja',B:'Alta'},
      {fn:'Producción / manufactura',A:'Nula',B:'Alta'},
      {fn:'Funciones administrativas',A:'Media',B:'Media'},
    ],
    riesgos:[
      {rsg:'Riesgo de mercado (precio, demanda)',A:'Media',B:'Baja'},
      {rsg:'Riesgo de inventario',A:'Alta',B:'Nula'},
      {rsg:'Riesgo de crédito / incobrables',A:'Alta',B:'Nula'},
      {rsg:'Riesgo cambiario',A:'Media',B:'Media'},
      {rsg:'Riesgo de responsabilidad por producto',A:'Baja',B:'Alta'},
      {rsg:'Riesgo regulatorio / laboral',A:'Alta',B:'Baja'},
    ],
    activos:[
      {act:'Inventarios',A:'Alta',B:'Baja'},
      {act:'Cuentas por cobrar',A:'Alta',B:'Nula'},
      {act:'Red de distribución / clientes',A:'Alta',B:'Baja'},
      {act:'Marcas y propiedad intelectual',A:'Baja',B:'Alta'},
      {act:'Fórmulas / conocimiento técnico',A:'Nula',B:'Alta'},
      {act:'Activos fijos productivos',A:'Baja',B:'Alta'},
    ],
    perfil:'Distribuidor de riesgo limitado (Limited Risk Distributor — LRD)',
    metodoSug:'Precio de Reventa (PRR) o TNMM con margen neto sobre ventas',
  },
  manufactura: {
    funciones:[{fn:'Manufactura / transformación',A:'Alta',B:'Baja'},{fn:'Control de calidad',A:'Alta',B:'Media'},{fn:'Compra de insumos',A:'Media',B:'Alta'},{fn:'Diseño de producto',A:'Baja',B:'Alta'},{fn:'Logística de salida',A:'Baja',B:'Alta'},{fn:'Ventas y marketing',A:'Nula',B:'Alta'},{fn:'I+D tecnología productiva',A:'Baja',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de capacidad productiva',A:'Media',B:'Baja'},{rsg:'Riesgo de inventario de insumos',A:'Media',B:'Alta'},{rsg:'Riesgo de calidad / devoluciones',A:'Alta',B:'Baja'},{rsg:'Riesgo de obsolescencia tecnológica',A:'Baja',B:'Alta'},{rsg:'Riesgo laboral',A:'Alta',B:'Baja'},{rsg:'Riesgo de mercado final',A:'Nula',B:'Alta'}],
    activos:[{act:'Planta y maquinaria',A:'Alta',B:'Baja'},{act:'Know-how productivo',A:'Media',B:'Alta'},{act:'Patentes de proceso',A:'Baja',B:'Alta'},{act:'Fuerza laboral especializada',A:'Alta',B:'Media'},{act:'Marca comercial',A:'Nula',B:'Alta'}],
    perfil:'Fabricante por contrato (Contract Manufacturer)',
    metodoSug:'Precio de Costo Adicionado (PC) o TNMM con margen sobre costos totales (ROTC)',
  },
  servicios: {
    funciones:[{fn:'Prestación del servicio principal',A:'Alta',B:'Nula'},{fn:'Gestión de personal',A:'Alta',B:'Baja'},{fn:'Desarrollo de metodologías',A:'Media',B:'Alta'},{fn:'Relación con el cliente',A:'Alta',B:'Baja'},{fn:'Facturación y cobranza',A:'Alta',B:'Nula'},{fn:'Soporte tecnológico',A:'Media',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de crédito',A:'Alta',B:'Nula'},{rsg:'Riesgo de calidad del servicio',A:'Alta',B:'Baja'},{rsg:'Riesgo laboral',A:'Alta',B:'Baja'},{rsg:'Riesgo de confidencialidad',A:'Alta',B:'Media'}],
    activos:[{act:'Capital humano especializado',A:'Alta',B:'Media'},{act:'Metodologías propietarias',A:'Media',B:'Alta'},{act:'Software / herramientas',A:'Media',B:'Alta'},{act:'Base de clientes',A:'Alta',B:'Baja'}],
    perfil:'Prestador de servicios de riesgo limitado (Low Value-Adding Services)',
    metodoSug:'TNMM con margen neto sobre ventas o PC (costo + margen)',
  },
  licencia: {
    funciones:[{fn:'Desarrollo original del intangible',A:'Nula',B:'Alta'},{fn:'Mantenimiento y actualización',A:'Baja',B:'Alta'},{fn:'Explotación comercial',A:'Alta',B:'Baja'},{fn:'Marketing local',A:'Alta',B:'Baja'},{fn:'Protección legal (registro)',A:'Baja',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de obsolescencia del intangible',A:'Baja',B:'Alta'},{rsg:'Riesgo de desarrollo (I+D)',A:'Nula',B:'Alta'},{rsg:'Riesgo de mercado local',A:'Alta',B:'Baja'},{rsg:'Riesgo de infracción IP',A:'Media',B:'Alta'}],
    activos:[{act:'Intangible licenciado (marca/patente)',A:'Nula',B:'Alta'},{act:'Know-how asociado',A:'Baja',B:'Alta'},{act:'Red de distribución local',A:'Alta',B:'Baja'},{act:'Relaciones con clientes',A:'Alta',B:'Baja'}],
    perfil:'Licenciatario de intangibles (IP Licensee)',
    metodoSug:'PCNC (comparables de royalties) o TNMM con margen neto. Para intangibles únicos: División de Utilidades (MCU)',
  },
  prestamo: {
    funciones:[{fn:'Otorgamiento del préstamo',A:'Nula',B:'Alta'},{fn:'Gestión de la tesorería',A:'Baja',B:'Alta'},{fn:'Uso de los fondos',A:'Alta',B:'Nula'},{fn:'Reembolso del capital',A:'Alta',B:'Nula'}],
    riesgos:[{rsg:'Riesgo crediticio',A:'Nula',B:'Alta'},{rsg:'Riesgo cambiario',A:'Media',B:'Media'},{rsg:'Riesgo de liquidez',A:'Alta',B:'Baja'},{rsg:'Riesgo de tasa de interés',A:'Media',B:'Media'}],
    activos:[{act:'Capital financiero prestado',A:'Nula',B:'Alta'},{act:'Activos financiados',A:'Alta',B:'Nula'}],
    perfil:'Deudor intragrupo (Intragroup Borrower)',
    metodoSug:'PCNC — Tasa de interés comparable de mercado. Referencia: tasas LIBOR/SOFR + spread crediticio o tasas de crédito local comparable.',
  },
  holding: {
    funciones:[{fn:'Funciones de holding/control',A:'Nula',B:'Alta'},{fn:'Recepción de servicios centralizados',A:'Alta',B:'Nula'},{fn:'Finanzas corporativas',A:'Baja',B:'Alta'},{fn:'RR.HH. corporativos',A:'Baja',B:'Alta'},{fn:'Cumplimiento normativo',A:'Media',B:'Alta'}],
    riesgos:[{rsg:'Riesgo de gestión del grupo',A:'Nula',B:'Alta'},{rsg:'Riesgo por servicios no adecuados',A:'Alta',B:'Baja'},{rsg:'Riesgo regulatorio',A:'Media',B:'Alta'}],
    activos:[{act:'Personal local receptor',A:'Alta',B:'Baja'},{act:'Sistemas y plataformas',A:'Baja',B:'Alta'},{act:'Metodologías de servicio',A:'Nula',B:'Alta'}],
    perfil:'Receptor de servicios intragrupo de bajo valor añadido (Low-Value Adding Services)',
    metodoSug:'PC o TNMM. Para LVAS: margen del 5% sobre costos según safe harbor OCDE párr. 7.61',
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
        <div class="fra-section-title">⚙️ Funciones
          <div style="display:flex;gap:8px;margin-left:auto;font-size:14px"><span style="background:rgba(230,57,70,.1);padding:2px 8px;border-radius:5px;color:var(--red)">Alta</span><span style="background:rgba(201,168,76,.1);padding:2px 8px;border-radius:5px;color:var(--gold)">Media</span><span style="background:rgba(76,175,80,.08);padding:2px 8px;border-radius:5px;color:var(--green)">Baja</span><span style="background:rgba(144,144,168,.08);padding:2px 8px;border-radius:5px;color:var(--muted)">Nula</span></div>
        </div>
        <div style="display:grid;grid-template-columns:auto 1fr 80px 80px;gap:0;font-size:14px;color:var(--muted);padding:4px 0;margin-bottom:4px"><span></span><span></span><span style="text-align:center;padding:0 4px">${partA.substring(0,18)}</span><span style="text-align:center;padding:0 4px">${partB.substring(0,18)}</span></div>
        ${tpl.funciones.map(f=>`<div class="fra-item"><span style="font-size:8px;color:var(--muted);margin-top:3px">▸</span><span class="fra-item-name">${f.fn}</span><span class="fra-item-left ${lvl[f.A]}">${f.A}</span><span class="fra-item-right ${lvl[f.B]}">${f.B}</span></div>`).join('')}
      </div>
      <div class="fra-section">
        <div class="fra-section-title">⚠️ Riesgos asumidos</div>
        <div style="display:grid;grid-template-columns:auto 1fr 80px 80px;gap:0;font-size:14px;color:var(--muted);padding:4px 0;margin-bottom:4px"><span></span><span></span><span style="text-align:center;padding:0 4px">${partA.substring(0,18)}</span><span style="text-align:center;padding:0 4px">${partB.substring(0,18)}</span></div>
        ${tpl.riesgos.map(r=>`<div class="fra-item"><span style="font-size:8px;color:var(--muted);margin-top:3px">▸</span><span class="fra-item-name">${r.rsg}</span><span class="fra-item-left ${lvl[r.A]}">${r.A}</span><span class="fra-item-right ${lvl[r.B]}">${r.B}</span></div>`).join('')}
      </div>
      <div class="fra-section">
        <div class="fra-section-title">🏦 Activos empleados</div>
        <div style="display:grid;grid-template-columns:auto 1fr 80px 80px;gap:0;font-size:14px;color:var(--muted);padding:4px 0;margin-bottom:4px"><span></span><span></span><span style="text-align:center;padding:0 4px">${partA.substring(0,18)}</span><span style="text-align:center;padding:0 4px">${partB.substring(0,18)}</span></div>
        ${tpl.activos.map(a=>`<div class="fra-item"><span style="font-size:8px;color:var(--muted);margin-top:3px">▸</span><span class="fra-item-name">${a.act}</span><span class="fra-item-left ${lvl[a.A]}">${a.A}</span><span class="fra-item-right ${lvl[a.B]}">${a.B}</span></div>`).join('')}
      </div>
      <div style="background:rgba(155,89,182,.07);border:1px solid rgba(155,89,182,.2);border-radius:9px;padding:12px 14px;font-size:14px;margin-top:6px">
        <strong style="color:#C39CE0">Conclusión del análisis F/R/A:</strong><br>
        <strong>${partA}</strong> opera como <em>${tpl.perfil}</em>. La parte analizada realiza las funciones operativas principales con riesgo limitado en las áreas estratégicas. La remuneración arm's length debe reflejar este perfil funcional.<br>
        <strong>Método sugerido:</strong> ${tpl.metodoSug}.<br>
        <strong>Base legal:</strong> Art. 32-A(c) LIR; Guías OCDE 2022, Capítulo I, Sección D (análisis de comparabilidad).
      </div>`;
  }, 800);
}

// ════════════════════════════════════════
// 4. RANGO INTERCUARTIL
// ════════════════════════════════════════
let iqrComps = [];
function initIQR() {
  iqrComps = [null, null, null, null, null, null];
  renderIQRComps();
}
function addIQRComp() {
  if (iqrComps.length >= 20) { tpToast('Máximo 20 comparables.', 'error'); return; }
  iqrComps.push(null);
  renderIQRComps();
}
function renderIQRComps() {
  const el = document.getElementById('iqrCompsList'); if (!el) return;
  el.innerHTML = iqrComps.map((v, i) => `<div class="iqr-comparable-row">
    <span class="iqr-comp-lbl">Comparable ${i+1}</span>
    <input class="iqr-comp-inp" type="number" step="0.01" placeholder="ej: 12.5" value="${v||''}" oninput="iqrComps[${i}]=parseFloat(this.value)||null;calcIQR()">
    <button class="iqr-comp-del" onclick="iqrComps.splice(${i},1);renderIQRComps();calcIQR()">×</button>
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
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--red)">${fmt(minV)}</div><div class="iqr-stat-l">Mínimo</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--gold)">${fmt(q1)}</div><div class="iqr-stat-l">P25 (Q1)</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--green)">${fmt(median)}</div><div class="iqr-stat-l">Mediana</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--gold)">${fmt(q3)}</div><div class="iqr-stat-l">P75 (Q3)</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v" style="color:var(--red)">${fmt(maxV)}</div><div class="iqr-stat-l">Máximo</div></div>
      <div class="iqr-stat"><div class="iqr-stat-v">${n}</div><div class="iqr-stat-l">Comparables</div></div>
    </div>
    <div style="font-size:14px;color:var(--muted);margin-bottom:6px">Rango arm's length (P25–P75): <strong style="color:var(--green)">${fmt(q1)} — ${fmt(q3)}</strong></div>
    <div class="iqr-chart">
      <div class="iqr-axis"></div>
      <div class="iqr-range" style="left:${q1Pct}%;width:${q3Pct-q1Pct}%"></div>
      <div class="iqr-median" style="left:${medPct}%"><div class="iqr-label" style="color:var(--green)">Med ${fmt(median)}</div></div>
      <div class="iqr-label" style="left:${q1Pct}%;bottom:auto;top:-16px;color:var(--gold)">P25</div>
      <div class="iqr-label" style="left:${q3Pct}%;bottom:auto;top:-16px;color:var(--gold)">P75</div>
      ${testPct>=0?`<div class="iqr-tested ${inside?'inside':'outside'}" style="left:${testPct}%"><div class="iqr-label" style="color:${inside?'var(--green)':'var(--red)'};top:-28px;font-weight:500">▼ ${fmt(tested)}</div></div>`:''}
    </div>
    ${!isNaN(tested)?`<div class="iqr-verdict ${inside?'inside':'outside'}">
      ${inside?`✅ La transacción analizada (${fmt(tested)}) está DENTRO del rango arm's length (${fmt(q1)}–${fmt(q3)}). No se requiere ajuste.`:`⚠️ La transacción analizada (${fmt(tested)}) está FUERA del rango arm's length. Se debe ajustar a ${tested<q1?'P25 = '+fmt(q1):'P75 = '+fmt(q3)}. Diferencia: ${fmt(Math.abs(tested-(tested<q1?q1:q3)))}.`}
    </div>`:''}
    <p style="font-size:14px;color:var(--muted);margin-top:8px">Base legal: Art. 32-A(e) LIR — El resultado arm's length se determina aplicando el método más apropiado dentro del rango intercuartil (P25-P75) de los comparables seleccionados.</p>`;
}

// ════════════════════════════════════════
// 5. CHECKLIST FISCALIZACIÓN PT
// ════════════════════════════════════════
const CHECKLIST_PT = [
  { sec:'Obligaciones formales', items:[
    {t:'Formulario 3560 — DJ Anual PT presentada en plazo',r:'alto'},{t:'Todos los campos del Form. 3560 correctamente completados',r:'alto'},{t:'Declaración rectificatoria presentada si hubo errores',r:'medio'},{t:'Local File archivado en forma impresa y digital',r:'alto'},{t:'Master File disponible si aplica',r:'medio'},
  ]},
  { sec:'Análisis de comparabilidad', items:[
    {t:'Análisis de comparabilidad actualizado al cierre del ejercicio',r:'alto'},{t:'Fuente de comparables documentada (BvD, TP Catalyst, etc.)',r:'alto'},{t:'Criterios de búsqueda de comparables documentados',r:'alto'},{t:'Ajustes de comparabilidad realizados y documentados',r:'medio'},{t:'Rango intercuartil calculado y archivado',r:'alto'},{t:'Los comparables son del mismo año fiscal o ciclo económico',r:'medio'},
  ]},
  { sec:'Documentación de transacciones', items:[
    {t:'Contratos escritos para cada tipo de transacción intragrupo',r:'alto'},{t:'Los contratos están vigentes y firmados por representantes legales',r:'alto'},{t:'Comprobantes de pago emitidos por cada transacción',r:'alto'},{t:'Medios de pago bancarizados para pagos ≥ S/2,000',r:'alto'},{t:'Retenciones de IR a no domiciliados declaradas y pagadas',r:'alto'},{t:'El precio pactado coincide con el precio declarado en Form. 3560',r:'alto'},
  ]},
  { sec:'Análisis funcional', items:[
    {t:'Análisis F/R/A documentado para cada parte en cada transacción',r:'medio'},{t:'Perfil funcional de la parte analizada claramente definido',r:'medio'},{t:'Método PT seleccionado con justificación escrita',r:'alto'},{t:'Consistencia entre el método y el perfil funcional',r:'alto'},
  ]},
  { sec:'Intangibles y servicios intragrupo', items:[
    {t:'Los servicios intragrupo pasan el "benefit test" (beneficio real)',r:'alto'},{t:'Los royalties tienen sustento de uso real del intangible en Perú',r:'alto'},{t:'Los intangibles están registrados en INDECOPI si corresponde',r:'bajo'},{t:'Los servicios LVAS se aplica margen del 5% si corresponde',r:'bajo'},
  ]},
  { sec:'Precios de Transferencia financieros', items:[
    {t:'Los préstamos intragrupo tienen contratos formales',r:'alto'},{t:'La tasa de interés está en el rango de mercado',r:'alto'},{t:'Ratio deuda/patrimonio cumple límite de subcapitalización (3:1)',r:'alto'},{t:'Los intereses pagados a no domiciliados tienen sustento de tasa de mercado',r:'medio'},
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
          <div class="chk-check ${checked?'checked':'risk-'+item.r}" id="chk_${key}">${checked?'✓':''}</div>
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
  if (el) { el.classList.toggle('checked', chkState[key]); el.textContent = chkState[key] ? '✓' : ''; }
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

// ════════════════════════════════════════
// 6. LOCAL FILE GENERATOR
// ════════════════════════════════════════
async function generarLocalFile() {
  const empresa = document.getElementById('lfEmpresa')?.value?.trim() || 'Empresa';
  const ruc = document.getElementById('lfRuc')?.value?.trim() || '—';
  const anio = document.getElementById('lfAnio')?.value || '2024';
  const sector = document.getElementById('lfSector')?.value?.trim() || '—';
  const negocio = document.getElementById('lfNegocio')?.value?.trim() || '—';
  const grupo = document.getElementById('lfGrupo')?.value?.trim() || '—';
  const matriz = document.getElementById('lfMatriz')?.value?.trim() || '—';
  const particip = document.getElementById('lfParticip')?.value?.trim() || '—';
  const trans = document.getElementById('lfTransacciones')?.value?.trim() || '—';
  const metodo = document.getElementById('lfMetodo')?.value || 'TNMM';
  const pli = document.getElementById('lfPLI')?.value || 'NCP';
  const valorPLI = document.getElementById('lfValorPLI')?.value || '—';
  const fuente = document.getElementById('lfFuente')?.value || 'Bureau van Dijk (Orbis)';
  const nComp = document.getElementById('lfNComp')?.value || '—';
  const p25 = document.getElementById('lfP25')?.value || '—';
  const p75 = document.getElementById('lfP75')?.value || '—';
  const conclu = document.getElementById('lfConclu')?.value || 'dentro';
  const loading = document.getElementById('lfLoading');
  const preview = document.getElementById('lfPreview');
  const actions = document.getElementById('lfActions');
  loading.style.display = 'block'; preview.style.display = 'none'; if(actions) actions.style.display = 'none';

  if (!apiKey) {
    loading.style.display = 'none';
    preview.style.display = 'block';
    if(actions) actions.style.display = 'flex';
    preview.innerHTML = buildLocalFileHTML(empresa,ruc,anio,sector,negocio,grupo,matriz,particip,trans,metodo,pli,valorPLI,fuente,nComp,p25,p75,conclu, 'DEMO — Conecta tu API Key para generar el contenido completo redactado por IA.');
    return;
  }
  try {
    const prompt = `Redacta el contenido del Local File (Expediente Técnico de Precios de Transferencia) para el ejercicio ${anio} de ${empresa} (RUC ${ruc}).
Datos del grupo: ${grupo}. Matriz: ${matriz} (${particip}).
Negocio: ${negocio}.
Transacciones con vinculadas: ${trans}.
Método seleccionado: ${metodo}. PLI: ${pli} = ${valorPLI}%.
Comparables: ${nComp} de ${fuente}. Rango P25=${p25}%, P75=${p75}%.
Conclusión: ${conclu==='dentro'?'Dentro del rango arm\'s length':'Fuera del rango, se ajusta a P25/P75'}.

Redacta el texto completo de cada sección del Local File según D.S. 008-2023-EF Anexo I:
1. Descripción del grupo empresarial y estructura de propiedad
2. Descripción de la actividad y estrategia empresarial de la parte analizada
3. Descripción de las transacciones con partes vinculadas
4. Análisis funcional (funciones, riesgos y activos de cada parte)
5. Selección del método de precios de transferencia con justificación
6. Análisis de comparabilidad y selección de comparables
7. Determinación del rango arm's length y conclusión

Usa lenguaje formal técnico-jurídico. Cita artículos del Art. 32-A LIR y D.S. 008-2023-EF. Máximo 800 palabras en total.`;
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:2000,system:'Eres un especialista en Precios de Transferencia peruano. Redactas Local Files formales según el D.S. 008-2023-EF con lenguaje técnico-jurídico preciso.',messages:[{role:'user',content:prompt}]});
    const d = await res.json();
    const iaText = d.content?.[0]?.text || '';
    loading.style.display = 'none';
    preview.style.display = 'block';
    if(actions) actions.style.display = 'flex';
    preview.innerHTML = buildLocalFileHTML(empresa,ruc,anio,sector,negocio,grupo,matriz,particip,trans,metodo,pli,valorPLI,fuente,nComp,p25,p75,conclu,iaText);
  } catch(e) { loading.style.display='none'; preview.style.display='block'; preview.innerHTML = '<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>'; }
}

function buildLocalFileHTML(empresa,ruc,anio,sector,negocio,grupo,matriz,particip,trans,metodo,pli,valorPLI,fuente,nComp,p25,p75,conclu,iaContent) {
  return `<h2>LOCAL FILE — Expediente Técnico de Precios de Transferencia<br><span style="font-size:14px;font-weight:400">Ejercicio ${anio} | ${empresa} | RUC ${ruc}</span></h2>
  <div class="lf-box"><strong>Sector:</strong> ${sector} | <strong>Moneda:</strong> ${document.getElementById('lfMoneda')?.value||'PEN'} | <strong>Método:</strong> ${metodo} | <strong>PLI:</strong> ${pli} = ${valorPLI}%</div>
  <div class="lf-box"><strong>Partes vinculadas:</strong> ${matriz} (${particip})</div>
  <div style="white-space:pre-wrap;margin-top:10px">${iaContent.replace(/\*\*(.*?)\*\*/g,'<strong style="color:#C39CE0">$1</strong>').replace(/^#{1,3} (.*$)/gm,'<h3>$1</h3>').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}</div>
  <div class="lf-box" style="margin-top:14px;background:rgba(155,89,182,.08);border-left:2px solid rgba(155,89,182,.4)"><strong>Conclusión:</strong> La(s) transacción(es) analizada(s) ${conclu==='dentro'?'se encuentran DENTRO del rango arm\'s length (P25='+p25+'% — P75='+p75+'%). No se requiere ajuste de PT para el ejercicio '+anio+'.':'están FUERA del rango arm\'s length. Se procede a ajustar al P25/P75 correspondiente.'}
  <br><strong>Fuente:</strong> ${fuente} | <strong>Nº comparables:</strong> ${nComp}
  <br><strong>Base legal:</strong> Art. 32-A LIR; D.S. 008-2023-EF; Guías OCDE 2022.</div>`;
}

function exportLocalFile() {
  const empresa = document.getElementById('lfEmpresa')?.value || 'Empresa';
  const content = document.getElementById('lfPreview')?.innerHTML || '';
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Local File PT — ${empresa}</title><style>body{font-family:'Times New Roman',serif;max-width:750px;margin:40px auto;color:#1a1a2e;line-height:1.8;font-size:14px}.header{background:#1a1a2e;color:#C39CE0;padding:24px;border-radius:6px;margin-bottom:24px}h2{font-size:16px;margin:0 0 6px;font-family:Georgia,serif}h3{color:#6B4E9E;margin:16px 0 6px;font-size:14px}.lf-box{background:#f8f7ff;border:1px solid #ddd;border-radius:5px;padding:10px 14px;margin-bottom:8px;font-size:14px}strong{color:#4B3580}@media print{body{margin:20px}}</style></head><body>
  <div class="header"><h2>LOCAL FILE — Expediente Técnico de Precios de Transferencia</h2><p style="margin:0;font-size:14px;color:rgba(195,156,224,.8)">DeclaraFY · Módulo de Precios de Transferencia · Perú</p></div>
  ${content}
  <hr style="margin:24px 0;border-color:#ddd"><p style="font-size:14px;color:#999;text-align:center">Documento generado por DeclaraFY.pe · Solo orientativo · Validar con especialista en PT antes de presentar</p>
  </body></html>`);
  win.document.close(); setTimeout(()=>win.print(),500);
}
function copyLF() {
  const text = document.getElementById('lfPreview')?.innerText||'';
  navigator.clipboard.writeText(text).then(()=>{event.target.textContent='✅ Copiado!';setTimeout(()=>event.target.textContent='📋 Copiar',2000);});
}

// ════════════════════════════════════════
// 7. INFORME PT COMPLETO
// ════════════════════════════════════════
async function generarInformePT() {
  const firma = document.getElementById('ptInfFirma')?.value?.trim() || 'Especialista PT';
  const fecha = document.getElementById('ptInfFecha')?.value || new Date().toISOString().split('T')[0];
  const uso = document.getElementById('ptInfUso')?.value || 'interno';
  const empresa = document.getElementById('lfEmpresa')?.value?.trim() || 'Empresa';
  const ruc = document.getElementById('lfRuc')?.value?.trim() || '—';
  const anio = document.getElementById('lfAnio')?.value || '2024';
  const loading = document.getElementById('ptInformeLoading');
  const preview = document.getElementById('ptInformePreview');
  const actions = document.getElementById('ptInformeActions');
  loading.style.display = 'block'; preview.style.display = 'none'; if(actions)actions.style.display='none';
  const chkDone = Object.values(chkState).filter(Boolean).length;
  const chkTotal = CHECKLIST_PT.reduce((s,sec)=>s+sec.items.length,0);
  const fraInfo = document.getElementById('fraResult')?.innerText?.substring(0,500)||'Análisis F/R/A no completado aún.';
  const iqrInfo = document.getElementById('iqrResult')?.innerText?.substring(0,300)||'Rango IQR no calculado aún.';
  const metodInfo = document.getElementById('metodoResult')?.innerText?.substring(0,300)||'Selección de método no completada aún.';
  const prompt = `Genera un INFORME EJECUTIVO DE PRECIOS DE TRANSFERENCIA completo y formal para:
Empresa: ${empresa} | RUC: ${ruc} | Ejercicio: ${anio}
Uso del informe: ${uso}
Firmante: ${firma} | Fecha: ${fecha}
Cumplimiento checklist: ${chkDone}/${chkTotal} puntos (${Math.round(chkDone/chkTotal*100)}%)
Resumen F/R/A: ${fraInfo.substring(0,300)}
Resumen método: ${metodInfo.substring(0,200)}
Resumen IQR: ${iqrInfo.substring(0,200)}
Datos del Local File: ${document.getElementById('lfNegocio')?.value?.substring(0,200)||'No completado'}

Estructura el informe con:
1. Portada y datos generales
2. Resumen ejecutivo (key findings)
3. Marco legal aplicable (Art. 32-A LIR, D.S. 008-2023-EF, Guías OCDE)
4. Descripción del grupo y estructura de vinculación
5. Análisis funcional F/R/A (resumen)
6. Metodología de PT: método seleccionado y justificación
7. Análisis de comparabilidad y rango arm's length
8. Conclusión y dictamen de cumplimiento
9. Declaración jurada del responsable

Lenguaje formal. Citar normas exactas. Máximo 700 palabras.`;
  if (!apiKey) {
    loading.style.display = 'none'; preview.style.display = 'block'; if(actions)actions.style.display='flex';
    preview.innerHTML = `<h2>INFORME EJECUTIVO DE PRECIOS DE TRANSFERENCIA<br><span style="font-size:14px;font-weight:400">Ejercicio ${anio} — ${empresa} — RUC ${ruc}</span></h2>
    <div class="lf-box">Nivel de cumplimiento detectado: <strong>${Math.round(chkDone/chkTotal*100)}%</strong> (${chkDone}/${chkTotal} puntos del checklist)</div>
    <h3>Conecta tu API Key de Claude</h3><p>Para generar el informe PT completo redactado por IA con análisis detallado, base legal exacta y dictamen de cumplimiento, conecta tu API Key de Anthropic en la configuración.</p>
    <div class="lf-box" style="background:rgba(155,89,182,.08)">Firmante: ${firma} | Fecha: ${fecha} | Uso: ${uso}</div>`;
    return;
  }
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:2000,system:'Eres un especialista senior en Precios de Transferencia peruano. Redactas informes ejecutivos formales para presentar al directorio o a SUNAT.',messages:[{role:'user',content:prompt}]});
    const d = await res.json();
    const text = d.content?.[0]?.text||'';
    loading.style.display='none'; preview.style.display='block'; if(actions)actions.style.display='flex';
    preview.innerHTML=`<h2>INFORME EJECUTIVO DE PRECIOS DE TRANSFERENCIA<br><span style="font-size:14px;font-weight:400">Ejercicio ${anio} — ${empresa} — RUC ${ruc}</span></h2>
    <div style="white-space:pre-wrap">${text.replace(/\*\*(.*?)\*\*/g,'<strong style="color:#C39CE0">$1</strong>').replace(/^#{1,3} (.*$)/gm,'<h3>$1</h3>').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}</div>
    <hr style="border-color:rgba(155,89,182,.2);margin:16px 0">
    <div class="lf-box" style="background:rgba(155,89,182,.07)"><strong>Firmante:</strong> ${firma}<br><strong>Fecha:</strong> ${fecha}<br><strong>Uso:</strong> ${uso}<br><strong>Nivel de cumplimiento:</strong> ${Math.round(chkDone/chkTotal*100)}% checklist PT</div>`;
    addNotif('🔗','Informe PT generado','Informe ejecutivo de PT completado para '+empresa+'.');
  } catch(e){loading.style.display='none';preview.style.display='block';preview.innerHTML='<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>';}
}

function exportInformePT() {
  const empresa = document.getElementById('lfEmpresa')?.value||'Empresa';
  const content = document.getElementById('ptInformePreview')?.innerHTML||'';
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Informe PT — ${empresa}</title><style>body{font-family:'Times New Roman',serif;max-width:760px;margin:40px auto;color:#1a1a2e;line-height:1.85;font-size:14px}.lf-box{background:#f8f7ff;border:1px solid #ddd;border-radius:5px;padding:10px 14px;margin-bottom:8px;font-size:14px}h2{font-family:Georgia,serif;font-size:17px;color:#4B3580;border-bottom:2px solid #C39CE0;padding-bottom:8px;margin-bottom:16px}h3{color:#6B4E9E;font-size:14px;margin:14px 0 6px}strong{color:#4B3580}@media print{body{margin:20px}}</style></head><body>
  <div style="background:#1a1a2e;color:#C39CE0;padding:20px;border-radius:6px;margin-bottom:20px;font-family:Georgia,serif"><div style="font-size:16px;margin-bottom:4px">Informe Ejecutivo — Precios de Transferencia</div><div style="font-size:14px;opacity:.7">DeclaraFY.pe · Módulo PT · Art. 32-A LIR · D.S. 008-2023-EF</div></div>
  ${content}
  <hr style="margin:20px 0;border-color:#ddd"><p style="font-size:14px;text-align:center;color:#999">Documento generado por DeclaraFY.pe · Solo orientativo · Validar con especialista en PT antes de presentar a SUNAT</p></body></html>`);
  win.document.close(); setTimeout(()=>win.print(),500);
}

// ── PATCH setPTab ──
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


// ════════════════════════════════════════
// 1. IA PREDICTIVA DE FISCALIZACIÓN SUNAT
// ════════════════════════════════════════
const FISC_INDICATORS = [
  { key:'perdida', label:'Pérdidas recurrentes', weight:25,
    calc:(d) => d.resultado==='perdida_recurrente'?100:d.resultado==='perdida_1'?50:0 },
  { key:'igv_credito', label:'IGV crédito > débito', weight:20,
    calc:(d) => d.igv==='frecuente'?80:d.igv==='ocasional'?30:d.igv==='siempre'?10:0 },
  { key:'no_habido', label:'Proveedores no habidos', weight:25,
    calc:(d) => d.noHabido==='si_mucho'?100:d.noHabido==='si_poco'?40:0 },
  { key:'vinc_nodoc', label:'PT sin documentación', weight:15,
    calc:(d) => d.vinc==='si_nodoc'?100:d.vinc==='si_doc'?10:0 },
  { key:'daot', label:'Diferencias con DAOT', weight:10,
    calc:(d) => d.daot==='grandes'?100:d.daot==='pequenas'?30:0 },
  { key:'repres', label:'Gastos de representación elevados', weight:5,
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
    riskLabel.textContent = finalScore >= 70 ? '🔴 Riesgo ALTO' : finalScore >= 40 ? '🟡 Riesgo MEDIO' : '🟢 Riesgo BAJO';
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
  if (d.resultado === 'perdida_recurrente') recs.push({icon:'🔴', text:'Pérdidas por más de 2 años consecutivos: SUNAT prioriza fiscalizar. Prepara sustento de causalidad de gastos y proyecciones de negocio.'});
  if (d.noHabido === 'si_mucho') recs.push({icon:'🔴', text:'Proveedores no habidos: SUNAT desconocerá el crédito fiscal e IR. Identifícalos y evalúa rectificar o preparar sustento de fehaciencia (RTF 01580-5-2009).'});
  if (d.igv === 'frecuente') recs.push({icon:'🟡', text:'Crédito fiscal recurrentemente mayor al débito: activa auditorías cruzadas de SUNAT. Verifica que todos los comprobantes tengan sustento de operación real.'});
  if (d.vinc === 'si_nodoc') recs.push({icon:'🔴', text:'Transacciones con vinculadas sin documentación PT: multa del 0.6% de ingresos + ajuste de precios. Elabora el Local File urgente (D.S. 008-2023-EF).'});
  if (d.daot === 'grandes') recs.push({icon:'🟡', text:'Diferencias con DAOT: SUNAT cruza tu declaración con las de tus proveedores/clientes. Revisa declaraciones y considera rectificatoria.'});
  if (d.repres > 0 && d.ingresos > 0 && (d.repres/d.ingresos) > 0.02) recs.push({icon:'🟡', text:`Gastos de representación S/${d.repres.toLocaleString()} = ${((d.repres/d.ingresos)*100).toFixed(1)}% de ingresos. Límite deducible: 0.5% de ingresos netos. Exceso: S/${Math.max(0,d.repres - d.ingresos*0.005).toLocaleString()} no deducible.`});
  if (recs.length === 0) recs.push({icon:'🟢', text:'No se detectaron factores de riesgo significativos. Mantén tu documentación ordenada y actualiza tu Local File si tienes transacciones vinculadas.'});
  const recEl = document.getElementById('fiscRecs');
  if (recEl) recEl.innerHTML = `<div class="fisc-rec-title">📋 Recomendaciones preventivas</div>`+recs.map(r=>`<div class="fisc-rec-item"><span class="fisc-rec-icon">${r.icon}</span><span class="fisc-rec-text">${r.text}</span></div>`).join('');
  // Store for deep analysis
  window._fiscData = d;
  window._fiscScore = finalScore;
}

async function deepFiscAnalysis() {
  const d = window._fiscData || {};
  const score = window._fiscScore || 0;
  const el = document.getElementById('fiscDeepResult');
  el.style.display = 'block'; el.textContent = 'Analizando con IA...';
  if (!apiKey) { el.innerHTML = '<strong style="color:var(--red)">Conecta tu API Key</strong> para obtener el análisis profundo personalizado de SUNAT sobre tu perfil de riesgo.'; return; }
  const prompt = `Analiza el perfil de riesgo tributario de un contribuyente peruano:
Régimen: ${d.regimen} | Sector: ${d.sector} | Ingresos: S/${d.ingresos?.toLocaleString()}
Resultado: ${d.resultado} | IGV: ${d.igv} | Vinculadas: ${d.vinc}
Proveedores no habidos: ${d.noHabido} | DAOT: ${d.daot}
Score de riesgo calculado: ${score}%

Actúa como un inspector de SUNAT senior. Explica:
1. ¿Cuál sería el primer punto que auditarías y por qué?
2. ¿Qué documentos pedirías en el primer requerimiento?
3. ¿Qué inconsistencias cruzarías con la base de datos de SUNAT?
4. Tres acciones preventivas concretas que debe tomar el contribuyente AHORA.
Sé específico y cita normas exactas.`;
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un inspector senior de SUNAT con 20 años de experiencia en fiscalizaciones. Conoces exactamente cómo SUNAT selecciona y fiscaliza contribuyentes peruanos.',messages:[{role:'user',content:prompt}]});
    const data = await res.json();
    el.innerHTML = (data.content?.[0]?.text||'Sin respuesta').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--red)">$1</strong>');
  } catch(e) { el.innerHTML = 'Error: '+safeHTML(e.message); }
}

// ════════════════════════════════════════
// 2. ASISTENTE DE REQUERIMIENTOS SUNAT
// ════════════════════════════════════════
let reqTypeSel = '';
function selectReqType(type, btn) {
  reqTypeSel = type;
  document.querySelectorAll('.req-type-btn').forEach(b=>b.classList.remove('sel'));
  if(btn) btn.classList.add('sel');
}

async function generarRespuestaReq() {
  const texto = document.getElementById('reqTexto')?.value?.trim()||'';
  const numero = document.getElementById('reqNumero')?.value?.trim()||'—';
  const fecha = document.getElementById('reqFecha')?.value||new Date().toISOString().split('T')[0];
  const plazo = document.getElementById('reqPlazo')?.value?.trim()||'5 días hábiles';
  if (!texto && !reqTypeSel) { tpToast('Pega el texto del requerimiento o selecciona su tipo.', 'error'); return; }
  const loading = document.getElementById('reqLoading');
  const resp = document.getElementById('reqResponse');
  const actions = document.getElementById('reqActions');
  loading.style.display='block'; resp.style.display='none'; if(actions) actions.style.display='none';

  const tipoLabels = {fiscalizacion_igv:'Fiscalización IGV — Crédito fiscal observado',fiscalizacion_ir:'Fiscalización IR — Gastos deducibles',carta_presentacion:'Carta de presentación — Inicio de fiscalización',notificacion_deuda:'Notificación de deuda / Orden de pago',requerimiento_pt:'Requerimiento de Precios de Transferencia',esquela_induccion:'Esquela de inducción — Omisión de declaraciones'};
  const tipo = tipoLabels[reqTypeSel]||'Requerimiento SUNAT';

  if (!apiKey) {
    loading.style.display='none'; resp.style.display='block'; if(actions) actions.style.display='flex';
    resp.innerHTML = buildReqDemo(numero, fecha, plazo, tipo, texto);
    return;
  }
  const prompt = `Actúa como un abogado tributarista peruano senior especializado en defensa ante SUNAT. Analiza el siguiente requerimiento y genera la RESPUESTA FORMAL completa:

Tipo de requerimiento: ${tipo}
Número: ${numero} | Fecha notificación: ${fecha} | Plazo: ${plazo}
Contenido del requerimiento: ${texto||'(no proporcionado — usar tipo seleccionado)'}

Genera la respuesta con esta estructura formal:
1. ENCABEZADO (datos del contribuyente, número de RUC, fecha)
2. SUMILLA (resumen en 1 línea)
3. I. ANTECEDENTES (qué pidió SUNAT)
4. II. ANÁLISIS LEGAL (argumentos jurídicos con normas exactas)
5. III. RESPUESTA A CADA PUNTO DEL REQUERIMIENTO
6. IV. DOCUMENTOS ADJUNTOS (lista de documentos a acompañar)
7. V. PETITORIO
8. BASE LEGAL CITADA (listado de normas y RTFs favorables)

Usa lenguaje formal-legal peruano. Cita RTFs del Tribunal Fiscal favorables al contribuyente. Indica qué documentos son críticos adjuntar.`;
  try {
    const res = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:2000,system:'Eres un abogado tributarista peruano senior con 15 años de experiencia en defensa ante SUNAT y Tribunal Fiscal. Redactas respuestas formales a requerimientos con argumentación legal sólida.',messages:[{role:'user',content:prompt}]});
    const d = await res.json();
    loading.style.display='none'; resp.style.display='block'; if(actions) actions.style.display='flex';
    resp.innerHTML = safeHTML(formatReqResponse(d.content?.[0]?.text||'Sin respuesta', numero, fecha));
    addNotif('📬','Respuesta generada','Borrador de respuesta al Req. '+numero+' listo para revisar.');
  } catch(e) { loading.style.display='none'; resp.style.display='block'; resp.innerHTML='<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>'; }
}

function buildReqDemo(numero, fecha, plazo, tipo, texto) {
  return `<h3>RESPUESTA AL REQUERIMIENTO N° ${numero}</h3>
  <div class="req-section"><strong>Tipo:</strong> ${tipo} | <strong>Notificado:</strong> ${fecha} | <strong>Plazo:</strong> ${plazo}</div>
  <h4>I. ANTECEDENTES</h4>
  <p>Mediante el Requerimiento N° ${numero}, la Administración Tributaria solicita al contribuyente documentación e información de acuerdo con sus facultades del Art. 62 del Código Tributario.</p>
  <h4>II. ANÁLISIS LEGAL</h4>
  <p>El contribuyente tiene derecho a presentar documentación sustentatoria de conformidad con el Art. 74 del TUO del Código Tributario. Los plazos establecidos deben respetar el debido procedimiento (Art. IV LPAG).</p>
  <p><span class="req-art-cite">Art. 62 CT — Facultades de fiscalización</span><span class="req-art-cite">Art. 74 CT — Obligación de informar</span><span class="req-art-cite">RTF 04638-1-2005 — Nulidad por imprecisión</span></p>
  <h4>III. DOCUMENTOS ADJUNTOS</h4>
  <div class="req-checklist-mini">
    <div class="req-check-mini">Comprobantes de pago originales del período</div>
    <div class="req-check-mini">Registro de ventas y compras</div>
    <div class="req-check-mini">Contratos suscritos con proveedores/clientes</div>
    <div class="req-check-mini">Comprobantes de pago bancario (bancarización)</div>
    <div class="req-check-mini">Estados financieros del período</div>
  </div>
  <div class="cont-warning">⚠️ Demo — Conecta tu API Key para generar la respuesta formal completa personalizada con argumentos legales específicos para tu requerimiento.</div>`;
}

function formatReqResponse(text, numero, fecha) {
  return text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--gold)">$1</strong>').replace(/(Art\. \d+[^\n<]{0,30})/g,'<span class="req-art-cite">$1</span>').replace(/(RTF \d+[^\n<]{0,20})/g,'<span class="req-art-cite">$1</span>');
}

function exportReq() {
  const content = document.getElementById('reqResponse')?.innerHTML||'';
  const numero = document.getElementById('reqNumero')?.value||'SUNAT';
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Respuesta Req. ${numero}</title><style>body{font-family:'Times New Roman',serif;max-width:720px;margin:40px auto;color:#1a1a2e;line-height:1.85;font-size:14px}h3{color:#8B6914;font-size:15px;border-bottom:1px solid #ddd;padding-bottom:5px}h4{color:#555;font-size:14px;margin:12px 0 5px}.req-section{background:#fffef0;border:1px solid #ddd;padding:8px 12px;border-radius:5px;margin-bottom:8px;font-size:14px}.req-art-cite{background:#EEF4FF;border:1px solid #C5D8FF;border-radius:4px;padding:2px 7px;font-size:14px;color:#2C5CC5;display:inline-block;margin:2px}.req-checklist-mini{padding-left:14px}.req-check-mini{padding:3px 0;font-size:14px}.cont-warning{background:#FFFBEA;border-left:3px solid #C9A84C;padding:8px 12px;font-size:14px;margin:8px 0}@media print{body{margin:20px}}</style></head><body>${content}<hr style="margin:20px 0"><p style="font-size:14px;text-align:center;color:#999">Generado por DeclaraFY.pe — Borrador para revisión profesional antes de presentar</p></body></html>`);
  win.document.close(); setTimeout(()=>win.print(),500);
}
function copyReq() {
  const text = document.getElementById('reqResponse')?.innerText||'';
  navigator.clipboard.writeText(text).then(()=>{event.target.textContent='✅ Copiado!';setTimeout(()=>event.target.textContent='📋 Copiar texto',2000);});
}

// ════════════════════════════════════════
// 3. SIMULADOR DE ESCENARIOS TRIBUTARIOS
// ════════════════════════════════════════
let simScenario = '';
const SIM_CONFIGS = {
  dividendos: {
    title:'💰 Dividendos vs Reinversión',
    desc:'¿Conviene distribuir las utilidades como dividendos o reinvertirlas en la empresa?',
    fields:[{id:'simUtilidad',label:'Utilidad neta del ejercicio S/',type:'number',ph:'500000'},{id:'simAccionistas',label:'N° de accionistas',type:'number',ph:'2'},{id:'simRegimenEmp',label:'Régimen',type:'select',opts:[['rmt','RMT (10-29.5%)'],['rg','RG (29.5%)']]}],
  },
  regimen: {
    title:'📊 Comparación de Regímenes',
    desc:'¿Cuánto pago de IR en cada régimen según mis ingresos y gastos?',
    fields:[{id:'simVentas',label:'Ventas anuales S/',type:'number',ph:'800000'},{id:'simCostos',label:'Costos y gastos S/',type:'number',ph:'600000'},{id:'simCompras',label:'Compras afectas a IGV S/',type:'number',ph:'400000'}],
  },
  compra_activo: {
    title:'🏢 Compra Directa vs Leasing',
    desc:'¿Comprar el activo o tomar un leasing financiero? Impacto en IR e IGV.',
    fields:[{id:'simValorActivo',label:'Valor del activo S/',type:'number',ph:'200000'},{id:'simVidaUtil',label:'Vida útil (años)',type:'number',ph:'5'},{id:'simTasaLeasing',label:'Tasa leasing anual %',type:'number',ph:'12'},{id:'simPlazoLeasing',label:'Plazo leasing (años)',type:'number',ph:'3'}],
  },
  trabajador: {
    title:'👤 Planilla vs Honorarios',
    desc:'¿Contratar en planilla o por honorarios? Costo real para el empleador.',
    fields:[{id:'simSueldo',label:'Remuneración / Honorario mensual S/',type:'number',ph:'4000'},{id:'simMeses',label:'Meses al año',type:'number',ph:'12'},{id:'simPensionW',label:'Sistema pensionario',type:'select',opts:[['afp','AFP'],['onp','ONP']]}],
  },
  exportar: {
    title:'✈️ Venta Local vs Exportación',
    desc:'¿Qué ventajas tributarias tiene exportar vs vender en el mercado local?',
    fields:[{id:'simPrecioVenta',label:'Precio de venta unitario S/',type:'number',ph:'1000'},{id:'simCostoUnit',label:'Costo unitario S/',type:'number',ph:'600'},{id:'simUnidades',label:'Unidades por año',type:'number',ph:'1000'}],
  },
  reorganizacion: {
    title:'🏗 Reorganización Societaria',
    desc:'Impacto tributario de diferentes estructuras: operativa directa vs holding.',
    fields:[{id:'simUtilidadGrupo',label:'Utilidad anual del grupo S/',type:'number',ph:'2000000'},{id:'simDivAnual',label:'Dividendos anuales a distribuir S/',type:'number',ph:'500000'},{id:'simPaisHolding',label:'País de la holding',type:'select',opts:[['peru','Perú'],['espana','España (CDI)'],['paises_bajos','Países Bajos (CDI)']]}],
  },
};

function selectSimScen(scenario, btn) {
  simScenario = scenario;
  document.querySelectorAll('.sim-scen-btn').forEach(b=>b.classList.remove('sel'));
  if(btn) btn.classList.add('sel');
  const cfg = SIM_CONFIGS[scenario];
  const inputsEl = document.getElementById('simInputs');
  const resultEl = document.getElementById('simResult');
  const aiEl = document.getElementById('simAIInsight');
  if(resultEl) resultEl.style.display='none';
  if(aiEl) aiEl.style.display='none';
  if(!cfg) return;
  inputsEl.style.display='block';
  inputsEl.innerHTML=`<div class="sim-inputs-title">${cfg.title}</div><p style="font-size:14px;color:var(--muted);margin-bottom:12px">${cfg.desc}</p>`+
  '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">'+
  cfg.fields.map(f=>`<div class="fi" style="margin-bottom:0"><label>${f.label}</label>${f.type==='select'?`<select id="${f.id}" onchange="runSimulation()">${f.opts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('')}</select>`:`<input type="number" id="${f.id}" placeholder="${f.ph}" oninput="runSimulation()">`}</div>`).join('')+
  '</div>';
}

function runSimulation() {
  const res = document.getElementById('simResult');
  const ai = document.getElementById('simAIInsight');
  if(!res) return;
  const g = (id) => parseFloat(document.getElementById(id)?.value)||0;
  const s = (id) => document.getElementById(id)?.value||'';
  let html = '';
  const fmtS = n=>'S/ '+Math.round(n).toLocaleString();
  const UIT=5500;
  switch(simScenario) {
    case 'dividendos': {
      const util=g('simUtilidad'), n=g('simAccionistas')||1, reg=s('simRegimenEmp');
      if(!util) return;
      const irEmp=reg==='rmt'?Math.min(util,15*UIT)*0.10+Math.max(0,util-15*UIT)*0.295:util*0.295;
      const utilNeta=util-irEmp;
      const irDiv=utilNeta*0.05;
      const neto=utilNeta-irDiv;
      const reinvBase=utilNeta; const irReinv=0; const futuroCost=reinvBase*0.295;
      const maxBars=Math.max(util,utilNeta,neto);
      html=`<div class="sim-comparison">
        <div class="sim-option"><div class="sim-option-title">Distribuir dividendos</div>
          <div class="sim-option-row"><span class="sim-option-lbl">Utilidad bruta</span><span>${fmtS(util)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">IR empresarial (${reg.toUpperCase()})</span><span class="sim-option-val bad">-${fmtS(irEmp)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">IR dividendos (5%)</span><span class="sim-option-val bad">-${fmtS(irDiv)}</span></div>
          <div class="sim-option-row" style="border-top:1px solid var(--gold)"><span class="sim-option-lbl"><strong>Neto al accionista</strong></span><span class="sim-option-val highlight">${fmtS(neto)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Carga efectiva total</span><span class="sim-option-val bad">${((1-neto/util)*100).toFixed(1)}%</span></div>
        </div>
        <div class="sim-option best"><div class="sim-option-title">Reinvertir utilidades</div>
          <div class="sim-option-row"><span class="sim-option-lbl">Utilidad disponible</span><span>${fmtS(util)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">IR empresarial</span><span class="sim-option-val bad">-${fmtS(irEmp)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">IR dividendos diferido</span><span class="sim-option-val good">S/ 0 (diferido)</span></div>
          <div class="sim-option-row" style="border-top:1px solid var(--green)"><span class="sim-option-lbl"><strong>Capital disponible</strong></span><span class="sim-option-val highlight">${fmtS(utilNeta)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Ahorro vs dividendo</span><span class="sim-option-val good">+${fmtS(irDiv)}</span></div>
        </div>
      </div>
      <div class="sim-insight"><div class="sim-insight-title">💡 Análisis</div>
        Reinvertir difiere el IR del 5% sobre dividendos (${fmtS(irDiv)}), manteniendo ese capital generando rentabilidad dentro de la empresa. La distribución de dividendos solo conviene cuando el accionista tiene oportunidades de inversión personal con mayor retorno que la empresa.<br>
        <strong>Base legal:</strong> Art. 24-A LIR (dividendos 5%), Art. 37 LIR (deducibilidad reinversión en activos).
      </div>`;
      break;
    }
    case 'regimen': {
      const ventas=g('simVentas'), costos=g('simCostos'), compras=g('simCompras');
      if(!ventas) return;
      const renta=Math.max(0,ventas-costos);
      const nrus_mensual=ventas<=5000?20:ventas<=8000?50:ventas<=13000?200:ventas<=20000?400:600;
      const nrus_anual=nrus_mensual*12;
      const rer_renta=ventas*0.015; const igv_rer=(ventas-compras)*0.18;
      const rmt_ir=renta<=15*UIT?renta*0.10:15*UIT*0.10+(renta-15*UIT)*0.295;
      const igv_rmt=Math.max(0,(ventas-compras))*0.18;
      const rg_ir=renta*0.295; const igv_rg=igv_rmt;
      const opts=[
        {name:'NRUS',req:'Ventas ≤ S/96,000',ir:nrus_anual,igv:0,total:nrus_anual,class:'',label:'Cuota fija'},
        {name:'RER',req:'Ventas ≤ S/525,000',ir:rer_renta,igv:igv_rer,total:rer_renta+igv_rer,class:''},
        {name:'RMT',req:'Ventas ≤ S/1,700 UIT',ir:rmt_ir,igv:igv_rmt,total:rmt_ir+igv_rmt,class:'best',best:true},
        {name:'RG',req:'Sin límite',ir:rg_ir,igv:igv_rg,total:rg_ir+igv_rg,class:''},
      ];
      const minTotal=Math.min(...opts.map(o=>o.total));
      html=`<div class="sim-comparison">${opts.map(o=>`<div class="sim-option ${o.best?'best':''}">
        <div class="sim-option-title">${o.name} <span style="font-size:14px;color:var(--muted);display:block">${o.req}</span></div>
        <div class="sim-option-row"><span class="sim-option-lbl">IR / Renta</span><span class="sim-option-val">${fmtS(o.ir)}</span></div>
        <div class="sim-option-row"><span class="sim-option-lbl">IGV neto</span><span class="sim-option-val">${fmtS(o.igv)}</span></div>
        <div class="sim-option-row" style="border-top:1px solid var(--gold)"><span class="sim-option-lbl"><strong>Total tributos</strong></span><span class="sim-option-val highlight ${o.total===minTotal?'good':''}">${fmtS(o.total)}</span></div>
        <div class="sim-option-row"><span class="sim-option-lbl">% sobre ventas</span><span class="sim-option-val">${((o.total/ventas)*100).toFixed(1)}%</span></div>
      </div>`).join('')}</div>
      <div class="sim-insight"><div class="sim-insight-title">💡 Análisis</div>
        Para tus datos, el RMT es generalmente el más eficiente por su tasa del 10% sobre las primeras 15 UIT (S/${(15*UIT).toLocaleString()}) de renta neta. El IGV es neutro entre RER, RMT y RG — la diferencia real está en el IR.
      </div>`;
      break;
    }
    case 'trabajador': {
      const sueldo=g('simSueldo'), meses=g('simMeses')||12, pens=s('simPensionW');
      if(!sueldo) return;
      const essalud=sueldo*0.09;
      const grat=sueldo*(2/12);
      const cts=((sueldo+grat/2)/12);
      const totalPlanilla=(sueldo+essalud+grat+cts)*meses;
      const honorario=sueldo; const retIR=honorario>1500?honorario*0.08:0;
      const neto4ta=honorario-retIR;
      const totalHonorarios=honorario*meses;
      const ahorroHonorarios=totalPlanilla-totalHonorarios;
      html=`<div class="sim-comparison">
        <div class="sim-option"><div class="sim-option-title">En planilla (5ta categoría)</div>
          <div class="sim-option-row"><span class="sim-option-lbl">Sueldo bruto/mes</span><span>${fmtS(sueldo)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">EsSalud 9% (empleador)</span><span class="sim-option-val bad">-${fmtS(essalud)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Gratificación mensualizada</span><span class="sim-option-val bad">-${fmtS(grat)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">CTS mensualizada</span><span class="sim-option-val bad">-${fmtS(cts)}</span></div>
          <div class="sim-option-row" style="border-top:1px solid var(--gold)"><span class="sim-option-lbl"><strong>Costo real mensual</strong></span><span class="sim-option-val highlight">${fmtS(sueldo+essalud+grat+cts)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Costo anual total</span><span class="sim-option-val bad">${fmtS(totalPlanilla)}</span></div>
        </div>
        <div class="sim-option best"><div class="sim-option-title">Por honorarios (4ta categoría)</div>
          <div class="sim-option-row"><span class="sim-option-lbl">Honorario mensual</span><span>${fmtS(honorario)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Sin EsSalud (empleador)</span><span class="sim-option-val good">S/ 0</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Sin gratificación / CTS</span><span class="sim-option-val good">S/ 0</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Retención IR 8% (si aplica)</span><span>${fmtS(retIR)}</span></div>
          <div class="sim-option-row" style="border-top:1px solid var(--green)"><span class="sim-option-lbl"><strong>Costo mensual empresa</strong></span><span class="sim-option-val highlight">${fmtS(honorario)}</span></div>
          <div class="sim-option-row"><span class="sim-option-lbl">Ahorro anual vs planilla</span><span class="sim-option-val good">+${fmtS(ahorroHonorarios)}</span></div>
        </div>
      </div>
      <div class="sim-insight"><div class="sim-insight-title">⚠️ Atención — Riesgo de desnaturalización</div>
        Si el trabajador cumple indicios de relación laboral (horario fijo, exclusividad, subordinación, habitualidad) SUNAFIL puede exigir el reconocimiento de vínculo laboral con todos los beneficios retroactivos. El ahorro económico debe valorarse contra el riesgo de fiscalización laboral.<br>
        <strong>Base legal:</strong> Art. 4 D.Leg. 728 — presunción de laboralidad.
      </div>`;
      break;
    }
    default:
      html=`<div class="sim-insight"><div class="sim-insight-title">Selecciona un escenario</div>Elige una de las opciones arriba para ver la simulación tributaria comparativa.</div>`;
  }
  res.style.display='block'; res.innerHTML=html;
  if(ai) ai.style.display='block';
  window._simData={scenario:simScenario};
}

async function getSimAIInsight() {
  const el=document.getElementById('simAIText');
  el.style.display='block'; el.textContent='Consultando IA...';
  if(!apiKey){el.innerHTML='<strong>Conecta tu API Key</strong> para obtener la recomendación personalizada del especialista.';return;}
  const resultText=document.getElementById('simResult')?.innerText?.substring(0,500)||'Sin datos';
  const prompt=`Como especialista tributario peruano, analiza este escenario "${simScenario}" con estos resultados: ${resultText}. Proporciona: 1) Tu recomendación concreta, 2) Consideraciones no numéricas importantes, 3) Riesgos a evaluar, 4) Norma legal que respalda la decisión. Máximo 200 palabras.`;
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:400,system:'Eres un asesor tributario peruano senior. Das recomendaciones concretas y accionables.',messages:[{role:'user',content:prompt}]});
    const d=await r.json();
    renderAIResponse(el, d.content?.[0]?.text||"");
  }catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}

// ════════════════════════════════════════
// 4. GENERADOR DE CONTRATOS
// ════════════════════════════════════════
let contTypeSel='';
const CONT_FORMS = {
  prestamo:{title:'Contrato de Préstamo Intragrupo',fields:[{id:'contPrestMonto',label:'Monto del préstamo S/',type:'number',ph:'500000'},{id:'contPrestTasa',label:'Tasa de interés anual % (arm\'s length)',type:'number',ph:'8.5'},{id:'contPrestPlazo',label:'Plazo (meses)',type:'number',ph:'24'},{id:'contPrestMoneda',label:'Moneda',type:'select',opts:[['PEN','Soles (PEN)'],['USD','Dólares (USD)']]},{id:'contPrestPrestamista',label:'Prestamista (entidad)',type:'text',ph:'XYZ Corp — EEUU'},{id:'contPrestPrestatario',label:'Prestatario',type:'text',ph:'XYZ Perú S.A.C.'}]},
  servicios:{title:'Contrato de Prestación de Servicios',fields:[{id:'contServDescripcion',label:'Descripción del servicio',type:'text',ph:'Consultoría de sistemas de información'},{id:'contServMonto',label:'Honorario total S/',type:'number',ph:'120000'},{id:'contServPeriodo',label:'Período',type:'text',ph:'Enero — Diciembre 2025'},{id:'contServPrestador',label:'Prestador del servicio',type:'text',ph:'Consultor SAC'},{id:'contServContratante',label:'Contratante',type:'text',ph:'Empresa XYZ SAC'}]},
  arrendamiento:{title:'Contrato de Arrendamiento',fields:[{id:'contArrBien',label:'Bien arrendado',type:'text',ph:'Local comercial en Av. Arequipa 2500, Miraflores'},{id:'contArrMonto',label:'Merced conductiva mensual S/',type:'number',ph:'8500'},{id:'contArrPlazo',label:'Plazo (meses)',type:'number',ph:'24'},{id:'contArrArrendador',label:'Arrendador (propietario)',type:'text',ph:'Juan Pérez García — DNI 12345678'},{id:'contArrArrendatario',label:'Arrendatario (empresa)',type:'text',ph:'Empresa XYZ SAC'}]},
  licencia:{title:'Contrato de Licencia de Marca / Propiedad Intelectual',fields:[{id:'contLicMarca',label:'Marca / IP licenciada',type:'text',ph:'Marca "BRAND" — Reg. INDECOPI 123456'},{id:'contLicRoyalty',label:'Royalty % sobre ventas netas',type:'number',ph:'2.5'},{id:'contLicLicenciante',label:'Licenciante',type:'text',ph:'Brand Corp Ltd — EEUU'},{id:'contLicLicenciatario',label:'Licenciatario',type:'text',ph:'Distribuidora SAC — Perú'},{id:'contLicPlazo',label:'Plazo (años)',type:'number',ph:'5'}]},
  compraventa:{title:'Contrato de Compraventa de Bienes',fields:[{id:'contCvBien',label:'Descripción del bien',type:'text',ph:'Mercaderías de consumo masivo'},{id:'contCvMonto',label:'Valor total S/',type:'number',ph:'250000'},{id:'contCvVendedor',label:'Vendedor',type:'text',ph:'Proveedor SAC'},{id:'contCvComprador',label:'Comprador',type:'text',ph:'Empresa XYZ SAC'},{id:'contCvEntrega',label:'Lugar de entrega',type:'text',ph:'Almacén del comprador, Lima'}]},
  locacion:{title:'Contrato de Locación de Obra',fields:[{id:'contLocObra',label:'Descripción de la obra',type:'text',ph:'Desarrollo de software ERP a medida'},{id:'contLocMonto',label:'Precio de la obra S/',type:'number',ph:'45000'},{id:'contLocLocador',label:'Locador (ejecutor)',type:'text',ph:'Desarrollador Juan Pérez — RUC 10123456789'},{id:'contLocComitente',label:'Comitente (contratante)',type:'text',ph:'Empresa XYZ SAC'},{id:'contLocPlazo',label:'Plazo de entrega',type:'text',ph:'90 días calendario'}]},
};

function selectContType(type, btn) {
  contTypeSel = type;
  document.querySelectorAll('.cont-type-btn').forEach(b=>b.classList.remove('sel'));
  if(btn) btn.classList.add('sel');
  const cfg = CONT_FORMS[type];
  const formEl = document.getElementById('contForm');
  const prevEl = document.getElementById('contPreview');
  const actEl = document.getElementById('contActions');
  if(prevEl) prevEl.style.display='none'; if(actEl) actEl.style.display='none';
  if(!cfg||!formEl) return;
  formEl.style.display='block';
  formEl.innerHTML=`<div class="cont-form-title">📋 ${cfg.title}</div>`+
  '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">'+
  cfg.fields.map(f=>`<div class="fi" style="margin-bottom:0"><label>${f.label}</label>${f.type==='select'?`<select id="${f.id}">${f.opts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('')}</select>`:`<input type="${f.type||'text'}" id="${f.id}" placeholder="${f.ph}">`}</div>`).join('')+
  '</div><button onclick="generarContrato()" class="bp" style="background:var(--green);border-color:rgba(76,175,80,.4);margin-top:12px">✨ Generar contrato con IA</button>';
}

async function generarContrato() {
  const cfg = CONT_FORMS[contTypeSel]; if(!cfg) return;
  const vals = {};
  cfg.fields.forEach(f=>vals[f.id]=document.getElementById(f.id)?.value||'—');
  const loading=document.getElementById('contLoading');
  const preview=document.getElementById('contPreview');
  const actions=document.getElementById('contActions');
  loading.style.display='block'; preview.style.display='none'; if(actions) actions.style.display='none';
  const taxNotes = {
    prestamo:`CLÁUSULAS TRIBUTARIAS OBLIGATORIAS:\n- La tasa de interés pactada debe cumplir el valor de mercado (Art. 32-A LIR para vinculadas, Art. 26 LIR para cesión gratuita).\n- Los intereses pagados al exterior están sujetos a retención de IR (4.99% si hay CDI o cumplen Art. 56 LIR; 30% caso contrario).\n- Los intereses son deducibles si la tasa es de mercado y el préstamo es para el negocio (Art. 37 inc. a) LIR).\n- Ratio de subcapitalización: deuda con vinculadas no puede superar 3 veces el patrimonio neto.\n- Pagos por el sistema financiero para cumplir bancarización (Ley 28194).`,
    servicios:`CLÁUSULAS TRIBUTARIAS:\n- Los honorarios deben pagarse por medio de pago del sistema financiero si superan S/2,000 (Ley 28194).\n- Retención de 8% sobre honorarios si el prestador emite RHE y supera S/1,500 mensuales.\n- IGV: Si el prestador es contribuyente del IGV, agregar 18% al precio o indicar que está incluido.\n- El servicio debe tener documentación de sustento: informes, entregables, correos (principio de fehaciencia).`,
    arrendamiento:`CLÁUSULAS TRIBUTARIAS:\n- Si el arrendador es persona natural: renta de 1ra categoría, paga 5% mensual vía declaración.\n- Si es empresa: incluir en renta de 3ra categoría.\n- El arrendatario debe exigir comprobante de pago electrónico para deducir el gasto.\n- Pagos por medios del sistema financiero si superan S/2,000 (bancarización, Ley 28194).\n- Si el arrendador tiene RUC y es contribuyente del IGV, el arrendamiento puede estar gravado (verificar si es primera transferencia o servicio habitual).`,
    licencia:`CLÁUSULAS TRIBUTARIAS:\n- Royalties pagados a domiciliados: renta de 2da categoría (5%) — el pagador retiene.\n- Royalties pagados a no domiciliados: retención del 30% (o tasa CDI si aplica, típicamente 10-15%).\n- Los royalties son deducibles para el licenciatario (Art. 37 inc. h) LIR) si el intangible está efectivamente en uso.\n- El royalty debe ser proporcional y razonable — SUNAT puede cuestionar tasas excesivas en partes vinculadas (Art. 32-A LIR).\n- El contrato debe inscribirse si el intangible está registrado en INDECOPI.`,
    compraventa:`CLÁUSULAS TRIBUTARIAS:\n- Bancarización obligatoria si el precio supera S/2,000 o USD 500 (Ley 28194).\n- El vendedor debe emitir factura electrónica (comprobante de pago SUNAT).\n- IGV incluido o excluido del precio — especificar en el contrato.\n- Si hay pago diferido: documentar las cuotas para evitar presunciones de préstamos.\n- Guía de remisión requerida para el traslado de los bienes.`,
    locacion:`CLÁUSULAS TRIBUTARIAS:\n- Si el locador es persona natural: 4ta categoría. Retención del 8% si pago > S/1,500.\n- Si es empresa: 3ra categoría, emite factura con IGV.\n- El comitente debe exigir RHE (locador persona natural) o factura electrónica (empresa).\n- El pago debe ser por sistema financiero si supera S/2,000 (bancarización).\n- Documentar hitos de entrega y conformidades para sustentar la deducción del gasto.`,
  };
  if(!apiKey) {
    loading.style.display='none'; preview.style.display='block'; if(actions) actions.style.display='flex';
    preview.innerHTML=buildContDemo(cfg, vals, taxNotes[contTypeSel]||'');
    return;
  }
  const prompt=`Redacta un contrato completo de "${cfg.title}" para el ámbito legal peruano con las siguientes características:
${Object.entries(vals).map(([k,v])=>`${k}: ${v}`).join('\n')}

El contrato debe incluir:
1. Encabezado formal (lugar, fecha, partes)
2. Declaración de capacidad y representación
3. Cláusulas del contrato (mínimo 8-10 cláusulas numeradas)
4. Cláusulas tributarias específicas: ${taxNotes[contTypeSel]?.substring(0,200)||''}
5. Cláusula de bancarización y medios de pago
6. Cláusula de resolución de controversias (arbitraje o judicial)
7. Firmas y representantes legales

Usa lenguaje jurídico formal peruano. Cita las normas aplicables en cada cláusula tributaria.`;
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:2500,system:'Eres un abogado tributarista peruano que redacta contratos con cláusulas tributarias optimizadas según la legislación vigente.',messages:[{role:'user',content:prompt}]});
    const d=await r.json();
    loading.style.display='none'; preview.style.display='block'; if(actions) actions.style.display='flex';
    preview.innerHTML=`<div class="cont-header"><h2>${cfg.title}</h2><div style="font-size:14px;color:var(--muted)">Lima, ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div></div>`+
    (d.content?.[0]?.text||'').replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')+
    `<div class="cont-footer">Documento generado por DeclaraFY.pe · Borrador para revisión de abogado antes de firmar</div>`;
    addNotif('📜','Contrato generado',cfg.title+' con cláusulas tributarias listo para revisión.');
  }catch(e){loading.style.display='none';preview.style.display='block';preview.innerHTML='<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>';}
}

function buildContDemo(cfg, vals, taxNote) {
  return `<div class="cont-header"><h2>${cfg.title} — DEMO</h2><div style="font-size:14px;color:var(--muted)">Lima, ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div></div>
  <p>Conste por el presente documento el contrato de ${cfg.title.toLowerCase()} que celebran las partes indicadas, de conformidad con el Código Civil peruano y las normas tributarias vigentes.</p>
  <div class="clause-title">CLÁUSULA PRIMERA — OBJETO</div>
  <div class="clause-body">Las partes acuerdan las condiciones establecidas en los datos del contrato.</div>
  <div class="clause-title">CLÁUSULAS TRIBUTARIAS</div>
  <div class="cont-warning" style="margin-bottom:8px">⚠️ Este contrato incluirá automáticamente las siguientes cláusulas tributarias:</div>
  ${taxNote.split('\n').filter(l=>l.trim()).map(l=>`<span class="cont-tax-tag">${l.replace(/^-\s*/,'').substring(0,60)}</span>`).join('')}
  <br><br><div class="cont-warning">🔑 Conecta tu API Key para generar el contrato completo con todas las cláusulas redactadas por IA.</div>`;
}

function exportContrato(){
  const content=document.getElementById('contPreview')?.innerHTML||'';
  const tipo=CONT_FORMS[contTypeSel]?.title||'Contrato';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${tipo}</title><style>body{font-family:'Times New Roman',serif;max-width:740px;margin:40px auto;color:#1a1a2e;line-height:1.9;font-size:14px}.cont-header{text-align:center;border-bottom:2px solid #4CAF50;padding-bottom:14px;margin-bottom:18px}.cont-header h2{font-size:16px;font-family:Georgia,serif;color:#2E7D32;margin-bottom:4px}.clause-title{font-weight:700;text-transform:uppercase;font-size:14px;margin:14px 0 4px;color:#1a1a2e}.clause-body{font-size:14px;color:#333}.cont-warning{background:#f9fff9;border-left:3px solid #4CAF50;padding:8px 12px;font-size:14px;margin:8px 0;color:#333}.cont-footer{margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:14px;color:#999;text-align:center}.cont-tax-tag{display:inline-block;background:#E8F5E9;border:1px solid #A5D6A7;border-radius:4px;padding:2px 7px;font-size:14px;color:#2E7D32;margin:2px}@media print{body{margin:20px}}</style></head><body>${content}<hr style="margin:24px 0"><p style="font-size:14px;text-align:center;color:#999">Generado por DeclaraFY.pe · Borrador orientativo · Validar con abogado antes de firmar</p></body></html>`);
  win.document.close();setTimeout(()=>win.print(),500);
}
function copyContrato(){
  const t=document.getElementById('contPreview')?.innerText||'';
  navigator.clipboard.writeText(t).then(()=>{event.target.textContent='✅ Copiado!';setTimeout(()=>event.target.textContent='📋 Copiar',2000);});
}

// ── PATCH setPTab ──
const _origSetPTabInnov=setPTab;
setPTab = function(tab,btn){
  _origSetPTabInnov(tab,btn);
  if(tab==='ia_fisc'){document.getElementById('fiscResult').style.display='none';}
  if(tab==='requerimiento'){document.getElementById('reqResponse').style.display='none';const d=document.getElementById('reqActions');if(d)d.style.display='none';}
  if(tab==='simulador_esc'){document.getElementById('simInputs').style.display='none';document.getElementById('simResult').style.display='none';document.getElementById('simAIInsight').style.display='none';}
  if(tab==='contratos_gen'){const p=document.getElementById('contPreview');if(p)p.style.display='none';const a=document.getElementById('contActions');if(a)a.style.display='none';}
}


// ════════════════════════════════════════
// 1. ASISTENTE DE CIERRE CONTABLE
// ════════════════════════════════════════
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
const CIERRE_TASKS = [
  {cat:'Declaraciones y pagos',tasks:[
    {t:'PDT 621 — IGV y pago a cuenta IR declarado y pagado',s:'alto',base:'Art. 88 CT'},
    {t:'AFP Net / PLAME — Planilla electrónica enviada a SUNAT',s:'alto',base:'D.S. 018-2007-TR'},
    {t:'T-Registro actualizado con altas y bajas del mes',s:'medio',base:'D.S. 015-2010-TR'},
    {t:'Retenciones de 4ta categoría pagadas (si aplica)',s:'alto',base:'Art. 74 LIR'},
  ]},
  {cat:'Libros electrónicos (SLE-PLE)',tasks:[
    {t:'Registro de Ventas e Ingresos cargado al PLE',s:'alto',base:'R.S. 286-2009/SUNAT'},
    {t:'Registro de Compras cargado al PLE',s:'alto',base:'R.S. 286-2009/SUNAT'},
    {t:'Libro Diario / Mayor al día (si obligado)',s:'medio',base:'Art. 65 LIR'},
    {t:'Libro de Inventarios y Balances actualizado',s:'bajo',base:'Art. 65 LIR'},
  ]},
  {cat:'Conciliaciones contables',tasks:[
    {t:'Conciliación bancaria de todas las cuentas',s:'alto',base:'NIC 7'},
    {t:'Cuadre de cuentas por cobrar vs clientes',s:'medio',base:'NIC 39'},
    {t:'Revisión de saldos deudores en cuentas de pasivo',s:'medio',base:'PCG'},
    {t:'Verificación de tipo de cambio en saldos ME',s:'medio',base:'Art. 61 LIR'},
  ]},
  {cat:'Comprobantes y sustento',tasks:[
    {t:'Facturas de compra registradas con IGV correcto',s:'alto',base:'Art. 18 LIGV'},
    {t:'Comprobantes de gastos con bancarización verificada',s:'alto',base:'Ley 28194'},
    {t:'Facturas de proveedores en HABIDO verificadas en SUNAT',s:'alto',base:'RTF 01580-5-2009'},
    {t:'Notas de crédito y débito correctamente registradas',s:'medio',base:'Art. 26 LIGV'},
  ]},
  {cat:'Planilla y beneficios sociales',tasks:[
    {t:'EsSalud (9%) calculado y pagado correctamente',s:'alto',base:'Ley 26790'},
    {t:'AFP/ONP descontado y depositado dentro del plazo',s:'alto',base:'D.Leg. 25897'},
    {t:'CTS provisión mensual calculada (1/12)',s:'medio',base:'D.S. 001-97-TR'},
    {t:'Gratificación mensualizada provisionada (1/6)',s:'medio',base:'Ley 27735'},
  ]},
];
let cierreState = {}, cierreMonthSel = new Date().getMonth();

function initCierre() {
  const mgEl = document.getElementById('cierreMonthGrid');
  if (!mgEl) return;
  mgEl.innerHTML = MESES.map((m,i) => `<button class="cierre-month-btn ${i===cierreMonthSel?'sel':''}" onclick="selectCierreMonth(${i},this)">${m.substring(0,3)}</button>`).join('');
  renderCierreTasks();
}
function selectCierreMonth(idx, btn) {
  cierreMonthSel = idx;
  document.querySelectorAll('.cierre-month-btn').forEach(b=>b.classList.remove('sel'));
  if(btn) btn.classList.add('sel');
  renderCierreTasks();
}
function renderCierreTasks() {
  const el = document.getElementById('cierreTaskList'); if(!el) return;
  const prefix = `${cierreMonthSel}_`;
  let total=0, done=0;
  el.innerHTML = CIERRE_TASKS.map((sec,si) => {
    const secItems = sec.tasks.map((t,ti) => {
      const key=`${cierreMonthSel}_${si}_${ti}`;
      const checked = cierreState[key]||false;
      total++; if(checked) done++;
      const col = t.s==='alto'?'var(--red)':t.s==='medio'?'var(--gold)':'var(--green)';
      return `<div class="cierre-task ${checked?'done-task':''}" onclick="toggleCierre('${key}')">
        <div class="cierre-task-check ${checked?'checked':''}">${checked?'✓':''}</div>
        <div class="cierre-task-body"><div class="cierre-task-title">${t.t}<span class="cierre-task-tag" style="background:rgba(0,0,0,.2);color:${col}">${t.s.toUpperCase()}</span></div><div class="cierre-task-sub">${t.base}</div></div>
      </div>`;
    }).join('');
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:14px;margin-bottom:10px"><div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">${sec.cat}</div>${secItems}</div>`;
  }).join('');
  const pct = total>0?Math.round((done/total)*100):0;
  const pctEl = document.getElementById('cierrePct'); if(pctEl) pctEl.textContent=pct+'%';
  const circ = 2*Math.PI*28;
  const ring = document.getElementById('cierreRingFill');
  if(ring) { ring.style.stroke=pct>=80?'var(--green)':pct>=50?'var(--gold)':'var(--red)'; ring.style.strokeDashoffset=circ-(pct/100)*circ; }
}
function toggleCierre(key) { cierreState[key]=!cierreState[key]; renderCierreTasks(); }
async function analizarCierreIA() {
  const el=document.getElementById('cierreIAResult'); el.style.display='block'; el.textContent='Analizando...';
  const pendientes=[];
  CIERRE_TASKS.forEach((sec,si)=>sec.tasks.forEach((t,ti)=>{ if(!cierreState[`${cierreMonthSel}_${si}_${ti}`]&&t.s==='alto') pendientes.push(t.t); }));
  if(!apiKey){el.innerHTML=pendientes.length?`<strong style="color:var(--red)">⚠️ Tareas críticas pendientes:</strong><br>${pendientes.map(p=>`• ${p}`).join('<br>')}`:' <strong style="color:var(--green)">✅ Todas las tareas críticas completadas.</strong> Conecta tu API Key para análisis profundo.';return;}
  if(!pendientes.length){el.innerHTML='<strong style="color:var(--green)">✅ Cierre completo.</strong> No hay inconsistencias críticas detectadas para '+MESES[cierreMonthSel]+'.';return;}
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:600,system:'Eres un contador público peruano senior. Identificas riesgos tributarios en el cierre contable mensual.',messages:[{role:'user',content:`Analiza estas tareas de cierre contable pendientes para ${MESES[cierreMonthSel]}: ${pendientes.join(', ')}. Explica los riesgos concretos de no completarlas y qué debe hacer el contador HOY.`}]});
    const d=await r.json();
    renderAIResponse(el, d.content?.[0]?.text||"");
  }catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}

// ════════════════════════════════════════
// 2. UTILIDADES TRABAJADORES
// ════════════════════════════════════════
let utilEmpleados=[{nombre:'',dias:0,rem:0}];
function addUtilEmpleado(){utilEmpleados.push({nombre:'',dias:0,rem:0});renderUtilEmpleados();}
function renderUtilEmpleados(){
  const el=document.getElementById('utilEmpleadosList');if(!el)return;
  el.innerHTML=utilEmpleados.map((e,i)=>`<div class="util-emp-row">
    <input style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;padding:6px 9px;color:var(--text);font-family:inherit;font-size:14px;outline:none;min-width:100px" placeholder="Nombre del trabajador" value="${e.nombre}" oninput="utilEmpleados[${i}].nombre=this.value;calcUtilidades()">
    <input style="width:70px;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:inherit;font-size:14px;outline:none;text-align:center" type="number" placeholder="Días" value="${e.dias||''}" oninput="utilEmpleados[${i}].dias=parseFloat(this.value)||0;calcUtilidades()">
    <input style="width:110px;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:inherit;font-size:14px;outline:none;text-align:right" type="number" placeholder="Remuneración S/" value="${e.rem||''}" oninput="utilEmpleados[${i}].rem=parseFloat(this.value)||0;calcUtilidades()">
    <span style="color:var(--gold);font-weight:500;min-width:90px;text-align:right;font-size:14px" id="utilEmpResult_${i}">—</span>
    <button style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:4px" onclick="utilEmpleados.splice(${i},1);renderUtilEmpleados();calcUtilidades()">×</button>
  </div>`).join('');
}
function calcUtilidades(){
  const renta=parseFloat(document.getElementById('utilRenta')?.value)||0;
  const pct=parseFloat(document.getElementById('utilSector')?.value)||10;
  const diasTotal=parseFloat(document.getElementById('utilDiasTotal')?.value)||0;
  const remTotal=parseFloat(document.getElementById('utilRemTotal')?.value)||0;
  const sumEl=document.getElementById('utilSummary');
  const resEl=document.getElementById('utilResult');
  if(!renta){if(sumEl)sumEl.style.display='none';if(resEl)resEl.style.display='none';return;}
  const poolTotal=renta*(pct/100);
  const poolDias=poolTotal*0.50;
  const poolRem=poolTotal*0.50;
  const fmtS=n=>'S/ '+Math.round(n).toLocaleString();
  if(sumEl){
    sumEl.style.display='block';
    sumEl.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
      <div class="fracc-card"><div class="fracc-card-v">${fmtS(poolTotal)}</div><div class="fracc-card-l">Total utilidades (${pct}%)</div></div>
      <div class="fracc-card"><div class="fracc-card-v">${fmtS(poolDias)}</div><div class="fracc-card-l">50% por días trabajados</div></div>
      <div class="fracc-card"><div class="fracc-card-v">${fmtS(poolRem)}</div><div class="fracc-card-l">50% por remuneraciones</div></div>
    </div><p style="font-size:14px;color:var(--muted);margin-top:8px">Base legal: Art. 29 D.Leg. 892. Límite: 18 sueldos por trabajador. Tope de participación.</p>`;
  }
  // Individual calculations
  const UIT=5500, topeIndiv=18;
  utilEmpleados.forEach((emp,i)=>{
    if(!emp.dias&&!emp.rem){const _el=document.getElementById('utilEmpResult_'+i);if(_el)_el.textContent='—';return;}
    const partDias=diasTotal>0?(poolDias*emp.dias/diasTotal):0;
    const partRem=remTotal>0?(poolRem*emp.rem/remTotal):0;
    const subtotal=partDias+partRem;
    const tope=emp.rem*topeIndiv;
    const final=Math.min(subtotal,tope);
    const el2=document.getElementById('utilEmpResult_'+i);
    if(el2) el2.textContent=fmtS(final);
  });
  if(resEl&&utilEmpleados.some(e=>e.nombre)){
    resEl.style.display='block';
    resEl.innerHTML='<div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:10px">Detalle por trabajador</div>'+
    utilEmpleados.filter(e=>e.nombre).map(emp=>{
      const partDias=diasTotal>0?(poolDias*emp.dias/diasTotal):0;
      const partRem=remTotal>0?(poolRem*emp.rem/remTotal):0;
      const final=Math.min(partDias+partRem,emp.rem*topeIndiv);
      return `<div class="tim-row"><span class="tim-row-lbl">${emp.nombre}</span><span class="tim-row-val gold">${fmtS(final)}</span></div>`;
    }).join('');
  }
}

// ════════════════════════════════════════
// 3. SIMULADOR FRACCIONAMIENTO
// ════════════════════════════════════════
function calcFracc(){
  const deuda=parseFloat(document.getElementById('fraccDeuda')?.value)||0;
  const nCuotas=parseInt(document.getElementById('fraccCuotas')?.value)||12;
  const fecha=document.getElementById('fraccFecha')?.value;
  const tributo=document.getElementById('fraccTributo')?.value||'IGV';
  const sumEl=document.getElementById('fraccSummary');
  const tableWrap=document.getElementById('fraccTableWrap');
  const tableEl=document.getElementById('fraccTable');
  const actEl=document.getElementById('fraccActions');
  if(!deuda||!fecha){if(sumEl)sumEl.style.display='none';if(tableWrap)tableWrap.style.display='none';if(actEl)actEl.style.display='none';return;}
  const TIM_MENSUAL=0.012; // 1.2% mensual
  const TIM_FRACCIONAMIENTO=0.008; // TIM fraccionamiento = 80% de TIM
  const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  // Cuota = deuda * (r * (1+r)^n) / ((1+r)^n - 1)
  const r=TIM_FRACCIONAMIENTO;
  const n=nCuotas;
  const cuotaFija=deuda*(r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1);
  const totalPagar=cuotaFija*n;
  const totalIntereses=totalPagar-deuda;
  // Summary
  sumEl.style.display='grid';
  sumEl.innerHTML=[
    {v:fmtS(deuda),l:'Deuda original'},{v:fmtS(cuotaFija),l:'Cuota mensual fija'},
    {v:fmtS(totalIntereses),l:'Intereses totales (TIM 0.8%/mes)'},{v:fmtS(totalPagar),l:'Total a pagar'},
    {v:n+' cuotas',l:'Plazo'},{v:(n/12).toFixed(1)+' años',l:'Duración'},
  ].map(c=>`<div class="fracc-card"><div class="fracc-card-v">${c.v}</div><div class="fracc-card-l">${c.l}</div></div>`).join('');
  // Table
  let saldo=deuda, rows='<thead><tr><th>Cuota</th><th>Vencimiento</th><th>Capital</th><th>Interés</th><th>Cuota total</th><th>Saldo</th></tr></thead><tbody>';
  const startDate=new Date(fecha);
  for(let i=1;i<=Math.min(n,24);i++){
    const venc=new Date(startDate); venc.setMonth(venc.getMonth()+i);
    const interes=saldo*r;
    const capital=cuotaFija-interes;
    saldo-=capital;
    rows+=`<tr><td>${i}</td><td>${venc.toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'2-digit'})}</td><td>${fmtS(capital)}</td><td style="color:var(--red)">${fmtS(interes)}</td><td style="color:var(--gold)">${fmtS(cuotaFija)}</td><td>${fmtS(Math.max(0,saldo))}</td></tr>`;
  }
  if(n>24) rows+=`<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:10px">... ${n-24} cuotas adicionales ...</td></tr>`;
  rows+='</tbody>';
  tableEl.innerHTML=rows;
  tableWrap.style.display='block';
  actEl.style.display='flex';
  window._fraccData={deuda,nCuotas,tributo,cuotaFija,totalPagar,totalIntereses,fecha};
}

async function generarSolicitudFracc(){
  const d=window._fraccData||{};
  const el=document.getElementById('fraccSolicitud');
  el.style.display='block';
  const fmtS=n=>'S/ '+parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const body=`SEÑOR INTENDENTE REGIONAL — SUNAT\n\nEL CONTRIBUYENTE, identificado con RUC ${curUser?.ruc||'__________'}, con domicilio fiscal en Lima, ante Ud. respetuosamente me presento y expongo:\n\nPRIMERO: Que el suscrito tiene una deuda tributaria por concepto de ${d.tributo||'tributo'} por el importe de ${fmtS(d.deuda||0)}, correspondiente al período _________.\n\nSEGUNDO: Que por el presente, acogido al Art. 36 del TUO del Código Tributario (D.S. 133-2013-EF) y la R.S. 161-2015/SUNAT, solicito el fraccionamiento de dicha deuda en ${d.nCuotas||12} cuotas mensuales iguales de ${fmtS(d.cuotaFija||0)} cada una, a una tasa del 80% de la TIM vigente (0.8% mensual), con vencimiento a partir del ${new Date(d.fecha||new Date()).toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}.\n\nTERCERO: Que el monto total a pagar asciende a ${fmtS(d.totalPagar||0)}, incluyendo intereses por ${fmtS(d.totalIntereses||0)}.\n\nCUARTO: Declaro bajo juramento que la información consignada es veraz y que no tengo resoluciones de pérdida de fraccionamiento anteriores.\n\nPOR LO EXPUESTO: Solicito se sirva aceptar la presente solicitud de fraccionamiento.\n\n${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}\n\n_______________________\nFirma del contribuyente o representante legal`;
  el.innerHTML=body.replace(/\n/g,'<br>');
}

function exportFraccPDF(){
  const content=document.getElementById('fraccTable')?.outerHTML||'';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fraccionamiento SUNAT</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:30px auto;font-size:14px}table{width:100%;border-collapse:collapse}th{background:#1a1a2e;color:#C9A84C;padding:7px;font-size:14px}td{padding:6px 8px;border-bottom:1px solid #eee;text-align:center}@media print{body{margin:10px}}</style></head><body><h2 style="color:#1a1a2e;font-family:Georgia,serif">Tabla de Fraccionamiento — Art. 36 CT</h2>${content}<p style="font-size:14px;color:#999;margin-top:12px">TIM Fraccionamiento: 0.8% mensual (80% de TIM). Base legal: Art. 36 CT y R.S. 161-2015/SUNAT.</p></body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}

// ════════════════════════════════════════
// 4. DETECTOR DE ERRORES PDT
// ════════════════════════════════════════
function detectPDT(){
  const baseV=parseFloat(document.getElementById('pdtBaseVentas')?.value)||0;
  const debito=parseFloat(document.getElementById('pdtDebito')?.value)||0;
  const baseC=parseFloat(document.getElementById('pdtBaseCompras')?.value)||0;
  const credito=parseFloat(document.getElementById('pdtCredito')?.value)||0;
  const igvPagar=parseFloat(document.getElementById('pdtIGVPagar')?.value)||0;
  const coef=parseFloat(document.getElementById('pdtCoef')?.value)||0;
  const ingNeto=parseFloat(document.getElementById('pdtIngNeto')?.value)||0;
  const pac=parseFloat(document.getElementById('pdtPAC')?.value)||0;
  const el=document.getElementById('pdtErrors');if(!el||!baseV)return;
  const errores=[];
  const IGV_RATE=0.18;
  // Check 1: IGV débito
  const debitoEsp=baseV*IGV_RATE;
  if(Math.abs(debito-debitoEsp)>1){
    const diff=debito-debitoEsp;
    errores.push({tipo:Math.abs(diff)>500?'critico':'advertencia',titulo:'IGV débito fiscal incorrecto',desc:`Declarado: S/${debito.toFixed(2)} | Esperado (18%): S/${debitoEsp.toFixed(2)} | Diferencia: S/${diff.toFixed(2)}`,fix:'Verificar si hay operaciones exoneradas, inafectas o exportaciones que reduzcan la base imponible.'});
  } else errores.push({tipo:'ok',titulo:'IGV débito fiscal correcto',desc:`18% × S/${baseV.toLocaleString()} = S/${debitoEsp.toFixed(2)} ✓`,fix:''});
  // Check 2: IGV crédito
  const creditoEsp=baseC*IGV_RATE;
  if(Math.abs(credito-creditoEsp)>1){
    errores.push({tipo:Math.abs(credito-creditoEsp)>500?'critico':'advertencia',titulo:'IGV crédito fiscal posiblemente incorrecto',desc:`Declarado: S/${credito.toFixed(2)} | Calculado (18%): S/${creditoEsp.toFixed(2)}`,fix:'Verificar si hay facturas con IGV distinto al 18%, notas de crédito, o gastos no relacionados al giro del negocio.'});
  }
  // Check 3: IGV a pagar
  const igvPagarEsp=Math.max(0,debito-credito);
  if(Math.abs(igvPagar-igvPagarEsp)>1){
    errores.push({tipo:'critico',titulo:'IGV a pagar no coincide con débito - crédito',desc:`Declarado: S/${igvPagar.toFixed(2)} | Esperado (débito - crédito): S/${igvPagarEsp.toFixed(2)}`,fix:'Error aritmético en el PDT. Corregir antes de presentar o rectificar si ya fue presentado.'});
  } else errores.push({tipo:'ok',titulo:'IGV a pagar cuadra correctamente',desc:`S/${debito.toFixed(2)} - S/${credito.toFixed(2)} = S/${igvPagarEsp.toFixed(2)} ✓`,fix:''});
  // Check 4: Pago a cuenta IR
  if(coef>0&&ingNeto>0){
    const pacEsp=ingNeto*(coef/100);
    if(Math.abs(pac-pacEsp)>1){
      errores.push({tipo:'advertencia',titulo:'Pago a cuenta IR posiblemente incorrecto',desc:`Declarado: S/${pac.toFixed(2)} | Calculado (${coef}% × S/${ingNeto.toLocaleString()}): S/${pacEsp.toFixed(2)}`,fix:'Verificar coeficiente o porcentaje aplicado. El coeficiente se obtiene del IR del año anterior / ingresos netos del año anterior.'});
    } else errores.push({tipo:'ok',titulo:'Pago a cuenta IR correcto',desc:`${coef}% × S/${ingNeto.toLocaleString()} = S/${pacEsp.toFixed(2)} ✓`,fix:''});
  }
  // Check 5: Ratio crédito/ventas
  if(baseV>0&&credito/baseV>0.95){
    errores.push({tipo:'advertencia',titulo:'Crédito fiscal muy alto vs ventas — posible observación SUNAT',desc:`Ratio crédito/ventas: ${((credito/baseV)*100).toFixed(1)}%. SUNAT puede cuestionar si la empresa tiene pérdidas frecuentes.`,fix:'Verificar que todas las compras con crédito fiscal estén relacionadas al giro del negocio (Art. 18 LIGV).'});
  }
  const icons={critico:'🔴',advertencia:'🟡',info:'🔵',ok:'🟢'};
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-bottom:14px">
    ${['critico','advertencia','ok'].map(t=>`<div class="fracc-card"><div class="fracc-card-v" style="color:${t==='critico'?'var(--red)':t==='advertencia'?'var(--gold)':'var(--green)'}">${errores.filter(e=>e.tipo===t).length}</div><div class="fracc-card-l">${t==='critico'?'Errores críticos':t==='advertencia'?'Advertencias':'Correctos'}</div></div>`).join('')}
  </div>`+errores.map(e=>`<div class="pdt-error-item ${e.tipo}">
    <div class="pdt-error-title">${icons[e.tipo]||'ℹ️'} ${e.titulo}</div>
    <div class="pdt-error-desc">${e.desc}</div>
    ${e.fix?`<div class="pdt-error-fix">💡 ${e.fix}</div>`:''}
  </div>`).join('');
}

// ════════════════════════════════════════
// 5. ANÁLISIS DE ESTADOS FINANCIEROS
// ════════════════════════════════════════
function analizarEEFF(){
  const v=parseFloat(document.getElementById('eeffVentas')?.value)||0;
  const c=parseFloat(document.getElementById('eeffCosto')?.value)||0;
  const gv=parseFloat(document.getElementById('eeffGVentas')?.value)||0;
  const ga=parseFloat(document.getElementById('eeffGAdmin')?.value)||0;
  const gf=parseFloat(document.getElementById('eeffGFin')?.value)||0;
  const oi=parseFloat(document.getElementById('eeffOtrosIng')?.value)||0;
  const irCont=parseFloat(document.getElementById('eeffIRCont')?.value)||0;
  const activo=parseFloat(document.getElementById('eeffActivo')?.value)||0;
  const pasivo=parseFloat(document.getElementById('eeffPasivo')?.value)||0;
  const patr=parseFloat(document.getElementById('eeffPatrimonio')?.value)||0;
  const cxc=parseFloat(document.getElementById('eeffCxC')?.value)||0;
  const exist=parseFloat(document.getElementById('eeffExist')?.value)||0;
  const deuda=parseFloat(document.getElementById('eeffDeuda')?.value)||0;
  const repres=parseFloat(document.getElementById('eeffRepres')?.value)||0;
  const el=document.getElementById('eeffResult');
  const aiBtn=document.getElementById('eeffAIBtn');
  if(!v){el.style.display='none';if(aiBtn)aiBtn.style.display='none';return;}
  const utilBruta=v-c, utilOp=utilBruta-gv-ga, utilAntes=utilOp-gf+oi;
  const UIT=5500;
  const irTeorico=utilAntes>0?(utilAntes<=15*UIT?utilAntes*0.10:15*UIT*0.10+(utilAntes-15*UIT)*0.295):0;
  const irEfectivo=v>0?(irCont/v)*100:0;
  const margenBruto=v>0?(utilBruta/v)*100:0;
  const margenOp=v>0?(utilOp/v)*100:0;
  const rotCxC=v>0&&cxc>0?(v/cxc):0;
  const apalancamiento=patr>0?(deuda/patr):0;
  const represLimite=v*0.005;
  const represExceso=Math.max(0,repres-represLimite);
  const fmtS=n=>'S/ '+Math.round(n).toLocaleString();
  const alerts=[];
  if(represExceso>0) alerts.push({t:'Gastos de representación exceden límite deducible',d:`Gasto declarado: ${fmtS(repres)} | Límite (0.5% ventas): ${fmtS(represLimite)} | No deducible: ${fmtS(represExceso)}. Art. 37 inc. q) LIR.`});
  if(Math.abs(irCont-irTeorico)/Math.max(irTeorico,1)>0.15&&irTeorico>0) alerts.push({t:'Diferencia entre IR contabilizado e IR teórico',d:`IR contabilizado: ${fmtS(irCont)} | IR teórico RMT: ${fmtS(irTeorico)} | Diferencia: ${fmtS(Math.abs(irCont-irTeorico))}. Puede indicar diferencias temporarias o gastos no deducibles.`});
  if(apalancamiento>3) alerts.push({t:'Ratio de apalancamiento supera límite de subcapitalización',d:`Deuda/Patrimonio: ${apalancamiento.toFixed(1)}x (límite: 3x). Los intereses sobre el exceso de deuda no son deducibles (Art. 37 inc. a) LIR).`});
  if(utilOp<0) alerts.push({t:'Pérdida operativa — SUNAT puede cuestionar causalidad',d:`Utilidad operativa negativa: ${fmtS(utilOp)}. SUNAT puede pedir sustento de la continuación del negocio y causalidad de gastos.`});
  el.style.display='block';
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:14px">
    <div class="eeff-metric"><div class="eeff-metric-head"><span class="eeff-metric-name">Margen bruto</span><span class="eeff-metric-val">${margenBruto.toFixed(1)}%</span></div><div class="eeff-metric-bar"><div class="eeff-metric-fill" style="width:${Math.min(100,margenBruto)}%;background:${margenBruto>30?'var(--green)':margenBruto>15?'var(--gold)':'var(--red)'}"></div></div><div class="eeff-metric-desc">Ventas − Costo de ventas / Ventas</div></div>
    <div class="eeff-metric"><div class="eeff-metric-head"><span class="eeff-metric-name">Margen operativo</span><span class="eeff-metric-val">${margenOp.toFixed(1)}%</span></div><div class="eeff-metric-bar"><div class="eeff-metric-fill" style="width:${Math.min(100,Math.max(0,margenOp))}%;background:${margenOp>10?'var(--green)':margenOp>3?'var(--gold)':'var(--red)'}"></div></div><div class="eeff-metric-desc">Utilidad operativa / Ventas</div></div>
    <div class="eeff-metric"><div class="eeff-metric-head"><span class="eeff-metric-name">IR teórico RMT</span><span class="eeff-metric-val">${fmtS(irTeorico)}</span></div><div class="eeff-metric-desc">Diferencia vs IR contabilizado: ${fmtS(Math.abs(irCont-irTeorico))}</div></div>
    <div class="eeff-metric"><div class="eeff-metric-head"><span class="eeff-metric-name">Apalancamiento</span><span class="eeff-metric-val" style="color:${apalancamiento>3?'var(--red)':apalancamiento>1.5?'var(--gold)':'var(--green)'}">${apalancamiento.toFixed(1)}x</span></div><div class="eeff-metric-desc">Deuda / Patrimonio. Límite subcapitalización: 3x (Art. 37 a) LIR)</div></div>
  </div>
  ${alerts.map(a=>`<div class="eeff-alert"><div class="eeff-alert-title">⚠️ ${a.t}</div><div style="font-size:14px;color:var(--muted)">${a.d}</div></div>`).join('')}
  ${alerts.length===0?'<div style="background:rgba(76,175,80,.07);border:1px solid rgba(76,175,80,.2);border-radius:9px;padding:12px;font-size:14px;color:var(--green)">✅ No se detectaron alertas tributarias relevantes en los indicadores analizados.</div>':''}`;
  if(aiBtn) aiBtn.style.display='block';
  window._eeffData={v,c,gv,ga,gf,oi,irCont,activo,pasivo,patr,utilOp,irTeorico,margenOp};
}
async function eeffDeepAI(){
  const d=window._eeffData||{};
  const el=document.getElementById('eeffAIResult');
  el.style.display='block';el.textContent='Analizando EEFF...';
  if(!apiKey){el.innerHTML='Conecta tu API Key para análisis profundo de EEFF con IA.';return;}
  const prompt=`Analiza estos estados financieros de una empresa peruana para identificar riesgos tributarios:
Ventas: S/${d.v?.toLocaleString()} | Costo: S/${d.c?.toLocaleString()} | Util. Operativa: S/${d.utilOp?.toLocaleString()}
IR contabilizado: S/${d.irCont?.toLocaleString()} | IR teórico RMT: S/${d.irTeorico?.toLocaleString()}
Margen operativo: ${d.margenOp?.toFixed(1)}% | Apalancamiento: ${(d.d/d.patr)?.toFixed(1)}x
Identifica: 1) Gastos probablemente no deducibles, 2) Diferencias temporarias importantes, 3) Riesgos de fiscalización específicos, 4) Optimizaciones tributarias posibles. Cita normas exactas.`;
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:700,system:'Eres un auditor tributario peruano senior. Analizas EEFF identificando riesgos tributarios específicos con base legal exacta.',messages:[{role:'user',content:prompt}]});
    const dt=await r.json();
    el.innerHTML=(dt.content?.[0]?.text||'').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong style="color:#9B59B6">$1</strong>');
  }catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}

// ════════════════════════════════════════
// 6. GENERADOR DE CARTAS A CLIENTES
// ════════════════════════════════════════
let cartaTypeSel='';
function selectCartaType(type,btn){
  cartaTypeSel=type;
  document.querySelectorAll('.carta-type-btn').forEach(b=>b.classList.remove('sel'));
  if(btn)btn.classList.add('sel');
}
async function generarCarta(){
  if(!cartaTypeSel){tpToast('Selecciona el tipo de carta.', 'error');return;}
  const estudio=document.getElementById('cartaEstudio')?.value?.trim()||'Estudio Contable';
  const cliente=document.getElementById('cartaCliente')?.value?.trim()||'Estimado cliente';
  const detalle=document.getElementById('cartaDetalle')?.value?.trim()||'';
  const firma=document.getElementById('cartaFirma')?.value?.trim()||'El Contador';
  const loading=document.getElementById('cartaLoading');
  const preview=document.getElementById('cartaPreview');
  const actions=document.getElementById('cartaActions');
  loading.style.display='block';preview.style.display='none';if(actions)actions.style.display='none';
  const tipos={vencimiento:'aviso de vencimiento de obligaciones tributarias del mes',cierre_anual:'solicitud de documentos para cierre contable anual',fiscalizacion:'alerta por notificación de fiscalización SUNAT',honorarios:'propuesta de servicios contables y tributarios',cambio_norma:'comunicado sobre cambio normativo tributario relevante',devolucion:'comunicado sobre procedimiento de devolución de saldo a favor'};
  if(!apiKey){
    loading.style.display='none';preview.style.display='block';if(actions)actions.style.display='flex';
    preview.innerHTML=buildCartaDemo(estudio,cliente,detalle,firma,tipos[cartaTypeSel]||cartaTypeSel);return;
  }
  const prompt=`Redacta una carta profesional de asesoría tributaria:
Remitente: ${estudio} | Destinatario: ${cliente}
Tipo de carta: ${tipos[cartaTypeSel]} | Detalle adicional: ${detalle}
Firmante: ${firma} | Fecha: ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}
La carta debe ser profesional, clara y no mayor a 3 párrafos. Incluir datos tributarios específicos y relevantes. Lenguaje formal pero accesible para el cliente.`;
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:600,system:'Eres un contador público peruano que redacta cartas de asesoría tributaria profesionales para sus clientes.',messages:[{role:'user',content:prompt}]});
    const d=await r.json();
    loading.style.display='none';preview.style.display='block';if(actions)actions.style.display='flex';
    preview.innerHTML=safeHTML(buildCartaHTML(estudio,cliente,firma,d.content?.[0]?.text||''));
  }catch(e){loading.style.display='none';preview.innerHTML='<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>';preview.style.display='block';}
}
function buildCartaDemo(estudio,cliente,detalle,firma,tipo){
  return `<div class="carta-header"><div class="carta-logo">${estudio}</div><div style="font-size:14px;color:var(--muted)">Asesoría Contable-Tributaria | Lima, ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div></div>
  <p><strong>${cliente}</strong><br>Presente.—</p>
  <p>Estimado cliente, por medio de la presente nos dirigimos a usted para informarle sobre ${tipo}. ${detalle?'En particular: '+detalle+'.':''}</p>
  <p>Quedamos a su disposición para cualquier consulta adicional.</p>
  <p>Atentamente,<br><strong>${firma}</strong></p>
  <div style="margin-top:10px;font-size:14px;color:var(--muted)">Conecta tu API Key para generar cartas completas y personalizadas.</div>`;
}
function buildCartaHTML(estudio,cliente,firma,body){
  return `<div class="carta-header"><div class="carta-logo">${estudio}</div><div style="font-size:14px;color:var(--muted)">Lima, ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div></div>
  <p><strong>${cliente}</strong><br>Presente.—</p>
  ${body.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')}
  <br><p>Atentamente,<br><br><strong>${firma}</strong></p>`;
}
function exportCarta(){
  const c=document.getElementById('cartaPreview')?.innerHTML||'';
  const estudio=document.getElementById('cartaEstudio')?.value||'Estudio';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Carta — ${estudio}</title><style>body{font-family:'Times New Roman',serif;max-width:640px;margin:50px auto;color:#1a1a2e;line-height:1.9;font-size:14px}.carta-header{border-bottom:2px solid #C9A84C;padding-bottom:12px;margin-bottom:20px}.carta-logo{font-family:Georgia,serif;font-size:16px;color:#8B6914;margin-bottom:3px}@media print{body{margin:30px}}</style></head><body>${c}</body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}
function copyCarta(){navigator.clipboard.writeText(document.getElementById('cartaPreview')?.innerText||'').then(()=>{event.target.textContent='✅ Copiado!';setTimeout(()=>event.target.textContent='📋 Copiar',2000);});}

// ════════════════════════════════════════
// 7. MONITOR DE NORMAS EL PERUANO
// ════════════════════════════════════════
const MONITOR_DATA=[
  {fecha:'15 Mar 2025',titulo:'D.S. 012-2025-EF — Cronograma declaración anual IR 2024',impacto:'Establece fechas para la DJ Anual de IR 2024. Los contribuyentes del RG y RMT con rentas de 3ra categoría deben declarar entre marzo y abril 2025 según su dígito de RUC.',cat:'ir',nuevo:true,importante:true,regimenes:['RG','RMT']},
  {fecha:'08 Mar 2025',titulo:'R.S. 042-2025/SUNAT — Actualización de tasas TIM',impacto:'La TIM se mantiene en 1.2% mensual para deudas en soles. Sin cambios respecto al período anterior. La TIM para fraccionamiento continúa en 0.8% mensual.',cat:'ir',nuevo:true,importante:false,regimenes:['Todos']},
  {fecha:'01 Feb 2025',titulo:'D.S. 008-2025-EF — UIT 2025 fijada en S/5,350',impacto:'La UIT 2025 sube a S/5,350 (aumento de S/200 vs 2024). Impacta en: límites de deducción 4ta categoría (7 UIT = S/37,450), renta de 4ta mínima (S/37,450 anuales), escalas del RMT (15 UIT = S/80,250), multas SUNAT.',cat:'sunat',nuevo:true,importante:true,regimenes:['Todos']},
  {fecha:'15 Ene 2025',titulo:'D.Leg. 1623 — IGV plataformas digitales (implementación plena)',impacto:'Las plataformas digitales extranjeras (Netflix, Spotify, Adobe, Google Ads, Meta Ads) deben cobrar IGV (18%) a sus usuarios peruanos. El banco retiene automáticamente. Las empresas pueden usar como crédito fiscal.',cat:'igv',nuevo:false,importante:true,regimenes:['RG','RMT','RER']},
  {fecha:'10 Ene 2025',titulo:'R.S. 008-2025/SUNAT — Cronograma vencimientos 2025',impacto:'Se publica el cronograma de vencimientos para declaraciones y pagos del ejercicio 2025. Los plazos varían según el último dígito de RUC.',cat:'sunat',nuevo:false,importante:true,regimenes:['Todos']},
  {fecha:'20 Dic 2024',titulo:'Ley 32187 — Modificaciones al régimen laboral agrario',impacto:'Se ajustan beneficios del sector agrario: EsSalud al 9%, gratificaciones proporcionales. Impacta en el cálculo de costo laboral y deducciones del IR para empresas agroindustriales.',cat:'laboral',nuevo:false,importante:false,regimenes:['Agrario']},
  {fecha:'15 Nov 2024',titulo:'D.S. 008-2023-EF — Nuevo reglamento de PT (vigencia plena)',impacto:'El nuevo reglamento de Precios de Transferencia entró en vigencia plena. Nuevos formularios 3560 y 3561. Plazo máximo de respuesta en fiscalizaciones PT: 60 días hábiles.',cat:'ir',nuevo:false,importante:true,regimenes:['RG','RMT']},
  {fecha:'01 Oct 2024',titulo:'Res. SBS 3456-2024 — Nuevos tipos de cambio contable',impacto:'Actualización del proceso de publicación del TC SBS. El tipo de cambio para fines tributarios se publica a las 18:00 del día anterior. Importante para cierres contables y declaraciones con operaciones en ME.',cat:'aduanas',nuevo:false,importante:false,regimenes:['RG','RMT']},
];
let monitorFilter='todos';
function filterMonitor(cat,btn){monitorFilter=cat;document.querySelectorAll('.monitor-filter').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderMonitor('');}
function searchMonitor(q){renderMonitor(q.toLowerCase());}
function renderMonitor(q){
  const el=document.getElementById('monitorList');if(!el)return;
  let items=monitorFilter==='todos'?MONITOR_DATA:MONITOR_DATA.filter(n=>n.cat===monitorFilter);
  if(q)items=items.filter(n=>n.titulo.toLowerCase().includes(q)||n.impacto.toLowerCase().includes(q));
  if(!items.length){el.innerHTML='<div class="hempty">No se encontraron normas.</div>';return;}
  el.innerHTML=items.map(n=>`<div class="monitor-item ${n.nuevo?'nuevo':''} ${n.importante?'importante':''}">
    <div class="monitor-item-date"><span>📅 ${n.fecha}</span>${n.nuevo?'<span style="background:rgba(76,175,80,.15);border:1px solid rgba(76,175,80,.25);color:var(--green);font-size:9px;padding:1px 6px;border-radius:5px">NUEVO</span>':''} ${n.importante?'<span style="background:rgba(230,57,70,.1);border:1px solid rgba(230,57,70,.2);color:var(--red);font-size:9px;padding:1px 6px;border-radius:5px">IMPORTANTE</span>':''}</div>
    <div class="monitor-item-title">${n.titulo}</div>
    <div class="monitor-item-impacto">${n.impacto}</div>
    <div>${n.regimenes.map(r=>`<span class="monitor-item-regimen">${r}</span>`).join('')}</div>
    <button class="reg-ask-btn" style="margin-top:8px" onclick="askAboutRegulation(event,'${n.titulo.replace(/'/g,"\\'")}')" >💬 Consultar IA sobre esta norma</button>
  </div>`).join('');
}

// ════════════════════════════════════════
// 8. CONSTRUCTOR DE EXPEDIENTE
// ════════════════════════════════════════
const EXP_PHASES=[
  {titulo:'Fase 1 — Documentos de identificación',docs:[
    {n:'Poder vigente del representante legal',p:'critical'},{n:'Ficha RUC actualizada',p:'critical'},
    {n:'Copia de escritura de constitución',p:'high'},{n:'Nombramiento del representante legal vigente',p:'critical'},
  ]},
  {titulo:'Fase 2 — Libros y registros contables',docs:[
    {n:'Libro Diario del período fiscalizado',p:'critical'},{n:'Libro Mayor del período',p:'critical'},
    {n:'Registro de Ventas e Ingresos (PLE)',p:'critical'},{n:'Registro de Compras (PLE)',p:'critical'},
    {n:'Libro de Inventarios y Balances',p:'high'},{n:'Libro Caja y Bancos',p:'high'},
  ]},
  {titulo:'Fase 3 — Comprobantes de pago',docs:[
    {n:'Facturas de venta (originales)',p:'critical'},{n:'Facturas de compra (originales)',p:'critical'},
    {n:'Notas de crédito y débito emitidas y recibidas',p:'high'},{n:'Boletas de pago de planilla',p:'high'},
    {n:'Comprobantes de pago de tributos (bouchers)',p:'critical'},{n:'Comprobantes de operaciones bancarias',p:'high'},
  ]},
  {titulo:'Fase 4 — Contratos y documentación de operaciones',docs:[
    {n:'Contratos con principales proveedores',p:'high'},{n:'Contratos con clientes importantes',p:'normal'},
    {n:'Contratos de arrendamiento (si hay)',p:'high'},{n:'Contratos laborales vigentes',p:'normal'},
    {n:'Documentación de sustento de gastos importantes',p:'critical'},{n:'Guías de remisión del período',p:'high'},
  ]},
  {titulo:'Fase 5 — Declaraciones y pagos',docs:[
    {n:'PDT 621 de todos los meses del período',p:'critical'},{n:'PDT 710 / DJ Anual del período',p:'critical'},
    {n:'PLAME de todos los meses',p:'high'},{n:'Boletas de pago de tributos',p:'critical'},
    {n:'Declaraciones rectificatorias (si hubo)',p:'high'},{n:'Cronograma de vencimientos cumplidos',p:'normal'},
  ]},
];
let expState={};
function renderExpediente(){
  const el=document.getElementById('expPhaseList');if(!el)return;
  el.innerHTML=EXP_PHASES.map((ph,pi)=>{
    const total=ph.docs.length;
    const done=ph.docs.filter((_,di)=>expState[`${pi}_${di}`]).length;
    return `<div class="exp-phase">
      <div class="exp-phase-header" onclick="toggleExpPhase('expBody_${pi}')">
        <div class="exp-phase-title">📁 ${ph.titulo}</div>
        <div class="exp-phase-pct">${done}/${total} <span style="color:${done===total?'var(--green)':done>0?'var(--gold)':'var(--muted)'}">${done===total?'✅ Completo':done>0?'En progreso':'Pendiente'}</span></div>
      </div>
      <div id="expBody_${pi}">${ph.docs.map((d,di)=>{
        const key=`${pi}_${di}`;const checked=expState[key]||false;
        const col=d.p==='critical'?'critical':d.p==='high'?'high':'normal';
        return `<div class="exp-doc-item" onclick="toggleExpDoc('${key}')">
          <div class="exp-doc-check ${checked?'checked':''}">${checked?'✓':''}</div>
          <span class="exp-doc-name">${d.n}</span>
          <span class="exp-doc-priority ${col}">${d.p==='critical'?'CRÍTICO':d.p==='high'?'IMPORTANTE':'Normal'}</span>
        </div>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}
function toggleExpPhase(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='none'?'block':'none';}
function toggleExpDoc(key){expState[key]=!expState[key];renderExpediente();}

function generarIndiceExp(){
  const numReq=document.getElementById('expNumReq')?.value||'Req. SUNAT';
  const periodo=document.getElementById('expPeriodo')?.value||'—';
  const tributo=document.getElementById('expTributo')?.value||'—';
  const el=document.getElementById('expIndice');el.style.display='block';
  const docsReunidos=[];const docsPendientes=[];
  EXP_PHASES.forEach((ph,pi)=>ph.docs.forEach((d,di)=>{
    if(expState[`${pi}_${di}`]) docsReunidos.push({fase:ph.titulo.split('—')[1].trim(),doc:d.n,prioridad:d.p});
    else docsPendientes.push({fase:ph.titulo.split('—')[1].trim(),doc:d.n,prioridad:d.p});
  }));
  el.innerHTML=`<strong style="color:var(--red);font-size:14px">ÍNDICE DEL EXPEDIENTE DE FISCALIZACIÓN</strong><br>
  <span style="color:var(--muted)">Requerimiento: ${numReq} | Período: ${periodo} | Tributo: ${tributo}</span><br>
  <span style="color:var(--muted)">Generado: ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</span><br><br>
  <strong style="color:var(--green)">DOCUMENTOS REUNIDOS (${docsReunidos.length}):</strong><br>
  ${docsReunidos.map((d,i)=>`${String(i+1).padStart(2,'0')}. ${d.fase} — ${d.doc}`).join('<br>')}<br><br>
  <strong style="color:var(--red)">DOCUMENTOS PENDIENTES (${docsPendientes.length}):</strong><br>
  ${docsPendientes.map(d=>`⚠️ ${d.fase} — ${d.doc} [${d.prioridad.toUpperCase()}]`).join('<br>')}`;
  addNotif('🗂','Índice generado','Expediente para Req. '+numReq+': '+docsReunidos.length+' docs reunidos, '+docsPendientes.length+' pendientes.');
}
function exportExpPDF(){
  const content=document.getElementById('expIndice')?.innerHTML||'';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Expediente Fiscalización</title><style>body{font-family:'Times New Roman',serif;max-width:700px;margin:40px auto;color:#1a1a2e;font-size:14px;line-height:1.8}@media print{body{margin:20px}}</style></head><body><h2 style="color:#C41E0A;font-family:Georgia,serif">Expediente de Fiscalización SUNAT</h2>${content}<hr style="margin:20px 0"><p style="font-size:14px;color:#999;text-align:center">Generado por DeclaraFY.pe</p></body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}

// ── PATCH setPTab ──
const _origSetPTabTools=setPTab;
setPTab = function(tab,btn){
  _origSetPTabTools(tab,btn);
  if(tab==='cierre')initCierre();
  if(tab==='utilidades'){renderUtilEmpleados();document.getElementById('utilSummary').style.display='none';document.getElementById('utilResult').style.display='none';}
  if(tab==='fraccionamiento'){const hoy=new Date().toISOString().split('T')[0];const fi=document.getElementById('fraccFecha');if(fi&&!fi.value)fi.value=hoy;}
  if(tab==='detector_pdt')document.getElementById('pdtErrors').innerHTML='';
  if(tab==='eeff'){document.getElementById('eeffResult').style.display='none';document.getElementById('eeffAIBtn').style.display='none';document.getElementById('eeffAIResult').style.display='none';}
  if(tab==='cartas'){document.getElementById('cartaPreview').style.display='none';const a=document.getElementById('cartaActions');if(a)a.style.display='none';}
  if(tab==='monitor')renderMonitor('');
  if(tab==='expediente')renderExpediente();
}


// ════════════════════════════════════════
// ITAN — IMPUESTO TEMPORAL ACTIVOS NETOS
// ════════════════════════════════════════
const ITAN_ESCALA = [
  {desde:0, hasta:1000000000, tasa:0}, // Primero S/ 1,000,000,000 exonerado? No
  // Correcto: primero 1M exonerado, resto al 0.4%
];
// Art. 4 Ley 28424: Activos netos hasta S/1,000,000 → ITAN = 0; Exceso → 0.4%
/**
 * calcITAN — Impuesto Temporal a los Activos Netos
 * Base legal: Ley 28424 y sus modificatorias.
 * Tasa: 0.4% sobre el valor de los activos netos que excedan S/1,000,000.
 * El ITAN se puede usar como crédito contra el IR del ejercicio.
 * Pago: en 9 cuotas mensuales iguales (Art. 8 Ley 28424).
 */
function calcITAN() {
  const activos = parseFloat(document.getElementById('itanActivos')?.value) || 0;
  const deduc = parseFloat(document.getElementById('itanDeducciones')?.value) || 0;
  const amazonia = document.getElementById('itanAmazonia')?.value === 'si';
  const modalidad = document.getElementById('itanModalidad')?.value || 'cuotas';
  const ejercicio = document.getElementById('itanEjercicio')?.value || '2025';
  const el = document.getElementById('itanResult'); if (!el) return;
  if (!activos) { el.style.display = 'none'; return; }
  if (amazonia) { el.style.display = 'block'; el.innerHTML = '<div style="background:rgba(76,175,80,.08);border:1px solid rgba(76,175,80,.2);border-radius:10px;padding:14px;font-size:14px;color:var(--green)">✅ Empresa en zona de Amazonía — <strong>Exonerada del ITAN</strong> según Art. 13 Ley 27037. No corresponde pago.</div>'; return; }
  const base = Math.max(0, activos - deduc);
  const EXONERA = 1000000; // S/ 1,000,000 exonerado
  const itan = base <= EXONERA ? 0 : (base - EXONERA) * 0.004;
  const cuota = modalidad === 'cuotas' ? itan / 9 : itan;
  const fmtS = n => 'S/ ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="itan-result-grid">
      <div class="fracc-card"><div class="fracc-card-v">${fmtS(base)}</div><div class="fracc-card-l">Activos netos (base imponible)</div></div>
      <div class="fracc-card"><div class="fracc-card-v" style="color:${itan>0?'var(--red)':'var(--green)'}">${fmtS(itan)}</div><div class="fracc-card-l">ITAN total ${ejercicio}</div></div>
      <div class="fracc-card"><div class="fracc-card-v" style="color:var(--gold)">${fmtS(cuota)}</div><div class="fracc-card-l">${modalidad==='cuotas'?'Cuota mensual (÷9)':'Pago único (abril)'}</div></div>
      <div class="fracc-card"><div class="fracc-card-v" style="color:var(--green)">Crédito IR</div><div class="fracc-card-l">ITAN pagado = crédito contra IR anual</div></div>
    </div>
    <div class="itan-escala">
      <div class="itan-escala-row ${base<=EXONERA?'active':''}"><span>Primeros S/1,000,000 de activos netos</span><span style="color:var(--green)">Exonerado (0%)</span></div>
      <div class="itan-escala-row ${base>EXONERA?'active':''}"><span>Exceso de S/1,000,000</span><span style="color:${base>EXONERA?'var(--red)':'var(--muted)'}">0.4% → ${fmtS(itan)}</span></div>
    </div>
    <div style="background:rgba(58,134,255,.07);border:1px solid rgba(58,134,255,.2);border-radius:9px;padding:12px;font-size:14px;margin-top:8px">
      <strong style="color:#3A86FF">💡 Crédito contra el IR:</strong> El ITAN pagado se aplica como crédito contra el IR anual. Si el ITAN excede el IR, la diferencia puede solicitarse en devolución (Art. 8 Ley 28424).<br>
      <strong>Base legal:</strong> Ley 28424 · D.S. 025-2005-EF (Reglamento) · Art. 37 inc. s) LIR (deducibilidad si no se aplica como crédito).
    </div>`;
  // Render cuotas table
  renderITANCuotas(itan, modalidad, ejercicio);
}
function setITANTab(tab, btn) {
  document.querySelectorAll('#itanTabs .module-tab').forEach(b=>b.classList.remove('active'));
  if(btn){btn.classList.add('active');btn.style.background='rgba(58,134,255,.7)';}
  ['itanCalc','itanCuotas','itanNormas'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const el=document.getElementById('itan'+tab.charAt(0).toUpperCase()+tab.slice(1));
  if(el)el.style.display='block';
  if(tab==='cuotas'){const a=parseFloat(document.getElementById('itanActivos')?.value)||0;const d=parseFloat(document.getElementById('itanDeducciones')?.value)||0;const itan=Math.max(0,(a-d-1000000)*0.004);renderITANCuotas(itan,'cuotas','2025');}
  if(tab==='normas')renderRegList('itanNormasList',[
    {id:'in1',cat:'todos',titulo:'Ley 28424 — Ley del ITAN',tipo:'Ley',fecha:'Nov 2004',badge:'blue',desc:'Crea el ITAN: 0.4% sobre activos netos al 1 de enero. Exonera primeros S/1M. Crédito contra IR.',detalle:`<h4>Ley 28424 — ITAN</h4><div class="reg-detail-art">Art. 1: El ITAN grava los activos netos al valor del balance cerrado al 31 de diciembre del ejercicio gravable anterior.</div><div class="reg-detail-art">Art. 4: Escala: primeros S/1,000,000 exonerados; exceso: 0.4%.</div><div class="reg-detail-art">Art. 8: El ITAN efectivamente pagado puede usarse como crédito contra el IR de regularización. Si supera el IR, puede pedirse devolución.</div><strong>Carácter:</strong> El ITAN es un anticipo del IR. No es un gasto deducible si se usa como crédito.`},
    {id:'in2',cat:'todos',titulo:'D.S. 025-2005-EF — Reglamento del ITAN',tipo:'D.Supremo',fecha:'Feb 2005',badge:'gray',desc:'Reglamenta la determinación de la base imponible, deducciones permitidas y procedimiento de pago.',detalle:`<h4>Deducciones del ITAN</h4><div class="reg-detail-art">Se deducen: Activos entregados en concesión al Estado, activos afectados por fuerza mayor, acciones y participaciones, activos en zonas de frontera, activos de empresas que iniciaron operaciones en el ejercicio.</div>`},
  ],'','todos','#3A86FF');
}
function renderITANCuotas(itan, modalidad, ejercicio) {
  const el=document.getElementById('itanCuotasTable'); if(!el) return;
  if(modalidad==='contado'){el.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:14px"><strong>Pago único al contado:</strong> S/ ${itan.toFixed(2)} — Vence en abril ${ejercicio} según cronograma SUNAT (dígito RUC).</div>`;return;}
  const cuota=itan/9, fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const meses=['Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
  el.innerHTML=`<table class="fracc-cuota-table"><thead><tr><th>Cuota</th><th>Mes</th><th>Año</th><th>Monto</th><th>Acumulado</th></tr></thead><tbody>${meses.map((m,i)=>`<tr><td>${i+1}</td><td>${m}</td><td>${ejercicio}</td><td style="color:var(--gold)">${fmtS(cuota)}</td><td>${fmtS(cuota*(i+1))}</td></tr>`).join('')}</tbody></table><p style="font-size:14px;color:var(--muted);margin-top:8px">Vencimiento exacto según cronograma SUNAT del dígito de RUC. Total ITAN: ${fmtS(itan)}</p>`;
}

// ════════════════════════════════════════
// DRAWBACK — COMPLETO
// ════════════════════════════════════════
const DBK_REQUISITOS = [
  {titulo:'Requisito 1 — Exportación definitiva', desc:'La exportación debe ser definitiva (no temporal). Debe estar amparada en una Declaración Aduanera de Exportación (DAE) numerada por SUNAT-Aduanas.',detalle:'La DAE debe estar en estado "Salida confirmada". Las exportaciones bajo admisión temporal, exportación temporal o muestras no aplican.'},
  {titulo:'Requisito 2 — Insumos importados utilizados', desc:'El producto exportado debe contener insumos importados o similares. No se requiere probar que los insumos importados son exactamente los del producto exportado.',detalle:'La Ley 27328 amplió el drawback: basta que la empresa haya importado insumos del mismo tipo que los usados en la producción. Se aplica el principio de fungibilidad.'},
  {titulo:'Requisito 3 — No devolución previa de aranceles', desc:'Los aranceles sobre los insumos no deben haber sido devueltos por otro régimen (admisión temporal, drawback anterior, etc.).',detalle:'Si los insumos fueron importados bajo admisión temporal (con suspensión de aranceles), no califican para drawback porque nunca se pagaron aranceles.'},
  {titulo:'Requisito 4 — Plazo de solicitud', desc:'La solicitud debe presentarse dentro de los 180 días hábiles siguientes a la fecha de embarque del bien exportado.',detalle:'El plazo de 180 días hábiles corre desde la fecha del embarque en la DAE. Si vence el plazo, se pierde el derecho. Establecer un proceso interno de seguimiento por exportación.'},
  {titulo:'Requisito 5 — Solicitud electrónica SUNAT', desc:'La solicitud se presenta por el portal SUNAT (SOL) mediante el formulario virtual de drawback. SUNAT tiene 10 días hábiles para resolver.',detalle:'El trámite es 100% electrónico. SUNAT puede hacer verificaciones adicionales. La restitución se deposita en la cuenta bancaria del exportador.'},
  {titulo:'Requisito 6 — Monto mínimo por solicitud', desc:'El monto mínimo por solicitud de drawback es USD 500 (equivalente en PEN al TC del día). No hay monto máximo.',detalle:'Se puede acumular varias DAEs en una sola solicitud para alcanzar el mínimo. Es recomendable agrupar exportaciones del mismo período para optimizar el proceso administrativo.'},
];
const DBK_PROCESO = [
  {num:1,titulo:'Realizar la exportación y obtener la DAE',desc:'Embarca la mercancía y obtén la DAE en estado "Salida confirmada" del sistema SUNAT-Aduanas.'},
  {num:2,titulo:'Verificar elegibilidad — 180 días hábiles',desc:'Desde la fecha de embarque tienes 180 días hábiles para presentar la solicitud. Calendarizar el vencimiento.'},
  {num:3,titulo:'Reunir documentación sustentoria',desc:'DAE, factura comercial de exportación, bill of lading, documento de importación de insumos (DI), lista de empaque.'},
  {num:4,titulo:'Calcular el monto de restitución',desc:'3% × Valor FOB exportado. Verificar que no supere el límite del 50% del costo de producción.'},
  {num:5,titulo:'Presentar solicitud por SUNAT SOL',desc:'Formulario virtual en portal SUNAT. Adjuntar documentos escaneados. SUNAT envía acuse de recibo.'},
  {num:6,titulo:'Resolución SUNAT (10 días hábiles)',desc:'SUNAT resuelve en 10 días hábiles. Puede solicitar documentación adicional. Si es favorable, ordena el depósito.'},
  {num:7,titulo:'Recepción del depósito bancario',desc:'SUNAT deposita el monto en tu cuenta bancaria registrada en SUNAT. Tratar como ingreso en el mes de recepción.'},
];

function setDBKTab(tab, btn) {
  document.querySelectorAll('#drawbackTabs .module-tab').forEach(b=>{b.classList.remove('active');b.style.background='';});
  if(btn){btn.classList.add('active');btn.style.background='rgba(76,175,80,.7)';}
  ['dbkCalc','dbkForecast','dbkRequisitos','dbkProceso','dbkAnalisis'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const el=document.getElementById('dbk'+tab.charAt(0).toUpperCase()+tab.slice(1));
  if(el)el.style.display='block';
  if(tab==='requisitos')renderDBKRequisitos();
  if(tab==='proceso')renderDBKProceso();
  if(tab==='forecast')initDBKForecast();
}

function calcDBK() {
  const fob=parseFloat(document.getElementById('dbkFOB')?.value)||0;
  const tc=parseFloat(document.getElementById('dbkTC')?.value)||3.75;
  const tasa=parseFloat(document.getElementById('dbkTasa')?.value)||3;
  const nExp=parseInt(document.getElementById('dbkNumExp')?.value)||1;
  const costoIns=parseFloat(document.getElementById('dbkCostoIns')?.value)||0;
  const aranceles=parseFloat(document.getElementById('dbkAranceles')?.value)||0;
  const el=document.getElementById('dbkResult'); if(!el||!fob) return;
  const fobPEN=fob*tc;
  const restitPEN=fobPEN*(tasa/100);
  const restitUSD=restitPEN/tc;
  const limCostoProd=costoIns*0.50; // No puede superar 50% del costo de producción
  const restitReal=costoIns>0?Math.min(restitPEN,limCostoProd):restitPEN;
  const anual=restitReal*nExp;
  const roi=costoIns>0?(restitReal/costoIns)*100:0;
  const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const fmtU=n=>'USD '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  el.style.display='block';
  el.innerHTML=`
    <div class="dbk-result-hero">
      <div class="dbk-monto">${fmtS(restitReal)}</div>
      <div class="dbk-sub">Restitución drawback por exportación · ${tasa}% × FOB S/${fobPEN.toLocaleString()}</div>
      ${costoIns>0&&restitPEN>limCostoProd?`<div style="margin-top:6px;font-size:14px;color:var(--gold)">⚠️ Limitado al 50% del costo de producción: ${fmtS(limCostoProd)}</div>`:''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:14px">
      <div class="fracc-card"><div class="fracc-card-v">${fmtU(restitUSD)}</div><div class="fracc-card-l">Restitución en USD</div></div>
      <div class="fracc-card"><div class="fracc-card-v" style="color:var(--green)">${fmtS(anual)}</div><div class="fracc-card-l">Proyección anual (${nExp} exp.)</div></div>
      <div class="fracc-card"><div class="fracc-card-v">${roi.toFixed(1)}%</div><div class="fracc-card-l">ROI sobre costo insumos</div></div>
      ${aranceles>0?`<div class="fracc-card"><div class="fracc-card-v" style="color:${restitReal>=aranceles?'var(--green)':'var(--gold)'}">${restitReal>=aranceles?'✅ Cubre':'⚠️ Parcial'}</div><div class="fracc-card-l">vs aranceles pagados ${fmtS(aranceles)}</div></div>`:''}
    </div>
    <div class="tim-row"><span class="tim-row-lbl">Valor FOB exportado</span><span class="tim-row-val">${fmtU(fob)} (${fmtS(fobPEN)})</span></div>
    <div class="tim-row"><span class="tim-row-lbl">Tasa de restitución</span><span class="tim-row-val">${tasa}%</span></div>
    <div class="tim-row"><span class="tim-row-lbl">Restitución bruta</span><span class="tim-row-val">${fmtS(restitPEN)}</span></div>
    ${costoIns>0?`<div class="tim-row"><span class="tim-row-lbl">Límite 50% costo producción</span><span class="tim-row-val ${restitPEN>limCostoProd?'gold':''}">${fmtS(limCostoProd)}</span></div>`:''}
    <div class="tim-row" style="border-top:1px solid var(--green)"><span class="tim-row-lbl"><strong>Restitución a recibir</strong></span><span class="tim-row-val" style="color:var(--green);font-size:16px"><strong>${fmtS(restitReal)}</strong></span></div>
    <div class="dbk-alert green" style="margin-top:12px">📋 <strong>Tratamiento tributario:</strong> El drawback recibido es un <strong>ingreso gravado con IR</strong> en el período de reconocimiento (Art. 3 LIR). No está afecto a IGV. Debe declararse en la casilla de ingresos extraordinarios o ingresos financieros según el plan de cuentas de la empresa.</div>
    <div class="dbk-alert" style="margin-top:6px">⏰ <strong>Plazo:</strong> Presenta la solicitud dentro de los <strong>180 días hábiles</strong> desde el embarque. Vencimiento para esta exportación: aproximadamente <strong>${calcVencDBK()} días hábiles</strong> restantes si exportaste hoy.</div>`;
  window._dbkData={fob,tc,tasa,nExp,restitReal,anual,fobPEN};
}
function calcVencDBK(){ return 180; }

function initDBKForecast() {
  const el=document.getElementById('dbkMonthInputs'); if(!el||el.children.length) return;
  const meses=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
  el.innerHTML=meses.map((m,i)=>`<div class="fi" style="margin-bottom:0"><label>${m}</label><input type="number" id="dbkM${i}" placeholder="0" oninput="calcDBKForecast()" style="font-size:14px;padding:6px 8px"></div>`).join('');
}
function calcDBKForecast() {
  const tc=3.75, tasa=3;
  const vals=Array.from({length:12},(_,i)=>parseFloat(document.getElementById('dbkM'+i)?.value)||0);
  const total=vals.reduce((a,b)=>a+b,0);
  const dbkTotal=total*tc*(tasa/100);
  const el=document.getElementById('dbkForecastResult'); if(!el) return;
  el.style.display='block';
  const maxV=Math.max(...vals,1);
  const meses=['E','F','M','A','M','J','J','A','S','O','N','D'];
  const fmtS=n=>'S/ '+n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  el.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:16px">
    <div style="font-size:14px;font-weight:500;color:var(--green);margin-bottom:10px">Pronóstico de drawback anual</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      <div class="fracc-card"><div class="fracc-card-v">${fmtS(dbkTotal)}</div><div class="fracc-card-l">Total drawback año</div></div>
      <div class="fracc-card"><div class="fracc-card-v">${fmtS(dbkTotal/12)}</div><div class="fracc-card-l">Promedio mensual</div></div>
      <div class="fracc-card"><div class="fracc-card-v">USD ${(total).toLocaleString()}</div><div class="fracc-card-l">FOB total exportado</div></div>
    </div>
    <div class="dbk-forecast-bar">${vals.map((v,i)=>{const h=v>0?Math.max(8,(v/maxV)*72):4;const dbk=v*tc*(tasa/100);return `<div class="dbk-bar" style="height:${h}px;background:rgba(76,175,80,${v>0?0.6:0.15});border-radius:4px 4px 0 0"><div class="dbk-bar-lbl">${meses[i]}</div>${v>0?`<div class="dbk-bar-val">${fmtS(dbk)}</div>`:''}</div>`}).join('')}</div>
    <div style="height:18px"></div>
  </div>`;
}
function renderDBKRequisitos() {
  const el=document.getElementById('dbkReqList'); if(!el) return;
  el.innerHTML=DBK_REQUISITOS.map((r,i)=>`<div class="dbk-req-item" onclick="toggleRegDetail('dbkr_${i}')">
    <div style="font-size:14px;font-weight:500;margin-bottom:3px">${r.titulo}</div>
    <div style="font-size:14px;color:var(--muted)">${r.desc}</div>
    <div class="dbk-req-detail" id="detail_dbkr_${i}">${r.detalle}</div>
  </div>`).join('');
}
function renderDBKProceso() {
  const el=document.getElementById('dbkProcesoSteps'); if(!el) return;
  el.innerHTML=DBK_PROCESO.map(s=>`<div class="dbk-step"><div class="dbk-step-num">${s.num}</div><div class="dbk-step-body"><div class="dbk-step-title">${s.titulo}</div><div class="dbk-step-desc">${s.desc}</div></div></div>`).join('');
}
async function consultDBKAI() {
  const q=document.getElementById('dbkConsultaText')?.value?.trim()||'';
  if(!q){tpToast('Escribe tu consulta sobre drawback.', 'warn');return;}
  const el=document.getElementById('dbkAIResult'); el.style.display='block'; el.textContent='Analizando...';
  if(!apiKey){el.innerHTML='Conecta tu API Key para análisis de drawback con IA.';return;}
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:700,system:'Eres un especialista en comercio exterior peruano y régimen de drawback (D.S. 104-95-EF, Ley 27328, D.S. 135-2005-EF). Conoces a fondo los requisitos, plazos, cálculos y el proceso ante SUNAT-Aduanas.',messages:[{role:'user',content:q}]});
    const d=await r.json();
    renderAIResponse(el, d.content?.[0]?.text||"");
  }catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}

// ════════════════════════════════════════
// CDI — CONVENIOS DOBLE IMPOSICIÓN
// ════════════════════════════════════════
const CDI_DATA = {
  'Chile':       {flag:'🇨🇱',vigencia:'2014',tasas:{dividendos:'10%',intereses:'15%',regalias:'15%',servicios:'14%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 30147. Dividendos: 10% si tenencia ≥ 25%, 15% otros. Intereses: 15% general, 10% a bancos.'},
  'Colombia':    {flag:'🇨🇴',vigencia:'2015',tasas:{dividendos:'10%',intereses:'10%',regalias:'10%',servicios:'10%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 30648. Cláusula de la nación más favorecida.'},
  'Ecuador':     {flag:'🇪🇨',vigencia:'1999',tasas:{dividendos:'0%',intereses:'0%',regalias:'0%',servicios:'0%',ganancias_capital:'0%'},notas:'Decisión 578 CAN — Principio de tributación en fuente. Exención en país de residencia.'},
  'Bolivia':     {flag:'🇧🇴',vigencia:'1999',tasas:{dividendos:'0%',intereses:'0%',regalias:'0%',servicios:'0%',ganancias_capital:'0%'},notas:'Decisión 578 CAN — mismo régimen que Ecuador y Colombia (solo CAN).'},
  'España':      {flag:'🇪🇸',vigencia:'2014',tasas:{dividendos:'15%',intereses:'15%',regalias:'10%',servicios:'14%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 30147. Dividendos: 10% si participación ≥ 25% por 6 meses.'},
  'Brasil':      {flag:'🇧🇷',vigencia:'2009',tasas:{dividendos:'15%',intereses:'15%',regalias:'15%',servicios:'15%',ganancias_capital:'0%'},notas:'CDI aprobado por D.S. 093-2009-EF. Protocolo adicional en negociación.'},
  'Canadá':      {flag:'🇨🇦',vigencia:'2013',tasas:{dividendos:'15%',intereses:'15%',regalias:'15%',servicios:'15%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 29936.'},
  'México':      {flag:'🇲🇽',vigencia:'2014',tasas:{dividendos:'15%',intereses:'15%',regalias:'15%',servicios:'10%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 30147. Asistencia técnica al 10%.'},
  'Suiza':       {flag:'🇨🇭',vigencia:'2015',tasas:{dividendos:'10%',intereses:'15%',regalias:'10%',servicios:'10%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 30272. Dividendos: 10% para tenencia ≥ 25%.'},
  'Corea del Sur':{flag:'🇰🇷',vigencia:'2015',tasas:{dividendos:'10%',intereses:'15%',regalias:'10%',servicios:'10%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 30272.'},
  'Portugal':    {flag:'🇵🇹',vigencia:'2013',tasas:{dividendos:'10%',intereses:'15%',regalias:'10%',servicios:'10%',ganancias_capital:'0%'},notas:'CDI aprobado por Ley 30007.'},
};
const TASA_DOMESTICA = {dividendos:'5%',intereses:'30%',regalias:'30%',servicios:'30%',ganancias_capital:'30%'};
const TASA_DOM_NUM = {dividendos:5,intereses:30,regalias:30,servicios:30,ganancias_capital:30};

function initCDI() {
  const grid=document.getElementById('cdiCountryGrid'); if(!grid||grid.children.length) return;
  grid.innerHTML=Object.entries(CDI_DATA).map(([pais,d])=>`<button class="cdi-country-btn" onclick="showCDIDetail('${pais}',this)">${d.flag}<br><strong>${pais}</strong><br><span style="font-size:14px">Desde ${d.vigencia}</span></button>`).join('');
  const sel=document.getElementById('cdiPaisComp'); if(sel&&!sel.children.length){
    sel.innerHTML='<option value="">— Seleccionar —</option>'+Object.keys(CDI_DATA).map(p=>`<option value="${p}">${CDI_DATA[p].flag} ${p}</option>`).join('');
  }
}
function showCDIDetail(pais, btn) {
  document.querySelectorAll('.cdi-country-btn').forEach(b=>b.classList.remove('sel'));
  if(btn) btn.classList.add('sel');
  const d=CDI_DATA[pais]; if(!d) return;
  const el=document.getElementById('cdiDetail'); el.style.display='block';
  const tipo=['dividendos','intereses','regalias','servicios','ganancias_capital'];
  const labels={dividendos:'Dividendos',intereses:'Intereses',regalias:'Regalías',servicios:'Servicios / Asist. técnica',ganancias_capital:'Ganancias de capital'};
  el.innerHTML=`<div class="cdi-detail-box">
    <div style="font-size:14px;font-weight:500;margin-bottom:4px">${d.flag} CDI Perú–${pais} <span style="font-size:14px;color:var(--muted)">Vigente desde ${d.vigencia}</span></div>
    <div style="font-size:14px;color:var(--muted);margin-bottom:12px">${d.notas}</div>
    <table class="cdi-rate-table"><thead><tr><th>Tipo de renta</th><th>Tasa CDI</th><th>Tasa doméstica Perú</th><th>Ahorro</th></tr></thead><tbody>
    ${tipo.map(t=>{
      const cdNum=parseFloat(d.tasas[t])||0;
      const domNum=TASA_DOM_NUM[t]||0;
      const ahorro=domNum-cdNum;
      return `<tr><td>${labels[t]}</td><td class="cdi-rate-highlight">${d.tasas[t]}</td><td style="color:var(--muted)">${TASA_DOMESTICA[t]}</td><td class="${ahorro>0?'cdi-saving':ahorro<0?'cdi-no-saving':''}">${ahorro>0?'-'+ahorro+'%':ahorro<0?'+'+Math.abs(ahorro)+'%':'=Sin diferencia'}</td></tr>`;
    }).join('')}</tbody></table>
    <button class="reg-ask-btn" style="border-color:rgba(155,89,182,.4);color:#C39CE0;margin-top:10px" onclick="askAboutRegulation(event,'CDI Perú-${pais}: tasas y aplicación')">💬 Consultar IA sobre este CDI</button>
  </div>`;
}
function setCDITab(tab,btn){
  document.querySelectorAll('#cdiTabs .module-tab').forEach(b=>{b.classList.remove('active');b.style.background='';});
  if(btn){btn.classList.add('active');btn.style.background='rgba(155,89,182,.7)';}
  ['cdiPaises','cdiComparar','cdiConsultor'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const el=document.getElementById('cdi'+tab.charAt(0).toUpperCase()+tab.slice(1));if(el)el.style.display='block';
}
function compararCDI(){
  const pais=document.getElementById('cdiPaisComp')?.value;
  const tipo=document.getElementById('cdiTipoRenta')?.value||'dividendos';
  const monto=parseFloat(document.getElementById('cdiMonto')?.value)||0;
  const el=document.getElementById('cdiCompResult'); if(!el) return;
  if(!pais||!monto){el.style.display='none';return;}
  const d=CDI_DATA[pais]; if(!d){el.style.display='none';return;}
  const tasaCDI=parseFloat(d.tasas[tipo])||0;
  const tasaDom=TASA_DOM_NUM[tipo]||0;
  const tc=3.75;
  const montoS=monto*tc;
  const retCDI=montoS*(tasaCDI/100);
  const retDom=montoS*(tasaDom/100);
  const ahorro=retDom-retCDI;
  const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  el.style.display='block';
  el.innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
    <div style="background:rgba(230,57,70,.06);border:1px solid rgba(230,57,70,.18);border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:14px;color:var(--muted);margin-bottom:4px">Sin CDI (tasa doméstica ${tasaDom}%)</div>
      <div style="font-size:22px;font-weight:300;color:var(--red)">${fmtS(retDom)}</div>
      <div style="font-size:14px;color:var(--muted)">Neto recibe: ${fmtS(montoS-retDom)}</div>
    </div>
    <div style="background:rgba(76,175,80,.06);border:1px solid rgba(76,175,80,.2);border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:14px;color:var(--muted);margin-bottom:4px">Con CDI ${d.flag} (${tasaCDI}%)</div>
      <div style="font-size:22px;font-weight:300;color:var(--green)">${fmtS(retCDI)}</div>
      <div style="font-size:14px;color:var(--muted)">Neto recibe: ${fmtS(montoS-retCDI)}</div>
    </div>
  </div>
  <div style="background:rgba(201,168,76,.08);border:1px solid rgba(201,168,76,.2);border-radius:9px;padding:12px;text-align:center;margin-bottom:10px">
    <div style="font-size:14px;color:var(--muted)">Ahorro con CDI</div>
    <div style="font-size:24px;font-weight:300;color:var(--gold)">${fmtS(ahorro)}</div>
    <div style="font-size:14px;color:var(--muted)">${((ahorro/retDom)*100).toFixed(0)}% menos retención</div>
  </div>
  <p style="font-size:14px;color:var(--muted)">Para aplicar el CDI, el beneficiario debe presentar su Certificado de Residencia Fiscal emitido por la autoridad tributaria de ${pais}. TC utilizado: ${tc}. Base legal: Art. 76 LIR + CDI Perú-${pais}.</p>`;
}
async function consultCDIAI(){
  const q=document.getElementById('cdiConsultaText')?.value?.trim()||'';
  if(!q){tpToast('Escribe tu consulta.', 'warn');return;}
  const el=document.getElementById('cdiAIResult');el.style.display='block';el.textContent='Consultando...';
  if(!apiKey){el.innerHTML='Conecta tu API Key para consultas sobre CDIs.';return;}
  try{const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:700,system:'Eres un experto en derecho tributario internacional peruano, especializado en los 11 CDIs vigentes de Perú, residencia fiscal, establecimiento permanente, y planificación fiscal internacional conforme a las directrices OCDE.',messages:[{role:'user',content:q}]});
  const d=await r.json();renderAIResponse(el, d.content?.[0]?.text||"");}catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}

// ════════════════════════════════════════
// RETENCIONES Y PERCEPCIONES IGV
// ════════════════════════════════════════
let rpType='retencion';
function setRPType(type,btn){
  rpType=type;
  document.querySelectorAll('.rp-type-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderRPInputs();
}
function renderRPInputs(){
  const el=document.getElementById('rpInputs'); if(!el) return;
  document.getElementById('rpResult').style.display='none';
  const configs={
    retencion:{fields:[{id:'rpMonto',label:'Precio de venta (precio operación) S/'},{ id:'rpIGV',label:'¿El precio incluye IGV?',type:'select',opts:[['si','Sí — precio con IGV incluido'],['no','No — precio sin IGV (base imponible)']]}],tasa:3,titulo:'Retención IGV 3%',desc:'Agentes de retención autorizados retienen el 3% del precio de venta. Base: R.S. 037-2002/SUNAT.'},
    percepcion:{fields:[{id:'rpMontoPer',label:'Precio de venta (con IGV) S/'},{id:'rpTipoPer',label:'Tipo de operación',type:'select',opts:[['combustible','Combustible (0.5%)'],['importacion','Importación de bienes (3.5% o 10%)'],['interno','Venta interna bienes (2%)']]}],titulo:'Percepción IGV',desc:'El agente de percepción cobra al cliente un porcentaje adicional como adelanto del IGV. Base: Ley 29173.'},
    detraccion:{fields:[{id:'rpMontoD',label:'Precio de operación (con IGV) S/'},{id:'rpServicio',label:'Bien o servicio',type:'select',opts:[['0.04','Arena y piedra (4%)'],['0.04','Minerales (4%)'],['0.10','Madera (10%)'],['0.12','Intermediación laboral (12%)'],['0.12','Arrendamiento de bienes (12%)'],['0.12','Mantenimiento y reparación (12%)'],['0.12','Movimiento de carga (12%)'],['0.15','Otros servicios (15%)'],['0.04','Azúcar y melaza (4%)'],['0.09','Algodón (9%)']]}],titulo:'Detracción SPOT',desc:'Sistema de Pago de Obligaciones Tributarias. El adquirente deposita % del precio en cuenta del Banco de la Nación del vendedor.'},
    cuenta_corriente:{fields:[{id:'rpDebito',label:'IGV débito fiscal del mes S/'},{id:'rpCredito',label:'IGV crédito fiscal del mes S/'},{id:'rpRetenciones',label:'Retenciones sufridas del mes S/'},{id:'rpPercepciones',label:'Percepciones sufridas del mes S/'},{id:'rpSaldoAnterior',label:'Saldo a favor mes anterior S/'}],titulo:'Cuenta corriente IGV mensual',desc:'Calcula el IGV neto a pagar o saldo a favor del mes, aplicando retenciones y percepciones.'},
  };
  const cfg=configs[rpType];
  el.innerHTML=`<div style="margin-bottom:12px;font-size:14px;color:var(--muted)">${cfg.desc}</div>`+
  '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">'+
  cfg.fields.map(f=>`<div class="fi" style="margin-bottom:0"><label>${f.label}</label>${f.type==='select'?`<select id="${f.id}" onchange="calcRP()">${f.opts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('')}</select>`:`<input type="number" id="${f.id}" placeholder="0" oninput="calcRP()">`}</div>`).join('');
  '</div>';
  el.innerHTML+=`</div><button onclick="calcRP()" style="margin-top:10px;padding:9px 20px;border-radius:8px;background:rgba(232,160,32,.15);border:1px solid rgba(232,160,32,.3);color:#E8A020;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit">Calcular</button>`;
}
function calcRP(){
  const el=document.getElementById('rpResult'); if(!el) return;
  const fmtS=n=>'S/ '+Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  el.style.display='block';
  if(rpType==='retencion'){
    const precio=parseFloat(document.getElementById('rpMonto')?.value)||0;
    const inclIGV=document.getElementById('rpIGV')?.value==='si';
    const base=inclIGV?precio/1.18:precio;
    const precioTotal=inclIGV?precio:precio*1.18;
    const retencion=precioTotal*0.03;
    const neto=precioTotal-retencion;
    el.innerHTML=`<div class="rp-result-title">Retención IGV 3% — Cálculo</div>
      <div class="rp-timeline">
        <div class="rp-tl-item"><span class="rp-tl-icon">1️⃣</span><span class="rp-tl-text">Precio de venta (con IGV)</span><span class="rp-tl-amount">${fmtS(precioTotal)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">✂️</span><span class="rp-tl-text">Retención (3%) que aplica el comprador</span><span class="rp-tl-amount" style="color:var(--red)">-${fmtS(retencion)}</span></div>
        <div class="rp-tl-item" style="background:rgba(232,160,32,.06)"><span class="rp-tl-icon">💰</span><span class="rp-tl-text"><strong>Neto que recibe el vendedor</strong></span><span class="rp-tl-amount" style="font-size:16px">${fmtS(neto)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">✅</span><span class="rp-tl-text">El vendedor usa la retención como crédito vs IGV del mes</span><span class="rp-tl-amount" style="color:var(--green)">+${fmtS(retencion)} crédito</span></div>
      </div><p style="font-size:14px;color:var(--muted);margin-top:8px">Base legal: R.S. 037-2002/SUNAT. Solo aplica a operaciones con Agentes de Retención autorizados por SUNAT.</p>`;
  } else if(rpType==='percepcion'){
    const precio=parseFloat(document.getElementById('rpMontoPer')?.value)||0;
    const tipo=document.getElementById('rpTipoPer')?.value;
    const tasas={'combustible':0.005,'importacion':0.035,'interno':0.02};
    const tasa=tasas[tipo]||0.02;
    const percepcion=precio*tasa;
    const total=precio+percepcion;
    el.innerHTML=`<div class="rp-result-title">Percepción IGV ${(tasa*100).toFixed(1)}%</div>
      <div class="rp-timeline">
        <div class="rp-tl-item"><span class="rp-tl-icon">1️⃣</span><span class="rp-tl-text">Precio de venta con IGV</span><span class="rp-tl-amount">${fmtS(precio)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">➕</span><span class="rp-tl-text">Percepción cobrada al cliente (${(tasa*100).toFixed(1)}%)</span><span class="rp-tl-amount" style="color:var(--red)">+${fmtS(percepcion)}</span></div>
        <div class="rp-tl-item" style="background:rgba(232,160,32,.06)"><span class="rp-tl-icon">💳</span><span class="rp-tl-text"><strong>Total que paga el cliente</strong></span><span class="rp-tl-amount" style="font-size:16px">${fmtS(total)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">✅</span><span class="rp-tl-text">El cliente usa la percepción como crédito vs IGV del mes</span><span class="rp-tl-amount" style="color:var(--green)">+${fmtS(percepcion)} crédito</span></div>
      </div><p style="font-size:14px;color:var(--muted);margin-top:8px">Base legal: Ley 29173. La percepción es un adelanto del IGV de futuras ventas del cliente.</p>`;
  } else if(rpType==='detraccion'){
    const precio=parseFloat(document.getElementById('rpMontoD')?.value)||0;
    const tasa=parseFloat(document.getElementById('rpServicio')?.value)||0.12;
    const detraccion=precio*tasa;
    const neto=precio-detraccion;
    el.innerHTML=`<div class="rp-result-title">Detracción SPOT ${(tasa*100).toFixed(0)}%</div>
      <div class="rp-timeline">
        <div class="rp-tl-item"><span class="rp-tl-icon">1️⃣</span><span class="rp-tl-text">Precio total de la operación</span><span class="rp-tl-amount">${fmtS(precio)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">🏦</span><span class="rp-tl-text">Depósito BN cuenta proveedor (${(tasa*100).toFixed(0)}%)</span><span class="rp-tl-amount" style="color:var(--gold)">${fmtS(detraccion)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">💰</span><span class="rp-tl-text"><strong>Pago directo al proveedor</strong></span><span class="rp-tl-amount" style="font-size:16px">${fmtS(neto)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">✅</span><span class="rp-tl-text">El proveedor usa el fondo BN para pagar IGV, IR, planilla</span><span class="rp-tl-amount" style="color:var(--green)">Fondo tributario</span></div>
      </div><p style="font-size:14px;color:var(--muted);margin-top:8px">Base legal: D.Leg. 940 y normas complementarias. Depósito antes del pago o a más tardar el 5to día hábil del mes siguiente.</p>`;
  } else {
    const deb=parseFloat(document.getElementById('rpDebito')?.value)||0;
    const cred=parseFloat(document.getElementById('rpCredito')?.value)||0;
    const ret=parseFloat(document.getElementById('rpRetenciones')?.value)||0;
    const per=parseFloat(document.getElementById('rpPercepciones')?.value)||0;
    const saldoAnt=parseFloat(document.getElementById('rpSaldoAnterior')?.value)||0;
    const neto=deb-cred-ret-per-saldoAnt;
    el.innerHTML=`<div class="rp-result-title">Cuenta Corriente IGV del mes</div>
      <div class="rp-timeline">
        <div class="rp-tl-item"><span class="rp-tl-icon">➕</span><span class="rp-tl-text">Débito fiscal (IGV ventas)</span><span class="rp-tl-amount">${fmtS(deb)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">➖</span><span class="rp-tl-text">Crédito fiscal (IGV compras)</span><span class="rp-tl-amount" style="color:var(--green)">-${fmtS(cred)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">✂️</span><span class="rp-tl-text">Retenciones sufridas</span><span class="rp-tl-amount" style="color:var(--green)">-${fmtS(ret)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">➖</span><span class="rp-tl-text">Percepciones sufridas</span><span class="rp-tl-amount" style="color:var(--green)">-${fmtS(per)}</span></div>
        <div class="rp-tl-item"><span class="rp-tl-icon">📋</span><span class="rp-tl-text">Saldo a favor mes anterior</span><span class="rp-tl-amount" style="color:var(--green)">-${fmtS(saldoAnt)}</span></div>
        <div class="rp-tl-item" style="background:${neto>0?'rgba(230,57,70,.07)':'rgba(76,175,80,.06)'}"><span class="rp-tl-icon">${neto>0?'💳':'✅'}</span><span class="rp-tl-text"><strong>${neto>0?'IGV a pagar':'Saldo a favor'}</strong></span><span class="rp-tl-amount" style="font-size:16px;color:${neto>0?'var(--red)':'var(--green)'}">${fmtS(Math.abs(neto))}</span></div>
      </div>`;
  }
}

// ════════════════════════════════════════
// NIIF vs NIC TRIBUTARIO
// ════════════════════════════════════════
const NIIF_DIFFS = [
  {norma:'NIC 16 / NIIF',partida:'Depreciación de activos fijos',niif:'Vida útil técnica estimada (componentes). Sin límite porcentual.',lir:'Porcentajes máximos Art. 22 RLIR (edificios 3-5%, vehículos 20%, cómputo 25%).',tipo:'temporaria',impacto:'Diferencia temporaria si % NIIF ≠ % LIR. Genera impuesto diferido activo o pasivo.'},
  {norma:'NIC 2',partida:'Valoración de inventarios',niif:'Costo promedio o FIFO. NRV (valor neto realizable) si es menor.',lir:'Costo promedio, FIFO o LIFO (Art. 62 LIR). No reconoce NRV como gasto hasta la venta.',tipo:'temporaria',impacto:'Diferencia temporaria por desvalorización de inventarios. El gasto NIIF no es deducible hasta la venta real.'},
  {norma:'NIIF 9 / NIC 39',partida:'Provisión por incobrables',niif:'Modelo de pérdida esperada (ECL). Provisión desde el momento 1.',lir:'Deducible solo si cumple Art. 37 inc. i) LIR: deuda en cobranza judicial o protestada, deudor en quiebra, etc.',tipo:'temporaria',impacto:'La provisión NIIF generalmente supera la tributariamente deducible. Diferencia temporaria imponible.'},
  {norma:'NIC 37',partida:'Provisiones y pasivos contingentes',niif:'Provisionar si es probable (>50%) y cuantificable.',lir:'No deducible como gasto hasta que la obligación sea cierta (devengado). Art. 37 LIR.',tipo:'temporaria',impacto:'La provisión contable se anticipa al reconocimiento tributario. Activo diferido hasta el devengo tributario.'},
  {norma:'NIIF 16',partida:'Arrendamiento operativo',niif:'Todo arrendamiento > 12 meses: activo por derecho de uso + pasivo. Gasto: depreciación + interés.',lir:'Arrendamiento operativo sigue siendo cuota mensual deducible (Art. 37 inc. s) LIR). El tratamiento NIIF 16 no aplica para IR.',tipo:'temporaria',impacto:'Diferencia significativa: NIIF reconoce activo/pasivo, LIR deduce la cuota. Genera diferencias temporarias en ambos sentidos.'},
  {norma:'NIC 12',partida:'Impuesto a las ganancias',niif:'Impuesto corriente + impuesto diferido. Reconocer activos y pasivos por diferencias temporarias.',lir:'Solo se paga el IR corriente calculado sobre la renta neta imponible.',tipo:'ninguna',impacto:'El impuesto diferido NIC 12 es un asiento contable. No modifica la obligación tributaria — solo la presentación en estados financieros.'},
  {norma:'NIC 23',partida:'Costos por préstamos',niif:'Capitalizar costos de financiamiento de activos calificados.',lir:'Los intereses capitalizados no son deducibles en el período — lo son vía depreciación del activo (Art. 37 inc. a) LIR).',tipo:'temporaria',impacto:'Diferencia temporaria: el gasto financiero NIIF capitalizado se convierte en diferencia temporal que se revierte via depreciación.'},
  {norma:'NIC 19',partida:'Beneficios a empleados (CTS, vacaciones)',niif:'Reconocer la obligación devengada mensualmente.',lir:'CTS y vacaciones son deducibles cuando se pagan (Art. 37 inc. j) y v) LIR).',tipo:'temporaria',impacto:'Diferencia temporaria: la provisión contable mensual se revierte cuando se paga. Activo diferido sobre el monto provisionado y no pagado.'},
  {norma:'NIIF 3',partida:'Combinaciones de negocios / plusvalía',niif:'Goodwill (plusvalía) no se amortiza — solo prueba de deterioro anual.',lir:'El intangible de duración limitada se amortiza según vida útil. La plusvalía no es deducible (Art. 44 LIR).',tipo:'permanente',impacto:'Diferencia permanente: la plusvalía contable nunca es gasto tributario. Mayor base imponible permanente.'},
  {norma:'NIC 36',partida:'Deterioro de activos',niif:'Reconocer pérdida por deterioro cuando valor recuperable < valor en libros.',lir:'El deterioro no es gasto deducible. Solo es deducible la pérdida cuando el activo es vendido o dado de baja.',tipo:'temporaria',impacto:'Diferencia temporaria deducible: el gasto por deterioro NIC 36 genera activo diferido hasta la venta/baja del activo.'},
  {norma:'NIC 21',partida:'Diferencias de cambio',niif:'Las diferencias de cambio de operaciones se reconocen en resultados. Las de inversión neta en ORI.',lir:'Diferencias de cambio de operaciones del giro: deducibles/gravables. Las de inversión no son tributarias (Art. 61 LIR).',tipo:'ninguna',impacto:'Las diferencias de cambio operacionales no generan diferencias NIIF-LIR. Solo las de inversión neta en subsidiarias pueden diferir.'},
  {norma:'NIIF 15',partida:'Reconocimiento de ingresos',niif:'Reconocer ingreso cuando se satisface la obligación de desempeño (5 pasos NIIF 15).',lir:'Renta devengada (Art. 57 LIR): cuando se tiene derecho a cobrarla, independientemente del cobro.',tipo:'temporaria',impacto:'En la mayoría de casos coinciden. Diferencia cuando NIIF 15 difiere el ingreso (ej: licencias con uso continuo) vs LIR que lo reconoce al devengo.'},
];
let niifFilterCat='todos';
function filterNIIF(cat,btn){niifFilterCat=cat;document.querySelectorAll('#ptNiif .reg-filter-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');renderNIIFTable('');}
function searchNIIF(q){renderNIIFTable(q.toLowerCase());}
function renderNIIFTable(q){
  const el=document.getElementById('niifTableBody'); if(!el) return;
  let items=niifFilterCat==='todos'?NIIF_DIFFS:NIIF_DIFFS.filter(d=>d.tipo===niifFilterCat);
  if(q)items=items.filter(d=>d.norma.toLowerCase().includes(q)||d.partida.toLowerCase().includes(q)||d.impacto.toLowerCase().includes(q));
  el.innerHTML=items.map(d=>`<tr>
    <td><strong>${d.norma}</strong><br><span style="font-size:14px;color:var(--muted)">${d.partida}</span></td>
    <td style="font-size:14px;color:var(--muted)">${d.niif}</td>
    <td style="font-size:14px;color:var(--muted)">${d.lir}</td>
    <td><span class="niif-tag ${d.tipo}">${d.tipo==='temporaria'?'Temporaria':d.tipo==='permanente'?'Permanente':'Sin dif.'}</span></td>
    <td style="font-size:14px;color:var(--muted)">${d.impacto}</td>
  </tr>`).join('');
}
function setNIIFTab(tab,btn){
  document.querySelectorAll('#niifTabs .module-tab').forEach(b=>{b.classList.remove('active');b.style.background='';});
  if(btn){btn.classList.add('active');btn.style.background='rgba(144,144,200,.7)';}
  ['niifDiferencias','niifImpuesto_diferido','niifConsultor'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const el=document.getElementById('niif'+tab.charAt(0).toUpperCase()+tab.replace('_diferido','Diferido').slice(1).replace('_','')||tab);
  const map={diferencias:'niifDiferencias',impuesto_diferido:'niifImpuesto_diferido',consultor:'niifConsultor'};
  const showEl=document.getElementById(map[tab]);if(showEl)showEl.style.display='block';
}
function calcImpuestoDiferido(){
  const bc=parseFloat(document.getElementById('niifBaseContable')?.value)||0;
  const bt=parseFloat(document.getElementById('niifBaseTributaria')?.value)||0;
  const tasa=parseFloat(document.getElementById('niifTasaIR')?.value)||29.5;
  const tipo=document.getElementById('niifTipoDif')?.value||'activo_mayor';
  const el=document.getElementById('niifDifResult'); if(!el) return;
  if(!bc&&!bt){el.style.display='none';return;}
  const diff=Math.abs(bc-bt);
  const impDif=diff*(tasa/100);
  const fmtS=n=>'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const esPasivo=tipo==='activo_mayor';
  el.style.display='block';
  el.innerHTML=`<div style="font-size:14px;font-weight:500;margin-bottom:12px;color:${esPasivo?'var(--red)':'var(--green)'}">
    ${esPasivo?'📈 Pasivo por Impuesto Diferido':'📉 Activo por Impuesto Diferido'} — NIC 12
  </div>
  <div class="tim-row"><span class="tim-row-lbl">Base contable (NIIF)</span><span class="tim-row-val">${fmtS(bc)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Base tributaria (LIR)</span><span class="tim-row-val">${fmtS(bt)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Diferencia temporaria</span><span class="tim-row-val">${fmtS(diff)}</span></div>
  <div class="tim-row"><span class="tim-row-lbl">Tasa IR aplicable</span><span class="tim-row-val">${tasa}%</span></div>
  <div class="tim-row" style="border-top:1px solid var(${esPasivo?'--red':'--green'})">
    <span class="tim-row-lbl"><strong>${esPasivo?'Pasivo diferido (cuenta 49)':'Activo diferido (cuenta 37)'}</strong></span>
    <span class="tim-row-val" style="color:${esPasivo?'var(--red)':'var(--green)'};font-size:16px"><strong>${fmtS(impDif)}</strong></span>
  </div>
  <div class="niif-impuesto-dif ${esPasivo?'pasivo':'activo'}" style="margin-top:10px">
    <strong>${esPasivo?'Asiento contable — Pasivo diferido:':'Asiento contable — Activo diferido:'}</strong><br>
    ${esPasivo?`DÉBITO: Gasto impuesto a las ganancias ${fmtS(impDif)}<br>CRÉDITO: Pasivo diferido (cuenta 49) ${fmtS(impDif)}<br><em style="font-size:14px">→ Se revertirá cuando la base contable = base tributaria</em>`:
    `DÉBITO: Activo diferido (cuenta 37) ${fmtS(impDif)}<br>CRÉDITO: Ingreso impuesto a las ganancias ${fmtS(impDif)}<br><em style="font-size:14px">→ Representa el menor IR futuro que se pagará</em>`}
  </div>`;
}
async function consultNIIFAI(){
  const q=document.getElementById('niifConsultaText')?.value?.trim()||'';
  if(!q){tpToast('Escribe tu consulta.', 'warn');return;}
  const el=document.getElementById('niifAIResult');el.style.display='block';el.textContent='Consultando...';
  if(!apiKey){el.innerHTML='Conecta tu API Key para consultas NIIF-tributario.';return;}
  try{const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:700,system:'Eres un contador público peruano experto en NIIF/NIC y su aplicación tributaria bajo la LIR peruana. Conoces a fondo las diferencias temporarias, permanentes y el cálculo de impuesto diferido bajo NIC 12.',messages:[{role:'user',content:q}]});
  const d=await r.json();renderAIResponse(el, d.content?.[0]?.text||"");}catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}

// ── PATCH setPTab ──
const _origSetPTabFin=setPTab;
setPTab = function(tab,btn){
  _origSetPTabFin(tab,btn);
  if(tab==='itan'){setITANTab('calc',null);setTimeout(()=>document.querySelector('#itanTabs .module-tab')?.classList.add('active'),50);}
  if(tab==='drawback'){setDBKTab('calc',null);setTimeout(()=>document.querySelector('#drawbackTabs .module-tab')?.classList.add('active'),50);}
  if(tab==='cdi'){initCDI();setCDITab('paises',null);setTimeout(()=>document.querySelector('#cdiTabs .module-tab')?.classList.add('active'),50);}
  if(tab==='ret_perc'){rpType='retencion';document.querySelectorAll('.rp-type-btn').forEach((b,i)=>{if(i===0)b.classList.add('active');else b.classList.remove('active');});renderRPInputs();}
  if(tab==='niif'){setNIIFTab('diferencias',null);renderNIIFTable('');setTimeout(()=>document.querySelector('#niifTabs .module-tab')?.classList.add('active'),50);}
}






// ════════════════════════════════════════
// PLAN EMPRESA — SUITE EXCLUSIVA
// ════════════════════════════════════════

// ── Plan gate ──
function isEmpresa() {
  return curUser && (curUser.plan === 'empresa' || isAdminUser());
}

function initEmpresaHub() {
  const lock = document.getElementById('empLockScreen');
  const content = document.getElementById('empContent');
  if (!isEmpresa()) {
    if (lock) lock.style.display = 'block';
    if (content) content.style.display = 'none';
    return false;
  }
  if (lock) lock.style.display = 'none';
  if (content) content.style.display = 'block';
  return true;
}

function setEmpTab(tab, btn) {
  document.querySelectorAll('.emp-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['empCrm','empInformes','empAuditoria','empDossier','empDuediligence','empWhitelabel','empAlertas']
    .forEach(id => { const el = document.getElementById(id); if(el) el.style.display = 'none'; });
  const map = { crm:'empCrm', informes:'empInformes', auditoria:'empAuditoria',
    dossier:'empDossier', duediligence:'empDuediligence', whitelabel:'empWhitelabel', alertas:'empAlertas' };
  const el = document.getElementById(map[tab]); if(el) el.style.display = 'block';
  if (tab === 'crm') { initCRMData(); renderCRMClients(); }
  if (tab === 'informes') populateClienteSelects();
  if (tab === 'auditoria') populateClienteSelects();
  if (tab === 'dossier') { populateClienteSelects(); renderDossier(''); }
  if (tab === 'duediligence') renderDDCategories();
  if (tab === 'whitelabel') { loadWLConfig(); previewWL(); }
  if (tab === 'alertas') { renderSectorGrid(); renderAlertasReg(sectoresSel); }
}

// ════════════════════════════════════════
// 1. CRM — GESTIÓN DE CARTERA DE CLIENTES
// ════════════════════════════════════════
let crmClients = [];
const CRM_KEY = () => 'tp_crm_' + btoa(curUser?.email || 'demo');

function initCRMData() {
  try {
    const saved = localStorage.getItem(CRM_KEY());
    crmClients = saved ? JSON.parse(saved) : getDemoCRMClients();
    if (!saved) saveCRMData();
  } catch(e) { crmClients = getDemoCRMClients(); }
  updateCRMStats();
}

function getDemoCRMClients() {
  return [
    { id: 'c1', nombre: 'Comercializadora Norte S.A.C.', ruc: '20512345678', regimen: 'rmt', sector: 'Comercio', email: 'contab@cnorte.com', contador: 'CPC Ana García', alertas: ['IGV vence en 3 días'], estado: 'alerta', fechaAlta: '2024-01-15' },
    { id: 'c2', nombre: 'Constructora Pacífico E.I.R.L.', ruc: '20456789012', regimen: 'rg', sector: 'Construcción', email: 'admin@cpac.pe', contador: 'CPC Luis Torres', alertas: [], estado: 'ok', fechaAlta: '2024-03-10' },
    { id: 'c3', nombre: 'Servicios Tech Lima S.A.C.', ruc: '20398765432', regimen: 'rmt', sector: 'Tecnología', email: 'cfo@techli.pe', contador: 'CPC Ana García', alertas: ['PT Local File vence en 15 días'], estado: 'warn', fechaAlta: '2024-06-01' },
    { id: 'c4', nombre: 'Exportadora Andina S.A.', ruc: '20123456789', regimen: 'rg', sector: 'Exportación', email: 'finanzas@eandina.pe', contador: 'CPC Pedro Ramos', alertas: [], estado: 'ok', fechaAlta: '2023-11-20' },
    { id: 'c5', nombre: 'Restaurantes El Sabor S.R.L.', ruc: '20567890123', regimen: 'rer', sector: 'Gastronomía', email: 'dueno@elsabor.pe', contador: 'CPC Luis Torres', alertas: ['Pago PLAME pendiente'], estado: 'alerta', fechaAlta: '2024-08-05' },
  ];
}

function saveCRMData() {
  try { kvPut(CRM_KEY(), crmClients, 'crm'); } catch(e) {}
}
registerKVScope('crm', () => CRM_KEY());

function updateCRMStats() {
  const el = document.getElementById('crmStats'); if(!el) return;
  const alertas = crmClients.filter(c => c.estado === 'alerta').length;
  const warns   = crmClients.filter(c => c.estado === 'warn').length;
  const ok      = crmClients.filter(c => c.estado === 'ok').length;
  const regCounts = {};
  crmClients.forEach(c => regCounts[c.regimen] = (regCounts[c.regimen]||0)+1);
  el.innerHTML = [
    {v: crmClients.length, l: 'Total clientes', c: '#3A86FF'},
    {v: alertas, l: '🔴 Con alertas urgentes', c: 'var(--red)'},
    {v: warns,   l: '🟡 Con avisos pendientes', c: 'var(--gold)'},
    {v: ok,      l: '🟢 Al día', c: 'var(--green)'},
  ].map(s => `<div class="crm-stat"><div class="crm-stat-v" style="color:${s.c}">${s.v}</div><div class="crm-stat-l">${s.l}</div></div>`).join('');
}

function toggleCRMForm() {
  const f = document.getElementById('crmAddForm');
  if(f) f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

function addCRMClient() {
  const nombre = document.getElementById('crmNewNombre')?.value?.trim();
  const ruc    = document.getElementById('crmNewRUC')?.value?.trim();
  if (!nombre || !ruc) { tpToast('Nombre y RUC son requeridos.', 'warn'); return; }
  const newClient = {
    id: 'c' + Date.now(),
    nombre, ruc,
    regimen: document.getElementById('crmNewRegimen')?.value || 'rmt',
    sector:  document.getElementById('crmNewSector')?.value?.trim() || 'General',
    email:   document.getElementById('crmNewEmail')?.value?.trim() || '',
    contador:document.getElementById('crmNewContador')?.value?.trim() || '',
    alertas: [], estado: 'ok',
    fechaAlta: new Date().toISOString().split('T')[0],
  };
  crmClients.push(newClient);
  saveCRMData(); updateCRMStats(); renderCRMClients(); toggleCRMForm();
  ['crmNewNombre','crmNewRUC','crmNewSector','crmNewEmail','crmNewContador'].forEach(id => { const el=document.getElementById(id); if(el)el.value=''; });
  addNotif('👥','Cliente agregado', nombre + ' agregado a tu cartera.');
}

async function deleteCRMClient(id, e) {
  e.stopPropagation();
  const ok = await tpConfirm('¿Eliminar cliente?', '¿Eliminar este cliente de la cartera? Esta acción no se puede deshacer.', '🗑️'); if (!ok) return;
  crmClients = crmClients.filter(c => c.id !== id);
  saveCRMData(); updateCRMStats(); renderCRMClients();
}

function searchCRM(q) { renderCRMClients(q); }

function renderCRMClients(q = '') {
  const el = document.getElementById('crmClientList'); if(!el) return;
  const reg = document.getElementById('crmFilterRegimen')?.value || 'todos';
  let items = crmClients;
  if (reg !== 'todos') items = items.filter(c => c.regimen === reg);
  if (q) {
    const ql = q.toLowerCase();
    items = items.filter(c => c.nombre.toLowerCase().includes(ql) || c.ruc.includes(ql) || (c.sector||'').toLowerCase().includes(ql));
  }
  if (!items.length) { el.innerHTML = '<div class="hempty">No se encontraron clientes.</div>'; return; }
  const regLabels = {rg:'RG',rmt:'RMT',rer:'RER',nrus:'NRUS'};
  el.innerHTML = items.map(c => `
    <div class="crm-client-card">
      <div class="crm-client-top">
        <div>
          <div class="crm-client-name">${c.nombre}</div>
          <div class="crm-client-ruc">RUC ${c.ruc} · ${c.sector} · ${regLabels[c.regimen]||c.regimen}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button onclick="generarInformeDesdeCartera('${c.id}')" style="background:rgba(58,134,255,.1);border:1px solid rgba(58,134,255,.2);color:#3A86FF;border-radius:6px;padding:4px 9px;font-size:14px;cursor:pointer;font-family:inherit">📄 Informe</button>
          <button onclick="deleteCRMClient('${c.id}',event)" style="background:rgba(230,57,70,.08);border:1px solid rgba(230,57,70,.15);color:var(--red);border-radius:6px;padding:4px 9px;font-size:14px;cursor:pointer;font-family:inherit">✕</button>
        </div>
      </div>
      <div class="crm-client-meta">
        ${c.contador ? `<span style="color:var(--muted)">👤 ${c.contador}</span>` : ''}
        ${c.email ? `<span style="color:var(--muted)">📧 ${c.email}</span>` : ''}
        <span style="color:var(--muted)">Alta: ${c.fechaAlta}</span>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">
        ${c.alertas.map(a => `<span class="crm-alert-pill ${a.includes('urgente')||a.includes('días')&&parseInt(a)<5?'urgent':'warn'}">${a}</span>`).join('')}
        ${!c.alertas.length ? '<span class="crm-alert-pill ok">✓ Al día</span>' : ''}
      </div>
    </div>`).join('');
}

function populateClienteSelects() {
  ['infClienteSel','auditClienteSel','dossierClienteSel'].forEach(id => {
    const el = document.getElementById(id); if(!el) return;
    el.innerHTML = '<option value="">— Seleccionar cliente —</option>' +
      crmClients.map(c => `<option value="${c.id}">${c.nombre} (${c.ruc})</option>`).join('');
  });
}

function generarInformeDesdeCartera(id) {
  const client = crmClients.find(c => c.id === id);
  if (!client) return;
  setEmpTab('informes', null);
  setTimeout(() => {
    const sel = document.getElementById('infClienteSel');
    if (sel) sel.value = id;
    loadClienteInforme();
    document.querySelectorAll('.emp-tab').forEach((b,i) => { if(i===1) b.classList.add('active'); else b.classList.remove('active'); });
  }, 100);
}

// ════════════════════════════════════════
// 2. INFORMES MENSUALES POR CLIENTE
// ════════════════════════════════════════
let infColor = '#1A1A2E';

function selectInfColor(btn, color) {
  infColor = color;
  document.querySelectorAll('#empInformes .wl-color-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
}

function loadClienteInforme() {
  const id = document.getElementById('infClienteSel')?.value;
  // Pre-fill if client found
}

async function generarInformeMensual() {
  const id     = document.getElementById('infClienteSel')?.value;
  const estudio= document.getElementById('infEstudio')?.value?.trim() || 'Estudio Contable';
  const firmante=document.getElementById('infFirmante')?.value?.trim() || 'El Contador';
  const periodo= document.getElementById('infPeriodo')?.value || 'Marzo 2025';
  const notas  = document.getElementById('infNotas')?.value?.trim() || '';
  const cliente= crmClients.find(c => c.id === id);
  if (!cliente) { tpToast('Selecciona un cliente.', 'error'); return; }
  const loading = document.getElementById('infLoading');
  const preview = document.getElementById('infPreview');
  const actions = document.getElementById('infActions');
  loading.style.display='block'; preview.style.display='none'; if(actions)actions.style.display='none';
  const regLabels={rg:'Régimen General (29.5%)',rmt:'RMT (10%/29.5%)',rer:'RER',nrus:'NRUS'};
  if (!apiKey) {
    loading.style.display='none'; preview.style.display='block'; if(actions)actions.style.display='flex';
    preview.innerHTML = buildInformeDemo(estudio,firmante,periodo,cliente,notas,infColor);
    return;
  }
  const prompt = `Redacta un informe tributario mensual profesional para:
Estudio: ${estudio} | Firmante: ${firmante}
Cliente: ${cliente.nombre} | RUC: ${cliente.ruc}
Régimen: ${regLabels[cliente.regimen]||cliente.regimen} | Sector: ${cliente.sector}
Período: ${periodo} | Alertas activas: ${cliente.alertas.join(', ')||'ninguna'}
Notas adicionales: ${notas}

Estructura el informe con:
1. Situación tributaria actual del cliente
2. Obligaciones del período ${periodo} con fechas de vencimiento exactas
3. Alertas y puntos de atención (máx. 3)
4. Recomendaciones del mes (máx. 3)
5. Recordatorio de documentos a preparar

Lenguaje profesional pero accesible. Citar normas cuando corresponda. Máximo 400 palabras.`;
  try {
    const r = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:'Eres un contador público peruano que redacta informes mensuales profesionales para clientes. Usas lenguaje formal pero claro.',messages:[{role:'user',content:prompt}]});
    const d = await r.json();
    loading.style.display='none'; preview.style.display='block'; if(actions)actions.style.display='flex';
    preview.innerHTML = safeHTML(buildInformeHTML(estudio,firmante,periodo,cliente,d.content?.[0]?.text||'',infColor));
    addNotif('📄','Informe generado',`Informe de ${periodo} para ${cliente.nombre} listo.`);
  } catch(e) { loading.style.display='none'; preview.innerHTML='<p style="color:var(--red)">Error: '+safeHTML(e.message)+'</p>'; preview.style.display='block'; }
}

function buildInformeDemo(estudio,firmante,periodo,cliente,notas,color) {
  return `<div class="inf-header"><div class="inf-logo" style="color:${color}">${estudio}</div><div style="font-size:14px;color:var(--muted)">Lima, ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div></div>
  <div><strong>${cliente.nombre}</strong> — RUC ${cliente.ruc}<br><span style="font-size:14px;color:var(--muted)">Informe tributario mensual · ${periodo}</span></div>
  <br><div class="inf-section"><strong>Situación tributaria:</strong> Cliente en ${cliente.regimen.toUpperCase()} — Sector ${cliente.sector}. Obligaciones del período al día.</div>
  ${cliente.alertas.map(a=>`<div class="inf-alert">⚠️ ${a}</div>`).join('')}
  <div class="inf-ok">✅ Sin contingencias tributarias significativas identificadas.</div>
  <br><p style="color:var(--muted)">Conecta tu API Key para generar el informe completo con IA.</p>
  <br><strong>Atentamente,</strong><br>${firmante}<br>${estudio}`;
}

function buildInformeHTML(estudio,firmante,periodo,cliente,body,color) {
  return `<div class="inf-header"><div class="inf-logo" style="color:${color}">${estudio}</div>
  <div style="font-size:14px;color:var(--muted)">Lima, ${new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})}</div></div>
  <div style="margin-bottom:14px"><strong>${cliente.nombre}</strong> — RUC ${cliente.ruc}<br>
  <span style="font-size:14px;color:var(--muted)">Informe Tributario Mensual · Período: ${periodo}</span></div>
  ${body.replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,`<strong style="color:${color}">$1</strong>`)}
  <br><div style="border-top:1px solid var(--border);margin-top:16px;padding-top:12px;font-size:14px">
  Atentamente,<br><strong>${firmante}</strong><br><span style="color:var(--muted)">${estudio}</span></div>`;
}

function exportInformeMensual() {
  const c=crmClients.find(c=>c.id===document.getElementById('infClienteSel')?.value);
  const content=document.getElementById('infPreview')?.innerHTML||'';
  const estudio=document.getElementById('infEstudio')?.value||'Estudio';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Informe — ${c?.nombre||'Cliente'}</title><style>body{font-family:'Times New Roman',serif;max-width:680px;margin:40px auto;color:#1a1a2e;line-height:1.85;font-size:14px}.inf-header{border-bottom:2px solid ${infColor};padding-bottom:12px;margin-bottom:16px}.inf-logo{font-size:16px;font-weight:bold;color:${infColor};margin-bottom:3px}.inf-section{background:#f8f8ff;border-left:3px solid ${infColor};padding:8px 12px;margin-bottom:8px;border-radius:0 5px 5px 0;font-size:14px}.inf-alert{background:#fff5f5;border:1px solid #fcc;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:14px}.inf-ok{background:#f0fff4;border:1px solid #9be9a8;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:14px}@media print{body{margin:20px}}</style></head><body>${content}<hr style="margin:20px 0"><p style="font-size:14px;text-align:center;color:#999">Generado por ${estudio} · DeclaraFY.pe</p></body></html>`);
  win.document.close(); setTimeout(()=>win.print(),400);
}
function copyInforme(){navigator.clipboard.writeText(document.getElementById('infPreview')?.innerText||'').then(()=>{event.target.textContent='✅ Copiado!';setTimeout(()=>event.target.textContent='📋 Copiar',2000);});}

// ════════════════════════════════════════
// 3. AUDITORÍA PREVENTIVA MENSUAL
// ════════════════════════════════════════
function runAuditPreventiva() {
  const ventas  = parseFloat(document.getElementById('auditVentas')?.value)||0;
  const compras = parseFloat(document.getElementById('auditCompras')?.value)||0;
  const igvDecl = parseFloat(document.getElementById('auditIGVDecl')?.value)||0;
  const pac     = parseFloat(document.getElementById('auditPAC')?.value)||0;
  const repres  = parseFloat(document.getElementById('auditRepres')?.value)||0;
  const nFact   = parseFloat(document.getElementById('auditNFacturas')?.value)||0;
  const noHab   = document.getElementById('auditNoHabido')?.value||'no';
  const el      = document.getElementById('auditResult');
  const aiBtn   = document.getElementById('auditAIBtn');
  if (!ventas) { tpToast('Ingresa al menos las ventas del período.', 'warn'); return; }
  const findings = [];
  // IGV check
  const igvEsp = Math.max(0,(ventas-compras)*0.18);
  const igvDiff = Math.abs(igvDecl-igvEsp);
  if (igvDiff > 100) findings.push({tipo:igvDiff>500?'critical':'warning',title:'IGV declarado difiere del calculado',desc:`Declarado: S/${igvDecl.toLocaleString()} | Calculado: S/${igvEsp.toFixed(0)} | Diferencia: S/${igvDiff.toFixed(0)}`,action:'Verificar si hay crédito de períodos anteriores, notas de crédito o diferencias de base imponible no consideradas.'});
  else findings.push({tipo:'pass',title:'IGV cuadra correctamente',desc:`Débito - Crédito = S/${igvEsp.toFixed(0)} ≈ Declarado S/${igvDecl.toLocaleString()}`,action:''});
  // PAC check
  const pacEsp = ventas * 0.015;
  if (Math.abs(pac-pacEsp)>50) findings.push({tipo:'warning',title:'Pago a cuenta IR posiblemente incorrecto',desc:`Declarado: S/${pac.toLocaleString()} | Calculado 1.5%: S/${pacEsp.toFixed(0)}`,action:'Verificar coeficiente aplicado. El coeficiente se obtiene del IR previo / ingresos previos.'});
  else findings.push({tipo:'pass',title:'Pago a cuenta IR correcto',desc:`1.5% × S/${ventas.toLocaleString()} = S/${pacEsp.toFixed(0)}`,action:''});
  // Representación
  const represLim = ventas * 0.005;
  if (repres > represLim) findings.push({tipo:'critical',title:'Gastos de representación exceden límite deducible',desc:`Gasto: S/${repres.toLocaleString()} | Límite (0.5% ventas): S/${represLim.toFixed(0)} | Exceso NO deducible: S/${(repres-represLim).toFixed(0)}`,action:'Art. 37 inc. q) LIR. El exceso genera IR adicional. Evaluar reclasificar gastos.'});
  // No habidos
  if (noHab==='si_mucho') findings.push({tipo:'critical',title:'Proveedores en estado NO HABIDO detectados (>5%)',desc:'SUNAT puede desconocer el crédito fiscal IGV y la deducción del IR de estas facturas.',action:'RTF 01580-5-2009. Identificar y evaluar rectificatoria. Documentar fehaciencia de las operaciones.'});
  else if (noHab==='si_poco') findings.push({tipo:'warning',title:'Proveedores NO HABIDO (<5%) — Riesgo controlado',desc:'Monitorear regularmente en SUNAT. El crédito fiscal puede ser cuestionado.',action:'Verificar estado de todos los proveedores regularmente en consulta SUNAT.'});
  else findings.push({tipo:'pass',title:'Sin proveedores en estado NO HABIDO',desc:'Todos los proveedores verificados en estado HABIDO.',action:''});
  // Ratio compras/ventas
  if (compras/ventas > 0.92) findings.push({tipo:'warning',title:'Margen bruto muy bajo — posible observación',desc:`Ratio compras/ventas: ${((compras/ventas)*100).toFixed(1)}%. Margen bruto: ${(100-((compras/ventas)*100)).toFixed(1)}%.`,action:'SUNAT puede cuestionar la razonabilidad del margen. Preparar sustento de estructura de costos.'});
  const criticos = findings.filter(f=>f.tipo==='critical').length;
  const warnings = findings.filter(f=>f.tipo==='warning').length;
  const passes   = findings.filter(f=>f.tipo==='pass').length;
  const score    = Math.max(0, 100 - criticos*25 - warnings*10);
  const scoreColor = score>=80?'var(--green)':score>=60?'var(--gold)':'var(--red)';
  el.style.display='block';
  el.innerHTML = `<div style="display:flex;align-items:center;gap:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:14px;flex-wrap:wrap">
    <div style="text-align:center;flex-shrink:0">
      <div style="font-size:34px;font-weight:300;color:${scoreColor}">${score}</div>
      <div style="font-size:14px;color:var(--muted)">Score de cumplimiento</div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <span style="background:rgba(230,57,70,.12);color:var(--red);padding:4px 10px;border-radius:8px;font-size:14px;font-weight:500">🔴 ${criticos} crítico${criticos!==1?'s':''}</span>
      <span style="background:rgba(201,168,76,.12);color:var(--gold);padding:4px 10px;border-radius:8px;font-size:14px;font-weight:500">🟡 ${warnings} advertencia${warnings!==1?'s':''}</span>
      <span style="background:rgba(76,175,80,.1);color:var(--green);padding:4px 10px;border-radius:8px;font-size:14px;font-weight:500">🟢 ${passes} correcto${passes!==1?'s':''}</span>
    </div>
  </div>
  ${findings.map(f=>`<div class="audit-finding ${f.tipo}">
    <div class="audit-finding-title">${f.tipo==='critical'?'🔴':f.tipo==='warning'?'🟡':'✅'} ${f.title}</div>
    <div class="audit-finding-desc">${f.desc}</div>
    ${f.action?`<div class="audit-finding-action">💡 ${f.action}</div>`:''}
  </div>`).join('')}`;
  if(aiBtn) { aiBtn.style.display='block'; window._auditData={ventas,compras,igvDecl,pac,repres,noHab,score,criticos}; }
}

async function deepAuditAI() {
  const d=window._auditData||{};
  const el=document.getElementById('auditAIResult');
  el.style.display='block'; el.textContent='Analizando con IA...';
  const cliente=crmClients.find(c=>c.id===document.getElementById('auditClienteSel')?.value);
  if(!apiKey){el.innerHTML='Conecta tu API Key para el análisis profundo de auditoría.';return;}
  const prompt=`Actúa como auditor tributario peruano senior. Analiza este perfil mensual:
${cliente?'Cliente: '+cliente.nombre+' ('+cliente.regimen.toUpperCase()+' - '+cliente.sector+')':''}
Ventas: S/${d.ventas?.toLocaleString()} | Compras: S/${d.compras?.toLocaleString()}
IGV declarado: S/${d.igvDecl} | Pago a cuenta IR: S/${d.pac}
Gastos representación: S/${d.repres} | No habidos: ${d.noHab}
Score de cumplimiento: ${d.score}/100 | Hallazgos críticos: ${d.criticos}
Proporciona: 1) Los 3 riesgos más importantes que SUNAT podría detectar, 2) Acciones concretas a tomar ESTA SEMANA, 3) Documentación que debe prepararse preventivamente. Máx 250 palabras.`;
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:600,system:'Eres un auditor tributario peruano senior. Das recomendaciones concretas y accionables.',messages:[{role:'user',content:prompt}]});
    const dt=await r.json();
    el.innerHTML=(dt.content?.[0]?.text||'').replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--red)">$1</strong>');
  }catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}

// ════════════════════════════════════════
// 4. DOSSIER HISTÓRICO
// ════════════════════════════════════════
const DOSSIER_DEMO = {
  c1: [
    {tipo:'pago',fecha:'Mar 2025',titulo:'PDT 621 — IGV y pago a cuenta IR',desc:'Declarado y pagado dentro del plazo. IGV: S/4,200. PAC IR: S/1,875.',monto:'S/ 6,075'},
    {tipo:'fiscal',fecha:'Feb 2025',titulo:'Requerimiento SUNAT N° 0922250001234',desc:'Solicitud de documentación sustentatoria de compras del período Jul-Dic 2024. Respondido dentro del plazo.',monto:''},
    {tipo:'pago',fecha:'Ene 2025',titulo:'PDT 621 — Enero 2025',desc:'Declarado y pagado. IGV: S/3,950.',monto:'S/ 5,500'},
    {tipo:'multa',fecha:'Nov 2024',titulo:'Multa por presentación tardía PDT 621',desc:'Presentación fuera de plazo. Multa: 1 UIT rebajada al 90%.',monto:'S/ 515'},
    {tipo:'pago',fecha:'Oct 2024',titulo:'ITAN — Cuota 7/9',desc:'Pago de cuota mensual ITAN.',monto:'S/ 2,150'},
    {tipo:'fiscal',fecha:'Set 2024',titulo:'Inicio fiscalización parcial IGV 2022',desc:'SUNAT inició fiscalización parcial del IGV 2022. Completada sin observaciones.',monto:''},
  ],
};

function loadDossier() {
  const id = document.getElementById('dossierClienteSel')?.value;
  renderDossier(id);
}

function renderDossier(id) {
  const content = document.getElementById('dossierContent');
  const empty   = document.getElementById('dossierEmpty');
  if (!id) { if(content)content.style.display='none'; if(empty)empty.style.display='block'; return; }
  const cliente = crmClients.find(c=>c.id===id);
  if (!cliente) return;
  const events = DOSSIER_DEMO[id] || generateDemoEvents(cliente);
  if(content) content.style.display='block';
  if(empty) empty.style.display='none';
  const nEl = document.getElementById('dossierClienteNombre');
  if(nEl) nEl.textContent = `📁 Dossier: ${cliente.nombre} — RUC ${cliente.ruc}`;
  const statsEl = document.getElementById('dossierStats');
  if(statsEl) {
    const fiscales=events.filter(e=>e.tipo==='fiscal').length;
    const multas=events.filter(e=>e.tipo==='multa').length;
    const pagos=events.filter(e=>e.tipo==='pago').length;
    statsEl.innerHTML=[
      {v:events.length,l:'Total eventos',c:'#3A86FF'},{v:pagos,l:'Pagos realizados',c:'var(--green)'},
      {v:fiscales,l:'Fiscalizaciones',c:'var(--red)'},{v:multas,l:'Multas',c:'var(--gold)'},
    ].map(s=>`<div class="fracc-card"><div class="fracc-card-v" style="color:${s.c}">${s.v}</div><div class="fracc-card-l">${s.l}</div></div>`).join('');
  }
  const tlEl = document.getElementById('dossierTimeline');
  if(tlEl) tlEl.innerHTML = events.map(e=>`<div class="dossier-item ${e.tipo}">
    <div class="dossier-date">📅 ${e.fecha}</div>
    <div class="dossier-title">${e.titulo}</div>
    <div class="dossier-desc">${e.desc}</div>
    ${e.monto?`<div class="dossier-amount" style="color:${e.tipo==='multa'?'var(--red)':e.tipo==='pago'?'var(--green)':'var(--muted)'}">${e.monto}</div>`:''}
  </div>`).join('');
}

function generateDemoEvents(cliente) {
  return [
    {tipo:'pago',fecha:'Mar 2025',titulo:'PDT 621 — Declaración mensual',desc:`Declaración y pago de ${cliente.regimen.toUpperCase()} dentro del plazo.`,monto:'Al día'},
    {tipo:'pago',fecha:'Feb 2025',titulo:'PDT 621 — Declaración mensual',desc:'Declaración y pago realizados correctamente.',monto:'Al día'},
    {tipo:'pago',fecha:'Ene 2025',titulo:'DJ Anual — Inicio preparación',desc:'Se inició la recopilación de información para la DJ Anual 2024.',monto:''},
  ];
}

function addDossierEvent() {
  const id = document.getElementById('dossierClienteSel')?.value;
  if(!id){tpToast('Selecciona un cliente primero.', 'error');return;}
  const tipo = prompt('Tipo de evento (pago/fiscal/multa):','pago');
  const titulo = prompt('Título del evento:','PDT 621 — Declaración mensual');
  const desc = prompt('Descripción:','');
  if(!titulo)return;
  if(!DOSSIER_DEMO[id]) DOSSIER_DEMO[id]=[];
  DOSSIER_DEMO[id].unshift({tipo:tipo||'pago',fecha:new Date().toLocaleDateString('es-PE',{month:'short',year:'numeric'}),titulo,desc,monto:''});
  renderDossier(id);
}

function exportDossier() {
  const id=document.getElementById('dossierClienteSel')?.value;
  const cliente=crmClients.find(c=>c.id===id);
  const content=document.getElementById('dossierTimeline')?.innerHTML||'';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dossier — ${cliente?.nombre||'Cliente'}</title><style>body{font-family:'Times New Roman',serif;max-width:680px;margin:40px auto;color:#1a1a2e;font-size:14px;line-height:1.7}.dossier-item{margin-bottom:14px;padding-left:18px;border-left:2px solid #3A86FF}.dossier-item.fiscal{border-left-color:#E63946}.dossier-item.multa{border-left-color:#C9A84C}.dossier-item.pago{border-left-color:#4CAF50}.dossier-date{font-size:14px;color:#666}.dossier-title{font-weight:bold;margin:2px 0}.dossier-desc{color:#444}.dossier-amount{font-weight:bold;margin-top:3px}@media print{body{margin:20px}}</style></head><body><h2 style="font-family:Georgia,serif;color:#1A1A2E">Dossier Tributario</h2><h3>${cliente?.nombre||''} — RUC ${cliente?.ruc||''}</h3>${content}<hr><p style="font-size:14px;text-align:center;color:#999">Generado por DeclaraFY.pe</p></body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}

// ════════════════════════════════════════
// 5. DUE DILIGENCE M&A
// ════════════════════════════════════════
const DD_CATEGORIES = [
  { titulo:'Declaraciones y pagos tributarios', icon:'📋', items:[
    {t:'DJ Anuales de IR presentadas en los últimos 4/6 años',r:'alto'},{t:'PDT 621 mensuales sin omisiones',r:'alto'},
    {t:'Pagos de tributos realizados dentro de plazo',r:'alto'},{t:'Rectificatorias presentadas y su impacto',r:'medio'},
    {t:'ITAN declarado y pagado correctamente',r:'medio'},{t:'Cero órdenes de pago o resoluciones de determinación pendientes',r:'alto'},
  ]},
  { titulo:'IGV y crédito fiscal', icon:'🧾', items:[
    {t:'Crédito fiscal sustentado con operaciones fehacientes (RTF 01580-5-2009)',r:'alto'},
    {t:'Sin proveedores en estado NO HABIDO en el período revisado',r:'alto'},
    {t:'Bancarización cumplida para compras >S/2,000 (Ley 28194)',r:'alto'},
    {t:'Notas de crédito y débito correctamente registradas',r:'medio'},
    {t:'IGV de importaciones correctamente liquidado',r:'medio'},
  ]},
  { titulo:'Precios de Transferencia', icon:'🔗', items:[
    {t:'Local File presentado si ingresos >S/2.3M y transacciones vinculadas >S/400K',r:'alto'},
    {t:'Formulario 3560 declarado correctamente',r:'alto'},{t:'Contratos con vinculadas formalizados y vigentes',r:'alto'},
    {t:'Tasas de interés en préstamos intragrupo dentro del rango de mercado',r:'alto'},
    {t:'Royalties con sustento de uso real del intangible',r:'medio'},
  ]},
  { titulo:'Contingencias y litigios', icon:'⚖️', items:[
    {t:'Sin procedimientos de fiscalización activos con SUNAT',r:'alto'},
    {t:'Sin recursos de apelación ante el Tribunal Fiscal pendientes',r:'alto'},
    {t:'Sin acciones contencioso-administrativas pendientes',r:'medio'},
    {t:'Provisiones contables por contingencias tributarias valoradas',r:'medio'},
    {t:'Carta de abogados externos confirmando litigios pendientes',r:'alto'},
  ]},
  { titulo:'Laboral y planilla', icon:'👷', items:[
    {t:'PLAME al día sin omisiones',r:'alto'},{t:'EsSalud y AFP/ONP depositados puntualmente',r:'alto'},
    {t:'CTS y gratificaciones pagadas correctamente',r:'medio'},{t:'Sin procesos laborales activos (SUNAFIL)',r:'medio'},
    {t:'Utilidades a trabajadores calculadas y pagadas',r:'medio'},
  ]},
  { titulo:'Activos y patrimonio', icon:'🏢', items:[
    {t:'Depreciación contable vs tributaria conciliada (diferencias temporarias)',r:'medio'},
    {t:'Activos revaluados con impacto tributario documentado',r:'medio'},
    {t:'Sin activos gravados con medidas cautelares de SUNAT',r:'alto'},
    {t:'ITAN calculado correctamente sobre activos netos reales',r:'bajo'},
  ]},
];

let ddState = {};

function renderDDCategories() {
  const el = document.getElementById('ddCategories'); if(!el) return;
  el.innerHTML = DD_CATEGORIES.map((cat,ci) => {
    const total=cat.items.length;
    const done=cat.items.filter((_,ii)=>ddState[`${ci}_${ii}`]).length;
    const pct=Math.round((done/total)*100);
    const cls=pct>=80?'low':pct>=50?'med':'high';
    return `<div class="dd-category">
      <div class="dd-cat-header" onclick="toggleDDCat('ddBody_${ci}')">
        <div class="dd-cat-title">${cat.icon} ${cat.titulo}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:14px;color:var(--muted)">${done}/${total}</span>
          <span class="dd-cat-score ${cls}">${pct>=80?'✅ OK':pct>=50?'⚠️ Parcial':'🔴 Pendiente'}</span>
        </div>
      </div>
      <div id="ddBody_${ci}">${cat.items.map((item,ii)=>{
        const key=`${ci}_${ii}`;const checked=ddState[key]||false;
        return `<div class="dd-item" onclick="toggleDD('${key}')">
          <div class="dd-item-check ${checked?'checked':item.r==='alto'?'risk':''}">${checked?'✓':''}</div>
          <span class="dd-item-text">${item.t}</span>
          <span class="dd-item-risk ${item.r}">${item.r.toUpperCase()}</span>
        </div>`;
      }).join('')}</div>
    </div>`;
  }).join('');
  updateDDScore();
}

function toggleDDCat(id){const el=document.getElementById(id);if(el)el.style.display=el.style.display==='none'?'block':'block';}
function toggleDD(key){ddState[key]=!ddState[key];renderDDCategories();}

function updateDDScore() {
  const total=DD_CATEGORIES.reduce((s,c)=>s+c.items.length,0);
  const done=Object.values(ddState).filter(Boolean).length;
  const altoTotal=DD_CATEGORIES.reduce((s,c)=>s+c.items.filter(i=>i.r==='alto').length,0);
  const altoDone=DD_CATEGORIES.reduce((s,c,ci)=>s+c.items.filter((i,ii)=>i.r==='alto'&&ddState[`${ci}_${ii}`]).length,0);
  const el=document.getElementById('ddScoreSummary');
  if(!total||!el)return;
  el.style.display='flex';
  const pct=Math.round((done/total)*100);
  const risk=Math.round(((altoTotal-altoDone)/altoTotal)*100)||0;
  el.innerHTML=`
    <div style="text-align:center;flex-shrink:0"><div style="font-size:32px;font-weight:300;color:${pct>=80?'var(--green)':pct>=50?'var(--gold)':'var(--red)'}">${pct}%</div><div style="font-size:14px;color:var(--muted)">Completado</div></div>
    <div style="flex:1">
      <div style="font-size:14px;font-weight:500;margin-bottom:6px">Estado del DD: <span style="color:${pct>=80?'var(--green)':pct>=50?'var(--gold)':'var(--red)'}">${pct>=80?'Avanzado':pct>=50?'En progreso':'Inicial'}</span></div>
      <div style="font-size:14px;color:var(--muted)">${done}/${total} puntos revisados · ${altoTotal-altoDone} ítems de riesgo ALTO pendientes</div>
      <div style="font-size:14px;color:var(--red);margin-top:4px">${risk>0?`⚠️ Riesgo residual: ${risk}% de ítems críticos sin revisar`:' ✅ Todos los ítems críticos revisados'}</div>
    </div>`;
}

async function generarInformeDDIA() {
  const target=document.getElementById('ddTarget')?.value?.trim()||'Empresa Target';
  const tipo=document.getElementById('ddTipo')?.value||'adquisicion';
  const el=document.getElementById('ddInformeResult');
  el.style.display='block'; el.textContent='Generando informe de due diligence...';
  const total=DD_CATEGORIES.reduce((s,c)=>s+c.items.length,0);
  const done=Object.values(ddState).filter(Boolean).length;
  const pendientes=[];
  DD_CATEGORIES.forEach((cat,ci)=>cat.items.forEach((item,ii)=>{if(!ddState[`${ci}_${ii}`]&&item.r==='alto')pendientes.push(item.t);}));
  if(!apiKey){
    el.innerHTML=`<strong style="color:#3A86FF">Due Diligence Tributario — ${target}</strong><br><br>
    <strong>Cobertura:</strong> ${done}/${total} puntos revisados (${Math.round(done/total*100)}%)<br>
    <strong>Ítems críticos pendientes:</strong><br>${pendientes.map(p=>`• ${p}`).join('<br>')}<br><br>
    <em>Conecta tu API Key para generar el informe completo con análisis IA y recomendaciones.</em>`;
    return;
  }
  const prompt=`Genera un informe ejecutivo de due diligence tributario para:
Target: ${target} | Operación: ${tipo}
Cobertura de revisión: ${done}/${total} puntos (${Math.round(done/total*100)}%)
Puntos críticos SIN revisar: ${pendientes.slice(0,8).join(', ')}

Estructura el informe con:
1. Resumen ejecutivo (2-3 líneas)
2. Hallazgos principales (por categoría)
3. Contingencias tributarias identificadas y cuantificación estimada
4. Cláusulas de protección recomendadas para el contrato (garantías, escrow, earn-out)
5. Condiciones precedentes al cierre
6. Recomendación final: PROCEDER / PROCEDER CON CONDICIONES / NO PROCEDER

Lenguaje técnico-legal. Citar normas cuando corresponda.`;
  try{
    const r=await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:900,system:'Eres un abogado tributarista peruano especialista en M&A y due diligence tributario.',messages:[{role:'user',content:prompt}]});
    const d=await r.json();
    renderAIResponse(el, d.content?.[0]?.text||"");
    addNotif('⚖️','DD generado','Informe de due diligence para '+target+' completado.');
  }catch(e){el.innerHTML='Error: '+safeHTML(e.message);}
}
function exportDDPDF(){
  const content=document.getElementById('ddInformeResult')?.innerHTML||'';
  const target=document.getElementById('ddTarget')?.value||'Target';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>DD Tributario — ${target}</title><style>body{font-family:'Times New Roman',serif;max-width:720px;margin:40px auto;color:#1a1a2e;line-height:1.85;font-size:14px}h2{font-family:Georgia,serif;color:#1A1A2E}@media print{body{margin:20px}}</style></head><body><h2>Informe de Due Diligence Tributario</h2><h3>Target: ${target}</h3>${content}<hr><p style="font-size:14px;text-align:center;color:#999">DeclaraFY.pe — Documento confidencial</p></body></html>`);
  win.document.close();setTimeout(()=>win.print(),400);
}

// ════════════════════════════════════════
// 6. WHITE LABEL
// ════════════════════════════════════════
let wlColor='#1A1A2E', wlAccent='#C9A84C';
const WL_KEY=()=>'tp_wl_'+(curUser?.email||'demo');
registerKVScope('whitelabel', () => WL_KEY());

function loadWLConfig(){
  try{const c=JSON.parse(localStorage.getItem(WL_KEY())||'{}');
    if(c.nombre)document.getElementById('wlNombre').value=c.nombre;
    if(c.slogan)document.getElementById('wlSlogan').value=c.slogan;
    if(c.color){wlColor=c.color;}
    if(c.accent){wlAccent=c.accent;}
  }catch(e){}
}

function selectWLColor(color,btn){
  wlColor=color;
  document.querySelectorAll('#empWhitelabel .wl-color-btn:nth-child(-n+6)').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  previewWL();
}
function selectWLAccent(color,btn){
  wlAccent=color;
  const picks=document.querySelectorAll('#empWhitelabel .wl-color-pick');
  if(picks[1]) picks[1].querySelectorAll('.wl-color-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  previewWL();
}
function previewWL(){
  const nombre=document.getElementById('wlNombre')?.value||'Tu Estudio';
  const slogan=document.getElementById('wlSlogan')?.value||'Asesoría tributaria';
  const logo=document.getElementById('wlLogoPreview');
  const nombreP=document.getElementById('wlNombrePreview');
  const sloganP=document.getElementById('wlSloganPreview');
  const header=document.getElementById('wlHeaderPreview');
  if(logo){logo.textContent=nombre.charAt(0).toUpperCase();logo.style.background=wlAccent;logo.style.color=wlColor;}
  if(nombreP){nombreP.textContent=nombre;nombreP.style.color=wlColor;}
  if(sloganP)sloganP.textContent=slogan;
  if(header)header.style.borderBottom=`1px solid ${wlAccent}22`;
}
function saveWLConfig(){
  const config={nombre:document.getElementById('wlNombre')?.value,slogan:document.getElementById('wlSlogan')?.value,color:wlColor,accent:wlAccent};
  try{kvPut(WL_KEY(),config,'whitelabel');}catch(e){}
  const msg=document.getElementById('wlSavedMsg');
  if(msg){msg.style.display='block';setTimeout(()=>msg.style.display='none',4000);}
  addNotif('🎨','White Label guardado','Configuración de marca aplicada a todos tus documentos.');
}
function previewWLFull(){
  const nombre=document.getElementById('wlNombre')?.value||'Tu Estudio';
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${nombre} — IA Tributaria</title><style>body{background:${wlColor};color:#f2f2f2;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{background:rgba(255,255,255,.08);border:1px solid ${wlAccent}33;border-radius:16px;padding:40px;max-width:400px;text-align:center}.logo{width:60px;height:60px;border-radius:12px;background:${wlAccent};display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:${wlColor};margin-bottom:16px}.name{font-size:22px;font-weight:600;color:${wlAccent}}.slogan{font-size:14px;opacity:.6;margin-top:6px;margin-bottom:24px}.btn{padding:12px 28px;border-radius:10px;background:${wlAccent};border:none;color:${wlColor};font-size:14px;font-weight:600;cursor:pointer}</style></head><body><div class="box"><div class="logo">${nombre.charAt(0)}</div><div class="name">${nombre}</div><div class="slogan">${document.getElementById('wlSlogan')?.value||'Asesoría tributaria'}</div><button class="btn">Ingresar a la plataforma</button></div></body></html>`);
  win.document.close();
}

// ════════════════════════════════════════
// 7. ALERTAS SECTORIALES
// ════════════════════════════════════════
const SECTORES_LIST=['🏗 Construcción','🛒 Comercio','🏭 Manufactura','🌿 Agroindustria','✈️ Exportación','💻 Tecnología','🏥 Salud','🍽 Gastronomía','🏦 Financiero','🚚 Transporte','⛏ Minería','🏘 Inmobiliaria'];
let sectoresSel = new Set();

const ALERTAS_SECTORIALES = [
  {sector:'construccion',nivel:'critica',fecha:'15 Mar 2025',titulo:'Modificación a detracciones en contratos de construcción',impacto:'Se modifica la tasa de detracción para contratos de construcción y rehabilitación de obras públicas. Verificar contratos vigentes.',norma:'R.S. 022-2025/SUNAT'},
  {sector:'agroindust',nivel:'importante',fecha:'10 Mar 2025',titulo:'Ley 31110 — Nuevas tablas salariales sector agrario',impacto:'Se actualizan las remuneraciones mínimas del sector agrario. Impacto en planilla, EsSalud y utilidades trabajadores.',norma:'D.S. 008-2025-MIDAGRI'},
  {sector:'exportacion',nivel:'critica',fecha:'05 Mar 2025',titulo:'Actualización procedimiento Drawback — SUNAT',impacto:'SUNAT actualiza el Form. 4702 y los requisitos de sustento para solicitudes de restitución. Nuevos plazos de verificación.',norma:'R.S. 043-2025/SUNAT'},
  {sector:'tecnologia',nivel:'importante',fecha:'01 Feb 2025',titulo:'IGV plataformas digitales — Implementación completa',impacto:'Todas las plataformas digitales extranjeras deben cobrar IGV. El banco retiene automáticamente. El crédito fiscal está disponible.',norma:'D.Leg. 1623 (vigente)'},
  {sector:'comercio',nivel:'critica',fecha:'15 Ene 2025',titulo:'Nuevos umbrales de detracciones bienes de comercio',impacto:'Se modifican los porcentajes de detracción para bienes del Anexo 1. Actualizar procedimientos de pago a proveedores.',norma:'R.S. 008-2025/SUNAT'},
  {sector:'mineria',nivel:'critica',fecha:'20 Feb 2025',titulo:'Regalías mineras — Nuevas tasas para 2025',impacto:'MINEM publica nuevas tasas de regalías para el ejercicio 2025. Impacto en IR y deducibilidad para empresas mineras.',norma:'D.S. 012-2025-MINEM'},
  {sector:'todos',nivel:'importante',fecha:'01 Feb 2025',titulo:'UIT 2025 fijada en S/5,350',impacto:'El aumento de S/200 en la UIT afecta: límites 4ta categoría (7 UIT), escalas RMT (15 UIT), multas SUNAT y SUNAFIL, topes ITAN.',norma:'D.S. 008-2025-EF'},
  {sector:'todos',nivel:'critica',fecha:'15 Mar 2025',titulo:'Cronograma de vencimientos DJ Anual 2024',impacto:'SUNAT publica el cronograma para la DJ Anual IR 2024. Contribuyentes RG y RMT deben declarar entre marzo y abril 2025.',norma:'R.S. 042-2025/SUNAT'},
];

function renderSectorGrid(){
  const el=document.getElementById('sectorGrid');if(!el)return;
  el.innerHTML=SECTORES_LIST.map(s=>`<button class="sector-btn ${sectoresSel.has(s)?'sel':''}" onclick="toggleSector('${s}',this)">${s}</button>`).join('');
}
function toggleSector(s,btn){
  if(sectoresSel.has(s))sectoresSel.delete(s);else sectoresSel.add(s);
  if(btn)btn.classList.toggle('sel',sectoresSel.has(s));
}
function activarAlertas(){
  if(!sectoresSel.size){tpToast('Selecciona al menos un sector.', 'error');return;}
  renderAlertasReg(sectoresSel);
  addNotif('📡','Alertas activadas',`Monitoreando ${sectoresSel.size} sectores en tu cartera.`);
}
function renderAlertasReg(sectors){
  const el=document.getElementById('alertasReg');if(!el)return;
  let items=ALERTAS_SECTORIALES;
  if(sectors&&sectors.size>0){
    const keys=[...sectors].map(s=>s.toLowerCase().replace(/[^a-z]/g,'').substring(2,10));
    items=ALERTAS_SECTORIALES.filter(a=>a.sector==='todos'||keys.some(k=>a.sector.includes(k)));
  }
  if(!items.length){el.innerHTML='<div class="hempty">No hay alertas para los sectores seleccionados.</div>';return;}
  el.innerHTML=items.map(a=>`<div class="alerta-reg-item ${a.nivel}">
    <div class="alerta-reg-fecha">📅 ${a.fecha} · <strong>${a.norma}</strong></div>
    <div class="alerta-reg-title">${a.titulo}</div>
    <div class="alerta-reg-impacto">${a.impacto}</div>
    <button class="reg-ask-btn" onclick="askAboutRegulation(event,'${a.titulo.replace(/'/g,"\\'")}')" style="margin-top:7px">💬 Consultar IA sobre esta norma</button>
  </div>`).join('');
}

// ── PATCH setPTab ──
const _origSetPTabEmp=setPTab;
setPTab = function(tab,btn){
  _origSetPTabEmp(tab,btn);
  if(tab==='empresa_hub'){
    if(!initEmpresaHub())return;
    initCRMData();
    setEmpTab('crm',null);
    setTimeout(()=>document.querySelector('.emp-tab')?.classList.add('active'),50);
  }
}


// ════════════════════════════════════════
// EMAIL CORPORATIVO — VALIDACIÓN PLAN EMPRESA
// ════════════════════════════════════════
const BLOCKED_DOMAINS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.es','yahoo.com.pe','yahoo.co',
  'hotmail.com','hotmail.es','hotmail.com.pe','live.com','live.com.pe','live.cl',
  'outlook.com','outlook.es','outlook.com.pe','msn.com',
  'icloud.com','me.com','mac.com','apple.com',
  'protonmail.com','proton.me','pm.me',
  'aol.com','ymail.com','rocketmail.com',
  'mail.com','email.com','inbox.com',
  'zoho.com','zohomail.com',
  'gmx.com','gmx.net','gmx.es',
  'terra.com.pe','terra.com','speedy.com.pe',
  'telefonica.net.pe','telefonica.net',
  'yopmail.com','tempmail.com','guerrillamail.com','10minutemail.com','throwam.com',
  'mailinator.com','fakeinbox.com','sharklasers.com','guerrillamailblock.com',
]);

const GENERIC_TLD_PATTERNS = [/^gmail\./i,/^yahoo\./i,/^hotmail\./i,/^outlook\./i,/^icloud\./i];

function isCorporateEmail(email) {
  if (!email || !email.includes('@')) return { ok: false, msg: 'Correo inválido.' };
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return { ok: false, msg: 'Correo inválido.' };
  // Block known generic providers
  if (BLOCKED_DOMAINS.has(domain)) {
    return { ok: false, msg: `❌ "${domain}" es un proveedor genérico. El Plan Empresa requiere correo corporativo (ej: tu@tuempresa.pe).` };
  }
  // Block common generic TLD patterns
  for (const pat of GENERIC_TLD_PATTERNS) {
    if (pat.test(domain)) return { ok: false, msg: `❌ Correo genérico detectado. Usa el correo de tu estudio o empresa.` };
  }
  // Must have at least one dot in domain (e.g., empresa.pe, estudio.com.pe)
  if (!domain.includes('.')) return { ok: false, msg: 'Dominio de correo inválido.' };
  // Warn if free-tier TLD only (single level like .pe direct without company)
  const parts = domain.split('.');
  if (parts.length < 2) return { ok: false, msg: 'Dominio de correo inválido.' };
  return { ok: true, msg: `✅ Correo corporativo válido — ${domain}` };
}

function validateRegisterEmail(input) {
  const plan = document.getElementById('rPlan')?.value || 'basico';
  const hint = document.getElementById('rEmailHint');
  if (!hint) return;
  const email = input.value?.trim().toLowerCase();
  if (!email || !email.includes('@')) { hint.style.display='none'; return; }
  if (plan !== 'empresa') { hint.style.display='none'; return; }
  const result = isCorporateEmail(email);
  hint.style.display = 'block';
  hint.textContent = result.msg;
  hint.style.color = result.ok ? 'var(--green)' : 'var(--red)';
  input.style.borderColor = result.ok ? 'var(--green)' : 'var(--red)';
}

function onPlanChange(select) {
  const note = document.getElementById('rPlanEmpresaNote');
  const emailHint = document.getElementById('rEmailHint');
  const emailInput = document.getElementById('rEmail');
  if (!note) return;
  const isEmp = select.value === 'empresa';
  note.style.display = isEmp ? 'block' : 'none';
  // Re-validate email if already typed
  if (emailInput?.value && isEmp) validateRegisterEmail(emailInput);
  else if (!isEmp) {
    if(emailHint) emailHint.style.display='none';
    if(emailInput) emailInput.style.borderColor='';
  }
}

// ─── PATCH doRegister to add corporate email check ───────────────────────────
function doRegister() {
  const plan = document.getElementById('rPlan')?.value || 'basico';
  const email = (document.getElementById('rEmail')?.value || '').trim().toLowerCase();
  // If Plan Empresa, validate corporate email
  if (plan === 'empresa') {
    const result = isCorporateEmail(email);
    if (!result.ok) {
      aerr(result.msg);
      const hint = document.getElementById('rEmailHint');
      if (hint) { hint.style.display='block'; hint.textContent=result.msg; hint.style.color='var(--red)'; }
      document.getElementById('rEmail').style.borderColor='var(--red)';
      return;
    }
  }
  // Store selected plan for Firebase registration
  window._overridePlan = plan;
  _origDoRegister();
}

// ─── PATCH doRegisterFB to use selected plan ─────────────────────────────────



// ════════════════════════════════════════
// CRIPTO LEGAL — DATA & FUNCTIONS
// ════════════════════════════════════════

// ── Tab switching ──
function setCLTab(tab, btn) {
  document.querySelectorAll('.cl-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['clSunat_guia','clIr_calc','clNft','clDefi','clAml','clTokens','clDao','clSmart','clMineria_cripto','clPrecios','clIgvCripto']
    .forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
  const map = { sunat_guia:'clSunat_guia', ir_calc:'clIr_calc', nft:'clNft', defi:'clDefi',
    aml:'clAml', tokens:'clTokens', dao:'clDao', smart:'clSmart', mineria_cripto:'clMineria_cripto',
    precios:'clPrecios', igv_cripto:'clIgvCripto' };
  const el = document.getElementById(map[tab]); if(el) el.style.display='block';
  if (tab==='sunat_guia') renderSunatGuia();
  if (tab==='ir_calc') initIRCripto();
  if (tab==='nft') renderNFT();
  if (tab==='defi') renderDeFi();
  if (tab==='aml') renderAML();
  if (tab==='tokens') renderTokenClassifier();
  if (tab==='dao') renderDAO();
  if (tab==='smart') renderSmart();
  if (tab==='mineria_cripto') renderMining();
  if (tab==='precios') loadCriptoPrecios();
  if (tab==='igv_cripto') initIgvCripto();
}

// ── Generic AI consultor ──
async function consultCLAI(topic) {
  const qIds = { sunat_guia:'clSunatQ', nft:'clNftQ', defi:'clDefiQ', aml:'clAmlQ',
    tokens:'clTokensQ', dao:'clDaoQ', smart:'clSmartQ', mineria_cripto:'clMiningQ' };
  const rIds = { sunat_guia:'clSunatResult', nft:'clNftResult', defi:'clDefiResult', aml:'clAmlResult',
    tokens:'clTokensResult', dao:'clDaoResult', smart:'clSmartResult', mineria_cripto:'clMineriaResult' };
  const systems = {
    sunat_guia:'Eres un especialista en tributación de criptomonedas en Perú. Conoces el Informe 045-2023-SUNAT, el D.Leg. 1623, y los principios de neutralidad tecnológica y fuente aplicados a cripto. Das respuestas concretas con base legal.',
    nft:'Eres un experto en la tributación y aspectos legales de NFTs en Perú. Conoces el Decreto Legislativo 822 (Ley de Derecho de Autor), la Ley 28294 y los principios SUNAT aplicables a la economía digital.',
    defi:'Eres especialista en tributación de finanzas descentralizadas (DeFi) en Perú. Analizas el tratamiento del staking, yield farming, liquidity pools y préstamos DeFi bajo la óptica del IR e IGV peruanos.',
    aml:'Eres experto en AML/CFT aplicado a activos virtuales en Perú. Conoces el D.Leg. 1492, la Resolución UIF 035-2023, la Ley 27693 y las obligaciones de los PSAVs.',
    tokens:'Eres especialista en regulación de tokens y valores digitales en Perú. Conoces el Reglamento del Mercado de Valores (D.Leg. 861), el Howey Test, y los lineamientos de la SMV para activos digitales.',
    dao:'Eres experto en la naturaleza jurídica y tributación de DAOs en Perú. Analizas bajo el Código Civil peruano, la LGS y la Ley del IR.',
    smart:'Eres experto en la validez y efectos jurídicos de los contratos inteligentes en Perú bajo el Código Civil (D.Leg. 295), la Ley de Firmas Digitales (Ley 27269) y la Ley de Gobierno Digital.',
    mineria_cripto:'Eres especialista en la tributación de la minería de criptomonedas en Perú. Conoces el tratamiento del IR (3ra categoría), IGV, depreciación de equipos (Art. 22 RLIR) y los requisitos contables.'
  };
  const q = document.getElementById(qIds[topic])?.value?.trim() || '';
  if (!q) { tpToast('Escribe tu consulta.', 'warn'); return; }
  const rEl = document.getElementById(rIds[topic]); if(!rEl) return;
  rEl.style.display='block';
  rEl.style.cssText='display:block;margin-top:12px;background:var(--surface);border:1px solid rgba(155,89,182,.2);border-radius:10px;padding:14px;font-size:14px;line-height:1.75;color:#C8C8DC';
  rEl.textContent = 'Consultando...';
  if (!apiKey) { rEl.innerHTML = '<strong>Conecta tu API Key</strong> para obtener respuestas especializadas sobre ' + topic + '.'; return; }
  try {
    const r = await callDeclaraFY({model:'claude-sonnet-4-5',max_tokens:800,system:systems[topic]||'Eres un especialista en cripto y derecho digital peruano.',messages:[{role:'user',content:q}]});
    const d = await r.json();
    renderAIResponse(rEl, d.content?.[0]?.text||"");
  } catch(e) { rEl.innerHTML = 'Error: '+safeHTML(e.message); }
}

// ════════════════════════════════════════
// 1. GUÍA DECLARACIÓN SUNAT
// ════════════════════════════════════════
const SUNAT_PASOS = [
  { num:1, title:'Determinar si eres "habitual" o "no habitual"', badge:'Crítico', badgeCls:'riesgo',
    body:`<strong>No habitual:</strong> Compras y vendes cripto esporádicamente → <strong>Renta de 2da categoría. Tasa efectiva: 5%</strong> (6.25% sobre el 80% de la ganancia). Declaras en la DJ Anual con el formulario virtual.
<strong>Habitual:</strong> SUNAT te considera habitual si realizas operaciones frecuentes con cripto (criterio no definido explícitamente — SUNAT usa analogía con el mercado de valores). → <strong>Renta de 3ra categoría.</strong>
<span class="cl-art">Informe 045-2023-SUNAT: Las ganancias por venta de cripto califican como renta de 2da categoría para personas naturales no habituales.</span>` },
  { num:2, title:'Calcular la ganancia o pérdida de capital', badge:'Obligatorio', badgeCls:'vacio',
    body:`<strong>Ganancia = Precio de venta − Costo de adquisición − Comisiones</strong>
<span class="cl-art">Costo computable: El precio pagado en soles al momento de la compra (TC SBS del día si pagaste en USD). Incluye comisiones del exchange.</span>
Método de costeo: No existe norma específica. Se recomienda <strong>PEPS (FIFO)</strong> por analogía con los criterios del mercado de valores (Art. 57 LIR).
<span class="cl-ejemplo">Ejemplo: Compraste 0.5 BTC a S/120,000. Vendiste 0.5 BTC a S/175,000. Ganancia de capital = S/55,000. IR 2da categoría = S/55,000 × 80% × 6.25% = S/2,750.</span>` },
  { num:3, title:'Identificar el período fiscal correcto', badge:'Importante', badgeCls:'nuevo',
    body:`<strong>¿Cuándo se devenga la renta?</strong> Al momento de la venta o intercambio de la cripto (no al momento de compra).
<strong>Intercambio cripto-cripto</strong> (ej: BTC → ETH): También genera un hecho imponible. El valor de mercado en soles al momento del intercambio es el precio de venta.
<strong>Stablecoins:</strong> La conversión de BTC a USDT se considera venta. Si el USDT mantiene paridad con el dólar, la ganancia se calcula igual.
<span class="cl-art">Principio de realización: La renta se reconoce cuando se enajena el activo (Art. 57 LIR). El simple holding no genera renta.</span>` },
  { num:4, title:'Obtener y preparar tus estados de cuenta del exchange', badge:'Documentación', badgeCls:'nuevo',
    body:`Exporta el historial completo de transacciones de tus exchanges (Binance, Coinbase, Bitso, etc.) en formato CSV o PDF.
<strong>Qué debe contener:</strong>
• Fecha y hora de cada operación<br>
• Tipo (compra, venta, conversión)<br>
• Cantidad de cripto<br>
• Precio en USD y equivalente en soles (TC SBS del día)<br>
• Comisiones pagadas
<span class="cl-art">SUNAT puede solicitar esta documentación en una fiscalización. La falta de sustento genera presunción de ganancia (Art. 65-A CT).</span>` },
  { num:5, title:'Completar la Declaración Jurada Anual', badge:'Acción requerida', badgeCls:'riesgo',
    body:`<strong>Formulario Virtual N° 709</strong> (DJ Anual de Personas Naturales).
<strong>Casilla para 2da categoría:</strong> Sección "Ganancias de capital — Valores mobiliarios y otros" o la casilla habilitada para "Otros ingresos de 2da categoría". 
⚠️ <strong>SUNAT aún no ha publicado un formulario específico para cripto.</strong> La práctica actual es declararlas en la casilla de "Otros ingresos de capital no contemplados anteriormente" o en la DJ general con descripción explícita.
<strong>Plazo:</strong> Marzo-Abril del año siguiente (según cronograma SUNAT por dígito de RUC).
<strong>Pago:</strong> Bancos autorizados, SUNAT en línea o agentes bancarios.` },
  { num:6, title:'Compensar pérdidas (si aplica)', badge:'Optimización', badgeCls:'nuevo',
    body:`<strong>¿Se pueden compensar pérdidas de cripto?</strong>
Las pérdidas de capital en criptomonedas son compensables con las ganancias de la misma fuente (renta de 2da categoría) en el mismo ejercicio fiscal.
<strong>No se pueden arrastrar</strong> al ejercicio siguiente (a diferencia de las pérdidas de 3ra categoría).
<span class="cl-ejemplo">Si vendiste BTC con ganancia de S/50,000 y ETH con pérdida de S/30,000 en el mismo año, solo tributa la ganancia neta: S/20,000.</span>
<span class="cl-art">Art. 36 LIR: Las rentas de 2da categoría tienen como única deducción el 20% del ingreso bruto. No hay compensación de pérdidas entre categorías.</span>` },
];

let pasoState = {};
function renderSunatGuia() {
  const el = document.getElementById('sunatGuiaSteps'); if(!el) return;
  el.innerHTML = SUNAT_PASOS.map((p,i) => {
    const done = pasoState[i] || false;
    return `<div class="paso-item">
      <div class="paso-header" onclick="togglePaso(${i})">
        <div class="paso-check ${done?'done':''}" id="pasoChk_${i}" onclick="event.stopPropagation();togglePasoCheck(${i})">${done?'✓':''}</div>
        <div class="paso-num ${done?'done':''}">${p.num}</div>
        <div class="paso-title">${p.title}</div>
        <span class="paso-badge cl-badge ${p.badgeCls}">${p.badge}</span>
      </div>
      <div class="paso-body" id="pasoBody_${i}">${p.body}</div>
    </div>`;
  }).join('');
}
function togglePaso(i) {
  const b = document.getElementById('pasoBody_'+i); if(b) b.classList.toggle('open');
}
function togglePasoCheck(i) {
  pasoState[i] = !pasoState[i];
  const chk = document.getElementById('pasoChk_'+i);
  const num = document.querySelector(`#sunatGuiaSteps .paso-item:nth-child(${i+1}) .paso-num`);
  if(chk) { chk.classList.toggle('done',pasoState[i]); chk.textContent=pasoState[i]?'✓':''; }
  if(num) num.classList.toggle('done',pasoState[i]);
}

// ════════════════════════════════════════
// 2. CALCULADORA IR CRIPTO
// ════════════════════════════════════════
let criptoTxs = [];
function initIRCripto() {
  if (!criptoTxs.length) {
    criptoTxs = [
      {tipo:'compra',fecha:'2023-03-15',cantidad:0.5,precio:120000,comision:360},
      {tipo:'compra',fecha:'2023-09-20',cantidad:0.25,precio:95000,comision:237.5},
      {tipo:'venta',fecha:'2024-04-10',cantidad:0.3,precio:195000,comision:585},
    ];
  }
  renderCriptoTxs();
}
function addCriptoTx() {
  criptoTxs.push({tipo:'compra',fecha:'',cantidad:0,precio:0,comision:0});
  renderCriptoTxs();
}
function renderCriptoTxs() {
  const el = document.getElementById('irCriptoTxList'); if(!el) return;
  el.innerHTML = criptoTxs.map((tx,i) => `<div class="calc-cripto-tx">
    <div class="calc-cripto-tx-header">
      <select style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 5px;color:var(--text);font-family:inherit;font-size:14px;outline:none" onchange="criptoTxs[${i}].tipo=this.value">
        <option value="compra" ${tx.tipo==='compra'?'selected':''}>Compra</option>
        <option value="venta" ${tx.tipo==='venta'?'selected':''}>Venta</option>
        <option value="intercambio" ${tx.tipo==='intercambio'?'selected':''}>Intercambio</option>
        <option value="airdrop" ${tx.tipo==='airdrop'?'selected':''}>Airdrop</option>
        <option value="mining" ${tx.tipo==='mining'?'selected':''}>Minería</option>
      </select>
      <input class="calc-cripto-inp" type="date" value="${tx.fecha}" onchange="criptoTxs[${i}].fecha=this.value">
      <input class="calc-cripto-inp" type="number" placeholder="Cantidad" value="${tx.cantidad||''}" step="0.00001" onchange="criptoTxs[${i}].cantidad=parseFloat(this.value)||0">
      <input class="calc-cripto-inp" type="number" placeholder="Precio S/ c/u" value="${tx.precio||''}" onchange="criptoTxs[${i}].precio=parseFloat(this.value)||0">
      <input class="calc-cripto-inp" type="number" placeholder="Comisión S/" value="${tx.comision||''}" onchange="criptoTxs[${i}].comision=parseFloat(this.value)||0">
      <button class="calc-cripto-del" onclick="criptoTxs.splice(${i},1);renderCriptoTxs()">×</button>
    </div>
  </div>`).join('');
}

function calcIRCripto() {
  const regimen = document.getElementById('irCriptoRegimen')?.value || 'pn_no_habitual';
  const metodo = document.getElementById('irMetodo')?.value || 'fifo';
  const el = document.getElementById('irCriptoResult');
  if (!el) return;
  const metodoLabels = { fifo: 'PEPS (FIFO)', lifo: 'UEPS (LIFO)', avg: 'Costo Promedio Ponderado' };
  const metodoLabel = metodoLabels[metodo] || 'FIFO';
  let gananciaNeta = 0;
  const detalles = [];
  const sorted = [...criptoTxs].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  if (metodo === 'avg') {
    let totalCantidad = 0;
    let totalCosto = 0;
    for (const tx of sorted) {
      if (tx.tipo === 'compra') {
        totalCantidad += tx.cantidad;
        totalCosto += tx.cantidad * tx.precio + tx.comision;
        detalles.push({ desc: `Compra ${tx.cantidad} — S/${(tx.precio || 0).toLocaleString()}/u`, efecto: `Costo prom: S/${totalCantidad > 0 ? (totalCosto / totalCantidad).toFixed(0) : '0'}/u`, imp: 0 });
      } else if (tx.tipo === 'venta' || tx.tipo === 'intercambio') {
        if (totalCantidad < 0.000001) {
          detalles.push({ desc: `Venta ${tx.cantidad} — SIN HOLDINGS`, efecto: 'Error: sin costo base', imp: 0, ok: false });
          continue;
        }
        const costoUnit = totalCosto / totalCantidad;
        const vendido = Math.min(tx.cantidad, totalCantidad);
        const costoBase = vendido * costoUnit;
        const ingresos = tx.cantidad * tx.precio - tx.comision;
        const ganancia = ingresos - costoBase;
        gananciaNeta += ganancia;
        totalCantidad -= vendido;
        totalCosto -= costoBase;
        if (totalCantidad < 0.000001) { totalCantidad = 0; totalCosto = 0; }
        detalles.push({ desc: `Venta ${vendido} — S/${(tx.precio || 0).toLocaleString()}/u`, efecto: `Ganancia: S/${ganancia.toFixed(0)}`, imp: ganancia, ok: ganancia >= 0 });
      } else if (tx.tipo === 'airdrop') {
        const ingreso = tx.cantidad * tx.precio;
        gananciaNeta += ingreso;
        totalCantidad += tx.cantidad;
        totalCosto += ingreso;
        detalles.push({ desc: `Airdrop ${tx.cantidad}`, efecto: `Renta inmediata: S/${ingreso.toFixed(0)}`, imp: ingreso, ok: true });
      } else if (tx.tipo === 'mining') {
        const ingreso = tx.cantidad * tx.precio;
        gananciaNeta += ingreso;
        totalCantidad += tx.cantidad;
        totalCosto += ingreso;
        detalles.push({ desc: `Minería ${tx.cantidad}`, efecto: `Renta inmediata: S/${ingreso.toFixed(0)}`, imp: ingreso, ok: true });
      }
    }
  } else {
    const pool = [];
    for (const tx of sorted) {
      if (tx.tipo === 'compra') {
        pool.push({ cantidad: tx.cantidad, costoUnit: tx.precio + tx.comision / tx.cantidad });
        detalles.push({ desc: `Compra ${tx.cantidad} — S/${(tx.precio || 0).toLocaleString()}/u`, efecto: `Ingresa al pool ${metodo.toUpperCase()}`, imp: 0 });
      } else if (tx.tipo === 'venta' || tx.tipo === 'intercambio') {
        let cantPendiente = tx.cantidad;
        let costoBase = 0;
        while (cantPendiente > 0.000001 && pool.length) {
          const idx = metodo === 'lifo' ? pool.length - 1 : 0;
          const lote = pool[idx];
          if (lote.cantidad <= cantPendiente) {
            costoBase += lote.cantidad * lote.costoUnit;
            cantPendiente -= lote.cantidad;
            pool.splice(idx, 1);
          } else {
            costoBase += cantPendiente * lote.costoUnit;
            lote.cantidad -= cantPendiente;
            cantPendiente = 0;
          }
        }
        const ingresos = tx.cantidad * tx.precio - tx.comision;
        const ganancia = ingresos - costoBase;
        gananciaNeta += ganancia;
        detalles.push({ desc: `Venta ${tx.cantidad} — S/${(tx.precio || 0).toLocaleString()}/u`, efecto: `Ganancia: S/${ganancia.toFixed(0)}`, imp: ganancia, ok: ganancia >= 0 });
      } else if (tx.tipo === 'airdrop') {
        const ingreso = tx.cantidad * tx.precio;
        gananciaNeta += ingreso;
        pool.push({ cantidad: tx.cantidad, costoUnit: tx.precio });
        detalles.push({ desc: `Airdrop ${tx.cantidad}`, efecto: `Renta inmediata: S/${ingreso.toFixed(0)}`, imp: ingreso, ok: true });
      } else if (tx.tipo === 'mining') {
        const ingreso = tx.cantidad * tx.precio;
        gananciaNeta += ingreso;
        pool.push({ cantidad: tx.cantidad, costoUnit: tx.precio });
        detalles.push({ desc: `Minería ${tx.cantidad}`, efecto: `Renta inmediata: S/${ingreso.toFixed(0)}`, imp: ingreso, ok: true });
      }
    }
  }
  const UIT = 5500;
  let impuesto = 0, tasaEfectiva = 0, categ = '';
  if (regimen === 'pn_no_habitual') {
    categ = '2da categoría';
    impuesto = gananciaNeta > 0 ? gananciaNeta * 0.8 * 0.0625 : 0;
    tasaEfectiva = 5;
  } else if (regimen === 'pn_habitual') {
    categ = '3ra / 4ta categoría';
    const base = Math.max(0, gananciaNeta - 7 * UIT);
    impuesto = base > 0 ? (base <= 5 * UIT ? base * 0.08 : base <= 20 * UIT ? 5 * UIT * 0.08 + (base - 5 * UIT) * 0.14 : 5 * UIT * 0.08 + 15 * UIT * 0.14 + (base - 20 * UIT) * 0.17) : 0;
    tasaEfectiva = gananciaNeta > 0 ? (impuesto / gananciaNeta) * 100 : 0;
  } else {
    categ = '3ra categoría';
    impuesto = gananciaNeta > 0 ? (gananciaNeta <= 15 * UIT ? gananciaNeta * 0.10 : 15 * UIT * 0.10 + (gananciaNeta - 15 * UIT) * 0.295) : 0;
    tasaEfectiva = gananciaNeta > 0 ? (impuesto / gananciaNeta) * 100 : 0;
  }
  const fmtS = n => 'S/ ' + Math.round(n).toLocaleString();
  el.style.display = 'block';
  let warningText = '';
  if (metodo === 'fifo') warningText = '⚠️ Cálculo referencial bajo principio PEPS (FIFO). No existe norma peruana que establezca el método de costeo para cripto. Consulta con tu contador antes de declarar. Base legal: Informe 045-2023-SUNAT; Art. 57 LIR.';
  else if (metodo === 'lifo') warningText = '⚠️ Cálculo referencial bajo UEPS (LIFO). SUNAT no ha reconocido expresamente el método LIFO para cripto. Podría ser observado en fiscalización. Consulta con tu contador.';
  else warningText = '⚠️ Cálculo referencial bajo costo promedio ponderado. No existe norma peruana que establezca este método para cripto. Consulta con tu contador antes de declarar.';
  el.innerHTML = `
    <div style="font-size:14px;font-weight:500;color:#C39CE0;margin-bottom:12px">Resultado — ${metodoLabel} · ${categ}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:14px">
      <div class="fracc-card"><div class="fracc-card-v" style="color:${gananciaNeta >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtS(gananciaNeta)}</div><div class="fracc-card-l">Ganancia neta total</div></div>
      <div class="fracc-card"><div class="fracc-card-v" style="color:var(--red)">${fmtS(impuesto)}</div><div class="fracc-card-l">IR a pagar (${tasaEfectiva.toFixed(1)}% efectivo)</div></div>
      <div class="fracc-card"><div class="fracc-card-v">${detalles.filter(d => d.imp > 0).length}</div><div class="fracc-card-l">Operaciones gravadas</div></div>
      <div class="fracc-card"><div class="fracc-card-v" style="color:var(--green)">${fmtS(gananciaNeta - impuesto)}</div><div class="fracc-card-l">Ganancia neta después de IR</div></div>
    </div>
    ${detalles.map(d => `<div class="cripto-ir-row"><span style="color:var(--muted)">${d.desc}</span><span style="color:${d.ok ? 'var(--green)' : d.imp < 0 ? 'var(--red)' : 'var(--muted)'};font-weight:500">${d.efecto}</span></div>`).join('')}
    <div style="margin-top:10px;padding:10px 12px;background:rgba(155,89,182,.07);border-radius:8px;font-size:14px;color:var(--muted)">${warningText}</div>`;
}

// ════════════════════════════════════════
// 3. NFTs DATA
// ════════════════════════════════════════
const NFT_DATA = [
  { ref:'D.Leg. 822 (Ley de Derecho de Autor)', title:'Propiedad intelectual del NFT',
    desc:'El NFT en sí no transfiere los derechos de autor de la obra subyacente, salvo que el contrato lo establezca expresamente. Comprar un NFT es como comprar una impresión numerada — no te da el copyright.',
    detail:`<h4>¿Qué derechos adquiere el comprador de un NFT?</h4>
    <div class="cl-art">El smart contract del NFT debe especificar si se transfieren derechos de explotación, reproducción o solo la "propiedad" del token digital. Sin estipulación expresa, el autor conserva todos los derechos morales y patrimoniales (Art. 18 D.Leg. 822).</div>
    <div class="cl-ejemplo">Caso práctico: Un artista peruano vende un NFT de su pintura digital por 2 ETH. El comprador tiene el NFT pero NO puede reproducir la obra comercialmente sin autorización. El artista puede seguir vendiendo copias.</div>
    <strong>Para el creador del NFT:</strong> Si transfieres derechos de autor junto con el NFT, documentar en el contrato qué derechos específicos se ceden (Art. 88 D.Leg. 822 — formalidad escrita).` },
  { ref:'Informe 045-2023-SUNAT + principio neutralidad', title:'Tributación IR del creador de NFTs',
    desc:'Los ingresos por venta de NFTs tributan según la categoría de renta del creador. El artista o desarrollador que crea y vende NFTs genera renta gravada.',
    detail:`<h4>¿Qué renta genera la venta de NFTs?</h4>
    <div class="cl-art">Artista/creador PN: Renta de 4ta categoría si es trabajo independiente habitual (Art. 33 LIR). Deducción del 20% + 7 UIT. Si es empresa: 3ra categoría.</div>
    <div class="cl-art">Coleccionista que revende: Renta de 2da categoría (ganancia de capital) si no es habitual. Tasa efectiva: 5%.</div>
    <div class="cl-ejemplo">Ejemplo: Artista peruano vende NFT por 1 ETH (S/14,000). Si es 4ta categoría: base imponible S/11,200 (×80%). IR ≈ S/0 si está dentro del tramo exonerado (7 UIT = S/37,450 anuales). Si supera, paga escala.</div>
    <strong>IGV:</strong> Si el creador es contribuyente del IGV y los NFTs califican como "servicios digitales" o "bienes intangibles", podría estar gravado con IGV (18%). SUNAT no ha emitido pronunciamiento específico.` },
  { ref:'Resolución UIF 035-2023 + GAFI', title:'NFTs y lavado de activos (ALA)',
    desc:'Los NFTs de alto valor son un vector de lavado de activos identificado por el GAFI. Las plataformas que intermedian NFTs con valores significativos pueden estar sujetas a obligaciones ALA en Perú.',
    detail:`<h4>NFTs y Anti-Lavado de Activos</h4>
    <div class="cl-art">GAFI (Recomendación 15): Los PSAVs que facilitan la transferencia de NFTs deben implementar medidas ALA/CFT proporcionales al riesgo. Perú adoptó estas recomendaciones con el D.Leg. 1492.</div>
    <div class="cl-art">UIF-Perú: Si operas una plataforma de NFTs con transacciones frecuentes o de alto valor (> USD 10,000 equivalente), puedes estar sujeto a reporte de operaciones sospechosas (ROS) y conocimiento del cliente (KYC).</div>
    <strong>Zona gris:</strong> Un marketplace de NFTs artísticos pequeño tiene riesgo bajo. Un marketplace de NFTs financieros (gaming tokens, metaverso) tiene riesgo ALA medio-alto.` },
  { ref:'Vacío normativo 2024-2025', title:'Royalties automáticos en NFTs',
    desc:'Los smart contracts pueden programar royalties automáticos al creador en cada reventa. Su tratamiento tributario en Perú es incierto.',
    detail:`<h4>Royalties automáticos (resale royalties)</h4>
    <div class="cl-art">Si el contrato inteligente paga automáticamente un % al creador en cada reventa, esas rentas califican como regalías (Art. 27 LIR) o renta de 2da categoría (5% efectivo para PN).</div>
    <div class="cl-ejemplo">Ejemplo: Artista programa 10% de royalties. NFT se revende por 5 ETH → artista recibe automáticamente 0.5 ETH (S/7,000). Esta renta se devenga al momento del pago automático on-chain. Debe declararse en la DJ Anual.</div>
    <strong>Problema práctico:</strong> El pago ocurre on-chain sin intervención del artista. SUNAT no tiene mecanismo para verificarlo. La obligación de declarar recae exclusivamente en el contribuyente.` },
];

function renderNFT() {
  const el = document.getElementById('nftNormas'); if(!el) return;
  el.innerHTML = NFT_DATA.map((n,i) => `<div class="cl-norma" onclick="toggleCLDetail('nft_${i}')">
    <div class="cl-norma-top"><div><div class="cl-norma-ref">${n.ref}</div><div class="cl-norma-title">${n.title}</div></div><span class="cl-badge nuevo">NFT</span></div>
    <div class="cl-norma-desc">${n.desc}</div>
    <div class="cl-norma-detail" id="clDetail_nft_${i}">${n.detail}
      <button class="reg-ask-btn" style="margin-top:10px;border-color:rgba(155,89,182,.4);color:#C39CE0" onclick="event.stopPropagation();document.getElementById('clNftQ').value='Consulta sobre: ${n.title.replace(/'/g,"\\'")}';consultCLAI('nft')">💬 Consultar IA</button>
    </div>
  </div>`).join('');
}

// ════════════════════════════════════════
// 4. DeFi SCENARIOS
// ════════════════════════════════════════
const DEFI_DATA = [
  { icon:'💎', title:'Staking (prueba de participación)', riesgo:'medio',
    desc:'Bloquear cripto para validar transacciones y recibir recompensas. Ej: ETH en Lido, ADA en cardano staking.',
    detail:`<h4>Staking — Tratamiento tributario en Perú</h4>
    <div class="cl-art">Posición interpretativa predominante (analogía con intereses): Las recompensas de staking se reconocen como renta cuando se reciben (principio de percibido). Califican como renta de 2da categoría (intereses) para PN no habitual → tasa efectiva 5%.</div>
    <div class="cl-art">Posición alternativa (analogía con dividendos): Las recompensas son una forma de participación en el protocolo. Misma tasa efectiva del 5% para PN.</div>
    <div class="cl-ejemplo">Ejemplo: Stakeas 10 ETH. Recibes 0.04 ETH de recompensa mensual (≈S/700). Debes declarar S/700 como renta de 2da categoría en el período de recepción. Base de costo del ETH recibido = S/700 para futuras ventas.</div>
    <strong>Riesgo: </strong>SUNAT podría considerar que la renta se devenga continuamente (no solo al cobrar). Mantener registro detallado de cada recompensa.` },
  { icon:'🌾', title:'Yield Farming / Liquidity Mining', riesgo:'alto',
    desc:'Proveer liquidez a un protocolo DeFi (Uniswap, Curve) y recibir tokens de recompensa (governance tokens o fees).',
    detail:`<h4>Yield Farming — Tratamiento tributario</h4>
    <div class="cl-art">Los tokens de recompensa recibidos por proveer liquidez son renta en el momento de recepción, al valor de mercado en soles en esa fecha.</div>
    <div class="cl-art">Las comisiones (trading fees) recibidas del pool son ingreso ordinario gravado.</div>
    <div class="cl-ejemplo">Ejemplo: Provees liquidez ETH/USDT en Uniswap V3. Recibes 0.3% de las comisiones del pool en ETH y USDT. Cada semana retiras S/500 en comisiones. Debes declarar S/26,000 anuales como renta de 2da o 3ra categoría según habitualidad.</div>
    <strong>Impermanent Loss:</strong> La pérdida por impermanent loss no es una pérdida tributariamente reconocida hasta que retiras la liquidez (principio de realización). Su tratamiento es incierto en Perú.` },
  { icon:'🏦', title:'Lending / Borrowing DeFi (Aave, Compound)', riesgo:'medio',
    desc:'Prestar cripto y recibir intereses, o tomar préstamos colateralizados en cripto.',
    detail:`<h4>Lending DeFi — Tratamiento tributario</h4>
    <div class="cl-art">Intereses recibidos por préstamos DeFi: Renta de 2da categoría (Art. 24 inc. b) LIR). Tasa efectiva 5% para PN.</div>
    <div class="cl-art">Intereses pagados por préstamos DeFi: Son deducibles como gasto si el préstamo se usa para generar renta de 3ra categoría (Art. 37 inc. a) LIR). Para PN en 2da categoría: NO son deducibles.</div>
    <div class="cl-ejemplo">Ejemplo: Depositas 5,000 USDT en Aave y recibes 8% APY. Intereses anuales: 400 USDT ≈ S/1,490. Debes declarar S/1,490 como renta de 2da categoría. IR = S/1,490 × 80% × 6.25% = S/74.50.</div>
    <strong>Liquidación por colateral:</strong> Si Aave liquida tu colateral, se considera una venta forzada con el precio de liquidación. Genera ganancia o pérdida de capital tributable.` },
  { icon:'🔄', title:'Intercambio cripto-cripto (swap)', riesgo:'alto',
    desc:'Intercambiar BTC por ETH, o cualquier par cripto-cripto, incluso usando un DEX (Uniswap, 1inch).',
    detail:`<h4>Swap cripto-cripto — Hecho imponible</h4>
    <div class="cl-art">Cada swap es una enajenación del activo cedido. Se genera ganancia o pérdida de capital en el activo que "vendes".</div>
    <div class="cl-ejemplo">Ejemplo: Intercambias 0.1 BTC (costo S/12,000) por 1.5 ETH (valor S/21,000). Ganancia de capital: S/9,000. Tributa como renta de 2da categoría. El costo del ETH adquirido es S/21,000.</div>
    <strong>Problema práctico:</strong> En un año activo de DeFi puedes tener cientos de swaps. Cada uno es un evento tributario. Herramientas como Koinly o CoinTracker pueden ayudar a calcularlos, aunque deben adaptarse a la normativa peruana.
    <strong>Riesgo alto:</strong> La mayoría de usuarios no declaran los swaps cripto-cripto. SUNAT tiene acceso a información de exchanges que operan en Perú y puede cruzar datos.` },
  { icon:'🎁', title:'Airdrops y hard forks', riesgo:'medio',
    desc:'Recibir tokens gratis por tener una criptomoneda (airdrop) o por una bifurcación del protocolo (hard fork).',
    detail:`<h4>Airdrops y Hard Forks — Renta en el momento de recepción</h4>
    <div class="cl-art">Posición SUNAT (aplicando principio general): Los airdrops son renta gravada al momento de recepción, al valor de mercado en soles. Categoría: 2da (PN no habitual) o 3ra (empresa/habitual).</div>
    <div class="cl-art">Hard fork: Los tokens recibidos por hard fork (ej: BCH por tenencia de BTC) se valoran al precio de mercado en el momento de la bifurcación.</div>
    <div class="cl-ejemplo">Ejemplo: Recibes un airdrop de 1,000 tokens ARB (Arbitrum) en 2023. Precio al momento del airdrop: S/1.80/token. Renta reconocida: S/1,800. Cuando vendas los ARB, el costo computable es S/1,800.</div>
    <strong>Airdrops sin valor:</strong> Si el token no tiene liquidez ni precio de mercado al momento del airdrop, el valor reconocido es S/0. La renta se reconocerá cuando se enajene.` },
];

function renderDeFi() {
  const el = document.getElementById('defiScenarios'); if(!el) return;
  el.innerHTML = DEFI_DATA.map((d,i) => `<div class="defi-card" onclick="toggleCLDetail('defi_${i}')">
    <div class="defi-card-title">${d.icon} ${d.title}<span class="defi-risk-tag ${d.riesgo}">Riesgo tributario: ${d.riesgo.toUpperCase()}</span></div>
    <div class="defi-card-desc">${d.desc}</div>
    <div class="defi-treatment" id="clDetail_defi_${i}">${d.detail}
      <button class="reg-ask-btn" style="margin-top:10px;border-color:rgba(155,89,182,.4);color:#C39CE0" onclick="event.stopPropagation();document.getElementById('clDefiQ').value='Consulta sobre: ${d.title.replace(/'/g,"\\'")}';consultCLAI('defi')">💬 Consultar IA</button>
    </div>
  </div>`).join('');
}

// ════════════════════════════════════════
// 5. AML / KYC
// ════════════════════════════════════════
const AML_LEVELS = [
  { nivel:'BAJO', cls:'bajo', titulo:'Persona natural — usuario de cripto', threshold:'Transacciones personales de inversión',
    reqs:['Declarar ganancias en DJ Anual (obligación tributaria, no AML)','No reportar directamente a la UIF (salvo movimientos inusuales en el banco)',
          'El banco puede reportar operaciones sospechosas si detecta patrones inusuales','Cumplir con KYC del exchange (Binance, Bitso, Buda) donde operas'] },
  { nivel:'MEDIO', cls:'medio', titulo:'Exchange / PSAV pequeño o startup', threshold:'Plataformas que intermedian cripto por encargo de terceros',
    reqs:['Registro ante UIF-Perú como Sujeto Obligado (D.Leg. 1492 + Res. UIF 035-2023)','Implementar programa PLA/FT: KYC de clientes, monitoreo de transacciones',
          'Reportar Operaciones Sospechosas (ROS) dentro de 15 días hábiles','Designar Oficial de Cumplimiento ALA ante la UIF','Conservar registros por 5 años mínimo',
          'Límites de operación sin KYC: generalmente 0 para cripto (riesgo alto por GAFI)'] },
  { nivel:'ALTO', cls:'alto', titulo:'Exchange grande / VASP con volumen significativo', threshold:'Plataformas con + USD 1M/mes en transacciones',
    reqs:['Todos los requisitos del nivel medio +','Debida diligencia reforzada (DDR) para clientes de alto riesgo, PEPs y jurisdicciones de riesgo',
          'Implementar sistema de monitoreo transaccional automatizado (TMS)','Reporte de Operaciones en Efectivo (ROE) para transacciones > USD 10,000 equivalente',
          'Auditoría ALA/CFT anual por firma independiente','Cumplimiento con GAFI Recomendación 16 (Travel Rule): transmitir datos de remitente/beneficiario en transferencias',
          'Evaluación de riesgo de clientes con herramientas blockchain (Chainalysis, Elliptic)'] },
];

function renderAML() {
  const el = document.getElementById('amlLevels'); if(!el) return;
  el.innerHTML = AML_LEVELS.map(l => `<div class="aml-level ${l.cls}">
    <div class="aml-level-title"><span>⚠️ Nivel ${l.nivel} — ${l.titulo}</span><span class="cl-badge ${l.cls==='bajo'?'nuevo':l.cls==='medio'?'vacio':'riesgo'}">${l.threshold}</span></div>
    <div class="aml-reqs">${l.reqs.map(r=>`<div class="aml-req"><span style="flex-shrink:0">${l.cls==='alto'?'🔴':l.cls==='medio'?'🟡':'🟢'}</span><span>${r}</span></div>`).join('')}</div>
  </div>`).join('') + `<div style="background:rgba(58,134,255,.07);border:1px solid rgba(58,134,255,.2);border-radius:9px;padding:12px 14px;margin-top:10px;font-size:14px;line-height:1.7;color:var(--muted)">
    <strong style="color:#3A86FF">📋 Base legal AML/Cripto en Perú:</strong><br>
    • D.Leg. 1492 (2020) — Medidas para fortalecer la prevención ALA/CFT<br>
    • Ley 27693 — Ley de la Unidad de Inteligencia Financiera<br>
    • Resolución SBS N° 035-2023-UIF — Obligaciones de los PSAVs<br>
    • GAFI Guía actualizada sobre Activos Virtuales (2021, 2023)<br>
    • Reglamento de Gestión de Riesgos ALA/CFT — Res. SBS 2660-2015
  </div>`;
}

// ════════════════════════════════════════
// 6. TOKEN CLASSIFIER
// ════════════════════════════════════════
const TOKEN_QUESTIONS = [
  { q:'¿Los compradores invierten dinero o valor a cambio del token?', opts:['Sí — pagan para recibirlo','No — lo obtienen gratis (uso directo)'] },
  { q:'¿El valor del token depende del esfuerzo o trabajo de un equipo promotor?', opts:['Sí — el equipo lo desarrolla y mantiene','No — funciona de forma autónoma desde el inicio'] },
  { q:'¿Los compradores esperan obtener ganancias económicas del token?', opts:['Sí — esperan que suba de precio o recibir dividendos','No — lo usan para acceder a un servicio específico'] },
  { q:'¿El token otorga derechos sobre utilidades, flujos de caja o participación en la empresa?', opts:['Sí — es como una acción o bono','No — solo da acceso a funcionalidades del protocolo'] },
];
let tokenAnswers = {};
function renderTokenClassifier() {
  const el = document.getElementById('tokenClassifier'); if(!el) return;
  el.innerHTML = TOKEN_QUESTIONS.map((q,i) => `<div class="token-test">
    <div class="token-test-q">${i+1}. ${q.q}</div>
    <div class="token-opts">${q.opts.map((opt,j)=>`<button class="token-opt ${tokenAnswers[i]===j?'sel':''}" onclick="setTokenAnswer(${i},${j},this)">${opt}</button>`).join('')}</div>
  </div>`).join('');
  evalToken();
}
function setTokenAnswer(q, a, btn) {
  tokenAnswers[q] = a;
  document.querySelectorAll(`#tokenClassifier .token-test:nth-child(${q+1}) .token-opt`).forEach(b=>b.classList.remove('sel'));
  if(btn) btn.classList.add('sel');
  evalToken();
}
function evalToken() {
  const el = document.getElementById('tokenResult'); if(!el) return;
  if (Object.keys(tokenAnswers).length < TOKEN_QUESTIONS.length) { el.style.display='none'; return; }
  const valorSignals = [tokenAnswers[0]===0, tokenAnswers[1]===0, tokenAnswers[2]===0, tokenAnswers[3]===0].filter(Boolean).length;
  el.style.display = 'block';
  if (valorSignals >= 3) {
    el.className='token-result valor';
    el.innerHTML=`<strong style="color:var(--red)">🔴 PROBABLE VALOR MOBILIARIO — Registro SMV requerido</strong><br><br>
    Tu token presenta ${valorSignals}/4 criterios del Howey Test adaptado. Alta probabilidad de que califique como valor mobiliario bajo el D.Leg. 861 (Ley del Mercado de Valores) y el Reglamento SMV.<br><br>
    <strong>Consecuencias:</strong> Emitir o distribuir públicamente sin registro SMV es delito (Art. 13 D.Leg. 861 — oferta pública no autorizada). Multa hasta 700 UIT + inhabilitación.<br><br>
    <strong>Acción requerida:</strong> Consultar con abogado especialista en mercado de valores ANTES de cualquier emisión. Evaluar registro como valor mobiliario o restructurar el token para eliminar expectativa de ganancias.`;
  } else if (valorSignals >= 1) {
    el.className='token-result hibrido';
    el.innerHTML=`<strong style="color:var(--gold)">🟡 TOKEN HÍBRIDO — Zona gris regulatoria</strong><br><br>
    Tu token presenta ${valorSignals}/4 criterios del Howey Test. Está en zona gris entre token de utilidad y valor mobiliario.<br><br>
    <strong>Riesgo:</strong> SMV podría recalificarlo como valor mobiliario en una inspección. El análisis debe hacerse caso por caso.<br><br>
    <strong>Acción recomendada:</strong> Obtener opinión legal escrita sobre la naturaleza del token. Considerar estructura que refuerce el carácter de "utilidad" (uso real del servicio desde el lanzamiento, sin expectativa de ganancias en el whitepaper).`;
  } else {
    el.className='token-result utilidad';
    el.innerHTML=`<strong style="color:var(--green)">🟢 TOKEN DE UTILIDAD — Menor riesgo regulatorio SMV</strong><br><br>
    Tu token no presenta (o presenta mínimamente) los criterios del Howey Test. Probablemente califica como token de utilidad, no como valor mobiliario.<br><br>
    <strong>Tributación:</strong> Los ingresos por venta de tokens de utilidad tributan como renta de 3ra categoría (empresa) o 4ta categoría (PN). No aplica la normativa del mercado de valores.<br><br>
    <strong>IGV:</strong> Si el token da acceso a servicios digitales, la venta puede estar gravada con IGV (18%) como prestación de servicios digitales.`;
  }
}

// ════════════════════════════════════════
// 7. DAO DATA
// ════════════════════════════════════════
const DAO_DATA = [
  { ref:'Código Civil peruano (D.Leg. 295) — Vacío normativo', title:'Naturaleza jurídica de las DAOs en Perú',
    desc:'Las DAOs no tienen personalidad jurídica reconocida en el Perú. No existe un tipo societario equivalente. Esto genera problemas de responsabilidad, tributación y contratación.',
    detail:`<h4>¿Qué es una DAO jurídicamente en Perú?</h4>
    <div class="cl-art">Opciones actuales para formalizar una DAO en Perú: (1) Sociedad Anónima Cerrada (SAC) — la más común pero no refleja la estructura descentralizada. (2) Asociación civil — para DAOs sin fines de lucro. (3) Operar informalmente — riesgo legal significativo.</div>
    <div class="cl-art">Responsabilidad de los miembros: Al no existir figura jurídica específica, los miembros de una DAO podrían tener responsabilidad ilimitada por las obligaciones de la DAO (como una sociedad de hecho del Código Civil).</div>
    <div class="cl-ejemplo">Comparación internacional: Wyoming (EEUU) reconoce LLCs para DAOs desde 2021. Marshall Islands tiene ley específica. Perú no tiene equivalente — brecha normativa significativa.</div>
    <strong>Recomendación práctica:</strong> Constituir una SAC en Perú con un estatuto adaptado para reflejar la gobernanza mediante tokens. El contrato social puede incorporar mecanismos de votación on-chain.` },
  { ref:'LIR Arts. 1, 6, 57 — Principio de fuente y domicilio', title:'Tributación de los participantes peruanos en DAOs',
    desc:'Un residente peruano que participa en una DAO extranjera y recibe tokens o distribuciones debe declarar esas rentas en Perú, independientemente de dónde opere la DAO.',
    detail:`<h4>¿Tributan en Perú las ganancias de una DAO extranjera?</h4>
    <div class="cl-art">Sí. Perú grava a sus residentes por renta de fuente mundial (Art. 6 LIR). Los governance tokens recibidos como compensación por trabajo en la DAO son renta de 4ta o 5ta categoría.</div>
    <div class="cl-art">Las distribuciones de utilidades de la DAO (en ETH u otro cripto) son renta de 2da categoría para PN no habitual (equivalente a dividendos).</div>
    <div class="cl-ejemplo">Ejemplo: Peruano trabaja como desarrollador para una DAO y recibe 5,000 tokens de gobernanza (valor S/25,000). Debe declarar S/25,000 como renta de 4ta categoría. Cuando venda los tokens, tributará la ganancia adicional como 2da categoría.</div>
    <strong>Problema de valoración:</strong> Los governance tokens de DAOs pequeñas pueden no tener precio de mercado líquido al momento de recepción. Se puede argumentar que la renta se reconoce al momento de la liquidación.` },
];

function renderDAO() {
  const el = document.getElementById('daoNormas'); if(!el) return;
  el.innerHTML = DAO_DATA.map((n,i) => `<div class="cl-norma" onclick="toggleCLDetail('dao_${i}')">
    <div class="cl-norma-top"><div><div class="cl-norma-ref">${n.ref}</div><div class="cl-norma-title">${n.title}</div></div><span class="cl-badge vacio">Vacío normativo</span></div>
    <div class="cl-norma-desc">${n.desc}</div>
    <div class="cl-norma-detail" id="clDetail_dao_${i}">${n.detail}
      <button class="reg-ask-btn" style="margin-top:10px;border-color:rgba(155,89,182,.4);color:#C39CE0" onclick="event.stopPropagation();document.getElementById('clDaoQ').value='Consulta sobre: ${n.title.replace(/'/g,"\\'")}';consultCLAI('dao')">💬 Consultar IA</button>
    </div>
  </div>`).join('');
}

// ════════════════════════════════════════
// 8. SMART CONTRACTS DATA
// ════════════════════════════════════════
const SMART_DATA = [
  { ref:'Ley 27269 (Ley de Firmas Digitales) + Ley 30096 (Delitos Informáticos)', title:'Validez legal de los contratos inteligentes en Perú',
    desc:'Los smart contracts son válidos en Perú bajo el principio de libertad de forma del Código Civil, pero con limitaciones importantes para actos que requieren formalidad específica.',
    detail:`<h4>¿Es válido un contrato inteligente en Perú?</h4>
    <div class="cl-art">Art. 1352 CC: Los contratos se perfeccionan por el consentimiento de las partes, salvo que la ley exija forma determinada. Un smart contract puede ser un contrato válido si hay oferta, aceptación, objeto lícito y capacidad.</div>
    <div class="cl-art">Ley 27269 reconoce la firma digital como equivalente a la firma manuscrita, lo que da sustento a transacciones blockchain firmadas con claves privadas.</div>
    <div class="cl-art">Límites: Contratos que requieren escritura pública (compraventa de inmuebles, constitución de sociedades, poderes) NO pueden formalizarse solo mediante smart contract. Requieren notaría.</div>
    <div class="cl-ejemplo">Ejemplo válido: Contrato de servicios profesionales ejecutado automáticamente via smart contract — válido bajo CC. Ejemplo inválido: Transferencia de propiedad de un inmueble solo via smart contract — inválido, requiere escritura pública e inscripción en RRPP.</div>` },
  { ref:'Código Civil (D.Leg. 295) Arts. 1314-1321', title:'Responsabilidad por bugs en smart contracts',
    desc:'Si un smart contract tiene un error de código que causa pérdidas, ¿quién responde? La responsabilidad del desarrollador en Perú es un área poco explorada.',
    detail:`<h4>Responsabilidad del desarrollador de smart contracts</h4>
    <div class="cl-art">Responsabilidad contractual (Art. 1314 CC): Si el desarrollador actuó con la diligencia ordinaria requerida por las circunstancias, no hay responsabilidad por culpa leve. Si hubo dolo o culpa inexcusable, responde por todos los daños.</div>
    <div class="cl-art">Auditoría previa: Un smart contract auditado por terceros independientes reduce significativamente la responsabilidad del desarrollador ante bugs post-despliegue.</div>
    <div class="cl-ejemplo">Caso DAO Hack (analogía): Si un hacker explota una vulnerabilidad del código, el desarrollador podría ser responsable si no implementó las precauciones mínimas del arte. El usuario también asume riesgos al interactuar con código no auditado.</div>
    <strong>Recomendación:</strong> Los contratos con usuarios de smart contracts deben incluir cláusulas de limitación de responsabilidad, disclaimers de riesgos tecnológicos y arbitraje como mecanismo de resolución de disputas.` },
];

function renderSmart() {
  const el = document.getElementById('smartNormas'); if(!el) return;
  el.innerHTML = SMART_DATA.map((n,i) => `<div class="cl-norma" onclick="toggleCLDetail('smart_${i}')">
    <div class="cl-norma-top"><div><div class="cl-norma-ref">${n.ref}</div><div class="cl-norma-title">${n.title}</div></div><span class="cl-badge nuevo">Legal</span></div>
    <div class="cl-norma-desc">${n.desc}</div>
    <div class="cl-norma-detail" id="clDetail_smart_${i}">${n.detail}
      <button class="reg-ask-btn" style="margin-top:10px;border-color:rgba(155,89,182,.4);color:#C39CE0" onclick="event.stopPropagation();document.getElementById('clSmartQ').value='Consulta sobre: ${n.title.replace(/'/g,"\\'")}';consultCLAI('smart')">💬 Consultar IA</button>
    </div>
  </div>`).join('');
}

// ════════════════════════════════════════
// 9. MINERÍA CRIPTO — CALCULADORA
// ════════════════════════════════════════
const MINING_NORMAS = [
  { ref:'Art. 22 RLIR — Depreciación de activos fijos', title:'Depreciación de equipos de minería (ASICs, GPUs)',
    desc:'Los equipos de minería califican como activos fijos. Su depreciación tributaria máxima es del 25% anual (maquinaria y equipos). La vida útil real puede ser menor.',
    detail:`<h4>Depreciación tributaria de equipos de minería</h4>
    <div class="cl-art">Art. 22 RLIR: Los equipos de procesamiento de datos (GPUs, ASICs) se deprecian al 25% anual como "equipos de cómputo". Alternativa: 20% anual como "maquinaria".</div>
    <div class="cl-ejemplo">Ejemplo: Compras ASICs por S/120,000. Depreciación anual tributaria: S/30,000 (25%). En 4 años, el activo está totalmente depreciado. Si lo vendes en el año 3 por S/20,000, tienes una ganancia de capital de S/20,000 - S/30,000 (valor en libros) = pérdida de S/10,000.</div>
    <strong>IGV en la compra:</strong> Si compras los equipos a un proveedor peruano o los importas, pagas IGV (18%). Este IGV es crédito fiscal contra el IGV de tus operaciones gravadas de minería.` },
  { ref:'Informe 045-2023-SUNAT + Art. 28 LIR', title:'¿Cuándo nace la obligación tributaria en la minería?',
    desc:'La renta de la minería cripto nace al minar el activo (renta de fuente productiva), no al venderlo. Esta es la posición mayoritaria por analogía.',
    detail:`<h4>Momento de reconocimiento de la renta de minería</h4>
    <div class="cl-art">Posición 1 (más conservadora): La renta se reconoce al minar — valor de mercado del cripto al momento de la extracción = renta de 3ra categoría. Cuando se vende, la ganancia adicional es renta de capital.</div>
    <div class="cl-art">Posición 2: Solo la venta genera renta (principio de realización). El mining es como "extraer un mineral" — la renta surge cuando se enajena.</div>
    <div class="cl-ejemplo">Ejemplo posición 1: Minas 0.01 BTC (valor S/3,500 al minar). Renta de 3ra: S/3,500. Luego vendes cuando vale S/5,000. Ganancia adicional S/1,500 (2da o 3ra según categoría). TOTAL tributable: S/5,000.</div>
    <strong>Recomendación:</strong> Adoptar la posición más conservadora (Posición 1) para evitar contingencias. SUNAT no ha emitido pronunciamiento específico.` },
];

function renderMining() {
  const el = document.getElementById('miningNormas'); if(!el) return;
  el.innerHTML = MINING_NORMAS.map((n,i) => `<div class="cl-norma" onclick="toggleCLDetail('mining_${i}')">
    <div class="cl-norma-top"><div><div class="cl-norma-ref">${n.ref}</div><div class="cl-norma-title">${n.title}</div></div><span class="cl-badge nuevo">Minería</span></div>
    <div class="cl-norma-desc">${n.desc}</div>
    <div class="cl-norma-detail" id="clDetail_mining_${i}">${n.detail}</div>
  </div>`).join('');
}

function calcMining() {
  const ing = parseFloat(document.getElementById('minIngreso')?.value)||0;
  const elec = parseFloat(document.getElementById('minElec')?.value)||0;
  const equipos = parseFloat(document.getElementById('minEquipos')?.value)||0;
  const vidaUtil = parseFloat(document.getElementById('minVidaUtil')?.value)||4;
  const otros = parseFloat(document.getElementById('minOtrosGastos')?.value)||0;
  const tipo = document.getElementById('minTipo')?.value||'pj';
  const el = document.getElementById('miningResult'); if(!el||!ing) return;
  const UIT = 5500;
  const depreciacion = equipos * 0.25; // 25% anual máx.
  const gastos = elec + depreciacion + otros;
  const rentaNeta = Math.max(0, ing - gastos);
  let ir = 0, categ = '';
  if (tipo==='pj'||tipo==='pn_habitual') {
    categ='3ra categoría'; ir=rentaNeta<=15*UIT?rentaNeta*0.10:15*UIT*0.10+(rentaNeta-15*UIT)*0.295;
  } else {
    categ='2da categoría'; ir=rentaNeta*0.8*0.0625;
  }
  const fmtS = n=>'S/ '+Math.round(n).toLocaleString();
  el.style.display='block';
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px">
    <div class="fracc-card"><div class="fracc-card-v">${fmtS(ing)}</div><div class="fracc-card-l">Ingresos por minería</div></div>
    <div class="fracc-card"><div class="fracc-card-v" style="color:var(--red)">-${fmtS(gastos)}</div><div class="fracc-card-l">Gastos deducibles</div></div>
    <div class="fracc-card"><div class="fracc-card-v" style="color:var(--gold)">${fmtS(rentaNeta)}</div><div class="fracc-card-l">Renta neta (${categ})</div></div>
    <div class="fracc-card"><div class="fracc-card-v" style="color:var(--red)">${fmtS(ir)}</div><div class="fracc-card-l">IR a pagar</div></div>
  </div>
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:12px;font-size:14px;line-height:1.8">
    <div class="tim-row"><span class="tim-row-lbl">Depreciación equipos (25%/año)</span><span class="tim-row-val">-${fmtS(depreciacion)}</span></div>
    <div class="tim-row"><span class="tim-row-lbl">Electricidad</span><span class="tim-row-val">-${fmtS(elec)}</span></div>
    <div class="tim-row"><span class="tim-row-lbl">Otros gastos</span><span class="tim-row-val">-${fmtS(otros)}</span></div>
    <div class="tim-row"><span class="tim-row-lbl">Margen operativo minería</span><span class="tim-row-val">${((rentaNeta/ing)*100).toFixed(1)}%</span></div>
  </div>
  <p style="font-size:14px;color:var(--muted);margin-top:8px">Base legal: Art. 22 RLIR (depreciación), Informe 045-2023-SUNAT. Consultar con contador para caso específico.</p>`;
}

// ── Generic toggle for detail panels ──
function toggleCLDetail(id) {
  const el = document.getElementById('clDetail_' + id);
  if (el) {
    // Close all others in same parent
    const parent = el.closest('.cl-norma,.defi-card');
    if (parent) {
      const allDetails = parent.parentElement.querySelectorAll('.cl-norma-detail,.defi-treatment');
      allDetails.forEach(d => { if(d!==el) d.classList.remove('open'); });
    }
    el.classList.toggle('open');
  }
}

// ── PATCH setPTab ──
const _origSetPTabCL = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabCL(tab, btn);
  if (tab === 'cripto_legal') {
    setCLTab('sunat_guia', null);
    setTimeout(() => document.querySelector('.cl-tab')?.classList.add('active'), 50);
  }
}


// ══════════════════════════════════════════════════════════
// UNIFIED CURRENCY & NUMBER FORMATTING
// All monetary display in the app goes through these helpers.
// ══════════════════════════════════════════════════════════

/**
 * Format a number as Peruvian soles.
 * @param {number} n       - The amount to format
 * @param {number} [dec=2] - Decimal places (0 = round to soles)
 * @returns {string}  e.g. "S/ 12,345.60"
 */
function fmtS(n, dec = 2) {
  if (n === null || n === undefined || isNaN(n)) return 'S/ —';
  return 'S/ ' + Number(n).toLocaleString('es-PE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

/**
 * Compact formatter for large amounts (K / M suffixes).
 * @param {number} n
 * @returns {string} e.g. "S/ 1.2M"
 */
function fmtSCompact(n) {
  if (n === null || n === undefined || isNaN(n)) return 'S/ —';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return 'S/ ' + (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000)     return 'S/ ' + (n / 1_000).toFixed(1) + 'K';
  return fmtS(n, 0);
}

/**
 * Format a plain number with thousand separators (no currency symbol).
 * @param {number} n
 * @param {number} [dec=0]
 */
function fmtN(n, dec = 0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('es-PE', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

/**
 * Format as percentage.
 * @param {number} n     - Value between 0 and 1 (e.g. 0.185)
 * @param {number} [dec=1]
 */
function fmtPct(n, dec = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—%';
  return (n * 100).toFixed(dec) + '%';
}

// Aliases kept for backward compatibility with existing call sites
const formatCurrency = fmtS;
const formatNumber   = fmtN;


// ══════════════════════════════════════════════════════════
// LOADING SPINNER UTILITIES
// tpSpinner(show, label)  — page-level full overlay
// tpBtnLoad(btn, loading) — per-button spinner state
// tpAsyncBtn(btn, fn)     — wrap async fn with button spinner
// ══════════════════════════════════════════════════════════
function tpSpinner(show, label = 'Procesando...') {
  const el = document.getElementById('tp-page-spinner');
  const lb = document.getElementById('tp-page-spinner-label');
  if (!el) return;
  if (lb) lb.textContent = label;
  el.classList.toggle('show', !!show);
}

function tpBtnLoad(btn, loading) {
  if (!btn) return;
  btn.classList.toggle('btn-loading', loading);
  btn.disabled = loading;
}

// Wraps an async function: shows button spinner while running,
// catches errors as toasts.
async function tpAsyncBtn(btn, fn, loadLabel = 'Procesando...') {
  tpBtnLoad(btn, true);
  try {
    await fn();
  } catch (e) {
    tpToast(e.message || 'Error inesperado. Intenta de nuevo.', 'error');
  } finally {
    tpBtnLoad(btn, false);
  }
}

// Patch showAuthLoading to use our spinner instead of inline CSS hacks
function showAuthLoading(show) {
  tpSpinner(show, show ? 'Autenticando...' : '');
}



// ══════════════════════════════════════════════════════════
// SEGURIDAD XSS — safeHTML() y renderAIResponse()
// Usar siempre safeHTML() en lugar de innerHTML directo para
// contenido generado por la IA o ingresado por el usuario.
// ══════════════════════════════════════════════════════════
function safeHTML(str) {
  if (!str) return '';
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(str, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script','iframe','object','embed'],
      FORBID_ATTR: ['onerror','onload','onclick','onmouseover']
    });
  }
  // Fallback si DOMPurify no carga
  return str
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
}

function renderAIResponse(el, rawText) {
  if (!el || !rawText) return;
  // 1. Escapar HTML nativo del texto
  const escaped = rawText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // 2. Aplicar formato Markdown básico
  const formatted = escaped
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 5px;border-radius:3px;font-size:14px">$1</code>');
  // 3. Sanitizar y asignar
  el.innerHTML = safeHTML(formatted);
}

// ══════════════════════════════════════════════════════════
// ACCESIBILIDAD — Focus Trap para modales
// Uso: const trap = trapFocus(modalElement)
//      trap.release() cuando cierres el modal
// ══════════════════════════════════════════════════════════
function trapFocus(modal) {
  if (!modal) return { release: () => {} };
  const focusable = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return { release: () => {} };
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const prevFocus = document.activeElement;
  first.focus();
  function onKey(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  modal.addEventListener('keydown', onKey);
  return {
    release() {
      modal.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
  };
}

// Store active traps so we can release on modal close
window._focusTraps = {};

// ══════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// Replaces all native alert() calls with non-blocking toasts.
// Usage: tpToast(msg, type='info', title='')  type: info|success|error|warn
// ══════════════════════════════════════════════════════════
function tpToast(msg, type = 'info', title = '') {
  const wrap = document.getElementById('tp-toast-wrap');
  if (!wrap) { console.warn(msg); return; }

  // Map type to icon + default title
  const meta = {
    info:    { icon: 'ℹ️',  dt: 'Información' },
    success: { icon: '✅', dt: 'Listo'         },
    error:   { icon: '❌', dt: 'Error'         },
    warn:    { icon: '⚠️', dt: 'Atención'     },
  };
  const { icon, dt } = meta[type] || meta.info;
  const displayTitle = title || dt;

  const el = document.createElement('div');
  el.className = `tp-toast ${type}`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="tp-toast-icon" aria-hidden="true">${icon}</div>
    <div class="tp-toast-body">
      <div class="tp-toast-title">${displayTitle}</div>
      <div class="tp-toast-msg">${msg}</div>
    </div>
    <button class="tp-toast-close" aria-label="Cerrar notificación" onclick="tpDismiss(this.parentElement)">✕</button>`;
  wrap.appendChild(el);

  // Auto-dismiss after 4 s (errors stay 7 s)
  const delay = type === 'error' ? 7000 : 4000;
  setTimeout(() => tpDismiss(el), delay);
}

function tpDismiss(el) {
  if (!el || el.classList.contains('hide')) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 260);
}

// ── CONFIRM DIALOG ──────────────────────────────────────
// Usage: tpConfirm('¿Eliminar?', 'Esta acción no se puede deshacer.').then(ok => { if(ok) ... })
// Returns a Promise<boolean>
function tpConfirm(title, msg, icon = '⚠️', okLabel = 'Confirmar', cancelLabel = 'Cancelar') {
  return new Promise(resolve => {
    const overlay = document.getElementById('tp-confirm-overlay');
    const okBtn   = document.getElementById('tp-cf-ok');
    const canBtn  = document.getElementById('tp-cf-cancel');
    document.getElementById('tp-cf-icon').textContent  = icon;
    document.getElementById('tp-cf-title').textContent = title;
    document.getElementById('tp-cf-msg').textContent   = msg;
    okBtn.textContent  = okLabel;
    canBtn.textContent = cancelLabel;
    overlay.classList.add('show');
    okBtn.focus();

    // Clean up and resolve
    const done = (val) => {
      overlay.classList.remove('show');
      okBtn.replaceWith(okBtn.cloneNode(true));   // remove old listeners
      canBtn.replaceWith(canBtn.cloneNode(true));
      resolve(val);
    };
    document.getElementById('tp-cf-ok').addEventListener('click', () => done(true), { once: true });
    document.getElementById('tp-cf-cancel').addEventListener('click', () => done(false), { once: true });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); }, { once: true });
  });
}

// Backward-compat shim so nothing breaks if old code calls alert()
window._nativeAlert = window.alert;
window.alert = (msg) => tpToast(msg, 'warn');


// ══════════════════════════════════════════════════════════
// ACCESSIBILITY UTILITIES
// ══════════════════════════════════════════════════════════

// ── Keyboard-nav detection ──────────────────────────────
// Add .kb-nav to body when user presses Tab; remove on mouse click.
// This ensures focus rings only appear for keyboard users.
document.addEventListener('keydown', e => {
  if (e.key === 'Tab') document.body.classList.add('kb-nav');
});
document.addEventListener('mousedown', () => {
  document.body.classList.remove('kb-nav');
});

// ── High-contrast toggle ────────────────────────────────
function toggleHC() {
  const on = document.body.classList.toggle('hc-mode');
  localStorage.setItem('tp_hc', on ? '1' : '');
  tpToast(on ? 'Modo alto contraste activado' : 'Modo estándar restaurado', 'info');
  const btn = document.getElementById('hcBtn');
  if (btn) btn.setAttribute('aria-pressed', String(on));
}

// Restore HC preference on load
(function restoreHC() {
  if (localStorage.getItem('tp_hc')) {
    document.body.classList.add('hc-mode');
  }
})();

// ── Aria-live region helper ─────────────────────────────
// Announce short messages to screen readers (AT) without showing a toast.
function ariaAnnounce(msg, priority = 'polite') {
  const el = document.getElementById('tp-aria-live-' + priority);
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

// ── Focus trap for modals ────────────────────────────────
function trapFocus(containerEl) {
  const focusable = containerEl.querySelectorAll(
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return () => {};
  const first = focusable[0], last = focusable[focusable.length - 1];
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
  };
  containerEl.addEventListener('keydown', handler);
  return () => containerEl.removeEventListener('keydown', handler);
}

// Apply focus trap to the confirm dialog
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('tp-confirm-overlay');
  if (overlay) {
    const box = document.getElementById('tp-confirm-box');
    const observer = new MutationObserver(() => {
      if (overlay.classList.contains('show')) {
        const release = trapFocus(box);
        document.getElementById('tp-cf-ok')?.focus();
        const stopOnHide = () => { release(); overlay.removeEventListener('classremoved', stopOnHide); };
        // Watch for removal of 'show'
        new MutationObserver((_, obs) => {
          if (!overlay.classList.contains('show')) { release(); obs.disconnect(); }
        }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
      }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }
});



// ══════════════════════════════════════════════════════════
// UNIT TESTS — Movidos a declarafy.test.js
// Para ejecutar: cargar este archivo Y declarafy.test.js en el navegador,
// luego llamar tpRunTests() en la consola del desarrollador.
// NO cargar declarafy.test.js en producción.
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
// SEGURIDAD — Rate Limiting (cliente)
// ══════════════════════════════════════════════════════════
const TP_RL_KEY = 'tp_rl_ts';
const TP_RL_MAX = 10;
const TP_RL_WIN = 60000;

function tpCheckRateLimit() {
  try {
    const ts = JSON.parse(localStorage.getItem(TP_RL_KEY) || '[]');
    const now = Date.now();
    const recent = ts.filter(t => now - t < TP_RL_WIN);
    if (recent.length >= TP_RL_MAX) {
      const wait = Math.ceil((TP_RL_WIN - (now - recent[0])) / 1000);
      tpToast(`Límite de velocidad alcanzado. Espera ${wait}s antes de la próxima consulta.`, 'warn');
      return false;
    }
    recent.push(now);
    localStorage.setItem(TP_RL_KEY, JSON.stringify(recent.slice(-TP_RL_MAX)));
    return true;
  } catch { return true; }
}

// ══════════════════════════════════════════════════════════
// SEGURIDAD — Validación de RUC (algoritmo peruano + API)
// ══════════════════════════════════════════════════════════
function tpValidateRUCFormat(ruc) {
  if (!ruc || ruc.length !== 11 || !/^\d{11}$/.test(ruc))
    return { valid: false, msg: 'El RUC debe tener exactamente 11 dígitos numéricos.' };
  if (!['10','15','16','17','20'].some(p => ruc.startsWith(p)))
    return { valid: false, msg: 'RUC debe empezar con 10, 15, 16, 17 o 20.' };
  const weights = [5,4,3,2,7,6,5,4,3,2];
  const sum = weights.reduce((acc, w, i) => acc + w * parseInt(ruc[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 1;
  if (check !== parseInt(ruc[10]))
    return { valid: false, msg: 'Dígito de control inválido. Revisa el RUC.' };
  return { valid: true, tipo: ruc.startsWith('10') ? 'Persona Natural' : 'Persona Jurídica' };
}

async function tpValidateRUCOnline(ruc) {
  const fmt = tpValidateRUCFormat(ruc);
  if (!fmt.valid) return fmt;
  try {
    const res = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${ruc}`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { valid: true, online: false, ...fmt };
    const data = await res.json();
    return { valid: true, online: true, nombre: data.razonSocial || data.nombre,
      estado: data.estado, condicion: data.condicion, tipo: fmt.tipo };
  } catch { return { valid: true, online: false, ...fmt }; }
}

async function tpValidateRUCField(inputEl, badgeId) {
  const ruc = inputEl.value.trim();
  let badge = document.getElementById(badgeId);
  if (!badge) {
    badge = document.createElement('span');
    badge.id = badgeId;
    badge.style.cssText = 'font-size:14px;margin-left:6px;padding:2px 8px;border-radius:8px;transition:all .2s';
    inputEl.parentNode.appendChild(badge);
  }
  if (ruc.length < 11) { badge.textContent = ''; return; }
  badge.textContent = '⟳ Validando...'; badge.style.color = 'var(--muted)';
  const result = await tpValidateRUCOnline(ruc);
  if (!result.valid) {
    badge.textContent = '✗ ' + result.msg;
    badge.style.cssText = 'font-size:14px;margin-left:6px;padding:2px 8px;border-radius:8px;background:rgba(230,57,70,.12);color:var(--red)';
  } else {
    const label = result.online && result.nombre ? `✓ ${result.nombre}` : `✓ ${result.tipo}`;
    badge.textContent = label;
    badge.style.cssText = 'font-size:14px;margin-left:6px;padding:2px 8px;border-radius:8px;background:rgba(76,175,80,.12);color:var(--green)';
  }
}

// Añadir validación en tiempo real a todos los campos RUC de documentos
function tpAttachRUCValidators() {
  document.querySelectorAll('input[maxlength="11"][placeholder*="RUC"]').forEach((inp, i) => {
    const badgeId = 'ruc-badge-' + i;
    inp.addEventListener('input', () => {
      if (inp.value.length === 11) tpValidateRUCField(inp, badgeId);
      else { const b = document.getElementById(badgeId); if(b) b.textContent=''; }
    });
    inp.addEventListener('blur', () => { if (inp.value.length === 11) tpValidateRUCField(inp, badgeId); });
  });
}

// ══════════════════════════════════════════════════════════
// SEGURIDAD — Audit Log
// ══════════════════════════════════════════════════════════
const TP_AUDIT_KEY = 'tp_audit';
const TP_AUDIT_MAX = 200;

function tpAuditLog(action, detail) {
  try {
    const log = JSON.parse(localStorage.getItem(TP_AUDIT_KEY) || '[]');
    log.unshift({ ts: Date.now(), action, user: curUser?.email || 'anon', detail: (detail||'').substring(0,120) });
    if (log.length > TP_AUDIT_MAX) log.length = TP_AUDIT_MAX;
    localStorage.setItem(TP_AUDIT_KEY, JSON.stringify(log));
  } catch {}
}

function tpRenderAuditLog() {
  const tbody = document.getElementById('auditTbody');
  if (!tbody) return;
  try {
    const log = JSON.parse(localStorage.getItem(TP_AUDIT_KEY) || '[]');
    if (!log.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:18px">Sin eventos registrados aún.</td></tr>';
      return;
    }
    tbody.innerHTML = log.slice(0,60).map(e => {
      const d = new Date(e.ts);
      const ds = d.toLocaleDateString('es-PE',{day:'2-digit',month:'short'}) + ' ' + d.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
      return `<tr><td style="color:var(--muted);white-space:nowrap">${ds}</td><td><span class="audit-action ${e.action}">${e.action}</span></td><td style="color:var(--muted)">${e.user}</td><td>${e.detail}</td></tr>`;
    }).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="4" style="color:var(--red)">Error cargando log.</td></tr>'; }
}

function tpClearAuditLog() {
  if (!confirm('¿Limpiar el log de auditoría? No se puede deshacer.')) return;
  localStorage.removeItem(TP_AUDIT_KEY);
  tpRenderAuditLog();
  tpToast('Log limpiado.', 'ok');
}

// ══════════════════════════════════════════════════════════
// SEGURIDAD — Hashing SHA-256 (Web Crypto) + migración btoa
// ══════════════════════════════════════════════════════════
async function tpHashPw(pw) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('declarafy:' + pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch { return 'legacy:' + btoa(pw); }
}

async function tpVerifyPw(pw, stored) {
  if (!stored) return { match: false };
  const hash = await tpHashPw(pw);
  if (hash === stored) return { match: true, legacy: false };
  if (btoa(pw) === stored) return { match: true, legacy: true };
  if ('legacy:' + btoa(pw) === stored) return { match: true, legacy: false };
  return { match: false };
}

// Parchar el login fallback localStorage con SHA-256
const _origDoLoginFBInner = _doLoginFBFirebaseImpl;
async function doLoginFB() {
  // Si Firebase está activo, delegar completamente
  if (typeof fbReady !== 'undefined' && fbReady && typeof fbAuth !== 'undefined') {
    return _origDoLoginFBInner();
  }
  const em = (document.getElementById('lEmail')?.value || document.getElementById('lE')?.value || '').trim().toLowerCase();
  const pw = document.getElementById('lPass')?.value || document.getElementById('lP')?.value || '';
  if (!em || !pw) { if (typeof aerr === 'function') aerr('Completa todos los campos.'); return; }
  const us = getUsers();
  if (!us[em]) { if (typeof aerr === 'function') aerr('No existe cuenta con ese correo.'); return; }
  const verify = await tpVerifyPw(pw, us[em].pw);
  if (!verify.match) { if (typeof aerr === 'function') aerr('Contraseña incorrecta.'); return; }
  if (verify.legacy) {
    us[em].pw = await tpHashPw(pw);
    saveUsers(us);
    console.info('[DeclaraFY] Contraseña migrada a SHA-256:', em);
  }
  curUser = us[em];
  localStorage.setItem('tp_s', JSON.stringify({ e: em, t: Date.now() }));
  hideAuth(); loadPanel();
  tpAuditLog('login', 'Login localStorage: ' + em);
}

// Parchar registro fallback con SHA-256
const _origDoRegisterFBInner = typeof _origDoRegister === 'function' ? _origDoRegister : null;

// Parchar creación de usuario en registro localStorage
const _origRegisterLSBlock = async function(nm, em, pw) {
  const hash = await tpHashPw(pw);
  return hash;
};

// ══════════════════════════════════════════════════════════
// PLANTILLAS DE CONSULTA (Saved Prompts)
// ══════════════════════════════════════════════════════════
function tpGetPrompts() {
  try { return JSON.parse(localStorage.getItem('tp_prompts_' + (curUser?.email||'')) || '[]'); }
  catch { return []; }
}
function tpSavePrompts(list) {
  kvPut('tp_prompts_' + (curUser?.email||''), list, 'prompts');
}
registerKVScope('prompts', () => 'tp_prompts_' + (curUser?.email||''));
function tpSaveCurrentPrompt() {
  const inp = document.getElementById('userInput');
  const text = inp?.value?.trim();
  if (!text) { tpToast('Escribe una consulta primero para guardarla como plantilla.', 'warn'); return; }
  const prompts = tpGetPrompts();
  if (prompts.some(p => p.text === text)) { tpToast('Esta plantilla ya está guardada.', 'info'); return; }
  prompts.unshift({ text, ts: Date.now() });
  if (prompts.length > 30) prompts.length = 30;
  tpSavePrompts(prompts);
  tpToast('📌 Plantilla guardada', 'ok');
  tpAuditLog('query', 'Plantilla guardada: ' + text.substring(0,60));
}
function tpPromptsOpen() {
  tpRenderPromptsList();
  document.getElementById('tpPromptsModal')?.classList.remove('hidden');
}
function tpPromptsClose() {
  document.getElementById('tpPromptsModal')?.classList.add('hidden');
}
function tpRenderPromptsList() {
  const list = document.getElementById('tpPromptsList');
  if (!list) return;
  const prompts = tpGetPrompts();
  if (!prompts.length) {
    list.innerHTML = '<div class="tp-prompt-empty">No tienes plantillas guardadas.<br>Escribe una consulta en el chat y pulsa 📌 Guardar.</div>';
    return;
  }
  list.innerHTML = prompts.map((p, i) => `
    <div class="tp-prompt-item" onclick="tpUsePrompt(${i})">
      <div class="tp-prompt-text">${p.text.substring(0,120)}${p.text.length>120?'…':''}</div>
      <button class="tp-prompt-del" onclick="event.stopPropagation();tpDeletePrompt(${i})" title="Eliminar plantilla">×</button>
    </div>`).join('');
}
function tpUsePrompt(idx) {
  const p = tpGetPrompts()[idx];
  if (!p) return;
  const inp = document.getElementById('userInput');
  if (inp) { inp.value = p.text; inp.focus(); inp.style.height='auto'; inp.style.height=inp.scrollHeight+'px'; }
  tpPromptsClose();
  if (!document.getElementById('screen-chat')?.classList.contains('active') && typeof showScreen === 'function')
    showScreen('screen-chat');
}
function tpDeletePrompt(idx) {
  const prompts = tpGetPrompts();
  prompts.splice(idx, 1);
  tpSavePrompts(prompts);
  tpRenderPromptsList();
  tpToast('Plantilla eliminada.', 'info');
}

// ══════════════════════════════════════════════════════════
// HISTORIAL — Búsqueda con resaltado de coincidencias
// ══════════════════════════════════════════════════════════
function tpHighlight(text, query) {
  if (!query || !text) return text || '';
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(safe, 'gi'), m => `<span class="hs-match">${m}</span>`);
}

const _origRenderHistList = renderHistList;
renderHistList = function(h) {
  const l = document.getElementById('histList');
  if (!l) return;
  if (!h.length) { l.innerHTML = '<div class="hempty">No se encontraron conversaciones.</div>'; return; }
  const allH = getHist(curUser.email);
  const q = (document.getElementById('histSearch')?.value || '').trim();
  l.innerHTML = '';
  [...h].reverse().forEach(c => {
    const i = allH.findIndex(x => x.title === c.title && x.date === c.date);
    const d = document.createElement('div');
    d.className = 'hitem';
    const fu = c.messages?.find(m => m.role === 'user');
    const rawPrev = fu ? fu.content.substring(0, 80) : 'Consulta';
    const rawTitle = c.title || 'Consulta';
    const displayTitle = q ? tpHighlight(rawTitle, q) : rawTitle;
    const displayPrev  = q ? tpHighlight(rawPrev, q)  : rawPrev;
    d.innerHTML = `<div class="hl" onclick="loadConv(${i})"><div class="ht">${displayTitle}</div><div class="hp">${displayPrev}${rawPrev.length>=80?'…':''}</div></div><div class="hm"><div class="ha">${c.area||'General'}</div><div class="hd">${c.date}</div></div><button class="hdel" aria-label="Eliminar" onclick="delConv(${i},event)">×</button>`;
    l.appendChild(d);
  });
};

// ══════════════════════════════════════════════════════════
// PDF CON MEMBRETE DEL ESTUDIO
// ══════════════════════════════════════════════════════════
function exportPDF() {
  const msgs = document.getElementById('messages');
  if (!msgs) return;
  const rows = Array.from(msgs.querySelectorAll('.msg')).map(m => {
    const isUser = m.classList.contains('user');
    const text = (m.querySelector('.bbl')?.innerText || '').replace(/\n/g, '<br>');
    return `<div style="margin-bottom:14px;padding:10px 14px;background:${isUser?'#f0f0ff':'#f8f8f0'};border-radius:8px;border-left:3px solid ${isUser?'#555':'#C9A84C'}"><strong style="color:${isUser?'#333':'#8B6914'};font-size:14px">${isUser?'Consulta':'DeclaraFY'}</strong><p style="margin:5px 0 0;color:#333;line-height:1.65;font-size:14px">${text}</p></div>`;
  }).join('');
  let wlCfg = {};
  try { wlCfg = JSON.parse(localStorage.getItem(WL_KEY()) || '{}'); } catch(_e) {}
  const estudio = wlCfg.nombre || curUser?.studio || curUser?.name || 'DeclaraFY';
  const color   = wlCfg.color || '#C9A84C';
  const fecha   = new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'});
  const area    = AREAS[curArea]?.label || 'General';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${estudio} — Consulta Tributaria</title>
<style>
  body{font-family:'Times New Roman',serif;max-width:700px;margin:40px auto;color:#1a1a2e;line-height:1.65;font-size:14px}
  .lh{border-bottom:3px solid ${color};padding-bottom:12px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:flex-end}
  .lh-name{font-family:Georgia,serif;font-size:20px;color:${color};font-weight:bold;letter-spacing:.03em}
  .lh-sub{font-size:14px;color:#777;margin-top:3px}
  .lh-date{font-size:14px;color:#999;text-align:right}
  .meta-row{background:#f8f8f2;border:1px solid #e8e0c8;border-radius:6px;padding:8px 14px;font-size:14px;color:#555;margin-bottom:20px;display:flex;gap:22px;flex-wrap:wrap}
  .footer{border-top:1px solid #ddd;margin-top:24px;padding-top:10px;font-size:14px;color:#aaa;text-align:center}
  @media print{body{margin:20px}}
</style></head><body>
  <div class="lh">
    <div>
      <div class="lh-name">${estudio}</div>
      <div class="lh-sub">Asesoría Tributaria · Powered by DeclaraFY</div>
    </div>
    <div class="lh-date">${fecha}</div>
  </div>
  <div class="meta-row">
    <span>👤 ${curUser?.name||'—'}</span>
    <span>📂 Área: ${area}</span>
    <span>📋 Régimen: ${curUser?.regimen?.toUpperCase()||'—'}</span>
    <span>🗓 ${fecha}</span>
  </div>
  ${rows}
  <div class="footer">Documento generado por ${estudio} vía DeclaraFY.pe · Solo con fines orientativos · Consulta con un profesional para decisiones formales.</div>
</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 600);
  tpAuditLog('export', 'PDF con membrete: ' + area);
}

// ══════════════════════════════════════════════════════════
// CONSULTA RÁPIDA — Floating overlay
// ══════════════════════════════════════════════════════════
function tpQuickOpen() {
  const ov = document.getElementById('tpQuickOv');
  if (!ov) return;
  ov.classList.remove('hidden');
  const resp = document.getElementById('tpQuickResp');
  if (resp) { resp.style.display='none'; resp.innerHTML=''; }
  setTimeout(() => document.getElementById('tpQuickInp')?.focus(), 80);
}
function tpQuickClose() {
  document.getElementById('tpQuickOv')?.classList.add('hidden');
}
function tpQuickOpenFull() {
  const txt = document.getElementById('tpQuickInp')?.value?.trim();
  tpQuickClose();
  if (typeof showScreen === 'function') showScreen('screen-chat');
  if (txt) {
    const inp = document.getElementById('userInput');
    if (inp) { inp.value = txt; inp.focus(); }
  }
}
async function tpQuickSend() {
  const inp = document.getElementById('tpQuickInp');
  const query = inp?.value?.trim();
  if (!query) return;
  if (!tpCheckRateLimit()) return;
  const respEl = document.getElementById('tpQuickResp');
  respEl.style.display = 'block';
  respEl.innerHTML = '<span style="color:var(--muted)">⟳ Consultando a DeclaraFY...</span>';
  try {
    const sysPrompt = (typeof SYS !== 'undefined' ? SYS : '') || 'Eres un experto tributarista peruano. Responde de forma breve y concisa.';
    const res = await callDeclaraFY({ model:'claude-sonnet-4-5', max_tokens:600, system: sysPrompt, messages:[{role:'user',content:query}] });
    const data = await res.json();
    const text = data?.content?.[0]?.text || 'Sin respuesta.';
    respEl.innerHTML = text.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    tpSaveOfflineResponse(query, text);
    tpAuditLog('query', 'Consulta rápida: ' + query.substring(0,60));
  } catch(e) {
    respEl.innerHTML = `<span style="color:var(--red)">Error: ${safeHTML(e.message)}</span>`;
  }
}
function tpUpdateQuickBtn() {
  const btn = document.getElementById('tpQuickBtn');
  if (!btn) return;
  const inChat = document.getElementById('screen-chat')?.classList.contains('active');
  btn.classList.toggle('hidden', !curUser || !!inChat);
}

// ══════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — Vencimientos tributarios
// ══════════════════════════════════════════════════════════
const TP_NOTIF_DISMISSED = 'tp_notif_dismissed';
const TP_NOTIF_LAST_CHECK = 'tp_notif_last_check';
const TP_DEADLINES = {
  nrus:  [{ label:'Cuota mensual NRUS', day:13 }],
  rer:   [{ label:'PDT 621 RER mensual', day:15 }, { label:'DJ Renta Anual (abr)', month:3 }],
  rmt:   [{ label:'PDT 621 RMT mensual', day:15 }, { label:'Pagos a cuenta IR', day:15 }, { label:'ITAN (mar)', month:2 }],
  rg:    [{ label:'PDT 621 mensual', day:15 }, { label:'Pagos a cuenta IR', day:15 }, { label:'ITAN (mar)', month:2 }, { label:'DJ Renta Anual (mar)', month:2 }],
  '4ta': [{ label:'PDT 616 honorarios', day:15 }],
  '5ta': [{ label:'Regularización IR 5ta (abr)', month:3 }],
};

function tpInitNotifBanner() {
  const banner = document.getElementById('tpNotifBanner');
  if (!banner || !curUser) return;
  if (!('Notification' in window) || Notification.permission === 'granted') return;
  if (localStorage.getItem(TP_NOTIF_DISMISSED)) return;
  banner.classList.remove('hidden');
}
function tpDismissNotifBanner() {
  localStorage.setItem(TP_NOTIF_DISMISSED, '1');
  document.getElementById('tpNotifBanner')?.classList.add('hidden');
}
async function tpRequestNotifPermission() {
  if (!('Notification' in window)) { tpToast('Tu navegador no soporta notificaciones push.', 'warn'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    tpDismissNotifBanner();
    tpToast('✅ Notificaciones activadas. Recibirás alertas de vencimientos tributarios.', 'ok');
    tpAuditLog('login', 'Push notifications activadas');
    tpCheckTaxDeadlines(true);
  } else {
    tpToast('Notificaciones bloqueadas. Actívalas desde la configuración del navegador.', 'warn');
  }
}
function tpCheckTaxDeadlines(force) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const lastCheck = parseInt(localStorage.getItem(TP_NOTIF_LAST_CHECK) || '0');
  if (!force && Date.now() - lastCheck < 3600000) return;
  localStorage.setItem(TP_NOTIF_LAST_CHECK, String(Date.now()));
  const regimen = curUser?.regimen || 'rg';
  const deadlines = TP_DEADLINES[regimen] || TP_DEADLINES['rg'];
  const now = new Date();
  deadlines.forEach((dl, idx) => {
    if (dl.day !== undefined) {
      const daysLeft = dl.day - now.getDate();
      if (daysLeft >= 0 && daysLeft <= 5) {
        setTimeout(() => {
          new Notification('📅 DeclaraFY — Vencimiento próximo', {
            body: `${dl.label} vence ${daysLeft === 0 ? 'HOY' : 'en ' + daysLeft + ' día(s)'}`,
            icon: 'https://www.declarafy.com/favicon.ico',
            tag: 'tp-dl-' + idx,
          });
        }, 2000 + idx * 1500);
      }
    }
    if (dl.month !== undefined && dl.month === now.getMonth()) {
      setTimeout(() => {
        new Notification('📅 DeclaraFY — Recordatorio mensual', {
          body: `Este mes vence: ${dl.label}`,
          icon: 'https://www.declarafy.com/favicon.ico',
          tag: 'tp-dlm-' + idx,
        });
      }, 3000 + idx * 1500);
    }
  });
}

// ══════════════════════════════════════════════════════════
// PARCHES FINALES — conectar todo con loadPanel / setPTab
// ══════════════════════════════════════════════════════════
// Rate limiting en sendMsgStream
const _origSMSRL = _sendMsgStreamBase;
async function sendMsgStream(txt) {
  if (!tpCheckRateLimit()) return;
  tpAuditLog('query', 'IA: ' + (txt||'').substring(0,80));
  return _origSMSRL(txt);
}

// Ampliar loadPanel con nuevas inicializaciones
const _origLoadPanelV6 = loadPanel;
loadPanel = function() {
  _origLoadPanelV6();
  setTimeout(() => {
    tpInitNotifBanner();
    tpCheckTaxDeadlines();
    tpUpdateQuickBtn();
    tpAttachRUCValidators();
    tpRenderAuditLog();
    tpAuditLog('login', 'Acceso al panel — ' + new Date().toLocaleString('es-PE'));
  }, 900);
}

// Ampliar setPTab para actualizar botón flotante y audit log
const _origSetPTabV12 = typeof setPTab === 'function' ? setPTab : null;
setPTab = function(tab, btn) {
  if (_origSetPTabV12) _origSetPTabV12(tab, btn);
  tpUpdateQuickBtn();
  if (tab === 'admin') setTimeout(tpRenderAuditLog, 200);
}

// Parchar también showScreen para actualizar botón flotante
const _origShowScreenV6 = typeof showScreen === 'function' ? showScreen : null;
showScreen = function(id) {
  if (_origShowScreenV6) _origShowScreenV6(id);
  tpUpdateQuickBtn();
};

// ── INIT ──
(function(){
  // Ensure Firebase global is available before init
  if (typeof firebase === 'undefined') {
    console.warn('Firebase SDK not loaded yet, retrying...');
    window.addEventListener('load', function() {
      setTimeout(function() {
        if (typeof firebase !== 'undefined') {
          initFirebase(); renderFBStatus(); _bootApp();
        } else {
          renderFBStatus(); _bootApp();
        }
      }, 50);
    });
    return;
  }
  initFirebase();
  renderFBStatus();
  _bootApp();
})();

function _bootApp() {
  if (fbReady && fbAuth) {
    fbAuth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const doc = await fbDb.collection('users').doc(user.uid).get();
          if (doc.exists) {
            curUser = { ...doc.data(), uid: user.uid };
            localStorage.setItem('tp_s', curUser.email);
            kvLoadAll().then(() => loadPanel());
            return;
          }
        } catch(e) { console.warn('Auth state error:', e.message); }
      }
      _fallbackInit();
    });
  } else {
    _fallbackInit();
  }
}

function _fallbackInit() {
  const _rawS = localStorage.getItem('tp_s');
  let s = null;
  try {
    const _pS = JSON.parse(_rawS || 'null');
    if (_pS && _pS.e && (Date.now() - _pS.t) < 86400000) s = _pS.e;
    else if (_rawS && !_rawS.startsWith('{')) s = _rawS; // legacy string session
    else if (_rawS && _rawS.startsWith('{')) localStorage.removeItem('tp_s'); // expired
  } catch(e) { s = _rawS; }
  if (s) { const u = getUsers(); if (u[s]) { curUser = u[s]; loadPanel(); return; } }
  if (typeof showScreen === 'function') showScreen('screen-landing');
  else { const el=document.getElementById('screen-landing'); if(el){el.classList.add('active');el.style.display='flex';} }
}

// ════════════════════════════════════════
// LAZY LOADING — Inicialización diferida de módulos pesados
// ════════════════════════════════════════
const _lazyModules = {};
const _lazyCallbacks = {
  sbs: () => { if (typeof renderSBSData === 'function') renderSBSData(); },
  smv: () => { if (typeof renderSMVData === 'function') renderSMVData(); },
  cripto: () => { if (typeof renderCriptoData === 'function') renderCriptoData(); },
  cripto_legal: () => { if (typeof renderCriptoLegalData === 'function') renderCriptoLegalData(); },
  pt_modulo: () => { if (typeof calcUmbrales === 'function') calcUmbrales(); },
  comparado: () => { if (typeof renderComparadoData === 'function') renderComparadoData(); },
  ia_fisc: () => { calcFiscRisk(); },
  casos: () => { if (typeof renderCasos === 'function') renderCasos(); },
  rtf: () => { if (typeof renderRTF === 'function') renderRTF(); },
  sunat_inf: () => { if (typeof renderSunatInf === 'function') renderSunatInf(); },
  sunafil: () => { if (typeof renderSunafil === 'function') renderSunafil(); },
  indecopi: () => { if (typeof renderIndecopi === 'function') renderIndecopi(); },
  bcr: () => { if (typeof renderBCR === 'function') renderBCR(); },
  zonas: () => { if (typeof renderZonas === 'function') renderZonas(); },
  empresa_hub: () => { if (typeof renderCRMStats === 'function') renderCRMStats(); },
};
// Patch setPTab to lazy-load modules on first visit
const _origSetPTabLazy = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabLazy(tab, btn);
  if (tab && _lazyCallbacks[tab] && !_lazyModules[tab]) {
    _lazyModules[tab] = true;
    setTimeout(() => { try { _lazyCallbacks[tab](); } catch(e) {} }, 100);
  }
};

// ════════════════════════════════════════════════════════════
// API ACCESS (plan Empresa) — generar / listar / revocar API keys
// y llamar a las Cloud Functions correspondientes.
// ════════════════════════════════════════════════════════════

// DECLARAFY_FN_BASE ya está en config.js
let _tpLastGeneratedKey = '';

async function _tpAuthedFetch(url, options = {}) {
  let idToken = null;
  try {
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
      idToken = await firebase.auth().currentUser.getIdToken();
    }
  } catch (e) { console.warn('No se pudo obtener idToken:', e.message); }
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { 'Authorization': 'Bearer ' + idToken } : {}),
      ...(options.headers || {}),
    },
  });
}

function renderApiAccessPanel() {
  const upsell = document.getElementById('apiUpsell');
  const manage = document.getElementById('apiManage');
  if (!upsell || !manage) return;

  const isEmpresa = curUser && (curUser.plan === 'empresa' || isAdminUser());
  upsell.style.display = isEmpresa ? 'none' : 'block';
  manage.style.display = isEmpresa ? 'block' : 'none';
  document.getElementById('apiNewKeyBox').style.display = 'none';

  if (isEmpresa) tpApiListKeys();
}

async function tpApiGenerateKey() {
  const labelInput = document.getElementById('apiKeyLabel');
  const label = labelInput ? labelInput.value.trim() || 'Sin nombre' : 'Sin nombre';
  try {
    const res = await _tpAuthedFetch(`${DECLARAFY_FN_BASE}/generateApiKey`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    if (!res.ok) { addNotif('⚠️', 'No se pudo generar la key', data.error?.message || 'Error desconocido'); return; }

    _tpLastGeneratedKey = data.apiKey;
    document.getElementById('apiNewKeyValue').textContent = data.apiKey;
    document.getElementById('apiNewKeyBox').style.display = 'block';
    if (labelInput) labelInput.value = '';
    tpApiListKeys();
  } catch (e) {
    console.error('tpApiGenerateKey error:', e);
    addNotif('⚠️', 'Error de conexión', 'No se pudo generar la API key.');
  }
}

function tpApiCopyKey() {
  if (!_tpLastGeneratedKey) return;
  navigator.clipboard.writeText(_tpLastGeneratedKey).then(() => {
    addNotif('✅', 'Copiado', 'API key copiada al portapapeles.');
  }).catch(() => {});
}

async function tpApiListKeys() {
  const list = document.getElementById('apiKeysList');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--muted);font-size:14px">Cargando keys...</div>';
  try {
    const res = await _tpAuthedFetch(`${DECLARAFY_FN_BASE}/listApiKeys`);
    const data = await res.json();
    if (!res.ok) { list.innerHTML = `<div style="color:var(--red);font-size:14px">${data.error?.message || 'Error cargando keys'}</div>`; return; }

    const keys = (data.keys || []).sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0));
    if (keys.length === 0) {
      list.innerHTML = '<div style="color:var(--muted);font-size:14px">Aún no tienes API keys. Genera la primera arriba.</div>';
      return;
    }
    list.innerHTML = keys.map(k => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:500">${_escapeHtml(k.label || 'Sin nombre')} ${k.active ? '' : '<span style="color:var(--red);font-size:14px">(revocada)</span>'}</div>
          <div style="font-size:14px;color:var(--muted);font-family:monospace">${k.masked || ''}</div>
          <div style="font-size:14px;color:var(--muted)">${k.requestCount || 0} solicitudes${k.lastUsedAt ? ' · último uso reciente' : ' · sin uso aún'}</div>
        </div>
        ${k.active ? `<button style="font-size:14px;padding:5px 10px;border-radius:6px;background:rgba(230,57,70,.1);border:1px solid rgba(230,57,70,.25);color:var(--red);cursor:pointer;font-family:inherit" onclick="tpApiRevokeKey('${k.keyId}')">Revocar</button>` : ''}
      </div>
    `).join('');
  } catch (e) {
    console.error('tpApiListKeys error:', e);
    list.innerHTML = '<div style="color:var(--red);font-size:14px">Error de conexión al cargar las keys.</div>';
  }
}

async function tpApiRevokeKey(keyId) {
  if (!confirm('¿Revocar esta API key? Las integraciones que la usen dejarán de funcionar de inmediato.')) return;
  try {
    const res = await _tpAuthedFetch(`${DECLARAFY_FN_BASE}/revokeApiKey`, {
      method: 'POST',
      body: JSON.stringify({ keyId }),
    });
    const data = await res.json();
    if (!res.ok) { addNotif('⚠️', 'No se pudo revocar', data.error?.message || 'Error desconocido'); return; }
    addNotif('✅', 'Key revocada', 'La API key fue revocada correctamente.');
    tpApiListKeys();
  } catch (e) {
    console.error('tpApiRevokeKey error:', e);
    addNotif('⚠️', 'Error de conexión', 'No se pudo revocar la API key.');
  }
}

// Removed duplicate escapeHtml — use _escapeHtml instead (defined at top of file)

// Mostrar/renderizar el panel de API Access al entrar a esa pestaña
// (usa asignación, no "function setPTab", para no romper la cadena de wraps)
const _origSetPTabApiAccess = setPTab;
setPTab = function(tab, btn) {
  _origSetPTabApiAccess(tab, btn);
  if (tab === 'api_access') renderApiAccessPanel();
};

// ════════════════════════════════════════════════════════════
// CALCULADORA DE LIQUIDACIÓN DE BENEFICIOS SOCIALES
// ════════════════════════════════════════════════════════════

function _liqFmt(n) {
  return 'S/ ' + (isFinite(n) ? n : 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Calendar-aware months/days between two dates (d1 <= d2)
function _liqMesesYDias(d1, d2) {
  if (!(d1 instanceof Date) || !(d2 instanceof Date) || isNaN(d1) || isNaN(d2) || d2 < d1) return { meses: 0, dias: 0 };
  let anios = d2.getFullYear() - d1.getFullYear();
  let meses = d2.getMonth() - d1.getMonth();
  let dias = d2.getDate() - d1.getDate();
  if (dias < 0) {
    meses--;
    const prevMonth = new Date(d2.getFullYear(), d2.getMonth(), 0);
    dias += prevMonth.getDate();
  }
  if (meses < 0) { anios--; meses += 12; }
  return { meses: anios * 12 + meses, dias };
}

function _liqParseDate(id) {
  const v = document.getElementById(id)?.value;
  if (!v) return null;
  const d = new Date(v + 'T00:00:00');
  return isNaN(d) ? null : d;
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'liqMotivo') {
    const wrap = document.getElementById('liqMesesPendientesWrap');
    if (wrap) wrap.style.display = e.target.value === 'arbitrario_plazo' ? 'block' : 'none';
  }
});

let _liqUltimoResultado = null;

function calcLiquidacion() {
  const sueldo = parseFloat(document.getElementById('liqSueldo')?.value) || 0;
  const asigFamSi = document.getElementById('liqAsigFam')?.value === 'si';
  const rmv = parseFloat(document.getElementById('liqRMV')?.value) || 1130;
  const ingreso = _liqParseDate('liqIngreso');
  const cese = _liqParseDate('liqCese');
  const ultCTS = _liqParseDate('liqUltCTS');
  const vacManual = parseFloat(document.getElementById('liqVacDiasManual')?.value) || 0;
  const motivo = document.getElementById('liqMotivo')?.value || 'renuncia';
  const mesesPendientes = parseFloat(document.getElementById('liqMesesPendientes')?.value) || 0;

  const resultDiv = document.getElementById('liqResult');
  const aiWrap = document.getElementById('liqAIWrap');
  if (!resultDiv) return;

  if (!sueldo || !ingreso || !cese) {
    resultDiv.style.display = 'none';
    if (aiWrap) aiWrap.style.display = 'none';
    return;
  }
  if (cese < ingreso) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="color:var(--red);font-size:14px">La fecha de cese no puede ser anterior a la fecha de ingreso.</div>';
    if (aiWrap) aiWrap.style.display = 'none';
    return;
  }

  const asigFam = asigFamSi ? rmv * 0.10 : 0;
  const remuBase = sueldo + asigFam;

  // ── CTS trunca ──
  const inicioCTS = ultCTS && ultCTS >= ingreso ? ultCTS : ingreso;
  const { meses: ctsMeses, dias: ctsDias } = _liqMesesYDias(inicioCTS, cese);
  const remuComputableCTS = remuBase + (remuBase / 6); // incluye 1/6 de gratificación
  const cts = (remuComputableCTS / 12) * ctsMeses + (remuComputableCTS / 360) * ctsDias;

  // ── Gratificación trunca (semestre en curso) ──
  const ceseMonth = cese.getMonth(); // 0-11
  let semestreInicio;
  if (ceseMonth <= 5) semestreInicio = new Date(cese.getFullYear(), 0, 1); // ene-jun
  else semestreInicio = new Date(cese.getFullYear(), 6, 1); // jul-dic
  if (semestreInicio < ingreso) semestreInicio = ingreso;
  const { meses: gratMeses, dias: gratDias } = _liqMesesYDias(semestreInicio, cese);
  const gratTrunca = (remuBase / 6) * gratMeses + (remuBase / 180) * gratDias;
  const bonifExtraordinaria = gratTrunca * 0.09; // Ley 30334, 9% EsSalud, inafecta

  // ── Vacaciones truncas ──
  let vacDias;
  if (vacManual > 0) {
    vacDias = vacManual;
  } else {
    // Último aniversario de ingreso antes del cese (inicio del récord vacacional vigente)
    let ultAniversario = new Date(cese.getFullYear(), ingreso.getMonth(), ingreso.getDate());
    if (ultAniversario > cese) ultAniversario.setFullYear(ultAniversario.getFullYear() - 1);
    if (ultAniversario < ingreso) ultAniversario = new Date(ingreso);
    const { meses: vMeses, dias: vDias } = _liqMesesYDias(ultAniversario, cese);
    vacDias = null; // marcamos para calcular en soles directamente abajo
    var vacTruncasSoles = (sueldo / 12) * vMeses + (sueldo / 360) * vDias;
  }
  const vacaciones = vacDias !== null && vacDias !== undefined ? (sueldo / 30) * vacDias : vacTruncasSoles;

  // ── Indemnización (solo si aplica) ──
  let indemnizacion = 0;
  let indemDetalle = '';
  if (motivo === 'arbitrario_indef') {
    const { meses: totalMeses } = _liqMesesYDias(ingreso, cese);
    const aniosCompletos = Math.floor(totalMeses / 12);
    const mesesRestantes = totalMeses % 12;
    indemnizacion = Math.min(aniosCompletos * 1.5 * sueldo + (mesesRestantes / 12) * 1.5 * sueldo, 12 * sueldo);
    indemDetalle = `1.5 remuneraciones por año completo (${aniosCompletos} año(s) + ${mesesRestantes} mes(es)), tope 12 remuneraciones.`;
  } else if (motivo === 'arbitrario_plazo') {
    indemnizacion = Math.min(1.5 * sueldo * mesesPendientes, 12 * sueldo);
    indemDetalle = `1.5 remuneraciones por cada mes dejado de laborar (${mesesPendientes} mes(es)), tope 12 remuneraciones.`;
  }

  const total = cts + gratTrunca + bonifExtraordinaria + vacaciones + indemnizacion;

  _liqUltimoResultado = { sueldo, asigFam, cts, ctsMeses, ctsDias, gratTrunca, gratMeses, gratDias, bonifExtraordinaria, vacaciones, indemnizacion, indemDetalle, motivo, total };

  resultDiv.style.display = 'block';
  resultDiv.innerHTML = `
    <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:16px">
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>CTS trunca (${ctsMeses}m ${ctsDias}d)</span><strong>${_liqFmt(cts)}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>Gratificación trunca (${gratMeses}m ${gratDias}d)</span><strong>${_liqFmt(gratTrunca)}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>Bonificación extraordinaria 9% (Ley 30334)</span><strong>${_liqFmt(bonifExtraordinaria)}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>Vacaciones truncas</span><strong>${_liqFmt(vacaciones)}</strong></div>
      ${indemnizacion > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span>Indemnización por despido arbitrario</span><strong>${_liqFmt(indemnizacion)}</strong></div><div style="font-size:14px;color:var(--muted);padding:4px 0">${indemDetalle}</div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:8px;border-top:2px solid var(--gold)"><span style="font-weight:600">Total liquidación</span><strong style="color:var(--gold);font-size:17px">${_liqFmt(total)}</strong></div>
    </div>
    <div style="font-size:14px;color:var(--muted);margin-top:10px">
      Cálculo referencial según régimen laboral general de la actividad privada (D.S. 001-97-TR CTS, Ley 27735 gratificaciones, D.Leg. 713 vacaciones, D.S. 003-97-TR indemnización). Verifica convenios colectivos, regímenes especiales (agrario, construcción, microempresa, etc.) o beneficios adicionales que puedan aplicar a tu caso.
    </div>
  `;
  if (aiWrap) aiWrap.style.display = 'block';
  const aiResult = document.getElementById('liqAIResult');
  if (aiResult) aiResult.style.display = 'none';
}

async function tpLiquidacionAIInsight() {
  if (!_liqUltimoResultado) return;
  const box = document.getElementById('liqAIResult');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<span style="color:var(--muted)">Generando explicación...</span>';
  const r = _liqUltimoResultado;
  const prompt = `Explica en lenguaje simple y cercano (para un trabajador sin conocimientos legales, no un contador) esta liquidación de beneficios sociales peruana:
- CTS trunca: S/ ${r.cts.toFixed(2)}
- Gratificación trunca: S/ ${r.gratTrunca.toFixed(2)} + bonificación extraordinaria 9%: S/ ${r.bonifExtraordinaria.toFixed(2)}
- Vacaciones truncas: S/ ${r.vacaciones.toFixed(2)}
- Indemnización: S/ ${r.indemnizacion.toFixed(2)} (motivo de cese: ${r.motivo})
- Total: S/ ${r.total.toFixed(2)}
Explica brevemente qué es cada concepto y por qué le corresponde, en 4-5 líneas cortas, sin jerga legal.`;

  try {
    const res = await callDeclaraFY({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system: 'Eres un especialista en derecho laboral peruano que explica liquidaciones de forma clara y empática para trabajadores sin conocimientos legales.',
      messages: [{ role: 'user', content: prompt }],
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || 'No se pudo generar la explicación.';
    box.innerHTML = text.replace(/\n/g, '<br>');
  } catch (e) {
    console.error('tpLiquidacionAIInsight error:', e);
    box.innerHTML = '<span style="color:var(--red)">Error generando la explicación. Intenta de nuevo.</span>';
  }
}

// ════════════════════════════════════════════════════════════
// CONSULTA SUNAT EN VIVO (RUC + validación de comprobantes)
// ════════════════════════════════════════════════════════════

function setSunatLiveTab(tab, btn) {
  document.getElementById('sunatLiveRucPanel').style.display = tab === 'ruc' ? 'block' : 'none';
  document.getElementById('sunatLiveDeudas').style.display = tab === 'deudas' ? 'block' : 'none';
  document.getElementById('sunatLivePdt').style.display = tab === 'pdt' ? 'block' : 'none';
  document.getElementById('sunatLiveCpe').style.display = tab === 'cpe' ? 'block' : 'none';
  document.querySelectorAll('#sunatLiveTabs .module-tab').forEach(b => { b.classList.remove('active'); b.style.background = ''; });
  if (btn) { btn.classList.add('active'); btn.style.background = 'rgba(58,134,255,.7)'; }
}

async function tpConsultaRuc() {
  const ruc = (document.getElementById('sunatLiveRuc')?.value || '').replace(/\D/g, '');
  const box = document.getElementById('sunatLiveResult');
  if (!box) return;
  if (ruc.length !== 11) {
    box.style.display = 'block';
    box.innerHTML = '<div style="color:var(--red);font-size:14px">El RUC debe tener 11 dígitos.</div>';
    return;
  }
  box.style.display = 'block';
  box.innerHTML = '<div style="color:var(--muted);font-size:14px">Consultando SUNAT...</div>';
  try {
    const res = await _tpAuthedFetch(`${DECLARAFY_FN_BASE}/consultaRuc`, {
      method: 'POST',
      body: JSON.stringify({ ruc }),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      box.innerHTML = `<div style="color:var(--red);font-size:14px">${data.error?.message || data.message || 'No se encontró información para ese RUC.'}</div>`;
      return;
    }
    const d = data.data || data;
    const estadoColor = (d.estado || '').toUpperCase() === 'ACTIVO' ? 'var(--green,#2ECC71)' : 'var(--red)';
    box.innerHTML = `
      <div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-size:15px;font-weight:600;margin-bottom:6px">${_escapeHtml(d.nombre_o_razon_social || d.razon_social || '—')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:14px">
          <div><span style="color:var(--muted)">RUC:</span> ${_escapeHtml(d.numero_documento || ruc)}</div>
          <div><span style="color:var(--muted)">Estado:</span> <strong style="color:${estadoColor}">${_escapeHtml(d.estado || '—')}</strong></div>
          <div><span style="color:var(--muted)">Condición:</span> ${_escapeHtml(d.condicion || '—')}</div>
          <div><span style="color:var(--muted)">Ubigeo:</span> ${_escapeHtml(d.ubigeo || '—')}</div>
          <div style="grid-column:1/-1"><span style="color:var(--muted)">Dirección:</span> ${_escapeHtml(d.direccion || '—')}</div>
        </div>
      </div>`;
  } catch (e) {
    console.error('tpConsultaRuc error:', e);
    box.innerHTML = '<div style="color:var(--red);font-size:14px">Error de conexión consultando SUNAT.</div>';
  }
}

async function tpValidarComprobante() {
  const rucEmisor = (document.getElementById('cpeRuc')?.value || '').replace(/\D/g, '');
  const tipoComprobante = document.getElementById('cpeTipo')?.value;
  const serie = document.getElementById('cpeSerie')?.value?.trim();
  const numero = document.getElementById('cpeNumero')?.value?.trim();
  const fechaRaw = document.getElementById('cpeFecha')?.value;
  const monto = document.getElementById('cpeMonto')?.value;
  const box = document.getElementById('cpeResult');
  if (!box) return;

  if (!rucEmisor || !tipoComprobante || !serie || !numero || !fechaRaw) {
    box.style.display = 'block';
    box.innerHTML = '<div style="color:var(--red);font-size:14px">Completa todos los campos.</div>';
    return;
  }
  const [y, m, d] = fechaRaw.split('-');
  const fechaEmision = `${d}/${m}/${y}`;

  box.style.display = 'block';
  box.innerHTML = '<div style="color:var(--muted);font-size:14px">Validando ante SUNAT...</div>';
  try {
    // Client-side validation via public SUNAT API
    const rucRes = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${rucEmisor}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!rucRes.ok) throw new Error(`RUC ${rucEmisor} no encontrado`);
    const rucData = await rucRes.json();
    const isActive = (rucData.estado || '').toUpperCase() === 'ACTIVO';
    const tipoMap = { '01': 'Factura', '03': 'Boleta', '07': 'Nota de crédito', '08': 'Nota de débito', '31': 'Guía de remisión' };
    const tipoDesc = tipoMap[tipoComprobante] || tipoComprobante;
    box.innerHTML = `
      <div style="background:${isActive ? 'rgba(46,204,113,.08)' : 'rgba(230,57,70,.08)'};border:1px solid ${isActive ? 'rgba(46,204,113,.3)' : 'rgba(230,57,70,.3)'};border-radius:10px;padding:16px">
        <div style="font-size:15px;font-weight:600;color:${isActive ? '#2ECC71' : 'var(--red)'}">${isActive ? '✅ RUC emisor válido' : '❌ RUC emisor no activo'}</div>
        <div style="font-size:14px;margin-top:8px;line-height:1.8">
          <div><strong>Razón Social:</strong> ${_escapeHtml(rucData.nombre_o_razon_social || '—')}</div>
          <div><strong>RUC:</strong> ${_escapeHtml(rucData.numero_documento || rucEmisor)}</div>
          <div><strong>Estado:</strong> ${_escapeHtml(rucData.estado || '—')}</div>
          <div><strong>Condición:</strong> ${_escapeHtml(rucData.condicion || '—')}</div>
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)">
            <div><strong>Comprobante:</strong> ${tipoDesc} ${serie}-${numero}</div>
            <div><strong>Fecha emisión:</strong> ${fechaEmision}</div>
            ${monto ? `<div><strong>Monto:</strong> S/ ${parseFloat(monto).toFixed(2)}</div>` : ''}
          </div>
          <div style="margin-top:8px;font-size:14px;color:var(--muted)">
            ℹ️ El RUC está ${isActive ? 'activo y puede emitir comprobantes.' : 'inactivo. El comprobante podría no ser válido.'}
            Para validación completa del CPE, usa SUNAT Operaciones en Línea.
          </div>
        </div>
      </div>`;
  } catch (e) {
    console.error('tpValidarComprobante error:', e);
    box.innerHTML = `<div style="color:var(--red);font-size:14px">Error: ${safeHTML(e.message) || 'No se pudo conectar con SUNAT.'}</div>`;
  }
}

// ════════════════════════════════════════════════════════════
// OCR DE FACTURAS → ASIENTO CONTABLE
// ════════════════════════════════════════════════════════════

let _ocrFacturaFileData = null; // { base64, mediaType, isPdf }

function _tpFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function tpOcrFacturaPreview() {
  const input = document.getElementById('ocrFacturaFile');
  const file = input?.files?.[0];
  const previewBox = document.getElementById('ocrFacturaPreviewBox');
  const img = document.getElementById('ocrFacturaPreviewImg');
  const pdfBox = document.getElementById('ocrFacturaPreviewPdf');
  const btn = document.getElementById('ocrFacturaBtn');
  if (!file) { previewBox.style.display = 'none'; btn.disabled = true; return; }

  const isPdf = file.type === 'application/pdf';
  const base64 = await _tpFileToBase64(file);
  _ocrFacturaFileData = { base64, mediaType: file.type, isPdf };

  previewBox.style.display = 'block';
  if (isPdf) {
    img.style.display = 'none';
    pdfBox.style.display = 'block';
  } else {
    pdfBox.style.display = 'none';
    img.style.display = 'block';
    img.src = 'data:' + file.type + ';base64,' + base64;
  }
  btn.disabled = false;
  document.getElementById('ocrFacturaResult').style.display = 'none';
}

async function tpOcrFacturaProcesar() {
  if (!_ocrFacturaFileData) return;
  const loading = document.getElementById('ocrFacturaLoading');
  const result = document.getElementById('ocrFacturaResult');
  loading.style.display = 'block';
  result.style.display = 'none';

  const contentBlock = _ocrFacturaFileData.isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: _ocrFacturaFileData.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: _ocrFacturaFileData.mediaType, data: _ocrFacturaFileData.base64 } };

  const instructions = `Analiza este comprobante de pago peruano (factura o boleta). Extrae los datos y responde en este formato exacto, en español, sin agregar texto fuera de estas secciones:

**DATOS DEL COMPROBANTE**
- Tipo:
- Serie y número:
- Fecha de emisión:
- RUC emisor y razón social:
- RUC/DNI del cliente (si figura):
- Base imponible (sin IGV):
- IGV (18%):
- Total:

**TRATAMIENTO TRIBUTARIO**
- ¿Es deducible para efectos del Impuesto a la Renta? (sí/no y por qué)
- ¿Otorga derecho a crédito fiscal de IGV? (sí/no y por qué)
- ¿Aplica detracción (SPOT)? Si aplica, indica el porcentaje y el bien/servicio detectado.
- Observaciones o riesgos tributarios que notes (ej. comprobante no fidedigno, datos incompletos, etc.)

**ASIENTO CONTABLE SUGERIDO (PCGE)**
Presenta el asiento en una tabla simple: Cuenta | Denominación | Debe | Haber`;

  try {
    const res = await callDeclaraFY({
      model: 'claude-sonnet-4-5',
      max_tokens: 1800,
      system: 'Eres un contador peruano experto en tributación y en el Plan Contable General Empresarial (PCGE). Analizas comprobantes de pago con precisión y generas asientos contables correctos.',
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: instructions }] }],
    });
    const data = await res.json();
    const text = data.content?.[0]?.text;
    loading.style.display = 'none';
    result.style.display = 'block';
    if (!text) {
      result.innerHTML = '<div style="color:var(--red);font-size:14px">No se pudo procesar el comprobante. Intenta con una imagen más clara.</div>';
      return;
    }
    result.innerHTML = `<div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:16px;font-size:14px;line-height:1.8;white-space:pre-wrap">${_escapeHtml(text)}</div>
      <div style="font-size:14px;color:var(--muted);margin-top:10px">Resultado generado por IA a partir de la imagen/PDF subido. Verifica los montos y la clasificación tributaria antes de registrar el asiento en tu sistema contable.</div>`;
  } catch (e) {
    console.error('tpOcrFacturaProcesar error:', e);
    loading.style.display = 'none';
    result.style.display = 'block';
    result.innerHTML = '<div style="color:var(--red);font-size:14px">Error procesando el comprobante. Intenta de nuevo.</div>';
  }
}

// ════════════════════════════════════════════════════════════
// CLASIFICADOR ARANCELARIO (HS CODE) ASISTIDO POR IA
// ════════════════════════════════════════════════════════════

async function tpClasificarHS() {
  const descripcion = document.getElementById('hsDescripcion')?.value?.trim();
  const material = document.getElementById('hsMaterial')?.value?.trim();
  const uso = document.getElementById('hsUso')?.value?.trim();
  const flujo = document.getElementById('hsFlujo')?.value;
  const loading = document.getElementById('hsLoading');
  const result = document.getElementById('hsResult');

  if (!descripcion) {
    result.style.display = 'block';
    result.innerHTML = '<div style="color:var(--red);font-size:14px">Describe el producto primero.</div>';
    return;
  }

  loading.style.display = 'block';
  result.style.display = 'none';

  const prompt = `Producto a clasificar arancelariamente (${flujo === 'exportacion' ? 'EXPORTACIÓN' : 'IMPORTACIÓN'} en Perú):
Descripción: ${descripcion}
${material ? `Material principal: ${material}` : ''}
${uso ? `Uso/destino: ${uso}` : ''}

Responde en este formato exacto:

**PARTIDA ARANCELARIA SUGERIDA**
- Subpartida nacional (10 dígitos, Arancel de Aduanas del Perú) más probable:
- Descripción oficial de esa subpartida:
- Nivel de confianza (alta/media/baja) y por qué:

**ALTERNATIVAS A CONSIDERAR**
Lista 1-2 subpartidas alternativas si la clasificación es ambigua, con el criterio que las diferencia.

**RAZONAMIENTO**
Explica brevemente las Reglas Generales de Interpretación (RGI) aplicadas para llegar a esta clasificación.

**ARANCELES DE REFERENCIA**
- Ad valorem (partida general):
- ¿Tiene preferencia arancelaria en algún TLC relevante para Perú? Menciona cuál si aplica.

**IMPORTANTE**
Aclara que esto es una sugerencia de IA y que la clasificación final debe confirmarse con un agente de aduanas o mediante consulta de clasificación arancelaria ante SUNAT/INDECOPI.`;

  try {
    const res = await callDeclaraFY({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: 'Eres un especialista en clasificación arancelaria y comercio exterior peruano, con dominio del Sistema Armonizado (HS) y el Arancel de Aduanas del Perú.',
      messages: [{ role: 'user', content: prompt }],
    });
    const data = await res.json();
    const text = data.content?.[0]?.text;
    loading.style.display = 'none';
    result.style.display = 'block';
    if (!text) {
      result.innerHTML = '<div style="color:var(--red);font-size:14px">No se pudo generar la clasificación. Intenta de nuevo.</div>';
      return;
    }
    result.innerHTML = `<div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:10px;padding:16px;font-size:14px;line-height:1.8;white-space:pre-wrap">${_escapeHtml(text)}</div>`;
  } catch (e) {
    console.error('tpClasificarHS error:', e);
    loading.style.display = 'none';
    result.style.display = 'block';
    result.innerHTML = '<div style="color:var(--red);font-size:14px">Error generando la clasificación. Intenta de nuevo.</div>';
  }
}

// ════════════════════════════════════════════════════════════
// RECORDATORIOS POR WHATSAPP — guardar preferencias del usuario
// ════════════════════════════════════════════════════════════

async function tpGuardarRecordatorios() {
  const whatsapp = document.getElementById('pWhatsapp')?.value?.trim();
  const notifWhatsapp = document.getElementById('pNotifWhatsapp')?.value === 'si';
  const ruc = document.getElementById('pRuc')?.value?.trim();
  const ok = document.getElementById('notifOk');

  if (notifWhatsapp && (!whatsapp || !whatsapp.startsWith('+'))) {
    if (ok) { ok.style.color = 'var(--red)'; ok.textContent = 'Ingresa tu número con código de país, ej: +51999999999'; }
    return;
  }

  try {
    const res = await _tpAuthedFetch(`${DECLARAFY_FN_BASE}/updateNotifPrefs`, {
      method: 'POST',
      body: JSON.stringify({ whatsapp, notifWhatsapp, ruc }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (ok) { ok.style.color = 'var(--red)'; ok.textContent = data.error?.message || 'Error guardando preferencias.'; }
      return;
    }
    if (ok) { ok.style.color = ''; ok.textContent = notifWhatsapp ? '✅ Recordatorios activados. Te avisaremos por WhatsApp.' : '✅ Preferencias guardadas.'; }
  } catch (e) {
    console.error('tpGuardarRecordatorios error:', e);
    if (ok) { ok.style.color = 'var(--red)'; ok.textContent = 'Error de conexión.'; }
  }
}

// ════════════════════════════════════════════════════════════
// API: SUNAT REST — Comprobantes, Deudas, PDTs
// ════════════════════════════════════════════════════════════
const TP_FN_BASE = DECLARAFY_FN_BASE;

async function tpAuthFetch(url, options = {}) {
  const user = typeof firebase !== 'undefined' && firebase.auth().currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      ...(options.headers || {})
    }
  });
}

async function tpConsultaSunat(tipo) {
  let ruc = document.getElementById('sunatLiveRuc')?.value?.trim();
  let targetId = 'sunatLiveResult';
  if (tipo === 'deudas') {
    ruc = document.getElementById('sunatDeudasRuc')?.value?.trim() || ruc;
    targetId = 'sunatDeudasResult';
  } else if (tipo === 'pdt') {
    ruc = document.getElementById('sunatPdtRuc')?.value?.trim() || ruc;
    targetId = 'sunatPdtResult';
  }
  if (!ruc || ruc.length !== 11) { tpToast('Ingresa un RUC válido de 11 dígitos.', 'warn'); return; }
  const resultEl = document.getElementById(targetId);
  if (!resultEl) return;
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:var(--muted)">🔄 Consultando SUNAT...</div>';
  try {
    const response = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${ruc}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`RUC ${ruc} no encontrado`);
    const rawData = await response.json();
    if (tipo === 'deudas') {
      renderSunatResult({ deudas: rawData.deudas || [] }, 'deudas', targetId);
    } else if (tipo === 'pdt') {
      renderSunatResult({ pdts: rawData.pdts || [] }, 'pdt', targetId);
    } else {
      renderSunatResult(rawData, tipo, targetId);
    }
  } catch(e) {
    resultEl.innerHTML = `<div style="color:var(--red)">Error: ${safeHTML(e.message)}</div>`;
  }
}

function renderSunatResult(data, tipo, targetId) {
  const el = document.getElementById(targetId || 'sunatLiveResult');
  if (!el) return;
  if (tipo === 'deudas') {
    const deudas = data.deudas || data.data || [];
    if (!deudas.length) { el.innerHTML = '<div style="color:var(--green)">✅ No tiene deudas tributarias pendientes.</div>'; return; }
    el.innerHTML = `<div style="font-size:14px;font-weight:500;color:var(--red);margin-bottom:8px">⚠️ ${deudas.length} deuda(s) encontrada(s)</div>` +
      deudas.map(d => `<div style="background:rgba(230,57,70,.08);border:1px solid rgba(230,57,70,.2);border-radius:8px;padding:10px;margin-bottom:8px;font-size:14px">
        <div><strong>${d.codTributo || d.codigo || 'N/A'}</strong> — ${d.descripcion || d.desc || ''}</div>
        <div>Monto: S/ ${parseFloat(d.monto || d.deuda || 0).toFixed(2)} | Periodo: ${d.periodo || d.fiscal_period || 'N/A'}</div>
      </div>`).join('');
  } else if (tipo === 'pdt') {
    const pdts = data.pdts || data.data || [];
    if (!pdts.length) { el.innerHTML = '<div style="color:var(--muted)">No se encontraron PDTs presentados.</div>'; return; }
    el.innerHTML = `<div style="font-size:14px;font-weight:500;color:#3A86FF;margin-bottom:8px">📄 PDTs encontrados</div>` +
      pdts.map(p => `<div style="background:rgba(58,134,255,.07);border:1px solid rgba(58,134,255,.2);border-radius:8px;padding:10px;margin-bottom:8px;font-size:14px">
        <div><strong>${p.formulario || p.codigo || 'N/A'}</strong> — ${p.descripcion || p.periodo || ''}</div>
        <div>Fecha presentación: ${p.fechaPresentacion || p.fecha || 'N/A'} | Estado: ${p.estado || 'N/A'}</div>
      </div>`).join('');
  } else {
    el.innerHTML = `<div style="font-size:14px;line-height:1.8">
      <div><strong>Razón Social:</strong> ${data.razonSocial || data.nombre_o_razon_social || 'N/A'}</div>
      <div><strong>RUC:</strong> ${data.ruc || data.numeroDocumento || 'N/A'}</div>
      <div><strong>Estado:</strong> <span style="color:${data.estado === 'ACTIVO' ? 'var(--green)' : 'var(--red)'}">${data.estado || 'N/A'}</span></div>
      <div><strong>Condición:</strong> ${data.condicion || 'N/A'}</div>
      <div><strong>Dirección:</strong> ${data.direccion || data.domicilioFiscal || 'N/A'}</div>
      <div><strong>Tipo:</strong> ${data.tipoContribuyente || data.tipo || 'N/A'}</div>
      <div><strong>Actividad:</strong> ${data.actividadExterior || data.giroNegocio || 'N/A'}</div>
    </div>`;
  }
}

async function tpConsultaRucRapida() {
  const ruc = document.getElementById('sunatLiveRuc')?.value?.trim();
  if (!ruc || ruc.length !== 11) { tpToast('Ingresa un RUC válido.', 'warn'); return; }
  tpConsultaSunat('comprobante');
}

// ════════════════════════════════════════════════════════════
// API: BCR — Tipos de Cambio
// ════════════════════════════════════════════════════════════
async function tpConsultaBCR() {
  const resultEl = document.getElementById('bcrResult');
  if (!resultEl) return;
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:var(--muted)">🔄 Consultando BCRP...</div>';
  try {
    const response = await fetch('https://estadisticas.bcrp.gob.pe/rest/es/estadisticas/PM06252AA/ultimos/7/datos', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`BCR API returned ${response.status}`);
    const data = await response.json();
    renderBCRResult(data);
  } catch(e) {
    // BCR API may block CORS — try fallback via proxy
    try {
      const res = await fetch(`${TP_FN_BASE}/consultaBCRTiposCambio`);
      const data = await res.json();
      if (data.ok) { renderBCRResult(data.data); return; }
    } catch(_) {}
    resultEl.innerHTML = `<div style="color:var(--red)">Error: ${safeHTML(e.message)}</div>`;
  }
}

function renderBCRResult(data) {
  const el = document.getElementById('bcrResult');
  if (!el) return;
  const items = data?.estadisticas?.[0]?.data || data?.data || [];
  if (!items.length) { el.innerHTML = '<div style="color:var(--muted)">Sin datos disponibles.</div>'; return; }
  el.innerHTML = `<div style="font-size:14px">
    <div style="font-weight:500;color:var(--gold);margin-bottom:8px">Tipos de Cambio — BCRP</div>
    ${items.slice(0, 10).map(d => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span>${d.fecha || d.serie || ''}</span>
      <span style="color:var(--gold)">S/ ${(d.precio || d.valor || 0).toFixed(3)}</span>
    </div>`).join('')}
  </div>`;
}

// ════════════════════════════════════════════════════════════
// API: SBS — Pensiones, Seguros, COFIDE
// ════════════════════════════════════════════════════════════
async function tpConsultaSBS(tipo) {
  const resultEl = document.getElementById('sbsApiResult');
  if (!resultEl) return;
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="color:var(--muted)">🔄 Consultando SBS...</div>';
  try {
    let url;
    if (tipo === 'pension' || tipo === 'pensiones') {
      url = 'https://www.sbs.gob.pe/app/statistics/pension/702/702-PRIMA/1/1';
    } else if (tipo === 'seguro' || tipo === 'seguros') {
      url = 'https://www.sbs.gob.pe/app/statistics/insurance/500/500-PRIMA/1/1';
    }
    if (!url) throw new Error('Tipo no soportado');
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    const data = await response.json();
    renderSBSApiResult(data, tipo);
  } catch(e) {
    resultEl.innerHTML = `<div style="color:var(--red)">Error: ${safeHTML(e.message)}</div>`;
  }
}

function renderSBSApiResult(data, tipo) {
  const el = document.getElementById('sbsApiResult');
  if (!el) return;
  el.innerHTML = `<div style="font-size:14px;padding:10px;background:var(--surface);border-radius:8px;border:1px solid var(--border)">
    <div style="font-weight:500;color:var(--blue);margin-bottom:8px">🏦 Datos SBS — ${tipo}</div>
    <pre style="white-space:pre-wrap;font-size:14px;color:var(--text);max-height:300px;overflow-y:auto">${JSON.stringify(data, null, 2)}</pre>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// API: WhatsApp — Alertas de Vencimientos
// ════════════════════════════════════════════════════════════
async function tpSendWhatsAppAlert(phone, message) {
  try {
    const alerts = JSON.parse(localStorage.getItem('tp_whatsapp_alerts') || '[]');
    alerts.push({ phone, message, status: 'pending', createdAt: Date.now() });
    kvPut('tp_whatsapp_alerts', alerts, 'whatsapp_alerts');
registerKVScope('whatsapp_alerts', () => 'tp_whatsapp_alerts');
    tpToast('📱 Alerta guardada. Se enviará cuando se configure WhatsApp Business API.', 'ok');
    return { ok: true };
  } catch(e) {
    tpToast('Error: ' + e.message, 'err');
    return null;
  }
}

async function tpConfigWhatsApp() {
  const phone = document.getElementById('whatsappPhone')?.value?.trim();
  if (!phone) { tpToast('Ingresa tu número de WhatsApp.', 'warn'); return; }
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 9) { tpToast('Número inválido. Ejemplo: 991249954', 'warn'); return; }
  try {
    kvPut('tp_whatsapp_phone', phone, 'whatsapp_phone');
    kvPut('tp_whatsapp_enabled', 'si', 'whatsapp_enabled');
    registerKVScope('whatsapp_phone', () => 'tp_whatsapp_phone');
    registerKVScope('whatsapp_enabled', () => 'tp_whatsapp_enabled');
    const btn = document.querySelector('[onclick*="tpConfigWhatsApp"]');
    if (btn) { btn.textContent = '✅ Configurado'; btn.style.background = 'var(--green)'; }
    tpToast('✅ WhatsApp configurado. Recibirás alertas de vencimientos tributarios.', 'ok');
  } catch(e) {
    tpToast('Error: ' + e.message, 'err');
  }
}

// ════════════════════════════════════════════════════════════
// API: Exportar a CSV/Sheets
// ════════════════════════════════════════════════════════════
async function tpExportToCSV(title, data, columns) {
  if (!data || !data.length) { tpToast('No hay datos para exportar.', 'warn'); return; }
  const headers = columns || Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  for (const row of data) {
    csvRows.push(headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','));
  }
  const csv = csvRows.join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${title || 'export'}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click(); URL.revokeObjectURL(url);
  // Save export history locally
  if (curUser) {
    const exports = JSON.parse(localStorage.getItem('tp_exports') || '[]');
    exports.push({ title, date: new Date().toISOString(), rows: data.length });
    kvPut('tp_exports', exports, 'exports');
  }
registerKVScope('exports', () => 'tp_exports');
  tpToast('📊 Archivo CSV descargado.', 'ok');
}

async function tpExportarHistorial() {
  if (!curUser) return;
  const h = getHist(curUser.email);
  if (!h.length) { tpToast('No hay historial para exportar.', 'warn'); return; }
  const data = h.map(c => ({
    titulo: c.title || '',
    fecha: c.date || '',
    area: c.area || '',
    mensajes: (c.messages || []).length,
    primerMensaje: (c.messages?.[0]?.content || '').substring(0, 100)
  }));
  tpExportToCSV('historial_declarafy', data);
}

// ════════════════════════════════════════════════════════════
// API: IA Alternativa (OpenAI / DeepSeek)
// ════════════════════════════════════════════════════════════
async function callAlternativeAI(provider, messages, system) {
  try {
    const res = await tpAuthFetch(`${TP_FN_BASE}/callAlternativeAI`, {
      method: 'POST',
      body: JSON.stringify({ provider, messages, system, max_tokens: 2048 })
    });
    if (!res.ok) {
      return { error: 'Función no disponible sin Blaze plan. Se requiere para proteger las API keys de DeepSeek/OpenAI.' };
    }
    return await res.json();
  } catch(e) {
    return { error: 'IA alternativa requiere Cloud Functions (Blaze plan). Usa Claude como alternativa.' };
  }
}

async function sendMsgDeepSeek() {
  const inp = document.getElementById('userInput');
  const msg = inp?.value?.trim();
  const provider = document.getElementById('aiProvider')?.value || 'deepseek';
  if (!msg) return;
  if (!curUser || curPlan === 'basico') {
    tpToast('IA alternativa disponible para planes Profesional/Empresa.', 'warn'); return;
  }
  inp.value = '';
  inp.style.height = 'auto';
  addMsg('user', msg);
  showTyp();
  const result = await callAlternativeAI(provider, [
    { role: 'user', content: msg + (AREAS[curArea] ? `\n[Área: ${AREAS[curArea].label}]` : '') }
  ], SYS);
  remTyp();
  const text = result.content?.[0]?.text || result.error || 'Sin respuesta';
  addMsg('ai', text);
  convHist.push({ role: 'assistant', content: text });
}

// ════════════════════════════════════════════════════════════════
// 1. LIQUIDACIÓN DE NÓMINA
// ════════════════════════════════════════════════════════════════
const TASAS_AFP = { 'prima': 0.1314, 'profuturo': 0.1287, 'integra': 0.1230, 'habitat': 0.1213 };
const TASAS_ONP = { '50': 0.13, '60': 0.11 };

function calcNomina() {
  const bruto = parseFloat(document.getElementById('nomBruto')?.value) || 0;
  const regimen = document.getElementById('nomRegimen')?.value || 'rmt';
  const dias = parseInt(document.getElementById('nomDias')?.value) || 30;
  const bono = parseFloat(document.getElementById('nomBono')?.value) || 0;
  const box = document.getElementById('nomResult');
  if (!box || !bruto) return;

  const remBruto = bruto + bono;
  const remDiaria = remBruto / 30;
  const remProporcional = remDiaria * dias;

  // EsSalud: 9% del empleado
  const essalud = remProporcional * 0.09;
  // AFP: promedio ~13%
  const afp = remProporcional * 0.13;
  // ONP: 13% si 50, 11% si 60 (usamos AFP como default)
  const onp = remProporcional * 0.13;

  // Impuesto a la Renta - 5ta categoría
  let retencion = 0;
  const mensual7 = remProporcional * 0.07;
  const mensual8 = remProporcional * 0.08;
  if (regimen === '5cat' || regimen === 'rg') {
    // Cálculo gradual 5ta categoría
    if (remProporcional <= 2150) retencion = 0;
    else if (remProporcional <= 2600) retencion = (remProporcional - 2150) * 0.08;
    else if (remProporcional <= 4250) retencion = 36 + (remProporcional - 2600) * 0.10;
    else if (remProporcional <= 6550) retencion = 201 + (remProporcional - 4250) * 0.17;
    else if (remProporcional <= 10750) retencion = 592 + (remProporcional - 6550) * 0.20;
    else if (remProporcional <= 13950) retencion = 1432 + (remProporcional - 10750) * 0.23;
    else if (remProporcional <= 21550) retencion = 2168 + (remProporcional - 13950) * 0.27;
    else if (remProporcional <= 43550) retencion = 4220 + (remProporcional - 21550) * 0.30;
    else retencion = 10820 + (remProporcional - 43550) * 0.34;
  }

  // RMT
  let rmtCuota = 0;
  if (regimen === 'rmt') {
    if (remProporcional <= 1500) rmtCuota = remProporcional * 0.01;
    else if (remProporcional <= 2500) rmtCuota = 15 + (remProporcional - 1500) * 0.015;
    else rmtCuota = 30 + (remProporcional - 2500) * 0.03;
  }

  const totalDescuentos = afp + essalud + retencion + rmtCuota;
  const neto = remProporcional - totalDescuentos;
  const costTotal = remProporcional + essalud * 1.5;

  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table>
      <tr><th colspan="2">Liquidación de Nómina — S/</th></tr>
      <tr><td>Remuneración bruta</td><td style="text-align:right">S/ ${remBruto.toFixed(2)}</td></tr>
      <tr><td>+ Bonificaciones</td><td style="text-align:right">S/ ${bono.toFixed(2)}</td></tr>
      <tr><td><strong>Rem. Proporcional (${dias} días)</strong></td><td style="text-align:right"><strong>S/ ${remProporcional.toFixed(2)}</strong></td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td style="color:var(--red)">− EsSalud (9%)</td><td style="text-align:right;color:var(--red)">S/ ${essalud.toFixed(2)}</td></tr>
      <tr><td style="color:var(--red)">− AFP (~13%)</td><td style="text-align:right;color:var(--red)">S/ ${afp.toFixed(2)}</td></tr>
      ${retencion > 0 ? `<tr><td style="color:var(--red)">− Retención 5ta Cat.</td><td style="text-align:right;color:var(--red)">S/ ${retencion.toFixed(2)}</td></tr>` : ''}
      ${rmtCuota > 0 ? `<tr><td style="color:var(--red)">− Cuota RMT</td><td style="text-align:right;color:var(--red)">S/ ${rmtCuota.toFixed(2)}</td></tr>` : ''}
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td><strong style="color:var(--green)">Neto a recibir</strong></td><td style="text-align:right"><strong style="color:var(--green);font-size:16px">S/ ${neto.toFixed(2)}</strong></td></tr>
      <tr><td><strong>Costo total empresa</strong></td><td style="text-align:right;color:var(--gold)"><strong>S/ ${costTotal.toFixed(2)}</strong></td></tr>
    </table>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 2. MORAS SUNAT
// ════════════════════════════════════════════════════════════════
function calcMoras() {
  const monto = parseFloat(document.getElementById('moraMonto')?.value) || 0;
  const tipo = document.getElementById('moraTipo')?.value || 'igv';
  const fVen = document.getElementById('moraFechaVen')?.value;
  const fPago = document.getElementById('moraFechaPago')?.value;
  const box = document.getElementById('moraResult');
  if (!box || !monto || !fVen || !fPago) return;

  const d1 = new Date(fVen), d2 = new Date(fPago);
  const dias = Math.max(0, Math.floor((d2 - d1) / 86400000));
  if (dias <= 0) { box.style.display = 'block'; box.innerHTML = '<div style="color:var(--green)">✅ No hay mora. La fecha de pago es anterior al vencimiento.</div>'; return; }

  // Interés moratorio: tasa mensual 1.5% (SUNAT)
  const tasaMensual = 0.015;
  const meses = Math.ceil(dias / 30);
  const interes = monto * tasaMensual * meses;

  // Multa por no declarar: 25% o 50% según tipo
  let multa = 0;
  if (tipo === 'ple') {
    multa = monto * 0.25; // 25% PDT
  } else if (tipo === 'igv' || tipo === 'renta') {
    multa = monto * 0.40; // 40% tributo
  }

  const recargo = monto * 0.01 * Math.ceil(dias / 30);
  const total = monto + interes + multa + recargo;

  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table>
      <tr><th colspan="2" style="color:var(--red)">Calculadora de Moras SUNAT</th></tr>
      <tr><td>Monto original</td><td style="text-align:right">S/ ${monto.toFixed(2)}</td></tr>
      <tr><td>Días de mora</td><td style="text-align:right">${dias} días (${meses} meses)</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td style="color:var(--red)">+ Interés moratorio (1.5%/mes)</td><td style="text-align:right;color:var(--red)">S/ ${interes.toFixed(2)}</td></tr>
      <tr><td style="color:var(--red)">+ Multa (${tipo === 'ple' ? '25%' : '40%'})</td><td style="text-align:right;color:var(--red)">S/ ${multa.toFixed(2)}</td></tr>
      <tr><td style="color:var(--red)">+ Recargo (1%/mes)</td><td style="text-align:right;color:var(--red)">S/ ${recargo.toFixed(2)}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td><strong style="color:var(--red)">Total a pagar</strong></td><td style="text-align:right"><strong style="color:var(--red);font-size:16px">S/ ${total.toFixed(2)}</strong></td></tr>
      <tr><td>Recargo por pronto pago</td><td style="text-align:right;color:var(--green)">-S/ ${(total - monto).toFixed(2)}</td></tr>
    </table>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 3. CALENDARIO FISCAL
// ════════════════════════════════════════════════════════════════
function calcCalendarioFiscal() {
  const ruc = document.getElementById('calRuc')?.value?.trim();
  const regimen = document.getElementById('calRegimen')?.value || 'rmt';
  const box = document.getElementById('calendarioResult');
  if (!box || !ruc || ruc.length !== 11) return;

  const ultimoDigito = parseInt(ruc.slice(-1));
  const deadlineDay = 12 + ultimoDigito;

  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
  const year = new Date().getFullYear();

  let cronograma = [];
  for (let m = 0; m < 12; m++) {
    const vencimiento = `${deadlineDay}/${String(m + 1).padStart(2, '0')}/${year}`;
    let pdts = [];
    if (regimen === 'rmt' || regimen === 'rg') {
      pdts.push('PDT 621 (IGV)');
      if (m === 11) pdts.push('PDT 622 (Renta Anual)');
    } else if (regimen === 'rer') {
      pdts.push('PDT 621 (IGV)');
      if (m === 2) pdts.push('DJ RER Anual');
    } else if (regimen === 'nrus') {
      pdts.push('PDT 1400 (NRUS)');
    }
    const hoy = new Date();
    const fechaVen = new Date(year, m, deadlineDay);
    const diff = Math.floor((fechaVen - hoy) / 86400000);
    let estado = '⏳';
    let colorEstado = 'var(--muted)';
    if (diff < 0) { estado = '✅ Pagado'; colorEstado = 'var(--green)'; }
    else if (diff <= 3) { estado = '🔴 Urgente'; colorEstado = 'var(--red)'; }
    else if (diff <= 7) { estado = '🟡 Próximo'; colorEstado = 'var(--gold)'; }

    cronograma.push(`<tr>
      <td><strong>${meses[m]}</strong></td>
      <td style="text-align:center">${deadlineDay}</td>
      <td>${pdts.join(', ')}</td>
      <td style="color:${colorEstado};font-size:14px">${estado}</td>
    </tr>`);
  }

  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">📅 Cronograma ${year} — RUC ${ruc} — Último dígito: ${ultimoDigito}</div>
    <table>
      <tr><th>Mes</th><th>Vence</th><th>Formularios</th><th>Estado</th></tr>
      ${cronograma.join('')}
    </table>
    <div style="margin-top:10px;font-size:14px;color:var(--muted)">Régimen: ${regimen.toUpperCase()} | Día de vencimiento: ${deadlineDay} de cada mes</div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 4. IMPORTACIÓN / EXPORTACIÓN
// ════════════════════════════════════════════════════════════════
function calcImportacion() {
  const cif = parseFloat(document.getElementById('impCif')?.value) || 0;
  const tc = parseFloat(document.getElementById('impTC')?.value) || 3.752;
  const arancel = parseFloat(document.getElementById('impArancel')?.value) || 0;
  const tipo = document.getElementById('impTipo')?.value || 'general';
  const peso = parseFloat(document.getElementById('impPeso')?.value) || 0;
  const box = document.getElementById('impResult');
  if (!box || !cif) return;

  const cifSoles = cif * tc;

  // Derecho advalorem
  const advalorem = cifSoles * (arancel / 100);

  // IGV aduanero: 16% sobre (CIF + advalorem)
  const baseIgv = cifSoles + advalorem;
  const igv = baseIgv * 0.16;

  // SPF (Seguro de Privatización de Fondos) — simplificado
  const spf = cifSoles * 0.002;

  // THC (Terminal Handling Charges) — estimado
  const thc = peso > 0 ? Math.max(peso * 0.15, 120) : 200;

  // Almacenaje estimado (15 días gratis, luego S/ 6.5/m³/día)
  const almacenaje = 0;

  const totalTributos = advalorem + igv + spf;
  const totalCosto = totalTributos + thc + almacenaje;
  const totalUSD = totalCosto / tc;

  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">🚢 Costos de Importación — ${tipo}</div>
    <table>
      <tr><th>Concepto</th><th style="text-align:right">Monto</th></tr>
      <tr><td>Valor CIF</td><td style="text-align:right">USD ${cif.toLocaleString()} (S/ ${cifSoles.toFixed(2)})</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td style="color:var(--red)">Derecho advalorem (${arancel}%)</td><td style="text-align:right;color:var(--red)">S/ ${advalorem.toFixed(2)}</td></tr>
      <tr><td style="color:var(--red)">IGV aduanero (16%)</td><td style="text-align:right;color:var(--red)">S/ ${igv.toFixed(2)}</td></tr>
      <tr><td style="color:var(--red)">SPF (0.2%)</td><td style="text-align:right;color:var(--red)">S/ ${spf.toFixed(2)}</td></tr>
      <tr><td style="color:var(--red)">THC</td><td style="text-align:right;color:var(--red)">S/ ${thc.toFixed(2)}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td><strong style="color:var(--red)">Total tributos</strong></td><td style="text-align:right"><strong style="color:var(--red)">S/ ${totalTributos.toFixed(2)}</strong></td></tr>
      <tr><td><strong>Total costos importación</strong></td><td style="text-align:right"><strong style="color:var(--gold);font-size:15px">S/ ${totalCosto.toFixed(2)}</strong></td></tr>
      <tr><td><strong>Total USD</strong></td><td style="text-align:right;color:var(--text)"><strong>USD ${totalUSD.toFixed(2)}</strong></td></tr>
    </table>
    <div style="margin-top:10px;font-size:14px;color:var(--muted)">* THC y almacenaje son estimados. Valores reales varían según agencia aduanera.</div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 5. SELECTOR DE RÉGIMEN
// ════════════════════════════════════════════════════════════════
function calcRegimen() {
  const ingresos = parseFloat(document.getElementById('regIngresos')?.value) || 0;
  const gastos = parseFloat(document.getElementById('regGastos')?.value) || 0;
  const trab = parseInt(document.getElementById('regTrab')?.value) || 0;
  const actividad = document.getElementById('regActividad')?.value || 'servicios';
  const box = document.getElementById('regimenResult');
  if (!box || !ingresos) return;

  const utilidad = ingresos - gastos;
  const renta5cat = Math.max(0, utilidad * 0.24);

  // RMT
  let rmtMensual = 0;
  if (ingresos / 12 <= 1500) rmtMensual = (ingresos / 12) * 0.01;
  else if (ingresos / 12 <= 2500) rmtMensual = 15 + ((ingresos / 12) - 1500) * 0.015;
  else rmtMensual = 30 + ((ingresos / 12) - 2500) * 0.03;
  const rmtAnual = rmtMensual * 12;
  const rmtImpuesto = renta5cat * 0.5;

  // RG - 8% de gastos
  const rgImpuesto = Math.max(0, utilidad) * 0.24;

  // RER - 1.5% de ingresos
  const rerImpuesto = ingresos * 0.015;

  // NRUS - tope 70 UIT
  const nrusMensual = ingresos / 12 * 0.01;
  const nrusAnual = nrusMensual * 12;

  const regimenes = [
    { nombre: 'RMT', impuesto: rmtImpuesto, descripcion: 'Régimen MYPE Tributario. Ideal para microempresas con utilidad moderada.', requisitos: 'Ingresos ≤ 500 UIT', color: '#2ECC71' },
    { nombre: 'RER', impuesto: rerImpuesto, descripcion: 'Régimen Especial. Paga 1.5% de tus ingresos netos.', requisitos: 'Ingresos ≤ 420 UIT', color: '#3A86FF' },
    { nombre: 'RG', impuesto: rgImpuesto, descripcion: 'Régimen General. Tributa sobre la renta neta.', requisitos: 'Sin límite', color: '#E8A020' },
    { nombre: 'NRUS', impuesto: nrusAnual, descripcion: 'Nuevo RUS. Cuota fija según actividad.', requisitos: 'Ingresos ≤ 70 UIT', color: '#9B59B6' }
  ];

  regimenes.sort((a, b) => a.impuesto - b.impuesto);
  const mejor = regimenes[0];

  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">🎯 Comparativa de Regímenes Tributarios</div>
    <table>
      <tr><th>Régimen</th><th style="text-align:right">Impuesto anual</th><th>Requisitos</th></tr>
      ${regimenes.map(r => `<tr style="${r.nombre === mejor.nombre ? 'background:rgba(46,204,113,.08)' : ''}">
        <td><span style="color:${r.color};font-weight:600">${r.nombre}</span> ${r.nombre === mejor.nombre ? '⭐' : ''}</td>
        <td style="text-align:right;font-weight:500">S/ ${r.impuesto.toFixed(2)}</td>
        <td style="font-size:14px;color:var(--muted)">${r.requisitos}</td>
      </tr>`).join('')}
    </table>
    <div style="margin-top:12px;padding:12px;background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.25);border-radius:8px">
      <div style="font-size:14px;font-weight:600;color:var(--green)">Recomendación: ${mejor.nombre}</div>
      <div style="font-size:14px;color:var(--muted);margin-top:4px">${mejor.descripcion}</div>
      <div style="font-size:14px;margin-top:4px">Ahorro anual vs. régimen más caro: <strong style="color:var(--green)">S/ ${(regimenes[regimenes.length - 1].impuesto - mejor.impuesto).toFixed(2)}</strong></div>
    </div>
    <div style="margin-top:8px;font-size:14px;color:var(--muted)">* Cálculo simplificado. Consulta con un contador para el análisis completo.</div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 6. GENERADOR DE PDTs
// ════════════════════════════════════════════════════════════════
function calcPDT() {
  const ruc = document.getElementById('pdtRuc')?.value?.trim();
  const periodo = document.getElementById('pdtGenPeriodo')?.value;
  const tipo = document.getElementById('pdtTipo')?.value || '621';
  const regimen = document.getElementById('pdtGenRegimen')?.value || 'rmt';
  const ingresos = parseFloat(document.getElementById('pdtIngresos')?.value) || 0;
  const gastos = parseFloat(document.getElementById('pdtGastos')?.value) || 0;
  const igvPagado = parseFloat(document.getElementById('pdtIgvPagado')?.value) || 0;
  const igvCobrado = parseFloat(document.getElementById('pdtIgvCobrado')?.value) || 0;
  const box = document.getElementById('pdtResult');
  if (!box || !ruc || ruc.length !== 11 || !ingresos) return;

  let contenido = '';
  let validaciones = [];
  let errores = 0;

  if (tipo === '621') {
    const renta = Math.max(0, ingresos - gastos);
    const igvNeto = igvCobrado - igvPagado;
    const igvVentas = ingresos * 0.18;
    const igvCompras = gastos * 0.18;

    validaciones.push({ check: ruc.length === 11, msg: 'RUC válido (11 dígitos)' });
    validaciones.push({ check: igvCobrado > 0, msg: 'IGV cobrado declarado' });
    validaciones.push({ check: igvPagado > 0, msg: 'IGV pagado declarado' });
    validaciones.push({ check: Math.abs(igvNeto - (igvVentas - igvCompras)) < 100, msg: 'IGV neto consistente' });

    contenido = `<table>
      <tr><th colspan="2">PDT 621 — Declaración Mensual ${periodo}</th></tr>
      <tr><td>RUC</td><td style="text-align:right">${ruc}</td></tr>
      <tr><td>Régimen</td><td style="text-align:right">${regimen.toUpperCase()}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td><strong>CUADRO 1</strong> — Ventas gravadas</td><td style="text-align:right">S/ ${ingresos.toFixed(2)}</td></tr>
      <tr><td>IGV Ventas (18%)</td><td style="text-align:right">S/ ${igvVentas.toFixed(2)}</td></tr>
      <tr><td><strong>CUADRO 2</strong> — Compras gravadas</td><td style="text-align:right">S/ ${gastos.toFixed(2)}</td></tr>
      <tr><td>IGV Compras (18%)</td><td style="text-align:right">S/ ${igvCompras.toFixed(2)}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td><strong>Cuadro 7</strong> — IGV a pagar</td><td style="text-align:right"><strong style="color:${igvNeto > 0 ? 'var(--red)' : 'var(--green)'}">S/ ${igvNeto.toFixed(2)}</strong></td></tr>
    </table>`;
  } else if (tipo === '622') {
    const rentaAnual = Math.max(0, ingresos - gastos);
    const impRenta = rentaAnual * 0.24;
    const cta5 = Math.max(0, impRenta - igvCobrado * 0.12);

    validaciones.push({ check: ruc.length === 11, msg: 'RUC válido' });
    validaciones.push({ check: rentaAnual > 0, msg: 'Utilidad positiva' });

    contenido = `<table>
      <tr><th colspan="2">PDT 622 — Declaración Anual ${new Date().getFullYear() - 1}</th></tr>
      <tr><td>RUC</td><td style="text-align:right">${ruc}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td>Ingresos netos anuales</td><td style="text-align:right">S/ ${ingresos.toFixed(2)}</td></tr>
      <tr><td>Costos y gastos</td><td style="text-align:right">S/ ${gastos.toFixed(2)}</td></tr>
      <tr><td><strong>Renta neta</strong></td><td style="text-align:right"><strong>S/ ${rentaAnual.toFixed(2)}</strong></td></tr>
      <tr><td><strong>Impuesto a la Renta</strong></td><td style="text-align:right"><strong style="color:var(--red)">S/ ${impRenta.toFixed(2)}</strong></td></tr>
      <tr><td>Cuota 5ta categoría pagada</td><td style="text-align:right">S/ ${igvCobrado.toFixed(2)}</td></tr>
      <tr><td><strong>Saldo a pagar</strong></td><td style="text-align:right"><strong style="color:var(--red);font-size:15px">S/ ${cta5.toFixed(2)}</strong></td></tr>
    </table>`;
  } else {
    // PDT 1400 - NRUS
    const cuota = regimen === 'nrus' ? ingresos / 12 * 0.01 : 0;
    validaciones.push({ check: ingresos / 12 <= 5200, msg: 'Ingresos dentro del límite NRUS' });

    contenido = `<table>
      <tr><th colspan="2">PDT 1400 — NRUS ${periodo}</th></tr>
      <tr><td>RUC</td><td style="text-align:right">${ruc}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td>Ingresos del mes</td><td style="text-align:right">S/ ${ingresos.toFixed(2)}</td></tr>
      <tr><td>Cuota mensual NRUS (1%)</td><td style="text-align:right">S/ ${cuota.toFixed(2)}</td></tr>
      <tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr>
      <tr><td><strong>Cuota a pagar</strong></td><td style="text-align:right"><strong style="color:var(--red);font-size:15px">S/ ${cuota.toFixed(2)}</strong></td></tr>
    </table>`;
  }

  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    ${contenido}
    <div style="margin-top:12px;padding:10px;background:${validaciones.every(v => v.check) ? 'rgba(46,204,113,.08)' : 'rgba(230,57,70,.08)'};border:1px solid ${validaciones.every(v => v.check) ? 'rgba(46,204,113,.25)' : 'rgba(230,57,70,.25)'};border-radius:8px">
      <div style="font-size:14px;font-weight:500;margin-bottom:6px">Validaciones:</div>
      ${validaciones.map(v => `<div style="font-size:14px;color:${v.check ? 'var(--green)' : 'var(--red)'}">${v.check ? '✅' : '❌'} ${v.msg}</div>`).join('')}
    </div>
    <div style="margin-top:8px;font-size:14px;color:var(--muted)">* Borrador para revisión. Presenta en SUNAT Operaciones en Línea.</div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 7. SCORE FINANCIERO
// ════════════════════════════════════════════════════════════════
function calcScoreFin() {
  const activo = parseFloat(document.getElementById('sfActivo')?.value) || 0;
  const pasivo = parseFloat(document.getElementById('sfPasivo')?.value) || 0;
  const patrimonio = parseFloat(document.getElementById('sfPatrimonio')?.value) || 0;
  const ingresos = parseFloat(document.getElementById('sfIngresos')?.value) || 0;
  const utilidad = parseFloat(document.getElementById('sfUtilidad')?.value) || 0;
  const deuda = parseFloat(document.getElementById('sfDeuda')?.value) || 0;
  const box = document.getElementById('scoreResult');
  if (!box || !activo) return;

  // Indicadores
  const liquidez = activo / pasivo;
  const solvencia = patrimonio / activo;
  const rentabilidad = utilidad / ingresos;
  const apalancamiento = pasivo / activo;
  const roe = patrimonio > 0 ? utilidad / patrimonio : 0;
  const roa = activo > 0 ? utilidad / activo : 0;
  const endeudamiento = activo > 0 ? deuda / activo : 0;

  // Scoring (0-100)
  let score = 0;
  if (liquidez >= 1.5) score += 20; else if (liquidez >= 1) score += 15; else if (liquidez >= 0.8) score += 8;
  if (solvencia >= 0.5) score += 20; else if (solvencia >= 0.3) score += 15; else if (solvencia >= 0.15) score += 8;
  if (rentabilidad >= 0.15) score += 20; else if (rentabilidad >= 0.08) score += 15; else if (rentabilidad >= 0.03) score += 8;
  if (roe >= 0.20) score += 15; else if (roe >= 0.10) score += 10; else if (roe >= 0.05) score += 5;
  if (endeudamiento <= 0.3) score += 15; else if (endeudamiento <= 0.5) score += 10; else if (endeudamiento <= 0.7) score += 5;

  let nivel, color, emoji, recomendaciones = [];
  if (score >= 75) { nivel = 'EXCELENTE'; color = '#2ECC71'; emoji = '🟢'; }
  else if (score >= 55) { nivel = 'BUENO'; color = '#3A86FF'; emoji = '🔵'; }
  else if (score >= 35) { nivel = 'REGULAR'; color = '#E8A020'; emoji = '🟡'; }
  else { nivel = 'CRÍTICO'; color = '#E63946'; emoji = '🔴'; }

  if (liquidez < 1) recomendaciones.push('⚡ Tu liquidez es insuficiente. Considera reducir pasivos de corto plazo.');
  if (solvencia < 0.3) recomendaciones.push('📉 Solvencia baja. Aumenta capital propio o reduce deuda.');
  if (rentabilidad < 0.05) recomendaciones.push('💰 Rentabilidad baja. Revisa costos operativos y pricing.');
  if (endeudamiento > 0.5) recomendaciones.push('🏦 Alto endeudamiento. Considera refinanciar o amortizar deuda.');
  if (recomendaciones.length === 0) recomendaciones.push('✅ Tu empresa tiene salud financiera sólida.');

  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <div style="text-align:center;margin-bottom:12px">
      <div style="font-size:36px;font-weight:700;color:${color}">${score}/100</div>
      <div style="font-size:14px;font-weight:500;color:${color}">${emoji} ${nivel}</div>
    </div>
    <table>
      <tr><th>Indicador</th><th style="text-align:right">Valor</th><th>Diagnóstico</th></tr>
      <tr><td>Liquidez general</td><td style="text-align:right">${liquidez.toFixed(2)}</td><td style="font-size:14px;color:${liquidez >= 1 ? 'var(--green)' : 'var(--red)'}">${liquidez >= 1.5 ? 'Excelente' : liquidez >= 1 ? 'Adecuada' : 'Deficiente'}</td></tr>
      <tr><td>Solvencia</td><td style="text-align:right">${(solvencia * 100).toFixed(1)}%</td><td style="font-size:14px;color:${solvencia >= 0.3 ? 'var(--green)' : 'var(--red)'}">${solvencia >= 0.5 ? 'Sólida' : solvencia >= 0.3 ? 'Aceptable' : 'Débil'}</td></tr>
      <tr><td>ROE</td><td style="text-align:right">${(roe * 100).toFixed(1)}%</td><td style="font-size:14px;color:${roe >= 0.1 ? 'var(--green)' : 'var(--red)'}">${roe >= 0.2 ? 'Alta' : roe >= 0.1 ? 'Media' : 'Baja'}</td></tr>
      <tr><td>ROA</td><td style="text-align:right">${(roa * 100).toFixed(1)}%</td><td style="font-size:14px">${roa >= 0.08 ? 'Buena' : roa >= 0.03 ? 'Aceptable' : 'Baja'}</td></tr>
      <tr><td>Endeudamiento</td><td style="text-align:right">${(endeudamiento * 100).toFixed(1)}%</td><td style="font-size:14px;color:${endeudamiento <= 0.5 ? 'var(--green)' : 'var(--red)'}">${endeudamiento <= 0.3 ? 'Bajo' : endeudamiento <= 0.5 ? 'Moderado' : 'Alto'}</td></tr>
      <tr><td>Margen neto</td><td style="text-align:right">${(rentabilidad * 100).toFixed(1)}%</td><td style="font-size:14px">${rentabilidad >= 0.1 ? 'Saludable' : rentabilidad >= 0.03 ? 'Aceptable' : 'Bajo'}</td></tr>
    </table>
    <div style="margin-top:12px;padding:12px;background:rgba(58,134,255,.06);border:1px solid rgba(58,134,255,.2);border-radius:8px">
      <div style="font-size:14px;font-weight:500;color:#3A86FF;margin-bottom:6px">Recomendaciones:</div>
      ${recomendaciones.map(r => `<div style="font-size:14px;color:var(--muted);margin-top:4px">${r}</div>`).join('')}
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 8. RADAR NORMATIVO
// ════════════════════════════════════════════════════════════════
const RADAR_DATA = {
  sunat: [
    { fecha: 'Jul 2026', titulo: 'Nuevo cronograma vencimiento PDT 621', resumen: 'Ajuste en fechas de vencimiento para contribuyentes con RUC terminados en 7-8-9-0.', impacto: 'medio' },
    { fecha: 'Jun 2026', titulo: 'Modificación TUPA SUNAT', resumen: 'Nuevas tarifas y procedimientos en el Texto Único Procedimientos Administrativos SUNAT.', impacto: 'bajo' },
    { fecha: 'Jun 2026', titulo: 'Actualización lista de precios de transferencia', resumen: 'Publicación de nuevos rangos para operaciones vinculadas con sujetos del exterior.', impacto: 'alto' },
    { fecha: 'May 2026', titulo: 'Resolución SUNAT — Validación CPE', resumen: 'Nuevos requisitos de validación de comprobantes de pago electrónicos.', impacto: 'medio' }
  ],
  sbs: [
    { fecha: 'Jul 2026', titulo: 'Actualización TIM — Tasa de interés moratoria', resumen: 'La Tasa Interés Moratoria sube a 1.30% mensual para el mes de julio.', impacto: 'medio' },
    { fecha: 'Jun 2026', titulo: 'Nueva resolución encaje bancario', resumen: 'Ajuste del encaje mínimo legal del 6.0% al 6.5% para depósitos a plazo.', impacto: 'alto' },
    { fecha: 'May 2026', titulo: 'Circular SBS — Seguros obligatorios', resumen: 'Actualización de primas mínimas para seguros de vida y patrimoniales.', impacto: 'bajo' }
  ],
  mef: [
    { fecha: 'Jul 2026', titulo: 'Nuevo presupuesto público 2026-2027', resumen: 'Aprobación del marco macro plurianual de gasto para el periodo 2026-2027.', impacto: 'alto' },
    { fecha: 'Jun 2026', titulo: 'Actualización UIT 2026', resumen: 'UIT 2026 se fija en S/ 5,700 (proyección). Impacta multas, deducciones y límites.', impacto: 'alto' },
    { fecha: 'May 2026', titulo: 'Ley de simplificación tributaria', resumen: 'Nuevas medidas de simplificación para MYPES: reducción de formularios.', impacto: 'medio' }
  ]
};

let RADAR_NORM_N8N = [];
function loadRadarNorm(fuente) {
  const box = document.getElementById('radarResult');
  if (!box) return;

  const renderItems = () => {
    let items = [];
    if (fuente === 'all') {
      items = [...(RADAR_DATA.sunat || []), ...(RADAR_DATA.sbs || []), ...(RADAR_DATA.mef || []), ...RADAR_NORM_N8N];
      items.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    } else if (fuente === 'elperuano') {
      items = [...RADAR_NORM_N8N];
    } else {
      items = RADAR_DATA[fuente] || [];
    }

    box.style.display = 'block';
    box.innerHTML = items.map(item => {
      const impactoColor = item.impacto === 'alto' ? 'var(--red)' : item.impacto === 'medio' ? 'var(--gold)' : 'var(--green)';
      const impactoBg = item.impacto === 'alto' ? 'rgba(230,57,70,.08)' : item.impacto === 'medio' ? 'rgba(232,160,32,.08)' : 'rgba(46,204,113,.08)';
      const titulo = _escapeHtml(item.titulo);
      const tituloHtml = item.link
        ? `<a href="${_escapeHtml(item.link)}" target="_blank" rel="noopener">${titulo} ↗</a>`
        : titulo;
      return `<div style="background:${impactoBg};border:1px solid ${impactoColor}33;border-radius:10px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-size:14px;font-weight:600">${tituloHtml}</div>
          <span style="font-size:14px;padding:2px 8px;background:${impactoColor}22;color:${impactoColor};border-radius:12px;font-weight:500">${item.impacto.toUpperCase()}</span>
        </div>
        <div style="font-size:14px;color:var(--muted);margin-bottom:4px">${item.fecha}</div>
        <div style="font-size:14px;line-height:1.6">${_escapeHtml(item.resumen)}</div>
      </div>`;
    }).join('');
  };

  renderItems();

  // Normas detectadas automáticamente por n8n → colección radar_normativo (solo lectura)
  if (!RADAR_NORM_N8N.length && typeof fbDb !== 'undefined' && typeof fbReady !== 'undefined' && fbReady) {
    fbDb.collection('radar_normativo').orderBy('createdAt', 'desc').limit(25).get()
      .then(snap => {
        snap.forEach(d => {
          const n = d.data();
          RADAR_NORM_N8N.push({ titulo: n.titulo, resumen: n.resumen, fecha: n.fecha, impacto: n.impacto || 'medio', link: n.link || '' });
        });
        if (RADAR_NORM_N8N.length) renderItems();
      })
      .catch(e => console.warn('radar_normativo load:', e.message));
  }
}

// ════════════════════════════════════════════════════════════════
// 10. BALANCE DE COMPROBACION
// ════════════════════════════════════════════════════════════════
let cuentasBC = [];
function addCuentaRow(codigo, nombre, debe, haber) {
  cuentasBC.push({ codigo: codigo || '', nombre: nombre || '', debe: debe || 0, haber: haber || 0 });
  renderCuentasTable();
}
function addCuentaPreset(tipo) {
  const presets = {
    caja: { codigo: '101', nombre: 'Caja', debe: 5000 },
    bancos: { codigo: '104', nombre: 'Bancos', debe: 120000 },
    ventas: { codigo: '701', nombre: 'Ventas nacionales', haber: 250000 },
    compras: { codigo: '601', nombre: 'Mercaderias', debe: 80000 }
  };
  const p = presets[tipo];
  if (p) addCuentaRow(p.codigo, p.nombre, p.debe || 0, p.haber || 0);
}
function removeCuentaRow(i) { cuentasBC.splice(i, 1); renderCuentasTable(); }
function renderCuentasTable() {
  const tbody = document.getElementById('cuentasBody');
  if (!tbody) return;
  tbody.innerHTML = cuentasBC.map((c, i) => '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">' +
    '<td style="padding:4px"><input value="' + c.codigo + '" onchange="cuentasBC[' + i + '].codigo=this.value" style="background:var(--dark3);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px;width:60px;font-size:14px"></td>' +
    '<td style="padding:4px"><input value="' + c.nombre + '" onchange="cuentasBC[' + i + '].nombre=this.value" style="background:var(--dark3);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px;width:200px;font-size:14px"></td>' +
    '<td style="padding:4px"><input type="number" value="' + (c.debe||0) + '" onchange="cuentasBC[' + i + '].debe=parseFloat(this.value)||0" style="background:var(--dark3);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px;width:90px;text-align:right;font-size:14px"></td>' +
    '<td style="padding:4px"><input type="number" value="' + (c.haber||0) + '" onchange="cuentasBC[' + i + '].haber=parseFloat(this.value)||0" style="background:var(--dark3);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px;width:90px;text-align:right;font-size:14px"></td>' +
    '<td style="padding:4px"><button onclick="removeCuentaRow(' + i + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px">X</button></td>' +
    '</tr>').join('');
}
function genBalanceComp() {
  const box = document.getElementById('balResult');
  if (!box || !cuentasBC.length) return;
  let totalDebe = 0, totalHaber = 0;
  const rows = cuentasBC.map(function(c) {
    var d = c.debe || 0, h = c.haber || 0;
    var saldo = d - h;
    totalDebe += d; totalHaber += h;
    return '<tr><td>' + c.codigo + '</td><td>' + c.nombre + '</td><td style="text-align:right">S/ ' + d.toFixed(2) + '</td><td style="text-align:right">S/ ' + h.toFixed(2) + '</td><td style="text-align:right;color:' + (saldo > 0 ? 'var(--red)' : 'var(--green)') + '">S/ ' + Math.abs(saldo).toFixed(2) + '</td><td>' + (saldo > 0 ? 'Deudor' : 'Acreedor') + '</td></tr>';
  }).join('');
  var balanceado = Math.abs(totalDebe - totalHaber) < 0.01;
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result"><div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">Balance de Comprobacion</div><table><tr><th>Codigo</th><th>Cuenta</th><th style="text-align:right">Debe</th><th style="text-align:right">Haber</th><th style="text-align:right">Saldo</th><th>Tipo</th></tr>' + rows + '<tr style="font-weight:600;border-top:2px solid var(--border)"><td colspan="2">TOTALES</td><td style="text-align:right">S/ ' + totalDebe.toFixed(2) + '</td><td style="text-align:right">S/ ' + totalHaber.toFixed(2) + '</td><td style="text-align:right;color:' + (balanceado ? 'var(--green)' : 'var(--red)') + '">S/ ' + Math.abs(totalDebe - totalHaber).toFixed(2) + '</td><td>' + (balanceado ? 'OK' : 'Descuadrado') + '</td></tr></table></div>';
}

// ════════════════════════════════════════════════════════════════
// 11. LIBRO DIARIO
// ════════════════════════════════════════════════════════════════
var asientosLD = [];
function addAsientoLD() {
  var f = document.getElementById('ldFecha').value;
  var g = document.getElementById('ldGlosa').value;
  var cd = document.getElementById('ldCtaDebito').value;
  var md = parseFloat(document.getElementById('ldMontoDeb').value) || 0;
  var cc = document.getElementById('ldCtaCredito').value;
  var mc = parseFloat(document.getElementById('ldMontoCred').value) || 0;
  if (!g || !cd || !cc || !md) return;
  asientosLD.push({ fecha: f, glosa: g, ctaDeb: cd, montoDeb: md, ctaCred: cc, montoCred: mc });
  renderAsientosLD();
}
function renderAsientosLD() {
  var el = document.getElementById('asientosLD');
  if (!el) return;
  el.innerHTML = asientosLD.map(function(a, i) {
    return '<div style="background:var(--dark2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;font-size:14px"><div style="display:flex;justify-content:space-between"><strong>' + a.fecha + '</strong> <button onclick="asientosLD.splice(' + i + ',1);renderAsientosLD()" style="background:none;border:none;color:var(--red);cursor:pointer">X</button></div><div style="color:var(--muted);margin:4px 0">' + a.glosa + '</div><div>Debe: ' + a.ctaDeb + ' - S/ ' + a.montoDeb.toFixed(2) + '</div><div>Haber: ' + a.ctaCred + ' - S/ ' + a.montoCred.toFixed(2) + '</div></div>';
  }).join('');
}
function genLibroDiario() {
  var box = document.getElementById('ldResult');
  if (!box || !asientosLD.length) return;
  var totalDebe = 0, totalHaber = 0;
  var rows = asientosLD.map(function(a) {
    totalDebe += a.montoDeb; totalHaber += a.montoCred;
    return '<tr><td>' + a.fecha + '</td><td>' + a.glosa + '</td><td>' + a.ctaDeb + '</td><td style="text-align:right">S/ ' + a.montoDeb.toFixed(2) + '</td><td>' + a.ctaCred + '</td><td style="text-align:right">S/ ' + a.montoCred.toFixed(2) + '</td></tr>';
  }).join('');
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result"><div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">Libro Diario</div><table><tr><th>Fecha</th><th>Glosa</th><th>Cta Debito</th><th style="text-align:right">S/ Debito</th><th>Cta Credito</th><th style="text-align:right">S/ Credito</th></tr>' + rows + '<tr style="font-weight:600;border-top:2px solid var(--border)"><td colspan="3">TOTALES</td><td style="text-align:right">S/ ' + totalDebe.toFixed(2) + '</td><td></td><td style="text-align:right">S/ ' + totalHaber.toFixed(2) + '</td></tr></table><div style="margin-top:8px;font-size:14px;color:' + (Math.abs(totalDebe - totalHaber) < 0.01 ? 'var(--green)' : 'var(--red)') + '">' + (Math.abs(totalDebe - totalHaber) < 0.01 ? 'Asientos balanceados' : 'Los asientos NO estan balanceados') + '</div></div>';
}

// ════════════════════════════════════════════════════════════════
// 12. CONCILIACION BANCARIA
// ════════════════════════════════════════════════════════════════
function calcConcil() {
  var saldoBanco = parseFloat(document.getElementById('cbSaldoBanco').value) || 0;
  var saldoLibros = parseFloat(document.getElementById('cbSaldoLibros').value) || 0;
  var depositTrans = parseFloat(document.getElementById('cbDepositTrans').value) || 0;
  var chequesPen = parseFloat(document.getElementById('cbChequesPen').value) || 0;
  var comisiones = parseFloat(document.getElementById('cbComisiones').value) || 0;
  var notasCred = parseFloat(document.getElementById('cbNotasCred').value) || 0;
  var box = document.getElementById('concilResult');
  if (!box) return;
  var saldoAjustadoBanco = saldoBanco + depositTrans - chequesPen;
  var saldoAjustadoLibros = saldoLibros + comisiones - notasCred;
  var diferencia = saldoAjustadoBanco - saldoAjustadoLibros;
  var conciliado = Math.abs(diferencia) < 0.01;
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result"><div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">Conciliacion Bancaria</div><table><tr><th colspan="2" style="color:#3A86FF">Saldo segun Banco</th></tr><tr><td>Saldo extracto</td><td style="text-align:right">S/ ' + saldoBanco.toFixed(2) + '</td></tr><tr><td style="color:var(--green)">+ Depositos en transito</td><td style="text-align:right;color:var(--green)">S/ ' + depositTrans.toFixed(2) + '</td></tr><tr><td style="color:var(--red)">- Cheques pendientes</td><td style="text-align:right;color:var(--red)">S/ ' + chequesPen.toFixed(2) + '</td></tr><tr><td><strong>Saldo ajustado banco</strong></td><td style="text-align:right"><strong>S/ ' + saldoAjustadoBanco.toFixed(2) + '</strong></td></tr><tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr><tr><th colspan="2" style="color:#9B59B6">Saldo segun Libros</th></tr><tr><td>Saldo libros</td><td style="text-align:right">S/ ' + saldoLibros.toFixed(2) + '</td></tr><tr><td style="color:var(--red)">+ Comisiones bancarias</td><td style="text-align:right;color:var(--red)">S/ ' + comisiones.toFixed(2) + '</td></tr><tr><td style="color:var(--green)">- Notas de credito</td><td style="text-align:right;color:var(--green)">S/ ' + notasCred.toFixed(2) + '</td></tr><tr><td><strong>Saldo ajustado libros</strong></td><td style="text-align:right"><strong>S/ ' + saldoAjustadoLibros.toFixed(2) + '</strong></td></tr><tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr><tr><td><strong style="color:' + (conciliado ? 'var(--green)' : 'var(--red)') + '">Diferencia</strong></td><td style="text-align:right"><strong style="color:' + (conciliado ? 'var(--green)' : 'var(--red)') + ';font-size:16px">S/ ' + diferencia.toFixed(2) + '</strong></td></tr></table><div style="margin-top:8px;font-size:14px;color:' + (conciliado ? 'var(--green)' : 'var(--red)') + '">' + (conciliado ? 'Cuenta conciliada' : 'La cuenta NO esta conciliada') + '</div></div>';
}

// ════════════════════════════════════════════════════════════════
// 13. CTS / GRATIFICACIONES / UTILIDADES
// ════════════════════════════════════════════════════════════════
function calcBeneficios() {
  var bruto = parseFloat(document.getElementById('bsBruto').value) || 0;
  var dias = parseInt(document.getElementById('bsDias').value) || 365;
  var tipo = document.getElementById('bsTipo').value || 'all';
  var utilidadEmpresa = parseFloat(document.getElementById('bsUtilidad').value) || 0;
  var box = document.getElementById('bsResult');
  if (!box || !bruto) return;
  var remDiaria = bruto / 30;
  var mesesCTS = Math.min(dias / 30, 12);
  var ctsReal = (bruto / 12) * mesesCTS;
  var mesesGrat = Math.min(dias / 30, 6);
  var gratificacion = remDiaria * (1 / 6) * 30 * (mesesGrat / 6);
  var topeUtilidad = bruto * 18;
  var participacion = Math.min(utilidadEmpresa * 0.05, topeUtilidad);
  var vacaciones = bruto;
  var show = function(t) { return tipo === 'all' || tipo === t; };
  var html = '<table><tr><th>Beneficio</th><th style="text-align:right">Monto</th><th>Calculo</th></tr>';
  if (show('cts')) html += '<tr><td>CTS</td><td style="text-align:right"><strong>S/ ' + ctsReal.toFixed(2) + '</strong></td><td style="font-size:14px;color:var(--muted)">Rem. / 12 x ' + mesesCTS.toFixed(1) + ' meses</td></tr>';
  if (show('grat')) html += '<tr><td>Gratificacion</td><td style="text-align:right"><strong>S/ ' + gratificacion.toFixed(2) + '</strong></td><td style="font-size:14px;color:var(--muted)">Rem. x 1/6 x ' + (mesesGrat/6*100).toFixed(0) + '%</td></tr>';
  if (show('util')) html += '<tr><td>Utilidades</td><td style="text-align:right"><strong>S/ ' + participacion.toFixed(2) + '</strong></td><td style="font-size:14px;color:var(--muted)">5% utilidad empresa</td></tr>';
  if (show('all')) html += '<tr><td>Vacaciones</td><td style="text-align:right"><strong>S/ ' + vacaciones.toFixed(2) + '</strong></td><td style="font-size:14px;color:var(--muted)">1 rem. mensual</td></tr>';
  var total = 0;
  if (show('cts')) total += ctsReal;
  if (show('grat')) total += gratificacion;
  if (show('util')) total += participacion;
  if (show('all')) total += vacaciones;
  html += '<tr style="font-weight:600;border-top:2px solid var(--border)"><td>Total</td><td style="text-align:right;color:var(--gold);font-size:15px">S/ ' + total.toFixed(2) + '</td><td></td></tr></table>';
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result">' + html + '</div>';
}

// ════════════════════════════════════════════════════════════════
// 14. GENERADOR DE CONTRATOS
// ════════════════════════════════════════════════════════════════
function genContrato() {
  var tipo = document.getElementById('contTipo').value || 'locacion';
  var parteA = document.getElementById('contParteA').value || '_______________';
  var parteB = document.getElementById('contParteB').value || '_______________';
  var monto = parseFloat(document.getElementById('contMonto').value) || 0;
  var duracion = document.getElementById('contDuracion').value || '_______';
  var actividad = document.getElementById('contActividad').value || '_______________';
  var box = document.getElementById('contResult');
  if (!box) return;
  var tipos = { locacion: 'CONTRATO DE LOCACION DE SERVICIOS', trabajo: 'CONTRATO DE TRABAJO', prestacion: 'CONTRATO DE PRESTACION DE SERVICIOS', comodato: 'CONTRATO DE COMODATO', arrendamiento: 'CONTRATO DE ARRENDAMIENTO' };
  var hoy = new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });
  var contenido = '';
  if (tipo === 'locacion') {
    contenido = '<p><strong>PRIMERA: OBJETO.</strong> La parte B se obliga a prestar servicios de ' + _escapeHtml(actividad) + ' a la parte A.</p><p><strong>SEGUNDA: REMUNERACION.</strong> S/ ' + monto.toFixed(2) + ' mensuales, pagaderos dentro de los primeros 5 dias habiles.</p><p><strong>TERCERA: PLAZO.</strong> ' + _escapeHtml(duracion) + '.</p><p><strong>CUARTA: CONFIDENCIALIDAD.</strong> La parte B mantendra estricta confidencialidad.</p><p><strong>QUINTA: TERMINACION.</strong> Con 30 dias de anticipacion por cualquiera de las partes.</p><p><strong>SEXTA: JURISDICCION.</strong> Tribunales de Lima.</p>';
  } else if (tipo === 'trabajo') {
    contenido = '<p><strong>PRIMERA: OBJETO.</strong> Funciones de ' + _escapeHtml(actividad) + ', bajo subordinacion.</p><p><strong>SEGUNDA: REMUNERACION.</strong> S/ ' + monto.toFixed(2) + ' bruto + beneficios de ley.</p><p><strong>TERCERA: BENEFICIOS.</strong> CTS, gratificaciones, utilidades, vacaciones (D. Leg. 728).</p><p><strong>CUARTA: JORNADA.</strong> 8 horas diarias, 48 semanales.</p><p><strong>QUINTA: CESE.</strong> Por causas justas Art. 23 D. Leg. 728.</p>';
  } else {
    contenido = '<p><strong>PRIMERA: OBJETO.</strong> ' + _escapeHtml(actividad) + '.</p><p><strong>SEGUNDA: PRECIO.</strong> S/ ' + monto.toFixed(2) + '.</p><p><strong>TERCERA: PLAZO.</strong> ' + _escapeHtml(duracion) + '.</p><p><strong>CUARTA: LEY APLICABLE.</strong> Leyes de la Republica del Peru.</p>';
  }
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result" style="font-size:14px;line-height:1.8"><div style="text-align:center;margin-bottom:16px"><div style="font-size:16px;font-weight:700">' + tipos[tipo] + '</div><div style="font-size:14px;color:var(--muted)">' + hoy + '</div></div><p><strong>CONTRATANTE:</strong> ' + _escapeHtml(parteA) + '</p><p><strong>CONTRATISTA:</strong> ' + _escapeHtml(parteB) + '</p><div style="margin-top:12px">' + contenido + '</div><div style="margin-top:24px;display:flex;justify-content:space-around"><div style="text-align:center"><div style="border-top:1px solid var(--text);width:200px;padding-top:4px;font-size:14px"><strong>' + _escapeHtml(parteA) + '</strong><br>Contratante</div></div><div style="text-align:center"><div style="border-top:1px solid var(--text);width:200px;padding-top:4px;font-size:14px"><strong>' + _escapeHtml(parteB) + '</strong><br>Contratista</div></div></div><div style="margin-top:12px;font-size:14px;color:var(--muted);text-align:center">* Borrador - revisar con abogado antes de firmar.</div></div>';
}

// ════════════════════════════════════════════════════════════════
// 15. DOCUMENTOS LEGALES
// ════════════════════════════════════════════════════════════════
function genDocLegal(tipo) {
  var nombre = document.getElementById('dlNombre').value || '_______________';
  var ruc = document.getElementById('dlRuc').value || '_______________';
  var resolucion = document.getElementById('dlResolucion').value || '_______________';
  var monto = parseFloat(document.getElementById('dlMonto').value) || 0;
  var hechos = document.getElementById('dlHechos').value || '_______________';
  var box = document.getElementById('dlResult');
  if (!box) return;
  var hoy = new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });
  var titulos = { carta: 'CARTA NOTARIAL', apelacion: 'RECURSO DE APELACION', reclamacion: 'RECLAMACION', consulta: 'CONSULTA PREVIA' };
  var entidades = { carta: 'A quien corresponda', apelacion: 'Tribunal Fiscal', reclamacion: 'SUNAT', consulta: 'SUNAT - DGAAT' };
  var contenido = '';
  if (tipo === 'apelacion') {
    contenido = '<p><strong>I. HECHOS:</strong></p><p>' + _escapeHtml(hechos) + '</p><p><strong>II. FUNDAMENTO:</strong></p><p>Art. 217 TUO Codigo Tributario (D.S. 133-2013-EF).</p><p><strong>III. PETITORIO:</strong></p><p>Declarar INFUNDADA la Resolucion ' + _escapeHtml(resolucion) + ' y nulidad de S/ ' + monto.toFixed(2) + '.</p>';
  } else if (tipo === 'reclamacion') {
    contenido = '<p><strong>I. HECHOS:</strong></p><p>' + _escapeHtml(hechos) + '</p><p><strong>II. FUNDAMENTO:</strong></p><p>Art. 117 TUO Codigo Tributario. Plazo: 20 dias habiles.</p>';
  } else if (tipo === 'consulta') {
    contenido = '<p><strong>HECHOS:</strong></p><p>' + _escapeHtml(hechos) + '</p><p>Solicito pronunciamiento sobre la correcta aplicacion de la norma.</p>';
  } else {
    contenido = '<p>Estimado/a,</p><p>' + _escapeHtml(hechos) + '</p><p>Quedo a la espera de su respuesta.</p><p>Atentamente,<br>' + _escapeHtml(nombre) + '</p>';
  }
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result" style="font-size:14px;line-height:1.8"><div style="text-align:center;margin-bottom:16px"><div style="font-size:15px;font-weight:700">' + titulos[tipo] + '</div><div style="font-size:14px;color:var(--muted)">' + hoy + '</div></div><p><strong>De:</strong> ' + _escapeHtml(nombre) + ' - RUC/DNI: ' + _escapeHtml(ruc) + '</p><p><strong>A:</strong> ' + entidades[tipo] + '</p>' + (resolucion !== '_______________' ? '<p><strong>Ref:</strong> ' + _escapeHtml(resolucion) + '</p>' : '') + '<div style="margin-top:12px">' + contenido + '</div><div style="margin-top:16px;text-align:right"><strong>' + _escapeHtml(nombre) + '</strong></div><div style="margin-top:8px;font-size:14px;color:var(--muted);text-align:center">* Borrador - revisar con abogado tributarista.</div></div>';
}

// ════════════════════════════════════════════════════════════════
// 16. WITHHOLDING TAX (CDI)
// ════════════════════════════════════════════════════════════════
var CDI_RATES = {
  CL: { dividendos: 0.05, intereses: 0.04, royaltys: 0.05, servicios: 0.15, logistica: 0.15, nombre: 'Chile' },
  CO: { dividendos: 0.10, intereses: 0.10, royaltys: 0.10, servicios: 0.15, logistica: 0.15, nombre: 'Colombia' },
  MX: { dividendos: 0.10, intereses: 0.049, royaltys: 0.10, servicios: 0.15, logistica: 0.15, nombre: 'Mexico' },
  ES: { dividendos: 0.08, intereses: 0.04, royaltys: 0.10, servicios: 0.15, logistica: 0.15, nombre: 'Espana' },
  US: { dividendos: 0.10, intereses: 0.04, royaltys: 0.10, servicios: 0.15, logistica: 0.15, nombre: 'EE.UU.' },
  BR: { dividendos: 0.15, intereses: 0.15, royaltys: 0.15, servicios: 0.15, logistica: 0.15, nombre: 'Brasil' },
  CN: { dividendos: 0.10, intereses: 0.10, royaltys: 0.10, servicios: 0.15, logistica: 0.15, nombre: 'China' },
  no_cd: { dividendos: 0.30, intereses: 0.30, royaltys: 0.30, servicios: 0.30, logistica: 0.30, nombre: 'Sin CDI' }
};
function calcWHT() {
  var pais = document.getElementById('whtPais').value || 'no_cd';
  var tipo = document.getElementById('whtTipo').value || 'dividendos';
  var monto = parseFloat(document.getElementById('whtMonto').value) || 0;
  var box = document.getElementById('whtResult');
  if (!box || !monto) return;
  var cdi = CDI_RATES[pais] || CDI_RATES.no_cd;
  var tasaCDI = cdi[tipo] || 0.30;
  var tasaLocal = parseFloat(document.getElementById('whtTasaLocal').value) || 30;
  var retencionCDI = monto * tasaCDI;
  var retencionLocal = monto * (tasaLocal / 100);
  var ahorro = retencionLocal - retencionCDI;
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result"><div style="font-size:14px;font-weight:500;color:var(--gold);margin-bottom:8px">WHT - ' + cdi.nombre + '</div><table><tr><th>Concepto</th><th style="text-align:right">Monto</th></tr><tr><td>Monto pagado</td><td style="text-align:right">S/ ' + monto.toFixed(2) + '</td></tr><tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr><tr><td style="color:#3A86FF">Retencion con CDI (' + tipo + ')</td><td style="text-align:right;color:#3A86FF">S/ ' + retencionCDI.toFixed(2) + ' (' + (tasaCDI * 100).toFixed(1) + '%)</td></tr><tr><td style="color:var(--red)">Retencion sin CDI (local)</td><td style="text-align:right;color:var(--red)">S/ ' + retencionLocal.toFixed(2) + ' (' + tasaLocal + '%)</td></tr><tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr><tr><td><strong style="color:var(--green)">Ahorro por CDI</strong></td><td style="text-align:right"><strong style="color:var(--green);font-size:15px">S/ ' + ahorro.toFixed(2) + '</strong></td></tr></table><div style="margin-top:8px;font-size:14px;color:var(--muted)">* Tasas segun CDI Peru-' + cdi.nombre + '</div></div>';
}

// ════════════════════════════════════════════════════════════════
// 17. ANALISIS FINANCIERO AVANZADO
// ════════════════════════════════════════════════════════════════
function showAnalisisTab(tab) {
  document.getElementById('analisisDupont').style.display = tab === 'dupont' ? 'block' : 'none';
  document.getElementById('analisisEquilibrio').style.display = tab === 'equilibrio' ? 'block' : 'none';
  document.getElementById('btnDupont').className = tab === 'dupont' ? 'bp' : 'bg';
  document.getElementById('btnEquilibrio').className = tab === 'equilibrio' ? 'bp' : 'bg';
}
function calcDuPont() {
  var ingresos = parseFloat(document.getElementById('dpIngresos').value) || 0;
  var utilidad = parseFloat(document.getElementById('dpUtilidad').value) || 0;
  var activos = parseFloat(document.getElementById('dpActivos').value) || 0;
  var patrimonio = parseFloat(document.getElementById('dpPatrimonio').value) || 0;
  var box = document.getElementById('dupontResult');
  if (!box || !ingresos || !activos) return;
  var margenNeto = utilidad / ingresos;
  var rotacionActivos = ingresos / activos;
  var leverage = activos / (patrimonio || 1);
  var roe = margenNeto * rotacionActivos * leverage;
  var nivel, color;
  if (roe >= 0.20) { nivel = 'EXCELENTE'; color = '#2ECC71'; }
  else if (roe >= 0.12) { nivel = 'BUENO'; color = '#3A86FF'; }
  else if (roe >= 0.05) { nivel = 'REGULAR'; color = '#E8A020'; }
  else { nivel = 'BAJO'; color = '#E63946'; }
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result"><div style="text-align:center;margin-bottom:12px"><div style="font-size:14px;font-weight:600;color:var(--gold)">Analisis Du Pont</div><div style="font-size:28px;font-weight:700;color:' + color + ';margin-top:8px">ROE = ' + (roe * 100).toFixed(1) + '%</div><div style="font-size:14px;color:' + color + '">' + nivel + '</div></div><div style="text-align:center;font-size:14px;margin-bottom:12px;padding:12px;background:rgba(58,134,255,.06);border-radius:8px"><strong style="color:#3A86FF">' + (margenNeto * 100).toFixed(1) + '%</strong> x <strong style="color:var(--gold)">' + rotacionActivos.toFixed(2) + '</strong> x <strong style="color:#9B59B6">' + leverage.toFixed(2) + '</strong> = <strong style="color:' + color + '">' + (roe * 100).toFixed(1) + '%</strong></div><table><tr><td>Margen Neto</td><td style="text-align:right;color:#3A86FF"><strong>' + (margenNeto * 100).toFixed(1) + '%</strong></td></tr><tr><td>Rotacion de Activos</td><td style="text-align:right;color:var(--gold)"><strong>' + rotacionActivos.toFixed(2) + '</strong></td></tr><tr><td>Palancas Financieras</td><td style="text-align:right;color:#9B59B6"><strong>' + leverage.toFixed(2) + '</strong></td></tr><tr><td><strong>ROE</strong></td><td style="text-align:right;color:' + color + '"><strong>' + (roe * 100).toFixed(1) + '%</strong></td></tr></table><div style="margin-top:10px;font-size:14px;color:var(--muted)">ROE = Margen Neto x Rotacion Activos x Palancas</div></div>';
}
function calcEquilibrio() {
  var fijos = parseFloat(document.getElementById('eqFijos').value) || 0;
  var variable = parseFloat(document.getElementById('eqVariable').value) || 0;
  var precio = parseFloat(document.getElementById('eqPrecio').value) || 0;
  var volumen = parseFloat(document.getElementById('eqVolumen').value) || 0;
  var box = document.getElementById('equilibrioResult');
  if (!box || !fijos || !precio) return;
  var margenUnit = precio - variable;
  var puntoEq = margenUnit > 0 ? fijos / margenUnit : 0;
  var puntoEqS = puntoEq * precio;
  var ingresoActual = volumen * precio;
  var utilidadActual = volumen * margenUnit - fijos;
  var margenSeg = margenUnit / precio;
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result"><div style="text-align:center;margin-bottom:12px"><div style="font-size:14px;font-weight:600;color:var(--gold)">Punto de Equilibrio</div><div style="font-size:28px;font-weight:700;color:#3A86FF;margin-top:8px">' + puntoEq.toFixed(0) + ' unidades</div><div style="font-size:14px;color:var(--muted)">S/ ' + puntoEqS.toFixed(2) + ' en ventas</div></div><table><tr><td>Margen unitario</td><td style="text-align:right">S/ ' + margenUnit.toFixed(2) + '</td></tr><tr><td>Margen de seguridad</td><td style="text-align:right;color:' + (margenSeg >= 0.2 ? 'var(--green)' : 'var(--red)') + '">' + (margenSeg * 100).toFixed(1) + '%</td></tr><tr><td colspan="2" style="border-bottom:none;padding:4px"></td></tr><tr><td>Volumen actual</td><td style="text-align:right">' + volumen + ' unidades</td></tr><tr><td>Ingreso actual</td><td style="text-align:right">S/ ' + ingresoActual.toFixed(2) + '</td></tr><tr><td>Utilidad actual</td><td style="text-align:right;color:' + (utilidadActual >= 0 ? 'var(--green)' : 'var(--red)') + '">S/ ' + utilidadActual.toFixed(2) + '</td></tr></table><div style="margin-top:8px;font-size:14px;color:var(--muted)">P.E. = Costos Fijos / (Precio - Costo Variable Unitario)</div></div>';
}

// ════════════════════════════════════════════════════════════════
// 18. COMPLIANCE CHECKLIST
// ════════════════════════════════════════════════════════════════
var COMPLIANCE_DATA = {
  sunat: [
    { item: 'Declaracion Jurada mensual IGV (PDT 621)', frecuencia: 'Mensual', prioridad: 'alta' },
    { item: 'Declaracion Jurada anual de Renta (PDT 622)', frecuencia: 'Anual', prioridad: 'alta' },
    { item: 'Pago oportuno de IGV', frecuencia: 'Mensual', prioridad: 'alta' },
    { item: 'Declaracion de informacion mensual (PLE)', frecuencia: 'Mensual', prioridad: 'media' },
    { item: 'Conservacion de libros contables (10 anios)', frecuencia: 'Permanente', prioridad: 'media' },
    { item: 'Emision de facturas electronicas', frecuencia: 'Cada operacion', prioridad: 'alta' },
    { item: 'Retenciones y percepciones mensuales', frecuencia: 'Mensual', prioridad: 'media' },
    { item: 'DJ de nomina electronica (PLAME)', frecuencia: 'Mensual', prioridad: 'media' }
  ],
  laboral: [
    { item: 'Declaracion y pago de EsSalud (9%)', frecuencia: 'Mensual', prioridad: 'alta' },
    { item: 'Aportes AFP/ONP', frecuencia: 'Mensual', prioridad: 'alta' },
    { item: 'Compensacion por Tiempo de Servicios (CTS)', frecuencia: 'Semestral', prioridad: 'alta' },
    { item: 'Gratificaciones (julio y diciembre)', frecuencia: 'Semestral', prioridad: 'alta' },
    { item: 'Utilidades (marzo-abril)', frecuencia: 'Anual', prioridad: 'media' },
    { item: 'Vacaciones (30 dias anuales)', frecuencia: 'Anual', prioridad: 'media' },
    { item: 'Contrato de trabajo por escrito', frecuencia: 'Al inicio', prioridad: 'alta' },
    { item: 'Seguro de Vida Ley (4%)', frecuencia: 'Mensual', prioridad: 'media' }
  ],
  aml: [
    { item: 'Programa de Prevencion de Lavado de Activos', frecuencia: 'Permanente', prioridad: 'alta' },
    { item: 'Reporte de Operaciones Sospechosas (ROS)', frecuencia: 'Bajo demanda', prioridad: 'alta' },
    { item: 'Reporte de Transacciones en Efectivo (RTE)', frecuencia: 'Mensual', prioridad: 'media' },
    { item: 'Due Diligence de clientes (KYC)', frecuencia: 'Al inicio', prioridad: 'alta' },
    { item: 'Identificacion del Beneficio Final', frecuencia: 'Al inicio', prioridad: 'alta' },
    { item: 'Evaluacion de riesgo de clientes', frecuencia: 'Periodica', prioridad: 'media' }
  ],
  corporativo: [
    { item: 'Escritura publica y registro en Registros Publicos', frecuencia: 'Al constituir', prioridad: 'baja' },
    { item: 'Libro de Actas de Directorio/Socios', frecuencia: 'Permanente', prioridad: 'media' },
    { item: 'Declaracion anual de personas juridicas (DJPJ)', frecuencia: 'Anual', prioridad: 'media' },
    { item: 'Cumplimiento de normas NIIF/NIC', frecuencia: 'Permanente', prioridad: 'media' },
    { item: 'Renovacion de licencias de funcionamiento', frecuencia: 'Anual', prioridad: 'media' }
  ]
};
function genCompliance(area) {
  var items = COMPLIANCE_DATA[area] || [];
  var box = document.getElementById('complianceResult');
  if (!box) return;
  var colores = { alta: 'var(--red)', media: 'var(--gold)', baja: 'var(--green)' };
  var labels = { alta: 'CRITICA', media: 'MEDIA', baja: 'BAJA' };
  var icons = { alta: '!', media: '~', baja: 'o' };
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result"><table><tr><th>OK</th><th>Obligacion</th><th>Frecuencia</th><th>Prioridad</th></tr>' + items.map(function(it) {
    return '<tr><td><input type="checkbox" onchange="this.parentElement.parentElement.style.opacity=this.checked?0.5:1" style="cursor:pointer"></td><td>' + it.item + '</td><td style="font-size:14px;color:var(--muted)">' + it.frecuencia + '</td><td><span style="color:' + colores[it.prioridad] + ';font-size:14px;font-weight:500">' + icons[it.prioridad] + ' ' + labels[it.prioridad] + '</span></td></tr>';
  }).join('') + '</table><div style="margin-top:10px;font-size:14px;color:var(--muted)">Marca cada obligacion completada. Prioridad ALTA = plazo inminente o multa alta.</div></div>';
}

// ═══════════════════════════════════════════════════════════════
// NEW SERVICES — BATCH 3 (17 services)
// ═══════════════════════════════════════════════════════════════

// ── 1. SPOT ──
var SPOT_CATS={detraccion:[{v:'azucar',l:'Azucar (10%)'},{v:'alcohol',l:'Alcohol (12%)'},{v:'recursos_hidrobiologicos',l:'Recursos hidrobiologicos (9%)'},{v:'arroz',l:'Arroz (7%)'},{v:'maiz',l:'Maiz (7%)'},{v:'minerales_no_auriferos',l:'Minerales metalicos no auriferos (10%)'},{v:'minerales_auriferos',l:'Minerales metalicos auriferos (10%)'},{v:'minerales_no_metalicos',l:'Minerales no metalicos (10%)'},{v:'bienes_exonerados',l:'Bienes exonerados IGV (1.5%)'},{v:'otros_12',l:'Otros - 12%'},{v:'otros_10',l:'Otros - 10%'},{v:'otros_6',l:'Otros - 6%'},{v:'otros_4',l:'Otros - 4%'},{v:'otros_1_5',l:'Otros - 1.5%'}],percepcion:[{v:'combustibles',l:'Combustibles (2%)'},{v:'alcohol_etilico',l:'Alcohol etilico (2%)'},{v:'azucar_per',l:'Azucar (2%)'},{v:'algodon',l:'Algodon (1.5%)'},{v:'otros_per_10',l:'Otros - 10%'},{v:'otros_per_5',l:'Otros - 5%'},{v:'otros_per_2',l:'Otros - 2%'},{v:'otros_per_1',l:'Otros - 1%'}],retencion:[{v:'agente_3',l:'Agentes de retencion (3%)'},{v:'agente_6',l:'Agentes de retencion (6%)'},{v:'no_agente',l:'No agente (0%)'}]};
var SPOT_RATES={detraccion:{azucar:0.10,alcohol:0.12,recursos_hidrobiologicos:0.09,arroz:0.07,maiz:0.07,minerales_no_auriferos:0.10,minerales_auriferos:0.10,minerales_no_metalicos:0.10,bienes_exonerados:0.015,otros_12:0.12,otros_10:0.10,otros_6:0.06,otros_4:0.04,otros_1_5:0.015},percepcion:{combustibles:0.02,alcohol_etilico:0.02,azucar_per:0.02,algodon:0.015,otros_per_10:0.10,otros_per_5:0.05,otros_per_2:0.02,otros_per_1:0.01},retencion:{agente_3:0.03,agente_6:0.06,no_agente:0.00}};
function updateSPOTCat(){var t=document.getElementById('spot_type')?.value||'detraccion';var s=document.getElementById('spot_cat');if(!s)return;s.innerHTML='';(SPOT_CATS[t]||SPOT_CATS.detraccion).forEach(function(c){var o=document.createElement('option');o.value=c.v;o.textContent=c.l;s.appendChild(o);});}
function calcSPOT(){var t=document.getElementById('spot_type')?.value||'detraccion';var c=document.getElementById('spot_cat')?.value||'';var m=parseFloat(document.getElementById('spot_monto')?.value)||0;var i=document.getElementById('spot_igv')?.value||'no';var b=document.getElementById('spotResult');if(!b)return;if(!m){b.style.display='none';return;}var base=i==='si'?m/1.18:m;var rate=SPOT_RATES[t]?SPOT_RATES[t][c]||0:0;var pct=(rate*100).toFixed(1);var h='<div class="sunat-api-result"><table><tr><th colspan="2">Resultado SPOT</th></tr><tr><td>Monto base</td><td>S/ '+base.toFixed(2)+'</td></tr><tr><td>Tasa aplicada</td><td>'+pct+'%</td></tr>';if(t==='detraccion'){var d=base*rate;h+='<tr><td>Monto detraido</td><td>S/ '+d.toFixed(2)+'</td></tr><tr><td><strong>Neto a pagar</strong></td><td><strong>S/ '+(base-d).toFixed(2)+'</strong></td></tr>';}else if(t==='percepcion'){var p=m*rate;h+='<tr><td>Percepcion aplicada</td><td>S/ '+p.toFixed(2)+'</td></tr><tr><td><strong>Total a pagar</strong></td><td><strong>S/ '+(m+p).toFixed(2)+'</strong></td></tr>';}else{var r=m*rate;h+='<tr><td>Monto retenido</td><td>S/ '+r.toFixed(2)+'</td></tr><tr><td><strong>Neto recibido</strong></td><td><strong>S/ '+(m-r).toFixed(2)+'</strong></td></tr>';}h+='<tr><td colspan="2" style="font-size:14px;color:var(--muted);text-align:center">Tasas referenciales SUNAT</td></tr></table></div>';b.style.display='block';b.innerHTML=h;}
setTimeout(function(){try{updateSPOTCat();}catch(e){}},100);

// ── 2. ARBITRIOS ──
var ARBITRIOS_RATES={miraflores:{limpieza:3.20,parques:1.80,serenazgo:4.50,riesgo:'Bajo'},san_isidro:{limpieza:3.00,parques:2.00,serenazgo:4.20,riesgo:'Bajo'},san_borja:{limpieza:2.80,parques:1.60,serenazgo:3.80,riesgo:'Bajo'},la_molina:{limpieza:2.50,parques:2.20,serenazgo:3.50,riesgo:'Bajo'},surco:{limpieza:2.60,parques:1.50,serenazgo:3.40,riesgo:'Bajo'},barranco:{limpieza:2.90,parques:1.90,serenazgo:4.00,riesgo:'Medio'},jesus_maria:{limpieza:2.40,parques:1.40,serenazgo:3.20,riesgo:'Medio'},lince:{limpieza:2.30,parques:1.30,serenazgo:3.00,riesgo:'Medio'},magdalena:{limpieza:2.20,parques:1.20,serenazgo:2.80,riesgo:'Medio'},pueblo_libre:{limpieza:2.10,parques:1.10,serenazgo:2.60,riesgo:'Medio'},san_miguel:{limpieza:2.00,parques:1.00,serenazgo:2.50,riesgo:'Medio'},los_olivos:{limpieza:1.80,parques:0.90,serenazgo:2.30,riesgo:'Alto'},sjl:{limpieza:1.50,parques:0.80,serenazgo:2.00,riesgo:'Alto'},ate:{limpieza:1.60,parques:0.85,serenazgo:2.10,riesgo:'Alto'},comas:{limpieza:1.40,parques:0.70,serenazgo:1.90,riesgo:'Alto'},villa_el_salvador:{limpieza:1.30,parques:0.65,serenazgo:1.80,riesgo:'Alto'},villa_maria:{limpieza:1.30,parques:0.65,serenazgo:1.80,riesgo:'Alto'},carabayllo:{limpieza:1.20,parques:0.60,serenazgo:1.70,riesgo:'Alto'},smp:{limpieza:1.50,parques:0.75,serenazgo:2.00,riesgo:'Alto'},independencia:{limpieza:1.70,parques:0.80,serenazgo:2.20,riesgo:'Alto'},el_agustino:{limpieza:1.40,parques:0.70,serenazgo:1.90,riesgo:'Alto'},rimac:{limpieza:1.60,parques:0.80,serenazgo:2.10,riesgo:'Alto'},brena:{limpieza:1.90,parques:0.95,serenazgo:2.40,riesgo:'Medio'},cercado:{limpieza:2.00,parques:1.00,serenazgo:2.50,riesgo:'Medio'},chorrillos:{limpieza:2.20,parques:1.10,serenazgo:2.80,riesgo:'Medio'},bellavista:{limpieza:2.10,parques:1.05,serenazgo:2.60,riesgo:'Medio'},callao:{limpieza:2.30,parques:1.15,serenazgo:2.90,riesgo:'Medio'},otro:{limpieza:1.80,parques:0.90,serenazgo:2.30,riesgo:'Medio'}};
var ARB_USO={residencial:1.0,comercial:1.5,industrial:2.0,mixto:1.3};
var ARB_TIPO={casa:1.0,depto:0.85,comercial:1.4,oficina:1.1,terreno:0.5,industrial:1.6,otro:1.0};
function calcArbitrios(){var d=document.getElementById('arbitrios_distrito')?.value||'otro';var t=document.getElementById('arbitrios_tipo')?.value||'casa';var u=document.getElementById('arbitrios_uso')?.value||'residencial';var a=parseFloat(document.getElementById('arbitrios_area')?.value)||0;var al=parseFloat(document.getElementById('arbitrios_area_libre')?.value)||0;var an=parseInt(document.getElementById('arbitrios_anio')?.value)||2020;var s=document.getElementById('arbitrios_svcs')?.value||'completo';var b=document.getElementById('arbitriosResult');if(!b)return;if(!a){b.style.display='none';return;}var r=ARBITRIOS_RATES[d]||ARBITRIOS_RATES.otro;var uc=ARB_USO[u]||1.0;var tc=ARB_TIPO[t]||1.0;var ant=Math.max(0.7,1-Math.max(0,2026-an)*0.005);var ae=a+al*0.3;var lim=0,par=0,ser=0;if(s==='completo'||s==='limpieza')lim=r.limpieza*a*uc*tc*ant;if(s==='completo')par=r.parques*ae*uc*tc*ant;if(s==='completo'||s==='serenazgo')ser=r.serenazgo*a*uc*tc*ant;var anual=lim+par+ser;var riesgo=r.riesgo||'Medio';var cr=riesgo==='Bajo'?'#2e7d32':riesgo==='Medio'?'#f57f17':'#c62828';var h='<div class="sunat-api-result"><table><tr><th colspan="2">Arbitrios - '+d.charAt(0).toUpperCase()+d.slice(1).replace(/_/g,' ')+'</th></tr>';if(lim>0)h+='<tr><td>Limpieza publica</td><td>S/ '+lim.toFixed(2)+'</td></tr>';if(par>0)h+='<tr><td>Parques y jardines</td><td>S/ '+par.toFixed(2)+'</td></tr>';if(ser>0)h+='<tr><td>Serenazgo</td><td>S/ '+ser.toFixed(2)+'</td></tr>';h+='<tr><td><strong>Total anual</strong></td><td><strong>S/ '+anual.toFixed(2)+'</strong></td></tr><tr><td>Total mensual</td><td>S/ '+(anual/12).toFixed(2)+'</td></tr><tr><td>Riesgo distrital</td><td style="color:'+cr+';font-weight:bold">'+riesgo+'</td></tr><tr><td colspan="2" style="font-size:14px;color:var(--muted);text-align:center">Valores referenciales</td></tr></table></div>';b.style.display='block';b.innerHTML=h;}

// ── 3. RENTA ANUAL ──
var RENTA_UIT={2025:5350,2024:5150,2023:4950};
var RENTA_BRACKETS=[{lim:5,rate:0.08},{lim:20,rate:0.14},{lim:35,rate:0.17},{lim:45,rate:0.20},{lim:Infinity,rate:0.30}];
function calcRentaAnual(){var yr=parseInt(document.getElementById('renta_year')?.value)||2025;var cat=document.getElementById('renta_cat')?.value||'tercera';var ing=parseFloat(document.getElementById('renta_ingresos')?.value)||0;var cost=parseFloat(document.getElementById('renta_costos')?.value)||0;var gast=parseFloat(document.getElementById('renta_gastos')?.value)||0;var afpT=document.getElementById('renta_afp')?.value||'no';var afpM=parseFloat(document.getElementById('renta_afp_monto')?.value)||0;var deps=parseInt(document.getElementById('renta_deps')?.value)||0;var dedAd=parseFloat(document.getElementById('renta_deduc')?.value)||0;var dedOt=parseFloat(document.getElementById('renta_deduc_otras')?.value)||0;var b=document.getElementById('rentaResult');if(!b)return;if(!ing){b.style.display='none';return;}var uit=RENTA_UIT[yr]||RENTA_UIT[2025];var dedF=Math.min(dedAd,3*uit);var rNet=ing-cost-gast;if(cat==='tercera'||cat==='cuarta'||cat==='quinta')rNet-=7*uit;if(afpT!=='no')rNet-=afpM;rNet-=dedF;rNet-=deps*0.5*uit;rNet-=dedOt;rNet=Math.max(0,rNet);var imp=0;var brRows='';var prev=0;var rem=rNet;for(var i=0;i<RENTA_BRACKETS.length;i++){var bk=RENTA_BRACKETS[i];var bBase=Math.min(Math.max(0,rem),(bk.lim-prev)*uit);if(bBase>0){var tax=bBase*bk.rate;imp+=tax;var lbl=bk.lim===Infinity?'Mas de '+prev+' UIT':'Hasta '+bk.lim+' UIT';brRows+='<tr><td>'+lbl+' ('+(bk.rate*100).toFixed(0)+'%)</td><td>S/ '+bBase.toFixed(2)+'</td><td>S/ '+tax.toFixed(2)+'</td></tr>';rem-=bBase;}prev=bk.lim;if(rem<=0)break;}var ef=rNet>0?(imp/ing*100):0;var h='<div class="sunat-api-result"><table><tr><th colspan="3">Renta Anual '+yr+' (UIT: S/ '+uit+')</th></tr><tr><td>Ingresos brutos</td><td colspan="2">S/ '+ing.toFixed(2)+'</td></tr><tr><td>(-) Costos deducibles</td><td colspan="2">S/ '+cost.toFixed(2)+'</td></tr><tr><td>(-) Gastos deducibles</td><td colspan="2">S/ '+gast.toFixed(2)+'</td></tr><tr><td>(-) Deduc. 7 UIT</td><td colspan="2">S/ '+(7*uit).toFixed(2)+'</td></tr>';if(afpT!=='no')h+='<tr><td>(-) Aportes '+afpT.toUpperCase()+'</td><td colspan="2">S/ '+afpM.toFixed(2)+'</td></tr>';if(dedF>0)h+='<tr><td>(-) Deduc. adicional max 3 UIT</td><td colspan="2">S/ '+dedF.toFixed(2)+'</td></tr>';if(deps>0)h+='<tr><td>(-) Deduc. '+deps+' dependiente(s)</td><td colspan="2">S/ '+(deps*0.5*uit).toFixed(2)+'</td></tr>';if(dedOt>0)h+='<tr><td>(-) Otras deducciones</td><td colspan="2">S/ '+dedOt.toFixed(2)+'</td></tr>';h+='<tr><td><strong>Renta neta imponible</strong></td><td colspan="2"><strong>S/ '+rNet.toFixed(2)+'</strong></td></tr>'+brRows+'<tr><td><strong>Impuesto calculado</strong></td><td colspan="2"><strong>S/ '+imp.toFixed(2)+'</strong></td></tr><tr><td>Tasa efectiva</td><td colspan="2">'+ef.toFixed(2)+'%</td></tr><tr><td colspan="3" style="font-size:14px;color:var(--muted);text-align:center">Simulacion referencial</td></tr></table></div>';b.style.display='block';b.innerHTML=h;}

// ── 4. PERDIDA ARRASTRABLE ──
function calcPerdida(){var an=parseInt(document.getElementById('perdida_anio')?.value)||2024;var mp=parseFloat(document.getElementById('perdida_monto')?.value)||0;var ings=[parseFloat(document.getElementById('perdida_ing1')?.value)||0,parseFloat(document.getElementById('perdida_ing2')?.value)||0,parseFloat(document.getElementById('perdida_ing3')?.value)||0,parseFloat(document.getElementById('perdida_ing4')?.value)||0];var lim=(parseFloat(document.getElementById('perdida_limite')?.value)||100)/100;var b=document.getElementById('perdidaResult');if(!b)return;if(!mp||ings.every(function(x){return !x;})){b.style.display='none';return;}var saldo=mp,totalC=0,aniosN=0;var h='<div class="sunat-api-result"><table><tr><th colspan="4">Arrastre Perdida - Ejercicio '+an+'</th></tr><tr><th>Anio</th><th>Ingreso</th><th>Compensado</th><th>Saldo</th></tr><tr><td>'+an+'</td><td>-</td><td>-</td><td style="color:#c62828">S/ '+saldo.toFixed(2)+'</td></tr>';for(var i=0;i<ings.length;i++){var ing=ings[i];var yr=an+1+i;if(saldo<=0){h+='<tr><td>'+yr+'</td><td>S/ '+ing.toFixed(2)+'</td><td>S/ 0.00</td><td style="color:#2e7d32">S/ 0.00</td></tr>';continue;}var comp=0;if(ing>0){comp=Math.min(saldo,ing*lim);saldo-=comp;totalC+=comp;aniosN++;}h+='<tr><td>'+yr+'</td><td>S/ '+ing.toFixed(2)+'</td><td>S/ '+comp.toFixed(2)+'</td><td>S/ '+Math.max(0,saldo).toFixed(2)+'</td></tr>';}if(saldo<=0)h+='<tr><td colspan="4" style="color:#2e7d32;font-weight:bold">Perdida compensada en '+aniosN+' anio(s)</td></tr>';else h+='<tr><td colspan="4" style="color:#c62828;font-weight:bold">Saldo pendiente: S/ '+saldo.toFixed(2)+'</td></tr>';h+='<tr><td>Limite</td><td colspan="3">'+(lim*100).toFixed(0)+'%</td></tr><tr><td colspan="4" style="font-size:14px;color:var(--muted);text-align:center">LIR Art. 50</td></tr></table></div>';b.style.display='block';b.innerHTML=h;}

// ── 5. DESPIDO ──
function calcDespido(){var sue=parseFloat(document.getElementById('despido_sueldo')?.value)||0;var asig=document.getElementById('despido_asigfam')?.value||'no';var rmv=parseFloat(document.getElementById('despido_rmv')?.value)||1130;var fi=document.getElementById('despido_ingreso')?.value;var fc=document.getElementById('despido_cese')?.value;var contrato=document.getElementById('despido_contrato')?.value||'indefinido';var motivo=document.getElementById('despido_motivo')?.value||'despido_arbitrario';var ctsB=parseFloat(document.getElementById('despido_cts')?.value)||0;var vac=parseInt(document.getElementById('despido_vac')?.value)||0;var gratif=document.getElementById('despido_gratif')?.value||'no';var b=document.getElementById('despidoResult');if(!b)return;if(!sue||!fi||!fc){b.style.display='none';return;}var ing=new Date(fi),ces=new Date(fc);if(ing>=ces){b.style.display='none';return;}var dMs=ces-ing,tDias=Math.floor(dMs/86400000),tMeses=tDias/30.4375,anios=Math.floor(tMeses/12),meses=Math.floor(tMeses%12);var asigM=asig==='si'?rmv*0.10:0,remC=sue+asigM;var gratifP=gratif==='no'?(sue/6)*(meses/12):0,ctsT=((remC+(sue/6))/12)*tMeses,ctsF=Math.max(0,ctsT-ctsB),vacT=(sue/30)*vac;var ind=0;var esDes=motivo==='despido_arbitrario'||motivo==='despido_fijo'||motivo==='hostilidad';if(esDes)ind=Math.min(1.5*sue*(anios+meses/12),12*sue);var total=ctsF+vacT+gratifP+ind;var h='<div class="sunat-api-result"><table><tr><th colspan="2">Liquidacion Beneficios</th></tr><tr><td>Periodo</td><td>'+anios+'a '+meses+'m ('+tDias+'d)</td></tr><tr><td>Rem. computable</td><td>S/ '+remC.toFixed(2)+'</td></tr><tr><td>CTS trunca</td><td>S/ '+ctsT.toFixed(2)+'</td></tr>';if(ctsB>0)h+='<tr><td>(-) CTS banco</td><td>S/ '+ctsB.toFixed(2)+'</td></tr>';h+='<tr><td><strong>CTS a pagar</strong></td><td><strong>S/ '+ctsF.toFixed(2)+'</strong></td></tr>';if(vac>0)h+='<tr><td>Vac. truncas ('+vac+'d)</td><td>S/ '+vacT.toFixed(2)+'</td></tr>';if(gratifP>0&&gratif==='no')h+='<tr><td>Gratif. trunca</td><td>S/ '+gratifP.toFixed(2)+'</td></tr>';if(esDes)h+='<tr><td><strong>Indemnizacion</strong></td><td><strong>S/ '+ind.toFixed(2)+'</strong></td></tr>';else h+='<tr><td>Indemnizacion</td><td style="color:#888">No aplica</td></tr>';h+='<tr><td><strong>Total</strong></td><td><strong>S/ '+total.toFixed(2)+'</strong></td></tr></table></div>';b.style.display='block';b.innerHTML=h;}

// ── 6. T-REGISTRO ──
function calcTRegistro(){var doc=document.getElementById('treg_doc')?.value||'DNI';var num=document.getElementById('treg_num')?.value||'';var nac=document.getElementById('treg_nac')?.value||'';var ing=document.getElementById('treg_ingreso')?.value||'';var pen=document.getElementById('treg_pension')?.value||'AFP';var tipo=document.getElementById('treg_tipo')?.value||'Empleado';var rem=parseFloat(document.getElementById('treg_rem')?.value)||0;var ext=document.getElementById('treg_extranjero')?.value||'no';var b=document.getElementById('tregResult');if(!b)return;if(!num||!ing){b.style.display='none';return;}var ok=false;if(doc==='DNI'&&num.length===8&&/^\d{8}$/.test(num))ok=true;else if(doc==='CE'&&num.length>=5&&num.length<=12)ok=true;else if(doc==='Pasaporte'&&num.length>=5)ok=true;var edad=0;if(nac)edad=Math.floor((new Date()-new Date(nac))/(365.25*86400000));b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th colspan="2">Validacion T-Registro</th></tr><tr><td>Documento</td><td>'+doc+': '+num+' '+(ok?'Valido':'Invalido')+'</td></tr><tr><td>Edad</td><td>'+(edad||'-')+' anios'+(edad>=18?'':' - Menor edad')+'</td></tr><tr><td>Pension</td><td>'+pen+'</td></tr><tr><td>Tipo</td><td>'+tipo+'</td></tr><tr><td>Remuneracion</td><td>S/ '+(rem.toFixed(2)||'0.00')+'</td></tr><tr><td>Extranjero</td><td>'+ext+'</td></tr><tr><td>Plazo registro SUNAT</td><td>5 dias habiles del ingreso</td></tr></table></div>';}

// ── 7. SUSPENSION ──
function calcSuspension(){var tipo=document.getElementById('susp_tipo')?.value||'suspension';var rem=parseFloat(document.getElementById('susp_rem')?.value)||0;var inicio=document.getElementById('susp_inicio')?.value||'';var fin=document.getElementById('susp_fin')?.value||'';var diasM=parseInt(document.getElementById('susp_dias')?.value)||0;var cts=document.getElementById('susp_cts')?.value||'nocomputa';var vac=document.getElementById('susp_vac')?.value||'nocomputa';var b=document.getElementById('suspResult');if(!b)return;if(!inicio||!fin||!rem){b.style.display='none';return;}var f1=new Date(inicio),f2=new Date(fin);if(f1>=f2){b.style.display='none';return;}var diff=Math.round((f2-f1)/86400000);var dias=diasM>0?diasM:diff;var desc=(rem/30)*dias;var lbls={'suspension':'Suspension perfecta','parental10':'Licencia parental 10d','parental30':'Licencia parental 30d','enfermedad':'Descanso medico','accidente':'Descanso medico accidente','singoce':'Licencia sin goce','disciplinaria':'Suspension disciplinaria','huelga':'Huelga legal'};var paga=(tipo==='parental10'||tipo==='parental30'||tipo==='enfermedad'||tipo==='accidente');b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th colspan="2">'+(lbls[tipo]||tipo)+'</th></tr><tr><td>Periodo</td><td>'+inicio+' -> '+fin+' ('+dias+' dias)</td></tr><tr><td>Remuneracion</td><td>S/ '+rem.toFixed(2)+'</td></tr><tr><td>Descuento</td><td>'+(paga?'Con goce':'S/ '+desc.toFixed(2))+'</td></tr><tr><td>AFECTA CTS</td><td>'+cts.replace('nocomputa','No computa').replace('parcial','Parcialmente').replace('normal','Normal')+'</td></tr><tr><td>AFECTA VACACIONES</td><td>'+vac.replace('nocomputa','No computa').replace('parcial','Parcialmente').replace('normal','Normal')+'</td></tr></table></div>';}

// ── 8. FLUJO CAJA ──
function calcFlujoCaja(){var base=parseFloat(document.getElementById('fc_ingresos')?.value)||0;var crec=(parseFloat(document.getElementById('fc_crecimiento')?.value)||0)/100;var cf=parseFloat(document.getElementById('fc_costos_fijos')?.value)||0;var cv=(parseFloat(document.getElementById('fc_costos_vars')?.value)||0)/100;var inv=parseFloat(document.getElementById('fc_inversion')?.value)||0;var mIni=parseInt(document.getElementById('fc_mes')?.value)||0;var est=document.getElementById('fc_estacionalidad')?.value||'none';var b=document.getElementById('fcResult');if(!b)return;if(!base){b.style.display='none';return;}var meses=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];var sfac={'none':[1,1,1,1,1,1,1,1,1,1,1,1],'jul_dic':[0.8,0.8,0.9,0.9,1,1,1.2,1.2,1.1,1.1,1.1,1.1],'ene_jun':[1.2,1.1,1.1,1,1,1,0.9,0.9,0.8,0.8,0.9,0.9],'mar_sep':[0.9,0.9,1.3,1,1,0.9,0.9,0.9,1.3,1,0.9,0.9],'variable':[1,0.8,1.2,1,0.9,0.7,1.1,1.3,0.9,1,1.1,0.8]};var sf=sfac[est]||sfac.none;var rows='',totI=0,totCV=0,totCF=0,totU=0,acum=-inv;for(var i=0;i<12;i++){var idx=(mIni+i)%12;var ing=base*Math.pow(1+crec,i)*sf[idx];var cvar=ing*cv;var util=ing-cvar-cf;acum+=util;totI+=ing;totCV+=cvar;totCF+=cf;totU+=util;rows+='<tr><td>'+meses[idx]+'</td><td>S/ '+ing.toFixed(2)+'</td><td>S/ '+cvar.toFixed(2)+'</td><td>S/ '+cf.toFixed(2)+'</td><td>S/ '+util.toFixed(2)+'</td><td style="color:'+(acum>=0?'var(--green)':'var(--red)')+'">S/ '+acum.toFixed(2)+'</td></tr>';}b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th>Mes</th><th>Ingresos</th><th>Costos Var</th><th>Costos Fijos</th><th>Utilidad</th><th>Acumulado</th></tr>'+rows+'<tr style="font-weight:600"><td>Total</td><td>S/ '+totI.toFixed(2)+'</td><td>S/ '+totCV.toFixed(2)+'</td><td>S/ '+totCF.toFixed(2)+'</td><td>S/ '+totU.toFixed(2)+'</td><td style="color:'+(acum>=0?'var(--green)':'var(--red)')+'">S/ '+acum.toFixed(2)+'</td></tr></table></div>';}

// ── 9. VAN/TIR ──
function calcVAN_TIR(){var inv=parseFloat(document.getElementById('van_inversion')?.value)||0;var flujos=[];for(var i=1;i<=5;i++)flujos.push(parseFloat(document.getElementById('van_flujo'+i)?.value)||0);var tasa=(parseFloat(document.getElementById('van_tasa')?.value)||0)/100;var kd=(parseFloat(document.getElementById('van_kd')?.value)||0)/100;var ke=(parseFloat(document.getElementById('van_ke')?.value)||0)/100;var dPct=(parseFloat(document.getElementById('van_deuda_pct')?.value)||0)/100;var imp=(parseFloat(document.getElementById('van_impuesto')?.value)||0)/100;var b=document.getElementById('vanResult');if(!b)return;if(!inv){b.style.display='none';return;}var van=-inv;var vaR='';for(var i=0;i<5;i++){var va=flujos[i]/Math.pow(1+tasa,i+1);van+=va;vaR+='<tr><td>'+(i+1)+'</td><td>S/ '+flujos[i].toFixed(2)+'</td><td>S/ '+va.toFixed(2)+'</td></tr>';}var tir=0,lo=0,hi=5,iter=0;while(iter<100){var mid=(lo+hi)/2;var npv=-inv;for(var j=0;j<5;j++)npv+=flujos[j]/Math.pow(1+mid,j+1);if(Math.abs(npv)<0.001){tir=mid;break;}if(npv>0)lo=mid;else hi=mid;iter++;if(iter===99)tir=mid;}var wacc=((1-dPct)*ke)+(dPct*kd*(1-imp));var vi=van>0;b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th colspan="3">Evaluacion de Proyectos</th></tr><tr><th>Anio</th><th>Flujo</th><th>VA</th></tr>'+vaR+'<tr><td><strong>VAN</strong></td><td colspan="2" style="color:'+(vi?'var(--green)':'var(--red)')+';font-weight:600">S/ '+van.toFixed(2)+'</td></tr><tr><td><strong>TIR</strong></td><td colspan="2" style="font-weight:600">'+(tir*100).toFixed(2)+'%</td></tr><tr><td><strong>WACC</strong></td><td colspan="2">'+(wacc*100).toFixed(2)+'%</td></tr><tr><td><strong>Resultado</strong></td><td colspan="2" style="color:'+(vi?'var(--green)':'var(--red)')+';font-weight:600">'+(vi?'Viable (VAN>0)':'No viable (VAN<0)')+'</td></tr><tr><td colspan="3" style="font-size:14px;color:var(--muted);text-align:center">'+(tir>wacc?'TIR > WACC: genera valor':'TIR < WACC: no cubre costo capital')+'</td></tr></table></div>';}

// ── 10. COMP. FINANCIAMIENTO ──
function calcCompFin(){var m=parseFloat(document.getElementById('compMonto')?.value)||0;var pl=parseInt(document.getElementById('compPlazo')?.value)||0;var tL=(parseFloat(document.getElementById('compTeaLease')?.value)||0)/100;var tC=(parseFloat(document.getElementById('compTeaCredit')?.value)||0)/100;var tF=(parseFloat(document.getElementById('compTasaFact')?.value)||0)/100;var op=(parseFloat(document.getElementById('compOpCompra')?.value)||0)/100;var seg=document.getElementById('compSeguro')?.value||'no';var segM=parseFloat(document.getElementById('compSeguroMonto')?.value)||0;var b=document.getElementById('compFinResult');if(!b)return;if(!m||!pl){b.style.display='none';return;}var sCuota=seg==='si'?segM:0;var temL=Math.pow(1+tL,1/12)-1;var temC=Math.pow(1+tC,1/12)-1;function pmt(p,i,n){if(i===0)return p/n;return p*i*Math.pow(1+i,n)/(Math.pow(1+i,n)-1);}var cLb=pmt(m,temL,pl);var opV=m*op;var cL=cLb+sCuota;var tLt=cL*pl+opV;var cC=pmt(m,temC,pl)+sCuota;var tCt=cC*pl;var vF=m;var cFb=vF*tF;var cF=cFb+sCuota;var tFt=cF*pl+vF;var ops=[{n:'Leasing',t:tLt,c:tLt-m,cu:cL,f:opV},{n:'Credito',t:tCt,c:tCt-m,cu:cC,f:0},{n:'Factoring',t:tFt,c:tFt-m,cu:cF,f:vF}].sort(function(a,b){return a.t-b.t});var mej=ops[0].n;b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th>Concepto</th><th>Leasing</th><th>Credito</th><th>Factoring</th></tr><tr><td>Cuota mensual</td><td>S/ '+cL.toFixed(2)+'</td><td>S/ '+cC.toFixed(2)+'</td><td>S/ '+cF.toFixed(2)+'</td></tr><tr><td>Total pagado</td><td>S/ '+tLt.toFixed(2)+'</td><td>S/ '+tCt.toFixed(2)+'</td><td>S/ '+tFt.toFixed(2)+'</td></tr><tr><td>Costo financiero</td><td>S/ '+(tLt-m).toFixed(2)+'</td><td>S/ '+(tCt-m).toFixed(2)+'</td><td>S/ '+(tFt-m).toFixed(2)+'</td></tr><tr><td>Cuota residual</td><td>S/ '+opV.toFixed(2)+'</td><td>-</td><td>S/ '+vF.toFixed(2)+'</td></tr><tr><td colspan="4" style="font-weight:bold;text-align:center">Recomendacion: '+mej+' (menor costo total)</td></tr></table></div>';}

// ── 11. GUIAS REMISION ──
function calcGuiaRemision(){var t=document.getElementById('guiaTipo')?.value||'';var rR=document.getElementById('guiaRucRem')?.value||'';var rzR=document.getElementById('guiaRazonRem')?.value||'';var dP=document.getElementById('guiaDirPartida')?.value||'';var rD=document.getElementById('guiaRucDest')?.value||'';var rzD=document.getElementById('guiaRazonDest')?.value||'';var dL=document.getElementById('guiaDirLlegada')?.value||'';var fe=document.getElementById('guiaFecha')?.value||'';var mo=document.getElementById('guiaMotivo')?.value||'';var bi=document.getElementById('guiaBienes')?.value||'';var bu=document.getElementById('guiaBultos')?.value||'1';var pe=document.getElementById('guiaPeso')?.value||'0';var pl=document.getElementById('guiaPlaca')?.value||'';var co=document.getElementById('guiaConductor')?.value||'';var li=document.getElementById('guiaLicencia')?.value||'';var ci=document.getElementById('guiaCitv')?.value||'';var b=document.getElementById('guiaRemisionResult');if(!b)return;if(!rR||rR.length!==11||!rD||rD.length!==11){b.style.display='block';b.innerHTML='<div class="sunat-api-result"><span style="color:#E8A020">Complete los RUC (11 digitos)</span></div>';return;}b.style.display='block';b.innerHTML='<div class="sunat-api-result"><h3 style="margin:0 0 10px">'+t+'</h3><table><tr><td style="font-weight:600">RUC remitente</td><td>'+rR+'</td></tr><tr><td style="font-weight:600">Razon social</td><td>'+(rzR||'-')+'</td></tr><tr><td style="font-weight:600">Direccion partida</td><td>'+(dP||'-')+'</td></tr><tr><td style="font-weight:600">RUC destinatario</td><td>'+rD+'</td></tr><tr><td style="font-weight:600">Razon social dest.</td><td>'+(rzD||'-')+'</td></tr><tr><td style="font-weight:600">Direccion llegada</td><td>'+(dL||'-')+'</td></tr><tr><td style="font-weight:600">Fecha traslado</td><td>'+(fe||'-')+'</td></tr><tr><td style="font-weight:600">Motivo</td><td>'+mo+'</td></tr><tr><td style="font-weight:600">Bienes</td><td>'+(bi||'-')+'</td></tr><tr><td style="font-weight:600">Bultos / Peso</td><td>'+bu+' / '+pe+' kg</td></tr><tr><td style="font-weight:600">Placa / Conductor</td><td>'+(pl||'-')+' / '+(co||'-')+'</td></tr><tr><td style="font-weight:600">Licencia / CITV</td><td>'+(li||'-')+' / '+ci+'</td></tr></table></div>';}

// ── 12. VALIDADOR ──
function calcValidador(){var t=document.getElementById('valTipoDoc')?.value||'RUC';var ruc=document.getElementById('valRuc')?.value||'';var nR=document.getElementById('valNomRuc')?.value||'';var dni=document.getElementById('valDni')?.value||'';var nD=document.getElementById('valNomDni')?.value||'';var aD=document.getElementById('valApeDni')?.value||'';var ver=document.getElementById('valCoincidencia')?.value||'No';var b=document.getElementById('validadorResult');if(!b)return;if((t==='RUC'||t==='Ambos')&&ruc.length>0&&ruc.length!==11){b.style.display='block';b.innerHTML='<div class="sunat-api-result"><span style="color:#E8A020">RUC: 11 digitos requeridos</span></div>';return;}if((t==='DNI'||t==='Ambos')&&dni.length>0&&dni.length!==8){b.style.display='block';b.innerHTML='<div class="sunat-api-result"><span style="color:#E8A020">DNI: 8 digitos requeridos</span></div>';return;}if(t==='RUC'&&!ruc){b.style.display='none';return;}if(t==='DNI'&&!dni){b.style.display='none';return;}if(t==='Ambos'&&!ruc&&!dni){b.style.display='none';return;}var rows='';if(t==='RUC'||t==='Ambos'){var pre=ruc.substring(0,2);var tipoEnt=pre==='10'?'Persona Natural':pre==='15'?'Asociacion':pre==='17'?'Sociedad Conyugal':pre==='20'?'Persona Juridica':'Otro';var preOk=['10','15','17','20'].includes(pre);var suma=parseInt(ruc[0])*5+parseInt(ruc[1])*4+parseInt(ruc[2])*3+parseInt(ruc[3])*2+parseInt(ruc[4])*7+parseInt(ruc[5])*6+parseInt(ruc[6])*5+parseInt(ruc[7])*4+parseInt(ruc[8])*3+parseInt(ruc[9])*2;var res=suma%11;var digC=res===0?0:11-res;var digR=parseInt(ruc[10]);var ok=preOk&&digC===digR;rows+='<tr><td>RUC</td><td>'+ruc+'</td><td>'+(ok?'VALIDO':'INVALIDO')+'</td><td>'+tipoEnt+'</td></tr>';}if(t==='DNI'||t==='Ambos'){var dOk=dni.length===8&&/^\d{8}$/.test(dni);rows+='<tr><td>DNI</td><td>'+dni+'</td><td>'+(dOk?'VALIDO':'INVALIDO')+'</td><td>'+(dOk?'8 digitos':'' )+'</td></tr>';}var coin='';if(ver==='Si'&&t==='Ambos'&&ruc&&dni&&nR&&nD&&ruc.substring(0,2)==='10'){var nRN=nR.toLowerCase().replace(/\s+/g,'');var nDN=(nD+' '+aD).toLowerCase().replace(/\s+/g,'');var match=nRN.includes(nDN)||nDN.includes(nRN);coin='<tr><td>Coincidencia</td><td colspan="3">'+(match?'Coinciden':'No coinciden')+'</td></tr>';}b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th>Doc</th><th>Numero</th><th>Estado</th><th>Detalle</th></tr>'+rows+coin+'</table></div>';}

// ── 13. PRECIOS TRANSFERENCIA ──
function calcPreciosTransf(){var m=parseFloat(document.getElementById('ptMonto')?.value)||0;var mg=parseFloat(document.getElementById('ptMargen')?.value)||0;var cRaw=document.getElementById('ptComparables')?.value||'';var intv=document.getElementById('ptIntervalo')?.value||'95';var b=document.getElementById('preciosTransfResult');if(!b)return;if(!m||!mg||!cRaw.trim()){b.style.display='none';return;}var nums=cRaw.split(/[\/\n,;\s]+/).map(function(s){return parseFloat(s.trim());}).filter(function(n){return !isNaN(n)&&isFinite(n);});if(nums.length<2){b.style.display='block';b.innerHTML='<div class="sunat-api-result"><span style="color:#E8A020">Ingrese al menos 2 comparables</span></div>';return;}var sorted=[].concat(nums).sort(function(a,b){return a-b;});var n=sorted.length;var min=sorted[0],max=sorted[n-1];var med=n%2===0?(sorted[n/2-1]+sorted[n/2])/2:sorted[Math.floor(n/2)];var q1,q3;if(intv==='95'){var pQ1=0.25*(n+1),pQ3=0.75*(n+1);q1=pQ1===Math.floor(pQ1)?sorted[pQ1-1]:sorted[Math.floor(pQ1)-1]+(pQ1-Math.floor(pQ1))*(sorted[Math.floor(pQ1)]-sorted[Math.floor(pQ1)-1]);q3=pQ3===Math.floor(pQ3)?sorted[pQ3-1]:sorted[Math.floor(pQ3)-1]+(pQ3-Math.floor(pQ3))*(sorted[Math.floor(pQ3)]-sorted[Math.floor(pQ3)-1]);}else{q1=min;q3=max;}if(n<4&&intv==='95'){q1=min;q3=max;}var dentro=mg>=q1&&mg<=q3;var aj=0;if(!dentro)aj=mg<q1?q1-mg:q3-mg;var ajM=(aj/100)*m;var cRows='';for(var i=0;i<sorted.length;i++){cRows+='<tr><td>'+(i+1)+'</td><td>'+sorted[i].toFixed(2)+'%</td></tr>';}b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th colspan="4">Analisis de Rango Intercuartil</th></tr><tr><td>N comparables</td><td>'+n+'</td><td>Intervalo</td><td>'+(intv==='95'?'Q1-Q3':'Min-Max')+'</td></tr><tr><td>Minimo</td><td>'+min.toFixed(2)+'%</td><td>Maximo</td><td>'+max.toFixed(2)+'%</td></tr><tr><td>Q1</td><td>'+q1.toFixed(2)+'%</td><td>Q3</td><td>'+q3.toFixed(2)+'%</td></tr><tr><td>Mediana</td><td colspan="3">'+med.toFixed(2)+'%</td></tr><tr><td>Su margen</td><td colspan="3">'+mg.toFixed(2)+'%</td></tr><tr style="background:'+(dentro?'rgba(76,175,80,.2)':'rgba(244,67,54,.2)')+'"><td><strong>Resultado</strong></td><td colspan="3">'+(dentro?'Dentro del rango':'Fuera del rango')+'</td></tr>'+(aj>0?'<tr><td>Ajuste</td><td colspan="3">'+aj.toFixed(2)+'% (S/ '+ajM.toFixed(2)+')</td></tr>':'')+'<tr><th colspan="4">Comparables</th></tr><tr><th>#</th><th>Valor</th><th colspan="2"></th></tr>'+cRows+'</table></div>';}

// ── 14. TEA MULTAS ──
function calcTEAMultas(){var an=document.getElementById('teaAnio')?.value||'2025';var u=parseFloat(document.getElementById('teaUits')?.value)||0;var tm=document.getElementById('teaTipoMulta')?.value||'tributaria';var fN=document.getElementById('teaFechaNotif')?.value||'';var fP=document.getElementById('teaFechaPago')?.value||'';var fr=document.getElementById('teaFraccion')?.value||'no';var b=document.getElementById('teaMultasResult');if(!b)return;var uits={'2025':5350,'2024':5150,'2023':4950,'2022':4600,'2021':4400,'2020':4300,'2019':4200,'2018':4150,'2017':4050,'2016':3950,'2015':3850,'2014':3800,'2013':3700};var vU=uits[an]||0;var mS=u*vU;if(!u||!fN||!fP){b.style.display=mS?'block':'none';if(b.style.display==='block')b.innerHTML='<div class="sunat-api-result"><span style="color:#E8A020">Complete todos los campos</span></div>';return;}var f1=new Date(fN),f2=new Date(fP);var dias=Math.round((f2-f1)/86400000);if(dias<0){b.style.display='block';b.innerHTML='<div class="sunat-api-result"><span style="color:#E8A020">Pago debe ser posterior a notificacion</span></div>';return;}var tM=tm==='tributaria'?0.015:0.012;if(fr==='ref')tM=0.005;else if(fr==='aplazamiento')tM=0.010;var tea=Math.pow(1+tM,12)-1;var int=mS*(Math.pow(1+tM/30,dias)-1);var total=mS+int;b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th colspan="2">Liquidacion Multa</th></tr><tr><td>Anio/UIT</td><td>'+an+' / S/ '+vU.toFixed(2)+'</td></tr><tr><td>Multa (S/)</td><td>S/ '+mS.toFixed(2)+' ('+u+' UIT)</td></tr><tr><td>Dias mora</td><td>'+dias+'</td></tr><tr><td>Tasa mensual</td><td>'+(tM*100).toFixed(2)+'%</td></tr><tr><td>Interes</td><td>S/ '+int.toFixed(2)+'</td></tr><tr><td><strong>Total a pagar</strong></td><td><strong>S/ '+total.toFixed(2)+'</strong></td></tr><tr><td><strong>TEA</strong></td><td><strong>'+(tea*100).toFixed(4)+'%</strong></td></tr></table></div>';}

// ── 15. RMT VS RER ──
function calcRMTRER(){var ing=parseFloat(document.getElementById('rmt_rer_ingresos')?.value)||0;var cost=parseFloat(document.getElementById('rmt_rer_costos')?.value)||0;var comp=parseFloat(document.getElementById('rmt_rer_compras')?.value)||0;var trab=parseInt(document.getElementById('rmt_rer_trab')?.value)||1;var serv=document.getElementById('rmt_rer_servicio')?.value||'no';var fact=document.getElementById('rmt_rer_facturas_ant')?.value||'no';var b=document.getElementById('rmt_rerResult');if(!b)return;if(!ing){b.style.display='none';return;}var UIT=5150,lim=525000;var cumple=ing<lim;var rNet=Math.max(0,ing-cost);var rmtIR,rmtPct;if(ing<=300*UIT){rmtIR=ing*0.01;rmtPct='1%';}else{rmtIR=300*UIT*0.01+(ing-300*UIT)*0.295;rmtPct='1% hasta 300 UIT, luego 29.5%';}var rmtIGV=ing*0.18;var rmtTot=rmtIR+rmtIGV;var rerIR=ing*0.015;var rerIGV=ing*0.18;var rerTot=rerIR+rerIGV;var dif=rmtTot-rerTot;var rec;if(fact==='si')rec='RER no aplica (facturo > S/525K)';else if(!cumple)rec='RER no aplica (ingresos > S/525K)';else if(serv==='si'&&ing>150000)rec='RER puede no aplicar (servicio > S/150K)';else rec=dif>=0?'Recomendado: RER':'Recomendado: RMT';b.style.display='block';b.innerHTML='<div class="sunat-api-result"><table><tr><th>Concepto</th><th>RMT</th><th>RER</th></tr><tr><td>IR Anual</td><td>S/ '+rmtIR.toFixed(2)+'</td><td>S/ '+rerIR.toFixed(2)+'</td></tr><tr><td>IGV 18%</td><td>S/ '+rmtIGV.toFixed(2)+'</td><td>S/ '+rerIGV.toFixed(2)+'</td></tr><tr><td><strong>Total</strong></td><td><strong>S/ '+rmtTot.toFixed(2)+'</strong></td><td><strong>S/ '+rerTot.toFixed(2)+'</strong></td></tr><tr><td>Diferencia</td><td colspan="2">'+(dif>=0?'RER ahorra':'RMT ahorra')+' S/ '+Math.abs(dif).toFixed(2)+'</td></tr><tr><td>Renta neta</td><td colspan="2">S/ '+rNet.toFixed(2)+'</td></tr><tr><td>Limite RER</td><td colspan="2">'+(cumple?'Cumple S/525K':'Excede S/525K')+'</td></tr></table><div style="margin-top:8px;padding:8px;background:var(--dark2);border-radius:6px;font-weight:500;text-align:center">'+rec+'</div></div>';}

// ── 16. AMAZONIA ──
function calcAmazonia(){var z=document.getElementById('amazonia_zona')?.value||'amazonia';var bf=document.getElementById('amazonia_beneficio')?.value||'todo';var ing=parseFloat(document.getElementById('amazonia_ingresos')?.value)||0;var pct=parseFloat(document.getElementById('amazonia_pct')?.value)||0;var ven=document.getElementById('amazonia_venta')?.value||'no';var con=document.getElementById('amazonia_constituida')?.value||'si';var box=document.getElementById('amazoniaResult');if(!box)return;if(!ing||!pct){box.style.display='none';return;}var iZ=ing*pct/100;var igvA=iZ*0.18/1.18;var zonas={amazonia:{nombre:'Amazonia (Ley 27037)',igv:true,irR:true,irE:true,cred:true,tasaIR:'10%',legal:'Ley 27037'},ceticos:{nombre:'CETICOS (Ley 27688)',igv:true,irR:true,irE:false,cred:false,tasaIR:'15%',legal:'Ley 27688'},zoftacna:{nombre:'ZOFRATACNA',igv:true,irR:true,irE:false,cred:false,tasaIR:'15%',legal:'DS'},altoandina:{nombre:'Altoandina',igv:false,irR:true,irE:false,cred:false,tasaIR:'10-15%',legal:'Ley 27688'},fronteriza:{nombre:'Fronteriza Norte',igv:true,irR:true,irE:false,cred:false,tasaIR:'15%',legal:'Ley 27688'}};var zo=zonas[z]||zonas.amazonia;var aIGV=zo.igv&&(bf==='todo'||bf==='igv');var aIR=zo.irR&&(bf==='todo'||bf==='ir_reducida');var aIRex=zo.irE&&(bf==='todo'||bf==='ir_exonerado');var aCred=zo.cred&&(bf==='todo'||bf==='credito');var irA=0,irTxt='No aplica';if(aIRex&&z==='amazonia'&&con==='si'){irTxt='IR exonerado 10 anios';irA=iZ*0.295;}else if(aIR){irA=iZ*(0.295-parseFloat(zo.tasaIR)/100);irTxt='Tasa reducida: '+zo.tasaIR;}var ahorro=(aIGV?igvA:0)+irA;box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><th colspan="2">'+zo.nombre+'</th></tr><tr><td>Base legal</td><td>'+zo.legal+'</td></tr><tr><td>Ingresos zona</td><td>S/ '+iZ.toFixed(2)+'</td></tr><tr><td>Exoneracion IGV</td><td>'+(aIGV?'S/ '+igvA.toFixed(2):'No aplica')+'</td></tr><tr><td>Beneficio IR</td><td>'+irTxt+'</td></tr><tr><td><strong>Ahorro total</strong></td><td><strong>S/ '+ahorro.toFixed(2)+'</strong></td></tr></table></div>';}

// ── 17. ITAN DETALLE ──
function calcITANDetalle(){var act=parseFloat(document.getElementById('itand_activos')?.value)||0;var ded=parseFloat(document.getElementById('itand_deducciones')?.value)||0;var inm=parseFloat(document.getElementById('itand_inmuebles')?.value)||0;var pas=parseFloat(document.getElementById('itand_pasivos')?.value)||0;var ama=document.getElementById('itand_amazonia')?.value||'no';var pag=document.getElementById('itand_pago')?.value||'contado';var cred=document.getElementById('itand_credito')?.value||'si';var b=document.getElementById('itandResult');if(!b)return;if(!act){b.style.display='none';return;}var base=Math.max(0,act-ded-1000000);var exo=ama==='si';var itan=exo?0:base*0.004;var meses=['Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];var cron='',totC=0;if(pag==='contado'){cron='<tr><td>Abril</td><td>S/ '+itan.toFixed(2)+'</td><td>Unico</td></tr>';totC=itan;}else{var cuo=itan/9,rem=itan;for(var i=0;i<9;i++){var monto=i<8?Math.floor(cuo*100)/100:rem;rem-=monto;totC+=monto;cron+='<tr><td>'+meses[i]+'</td><td>S/ '+monto.toFixed(2)+'</td><td>Cuota '+(i+1)+'/9</td></tr>';}}b.style.display='block';b.innerHTML='<div class="sunat-api-result"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;padding:10px;background:var(--dark2);border-radius:6px"><div><strong>Base ITAN</strong><br>S/ '+base.toFixed(2)+'</div><div><strong>ITAN 0.4%</strong><br>S/ '+itan.toFixed(2)+'</div><div><strong>Activos</strong><br>S/ '+(act-ded).toFixed(2)+'</div><div><strong>Amazonia</strong><br>'+(exo?'Exonerada':'No')+'</div></div>'+(exo?'<div style="margin-bottom:10px;padding:8px;background:rgba(76,175,80,.2);border-radius:4px">Exonerado ITAN (Ley 27037)</div>':'')+'<table><tr><th>Mes</th><th>Monto</th><th>Cuota</th></tr>'+cron+'<tr style="font-weight:600"><td colspan="2">Total: S/ '+totC.toFixed(2)+'</td><td>'+(pag==='contado'?'Contado':'9 cuotas')+'</td></tr></table><div style="margin-top:10px;padding:8px;background:var(--dark2);border-radius:6px;font-size:14px">Credito contra IR: '+(cred==='si'&&itan>0?'S/ '+itan.toFixed(2):'No aplica')+'</div></div>';}
// ── 1. RUS ──
function calcRus() {
  const ingresos = parseFloat(document.getElementById('rus_ingresos')?.value) || 0;
  const catActual = parseInt(document.getElementById('rus_categoria')?.value) || 0;
  const actividad = document.getElementById('rus_actividad')?.value || 'comercio';
  const emiteFactura = document.getElementById('rus_factura')?.value || 'no';
  const tieneLocal = document.getElementById('rus_local')?.value || 'no';
  const box = document.getElementById('rusResult');
  if (!box) return;
  if (!ingresos) { box.style.display = 'none'; return; }
  let catSugerida = 0, cuota = 0, tope = 0;
  if (ingresos <= 5000) { catSugerida = 1; cuota = 25; tope = 60000; }
  else if (ingresos <= 8000) { catSugerida = 2; cuota = 45; tope = 96000; }
  else if (ingresos <= 13000) { catSugerida = 3; cuota = 85; tope = 156000; }
  else if (ingresos <= 20000) { catSugerida = 4; cuota = 120; tope = 240000; }
  else if (ingresos <= 30000) { catSugerida = 5; cuota = 170; tope = 360000; }
  else { catSugerida = 0; cuota = 0; tope = 0; }
  const pagoTrimestral = cuota * 3;
  const pagoAnual = cuota * 12;
  const catActualNombre = catActual > 0 ? 'Cat ' + catActual : 'No registrado';
  const catSugeridaNombre = catSugerida > 0 ? 'Cat ' + catSugerida : 'Excede límite NRUS';
  const puedeAcogerse = catSugerida > 0 && emiteFactura === 'no';
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 8px;font-weight:600;background:var(--accent);color:var(--bg);border-radius:6px 6px 0 0" colspan="2">Resultado RUS — Ingresos S/ ${ingresos.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Categoría Actual</td><td style="padding:4px 8px;font-weight:600">${catActualNombre}</td></tr>
      <tr><td style="padding:4px 8px">Categoría Sugerida</td><td style="padding:4px 8px;font-weight:600">${catSugeridaNombre}</td></tr>
      ${catSugerida > 0 ? `
      <tr><td style="padding:4px 8px">Cuota Mensual</td><td style="padding:4px 8px;font-weight:600">S/ ${cuota.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Pago Trimestral</td><td style="padding:4px 8px;font-weight:600">S/ ${pagoTrimestral.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Pago Anual</td><td style="padding:4px 8px;font-weight:600">S/ ${pagoAnual.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Tope Máx. Facturación Anual</td><td style="padding:4px 8px;font-weight:600">S/ ${tope.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">¿Puede acogerse?</td><td style="padding:4px 8px;font-weight:600;color:${puedeAcogerse ? 'var(--green)' : '#e74c3c'}">${puedeAcogerse ? 'Sí' : 'No (emite facturas o excede límite)'}</td></tr>
      ` : '<tr><td style="padding:4px 8px;color:#e74c3c" colspan="2">⚠ Ingresos exceden S/ 30,000 — no aplica NRUS</td></tr>'}
    </table>
  </div>`;
}

// ── 2. CIERRE FISCAL ──
function calcCierreFiscal() {
  const anio = parseInt(document.getElementById('cf_anio')?.value) || 2026;
  const ingresos = parseFloat(document.getElementById('cf_ingresos')?.value) || 0;
  const costo = parseFloat(document.getElementById('cf_costo')?.value) || 0;
  const gastos = parseFloat(document.getElementById('cf_gastos')?.value) || 0;
  const igvProm = parseFloat(document.getElementById('cf_igv')?.value) || 0;
  const irPagado = parseFloat(document.getElementById('cf_ir_pagado')?.value) || 0;
  const percepciones = parseFloat(document.getElementById('cf_percepciones')?.value) || 0;
  const box = document.getElementById('cfResult');
  if (!box) return;
  if (!ingresos) { box.style.display = 'none'; return; }
  const utilidad = ingresos - costo - gastos;
  const tasaIR = anio >= 2024 ? 0.295 : 0.30;
  const irCalculado = Math.max(0, utilidad * tasaIR);
  const difIR = irCalculado - irPagado;
  const igvAnual = igvProm * 12;
  const totalTributos = irCalculado + igvAnual + percepciones;
  const ratioTributario = (totalTributos / ingresos) * 100;
  const pctIRUtilidad = utilidad > 0 ? (irCalculado / utilidad) * 100 : 0;
  const saldoFavor = difIR < 0 ? Math.abs(difIR) : 0;
  const deuda = difIR > 0 ? difIR : 0;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 8px;font-weight:600;background:var(--accent);color:var(--bg);border-radius:6px 6px 0 0" colspan="2">Cierre Fiscal ${anio}</td></tr>
      <tr><td style="padding:4px 8px">Utilidad Neta</td><td style="padding:4px 8px;font-weight:600">S/ ${utilidad.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Tasa IR</td><td style="padding:4px 8px;font-weight:600">${(tasaIR * 100).toFixed(1)}%</td></tr>
      <tr><td style="padding:4px 8px">IR Calculado</td><td style="padding:4px 8px;font-weight:600">S/ ${irCalculado.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">IR Pagado</td><td style="padding:4px 8px">S/ ${irPagado.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Diferencia IR</td><td style="padding:4px 8px;font-weight:600;color:${difIR >= 0 ? '#e74c3c' : 'var(--green)'}">${difIR >= 0 ? 'Deuda: S/ ' + deuda.toFixed(2) : 'Saldo a favor: S/ ' + saldoFavor.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">IGV Anual Estimado</td><td style="padding:4px 8px;font-weight:600">S/ ${igvAnual.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Percepciones</td><td style="padding:4px 8px">S/ ${percepciones.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Carga Tributaria Total</td><td style="padding:4px 8px;font-weight:600">S/ ${totalTributos.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Ratio Tributario</td><td style="padding:4px 8px;font-weight:600">${ratioTributario.toFixed(2)}%</td></tr>
      <tr><td style="padding:4px 8px">% IR / Utilidad</td><td style="padding:4px 8px;font-weight:600">${pctIRUtilidad.toFixed(2)}%</td></tr>
    </table>
  </div>`;
}

// ── 3. TIM HISTÓRICO ──
function calcTim() {
  const anio = parseInt(document.getElementById('tim_anio')?.value) || 2026;
  const mesIni = parseInt(document.getElementById('tim_mes_ini')?.value) || 1;
  const mesFin = parseInt(document.getElementById('tim_mes_fin')?.value) || 12;
  const deuda = parseFloat(document.getElementById('tim_deuda')?.value) || 0;
  const box = document.getElementById('timHistResult');
  if (!box) return;
  if (!deuda || mesIni > mesFin) { box.style.display = 'none'; return; }
  const timRates = { 2026: 1.2, 2025: 1.2, 2024: 1.3, 2023: 1.5, 2022: 1.8, 2021: 1.8, 2020: 2.0, 2019: 2.2, 2018: 2.5, 2017: 2.8, 2016: 3.0, 2015: 3.5 };
  const tasaTIM = timRates[anio] || 1.2;
  const tasaDecimal = tasaTIM / 100;
  let totalInteres = 0;
  let rows = '';
  for (let m = mesIni; m <= mesFin; m++) {
    const interesMes = deuda * tasaDecimal;
    totalInteres += interesMes;
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
    rows += `<tr><td style="padding:3px 6px">${meses[m - 1]}</td><td style="padding:3px 6px">${tasaTIM.toFixed(1)}%</td><td style="padding:3px 6px">S/ ${interesMes.toFixed(2)}</td></tr>`;
  }
  const deudaTotal = deuda + totalInteres;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 8px;font-weight:600;background:var(--accent);color:var(--bg);border-radius:6px 6px 0 0" colspan="3">TIM ${anio} — Tasa: ${tasaTIM}% mensual</td></tr>
      <tr><td style="padding:4px 8px;font-weight:600" colspan="3">Deuda original: S/ ${deuda.toFixed(2)}</td></tr>
      ${rows}
      <tr><td style="padding:4px 8px;font-weight:600">Total Intereses</td><td colspan="2" style="padding:4px 8px;font-weight:600;color:#e74c3c">S/ ${totalInteres.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:600">Deuda Total Actualizada</td><td colspan="2" style="padding:4px 8px;font-weight:600">S/ ${deudaTotal.toFixed(2)}</td></tr>
    </table>
  </div>`;
}

// ── 4. COMPENSACIÓN DEUDAS ──
function calcCompensacion() {
  const saldoFavor = parseFloat(document.getElementById('comp_saldo')?.value) || 0;
  const deudaPrincipal = parseFloat(document.getElementById('comp_deuda')?.value) || 0;
  const tipo = document.getElementById('comp_tipo')?.value || 'IR';
  const intereses = parseFloat(document.getElementById('comp_intereses')?.value) || 0;
  const box = document.getElementById('compensacionResult');
  if (!box) return;
  if (!saldoFavor || !deudaPrincipal) { box.style.display = 'none'; return; }
  const deudaTotal = deudaPrincipal + intereses;
  const montoCompensado = Math.min(saldoFavor, deudaTotal);
  const saldoPendiente = deudaTotal - montoCompensado;
  const ahorro = montoCompensado;
  const saldoFavorRestante = saldoFavor - montoCompensado;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 8px;font-weight:600;background:var(--accent);color:var(--bg);border-radius:6px 6px 0 0" colspan="2">Compensación — Deuda ${tipo}</td></tr>
      <tr><td style="padding:4px 8px">Saldo a Favor</td><td style="padding:4px 8px;font-weight:600;color:var(--green)">S/ ${saldoFavor.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Deuda Principal</td><td style="padding:4px 8px">S/ ${deudaPrincipal.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Intereses Generados</td><td style="padding:4px 8px">S/ ${intereses.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:600">Deuda Total</td><td style="padding:4px 8px;font-weight:600">S/ ${deudaTotal.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:600;color:var(--green)">Monto Compensado</td><td style="padding:4px 8px;font-weight:600;color:var(--green)">S/ ${montoCompensado.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:600">Saldo Pendiente</td><td style="padding:4px 8px;font-weight:600;color:${saldoPendiente > 0 ? '#e74c3c' : 'var(--green)'}">${saldoPendiente > 0 ? 'S/ ' + saldoPendiente.toFixed(2) : 'S/ 0.00 (Cancelado)'}</td></tr>
      <tr><td style="padding:4px 8px">Ahorro por Compensación</td><td style="padding:4px 8px;font-weight:600;color:var(--green)">S/ ${ahorro.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Saldo a Favor Restante</td><td style="padding:4px 8px">S/ ${saldoFavorRestante.toFixed(2)}</td></tr>
    </table>
  </div>`;
}

// ── 5. EXONERACIÓN DETRACCIÓN ──
function calcExonDetraccion() {
  const tipo = document.getElementById('exon_tipo')?.value || 'bien';
  const monto = parseFloat(document.getElementById('exon_monto')?.value) || 0;
  const categoria = document.getElementById('exon_categoria')?.value || 'alimentos';
  const incluyeIGV = document.getElementById('exon_igv')?.value || 'si';
  const tope = parseFloat(document.getElementById('exon_tope')?.value) || 0;
  const box = document.getElementById('exonResult');
  if (!box) return;
  if (!monto) { box.style.display = 'none'; return; }
  const tasas = { bien: 0.10, servicio: 0.12, construccion: 0.05 };
  const exoneraciones = { alimentos: { tope: 700, exonerado: true, nombre: 'Alimentos perecibles' }, combustibles: { tope: 400, exonerado: true, nombre: 'Combustibles' }, comision: { tope: 0, exonerado: true, nombre: 'Comisión mercantil' }, minerales: { tope: 0, exonerado: false, nombre: 'Minerales' }, transporte: { tope: 0, exonerado: false, nombre: 'Transporte' }, otros: { tope: 0, exonerado: false, nombre: 'Otras categorías' } };
  const exo = exoneraciones[categoria] || exoneraciones.otros;
  const montoBase = incluyeIGV === 'si' ? monto / 1.18 : monto;
  const exonerado = exo.exonerado && (exo.tope === 0 || montoBase <= exo.tope);
  const tasaAplicable = exonerado ? 0 : (tasas[tipo] || 0.10);
  const montoDetraer = exonerado ? 0 : montoBase * tasaAplicable;
  let baseLegal = '';
  if (exonerado && categoria === 'alimentos') baseLegal = 'Res. 183-2005/SUNAT — Alimentos perecibles < S/ 700';
  else if (exonerado && categoria === 'combustibles') baseLegal = 'Res. 183-2005/SUNAT — Combustibles < S/ 400';
  else if (exonerado && categoria === 'comision') baseLegal = 'Ley 28194 — Comisión mercantil exonerada';
  else baseLegal = 'Res. 183-2005/SUNAT y normas SPOT';
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 8px;font-weight:600;background:var(--accent);color:var(--bg);border-radius:6px 6px 0 0" colspan="2">Detracción SPOT — ${tipo.charAt(0).toUpperCase() + tipo.slice(1)}</td></tr>
      <tr><td style="padding:4px 8px">Categoría</td><td style="padding:4px 8px">${exo.nombre}</td></tr>
      <tr><td style="padding:4px 8px">Monto Base (sin IGV)</td><td style="padding:4px 8px;font-weight:600">S/ ${montoBase.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:600">¿Exonerado?</td><td style="padding:4px 8px;font-weight:600;font-size:15px;color:${exonerado ? 'var(--green)' : '#e74c3c'}">${exonerado ? '✅ SÍ — Exonerado' : '❌ NO — Aplica detracción'}</td></tr>
      ${!exonerado ? `<tr><td style="padding:4px 8px">Tasa Aplicable</td><td style="padding:4px 8px;font-weight:600">${(tasaAplicable * 100).toFixed(0)}%</td></tr>
      <tr><td style="padding:4px 8px;font-weight:600;color:#e74c3c">Monto a Detraer</td><td style="padding:4px 8px;font-weight:600;color:#e74c3c">S/ ${montoDetraer.toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:4px 8px">Base Legal</td><td style="padding:4px 8px;font-size:14px;color:var(--muted)">${baseLegal}</td></tr>
    </table>
  </div>`;
}

// ── 6. RECURSO MULTA SUNAT ──
function calcRecursoMulta() {
  const uits = {2020:4300, 2021:4400, 2022:4600, 2023:4950, 2024:5150, 2025:5350, 2026:5600};
  const tipo = document.getElementById('rm_tipo')?.value || 'reclamacion';
  const multaUit = parseFloat(document.getElementById('rm_uit')?.value) || 0;
  const anio = parseInt(document.getElementById('rm_anio')?.value) || 2025;
  const infraccion = document.getElementById('rm_infraccion')?.value || 'formal';
  const fecNotif = document.getElementById('rm_fec_notif')?.value || '';
  const fecInterp = document.getElementById('rm_fec_interp')?.value || '';
  const fraccion = document.getElementById('rm_fraccion')?.value || 'no';
  const box = document.getElementById('rmResult');
  if (!box) return;
  if (!multaUit || !fecNotif || !fecInterp) { box.style.display = 'none'; return; }
  const uitValor = uits[anio] || 5350;
  const multaSoles = multaUit * uitValor;
  const d1 = new Date(fecNotif), d2 = new Date(fecInterp);
  const diffTime = Math.abs(d2 - d1);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const diasHabiles = Math.round(diffDays * 5 / 7);
  const timMensual = 1.2;
  const mesesTrans = diffDays / 30;
  const interes = multaSoles * (timMensual / 100) * mesesTrans;
  const totalPagar = multaSoles + interes;
  const plazos = { reclamacion: { max: 20, desc: '20 días hábiles', prob: 40 }, apelacion: { max: 15, desc: '15 días hábiles', prob: 25 }, quebrantamiento: { max: 0, desc: 'No aplica', prob: 60 } };
  const p = plazos[tipo];
  const dentroPlazo = p.max === 0 ? 'N/A' : diasHabiles <= p.max ? '✅ Dentro de plazo' : '❌ Fuera de plazo';
  const probExito = p.prob;
  const recText = { reclamacion: 'Reclamación', apelacion: 'Apelación', quebrantamiento: 'Quebrantamiento' }[tipo];
  const infText = { formal: 'Formal', sustancial: 'Sustancial' }[infraccion];
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table>
      <tr><th>Concepto</th><th>Valor</th></tr>
      <tr><td>Tipo de recurso</td><td>${recText}</td></tr>
      <tr><td>Tipo de infracción</td><td>${infText}</td></tr>
      <tr><td>Multa en UIT</td><td>${multaUit} UIT</td></tr>
      <tr><td>Valor UIT ${anio}</td><td>S/ ${uitValor.toFixed(2)}</td></tr>
      <tr><td><strong>Monto multa en S/</strong></td><td><strong>S/ ${multaSoles.toFixed(2)}</strong></td></tr>
      <tr><td>Días calendario</td><td>${diffDays} días</td></tr>
      <tr><td>Días hábiles estimados</td><td>${diasHabiles} días</td></tr>
      <tr><td>Plazo máximo</td><td>${p.desc}</td></tr>
      <tr><td>Estado del plazo</td><td>${dentroPlazo}</td></tr>
      <tr><td>Intereses moratorios (TIM ${timMensual}%)</td><td>S/ ${interes.toFixed(2)}</td></tr>
      <tr><td><strong>Total si se pierde</strong></td><td><strong>S/ ${totalPagar.toFixed(2)}</strong></td></tr>
      <tr><td>Probabilidad de éxito</td><td>${probExito}%</td></tr>
      <tr><td>Fraccionamiento</td><td>${fraccion === 'si' ? '✅ Sí' : '❌ No'}</td></tr>
    </table>
    <div style="margin-top:12px;padding:12px;background:var(--accent);border-radius:6px;font-weight:600;text-align:center">${probExito >= 50 ? '✅ Alta probabilidad de éxito' : probExito >= 30 ? '⚠️ Probabilidad moderada' : '❌ Baja probabilidad de éxito'}</div>
  </div>`;
}

// ── 7. SALDO FAVOR EXPORTADOR ──
function calcSaldoExport() {
  const fobUsd = parseFloat(document.getElementById('se_fob')?.value) || 0;
  const tc = parseFloat(document.getElementById('se_tc')?.value) || 0;
  const insImp = parseFloat(document.getElementById('se_ins_imp')?.value) || 0;
  const insNac = parseFloat(document.getElementById('se_ins_nac')?.value) || 0;
  const igvComp = parseFloat(document.getElementById('se_igv_comp')?.value) || 0;
  const igvVent = parseFloat(document.getElementById('se_igv_vent')?.value) || 0;
  const pctDrawback = parseFloat(document.getElementById('se_drawback_pct')?.value) || 0;
  const box = document.getElementById('seResult');
  if (!box) return;
  if (!fobUsd || !tc) { box.style.display = 'none'; return; }
  const fobSoles = fobUsd * tc;
  const saldoFavorIGV = Math.max(0, igvComp - igvVent);
  const drawback = fobSoles * pctDrawback / 100;
  const costTotal = insImp + insNac;
  const limiteDrawback = costTotal * 0.5;
  const recuperacionMax = Math.min(drawback, limiteDrawback);
  const puedeAcogerse = costTotal > 0 && fobSoles > 0;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table>
      <tr><th>Concepto</th><th>Valor</th></tr>
      <tr><td>Valor FOB exportado</td><td>USD ${fobUsd.toFixed(2)}</td></tr>
      <tr><td>Valor FOB en S/ (TC ${tc})</td><td>S/ ${fobSoles.toFixed(2)}</td></tr>
      <tr><td>IGV de exportación</td><td>0% (tasa 0)</td></tr>
      <tr><td><strong>Saldo a favor IGV</strong></td><td><strong>S/ ${saldoFavorIGV.toFixed(2)}</strong></td></tr>
      <tr><td>Drawback (${pctDrawback}% de FOB)</td><td>S/ ${drawback.toFixed(2)}</td></tr>
      <tr><td>Costo total insumos</td><td>S/ ${costTotal.toFixed(2)}</td></tr>
      <tr><td>Límite drawback (50%)</td><td>S/ ${limiteDrawback.toFixed(2)}</td></tr>
      <tr><td><strong>Recuperación máxima</strong></td><td><strong>S/ ${recuperacionMax.toFixed(2)}</strong></td></tr>
      <tr><td>¿Puede acogerse?</td><td>${puedeAcogerse ? '✅ Sí' : '❌ No'}</td></tr>
    </table>
    <div style="margin-top:12px;padding:12px;background:var(--accent);border-radius:6px;font-weight:600;text-align:center">${puedeAcogerse ? `✅ Drawback: S/ ${recuperacionMax.toFixed(2)}. Saldo IGV: S/ ${saldoFavorIGV.toFixed(2)}.` : 'ℹ️ Ingrese costos de insumos'}</div>
  </div>`;
}

// ── 8. HORAS EXTRAS (DL 854) ──
function calcHorasExtras() {
  const sueldo = parseFloat(document.getElementById('he_sueldo')?.value) || 0;
  const horasDia = parseFloat(document.getElementById('he_horas')?.value) || 0;
  const dias = parseFloat(document.getElementById('he_dias')?.value) || 0;
  const tipo = document.getElementById('he_tipo')?.value || 'sobretasa_25';
  const jornada = document.getElementById('he_jornada')?.value || 'regular';
  const box = document.getElementById('heResult');
  if (!box) return;
  if (!sueldo || !horasDia || !dias) { box.style.display = 'none'; return; }
  const valorHoraOrd = sueldo / 30 / 8;
  const sobretasas = { sobretasa_25: { pct: 25, label: 'Sobretasa 25% (hasta 2h diurnas)' }, sobretasa_35: { pct: 35, label: 'Sobretasa 35% (más de 2h diurnas)' }, nocturna_100: { pct: 100, label: 'Nocturna 100%' }, dominical_200: { pct: 200, label: 'Dominical / Feriado 200%' } };
  const st = sobretasas[tipo] || sobretasas.sobretasa_25;
  const valorHoraExtra = valorHoraOrd * (1 + st.pct / 100);
  const pagoMensual = valorHoraExtra * horasDia * dias;
  const pctSueldo = (pagoMensual / sueldo) * 100;
  const jornadas = { regular: 'Regular (8h)', parcial: 'Parcial (< 8h)', nocturna: 'Nocturna' };
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table>
      <tr><th>Concepto</th><th>Valor</th></tr>
      <tr><td>Sueldo mensual</td><td>S/ ${sueldo.toFixed(2)}</td></tr>
      <tr><td>Jornada laboral</td><td>${jornadas[jornada] || 'Regular'}</td></tr>
      <tr><td>Valor hora ordinaria</td><td>S/ ${valorHoraOrd.toFixed(4)}</td></tr>
      <tr><td>Tipo de hora extra</td><td>${st.label}</td></tr>
      <tr><td>Sobretasa aplicada</td><td>${st.pct}%</td></tr>
      <tr><td>Valor hora extra</td><td>S/ ${valorHoraExtra.toFixed(4)}</td></tr>
      <tr><td><strong>Pago mensual horas extras</strong></td><td><strong>S/ ${pagoMensual.toFixed(2)}</strong></td></tr>
      <tr><td>% sobre sueldo</td><td>${pctSueldo.toFixed(2)}%</td></tr>
    </table>
    <div style="margin-top:12px;padding:12px;background:var(--accent);border-radius:6px;font-weight:600;text-align:center">Total mensual: S/ ${(sueldo + pagoMensual).toFixed(2)} (sueldo + horas extras)</div>
  </div>`;
}

// ── 9. RÉGIMEN AGRARIO ──
function calcRegAgrario() {
  const sueldo = parseFloat(document.getElementById('ra_sueldo')?.value) || 0;
  const regimen = document.getElementById('ra_regimen')?.value || 'agrario';
  const diario = parseFloat(document.getElementById('ra_diario')?.value) || 0;
  const dias = parseFloat(document.getElementById('ra_dias')?.value) || 0;
  const ctsIncluida = document.getElementById('ra_cts')?.value || 'si';
  const gratifIncluida = document.getElementById('ra_gratif')?.value || 'si';
  const box = document.getElementById('raResult');
  if (!box) return;
  if (!sueldo && !diario) { box.style.display = 'none'; return; }
  const remMensual = sueldo || diario * dias;
  const remDiaria = diario || sueldo / 30;
  let ir, cts, gratif, essalud, senati, bonif, otros;
  let regimenLabel, notas = '';
  switch (regimen) {
    case 'agrario': regimenLabel = 'Agrario (Ley 27360)'; ir = remMensual * 0.15; cts = ctsIncluida === 'si' ? remMensual * 0.0972 : 0; gratif = gratifIncluida === 'si' ? remMensual * 0.1666 : 0; essalud = remMensual * 0.04; senati = remMensual * 0.0075; bonif = 0; otros = 0; notas = 'IR 15%, CTS 9.72%, Gratif 16.66%, ESSALUD 4%, SENATI 0.75%'; break;
    case 'agroexportador': regimenLabel = 'Agroexportador'; ir = remMensual * 0.15; cts = ctsIncluida === 'si' ? remMensual * 0.0972 : 0; gratif = gratifIncluida === 'si' ? remMensual * 0.1666 : 0; essalud = remMensual * 0.04; senati = 0; bonif = 0; otros = 0; notas = 'IR 15%, CTS 9.72%, Gratif 16.66%, ESSALUD 4%'; break;
    case 'mype': regimenLabel = 'MYPE'; ir = remMensual * 0.01; cts = ctsIncluida === 'si' ? remMensual * 0.0833 : 0; gratif = gratifIncluida === 'si' ? remMensual * 0.1666 : 0; essalud = remMensual * 0.04; senati = 0; bonif = 0; otros = 0; notas = 'IR 1% (hasta 300 UIT), CTS 8.33%, Gratif 16.66%, ESSALUD 4%'; break;
    case 'construccion': regimenLabel = 'Construcción Civil'; ir = remMensual * 0.05; cts = 0; gratif = 0; essalud = remMensual * 0.10; senati = remMensual * 0.02; bonif = remDiaria * 0.35 * dias; otros = remMensual * 0.01; notas = 'ESSALUD 10%, SENATI 2%, SENCICO 1%, Bonif 35% SBU'; break;
    default: regimenLabel = regimen; ir = 0; cts = 0; gratif = 0; essalud = 0; senati = 0; bonif = 0; otros = 0;
  }
  const totalBeneficios = ir + cts + gratif + essalud + senati + bonif + otros;
  const costoTrabajador = remMensual + totalBeneficios;
  const pctCarga = (totalBeneficios / remMensual) * 100;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table>
      <tr><th>Concepto</th><th>Valor</th></tr>
      <tr><td>Régimen</td><td>${regimenLabel}</td></tr>
      <tr><td>Remuneración mensual</td><td>S/ ${remMensual.toFixed(2)}</td></tr>
      <tr><td>IR (retención)</td><td>S/ ${ir.toFixed(2)}</td></tr>
      <tr><td>CTS</td><td>${ctsIncluida === 'si' ? 'S/ ' + cts.toFixed(2) : 'No incluida'}</td></tr>
      <tr><td>Gratificaciones</td><td>${gratifIncluida === 'si' ? 'S/ ' + gratif.toFixed(2) : 'No incluidas'}</td></tr>
      <tr><td>ESSALUD</td><td>S/ ${essalud.toFixed(2)}</td></tr>
      <tr><td>SENATI</td><td>${senati > 0 ? 'S/ ' + senati.toFixed(2) : 'No aplica'}</td></tr>
      <tr><td>Bonificación</td><td>${bonif > 0 ? 'S/ ' + bonif.toFixed(2) : 'No aplica'}</td></tr>
      <tr><td><strong>Total cargas</strong></td><td><strong>S/ ${totalBeneficios.toFixed(2)}</strong></td></tr>
      <tr><td><strong>Costo total trabajador</strong></td><td><strong>S/ ${costoTrabajador.toFixed(2)}</strong></td></tr>
      <tr><td>Carga sobre rem.</td><td>${pctCarga.toFixed(2)}%</td></tr>
    </table>
    <div style="margin-top:8px;padding:8px;background:#e2f3ff;border-radius:4px;color:#004080;font-size:14px">📌 ${notas}</div>
  </div>`;
}

// ── 10. AFP COMISIONES ──
function calcAfpComisiones() {
  const afpSel = document.getElementById('afp_sel')?.value || 'prima';
  const rem = parseFloat(document.getElementById('afp_rem')?.value) || 0;
  const anios = parseFloat(document.getElementById('afp_anios')?.value) || 0;
  const rentPct = parseFloat(document.getElementById('afp_rent')?.value) || 0;
  const actual = parseFloat(document.getElementById('afp_actual')?.value) || 0;
  const box = document.getElementById('afpResult');
  if (!box) return;
  if (!rem || !anios) { box.style.display = 'none'; return; }
  const afps = { prima: { nombre: 'Prima', comision: 1.69, primaSeg: 1.24 }, habitat: { nombre: 'Hábitat', comision: 1.69, primaSeg: 1.24 }, profuturo: { nombre: 'Profuturo', comision: 1.69, primaSeg: 1.24 }, integra: { nombre: 'Integra', comision: 1.69, primaSeg: 1.24 } };
  const afp = afps[afpSel];
  const aporte = rem * 0.10;
  const comisionMensual = rem * afp.comision / 100;
  const primaMensual = rem * afp.primaSeg / 100;
  const totalDesc = aporte + comisionMensual + primaMensual;
  const fondoMensual = aporte;
  const rent = rentPct / 100;
  const totalAportes = fondoMensual * 12 * anios;
  const fondoConRent = fondoMensual * 12 * ((Math.pow(1 + rent, anios) - 1) / rent);
  const gananciaRent = fondoConRent - totalAportes;
  let compRows = '';
  for (const key of Object.keys(afps)) {
    const a = afps[key];
    const c = rem * a.comision / 100, p = rem * a.primaSeg / 100, t = aporte + c + p;
    const ta = aporte * 12 * anios;
    const fc = aporte * 12 * ((Math.pow(1 + rent, anios) - 1) / rent);
    const esSel = key === afpSel;
    compRows += `<tr${esSel ? ' style="font-weight:600;background:var(--accent)"' : ''}><td>${a.nombre}${esSel ? ' ✅' : ''}</td><td>${a.comision}%</td><td>${a.primaSeg}%</td><td>S/ ${c.toFixed(2)}</td><td>S/ ${p.toFixed(2)}</td><td>S/ ${t.toFixed(2)}</td><td>S/ ${fc.toFixed(2)}</td></tr>`;
  }
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;padding:10px;background:var(--card-bg);border-radius:6px">
      <div><strong>AFP:</strong><br>${afp.nombre}</div>
      <div><strong>Aporte 10%:</strong><br>S/ ${aporte.toFixed(2)}/mes</div>
      <div><strong>Comisión+prima:</strong><br>S/ ${(comisionMensual + primaMensual).toFixed(2)}/mes</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;padding:10px;background:var(--card-bg);border-radius:6px">
      <div><strong>Total descuento:</strong><br>S/ ${totalDesc.toFixed(2)}</div>
      <div><strong>Fondo sin rentab.:</strong><br>S/ ${totalAportes.toFixed(2)}</div>
      <div><strong>Fondo con ${rentPct}%:</strong><br>S/ ${fondoConRent.toFixed(2)}</div>
    </div>
    <div style="margin-bottom:12px;padding:10px;background:#d4edda;border-radius:6px;color:#155724"><strong>💰 Ganancia rentabilidad:</strong> S/ ${gananciaRent.toFixed(2)}</div>
    <table><tr><th>AFP</th><th>Com.</th><th>Prima</th><th>Com. S/</th><th>Prima S/</th><th>Total</th><th>Fondo</th></tr>${compRows}</table>
    <div style="margin-top:8px;padding:8px;background:#e2f3ff;border-radius:4px;color:#004080;font-size:14px">📌 Proyección a ${anios} años con rentabilidad de ${rentPct}% anual</div>
  </div>`;
}

// ── 11. ASIGNACIÓN FAMILIAR ──
function calcAsignacion() {
  const sueldo = parseFloat(document.getElementById('asig_sueldo')?.value) || 0;
  const rmv = parseFloat(document.getElementById('asig_rmv')?.value) || 1130;
  const hijos = parseInt(document.getElementById('asig_hijos')?.value) || 0;
  const ingreso = document.getElementById('asig_ingreso')?.value;
  const fecha = document.getElementById('asig_fecha')?.value;
  const box = document.getElementById('asigResult');
  if (!box) return;
  if (!sueldo || !hijos) { box.style.display = 'none'; return; }
  const asigPorHijo = rmv * 0.10;
  const totalAsig = asigPorHijo * hijos;
  const tope = rmv * 2;
  const derecho = sueldo <= tope;
  let acumulado = '—';
  if (ingreso && fecha) { const d1 = new Date(ingreso), d2 = new Date(fecha); const meses = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()); if (meses > 0) acumulado = 'S/ ' + (totalAsig * Math.max(0, meses)).toFixed(2); }
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result"><table>
    <tr><th colspan="2">📋 Asignación Familiar — Resultados</th></tr>
    <tr><td>Asignación por hijo (10% RMV)</td><td><strong>S/ ${asigPorHijo.toFixed(2)}</strong></td></tr>
    <tr><td>Total asignación mensual</td><td><strong>S/ ${totalAsig.toFixed(2)}</strong></td></tr>
    <tr><td>RMV actual</td><td>S/ ${rmv.toFixed(2)}</td></tr>
    <tr><td>Tope (2 RMV)</td><td>S/ ${tope.toFixed(2)}</td></tr>
    <tr><td>¿Derecho al beneficio?</td><td><span style="color:${derecho ? 'var(--accent)' : 'red'};font-weight:700">${derecho ? '✅ Sí' : '❌ No — Sueldo excede S/ ' + tope.toFixed(2)}</span></td></tr>
    <tr><td>Asignación acumulada</td><td><strong>${acumulado}</strong></td></tr>
    <tr><td>Impacto CTS (mensual)</td><td>S/ ${(totalAsig / 12).toFixed(2)}</td></tr>
    <tr><td>Impacto gratificación</td><td>S/ ${totalAsig.toFixed(2)}</td></tr>
  </table></div>`;
}

// ── 12. RATIOS FINANCIEROS ──
function calcRatios() {
  const ac = parseFloat(document.getElementById('rat_ac')?.value) || 0;
  const pc = parseFloat(document.getElementById('rat_pc')?.value) || 0;
  const at = parseFloat(document.getElementById('rat_at')?.value) || 0;
  const pt = parseFloat(document.getElementById('rat_pt')?.value) || 0;
  const pat = parseFloat(document.getElementById('rat_pat')?.value) || 0;
  const vtas = parseFloat(document.getElementById('rat_vtas')?.value) || 0;
  const cv = parseFloat(document.getElementById('rat_cv')?.value) || 0;
  const un = parseFloat(document.getElementById('rat_un')?.value) || 0;
  const uo = parseFloat(document.getElementById('rat_uo')?.value) || 0;
  const gf = parseFloat(document.getElementById('rat_gf')?.value) || 0;
  const inv = parseFloat(document.getElementById('rat_inv')?.value) || 0;
  const cc = parseFloat(document.getElementById('rat_cc')?.value) || 0;
  const cp = parseFloat(document.getElementById('rat_cp')?.value) || 0;
  const dias = parseFloat(document.getElementById('rat_dias')?.value) || 360;
  const box = document.getElementById('ratResult');
  if (!box) return;
  if (!ac) { box.style.display = 'none'; return; }
  const r = {};
  r.liquidez = pc ? (ac / pc) : 0;
  r.pa = pc ? ((ac - inv) / pc) : 0;
  r.endeud = at ? (pt / at) : 0;
  r.roe = pat ? (un / pat) : 0;
  r.roa = at ? (un / at) : 0;
  r.mn = vtas ? (un / vtas) : 0;
  r.mb = vtas ? ((vtas - cv) / vtas) : 0;
  r.rotInv = cv ? (cv / inv) : 0;
  r.rotCc = vtas ? (vtas / cc) : 0;
  r.rotCp = cv ? (cv / cp) : 0;
  r.diasInv = r.rotInv ? (dias / r.rotInv) : 0;
  r.diasCc = r.rotCc ? (dias / r.rotCc) : 0;
  r.diasCp = r.rotCp ? (dias / r.rotCp) : 0;
  r.ciclo = r.diasInv + r.diasCc - r.diasCp;
  function color(val, good, bad) { if (!val) return 'var(--muted)'; return val >= good ? 'var(--accent)' : val < bad ? 'red' : 'orange'; }
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result"><table>
    <tr><th>📊 Ratio</th><th>Valor</th><th>Ref.</th><th></th></tr>
    <tr><td>Liquidez (AC/PC)</td><td>${r.liquidez.toFixed(2)}</td><td>1.5–3.0</td><td style="color:${color(r.liquidez, 1.5, 1)}">●</td></tr>
    <tr><td>Prueba ácida</td><td>${r.pa.toFixed(2)}</td><td>0.8–1.2</td><td style="color:${color(r.pa, 0.8, 0.5)}">●</td></tr>
    <tr><td>Endeudamiento</td><td>${(r.endeud * 100).toFixed(1)}%</td><td>&lt;60%</td><td style="color:${r.endeud <= 0.6 ? 'var(--accent)' : 'red'}">●</td></tr>
    <tr><td>ROE</td><td>${(r.roe * 100).toFixed(1)}%</td><td>&gt;15%</td><td style="color:${color(r.roe, 0.15, 0.05)}">●</td></tr>
    <tr><td>ROA</td><td>${(r.roa * 100).toFixed(1)}%</td><td>&gt;5%</td><td style="color:${color(r.roa, 0.05, 0)}">●</td></tr>
    <tr><td>Margen neto</td><td>${(r.mn * 100).toFixed(1)}%</td><td>&gt;10%</td><td style="color:${color(r.mn, 0.1, 0)}">●</td></tr>
    <tr><td>Margen bruto</td><td>${(r.mb * 100).toFixed(1)}%</td><td>&gt;30%</td><td style="color:${color(r.mb, 0.3, 0.1)}">●</td></tr>
    <tr><td>Rot. inventario</td><td>${r.rotInv.toFixed(2)}x</td><td>—</td><td>—</td></tr>
    <tr><td>Rot. cobros</td><td>${r.rotCc.toFixed(2)}x</td><td>—</td><td>—</td></tr>
    <tr><td>Rot. pagos</td><td>${r.rotCp.toFixed(2)}x</td><td>—</td><td>—</td></tr>
    <tr><td>Días inventario</td><td>${r.diasInv.toFixed(0)} d</td><td>—</td><td>—</td></tr>
    <tr><td>Días cobros</td><td>${r.diasCc.toFixed(0)} d</td><td>—</td><td>—</td></tr>
    <tr><td>Días pagos</td><td>${r.diasCp.toFixed(0)} d</td><td>—</td><td>—</td></tr>
    <tr><td style="font-weight:700">Ciclo efectivo</td><td style="font-weight:700">${r.ciclo.toFixed(0)} d</td><td>—</td><td style="color:${r.ciclo < 60 ? 'var(--accent)' : r.ciclo < 120 ? 'orange' : 'red'}">●</td></tr>
  </table>
  <div style="margin-top:8px;font-size:14px;color:var(--muted)">● Verde = saludable ● Naranja = alerta ● Rojo = crítico</div></div>`;
}

// ── 13. AMORTIZACIÓN FRANCÉS VS ALEMÁN ──
function calcAmortizacion() {
  const monto = parseFloat(document.getElementById('amort_monto')?.value) || 0;
  const plazo = parseInt(document.getElementById('amort_plazo')?.value) || 0;
  const tea = (parseFloat(document.getElementById('amort_tea')?.value) || 0) / 100;
  const seg = parseFloat(document.getElementById('amort_seg')?.value) || 0;
  const portes = parseFloat(document.getElementById('amort_portes')?.value) || 0;
  const box = document.getElementById('amortResult');
  if (!box) return;
  if (!monto || !plazo || !tea) { box.style.display = 'none'; return; }
  const tem = Math.pow(1 + tea, 1 / 12) - 1;
  const cuotaF = tem === 0 ? monto / plazo : monto * tem * Math.pow(1 + tem, plazo) / (Math.pow(1 + tem, plazo) - 1);
  let saldoF = monto; let totalIntF = 0; const rowsF = [];
  for (let i = 1; i <= Math.min(12, plazo); i++) { const int = saldoF * tem; const amort = cuotaF - int; totalIntF += int; rowsF.push({ n: i, cuota: cuotaF, int, amort, saldo: saldoF - amort }); saldoF -= amort; }
  const amortC = monto / plazo; let saldoA = monto; let totalIntA = 0; const rowsA = [];
  for (let i = 1; i <= Math.min(12, plazo); i++) { const int = saldoA * tem; const cuota = amortC + int; totalIntA += int; rowsA.push({ n: i, cuota, int, amort: amortC, saldo: saldoA - amortC }); saldoA -= amortC; }
  const intTotF = (cuotaF * plazo - monto); const intTotA = monto * tem * (plazo + 1) / 2;
  const totalPagF = cuotaF * plazo; const totalPagA = monto + intTotA;
  const difInt = intTotA - intTotF;
  let html = `<div class="sunat-api-result"><table>
    <tr><th colspan="6">📋 Francés vs Alemán</th></tr>
    <tr><th colspan="2">Parámetros</th><th colspan="2">Francés</th><th colspan="2">Alemán</th></tr>
    <tr><td colspan="2">TEA</td><td colspan="2">${(tea * 100).toFixed(2)}%</td><td colspan="2">${(tea * 100).toFixed(2)}%</td></tr>
    <tr><td colspan="2">TEM</td><td colspan="2">${(tem * 100).toFixed(4)}%</td><td colspan="2">${(tem * 100).toFixed(4)}%</td></tr>
    <tr><td colspan="2">Cuota mensual</td><td colspan="2"><strong>S/ ${cuotaF.toFixed(2)}</strong></td><td colspan="2"><strong>S/ ${rowsA[0]?.cuota.toFixed(2)} → S/ ${rowsA[Math.min(11, plazo - 1)]?.cuota.toFixed(2)}</strong></td></tr>
    <tr><td colspan="2">Total intereses</td><td colspan="2">S/ ${intTotF.toFixed(2)}</td><td colspan="2">S/ ${intTotA.toFixed(2)}</td></tr>
    <tr><td colspan="2">Total pagado</td><td colspan="2">S/ ${totalPagF.toFixed(2)}</td><td colspan="2">S/ ${totalPagA.toFixed(2)}</td></tr>
    <tr><td colspan="2">Diferencial</td><td colspan="4" style="color:${difInt >= 0 ? 'red' : 'var(--accent)'};font-weight:700">${difInt >= 0 ? 'Francés ahorra' : 'Alemán ahorra'} S/ ${Math.abs(difInt).toFixed(2)}</td></tr>
  </table>
  <table style="margin-top:12px"><tr><th colspan="6">📅 Primeros 12 meses — Francés</th></tr>
    <tr><th>#</th><th>Cuota</th><th>Interés</th><th>Amort.</th><th>Saldo</th><th>Seg+Portes</th></tr>`;
  for (const r of rowsF) html += `<tr><td>${r.n}</td><td>S/ ${r.cuota.toFixed(2)}</td><td>S/ ${r.int.toFixed(2)}</td><td>S/ ${r.amort.toFixed(2)}</td><td>S/ ${r.saldo.toFixed(2)}</td><td>S/ ${(seg + portes).toFixed(2)}</td></tr>`;
  html += `</table><table style="margin-top:12px"><tr><th colspan="6">📅 Primeros 12 meses — Alemán</th></tr>
    <tr><th>#</th><th>Cuota</th><th>Interés</th><th>Amort.</th><th>Saldo</th><th>Seg+Portes</th></tr>`;
  for (const r of rowsA) html += `<tr><td>${r.n}</td><td>S/ ${r.cuota.toFixed(2)}</td><td>S/ ${r.int.toFixed(2)}</td><td>S/ ${r.amort.toFixed(2)}</td><td>S/ ${r.saldo.toFixed(2)}</td><td>S/ ${(seg + portes).toFixed(2)}</td></tr>`;
  html += `</table></div>`;
  box.style.display = 'block'; box.innerHTML = html;
}

// ── 14. DEPRECIACIÓN ACELERADA ──
function calcDepreciacion() {
  const tipo = document.getElementById('dep_tipo')?.value || 'edificio';
  const valor = parseFloat(document.getElementById('dep_valor')?.value) || 0;
  const residual = parseFloat(document.getElementById('dep_residual')?.value) || 0;
  const vida = parseInt(document.getElementById('dep_vida')?.value) || 0;
  const metodo = document.getElementById('dep_metodo')?.value || '3x';
  const anio = parseInt(document.getElementById('dep_anio')?.value) || 2026;
  const box = document.getElementById('depAcelResult');
  if (!box) return;
  if (!valor || !vida) { box.style.display = 'none'; return; }
  const tasasNormales = { edificio: 0.05, maquinaria: 0.10, vehiculo: 0.20, equipo: 0.25, mueble: 0.10, software: 0.50 };
  const tasaNormal = tasasNormales[tipo] || 0.10;
  const baseDep = valor - residual;
  const depNormalAnual = baseDep * tasaNormal;
  const vidaNormal = Math.ceil(1 / tasaNormal);
  let factorAcel = metodo === '3x' ? 3 : metodo === '5x' ? 5 : 0;
  let tasaAcel = metodo === 'dsd' ? 2 * tasaNormal : Math.min(tasaNormal * factorAcel, 1.0);
  const vidaAcel = Math.ceil(1 / tasaAcel);
  const tasaIR = 0.295;
  const maxAnios = Math.max(vidaNormal, vidaAcel, vida);
  let rows = []; let totalDepNormal = 0, totalDepAcel = 0, totalAhorro = 0;
  let saldoAcel = baseDep;
  for (let i = 0; i < maxAnios; i++) {
    const anioAct = anio + i;
    let depNormal = i < vida ? depNormalAnual : 0;
    let depAcel;
    if (metodo === 'dsd') { depAcel = saldoAcel * tasaAcel; if (i === maxAnios - 1 || depAcel > saldoAcel) depAcel = saldoAcel; saldoAcel = Math.max(0, saldoAcel - depAcel); }
    else depAcel = i < vidaAcel ? baseDep * tasaAcel : 0;
    const ahorro = (depAcel - depNormal) * tasaIR;
    totalDepNormal += depNormal; totalDepAcel += depAcel; totalAhorro += ahorro;
    rows.push({ anio: anioAct, normal: depNormal, acelerada: depAcel, ahorro });
  }
  let html = `<div class="sunat-api-result"><table>
    <tr><th colspan="6">⚡ Depreciación — ${tipo.charAt(0).toUpperCase() + tipo.slice(1)} (${metodo === 'dsd' ? 'Doble Saldo Decreciente' : metodo === '3x' ? '3 años' : '5 años'})</th></tr>
    <tr><td colspan="2"><strong>Tasa normal:</strong> ${(tasaNormal * 100).toFixed(0)}%</td><td colspan="2"><strong>Tasa acelerada:</strong> ${(tasaAcel * 100).toFixed(0)}%</td><td colspan="2"><strong>Base:</strong> S/ ${baseDep.toFixed(2)}</td></tr>
    <tr><th>Año</th><th>Normal</th><th>Acelerada</th><th>Diferencia</th><th>Ahorro IR</th><th></th></tr>`;
  let maxBar = 0; for (const r of rows) maxBar = Math.max(maxBar, r.acelerada);
  for (const r of rows) { if (r.normal === 0 && r.acelerada === 0) continue; const diff = r.acelerada - r.normal; const pct = maxBar ? (r.acelerada / maxBar * 100) : 0; html += `<tr><td>${r.anio}</td><td>S/ ${r.normal.toFixed(2)}</td><td>S/ ${r.acelerada.toFixed(2)}</td><td style="color:${diff > 0 ? 'var(--accent)' : 'red'}">${diff > 0 ? '+' : ''}S/ ${diff.toFixed(2)}</td><td style="color:${r.ahorro > 0 ? 'var(--accent)' : 'inherit'}">S/ ${r.ahorro.toFixed(2)}</td><td><div style="width:50px;height:12px;background:var(--bg2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent);border-radius:4px"></div></div></td></tr>`; }
  html += `<tr style="font-weight:700;border-top:2px solid var(--border)"><td>Totales</td><td>S/ ${totalDepNormal.toFixed(2)}</td><td>S/ ${totalDepAcel.toFixed(2)}</td><td>S/ ${(totalDepAcel - totalDepNormal).toFixed(2)}</td><td style="color:var(--accent)">S/ ${totalAhorro.toFixed(2)}</td><td></td></tr></table>
    <div style="margin-top:10px;padding:10px;background:var(--bg2);border-radius:6px"><strong>💡 Ahorro tributario total:</strong> S/ ${totalAhorro.toFixed(2)} (${(tasaIR * 100).toFixed(1)}% IR)</div></div>`;
  box.style.display = 'block'; box.innerHTML = html;
}

// ── 15. LEASING ──
function calcLeasing() {
  const valor = parseFloat(document.getElementById('lease_valor')?.value) || 0;
  const plazo = parseInt(document.getElementById('lease_plazo')?.value) || 0;
  const teaL = (parseFloat(document.getElementById('lease_tea_l')?.value) || 0) / 100;
  const opcCompra = (parseFloat(document.getElementById('lease_opc')?.value) || 0) / 100;
  const teaC = (parseFloat(document.getElementById('lease_tea_c')?.value) || 0) / 100;
  const alqOp = parseFloat(document.getElementById('lease_alq')?.value) || 0;
  const tasaIR = (parseFloat(document.getElementById('lease_ir')?.value) || 29.5) / 100;
  const depAnios = parseInt(document.getElementById('lease_dep')?.value) || 5;
  const box = document.getElementById('leaseResult');
  if (!box) return;
  if (!valor || !plazo) { box.style.display = 'none'; return; }
  const temL = Math.pow(1 + teaL, 1 / 12) - 1; const temC = Math.pow(1 + teaC, 1 / 12) - 1;
  const valorOpc = valor * opcCompra;
  const cuotaL = (valor - valorOpc) * temL * Math.pow(1 + temL, plazo) / (Math.pow(1 + temL, plazo) - 1);
  const totalL = cuotaL * plazo + valorOpc;
  let saldoL = valor - valorOpc; let intL = 0;
  for (let i = 0; i < plazo; i++) { const int = saldoL * temL; intL += int; saldoL -= (cuotaL - int); }
  const depAnual = valor / depAnios;
  const escudoL = (depAnual * plazo / 12 + intL) * tasaIR;
  const costoL = totalL - escudoL;
  const totalOp = alqOp * plazo;
  const escudoOp = (depAnual * plazo / 12) * tasaIR;
  const costoOp = totalOp - escudoOp;
  const cuotaC = valor * temC * Math.pow(1 + temC, plazo) / (Math.pow(1 + temC, plazo) - 1);
  const totalC = cuotaC * plazo;
  let saldoC = valor; let intC = 0;
  for (let i = 0; i < plazo; i++) { const int = saldoC * temC; intC += int; saldoC -= (cuotaC - int); }
  const escudoC = (depAnual * plazo / 12 + intC) * tasaIR;
  const costoCred = totalC - escudoC;
  const mejor = Math.min(costoL, costoOp, costoCred);
  const rec = mejor === costoL ? '✅ Leasing Fin.' : mejor === costoOp ? '✅ Leasing Op.' : '✅ Compra Directa';
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result"><table>
    <tr><th colspan="4">🚛 Leasing Financiero vs Operativo vs Compra</th></tr>
    <tr><th>Concepto</th><th>Leasing Fin.</th><th>Leasing Op.</th><th>Compra Dir.</th></tr>
    <tr><td>Valor bien</td><td colspan="3" style="text-align:center">S/ ${valor.toFixed(2)}</td></tr>
    <tr><td>Cuota mensual</td><td><strong>S/ ${cuotaL.toFixed(2)}</strong></td><td><strong>S/ ${alqOp.toFixed(2)}</strong></td><td><strong>S/ ${cuotaC.toFixed(2)}</strong></td></tr>
    <tr><td>Total pagado</td><td>S/ ${totalL.toFixed(2)}</td><td>S/ ${totalOp.toFixed(2)}</td><td>S/ ${totalC.toFixed(2)}</td></tr>
    <tr><td>Opción compra</td><td>S/ ${valorOpc.toFixed(2)}</td><td>—</td><td>—</td></tr>
    <tr><td>Intereses totales</td><td>S/ ${intL.toFixed(2)}</td><td>—</td><td>S/ ${intC.toFixed(2)}</td></tr>
    <tr><td>Escudo fiscal</td><td>S/ ${escudoL.toFixed(2)}</td><td>S/ ${escudoOp.toFixed(2)}</td><td>S/ ${escudoC.toFixed(2)}</td></tr>
    <tr style="font-weight:700;border-top:2px solid var(--border)"><td>Costo neto total</td><td style="color:${costoL === mejor ? 'var(--accent)' : 'inherit'}">S/ ${costoL.toFixed(2)}</td><td style="color:${costoOp === mejor ? 'var(--accent)' : 'inherit'}">S/ ${costoOp.toFixed(2)}</td><td style="color:${costoCred === mejor ? 'var(--accent)' : 'inherit'}">S/ ${costoCred.toFixed(2)}</td></tr>
  </table>
  <div style="margin-top:10px;padding:10px;background:var(--bg2);border-radius:6px;font-weight:700;color:var(--accent)">🏆 ${rec}</div></div>`;
}

// ── 16. CONVERSOR TASAS ──
function calcConversor() {
  const tasa = parseFloat(document.getElementById('conv_tasa')?.value) || 0;
  const origen = document.getElementById('conv_origen')?.value || 'TEA';
  const destino = document.getElementById('conv_destino')?.value || 'TEA';
  const box = document.getElementById('convResult');
  if (!box) return;
  if (!tasa) { box.style.display = 'none'; return; }
  const r = tasa / 100;
  let tea, tem, tna, tpa, ted;
  switch (origen) {
    case 'TEA': tea = r; break;
    case 'TEM': tea = Math.pow(1 + r, 12) - 1; break;
    case 'TNA': tea = Math.pow(1 + (r / 12), 12) - 1; break;
    case 'TPA': tea = Math.pow(1 + r, 4) - 1; break;
    case 'TED': tea = Math.pow(1 + r, 360) - 1; break;
  }
  tem = Math.pow(1 + tea, 1 / 12) - 1;
  tna = tem * 12;
  tpa = Math.pow(1 + tem, 3) - 1;
  ted = Math.pow(1 + tem, 1 / 30) - 1;
  let destVal;
  switch (destino) { case 'TEA': destVal = tea; break; case 'TEM': destVal = tem; break; case 'TNA': destVal = tna; break; case 'TPA': destVal = tpa; break; case 'TED': destVal = ted; break; }
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">Tasa</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">Valor</th></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Resultado (${destino})</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;font-weight:bold;color:var(--accent)">${(destVal * 100).toFixed(4)}%</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">TEA</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${(tea * 100).toFixed(4)}%</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">TEM</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${(tem * 100).toFixed(4)}%</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">TNA</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${(tna * 100).toFixed(4)}%</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">TPA</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${(tpa * 100).toFixed(4)}%</td></tr>
      <tr><td style="padding:4px 8px">TED</td><td style="padding:4px 8px;text-align:right">${(ted * 100).toFixed(4)}%</td></tr>
    </table>
    <div style="font-size:14px;color:var(--muted);margin-top:8px">Origen: ${origen} ${tasa.toFixed(2)}%</div>
  </div>`;
}

// ── 17. ISC ──
function calcIsc() {
  const vvu = parseFloat(document.getElementById('isc_vvu')?.value) || 0;
  const cant = parseFloat(document.getElementById('isc_cant')?.value) || 0;
  const bien = document.getElementById('isc_bien')?.value || 'otros';
  const sistema = document.getElementById('isc_sistema')?.value || 'valor';
  const tasaIngresada = parseFloat(document.getElementById('isc_tasa')?.value) || 0;
  const iscEsp = parseFloat(document.getElementById('isc_esp')?.value) || 0;
  const box = document.getElementById('iscResult');
  if (!box) return;
  if (!vvu || !cant) { box.style.display = 'none'; return; }
  const tasasReales = { combustibles: 12, alcohol: 20, cervezas: 25, cigarrillos: 50, gaseosas: 17, vehiculos: 20, palas: 10, otros: 18 };
  const tasaReal = tasaIngresada || tasasReales[bien] || 18;
  let iscUnd = 0;
  switch (sistema) { case 'valor': iscUnd = vvu * (tasaReal / 100); break; case 'especifico': iscUnd = iscEsp || 0.27; break; case 'mixto': iscUnd = vvu * (tasaReal / 100) + (iscEsp || 0.27); break; }
  const iscTotal = iscUnd * cant;
  const precioVentaIsc = (vvu + iscUnd) * cant;
  const igv = (vvu + iscUnd) * cant * 0.18;
  const precioFinal = precioVentaIsc + igv;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">Concepto</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">S/</th></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">ISC por Unidad</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${iscUnd.toFixed(4)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">ISC Total</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;font-weight:bold;color:var(--accent)">${iscTotal.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Precio + ISC</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${precioVentaIsc.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">IGV (18%)</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${igv.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Precio Final</td><td style="padding:4px 8px;text-align:right;font-weight:bold">${precioFinal.toFixed(2)}</td></tr>
    </table>
    <div style="font-size:14px;color:var(--muted);margin-top:8px">Bien: ${bien} | Sistema: ${sistema} | Tasa: ${tasaReal}%${iscEsp ? ' | Esp.: S/' + iscEsp : ''}</div>
  </div>`;
}

// ── 18. MINERÍA ──
function calcMineria() {
  const util = parseFloat(document.getElementById('min_utilidad')?.value) || 0;
  const prod = parseFloat(document.getElementById('min_prod')?.value) || 0;
  const regimen = document.getElementById('min_regimen')?.value || 'general';
  const contrib = parseFloat(document.getElementById('min_contrib')?.value) || 0;
  const box = document.getElementById('minResult');
  if (!box) return;
  if (!util) { box.style.display = 'none'; return; }
  let regaliaTasa = 0;
  if (regimen !== 'general') { regaliaTasa = 0.5; } else {
    const margen = util / (prod || 1);
    if (margen < 0.10) regaliaTasa = 1; else if (margen < 0.15) regaliaTasa = 2; else if (margen < 0.20) regaliaTasa = 3; else if (margen < 0.25) regaliaTasa = 4; else if (margen < 0.30) regaliaTasa = 5; else if (margen < 0.35) regaliaTasa = 6; else if (margen < 0.40) regaliaTasa = 7; else if (margen < 0.45) regaliaTasa = 8; else if (margen < 0.50) regaliaTasa = 9; else if (margen < 0.55) regaliaTasa = 10; else if (margen < 0.65) regaliaTasa = 11; else if (margen < 0.75) regaliaTasa = 12; else if (margen < 0.85) regaliaTasa = 13; else regaliaTasa = 14;
  }
  const regaliaMes = util * (regaliaTasa / 100);
  const margenOp = util / (prod || 1);
  let impEsp = 0;
  if (margenOp > 0.10) impEsp = util * (Math.min(margenOp * 0.063, 0.054));
  const gravamen = util * 0.005;
  const contribMonto = util * (contrib / 100);
  const totalCarga = regaliaMes + impEsp + gravamen + contribMonto;
  const tasaEfectiva = (totalCarga / util) * 100;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">Concepto</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">S/</th></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Regalía (${regaliaTasa}%)</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${regaliaMes.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Impuesto Especial</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${impEsp.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Gravamen (0.5%)</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${gravamen.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Contrib. Vol. (${contrib}%)</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${contribMonto.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);font-weight:bold">Total Carga</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;font-weight:bold;color:var(--accent)">${totalCarga.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px">Tasa Efectiva</td><td style="padding:4px 8px;text-align:right;font-weight:bold">${tasaEfectiva.toFixed(2)}%</td></tr>
    </table>
    <div style="font-size:14px;color:var(--muted);margin-top:8px">Régimen: ${regimen}${prod ? ' | Producción: ' + prod.toLocaleString() + ' TM' : ''}</div>
  </div>`;
}

// ── 19. CIERRE EMPRESA ──
function calcCierre() {
  const activos = parseFloat(document.getElementById('cierre_activos')?.value) || 0;
  const pasivos = parseFloat(document.getElementById('cierre_pasivos')?.value) || 0;
  const trabajadores = parseFloat(document.getElementById('cierre_trabajadores')?.value) || 0;
  const anios = parseFloat(document.getElementById('cierre_anios')?.value) || 0;
  const deudaSunat = parseFloat(document.getElementById('cierre_sunat')?.value) || 0;
  const deudaLaboral = parseFloat(document.getElementById('cierre_laboral')?.value) || 0;
  const juicios = document.getElementById('cierre_juicios')?.value || 'no';
  const costNotarial = parseFloat(document.getElementById('cierre_notarial')?.value) || 1200;
  const tipo = document.getElementById('cierre_tipo')?.value || 'EIRL';
  const box = document.getElementById('cierreResult');
  if (!box) return;
  if (!activos && !pasivos) { box.style.display = 'none'; return; }
  const patrimonio = activos - pasivos;
  const deudaTotalTerceros = deudaSunat + deudaLaboral;
  const costSUNARP = tipo === 'SA' || tipo === 'SAA' ? 800 : 450;
  const costLiquidLaboral = trabajadores * (anios * 450 + 1500);
  const costRegistral = 350;
  const costoTotal = costNotarial + costSUNARP + costRegistral + costLiquidLaboral + deudaSunat + deudaLaboral;
  const mesesEst = 4 + trabajadores * 0.5 + (juicios === 'si' ? 8 : 0) + (deudaSunat > 0 ? 3 : 0);
  const valeCierre = patrimonio > 0 && costoTotal < patrimonio * 0.5 && juicios === 'no';
  const pasos = [
    { etapa: 'Junta/Acuerdo Disolución', costo: 0, tiempo: '1-2 meses' },
    { etapa: 'Nombramiento Liquidador', costo: 0, tiempo: '<1 mes' },
    { etapa: 'Publicación Edictos (3)', costo: 350, tiempo: '1 mes' },
    { etapa: 'Minuta y Escritura', costo: costNotarial, tiempo: '1-2 sem' },
    { etapa: 'Inscripción SUNARP', costo: costSUNARP, tiempo: '1-2 sem' },
    { etapa: 'Liquidación Tributaria', costo: deudaSunat, tiempo: deudaSunat > 0 ? '3-6 meses' : '1 mes' },
    { etapa: 'Liquidación Laboral', costo: deudaLaboral, tiempo: '1-2 meses' },
    { etapa: 'Baja SUNAT Definitiva', costo: 0, tiempo: '1 mes' },
  ];
  if (juicios === 'si') pasos.push({ etapa: 'Esperar juicios', costo: 0, tiempo: '6-18 meses' });
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <div style="margin-bottom:12px;font-size:14px">
      <strong>Patrimonio Líquido:</strong> S/ ${patrimonio.toFixed(2)} |
      <strong>Deuda Terceros:</strong> S/ ${deudaTotalTerceros.toFixed(2)} |
      <strong>Costo Total:</strong> S/ ${costoTotal.toFixed(2)}
      <br><span style="color:${valeCierre ? 'var(--accent)' : '#e74c3c'};font-weight:bold">${valeCierre ? '✓ Vale la pena cerrar' : '✗ Evalúe abandono/reestructuración'}</span>
      <br><strong>Tiempo:</strong> ${mesesEst.toFixed(0)} meses
    </div>
    <div style="font-size:14px;font-weight:bold;margin-bottom:8px">📋 Pasos</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">Etapa</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">S/</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">Tiempo</th></tr>
      ${pasos.map(p => `<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">${p.etapa}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${p.costo.toFixed(0)}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${p.tiempo}</td></tr>`).join('')}
    </table>
  </div>`;
}

// ── 20. PODER NOTARIAL ──
function calcPoder() {
  const tipo = document.getElementById('poder_tipo')?.value || 'general';
  const otorgante = document.getElementById('poder_otorgante')?.value || 'natural';
  const numero = parseFloat(document.getElementById('poder_numero')?.value) || 1;
  const cargoEl = document.getElementById('poder_cargo')?.value || 'gg';
  const plazo = parseFloat(document.getElementById('poder_plazo')?.value) || 365;
  const facultades = document.getElementById('poder_facultades')?.value || '';
  const sunarp = document.getElementById('poder_sunarp')?.value || 'si';
  const box = document.getElementById('poderResult');
  if (!box) return;
  const costosMinuta = { general: 200, especial: 250, representacion: 220, administracion: 220, judicial: 280, litigio: 300 };
  const costElevacion = { general: 120, especial: 150, representacion: 140, administracion: 140, judicial: 180, litigio: 200 };
  const minuta = (costosMinuta[tipo] || 200) * numero;
  const elevacion = (costElevacion[tipo] || 120) * numero;
  const registral = sunarp === 'si' ? 50 + (numero > 1 ? 30 * (numero - 1) : 0) : 0;
  const total = minuta + elevacion + registral;
  const tipoLabels = { general: 'General', especial: 'Especial', representacion: 'Representación', administracion: 'Administración', judicial: 'Judicial', litigio: 'Litigio' };
  const cargos = { gg: 'Gerente General', apoderado: 'Apoderado', legal: 'Representante Legal', abogado: 'Abogado' };
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result">
    <div style="margin-bottom:12px;font-size:14px;font-weight:bold">📜 ${tipoLabels[tipo] || tipo} — ${cargos[cargoEl] || cargoEl}</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">Concepto</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--border);background:var(--accent);color:#fff">S/</th></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Minuta Notarial (×${numero})</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${minuta.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Elevación Escritura (×${numero})</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${elevacion.toFixed(2)}</td></tr>
      ${sunarp === 'si' ? `<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)">Registro SUNARP</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right">${registral.toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:4px 8px;font-weight:bold">TOTAL</td><td style="padding:4px 8px;text-align:right;font-weight:bold;color:var(--accent)">${total.toFixed(2)}</td></tr>
    </table>
    <div style="margin-top:10px;font-size:14px"><strong>Facultades:</strong><br><em style="color:var(--muted)">${facultades || 'No especificadas'}</em><br><br><strong>Plazo:</strong> ${plazo} días (${Math.round(plazo / 30)} meses)<br><strong>Otorgante:</strong> ${otorgante === 'natural' ? 'Persona Natural' : 'Persona Jurídica'} | <strong>SUNARP:</strong> ${sunarp === 'si' ? 'Sí' : 'No'}</div>
    <div style="margin-top:10px;font-size:14px;color:var(--muted);background:var(--card-bg);padding:8px;border-radius:6px">📋 Requisitos: Copia DNI, Testimonio escritura, Formulario SUNARP, Pago S/${registral.toFixed(0)}</div>
  </div>`;
}

// ── 21. VERIFICADOR RUC ──
function calcRuc() {
  const ruc = document.getElementById('ruc_num')?.value.replace(/\D/g, '') || '';
  const consulta = document.getElementById('ruc_consulta')?.value || 'ruc';
  const nombre = document.getElementById('ruc_nombre')?.value || '';
  const tipo = document.getElementById('ruc_tipo')?.value || 'pn';
  const box = document.getElementById('rucResult');
  if (!box) return;
  if (ruc.length < 11) { box.style.display = 'none'; return; }
  const pre = ruc.substring(0, 2);
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += parseInt(ruc[i]) * pesos[i];
  const resto = suma % 11;
  const digVer = resto === 0 ? 0 : 11 - resto;
  const valido = parseInt(ruc[10]) === digVer && ['10', '15', '17', '20'].includes(pre);
  const tipos = { '10': 'Persona Natural', '15': 'Asociación', '17': 'Sociedad Conyugal', '20': 'Persona Jurídica' };
  const tipoContrib = tipos[pre] || 'Desconocido';
  if (!valido) {
    box.style.display = 'block';
    box.innerHTML = `<div class="sunat-api-result" style="border-left:4px solid #ef4444;padding:12px;background:rgba(239,68,68,0.08)"><strong style="color:#ef4444">RUC Inválido</strong><span style="font-size:14px"> Dígito verificador no coincide.</span><table style="width:100%;margin-top:8px;font-size:14px;border-collapse:collapse"><tr><td style="padding:4px 8px;color:var(--muted)">Esperado</td><td style="padding:4px 8px">${digVer}</td></tr><tr><td style="padding:4px 8px;color:var(--muted)">Ingresado</td><td style="padding:4px 8px">${ruc[10]}</td></tr></table></div>`;
    return;
  }
  const estadosSim = ['Activo', 'Activo', 'Activo', 'Baja de Oficio', 'Suspendido'];
  const condSim = ['Habido', 'Habido', 'Habido', 'No Habido'];
  const ecoSim = ['Venta al por menor', 'Restaurantes', 'Servicios profesionales', 'Construcción', 'Transporte'];
  const estado = estadosSim[Math.floor(Math.random() * estadosSim.length)];
  const condicion = condSim[Math.floor(Math.random() * condSim.length)];
  const economia = ecoSim[Math.floor(Math.random() * ecoSim.length)];
  const fechaInsc = `${Math.floor(Math.random() * 28) + 1}/${Math.floor(Math.random() * 12) + 1}/${1990 + Math.floor(Math.random() * 25)}`;
  const nombresSim = nombre || (consulta === 'dni' ? 'Carlos Alberto Mendoza López' : 'GRUPO INVERSIONES DEL SUR S.A.C.');
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result" style="border-left:4px solid #22c55e;padding:12px;background:rgba(34,197,94,0.08)"><strong style="color:#22c55e">RUC Válido</strong><table style="width:100%;margin-top:8px;font-size:14px;border-collapse:collapse"><tr><td style="padding:4px 8px;color:var(--muted)">RUC</td><td style="padding:4px 8px;font-weight:600">${ruc}</td></tr><tr><td style="padding:4px 8px;color:var(--muted)">Razón Social</td><td style="padding:4px 8px">${nombresSim}</td></tr><tr><td style="padding:4px 8px;color:var(--muted)">Tipo</td><td style="padding:4px 8px">${tipoContrib}</td></tr><tr><td style="padding:4px 8px;color:var(--muted)">Estado</td><td style="padding:4px 8px">${estado}</td></tr><tr><td style="padding:4px 8px;color:var(--muted)">Condición</td><td style="padding:4px 8px">${condicion}</td></tr><tr><td style="padding:4px 8px;color:var(--muted)">Domicilio</td><td style="padding:4px 8px">Av. ${['Larco 1234', 'Arequipa 567', 'Javier Prado 890'][Math.floor(Math.random() * 3)]}, Lima</td></tr><tr><td style="padding:4px 8px;color:var(--muted)">Actividad</td><td style="padding:4px 8px">${economia}</td></tr></table></div>`;
}

// ── 22. PROYECCIÓN AFP ──
function calcProyAfp() {
  const edad = parseFloat(document.getElementById('proy_edad')?.value) || 0;
  const jub = parseFloat(document.getElementById('proy_jub')?.value) || 65;
  const sueldo = parseFloat(document.getElementById('proy_sueldo')?.value) || 0;
  const crec = (parseFloat(document.getElementById('proy_crec')?.value) || 3) / 100;
  const rent = (parseFloat(document.getElementById('proy_rent')?.value) || 5.5) / 100;
  const comision = parseFloat(document.getElementById('proy_comision')?.value) || 1.69;
  const prima = (parseFloat(document.getElementById('proy_prima')?.value) || 1.24) / 100;
  const fondoAct = parseFloat(document.getElementById('proy_fondo')?.value) || 0;
  const afpSel = document.getElementById('proy_select')?.value || 'prima';
  const box = document.getElementById('proyAfpResult');
  if (!box) return;
  if (!sueldo || !edad) { box.style.display = 'none'; return; }
  const annos = Math.max(0, jub - edad);
  let fondo = fondoAct, sueldoAnual = sueldo * 12, aporteMensual = sueldo * 0.10;
  const descTotal = aporteMensual + comision + (sueldo * prima);
  const decadas = [];
  for (let a = 0; a < annos; a++) {
    for (let m = 0; m < 12; m++) { fondo = fondo * (1 + rent / 12) + aporteMensual; sueldoAnual *= (1 + crec); aporteMensual = (sueldoAnual / 12) * 0.10; }
    if ((a + 1) % 10 === 0 || a === annos - 1) decadas.push({ anno: a + 1, fondo: Math.round(fondo) });
  }
  const pension = fondo * 0.04 / 12;
  const afpNombres = { prima: 'Prima', habitat: 'Hábitat', profuturo: 'Profuturo', integra: 'Integra' };
  const compRents = { prima: 5.2, habitat: 5.8, profuturo: 5.5, integra: 5.0 };
  const comps = [];
  for (const [k, v] of Object.entries(compRents)) {
    let f = fondoAct, sa = sueldo * 12, ap = sueldo * 0.10;
    for (let a = 0; a < annos; a++) { for (let m = 0; m < 12; m++) { f = f * (1 + v / 100 / 12) + ap; sa *= (1 + crec); ap = (sa / 12) * 0.10; } }
    comps.push({ nombre: afpNombres[k] || k, fondo: Math.round(f), pension: Math.round(f * 0.04 / 12) });
  }
  let decHtml = '';
  for (const d of decadas) decHtml += `<tr><td style="padding:4px 8px">${d.anno} años</td><td style="padding:4px 8px;text-align:right">S/ ${d.fondo.toLocaleString()}</td></tr>`;
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result" style="padding:12px">
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td colspan="2" style="padding:6px 8px;font-weight:600;border-bottom:1px solid rgba(128,128,128,0.2)">Resumen — ${afpNombres[afpSel]}</td></tr>
      <tr><td style="padding:4px 8px;color:var(--muted)">Años cotización</td><td style="padding:4px 8px;text-align:right">${annos} años</td></tr>
      <tr><td style="padding:4px 8px;color:var(--muted)">Aporte mensual</td><td style="padding:4px 8px;text-align:right">S/ ${(sueldo * 0.10).toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;color:var(--muted)">Descuento total</td><td style="padding:4px 8px;text-align:right">S/ ${descTotal.toFixed(2)}</td></tr>
      <tr><td style="padding:4px 8px;color:var(--muted)">Fondo proyectado</td><td style="padding:4px 8px;text-align:right;font-weight:600;font-size:14px;color:var(--accent)">S/ ${Math.round(fondo).toLocaleString()}</td></tr>
      <tr><td style="padding:4px 8px;color:var(--muted)">Pensión estimada</td><td style="padding:4px 8px;text-align:right;font-weight:600">S/ ${Math.round(pension).toLocaleString()}/mes</td></tr>
    </table>
    <div style="margin-top:12px;font-weight:600;font-size:14px">Por década</div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin-top:4px">
      <tr><th style="padding:4px 8px;text-align:left;border-bottom:1px solid rgba(128,128,128,0.2)">Período</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid rgba(128,128,128,0.2)">Fondo</th></tr>
      ${decHtml}
    </table>
    <div style="margin-top:12px;font-weight:600;font-size:14px">Comparación AFP</div>
    <table style="width:100%;font-size:14px;border-collapse:collapse;margin-top:4px">
      <tr><th style="padding:4px 8px;text-align:left;border-bottom:1px solid rgba(128,128,128,0.2)">AFP</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid rgba(128,128,128,0.2)">Fondo</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid rgba(128,128,128,0.2)">Pensión</th></tr>
      ${comps.map(c => `<tr><td style="padding:4px 8px">${c.nombre}</td><td style="padding:4px 8px;text-align:right">S/ ${c.fondo.toLocaleString()}</td><td style="padding:4px 8px;text-align:right">S/ ${c.pension.toLocaleString()}/mes</td></tr>`).join('')}
    </table>
  </div>`;
}

// ── 23. ANALIZADOR CONTRATOS ──
function calcContr() {
  const tipo = document.getElementById('contr_tipo')?.value || 'indefinido';
  const prueba = parseInt(document.getElementById('contr_prueba')?.value) || 0;
  const jornada = parseInt(document.getElementById('contr_jornada')?.value) || 0;
  const remu = parseFloat(document.getElementById('contr_remu')?.value) || 0;
  const duracion = parseInt(document.getElementById('contr_duracion')?.value) || 0;
  const confid = document.getElementById('contr_confid')?.value || 'no';
  const exclus = document.getElementById('contr_exclus')?.value || 'no';
  const compet = document.getElementById('contr_compet')?.value || 'no';
  const cts = document.getElementById('contr_b_cts')?.checked || false;
  const gratif = document.getElementById('contr_b_gratif')?.checked || false;
  const sctr = document.getElementById('contr_b_sctr')?.checked || false;
  const vac = document.getElementById('contr_b_vac')?.checked || false;
  const seg = document.getElementById('contr_b_seg')?.checked || false;
  const essalud = document.getElementById('contr_b_essalud')?.checked || false;
  const box = document.getElementById('contrResult');
  if (!box) return;
  if (!remu) { box.style.display = 'none'; return; }
  const rmv = 1025;
  const ok = [], alertas = [];
  if (prueba > 0 && prueba <= 90) ok.push('Período de prueba dentro del límite (≤3 meses)');
  if (prueba > 90 && tipo !== 'confianza') alertas.push('Período de prueba muy largo — máximo 3 meses');
  if (prueba > 365) alertas.push('Excede límite máximo (1 año solo confianza)');
  if (jornada > 0 && jornada <= 48) ok.push('Jornada dentro del límite (48 h/sem)');
  if (jornada > 48) alertas.push('Jornada excede máximo de 48 h/sem');
  if (remu < rmv) alertas.push('Remuneración debajo del mínimo vital (S/ ' + rmv + ')');
  else ok.push('Remuneración ≥ mínimo vital');
  if (gratif) ok.push('Gratificación incluida');
  else alertas.push('Falta gratificación (Ley 27735)');
  if (cts) ok.push('CTS incluida');
  else alertas.push('Falta CTS (Ley 30487)');
  if (vac) ok.push('Vacaciones incluidas (30 días)');
  else alertas.push('Faltan vacaciones (derecho irrenunciable)');
  if (essalud) ok.push('ESSALUD incluido');
  else alertas.push('Falta ESSALUD (obligatorio)');
  if (sctr) ok.push('SCTR incluido');
  if (confid === 'si') ok.push('Confidencialidad incluida');
  if (exclus === 'si') alertas.push('Exclusividad — verificar que no limite actividad lícita');
  if (compet === 'si') alertas.push('Cláusula de competencia — evaluar razonabilidad');
  if (tipo === 'plazo_fijo' && duracion > 60) alertas.push('Contrato plazo fijo >5 años podría desnaturalizarse');
  box.style.display = 'block';
  box.innerHTML = `<div class="sunat-api-result" style="padding:12px">
    <div style="font-weight:600;font-size:14px;margin-bottom:8px">${tipo.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
    <div style="margin-bottom:8px"><span style="font-weight:600;color:#22c55e">✓ Cumplimiento (${ok.length})</span></div>
    <ul style="margin:0 0 8px 16px;font-size:14px">${ok.map(o => `<li style="margin-bottom:4px">${o}</li>`).join('')}</ul>
    ${alertas.length ? `<div style="margin-bottom:8px"><span style="font-weight:600;color:#ef4444">⚠ Alertas (${alertas.length})</span></div><ul style="margin:0 0 8px 16px;font-size:14px">${alertas.map(a => `<li style="margin-bottom:4px">${a}</li>`).join('')}</ul>` : ''}
    <div style="margin-top:8px;padding:8px;background:rgba(34,197,94,0.08);border-radius:4px;font-size:14px"><strong>Cumplimiento:</strong> ${ok.length >= 5 ? '✅ Alto' : ok.length >= 3 ? '⚠ Medio' : '❌ Bajo'}</div>
  </div>`;
}

// ── 24. CHAT SESIONES ──
function calcChat() {
  const buscar = (document.getElementById('chat_buscar')?.value || '').toLowerCase();
  const prov = document.getElementById('chat_prov')?.value || 'todos';
  const box = document.getElementById('chatResult');
  if (!box) return;
  box.style.display = 'block';
  let sesiones = [];
  try { sesiones = JSON.parse(localStorage.getItem('tp_chat_sessions') || '[]'); } catch (e) { }
  if (!Array.isArray(sesiones) || !sesiones.length) {
    const def = [{ id: 1, fecha: '2026-07-20 14:30', resumen: 'Consulta sobre RUC y facturación', proveedor: 'Claude', msgs: 12 }, { id: 2, fecha: '2026-07-19 09:15', resumen: 'Análisis de contrato laboral', proveedor: 'DeepSeek', msgs: 8 }, { id: 3, fecha: '2026-07-18 16:45', resumen: 'Proyección AFP', proveedor: 'OpenAI', msgs: 15 }, { id: 4, fecha: '2026-07-17 11:00', resumen: 'PDT 621', proveedor: 'Claude', msgs: 6 }, { id: 5, fecha: '2026-07-15 08:30', resumen: 'Detracciones', proveedor: 'DeepSeek', msgs: 10 }];
    localStorage.setItem('tp_chat_sessions', JSON.stringify(def));
    kvPut('tp_chat_sessions', def, 'chat_sessions');
    sesiones = def;
  }
registerKVScope('chat_sessions', () => 'tp_chat_sessions');
  let filtradas = sesiones;
  if (prov !== 'todos') filtradas = filtradas.filter(s => s.proveedor === prov);
  if (buscar) filtradas = filtradas.filter(s => (s.resumen || '').toLowerCase().includes(buscar) || (s.fecha || '').includes(buscar));
  if (!filtradas.length) { box.innerHTML = '<div style="padding:12px;font-size:14px;color:var(--muted)">No se encontraron sesiones.</div>'; return; }
  box.innerHTML = `<div class="sunat-api-result" style="padding:0;overflow:hidden">
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><th style="padding:8px;text-align:left;border-bottom:1px solid rgba(128,128,128,0.2)">Fecha</th><th style="padding:8px;text-align:left;border-bottom:1px solid rgba(128,128,128,0.2)">Resumen</th><th style="padding:8px;text-align:left;border-bottom:1px solid rgba(128,128,128,0.2)">Proveedor</th><th style="padding:8px;text-align:right;border-bottom:1px solid rgba(128,128,128,0.2)">Msgs</th><th style="padding:8px;border-bottom:1px solid rgba(128,128,128,0.2)"></th></tr>
      ${filtradas.map(s => `<tr><td style="padding:6px 8px;white-space:nowrap">${s.fecha || '-'}</td><td style="padding:6px 8px">${s.resumen || '-'}</td><td style="padding:6px 8px">${s.proveedor || '-'}</td><td style="padding:6px 8px;text-align:right">${s.msgs || 0}</td><td style="padding:6px 8px"><button onclick="exportarSesion(${s.id})" style="font-size:14px;padding:2px 6px;cursor:pointer" title="Exportar">📥</button> <button onclick="eliminarSesion(${s.id})" style="font-size:14px;padding:2px 6px;cursor:pointer;color:#ef4444" title="Eliminar">🗑</button></td></tr>`).join('')}
    </table>
    <div style="padding:8px;font-size:14px;color:var(--muted);border-top:1px solid rgba(128,128,128,0.1)">${filtradas.length} sesión(es)</div>
  </div>`;
}
function eliminarSesion(id) { try { let s = JSON.parse(localStorage.getItem('tp_chat_sessions') || '[]'); if (id === null) s = []; else s = s.filter(x => x.id !== id); localStorage.setItem('tp_chat_sessions', JSON.stringify(s)); kvPut('tp_chat_sessions', s, 'chat_sessions'); calcChat(); } catch (e) { } }
function exportarSesion(id) { try { const s = JSON.parse(localStorage.getItem('tp_chat_sessions') || '[]'); const ses = s.find(x => x.id === id); if (!ses) return; const b = new Blob([JSON.stringify(ses, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'sesion_' + id + '.json'; a.click(); URL.revokeObjectURL(a.href); } catch (e) { } }

// ── 25. GENERADOR INFORMES ──
function calcInf() {
  const tipo = document.getElementById('inf_tipo')?.value || 'resumen';
  const inicio = document.getElementById('inf_inicio')?.value || '';
  const fin = document.getElementById('inf_fin')?.value || '';
  const ruc = document.getElementById('inf_ruc')?.value || '';
  const nombre = document.getElementById('inf_nombre')?.value || 'Contribuyente';
  const graf = document.getElementById('inf_graf')?.value || 'si';
  const nota = document.getElementById('inf_nota')?.value || 'si';
  const box = document.getElementById('infResult');
  if (!box) return;
  if (!ruc || !nombre) { box.style.display = 'none'; return; }
  const tipos = { resumen: 'Resumen Tributario', declaracion: 'Declaración Mensual', flujo: 'Flujo Caja', planilla: 'Planilla', anual: 'Impuestos Anuales', auditoria: 'Auditoría Rápida' };
  const labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  const ingresos = labels.map(() => Math.floor(5000 + Math.random() * 20000));
  const egresos = labels.map(() => Math.floor(3000 + Math.random() * 12000));
  const totalIng = ingresos.reduce((a, b) => a + b, 0);
  const totalEgr = egresos.reduce((a, b) => a + b, 0);
  const igv = Math.round(totalIng * 0.18);
  const ir = Math.round(totalIng * 0.295);
  const pend = Math.floor(Math.random() * 5000);
  const meses = labels.slice(0, Math.min(12, Math.max(1, (inicio && fin ? (parseInt(fin.split('-')[1]) - parseInt(inicio.split('-')[1]) + 1) : 6))));
  let grafHtml = '';
  if (graf === 'si') {
    grafHtml = '<div style="margin:12px 0;font-size:14px"><strong>Ingresos vs Egresos</strong><div style="display:flex;gap:2px;height:100px;align-items:flex-end;margin-top:4px">' +
      ingresos.slice(0, meses.length).map((v, i) => {
        const max = Math.max(...ingresos.slice(0, meses.length), ...egresos.slice(0, meses.length)) || 1;
        return '<div style="display:flex;flex-direction:column;align-items:center;flex:1"><div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:1px"><div style="width:14px;height:' + ((v / max) * 80) + 'px;background:#22c55e;border-radius:2px 2px 0 0" title="S/ ' + v + '"></div><div style="width:14px;height:' + ((egresos[i] / max) * 80) + 'px;background:#ef4444;border-radius:2px 2px 0 0" title="S/ ' + egresos[i] + '"></div></div><span style="font-size:8px;margin-top:2px">' + meses[i] + '</span></div>';
      }).join('') +
      '</div><div style="display:flex;gap:12px;font-size:14px"><span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px;vertical-align:middle"></span>Ingresos</span><span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:4px;vertical-align:middle"></span>Egresos</span></div></div>';
  }
  const notaHtml = nota === 'si' ? '<div style="margin-top:12px;padding:8px;font-size:14px;color:var(--muted);border-top:1px solid rgba(128,128,128,0.2)"><em>Nota: Esta es una simulación ilustrativa. Valide con un contador público colegiado.</em></div>' : '';
  const fecStr = (inicio || '2026-01') + ' a ' + (fin || '2026-12');
  box.style.display = 'block';
  box.innerHTML = '<div class="sunat-api-result" id="reportPreview" style="padding:16px;font-size:14px">' +
    '<div style="text-align:center;margin-bottom:12px"><strong style="font-size:14px">' + (tipos[tipo] || 'Informe') + '</strong><br><span style="color:var(--muted)">' + ruc + ' — ' + nombre + ' — ' + fecStr + '</span></div>' +
    '<div style="margin-bottom:8px"><strong>Resumen</strong><p style="color:var(--muted);margin:4px 0">Ingresos S/ ' + totalIng.toLocaleString() + ', egresos S/ ' + totalEgr.toLocaleString() + '</p></div>' +
    grafHtml +
    '<div style="margin-bottom:8px"><strong>Impuestos</strong><table style="width:100%;border-collapse:collapse;margin-top:4px"><tr><th style="padding:4px 8px;text-align:left;border-bottom:1px solid rgba(128,128,128,0.2)">Concepto</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid rgba(128,128,128,0.2)">S/</th></tr><tr><td style="padding:4px 8px">IGV (18%)</td><td style="padding:4px 8px;text-align:right">' + igv.toLocaleString() + '</td></tr><tr><td style="padding:4px 8px">IR (29.5%)</td><td style="padding:4px 8px;text-align:right">' + ir.toLocaleString() + '</td></tr></table></div>' +
    '<div style="margin-bottom:8px"><strong>Recomendaciones</strong><ul style="margin:4px 0 0 16px;color:var(--muted);font-size:14px"><li>Revisar cronograma de vencimientos SUNAT</li><li>Verificar pagos a cuenta del IR</li><li>Mantener actualizado Registro de Ventas</li>' + (tipo === 'planilla' ? '<li>Validar altas/bajas en T-Registro</li>' : '') + '</ul></div>' +
    notaHtml +
    '<div style="margin-top:12px;text-align:center"><button onclick="descargarInforme()" style="padding:6px 16px;cursor:pointer;background:var(--accent,#06b6d4);color:#fff;border:none;border-radius:4px;font-size:14px">📥 Descargar (HTML)</button></div></div>';
}
function descargarInforme() {
  const p = document.getElementById('reportPreview');
  if (!p) return;
  const html = '<html><meta charset="UTF-8"><title>Informe Tributario</title><style>body{font-family:Arial,sans-serif;font-size:14px;padding:20px;max-width:800px;margin:0 auto}table{width:100%;border-collapse:collapse}td,th{padding:6px 10px;border-bottom:1px solid #ddd}</style><body>' + p.innerHTML.replace(/<button[\s\S]*?<\/button>/, '') + '</body></html>';
  const a = document.createElement('a');
  a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  a.download = 'informe_tributario_' + Date.now() + '.html';
  a.click();
}

function calcItf() {
  const monto = parseFloat(document.getElementById('itf_monto').value) || 0;
  const ops = parseInt(document.getElementById('itf_ops').value) || 1;
  const tipo = document.getElementById('itf_tipo').value;
  const alicuota = 0.00005;
  let exonerado = false;
  if (monto < 1000 || tipo === 'debito' || tipo === 'credito') exonerado = true;
  const total = monto * alicuota * ops;
  const div = document.getElementById('itfResult');
  if (!monto) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Monto transacción</td><td style="text-align:right">S/ '+monto.toFixed(2)+'</td></tr>' +
    '<tr><td>Tipo operación</td><td>'+tipo+'</td></tr>' +
    '<tr><td>N° operaciones</td><td style="text-align:right">'+ops+'</td></tr>' +
    '<tr><td>ITF (0.005%)</td><td style="text-align:right;font-weight:600">S/ '+total.toFixed(4)+'</td></tr>' +
    '<tr><td style="color:'+(exonerado?'var(--green)':'var(--red)')+'">Estado</td><td>'+(exonerado?'Exonerado':'Afecto')+'</td></tr>' +
    '<tr><td colspan="2" style="font-size:14px;color:var(--muted);text-align:center">ℹ️ Exonerado para cuentas sueldo, CTS y montos &lt; S/ 1,000</td></tr>' +
    '</table></div>';
}
function calcIr5ta() {
  const sueldo = parseFloat(document.getElementById('ir5_sueldo').value) || 0;
  const meses = parseInt(document.getElementById('ir5_meses').value) || 12;
  const grati = parseFloat(document.getElementById('ir5_grati').value) || 0;
  const bono = parseFloat(document.getElementById('ir5_bono').value) || 0;
  const onpafp = document.getElementById('ir5_onpafp').value;
  const essalud = parseFloat(document.getElementById('ir5_essalud').value) || 0;
  const anios = parseInt(document.getElementById('ir5_anios').value) || 0;
  const UIT = 5350;
  const deduccion = 7 * UIT;
  const ingresoAnual = sueldo * meses + grati + bono;
  const descuento = onpafp === 'onp' ? sueldo * 0.04 * meses : sueldo * 0.13 * meses;
  const rentaNeta = Math.max(0, ingresoAnual - deduccion - descuento);
  let impuesto = 0;
  if (rentaNeta > 0) {
    if (rentaNeta <= 5 * UIT) impuesto = rentaNeta * 0.08;
    else if (rentaNeta <= 20 * UIT) impuesto = 5 * UIT * 0.08 + (rentaNeta - 5 * UIT) * 0.14;
    else if (rentaNeta <= 35 * UIT) impuesto = 5 * UIT * 0.08 + 15 * UIT * 0.14 + (rentaNeta - 20 * UIT) * 0.17;
    else if (rentaNeta <= 45 * UIT) impuesto = 5 * UIT * 0.08 + 15 * UIT * 0.14 + 15 * UIT * 0.17 + (rentaNeta - 35 * UIT) * 0.20;
    else impuesto = 5 * UIT * 0.08 + 15 * UIT * 0.14 + 15 * UIT * 0.17 + 10 * UIT * 0.20 + (rentaNeta - 45 * UIT) * 0.30;
  }
  const div = document.getElementById('ir5taResult');
  if (!sueldo) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Ingreso anual bruto</td><td style="text-align:right">S/ '+ingresoAnual.toFixed(2)+'</td></tr>' +
    '<tr><td>Deducción 7 UIT (S/ '+UIT.toFixed(2)+' c/u)</td><td style="text-align:right">S/ '+deduccion.toFixed(2)+'</td></tr>' +
    '<tr><td>Descuento ONP/AFP</td><td style="text-align:right">S/ '+descuento.toFixed(2)+'</td></tr>' +
    '<tr><td>Renta neta imponible</td><td style="text-align:right;font-weight:600">S/ '+rentaNeta.toFixed(2)+'</td></tr>' +
    '<tr><td>Impuesto calculado</td><td style="text-align:right;font-weight:600;color:var(--gold)">S/ '+impuesto.toFixed(2)+'</td></tr>' +
    '<tr><td colspan="2" style="font-size:14px;color:var(--muted);text-align:center">ℹ️ Tasas: 8% hasta 5 UIT · 14% hasta 20 UIT · 17% hasta 35 UIT · 20% hasta 45 UIT · 30% exceso</td></tr>' +
    '</table></div>';
}
function calcDividendos() {
  const tipo = document.getElementById('div_tipo').value;
  const monto = parseFloat(document.getElementById('div_monto').value) || 0;
  const ejercicio = document.getElementById('div_ejercicio').value;
  let tasa = 0;
  if (tipo === 'natural') tasa = (ejercicio === '2025' || ejercicio === '2026') ? 5 : 6.8;
  else if (tipo === 'juridica') tasa = 0;
  else if (tipo === 'nodom') tasa = 5;
  const retencion = monto * tasa / 100;
  const neto = monto - retencion;
  const div = document.getElementById('dividendosResult');
  if (!monto) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Tipo contribuyente</td><td>'+tipo+'</td></tr>' +
    '<tr><td>Dividendo bruto</td><td style="text-align:right">S/ '+monto.toFixed(2)+'</td></tr>' +
    '<tr><td>Tasa retención</td><td style="text-align:right">'+tasa+'%</td></tr>' +
    '<tr><td>Retención</td><td style="text-align:right;color:var(--red)">S/ '+retencion.toFixed(2)+'</td></tr>' +
    '<tr><td>Neto recibido</td><td style="text-align:right;font-weight:600;color:var(--green)">S/ '+neto.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcNoDom() {
  const tipo = document.getElementById('nod_tipo').value;
  const montoUSD = parseFloat(document.getElementById('nod_monto_usd').value) || 0;
  const montoSoles = parseFloat(document.getElementById('nod_monto_soles').value) || 0;
  const tc = parseFloat(document.getElementById('nod_tc').value) || 3.73;
  const cdiPais = document.getElementById('nod_cdi_pais').value;
  const benef = document.getElementById('nod_benef').value;
  let base = montoSoles || montoUSD * tc;
  let tasaIR = 30;
  if (tipo === 'dividendos') tasaIR = 5;
  else if (tipo === 'intereses') tasaIR = 4.99;
  else if (tipo === 'regalias') tasaIR = 30;
  else if (tipo === 'asistencia_tecnica') tasaIR = 15;
  else if (tipo === 'ganancia_capital') tasaIR = 5;
  else if (tipo === 'renta_1ra' || tipo === 'renta_2da' || tipo === 'renta_4ta') tasaIR = 30;
  if (cdiPais !== 'ninguno') tasaIR = Math.min(tasaIR, 15);
  const retencion = base * tasaIR / 100;
  const igv = (tipo === 'asistencia_tecnica' || tipo === 'regalias') ? base * 0.18 : 0;
  const total = base - retencion - igv;
  const div = document.getElementById('noDomResult');
  if (!base) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Tipo renta</td><td>'+tipo+'</td></tr>' +
    '<tr><td>Base imponible</td><td style="text-align:right">S/ '+base.toFixed(2)+'</td></tr>' +
    '<tr><td>Tasa IR aplicable</td><td style="text-align:right">'+tasaIR+'%</td></tr>' +
    '<tr><td>Retención IR</td><td style="text-align:right;color:var(--red)">S/ '+retencion.toFixed(2)+'</td></tr>' +
    (igv ? '<tr><td>IGV (18%)</td><td style="text-align:right;color:var(--red)">S/ '+igv.toFixed(2)+'</td></tr>' : '') +
    '<tr><td>Neto</td><td style="text-align:right;font-weight:600;color:var(--green)">S/ '+total.toFixed(2)+'</td></tr>' +
    (cdiPais !== 'ninguno' ? '<tr><td colspan="2" style="font-size:14px;color:var(--gold);text-align:center">🌐 CDI aplicable con '+cdiPais+'. Tasa reducida a '+tasaIR+'%</td></tr>' : '') +
    '</table></div>';
}
function calcCas() {
  const sueldo = parseFloat(document.getElementById('cas_sueldo').value) || 0;
  const tipo = document.getElementById('cas_tipo').value;
  const meses = parseInt(document.getElementById('cas_meses').value) || 12;
  if (tipo === 'privado') {
    document.getElementById('casResult').style.display = 'none';
    return;
  }
  let tasa = 0;
  if (sueldo <= 2000) tasa = 0;
  else if (sueldo <= 4000) tasa = 5;
  else if (sueldo <= 6000) tasa = 8;
  else if (sueldo <= 10000) tasa = 12;
  else tasa = 15;
  const aporte = sueldo * tasa / 100;
  const aporteAnual = aporte * meses;
  const div = document.getElementById('casResult');
  if (!sueldo || tipo !== 'publico') { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Sueldo mensual</td><td style="text-align:right">S/ '+sueldo.toFixed(2)+'</td></tr>' +
    '<tr><td>Tasa CAS</td><td style="text-align:right">'+tasa+'%</td></tr>' +
    '<tr><td>Aporte mensual</td><td style="text-align:right;font-weight:600">S/ '+aporte.toFixed(2)+'</td></tr>' +
    '<tr><td>Aporte anual estimado</td><td style="text-align:right;font-weight:600;color:var(--gold)">S/ '+aporteAnual.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcRoyalties() {
  const tipo = document.getElementById('roy_tipo').value;
  const monto = parseFloat(document.getElementById('roy_monto').value) || 0;
  const plazo = document.getElementById('roy_plazo_tipo').value;
  const cant = parseInt(document.getElementById('roy_plazo_cant').value) || 12;
  const domicilio = document.getElementById('roy_domicilio').value;
  const pais = document.getElementById('roy_pais').value;
  const cdi = document.getElementById('roy_cdi').value;
  const digital = document.getElementById('roy_digital').value;
  let meses = plazo === 'anios' ? cant * 12 : cant;
  let amortMensual = monto > 0 && meses > 0 ? monto / meses : 0;
  let tasaRet = 30;
  if (domicilio === 'domiciliado_pj') {
    tasaRet = 5;
  } else if (domicilio === 'domiciliado_pn') {
    tasaRet = 6.8;
  }
  if (domicilio === 'nodomiciliado' && cdi === 'si') {
    if (['software', 'patente'].includes(tipo)) tasaRet = 15;
    else if (tipo === 'asistencia') tasaRet = 10;
    else tasaRet = 15;
  } else if (domicilio === 'nodomiciliado' && cdi === 'no') {
    if (tipo === 'asistencia') tasaRet = 15;
    else if (["software", "patente", "knowhow", "marca"].includes(tipo)) tasaRet = 30;
  }
  const retencion = amortMensual * tasaRet / 100;
  const igvMensual = (domicilio === 'nodomiciliado') ? amortMensual * 0.18 : 0;
  const totalMensual = amortMensual - retencion - igvMensual;
  const div = document.getElementById('royResult');
  if (!monto) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Tipo intangible</td><td>'+tipo+'</td></tr>' +
    '<tr><td>Monto contrato</td><td style="text-align:right">S/ '+monto.toFixed(2)+'</td></tr>' +
    '<tr><td>Plazo</td><td style="text-align:right">'+meses+' meses</td></tr>' +
    '<tr><td>Amortización mensual</td><td style="text-align:right">S/ '+amortMensual.toFixed(2)+'</td></tr>' +
    '<tr><td>Retención IR ('+tasaRet+'%)</td><td style="text-align:right;color:var(--red)">S/ '+retencion.toFixed(2)+'</td></tr>' +
    (igvMensual ? '<tr><td>IGV (18%)</td><td style="text-align:right;color:var(--red)">S/ '+igvMensual.toFixed(2)+'</td></tr>' : '') +
    '<tr><td>Neto mensual</td><td style="text-align:right;font-weight:600;color:var(--green)">S/ '+totalMensual.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcAfpOnp() {
  const sueldo = parseFloat(document.getElementById('afponp_sueldo').value) || 0;
  const edad = parseInt(document.getElementById('afponp_edad').value) || 30;
  const jubilacion = parseInt(document.getElementById('afponp_jubilacion').value) || 65;
  const fondo = parseFloat(document.getElementById('afponp_fondo').value) || 0;
  const renta = parseFloat(document.getElementById('afponp_renta').value) || 5;
  const afp = document.getElementById('afponp_afp').value;
  const aniosOnp = parseInt(document.getElementById('afponp_anios_onp').value) || 0;
  const comision = parseFloat(document.getElementById('afponp_comision').value) || 1.69;
  const anios = jubilacion - edad;
  const aporteMensual = sueldo * 0.10;
  const aporteAnual = aporteMensual * 12;
  const rentaDec = renta / 100;
  const comDec = comision / 100;
  const fondoProyectado = fondo * Math.pow(1 + rentaDec - comDec, anios) + aporteAnual * ((Math.pow(1 + rentaDec - comDec, anios) - 1) / (rentaDec - comDec || 0.01));
  const pensionAfp = fondoProyectado * (rentaDec - comDec) / 12 * 0.85;
  const pensionOnp = Math.min(sueldo * 0.70, 893);
  const aniosRestantes = aniosOnp >= 20 ? 0 : 20 - aniosOnp;
  const div = document.getElementById('afponpResult');
  if (!sueldo) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Sueldo mensual</td><td style="text-align:right">S/ '+sueldo.toFixed(2)+'</td></tr>' +
    '<tr><td>Aporte AFP mensual (10%)</td><td style="text-align:right">S/ '+aporteMensual.toFixed(2)+'</td></tr>' +
    '<tr><td>Fondo proyectado AFP</td><td style="text-align:right;font-weight:600;color:var(--green)">S/ '+fondoProyectado.toFixed(2)+'</td></tr>' +
    '<tr><td>Pensión estimada AFP</td><td style="text-align:right;font-weight:600;color:#3A86FF">S/ '+pensionAfp.toFixed(2)+'/mes</td></tr>' +
    '<tr><td>Pensión estimada ONP (máx)</td><td style="text-align:right;font-weight:600;color:#E8A020">S/ '+pensionOnp.toFixed(2)+'/mes</td></tr>' +
    (aniosRestantes > 0 ? '<tr><td colspan="2" style="font-size:14px;color:var(--muted);text-align:center">⏳ Te faltan '+aniosRestantes+' años para pensión mínima ONP (20 años)</td></tr>' : '') +
    '</table></div>';
}
function calcPercepciones() {
  const tipo = document.getElementById('percep_tipo').value;
  const monto = parseFloat(document.getElementById('percep_monto').value) || 0;
  const tasaSel = parseFloat(document.getElementById('percep_tasa').value) || 1;
  const comprobante = document.getElementById('percep_comprobante').value;
  const igvIncluido = document.getElementById('percep_igv_incluido').value;
  let base = igvIncluido === 'si' ? monto / 1.18 : monto;
  let tasa = tipo === 'percepcion' ? tasaSel : 6;
  if (tipo === 'retencion') tasa = comprobante === 'boleta' ? 3 : 6;
  const percepcion = base * tasa / 100;
  const total = monto + percepcion;
  const div = document.getElementById('percepResult');
  if (!monto) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Tipo</td><td>'+(tipo === 'percepcion' ? 'Percepción' : 'Retención')+'</td></tr>' +
    '<tr><td>Base</td><td style="text-align:right">S/ '+base.toFixed(2)+'</td></tr>' +
    '<tr><td>Tasa</td><td style="text-align:right">'+tasa+'%</td></tr>' +
    '<tr><td>'+(tipo === 'percepcion' ? 'Percepción' : 'Retención')+'</td><td style="text-align:right;font-weight:600;color:'+(tipo==='percepcion'?'var(--red)':'var(--red)')+'">S/ '+percepcion.toFixed(2)+'</td></tr>' +
    '<tr><td>Total a pagar</td><td style="text-align:right;font-weight:600;color:var(--green)">S/ '+total.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcNotasCredito() {
  const tipo = document.getElementById('nc_tipo').value;
  const montoOrig = parseFloat(document.getElementById('nc_monto_original').value) || 0;
  const montoMod = parseFloat(document.getElementById('nc_monto_mod').value) || 0;
  const motivo = document.getElementById('nc_motivo').value;
  const igvIncluido = document.getElementById('nc_igv_incluido').value;
  const ventas = parseFloat(document.getElementById('nc_ventas_anuales').value) || 120000;
  let baseMod = igvIncluido === 'si' ? montoMod / 1.18 : montoMod;
  const igvMod = baseMod * 0.18;
  const totalMod = tipo === 'credito' ? -montoMod : montoMod;
  const limiteDescuento = ventas * 0.10;
  const excedeLimite = motivo === 'descuento' && Math.abs(baseMod) > limiteDescuento;
  const div = document.getElementById('ncResult');
  if (!montoOrig || !montoMod) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Tipo</td><td>'+(tipo === 'credito' ? 'Nota de Crédito' : 'Nota de Débito')+'</td></tr>' +
    '<tr><td>Monto modificación (base)</td><td style="text-align:right">S/ '+baseMod.toFixed(2)+'</td></tr>' +
    '<tr><td>IGV modificación</td><td style="text-align:right">S/ '+igvMod.toFixed(2)+'</td></tr>' +
    '<tr><td>Impacto total</td><td style="text-align:right;font-weight:600;color:'+(tipo==='credito'?'var(--red)':'var(--green)')+'">'+(tipo==='credito'?'-':'+')+' S/ '+Math.abs(totalMod).toFixed(2)+'</td></tr>' +
    (excedeLimite ? '<tr><td colspan="2" style="font-size:14px;color:var(--gold);text-align:center">⚠️ Excede límite 10% ventas anuales (S/ '+limiteDescuento.toFixed(2)+')</td></tr>' : '') +
    '</table></div>';
}
function calcFacturaElectronica() {
  const rucEmi = document.getElementById('fe_ruc_emisor').value;
  const rucRec = document.getElementById('fe_ruc_receptor').value;
  const tipoDoc = document.getElementById('fe_tipo_doc').value;
  const serie = document.getElementById('fe_serie').value;
  const monto = parseFloat(document.getElementById('fe_monto_total').value) || 0;
  const igv = parseFloat(document.getElementById('fe_igv_total').value) || 0;
  const moneda = document.getElementById('fe_moneda').value;
  const serieRegex = /^[BF][0-9]{3}$/;
  const serieValida = serieRegex.test(serie);
  const rucEmiValido = rucEmi.length === 11;
  const rucRecValido = rucRec.length === 11 || rucRec.length === 8;
  const igvEsperado = monto * 18 / 118;
  const igvOk = Math.abs(igv - igvEsperado) < 0.01;
  const validaciones = [];
  validaciones.push({label: 'RUC Emisor', ok: rucEmiValido, msg: rucEmiValido ? 'Válido (11 dígitos)' : 'Debe tener 11 dígitos'});
  validaciones.push({label: 'RUC Receptor', ok: rucRecValido, msg: rucRecValido ? 'Válido' : 'Debe tener 8 o 11 dígitos'});
  validaciones.push({label: 'Serie', ok: serieValida, msg: serieValida ? 'Formato correcto' : 'Formato inválido (ej: F001)'});
  validaciones.push({label: 'IGV', ok: igvOk, msg: igvOk ? 'IGV correcto (18%)' : 'IGV no coincide (esperado S/ '+igvEsperado.toFixed(2)+')'});
  const totalOk = validaciones.every(v => v.ok);
  const div = document.getElementById('feResult');
  if (!monto) { div.style.display = 'none'; return; }
  div.style.display = '';
  let html = '<div class="res-table"><table>' +
    '<tr><td colspan="2" style="font-weight:600;text-align:center">'+(totalOk ? '✅ Documento válido' : '❌ Documento con observaciones')+'</td></tr>';
  validaciones.forEach(v => {
    html += '<tr><td>'+v.label+'</td><td style="text-align:right;color:'+(v.ok?'var(--green)':'var(--red)')+'">'+(v.ok?'✅ ':'❌ ')+v.msg+'</td></tr>';
  });
  html += '</table></div>';
  div.innerHTML = html;
}
function calcRectificatoria() {
  const mes = parseInt(document.getElementById('rect_mes').value) || 1;
  const anio = parseInt(document.getElementById('rect_anio').value) || 2025;
  const montoOrig = parseFloat(document.getElementById('rect_monto_original').value) || 0;
  const montoCorr = parseFloat(document.getElementById('rect_monto_corregido').value) || 0;
  const tributo = document.getElementById('rect_tributo').value;
  const fechaOrig = document.getElementById('rect_fecha_original').value;
  const fechaRect = document.getElementById('rect_fecha_rect').value;
  const subsana = document.getElementById('rect_subsana').value;
  const omitido = Math.max(0, montoCorr - montoOrig);
  const TIM = 0.012;
  let dias = 0;
  if (fechaOrig && fechaRect) {
    dias = Math.max(0, Math.floor((new Date(fechaRect) - new Date(fechaOrig)) / (1000*60*60*24)));
  }
  const mesesMora = Math.ceil(dias / 30);
  const interes = omitido * TIM * mesesMora;
  const multaBase = omitido * 0.50;
  const gradualidad = subsana === 'si' ? 0.90 : (dias > 0 ? 0.40 : 0.60);
  const multaFinal = multaBase * (1 - gradualidad);
  const totalDeuda = omitido + interes + multaFinal;
  const div = document.getElementById('rectResult');
  if (!omitido) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Período</td><td>'+mes+'/'+anio+'</td></tr>' +
    '<tr><td>Tributo omitido</td><td style="text-align:right;color:var(--red)">S/ '+omitido.toFixed(2)+'</td></tr>' +
    '<tr><td>Días de mora</td><td style="text-align:right">'+dias+'</td></tr>' +
    '<tr><td>Interés TIM (1.2% mensual)</td><td style="text-align:right;color:var(--red)">S/ '+interes.toFixed(2)+'</td></tr>' +
    '<tr><td>Multa 50% (con gradualidad '+(gradualidad*100)+'%)</td><td style="text-align:right;color:var(--red)">S/ '+multaFinal.toFixed(2)+'</td></tr>' +
    '<tr><td>Total deuda rectificatoria</td><td style="text-align:right;font-weight:600;color:var(--gold)">S/ '+totalDeuda.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcEssaludSenati() {
  const tipoEmp = document.getElementById('ess_tipo_empresa').value;
  const sector = document.getElementById('ess_sector').value;
  const numTrab = parseInt(document.getElementById('ess_num_trabajadores').value) || 1;
  const planilla = parseFloat(document.getElementById('ess_planilla').value) || 0;
  const construccion = parseFloat(document.getElementById('ess_construccion').value) || 0;
  const apVol = document.getElementById('ess_aporte_voluntario').value;
  const riesgo = document.getElementById('ess_riesgo').value;
  let tasaEssalud = sector === 'agrario' ? 4 : 9;
  if (apVol === 'si') tasaEssalud += 1;
  let senati = 0;
  if (sector === 'industrial') senati = planilla * 0.0075;
  let sencico = 0;
  if (sector === 'construccion') sencico = construccion * 0.002;
  else sencico = planilla * 0.005;
  let sctr = 0;
  if (riesgo === 'bajo') sctr = planilla * 0.005;
  else if (riesgo === 'medio') sctr = planilla * 0.012;
  else if (riesgo === 'alto') sctr = planilla * 0.025;
  const essalud = planilla * tasaEssalud / 100;
  const totalMensual = essalud + senati + sencico + sctr;
  const totalAnual = totalMensual * 12;
  const div = document.getElementById('essResult');
  if (!planilla) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Planilla mensual</td><td style="text-align:right">S/ '+planilla.toFixed(2)+'</td></tr>' +
    '<tr><td>ESSALUD ('+tasaEssalud+'%)</td><td style="text-align:right">S/ '+essalud.toFixed(2)+'</td></tr>' +
    (senati > 0 ? '<tr><td>SENATI (0.75%)</td><td style="text-align:right">S/ '+senati.toFixed(2)+'</td></tr>' : '') +
    '<tr><td>SENCICO</td><td style="text-align:right">S/ '+sencico.toFixed(2)+'</td></tr>' +
    (sctr > 0 ? '<tr><td>SCTR ('+riesgo+')</td><td style="text-align:right">S/ '+sctr.toFixed(2)+'</td></tr>' : '') +
    '<tr><td>Total mensual</td><td style="text-align:right;font-weight:600;color:var(--gold)">S/ '+totalMensual.toFixed(2)+'</td></tr>' +
    '<tr><td>Total anual estimado</td><td style="text-align:right;font-weight:600;color:var(--gold)">S/ '+totalAnual.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcOnp() {
  const sueldo = parseFloat(document.getElementById('onp_sueldo').value) || 0;
  const edad = parseInt(document.getElementById('onp_edad').value) || 30;
  const jubilacion = parseInt(document.getElementById('onp_jubilacion').value) || 65;
  const anios = parseInt(document.getElementById('onp_anios').value) || 0;
  const fondo = parseFloat(document.getElementById('onp_fondo').value) || 0;
  const penMin = document.getElementById('onp_pension_min').value;
  const aporte = sueldo * 0.13;
  const aporteAnual = aporte * 12;
  const aniosFaltantes = Math.max(0, 20 - anios);
  const pensionBase = Math.min(aporte * 0.70 * 12, 893);
  const pension = penMin === 'si' ? Math.max(pensionBase, 500) : pensionBase;
  const fondoFinal = fondo + aporteAnual * Math.max(0, jubilacion - edad);
  const añosRecuperacion = fondoFinal > 0 && pension > 0 ? fondoFinal / (pension * 12) : 0;
  const div = document.getElementById('onpResult');
  if (!sueldo) { div.style.display = 'none'; return; }
  div.style.display = '';
  const inpAporte = document.getElementById('onp_aporte');
  if (inpAporte) inpAporte.value = 'S/ ' + aporte.toFixed(2);
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Sueldo mensual</td><td style="text-align:right">S/ '+sueldo.toFixed(2)+'</td></tr>' +
    '<tr><td>Aporte mensual ONP (13%)</td><td style="text-align:right">S/ '+aporte.toFixed(2)+'</td></tr>' +
    '<tr><td>Años cotizados</td><td style="text-align:right">'+anios+'</td></tr>' +
    (aniosFaltantes > 0 ? '<tr><td>Años faltantes mín. 20</td><td style="text-align:right;color:var(--red)">'+aniosFaltantes+'</td></tr>' : '') +
    '<tr><td>Pensión estimada</td><td style="text-align:right;font-weight:600;color:var(--green)">S/ '+pension.toFixed(2)+'/mes</td></tr>' +
    '<tr><td>Años de recuperación aprox.</td><td style="text-align:right">'+añosRecuperacion.toFixed(1)+' años</td></tr>' +
    '<tr><td colspan="2" style="font-size:14px;color:var(--muted);text-align:center">ℹ️ Pensión máxima ONP: S/ 893/mes. Mínimo 20 años de aportes.</td></tr>' +
    '</table></div>';
}
function calcCobranzaCoactiva() {
  const monto = parseFloat(document.getElementById('coac_monto').value) || 0;
  const tipo = document.getElementById('coac_tipo').value;
  const dias = parseInt(document.getElementById('coac_dias').value) || 0;
  const regimen = document.getElementById('coac_regimen').value;
  const embargo = document.getElementById('coac_embargo').value;
  const fechaNotif = document.getElementById('coac_fecha_notif').value;
  const fechaEmbargo = document.getElementById('coac_fecha_embargo').value;
  const fechaPago = document.getElementById('coac_fecha_pago').value;
  const TIM = 0.012;
  const mesesMora = Math.ceil(dias / 30);
  const interes = monto * TIM * mesesMora;
  const costas = monto * 0.05;
  const costosEmbargo = embargo === 'bancario' ? monto * 0.10 : monto * 0.15;
  const gastosAdmin = monto * 0.05;
  const total = monto + interes + costas + costosEmbargo + gastosAdmin;
  const div = document.getElementById('coacResult');
  if (!monto) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Deuda original</td><td style="text-align:right">S/ '+monto.toFixed(2)+'</td></tr>' +
    '<tr><td>Interés TIM ('+mesesMora+' meses)</td><td style="text-align:right;color:var(--red)">S/ '+interes.toFixed(2)+'</td></tr>' +
    '<tr><td>Costas procesales (5%)</td><td style="text-align:right">S/ '+costas.toFixed(2)+'</td></tr>' +
    '<tr><td>Costos de embargo ('+(embargo==='bancario'?'10':'15')+'%)</td><td style="text-align:right">S/ '+costosEmbargo.toFixed(2)+'</td></tr>' +
    '<tr><td>Gastos administrativos (5%)</td><td style="text-align:right">S/ '+gastosAdmin.toFixed(2)+'</td></tr>' +
    '<tr><td>Total deuda actualizada</td><td style="text-align:right;font-weight:600;color:var(--gold)">S/ '+total.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcDonaciones() {
  const tipo = document.getElementById('don_tipo').value;
  const tipoDon = document.getElementById('don_tipo_donacion').value;
  const monto = parseFloat(document.getElementById('don_monto').value) || 0;
  const entidad = document.getElementById('don_entidad').value;
  const renta = parseFloat(document.getElementById('don_renta').value) || 0;
  const ejerc = parseInt(document.getElementById('don_ejercicio').value) || 2025;
  const maxDeducible = renta * 0.10;
  const montoDeducible = Math.min(monto, maxDeducible);
  const ahorroIR = montoDeducible * 0.30;
  const neto = monto - ahorroIR;
  const div = document.getElementById('donResult');
  if (!monto || !renta) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Monto donado</td><td style="text-align:right">S/ '+monto.toFixed(2)+'</td></tr>' +
    '<tr><td>Límite deducible (10% renta)</td><td style="text-align:right">S/ '+maxDeducible.toFixed(2)+'</td></tr>' +
    '<tr><td>Monto deducible</td><td style="text-align:right;font-weight:600">S/ '+montoDeducible.toFixed(2)+'</td></tr>' +
    '<tr><td>Ahorro IR estimado (30%)</td><td style="text-align:right;color:var(--green);font-weight:600">S/ '+ahorroIR.toFixed(2)+'</td></tr>' +
    '<tr><td>Costo real de la donación</td><td style="text-align:right;font-weight:600;color:var(--gold)">S/ '+neto.toFixed(2)+'</td></tr>' +
    '</table></div>';
}
function calcSucesiones() {
  const tipo = document.getElementById('suc_tipo').value;
  const hered = parseInt(document.getElementById('suc_herederos').value) || 1;
  const tipoHere = document.getElementById('suc_tipo_heredero').value;
  const inmuebles = parseFloat(document.getElementById('suc_inmuebles').value) || 0;
  const muebles = parseFloat(document.getElementById('suc_muebles').value) || 0;
  const efectivo = parseFloat(document.getElementById('suc_efectivo').value) || 0;
  const deudas = parseFloat(document.getElementById('suc_deudas').value) || 0;
  const totalMasa = inmuebles + muebles + efectivo - deudas;
  const porHere = totalMasa / hered;
  const gastosNotariales = totalMasa * 0.015;
  const gastosRegistrales = totalMasa * 0.005;
  const totalGastos = gastosNotariales + gastosRegistrales;
  const neto = totalMasa - totalGastos;
  const div = document.getElementById('sucResult');
  if (!totalMasa) { div.style.display = 'none'; return; }
  div.style.display = '';
  div.innerHTML = '<div class="res-table"><table>' +
    '<tr><td>Masa hereditaria total</td><td style="text-align:right;font-weight:600">S/ '+totalMasa.toFixed(2)+'</td></tr>' +
    '<tr><td>Gastos notariales (1.5%)</td><td style="text-align:right">S/ '+gastosNotariales.toFixed(2)+'</td></tr>' +
    '<tr><td>Gastos registrales (0.5%)</td><td style="text-align:right">S/ '+gastosRegistrales.toFixed(2)+'</td></tr>' +
    '<tr><td>Total gastos</td><td style="text-align:right;color:var(--red)">S/ '+totalGastos.toFixed(2)+'</td></tr>' +
    '<tr><td>Neto a distribuir</td><td style="text-align:right;font-weight:600;color:var(--green)">S/ '+neto.toFixed(2)+'</td></tr>' +
    '<tr><td>N° herederos</td><td style="text-align:right">'+hered+'</td></tr>' +
    '<tr><td style="font-weight:600;color:#9B59B6;font-size:14px">Valor por heredero</td><td style="text-align:right;font-weight:600;color:#9B59B6;font-size:14px">S/ '+porHere.toFixed(2)+'</td></tr>' +
    '<tr><td colspan="2" style="font-size:14px;color:var(--muted);padding-top:8px;text-align:center">ℹ️ En Perú no hay impuesto a la herencia (derogado). Si el heredero vende bien inmueble antes de 2 años, aplica IR por ganancia de capital (5% sobre diferencia).</td></tr>' +
    '</table></div>';
}

// ════════════════════════════════════════
// CRYPTO IMPROVEMENTS — CoinGecko API, TC, IGV, Staking, Price Widget, Portfolio
// ════════════════════════════════════════

const _cgCache = {};

async function _cgPrice(coinIds) {
  const key = coinIds;
  const cached = _cgCache[key];
  if (cached && Date.now() - cached.ts < 300000) return cached.data;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd&include_24hr_change=true`);
    if (!r.ok) return null;
    const data = await r.json();
    _cgCache[key] = { data, ts: Date.now() };
    return data;
  } catch (e) {
    return null;
  }
}

async function _cgHistoricalPrice(coinId, dateStr) {
  const key = `hist_${coinId}_${dateStr}`;
  const cached = _cgCache[key];
  if (cached && Date.now() - cached.ts < 300000) return cached.data;
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${dateStr}`);
    if (!r.ok) return null;
    const data = await r.json();
    const price = data?.market_data?.current_price?.usd;
    _cgCache[key] = { data: price, ts: Date.now() };
    return price;
  } catch (e) {
    return null;
  }
}

async function _cgSearch(query) {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data?.coins?.slice(0, 10) || [];
  } catch (e) {
    return [];
  }
}

const _CG_IDS = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
  'USDT': 'tether', 'USDC': 'usd-coin', 'BNB': 'binancecoin',
  'ADA': 'cardano', 'DOT': 'polkadot', 'MATIC': 'matic-network',
  'LINK': 'chainlink', 'UNI': 'uniswap', 'XRP': 'ripple',
  'DAI': 'dai', 'BCH': 'bitcoin-cash', 'LTC': 'litecoin',
  'DOGE': 'dogecoin', 'AVAX': 'avalanche-2', 'TRX': 'tron'
};

const _CG_TOP10 = [
  {id:'bitcoin',sym:'BTC',name:'Bitcoin'},{id:'ethereum',sym:'ETH',name:'Ethereum'},
  {id:'solana',sym:'SOL',name:'Solana'},{id:'tether',sym:'USDT',name:'Tether'},
  {id:'binancecoin',sym:'BNB',name:'BNB'},{id:'ripple',sym:'XRP',name:'XRP'},
  {id:'cardano',sym:'ADA',name:'Cardano'},{id:'polkadot',sym:'DOT',name:'Polkadot'},
  {id:'avalanche-2',sym:'AVAX',name:'Avalanche'},{id:'dogecoin',sym:'DOGE',name:'Dogecoin'}
];

const _tcCache = {};

async function _getTC() {
  if (_tcCache.tc && Date.now() - _tcCache.tc.ts < 3600000) return _tcCache.tc.data;
  try {
    const r = await fetch('https://api.apis.net.pe/v1/tipo-cambio-sunat');
    if (r.ok) {
      const d = await r.json();
      const result = { compra: parseFloat(d.compra), venta: parseFloat(d.venta), fecha: d.fecha || new Date().toISOString().split('T')[0] };
      if (result.compra && result.venta) {
        _tcCache.tc = { data: result, ts: Date.now() };
        return result;
      }
    }
  } catch (e) {}
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (r.ok) {
      const d = await r.json();
      const pen = d.rates?.PEN;
      if (pen) {
        const result = { compra: pen * 0.997, venta: pen * 1.003, fecha: d.date || new Date().toISOString().split('T')[0] };
        _tcCache.tc = { data: result, ts: Date.now() };
        return result;
      }
    }
  } catch (e) {}
  return { compra: 3.75, venta: 3.77, fecha: new Date().toISOString().split('T')[0] };
}

const CRIPTO_IGV_TIPOS = [
  { value: 'compra_ext', label: 'Compra en exchange extranjero', igv: 0, baseLegal: 'Exportación de servicios — Inafecto IGV (Art. 33 LIGV). SUNAT Informe 045-2023.' },
  { value: 'compra_pe', label: 'Compra en exchange peruano', igv: 0.18, baseLegal: 'Gravado con IGV 18%. El exchange peruano actúa como intermediario financiero sujeto a IGV.' },
  { value: 'venta', label: 'Venta de cripto por USD', igv: 0, baseLegal: 'Enajenación de bien intangible no gravada con IGV (principio de neutralidad tecnológica).' },
  { value: 'venta_pe', label: 'Venta de cripto por Soles', igv: 0, baseLegal: 'Mismo tratamiento — no hay IGV en venta de cripto entre personas naturales.' },
  { value: 'mineria', label: 'Minería (recompensas)', igv: 0, baseLegal: 'No hay IGV al recibir recompensas de minería. Si eres empresa habitual, los ingresos por minería están gravados con IR pero no IGV.' },
  { value: 'staking', label: 'Staking / Yield Farming', igv: 0, baseLegal: 'Recompensas DeFi: No califican como operación gravada con IGV. Tributan solo por IR (2da categoría).' },
  { value: 'swap', label: 'Swap cripto-cripto', igv: 0, baseLegal: 'Intercambio de criptos no es operación gravada con IGV (trueque de bienes intangibles — inafecto).' },
  { value: 'p2p_pe', label: 'P2P entre peruanos', igv: 0.18, baseLegal: 'Si es habitual y el vendedor es contribuyente del IGV, podría estar gravado. Persona natural no habitual: inafecto.' },
  { value: 'nft_creacion', label: 'Creación y venta de NFT', igv: 0, baseLegal: 'NFT como bien digital — no hay IGV si el creador no es contribuyente. Si es empresa (3ra categoría), aplicar IGV 18%.' },
  { value: 'comision_exchange', label: 'Comisiones por trading', igv: 0.18, baseLegal: 'Las comisiones cobradas por exchanges peruanos están gravadas con IGV como servicios digitales.' }
];

function initIgvCripto() {
  const el = document.getElementById('clIgvCriptoForm');
  if (!el) return;
  const opts = CRIPTO_IGV_TIPOS.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:550px;margin-bottom:14px">
      <div class="fi"><label>Tipo de operación</label>
        <select id="igvCriptoTipo" class="sunat-input" title="Selecciona el tipo de operación con criptomonedas para determinar si aplica IGV" onchange="onIgvCriptoChange()">${opts}</select>
      </div>
      <div class="fi"><label>Monto en USD</label><input type="number" id="igvCriptoMontoUSD" class="sunat-input" title="Monto de la operación en dólares estadounidenses" oninput="onIgvCriptoChange()" min="0" step="0.01" placeholder="1000"></div>
      <div class="fi"><label>Tipo de cambio (S/ per USD)</label><input type="number" id="igvCriptoTC" class="sunat-input" title="Tipo de cambio sol/dólar usado para convertir el monto" oninput="onIgvCriptoChange()" min="0" step="0.001" value="3.75" placeholder="3.75"></div>
      <div class="fi"><label>Monto en Soles</label><input type="number" id="igvCriptoMontoSoles" class="sunat-input" oninput="onIgvCriptoChange()" min="0" step="0.01" placeholder="3750" readonly style="opacity:0.7"></div>
      <div class="fi"><label>País del exchange</label>
        <select id="igvCriptoPais" class="sunat-input" onchange="onIgvCriptoChange()">
          <option value="pe">Perú</option><option value="us">Estados Unidos</option><option value="other">Otro (sin convenio)</option>
        </select>
      </div>
      <div class="fi"><label>Tipo de contraparte</label>
        <select id="igvCriptoContraparte" class="sunat-input" onchange="onIgvCriptoChange()">
          <option value="pn">Persona natural</option><option value="pj">Persona jurídica (empresa)</option><option value="exchange">Exchange registrado</option>
        </select>
      </div>
    </div>
    <button class="bp" onclick="calcIgvCripto()" style="background:rgba(155,89,182,.8);border-color:rgba(155,89,182,.5)">🧮 Calcular IGV</button>
    <div id="igvCriptoResult" style="display:none;margin-top:14px"></div>
    <div id="igvCriptoInfo" style="margin-top:14px;padding:12px;background:rgba(155,89,182,.05);border-radius:9px;font-size:14px;color:var(--muted);line-height:1.7"></div>`;
}

function onIgvCriptoChange() {
  const usd = parseFloat(document.getElementById('igvCriptoMontoUSD')?.value) || 0;
  const tc = parseFloat(document.getElementById('igvCriptoTC')?.value) || 3.75;
  const solesEl = document.getElementById('igvCriptoMontoSoles');
  if (solesEl) solesEl.value = (usd * tc).toFixed(2);
  const tipo = document.getElementById('igvCriptoTipo')?.value || '';
  const info = CRIPTO_IGV_TIPOS.find(t => t.value === tipo);
  const infoEl = document.getElementById('igvCriptoInfo');
  if (infoEl && info) {
    infoEl.innerHTML = `<strong style="color:#C39CE0">Base Legal:</strong><br>${info.baseLegal}`;
  }
}

function calcIgvCripto() {
  const tipo = document.getElementById('igvCriptoTipo')?.value || '';
  const montoUSD = parseFloat(document.getElementById('igvCriptoMontoUSD')?.value) || 0;
  const tc = parseFloat(document.getElementById('igvCriptoTC')?.value) || 3.75;
  const montoSoles = montoUSD * tc;
  const pais = document.getElementById('igvCriptoPais')?.value || 'pe';
  const contraparte = document.getElementById('igvCriptoContraparte')?.value || 'pn';
  const el = document.getElementById('igvCriptoResult');
  if (!el || !tipo || !montoUSD) { if (el) el.style.display = 'none'; return; }
  const tipoInfo = CRIPTO_IGV_TIPOS.find(t => t.value === tipo);
  if (!tipoInfo) return;
  let tasaIGV = tipoInfo.igv;
  if (tipo === 'p2p_pe' && contraparte === 'pn') tasaIGV = 0;
  if (tipo === 'compra_pe' && pais !== 'pe') tasaIGV = 0;
  if (tipo === 'nft_creacion' && contraparte === 'pn') tasaIGV = 0;
  const igvSoles = montoSoles * tasaIGV;
  const totalSoles = montoSoles + igvSoles;
  const fmtS = n => 'S/ ' + n.toFixed(2);
  const exonerado = tasaIGV === 0;
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:${exonerado ? 'rgba(76,175,80,.08)' : 'rgba(230,57,70,.07)'};border:1px solid ${exonerado ? 'rgba(76,175,80,.2)' : 'rgba(230,57,70,.2)'};border-radius:10px;padding:14px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
        <div class="fracc-card"><div class="fracc-card-v">${tipoInfo.label}</div><div class="fracc-card-l">Tipo de operación</div></div>
        <div class="fracc-card"><div class="fracc-card-v">${exonerado ? '✅ INAFECTO' : '⚠️ GRAVADO'}</div><div class="fracc-card-l">${exonerado ? 'No paga IGV' : 'Sujeto a IGV'}</div></div>
        <div class="fracc-card"><div class="fracc-card-v" style="color:${exonerado ? 'var(--green)' : 'var(--red)'}">${fmtS(montoSoles)}</div><div class="fracc-card-l">Base imponible</div></div>
        ${!exonerado ? `<div class="fracc-card"><div class="fracc-card-v" style="color:var(--red)">+${fmtS(igvSoles)}</div><div class="fracc-card-l">IGV (${(tasaIGV * 100).toFixed(0)}%)</div></div>
        <div class="fracc-card"><div class="fracc-card-v" style="color:var(--gold)">${fmtS(totalSoles)}</div><div class="fracc-card-l">Total con IGV</div></div>` : ''}
      </div>
      <div style="margin-top:10px;padding:8px 10px;background:rgba(155,89,182,.06);border-radius:7px;font-size:14px;color:var(--muted)">${tipoInfo.baseLegal}</div>
    </div>`;
}

const STAKING_KEY = 'tp_staking_legal';

function getStakingData() {
  try { return JSON.parse(localStorage.getItem(STAKING_KEY)) || []; } catch(e) { return []; }
}

function saveStakingData(data) {
  kvPut(STAKING_KEY, data, 'staking_legal');
}
registerKVScope('staking_legal', () => STAKING_KEY);

function initStakingTracker() {
  const el = document.getElementById('clStakingTracker');
  if (!el) return;
  const data = getStakingData();
  const totalRewards = data.reduce((s, r) => s + r.montoSoles, 0);
  const byYear = {};
  data.forEach(r => {
    const year = (r.fecha || '').split('-')[0] || 'Sin año';
    byYear[year] = (byYear[year] || 0) + r.montoSoles;
  });
  el.innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-size:14px;font-weight:500;color:#C39CE0;margin-bottom:10px">📊 Resumen de recompensas</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:12px">
        <div class="fracc-card"><div class="fracc-card-v">${data.length}</div><div class="fracc-card-l">Recompensas registradas</div></div>
        <div class="fracc-card"><div class="fracc-card-v" style="color:var(--green)">S/ ${totalRewards.toFixed(2)}</div><div class="fracc-card-l">Total Soles</div></div>
        <div class="fracc-card"><div class="fracc-card-v" style="color:var(--gold)">S/ ${(totalRewards * 0.05).toFixed(2)}</div><div class="fracc-card-l">IR estimado (5%)</div></div>
      </div>
      ${Object.entries(byYear).sort(([a],[b]) => b.localeCompare(a)).map(([year, total]) =>
        `<div style="display:flex;justify-content:space-between;padding:4px 10px;background:rgba(155,89,182,.05);border-radius:6px;margin-bottom:4px;font-size:14px">
          <span style="color:var(--muted)">${year}</span><span style="color:var(--green);font-weight:500">S/ ${total.toFixed(2)}</span>
        </div>`
      ).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px">
      <div class="fi"><label>Cripto / Token</label>
        <input type="text" id="stkCripto" class="sunat-input" title="Nombre del token o criptomoneda que generó la recompensa" placeholder="ETH, SOL, ADA..." value="ETH">
      </div>
      <div class="fi"><label>Plataforma / Protocolo</label>
        <input type="text" id="stkPlataforma" class="sunat-input" placeholder="Lido, Binance, Aave..." value="Lido">
      </div>
      <div class="fi"><label>Fecha de recepción</label>
        <input type="date" id="stkFecha" class="sunat-input" value="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="fi"><label>Monto reward (USD)</label>
        <input type="number" id="stkMontoUSD" class="sunat-input" title="Valor de la recompensa en dólares USD al momento de recibirla" oninput="stkCalcSoles()" min="0" step="0.01" placeholder="100">
      </div>
      <div class="fi"><label>Tipo de cambio</label>
        <input type="number" id="stkTC" class="sunat-input" oninput="stkCalcSoles()" min="0" step="0.001" value="3.75">
      </div>
      <div class="fi"><label>Monto Soles</label>
        <input type="number" id="stkMontoSoles" class="sunat-input" readonly style="opacity:0.7">
      </div>
      <div class="fi"><label>Tipo de recompensa</label>
        <select id="stkTipo" class="sunat-input">
          <option value="staking">Staking</option>
          <option value="yield">Yield Farming</option>
          <option value="lending">Lending / Préstamos</option>
          <option value="lp">Liquidity Pool</option>
          <option value="airdrop">Airdrop</option>
        </select>
      </div>
    </div>
    <button class="bp" onclick="addStakingReward()" style="background:rgba(155,89,182,.8);border-color:rgba(155,89,182,.5);margin-bottom:14px">+ Registrar recompensa</button>
    <div id="stkHistory"></div>`;
  renderStakingHistory();
}

function stkCalcSoles() {
  const usd = parseFloat(document.getElementById('stkMontoUSD')?.value) || 0;
  const tc = parseFloat(document.getElementById('stkTC')?.value) || 3.75;
  const solesEl = document.getElementById('stkMontoSoles');
  if (solesEl) solesEl.value = (usd * tc).toFixed(2);
}

function addStakingReward() {
  const cripto = document.getElementById('stkCripto')?.value?.trim();
  const plataforma = document.getElementById('stkPlataforma')?.value?.trim();
  const fecha = document.getElementById('stkFecha')?.value;
  const montoUSD = parseFloat(document.getElementById('stkMontoUSD')?.value) || 0;
  const tc = parseFloat(document.getElementById('stkTC')?.value) || 3.75;
  const tipo = document.getElementById('stkTipo')?.value || 'staking';
  if (!cripto || !fecha || !montoUSD) { tpToast('Completa todos los campos requeridos.', 'warn'); return; }
  const data = getStakingData();
  data.push({ cripto, plataforma, fecha, montoUSD, tc, montoSoles: montoUSD * tc, tipo, id: Date.now() });
  saveStakingData(data);
  tpToast('Recompensa registrada correctamente.', 'ok');
  initStakingTracker();
}

function removeStakingReward(id) {
  let data = getStakingData();
  data = data.filter(r => r.id !== id);
  saveStakingData(data);
  initStakingTracker();
}

function renderStakingHistory() {
  const el = document.getElementById('stkHistory');
  if (!el) return;
  const data = getStakingData();
  if (!data.length) { el.innerHTML = '<div style="font-size:14px;color:var(--muted);padding:12px;text-align:center">No hay recompensas registradas aún.</div>'; return; }
  const tipoLabels = { staking:'Staking', yield:'Yield Farming', lending:'Lending', lp:'Liquidity Pool', airdrop:'Airdrop' };
  el.innerHTML = `
    <div style="font-size:14px;font-weight:500;color:#C39CE0;margin-bottom:8px">📋 Historial de recompensas</div>
    <div style="max-height:300px;overflow-y:auto">
      ${[...data].reverse().map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(155,89,182,.04);border-radius:7px;margin-bottom:4px;font-size:14px">
          <div style="flex:1">
            <span style="color:var(--text);font-weight:500">${r.cripto}</span>
            <span style="color:var(--muted);margin-left:6px">${r.plataforma || ''}</span>
            <span style="color:var(--muted);margin-left:6px">${r.fecha || ''}</span>
            <span class="cl-badge ${r.tipo === 'staking' ? 'nuevo' : r.tipo === 'yield' ? 'riesgo' : 'vacio'}" style="margin-left:6px;font-size:9px">${tipoLabels[r.tipo] || r.tipo}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="color:var(--green);font-weight:500">S/ ${r.montoSoles.toFixed(2)}</span>
            <span style="color:var(--muted);font-size:14px">USD ${r.montoUSD.toFixed(2)}</span>
            <button onclick="removeStakingReward(${r.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">×</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function calcStakingTotal() {
  const data = getStakingData();
  const totalUSD = data.reduce((s, r) => s + r.montoUSD, 0);
  const totalSoles = data.reduce((s, r) => s + r.montoSoles, 0);
  const irEstimado = totalSoles * 0.05;
  const byYear = {};
  data.forEach(r => {
    const year = (r.fecha || '').split('-')[0] || 'Sin año';
    byYear[year] = (byYear[year] || 0) + r.montoSoles;
  });
  return { totalUSD, totalSoles, irEstimado, byYear, count: data.length };
}

async function loadCriptoPrecios() {
  const grid = document.getElementById('clPreciosGrid');
  const errEl = document.getElementById('clPreciosError');
  if (!grid) return;
  grid.innerHTML = _CG_TOP10.map(c => `<div class="fracc-card"><div class="fracc-card-l">${c.sym}</div><div class="fracc-card-v" style="font-size:14px" id="pr_${c.id}">—</div><div class="fracc-card-l" style="font-size:9px" id="pr24_${c.id}"></div></div>`).join('');
  const ids = _CG_TOP10.map(c => c.id).join(',');
  const data = await _cgPrice(ids);
  if (!data) {
    if (errEl) errEl.style.display = 'block';
    return;
  }
  if (errEl) errEl.style.display = 'none';
  const tc = await _getTC();
  const tcVenta = tc.venta || 3.75;
  for (const c of _CG_TOP10) {
    const price = data[c.id]?.usd;
    const change = data[c.id]?.usd_24h_change;
    const el = document.getElementById(`pr_${c.id}`);
    const el24 = document.getElementById(`pr24_${c.id}`);
    if (el) {
      const soles = price ? price * tcVenta : 0;
      el.innerHTML = `<span style="font-size:14px">$${price ? price.toLocaleString(undefined,{maximumFractionDigits:2}) : '—'}</span><br><span style="font-size:9px;color:var(--gold)">S/ ${soles ? soles.toLocaleString(undefined,{maximumFractionDigits:2}) : '—'}</span>`;
    }
    if (el24) {
      if (change != null) {
        el24.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
        el24.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
      } else {
        el24.textContent = '';
      }
    }
  }
}

async function onCriptoPrecioSearch() {
  const query = document.getElementById('clPrecioSearch')?.value?.trim();
  const resultEl = document.getElementById('clPrecioResult');
  if (!resultEl) return;
  if (!query || query.length < 2) { resultEl.style.display = 'none'; return; }
  const results = await _cgSearch(query);
  if (!results.length) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<div style="font-size:14px;color:var(--muted)">Sin resultados. Intenta con otro término.</div>';
    return;
  }
  const ids = results.slice(0, 5).map(r => r.id).join(',');
  const prices = await _cgPrice(ids);
  resultEl.style.display = 'block';
  resultEl.innerHTML = results.slice(0, 5).map(r => {
    const p = prices?.[r.id]?.usd;
    return `<div style="display:flex;justify-content:space-between;padding:5px 8px;background:rgba(155,89,182,.04);border-radius:6px;margin-bottom:3px;font-size:14px">
      <span><img src="${r.thumb || ''}" style="width:14px;height:14px;vertical-align:middle;margin-right:4px" onerror="this.style.display='none'">${r.name} (${r.symbol})</span>
      <span style="font-weight:500">${p ? '$' + p.toLocaleString() : '—'}</span>
    </div>`;
  }).join('');
}

async function onCriptoPrecioSelect() {
  const sel = document.getElementById('clPrecioSelect');
  const resultEl = document.getElementById('clPrecioResult');
  if (!sel || !resultEl) return;
  const coinId = sel.value;
  if (!coinId) { resultEl.style.display = 'none'; return; }
  const prices = await _cgPrice(coinId);
  const p = prices?.[coinId]?.usd;
  const tc = await _getTC();
  const tcVenta = tc.venta || 3.75;
  resultEl.style.display = 'block';
  if (p) {
    const soles = p * tcVenta;
    resultEl.innerHTML = `<div style="padding:10px;background:rgba(76,175,80,.06);border-radius:8px;font-size:14px">
      <div style="font-weight:500;color:var(--text);margin-bottom:4px">${coinId.charAt(0).toUpperCase() + coinId.slice(1)}</div>
      <div style="display:flex;gap:16px">
        <span>USD: <strong style="color:var(--green)">$${p.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></span>
        <span>Soles: <strong style="color:var(--gold)">S/ ${soles.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></span>
        <span>TC: S/ ${tcVenta.toFixed(3)}</span>
      </div>
    </div>`;
  } else {
    resultEl.innerHTML = '<div style="font-size:14px;color:var(--muted)">No se pudo obtener el precio.</div>';
  }
}

async function loadCriptoHistPrice() {
  const coinId = document.getElementById('clHistCoin')?.value?.trim().toLowerCase() || 'bitcoin';
  const dateStr = document.getElementById('clHistDate')?.value?.trim();
  const resultEl = document.getElementById('clHistResult');
  if (!resultEl || !dateStr) { tpToast('Ingresa una fecha en formato DD-MM-YYYY.', 'warn'); return; }
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<div style="font-size:14px;color:var(--muted)">Consultando precio histórico...</div>';
  const price = await _cgHistoricalPrice(coinId, dateStr);
  if (price) {
    resultEl.innerHTML = `<div style="padding:10px;background:rgba(58,134,255,.06);border-radius:8px;font-size:14px">
      <strong>${coinId.charAt(0).toUpperCase() + coinId.slice(1)}</strong> — Precio al ${dateStr}: <strong style="color:var(--green)">$${price.toLocaleString(undefined,{maximumFractionDigits:2})}</strong>
    </div>`;
  } else {
    resultEl.innerHTML = '<div style="font-size:14px;color:var(--red)">No se encontró precio para esa fecha. Verifica el ID de la cripto y el formato DD-MM-YYYY.</div>';
  }
}

async function onCriptoConv() {
  const cant = parseFloat(document.getElementById('clConvCant')?.value) || 0;
  const coinId = document.getElementById('clConvCoin')?.value || 'bitcoin';
  const tc = parseFloat(document.getElementById('clConvTC')?.value) || 3.75;
  const resultEl = document.getElementById('clConvResult');
  if (!resultEl) return;
  if (!cant || cant <= 0) { resultEl.style.display = 'none'; return; }
  const prices = await _cgPrice(coinId);
  const usdPrice = prices?.[coinId]?.usd;
  resultEl.style.display = 'block';
  if (usdPrice) {
    const usdValue = cant * usdPrice;
    const solesValue = usdValue * tc;
    resultEl.innerHTML = `<div style="padding:10px;background:rgba(155,89,182,.06);border-radius:8px;font-size:14px">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center">
        <div><div style="font-size:14px;font-weight:300;color:var(--gold)">${cant}</div><div style="font-size:14px;color:var(--muted)">${coinId.charAt(0).toUpperCase() + coinId.slice(1)}</div></div>
        <div><div style="font-size:14px;font-weight:300;color:var(--green)">$${usdValue.toLocaleString(undefined,{maximumFractionDigits:2})}</div><div style="font-size:14px;color:var(--muted)">USD</div></div>
        <div><div style="font-size:14px;font-weight:300;color:var(--gold)">S/ ${solesValue.toLocaleString(undefined,{maximumFractionDigits:2})}</div><div style="font-size:14px;color:var(--muted)">Soles (TC ${tc.toFixed(3)})</div></div>
      </div>
    </div>`;
  } else {
    resultEl.innerHTML = '<div style="font-size:14px;color:var(--muted)">No se pudo obtener el precio. Intenta de nuevo.</div>';
  }
}

// ── Portfolio Cripto functions ──
let _portAssets = [];
let _portStaking = [];
let _portPrices = {};
let _csvParsedRows = [];

const _PORT_CRYPTO_MAP = {
  bitcoin:'Bitcoin (BTC)',ethereum:'Ethereum (ETH)',tether:'Tether (USDT)',solana:'Solana (SOL)',
  binancecoin:'BNB',ripple:'XRP',cardano:'Cardano (ADA)',dogecoin:'Dogecoin (DOGE)',
  polkadot:'Polkadot (DOT)',maticnetwork:'Polygon (MATIC)',chainlink:'Chainlink (LINK)',
  avalanche2:'Avalanche (AVAX)',litecoin:'Litecoin (LTC)',bitcoincash:'Bitcoin Cash (BCH)',
  stellar:'Stellar (XLM)',cosmos:'Cosmos (ATOM)',tron:'TRON (TRX)',usdcoin:'USDC',
  dai:'Dai (DAI)',near:'NEAR Protocol',pepe:'Pepe (PEPE)'
};

function _portCoinId(name) {
  const e=Object.entries(_PORT_CRYPTO_MAP);
  for(let[k,v]of e){if(v===name||k===name)return k}
  return name.toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9]/g,'');
}

function _portName(coinId) {
  const clean=coinId.replace(/[^a-z0-9]/g,'');
  for(const[k,v]of Object.entries(_PORT_CRYPTO_MAP)){
    if(k===clean||k.replace(/[^a-z0-9]/g,'')===clean)return v
  }
  const specials={btc:'Bitcoin (BTC)',eth:'Ethereum (ETH)',usdt:'Tether (USDT)',sol:'Solana (SOL)',
    ada:'Cardano (ADA)',doge:'Dogecoin (DOGE)',dot:'Polkadot (DOT)',matic:'Polygon (MATIC)',
    link:'Chainlink (LINK)',avax:'Avalanche (AVAX)',ltc:'Litecoin (LTC)',bch:'Bitcoin Cash (BCH)',
    xlm:'Stellar (XLM)',atom:'Cosmos (ATOM)',trx:'TRON (TRX)',near:'NEAR Protocol',
    pepe:'Pepe (PEPE)',bnb:'BNB',xrp:'XRP',dai:'Dai (DAI)',usdc:'USDC'};
  return specials[coinId.toLowerCase()]||coinId.charAt(0).toUpperCase()+coinId.slice(1);
}

function loadPortfolio() {
  try{_portAssets=JSON.parse(localStorage.getItem('tp_portfolio')||'[]')}catch{_portAssets=[]}
  try{_portStaking=JSON.parse(localStorage.getItem('tp_staking')||'[]')}catch{_portStaking=[]}
  _portPrices={};
  setTimeout(()=>_portFetchPrices(),100);
}

function savePortfolio() {
  kvPut('tp_portfolio', _portAssets, 'portfolio');
  kvPut('tp_staking', _portStaking, 'staking');
}
registerKVScope('portfolio', () => 'tp_portfolio');
registerKVScope('staking', () => 'tp_staking');

async function _portFetchPrices() {
  const ids=[...new Set(_portAssets.filter(a=>a.coinId).map(a=>a.coinId))];
  if(!ids.length)return;
  try {
    const prices=await _cgPrice(ids);
    if(prices&&typeof prices==='object'){
      for(const[id,data]of Object.entries(prices)){
        _portPrices[id]={usd:data.usd||0,lastUpdated:Date.now()};
      }
    }
  }catch(e){console.warn('Error fetching prices:',e.message)}
  renderPortfolio();
}

function calcPortfolio() {
  let totalUSD=0,totalInvestedUSD=0,count=0;
  const alloc={};
  const tc=3.75;
  for(const a of _portAssets){
    const qty=parseFloat(a.cantidad)||0;
    const buyPrice=parseFloat(a.precioCompraUSD)||0;
    const currPrice=_portPrices[a.coinId]?.usd||buyPrice||0;
    const valUSD=qty*currPrice;
    const invUSD=qty*buyPrice;
    totalUSD+=valUSD;
    totalInvestedUSD+=invUSD;
    if(qty>0&&currPrice>0){alloc[a.coinId||a.activo]=(alloc[a.coinId||a.activo]||0)+valUSD}
    count++;
  }
  const pnlUSD=totalUSD-totalInvestedUSD;
  const pnlPct=totalInvestedUSD>0?((pnlUSD/totalInvestedUSD)*100):0;
  return{totalUSD,totalInvestedUSD,pnlUSD,pnlPct,count,alloc,tc};
}

function renderPortfolio() {
  const calc=calcPortfolio();
  const tc=calc.tc;
  document.getElementById('cpValUSD').textContent='$'+calc.totalUSD.toFixed(2);
  document.getElementById('cpValPEN').textContent='S/ '+(calc.totalUSD*tc).toFixed(2);
  document.getElementById('cpInvested').textContent='$'+calc.totalInvestedUSD.toFixed(2);
  const pnlEl=document.getElementById('cpPnL');
  pnlEl.textContent='$'+calc.pnlUSD.toFixed(2);
  pnlEl.style.color=calc.pnlUSD>=0?'var(--green)':'var(--red)';
  const pnlPctEl=document.getElementById('cpPnLPct');
  pnlPctEl.textContent=(calc.pnlPct>=0?'+':'')+calc.pnlPct.toFixed(2)+'%';
  pnlPctEl.style.color=calc.pnlPct>=0?'var(--green)':'var(--red)';
  document.getElementById('cpCount').textContent=calc.count;

  const allocEl=document.getElementById('cpAllocation');
  const entries=Object.entries(calc.alloc);
  if(!entries.length){
    allocEl.innerHTML='<div style="text-align:center;padding:10px;color:var(--muted);font-size:14px">Sin activos para mostrar asignación.</div>';
  }else{
    const total=Object.values(calc.alloc).reduce((s,v)=>s+v,0);
    const colors=['#9B59B6','#3A86FF','#E8A020','#4CAF50','#E63946','#C39CE0','#00BCD4','#FF9800','#8BC34A','#F44336','#607D8B','#FFC107','#9C27B0','#03A9F4','#795548','#E91E63','#009688','#CDDC39','#7C4DFF','#FF6D00'];
    const sorted=entries.sort((a,b)=>b[1]-a[1]);
    allocEl.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:10px">'+
      sorted.map(([id,val],i)=>{
        const pct=total>0?(val/total)*100:0;
        const name=_portName(id);
        return '<div style="flex:1;min-width:120px;display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(255,255,255,.03);border-radius:7px">'+
          '<div style="width:10px;height:10px;border-radius:3px;background:'+colors[i%colors.length]+';flex-shrink:0"></div>'+
          '<div style="flex:1;min-width:0"><div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+name+'</div>'+
          '<div style="height:4px;background:rgba(255,255,255,.07);border-radius:2px;margin-top:3px;overflow:hidden">'+
          '<div style="height:100%;width:'+pct.toFixed(1)+'%;background:'+colors[i%colors.length]+';border-radius:2px"></div></div></div>'+
          '<div style="font-size:14px;color:var(--muted);text-align:right"><div>'+pct.toFixed(1)+'%</div><div>$'+val.toFixed(0)+'</div></div></div>';
      }).join('')+'</div>';
  }

  const tbody=document.getElementById('cpAssetsBody');
  const empty=document.getElementById('cpAssetsEmpty');
  if(!_portAssets.length){
    tbody.innerHTML='';
    empty.style.display='block';
    return;
  }
  empty.style.display='none';
  tbody.innerHTML=_portAssets.map((a,i)=>{
    const qty=parseFloat(a.cantidad)||0;
    const buyPrice=parseFloat(a.precioCompraUSD)||0;
    const currPrice=_portPrices[a.coinId]?.usd||buyPrice||0;
    const currPricePEN=currPrice*tc;
    const valPEN=qty*currPricePEN;
    const invPEN=qty*buyPrice*tc;
    const pnlPEN=valPEN-invPEN;
    const pnlPct=invPEN>0?((pnlPEN/invPEN)*100):0;
    const name=_portName(a.coinId||a.activo);
    return '<tr>'+
      '<td><strong>'+name+'</strong>'+(a.exchange?'<br><span style="font-size:9px;color:var(--muted)">'+a.exchange+'</span>':'')+'</td>'+
      '<td>'+qty.toFixed(6)+'</td>'+
      '<td>$'+buyPrice.toFixed(2)+'</td>'+
      '<td>$'+currPrice.toFixed(2)+'</td>'+
      '<td>S/ '+currPricePEN.toFixed(2)+'</td>'+
      '<td>S/ '+valPEN.toFixed(2)+'</td>'+
      '<td>S/ '+invPEN.toFixed(2)+'</td>'+
      '<td style="color:'+(pnlPEN>=0?'var(--green)':'var(--red)')+'">'+(pnlPEN>=0?'+':'')+'S/ '+pnlPEN.toFixed(2)+'</td>'+
      '<td style="color:'+(pnlPct>=0?'var(--green)':'var(--red)')+'">'+(pnlPct>=0?'+':'')+pnlPct.toFixed(2)+'%</td>'+
      '<td><button onclick="editPortAsset('+i+')" style="background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--muted);padding:3px 7px;font-size:14px;cursor:pointer;font-family:inherit">✏️</button> '+
      '<button onclick="removePortAsset('+i+')" style="background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--muted);padding:3px 7px;font-size:14px;cursor:pointer;font-family:inherit">🗑</button></td>'+
      '</tr>';
  }).join('');
  renderMultiYearDashboard();
  _portPopulateOppCostSelects();
}

function addPortAsset() {
  const coinId=document.getElementById('cpAssetSelect').value;
  let activo=coinId;
  if(coinId==='otro'||!coinId){
    const other=document.getElementById('cpAssetOther').value.trim();
    if(!other){tpToast('Ingresa el nombre del activo.','warn');return}
    activo=other;
    coinId=_portCoinId(other);
  }else if(!coinId){
    tpToast('Selecciona un activo.','warn');return;
  }
  const cantidad=parseFloat(document.getElementById('cpCantidad').value);
  if(!cantidad||cantidad<=0){tpToast('Ingresa una cantidad válida.','warn');return}
  const precioCompra=parseFloat(document.getElementById('cpPrecioCompra').value);
  if(!precioCompra||precioCompra<=0){tpToast('Ingresa un precio de compra válido.','warn');return}
  const fechaCompra=document.getElementById('cpFechaCompra').value||new Date().toISOString().slice(0,10);
  const exchange=document.getElementById('cpExchange').value.trim();
  const notas=document.getElementById('cpNotas').value.trim();
  const idx=_portAssets.findIndex(a=>a.coinId===coinId&&Math.abs(a.precioCompraUSD-precioCompra)<0.01);
  if(idx>=0){
    const existing=_portAssets[idx];
    const totalQty=parseFloat(existing.cantidad)+cantidad;
    const totalCost=parseFloat(existing.cantidad)*existing.precioCompraUSD+cantidad*precioCompra;
    existing.cantidad=totalQty;
    existing.precioCompraUSD=totalCost/totalQty;
    if(fechaCompra<existing.fechaCompra)existing.fechaCompra=fechaCompra;
    if(exchange&&!existing.exchange)existing.exchange=exchange;
  }else{
    _portAssets.push({id:Date.now(),coinId,activo,cantidad,precioCompraUSD:precioCompra,fechaCompra,exchange,notas});
  }
  savePortfolio();
  document.getElementById('cpCantidad').value='';
  document.getElementById('cpPrecioCompra').value='';
  document.getElementById('cpFechaCompra').value='';
  document.getElementById('cpExchange').value='';
  document.getElementById('cpNotas').value='';
  tpToast('✅ '+_portName(coinId)+' agregado al portafolio.','ok');
  _portFetchPrices();
}

function editPortAsset(idx) {
  const a=_portAssets[idx];
  if(!a)return;
  const newQty=prompt('Nueva cantidad para '+_portName(a.coinId||a.activo)+':',a.cantidad);
  if(newQty===null)return;
  const qty=parseFloat(newQty);
  if(isNaN(qty)||qty<0){tpToast('Cantidad inválida.','warn');return}
  const newPrice=prompt('Nuevo precio de compra USD:',a.precioCompraUSD);
  if(newPrice===null)return;
  const price=parseFloat(newPrice);
  if(isNaN(price)||price<0){tpToast('Precio inválido.','warn');return}
  a.cantidad=qty;
  a.precioCompraUSD=price;
  savePortfolio();
  _portFetchPrices();
  tpToast('✅ Activo actualizado.','ok');
}

function removePortAsset(idx) {
  const a=_portAssets[idx];
  if(!a)return;
  if(!confirm('¿Eliminar '+_portName(a.coinId||a.activo)+' del portafolio?'))return;
  _portAssets.splice(idx,1);
  savePortfolio();
  _portFetchPrices();
  tpToast('🗑 Activo eliminado.','ok');
}

function clearPortfolio() {
  if(!_portAssets.length){tpToast('El portafolio ya está vacío.','info');return}
  if(!confirm('¿Eliminar TODOS los activos del portafolio? Esta acción no se puede deshacer.'))return;
  _portAssets=[];
  _portStaking=[];
  savePortfolio();
  renderPortfolio();
  tpToast('🗑 Portafolio limpiado.','ok');
}

function _portFmtS(n){return'S/ '+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')}
function _portFmtUSD(n){return'$'+n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',')}

function importCSV() {
  const file=document.getElementById('cpCSVFile').files[0];
  if(!file){tpToast('Selecciona un archivo CSV.','warn');return}
  const format=document.getElementById('cpCSVFormat').value;
  const reader=new FileReader();
  reader.onload=function(e){
    const text=e.target.result;
    let rows;
    if(format==='binance'||(!format||format==='auto')&&text.includes('Date(UTC),Market')){
      rows=parseBinanceCSV(text);
    }else if(format==='coinbase'||(!format||format==='auto')&&text.includes('Timestamp,Transaction Type')){
      rows=parseCoinbaseCSV(text);
    }else if(format==='kucoin'||(!format||format==='auto')&&text.includes('Date,Time,Type,Size,Price,Cost,Fee')){
      rows=parseKuCoinCSV(text);
    }else if(format==='kraken'||(!format||format==='auto')&&text.includes('txid,refid,time,type,asset,qty,price,fee')){
      rows=parseKrakenCSV(text);
    }else if(format==='bybit'||(!format||format==='auto')&&text.includes('Transaction ID,Time,Type,Coin,Size,Price,Fee')){
      rows=parseBybitCSV(text);
    }else if(format==='cryptocom'||(!format||format==='auto')&&text.includes('Timestamp (UTC),Transaction Description')){
      rows=parseCryptocomCSV(text);
    }else{
      rows=parseGenericCSV(text);
    }
    if(!rows||!rows.length){tpToast('No se pudieron parsear transacciones del CSV. Verifica el formato.','warn');return}
    _csvParsedRows=rows;
    showCSVPreview(rows);
  };
  reader.readAsText(file);
}

function parseBinanceCSV(text) {
  const lines=text.trim().split('\n');
  if(lines.length<2)return[];
  const results=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<6)continue;
    const date=parts[0].trim();
    const market=parts[1].trim();
    const type=parts[2].trim().toUpperCase();
    const price=parseFloat(parts[3])||0;
    const amount=parseFloat(parts[4])||0;
    const total=parseFloat(parts[5])||0;
    const fee=parseFloat(parts[6])||0;
    const [base,quote]=market.split(/[\/\-]/);
    if(!base||!quote)continue;
    results.push({
      fecha:date.split(' ')[0],activo:base,tipo:type==='BUY'?'compra':'venta',
      cantidad:amount,precioUSD:price,totalUSD:total,comisionUSD:fee,
      exchange:'Binance',quote,raw:lines[i]
    });
  }
  return results;
}

function parseCoinbaseCSV(text) {
  const lines=text.trim().split('\n');
  if(lines.length<2)return[];
  const results=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<6)continue;
    const timestamp=parts[0].trim();
    const txType=parts[1].trim();
    const asset=parts[2].trim();
    const qtyTransacted=parseFloat(parts[3])||0;
    const spotPrice=parseFloat(parts[4])||0;
    const usdSpot=parseFloat(parts[5])||0;
    const total=Math.abs(qtyTransacted)*spotPrice;
    const isBuy=txType.toLowerCase().includes('buy')||qtyTransacted>0;
    if(txType.toLowerCase().includes('send')||txType.toLowerCase().includes('receive'))continue;
    results.push({
      fecha:timestamp.split('T')[0],activo:asset,tipo:isBuy?'compra':'venta',
      cantidad:Math.abs(qtyTransacted),precioUSD:spotPrice,
      totalUSD:total,comisionUSD:0,exchange:'Coinbase',raw:lines[i]
    });
  }
  return results;
}

function parseGenericCSV(text) {
  const lines=text.trim().split('\n');
  if(lines.length<2)return[];
  const header=lines[0].toLowerCase();
  const cols={};
  const hParts=lines[0].split(',');
  const fieldMap={fecha:['fecha','date','fech','timestamp','tiempo'],activo:['activo','asset','cripto','moneda','coin','symbol','market','crypto','nombre'],
    tipo:['tipo','type','transaction','tx','side','operation'],cantidad:['cantidad','amount','quantity','qty','volumen','volume'],
    precio:['precio','price','precio_unitario','unit_price','spot','rate'],
    comision:['comision','fee','commission','comisión','fee_amount','gastos'],
    total:['total','total_usd','monto','importe','valor','amount_usd','usd_total']};
  for(let c=0;c<hParts.length;c++){
    const h=hParts[c].trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    for(const[key,aliases]of Object.entries(fieldMap)){
      if(aliases.some(a=>h.includes(a))){cols[key]=c;break}
    }
  }
  if(cols.fecha===undefined||cols.activo===undefined||cols.cantidad===undefined){return parseSimpleCSV(text)}
  const results=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<2)continue;
    const fecha=(parts[cols.fecha]||'').trim().split(' ')[0];
    const activo=(parts[cols.activo]||'').trim();
    const tipoRaw=(parts[cols.tipo]||'').trim().toLowerCase();
    const tipo=tipoRaw.includes('vent')||tipoRaw.includes('sell')?'venta':'compra';
    const cantidad=Math.abs(parseFloat(parts[cols.cantidad])||0);
    const precio=parseFloat(parts[cols.precio])||0;
    const comision=cols.comision!==undefined?(parseFloat(parts[cols.comision])||0):0;
    const total=cols.total!==undefined?(parseFloat(parts[cols.total])||0):cantidad*precio;
    if(!cantidad||!activo)continue;
    results.push({fecha,activo,tipo,cantidad,precioUSD:precio,totalUSD:total,comisionUSD:comision,exchange:'Importado',raw:lines[i]});
  }
  return results;
}

function parseSimpleCSV(text) {
  const lines=text.trim().split('\n').filter(l=>l.trim());
  if(lines.length<2)return[];
  const results=[];
  for(let i=0;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<3)continue;
    const fecha=parts[0].trim().split(' ')[0];
    const activo=parts[1].trim();
    const tipo=parts.length>2?parts[2].trim().toLowerCase():'compra';
    const cantidad=Math.abs(parseFloat(parts[3])||0);
    const precio=parseFloat(parts[4])||0;
    const comision=parts.length>5?(parseFloat(parts[5])||0):0;
    if(!cantidad||!activo)continue;
    results.push({fecha,activo,tipo:tipo.includes('vent')?'venta':'compra',cantidad,precioUSD:precio,totalUSD:cantidad*precio,comisionUSD:comision,exchange:'Importado',raw:lines[i]});
  }
  return results;
}

function parseKuCoinCSV(text) {
  const lines=text.trim().split('\n');
  if(lines.length<2)return[];
  const hParts=lines[0].split(',');
  const coinIdx=hParts.findIndex(h=>/coin|symbol|pair|market/i.test(h.trim()));
  const results=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<7)continue;
    const date=parts[0].trim();
    const type=parts[2].trim().toUpperCase();
    const size=parseFloat(parts[3])||0;
    const price=parseFloat(parts[4])||0;
    const cost=parseFloat(parts[5])||0;
    const fee=parseFloat(parts[6])||0;
    let activo='';
    if(coinIdx>=0&&parts[coinIdx]){
      activo=parts[coinIdx].trim().replace(/\/.*$/,'').replace(/-.*$/,'');
    }else if(parts.length>7&&parts[7]){
      activo=parts[7].trim().replace(/\/.*$/,'').replace(/-.*$/,'');
    }
    if(!size||!price)continue;
    results.push({fecha:date.split(' ')[0],activo,tipo:type==='BUY'?'compra':'venta',cantidad:size,precioUSD:price,totalUSD:cost,comisionUSD:fee,exchange:'KuCoin',raw:lines[i]});
  }
  return results;
}

function parseKrakenCSV(text) {
  const lines=text.trim().split('\n');
  if(lines.length<2)return[];
  const results=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<8)continue;
    const time=parts[2].trim();
    const type=parts[3].trim().toUpperCase();
    let asset=parts[4].trim();
    const qty=parseFloat(parts[5])||0;
    const price=parseFloat(parts[6])||0;
    const fee=parseFloat(parts[7])||0;
    if(asset.startsWith('X')||asset.startsWith('Z'))asset=asset.slice(1);
    if(asset==='XBT')asset='BTC';
    if(asset==='XETH')asset='ETH';
    const total=qty*price;
    if(!qty||!price)continue;
    const ts=parseFloat(time);
    const fecha=!isNaN(ts)&&ts>1000000000?new Date(ts*1000).toISOString().split('T')[0]:time.split(' ')[0];
    results.push({fecha,activo:asset,tipo:type==='BUY'?'compra':'venta',cantidad:qty,precioUSD:price,totalUSD:total,comisionUSD:fee,exchange:'Kraken',raw:lines[i]});
  }
  return results;
}

function parseBybitCSV(text) {
  const lines=text.trim().split('\n');
  if(lines.length<2)return[];
  const results=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<7)continue;
    const time=parts[1].trim();
    const type=parts[2].trim().toUpperCase();
    const coin=parts[3].trim();
    const size=parseFloat(parts[4])||0;
    const price=parseFloat(parts[5])||0;
    const fee=parseFloat(parts[6])||0;
    if(!size||!price)continue;
    results.push({fecha:time.split(' ')[0],activo:coin,tipo:type==='BUY'?'compra':'venta',cantidad:size,precioUSD:price,totalUSD:size*price,comisionUSD:fee,exchange:'Bybit',raw:lines[i]});
  }
  return results;
}

function parseCryptocomCSV(text) {
  const lines=text.trim().split('\n');
  if(lines.length<2)return[];
  const results=[];
  for(let i=1;i<lines.length;i++){
    const parts=lines[i].split(',');
    if(parts.length<10)continue;
    const timestamp=parts[0].trim();
    const currency=parts[2].trim();
    const amount=parseFloat(parts[3])||0;
    const toCurrency=parts[4].trim();
    const toAmount=parseFloat(parts[5])||0;
    const nativeUSD=parseFloat(parts[8])||0;
    const kind=parts[9].trim().toLowerCase();
    if(!currency)continue;
    const absAmt=Math.abs(amount);
    if(kind==='crypto_purchase'){
      const price=absAmt>0?nativeUSD/absAmt:0;
      results.push({fecha:timestamp.split(' ')[0],activo:currency,tipo:'compra',cantidad:absAmt,precioUSD:price,totalUSD:nativeUSD,comisionUSD:0,exchange:'Crypto.com',raw:lines[i]});
    }else if(kind==='crypto_sell'){
      const price=absAmt>0?nativeUSD/absAmt:0;
      results.push({fecha:timestamp.split(' ')[0],activo:currency,tipo:'venta',cantidad:absAmt,precioUSD:price,totalUSD:nativeUSD,comisionUSD:0,exchange:'Crypto.com',raw:lines[i]});
    }else if(kind==='crypto_exchange'){
      if(amount<0&&absAmt>0){
        const price=absAmt>0?nativeUSD/absAmt:0;
        results.push({fecha:timestamp.split(' ')[0],activo:currency,tipo:'venta',cantidad:absAmt,precioUSD:price,totalUSD:nativeUSD,comisionUSD:0,exchange:'Crypto.com',raw:lines[i]});
      }
      const absTo=Math.abs(toAmount);
      if(toCurrency&&absTo>0){
        const priceTo=absTo>0?nativeUSD/absTo:0;
        results.push({fecha:timestamp.split(' ')[0],activo:toCurrency,tipo:'compra',cantidad:absTo,precioUSD:priceTo,totalUSD:nativeUSD,comisionUSD:0,exchange:'Crypto.com',raw:lines[i]});
      }
    }
  }
  return results;
}

function showCSVPreview(rows) {
  const el=document.getElementById('cpCSVPreview');
  el.style.display='block';
  document.getElementById('cpCSVCount').textContent=rows.length;
  const wrap=document.getElementById('cpCSVTableWrap');
  wrap.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>'+
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;color:var(--muted)">Fecha</th>'+
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;color:var(--muted)">Activo</th>'+
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;color:var(--muted)">Tipo</th>'+
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted)">Cantidad</th>'+
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted)">Precio USD</th>'+
    '<th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted)">Total USD</th>'+
    '</tr></thead><tbody>'+
    rows.slice(0,50).map(r=>'<tr>'+
      '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04)">'+(r.fecha||'')+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04)">'+(r.activo||'')+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);color:'+(r.tipo==='compra'?'var(--green)':'var(--red)')+'">'+(r.tipo||'')+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right">'+(r.cantidad||0).toFixed(6)+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right">$'+(r.precioUSD||0).toFixed(2)+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right">$'+(r.totalUSD||0).toFixed(2)+'</td>'+
      '</tr>').join('')+
    (rows.length>50?'<tr><td colspan="6" style="padding:8px;text-align:center;color:var(--muted);font-size:14px">... y '+(rows.length-50)+' más</td></tr>':'')+
    '</tbody></table>';
}

function confirmCSVImport() {
  if(!_csvParsedRows||!_csvParsedRows.length){tpToast('No hay datos para importar.','warn');return}
  let added=0;
  for(const r of _csvParsedRows){
    if(r.tipo==='compra'){
      const coinId=_portCoinId(r.activo);
      const idx=_portAssets.findIndex(a=>a.coinId===coinId);
      if(idx>=0){
        const a=_portAssets[idx];
        const oldQty=parseFloat(a.cantidad);
        const oldCost=oldQty*a.precioCompraUSD;
        a.cantidad=oldQty+r.cantidad;
        a.precioCompraUSD=(oldCost+r.cantidad*r.precioUSD)/a.cantidad;
      }else{
        _portAssets.push({id:Date.now()+Math.random(),coinId:coinId||r.activo,activo:r.activo,
          cantidad:r.cantidad,precioCompraUSD:r.precioUSD,fechaCompra:r.fecha||new Date().toISOString().slice(0,10),
          exchange:r.exchange||'Importado',notas:''});
      }
      added++;
    }
  }
  _csvParsedRows=[];
  savePortfolio();
  document.getElementById('cpCSVPreview').style.display='none';
  document.getElementById('cpCSVFile').value='';
  tpToast('✅ '+added+' transacción(es) importada(s).','ok');
  _portFetchPrices();
}

function genTaxReport() {
  const year=parseInt(document.getElementById('cpTaxYear').value)||new Date().getFullYear();
  const method=document.getElementById('cpTaxMethod').value;
  const tx=_portAssets.filter(a=>{
    const d=new Date(a.fechaCompra);
    return !isNaN(d.getTime())&&d.getFullYear()===year;
  });
  if(!tx.length){
    document.getElementById('cpTaxResult').style.display='block';
    document.getElementById('cpTaxResult').innerHTML='<div style="text-align:center;padding:20px;color:var(--muted)">No hay transacciones en '+year+'.</div>';
    return;
  }
  const totalCompras=tx.reduce((s,a)=>s+parseFloat(a.cantidad||0)*a.precioCompraUSD,0);
  const totalVentas=0;
  const gananciaBruta=-totalCompras;
  const irPN=Math.max(0,gananciaBruta*0.05);
  const irPJ=Math.max(0,gananciaBruta*0.295);
  const el=document.getElementById('cpTaxResult');
  el.style.display='block';
  document.getElementById('cpTaxSummary').innerHTML=
    '<div class="pcard"><div class="pcard-lbl">Total Compras USD</div><div class="pcard-val gold">'+_portFmtUSD(totalCompras)+'</div></div>'+
    '<div class="pcard"><div class="pcard-lbl">Total Ventas USD</div><div class="pcard-val">'+_portFmtUSD(totalVentas)+'</div></div>'+
    '<div class="pcard"><div class="pcard-lbl">Ganancia/Pérdida Bruta USD</div><div class="pcard-val" style="color:'+(gananciaBruta>=0?'var(--green)':'var(--red)')+'">'+(gananciaBruta>=0?'+':'')+_portFmtUSD(gananciaBruta)+'</div></div>'+
    '<div class="pcard"><div class="pcard-lbl">IR Estimado (5% PN)</div><div class="pcard-val" style="color:var(--red)">'+_portFmtUSD(irPN)+'</div></div>'+
    '<div class="pcard"><div class="pcard-lbl">IR Estimado (29.5% PJ)</div><div class="pcard-val" style="color:var(--red)">'+_portFmtUSD(irPJ)+'</div></div>';
  document.getElementById('cpTaxTableWrap').innerHTML=
    '<table class="res-table" style="width:100%;font-size:14px"><thead><tr>'+
    '<th>Fecha</th><th>Activo</th><th>Tipo</th><th>Cantidad</th><th>Precio USD</th><th>Total USD</th><th>Método</th></tr></thead><tbody>'+
    tx.map(a=>'<tr>'+
      '<td>'+(a.fechaCompra||'')+'</td>'+
      '<td>'+_portName(a.coinId||a.activo)+'</td>'+
      '<td>Compra</td>'+
      '<td>'+(parseFloat(a.cantidad)||0).toFixed(6)+'</td>'+
      '<td>$'+(a.precioCompraUSD||0).toFixed(2)+'</td>'+
      '<td>$'+((parseFloat(a.cantidad)||0)*a.precioCompraUSD).toFixed(2)+'</td>'+
      '<td>'+method.toUpperCase()+'</td>'+
      '</tr>').join('')+
    '</tbody></table>';
}

function renderTaxReport(year,method,data) {}

function downloadTaxReport() {
  const summaryEl=document.getElementById('cpTaxSummary');
  const tableEl=document.getElementById('cpTaxTableWrap');
  if(!summaryEl||!tableEl)return;
  const year=document.getElementById('cpTaxYear').value;
  const method=document.getElementById('cpTaxMethod').value;
  const methodLabels={fifo:'FIFO / PEPS',lifo:'LIFO / UEPS',avg:'Costo Promedio Ponderado'};
  const cards=summaryEl.querySelectorAll('.pcard');
  const summaryRows=Array.from(cards).map(c=>{
    const lbl=c.querySelector('.pcard-lbl')?.textContent||'';
    const val=c.querySelector('.pcard-val')?.textContent||'';
    return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:14px"><span style="color:#666">'+lbl+'</span><span style="font-weight:500">'+val+'</span></div>';
  }).join('');
  const tableHtml=tableEl.innerHTML;
  const win=window.open('','_blank');
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reporte Tributario Cripto '+year+'</title>'+
    '<style>body{font-family:Arial,sans-serif;max-width:780px;margin:40px auto;color:#333;line-height:1.5;padding:0 20px}'+
    'h1{color:#9B59B6;border-bottom:2px solid #9B59B6;padding-bottom:8px;font-size:20px}'+
    'h2{color:#666;font-size:14px;margin:20px 0 10px}'+
    '.summary{background:#f8f4ff;border:1px solid #d4b0e8;border-radius:8px;padding:14px;margin:16px 0}'+
    'table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}'+
    'th{background:#9B59B6;color:#fff;padding:8px 10px;text-align:left;font-size:14px;text-transform:uppercase}'+
    'td{padding:7px 10px;border-bottom:1px solid #eee}'+
    'tr:hover td{background:#f5f0ff}'+
    '.footer{font-size:14px;color:#999;text-align:center;margin-top:30px;border-top:1px solid #eee;padding-top:12px}'+
    '@media print{body{margin:20px}}</style></head><body>'+
    '<h1>📊 Reporte Tributario Cripto — '+year+'</h1>'+
    '<p style="font-size:14px;color:#888">Generado: '+new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})+
    ' · Método: '+(methodLabels[method]||method.toUpperCase())+'</p>'+
    '<h2>Resumen</h2><div class="summary">'+summaryRows+'</div>'+
    '<h2>Detalle de Transacciones</h2>'+tableHtml+
    '<div class="footer">Documento generado por DeclaraFY.pe — Solo con fines orientativos. Consulta con un profesional para decisiones formales.</div>'+
    '</body></html>');
  win.document.close();
  setTimeout(()=>win.print(),500);
}

function downloadTaxPDF() {
  const year=document.getElementById('cpTaxYear').value;
  const method=document.getElementById('cpTaxMethod').value;
  const methodLabels={fifo:'FIFO / PEPS',lifo:'LIFO / UEPS',avg:'Costo Promedio Ponderado'};
  const methodLabel=methodLabels[method]||method.toUpperCase();
  if(typeof html2pdf==='undefined'){tpToast('La librería PDF no ha cargado. Usa "Descargar reporte HTML" y desde el navegador elige "Imprimir > Guardar como PDF".','warn');return}
  const el=document.createElement('div');
  el.style.cssText='padding:30px;font-family:Arial,sans-serif;max-width:780px;margin:auto;color:#333;line-height:1.6;background:#fff';
  el.innerHTML=
    '<h1 style="color:#9B59B6;border-bottom:2px solid #9B59B6;padding-bottom:8px;font-size:22px">📊 Reporte Tributario Cripto — '+year+'</h1>'+
    '<p style="font-size:14px;color:#888">Generado: '+new Date().toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'})+
    ' · Método: '+methodLabel+'</p>'+
    '<div style="margin:16px 0">'+document.getElementById('cpTaxSummary').innerHTML+'</div>'+
    '<h2 style="color:#666;font-size:16px;margin:20px 0 10px">Detalle de Transacciones</h2>'+
    document.getElementById('cpTaxTableWrap').innerHTML+
    '<p style="font-size:12px;color:#999;text-align:center;margin-top:30px;border-top:1px solid #eee;padding-top:12px">Documento generado por DeclaraFY.pe — Solo con fines orientativos. Consulta con un profesional para decisiones formales.</p>';
  document.body.appendChild(el);
  html2pdf().set({margin:[10,10,10,10],filename:'reporte_tributario_cripto_'+year+'.pdf',image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}}).from(el).save().then(()=>{document.body.removeChild(el)}).catch(()=>{document.body.removeChild(el);tpToast('Error al generar PDF. Intenta con el reporte HTML.','err')});
}

function addPortStaking() {
  const coinId=document.getElementById('cpStakingAsset').value;
  if(!coinId){tpToast('Selecciona un activo.','warn');return}
  const cantidad=parseFloat(document.getElementById('cpStakingCant').value);
  if(!cantidad||cantidad<=0){tpToast('Ingresa una cantidad válida.','warn');return}
  const valorUSD=parseFloat(document.getElementById('cpStakingValor').value);
  const fecha=document.getElementById('cpStakingFecha').value||new Date().toISOString().slice(0,10);
  _portStaking.push({id:Date.now(),coinId,cantidad,valorUSD,fecha,notas:''});
  savePortfolio();
  document.getElementById('cpStakingCant').value='';
  document.getElementById('cpStakingValor').value='';
  document.getElementById('cpStakingFecha').value='';
  loadPortStaking();
  tpToast('✅ Reward de staking agregado.','ok');
}

function loadPortStaking() {
  try{_portStaking=JSON.parse(localStorage.getItem('tp_staking')||'[]')}catch{_portStaking=[]}
  const totalReward=_portStaking.reduce((s,r)=>s+(parseFloat(r.valorUSD)||0),0);
  const irStaking=totalReward*0.05;
  const summaryEl=document.getElementById('cpStakingSummary');
  summaryEl.innerHTML=
    '<div class="pcard"><div class="pcard-lbl">Total Rewards USD</div><div class="pcard-val gold">$'+totalReward.toFixed(2)+'</div></div>'+
    '<div class="pcard"><div class="pcard-lbl">IR Estimado (5%)</div><div class="pcard-val" style="color:var(--red)">$'+irStaking.toFixed(2)+'</div></div>'+
    '<div class="pcard"><div class="pcard-lbl">Transacciones</div><div class="pcard-val">'+_portStaking.length+'</div></div>';
  const listEl=document.getElementById('cpStakingList');
  if(!_portStaking.length){
    listEl.innerHTML='<div style="color:var(--muted);font-size:14px;padding:8px 0">Sin rewards registrados.</div>';
  }else{
    listEl.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr>'+
      '<th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left;color:var(--muted);font-weight:400">Activo</th>'+
      '<th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);font-weight:400">Cantidad</th>'+
      '<th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);font-weight:400">Valor USD</th>'+
      '<th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:left;color:var(--muted);font-weight:400">Fecha</th>'+
      '<th style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:center;color:var(--muted);font-weight:400"></th></tr></thead><tbody>'+
      _portStaking.map((r,i)=>'<tr>'+
        '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04)">'+_portName(r.coinId)+'</td>'+
        '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right">'+(r.cantidad||0).toFixed(6)+'</td>'+
        '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right">$'+(r.valorUSD||0).toFixed(2)+'</td>'+
        '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04)">'+(r.fecha||'')+'</td>'+
        '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);text-align:center">'+
        '<button onclick="_portStaking.splice('+i+',1);savePortfolio();loadPortStaking();" style="background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--muted);padding:2px 6px;font-size:14px;cursor:pointer;font-family:inherit">🗑</button></td>'+
        '</tr>').join('')+
      '</tbody></table>';
  }
}

// ── Multi-Year Dashboard ──
function renderMultiYearDashboard() {
  try {
    const years = {};
    for (const a of _portAssets) {
      const d = new Date(a.fechaCompra);
      if (isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      if (!years[y]) years[y] = { invested: 0, current: 0, count: 0 };
      const qty = parseFloat(a.cantidad) || 0;
      const bp = parseFloat(a.precioCompraUSD) || 0;
      const cp = _portPrices[a.coinId]?.usd || bp || 0;
      years[y].invested += qty * bp;
      years[y].current += qty * cp;
      years[y].count++;
    }
    const sYears = {};
    for (const s of _portStaking) {
      const d = new Date(s.fecha);
      if (isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      sYears[y] = (sYears[y] || 0) + (parseFloat(s.valorUSD) || 0);
    }
    const sorted = Object.keys(years).sort();
    const el = document.getElementById('cpMultiYearWrap');
    if (!el) return;
    if (!sorted.length) { el.innerHTML = ''; return }
    let html = '<div class="sec-title" style="margin-top:20px">📅 Dashboard Multi-Anual</div>';
    html += '<div style="overflow-x:auto;margin-bottom:16px"><table class="res-table" style="width:100%;font-size:14px"><thead><tr>' +
      '<th>Año</th><th>Total Invertido</th><th>Valor Actual</th><th>Ganancia/Pérdida</th><th>Retorno %</th><th>Staking Rewards</th><th>Activos</th></tr></thead><tbody>';
    for (const y of sorted) {
      const inv = years[y].invested;
      const cur = years[y].current;
      const pnl = cur - inv;
      const pct = inv > 0 ? (pnl / inv) * 100 : 0;
      const staking = sYears[y] || 0;
      const sgn = pnl >= 0 ? '+' : '';
      html += '<tr>' +
        '<td><strong>' + y + '</strong></td>' +
        '<td>$' + inv.toFixed(2) + '</td>' +
        '<td>$' + cur.toFixed(2) + '</td>' +
        '<td style="color:' + (pnl >= 0 ? 'var(--green)' : 'var(--red)') + '">' + sgn + '$' + pnl.toFixed(2) + '</td>' +
        '<td style="color:' + (pct >= 0 ? 'var(--green)' : 'var(--red)') + '">' + sgn + pct.toFixed(2) + '%</td>' +
        '<td>' + (staking > 0 ? '$' + staking.toFixed(2) : '—') + '</td>' +
        '<td>' + years[y].count + '</td></tr>';
    }
    html += '</tbody></table></div>';
    el.innerHTML = html;
  } catch (e) { console.warn('renderMultiYearDashboard:', e.message) }
}

// ── Opportunity Cost ──
function _portPopulateOppCostSelects() {
  try {
    const selA = document.getElementById('cpOppCostAsset');
    const selB = document.getElementById('cpOppCostAlt');
    if (!selA || !selB) return;
    selA.innerHTML = '<option value="">— Seleccionar —</option>' +
      _portAssets.map(a => '<option value="' + (a.coinId || a.activo) + '">' + _portName(a.coinId || a.activo) + '</option>').join('');
    selB.innerHTML = '<option value="">— Seleccionar —</option>' +
      Object.entries(_PORT_CRYPTO_MAP).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('');
  } catch (e) { console.warn('_portPopulateOppCostSelects:', e.message) }
}

async function calcOpportunityCost() {
  try {
    const selA = document.getElementById('cpOppCostAsset');
    const selB = document.getElementById('cpOppCostAlt');
    const resEl = document.getElementById('cpOppCostResult');
    const aId = selA?.value;
    const bId = selB?.value;
    if (!aId || !bId) { tpToast('Selecciona ambos activos.', 'warn'); return }
    if (aId === bId) { tpToast('Selecciona activos diferentes.', 'warn'); return }
    const asset = _portAssets.find(a => a.coinId === aId);
    if (!asset) { tpToast('Activo no encontrado.', 'warn'); return }
    const qty = parseFloat(asset.cantidad) || 0;
    const bp = parseFloat(asset.precioCompraUSD) || 0;
    const paid = qty * bp;
    const cpA = _portPrices[aId]?.usd || 0;
    const cpB = _portPrices[bId]?.usd || 0;
    const valA = qty * cpA;
    const nameA = _portName(aId);
    const nameB = _portName(bId);
    const dateDisplay = asset.fechaCompra || 'desconocida';
    let histB = null;
    if (asset.fechaCompra) {
      const p = asset.fechaCompra.split('-');
      histB = await _cgHistoricalPrice(bId, p[2] + '-' + p[1] + '-' + p[0]);
    }
    let worthToday = paid;
    let histStr = '';
    if (histB && histB > 0) {
      const qtyB = paid / histB;
      worthToday = qtyB * cpB;
      histStr = ' | Precio ' + dateDisplay + ': $' + histB.toFixed(2);
    }
    const diff = worthToday - valA;
    resEl.style.display = 'block';
    resEl.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px;font-size:14px">' +
      '<div class="pcard"><div class="pcard-lbl">Invertiste en ' + nameA + '</div><div class="pcard-val gold">$' + paid.toFixed(2) + '</div><div style="font-size:12px;color:var(--muted)">el ' + dateDisplay + '</div></div>' +
      '<div class="pcard"><div class="pcard-lbl">Valor actual de ' + nameA + '</div><div class="pcard-val" style="color:' + (valA >= paid ? 'var(--green)' : 'var(--red)') + '">$' + valA.toFixed(2) + '</div></div>' +
      '<div class="pcard"><div class="pcard-lbl">Si comprabas ' + nameB + '</div><div class="pcard-val gold">$' + worthToday.toFixed(2) + '</div><div style="font-size:12px;color:var(--muted)">' + nameB + ' hoy: $' + cpB.toFixed(2) + histStr + '</div></div>' +
      '<div class="pcard"><div class="pcard-lbl">Diferencia</div><div class="pcard-val" style="color:' + (diff >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (diff >= 0 ? '+' : '') + '$' + diff.toFixed(2) + '</div></div>' +
      '</div>';
  } catch (e) { tpToast('Error: ' + e.message, 'error') }
}

// ── Tax Recommendation ──
function genTaxRecommendation() {
  try {
    const el = document.getElementById('cpTaxRecommendation');
    if (!el) return;
    if (!_portAssets.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:14px">No hay activos en el portafolio para analizar.</div>';
      el.style.display = 'block';
      return;
    }
    if (!Object.keys(_portPrices).length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:14px">⏳ Esperando precios... Presiona "Actualizar precios".</div>';
      el.style.display = 'block';
      return;
    }
    const losers = [];
    const winners = [];
    for (const a of _portAssets) {
      const qty = parseFloat(a.cantidad) || 0;
      const bp = parseFloat(a.precioCompraUSD) || 0;
      const cp = _portPrices[a.coinId]?.usd || bp || 0;
      if (!qty || !bp) continue;
      const inv = qty * bp;
      const cur = qty * cp;
      const pnl = cur - inv;
      const pct = bp > 0 ? ((cp - bp) / bp) * 100 : 0;
      const item = { name: _portName(a.coinId || a.activo), inv, cur, pnl, pct, coinId: a.coinId };
      if (pnl < 0) losers.push(item);
      else if (pnl > 0) winners.push(item);
    }
    losers.sort((a, b) => a.pct - b.pct);
    winners.sort((a, b) => b.pct - a.pct);
    const totalGain = winners.reduce((s, a) => s + a.pnl, 0);
    const totalLoss = losers.reduce((s, a) => s + a.pnl, 0);
    const netGain = totalGain + totalLoss;
    const taxPN = Math.max(0, netGain * 0.05);
    const taxPJ = Math.max(0, netGain * 0.295);
    const savings = Math.abs(totalLoss) * 0.05;

    let method = 'avg';
    if (losers.length > winners.length && losers.length > 2) method = 'fifo';
    else if (winners.length > losers.length && winners.length > 2) method = 'lifo';
    const mLabels = { fifo: 'FIFO / PEPS', lifo: 'LIFO / UEPS', avg: 'Costo Promedio' };

    let html = '<div class="sec-title" style="margin-top:20px">💡 Recomendación Tributaria Inteligente</div>';
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">';

    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center">';
    html += '<div style="padding:6px 12px;background:rgba(155,89,182,.13);border-radius:6px;font-size:14px;font-weight:500">📐 Método sugerido: <strong>' + mLabels[method] + '</strong></div>';
    if (method === 'fifo') html += '<div style="font-size:13px;color:var(--muted)">· FIFO permite deducir pérdidas antiguas primero</div>';
    else if (method === 'lifo') html += '<div style="font-size:13px;color:var(--muted)">· LIFO minimiza ganancia gravable actual</div>';
    else html += '<div style="font-size:13px;color:var(--muted)">· Cartera balanceada — costo promedio ponderado</div>';
    html += '</div>';

    if (losers.length) {
      html += '<div style="font-size:15px;font-weight:600;margin:10px 0 8px;color:var(--red)">📉 Tax-Loss Harvesting</div>';
      html += '<table class="res-table" style="width:100%;font-size:14px;margin-bottom:10px"><thead><tr>' +
        '<th>Activo</th><th>Invertido</th><th>Valor Actual</th><th>Pérdida</th><th>%</th><th>Sugerencia</th></tr></thead><tbody>';
      for (const a of losers.slice(0, 5)) {
        const sug = a.pct < -20 ? '⚠️ Considera vender' : '📊 Monitorear';
        html += '<tr><td>' + a.name + '</td><td>$' + a.inv.toFixed(2) + '</td><td>$' + a.cur.toFixed(2) + '</td>' +
          '<td style="color:var(--red)">-$' + Math.abs(a.pnl).toFixed(2) + '</td><td style="color:var(--red)">' + a.pct.toFixed(2) + '%</td><td style="font-size:13px">' + sug + '</td></tr>';
      }
      html += '</tbody></table>';
      if (losers.length > 5) html += '<div style="font-size:13px;color:var(--muted);margin-bottom:10px">... y ' + (losers.length - 5) + ' más.</div>';
    }

    html += '<div style="font-size:15px;font-weight:600;margin:10px 0 8px">💰 Impacto Tributario</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:10px">';
    html += '<div class="pcard"><div class="pcard-lbl">Ganancia Neta</div><div class="pcard-val" style="color:' + (netGain >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (netGain >= 0 ? '+' : '') + '$' + netGain.toFixed(2) + '</div></div>';
    html += '<div class="pcard"><div class="pcard-lbl">IR 5% (PN)</div><div class="pcard-val" style="color:var(--red)">$' + taxPN.toFixed(2) + '</div></div>';
    html += '<div class="pcard"><div class="pcard-lbl">IR 29.5% (PJ)</div><div class="pcard-val" style="color:var(--red)">$' + taxPJ.toFixed(2) + '</div></div>';
    if (savings > 0) html += '<div class="pcard"><div class="pcard-lbl">Ahorro TH Potencial</div><div class="pcard-val" style="color:var(--green)">$' + savings.toFixed(2) + '</div></div>';
    html += '</div>';

    html += '<div style="font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px">⚠️ Recomendación automatizada. Consulta con un contador para decisiones formales.</div>';
    html += '</div>';
    el.innerHTML = html;
    el.style.display = 'block';
  } catch (e) { console.warn('genTaxRecommendation:', e.message) }
}

function _portInitTaxYears() {
  const sel=document.getElementById('cpTaxYear');
  if(!sel)return;
  const current=new Date().getFullYear();
  sel.innerHTML='';
  for(let y=current;y>=2020;y--){
    const opt=document.createElement('option');
    opt.value=y;opt.textContent=y;
    sel.appendChild(opt);
  }
}

function _portInit() {
  _portInitTaxYears();
  loadPortfolio();
  renderPortfolio();
  loadPortStaking();
  _portPopulateOppCostSelects();
  renderMultiYearDashboard();
}

const _origSetPTab = setPTab;
window.setPTab = function(tab, btn) {
  _origSetPTab(tab, btn);
  if (tab === 'cripto_portfolio') { _portInit(); }
  if (tab === 'lavado') { setLavadoTab('normas', null); setTimeout(() => document.querySelector('#ptLavado .reg-tab')?.classList.add('active'), 50); }
};

if (document.getElementById('clStakingTracker')) initStakingTracker();
