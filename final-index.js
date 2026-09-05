// Final DeclaraFY Cloud Functions entrypoint.
// Extends the hardened exports with strict validation for remaining auxiliary endpoints.
const hardened = require('./secure-index.js');
const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });

const db = getFirestore();
const DEEPSEEK_API_KEY = defineSecret('DEEPSEEK_API_KEY');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Auth required' });
    return null;
  }
  try {
    return await getAuth().verifyIdToken(authHeader.slice(7));
  } catch (_) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

function isValidRuc(value) {
  return /^\d{11}$/.test(String(value || ''));
}

async function rateLimit(uid, scope, perMinute = 15, perHour = 60) {
  const now = Date.now();
  const minuteCutoff = now - 60_000;
  const hourCutoff = now - 3_600_000;
  const ref = db.collection('rate_limits').doc(`${scope}_${uid}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? (snap.data().timestamps || []) : [];
    const hour = previous.filter(t => Number.isFinite(t) && t > hourCutoff);
    const minute = hour.filter(t => t > minuteCutoff);
    if (minute.length >= perMinute || hour.length >= perHour) return false;
    tx.set(ref, { timestamps: [...hour, now], updatedAt: now }, { merge: true });
    return true;
  });
}

hardened.consultaSunatComprobantes = onRequest({ timeoutSeconds: 30 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }
    const decoded = await requireUser(req, res);
    if (!decoded) return;
    const { ruc, tipo } = req.body || {};
    if (!isValidRuc(ruc)) {
      res.status(400).json({ error: 'RUC inválido' });
      return;
    }
    const normalizedTipo = String(tipo || 'ruc').toLowerCase();
    if (!['ruc', 'deuda', 'pdt'].includes(normalizedTipo)) {
      res.status(400).json({ error: 'Tipo de consulta no soportado' });
      return;
    }
    if (!(await rateLimit(decoded.uid, 'sunat_aux', 10, 60))) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }
    try {
      const endpoint = normalizedTipo === 'deuda' ? 'deudas' : normalizedTipo === 'pdt' ? 'pdt' : 'ruc';
      const response = await fetch(`https://api.apis.net.pe/v2/sunat/${endpoint}?numero=${encodeURIComponent(ruc)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        res.status(502).json({ error: 'SUNAT provider error' });
        return;
      }
      res.json({ ok: true, data: await response.json() });
    } catch (e) {
      console.error('consultaSunatComprobantes error', e);
      res.status(502).json({ error: 'No fue posible completar la consulta SUNAT' });
    }
  });
});

hardened.consultaSBS = onRequest({ timeoutSeconds: 30 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }
    const decoded = await requireUser(req, res);
    if (!decoded) return;
    const tipo = String(req.body?.tipo || '').toLowerCase();
    if (!['pension', 'pensiones', 'seguro', 'seguros'].includes(tipo)) {
      res.status(400).json({ error: 'Tipo SBS no soportado' });
      return;
    }
    if (!(await rateLimit(decoded.uid, 'sbs_aux', 10, 60))) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }
    const url = (tipo === 'pension' || tipo === 'pensiones')
      ? 'https://www.sbs.gob.pe/app/statistics/pension/702/702-PRIMA/1/1'
      : 'https://www.sbs.gob.pe/app/statistics/insurance/500/500-PRIMA/1/1';
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        res.status(502).json({ error: 'SBS provider error' });
        return;
      }
      res.json({ ok: true, data: await response.json() });
    } catch (e) {
      console.error('consultaSBS error', e);
      res.status(502).json({ error: 'No fue posible completar la consulta SBS' });
    }
  });
});

function validateAiPayload(body) {
  if (!body || typeof body !== 'object') return 'Invalid request body';
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 50) return 'Invalid messages';
  const serialized = JSON.stringify(body.messages);
  if (serialized.length > 200_000) return 'Request too large';
  const maxTokens = Number(body.max_tokens || 1024);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) return 'max_tokens out of range';
  if (body.system != null && typeof body.system !== 'string') return 'system must be text';
  if (typeof body.system === 'string' && body.system.length > 20_000) return 'system too large';
  const validMessages = body.messages.every(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 50_000);
  if (!validMessages) return 'Invalid message format';
  return null;
}

hardened.callAlternativeAI = onRequest({
  secrets: [DEEPSEEK_API_KEY, OPENAI_API_KEY],
  timeoutSeconds: 60
}, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }
    const decoded = await requireUser(req, res);
    if (!decoded) return;

    // The UI already hides alternative providers from Plan Básico, but that is
    // not a security boundary. Enforce the entitlement from Firestore here.
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const plan = userDoc.exists ? String(userDoc.data().plan || 'basico') : 'basico';
    if (!['profesional', 'empresa'].includes(plan)) {
      res.status(403).json({ error: 'Plan Profesional or Empresa required' });
      return;
    }

    const validationError = validateAiPayload(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    if (!(await rateLimit(decoded.uid, 'alternative_ai', 10, 40))) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    const provider = String(req.body.provider || 'openai').toLowerCase();
    const allowedModels = {
      openai: new Set(['gpt-4o', 'gpt-4o-mini']),
      deepseek: new Set(['deepseek-chat', 'deepseek-reasoner'])
    };
    if (!allowedModels[provider]) {
      res.status(400).json({ error: 'Unsupported AI provider' });
      return;
    }
    const requestedModel = String(req.body.model || '');
    const model = requestedModel && allowedModels[provider].has(requestedModel)
      ? requestedModel
      : (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');

    try {
      const maxTokens = Number(req.body.max_tokens || 1024);
      const messages = [
        ...(req.body.system ? [{ role: 'system', content: req.body.system }] : []),
        ...req.body.messages
      ];
      const isDeepseek = provider === 'deepseek';
      const response = await fetch(
        isDeepseek ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${isDeepseek ? DEEPSEEK_API_KEY.value() : OPENAI_API_KEY.value()}`
          },
          body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
          signal: AbortSignal.timeout(45_000)
        }
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error('Alternative AI upstream error', provider, response.status, detail.slice(0, 500));
        res.status(502).json({ error: 'AI provider error' });
        return;
      }
      const data = await response.json();
      await db.collection('users').doc(decoded.uid).set({
        mc: require('firebase-admin/firestore').FieldValue.increment(1)
      }, { merge: true });
      res.json({ content: [{ text: data.choices?.[0]?.message?.content || 'Sin respuesta' }] });
    } catch (e) {
      console.error('callAlternativeAI error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

module.exports = hardened;
