import { apiRequest } from './client';
import { getToken } from '../auth/session';

async function authHeaders(){
 const token=await getToken();
 return token?{Authorization:`Bearer ${token}`}:{};
}
export type RucResult={ruc:string;razonSocial?:string;estado?:string;condicion?:string;direccion?:string};
export type CalendarItem={id:string|number;title:string;date:string;description?:string};
export async function fetchRuc(ruc:string){return apiRequest<RucResult>(`/ruc/${encodeURIComponent(ruc)}`,{headers:await authHeaders()});}
export async function fetchCalendar(){return apiRequest<CalendarItem[]>('/calendar',{headers:await authHeaders()});}
export async function askFiscalAI(message:string){return apiRequest<{answer:string}>('/ai/fiscal',{method:'POST',headers:await authHeaders(),body:JSON.stringify({message})});}
export async function fetchTaxParameters(){return apiRequest<{timMonthly?:number;updatedAt?:string}>('/tax/parameters',{headers:await authHeaders()});}
