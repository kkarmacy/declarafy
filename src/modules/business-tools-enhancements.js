// Audited business tools: agrarian/MYPE, municipal arbitrios, debt compensation,
// bank reconciliation and rate conversion.
(function(global){'use strict';
const money=v=>'S/ '+Number(v||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
const note=t=>'<div style="margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:12px;line-height:1.5">📌 '+t+'</div>';

function calcRegAgrario(){
 const salary=Number(document.getElementById('ra_sueldo')?.value||0),daily=Number(document.getElementById('ra_diario')?.value||0),days=Number(document.getElementById('ra_dias')?.value||0),reg=document.getElementById('ra_regimen')?.value||'',box=document.getElementById('raResult');
 if(!box)return;const monthly=salary||(daily*days);if(monthly<=0){box.style.display='none';return}
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><th>Dato</th><th>Resultado</th></tr><tr><td>Régimen seleccionado</td><td><strong>'+reg+'</strong></td></tr><tr><td>Remuneración informada</td><td>'+money(monthly)+'</td></tr></table>'+note('No se calcula una carga laboral/tributaria automática con porcentajes históricos. El régimen agrario vigente se rige por la Ley 31110 y MYPE exige identificar REMYPE y si corresponde micro o pequeña empresa. CTS, gratificaciones, EsSalud e IR deben calcularse según el régimen y período realmente aplicables.')+'</div>';
}

function calcArbitrios(){
 const district=document.getElementById('arbitrios_distrito')?.value||'',area=Number(document.getElementById('arbitrios_area')?.value||0),year=Number(document.getElementById('arbitrios_anio')?.value||new Date().getFullYear()),box=document.getElementById('arbitriosResult');
 if(!box)return;if(area<=0){box.style.display='none';return}
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><div style="font-weight:700">🏛️ Arbitrios municipales — validación de ordenanza</div><p>Distrito: <strong>'+district.replace(/_/g,' ')+'</strong> · Año: <strong>'+year+'</strong> · Área declarada: <strong>'+area+' m²</strong>.</p>'+note('DeclaraFY no genera un importe usando tarifas municipales ficticias. Limpieza pública, parques y jardines y serenazgo se determinan mediante ordenanzas de cada municipalidad, con criterios y costos propios por ejercicio. Ingresa o consulta la ordenanza vigente para obtener una liquidación válida.')+'</div>';
}

function calcCompensacion(){
 const credit=Number(document.getElementById('comp_saldo')?.value||0),debt=Number(document.getElementById('comp_deuda')?.value||0),interest=Number(document.getElementById('comp_intereses')?.value||0),type=document.getElementById('comp_tipo')?.value||'',box=document.getElementById('compensacionResult');
 if(!box)return;if(!(credit>0&&debt>0)){box.style.display='none';return}
 const total=debt+interest, potential=Math.min(credit,total);
 box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><th>Simulación</th><th>Monto</th></tr><tr><td>Crédito/saldo informado</td><td>'+money(credit)+'</td></tr><tr><td>Deuda '+type+' + intereses informados</td><td>'+money(total)+'</td></tr><tr><td>Compensación matemática potencial</td><td><strong>'+money(potential)+'</strong></td></tr><tr><td>Saldo de deuda potencial</td><td>'+money(Math.max(0,total-potential))+'</td></tr></table>'+note('Esta es una simulación matemática, no una compensación aprobada. SUNAT debe reconocer la coexistencia, exigibilidad y procedencia del crédito y la deuda conforme al Código Tributario y al procedimiento aplicable.')+'</div>';
}

function rateConvert(value,from,to,periods){
 const nominal={monthly:12,quarterly:4,semiannual:2,annual:1};
 const n1=nominal[from],n2=nominal[to];if(!n1||!n2)return null;
 const annual=Math.pow(1+value/100,n1)-1;
 return (Math.pow(1+annual,1/n2)-1)*100;
}
function installStandalone(){
 const nav=document.querySelector('.pnav');if(!nav)return;
 const ensureNav=(tab,label)=>{if(Array.from(nav.querySelectorAll('.pntab')).some(el=>(el.getAttribute('onclick')||'').includes("setPTab('"+tab+"'")))return;const b=document.createElement('button');b.type='button';b.className='pntab';b.textContent=label;b.setAttribute('onclick',"setPTab('"+tab+"',this)");nav.appendChild(b);};
 const mount=(id,title,html)=>{
   if(document.getElementById(id))return;
   const content=document.querySelector('#screen-panel > .pnav + div');if(!content)return;
   const sec=document.createElement('div');sec.id=id;sec.className='pbody';sec.style.display='none';sec.innerHTML='<h2>'+title+'</h2>'+html;content.appendChild(sec);
 };
 mount('ptConcilBanc','🏦 Conciliación bancaria','<p>Compara el saldo contable con el saldo bancario e identifica partidas pendientes.</p><div class="grid2"><div class="fi"><label for="cb_libros">Saldo según libros (S/)</label><input id="cb_libros" type="number" step="0.01"></div><div class="fi"><label for="cb_banco">Saldo según banco (S/)</label><input id="cb_banco" type="number" step="0.01"></div><div class="fi"><label for="cb_transito">Depósitos en tránsito (S/)</label><input id="cb_transito" type="number" step="0.01" value="0"></div><div class="fi"><label for="cb_cheques">Cheques/cargos pendientes (S/)</label><input id="cb_cheques" type="number" step="0.01" value="0"></div></div><button class="bp" id="cb_calc">Conciliar</button><div id="cbResult" style="display:none;margin-top:12px" aria-live="polite"></div>');
 ensureNav('concil_banc','🏦 Conciliación');
 const cb=document.getElementById('cb_calc');if(cb)cb.onclick=()=>{const l=Number(document.getElementById('cb_libros').value||0),b=Number(document.getElementById('cb_banco').value||0),d=Number(document.getElementById('cb_transito').value||0),ch=Number(document.getElementById('cb_cheques').value||0),adj=b+d-ch,diff=l-adj,o=document.getElementById('cbResult');o.style.display='block';o.innerHTML='<div class="sunat-api-result"><table><tr><td>Saldo banco ajustado</td><td>'+money(adj)+'</td></tr><tr><td>Diferencia vs libros</td><td><strong>'+money(diff)+'</strong></td></tr></table></div>';};
 mount('ptConversorTasas','🔄 Conversor de tasas','<p>Convierte tasas efectivas entre períodos mediante equivalencia financiera.</p><div class="grid2"><div class="fi"><label for="rt_val">Tasa (%)</label><input id="rt_val" type="number" step="0.0001"></div><div class="fi"><label for="rt_from">Período origen</label><select id="rt_from"><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option><option value="semiannual">Semestral</option><option value="annual">Anual</option></select></div><div class="fi"><label for="rt_to">Período destino</label><select id="rt_to"><option value="annual">Anual</option><option value="semiannual">Semestral</option><option value="quarterly">Trimestral</option><option value="monthly">Mensual</option></select></div></div><button class="bp" id="rt_calc">Convertir</button><div id="rtResult" style="display:none;margin-top:12px" aria-live="polite"></div>');
 ensureNav('conversor_tasas','🔄 Conversor Tasas');
 const rt=document.getElementById('rt_calc');if(rt)rt.onclick=()=>{const v=Number(document.getElementById('rt_val').value||0),r=rateConvert(v,document.getElementById('rt_from').value,document.getElementById('rt_to').value),o=document.getElementById('rtResult');o.style.display='block';o.innerHTML='<div class="sunat-api-result"><strong>Tasa equivalente: '+(r===null?'—':r.toFixed(4)+'%')+'</strong>'+note('Conversión matemática de tasas efectivas. No confundir con tasas nominales, TEA/TCEA contractuales o costos adicionales.')+'</div>';};
}
function install(){global.calcRegAgrario=calcRegAgrario;global.calcArbitrios=calcArbitrios;global.calcCompensacion=calcCompensacion;global.DeclarafyRateConvert=rateConvert;installStandalone();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})(window);
