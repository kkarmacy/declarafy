export type Plan='free'|'professional'|'enterprise';
export type Feature='ai-fiscal'|'calendar'|'ruc'|'calculators'|'tim'|'installments';
const order:Record<Plan,number>={free:0,professional:1,enterprise:2};
const minimum:Record<Feature,Plan>={'ai-fiscal':'professional',calendar:'free',ruc:'free',calculators:'free',tim:'professional',installments:'professional'};
export function normalizePlan(value?:string):Plan{const p=(value||'free').trim().toLowerCase();if(p.includes('enterprise'))return'enterprise';if(p.includes('professional')||p.includes('profesional'))return'professional';return'free';}
export function canUseFeature(planValue:string|undefined,feature:Feature){return order[normalizePlan(planValue)]>=order[minimum[feature]];}
export function displayPlan(planValue?:string){const p=normalizePlan(planValue);return p==='enterprise'?'Enterprise':p==='professional'?'Professional':'Free';}
