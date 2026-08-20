import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

let openModalCount = 0;
const stackListeners = new Set<() => void>();
let nextModalDepth = 0;
let modalSeq = 0;
const liveDepths = new Set<number>();

function notifyModalStack() {
  nextModalDepth = liveDepths.size ? Math.max(...liveDepths) : 0;
  for (const fn of stackListeners) fn();
}

function setRootInert(on: boolean) {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  if (!root) return;
  if (on) root.setAttribute('inert', '');
  else root.removeAttribute('inert');
}

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return [
    ...panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Extra class on the panel (e.g. feature-specific layouts) */
  className?: string;
  /** Named target for confirm honesty / tests */
  dataConfirm?: string;
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
  className,
  dataConfirm }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpen = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [depth, setDepth] = useState(0);
  const [front, setFront] = useState(true);

  // Body scroll lock + Escape + inert background + Tab trap
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    openModalCount += 1;
    modalSeq += 1;
    const myDepth = modalSeq;
    liveDepths.add(myDepth);
    setDepth(myDepth);
    setRootInert(true);
    notifyModalStack();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (myDepth !== nextModalDepth) return;
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const list = focusableIn(panel);
      if (!list.length) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      liveDepths.delete(myDepth);
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        setRootInert(false);
        nextModalDepth = 0;
        modalSeq = 0;
        liveDepths.clear();
      }
      notifyModalStack();
      const back = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (back && document.contains(back)) back.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const sync = () => setFront(depth > 0 && depth === nextModalDepth);
    sync();
    stackListeners.add(sync);
    return () => {
      stackListeners.delete(sync);
    };
  }, [open, depth]);

  // Focus first focusable field only when transitioning closed → open
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

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
          : size === 'full'
            ? 'modal--full'
            : '';

  const tree = (
    <div
      className={['modal-backdrop', front ? 'modal-backdrop--front' : 'modal-backdrop--back'].join(
        ' ',
      )}
      role="presentation"
      onMouseDown={(e) => {
        if (!front) return;
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        className={['modal', sizeClass, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-confirm={dataConfirm}
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
