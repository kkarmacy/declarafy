// DeclaraFY hardened entrypoint.
// Loads all legacy exports, then overrides critical HTTP endpoints with safer versions.
const legacy = require('./index.js');
const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { defineSecret } = require('firebase-functions/params');
const cors = require('cors')({ origin: true });

const db = getFirestore();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const ANTHROPIC_MODEL = 'claude-sonnet-4-5';

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Auth required' });
    return null;
  }
  try {
    return await getAuth().verifyIdToken(authHeader.slice(7));
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

function sanitizePlan(plan) {
  return ['basico', 'profesional', 'empresa'].includes(plan) ? plan : 'basico';
}

async function checkRateLimitAtomic(uid, plan) {
  const now = Date.now();
  const minuteCutoff = now - 60_000;
  const hourCutoff = now - 3_600_000;
  const minLimit = plan === 'basico' ? 5 : 15;
  const hourLimit = plan === 'basico' ? 30 : 60;
  const ref = db.collection('rate_limits').doc(`user_${uid}`);

  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? (snap.data().timestamps || []) : [];
    const recentHour = previous.filter(t => Number.isFinite(t) && t > hourCutoff);
    const recentMinute = recentHour.filter(t => t > minuteCutoff);

    if (recentMinute.length >= minLimit) {
      return { status: 429, message: `Rate limit: ${minLimit} requests/minute.` };
    }
    if (recentHour.length >= hourLimit) {
      return { status: 429, message: `Rate limit: ${hourLimit} requests/hour.` };
    }

    tx.set(ref, { timestamps: [...recentHour, now], updatedAt: now }, { merge: true });
    return null;
  });
}

function validateClaudeBody(body) {
  if (!body || typeof body !== 'object') return 'Invalid request body';
  if (!Array.isArray(body.messages) || body.messages.length === 0) return 'messages must be a non-empty array';
  if (body.messages.length > 50) return 'Too many messages';
  const maxTokens = Number(body.max_tokens || 1024);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) return 'max_tokens out of range';
  const serialized = JSON.stringify(body.messages);
  if (serialized.length > 200_000) return 'Request too large';
  return null;
}

legacy.claudeProxy = onRequest({
  secrets: [ANTHROPIC_API_KEY],
  timeoutSeconds: 120,
  memory: '512MiB'
}, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const decoded = await requireUser(req, res);
    if (!decoded) return;

    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const plan = sanitizePlan(userDoc.exists ? userDoc.data().plan : 'basico');

    const validationError = validateClaudeBody(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const rl = await checkRateLimitAtomic(decoded.uid, plan);
    if (rl) {
      res.status(rl.status).json({ error: rl.message });
      return;
    }

    try {
      const body = req.body;
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: Number(body.max_tokens || 1024),
          stream: Boolean(body.stream),
          system: typeof body.system === 'string' ? body.system.slice(0, 20_000) : undefined,
          messages: body.messages
        })
      });

      if (!upstream.ok) {
        const details = await upstream.text().catch(() => '');
        console.error('Anthropic upstream error', upstream.status, details.slice(0, 500));
        res.status(502).json({ error: 'AI provider error' });
        return;
      }

      if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      } else {
        const data = await upstream.json();
        await db.collection('users').doc(decoded.uid).set({
          mc: (userDoc.exists ? Number(userDoc.data().mc || 0) : 0) + 1
        }, { merge: true });
        res.json(data);
      }
    } catch (e) {
      console.error('claudeProxy error', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
});

function isValidRuc(value) {
  return /^\d{11}$/.test(String(value || ''));
}

legacy.validarComprobante = onRequest({ timeoutSeconds: 15 }, async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }

    const decoded = await requireUser(req, res);
    if (!decoded) return;

    const { rucEmisor, tipoComprobante, serie, numero, fechaEmision, monto } = req.body || {};
    if (!isValidRuc(rucEmisor) || !tipoComprobante || !serie || !numero || !fechaEmision) {
      res.status(400).json({ error: 'Datos del comprobante inválidos o incompletos' });
      return;
    }

    const params = new URLSearchParams({
      ruc: String(rucEmisor),
      tipo: String(tipoComprobante).slice(0, 10),
      serie: String(serie).slice(0, 20),
      numero: String(numero).slice(0, 30),
      fecha: String(fechaEmision).slice(0, 20),
      monto: monto == null ? '' : String(monto).slice(0, 30)
    });

    try {
      const response = await fetch(`https://api.apis.net.pe/v2/sunat/cpe/validar?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });

      if (response.ok) {
        const data = await response.json();
        const valido = data.estado_cpe === '1' || data.valido === true || data.estado === 'ACEPTADO';
        res.json({
          ok: true,
          verificado: true,
          success: valido,
          valido,
          estado_cpe: data.estado_cpe || data.estado || 'desconocido',
          mensaje: data.mensaje || data.message || `Estado: ${data.estado || 'N/A'}`,
          data
        });
        return;
      }

      // A RUC lookup is contextual information only; it never validates a specific CPE.
      let rucActivo = null;
      try {
        const rucResponse = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${encodeURIComponent(rucEmisor)}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000)
        });
        if (rucResponse.ok) {
          const rucData = await rucResponse.json();
          rucActivo = rucData.estado === 'ACTIVO';
        }
      } catch (_) {}

      res.status(502).json({
        ok: false,
        verificado: false,
        success: null,
        valido: null,
        estado_cpe: 'no_verificado',
        rucActivo,
        mensaje: 'No fue posible validar el comprobante con la fuente CPE. El estado del RUC no prueba que el comprobante exista o sea válido.'
      });
    } catch (e) {
      console.error('validarComprobante error', e);
      res.status(502).json({
        ok: false,
        verificado: false,
        success: null,
        valido: null,
        estado_cpe: 'no_verificado',
        mensaje: 'No fue posible validar el comprobante en este momento.'
      });
    }
  });
});

module.exports = legacy;
