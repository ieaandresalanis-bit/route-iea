import { CONFIG } from '../constants/config';

// In a real app, use expo-secure-store for token storage
let authToken: string | null = null;

export function setToken(token: string) { authToken = token; }
export function getToken() { return authToken; }
export function clearToken() { authToken = null; }

/**
 * Fetch wrapper for IEA Growth Intelligence API.
 * Auto-attaches JWT Bearer token.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${CONFIG.API_URL}${path}`, { ...options, headers });

  if (response.status === 401) {
    clearToken();
    throw new Error('Session expired');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const json = await response.json();
  return json.data !== undefined ? json.data : json;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
};
