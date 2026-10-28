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


const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('SUNAT authentication test is wired from the admin UI to the API action', () => {
  assert.match(html, /id="sunatAuthAdminTools"/);
  assert.match(html, /id="sunatAuthService"/);
  assert.match(html, /id="sunatAuthTestButton"[^>]*onclick="testSunatAuthService\(\)"/);
  assert.match(app, /async function testSunatAuthService\(\)/);
  assert.match(app, /declarafyApi\('sunat_auth_test',\s*\{\s*body:\s*\{\s*service\s*\}\s*\}\)/);
  for (const service of ['controlcpe', 'controlmsg', 'enviossp', 'programacion', 'documentossustentatorios', 'salida', 'autorizacionsalida', 'ingreso']) {
    assert.match(html, new RegExp('<option value="' + service + '">'));
  }
});

test('SUNAT digitalized documents leaves scope empty as shown in the official manual', () => {
  assert.match(
    allowlist,
    /'documentossustentatorios'\s*=>\s*\['name'\s*=>\s*'Transmisión de documentos digitalizados',\s*'scope'\s*=>\s*''\]/,
  );
});

test('generic SUNAT scope is explicitly marked provisional pending service-by-service evidence', () => {
  assert.match(source, /no se ha encontrado/);
  assert.match(source, /documentación oficial que confirme individualmente el scope genérico/);
  assert.match(source, /Tratar https:\/\/api\.sunat\.gob\.pe como provisional/);
});

test('all eight SUNAT authentication choices have scope values in the configured allowlist', () => {
  const entries = [...allowlist.matchAll(/'([a-z]+)'\s*=>\s*\['name'\s*=>\s*'[^']+',\s*'scope'\s*=>\s*'([^']*)'\]/g)];
  assert.equal(entries.length, 8, 'expected eight explicitly listed SUNAT services');
  for (const entry of entries) {
    const service = entry[1];
    const scope = entry[2];
    assert.ok(
      scope === '' || ['https://api-cpe.sunat.gob.pe', 'https://api.sunat.gob.pe'].includes(scope),
      'SUNAT service ' + service + ' must use an explicitly approved scope format',
    );
  }
});
