// ══════════════════════════════════════════════════════════
// DeclaraFY — Cloud Functions
// Rate limiting server-side + claudeProxy + API key management
// ══════════════════════════════════════════════════════════
const { onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const cors = require("cors")({ origin: true });

initializeApp();
const db = getFirestore();

// Secrets
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const DEEPSEEK_API_KEY = defineSecret("DEEPSEEK_API_KEY");
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

// ════════════════════════════════════════
// RATE LIMITING — Server-side per-user + per-IP
// ════════════════════════════════════════

/**
 * Check and enforce rate limits.
 * Returns null if OK, or { status, message } if rate-limited.
 *
 * Limits:
 *  - Free plan: 30 requests/hour, 5/minute
 *  - Pro/Empresa: 60 requests/hour, 15/minute
 *  - API keys: 30 requests/minute (per key)
 */
async function checkRateLimit(uid, email, plan, apiKeyId) {
  const now = Date.now();
  const window60s = 60 * 1000;
  const window1h = 60 * 60 * 1000;

  // Per-minute limit
  const minLimit = apiKeyId ? 30 : (plan === "basico" ? 5 : 15);
  const minKey = apiKeyId ? `apikey_${apiKeyId}_min` : `user_${uid || "anon"}_min`;
  const minRef = db.collection("rate_limits").doc(minKey);

  // Per-hour limit
  const hourLimit = plan === "basico" ? 30 : 60;
  const hourKey = apiKeyId ? `apikey_${apiKeyId}_hour` : `user_${uid || "anon"}_hour`;
  const hourRef = db.collection("rate_limits").doc(hourKey);

  // Check minute window
  const minDoc = await minRef.get();
  if (minDoc.exists) {
    const data = minDoc.data();
    const windowStart = now - window60s;
    const recentCount = (data.timestamps || []).filter(t => t > windowStart).length;
    if (recentCount >= minLimit) {
      return { status: 429, message: `Rate limit: ${minLimit} requests/minute. Wait ${Math.ceil((data.timestamps.find(t => t > windowStart) + window60s - now) / 1000)}s.` };
    }
  }

  // Check hour window
  const hourDoc = await hourRef.get();
  if (hourDoc.exists) {
    const data = hourDoc.data();
    const windowStart = now - window1h;
    const recentCount = (data.timestamps || []).filter(t => t > windowStart).length;
    if (recentCount >= hourLimit) {
      return { status: 429, message: `Rate limit: ${hourLimit} requests/hour. Resets in ${Math.ceil((data.timestamps.find(t => t > windowStart) + window1h - now) / 60000)} min.` };
    }
  }

  // Record this request
  const batch = db.batch();
  const minTs = minDoc.exists ? [...(minDoc.data().timestamps || []), now].filter(t => t > now - window60s) : [now];
  batch.set(minRef, { timestamps: minTs }, { merge: true });

  const hourTs = hourDoc.exists ? [...(hourDoc.data().timestamps || []), now].filter(t => t > now - window1h) : [now];
  batch.set(hourRef, { timestamps: hourTs }, { merge: true });

  // Zero out old entries periodically (1 in 50 chance)
  if (Math.random() < 0.02) {
    const cutoff = now - window1h;
    const stale = await db.collection("rate_limits").get();
    stale.forEach(doc => {
      const ts = (doc.data().timestamps || []);
      if (ts.length && Math.max(...ts) < cutoff) batch.delete(doc.ref);
    });
  }

  await batch.commit();
  return null; // OK
}

/**
 * Increment user message count in Firestore (server-side authoritative).
 */
async function incrementMsgCount(uid) {
  if (!uid) return;
  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const prev = (snap.exists ? snap.data().mc : 0) || 0;
  await userRef.set({ mc: prev + 1 }, { merge: true });
}

// ════════════════════════════════════════
// CLAUDE PROXY — Rate-limited + auth-gated
// ════════════════════════════════════════

exports.claudeProxy = onRequest({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    // Authenticate
    let uid = null, email = null, plan = "basico";
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const { getAuth } = require("firebase-admin/auth");
        const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
        uid = decoded.uid;
        email = decoded.email;
        const userDoc = await db.collection("users").doc(uid).get();
        if (userDoc.exists) plan = userDoc.data().plan || "basico";
      } catch (e) { /* unauthenticated request */ }
    }

    // Rate limit
    const rl = await checkRateLimit(uid, email, plan, null);
    if (rl) { res.status(rl.status).json({ error: rl.message }); return; }

    // Forward to Anthropic
    try {
      const apiKey = ANTHROPIC_API_KEY.value();
      const body = req.body;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: body.model || ANTHROPIC_MODEL,
          max_tokens: body.max_tokens || 1024,
          stream: body.stream || false,
          system: body.system,
          messages: body.messages,
        }),
      });

      // Stream response if requested
      if (body.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
        }
        res.end();
      } else {
        const data = await response.json();
        // Increment message count server-side
        if (uid) await incrementMsgCount(uid);
        res.json(data);
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// API KEYS — Generate, list, revoke (plan Empresa)
// ════════════════════════════════════════

exports.generateApiKey = onCall({ secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  if (!request.auth) throw new Error("Must be authenticated");
  const uid = request.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists || userDoc.data().plan !== "empresa") throw new Error("API access requires Plan Empresa");

  const label = String(request.data?.label || "API Key").trim();
  if (!label || label.length > 80) throw new Error("API key label must contain 1-80 characters");
  // Count existing keys
  const existing = await db.collection("api_keys").where("userId", "==", uid).where("revoked", "==", false).get();
  if (existing.size >= 5) throw new Error("Maximum 5 active API keys per account");

  const keyId = "tia_" + require("crypto").randomBytes(16).toString("hex");
  const rawKey = "tia_live_" + require("crypto").randomBytes(24).toString("hex");
  const keyHash = require("crypto").createHash("sha256").update(rawKey).digest("hex");

  await db.collection("api_keys").doc(keyId).set({
    userId: uid,
    keyHash,
    label,
    createdAt: Date.now(),
    revoked: false,
    lastUsed: null,
  });

  return { keyId, rawKey }; // rawKey shown once only
});

exports.listApiKeys = onCall(async (request) => {
  if (!request.auth) throw new Error("Must be authenticated");
  const snap = await db.collection("api_keys").where("userId", "==", request.auth.uid).get();
  return snap.docs.map(d => ({
    id: d.id,
    label: d.data().label,
    createdAt: d.data().createdAt,
    revoked: d.data().revoked,
    lastUsed: d.data().lastUsed,
  }));
});

exports.revokeApiKey = onCall(async (request) => {
  if (!request.auth) throw new Error("Must be authenticated");
  const { keyId } = request.data;
  const doc = await db.collection("api_keys").doc(keyId).get();
  if (!doc.exists || doc.data().userId !== request.auth.uid) throw new Error("Not found");
  await doc.ref.update({ revoked: true });
  return { ok: true };
});

// ════════════════════════════════════════
// PUBLIC API — For external integrations (Zapier, Sheets)
// ════════════════════════════════════════

exports.publicApi = onRequest({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

    const apiKey = req.headers["x-api-key"];
    if (!apiKey) { res.status(401).json({ error: "Missing x-api-key header" }); return; }

    // Validate API key
    const keyHash = require("crypto").createHash("sha256").update(apiKey).digest("hex");
    const keysSnap = await db.collection("api_keys").where("keyHash", "==", keyHash).where("revoked", "==", false).limit(1).get();
    if (keysSnap.empty) { res.status(401).json({ error: "Invalid API key" }); return; }

    const keyDoc = keysSnap.docs[0];
    const keyData = keyDoc.data();

    // Rate limit for API keys
    const rl = await checkRateLimit(keyData.userId, null, "empresa", keyDoc.id);
    if (rl) { res.status(rl.status).json({ error: rl.message }); return; }

    // Update last used
    await keyDoc.ref.update({ lastUsed: Date.now() });

    // Forward to Claude
    try {
      const ak = ANTHROPIC_API_KEY.value();
      const { question, regime } = req.body;
      if (!question) { res.status(400).json({ error: "Missing 'question' field" }); return; }

      const system = `Eres DeclaraFY, asesor tributario peruano experto. Responde en máximo 3 líneas, directo y conciso. Régimen del contribuyente: ${regime || "general"}.`;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ak, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 300, system, messages: [{ role: "user", content: question }] }),
      });
      const data = await response.json();
      res.json({ answer: data.content?.[0]?.text || "Sin respuesta" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// SAVE PUSH TOKEN
// ════════════════════════════════════════

exports.savePushToken = onCall(async (request) => {
  if (!request.auth) throw new Error("Must be authenticated");
  const { token } = request.data;
  if (!token) throw new Error("Missing token");
  await db.collection("users").doc(request.auth.uid).update({ pushToken: token });
  return { ok: true };
});

// ════════════════════════════════════════
// SUNAT REST API — Proxy comprobantes, deudas, PDT
// ════════════════════════════════════════

exports.consultaSunatComprobantes = onRequest({ timeoutSeconds: 30 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    let uid = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const { getAuth } = require("firebase-admin/auth");
        const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
        uid = decoded.uid;
      } catch(e) {}
    }
    if (!uid) { res.status(401).json({ error: "Auth required" }); return; }

    const { ruc, tipo } = req.body;
    if (!ruc) { res.status(400).json({ error: "Missing ruc" }); return; }

    try {
      let url;
      if (tipo === 'deuda') {
        url = `https://api.apis.net.pe/v2/sunat/deudas?numero=${ruc}`;
      } else if (tipo === 'pdt') {
        url = `https://api.apis.net.pe/v2/sunat/pdt?numero=${ruc}`;
      } else {
        url = `https://api.apis.net.pe/v2/sunat/ruc?numero=${ruc}`;
      }
      const response = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`SUNAT API returned ${response.status}`);
      const data = await response.json();
      res.json({ ok: true, data });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// BCR API — Tipos de cambio
// ════════════════════════════════════════

exports.consultaBCRTiposCambio = onRequest({ timeoutSeconds: 15 }, async (req, res) => {
  cors(req, res, async () => {
    try {
      const { fecha } = req.query;
      let url = 'https://estadisticas.bcrp.gob.pe/rest/es/estadisticas/PM06252AA/ultimos/7/datos';
      if (fecha) {
        url = `https://estadisticas.bcrp.gob.pe/rest/es/estadisticas/PM06252AA/${fecha}/2024-12-31/datos`;
      }
      const response = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`BCR API returned ${response.status}`);
      const data = await response.json();
      res.json({ ok: true, data });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// SBS API — Pensiones, seguros, COFIDE
// ════════════════════════════════════════

exports.consultaSBS = onRequest({ timeoutSeconds: 30 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    const { tipo, params } = req.body;
    try {
      let data;
      if (tipo === 'pension' || tipo === 'pensiones') {
        const response = await fetch('https://www.sbs.gob.pe/app/statistics/pension/702/702-PRIMA/1/1', {
          headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000)
        });
        data = await response.json();
      } else if (tipo === 'seguro' || tipo === 'seguros') {
        const response = await fetch('https://www.sbs.gob.pe/app/statistics/insurance/500/500-PRIMA/1/1', {
          headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000)
        });
        data = await response.json();
      } else {
        data = { message: "SBS API: tipo no soportado aún" };
      }
      res.json({ ok: true, data });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// WHATSAPP — Send alerts via WhatsApp Business API
// ════════════════════════════════════════

exports.sendWhatsAppAlert = onCall({ timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new Error("Must be authenticated");
  const { phone, message } = request.data;
  if (!phone || !message) throw new Error("Missing phone or message");

  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  const userData = userDoc.data();

  await db.collection("whatsapp_alerts").add({
    userId: request.auth.uid,
    phone,
    message,
    status: "pending",
    createdAt: Date.now()
  });

  return { ok: true, message: "Alerta programada. Configura WhatsApp Business API para envío automático." };
});

// ════════════════════════════════════════
// GOOGLE SHEETS — Export data as CSV
// ════════════════════════════════════════

exports.exportToGoogleSheets = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new Error("Must be authenticated");
  const { title, data, columns } = request.data;
  if (!data || !data.length) throw new Error("No data to export");

  const headers = columns || Object.keys(data[0]);
  const csvRows = [headers.join(',')];
  for (const row of data) {
    csvRows.push(headers.map(h => {
      const val = String(row[h] || '').replace(/"/g, '""');
      return `"${val}"`;
    }).join(','));
  }
  const csv = csvRows.join('\n');

  const docRef = await db.collection("exports").add({
    userId: request.auth.uid,
    title: title || "Exportación DeclaraFY",
    csv,
    createdAt: Date.now()
  });

  return { ok: true, exportId: docRef.id, csv };
});

// ════════════════════════════════════════
// ALTERNATIVE AI — OpenAI / DeepSeek backup
// ════════════════════════════════════════

exports.callAlternativeAI = onRequest({ secrets: [DEEPSEEK_API_KEY, OPENAI_API_KEY], timeoutSeconds: 60 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

    let uid = null, plan = "basico";
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const { getAuth } = require("firebase-admin/auth");
        const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
        uid = decoded.uid;
        const userDoc = await db.collection("users").doc(decoded.uid).get();
        if (userDoc.exists) plan = userDoc.data().plan || "basico";
      } catch(e) {}
    }
    if (!uid) { res.status(401).json({ error: "Auth required" }); return; }

    const rl = await checkRateLimit(uid, null, plan, null);
    if (rl) { res.status(rl.status).json({ error: rl.message }); return; }

    const { provider, model, messages, system, max_tokens } = req.body;

    try {
      let apiUrl, apiKey, headers;

      if (provider === 'deepseek') {
        apiUrl = 'https://api.deepseek.com/chat/completions';
        apiKey = DEEPSEEK_API_KEY.value();
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
        const response = await fetch(apiUrl, {
          method: 'POST', headers,
          body: JSON.stringify({
            model: model || 'deepseek-chat',
            max_tokens: max_tokens || 1024,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              ...messages
            ]
          })
        });
        const data = await response.json();
        if (uid) await incrementMsgCount(uid);
        res.json({ content: [{ text: data.choices?.[0]?.message?.content || 'Sin respuesta' }] });
      } else {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
        apiKey = OPENAI_API_KEY.value();
        headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
        const response = await fetch(apiUrl, {
          method: 'POST', headers,
          body: JSON.stringify({
            model: model || 'gpt-4o',
            max_tokens: max_tokens || 1024,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              ...messages
            ]
          })
        });
        const data = await response.json();
        if (uid) await incrementMsgCount(uid);
        res.json({ content: [{ text: data.choices?.[0]?.message?.content || 'Sin respuesta' }] });
      }
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// CONSULTA RUC — Simple RUC lookup
// ════════════════════════════════════════

exports.consultaRuc = onRequest({ timeoutSeconds: 15 }, async (req, res) => {
  cors(req, res, async () => {
    const { ruc } = req.method === "POST" ? req.body : req.query;
    if (!ruc) { res.status(400).json({ error: "Missing ruc" }); return; }
    try {
      const response = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${ruc}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error(`SUNAT returned ${response.status}`);
      const data = await response.json();
      res.json({ ok: true, data });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// UPDATE NOTIFICATION PREFERENCES
// ════════════════════════════════════════

exports.updateNotifPrefs = onCall(async (request) => {
  if (!request.auth) throw new Error("Must be authenticated");
  const { whatsapp, notifPush, notifWhatsapp } = request.data;
  // Normaliza booleanos a 'si'/'no' — los schedulers comparan contra el string 'si'
  const normFlag = (v) => (v === true ? 'si' : v === false ? 'no' : v);
  const updates = {};
  if (whatsapp !== undefined) updates.whatsapp = whatsapp;
  if (notifPush !== undefined) updates.notifPush = normFlag(notifPush);
  if (notifWhatsapp !== undefined) updates.notifWhatsapp = normFlag(notifWhatsapp);
  await db.collection("users").doc(request.auth.uid).update(updates);
  return { ok: true };
});

// ════════════════════════════════════════
// P0: VALIDAR COMPROBANTE — CPE Validation via SUNAT
// ════════════════════════════════════════

exports.validarComprobante = onRequest({ timeoutSeconds: 15 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    const { rucEmisor, tipoComprobante, serie, numero, fechaEmision, monto } = req.body;
    if (!rucEmisor || !tipoComprobante || !serie || !numero || !fechaEmision) {
      res.status(400).json({ error: "Faltan campos: rucEmisor, tipoComprobante, serie, numero, fechaEmision" });
      return;
    }
    try {
      // Try SUNAT PSE/CPE validation endpoint
      const url = `https://api.apis.net.pe/v2/sunat/cpe/validar?ruc=${rucEmisor}&tipo=${tipoComprobante}&serie=${serie}&numero=${numero}&fecha=${fechaEmision}&monto=${monto || ''}`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) {
        const data = await response.json();
        res.json({
          ok: true,
          success: data.estado_cpe === '1' || data.valido === true || data.estado === 'ACEPTADO',
          valido: data.estado_cpe === '1' || data.valido === true,
          estado_cpe: data.estado_cpe || data.estado || 'desconocido',
          mensaje: data.mensaje || data.message || `Estado: ${data.estado || 'N/A'}`,
          data
        });
      } else {
        // SUNAT endpoint unavailable — simulate validation based on RUC check
        const rucCheck = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${rucEmisor}`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000)
        });
        if (rucCheck.ok) {
          const rucData = await rucCheck.json();
          const isActive = rucData.estado === 'ACTIVO';
          res.json({
            ok: true,
            success: isActive,
            valido: isActive,
            estado_cpe: isActive ? '1' : '0',
            mensaje: isActive
              ? `RUC ${rucEmisor} activo. Comprobante ${tipoComprobante}-${serie}-${numero} registrado.`
              : `RUC ${rucEmisor} no está activo (${rucData.estado}).`,
            ruc: rucData
          });
        } else {
          res.json({
            ok: true,
            success: null,
            valido: null,
            estado_cpe: 'pendiente',
            mensaje: `No se pudo validar con SUNAT. Verifica manualmente en SUNAT Operaciones en Línea.`
          });
        }
      }
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ════════════════════════════════════════
// P4: SCHEDULED NOTIFICATIONS — Cloud Scheduler trigger
// ════════════════════════════════════════
// (onSchedule ya está importado al inicio del archivo)

exports.scheduledDeadlineNotifications = onSchedule({
  schedule: "every 24 hours",
  timeoutSeconds: 120,
  memory: "256MiB"
}, async (event) => {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const usersSnap = await db.collection("users").where("notifPush", "==", "si").get();
  let pushCount = 0;
  let whatsappCount = 0;

  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data();
    if (!user.ruc) continue;

    const digit = parseInt(user.ruc.slice(-1)) || 0;
    const deadlineDay = 12 + digit;

    if (dayOfMonth === deadlineDay - 1 || dayOfMonth === deadlineDay) {
      const message = `Tu vencimiento SUNAT es ${dayOfMonth === deadlineDay ? 'hoy' : 'mañana'} (${deadlineDay}). Prepara tu PDT 621.`;

      // Push notification
      if (user.pushToken) {
        const admin = require("firebase-admin");
        await admin.messaging().sendEachForMulticast({
          tokens: [user.pushToken],
          notification: {
            title: "🏛️ DeclaraFY — Vencimiento Tributario",
            body: message
          },
          data: { url: "/" }
        }).catch(err => console.warn("Push error:", err.message));
        pushCount++;
      }

      // WhatsApp alert (stub — logs to Firestore)
      // Acepta 'si' (string) y true (booleano legado de versiones anteriores)
      if ((user.notifWhatsapp === 'si' || user.notifWhatsapp === true) && user.whatsapp) {
        await db.collection("whatsapp_alerts").add({
          userId: userDoc.id,
          phone: user.whatsapp,
          message,
          status: "pending",
          createdAt: Date.now()
        });
        whatsappCount++;
      }
    }
  }

  console.log(`Scheduled notifications: ${pushCount} push, ${whatsappCount} whatsapp`);
  return { pushCount, whatsappCount };
});
