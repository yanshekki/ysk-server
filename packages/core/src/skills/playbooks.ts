/**
 * Built-in emergency / ops playbooks — structured steps only (allowlisted tools).
 */

import { randomUUID } from 'node:crypto';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface PlaybookStep {
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  emergency: boolean;
  steps: PlaybookStep[];
}

export const BUILTIN_PLAYBOOKS: Playbook[] = [
  {
    id: 'discover-host',
    name: 'Host discovery',
    description: 'Read-only host inventory',
    emergency: false,
    steps: [
      { tool: 'sys.info', args: {}, description: 'Collect system info' },
      { tool: 'process.list', args: {}, description: 'List processes' },
    ],
  },
  {
    id: 'nginx-health',
    name: 'Nginx health check',
    description: 'Check nginx service status',
    emergency: false,
    steps: [
      { tool: 'service.status', args: { name: 'nginx' }, description: 'Query nginx active state' },
    ],
  },
  {
    id: 'nginx-restart',
    name: 'Nginx restart (high risk)',
    description: 'Restart nginx after approval',
    emergency: true,
    steps: [
      { tool: 'service.status', args: { name: 'nginx' }, description: 'Pre-check status' },
      { tool: 'service.restart', args: { name: 'nginx' }, description: 'Restart nginx' },
      { tool: 'service.status', args: { name: 'nginx' }, description: 'Post-check status' },
    ],
  },
  {
    id: 'local-llm-ops-only',
    name: 'Local LLM ops only',
    description: 'Emergency discovery under protection mode',
    emergency: true,
    steps: [
      { tool: 'sys.info', args: {}, description: 'Local system facts' },
      { tool: 'fs.read', args: { path: '/etc/os-release' }, description: 'OS release' },
    ],
  },
];

export function listPlaybooks(): Playbook[] {
  return BUILTIN_PLAYBOOKS.map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s })) }));
}

export function getPlaybook(id: string): Playbook {
  const p = BUILTIN_PLAYBOOKS.find((x) => x.id === id);
  if (!p) {
    throw new YskError(ErrorCodes.NOT_FOUND, `Playbook not found: ${id}`, { httpStatus: 404 });
  }
  return { ...p, steps: p.steps.map((s) => ({ ...s })) };
}

export interface PlaybookRun {
  id: string;
  playbookId: string;
  actor: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: Array<{ tool: string; ok: boolean; detail: unknown }>;
  created_at: string;
}

export function startPlaybookRun(playbookId: string, actor: string): PlaybookRun {
  getPlaybook(playbookId);
  return {
    id: randomUUID(),
    playbookId,
    actor,
    status: 'pending',
    results: [],
    created_at: new Date().toISOString(),
  };
}
