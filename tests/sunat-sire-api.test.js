'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const api = read('api/index.php');
const sire = read('api/sunat-sire.php');
const app = read('app.js');
const html = read('index.html');
const client = read('server-api.js');

test('SIRE endpoints are authenticated, POST-only, rate-limited and separated from other SUNAT services', () => {
  const route = api.slice(api.indexOf("case 'sunat_sire_periods':"), api.indexOf("default:", api.indexOf("case 'sunat_sire_periods':")));
  assert.match(route, /require_method\('POST'\)/);
  assert.match(route, /require_user\(\)/);
  assert.match(route, /rate_limit\(\$pdo, 'sunat_sire', 12, 60\)/);
  assert.match(api, /require_once __DIR__ \. '\/sunat-sire\.php'/);
  for (const action of ['sunat_sire_periods', 'sunat_sire_proposal', 'sunat_sire_ticket_status', 'sunat_sire_download']) {
    assert.match(api, new RegExp("case '" + action + "':"));
  }
});

test('SIRE OAuth uses the official SIRE scope and SOL password grant', () => {
  assert.match(sire, /grant_type' => 'password'/);
  assert.match(sire, /scope' => 'https:\/\/api-sire\.sunat\.gob\.pe/);
  assert.match(sire, /https:\/\/api-sire\.sunat\.gob\.pe/);
  assert.match(sire, /clientessol/);
  assert.match(sire, /\$credentials\['ruc'\] \. ' ' \. \$credentials\['solUser'\]/);
});

test('SIRE credentials are request-scoped and are not persisted or returned', () => {
  assert.match(sire, /function sunat_sire_credentials/);
  assert.match(sire, /profileRuc !== '' && !hash_equals/);
  assert.doesNotMatch(sire, /INSERT INTO|UPDATE user_kv|user_documents|localStorage/);
  assert.doesNotMatch(sire, /error_log\([^\n]*(?:clientSecret|solPassword|access_token)/);
  assert.doesNotMatch(sire, /'access_token'\s*=>/);
});

test('SIRE outbound requests are server-side, HTTPS-only, TLS-verified and do not follow redirects', () => {
  assert.match(sire, /CURLOPT_SSL_VERIFYPEER => true/);
  assert.match(sire, /CURLOPT_SSL_VERIFYHOST => 2/);
  assert.match(sire, /CURLOPT_FOLLOWLOCATION => false/);
  assert.ok(sire.includes("str_contains($path, '://')"));
  assert.match(sire, /api-sire\.sunat\.gob\.pe' \. \$path/);
});

test('only RVIE and RCE book codes and documented read-only SIRE routes are exposed', () => {
  assert.match(sire, /'rvie'.*'140000'/s);
  assert.match(sire, /'rce'.*'080000'/s);
  assert.match(sire, /padron\/web\/omisos/);
  assert.match(sire, /exportapropuesta/);
  assert.match(sire, /exportacioncomprobantepropuesta/);
  assert.match(sire, /consultaestadotickets/);
  assert.match(sire, /archivoreporte/);
  assert.doesNotMatch(sire, /registrarpreliminar|aceptarpropuesta|reemplazarpropuesta|upload/);
});

test('SIRE downloads are bounded, temporary, sanitized and never cached', () => {
  assert.match(sire, /100 \* 1024 \* 1024/);
  assert.match(sire, /tempnam\(sys_get_temp_dir\(\), 'declarafy-sire-'/);
  assert.match(sire, /header\('Cache-Control: no-store, private'\)/);
  assert.match(sire, /header\('X-Content-Type-Options: nosniff'\)/);
  assert.match(sire, /@unlink\(\$tmp\)/);
  assert.match(sire, /preg_match\('\/\^\[A-Za-z0-9_.-\]\{1,200\}\$\//);
});

test('SIRE UI never writes credentials to browser storage and uses the authenticated API client', () => {
  assert.match(html, /id="sunatSireClientSecret" type="password"/);
  assert.match(html, /id="sunatSireSolPassword" type="password"/);
  assert.match(app, /declarafyApi\('sunat_sire_periods'/);
  assert.match(app, /declarafyApi\('sunat_sire_proposal'/);
  assert.match(app, /declarafyApi\('sunat_sire_ticket_status'/);
  assert.match(app, /declarafyDownloadApi\('sunat_sire_download'/);
  assert.doesNotMatch(app.slice(app.indexOf('function sunatSireCredentials'), app.indexOf('async function sunatSireLoadPeriods')), /localStorage|sessionStorage/);
  assert.match(client, /async function declarafyDownloadApi/);
});

test('SIRE UI offers both books and a ticket-to-download workflow', () => {
  assert.match(html, /value="rvie"/);
  assert.match(html, /value="rce"/);
  assert.match(html, /sunatSireLoadPeriods\(\)/);
  assert.match(html, /sunatSireRequestProposal\(\)/);
  assert.match(html, /sunatSireCheckTicket\(\)/);
  assert.match(html, /sunatSireDownloadProposal\(\)/);
});
