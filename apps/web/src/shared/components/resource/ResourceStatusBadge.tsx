import { useTranslation } from 'react-i18next';
import { Badge, type BadgeTone } from '../ui/Badge';

const TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  written: 'info',
  planned: 'warn',
  applied: 'ok',
  failed: 'danger',
  pending_execute: 'warn',
  uploaded: 'ok',
  issued: 'ok',
  missing: 'danger',
};

const KEY: Record<string, string> = {
  draft: 'applyStatus.draft',
  written: 'applyStatus.written',
  planned: 'applyStatus.planned',
  applied: 'applyStatus.applied',
  failed: 'applyStatus.failed',
  pending_execute: 'applyStatus.pendingExecute',
  uploaded: 'applyStatus.uploaded',
  issued: 'applyStatus.issued',
  missing: 'applyStatus.missing',
};

export function ResourceStatusBadge({ status }: { status?: string | null }) {
  const { t } = useTranslation();
  const s = (status ?? 'draft').toLowerCase();
  const tone = TONE[s] ?? ('info' as BadgeTone);
  const key = KEY[s];
  const label = key ? t(key) : (status ?? '—');
  return <Badge tone={tone}>{label}</Badge>;
}
