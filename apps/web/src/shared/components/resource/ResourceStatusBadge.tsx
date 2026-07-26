import { Badge, type BadgeTone } from '../ui/Badge';

const MAP: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  written: { label: '已寫入管理檔', tone: 'info' },
  planned: { label: '處理中', tone: 'warn' },
  applied: { label: '已套用到系統', tone: 'ok' },
  failed: { label: '失敗', tone: 'danger' },
  pending_execute: { label: '待系統權限', tone: 'warn' },
  uploaded: { label: '已上傳', tone: 'ok' },
  issued: { label: '已簽發', tone: 'ok' },
  missing: { label: '檔案缺失', tone: 'danger' },
};

export function ResourceStatusBadge({ status }: { status?: string | null }) {
  const s = (status ?? 'draft').toLowerCase();
  const m = MAP[s] ?? { label: status ?? '—', tone: 'info' as BadgeTone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
