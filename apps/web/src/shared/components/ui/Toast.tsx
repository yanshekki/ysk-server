/**
 * Fixed top-right toast viewport — operation feedback that does not depend on scroll.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  toast,
  toastStore,
  type ToastItem,
  type ToastVariant,
} from '../../stores/toast-store';

const VARIANT_CLASS: Record<ToastVariant, string> = {
  ok: 'ysk-toast ysk-toast--ok',
  error: 'ysk-toast ysk-toast--error',
  info: 'ysk-toast ysk-toast--info',
  warn: 'ysk-toast ysk-toast--warn',
};

const VARIANT_ICON: Record<ToastVariant, string> = {
  ok: '✓',
  error: '!',
  info: 'i',
  warn: '!',
};

function ToastCard({ item }: { item: ToastItem }) {
  const { t } = useTranslation();
  const role = item.variant === 'error' ? 'alert' : 'status';
  return (
    <div
      className={VARIANT_CLASS[item.variant]}
      role={role}
      data-toast-id={item.id}
      onMouseEnter={() => toast.pause(item.id)}
      onMouseLeave={() => toast.resume(item.id)}
    >
      <span className="ysk-toast__icon" aria-hidden>
        {VARIANT_ICON[item.variant]}
      </span>
      <div className="ysk-toast__body">
        <p className="ysk-toast__msg">{item.message}</p>
        {item.detail ? <p className="ysk-toast__detail">{item.detail}</p> : null}
      </div>
      <button
        type="button"
        className="ysk-toast__close"
        aria-label={t('common.close')}
        onClick={() => toast.dismiss(item.id)}
      >
        ×
      </button>
      {item.durationMs > 0 ? <span className="ysk-toast__timer" aria-hidden /> : null}
    </div>
  );
}

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>(() => toastStore.getToasts());

  useEffect(() => {
    return toastStore.subscribe(() => {
      setItems(toastStore.getToasts());
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="ysk-toast-viewport" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}
