'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/core/audit-remediations.js', 'utf8');

function setup() {
  const writes = [];
  const document = {
    readyState: 'complete',
    getElementById: id => ({
      wlNombre: { value: '<img src=x onerror=alert(1)>' },
      wlSlogan: { value: '<script>alert(1)</script>' },
    })[id] || null,
    querySelectorAll: () => [],
  };
  const window = {
    document,
    open: () => ({ opener: window, document: {
      open() {}, write(html) { writes.push(html); }, close() {},
    }}),
  };
  vm.runInNewContext(source, { window, wlColor: '#123456', wlAccent: '#aabbcc' });
  return { window, writes };
}

test('demo report never certifies compliance and escapes taxpayer inputs', () => {
  const { window } = setup();
  const html = window.buildInformeDemo('Estudio', 'Firmante', '2026-09', {
    nombre: '<img src=x onerror=alert(1)>',
    ruc: '20123456789',
    regimen: 'RMT',
    sector: 'Comercio',
    alertas: ['<script>alert(1)</script>'],
  }, '', '#aabbcc');
  assert.match(html, /no se ha comprobado la situación tributaria/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script\b|<img\b/i);
  assert.doesNotMatch(html, /Obligaciones del período al día|Sin contingencias tributarias significativas identificadas/);
});

test('generated monthly report labels AI claims unverified', () => {
  const { window } = setup();
  const html = window.buildInformeHTML('Estudio', 'Firmante', '2026-09',
    { nombre: 'Cliente' }, '<svg/onload=alert(1)>', '#aabbcc');
  assert.match(html, /Contenido generado por IA/);
  assert.match(html, /&lt;svg\/onload=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<svg\b/i);
});

test('white-label preview escapes brand fields and uses validated colors', () => {
  const { window, writes } = setup();
  window.previewWLFull();
  assert.equal(writes.length, 1);
  assert.match(writes[0], /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(writes[0], /#123456/);
  assert.doesNotMatch(writes[0], /<script\b|<img\b/i);
});

test('AI alternative quota reserves before external call and compensates failures', () => {
  const php = fs.readFileSync('api/index.php', 'utf8');
  const alt = php.split("case 'callalternativeai':")[1].split("case 'payments_list':")[0];
  assert.match(alt, /FOR UPDATE/);
  assert.match(alt, /UPDATE users SET message_count = message_count \+ 1/);
  assert.match(alt, /GREATEST\(message_count - 1, 0\)/);
  assert.ok(alt.indexOf('UPDATE users SET message_count = message_count + 1') < alt.indexOf('remote_json('));
  assert.match(alt, /mb_strlen\(\$message\['content'\]\) > 20000/);
});

test('obsolete Firebase backends are retired but PHP adapter is retained', () => {
  for (const file of ['index.js', 'secure-index.js', 'final-index.js', 'push-notifications.js']) {
    assert.equal(fs.existsSync(file), false, file);
  }
  assert.equal(fs.existsSync('firebase-sync.js'), true);
  assert.equal(fs.existsSync('server-api.js'), true);
});
