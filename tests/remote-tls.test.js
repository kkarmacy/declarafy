'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.resolve(__dirname, '../api/index.php'), 'utf8');

test('shared remote JSON and form helpers explicitly verify TLS and refuse redirects', () => {
  const jsonStart = api.indexOf('function remote_json');
  const formStart = api.indexOf('function remote_form');
  const end = api.indexOf('function clean_ruc', formStart);
  assert.ok(jsonStart >= 0 && formStart > jsonStart && end > formStart);
  const jsonHelper = api.slice(jsonStart, formStart);
  const formHelper = api.slice(formStart, end);
  for (const [name, helper] of [['remote_json', jsonHelper], ['remote_form', formHelper]]) {
    assert.match(helper, /CURLOPT_FOLLOWLOCATION => false/, name + ' must refuse redirects');
    assert.match(helper, /CURLOPT_SSL_VERIFYPEER => true/, name + ' must verify the TLS certificate');
    assert.match(helper, /CURLOPT_SSL_VERIFYHOST => 2/, name + ' must verify the TLS hostname');
    assert.match(helper, /if \(!curl_setopt_array\(/, name + ' must fail closed on cURL setup errors');
  }
});


test('SUNAT OAuth transport verifies TLS and fails closed when cURL setup fails', () => {
  const tokenStart = api.indexOf("$curl = curl_init($tokenUrl);");
  const tokenEnd = api.indexOf("$sunatRaw = curl_exec($curl);", tokenStart);
  assert.ok(tokenStart >= 0 && tokenEnd > tokenStart);
  const tokenTransport = api.slice(tokenStart, tokenEnd);
  assert.match(tokenTransport, /if \(\$curl === false\)/, 'must handle cURL initialization failure');
  assert.match(tokenTransport, /CURLOPT_FOLLOWLOCATION => false/, 'must refuse redirects');
  assert.match(tokenTransport, /CURLOPT_SSL_VERIFYPEER => true/, 'must verify the TLS certificate');
  assert.match(tokenTransport, /CURLOPT_SSL_VERIFYHOST => 2/, 'must verify the TLS hostname');
  assert.match(tokenTransport, /if \(!\$configured\)/, 'must fail closed when cURL setup fails');
});
