(function (global) {
  'use strict';
  const n = v => Number(v) || 0;
  const safe = (a,b) => b ? a/b : null;
  const round = v => v === null || !Number.isFinite(v) ? null : Math.round(v*10000)/10000;

  function analyze(input) {
    const x = input || {};
    const assets=n(x.totalAssets), currentAssets=n(x.currentAssets), currentLiabilities=n(x.currentLiabilities);
    const liabilities=n(x.totalLiabilities), equity=n(x.equity), revenue=n(x.revenue), netIncome=n(x.netIncome);
    const ebit=n(x.ebit), ebitda=n(x.ebitda), interest=n(x.interestExpense), inventory=n(x.inventory);
    const retained=n(x.retainedEarnings), workingCapital=currentAssets-currentLiabilities, marketEquity=n(x.marketEquity || equity);

    const ratios = {
      currentRatio: round(safe(currentAssets,currentLiabilities)),
      quickRatio: round(safe(currentAssets-inventory,currentLiabilities)),
      debtToAssets: round(safe(liabilities,assets)),
      debtToEquity: round(safe(liabilities,equity)),
      interestCoverage: round(safe(ebit,interest)),
      netMargin: round(safe(netIncome,revenue)),
      roa: round(safe(netIncome,assets)),
      roe: round(safe(netIncome,equity)),
      workingCapital: round(workingCapital),
      ebitda: round(ebitda)
    };

    // Classic public-manufacturing Altman formulation; caller must label applicability.
    const z = assets ? 1.2*(workingCapital/assets)+1.4*(retained/assets)+3.3*(ebit/assets)+0.6*(marketEquity/(liabilities||1))+1.0*(revenue/assets) : null;
    ratios.altmanZ = round(z);

    const alerts=[];
    if (ratios.currentRatio !== null && ratios.currentRatio < 1) alerts.push({severity:'high', code:'LIQUIDITY', message:'Liquidez corriente menor a 1.'});
    if (ratios.debtToAssets !== null && ratios.debtToAssets > 0.7) alerts.push({severity:'medium', code:'LEVERAGE', message:'Pasivos superiores al 70% de los activos.'});
    if (ratios.interestCoverage !== null && ratios.interestCoverage < 1.5) alerts.push({severity:'high', code:'COVERAGE', message:'Cobertura de intereses reducida.'});

    return { ratios, alerts, metadata:{ altmanModel:'classic-public-manufacturing', requiresProfessionalInterpretation:true } };
  }

  global.DeclarafyFinancialAnalysis={analyze};
  if (typeof module !== 'undefined' && module.exports) module.exports=global.DeclarafyFinancialAnalysis;
})(typeof window !== 'undefined' ? window : globalThis);
