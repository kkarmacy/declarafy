'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.php'), 'utf8');
const start = source.indexOf("    case 'sunat_auth_test':");
const end = source.indexOf("    case 'public_api':", start);
assert.notEqual(start, -1, 'SUNAT auth test endpoint must exist');
assert.notEqual(end, -1, 'SUNAT auth test endpoint must have a following case');
const handler = source.slice(start, end);

test('SUNAT OAuth test endpoint is POST-only and admin-only', () => {
  assert.match(handler, /require_method\('POST'\)/);
  assert.match(handler, /require_user\(\)/);
  assert.match(handler, /if\s*\(!is_admin\(\$config,\s*\$sunatUser\)\)/);
});

test('SUNAT OAuth test accepts only an allowlisted service key', () => {
  assert.match(handler, /if\s*\(!isset\(\$sunatServices\[\$serviceKey\]\)\)/);
  assert.match(handler, /sunat\/invalid-service/);
  const entries = [...handler.matchAll(/^\s{12}'([a-z]+)'\s*=>\s*\['name'\s*=>/gm)];
  assert.equal(entries.length, 8, 'only the eight intended SUNAT services should be selectable');
});

test('SUNAT credentials are not included in logs or success response', () => {
  assert.match(handler, /No se muestran sus valores por seguridad/);
  assert.match(handler, /No devolver ni registrar access_token, refresh_token ni credenciales/);
  assert.doesNotMatch(handler, /error_log\([^\n]*(?:\$clientSecret|\$solPassword|\$sunatPayload\['access_token'\])/);
  assert.match(handler, /'token_received'\s*=>\s*true/);
  assert.doesNotMatch(handler, /'access_token'\s*=>/);
});

test('SUNAT token rejection returns a sanitized error, not the raw response body', () => {
  assert.match(handler, /preg_replace\('\/\[\^A-Za-z0-9_\.\-\]\/'.*\$sunatPayload\['error'\]/);
  assert.match(handler, /'error'\s*=>\s*'sunat\/oauth-rejected'/);
  assert.doesNotMatch(handler, /'raw'\s*=>\s*\$sunatRaw/);
});
