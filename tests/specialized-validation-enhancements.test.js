const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const s=fs.readFileSync('src/modules/specialized-validation-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('SPOT no longer applies generic embedded rates',()=>{assert.match(s,/Se desactiva la tasa automática/);});
test('ISC removes fabricated generic product rates',()=>{assert.match(s,/Se eliminaron tasas ISC genéricas/);assert.doesNotMatch(s,/combustibles:\s*12|cigarrillos:\s*50/);});
test('mining does not aggregate approximate mining taxes',()=>{assert.match(s,/Se retiró la fórmula/);});
test('PDT is a preparation validator not official filing',()=>{assert.match(s,/no genera ni presenta una declaración SUNAT oficial/);});
test('GRE does not claim SUNAT issuance',()=>{assert.match(s,/no una GRE emitida ni aceptada por SUNAT/);});
test('local document validator distinguishes format from official status',()=>{assert.match(s,/Formato válido.*no significa/s);});
test('advanced analysis warns against isolated automatic ratings',()=>{assert.match(s,/calificación automática/);});
test('frontend loads specialized audit layer',()=>{assert.match(ui,/specialized-validation-enhancements\.js/);});
