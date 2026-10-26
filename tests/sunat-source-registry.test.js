'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../api/ai/SunatSourceRegistry.php'),
  'utf8'
);

test('SUNAT source retrieval stops if secure cURL options cannot be configured', () => {
  assert.match(source, /\$configured = curl_setopt_array\(\$curl, \[/);
  assert.match(
    source,
    /if \(!\$configured\) \{\s*curl_close\(\$curl\);\s*throw new RuntimeException\('No se pudo configurar la conexión segura con SUNAT\.'\);\s*\}/
  );
  assert.ok(
    source.indexOf('if (!$configured)') < source.indexOf('$ok = curl_exec($curl)'),
    'cURL must not execute when secure options fail to configure'
  );
  assert.match(source, /CURLOPT_SSL_VERIFYPEER => true/);
  assert.match(source, /CURLOPT_SSL_VERIFYHOST => 2/);
  assert.match(source, /CURLOPT_FOLLOWLOCATION => false/);
});
