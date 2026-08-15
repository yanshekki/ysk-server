import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { bindCall1 } from '../../../pages/bind-handlers';

/** Horizontal-only scroll so the page / tab bar never grows a Y scrollbar. */
export function scrollTabListTo(list: HTMLElement, tabEl: HTMLElement): void {
  const tabRect = tabEl.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  if (tabRect.left < listRect.left) {
    list.scrollLeft -= listRect.left - tabRect.left;
  } else if (tabRect.right > listRect.right) {
    list.scrollLeft += tabRect.right - listRect.right;
  }
}

export interface TabItem {
  id: string;
  label: string;
  /** Optional count / status badge on the tab label */
  badge?: string | number;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  children: ReactNode;
  /** scroll = horizontal overflow with arrows (default); wrap = multi-line */
  variant?: 'scroll' | 'wrap';
}

export function Tabs({ tabs, active, onChange, children, variant = 'scroll' }: TabsProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateOverflow = useCallback(() => {
    const el = listRef.current;
    if (!el || variant !== 'scroll') {
      setCanLeft(false);
      setCanRight(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, [variant]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    updateOverflow();
    const ro = new ResizeObserver(() => updateOverflow());
    ro.observe(el);
    el.addEventListener('scroll', updateOverflow, { passive: true });
    window.addEventListener('resize', updateOverflow);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', updateOverflow);
      window.removeEventListener('resize', updateOverflow);
    };
  }, [updateOverflow, tabs.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const tabEl = list.querySelector<HTMLElement>(`[data-tab-id="${active}"]`);
    if (!tabEl) return;
    scrollTabListTo(list, tabEl);
    requestAnimationFrame(updateOverflow);
  }, [active, updateOverflow]);

  function scrollBy(dir: -1 | 1) {
    const el = listRef.current;
    if (!el) return;
    const amount = Math.max(160, Math.floor(el.clientWidth * 0.55));
    el.scrollBy({ left: dir * amount, behavior: 'smooth' });
  }

  return (
    <div className={`tabs tabs--${variant}`}>
      <div
        className={`tabs__bar${canLeft ? ' tabs__bar--fade-left' : ''}${canRight ? ' tabs__bar--fade-right' : ''}`}
      >
        {variant === 'scroll' && canLeft ? (
          <button
            type="button"
            className="tabs__arrow tabs__arrow--left"
            aria-label={t('tabs.scrollLeft')}
            onClick={bindCall1(scrollBy, -1)}
          >
            ‹
          </button>
        ) : null}
        <div className="tabs__scroll-wrap">
          <div className="tabs__list" role="tablist" ref={listRef}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                data-tab-id={tab.id}
                id={`tab-${tab.id}`}
                aria-selected={active === tab.id}
                aria-controls={`panel-${tab.id}`}
                className={`tabs__tab${active === tab.id ? ' tabs__tab--on' : ''}`}
                onClick={bindCall1(onChange, tab.id)}
              >
                <span className="tabs__tab-label">{tab.label}</span>
                {tab.badge != null && tab.badge !== '' ? (
                  <span className="tabs__tab-badge">{tab.badge}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
        {variant === 'scroll' && canRight ? (
          <button
            type="button"
            className="tabs__arrow tabs__arrow--right"
            aria-label={t('tabs.scrollRight')}
            onClick={bindCall1(scrollBy, 1)}
          >
            ›
          </button>
        ) : null}
      </div>
      <div
        className="tabs__panel"
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
      >
        {children}
      </div>
    </div>
  );
}
