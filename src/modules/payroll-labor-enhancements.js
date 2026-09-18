// Audited payroll/labor safety layer.
(function(global){'use strict';
const money=v=>'S/ '+Number(v||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
const note=t=>'<div style="margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:12px;line-height:1.5">📌 '+t+'</div>';

function calcNomina(){
 const gross=Number(document.getElementById('nomBruto')?.value||0),days=Math.min(30,Math.max(0,Number(document.getElementById('nomDias')?.value||30))),bonus=Number(document.getElementById('nomBono')?.value||0),box=document.getElementById('nomResult');if(!box)return;if(gross<=0){box.style.display='none';return}
 const proportional=(gross+bonus)/30*days,essalud=proportional*.09;
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><th>Concepto</th><th>Monto</th></tr><tr><td>Remuneración computada ('+days+' días)</td><td>'+money(proportional)+'</td></tr><tr><td>EsSalud empleador (9%)</td><td>'+money(essalud)+'</td></tr><tr><td>Costo parcial antes de otros conceptos</td><td><strong>'+money(proportional+essalud)+'</strong></td></tr></table>'+note('No se descuenta un AFP genérico de 13%. Para obtener neto de trabajador deben seleccionarse AFP/comisión/seguro u ONP y calcular, cuando corresponda, IR de quinta categoría y otros conceptos de planilla.')+'</div>';
}

function calcHorasExtras(){
 const salary=Number(document.getElementById('he_sueldo')?.value||0),hours=Number(document.getElementById('he_horas')?.value||0),days=Number(document.getElementById('he_dias')?.value||0),box=document.getElementById('heResult');if(!box)return;if(!(salary>0&&hours>0&&days>0)){box.style.display='none';return}
 const ordinary=salary/30/8,first=Math.min(2,hours),rest=Math.max(0,hours-2),perDay=ordinary*1.25*first+ordinary*1.35*rest,total=perDay*days;
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><td>Valor hora ordinaria referencial</td><td>'+money(ordinary)+'</td></tr><tr><td>Primeras 2 horas/día (+25%)</td><td>'+money(ordinary*1.25*first*days)+'</td></tr><tr><td>Horas siguientes (+35%)</td><td>'+money(ordinary*1.35*rest*days)+'</td></tr><tr><td><strong>Total horas extra</strong></td><td><strong>'+money(total)+'</strong></td></tr></table>'+note('D.Leg. 854: sobretasa mínima de 25% para las dos primeras horas y 35% para las siguientes. Se retiraron las opciones genéricas “nocturna 100%” y “dominical 200%”, porque descanso semanal, feriados y trabajo nocturno tienen reglas propias.')+'</div>';
}

function calcTRegistro(){
 const doc=document.getElementById('treg_doc')?.value||'',num=(document.getElementById('treg_num')?.value||'').trim(),start=document.getElementById('treg_ingreso')?.value||'',pension=document.getElementById('treg_pension')?.value||'',box=document.getElementById('tregResult');if(!box)return;if(!num||!start){box.style.display='none';return}
 const format=doc==='DNI'?/^\d{8}$/.test(num):num.length>=5;
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><td>Documento</td><td>'+doc+' '+(format?'✓ formato válido':'⚠ revisar formato')+'</td></tr><tr><td>Fecha de ingreso</td><td>'+start+'</td></tr><tr><td>Régimen pensionario declarado</td><td>'+pension+'</td></tr></table>'+note('Este módulo valida consistencia de datos, no confirma alta en T-Registro. Se retiró el texto fijo “5 días hábiles”: los plazos dependen del tipo de alta/registro y deben verificarse en SUNAT según la operación.')+'</div>';
}

function calcEssaludSenati(){
 const sector=document.getElementById('ess_sector')?.value||'',payroll=Number(document.getElementById('ess_planilla')?.value||0),construction=Number(document.getElementById('ess_construccion')?.value||0),box=document.getElementById('essResult');if(!box)return;if(payroll<=0){box.style.display='none';return}
 const essalud=sector==='agrario'?null:payroll*.09,senati=sector==='industrial'?payroll*.0075:null;
 box.style.display='';box.innerHTML='<div class="res-table"><table><tr><td>Planilla informada</td><td>'+money(payroll)+'</td></tr><tr><td>EsSalud</td><td>'+(essalud===null?'Requiere tasa del régimen agrario vigente':money(essalud)+' (9%)')+'</td></tr><tr><td>SENATI</td><td>'+(senati===null?'Verificar actividad/afectación':money(senati)+' (0.75% referencial para actividad industrial afecta)')+'</td></tr>'+(construction>0?'<tr><td>Base construcción informada</td><td>'+money(construction)+'</td></tr>':'')+'</table>'+note('Se eliminaron SENCICO y SCTR calculados con porcentajes genéricos no sustentados. SCTR depende de actividad de riesgo, cobertura y condiciones; SENCICO tiene su propia base y reglas.')+'</div>';
}

function addBenefitsWorkspace(){
 const host=document.getElementById('ptNomina');if(!host||document.getElementById('laborBenefitsAudit'))return;
 const s=document.createElement('section');s.id='laborBenefitsAudit';s.style.marginTop='24px';s.innerHTML='<div class="sec-title">🎁 CTS / Gratificaciones — Preliquidación</div><p style="color:var(--muted);font-size:14px">Preliquidación para régimen laboral general. Permite revisar componentes antes de preparar el cálculo legal definitivo.</p><div class="grid2"><div class="fi"><label for="lb_rem">Remuneración computable (S/)</label><input id="lb_rem" type="number" min="0" step="0.01"></div><div class="fi"><label for="lb_months">Meses computables del semestre</label><input id="lb_months" type="number" min="0" max="6" value="6"></div></div><button class="bp" id="lb_calc">Precalcular</button><div id="lbResult" style="display:none;margin-top:12px" aria-live="polite"></div>';host.appendChild(s);
 s.querySelector('#lb_calc').onclick=()=>{const rem=Number(s.querySelector('#lb_rem').value||0),m=Math.min(6,Math.max(0,Number(s.querySelector('#lb_months').value||0))),out=s.querySelector('#lbResult');if(rem<=0)return;const grat=rem*m/6,bonus=grat*.09,cts=rem*m/12;out.style.display='block';out.innerHTML='<div class="sunat-api-result"><table><tr><td>Gratificación proporcional base</td><td>'+money(grat)+'</td></tr><tr><td>Bonificación extraordinaria 9%*</td><td>'+money(bonus)+'</td></tr><tr><td>CTS base simplificada</td><td>'+money(cts)+'</td></tr></table>'+note('*Para trabajadores cubiertos por EsSalud. EPS y componentes computables pueden modificar el resultado. CTS requiere incorporar, según corresponda, 1/6 de gratificación y otros conceptos computables; por eso se presenta como preliquidación, no como depósito definitivo.')+'</div>';};
}
function install(){global.calcNomina=calcNomina;global.calcHorasExtras=calcHorasExtras;global.calcTRegistro=calcTRegistro;global.calcEssaludSenati=calcEssaludSenati;addBenefitsWorkspace();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})(window);
