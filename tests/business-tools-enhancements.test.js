const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const s=fs.readFileSync('src/modules/business-tools-enhancements.js','utf8'),ui=fs.readFileSync('frontend-ui.js','utf8');
test('agrarian/MYPE calculator no longer hardcodes obsolete burden percentages',()=>{assert.match(s,/Ley 31110/);assert.doesNotMatch(s,/remMensual \* 0\.15/);assert.doesNotMatch(s,/essalud = remMensual/);});
test('arbitrios no longer fabricates municipal tariffs',()=>{assert.match(s,/no genera un importe usando tarifas municipales ficticias/i);assert.doesNotMatch(s,/ARBITRIOS_RATES/);});
test('compensation is explicitly a simulation pending SUNAT recognition',()=>{assert.match(s,/simulación matemática/i);assert.match(s,/SUNAT debe reconocer/i);});
test('bank reconciliation and rate converter have functional workspaces',()=>{assert.match(s,/ptConciliacion/);assert.match(s,/Saldo banco ajustado/);assert.match(s,/ptConversorTasas/);assert.match(s,/Math\.pow\(1\+annual,1\/n2\)/);});
test('frontend loads business enhancements',()=>{assert.match(ui,/business-tools-enhancements\.js/);assert.match(ui,/loadAuditedBusinessEnhancements\(\)/);});

test('standalone reconciliation and rate converter are reachable from navigation',()=>{assert.match(src,/ensureNav\('concil_banc'/);assert.match(src,/ensureNav\('conversor_tasas'/);});

test('reconciliation panel id matches concil_banc router key',()=>{assert.match(s,/mount\('ptConcilBanc'/);assert.match(s,/ensureNav\('concil_banc'/);});
