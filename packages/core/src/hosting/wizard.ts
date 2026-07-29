/**
 * One-click create wizard: project + optional DNS zone + mail domain + MySQL DB.
 * Honest notes for each step; partial success is reported per-step.
 */

import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectService } from './project-service.js';
import type { EmailService } from '../email/service.js';
import { assertCanCreateDatabase, assertCanCreateProject } from './package-limits.js';

export type WizardStepResult = {
  step: string;
  ok: boolean;
  notes: string[];
  id?: string;
  detail?: unknown;
};

export async function runCreateWizard(input: {
  db: YskDatabase;
  host: HostExecutor;
  dataDir: string;
  projects: ProjectService;
  email: EmailService;
  actor: string;
  actorUserId?: string;
  body: {
    projectName: string;
    domain?: string;
    runtime?: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
    runtimeVersion?: string;
    serverIp?: string;
    serverIpv6?: string;
    createDns?: boolean;
    createMail?: boolean;
    createDb?: boolean;
    dbName?: string;
    templateId?: string;
  };
}): Promise<{
  ok: boolean;
  steps: WizardStepResult[];
  projectId?: string;
  notes: string[];
}> {
  const steps: WizardStepResult[] = [];
  const notes: string[] = [];
  const domain = input.body.domain?.trim().toLowerCase();
  const runtime = input.body.runtime ?? 'node';

  try {
    assertCanCreateProject(input.db, input.actorUserId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      steps: [{ step: 'package', ok: false, notes: [msg] }],
      notes: [msg],
    };
  }

  // 1) Project
  try {
    const created = await input.projects.create({
      name: input.body.projectName,
      domain,
      runtime,
      runtimeVersion: input.body.runtimeVersion,
      actor: input.actor,
      templateId: input.body.templateId,
    });
    steps.push({
      step: 'project',
      ok: true,
      id: created.project.id,
      notes: [
        `專案 ${created.project.name}`,
        created.osProvision.detail,
        ...(created.scaffold?.notes ?? []),
      ],
      detail: { project: created.project },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ step: 'project', ok: false, notes: [msg] });
    return { ok: false, steps, notes: [msg, '專案建立失敗，已中止'] };
  }

  const projectId = steps[0]?.id;
  const serverIp = input.body.serverIp?.trim() || '127.0.0.1';
  const serverIpv6 = input.body.serverIpv6?.trim() || undefined;

  // 2) DNS zone (control-plane resource)
  if (input.body.createDns && domain) {
    try {
      const { randomUUID } = await import('node:crypto');
      if (!input.db.snapshot.dns_zones) input.db.snapshot.dns_zones = [];
      const id = randomUUID();
      input.db.snapshot.dns_zones.unshift({
        id,
        zone: domain,
        serverIp,
        ...(serverIpv6 ? { serverIpv6 } : {}),
        template: 'full',
        apply_status: 'draft',
        created_at: new Date().toISOString(),
      });
      // seed A/AAAA template records for honesty in records tab
      try {
        const { seedDnsZoneRecords } = await import('./managed-resources.js');
        seedDnsZoneRecords(input.db, id, domain, serverIp, 'full', serverIpv6);
      } catch {
        /* seed optional if import cycle */
      }
      input.db.persist();
      steps.push({
        step: 'dns',
        ok: true,
        id,
        notes: [
          `DNS zone draft ${domain}（需到 DNS 頁寫入/套用）`,
          ...(serverIpv6 ? [`已含 IPv6 ${serverIpv6}`] : []),
        ],
      });
    } catch (e) {
      steps.push({
        step: 'dns',
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  // 3) Mail domain
  if (input.body.createMail && domain) {
    try {
      const d = input.email.create({
        domain,
        serverIp,
        serverIpv6,
        actor: input.actor,
      });
      steps.push({
        step: 'mail',
        ok: true,
        id: d.domain.id,
        notes: [`郵件域名 ${domain} 已登記`],
      });
    } catch (e) {
      steps.push({
        step: 'mail',
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  // 4) MySQL DB registration (control plane)
  if (input.body.createDb) {
    try {
      assertCanCreateDatabase(input.db, input.actorUserId);
      const { randomUUID } = await import('node:crypto');
      const name =
        (input.body.dbName || input.body.projectName)
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .slice(0, 32) || 'app';
      if (!input.db.snapshot.mysql_databases) input.db.snapshot.mysql_databases = [];
      const id = randomUUID();
      input.db.snapshot.mysql_databases.unshift({
        id,
        name,
        engine: 'mysql',
        apply_status: 'draft',
        projectId,
        created_at: new Date().toISOString(),
      });
      input.db.persist();
      steps.push({
        step: 'database',
        ok: true,
        id,
        notes: [`MySQL DB draft ${name}（需到資料庫頁套用）`],
      });
    } catch (e) {
      steps.push({
        step: 'database',
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  const ok = steps.every((s) => s.ok);
  notes.push(
    ok
      ? '一鍵建立完成（draft 資源請到各頁「套用」）'
      : '部分步驟失敗 — 見 steps',
  );
  return { ok, steps, projectId, notes };
}
