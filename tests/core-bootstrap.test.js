'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'frontend-ui.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'src', 'core', 'core-loader.js'), 'utf8');

test('frontend lifecycle bootstraps the modular core without blocking legacy startup', () => {
  assert.match(frontend, /function bootstrapDeclarafyCore\(\)/);
  assert.match(frontend, /script\.src = '\/src\/core\/core-loader\.js'/);
  assert.match(frontend, /window\.DeclarafyCoreLoader\.load\(\)/);
  assert.match(frontend, /bootstrapDeclarafyCore\(\)\.catch/);
  assert.match(frontend, /installFrontendUsability\(\);/);
});

test('core loader preserves deterministic dependency order and signals readiness', () => {
  const expected = [
    '/src/core/company-context.js',
    '/src/core/module-result.js',
    '/src/core/module-registry.js',
    '/src/modules/financial-analysis.js',
    '/src/modules/case-workflow.js',
    '/src/modules/regulatory-center.js'
  ];
  let previous = -1;
  for (const file of expected) {
    const index = loader.indexOf(`'${file}'`);
    assert.ok(index > previous, `${file} must load in dependency order`);
    previous = index;
  }
  assert.match(loader, /declarafy:core-ready/);
});
