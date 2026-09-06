'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'secure-index.js'), 'utf8');

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
