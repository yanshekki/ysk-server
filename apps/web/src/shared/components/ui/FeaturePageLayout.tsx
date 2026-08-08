/**
 * Sole page chrome for every feature route (except Login).
 *
 * Layout:
 *   [← back]
 *   Title                          [actions…]
 *   [pill]  label value · label value · …   ← status strip (optional)
 *   ── body: alerts / tabs / content only ──
 *
 * Rules:
 * - Page-level KPIs go in `status` only (≤6 chips). Do not put
 *   SummaryStrip / custom hero markup at the top of children.
 * - `actions`: refresh / nav / non-create ops only (size="sm").
 * - **Never** put “+ 建立/新增 …” create here — only DataTable.toolbar.
 * - No tab-jump buttons in header — tabs own navigation.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from './PageHeader';
import { PageStatusBar, type PageStatusChip } from './PageStatusBar';
import { buttonClassName } from './Button';
import type { BadgeTone } from './Badge';

export type PageStatusItem = {
  label: string;
  value: ReactNode;
  tone?: BadgeTone;
};

export type PageStatus = {
  /** Short overall state badge (e.g. 就緒 / 2FA 未啟用) */
  pill?: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'neutral' };
  /** Key metrics — max 6 rendered */
  items?: PageStatusItem[];
  /** Rare free-form note when chips are empty */
  note?: ReactNode;
};

export interface FeaturePageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Unified status strip under the title row */
  status?: PageStatus;
  /** @deprecated Banner removed — kept for call-site compatibility */
  showCapability?: boolean;
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}

export function FeaturePageLayout({
  title,
  subtitle,
  actions,
  status,
  backTo,
  backLabel,
  children }: FeaturePageLayoutProps) {
  const { t } = useTranslation();
  const chips: PageStatusChip[] | undefined = status?.items?.length
    ? status.items.slice(0, 6).map((s) => ({
        label: s.label,
        value: s.value,
        tone: s.tone }))
    : undefined;

  const showStatus =
    Boolean(status?.pill) || Boolean(chips?.length) || Boolean(status?.note);

  return (
    <div className="feature-page">
      <div className="feature-page__head">
        {backTo ? (
          <div className="feature-page__back">
            <Link to={backTo} className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
              ← {backLabel ?? t('featurePage.back')}
            </Link>
          </div>
        ) : null}
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {showStatus ? (
          <PageStatusBar
            className="feature-page__status"
            pill={status?.pill}
            chips={chips}
            note={status?.note}
          />
        ) : null}
      </div>
      <div className="feature-page__body stack">{children}</div>
    </div>
  );
}
