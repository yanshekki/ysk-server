import type { OpsApplyResultDto } from '@ysk/shared';
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

const ACTION_LABEL: Record<string, string> = {
  deploy: '部署',
  'deploy-php': '部署 PHP',
  stop: '停止',
  health: '健康檢查',
  'publish-nginx': '發布 Nginx',
  'publish-nginx-ssl': '發布 Nginx + SSL',
  suspend: '暫停',
  unsuspend: '恢復',
  'git-deploy': 'Git 部署',
  backup: '備份',
  env: '儲存環境變數',
  quota: '設定配額',
  resources: '設定資源',
  wordpress: 'WordPress',
};

export function formatOpsMessage(action: string, result: OpsApplyResultDto): string {
  const label = ACTION_LABEL[action] ?? action;
  const notes = sanitizeOperatorNotes(result.notes ?? []);
  const tail = notes.slice(-1)[0] ?? humanizeOperatorNote(result.notes?.slice(-1)[0] ?? '') ?? null;
  if (result.ok) {
    const url = result.url ? ` → ${result.url}` : '';
    return tail ? `${label}完成：${tail}${url}` : `${label}完成${url}`;
  }
  const blocked =
    typeof (result as { blockMessage?: string }).blockMessage === 'string'
      ? (result as { blockMessage?: string }).blockMessage
      : undefined;
  const reason = tail ?? blocked ?? '未知錯誤';
  return `${label}失敗：${reason}`;
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
  if (runtime === 'python' || runtime === 'go' || runtime === 'rust') {
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

export function formatRuntimeLabel(runtime?: string, version?: string | null): string {
  const name =
    runtime === 'php'
      ? 'PHP'
      : runtime === 'node'
        ? 'Node.js'
        : runtime === 'static'
          ? '靜態'
          : runtime === 'python'
            ? 'Python'
            : runtime === 'go'
              ? 'Go'
              : runtime === 'rust'
                ? 'Rust'
                : runtime ?? '—';
  if (runtime === 'static' || !version) return name;
  return `${name} ${version}`;
}
