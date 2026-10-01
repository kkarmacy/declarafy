import { apiRequest } from './client';

// The PHP backend uses an HttpOnly session cookie. The local signed-in marker
// is not an access token and must never be sent as a Bearer credential.
const sessionOptions = { credentials: 'include' as const };
export type RucResult = { ruc: string; razonSocial?: string; estado?: string; condicion?: string; direccion?: string };
export type CalendarItem = { id: string | number; title: string; date: string; description?: string };
export async function fetchRuc(ruc: string) {
  return apiRequest<RucResult>(`/ruc/${encodeURIComponent(ruc)}`, sessionOptions);
}
export async function fetchCalendar() {
  return apiRequest<CalendarItem[]>('/calendar', sessionOptions);
}
export async function askFiscalAI(message: string) {
  return apiRequest<{ answer: string }>('/ai/fiscal', { ...sessionOptions, method: 'POST', body: JSON.stringify({ message }) });
}
export async function fetchTaxParameters() {
  return apiRequest<{ timMonthly?: number; updatedAt?: string }>('/tax/parameters', sessionOptions);
}
