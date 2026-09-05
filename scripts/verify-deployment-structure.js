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
  .filter(src => !/^(?:https?:)?\/\//i.test(src));

for (const src of localScripts) {
  const cleanPath = src.split(/[?#]/, 1)[0].replace(/^\//, '');
  if (!cleanPath || !fs.existsSync(path.join(root, cleanPath))) {
    fail(`index.html references missing local script: ${src}`);
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
  console.log(`Deployment structure verified: ${localScripts.length} local scripts and ${requiredExports.length} required function exports.`);
}
