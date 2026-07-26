/**
 * Sample honesty audit of apply_status / last ops across control plane.
 */

import type { YskDatabase } from '../db/database.js';

export type ApplyAuditFinding = {
  kind: string;
  id: string;
  name: string;
  apply_status?: string;
  issue?: string;
  severity: 'ok' | 'warn' | 'bad';
  href?: string;
};

export function auditApplyStatuses(db: YskDatabase): {
  findings: ApplyAuditFinding[];
  summary: { ok: number; warn: number; bad: number; total: number };
} {
  const findings: ApplyAuditFinding[] = [];

  const addRes = (
    kind: string,
    rows: Array<Record<string, unknown>>,
    nameKey: string,
    hrefPrefix: string,
  ) => {
    for (const r of rows) {
      const id = String(r.id ?? '');
      const name = String(r[nameKey] ?? id);
      const st = String(r.apply_status ?? r.status ?? 'unknown');
      let severity: ApplyAuditFinding['severity'] = 'ok';
      let issue: string | undefined;
      if (st === 'blocked' || st === 'failed' || st === 'error') {
        severity = 'bad';
        issue = `apply_status=${st}`;
      } else if (st === 'written' || st === 'draft' || st === 'planned') {
        severity = 'warn';
        issue = `尚未 applied（${st}）`;
      } else if (st === 'applied' || st === 'active' || st === 'running' || st === 'ok') {
        severity = 'ok';
      } else if (st === 'unknown' || !st) {
        severity = 'warn';
        issue = '無 apply_status';
      }
      findings.push({
        kind,
        id,
        name,
        apply_status: st,
        issue,
        severity,
        href: hrefPrefix,
      });
    }
  };

  addRes('dns_zone', db.snapshot.dns_zones ?? [], 'zone', '/dns');
  addRes('ftp', db.snapshot.ftp_accounts ?? [], 'username', '/ftp');
  addRes('nginx_site', db.snapshot.nginx_sites ?? [], 'serverName', '/nginx');
  addRes('certificate', db.snapshot.certificates ?? [], 'domain', '/ssl');

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
      issue = '未發布 nginx conf';
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
    findings.push({
      kind: 'email_domain',
      id: String(e.id ?? ''),
      name: String(e.domain ?? ''),
      apply_status: st,
      issue: st === 'suspended' ? 'suspended' : st === 'draft' ? 'draft' : undefined,
      severity: st === 'failed' ? 'bad' : st === 'draft' || st === 'suspended' ? 'warn' : 'ok',
      href: `/email/domains/${e.id}`,
    });
  }

  const summary = { ok: 0, warn: 0, bad: 0, total: findings.length };
  for (const f of findings) summary[f.severity]++;

  // Surface bad/warn first
  findings.sort((a, b) => {
    const r = { bad: 0, warn: 1, ok: 2 };
    return r[a.severity] - r[b.severity];
  });

  return { findings, summary };
}
