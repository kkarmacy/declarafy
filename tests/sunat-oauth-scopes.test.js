'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.php'), 'utf8');
const start = source.indexOf("$sunatServices = [", source.indexOf("case 'sunat_auth_test':"));
const end = source.indexOf("\n        ];", start);
assert.notEqual(start, -1, 'SUNAT allowlist must exist');
assert.notEqual(end, -1, 'SUNAT allowlist must close');
const allowlist = source.slice(start, end);

test('SUNAT digitalized documents uses the SUNAT API base URI as OAuth scope', () => {
  assert.match(
    allowlist,
    /'documentossustentatorios'\s*=>\s*\['name'\s*=>\s*'Transmisión de documentos digitalizados',\s*'scope'\s*=>\s*'https:\/\/api\.sunat\.gob\.pe'\]/,
  );
});

test('all eight SUNAT authentication choices use a known API base scope', () => {
  const entries = [...allowlist.matchAll(/'([a-z]+)'\s*=>\s*\['name'\s*=>\s*'[^']+',\s*'scope'\s*=>\s*'([^']*)'\]/g)];
  assert.equal(entries.length, 8, 'expected eight explicitly listed SUNAT services');
  for (const entry of entries) {
    const service = entry[1];
    const scope = entry[2];
    assert.ok(
      ['https://api-cpe.sunat.gob.pe', 'https://api.sunat.gob.pe'].includes(scope),
      'SUNAT service ' + service + ' must use a known API base scope',
    );
  }
});
