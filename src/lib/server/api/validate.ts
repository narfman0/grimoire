// Thin wrappers around Zod for SvelteKit handlers. On validation failure
// they throw a SvelteKit 400 — the route module re-throws as-is.

import { error } from '@sveltejs/kit';
import type { z } from 'zod';

function format(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export async function parseJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON');
  }
  const result = schema.safeParse(body);
  if (!result.success) throw error(400, format(result.error));
  return result.data;
}

export function parseParams<T extends z.ZodTypeAny>(
  params: Record<string, string | undefined>,
  schema: T
): z.infer<T> {
  const result = schema.safeParse(params);
  if (!result.success) throw error(400, format(result.error));
  return result.data;
}

export function parseSearch<T extends z.ZodTypeAny>(url: URL, schema: T): z.infer<T> {
  const obj: Record<string, string> = {};
  for (const [k, v] of url.searchParams) obj[k] = v;
  const result = schema.safeParse(obj);
  if (!result.success) throw error(400, format(result.error));
  return result.data;
}
