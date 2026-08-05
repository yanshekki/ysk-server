/**
 * Shared operation feedback — always top-right toast (no page-top Alert).
 */
import { toast, type ToastOptions } from '../stores/toast-store';

export function notifyOk(message: string, options?: ToastOptions): string {
  return toast.ok(message, options);
}

export function notifyError(message: string, options?: ToastOptions): string {
  return toast.error(message, options);
}

export function notifyWarn(message: string, options?: ToastOptions): string {
  return toast.warn(message, options);
}

export function notifyInfo(message: string, options?: ToastOptions): string {
  return toast.info(message, options);
}
