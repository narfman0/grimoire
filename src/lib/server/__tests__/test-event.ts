// Fabricate the minimum RequestEvent shape SvelteKit handlers read. Full
// fidelity isn't worth it — we cast through `unknown` and feed handlers
// only the surface area they touch.

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SessionUser } from '../auth/sessions';

// SvelteKit's RequestEvent is parameterized by the route's params + id;
// each handler expects its own specific variant. Tests need to pass our
// stub into many different handlers, so we type the return as `any` and
// rely on the runtime shape (which matches what handlers actually read).
type AnyEvent = any;

interface MakeEventOpts {
  user?: SessionUser | null;
  params?: Record<string, string>;
  body?: unknown;
  /** Multipart body for the upload routes (portrait, map/board background).
   *  Mutually exclusive with `body`; the Request sets its own content-type
   *  boundary, so we must not pass one. */
  formData?: FormData;
  method?: string;
  url?: string;
  searchParams?: Record<string, string>;
}

/** Same stub as makeEvent, but typed to satisfy SvelteKit's per-route
 *  ServerLoadEvent generics. Use in load function tests. */
export function makeLoadEvent(opts: MakeEventOpts = {}): AnyEvent {
  return makeEvent(opts);
}

export function makeEvent(opts: MakeEventOpts = {}): AnyEvent {
  const url = new URL(opts.url ?? 'http://localhost/');
  if (opts.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  const hasBody = opts.body !== undefined || opts.formData !== undefined;
  const method = opts.method ?? (hasBody ? 'POST' : 'GET');
  const request = new Request(url.toString(), {
    method,
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
    body:
      opts.formData !== undefined
        ? opts.formData
        : opts.body !== undefined
          ? JSON.stringify(opts.body)
          : undefined
  });
  return {
    params: opts.params ?? {},
    locals: { user: opts.user ?? null, requestId: 'test-request-id' },
    request,
    url,
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      serialize: () => '',
      getAll: () => []
    },
    fetch: globalThis.fetch,
    getClientAddress: () => '127.0.0.1',
    platform: undefined,
    route: { id: null },
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false
  } as AnyEvent;
}

/** Run a load function and return its data as `any` so tests can read
 *  `data.X` without TypeScript's `void | T` narrowing chiming in. */
export async function runLoad<T>(
  loadFn: (event: AnyEvent) => T | Promise<T>,
  event: AnyEvent
): Promise<AnyEvent> {
  return (await loadFn(event)) as AnyEvent;
}

/** Convenience for asserting a SvelteKit HttpError thrown from a handler.
 *  Accepts any awaitable (handlers may return MaybePromise<Response>). */
export async function expectHttpError(
  promise: AnyEvent,
  status: number
): Promise<void> {
  try {
    await promise;
    throw new Error(`expected handler to throw ${status}, but it resolved`);
  } catch (e) {
    const err = e as { status?: number };
    if (err.status !== status) {
      throw new Error(`expected ${status}, got ${err.status ?? '(no status)'}: ${e}`);
    }
  }
}
