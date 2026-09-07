'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'secure-index.js'), 'utf8');
const legacyBackend = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

test('Firebase callable functions use the callable protocol', () => {
  assert.match(app, /body:\s*JSON\.stringify\(\{ data \}\)/);
  assert.match(app, /return envelope\.result/);
  for (const name of ['generateApiKey', 'listApiKeys', 'revokeApiKey', 'updateNotifPrefs']) {
    assert.match(app, new RegExp(`_tpCallFunction\\('${name}'`));
  }
});

test('API key UI consumes the backend response schema', () => {
  assert.match(app, /data\.rawKey/);
  assert.match(app, /Array\.isArray\(data\)/);
  assert.match(app, /k\.revoked/);
  assert.match(app, /k\.id/);
});

test('SUNAT and CPE browser flows use authenticated backend endpoints', () => {
  assert.match(app, /TP_FN_BASE}\/consultaSunatComprobantes/);
  assert.match(app, /DECLARAFY_FN_BASE}\/validarComprobante/);
  assert.doesNotMatch(app, /async function tpConsultaSunat[\s\S]*?fetch\(`https:\/\/api\.apis\.net\.pe/);
});

test('CPE backend validates fields and applies a rate limit', () => {
  assert.match(backend, /isCpeDate\(fechaEmision\)/);
  assert.match(backend, /cpe_validation/);
  assert.match(backend, /normalizedMonto\.toFixed\(2\)/);
});

test('notification preferences persist a validated RUC', () => {
  assert.match(backend, /const \{ whatsapp, notifPush, notifWhatsapp, ruc \}/);
  assert.match(backend, /updates\.ruc = normalizedRuc/);
});

test('SUNAT renderer escapes external text fields', () => {
  assert.match(app, /const esc = value => _escapeHtml/);
  assert.match(app, /esc\(d\.descripcion/);
  assert.match(app, /esc\(data\.direccion/);
});

test('authentication fails closed and removes legacy local credentials', () => {
  assert.match(app, /isValidFirebaseConfig\(firebaseConfig\)/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /\/__\/firebase\/init\.js/);
  assert.match(app, /No se creó ninguna cuenta local/);
  assert.doesNotMatch(app, /btoa\((?:pw|old|nw|temp)\)/);
  assert.doesNotMatch(app, /tpHashPw|tpVerifyPw|Login localStorage/);
  assert.match(app, /function getUsers\(\)\{return \{\}\}/);
  assert.match(config, /localStorage\.removeItem\('tp_u'\)/);
});

test('public API validates current entitlement and bounded input', () => {
  assert.match(legacyBackend, /ownerDoc\.data\(\)\.plan !== "empresa"/);
  assert.match(legacyBackend, /question\.length > 8000/);
  assert.match(legacyBackend, /allowedRegimes\.has\(normalizedRegime\)/);
  assert.match(legacyBackend, /AbortSignal\.timeout\(45000\)/);
});

test('legacy API-key rate limiter records windows atomically', () => {
  assert.match(legacyBackend, /db\.runTransaction\(async tx/);
  assert.match(legacyBackend, /tx\.set\(minRef/);
  assert.match(legacyBackend, /tx\.set\(hourRef/);
});

test('authenticated provider lookups have explicit hourly limits', () => {
  assert.match(backend, /ruc_lookup/);
  assert.match(backend, /bcr_lookup/);
});

test('service worker bypasses Cloud Functions and refreshes navigations', () => {
  assert.match(serviceWorker, /hostname\.endsWith\('\.cloudfunctions\.net'\)/);
  assert.match(serviceWorker, /e\.request\.mode === 'navigate'/);
});
