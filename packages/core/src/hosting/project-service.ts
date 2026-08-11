/**
 * Real project lifecycle: DB + disk under dataDir/projects.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectDto } from '@ysk/shared';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
import {
  isCanonicalProjectHome,
  isSafeProjectHomePath,
  planProjectIsolation,
  projectHomeDir } from './project.js';
import { planIsolationMigration } from './project-isolation-status.js';
import { webGroupProvisionCommands } from './project-web-group.js';
import {
  buildServerNameList,
  renderNginxPhpFpm,
  renderNginxStatic,
} from './nginx-ssl.js';
import type { ProjectRepository, ProjectRow } from '../repositories/project-repo.js';
import type { HostExecutor } from '../host/executor.js';
import type { AuditRepository } from '../repositories/audit-repo.js';
import { getAppTemplate, scaffoldAppTemplate, type AppTemplateId } from './app-templates.js';
import {
  apacheBackendUpstream,
  normalizeRuntimeVersion,
  selectPhpRuntime,
} from './runtime.js';
import { normalizeExtraLogDirs } from './project-logs.js';
import { normalizeProjectDocRoot } from './project-ops.js';
import { applyPm2Stop } from './pm2-apply.js';
import { applyProjectWebGroupAccess } from './project-web-group.js';

export type DeleteProjectResult = {
  ok: boolean;
  projectId: string;
  removedFiles: boolean;
  notes: string[];
  warnings: string[];
};

export type DeleteProjectOptions = {
  /** Must equal project.name (trim). Required for API safety. */
  confirmName?: string;
  /** Delete OS home + linux user when safe (default true). */
  removeFiles?: boolean;
  /** Skip name check (CLI --yes with care; tests). */
  skipConfirm?: boolean;
};

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly host: HostExecutor,
    private readonly dataDir: string,
    private readonly audit?: AuditRepository,
  ) {}

  list(): ProjectDto[] {
    return this.projects.list().map((row) => this.healRuntimeVersion(row));
  }

  get(id: string): ProjectDto {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), { httpStatus: 404 });
    }
    return this.healRuntimeVersion(row);
  }

  /** Repair PHP projects that were incorrectly stored with Node default "20". */
  private healRuntimeVersion(row: ProjectRow): ProjectDto {
    const fixed = normalizeRuntimeVersion(row.runtime, row.runtime_version);
    if (fixed !== (row.runtime_version ?? '')) {
      this.projects.updateMeta(row.id, { runtime_version: fixed });
      row = { ...row, runtime_version: fixed };
    }
    return toDto(row);
  }

  /**
   * Create project record + home directory on disk.
   * OS useradd only when YSK_EXECUTE=1 and process is root.
   */
  async create(input: {
    name: string;
    domain?: string;
    domainAliases?: string[];
    runtime: ProjectDto['runtime'];
    runtimeVersion?: string;
    env?: 'staging' | 'production';
    actor: string;
    /** Panel user id for package quota ownership */
    actorUserId?: string;
    /** Optional one-click template */
    templateId?: string;
    forceTemplate?: boolean;
    /** Preferred process listen port (optional) */
    preferredPort?: number;
  }): Promise<{
    project: ProjectDto;
    osProvision: { attempted: boolean; ok: boolean; detail: string };
    plan: string[];
    scaffold?: ReturnType<typeof scaffoldAppTemplate>;
  }> {
    if (!input.name?.trim()) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.needProjectName'), { httpStatus: 400 });
    }
    const nameNorm = input.name.trim();
    // Reject duplicate project names (case-insensitive) before OS provision
    const nameClash = this.projects.list().find(
      (p) => p.name.trim().toLowerCase() === nameNorm.toLowerCase(),
    );
    if (nameClash) {
      throw new YskError(
        ErrorCodes.VALIDATION,
        tl('notes.ops.projectNameExists', { name: nameNorm }),
        { httpStatus: 409, details: { otherProjectId: nameClash.id, name: nameNorm } },
      );
    }
    const domainNorm = input.domain?.trim().toLowerCase();
    if (domainNorm) {
      const domainClash = this.projects.list().find((p) => {
        if ((p.domain ?? '').toLowerCase() === domainNorm) return true;
        return (p.domain_aliases ?? []).some((a) => a.toLowerCase() === domainNorm);
      });
      if (domainClash) {
        throw new YskError(
          ErrorCodes.VALIDATION,
          tl('notes.project.domainInUse', {
            domain: domainNorm,
            other: domainClash.name || domainClash.id,
          }),
          { httpStatus: 409, details: { otherProjectId: domainClash.id } },
        );
      }
    }
    let runtime = input.runtime;
    let runtimeVersion = input.runtimeVersion;
    if (input.templateId) {
      const tpl = getAppTemplate(input.templateId);
      runtime = tpl.runtime;
      runtimeVersion = runtimeVersion ?? tpl.runtimeVersion;
    }
    // Prefer panel default when client/template omitted version
    if (!String(runtimeVersion ?? '').trim() && runtime !== 'static') {
      const { resolvePanelRuntimeVersion } = await import('./runtime-panel-defaults.js');
      runtimeVersion = resolvePanelRuntimeVersion(this.dataDir, runtime);
    }
    // Never default PHP to Node "20" — resolve by runtime kind
    runtimeVersion = normalizeRuntimeVersion(runtime, runtimeVersion);
    const id = randomUUID();
    const plan = planProjectIsolation({
      id,
      name: input.name,
      domain: input.domain,
      runtime,
      runtimeVersion,
      env: input.env });

    const canOs = this.host.executeEnabled() && this.host.isRoot();
    // Canonical production home: /home/ysk-server-{id}
    // Degraded (no root): writable shadow under dataDir until provision migrates
    const canonicalHome = plan.project.homeDir; // /home/ysk-server-{id}
    const shadowHome = join(this.dataDir, 'homes', `ysk-server-${id}`);
    let homeDir = canOs ? canonicalHome : shadowHome;

    let osProvision = {
      attempted: false,
      ok: false,
      detail: canOs
        ? tl('notes.auto.n1055')
        : tl('notes.auto.t0286', { v0: (canonicalHome) }) };

    if (canOs) {
      osProvision = await this.provisionOsUser(
        plan.commands,
        plan.project.linuxUser,
        canonicalHome,
      );
      if (osProvision.ok) {
        homeDir = canonicalHome;
      } else {
        // Fall back to shadow so control-plane files still work; stay not provisioned
        homeDir = shadowHome;
        osProvision = {
          ...osProvision,
          ok: false,
          detail: tl('notes.auto.t0287', { v0: (osProvision.detail), v1: (shadowHome) }) };
      }
    }

    await this.host.mkdirp(join(homeDir, 'app'));
    await this.host.mkdirp(join(homeDir, 'logs'));
    await this.host.mkdirp(join(homeDir, 'tmp'));
    writeFileSync(
      join(homeDir, 'project.json'),
      JSON.stringify(
        {
          id,
          name: input.name,
          linuxUser: plan.project.linuxUser,
          canonicalHome,
          createdAt: new Date().toISOString() },
        null,
        2,
      ),
      'utf8',
    );

    if (canOs && homeDir === canonicalHome) {
      // Ensure ownership after writing control-plane files
      await this.host.runCommand(
        [
          'bash',
          '-c',
          `chown -R ${plan.project.linuxUser}:${plan.project.linuxGroup} ${JSON.stringify(homeDir)} && chmod 750 ${JSON.stringify(homeDir)}`,
        ],
        { timeoutMs: 15_000 },
      ).catch(() => undefined);
    }

    let scaffold: ReturnType<typeof scaffoldAppTemplate> | undefined;
    if (input.templateId) {
      scaffold = scaffoldAppTemplate({
        templateId: input.templateId as AppTemplateId,
        homeDir,
        projectName: input.name,
        domain: input.domain,
        force: input.forceTemplate });
    }

    // PHP/static hello uses app/public; default doc_root so Apache/Nginx match scaffold
    const defaultDocRoot =
      runtime === 'php' ||
      runtime === 'static' ||
      (scaffold?.docRoot && /public/.test(String(scaffold.docRoot)))
        ? 'app/public'
        : undefined;

    const preferredPort =
      typeof input.preferredPort === 'number' &&
      Number.isFinite(input.preferredPort) &&
      input.preferredPort > 0 &&
      input.preferredPort < 65536
        ? Math.floor(input.preferredPort)
        : undefined;

    const aliases = normalizeAliases(input.domainAliases, input.domain);
    // Optional nginx for PHP/static only — never write process proxy to fake :3100
    let nginxPath: string | undefined;
    if (input.domain && (runtime === 'php' || runtime === 'static')) {
      const confDir = join(this.dataDir, 'nginx', 'conf.d');
      mkdirSync(confDir, { recursive: true });
      const serverName = buildServerNameList(input.domain, aliases);
      const docRootAbs = join(homeDir, defaultDocRoot || 'app/public');
      const conf =
        runtime === 'php'
          ? renderNginxPhpFpm({
              serverName,
              docRoot: docRootAbs,
              apacheUpstream: apacheBackendUpstream(),
              ssl: false,
              cloudflareRealIp: true,
            })
          : renderNginxStatic({
              serverName,
              docRoot: docRootAbs,
              ssl: false,
              cloudflareRealIp: true,
            });
      nginxPath = join(confDir, `${plan.project.linuxUser}.conf`);
      writeFileSync(nginxPath, conf, 'utf8');
    }

    if (canOs && homeDir === canonicalHome) {
      // Scaffold wrote as root — re-own then ysk-web so Apache/www-data can read PHP public/
      await this.host
        .runCommand(
          [
            'bash',
            '-c',
            `chown -R ${plan.project.linuxUser}:${plan.project.linuxGroup} ${JSON.stringify(homeDir)} && chmod 750 ${JSON.stringify(homeDir)}`,
          ],
          { timeoutMs: 15_000 },
        )
        .catch(() => undefined);
      await applyProjectWebGroupAccess({
        host: this.host,
        linuxUser: plan.project.linuxUser,
        linuxGroup: plan.project.linuxGroup,
        homeDir,
      }).catch(() => undefined);
    }

    const now = new Date().toISOString();
    const row: ProjectRow = {
      id,
      name: plan.project.name,
      domain: input.domain,
      domain_aliases: aliases,
      linux_user: plan.project.linuxUser,
      linux_group: plan.project.linuxGroup,
      home_dir: homeDir,
      runtime,
      runtime_version: runtimeVersion,
      env: input.env ?? 'production',
      status: osProvision.ok ? 'active' : 'active_pending_os',
      os_provisioned: osProvision.ok,
      force_https: false,
      hsts: false,
      preferred_port: preferredPort,
      doc_root: defaultDocRoot,
      deploy_entry: scaffold?.entry ? String(scaffold.entry) : undefined,
      owner_user_id: input.actorUserId,
      created_at: now,
      updated_at: now };
    this.projects.insert(row);
    this.audit?.append({
      actor: input.actor,
      action: 'project.create',
      resource: id,
      detail: {
        name: input.name,
        homeDir,
        canonicalHome,
        osProvision,
        templateId: input.templateId,
        scaffold },
      ok: true });

    return {
      project: toDto(row),
      osProvision,
      plan: plan.commands,
      scaffold };
  }

  /**
   * Re-attempt Linux user/group isolation for an existing project (root + EXECUTE).
   * Migrates degraded shadow home → /home/ysk-server-{id} when needed.
   * Never fakes success.
   */
  async provisionOsIsolation(
    id: string,
    actor: string,
  ): Promise<{
    ok: boolean;
    osProvision: { attempted: boolean; ok: boolean; detail: string };
    requiresExecute: boolean;
    requiresRoot: boolean;
    homeDir?: string;
  }> {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), { httpStatus: 404 });
    }
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        osProvision: {
          attempted: false,
          ok: false,
          detail: tl('notes.auto.n0819') },
        requiresExecute: !this.host.executeEnabled(),
        requiresRoot: !this.host.isRoot() };
    }

    const canonicalHome = projectHomeDir(id);
    const previousHome = row.home_dir;
    const commands = [
      `groupadd --system ${row.linux_group} 2>/dev/null || true`,
      `id ${row.linux_user} >/dev/null 2>&1 || useradd --system --gid ${row.linux_group} --home-dir ${canonicalHome} --create-home --shell /usr/sbin/nologin ${row.linux_user}`,
      // If user exists with different home, fix home path in passwd
      `usermod -d ${canonicalHome} ${row.linux_user} 2>/dev/null || true`,
      `mkdir -p ${canonicalHome}/app ${canonicalHome}/logs ${canonicalHome}/tmp`,
    ];

    // Migrate files from shadow/legacy home if different
    if (
      previousHome &&
      previousHome !== canonicalHome &&
      existsSync(previousHome) &&
      isSafeProjectHomePath(previousHome, {
        projectId: id,
        dataDir: this.dataDir,
        linuxUser: row.linux_user })
    ) {
      commands.push(
        `cp -a ${JSON.stringify(previousHome + '/.')} ${JSON.stringify(canonicalHome + '/')} 2>/dev/null || true`,
      );
    }

    commands.push(
      `chown -R ${row.linux_user}:${row.linux_group} ${canonicalHome}`,
      `chmod 750 ${canonicalHome}`,
    );
    // Nginx/static: ysk-web group so www-data can read without world-readable home
    commands.push(...webGroupProvisionCommands(row.linux_user, canonicalHome));

    const osProvision = await this.provisionOsUser(commands, row.linux_user, canonicalHome);
    if (osProvision.ok) {
      this.projects.updateMeta(id, { home_dir: canonicalHome });
      this.projects.setOsProvisioned(id, true);
      // Sensible default systemd limits when operator never set any
      if (!row.memory_max || row.cpu_quota_percent == null) {
        this.projects.updateRuntimeState(id, {
          memory_max: row.memory_max ?? '512M',
          cpu_quota_percent: row.cpu_quota_percent ?? 50,
          tasks_max: row.tasks_max ?? 256,
          limit_nofile: row.limit_nofile ?? 4096,
        });
      }
    } else {
      this.projects.setOsProvisioned(id, false);
    }
    this.audit?.append({
      actor,
      action: 'project.os_provision',
      resource: id,
      detail: { osProvision, plan: commands, previousHome, canonicalHome },
      ok: osProvision.ok });
    return {
      ok: osProvision.ok,
      osProvision,
      requiresExecute: false,
      requiresRoot: false,
      homeDir: osProvision.ok ? canonicalHome : previousHome };
  }

  /**
   * Bulk provision OS isolation for projects that need it (root + EXECUTE).
   */
  async provisionOsIsolationAll(
    actor: string,
    opts?: { limit?: number; projectIds?: string[] },
  ): Promise<{
    ok: boolean;
    attempted: number;
    succeeded: number;
    failed: number;
    results: Array<{ id: string; name: string; ok: boolean; detail: string }>;
    requiresExecute: boolean;
    requiresRoot: boolean;
  }> {
    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      return {
        ok: false,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        results: [],
        requiresExecute: !this.host.executeEnabled(),
        requiresRoot: !this.host.isRoot(),
      };
    }
    const { listIsolationReport } = await import('./project-isolation-status.js');
    const snaps = this.projects.list().map((p) => ({
      id: p.id,
      name: p.name,
      linuxUser: p.linux_user,
      homeDir: p.home_dir,
      osProvisioned: Boolean(p.os_provisioned),
      ownerUserId: p.owner_user_id,
    }));
    let need = listIsolationReport(snaps).items.filter((i) => i.needsMigration);
    if (opts?.projectIds?.length) {
      const set = new Set(opts.projectIds);
      need = need.filter((i) => set.has(i.projectId));
    }
    const limit = Math.min(50, opts?.limit ?? 20);
    need = need.slice(0, limit);
    const results: Array<{ id: string; name: string; ok: boolean; detail: string }> = [];
    let succeeded = 0;
    let failed = 0;
    for (const row of need) {
      const r = await this.provisionOsIsolation(row.projectId, actor);
      if (r.ok) succeeded++;
      else failed++;
      results.push({
        id: row.projectId,
        name: row.name,
        ok: r.ok,
        detail: r.osProvision.detail,
      });
    }
    return {
      ok: failed === 0,
      attempted: results.length,
      succeeded,
      failed,
      results,
      requiresExecute: false,
      requiresRoot: false,
    };
  }

  /**
   * Explicit migrate: stop unit best-effort → provision home at /home/ysk-server-{id}
   * → optional remove previous safe home. Operator must confirm (UI).
   * Keeps existing linux_user (legacy name-slug users retained).
   */
  async migrateOsIsolation(
    id: string,
    actor: string,
    opts?: { removePreviousHome?: boolean },
  ): Promise<{
    ok: boolean;
    notes: string[];
    plan: ReturnType<typeof planIsolationMigration>;
    osProvision?: { attempted: boolean; ok: boolean; detail: string };
    requiresExecute: boolean;
    requiresRoot: boolean;
    homeDir?: string;
  }> {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), { httpStatus: 404 });
    }
    const plan = planIsolationMigration({
      id: row.id,
      name: row.name,
      linuxUser: row.linux_user,
      homeDir: row.home_dir,
      osProvisioned: row.os_provisioned });
    const notes = [...plan.reasons];

    if (!plan.needsMigration && row.os_provisioned && isCanonicalProjectHome(row.home_dir, id)) {
      notes.push(tl('notes.auto.n0798'));
      return {
        ok: true,
        notes,
        plan,
        requiresExecute: !this.host.executeEnabled(),
        requiresRoot: !this.host.isRoot(),
        homeDir: row.home_dir };
    }

    if (!this.host.executeEnabled() || !this.host.isRoot()) {
      notes.push(tl('notes.auto.n1487'));
      return {
        ok: false,
        notes,
        plan,
        requiresExecute: !this.host.executeEnabled(),
        requiresRoot: !this.host.isRoot() };
    }

    // Stop project unit before moving home
    const unit = `ysk-project-${row.linux_user}.service`;
    await this.host
      .runCommand(['systemctl', 'stop', unit], { timeoutMs: 15_000 })
      .catch(() => undefined);
    notes.push(tl('notes.auto.t0288', { v0: (unit) }));

    const previousHome = row.home_dir;
    const prov = await this.provisionOsIsolation(id, actor);
    notes.push(prov.osProvision.detail);

    if (prov.ok && opts?.removePreviousHome !== false && previousHome !== prov.homeDir) {
      if (
        previousHome &&
        existsSync(previousHome) &&
        isSafeProjectHomePath(previousHome, {
          projectId: id,
          dataDir: this.dataDir,
          linuxUser: row.linux_user })
      ) {
        // Only remove if canonical has content (project.json or app)
        const canonical = projectHomeDir(id);
        if (existsSync(join(canonical, 'app')) || existsSync(join(canonical, 'project.json'))) {
          try {
            rmSync(previousHome, { recursive: true, force: true });
            notes.push(tl('notes.auto.t0289', { v0: (previousHome) }));
          } catch (e) {
            notes.push(
              tl('notes.auto.t0290', { v0: (previousHome), v1: (e instanceof Error ? e.message : String(e)) }),
            );
          }
        } else {
          notes.push(tl('notes.auto.n1462'));
        }
      }
    }

    this.audit?.append({
      actor,
      action: 'project.os_migrate',
      resource: id,
      detail: { plan, notes, ok: prov.ok },
      ok: prov.ok });

    return {
      ok: prov.ok,
      notes,
      plan,
      osProvision: prov.osProvision,
      requiresExecute: false,
      requiresRoot: false,
      homeDir: prov.homeDir };
  }

  private async provisionOsUser(
    commands: string[],
    linuxUser: string,
    homeDir: string,
  ): Promise<{ attempted: boolean; ok: boolean; detail: string }> {
    const results: string[] = [];
    for (const cmd of commands) {
      // Shell required for `|| true`, brace expansion, redirects
      const r = await this.host.runCommand(['bash', '-c', cmd], { timeoutMs: 60_000 });
      const okish =
        r.exitCode === 0 ||
        /already exists|exists/i.test(r.stderr) ||
        /already exists|exists/i.test(r.stdout);
      results.push(`${cmd} => exit ${r.exitCode}${okish && r.exitCode !== 0 ? ' (ok-ish)' : ''}`);
    }
    // Verify user exists when possible
    const idCheck = await this.host.runCommand(
      ['bash', '-c', `id ${linuxUser} >/dev/null 2>&1; echo $?`],
      { timeoutMs: 5_000 },
    );
    const userExists = idCheck.stdout.trim().endsWith('0') || idCheck.stdout.trim() === '0';
    const homeOk = existsSync(homeDir);
    // Require real user identity — do not treat command noise as success without id(1)
    const ok = Boolean(userExists && homeOk);
    return {
      attempted: true,
      ok,
      detail: [...results, `id ${linuxUser}: ${userExists}`, `home exists: ${homeOk}`].join('; ') };
  }

  /**
   * Apply template onto existing project home.
   */
  applyTemplate(
    id: string,
    templateId: string,
    actor: string,
    force = false,
  ): { project: ProjectDto; scaffold: ReturnType<typeof scaffoldAppTemplate> } {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), { httpStatus: 404 });
    }
    const meta = getAppTemplate(templateId);
    const scaffold = scaffoldAppTemplate({
      templateId,
      homeDir: row.home_dir,
      projectName: row.name,
      domain: row.domain,
      force });
    this.projects.updateMeta(id, {
      runtime: meta.runtime,
      runtime_version: meta.runtimeVersion });
    this.audit?.append({
      actor,
      action: 'project.template',
      resource: id,
      detail: { templateId, scaffold },
      ok: scaffold.ok });
    return { project: this.get(id), scaffold };
  }

  /**
   * Destroy project: stop runners → tear web/PHP → OS user/home → DB.
   * Returns honest notes; ok=true when control-plane row removed.
   */
  async delete(
    id: string,
    actor: string,
    removeFilesOrOpts: boolean | DeleteProjectOptions = true,
  ): Promise<DeleteProjectResult> {
    // Legacy: delete(id, actor, boolean) skips name confirm (tests/CLI internal)
    const opts: DeleteProjectOptions =
      typeof removeFilesOrOpts === 'boolean'
        ? { removeFiles: removeFilesOrOpts, skipConfirm: true }
        : (removeFilesOrOpts ?? {});
    const removeFiles = opts.removeFiles !== false;
    const notes: string[] = [];
    const warnings: string[] = [];

    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), {
        httpStatus: 404,
      });
    }

    if (!opts.skipConfirm) {
      const want = (opts.confirmName ?? '').trim();
      if (!want || want !== row.name.trim()) {
        throw new YskError(
          ErrorCodes.VALIDATION,
          tl('notes.project.deleteNameMismatch', {
            defaultValue: 'confirmName must match project name exactly',
          }),
          { httpStatus: 400, details: { expected: row.name } },
        );
      }
    }

    const canSys = this.host.executeEnabled() && this.host.isRoot();
    const unit = `ysk-project-${row.linux_user}.service`;
    const nginxFile = `${row.linux_user}.conf`;

    // —— 1. Stop runners ——
    try {
      const pm2 = await applyPm2Stop({ host: this.host, linuxUser: row.linux_user });
      notes.push(...pm2.notes);
    } catch (e) {
      notes.push(`pm2 stop: ${e instanceof Error ? e.message : String(e)}`);
    }

    const pid = row.pid;
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        notes.push(`SIGTERM pid=${pid}`);
      } catch {
        notes.push(`pid ${pid} already dead`);
      }
    }
    const pidfile = row.pidfile ?? join(row.home_dir, 'app.pid');
    if (existsSync(pidfile)) {
      try {
        const n = Number(readFileSync(pidfile, 'utf8').trim());
        if (Number.isFinite(n) && n > 0 && n !== pid) {
          try {
            process.kill(n, 'SIGTERM');
            notes.push(`SIGTERM pidfile pid=${n}`);
          } catch {
            /* */
          }
        }
        unlinkSync(pidfile);
      } catch {
        /* */
      }
    }

    if (canSys) {
      await this.host
        .runCommand(['systemctl', 'disable', '--now', unit], { timeoutMs: 15_000 })
        .then((r) => notes.push(`systemctl disable --now ${unit} exit=${r.exitCode}`))
        .catch(() => notes.push(`systemctl disable ${unit} failed`));
      await this.host
        .runCommand(['bash', '-c', `rm -f /etc/systemd/system/${unit}`], { timeoutMs: 5_000 })
        .catch(() => undefined);
      await this.host
        .runCommand(['systemctl', 'daemon-reload'], { timeoutMs: 15_000 })
        .catch(() => undefined);
    } else {
      notes.push('systemd unit cleanup skipped (need root + YSK_EXECUTE)');
    }

    // —— 2. Web: nginx / PHP-FPM / Apache ——
    const managedNginx = join(this.dataDir, 'nginx', 'conf.d', nginxFile);
    for (const p of [row.nginx_config_path, managedNginx].filter(Boolean) as string[]) {
      if (existsSync(p)) {
        try {
          rmSync(p, { force: true });
          notes.push(`removed nginx conf ${p}`);
        } catch (e) {
          warnings.push(`nginx conf ${p}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    if (canSys) {
      const sysNginx = `/etc/nginx/conf.d/${nginxFile}`;
      await this.host
        .runCommand(['bash', '-c', `rm -f ${JSON.stringify(sysNginx)}`], { timeoutMs: 5_000 })
        .then((r) => {
          if (r.exitCode === 0) notes.push(`removed ${sysNginx}`);
        })
        .catch(() => undefined);
      const nt = await this.host.runCommand(['nginx', '-t'], { timeoutMs: 10_000 });
      if (nt.exitCode === 0) {
        const rel = await this.host.runCommand(['systemctl', 'reload', 'nginx'], {
          timeoutMs: 15_000,
        });
        notes.push(`nginx reload exit=${rel.exitCode}`);
      } else {
        warnings.push(`nginx -t failed after conf remove: ${(nt.stderr || nt.stdout).slice(0, 120)}`);
      }
    }

    if (row.runtime === 'php') {
      const ver = selectPhpRuntime(row.runtime_version || '8.2').version;
      const poolLocal = join(this.dataDir, 'php', ver, 'pool.d', `${row.linux_user}.conf`);
      if (existsSync(poolLocal)) {
        try {
          rmSync(poolLocal, { force: true });
          notes.push(`removed FPM pool artifact ${poolLocal}`);
        } catch {
          /* */
        }
      }
      const apacheLocal = join(this.dataDir, 'apache', 'sites', `ysk-${row.linux_user}.conf`);
      if (existsSync(apacheLocal)) {
        try {
          rmSync(apacheLocal, { force: true });
          notes.push(`removed Apache vhost artifact ${apacheLocal}`);
        } catch {
          /* */
        }
      }
      if (canSys) {
        const site = `ysk-${row.linux_user}`;
        await this.host
          .runCommand(
            [
              'bash',
              '-c',
              [
                `rm -f /etc/php/${ver}/fpm/pool.d/ysk-${row.linux_user}.conf 2>/dev/null || true`,
                `systemctl reload php${ver}-fpm 2>/dev/null || true`,
                `a2dissite ${site} 2>/dev/null || true`,
                `rm -f /etc/apache2/sites-available/${site}.conf 2>/dev/null || true`,
                `systemctl reload apache2 2>/dev/null || true`,
              ].join('; '),
            ],
            { timeoutMs: 30_000 },
          )
          .then((r) => notes.push(`php/apache teardown exit=${r.exitCode}`))
          .catch((e) =>
            warnings.push(`php/apache teardown: ${e instanceof Error ? e.message : String(e)}`),
          );
      }
    }

    // —— 3. Shared resources: do not auto-delete ——
    if (row.domain) {
      warnings.push(
        `DNS zone / mail for ${row.domain} left in place if shared (not auto-deleted)`,
      );
    }

    // —— 4. OS user + home ——
    if (removeFiles && row.home_dir && existsSync(row.home_dir)) {
      const safe = isSafeProjectHomePath(row.home_dir, {
        projectId: id,
        dataDir: this.dataDir,
        linuxUser: row.linux_user,
      });
      if (!safe) {
        warnings.push(tl('notes.auto.t0291', { v0: row.home_dir }));
      } else if (canSys) {
        const ud = await this.host.runCommand(
          [
            'bash',
            '-c',
            `userdel -r ${row.linux_user} 2>&1 || userdel ${row.linux_user} 2>&1 || true`,
          ],
          { timeoutMs: 30_000 },
        );
        notes.push(`userdel: ${(ud.stdout || ud.stderr || '').slice(0, 200)}`);
        if (existsSync(row.home_dir)) {
          await this.host.deletePath(row.home_dir).catch(() => {
            rmSync(row.home_dir, { recursive: true, force: true });
          });
          notes.push(`removed home ${row.home_dir}`);
        }
        await this.host
          .runCommand(['bash', '-c', `groupdel ${row.linux_group} 2>/dev/null || true`], {
            timeoutMs: 5_000,
          })
          .catch(() => undefined);
      } else {
        const underData =
          row.home_dir.startsWith(join(this.dataDir, 'projects')) ||
          row.home_dir.startsWith(join(this.dataDir, 'homes'));
        if (underData) {
          if (this.host.executeEnabled()) {
            await this.host.deletePath(row.home_dir);
          } else {
            rmSync(row.home_dir, { recursive: true, force: true });
          }
          notes.push(`removed control-plane home ${row.home_dir}`);
        } else {
          warnings.push(
            tl('notes.auto.t0292', { v0: row.home_dir, v1: row.linux_user }),
          );
        }
      }
    } else if (!removeFiles) {
      notes.push('removeFiles=false — home and linux user kept');
    }

    const shadow = join(this.dataDir, 'homes', `ysk-server-${id}`);
    if (removeFiles && existsSync(shadow) && shadow !== row.home_dir) {
      rmSync(shadow, { recursive: true, force: true });
      notes.push(`removed shadow ${shadow}`);
    }

    // —— 5. DB ——
    this.projects.delete(id);
    notes.push('control-plane project row deleted');

    this.audit?.append({
      actor,
      action: 'project.delete',
      resource: id,
      detail: {
        home_dir: row.home_dir,
        linux_user: row.linux_user,
        removeFiles,
        notes,
        warnings,
      },
      ok: true,
    });

    return {
      ok: true,
      projectId: id,
      removedFiles: removeFiles,
      notes,
      warnings,
    };
  }

  /**
   * Set extra log scan directories (relative to home). Always also scans logs/ and log/.
   */
  setLogExtraDirs(
    id: string,
    dirs: string[] | string,
    actor: string,
  ): { project: ProjectDto; notes: string[] } {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), { httpStatus: 404 });
    }
    const { dirs: cleaned, notes } = normalizeExtraLogDirs(dirs);
    this.projects.updateMeta(id, { log_extra_dirs: cleaned });
    this.audit?.append({
      actor,
      action: 'project.log_extra_dirs',
      resource: id,
      detail: { dirs: cleaned, notes },
      ok: true });
    return { project: this.get(id), notes };
  }

  /** Update network fields (domain, aliases, HTTPS flags, docroot). Does not publish nginx. */
  updateNetwork(
    id: string,
    patch: {
      domain?: string;
      domainAliases?: string[];
      forceHttps?: boolean;
      hsts?: boolean;
      siteRedirectUrl?: string | null;
      httpAuthUser?: string | null;
      httpAuthPass?: string | null;
      docRoot?: string | null;
      bindIp?: string | null;
      /** inherit | none | cloudflare | … */
      realIpProvider?: string | null;
      preferredPort?: number | null;
    },
    actor: string,
  ): ProjectDto {
    const row = this.projects.findById(id);
    if (!row) {
      throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.project.notFound', { id }), { httpStatus: 404 });
    }
    const domain = patch.domain !== undefined ? patch.domain.trim().toLowerCase() || undefined : row.domain;
    if (domain && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(domain)) {
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.project.domainInvalid', { domain }), {
        httpStatus: 400,
      });
    }
    // B7: rename must not collide with another project's primary domain or aliases
    if (domain) {
      const clash = this.projects.list().find((p) => {
        if (p.id === id) return false;
        const primary = (p.domain ?? '').toLowerCase();
        if (primary && primary === domain) return true;
        return (p.domain_aliases ?? []).some((a) => a.toLowerCase() === domain);
      });
      if (clash) {
        throw new YskError(
          ErrorCodes.VALIDATION,
          tl('notes.project.domainInUse', { domain, other: clash.name || clash.id }),
          { httpStatus: 409, details: { otherProjectId: clash.id } },
        );
      }
    }
    const aliases =
      patch.domainAliases !== undefined
        ? normalizeAliases(patch.domainAliases, domain)
        : (row.domain_aliases ?? []);
    let nextDocRoot = row.doc_root;
    if (patch.docRoot === null) nextDocRoot = undefined;
    else if (patch.docRoot !== undefined) {
      nextDocRoot = normalizeProjectDocRoot(patch.docRoot);
    }
    this.projects.updateMeta(id, {
      domain,
      domain_aliases: aliases,
      force_https: patch.forceHttps !== undefined ? patch.forceHttps : row.force_https,
      hsts: patch.hsts !== undefined ? patch.hsts : row.hsts,
      site_redirect_url:
        patch.siteRedirectUrl === null
          ? undefined
          : patch.siteRedirectUrl !== undefined
            ? patch.siteRedirectUrl.trim() || undefined
            : row.site_redirect_url,
      http_auth_user:
        patch.httpAuthUser === null
          ? undefined
          : patch.httpAuthUser !== undefined
            ? patch.httpAuthUser.trim() || undefined
            : row.http_auth_user,
      http_auth_pass:
        patch.httpAuthPass === null
          ? undefined
          : patch.httpAuthPass !== undefined
            ? patch.httpAuthPass || undefined
            : row.http_auth_pass,
      doc_root: nextDocRoot,
      bind_ip:
        patch.bindIp === null
          ? undefined
          : patch.bindIp !== undefined
            ? patch.bindIp.trim() || undefined
            : row.bind_ip,
      real_ip_provider:
        patch.realIpProvider === null
          ? undefined
          : patch.realIpProvider !== undefined
            ? normalizeProjectRealIpProvider(patch.realIpProvider)
            : row.real_ip_provider,
      preferred_port:
        patch.preferredPort === null
          ? undefined
          : patch.preferredPort !== undefined
            ? (() => {
                const n = Number(patch.preferredPort);
                if (!Number.isFinite(n) || n <= 0 || n >= 65536) return row.preferred_port;
                return Math.floor(n);
              })()
            : row.preferred_port,
    });
    this.audit?.append({
      actor,
      action: 'project.update_network',
      resource: id,
      detail: { ...patch, httpAuthPass: patch.httpAuthPass ? '***' : undefined },
      ok: true });
    return this.get(id);
  }
}

const REAL_IP_IDS = new Set([
  'none',
  'cloudflare',
  'fastly',
  'bunny',
  'cloudfront',
  'azure_frontdoor',
  'gcore',
  'custom',
  'inherit',
]);

function normalizeProjectRealIpProvider(raw: string): string | undefined {
  const v = raw.trim().toLowerCase();
  if (!v || v === 'inherit') return undefined;
  if (!REAL_IP_IDS.has(v)) {
    throw new YskError(ErrorCodes.VALIDATION, `Invalid realIpProvider: ${raw}`, {
      httpStatus: 400,
    });
  }
  return v;
}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    domainAliases: row.domain_aliases ?? [],
    linuxUser: row.linux_user,
    linuxGroup: row.linux_group,
    homeDir: row.home_dir,
    ownerUserId: row.owner_user_id,
    runtime: row.runtime,
    runtimeVersion: normalizeRuntimeVersion(row.runtime, row.runtime_version) || undefined,
    env: row.env,
    status: row.status,
    port: row.port,
    preferredPort: row.preferred_port,
    pid: row.pid,
    processStatus: row.process_status,
    nginxConfigPath: row.nginx_config_path,
    forceHttps: Boolean(row.force_https),
    hsts: Boolean(row.hsts),
    siteRedirectUrl: row.site_redirect_url,
    httpAuthUser: row.http_auth_user,
    docRoot: row.doc_root,
    bindIp: row.bind_ip,
    realIpProvider: row.real_ip_provider,
    lastHealth: row.last_health,
    lastDeployAt: row.last_deploy_at,
    osProvisioned: row.os_provisioned,
    gitUrl: row.git_url,
    gitBranch: row.git_branch,
    gitCommit: row.git_commit,
    envVars: row.env_vars,
    lastBackupPath: row.last_backup_path,
    lastBackupAt: row.last_backup_at,
    quotaMb: row.quota_mb,
    memoryMax: row.memory_max,
    cpuQuotaPercent: row.cpu_quota_percent,
    tasksMax: row.tasks_max,
    limitNofile: row.limit_nofile,
    shell: row.shell,
    accountLocked: row.account_locked,
    deployEntry: row.deploy_entry,
    lastDeployNotes: row.last_deploy_notes,
    logExtraDirs: row.log_extra_dirs ?? [] };
}

function normalizeAliases(aliases: string[] | undefined, primary?: string): string[] {
  const primaryNorm = (primary ?? '').trim().toLowerCase();
  const out: string[] = [];
  for (const a of aliases ?? []) {
    const n = a.trim().toLowerCase();
    if (!n || n === primaryNorm) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
