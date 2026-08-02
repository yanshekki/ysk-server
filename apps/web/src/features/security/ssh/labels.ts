import type { TFunction } from 'i18next';
import type { BadgeTone } from '../../../shared/components/ui';

/** Human labels — never show raw enums as primary UI copy */

export function purposeLabel(purpose: string, t: TFunction): string {
  switch (purpose) {
    case 'panel_outbound':
      return t('security.ssh.purposePanel');
    case 'user_outbound':
      return t('security.ssh.purposeUser');
    case 'unbound':
      return t('security.ssh.purposeUnbound');
    default:
      return purpose;
  }
}

export function purposeHint(purpose: string, t: TFunction): string {
  switch (purpose) {
    case 'panel_outbound':
      return t('security.ssh.purposePanelHint');
    case 'user_outbound':
      return t('security.ssh.purposeUserHint');
    default:
      return t('security.ssh.purposeDefaultHint');
  }
}

export function statusLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'stored':
      return t('security.ssh.statusStored');
    case 'installed':
      return t('security.ssh.statusInstalled');
    case 'verified':
      return t('security.ssh.statusVerified');
    case 'missing_on_disk':
      return t('security.ssh.statusMissing');
    case 'retired':
      return t('security.ssh.statusRetired');
    case 'error':
      return t('security.ssh.statusError');
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

export function shortFingerprint(fp: string | undefined | null): string {
  if (!fp) return '—';
  const bare = fp.replace(/^SHA256:/, '');
  if (bare.length <= 16) return fp;
  return `SHA256:${bare.slice(0, 8)}…${bare.slice(-6)}`;
}

/** Recommended primary action for list row CTA */
export function nextAction(
  status: string,
  purpose: string,
  t: TFunction,
): { id: 'install' | 'test' | 'copy_pub' | 'none'; label: string } {
  if (status === 'retired') return { id: 'none', label: '' };
  if (status === 'stored' || status === 'missing_on_disk') {
    return { id: 'install', label: t('security.ssh.actionInstall') };
  }
  if (status === 'installed') {
    return purpose === 'panel_outbound'
      ? { id: 'test', label: t('security.ssh.actionTest') }
      : { id: 'copy_pub', label: t('security.ssh.actionCopyPub') };
  }
  if (status === 'verified') return { id: 'copy_pub', label: t('security.ssh.actionCopyPub') };
  return { id: 'install', label: t('security.ssh.actionInstall') };
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
