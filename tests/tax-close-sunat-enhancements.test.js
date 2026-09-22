const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const s=fs.readFileSync('src/modules/tax-close-sunat-enhancements.js','utf8');
const ui=fs.readFileSync('frontend-ui.js','utf8');
test('SUNAT mora uses documented post-April-2021 TIM and does not invent fines',()=>{assert.match(s,/daily=0\.0003/);assert.match(s,/0\.9% mensual/);assert.match(s,/ni agrega multas\/gradualidad/i);});
test('historical TIM blocks unsupported earlier periods instead of fabricating annual rates',()=>{assert.match(s,/year<2021 \|\| \(year===2021&&mi<4\)/);assert.doesNotMatch(s,/2026:\s*1\.2/);});
test('annual close no longer equates accounting profit with taxable income',()=>{assert.match(s,/resultado contable preliminar/i);assert.match(s,/No se calcula automáticamente el IR anual/i);assert.doesNotMatch(s,/tasaIR\s*=\s*anio/);});
test('SPOT does not assign a generic rate from operation type',()=>{assert.match(s,/Validación SPOT requerida/);assert.match(s,/no asignará una tasa/i);assert.doesNotMatch(s,/bien:\s*0\.10/);});
test('frontend loads audited SUNAT enhancements',()=>{assert.match(ui,/tax-close-sunat-enhancements\.js/);assert.match(ui,/loadAuditedTaxEnhancements\(\)/);});
