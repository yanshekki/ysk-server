/**
 * Overflow actions menu — Esc / outside click close; portal avoids table clip.
 * Clicking an item closes the menu (confirm cancel then starts from closed).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TableMoreProps = {
  label: string;
  children: ReactNode;
};

export function TableMore({ label, children }: TableMoreProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPtr = (ev: PointerEvent) => {
      const el = ev.target as Node | null;
      if (rootRef.current?.contains(el) || menuRef.current?.contains(el)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPtr);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPtr);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return;
    const btn = btnRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const width = Math.min(18 * 16, Math.max(11 * 16, menu.offsetWidth));
    let left = btn.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    let top = btn.bottom + 4;
    const h = menu.offsetHeight;
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, btn.top - h - 4);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.minWidth = `${width}px`;
  }, [open]);

  const menu = open ? (
    <div
      ref={menuRef}
      className="table-more__menu table-more__menu--portal"
      role="menu"
      onClick={() => setOpen(false)}
    >
      {children}
    </div>
  ) : null;

  return (
    <div className="table-more" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="table-more__sum"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }
        }}
      >
        {label}
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
}
