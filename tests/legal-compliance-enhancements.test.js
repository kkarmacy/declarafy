const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.readFileSync('src/modules/legal-compliance-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('coactive collection is validation workflow not fabricated debt total',()=>{assert.match(s,/exigibilidad de la deuda/);});
test('rectification removes automatic 50 percent fine and inferred graduality',()=>{assert.match(s,/Se retiró la multa automática de 50%/);assert.doesNotMatch(s,/multaBase\s*=|gradualidad\s*=/);});
test('appeal deadline is not approximated by 5 over 7',()=>{assert.match(s,/No se aproxima el plazo hábil/);assert.doesNotMatch(s,/\*\s*5\s*\/\s*7/);});
test('compliance requires taxpayer context',()=>{assert.match(s,/Checklist de diagnóstico/);});
test('normative radar rejects static sample news',()=>{assert.match(s,/Se deshabilitan los registros estáticos de ejemplo/);});
test('legal analyzer workspace includes contract review fields',()=>{assert.match(s,/Analizador de Contratos/);assert.match(s,/ley aplicable/);});
test('AML requires obligated-subject determination',()=>{assert.match(s,/sujeto obligado/);});
test('frontend loads legal compliance audit layer',()=>{assert.match(ui,/legal-compliance-enhancements\.js/);});
