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

test('production frontend uses the same-origin Namecheap API without Firebase SDKs', () => {
  assert.match(html, /<script src="\/server-api\.js"><\/script>/);
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
  assert.match(api, /message_count'\] >= 30/);
  assert.match(api, /CURLOPT_TIMEOUT => 90/);
  assert.doesNotMatch(html + app + apiClient, /sk-ant-[A-Za-z0-9_-]{20,}/);
});

test('service worker never caches API responses and refreshes old shells', () => {
  assert.match(serviceWorker, /declarafy-v4-namecheap/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /e\.request\.mode === 'navigate'/);
});

test('successful authentication still opens the user panel', () => {
  assert.match(app, /await kvLoadAll\(\);\s*goPanel\(\);/);
  assert.match(app, /hideAuth\(\); goPanel\(\);/);
  assert.match(app, /kvLoadAll\(\)\.then\(\(\) => goPanel\(\)\)/);
});
