import type { OpsApplyResultDto } from '@yanshekki/shared';
import type { TFunction } from 'i18next';
import { humanizeOperatorNote, sanitizeOperatorNotes } from '../../../shared/lib/operator-messages';

export type ProjectOpsAction =
  | 'deploy'
  | 'deploy-php'
  | 'stop'
  | 'health'
  | 'publish-nginx'
  | 'publish-nginx-ssl'
  | 'suspend'
  | 'unsuspend'
  | 'git-deploy'
  | 'backup'
  | 'env'
  | 'quota'
  | 'resources'
  | 'wordpress';

/** i18n keys for ops action labels (projects.* namespace) */
const ACTION_LABEL_KEYS: Record<string, string> = {
  deploy: 'projects.deploy',
  'deploy-php': 'projects.deployPhp',
  stop: 'projects.stop',
  health: 'projects.health',
  'publish-nginx': 'projects.publishNginx',
  'publish-nginx-ssl': 'projects.publishNginxSsl',
  suspend: 'projects.suspend',
  unsuspend: 'projects.resume',
  'git-deploy': 'projects.gitDeploy',
  backup: 'projects.backup',
  env: 'projects.saveEnv',
  quota: 'projects.setQuota',
  resources: 'projects.setResources',
  wordpress: 'projects.downloadWp',
};

export function actionLabel(action: string, t: TFunction): string {
  const key = ACTION_LABEL_KEYS[action];
  return key ? t(key) : action;
}

export function formatOpsMessage(
  action: string,
  result: OpsApplyResultDto,
  t: TFunction,
): string {
  const label = actionLabel(action, t);
  const notes = sanitizeOperatorNotes(result.notes ?? []);
  const tail = notes.slice(-1)[0] ?? humanizeOperatorNote(result.notes?.slice(-1)[0] ?? '') ?? null;
  if (result.ok) {
    const url = result.url ? ` → ${result.url}` : '';
    return tail
      ? t('projects.opsOkWithNote', { label, note: tail, url })
      : t('projects.opsOk', { label, url });
  }
  const blocked =
    typeof (result as { blockMessage?: string }).blockMessage === 'string'
      ? (result as { blockMessage?: string }).blockMessage
      : undefined;
  const reason = tail ?? blocked ?? t('common.unknownError');
  return t('projects.opsFail', { label, reason });
}

export function parseEnvText(envText: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of envText.split('\n')) {
    const tline = line.trim();
    if (!tline || tline.startsWith('#')) continue;
    const i = tline.indexOf('=');
    if (i > 0) env[tline.slice(0, i).trim()] = tline.slice(i + 1).trim();
  }
  return env;
}

/** Runtime-aware empty env template (never force NODE_ENV on PHP/Python/Go/Rust). */
export function defaultEnvText(runtime?: string): string {
  if (runtime === 'php') return 'APP_ENV=production\n';
  if (runtime === 'static') return '';
  if (
    runtime === 'python' ||
    runtime === 'go' ||
    runtime === 'rust' ||
    runtime === 'java' ||
    runtime === 'kotlin' ||
    runtime === 'bun'
  ) {
    return 'APP_ENV=production\n';
  }
  return 'NODE_ENV=production\n';
}

export function envToText(env?: Record<string, string>, runtime?: string): string {
  if (!env || Object.keys(env).length === 0) return defaultEnvText(runtime);
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + (Object.keys(env).length ? '\n' : '');
}

export function formatRuntimeLabel(
  runtime?: string,
  version?: string | null,
  t?: TFunction,
): string {
  const name = formatRuntimeNameForLabel(runtime, t);
  if (runtime === 'static' || !version) return name;
  return `${name} ${version}`;
}

function formatRuntimeNameForLabel(runtime?: string, t?: TFunction): string {
  if (t) {
    if (runtime === 'php') return t('projects.runtimeName.php');
    if (runtime === 'node') return t('projects.runtimeName.node');
    if (runtime === 'static') return t('projects.runtimeName.static');
    if (runtime === 'python') return t('projects.runtimeName.python');
    if (runtime === 'go') return t('projects.runtimeName.go');
    if (runtime === 'rust') return t('projects.runtimeName.rust');
    if (runtime === 'java') return t('projects.runtimeName.java');
    if (runtime === 'kotlin') return t('projects.runtimeName.kotlin');
    if (runtime === 'bun') return t('projects.runtimeName.bun');
    return runtime ?? t('common.noneSelectedShort');
  }
  // Fallback without t (English brand names + static key)
  if (runtime === 'php') return 'PHP';
  if (runtime === 'node') return 'Node.js';
  if (runtime === 'static') return 'Static';
  if (runtime === 'python') return 'Python';
  if (runtime === 'go') return 'Go';
  if (runtime === 'rust') return 'Rust';
  if (runtime === 'java') return 'Java';
  if (runtime === 'kotlin') return 'Kotlin';
  if (runtime === 'bun') return 'Bun';
  return runtime ?? '—';
}
