const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('src/modules/pension-labor-enhancements.js', 'utf8');
const frontend = fs.readFileSync('frontend-ui.js', 'utf8');

test('AFP September 2026 parameters match the audited SBS table', () => {
  assert.match(source, /habitat:\s*\{[^}]*flujo:\s*1\.47[^}]*saldo:\s*1\.25[^}]*seguro:\s*1\.37/);
  assert.match(source, /integra:\s*\{[^}]*flujo:\s*1\.55[^}]*saldo:\s*0\.78[^}]*seguro:\s*1\.37/);
  assert.match(source, /prima:\s*\{[^}]*flujo:\s*1\.60[^}]*saldo:\s*1\.25[^}]*seguro:\s*1\.37/);
  assert.match(source, /profuturo:\s*\{[^}]*flujo:\s*1\.69[^}]*saldo:\s*0\.68[^}]*seguro:\s*1\.37/);
  assert.match(source, /remuneracionMaxAsegurable:\s*12672\.65/);
});

test('family allowance is one 10% RMV benefit and removes the former salary cap conclusion', () => {
  assert.match(source, /const monthly = rmv \* 0\.10/);
  assert.doesNotMatch(source, /rmv \* 2/);
  assert.match(source, /no se multiplica por cada hijo/);
});

test('AFP vs ONP comparator is installed and audited enhancements load from frontend startup', () => {
  assert.match(source, /afpOnpComparison/);
  assert.match(source, /onp:\s*13/);
  assert.match(frontend, /pension-labor-enhancements\.js/);
  assert.match(frontend, /loadAuditedModuleEnhancements\(\)/);
});
