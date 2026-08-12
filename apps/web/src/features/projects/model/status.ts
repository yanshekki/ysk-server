import type { ProjectDto } from '@yanshekki/shared';
import type { BadgeTone } from '../../../shared/components/ui';

export type ProjectStatusBucket =
  | 'running'
  | 'degraded'
  | 'unhealthy'
  | 'stopped'
  | 'pending_os'
  | 'other';

export interface ProjectDisplayStatus {
  /** i18n key under projects.status.* */
  labelKey: string;
  /** fallback plain label if key missing */
  labelFallback: string;
  tone: BadgeTone;
  /** i18n key for hint */
  hintKey?: string;
  hintFallback?: string;
  bucket: ProjectStatusBucket;
  /** raw value for debugging only */
  raw?: string;
}

/**
 * Whether overview should show retry deploy / publish actions.
 */
export function projectNeedsLiveRetry(project: ProjectDto): boolean {
  const st = (project.status ?? '').toLowerCase();
  const ps = (project.processStatus ?? '').toLowerCase();
  if (st === 'suspended') return false;
  if (ps === 'failed' || st === 'failed' || ps === 'unhealthy' || st === 'unhealthy') {
    return true;
  }
  const lh = (project.lastHealth ?? {}) as {
    goLiveOk?: boolean;
    nginxStatus?: string;
  };
  if (lh.goLiveOk === false) return true;
  if (lh.nginxStatus === 'needs_deploy') return true;
  if (lh.nginxStatus === 'nginx_t_failed' || String(lh.nginxStatus ?? '').startsWith('reload_failed')) {
    return true;
  }
  // Domain set but never successfully published
  if (project.domain?.trim() && !project.nginxConfigPath) return true;
  // Notes from failed goLive / deploy
  const notes = project.lastDeployNotes ?? [];
  if (notes.some((n) => /goLive|failed|incomplete|needs_deploy/i.test(n))) {
    return true;
  }
  return false;
}

/**
 * Single display model for project status — never show raw codes as primary label.
 */
export function deriveProjectStatus(project: ProjectDto): ProjectDisplayStatus {
  const ps = (project.processStatus ?? '').toLowerCase();
  const st = (project.status ?? '').toLowerCase();
  const raw = project.processStatus || project.status || '';

  if (st === 'suspended') {
    return {
      labelKey: 'projects.status.suspended',
      labelFallback: 'Suspended',
      tone: 'warn',
      bucket: 'stopped',
      hintKey: 'projects.status.suspendedHint',
      hintFallback: 'Site returns 503 until resumed',
      raw,
    };
  }

  if (ps === 'failed' || st === 'failed') {
    return {
      labelKey: 'projects.status.failed',
      labelFallback: 'Failed',
      tone: 'danger',
      bucket: 'unhealthy',
      hintKey: 'projects.status.failedHint',
      hintFallback: 'Deploy or health check failed — check logs',
      raw,
    };
  }

  if (ps === 'unhealthy' || st === 'unhealthy') {
    return {
      labelKey: 'projects.status.unhealthy',
      labelFallback: 'Unhealthy',
      tone: 'danger',
      bucket: 'unhealthy',
      hintKey: 'projects.status.unhealthyHint',
      hintFallback: 'Process is up but health check failed',
      raw,
    };
  }

  if (
    st === 'active_pending_os' ||
    st === 'pending_os' ||
    st.includes('pending_os') ||
    ps === 'active_pending_os'
  ) {
    return {
      labelKey: 'projects.status.pendingOs',
      labelFallback: 'OS user pending',
      tone: 'warn',
      bucket: 'pending_os',
      hintKey: 'projects.status.pendingOsHint',
      hintFallback:
        'System user not provisioned',
      raw,
    };
  }

  if (st === 'running_degraded') {
    return {
      labelKey: 'projects.status.degraded',
      labelFallback: 'Running (degraded)',
      tone: 'warn',
      bucket: 'degraded',
      hintKey: 'projects.status.degradedHint',
      hintFallback: 'Process is up but not full production mode (e.g. non-root / pidfile)',
      raw,
    };
  }

  if (st === 'deploying' || ps === 'starting') {
    return {
      labelKey: 'projects.status.deploying',
      labelFallback: 'Deploying',
      tone: 'info',
      bucket: 'other',
      raw,
    };
  }

  if (st === 'published') {
    return {
      labelKey: 'projects.status.published',
      labelFallback: 'Published',
      tone: 'ok',
      bucket: 'running',
      hintKey: 'projects.status.publishedHint',
      hintFallback: 'Nginx config written; process may still be separate',
      raw,
    };
  }

  if (ps === 'running' || st === 'running') {
    return {
      labelKey: 'projects.status.running',
      labelFallback: 'Running',
      tone: 'ok',
      bucket: 'running',
      raw,
    };
  }

  if (ps === 'stopped' || st === 'stopped') {
    return {
      labelKey: 'projects.status.stopped',
      labelFallback: 'Stopped',
      tone: 'neutral',
      bucket: 'stopped',
      raw,
    };
  }

  if (st === 'active' || (!ps && !st)) {
    return {
      labelKey: 'projects.status.ready',
      labelFallback: 'Ready',
      tone: 'neutral',
      bucket: 'stopped',
      hintKey: 'projects.status.readyHint',
      hintFallback: 'Created — deploy to start',
      raw,
    };
  }

  return {
    labelKey: 'projects.status.unknown',
    labelFallback: raw || 'Unknown',
    tone: 'warn',
    bucket: 'other',
    raw,
  };
}

export function summarizeProjects(items: ProjectDto[]) {
  let running = 0;
  let degraded = 0;
  let unhealthy = 0;
  let stopped = 0;
  let pendingOs = 0;
  for (const p of items) {
    const b = deriveProjectStatus(p).bucket;
    if (b === 'running') running += 1;
    else if (b === 'degraded') degraded += 1;
    else if (b === 'unhealthy') unhealthy += 1;
    else if (b === 'pending_os') pendingOs += 1;
    else stopped += 1;
  }
  return { total: items.length, running, degraded, unhealthy, stopped, pendingOs };
}

export type ChecklistStepState = 'done' | 'warn' | 'todo';

export interface ChecklistStep {
  id: string;
  labelKey: string;
  labelFallback: string;
  state: ChecklistStepState;
}

/** Main path: create → OS → deploy → nginx → health */
export function buildProjectChecklist(project: ProjectDto): ChecklistStep[] {
  const display = deriveProjectStatus(project);
  const created: ChecklistStepState = 'done';
  const os: ChecklistStepState = project.osProvisioned
    ? 'done'
    : display.bucket === 'pending_os'
      ? 'warn'
      : project.linuxUser
        ? 'warn'
        : 'todo';
  const deployed: ChecklistStepState = project.lastDeployAt
    ? 'done'
    : display.bucket === 'running' || display.bucket === 'degraded'
      ? 'done'
      : 'todo';
  const nginx: ChecklistStepState = project.nginxConfigPath ? 'done' : 'todo';
  const healthOk =
    project.lastHealth && typeof project.lastHealth === 'object'
      ? (project.lastHealth as { ok?: boolean }).ok
      : undefined;
  const health: ChecklistStepState =
    healthOk === true ? 'done' : healthOk === false ? 'warn' : 'todo';

  return [
    {
      id: 'created',
      labelKey: 'projects.checklist.created',
      labelFallback: 'Created',
      state: created,
    },
    {
      id: 'os',
      labelKey: 'projects.checklist.os',
      labelFallback: 'OS user',
      state: os,
    },
    {
      id: 'deploy',
      labelKey: 'projects.checklist.deploy',
      labelFallback: 'Deploy',
      state: deployed,
    },
    {
      id: 'nginx',
      labelKey: 'projects.checklist.nginx',
      labelFallback: 'Nginx',
      state: nginx,
    },
    {
      id: 'health',
      labelKey: 'projects.checklist.health',
      labelFallback: 'Health',
      state: health,
    },
  ];
}

export function formatHealthFacts(lastHealth: Record<string, unknown> | undefined | null): Array<{
  labelKey: string;
  labelFallback: string;
  value: string;
  hint?: string;
  tone?: BadgeTone;
}> {
  if (!lastHealth || typeof lastHealth !== 'object') return [];

  const facts: Array<{
    labelKey: string;
    labelFallback: string;
    value: string;
    hint?: string;
    tone?: BadgeTone;
  }> = [];

  if ('ok' in lastHealth) {
    const ok = Boolean(lastHealth.ok);
    facts.push({
      labelKey: 'projects.healthDetail.overall',
      labelFallback: 'Result',
      value: ok ? 'OK' : 'Failed',
      tone: ok ? 'ok' : 'danger',
    });
  }
  if (lastHealth.nginxStatus != null) {
    facts.push({
      labelKey: 'projects.healthDetail.nginxStatus',
      labelFallback: 'Nginx',
      value: String(lastHealth.nginxStatus),
      hint:
        lastHealth.nginxStatus === 'managed_only'
          ? 'Nginx config written (local)'
          : undefined,
    });
  }
  if ('nginxReloaded' in lastHealth) {
    facts.push({
      labelKey: 'projects.healthDetail.nginxReloaded',
      labelFallback: 'Nginx reload',
      value: lastHealth.nginxReloaded ? 'Yes' : 'No',
      tone: lastHealth.nginxReloaded ? 'ok' : 'warn',
    });
  }
  if (lastHealth.status != null) {
    facts.push({
      labelKey: 'projects.healthDetail.httpStatus',
      labelFallback: 'HTTP',
      value: String(lastHealth.status),
    });
  }
  if (lastHealth.ms != null) {
    facts.push({
      labelKey: 'projects.healthDetail.latency',
      labelFallback: 'Latency',
      value: `${lastHealth.ms} ms`,
    });
  }
  if (lastHealth.error != null && lastHealth.error !== '') {
    facts.push({
      labelKey: 'projects.healthDetail.error',
      labelFallback: 'Error',
      value: String(lastHealth.error),
      tone: 'danger',
    });
  }
  if (lastHealth.at != null) {
    const d = new Date(String(lastHealth.at));
    facts.push({
      labelKey: 'projects.healthDetail.at',
      labelFallback: 'Checked at',
      value: Number.isNaN(d.getTime()) ? String(lastHealth.at) : d.toLocaleString(),
    });
  }

  // generic remaining keys (skip already shown)
  const skip = new Set([
    'ok',
    'nginxStatus',
    'nginxReloaded',
    'status',
    'ms',
    'error',
    'at',
    'body',
  ]);
  for (const [k, v] of Object.entries(lastHealth)) {
    if (skip.has(k)) continue;
    if (v == null || typeof v === 'object') continue;
    facts.push({
      labelKey: '',
      labelFallback: k,
      value: String(v),
    });
  }

  return facts;
}
