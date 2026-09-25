import { API_BASE_URL } from '../config';
export class ApiError extends Error { constructor(public status:number,message:string){super(message);this.name='ApiError';} }
const TIMEOUT_MS=15000;
export async function apiRequest<T>(path:string,options:RequestInit={}):Promise<T>{
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);
 try{
  const response=await fetch(`${API_BASE_URL}${path}`,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}});
  const text=await response.text();let body:any={};
  try{body=text?JSON.parse(text):{};}catch{body={message:text};}
  if(response.status===401) throw new ApiError(401,'Tu sesión venció. Inicia sesión nuevamente.');
  if(response.status===403) throw new ApiError(403,'Tu plan no tiene acceso a esta función.');
  if(response.status===429) throw new ApiError(429,'Demasiadas solicitudes. Intenta nuevamente en unos minutos.');
  if(!response.ok) throw new ApiError(response.status,body.message||'No se pudo completar la solicitud.');
  return body as T;
 }catch(e:any){
  if(e?.name==='AbortError') throw new ApiError(408,'La solicitud tardó demasiado. Intenta nuevamente.');
  if(e instanceof ApiError) throw e;
  throw new ApiError(0,'No se pudo conectar con Declarafy. Revisa tu conexión.');
 }finally{clearTimeout(timeout);}
}
