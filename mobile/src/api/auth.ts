import { API_BASE_URL } from '../config';
import { ApiError } from './client';

export type User = {
  id: string | number;
  name?: string;
  email: string;
  plan?: string;
  features?: string[];
};
export type LoginResult = { user: User };
type PhpUser = { uid?: string; id?: string | number; name?: string; email: string; plan?: string; effectivePlan?: string; features?: string[] };
type PhpResponse<T> = { ok: boolean; data?: T; csrfToken?: string; message?: string };

const endpoint = (action: string) => `${API_BASE_URL}/index.php?action=${encodeURIComponent(action)}`;
let csrfToken = '';

async function phpRequest<T>(action: string, method: 'GET' | 'POST' = 'GET', payload?: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint(action), {
      method,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? {
          'Content-Type': 'application/json',
          'X-Requested-With': 'DeclarafyWeb',
          'X-CSRF-Token': csrfToken,
        } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(payload ?? {}) } : {}),
    });
    const raw = await response.text();
    let result: PhpResponse<T>;
    try { result = JSON.parse(raw) as PhpResponse<T>; }
    catch { throw new ApiError(response.status, 'El servidor devolvió una respuesta no válida.'); }
    if (result.csrfToken) csrfToken = result.csrfToken;
    if (!response.ok || !result.ok) {
      throw new ApiError(response.status, result.message || 'No se pudo completar la solicitud.');
    }
    // Some successful actions (e.g. logout) intentionally return an empty data object.
    if (result.data === undefined || result.data === null) {
      throw new ApiError(response.status, 'Respuesta incompleta del servidor.');
    }
    return result.data;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new ApiError(408, 'La solicitud tardó demasiado.');
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'No se pudo conectar con Declarafy.');
  } finally { clearTimeout(timeout); }
}

function normalizeUser(user: PhpUser): User {
  return {
    id: user.uid ?? user.id ?? user.email,
    name: user.name,
    email: user.email,
    // PHP provides effectivePlan for administrators; this is the authoritative UI plan.
    plan: user.effectivePlan ?? user.plan,
    features: user.features,
  };
}

export async function fetchSession(): Promise<User | null> {
  const data = await phpRequest<{ user: PhpUser | null }>('session');
  return data.user ? normalizeUser(data.user) : null;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  await fetchSession(); // Initializes the server session cookie and CSRF token.
  const data = await phpRequest<{ user: PhpUser }>('login', 'POST', { email, password });
  if (!data.user?.email) throw new ApiError(502, 'El servidor no devolvió el usuario.');
  return { user: normalizeUser(data.user) };
}

export async function logout(): Promise<void> {
  if (!csrfToken) await fetchSession();
  await phpRequest<object>('logout', 'POST');
  csrfToken = '';
}
