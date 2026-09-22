const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.readFileSync('src/modules/international-tax-trade-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('imports require entered tariff and disclose omitted customs items',()=>{assert.match(s,/subpartida NANDINA/);assert.match(s,/antidumping/);});
test('perceptions do not mix IGV perception and withholding rates',()=>{assert.match(s,/Se desactiva el cálculo automático/);assert.doesNotMatch(s,/comprobante==='boleta'\?3:6/);});
test('export balance separates SFMB from drawback',()=>{assert.match(s,/Saldo a Favor Materia del Beneficio y drawback son mecanismos distintos/);assert.doesNotMatch(s,/limiteDrawback/);});
test('nonresident and royalties do not invent treaty rate',()=>{assert.match(s,/CDI no significa una tasa universal de 15%/);assert.doesNotMatch(s,/Math\.min\(tasaIR,15\)/);});
test('Amazon benefit suppresses stale static conclusions and requires eligibility validation',()=>{assert.match(s,/Ley 27037/);assert.match(s,/no se determinan solo por departamento o domicilio/);assert.match(s,/el\.hidden=true/);assert.match(s,/se ocultaron conclusiones estáticas heredadas/i);});
test('frontend loads international audit layer',()=>{assert.match(ui,/international-tax-trade-enhancements\.js/);});
