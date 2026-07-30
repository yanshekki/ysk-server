import type { BadgeTone } from '../../../shared/components/ui';

/** Human labels — never show raw enums as primary UI copy */

export function purposeLabel(purpose: string): string {
  switch (purpose) {
    case 'panel_outbound':
      return '面板連其他機';
    case 'user_outbound':
      return '專案用戶出站';
    case 'unbound':
      return '尚未指定用途';
    default:
      return purpose;
  }
}

export function purposeHint(purpose: string): string {
  switch (purpose) {
    case 'panel_outbound':
      return 'Cluster peer、備份 scp、遠端探測';
    case 'user_outbound':
      return '專案 Linux 用戶 git / scp / 腳本';
    default:
      return '稍後再綁定';
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'stored':
      return '已入庫';
    case 'installed':
      return '已寫入磁碟';
    case 'verified':
      return '連線通過';
    case 'missing_on_disk':
      return '磁碟檔案遺失';
    case 'retired':
      return '已退役';
    case 'error':
      return '異常';
    default:
      return status;
  }
}

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'verified':
      return 'ok';
    case 'installed':
      return 'info';
    case 'retired':
      return 'neutral';
    case 'missing_on_disk':
    case 'error':
      return 'danger';
    default:
      return 'warn';
  }
}

export function shortFingerprint(fp: string): string {
  const bare = fp.replace(/^SHA256:/, '');
  if (bare.length <= 16) return fp;
  return `SHA256:${bare.slice(0, 8)}…${bare.slice(-6)}`;
}

/** Recommended primary action for list row CTA */
export function nextAction(
  status: string,
  purpose: string,
): { id: 'install' | 'test' | 'copy_pub' | 'none'; label: string } {
  if (status === 'retired') return { id: 'none', label: '' };
  if (status === 'stored' || status === 'missing_on_disk') {
    return { id: 'install', label: '寫入磁碟' };
  }
  if (status === 'installed') {
    return purpose === 'panel_outbound'
      ? { id: 'test', label: '測試連線' }
      : { id: 'copy_pub', label: '複製公鑰' };
  }
  if (status === 'verified') return { id: 'copy_pub', label: '複製公鑰' };
  return { id: 'install', label: '寫入磁碟' };
}

export function pipelineStep(
  status: string,
): 0 | 1 | 2 | 3 {
  // 0 stored · 1 installed · 2 verified · 3 failed/missing
  if (status === 'verified') return 2;
  if (status === 'installed') return 1;
  if (status === 'error' || status === 'missing_on_disk') return 3;
  return 0;
}
