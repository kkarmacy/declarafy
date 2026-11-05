export type Plan = 'free' | 'professional' | 'enterprise';
export type Feature = 'ai-fiscal' | 'calendar' | 'ruc' | 'calculators' | 'tim' | 'installments';
// Provisional UI fallback only. PHP must enforce authoritative permissions.
const order: Record<Plan, number> = { free: 0, professional: 1, enterprise: 2 };
const minimum: Record<Feature, Plan> = { 'ai-fiscal': 'professional', calendar: 'free', ruc: 'free', calculators: 'free', tim: 'professional', installments: 'professional' };
export function normalizePlan(value?: string): Plan {
  const p = (value || 'basico').trim().toLowerCase();
  if (p === 'empresa' || p === 'enterprise') return 'enterprise';
  if (p === 'pro' || p === 'professional' || p === 'profesional') return 'professional';
  return 'free';
}
export function canUseFeature(planValue: string | undefined, feature: Feature, serverFeatures?: string[]) {
  if (Array.isArray(serverFeatures)) return serverFeatures.includes(feature);
  return order[normalizePlan(planValue)] >= order[minimum[feature]];
}
export function displayPlan(planValue?: string) {
  const p = normalizePlan(planValue);
  return p === 'enterprise' ? 'Empresa' : p === 'professional' ? 'Pro' : 'Básico';
}
