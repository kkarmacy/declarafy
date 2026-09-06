// DeclaraFY hardened entrypoint.
// Loads legacy exports, then overrides security-sensitive functions.
const legacy = require('./index.js');
const { onRequest, onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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
  } catch (_) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

function sanitizePlan(plan) {
  return ['basico', 'profesional', 'empresa'].includes(plan) ? plan : 'basico';
}

async function getUserPlan(uid) {
  const snap = await db.collection('users').doc(uid).get();
  return {
    snap,
    plan: sanitizePlan(snap.exists ? snap.data().plan : 'basico')
  };
}

async function checkRateLimitAtomic(uid, plan, scope = 'ai') {
  const now = Date.now();
  const minuteCutoff = now - 60_000;
  const hourCutoff = now - 3_600_000;
  const minLimit = plan === 'basico' ? 5 : 15;
  const hourLimit = plan === 'basico' ? 30 : 60;
  const ref = db.collection('rate_limits').doc(`${scope}_${uid}`);

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

async function checkSimpleHourlyLimit(uid, scope, limit) {
  const now = Date.now();
  const cutoff = now - 3_600_000;
  const ref = db.collection('rate_limits').doc(`${scope}_${uid}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? (snap.data().timestamps || []) : [];
    const recent = previous.filter(t => Number.isFinite(t) && t > cutoff);
    if (recent.length >= limit) return false;
    tx.set(ref, { timestamps: [...recent, now], updatedAt: now }, { merge: true });
    return true;
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

    const { snap: userDoc, plan } = await getUserPlan(decoded.uid);
    const validationError = validateClaudeBody(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const rl = await checkRateLimitAtomic(decoded.uid, plan, 'ai');
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
        await db.collection('users').doc(decoded.uid).set({ mc: FieldValue.increment(1) }, { merge: true });
        res.end();
      } else {
        const data = await upstream.json();
        await db.collection('users').doc(decoded.uid).set({ mc: FieldValue.increment(1) }, { merge: true });
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

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}
function isCpeDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || ''));
  if (!match) return false;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
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
    const normalizedTipo = String(tipoComprobante || '');
    const normalizedSerie = String(serie || '').trim().toUpperCase();
    const normalizedNumero = String(numero || '').trim();
    const normalizedMonto = Number(monto);
    if (!isValidRuc(rucEmisor)
      || !/^\d{2}$/.test(normalizedTipo)
      || !/^[A-Z0-9-]{1,20}$/.test(normalizedSerie)
      || !/^\d{1,20}$/.test(normalizedNumero)
      || !isCpeDate(fechaEmision)
      || monto == null || monto === ''
      || !Number.isFinite(normalizedMonto) || normalizedMonto < 0) {
      res.status(400).json({ error: 'Datos del comprobante inválidos o incompletos' });
      return;
    }
    if (!(await checkSimpleHourlyLimit(decoded.uid, 'cpe_validation', 30))) {
      res.status(429).json({ error: 'Límite horario de validaciones excedido' });
      return;
    }


    const params = new URLSearchParams({
      ruc: String(rucEmisor),
      tipo: normalizedTipo,
      serie: normalizedSerie,
      numero: normalizedNumero,
      fecha: String(fechaEmision),
      monto: normalizedMonto.toFixed(2)
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

legacy.consultaRuc = onRequest({ timeoutSeconds: 15 }, async (req, res) => {
  cors(req, res, async () => {
    const decoded = await requireUser(req, res);
    if (!decoded) return;
    const ruc = req.method === 'POST' ? req.body?.ruc : req.query?.ruc;
    if (!isValidRuc(ruc)) {
      res.status(400).json({ error: 'RUC inválido' });
      return;
    }
    try {
      const response = await fetch(`https://api.apis.net.pe/v2/sunat/ruc?numero=${encodeURIComponent(ruc)}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        res.status(502).json({ error: 'SUNAT provider error' });
        return;
      }
      res.json({ ok: true, data: await response.json() });
    } catch (e) {
      console.error('consultaRuc error', e);
      res.status(502).json({ error: 'No fue posible consultar el RUC' });
    }
  });
});

legacy.consultaBCRTiposCambio = onRequest({ timeoutSeconds: 15 }, async (req, res) => {
  cors(req, res, async () => {
    const decoded = await requireUser(req, res);
    if (!decoded) return;
    const fecha = req.query?.fecha;
    if (fecha && !isIsoDate(fecha)) {
      res.status(400).json({ error: 'fecha debe usar formato YYYY-MM-DD' });
      return;
    }
    try {
      let url = 'https://estadisticas.bcrp.gob.pe/rest/es/estadisticas/PM06252AA/ultimos/7/datos';
      if (fecha) url = `https://estadisticas.bcrp.gob.pe/rest/es/estadisticas/PM06252AA/${encodeURIComponent(fecha)}/${encodeURIComponent(fecha)}/datos`;
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) {
        res.status(502).json({ error: 'BCR provider error' });
        return;
      }
      res.json({ ok: true, data: await response.json() });
    } catch (e) {
      console.error('consultaBCRTiposCambio error', e);
      res.status(502).json({ error: 'No fue posible consultar BCRP' });
    }
  });
});

legacy.sendWhatsAppAlert = onCall({ timeoutSeconds: 30 }, async request => {
  if (!request.auth) throw new Error('Must be authenticated');
  const uid = request.auth.uid;
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new Error('User profile not found');

  const configuredPhone = String(userDoc.data().whatsapp || '').replace(/[^\d+]/g, '');
  const requestedPhone = String(request.data?.phone || '').replace(/[^\d+]/g, '');
  const message = String(request.data?.message || '').trim();
  if (!configuredPhone || requestedPhone !== configuredPhone) throw new Error('WhatsApp destination must match the saved user number');
  if (!/^\+?\d{8,15}$/.test(configuredPhone)) throw new Error('Invalid WhatsApp number');
  if (!message || message.length > 1000) throw new Error('Message must contain 1-1000 characters');

  const allowed = await checkSimpleHourlyLimit(uid, 'whatsapp', 5);
  if (!allowed) throw new Error('WhatsApp hourly limit exceeded');

  await db.collection('whatsapp_alerts').add({
    userId: uid,
    phone: configuredPhone,
    message,
    status: 'pending',
    createdAt: Date.now()
  });
  return { ok: true, message: 'Alerta programada.' };
});

function csvCell(value) {
  let val = String(value ?? '');
  // Prevent spreadsheet formula execution when CSV is opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(val)) val = `'${val}`;
  return `"${val.replace(/"/g, '""')}"`;
}

legacy.exportToGoogleSheets = onCall({ timeoutSeconds: 60 }, async request => {
  if (!request.auth) throw new Error('Must be authenticated');
  const { title, data, columns } = request.data || {};
  if (!Array.isArray(data) || data.length === 0) throw new Error('No data to export');
  if (data.length > 5000) throw new Error('Maximum 5000 rows per export');
  if (!data.every(row => row && typeof row === 'object' && !Array.isArray(row))) throw new Error('Invalid row format');

  const headers = Array.isArray(columns) && columns.length ? columns.map(String) : Object.keys(data[0]);
  if (headers.length === 0 || headers.length > 50) throw new Error('Maximum 50 columns per export');
  const csvRows = [headers.map(csvCell).join(',')];
  for (const row of data) csvRows.push(headers.map(h => csvCell(row[h])).join(','));
  const csv = csvRows.join('\n');
  if (Buffer.byteLength(csv, 'utf8') > 1_000_000) throw new Error('Export exceeds 1 MB');

  const allowed = await checkSimpleHourlyLimit(request.auth.uid, 'exports', 10);
  if (!allowed) throw new Error('Export hourly limit exceeded');

  const docRef = await db.collection('exports').add({
    userId: request.auth.uid,
    title: String(title || 'Exportación DeclaraFY').slice(0, 120),
    csv,
    createdAt: Date.now()
  });
  return { ok: true, exportId: docRef.id, csv };
});

legacy.updateNotifPrefs = onCall(async request => {
  if (!request.auth) throw new Error('Must be authenticated');
  const { whatsapp, notifPush, notifWhatsapp, ruc } = request.data || {};
  const updates = {};
  const normFlag = v => v === true || v === 'si' ? 'si' : v === false || v === 'no' ? 'no' : null;

  if (whatsapp !== undefined) {
    const phone = String(whatsapp).replace(/[^\d+]/g, '');
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw new Error('Invalid WhatsApp number');
    updates.whatsapp = phone;
  }
  if (notifPush !== undefined) {
    const v = normFlag(notifPush);
    if (!v) throw new Error('Invalid push preference');
    updates.notifPush = v;
  }
  if (notifWhatsapp !== undefined) {
    const v = normFlag(notifWhatsapp);
    if (!v) throw new Error('Invalid WhatsApp preference');
    updates.notifWhatsapp = v;
  if (ruc !== undefined) {
    const normalizedRuc = String(ruc || '').replace(/\D/g, '');
    if (normalizedRuc && !isValidRuc(normalizedRuc)) throw new Error('Invalid RUC');
    updates.ruc = normalizedRuc;
  }
  if (Object.keys(updates).length === 0) throw new Error('No valid preferences supplied');
  }
  await db.collection('users').doc(request.auth.uid).set(updates, { merge: true });
  return { ok: true };
});

// Never infer SUNAT due dates from the last RUC digit with arithmetic.
// Notifications are emitted only from an explicitly loaded official calendar.
// Expected document: sunat_calendar/YYYY-MM with field `deadlines` mapping
// RUC last digit -> YYYY-MM-DD.
legacy.scheduledDeadlineNotifications = onSchedule({
  schedule: 'every 24 hours',
  timeZone: 'America/Lima',
  timeoutSeconds: 120,
  memory: '256MiB'
}, async () => {
  const now = new Date();
  const limaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  const tomorrowDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(now.getTime() + 86_400_000));
  const monthKey = limaDate.slice(0, 7);
  const calendarDoc = await db.collection('sunat_calendar').doc(monthKey).get();
  if (!calendarDoc.exists || !calendarDoc.data().deadlines) {
    console.warn(`SUNAT notifications skipped: official calendar ${monthKey} is not configured.`);
    return { skipped: true, reason: 'calendar_not_configured' };
  }

  const deadlines = calendarDoc.data().deadlines;
  const usersSnap = await db.collection('users').where('notifPush', '==', 'si').get();
  let pushCount = 0;
  let whatsappCount = 0;

  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data();
    if (!isValidRuc(user.ruc)) continue;
    const digit = user.ruc.slice(-1);
    const deadline = String(deadlines[digit] || '');
    if (deadline !== limaDate && deadline !== tomorrowDate) continue;

    const when = deadline === limaDate ? 'hoy' : 'mañana';
    const message = `Tu vencimiento SUNAT configurado en el calendario oficial es ${when} (${deadline}). Verifica tus obligaciones antes de presentar.`;

    if (user.pushToken) {
      const admin = require('firebase-admin');
      await admin.messaging().sendEachForMulticast({
        tokens: [user.pushToken],
        notification: { title: '🏛️ DeclaraFY — Vencimiento Tributario', body: message },
        data: { url: '/' }
      }).catch(err => console.warn('Push error:', err.message));
      pushCount++;
    }

    if ((user.notifWhatsapp === 'si' || user.notifWhatsapp === true) && /^\+?\d{8,15}$/.test(String(user.whatsapp || ''))) {
      await db.collection('whatsapp_alerts').add({
        userId: userDoc.id,
        phone: user.whatsapp,
        message,
        status: 'pending',
        createdAt: Date.now()
      });
      whatsappCount++;
    }
  }

  return { pushCount, whatsappCount, calendar: monthKey };
});

module.exports = legacy;
