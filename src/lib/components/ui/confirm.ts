/**
 * Promise-based replacement for the browser's `confirm()` / `prompt()`.
 *
 * Call sites stay one-liners:
 *
 *   if (!(await confirmDialog({ title: 'Delete this note?', danger: true }))) return;
 *   const slug = await promptDialog({ title: 'New slug:', defaultValue: '…' });
 *
 * The request is pushed onto a FIFO queue; `ConfirmHost` (mounted once in the
 * root layout) renders the head of the queue with `ConfirmModal` and calls
 * `resolveConfirm()` when the user answers. Requests never resolve on their
 * own — exactly like the native dialogs, an unanswered call blocks its caller.
 */
import { writable } from 'svelte/store';

/** Optional single-line text field, for the `prompt()` replacement. */
export interface ConfirmInput {
  /** Visible label above the field. */
  label?: string;
  placeholder?: string;
  /** Pre-filled value — the native `prompt()` second argument. */
  initial: string;
}

export interface ConfirmRequest {
  id: string;
  title: string;
  /** Optional supporting line under the title. */
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Red confirm button — destructive actions. */
  danger: boolean;
  input: ConfirmInput | null;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  /** Pre-filled value. Mirrors `prompt(message, defaultValue)`. */
  defaultValue?: string;
  label?: string;
  placeholder?: string;
}

type Entry = { request: ConfirmRequest; resolve: (value: string | null) => void };

const queue: Entry[] = [];
const current = writable<ConfirmRequest | null>(null);

/** Head of the queue, or null when nothing is being asked. */
export const activeConfirm = { subscribe: current.subscribe };

function pump() {
  current.set(queue.length > 0 ? queue[0].request : null);
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `confirm-${seq}`;
}

function enqueue(
  opts: ConfirmOptions & { input: ConfirmInput | null }
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    queue.push({
      request: {
        id: nextId(),
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? (opts.danger ? 'Delete' : 'Confirm'),
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        input: opts.input
      },
      resolve
    });
    pump();
  });
}

/**
 * Answer the head request. `value` is the input string on confirm (empty
 * string when the dialog has no field) or `null` on cancel. Called by
 * `ConfirmHost`; exported for tests.
 */
export function resolveConfirm(value: string | null): void {
  const head = queue.shift();
  head?.resolve(value);
  pump();
}

/** Cancel every queued request — used when tearing down in tests. */
export function resetConfirmQueue(): void {
  while (queue.length > 0) queue.shift()!.resolve(null);
  pump();
}

/** `confirm()` replacement — resolves true when the user confirms. */
export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const value = await enqueue({ ...opts, input: null });
  return value !== null;
}

/** `prompt()` replacement — resolves the entered string, or null on cancel. */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return enqueue({
    ...opts,
    confirmLabel: opts.confirmLabel ?? 'OK',
    input: {
      label: opts.label,
      placeholder: opts.placeholder,
      initial: opts.defaultValue ?? ''
    }
  });
}
