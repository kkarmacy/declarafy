const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.readFileSync('src/modules/accounting-tax-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('cash flow removes fabricated seasonality factors',()=>{assert.match(s,/antigua estacionalidad prefabricada fue retirada/i);assert.doesNotMatch(s,/jul_dic/);});
test('dividend and ITF assumptions are explicit',()=>{assert.match(s,/rate=\.05/);assert.match(s,/rate=\.00005/);assert.match(s,/operaciones exoneradas/i);});
test('fifth category does not deduct pension contribution from taxable base',()=>{assert.match(s,/gross-7\*uit/);assert.doesNotMatch(s,/aportePrevisional/);assert.match(s,/AFP\/ONP no se deducen/i);});
test('frontend loads accounting tax layer',()=>{assert.match(ui,/accounting-tax-enhancements\.js/);assert.match(ui,/loadAuditedAccountingTaxEnhancements\(\)/);});
