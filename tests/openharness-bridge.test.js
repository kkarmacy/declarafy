'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bridge = fs.readFileSync(path.join(root, 'api/openharness.php'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'api/bootstrap.php'), 'utf8');
const sample = fs.readFileSync(path.join(root, 'api/config.sample.php'), 'utf8');

test('OpenHarness integration is disabled by default', () => {
  assert.match(bootstrap, /DECLARAFY_OPENHARNESS_ENABLED[^\n]*\?\? '0'/);
  assert.match(sample, /'openharness_enabled'\s*=>\s*'0'/);
  assert.match(bridge, /openharness\/disabled/);
});

test('OpenHarness bridge requires same-origin mutation security and a logged-in user', () => {
  assert.match(bridge, /require_mutation_security\(\$config\)/);
  assert.match(bridge, /\$userId\s*=\s*require_user\(\)/);
});

test('OpenHarness bridge restricts HTTPS destinations to exact configured DNS hosts', () => {
  assert.match(bootstrap, /DECLARAFY_OPENHARNESS_ALLOWED_HOSTS/);
  assert.match(bootstrap, /'openharness_allowed_hosts'\s*=>\s*\$openharnessAllowedHosts/);
  assert.match(bridge, /in_array\(strtolower\(\(string\) \(\$parsed\['host'\] \?\? ''\)\), \$config\['openharness_allowed_hosts'\] \?\? \[\], true\)/);
  assert.match(bridge, /filter_var\(\(string\) \(\$parsed\['host'\] \?\? ''\), FILTER_VALIDATE_IP\) !== false/);
});

test('OpenHarness bridge uses HTTPS and does not follow redirects', () => {
  assert.match(bridge, /strtolower\(\(string\) \(\$parsed\['scheme'\] \?\? ''\)\) !== 'https'/);
  assert.match(bridge, /CURLOPT_FOLLOWLOCATION\s*=>\s*false/);
  assert.match(bridge, /CURLOPT_MAXREDIRS\s*=>\s*0/);
});

test('OpenHarness bridge only accepts predefined task types and bounded JSON input', () => {
  assert.match(bridge, /\['tax_question', 'document_summary', 'tax_data_analysis'\]/);
  assert.match(bridge, /strlen\(\$raw\) > 100_000/);
  assert.match(bridge, /strlen\(\$encodedInput\) > 50_000/);
  assert.match(bridge, /array_diff\(array_keys\(\$body\), \['task', 'input'\]\)/);
  assert.match(bridge, /request\/unknown-fields/);
});

test('Each task has an exact input schema and bounded content', () => {
  assert.match(bridge, /\$task === 'tax_question'/);
  assert.match(bridge, /\$inputKeys = array_keys\(\$input\);\s*sort\(\$inputKeys, SORT_STRING\)/);
  assert.match(bridge, /\$inputKeys !== \['question'\]/);
  assert.match(bridge, /strlen\(\$input\['question'\]\) > 8_000/);
  assert.match(bridge, /\$task === 'document_summary'/);
  assert.match(bridge, /\$inputKeys !== \['text'\]/);
  assert.match(bridge, /strlen\(\$input\['text'\]\) > 40_000/);
  assert.match(bridge, /\$task === 'tax_data_analysis'/);
  assert.match(bridge, /\$inputKeys !== \['data'\]/);
  assert.match(bridge, /count\(\$input\['data'\]\) > 500/);
  assert.match(bridge, /openharness\/input-schema/);
});

test('OpenHarness bridge supports stable client idempotency keys for retries', () => {
  assert.match(bridge, /HTTP_IDEMPOTENCY_KEY/);
  assert.match(bridge, /\^\[0-9a-f\]\{32\}\$/);
  assert.match(bridge, /\$requestId = \$idempotencyKey !== '' \? \$idempotencyKey : bin2hex\(random_bytes\(16\)\)/);
});

test('OpenHarness bridge does not return arbitrary worker response fields', () => {
  assert.match(bridge, /'job_id'\s*=>\s*\$decoded\['job_id'\]/);
  assert.match(bridge, /'status'\s*=>\s*'queued'/);
  assert.match(bridge, /\$status !== 202/);
  assert.match(bridge, /\^\[A-Za-z0-9_-\]\{16,128\}\$/);
  assert.doesNotMatch(bridge, /echo\s+\$response/);
  assert.doesNotMatch(bridge, /print_r\(\$decoded/);
});

test('OpenHarness worker secrets are configured only server-side', () => {
  assert.match(bootstrap, /'openharness_token'\s*=>/);
  assert.match(bridge, /'Authorization: Bearer ' \./);
  assert.doesNotMatch(bridge, /openharness_token.*\$_(GET|POST|REQUEST)/);
});

test('OpenHarness bridge fails closed if PHP cURL is unavailable', () => {
  assert.match(bridge, /function_exists\('curl_init'\)/);
  assert.match(bridge, /PHP cURL extension is missing/);
});

test('OpenHarness worker contract documents isolation and bounded execution', () => {
  const contract = fs.readFileSync(path.join(root, 'docs/openharness-worker-api-contract.md'), 'utf8');
  assert.match(contract, /disposable container/);
  assert.match(contract, /execution deadline/);
  assert.match(contract, /token\/cost budget/);
  assert.match(contract, /must reject arbitrary command strings/);
  assert.match(contract, /direct access to the Declarafy database/);
});
