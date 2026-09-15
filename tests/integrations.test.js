'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const apiClient = read('server-api.js');
const api = read('api/index.php');
const bootstrap = read('api/bootstrap.php');
const schema = read('api/schema.sql');
const html = read('index.html');
const serviceWorker = read('sw.js');
const version = read('VERSION.txt');

test('production frontend uses the same-origin Namecheap API without Firebase SDKs', () => {
  assert.match(html, /<script src="\/server-api\.js(?:\?v=[^"]+)?"><\/script>/);
  assert.doesNotMatch(html, /gstatic\.com\/firebasejs/);
  assert.doesNotMatch(html, /push-notifications\.js/);
  assert.match(read('config.js'), /DECLARAFY_PROXY_URL = '\/api\/index\.php\?action=ai'/);
  assert.doesNotMatch(read('config.js'), /cloudfunctions\.net/);
});

test('API client sends cookie sessions and CSRF protection on mutations', () => {
  assert.match(apiClient, /credentials: 'same-origin'/);
  assert.match(apiClient, /'X-CSRF-Token'/);
  assert.match(apiClient, /action=session/);
  assert.match(bootstrap, /hash_equals\(\$_SESSION\['csrf'\], \$token\)/);
  assert.match(bootstrap, /'httponly' => true/);
  assert.match(bootstrap, /'samesite' => 'Lax'/);
});

test('registration and login use password hashes and prepared statements', () => {
  assert.match(api, /password_hash\(\$password, PASSWORD_DEFAULT\)/);
  assert.match(api, /password_verify\(\$password, \$record\['password_hash'\]\)/);
  assert.match(api, /session_regenerate_id\(true\)/);
  assert.match(api, /\$pdo->prepare\('INSERT INTO users/);
  assert.doesNotMatch(schema, /\bpassword\s+VARCHAR/i);
});

test('client cannot assign itself a paid plan or arbitrary profile columns', () => {
  const profileCase = api.slice(api.indexOf("case 'profile_update':"), api.indexOf("case 'reauthenticate':"));
  assert.match(profileCase, /\$allowed = \[\]/);
  assert.match(profileCase, /\['regimen' => 80, 'sector' => 120\]/);
  assert.doesNotMatch(profileCase, /\$allowed\['plan'\]/);
  assert.doesNotMatch(profileCase, /\$allowed\['message_count'\]/);
});

test('password recovery stores only a token hash with an expiry', () => {
  assert.match(api, /hash\('sha256', \$token\)/);
  assert.match(api, /INTERVAL 60 MINUTE/);
  assert.match(api, /used_at IS NULL/);
  assert.match(schema, /token_hash CHAR\(64\)/);
});

test('AI key stays server-side and requests have quota and time limits', () => {
  assert.match(api, /\$config\['anthropic_api_key'\]/);
  assert.match(api, /SELECT plan, message_count, email FROM users WHERE id = \? FOR UPDATE/);
  assert.match(api, /message_count'\] >= 30/);
  assert.match(api, /GREATEST\(message_count - 1, 0\)/);
  assert.match(api, /CURLOPT_TIMEOUT => 90/);
  assert.doesNotMatch(html + app + apiClient, /sk-ant-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(html + app, /api\.anthropic\.com/);
});

test('service worker never caches API responses and refreshes old shells', () => {
  assert.match(serviceWorker, /declarafy-v13-namecheap/);
  assert.match(serviceWorker, /endsWith\('\.css'\)/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /e\.request\.mode === 'navigate'/);
});

test('successful authentication still opens the user panel', () => {
  assert.match(app, /await kvLoadAll\(\);\s*goPanel\(\);/);
  assert.match(app, /hideAuth\(\); goPanel\(\);/);
  assert.match(app, /kvLoadAll\(\)\.then\(\(\) => goPanel\(\)\)/);
});

test('authentication survives missing optional billing tables and repairs them automatically', () => {
  assert.match(bootstrap, /function ensure_runtime_schema\(PDO \$pdo\)/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS payments/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS subscriptions/);
  assert.match(bootstrap, /A missing optional billing table must never block login/);
  assert.match(bootstrap, /\$error->getCode\(\) !== '42S02'/);
});

test('audited external integrations fail truthfully instead of fabricating data', () => {
  assert.doesNotMatch(app, /api\.apis\.net\.pe\/v2\/sunat\/ruc/);
  assert.doesNotMatch(app, /sbs\.gob\.pe\/app\/statistics/);
  assert.doesNotMatch(app, /pen \* 0\.997|pen \* 1\.003/);
  assert.doesNotMatch(app, /return \{ compra: 3\.75, venta: 3\.77/);
  assert.match(app, /Tipo medio referencial/);
  assert.match(app, /La SBS no ofrece este resultado como una API pública estable/);
});

test('canonical host, critical shell CSS and cache versions are deployment-safe', () => {
  assert.match(html, /rel="canonical" href="https:\/\/declarafy\.com\/"/);
  assert.doesNotMatch(html, /https:\/\/www\.declarafy\.com/);
  assert.match(html, /id="critical-shell-css"/);
  assert.match(html, /#tp-confirm-overlay:not\(\.show\)/);
  assert.match(html, /\/app\.js\?v=20260914-1/);
  assert.match(html, /\/sw\.js\?v=11/);
  assert.match(version, /2026\.09\.14-1/);
  const rootHeaders = read('.htaccess');
  assert.match(rootHeaders, /RewriteCond %\{HTTP_HOST\} \^www\\\.declarafy\\\.com\$/);
  assert.match(rootHeaders, /Strict-Transport-Security/);
});

test('landing and authenticated panel are sibling screens', () => {
  const landing = html.slice(html.indexOf('<!-- LANDING -->'), html.indexOf('<!-- PANEL -->'));
  const opened = (landing.match(/<div\b/g) || []).length;
  const closed = (landing.match(/<\/div>/g) || []).length;
  assert.equal(opened, closed, 'the landing section must close before the panel starts');
  assert.match(html, /<!-- PANEL -->\s*<div class="screen" id="screen-panel">/);
});

test('all 145 declared panel tabs resolve to a real section id', () => {
  const list = app.match(/const PT_TAB_NAMES = \[([\s\S]*?)\];/);
  assert.ok(list, 'PT_TAB_NAMES declaration is missing');
  const tabs = [...list[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  const ids = [...html.matchAll(/id="pt([^"]+)"/g)].map(match => match[1]);
  const key = value => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  assert.equal(tabs.length, 145);
  assert.deepEqual(tabs.filter(tab => !ids.some(id => key(id) === key(tab))), []);
  assert.match(app, /function _ptSectionId\(tab\)/);
  const navigationTargets = [...new Set([...html.matchAll(/setPTab\(['"]([^'"]+)/g)].map(match => match[1]))];
  assert.deepEqual(navigationTargets.filter(tab => !ids.some(id => key(id) === key(tab))), []);
});

test('the 19 requested specialized modules are visible and open real tools', () => {
  const expected = ['sucesiones','donaciones','cobranza_coactiva','onp','essalud_senati','notas_credito','percepciones','afp_onp','royalties','cas','no_domiciliados','dividendos','ir_5ta','itf','generador_informes','chat_sesiones','analizador_contratos','proyeccion_afp','verificador_ruc'];
  const launcher = html.slice(html.indexOf('id="specializedModuleGrid"'), html.indexOf('id="specializedModuleEmpty"'));
  const sectionIds = [...html.matchAll(/id="pt([^"]+)"/g)].map(match => match[1]);
  const normalize = value => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  for (const module of expected) {
    assert.match(launcher, new RegExp(`openSpecializedModule\\('${module}'\\)`));
    assert.ok(sectionIds.some(id => normalize(id) === normalize(module)), `${module} must resolve to a panel section`);
  }
  assert.match(app, /function filterPanelNavigation\(value\)/);
  assert.match(app, /function filterSpecializedModules\(value\)/);
  assert.match(html, /setPTab\('especializados',this\).*19 módulos/);
  assert.match(html, /id="ptEspecializados"/);
});

test('SUNAT uses the official CPE OAuth service and protected data opens official portals', () => {
  assert.match(api, /api-seguridad\.sunat\.gob\.pe\/v1\/clientesextranet/);
  assert.match(api, /api\.sunat\.gob\.pe\/v1\/contribuyente\/contribuyentes/);
  assert.match(api, /validarcomprobante/);
  assert.match(api, /grant_type' => 'client_credentials'/);
  assert.match(bootstrap, /DECLARAFY_SUNAT_CLIENT_ID/);
  assert.match(bootstrap, /DECLARAFY_SUNAT_CLIENT_SECRET/);
  assert.match(bootstrap, /DECLARAFY_SUNAT_QUERY_RUC/);
  assert.match(app, /SUNAT_RUC_PUBLIC_URL = 'https:\/\/e-consultaruc\.sunat\.gob\.pe\/'/);
  assert.match(app, /SUNAT_SOL_URL = 'https:\/\/e-menu\.sunat\.gob\.pe\/'/);
  assert.match(app, /declarafyApi\('consultasunatcomprobantes'/);
  assert.doesNotMatch(app, /DECLARAFY_FN_BASE\/validarComprobante/);
  assert.doesNotMatch(app, /DECLARAFY_FN_BASE\/consultaRuc/);
});

test('chat sessions show real saved history and AFP projection compounds salary annually', () => {
  const chat = app.slice(app.indexOf('function calcChat()'), app.indexOf('// ── 25. GENERADOR INFORMES'));
  assert.match(chat, /getHist\(curUser\.email\)/);
  assert.doesNotMatch(chat, /Consulta sobre RUC y facturación|DeepSeek|tp_chat_sessions/);
  const projection = app.slice(app.indexOf('function calcProyAfp()'), app.indexOf('// ── 23. ANALIZADOR CONTRATOS'));
  assert.match(projection, /sueldo \* \(0\.10 \+ comision \+ prima\)/);
  assert.match(projection, /sueldoMensual \*= \(1 \+ crec\)/);
  assert.doesNotMatch(projection, /sueldoAnual \*= \(1 \+ crec\)/);
});

test('configured superadministrator bypasses commercial limits but retains security controls', () => {
  assert.match(bootstrap, /function is_superadmin\(array \$config, array \$user\): bool/);
  assert.match(bootstrap, /'isAdmin' => \$admin/);
  assert.match(bootstrap, /'effectivePlan' => \$admin \? 'empresa'/);
  assert.match(api, /!is_admin\(\$config, \$user\).*message_count.*>= 30/);
  assert.match(api, /!is_admin\(\$config, \$user\).*api-key\/limit/);
  assert.match(api, /\$apiKeyRecord\['plan'\] !== 'empresa' && !is_admin/);
  assert.match(app, /adminTab'\)\.style\.display = admin \? '' : 'none'/);
  assert.match(app, /declarafyApi\('admin_overview'/);
  assert.match(bootstrap, /function require_mutation_security/);
  assert.match(api, /rate_limit\(\$pdo, 'ai'/);
  assert.match(api, /rate_limit\(\$pdo, 'public_api'/);
});

test('data-driven administration, referrals, and membership statistics use server data', () => {
  assert.match(api, /case 'admin_overview':/);
  assert.match(api, /case 'referrals_overview':/);
  assert.match(app, /declarafyApi\('referrals_overview'/);
  assert.match(app, /const memberDays=/);
  const referrals = app.slice(app.indexOf('async function loadReferidos'), app.indexOf('function copyRefLink'));
  assert.doesNotMatch(referrals, /getUsers\(\)/);
  const admin = app.slice(app.indexOf('async function renderAdmin'), app.indexOf('const _origSetPTabV9'));
  assert.doesNotMatch(admin, /getUsers\(\)/);
  assert.doesNotMatch(admin, /\{n:'IGV',v:32\}/);
});

test('literal frontend API actions have matching PHP routes', () => {
  const frontend = [...app.matchAll(/(?:declarafyApi|_tpCallFunction)\(\s*['"`]([a-z0-9_]+)/gi)]
    .map(match => match[1].toLowerCase());
  const backend = new Set([...api.matchAll(/case '([a-z0-9_]+)':/g)].map(match => match[1]));
  assert.deepEqual([...new Set(frontend.filter(action => !backend.has(action)))], []);
});

test('external-data modules do not fabricate SUNAT, exchange-rate, billing, or report values', () => {
  assert.doesNotMatch(app, /estadosSim|condSim|ecoSim|SBS simulado|TC simulado|Simulate payment history/);
  assert.doesNotMatch(app, /3\.720\+Math\.random|5000 \+ Math\.random\(\) \* 20000/);
  assert.doesNotMatch(app, /3\.720\+Math\.sin|const BCR_HIST = \[\s*\{/);
  assert.doesNotMatch(app + html, /\|\|\s*3\.(?:73|75|752)|value="3\.(?:73|75|752)"/);
  assert.match(app, /declarafyApi\('consultasunatcomprobantes'/);
  assert.match(app, /declarafyApi\('consultabcrtiposcambio'/);
  assert.match(app, /declarafyApi\('payments_list'/);
});

test('chat consumes the backend JSON contract instead of expecting an SSE stream', () => {
  const chat = app.slice(app.indexOf('async function _sendMsgStreamBase'), app.indexOf('// Override sendMsg to use streaming'));
  assert.match(chat, /const payload = await res\.json\(\)/);
  assert.doesNotMatch(chat, /getReader\(|content_block_delta|line\.startsWith\('data: '\)/);
});

test('inline module handlers reference declared application functions and ids stay unique', () => {
  const scripts = ['app.js', 'config.js', 'utils.js', 'calculators.js', 'firebase-sync.js', 'server-api.js'].map(read).join('\n');
  const ignored = new Set(['if','for','while','switch','catch','confirm','setTimeout','parseInt','parseFloat','Number','String','Date','add','getElementById','open','preventDefault','remove','replace']);
  const references = [...html.matchAll(/on(?:click|change|input|keydown|submit)="([^"]+)"/g)]
    .flatMap(match => [...match[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(call => call[1]))
    .filter(name => !ignored.has(name));
  const declarations = new Set([...scripts.matchAll(/(?:function\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/g)].map(match => match[1]));
  assert.deepEqual([...new Set(references.filter(name => !declarations.has(name)))], []);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('root hosting headers prevent framing and accidental access to secrets', () => {
  const rootHeaders = read('.htaccess');
  assert.match(rootHeaders, /X-Frame-Options "DENY"/);
  assert.match(rootHeaders, /Content-Security-Policy-Report-Only/);
  assert.match(rootHeaders, /config\\\.local\\\.php/);
});

test('current tax constants are centralized and stale audited values are absent', () => {
  const config = read('config.js');
  assert.match(config, /2026:5500/);
  assert.match(config, /timMonthlyPercent: 0\.9/);
  assert.match(config, /timDailyPercent: 0\.03/);
  assert.doesNotMatch(app + html, /2026:5600|1\.2% mensual|0\.04% diario/);
  assert.doesNotMatch(app, /Interés moratorio \(1\.5%\/mes\)|monto < 1000|const UIT ?= ?5350|var UIT=5150/);
  assert.match(app, /ingresos <= 5000[\s\S]*cuota = 20/);
  assert.match(app, /ingresos <= 8000[\s\S]*cuota = 50/);
});

test('payment activation is verified server-side and recorded idempotently', () => {
  assert.match(api, /case 'culqi_webhook'/);
  assert.match(api, /api\.culqi\.com\/v2\/charges/);
  assert.match(schema, /UNIQUE KEY uq_payments_event/);
  assert.match(schema, /UNIQUE KEY uq_payments_charge/);
  assert.match(api, /UPDATE users SET plan = \? WHERE id = \?/);
  assert.match(api, /190000 => \['plan' => 'pro', 'months' => 12\]/);
  assert.match(api, /750000 => \['plan' => 'empresa', 'months' => 12\]/);
  assert.doesNotMatch(app, /Simulate payment history/);
});

test('rendered user and AI content is escaped or sanitized', () => {
  assert.match(app, /_escapeHtml\(f\.name\)/);
  assert.match(app, /_escapeHtml\(f\.q\)/);
  assert.match(app, /preview\.innerHTML = '<p style="color:var\(--red\)">Error: ' \+ _escapeHtml\(err\.message\)/);
  assert.doesNotMatch(app, /\.content\?\.\[0\]\?\.text\|\|'[^']*'\)\.replace\(\/\\n/);
});
