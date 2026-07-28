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

  // Projects missing OS isolation (only warn when EXECUTE on — otherwise always true)
  if (exec) {
    const bare = input.db.snapshot.projects.filter(
      (p) => !p.os_provisioned && p.status !== 'suspended',
    );
    if (bare.length) {
      push({
        id: 'proj-no-os',
        level: 'warn',
        title: `${bare.length} 個專案未建立系統用戶`,
        body: '生產隔離：到專案「資源」建立 Linux 用戶與 home',
        href: '/projects',
        source: 'projects',
      });
    }
  }

  // Pending human approvals
  const pendingApprovals = (input.db.snapshot.approvals ?? []).filter(
    (a) => a.status === 'pending',
  );
  if (pendingApprovals.length) {
    push({
      id: 'approvals-pending',
      level: pendingApprovals.length >= 5 ? 'critical' : 'warn',
      title: `${pendingApprovals.length} 項待審批`,
      body: pendingApprovals
        .slice(0, 3)
        .map((a) => a.action)
        .join('、'),
      href: '/security?tab=approvals',
      source: 'security',
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

  // Last backup failed (or side steps failed while tar ok)
  const lastBackup = input.lastBackup;
  if (lastBackup && lastBackup.ok === false) {
    push({
      id: 'backup-fail',
      level: 'warn',
      title: '上次全部備份有失敗',
      body: lastBackup.at ? `時間 ${String(lastBackup.at)}` : '請到備份頁查看',
      href: '/backups?tab=ops',
      source: 'backup',
    });
  } else if (lastBackup && lastBackup.ok === true && lastBackup.sideOk === false) {
    push({
      id: 'backup-side-fail',
      level: 'warn',
      title: '備份 tar 成功但遠端／restic 有問題',
      body: '請到備份操作頁查看 sideResults',
      href: '/backups?tab=ops',
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

  // Defense threat from last status snapshot (optional settings)
  try {
    const def = input.db.snapshot.settings?.defense_last_threat;
    if (def === 'under_attack' || def === 'critical') {
      push({
        id: 'defense-threat',
        level: def === 'critical' ? 'critical' : 'warn',
        title: def === 'critical' ? '防護：危急' : '防護：疑似受攻擊',
        body: '請到防護中心檢視訊號並切換防護檔',
        href: '/protection',
        source: 'defense',
      });
    }
  } catch {
    /* ignore */
  }

  // Auto-ban circuit breaker / pause
  try {
    const raw = input.db.snapshot.settings?.defense_auto_ban;
    if (raw) {
      const pol = JSON.parse(raw) as { enabled?: boolean; pausedReason?: string; mode?: string };
      if (pol.enabled && pol.pausedReason === 'circuit_breaker') {
        push({
          id: 'defense-auto-ban-cb',
          level: 'warn',
          title: '自動 ban 已熔斷',
          body: '本小時封禁次數達上限 — 到防護中心檢查',
          href: '/protection',
          source: 'defense',
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Automation: suggest emergency / last escalate
  try {
    const raw = input.db.snapshot.settings?.defense_automation;
    if (raw) {
      const a = JSON.parse(raw) as {
        enabled?: boolean;
        suggestEmergency?: boolean;
        lastPresetId?: string;
        lastTickNotes?: string[];
      };
      if (a.enabled && a.suggestEmergency) {
        push({
          id: 'defense-suggest-emergency',
          level: 'critical',
          title: '防護：建議緊急檔',
          body: '分數極高 — 緊急檔需人手確認（永不自動）',
          href: '/protection',
          source: 'defense',
        });
      }
      if (a.enabled && a.lastPresetId && a.lastPresetId !== 'daily') {
        const note = (a.lastTickNotes ?? []).find((n) => n.includes('自動防護檔'));
        if (note) {
          push({
            id: 'defense-auto-preset',
            level: 'warn',
            title: `自動防護檔：${a.lastPresetId}`,
            body: note,
            href: '/protection',
            source: 'defense',
          });
        }
      }
    }
  } catch {
    /* ignore */
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

  // Journal / log disk pressure from log-center settings snapshot (optional live probe)
  try {
    const raw = input.db.snapshot.settings?.log_center;
    let warnMb = 1024;
    if (raw) {
      const p = JSON.parse(raw) as { journalWarnMb?: number };
      if (p.journalWarnMb && p.journalWarnMb > 0) warnMb = Number(p.journalWarnMb);
    }
    // Prefer cached overview-style hint if present
    const hint = input.db.snapshot.settings?.log_center_disk_hint;
    if (hint) {
      try {
        const h = JSON.parse(hint) as { journalDiskMb?: number; at?: string };
        if (h.journalDiskMb != null && h.journalDiskMb >= warnMb) {
          push({
            id: 'journal-disk-high',
            level: h.journalDiskMb >= warnMb * 2 ? 'critical' : 'warn',
            title: `Journal 磁碟偏高：≈${h.journalDiskMb} MB`,
            body: `閾值 ${warnMb} MB — 可到日誌中心 vacuum 或調整保留`,
            href: '/logs?tab=maintain',
            source: 'logs',
            at: h.at,
          });
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  // Sort: critical > warn > info
  const rank = { critical: 0, warn: 1, info: 2 };
  items.sort((a, b) => rank[a.level] - rank[b.level] || (a.at < b.at ? 1 : -1));

  const counts = { critical: 0, warn: 0, info: 0 };
  for (const i of items) counts[i.level]++;

  return { items: items.slice(0, 50), counts };
}
