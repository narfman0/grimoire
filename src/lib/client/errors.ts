import { writable } from 'svelte/store';

export interface ApiError {
  message: string;
  code?: string;
  requestId?: string;
  /** HTTP status of the failed response (set by $lib/client/api). */
  status?: number;
}

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'info';
  requestId?: string;
}

function createToastStore() {
  const { subscribe, update } = writable<Toast[]>([]);
  return {
    subscribe,
    add(t: Omit<Toast, 'id'>) {
      const id = crypto.randomUUID();
      update((ts) => [...ts, { ...t, id }]);
      setTimeout(() => update((ts) => ts.filter((x) => x.id !== id)), 5000);
    },
    dismiss(id: string) {
      update((ts) => ts.filter((x) => x.id !== id));
    }
  };
}

export const toasts = createToastStore();
