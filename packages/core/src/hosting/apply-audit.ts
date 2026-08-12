/**
 * Honesty audit of apply_status / last ops across control plane.
 * Surfaces written ≠ applied, blocked, and dishonest ok+blocked last_apply blobs.
 */

import {
  assertHonestOps,
  type OpsResultDto,
  type OpsResultInput,  tl} from 'ysk-server-shared';
import type { YskDatabase } from '../db/database.js';

/** @deprecated import assertHonestOps from ysk-server-shared */
/** Re-export honesty layer helper for apply paths (SSOT with apply-honesty.ts). */
export { honestyFromFlags, type HonestyLayer } from './apply-honesty.js';

export function normalizeOpsHonesty<T extends OpsResultInput>(result: T): T & OpsResultDto {
  return assertHonestOps(result);
}

export type { OpsResultDto };

export type ApplyAuditFinding = {
  kind: string;
  id: string;
  name: string;
  apply_status?: string;
  issue?: string;
  severity: 'ok' | 'warn' | 'bad';
  href?: string;
};

export type ApplyAuditResult = {
  findings: ApplyAuditFinding[];
  summary: { ok: number; warn: number; bad: number; total: number };
};

function classifyStatus(st: string): {
  severity: ApplyAuditFinding['severity'];
  issue?: string;
} {
  const s = (st || 'unknown').toLowerCase();
  if (s === 'blocked' || s === 'failed' || s === 'error') {
    return { severity: 'bad', issue: `apply_status=${st}` };
  }
  if (s === 'written' || s === 'draft' || s === 'planned' || s === 'partial') {
    return { severity: 'warn', issue: tl('notes.auto.t0226', { v0: (st) }) };
  }
  if (
    s === 'applied' ||
    s === 'active' ||
    s === 'running' ||
    s === 'ok' ||
    s === 'enabled'
  ) {
    return { severity: 'ok' };
  }
  if (s === 'unknown' || !s) {
    return { severity: 'warn', issue: tl('notes.auto.n1070') };
  }
  return { severity: 'warn', issue: tl('notes.auto.t0227', { v0: (st) }) };
}

/** Detect dishonest last_apply payloads stored on resources */
function auditLastApply(
  kind: string,
  id: string,
  name: string,
  last: unknown,
  href: string,
): ApplyAuditFinding | null {
  if (!last || typeof last !== 'object') return null;
  const o = last as Record<string, unknown>;
  const ok = o.ok === true;
  const blocked = Boolean(o.blocked || o.requiresExecute || o.requiresRoot);
  if (ok && blocked) {
    return {
      kind,
      id,
      name,
      apply_status: String(o.apply_status ?? 'unknown'),
      issue: tl('notes.auto.n0318'),
      severity: 'bad',
      href,
    };
  }
  if (String(o.apply_status) === 'applied' && blocked) {
    return {
      kind,
      id,
      name,
      apply_status: 'applied',
      issue: tl('notes.auto.n0317'),
      severity: 'bad',
      href,
    };
  }
  return null;
}

export function auditApplyStatuses(db: YskDatabase): ApplyAuditResult {
  const findings: ApplyAuditFinding[] = [];

  const addRes = (
    kind: string,
    rows: Array<Record<string, unknown>> | undefined,
    nameKey: string,
    hrefPrefix: string,
  ) => {
    for (const r of rows ?? []) {
      const id = String(r.id ?? '');
      const name = String(r[nameKey] ?? id);
      const st = String(r.apply_status ?? r.status ?? 'unknown');
      const { severity, issue } = classifyStatus(st);
      const href =
        hrefPrefix.includes(':id')
          ? hrefPrefix.replace(':id', encodeURIComponent(id))
          : hrefPrefix;
      findings.push({
        kind,
        id,
        name,
        apply_status: st,
        issue,
        severity,
        href,
      });
      const dishonest = auditLastApply(kind, id, name, r.last_apply, href);
      if (dishonest) findings.push(dishonest);
    }
  };

  addRes('dns_zone', db.snapshot.dns_zones ?? [], 'zone', '/dns');
  addRes('ftp', db.snapshot.ftp_accounts ?? [], 'username', '/ftp');
  addRes('nginx_site', db.snapshot.nginx_sites ?? [], 'serverName', '/nginx');
  addRes('certificate', db.snapshot.certificates ?? [], 'domain', '/ssl');
  addRes('mysql_db', db.snapshot.mysql_databases ?? [], 'name', '/databases/mysql');
  addRes('postgres_db', db.snapshot.postgres_databases ?? [], 'name', '/databases/postgres');
  addRes('redis', db.snapshot.redis_instances ?? [], 'name', '/databases/redis');
  addRes('cron', db.snapshot.cron_jobs ?? [], 'name', '/cron');

  for (const p of db.snapshot.projects) {
    const st = p.status ?? 'unknown';
    let severity: ApplyAuditFinding['severity'] = 'ok';
    let issue: string | undefined;
    if (st === 'failed' || st === 'unhealthy') {
      severity = 'bad';
      issue = `status=${st}`;
    } else if (st === 'suspended') {
      severity = 'warn';
      issue = 'suspended';
    } else if (!p.nginx_config_path) {
      severity = 'warn';
      issue = tl('notes.auto.n0963');
    }
    findings.push({
      kind: 'project',
      id: p.id,
      name: p.name,
      apply_status: st,
      issue,
      severity,
      href: `/projects/${p.id}`,
    });
  }

  for (const e of db.snapshot.email_domains ?? []) {
    const st = String(e.apply_status ?? e.status ?? 'unknown');
    const { severity, issue } = classifyStatus(st);
    findings.push({
      kind: 'email_domain',
      id: String(e.id ?? ''),
      name: String(e.domain ?? ''),
      apply_status: st,
      issue:
        st === 'suspended'
          ? 'suspended'
          : issue,
      severity: st === 'suspended' ? 'warn' : severity,
      href: `/email/domains/${e.id}`,
    });
    const dishonest = auditLastApply(
      'email_domain',
      String(e.id ?? ''),
      String(e.domain ?? ''),
      e.last_apply,
      `/email/domains/${e.id}`,
    );
    if (dishonest) findings.push(dishonest);
  }

  const summary = { ok: 0, warn: 0, bad: 0, total: findings.length };
  for (const f of findings) summary[f.severity]++;

  findings.sort((a, b) => {
    const r = { bad: 0, warn: 1, ok: 2 };
    return r[a.severity] - r[b.severity];
  });

  return { findings, summary };
}
