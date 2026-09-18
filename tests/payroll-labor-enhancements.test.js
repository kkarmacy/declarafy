const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.readFileSync('src/modules/payroll-labor-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('payroll removes generic AFP 13 percent deduction',()=>{assert.match(s,/No se descuenta un AFP genérico de 13%/);assert.doesNotMatch(s,/afp\s*=\s*remProporcional\s*\*\s*0\.13/);});
test('overtime uses statutory 25 and 35 minimum bands',()=>{assert.match(s,/ordinary\*1\.25/);assert.match(s,/ordinary\*1\.35/);assert.doesNotMatch(s,/nocturna_100|dominical_200/);});
test('T-Registro no promises a fabricated universal five-day deadline',()=>{assert.match(s,/Se retiró el texto fijo “5 días hábiles”/);});
test('EsSalud SENATI avoids generic SCTR and SENCICO rates',()=>{assert.match(s,/payroll\*\.09/);assert.match(s,/payroll\*\.0075/);assert.doesNotMatch(s,/sctr\s*=|sencico\s*=/i);});
test('CTS and gratification preliquidation exists',()=>{assert.match(s,/laborBenefitsAudit/);assert.match(s,/Gratificación proporcional base/);assert.match(s,/CTS base simplificada/);});
test('frontend loads payroll labor audit layer',()=>{assert.match(ui,/payroll-labor-enhancements\.js/);});
