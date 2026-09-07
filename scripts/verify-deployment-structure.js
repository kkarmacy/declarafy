'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const firebase = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function fail(message) {
  console.error(`Deployment verification failed: ${message}`);
  process.exitCode = 1;
}

const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(src => !/^(?:https?:)?\/\//i.test(src))
  // Reserved Firebase Hosting runtime configuration; not a repository file.
  .filter(src => src !== '/__/firebase/init.js');

for (const src of localScripts) {
  const cleanPath = src.split(/[?#]/, 1)[0].replace(/^\//, '');
  if (!cleanPath || !fs.existsSync(path.join(root, cleanPath))) {
    fail(`index.html references missing local script: ${src}`);
  }
}

const localStylesheets = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(src => !/^(?:https?:)?\/\//i.test(src));

for (const href of localStylesheets) {
  const cleanPath = href.split(/[?#]/, 1)[0].replace(/^\//, '');
  if (!cleanPath || !fs.existsSync(path.join(root, cleanPath))) {
    fail(`index.html references missing local stylesheet: ${href}`);
  }
}

const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const staticAssetsMatch = serviceWorker.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/);
if (!staticAssetsMatch) {
  fail('unable to find STATIC_ASSETS in sw.js');
} else {
  const assets = [...staticAssetsMatch[1].matchAll(/["']([^"']+)["']/g)].map(match => match[1]);
  for (const asset of assets) {
    if (asset === '/') continue;
    const cleanPath = asset.split(/[?#]/, 1)[0].replace(/^\//, '');
    if (!cleanPath || !fs.existsSync(path.join(root, cleanPath))) {
      fail(`sw.js references missing static asset: ${asset}`);
    }
  }
}

if (pkg.main !== 'final-index.js') {
  fail(`package.json main must be final-index.js, received ${pkg.main}`);
}

if (firebase.hosting?.public !== '.') {
  fail('this verifier expects Firebase Hosting public to be the repository root');
}

const hostingIgnore = new Set(firebase.hosting?.ignore || []);
for (const sensitivePath of [
  'index.js',
  'secure-index.js',
  'final-index.js',
  'package.json',
  'package-lock.json',
  'firestore.rules',
  'firestore.indexes.json',
  'scripts/**'
]) {
  if (!hostingIgnore.has(sensitivePath)) {
    fail(`Firebase Hosting must ignore backend/build path: ${sensitivePath}`);
  }
}

let exported;
try {
  exported = require(path.join(root, pkg.main));
} catch (error) {
  fail(`unable to load Cloud Functions entrypoint: ${error.stack || error.message}`);
}

const requiredExports = [
  'claudeProxy',
  'validarComprobante',
  'consultaRuc',
  'consultaBCRTiposCambio',
  'consultaSunatComprobantes',
  'consultaSBS',
  'sendWhatsAppAlert',
  'exportToGoogleSheets',
  'updateNotifPrefs',
  'callAlternativeAI',
  'scheduledDeadlineNotifications'
];

for (const name of requiredExports) {
  if (!exported || !exported[name]) {
    fail(`missing Cloud Function export: ${name}`);
  }
}

if (!process.exitCode) {
  console.log(`Deployment structure verified: ${localScripts.length} local scripts, ${localStylesheets.length} local stylesheets and ${requiredExports.length} required function exports.`);
}
