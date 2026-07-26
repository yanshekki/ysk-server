import type { OpsApplyResultDto } from '@ysk/shared';

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

export function formatOpsMessage(action: string, result: OpsApplyResultDto): string {
  const tail = result.notes?.slice(-1)[0];
  if (result.ok) {
    return `${action} OK${result.url ? ` → ${result.url}` : ''}`;
  }
  return `${action} failed${tail ? `: ${tail}` : ''}`;
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

export function envToText(env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) return 'NODE_ENV=production\n';
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
    .concat('\n');
}
