import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Extra class on the panel (e.g. feature-specific layouts) */
  className?: string;
}

/**
 * Modal dialog. Focus is only moved when the dialog *opens* (not on every parent re-render),
 * so controlled inputs can type continuously.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpen = useRef(false);

  // Body scroll lock + Escape — stable onClose via ref so deps don't thrash
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Focus first focusable field only when transitioning closed → open
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;

    const panel = panelRef.current;
    if (!panel) return;
    // Prefer first text input / select / textarea in body, not the close button
    const preferred = panel.querySelector<HTMLElement>(
      '.modal__body input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), .modal__body select, .modal__body textarea, .modal__body button',
    );
    const fallback = panel.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (preferred ?? fallback)?.focus();
  }, [open]);

  if (!open) return null;

  const sizeClass =
    size === 'sm'
      ? 'modal--sm'
      : size === 'lg'
        ? 'modal--lg'
        : size === 'xl'
          ? 'modal--xl'
          : '';

  const tree = (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        className={['modal', sizeClass, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            {description ? <p className="modal__desc">{description}</p> : null}
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm modal__close"
            onClick={() => onCloseRef.current()}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__footer">{footer}</div> : null}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return tree;
  return createPortal(tree, document.body);
}
