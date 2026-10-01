export type InstallmentResult={payment:number;total:number;interest:number};
export function simulateInstallments(principal:number,months:number,monthlyRatePct:number):InstallmentResult{
 if(principal<=0||months<=0||monthlyRatePct<0) throw new Error('Parámetros inválidos');
 const r=monthlyRatePct/100;
 const payment=r===0?principal/months:principal*(r*Math.pow(1+r,months))/(Math.pow(1+r,months)-1);
 const total=payment*months;
 return {payment,total,interest:total-principal};
}
export function calculateDailyInterest(principal:number,days:number,monthlyRatePct:number){
 if(principal<0||days<0||monthlyRatePct<0) throw new Error('Parámetros inválidos');
 return principal*(monthlyRatePct/100/30)*days;
}
