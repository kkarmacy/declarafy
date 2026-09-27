import { fetchSession } from './auth';
import type { User } from './auth';

export async function fetchProfile(): Promise<User> {
  const user = await fetchSession();
  if (!user) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
  return user;
}
