// Audited accounting and tax helpers: cash flow, dividends, ITF and 5th-category IR.
// These overrides avoid unsupported deductions and label assumptions explicitly.
(function(global){'use strict';
const money=v=>'S/ '+Number(v||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
const note=t=>'<div style="margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:12px;line-height:1.5">📌 '+t+'</div>';

function calcFlujoCaja(){
 const base=Number(document.getElementById('fc_ingresos')?.value||0),growth=Number(document.getElementById('fc_crecimiento')?.value||0)/100,fixed=Number(document.getElementById('fc_costos_fijos')?.value||0),variable=Number(document.getElementById('fc_costos_vars')?.value||0)/100,investment=Number(document.getElementById('fc_inversion')?.value||0),start=Number(document.getElementById('fc_mes')?.value||0),box=document.getElementById('fcResult');
 if(!box)return;if(base<=0){box.style.display='none';return}
 const months=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];let cash=-investment,rows='',incomeTotal=0,outTotal=0;
 for(let i=0;i<12;i++){const income=base*Math.pow(1+growth,i),out=fixed+income*variable,net=income-out;cash+=net;incomeTotal+=income;outTotal+=out;rows+='<tr><td>'+months[(start+i)%12]+'</td><td>'+money(income)+'</td><td>'+money(out)+'</td><td>'+money(net)+'</td><td>'+money(cash)+'</td></tr>'}
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><th>Mes</th><th>Ingresos</th><th>Salidas</th><th>Flujo neto</th><th>Acumulado</th></tr>'+rows+'<tr><td><strong>Total</strong></td><td>'+money(incomeTotal)+'</td><td>'+money(outTotal)+'</td><td><strong>'+money(incomeTotal-outTotal)+'</strong></td><td><strong>'+money(cash)+'</strong></td></tr></table>'+note('Proyección financiera basada únicamente en los supuestos ingresados. La antigua estacionalidad prefabricada fue retirada porque generaba escenarios sin datos del negocio.')+'</div>';
}

function calcDividendos(){
 const type=document.getElementById('div_tipo')?.value||'',amount=Number(document.getElementById('div_monto')?.value||0),year=document.getElementById('div_ejercicio')?.value||'',box=document.getElementById('dividendosResult');if(!box)return;if(amount<=0){box.style.display='none';return}
 let rate=null,label='';
 if(type==='natural'||type==='nodom'){rate=.05;label='Retención referencial 5%';}
 else if(type==='juridica'){rate=0;label='No se aplica automáticamente retención de dividendos entre personas jurídicas domiciliadas';}
 const withheld=rate===null?null:amount*rate;
 box.style.display='';box.innerHTML='<div class="res-table"><table><tr><td>Ejercicio informado</td><td>'+year+'</td></tr><tr><td>Dividendo bruto</td><td>'+money(amount)+'</td></tr><tr><td>Tratamiento usado</td><td>'+label+'</td></tr>'+(withheld===null?'':'<tr><td>Retención estimada</td><td>'+money(withheld)+'</td></tr><tr><td>Neto estimado</td><td><strong>'+money(amount-withheld)+'</strong></td></tr>')+'</table>'+note('La tasa general de dividendos distribuídos por personas jurídicas domiciliadas es 5% para personas naturales y no domiciliados bajo la LIR; convenios, reorganizaciones y otros supuestos requieren revisión específica.')+'</div>';
}

function calcItf(){
 const amount=Number(document.getElementById('itf_monto')?.value||0),ops=Math.max(1,Number(document.getElementById('itf_ops')?.value||1)),type=document.getElementById('itf_tipo')?.value||'',box=document.getElementById('itfResult');if(!box)return;if(amount<=0){box.style.display='none';return}
 const rate=.00005,total=amount*ops*rate;box.style.display='';box.innerHTML='<div class="res-table"><table><tr><td>Operación</td><td>'+type+'</td></tr><tr><td>Monto × operaciones</td><td>'+money(amount)+' × '+ops+'</td></tr><tr><td>Alícuota usada</td><td>0.005%</td></tr><tr><td>ITF estimado</td><td><strong>'+money(total)+'</strong></td></tr></table>'+note('Estimación solo para operaciones gravadas. La Ley 28194 contiene operaciones exoneradas; el tipo seleccionado por sí solo no acredita que la operación esté gravada o exonerada.')+'</div>';
}

function calcIr5ta(){
 const salary=Number(document.getElementById('ir5_sueldo')?.value||0),months=Number(document.getElementById('ir5_meses')?.value||12),grat=Number(document.getElementById('ir5_grati')?.value||0),bonus=Number(document.getElementById('ir5_bono')?.value||0),box=document.getElementById('ir5taResult');if(!box)return;if(salary<=0){box.style.display='none';return}
 const uit=(global.TAX_RULES&&global.TAX_RULES.uit&&global.TAX_RULES.uit[global.TAX_RULES.currentYear])||null;if(!uit){box.style.display='';box.innerHTML='<div class="sunat-api-result">No hay UIT verificada cargada para calcular el período.</div>';return}
 const gross=salary*months+grat+bonus,base=Math.max(0,gross-7*uit),bands=[[5,.08],[15,.14],[15,.17],[10,.20],[Infinity,.30]];let remaining=base,tax=0;
 for(const [units,rate] of bands){if(remaining<=0)break;const slice=Math.min(remaining,units===Infinity?remaining:units*uit);tax+=slice*rate;remaining-=slice}
 box.style.display='';box.innerHTML='<div class="res-table"><table><tr><td>Ingreso anual proyectado</td><td>'+money(gross)+'</td></tr><tr><td>Deducción automática</td><td>7 UIT = '+money(7*uit)+'</td></tr><tr><td>Renta neta proyectada</td><td>'+money(base)+'</td></tr><tr><td>IR anual estimado</td><td><strong>'+money(tax)+'</strong></td></tr></table>'+note('La proyección usa las escalas progresivas de quinta categoría. Los aportes AFP/ONP no se deducen de esta base como hacía la versión anterior. La retención mensual real depende del procedimiento de proyección y regularización del empleador.')+'</div>';
}
function install(){const season=document.getElementById('fc_estacionalidad');if(season){season.value='none';season.disabled=true;season.title='Estacionalidad automática deshabilitada: la proyección usa solo supuestos ingresados.';}global.calcFlujoCaja=calcFlujoCaja;global.calcDividendos=calcDividendos;global.calcItf=calcItf;global.calcIr5ta=calcIr5ta;}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})(window);
