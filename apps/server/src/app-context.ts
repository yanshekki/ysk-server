/**
 * Shared runtime context for HTTP server and CLI — backed by SQLite.
 */

import { join } from 'node:path';
import {
  AgentComms,
  ApprovalQueue,
  ApprovalRepository,
  AuditRepository,
  AuthService,
  UsersAdminService,
  LocalHostExecutor,
  LlmGateway,
  ProjectRepository,
  ProjectService,
  ProjectOpsService,
  CronJobService,
  SessionRepository,
  SettingsRepository,
  UserRepository,
  EmailService,
  AiTaskService,
  FleetService,
  Scheduler,
  collectInventory,
  createDefaultAllowlist,
  echoTransport,
  evaluateProtection,
  fetchTransport,
  openDatabase,
  runProtectionProbes,
  backupAllProjects,
  checkIpDnsbl,
  type Allowlist,
  type HostExecutor,
  type ProtectionState,
  type YskConfig,
  type YskDatabase,
} from '@ysk/core';

export interface AppContext {
  db: YskDatabase;
  auth: AuthService;
  usersAdmin: UsersAdminService;
  allowlist: Allowlist;
  approvals: ApprovalQueue;
  agents: AgentComms;
  fleet: FleetService;
  llm: LlmGateway;
  protection: ProtectionState;
  host: HostExecutor;
  projects: ProjectService;
  projectOps: ProjectOpsService;
  cron: CronJobService;
  email: EmailService;
  ai: AiTaskService;
  audit: AuditRepository;
  settings: SettingsRepository;
  scheduler: Scheduler;
  /** rolling request counter for rate detection */
  requestHits: number[];
  version: string;
  startedAt: string;
  config?: YskConfig;
  configPath?: string;
  dataDir: string;
  /** Packaged Web UI root (null if not built) */
  webRoot?: string;
  /** Rebuild LLM gateway from settings (after settings.llm update) */
  reloadLlm: () => void;
  /** Run protection probes and apply resulting mode */
  runAutoProtection: () => ReturnType<typeof runProtectionProbes>;
  stopScheduler: () => void;
}

export interface CreateAppContextOptions {
  version: string;
  config?: YskConfig;
  configPath?: string;
  adminPassword?: string;
  /** Override data dir (tests) */
  dataDir?: string;
  /** Override db path (tests) */
  dbPath?: string;
  executeEnabled?: boolean;
  /** Override web static root */
  webRoot?: string;
}

export function createAppContext(versionOrOpts: string | CreateAppContextOptions): AppContext {
  const opts: CreateAppContextOptions =
    typeof versionOrOpts === 'string' ? { version: versionOrOpts } : versionOrOpts;

  const dataDir = opts.dataDir ?? opts.config?.dataDir ?? join(process.cwd(), '.ysk');
  const dbPath = opts.dbPath ?? join(dataDir, 'ysk.json');
  const db = openDatabase(dbPath);

  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const audit = new AuditRepository(db);
  const approvalRepo = new ApprovalRepository(db);
  const projectRepo = new ProjectRepository(db);
  const settings = new SettingsRepository(db);

  const auth = new AuthService(users, sessions, audit, db);
  const usersAdmin = new UsersAdminService(users, sessions, db, audit);
  const adminUsername = opts.config?.adminUsername ?? 'admin';
  const locale = opts.config?.locale ?? 'zh-TW';
  const password = opts.adminPassword ?? process.env.YSK_ADMIN_PASSWORD ?? 'admin';
  if (users.count() === 0) {
    auth.ensureAdmin(adminUsername, password, locale);
  }

  const host = new LocalHostExecutor({
    executeEnabled: opts.executeEnabled,
    // Project homes live under /home/ysk-server-{id}; allow control-plane chown/writes
    allowedWriteRoots: [dataDir, '/tmp', '/home'],
  });

  const projects = new ProjectService(projectRepo, host, dataDir, audit);
  const projectOps = new ProjectOpsService(projectRepo, host, dataDir, audit);
  const cron = new CronJobService(db, host, dataDir);
  const email = new EmailService(db, host, audit, dataDir);
  const fleet = new FleetService(db);
  const allowlist = createDefaultAllowlist();
  const approvals = new ApprovalQueue(approvalRepo);

  const protection = evaluateProtection({ networkReachable: true });

  const scheduler = new Scheduler();
  const ctx: AppContext = {
    db,
    auth,
    usersAdmin,
    allowlist,
    approvals,
    agents: new AgentComms(),
    fleet,
    llm: buildLlm(settings),
    protection,
    host,
    projects,
    projectOps,
    cron,
    email,
    ai: null as unknown as AiTaskService,
    audit,
    settings,
    scheduler,
    requestHits: [],
    version: opts.version,
    startedAt: new Date().toISOString(),
    config: opts.config,
    configPath: opts.configPath,
    dataDir,
    webRoot: opts.webRoot,
    reloadLlm() {
      ctx.llm = buildLlm(settings);
      ctx.llm.setProtection(ctx.protection);
      ctx.ai = new AiTaskService(
        db,
        allowlist,
        approvals,
        host,
        audit,
        ctx.llm,
        () => ctx.protection,
      );
    },
    async runAutoProtection() {
      const now = Date.now();
      ctx.requestHits = ctx.requestHits.filter((t) => now - t < 60_000);
      const probe = await runProtectionProbes({
        requestCountLastMinute: ctx.requestHits.length,
      });
      applyProtection(ctx, probe.protection);
      ctx.settings.setJson('last_protection_probe', probe);
      if (probe.protection.mode !== 'normal') {
        ctx.audit.append({
          actor: 'system',
          action: 'protection.auto',
          detail: probe,
          ok: true,
        });
      }
      return probe;
    },
    stopScheduler() {
      scheduler.stopAll();
    },
  };
  ctx.llm.setProtection(protection);
  ctx.ai = new AiTaskService(db, allowlist, approvals, host, audit, ctx.llm, () => ctx.protection);

  // P7: periodic protection probe (5 min) + daily inventory snapshot
  if (process.env.YSK_DISABLE_SCHEDULER !== '1') {
    scheduler.every(
      'protection-probe',
      5 * 60_000,
      async () => {
        await ctx.runAutoProtection();
      },
      { runImmediately: process.env.YSK_PROBE_ON_START === '1' },
    );
    scheduler.every(
      'daily-inventory',
      24 * 60 * 60_000,
      async () => {
        try {
          const inv = await collectInventory(host);
          settings.setJson('last_inventory', {
            at: new Date().toISOString(),
            count: inv.length,
            sample: inv.slice(0, 40),
            items: inv.slice(0, 80),
          });
          audit.append({
            actor: 'system',
            action: 'update.inventory.scheduled',
            detail: { count: inv.length },
            ok: true,
          });
        } catch {
          /* ignore */
        }
      },
      { runImmediately: process.env.YSK_INVENTORY_ON_START === '1' },
    );

    // Daily project backups (interval overridable for tests)
    const backupMs = Number(process.env.YSK_BACKUP_INTERVAL_MS ?? 24 * 60 * 60_000);
    scheduler.every(
      'daily-backup',
      Number.isFinite(backupMs) && backupMs >= 5_000 ? backupMs : 24 * 60 * 60_000,
      async () => {
        try {
          const projects = projectRepo.list();
          const r = await backupAllProjects({
            host,
            dataDir,
            projects: projects.map((p) => ({
              id: p.id,
              home_dir: p.home_dir,
              name: p.name,
            })),
          });
          for (const item of r.results) {
            if (item.ok && item.archivePath) {
              projectRepo.updateRuntimeState(item.projectId, {
                last_backup_path: item.archivePath,
                last_backup_at: new Date().toISOString(),
              });
            }
          }
          settings.setJson('last_backup_run', {
            at: new Date().toISOString(),
            ...r,
          });
          audit.append({
            actor: 'system',
            action: 'backup.scheduled',
            detail: { notes: r.notes, ok: r.ok, count: r.results.length },
            ok: r.ok,
          });
        } catch (e) {
          audit.append({
            actor: 'system',
            action: 'backup.scheduled',
            detail: { error: e instanceof Error ? e.message : String(e) },
            ok: false,
          });
        }
      },
      { runImmediately: process.env.YSK_BACKUP_ON_START === '1' },
    );

    // Expire temporary RO DB users (hourly)
    scheduler.every(
      'db-temp-expire',
      Number(process.env.YSK_TEMP_DB_EXPIRE_MS ?? 60 * 60_000),
      async () => {
        try {
          const { expireTempDbUsers } = await import('@ysk/core');
          const r = await expireTempDbUsers({
            db,
            host,
            dropSystem: process.env.YSK_TEMP_DB_AUTO_DROP === '1',
          });
          if (r.expired > 0) {
            audit.append({
              actor: 'system',
              action: 'db.temp_user.expire.scheduled',
              detail: r,
              ok: r.ok,
            });
          }
        } catch (e) {
          audit.append({
            actor: 'system',
            action: 'db.temp_user.expire.scheduled',
            detail: { error: e instanceof Error ? e.message : String(e) },
            ok: false,
          });
        }
      },
    );

    // Periodic DNSBL reputation check for registered email domains
    const dnsblMs = Number(process.env.YSK_DNSBL_INTERVAL_MS ?? 12 * 60 * 60_000);
    scheduler.every(
      'email-dnsbl',
      Number.isFinite(dnsblMs) && dnsblMs >= 10_000 ? dnsblMs : 12 * 60 * 60_000,
      async () => {
        try {
          const domains = db.snapshot.email_domains as Array<{
            id?: string;
            domain?: string;
            server_ip?: string;
          }>;
          const reports: Array<Record<string, unknown>> = [];
          for (const d of domains.slice(0, 20)) {
            if (!d.server_ip) continue;
            const report = await checkIpDnsbl(String(d.server_ip));
            reports.push({
              domainId: d.id,
              domain: d.domain,
              ip: d.server_ip,
              ok: report.ok,
              listedOn: report.listedOn,
              at: new Date().toISOString(),
            });
            if (!report.ok) {
              audit.append({
                actor: 'system',
                action: 'email.dnsbl.listed',
                resource: String(d.domain ?? d.id),
                detail: report,
                ok: false,
              });
            }
          }
          settings.setJson('last_dnsbl_run', {
            at: new Date().toISOString(),
            count: reports.length,
            reports,
          });
          audit.append({
            actor: 'system',
            action: 'email.dnsbl.scheduled',
            detail: { count: reports.length },
            ok: true,
          });
        } catch (e) {
          audit.append({
            actor: 'system',
            action: 'email.dnsbl.scheduled',
            detail: { error: e instanceof Error ? e.message : String(e) },
            ok: false,
          });
        }
      },
      { runImmediately: process.env.YSK_DNSBL_ON_START === '1' },
    );
  }

  return ctx;
}

function buildLlm(settings: SettingsRepository): LlmGateway {
  const llmSettings = settings.getJson<{ baseUrl?: string; apiKey?: string; model?: string }>('llm') ?? {};
  const baseUrl = llmSettings.baseUrl ?? process.env.YSK_LLM_BASE_URL;
  const useEcho = process.env.YSK_LLM_ECHO === '1' || !baseUrl;
  return new LlmGateway(
    {
      baseUrl: baseUrl ?? 'http://127.0.0.1:11434',
      apiKey: llmSettings.apiKey ?? process.env.YSK_LLM_API_KEY,
      defaultModel: llmSettings.model ?? 'local',
      localBaseUrl: process.env.YSK_LLM_LOCAL_URL ?? 'http://127.0.0.1:11434',
      localModel: 'local',
    },
    useEcho ? echoTransport : fetchTransport,
  );
}

export function applyProtection(ctx: AppContext, state: ProtectionState): void {
  ctx.protection = state;
  ctx.llm.setProtection(state);
  ctx.audit.append({
    actor: 'system',
    action: 'protection.change',
    detail: state,
    ok: true,
  });
}

export function closeAppContext(ctx: AppContext): void {
  ctx.stopScheduler();
  ctx.db.close();
}
