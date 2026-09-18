const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.readFileSync('src/modules/income-regime-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('annual return no longer applies one deduction formula to all categories',()=>{assert.match(s,/no se aplica una única fórmula/i);assert.doesNotMatch(s,/rNet-=7\*uit/);});
test('regime selector does not rank a best tax regime',()=>{assert.match(s,/ya no ordena regímenes por “menor impuesto”/);assert.doesNotMatch(s,/regimenes\.sort/);});
test('NRUS category is not represented as eligibility decision',()=>{assert.match(s,/no confirma acogimiento al NRUS/i);});
test('loss carryforward requires Art 50 system selection',()=>{assert.match(s,/Sistema A y Sistema B/);assert.doesNotMatch(s,/ing\*lim/);});
test('suspension does not infer labor effects from label',()=>{assert.match(s,/No se concluye automáticamente/);});
test('RMT vs RER workspace exists',()=>{assert.match(s,/rmtRerAudit/);assert.match(s,/RMT vs RER/);});
test('frontend loads income regime audit layer',()=>{assert.match(ui,/income-regime-enhancements\.js/);});
