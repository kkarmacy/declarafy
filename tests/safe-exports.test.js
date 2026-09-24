'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/core/safe-exports.js', 'utf8');

function loadExports() {
  const printed = [];
  const ids = {
    messages: {
      querySelectorAll: () => [{
        classList: { contains: key => key === 'user' },
        querySelector: () => ({ innerText: '<img src=x onerror=alert(1)> & prueba' }),
      }],
    },
    infClienteSel: { value: '1' },
    infEstudio: { value: '<svg/onload=alert(1)>' },
    infPreview: { innerText: '<script>alert(1)</script> Contenido del informe' },
  };
  const doc = { readyState: 'complete', getElementById: id => ids[id] || null };
  const win = {
    document: doc,
    localStorage: { getItem: () => JSON.stringify({ nombre: '<img onerror=alert(1)>', color: '#fff;}</style><script>alert(1)</script>' }) },
    open: () => {
      const popup = {
        opener: win,
        document: {
          open: () => {},
          write: html => printed.push(html),
          close: () => {},
        },
        print: () => {},
      };
      return popup;
    },
    setTimeout: () => {},
  };
  const context = {
    window: win,
    WL_KEY: () => 'test-whitelabel',
    curUser: { name: 'Usuario' },
    AREAS: { general: { label: 'General' } },
    curArea: 'general',
    crmClients: [{ id: '1', nombre: '<img src=x onerror=alert(1)>' }],
    infColor: '#aabbcc',
  };
  vm.runInNewContext(source, context);
  return { win, printed };
}

test('exportPDF escapes conversation content, document title and custom brand', () => {
  const { win, printed } = loadExports();
  win.exportPDF();
  assert.equal(printed.length, 1);
  assert.match(printed[0], /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(printed[0], /&amp; prueba/);
  assert.doesNotMatch(printed[0], /<img\b|<script\b/i);
  assert.match(printed[0], /#C9A84C/);
  assert.doesNotMatch(printed[0], /#fff;}/);
});

test('monthly export escapes both client identity and report preview', () => {
  const { win, printed } = loadExports();
  win.exportInformeMensual();
  assert.equal(printed.length, 1);
  assert.match(printed[0], /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(printed[0], /&lt;svg\/onload=alert\(1\)&gt;/);
  assert.match(printed[0], /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(printed[0], /<script\b|<img\b|<svg\b/i);
  assert.match(printed[0], /#aabbcc/);
});

test('frontend wires safe exports after legacy modules', () => {
  const ui = fs.readFileSync('frontend-ui.js', 'utf8');
  assert.match(ui, /loadSafeExports\(\)/);
  assert.match(ui, /\/src\/core\/safe-exports\.js/);
});
