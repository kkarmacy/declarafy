// Audited annual-close, SUNAT interest and SPOT safety layer.
// Loaded after app.js so these functions intentionally replace legacy approximations.
(function (global) {
'use strict';
const money=v=>'S/ '+Number(v||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
const note=t=>'<div style="margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:12px;line-height:1.5">📌 '+t+'</div>';

function calcMoras(){
 const monto=Number(document.getElementById('moraMonto')?.value||0), fv=document.getElementById('moraFechaVen')?.value, fp=document.getElementById('moraFechaPago')?.value, box=document.getElementById('moraResult');
 if(!box)return;if(!(monto>0&&fv&&fp)){box.style.display='none';return}
 const d1=new Date(fv+'T00:00:00'),d2=new Date(fp+'T00:00:00'),dias=Math.floor((d2-d1)/86400000);
 box.style.display='block';
 if(dias<=0){box.innerHTML='<div class="sunat-api-result">✅ No se generan días de mora con las fechas ingresadas.</div>';return}
 // SUNAT has maintained TIM at 0.9% monthly / 0.03% daily since 2021-04-01 for MN.
 const daily=0.0003, interest=monto*daily*dias;
 box.innerHTML='<div class="sunat-api-result"><table><tr><th>Concepto</th><th>Resultado</th></tr><tr><td>Deuda base</td><td>'+money(monto)+'</td></tr><tr><td>Días calendario de mora</td><td>'+dias+'</td></tr><tr><td>TIM diaria usada</td><td>0.03%</td></tr><tr><td>Interés simple referencial</td><td><strong>'+money(interest)+'</strong></td></tr><tr><td>Total referencial</td><td><strong>'+money(monto+interest)+'</strong></td></tr></table>'+note('SUNAT: TIM mensual 0.9% y diaria 0.03% desde 01/04/2021. Este estimador no sustituye la liquidación SUNAT ni agrega multas/gradualidad automáticamente.')+'</div>';
}

function calcTim(){
 const year=Number(document.getElementById('tim_anio')?.value||0),mi=Number(document.getElementById('tim_mes_ini')?.value||1),mf=Number(document.getElementById('tim_mes_fin')?.value||12),debt=Number(document.getElementById('tim_deuda')?.value||0),box=document.getElementById('timHistResult');
 if(!box)return;if(!(debt>0&&mi<=mf)){box.style.display='none';return}
 if(year<2021 || (year===2021&&mi<4)){box.style.display='block';box.innerHTML='<div class="sunat-api-result">⚠️ Este período requiere una tabla histórica por fecha de vigencia. Para evitar una tasa inventada, esta versión no calcula períodos anteriores al 1 de abril de 2021.</div>';return}
 const months=mf-mi+1, monthly=.009, interest=debt*monthly*months;
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><th>Período</th><th>TIM</th><th>Estimación</th></tr><tr><td>'+months+' mes(es) de '+year+'</td><td>0.9% mensual</td><td>'+money(interest)+'</td></tr><tr><td>Deuda base</td><td colspan="2">'+money(debt)+'</td></tr><tr><td>Total referencial</td><td colspan="2"><strong>'+money(debt+interest)+'</strong></td></tr></table>'+note('La TIM no debe inferirse por año completo cuando hubo cambios de vigencia. Para períodos desde 01/04/2021 se usa 0.9% mensual; períodos anteriores quedan bloqueados hasta incorporar la tabla oficial por fecha.')+'</div>';
}

function calcCierreFiscal(){
 const y=Number(document.getElementById('cf_anio')?.value||2026),inc=Number(document.getElementById('cf_ingresos')?.value||0),cost=Number(document.getElementById('cf_costo')?.value||0),exp=Number(document.getElementById('cf_gastos')?.value||0),igv=Number(document.getElementById('cf_igv')?.value||0),paid=Number(document.getElementById('cf_ir_pagado')?.value||0),credits=Number(document.getElementById('cf_percepciones')?.value||0),box=document.getElementById('cfResult');
 if(!box)return;if(inc<=0){box.style.display='none';return}
 const accounting=inc-cost-exp;
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><th colspan="2">📊 Pre-cierre fiscal '+y+'</th></tr><tr><td>Ingresos</td><td>'+money(inc)+'</td></tr><tr><td>Costos + gastos ingresados</td><td>'+money(cost+exp)+'</td></tr><tr><td>Resultado contable preliminar</td><td><strong>'+money(accounting)+'</strong></td></tr><tr><td>IGV mensual informado × 12</td><td>'+money(igv*12)+'</td></tr><tr><td>Pagos IR informados</td><td>'+money(paid)+'</td></tr><tr><td>Percepciones/créditos informados</td><td>'+money(credits)+'</td></tr></table>'+note('No se calcula automáticamente el IR anual aplicando 29.5% al resultado contable. La renta imponible exige conciliación tributaria (adiciones, deducciones, pérdidas, régimen y créditos). Este módulo ahora funciona como pre-cierre y evita presentar una deuda fiscal ficticia.')+'</div>';
}

function calcExonDetraccion(){
 const amount=Number(document.getElementById('exon_monto')?.value||0),type=document.getElementById('exon_tipo')?.value||'',cat=document.getElementById('exon_categoria')?.value||'',box=document.getElementById('exonResult');
 if(!box)return;if(amount<=0){box.style.display='none';return}
 box.style.display='block';
 box.innerHTML='<div class="sunat-api-result"><div style="font-weight:700;margin-bottom:8px">🔎 Validación SPOT requerida</div><p>Operación: <strong>'+type+'</strong> · categoría declarada: <strong>'+cat+'</strong> · importe: <strong>'+money(amount)+'</strong>.</p><p>DeclaraFY no asignará una tasa ni una “exoneración” solo por estas tres variables. El SPOT depende del bien/servicio exacto, anexo y numeral aplicable, comprobante, importe y supuestos de excepción vigentes.</p>'+note('Fuente normativa: D.Leg. 940 y R.S. 183-2004/SUNAT y modificatorias. Para servicios del Anexo 3, SUNAT indica como regla general operaciones mayores a S/ 700; las tasas dependen de la definición concreta. Verifica el apéndice SUNAT vigente antes del depósito.')+'</div>';
}

function install(){global.calcMoras=calcMoras;global.calcTim=calcTim;global.calcCierreFiscal=calcCierreFiscal;global.calcExonDetraccion=calcExonDetraccion;}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})(window);
