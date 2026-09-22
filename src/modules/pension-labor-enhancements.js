// Enhancements for pension and labor modules audited on 2026-09-17.
// Normative values are isolated here so they can be updated without rewriting calculators.
(function (global) {
  'use strict';

  const RULES = {
    updated: '2026-09-17',
    sources: {
      afp: 'SBS — Comisiones y primas del SPP, devengue 2026-09',
      asignacion: 'Ley 25129 / DS 035-90-TR / MTPE'
    },
    afp: {
      habitat: { nombre: 'Hábitat', flujo: 1.47, saldo: 1.25, seguro: 1.37 },
      integra: { nombre: 'Integra', flujo: 1.55, saldo: 0.78, seguro: 1.37 },
      prima: { nombre: 'Prima', flujo: 1.60, saldo: 1.25, seguro: 1.37 },
      profuturo: { nombre: 'Profuturo', flujo: 1.69, saldo: 0.68, seguro: 1.37 }
    },
    aporteAfp: 10,
    remuneracionMaxAsegurable: 12672.65,
    onp: 13
  };

  const money = value => 'S/ ' + Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = value => Number(value || 0).toFixed(2) + '%';

  function sourceNote(text) {
    return '<div class="module-source-note" style="margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:12px;line-height:1.5">📌 ' + text + '</div>';
  }

  function calcAfpComisiones() {
    const key = document.getElementById('afp_sel')?.value || 'prima';
    const rem = Number(document.getElementById('afp_rem')?.value || 0);
    const years = Number(document.getElementById('afp_anios')?.value || 0);
    const annualReturn = Number(document.getElementById('afp_rent')?.value || 0) / 100;
    const currentFund = Number(document.getElementById('afp_actual')?.value || 0);
    const box = document.getElementById('afpResult');
    if (!box) return;
    if (rem <= 0) { box.style.display = 'none'; return; }

    const afp = RULES.afp[key] || RULES.afp.prima;
    const insurable = Math.min(rem, RULES.remuneracionMaxAsegurable);
    const contribution = rem * RULES.aporteAfp / 100;
    const flowFee = rem * afp.flujo / 100;
    const insurance = insurable * afp.seguro / 100;
    const payrollDiscount = contribution + flowFee + insurance;

    let projected = currentFund;
    if (years > 0) {
      const months = Math.round(years * 12);
      const monthlyReturn = annualReturn > -1 ? Math.pow(1 + annualReturn, 1 / 12) - 1 : 0;
      for (let i = 0; i < months; i++) projected = projected * (1 + monthlyReturn) + contribution;
    }

    const rows = Object.entries(RULES.afp).map(([id, item]) => {
      const fee = rem * item.flujo / 100;
      const premium = insurable * item.seguro / 100;
      return '<tr' + (id === key ? ' style="font-weight:700"' : '') + '><td>' + item.nombre + (id === key ? ' ✓' : '') + '</td><td>' + pct(item.flujo) + '</td><td>' + pct(item.saldo) + '</td><td>' + pct(item.seguro) + '</td><td>' + money(contribution + fee + premium) + '</td></tr>';
    }).join('');

    box.style.display = 'block';
    box.innerHTML = '<div class="sunat-api-result"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin-bottom:12px">' +
      '<div class="pcard"><div class="pcard-lbl">Aporte al fondo</div><div class="pcard-val">' + money(contribution) + '</div></div>' +
      '<div class="pcard"><div class="pcard-lbl">Comisión flujo</div><div class="pcard-val">' + money(flowFee) + '</div></div>' +
      '<div class="pcard"><div class="pcard-lbl">Prima seguro</div><div class="pcard-val">' + money(insurance) + '</div></div>' +
      '<div class="pcard"><div class="pcard-lbl">Descuento estimado</div><div class="pcard-val">' + money(payrollDiscount) + '</div></div>' +
      '</div><div class="table-scroll" tabindex="0"><table><thead><tr><th>AFP</th><th>Flujo</th><th>Saldo anual</th><th>Seguro</th><th>Descuento mensual*</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (years > 0 ? '<div style="margin-top:12px"><strong>Proyección referencial del fondo:</strong> ' + money(projected) + ' en ' + years + ' años, usando la rentabilidad ingresada. No constituye promesa de rentabilidad.</div>' : '') +
      sourceNote('Parámetros SBS, devengue septiembre 2026. Aporte obligatorio: 10%. Prima: 1.37% hasta remuneración máxima asegurable de S/ 12,672.65. La comisión sobre saldo no se descuenta directamente de la remuneración mensual. *Comparación de descuento por flujo + seguro + aporte.') + '</div>';
  }

  function renderAfpVsOnp() {
    const host = document.getElementById('ptAfpComisiones');
    if (!host || document.getElementById('afpOnpComparison')) return;
    const section = document.createElement('div');
    section.id = 'afpOnpComparison';
    section.style.marginTop = '22px';
    section.innerHTML = '<div class="sec-title">💰 AFP vs ONP — Comparador de descuento</div>' +
      '<p style="font-size:14px;color:var(--muted)">Compara únicamente el descuento previsional estimado. No decide qué sistema es mejor ni proyecta una pensión ONP.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:500px"><div class="fi"><label for="afponp_rem">Remuneración mensual (S/)</label><input id="afponp_rem" type="number" min="0" step="0.01" placeholder="2500"></div><div class="fi"><label for="afponp_afp">AFP para comparar</label><select id="afponp_afp"><option value="habitat">Hábitat</option><option value="integra">Integra</option><option value="prima">Prima</option><option value="profuturo">Profuturo</option></select></div></div>' +
      '<button class="bp" type="button" id="afponp_calc">Comparar descuentos</button><div id="afponpResult" aria-live="polite" style="display:none;margin-top:12px"></div>';
    host.appendChild(section);
    section.querySelector('#afponp_calc').addEventListener('click', () => {
      const rem = Number(section.querySelector('#afponp_rem').value || 0);
      const key = section.querySelector('#afponp_afp').value;
      const out = section.querySelector('#afponpResult');
      if (rem <= 0) { out.style.display='block'; out.textContent='Ingresa una remuneración mayor a cero.'; return; }
      const a = RULES.afp[key];
      const insurance = Math.min(rem, RULES.remuneracionMaxAsegurable) * a.seguro / 100;
      const afp = rem * RULES.aporteAfp / 100 + rem * a.flujo / 100 + insurance;
      const onp = rem * RULES.onp / 100;
      out.style.display='block';
      out.innerHTML='<div class="sunat-api-result"><table><tr><th>Sistema</th><th>Descuento estimado</th><th>Qué representa</th></tr><tr><td>AFP ' + a.nombre + '</td><td><strong>' + money(afp) + '</strong></td><td>10% fondo + comisión flujo + seguro</td></tr><tr><td>ONP / SNP</td><td><strong>' + money(onp) + '</strong></td><td>13% de remuneración afecta</td></tr></table>' + sourceNote('Comparación informativa de aportes/descuentos. AFP y ONP tienen reglas distintas de pensión, acceso y prestaciones; una diferencia de descuento mensual no determina conveniencia.') + '</div>';
    });
  }

  function calcAsignacion() {
    const rmv = Number(document.getElementById('asig_rmv')?.value || 1130);
    const hijos = Number(document.getElementById('asig_hijos')?.value || 0);
    const ingreso = document.getElementById('asig_ingreso')?.value;
    const fecha = document.getElementById('asig_fecha')?.value;
    const box = document.getElementById('asigResult');
    if (!box) return;
    if (rmv <= 0 || hijos <= 0) { box.style.display='none'; return; }

    // The statutory amount is one family allowance equal to 10% RMV; it is not multiplied by number of children.
    const monthly = rmv * 0.10;
    let months = null;
    if (ingreso && fecha) {
      const start = new Date(ingreso + 'T00:00:00');
      const end = new Date(fecha + 'T00:00:00');
      if (end >= start) months = Math.max(0, (end.getFullYear()-start.getFullYear())*12 + end.getMonth()-start.getMonth());
    }

    box.style.display='block';
    box.innerHTML='<div class="sunat-api-result"><table><tr><th>Concepto</th><th>Resultado</th></tr>' +
      '<tr><td>RMV ingresada</td><td>' + money(rmv) + '</td></tr><tr><td>Asignación familiar mensual (10% RMV)</td><td><strong>' + money(monthly) + '</strong></td></tr>' +
      '<tr><td>Hijos informados</td><td>' + hijos + '</td></tr>' +
      (months !== null ? '<tr><td>Referencia acumulada (' + months + ' meses)</td><td>' + money(monthly * months) + '</td></tr>' : '') +
      '</table>' + sourceNote('Ley 25129 y DS 035-90-TR: el beneficio equivale al 10% de la RMV. No se multiplica por cada hijo y no se condiciona a un tope salarial. Debe verificarse que el trabajador cumpla los requisitos y haya acreditado la carga familiar.') + '</div>';
  }

  function calcProyAfp() {
    const age=Number(document.getElementById('proy_edad')?.value||0),retire=Number(document.getElementById('proy_jub')?.value||65),salary=Number(document.getElementById('proy_sueldo')?.value||0),growth=Number(document.getElementById('proy_crec')?.value||0)/100,annual=Number(document.getElementById('proy_rent')?.value||0)/100,current=Number(document.getElementById('proy_fondo')?.value||0),box=document.getElementById('proyAfpResult');
    if(!box)return;if(!(salary>0&&age>0&&retire>=age)){box.style.display='none';return}
    const years=Math.max(0,retire-age),months=Math.round(years*12),monthly=annual>-1?Math.pow(1+annual,1/12)-1:0;let fund=current,monthlySalary=salary;
    for(let m=0;m<months;m++){fund=fund*(1+monthly)+monthlySalary*RULES.aporteAfp/100;if((m+1)%12===0)monthlySalary*=1+growth;}
    box.style.display='block';box.innerHTML='<div class="sunat-api-result"><table><tr><td>Años de proyección</td><td>'+years+'</td></tr><tr><td>Aporte inicial referencial (10%)</td><td>'+money(salary*.10)+'</td></tr><tr><td>Fondo matemático proyectado</td><td><strong>'+money(fund)+'</strong></td></tr></table>'+sourceNote('Proyección matemática basada únicamente en saldo inicial, aporte obligatorio, crecimiento salarial y rentabilidad ingresada. Se retiró la conversión automática del fondo a una “pensión estimada” usando una regla fija de 4%, porque la pensión real depende de modalidad, condiciones, beneficiarios, tasas y reglas vigentes al momento de jubilarse. No constituye promesa de rentabilidad ni de pensión.')+'</div>';
  }

  function annotateAsignacion() {
    const host=document.getElementById('ptAsignacionFam');
    if (!host || host.dataset.auditEnhanced) return;
    host.dataset.auditEnhanced='true';
    const p=host.querySelector('p');
    if (p) p.textContent='Calcula la asignación familiar legal equivalente al 10% de la RMV. El monto es único por trabajador beneficiario y no se multiplica por el número de hijos.';
    const sueldo=document.getElementById('asig_sueldo')?.closest('.fi');
    if (sueldo) sueldo.style.display='none';
  }

  function install() {
    global.DeclarafyNormativeRules = RULES;
    global.calcAfpComisiones = calcAfpComisiones;
    global.calcAsignacion = calcAsignacion;
    global.calcProyAfp = calcProyAfp;
    renderAfpVsOnp();
    annotateAsignacion();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})(window);
