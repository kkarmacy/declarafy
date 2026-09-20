import { apiRequest } from './client';
import { getToken } from '../auth/session';
import type { User } from './auth';
export async function fetchProfile(){
 const token=await getToken();
 return apiRequest<User>('/auth/me',{headers:token?{Authorization:`Bearer ${token}`}:{}});
}
