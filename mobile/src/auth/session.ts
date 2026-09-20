import * as SecureStore from 'expo-secure-store';
import type { LoginResult, User } from '../api/auth';

const TOKEN_KEY='declarafy.auth.token';
const USER_KEY='declarafy.auth.user';

export async function saveSession(result: LoginResult) {
  if (result.token) await SecureStore.setItemAsync(TOKEN_KEY,result.token);
  await SecureStore.setItemAsync(USER_KEY,JSON.stringify(result.user));
}
export async function getToken(){ return SecureStore.getItemAsync(TOKEN_KEY); }
export async function getUser():Promise<User|null>{
  const raw=await SecureStore.getItemAsync(USER_KEY);
  if(!raw) return null;
  try{return JSON.parse(raw) as User;}catch{return null;}
}
export async function clearSession(){
  await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY),SecureStore.deleteItemAsync(USER_KEY)]);
}
