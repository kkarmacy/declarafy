import * as SecureStore from 'expo-secure-store';
import type { LoginResult, User } from '../api/auth';

// PHP uses an HttpOnly session cookie, managed by the native HTTP client.
// SecureStore only caches non-secret user details and a local signed-in marker.
const SIGNED_IN_KEY = 'declarafy.auth.signed-in';
const USER_KEY = 'declarafy.auth.user';
const LEGACY_TOKEN_KEY = 'declarafy.auth.token';

export async function saveSession(result: LoginResult) {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(result.user));
  await SecureStore.setItemAsync(SIGNED_IN_KEY, 'yes');
  await SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY);
}
export async function getToken() {
  return SecureStore.getItemAsync(SIGNED_IN_KEY);
}
export async function getUser(): Promise<User | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as User; } catch { return null; }
}
export async function clearSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(SIGNED_IN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
    SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
  ]);
}
