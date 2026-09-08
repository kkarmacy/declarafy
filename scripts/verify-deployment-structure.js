'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function fail(message) {
  console.error(`Deployment verification failed: ${message}`);
  process.exitCode = 1;
}

const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(src => !/^(?:https?:)?\/\//i.test(src));

for (const src of localScripts) {
  const cleanPath = src.split(/[?#]/, 1)[0].replace(/^\//, '');
  if (!cleanPath || !fs.existsSync(path.join(root, cleanPath))) fail(`index.html references missing local script: ${src}`);
}

for (const required of [
  'api/index.php', 'api/bootstrap.php', 'api/schema.sql', 'api/config.sample.php',
  'api/.htaccess', 'server-api.js', 'reset-password.html'
]) {
  if (!fs.existsSync(path.join(root, required))) fail(`missing Namecheap deployment file: ${required}`);
}

if (fs.existsSync(path.join(root, 'api/config.local.php'))) fail('api/config.local.php must never be committed or included in a release');

const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
if (!/^api\/config\.local\.php$/m.test(gitignore)) fail('api/config.local.php is not ignored by Git');

const htaccess = fs.readFileSync(path.join(root, 'api/.htaccess'), 'utf8');
if (!/config\\\.local\\\.php/.test(htaccess)) fail('api/.htaccess does not protect config.local.php');

if (!process.exitCode) console.log(`Namecheap deployment structure verified: ${localScripts.length} local scripts and protected PHP/MySQL backend.`);
