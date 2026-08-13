import { tl } from 'ysk-server-shared';
/**
 * One-click create wizard: project + optional DNS zone + mail domain + MySQL DB.
 * Honest notes for each step; partial success is reported per-step.
 */

import type { YskDatabase } from '../db/database.js';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectService } from './project-service.js';
import type { EmailService } from '../email/service.js';
import { assertCanCreateDatabase, assertCanCreateProject } from './package-limits.js';
import { attachProjectCreateExtras } from './project-create-extras.js';

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
        tl('notes.tpl.project', { name: created.project.name }),
        created.osProvision.detail,
        ...(created.scaffold?.notes ?? []),
      ],
      detail: { project: created.project },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ step: 'project', ok: false, notes: [msg] });
    return { ok: false, steps, notes: [msg, tl('notes.auto.n0692')] };
  }

  const projectId = steps[0]?.id;
  const serverIp = input.body.serverIp?.trim() || '127.0.0.1';
  const serverIpv6 = input.body.serverIpv6?.trim() || undefined;

  // 2) DNS zone (control-plane draft — same helper as panel/CLI)
  if (input.body.createDns && domain) {
    const linked = attachProjectCreateExtras({
      db: input.db,
      email: input.email,
      projectId: projectId ?? '',
      domain,
      actor: input.actor,
      createDnsZone: true,
      serverIp,
      serverIpv6,
      dnsTemplate: 'full',
    });
    steps.push({
      step: 'dns',
      ok: Boolean(linked.dnsZoneId),
      id: linked.dnsZoneId,
      notes: linked.notes,
    });
  }

  // 3) Mail domain
  if (input.body.createMail && domain) {
    const linked = attachProjectCreateExtras({
      db: input.db,
      email: input.email,
      projectId: projectId ?? '',
      domain,
      actor: input.actor,
      createMailDomain: true,
      serverIp,
      serverIpv6,
    });
    steps.push({
      step: 'mail',
      ok: Boolean(linked.emailDomainId),
      id: linked.emailDomainId,
      notes: linked.notes,
    });
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
        notes: [tl('notes.auto.t0324', { v0: (name) })],
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
      ? tl('notes.auto.n0488')
      : tl('notes.auto.n1495'),
  );
  return { ok, steps, projectId, notes };
}
