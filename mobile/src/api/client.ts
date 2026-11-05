import { API_BASE_URL } from '../config';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 15000;

function safeMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return 'No se pudo completar la solicitud.';
  const message = (body as { message?: unknown }).message;
  if (typeof message !== 'string') return 'No se pudo completar la solicitud.';
  // Never expose server-rendered HTML or stack traces in the mobile UI.
  if (/<\/?[a-z][\s\S]*>/i.test(message) || /fatal error|stack trace|warning:/i.test(message)) {
    return 'El servidor devolvió un error. Intenta nuevamente más tarde.';
  }
  return message.slice(0, 240);
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const raw = await response.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { body = {}; }
    if (response.status === 401) throw new ApiError(401, 'Tu sesión venció. Inicia sesión nuevamente.');
    if (response.status === 403) throw new ApiError(403, 'Tu plan no tiene acceso a esta función.');
    if (response.status === 429) throw new ApiError(429, 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.');
    if (!response.ok) throw new ApiError(response.status, safeMessage(body));
    if (!raw || !Object.keys(body).length) throw new ApiError(502, 'El servidor devolvió una respuesta vacía o no válida.');
    return body as T;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new ApiError(408, 'La solicitud tardó demasiado. Intenta nuevamente.');
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'No se pudo conectar con Declarafy. Revisa tu conexión.');
  } finally {
    clearTimeout(timeout);
  }
}
