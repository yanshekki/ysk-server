/**
 * Lightweight global toast store (no external deps).
 * Subscribe from ToastViewport; call toast.ok / toast.error from anywhere.
 */

export type ToastVariant = 'ok' | 'error' | 'info' | 'warn';

export interface ToastItem {
  id: string;
  message: string;
  /** Optional longer notes (shown under message) */
  detail?: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
}

export interface ToastOptions {
  durationMs?: number;
  /** Extra lines under the main message (e.g. ops notes) */
  detail?: string;
}

type Listener = () => void;

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  ok: 4000,
  info: 4000,
  warn: 5000,
  error: 6000,
};

const MAX_STACK = 5;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit() {
  listeners.forEach((l) => l());
}

function nextId(): string {
  seq += 1;
  return `toast-${seq}-${Date.now()}`;
}

function scheduleDismiss(id: string, durationMs: number) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  if (durationMs <= 0) return;
  const handle = setTimeout(() => {
    timers.delete(id);
    dismiss(id);
  }, durationMs);
  timers.set(id, handle);
}

function push(variant: ToastVariant, message: string, options?: ToastOptions): string {
  const text = String(message ?? '').trim();
  if (!text) return '';

  const durationMs = options?.durationMs ?? DEFAULT_DURATION[variant];
  const detail = options?.detail?.trim() || undefined;
  const item: ToastItem = {
    id: nextId(),
    message: text,
    detail,
    variant,
    durationMs,
    createdAt: Date.now(),
  };

  // Newest on top
  toasts = [item, ...toasts].slice(0, MAX_STACK);
  // Drop timers for items that fell off the stack
  const live = new Set(toasts.map((t) => t.id));
  for (const [id, handle] of timers) {
    if (!live.has(id)) {
      clearTimeout(handle);
      timers.delete(id);
    }
  }

  scheduleDismiss(item.id, durationMs);
  emit();
  return item.id;
}

function dismiss(id: string) {
  const handle = timers.get(id);
  if (handle) {
    clearTimeout(handle);
    timers.delete(id);
  }
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

function clearAll() {
  for (const handle of timers.values()) clearTimeout(handle);
  timers.clear();
  toasts = [];
  emit();
}

export const toastStore = {
  getToasts(): ToastItem[] {
    return toasts;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Test / teardown helper */
  clear(): void {
    clearAll();
  },
  /** Test helper — default durations */
  defaults: DEFAULT_DURATION,
  maxStack: MAX_STACK,
};

export const toast = {
  ok(message: string, options?: ToastOptions): string {
    return push('ok', message, options);
  },
  error(message: string, options?: ToastOptions): string {
    return push('error', message, options);
  },
  info(message: string, options?: ToastOptions): string {
    return push('info', message, options);
  },
  warn(message: string, options?: ToastOptions): string {
    return push('warn', message, options);
  },
  dismiss(id: string): void {
    dismiss(id);
  },
  clear(): void {
    clearAll();
  },
};
