/**
 * Aggregate panel notifications for dashboard (honest, derived from live state).
 */

import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';
import { collectMetrics } from './metrics.js';
import { parseCertExpiryFromPath } from '../hosting/ssl-certs.js';
import { existsSync } from 'node:fs';

export type NotificationLevel = 'critical' | 'warn' | 'info';

export type NotificationItem = {
  id: string;
  level: NotificationLevel;
  title: string;
  body: string;
  href?: string;
  source: string;
  at: string;
};

export async function collectNotifications(input: {
  db: YskDatabase;
  host: HostExecutor;
  dataDir: string;
  /** precomputed optional */
  executeEnabled?: boolean;
  /** Optional JSON blobs from settings repo */
  lastBackup?: Record<string, unknown> | null;
  lastDnsbl?: Record<string, unknown> | null;
}): Promise<{ items: NotificationItem[]; counts: Record<NotificationLevel, number> }> {
  const items: NotificationItem[] = [];
  const now = new Date().toISOString();
  const push = (n: Omit<NotificationItem, 'at'> & { at?: string }) => {
    items.push({ ...n, at: n.at ?? now });
  };

  // Execute permission
  const exec = input.executeEnabled ?? input.host.executeEnabled();
  if (!exec) {
    push({
      id: 'exec-disabled',
      level: 'warn',
      title: '系統變更未開啟',
      body: 'YSK_EXECUTE 未開 — 套用到系統嘅操作會 blocked',
      href: '/system/readiness',
      source: 'host',
    });
  }

  // Metrics
  try {
    const m = collectMetrics();
    for (const a of m.alerts ?? []) {
      if (a === 'memory_high') {
        push({
          id: 'mem-high',
          level: 'warn',
          title: '記憶體偏高',
          body: '主機 memory 使用率超過 90%',
          href: '/metrics',
          source: 'metrics',
        });
      }
      if (a === 'load_high') {
        push({
          id: 'load-high',
          level: 'warn',
          title: '負載偏高',
          body: '1 分鐘 load 超過 CPU×2',
          href: '/metrics',
          source: 'metrics',
        });
      }
      if (a === 'disk_high') {
        push({
          id: 'disk-high',
          level: 'critical',
          title: '磁碟空間不足',
          body: '根分割使用率超過 90%',
          href: '/metrics',
          source: 'metrics',
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Suspended projects
  const suspended = input.db.snapshot.projects.filter((p) => p.status === 'suspended');
  if (suspended.length) {
    push({
      id: 'proj-suspended',
      level: 'info',
      title: `${suspended.length} 個專案已暫停`,
      body: suspended
        .slice(0, 3)
        .map((p) => p.name)
        .join('、'),
      href: '/projects',
      source: 'projects',
    });
  }

  // Certs expiring ≤ 30d
  const nowMs = Date.now();
  for (const c of input.db.snapshot.certificates ?? []) {
    const domain = String(c.domain ?? '');
    let exp = c.expires_at ? String(c.expires_at) : null;
    if (!exp && c.fullchain_path && existsSync(String(c.fullchain_path))) {
      exp = parseCertExpiryFromPath(String(c.fullchain_path));
    }
    if (!exp) continue;
    const days = Math.floor((new Date(exp).getTime() - nowMs) / 86400_000);
    if (days <= 30) {
      push({
        id: `cert-${domain}`,
        level: days <= 7 ? 'critical' : 'warn',
        title: days < 0 ? `憑證已過期：${domain}` : `憑證 ${days} 日內到期：${domain}`,
        body: exp,
        href: `/ssl?domain=${encodeURIComponent(domain)}`,
        source: 'ssl',
      });
    }
  }

  // Last backup failed
  const lastBackup = input.lastBackup;
  if (lastBackup && lastBackup.ok === false) {
    push({
      id: 'backup-fail',
      level: 'warn',
      title: '上次全部備份有失敗',
      body: lastBackup.at ? `時間 ${String(lastBackup.at)}` : '請到備份頁查看',
      href: '/backups',
      source: 'backup',
    });
  }

  // DNSBL listed from last run
  const lastDnsbl = input.lastDnsbl as {
    reports?: Array<{ domain?: string; ok?: boolean; listedOn?: string[] }>;
  } | null;
  if (lastDnsbl?.reports) {
    for (const r of lastDnsbl.reports) {
      if (r.ok === false) {
        push({
          id: `dnsbl-${r.domain}`,
          level: 'critical',
          title: `DNSBL 上榜：${r.domain ?? 'IP'}`,
          body: (r.listedOn ?? []).join(', ') || 'listed',
          href: '/email',
          source: 'email',
        });
      }
    }
  }

  // Failed audit in last 20
  const failedAudit = (input.db.snapshot.audit_events ?? [])
    .filter((e) => e.ok === false)
    .slice(0, 5);
  for (const e of failedAudit) {
    push({
      id: `audit-${e.id}`,
      level: 'info',
      title: `操作失敗：${e.action}`,
      body: e.resource ? String(e.resource) : '見審計',
      href: '/security',
      source: 'audit',
      at: e.created_at,
    });
  }

  // Sort: critical > warn > info
  const rank = { critical: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.level] - rank[b.level] || (a.at < b.at ? 1 : -1));

  const counts = { critical: 0, warn: 0, info: 0 };
  for (const i of items) counts[i.level]++;

  return { items: items.slice(0, 50), counts };
}
