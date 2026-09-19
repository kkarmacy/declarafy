const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.readFileSync('src/modules/final-safety-enhancements.js','utf8'),trade=fs.readFileSync('src/modules/international-tax-trade-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('ONP does not invent pension or individual fund',()=>{assert.match(s,/Se retiró la pensión estimada/);assert.doesNotMatch(s,/pensionBase|fondoFinal/);});
test('credit notes remove fabricated ten percent sales cap',()=>{assert.match(s,/Se eliminó el supuesto límite general/);assert.doesNotMatch(s,/ventas\s*\*\s*0\.10/);});
test('inheritance removes percentage notarial registry costs',()=>{assert.match(s,/Se retiraron gastos notariales 1\.5%/);});
test('CPE local validation does not claim SUNAT acceptance',()=>{assert.match(s,/no confirma que un CPE exista/);});
test('WHT does not auto-apply treaty rate',()=>{assert.match(s,/No se aplica una tasa CDI automática/);assert.doesNotMatch(s,/retencionCDI\s*=/);});
test('import tax base is declared in strict mode',()=>{assert.match(trade,/duty=soles\*ad\/100,base=soles\+duty,igv=base\*\.18/);assert.doesNotMatch(trade,/;base=/);});
test('frontend loads final safety layer',()=>{assert.match(ui,/final-safety-enhancements\.js/);});

test('leasing override removes automatic tax shields and winner',()=>{assert.match(s,/function calcLeasing/);assert.match(s,/No se calcula escudo fiscal/);assert.doesNotMatch(s,/const mejor|costoL|escudoL/);});
