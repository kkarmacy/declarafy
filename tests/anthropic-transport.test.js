'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.resolve(__dirname, '../api/index.php'), 'utf8');

test('Anthropic transport validates cURL setup before execution and enforces TLS without redirects', () => {
  const start = api.indexOf('$sendAnthropic = static function');
  const end = api.indexOf('\n        };', start);
  assert.ok(start >= 0 && end > start, 'Anthropic transport closure must exist');
  const transport = api.slice(start, end);
  assert.match(transport, /\$curl = curl_init\('https:\/\/api\.anthropic\.com\/v1\/messages'\)/);
  assert.match(transport, /\$configured = curl_setopt_array\(\$curl, \[/);
  assert.match(transport, /if \(!\$configured\) \{\s*curl_close\(\$curl\);\s*throw new RuntimeException/);
  assert.ok(
    transport.indexOf('if (!$configured)') < transport.indexOf('$raw = curl_exec($curl)'),
    'provider request must not execute if options fail'
  );
  assert.match(transport, /CURLOPT_FOLLOWLOCATION => false/);
  assert.match(transport, /CURLOPT_SSL_VERIFYPEER => true/);
  assert.match(transport, /CURLOPT_SSL_VERIFYHOST => 2/);
  assert.match(transport, /CURLOPT_TIMEOUT => 90/);
});
