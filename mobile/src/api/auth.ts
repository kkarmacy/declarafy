import { apiRequest } from './client';

export type User = {
  id: string | number;
  name?: string;
  email: string;
  plan?: string;
  features?: string[];
};
export type LoginResult = { token?: string; user: User };

export async function login(email: string, password: string): Promise<LoginResult> {
  return apiRequest<LoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}
