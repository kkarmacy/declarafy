'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const ui = read('frontend-ui.js');
const css = read('frontend-polish.css');
const client = read('server-api.js');

test('shared usability layer is loaded after app and has responsive, keyboard-safe styles', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('/frontend-ui.js') > html.indexOf('/app.js'));
  assert.match(html, /frontend-polish\.css/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /screen:not\(\.active\)/);
  assert.match(ui, /label\.htmlFor = control\.id/);
  assert.match(ui, /input\.reportValidity|invalid\.reportValidity/);
});

test('location title is not rewritten when unchanged, avoiding observer feedback loops', () => {
  let writes = 0;
  const title = { get textContent() { return 'Inicio'; }, set textContent(value) { writes++; } };
  const context = { document: {
    readyState: 'loading', addEventListener() {},
    querySelector() { return { textContent: 'Inicio' }; },
    querySelectorAll() { return []; }, getElementById() { return title; }
  }};
  vm.createContext(context);
  vm.runInContext(ui, context);
  context.syncPanelAccessibility();
  assert.equal(writes, 0);
});

test('API fetch uses a timeout, never caches account data, and clears timers', async () => {
  let options, cleared = false;
  const context = {
    AbortController, setTimeout() { return 7; }, clearTimeout(id) { cleared = id === 7; },
    fetch: async (url, opts) => { options = opts; return { ok: true }; }
  };
  vm.createContext(context);
  vm.runInContext(client.slice(0, client.indexOf('async function declarafyApi')), context);
  await context.declarafyFetch('/api/index.php');
  assert.equal(options.cache, 'no-store');
  assert.ok(options.signal);
  assert.equal(cleared, true);
});

test('network errors provide a clear message rather than a raw browser exception', async () => {
  const context = {
    AbortController, setTimeout() { return 7; }, clearTimeout() {},
    fetch: async () => { throw new TypeError('Failed to fetch'); }
  };
  vm.createContext(context);
  vm.runInContext(client.slice(0, client.indexOf('async function declarafyApi')), context);
  await assert.rejects(context.declarafyFetch('/api/index.php'), /Comprueba tu conexión/);
});

test('welcome notifications do not invent deadlines or dated regulatory announcements', () => {
  const app = read('app.js');
  const notifications = app.slice(app.indexOf('const DEFAULT_NOTIFS'), app.indexOf('function getNotifs'));
  assert.doesNotMatch(notifications, /vence en 5 días|Hace 1 hora|034-2025/);
  assert.match(ui, /pendingButtons/);
  assert.match(ui, /stopImmediatePropagation/);
});

test('brand asset exists, is referenced, and is available offline', () => {
  const html = read('index.html');
  const styles = read('styles.css');
  const worker = read('sw.js');
  const logo = read('declarafy-logo.svg');
  assert.match(styles, /declarafy-logo\.svg/);
  assert.match(worker, /declarafy-logo\.svg/);
  assert.match(logo, /DeclaraFY/);
  assert.match(html, /20260915-1/);
});

test('theme control activates a real dark mode and preserves an accessible label', () => {
  const app = read('app.js');
  assert.match(app, /classList\.toggle\('dark-mode'/);
  assert.match(app, /Cambiar a tema claro/);
  assert.match(css, /body\.dark-mode/);
});

test('stored notifications are escaped and obsolete demo alerts are discarded', () => {
  const app = read('app.js');
  const notifications = app.slice(app.indexOf('const DEFAULT_NOTIFS'), app.indexOf('// ════════════════════════════════════════\n// PERFIL DE USUARIO'));
  assert.match(notifications, /_escapeHtml\(n\.title/);
  assert.match(notifications, /\[1, 2, 3\]\.includes/);
});

test('session loading rejects malformed non-JSON server responses clearly', () => {
  assert.match(client, /servidor devolvió una sesión inválida/);
  const session = client.slice(client.indexOf('async function declarafyLoadSession'), client.indexOf('function declarafyUser'));
  assert.match(session, /response\.text\(\)/);
  assert.doesNotMatch(session, /response\.json\(\)/);
});

test('panel navigation keeps Inicio and the module hub first, then sorts Spanish labels', () => {
  let order = [];
  const makeButton = (textContent, onclick, featured = false) => {
    const button = {
      textContent,
      getAttribute(name) { return name === 'onclick' ? onclick : ''; },
      classList: { contains(name) { return featured && name === 'pntab-featured'; } },
      after(other) {
        order.splice(order.indexOf(other), 1);
        order.splice(order.indexOf(button) + 1, 0, other);
      }
    };
    return button;
  };
  order = [
    makeButton('Calendario', "setPTab('calendario')"),
    makeButton('⭐ 17 módulos', "setPTab('especializados')", true),
    makeButton('Biblioteca', "setPTab('biblioteca')"),
    makeButton('Inicio', "setPTab('inicio')"),
    makeButton('AFP', "setPTab('afp')")
  ];
  const nav = {
    querySelectorAll() { return [...order]; },
    querySelector() { return null; },
    appendChild(button) { order.splice(order.indexOf(button), 1); order.push(button); },
    prepend(button) { order.splice(order.indexOf(button), 1); order.unshift(button); }
  };
  const context = { Intl, document: { readyState:'loading', addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, getElementById() { return null; } } };
  vm.createContext(context);
  vm.runInContext(ui, context);
  context.sortPanelNavigation(nav);
  assert.deepEqual(order.map(button => button.textContent), ['Inicio', '⭐ 17 módulos', 'AFP', 'Biblioteca', 'Calendario']);
});

test('history and referrals use styled dashboards and copy the displayed referral link', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /class="pbody module-page history-module"/);
  assert.match(html, /class="pbody module-page referrals-module"/);
  assert.match(html, /copyRefLink\(event\)/);
  assert.match(css, /\.history-toolbar/);
  assert.match(css, /\.ref-content-grid/);
  assert.match(app, /const shown = document\.getElementById\('refLink'\)/);
  assert.match(app, /_escapeHtml\(c\.area/);
});
