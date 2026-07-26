// Client-side fetch wrapper with uniform error handling.
//
// Modeled on the encounter channel's internal `send()` helper
// (src/lib/realtime/encounter-channel.ts): on a non-2xx response it parses
// the server's ApiError body (message + optional requestId), surfaces it to
// the user via the `toasts` store, and rethrows so call sites can still
// react (optimistic rollback, aborting a flow) WITHOUT re-toasting.
//
// NOTE: encounter-channel.ts deliberately keeps its own `send()` for now —
// converging the two is a follow-up.

import { toasts, type ApiError } from '$lib/client/errors';

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  /** Request body. Objects are JSON-serialized with a
   *  `content-type: application/json` header; `FormData` is sent as-is
   *  (the browser sets the multipart boundary); strings pass through. */
  body?: unknown;
  /** Suppress the automatic error toast (the ApiError is still thrown). */
  silent?: boolean;
}

async function request<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, silent, headers, ...init } = opts;
  const hasBody = body !== undefined;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(hasBody && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(headers ?? {})
      },
      body: !hasBody
        ? undefined
        : isForm || typeof body === 'string'
          ? (body as BodyInit)
          : JSON.stringify(body)
    });
  } catch {
    const err: ApiError = { message: 'Network error — check your connection and try again' };
    if (!silent) toasts.add({ type: 'error', message: err.message });
    throw err;
  }
  if (!res.ok) {
    let err: ApiError = { message: `Request failed (${res.status})`, status: res.status };
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed === 'object') {
        // Keep the whole body (e.g. a 409's structured payload) but
        // guarantee message/status are always present.
        err = {
          ...(parsed as Record<string, unknown>),
          message: typeof parsed.message === 'string' ? parsed.message : err.message,
          status: res.status
        };
      }
    } catch {
      /* non-JSON body — keep the status-based message */
    }
    if (!silent) toasts.add({ type: 'error', message: err.message, requestId: err.requestId });
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

type ApiFn = typeof request & {
  get<T = unknown>(path: string, opts?: ApiOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: ApiOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: ApiOptions): Promise<T>;
  del<T = unknown>(path: string, opts?: ApiOptions): Promise<T>;
};

export const api: ApiFn = Object.assign(request, {
  get: <T = unknown>(path: string, opts: ApiOptions = {}) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, opts: ApiOptions = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T = unknown>(path: string, body?: unknown, opts: ApiOptions = {}) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T = unknown>(path: string, opts: ApiOptions = {}) =>
    request<T>(path, { ...opts, method: 'DELETE' })
});
