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
  {
    id: 'disk-pressure',
    name: 'Disk pressure check',
    description: 'Read-only disk usage via df',
    emergency: false,
    steps: [
      { tool: 'sys.info', args: {}, description: 'Host facts' },
      { tool: 'fs.read', args: { path: '/proc/mounts' }, description: 'Mount table' },
    ],
  },
  {
    id: 'mail-stack-status',
    name: 'Mail stack status',
    description: 'Check postfix + dovecot units',
    emergency: false,
    steps: [
      { tool: 'service.status', args: { name: 'postfix' }, description: 'Postfix' },
      { tool: 'service.status', args: { name: 'dovecot' }, description: 'Dovecot' },
    ],
  },
  {
    id: 'security-units',
    name: 'Security units',
    description: 'fail2ban + sshd status (read-only)',
    emergency: false,
    steps: [
      { tool: 'service.status', args: { name: 'fail2ban' }, description: 'fail2ban' },
      { tool: 'service.status', args: { name: 'ssh' }, description: 'sshd (ssh unit)' },
    ],
  },
  {
    id: 'web-stack-status',
    name: 'Web stack status',
    description: 'nginx + php-fpm probe',
    emergency: false,
    steps: [
      { tool: 'service.status', args: { name: 'nginx' }, description: 'Nginx' },
      { tool: 'service.status', args: { name: 'php8.2-fpm' }, description: 'PHP-FPM 8.2' },
    ],
  },
  {
    id: 'emergency-read-only',
    name: 'Emergency read-only sweep',
    description: 'Protection-safe facts only',
    emergency: true,
    steps: [
      { tool: 'sys.info', args: {}, description: 'sys.info' },
      { tool: 'process.list', args: {}, description: 'processes' },
      { tool: 'fs.read', args: { path: '/etc/os-release' }, description: 'os-release' },
    ],
  },
  {
    id: 'backup-health',
    name: 'Backup readiness',
    description: 'Check disk + list processes before backup window',
    emergency: false,
    steps: [
      { tool: 'sys.info', args: {}, description: 'Host capacity' },
      { tool: 'service.status', args: { name: 'ysk-server' }, description: 'Panel unit' },
    ],
  },
  {
    id: 'db-stack-status',
    name: 'Database stack status',
    description: 'mysql/mariadb/redis/postgres units',
    emergency: false,
    steps: [
      { tool: 'service.status', args: { name: 'mysql' }, description: 'MySQL' },
      { tool: 'service.status', args: { name: 'mariadb' }, description: 'MariaDB' },
      { tool: 'service.status', args: { name: 'redis-server' }, description: 'Redis' },
      { tool: 'service.status', args: { name: 'postgresql' }, description: 'PostgreSQL' },
    ],
  },
  {
    id: 'ssl-nginx-check',
    name: 'SSL + Nginx check',
    description: 'nginx status before cert ops',
    emergency: false,
    steps: [
      { tool: 'service.status', args: { name: 'nginx' }, description: 'Nginx' },
      { tool: 'fs.read', args: { path: '/etc/nginx/nginx.conf' }, description: 'nginx.conf head check' },
    ],
  },
];

export function listPlaybooks(): Playbook[] {
  return BUILTIN_PLAYBOOKS.map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s })) }));
}

export function getPlaybook(id: string): Playbook {
  const p = BUILTIN_PLAYBOOKS.find((x) => x.id === id);
  if (!p) {
    throw new YskError(ErrorCodes.NOT_FOUND, `找不到 Playbook：${id}`, { httpStatus: 404 });
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
