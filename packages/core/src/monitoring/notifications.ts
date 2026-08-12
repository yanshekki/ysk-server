import { tl } from '@yanshekki/shared';
/**
 * Aggregate panel notifications for dashboard (honest, derived from live state).
 */

import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';
import { collectMetrics } from './metrics.js';
import { parseCertExpiryFromPath } from '../hosting/ssl-certs.js';
import { auditApplyStatuses } from '../hosting/apply-audit.js';
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
      title: tl('notes.auto.n0025'),
      body: tl('notes.auto.n0214'),
      href: '/system/readiness',
      source: 'host' });
  }

  // Metrics
  try {
    const m = collectMetrics();
    for (const a of m.alerts ?? []) {
      if (a === 'memory_high') {
        push({
          id: 'mem-high',
          level: 'warn',
          title: tl('notes.auto.n1357'),
          body: tl('notes.auto.n0504'),
          href: '/metrics',
          source: 'metrics' });
      }
      if (a === 'load_high') {
        push({
          id: 'load-high',
          level: 'warn',
          title: tl('notes.auto.n1446'),
          body: tl('notes.auto.n0063'),
          href: '/metrics',
          source: 'metrics' });
      }
      if (a === 'disk_high') {
        push({
          id: 'disk-high',
          level: 'critical',
          title: tl('notes.auto.n1292'),
          body: tl('notes.auto.n1007'),
          href: '/metrics',
          source: 'metrics' });
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
      title: tl('notes.auto.t0445', { v0: (suspended.length) }),
      body: suspended
        .slice(0, 3)
        .map((p) => p.name)
        .join('、'),
      href: '/projects',
      source: 'projects' });
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
        title: tl('notes.auto.t0446', { v0: (bare.length) }),
        body: tl('notes.auto.n1247'),
        href: '/projects',
        source: 'projects' });
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
      title: tl('notes.auto.t0447', { v0: (pendingApprovals.length) }),
      body: pendingApprovals
        .slice(0, 3)
        .map((a) => a.action)
        .join('、'),
      href: '/security?tab=approvals',
      source: 'security' });
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
        title: days < 0 ? tl('notes.auto.t0448', { v0: (domain) }) : tl('notes.auto.t0449', { v0: (days), v1: (domain) }),
        body: exp,
        href: `/ssl?domain=${encodeURIComponent(domain)}`,
        source: 'ssl' });
    }
  }

  // Last backup failed (or side steps failed while tar ok)
  const lastBackup = input.lastBackup;
  if (lastBackup && lastBackup.ok === false) {
    push({
      id: 'backup-fail',
      level: 'warn',
      title: tl('notes.auto.n0490'),
      body: lastBackup.at ? tl('notes.auto.t0450', { v0: (String(lastBackup.at)) }) : tl('notes.auto.n1383'),
      href: '/backups?tab=ops',
      source: 'backup' });
  } else if (lastBackup && lastBackup.ok === true && lastBackup.sideOk === false) {
    push({
      id: 'backup-side-fail',
      level: 'warn',
      title: tl('notes.auto.n0560'),
      body: tl('notes.auto.n1382'),
      href: '/backups?tab=ops',
      source: 'backup' });
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
          title: tl('notes.auto.t0451', { v0: (r.domain ?? 'IP') }),
          body: (r.listedOn ?? []).join(', ') || 'listed',
          href: '/email',
          source: 'email' });
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
        title: def === 'critical' ? tl('notes.auto.n1527') : tl('notes.auto.n1529'),
        body: tl('notes.auto.n1385'),
        href: '/protection',
        source: 'defense' });
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
          title: tl('notes.auto.n0026'),
          body: tl('notes.auto.n0994'),
          href: '/protection',
          source: 'defense' });
      }
    }
  } catch {
    /* ignore */
  }

  // Apply honesty audit — surface blocked / stuck-at-written resources
  try {
    const audit = auditApplyStatuses(input.db);
    if (audit.summary.bad > 0) {
      const sample = audit.findings
        .filter((f) => f.severity === 'bad')
        .slice(0, 3)
        .map((f) => f.name)
        .join('、');
      push({
        id: 'apply-audit-bad',
        level: 'critical',
        title: tl('notes.auto.t0452', { v0: (audit.summary.bad) }),
        body: sample || tl('notes.auto.n1384'),
        href: '/?tab=notifications',
        source: 'apply-audit' });
    } else if (audit.summary.warn > 0) {
      push({
        id: 'apply-audit-warn',
        level: 'warn',
        title: tl('notes.auto.t0453', { v0: (audit.summary.warn) }),
        body: tl('notes.auto.n0890'),
        href: '/?tab=notifications',
        source: 'apply-audit' });
    }
  } catch {
    /* ignore */
  }

  // Root not available while EXECUTE on — production risk
  if (exec && !input.host.isRoot()) {
    push({
      id: 'not-root',
      level: 'warn',
      title: tl('notes.auto.n1595'),
      body: tl('notes.auto.n0211'),
      href: '/system/readiness',
      source: 'host' });
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
          title: tl('notes.auto.n1528'),
          body: tl('notes.auto.n0597'),
          href: '/protection',
          source: 'defense' });
      }
      if (a.enabled && a.lastPresetId && a.lastPresetId !== 'daily') {
        const note = (a.lastTickNotes ?? []).find((n) => n.includes(tl('notes.auto.n1337')));
        if (note) {
          push({
            id: 'defense-auto-preset',
            level: 'warn',
            title: tl('notes.auto.t0454', { v0: (a.lastPresetId) }),
            body: note,
            href: '/protection',
            source: 'defense' });
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
      title: tl('notes.auto.t0455', { v0: (e.action) }),
      body: e.resource ? String(e.resource) : tl('notes.auto.n1350'),
      href: '/security',
      source: 'audit',
      at: e.created_at });
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
            title: tl('notes.auto.t0456', { v0: (h.journalDiskMb) }),
            body: tl('notes.auto.t0457', { v0: (warnMb) }),
            href: '/logs?tab=maintain',
            source: 'logs',
            at: h.at });
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
