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
  RbacPolicyService,
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
  adviseInventory,
  buildUpdatesSummary,
  normalizeUpdatesScanSettings,
  DEFAULT_UPDATES_SCAN,
  checkSelfUpdate,
  createDefaultAllowlist,
  echoTransport,
  evaluateProtection,
  fetchTransport,
  openDatabase,
  runProtectionProbes,
  backupAllProjects,
  runValidatorUpgradeScan,
  checkIpDnsbl,
  createTerminalTicketStore,
  createVncSessionTicketStore,
  HostBrowseService,
  createHostBrowseLiveTicketStore,
  type Allowlist,
  type HostBrowseLiveTicketStore,
  type HostExecutor,
  type ProtectionState,
  type TerminalTicketStore,
  type VncSessionTicketStore,
  type YskConfig,
  type YskDatabase,
} from 'ysk-server-core';

export interface AppContext {
  db: YskDatabase;
  auth: AuthService;
  usersAdmin: UsersAdminService;
  rbac: RbacPolicyService;
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
  /** One-time tickets for browser terminal WebSocket */
  terminalTickets: TerminalTicketStore;
  /** One-time tickets for browser VNC (RFB) WebSocket proxy */
  vncSessionTickets: VncSessionTicketStore;
  /** Host-mediated proxy browser (privacy egress) */
  hostBrowse: HostBrowseService;
  /** One-time tickets for host-browse live screencast WS */
  hostBrowseLiveTickets: HostBrowseLiveTicketStore;
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
  // D4 backends: YSK_STORE=json|sqlite|postgres · path auto-selects .json / .sqlite
  const storeKind = (process.env.YSK_STORE ?? process.env.YSK_DB_BACKEND ?? 'json')
    .trim()
    .toLowerCase();
  const defaultDbFile =
    storeKind === 'sqlite'
      ? 'ysk.sqlite'
      : storeKind === 'postgres'
        ? 'ysk.json' // mirror; real data in YSK_DATABASE_URL
        : 'ysk.json';
  const dbPath = opts.dbPath ?? join(dataDir, defaultDbFile);
  const db = openDatabase(dbPath, {
    kind:
      storeKind === 'sqlite' || storeKind === 'postgres' || storeKind === 'json'
        ? (storeKind as 'json' | 'sqlite' | 'postgres')
        : undefined,
    url: process.env.YSK_DATABASE_URL ?? process.env.DATABASE_URL,
  });

  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const audit = new AuditRepository(db);
  const approvalRepo = new ApprovalRepository(db);
  const projectRepo = new ProjectRepository(db);
  const settings = new SettingsRepository(db);

  const auth = new AuthService(users, sessions, audit, db, dataDir);
  const usersAdmin = new UsersAdminService(users, sessions, db, audit);
  const rbac = new RbacPolicyService(db, audit);
  const adminUsername = opts.config?.adminUsername ?? 'admin';
  const locale = opts.config?.locale ?? 'zh-HK';
  // Never silently seed default "admin" password on empty DB.
  // Tests/harness pass adminPassword; production must set YSK_ADMIN_PASSWORD or run setup.
  const password = opts.adminPassword ?? process.env.YSK_ADMIN_PASSWORD;
  if (users.count() === 0) {
    const allowInsecure =
      process.env.YSK_ALLOW_INSECURE_DEFAULTS === '1' ||
      process.env.YSK_ALLOW_INSECURE_DEFAULTS === 'true';
    if (password) {
      auth.ensureAdmin(adminUsername, password, locale);
    } else if (allowInsecure) {
      auth.ensureAdmin(adminUsername, 'admin', locale);
    }
    // else: empty user table — operator must run `ysk-server setup`
  }
  // Hard guarantee: at least one full-privilege user (users.manage + rbac.policy)
  rbac.ensureFullPrivilegeHolder();

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
    rbac,
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
    terminalTickets: createTerminalTicketStore(),
    vncSessionTickets: createVncSessionTicketStore(),
    hostBrowse: new HostBrowseService(
      {
        /* env defaults; panel settings overlay via getPanelConfig */
      },
      (event) => {
        try {
          audit.append({
            actor: event.userId,
            action: event.action,
            resource: 'host-browse',
            detail: event.detail,
            ok: event.ok,
          });
        } catch {
          /* non-fatal */
        }
      },
      () =>
        settings.getJson<{
          engine?: 'auto' | 'proxy' | 'browser';
          chromePath?: string;
          allowLoopback?: boolean;
          noSandbox?: boolean;
          safetyLevel?: 'strict' | 'standard' | 'relaxed';
          blockHosts?: string[];
          homeUrl?: string;
        }>('hostBrowse'),
      {
        getHost: () => host,
        getDataDir: () => dataDir,
        getLibrary: (userId) => {
          const all =
            settings.getJson<Record<string, import('ysk-server-core').BrowseUserLibrary>>(
              'hostBrowseLibraries',
            ) ?? {};
          return (
            all[userId] ?? {
              homeUrl:
                settings.getJson<{ homeUrl?: string }>('hostBrowse')?.homeUrl ||
                'https://www.google.com/',
              bookmarks: [],
              history: [],
            }
          );
        },
        setLibrary: (userId, lib) => {
          const all =
            settings.getJson<Record<string, import('ysk-server-core').BrowseUserLibrary>>(
              'hostBrowseLibraries',
            ) ?? {};
          all[userId] = lib;
          settings.setJson('hostBrowseLibraries', all);
        },
      },
    ),
    hostBrowseLiveTickets: createHostBrowseLiveTicketStore(),
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
    // Automatic updates scan (packages + panel self-check). Interval from settings.
    // Does NOT apt-upgrade — scan + cache only.
    const runUpdatesScan = async () => {
      const scanCfg = normalizeUpdatesScanSettings(
        settings.getJson('updates_scan_settings') ?? DEFAULT_UPDATES_SCAN,
      );
      if (!scanCfg.enabled) return;
      try {
        const { items: inv, meta } = await collectInventory(host);
        const advice = adviseInventory(inv);
        const at = new Date().toISOString();
        settings.setJson('last_inventory', {
          at,
          count: inv.length,
          upgradable: meta.upgradableCount,
          meta,
          sample: inv.slice(0, 40),
          items: inv.slice(0, 120),
          advice: advice.slice(0, 120),
          stale: false,
        });
        let lastSelf: Record<string, unknown> | null = null;
        try {
          const { VERSION } = await import('./version.js');
          const status = await checkSelfUpdate({ currentVersion: VERSION });
          lastSelf = {
            currentVersion: status.currentVersion,
            latestVersion: status.latestVersion,
            updateAvailable: status.updateAvailable,
            lastCheckAt: status.lastCheckAt,
            channel: status.channel,
            ok: status.ok,
            checked: status.checked,
          };
          settings.setJson('last_self_update', lastSelf);
        } catch {
          lastSelf = settings.getJson<Record<string, unknown>>('last_self_update') ?? null;
        }
        const job = scheduler.list().find((j) => j.id === 'updates.scan');
        const summary = buildUpdatesSummary({
          lastInventory: settings.getJson('last_inventory'),
          lastSelf,
          scanSettings: scanCfg,
          nextScanAt: job?.nextRunAt ?? null,
        });
        settings.setJson('updates_summary', summary);
        audit.append({
          actor: 'system',
          action: 'update.scan.scheduled',
          detail: {
            count: inv.length,
            upgradable: meta.upgradableCount,
            badgeCount: summary.badgeCount,
            panelUpdateAvailable: summary.panelUpdateAvailable,
          },
          ok: true,
        });
      } catch {
        /* ignore — next interval retries */
      }
    };

    scheduler.everyDynamic(
      'updates.scan',
      () => {
        const scanCfg = normalizeUpdatesScanSettings(
          settings.getJson('updates_scan_settings') ?? DEFAULT_UPDATES_SCAN,
        );
        if (!scanCfg.enabled) {
          // Park when disabled (5 min re-check of settings)
          return 5 * 60_000;
        }
        const envMs = Number(process.env.YSK_UPDATES_SCAN_INTERVAL_MS ?? '');
        if (Number.isFinite(envMs) && envMs >= 5_000) return envMs;
        return scanCfg.intervalMs;
      },
      async () => {
        await runUpdatesScan();
      },
      {
        runImmediately:
          process.env.YSK_INVENTORY_ON_START === '1' ||
          process.env.YSK_UPDATES_SCAN_ON_START === '1',
        maxIntervalMs: 7 * 24 * 60 * 60_000,
      },
    );

    scheduler.every(
      'validators.upgrade-scan',
      6 * 60 * 60_000,
      async () => {
        try {
          await runValidatorUpgradeScan({ dataDir, host });
        } catch {
          /* next interval */
        }
      },
      { runImmediately: process.env.YSK_VALIDATORS_SCAN_ON_START === '1' },
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
          const { expireTempDbUsers } = await import('ysk-server-core');
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

    // Defense automation — interval follows panel policy (fallback env / 120s)
    scheduler.everyDynamic(
      'defense-auto-ban',
      () => {
        try {
          const raw = db.snapshot.settings?.defense_automation;
          if (raw) {
            const p = JSON.parse(raw) as { autoBan?: { intervalSeconds?: number } };
            const sec = Number(p.autoBan?.intervalSeconds) || 120;
            return Math.max(30_000, Math.min(600_000, sec * 1000));
          }
        } catch {
          /* fall through */
        }
        const envMs = Number(process.env.YSK_AUTO_BAN_INTERVAL_MS ?? 120_000);
        return Number.isFinite(envMs) && envMs >= 15_000 ? envMs : 120_000;
      },
      async () => {
        try {
          const { runDefenseAutomationTick, loadDefenseAutomation } = await import('ysk-server-core');
          const pol = loadDefenseAutomation(db);
          if (!pol.enabled) return;
          if (!pol.autoBan.enabled && !pol.autoPreset.enabled) return;
          const r = await runDefenseAutomationTick({
            host,
            db,
            dataDir,
            requestCountLastMinute: ctx.requestHits?.length ?? 0,
          });
          if (r.banned.length > 0 || r.presetChanged || r.suggestEmergency) {
            audit.append({
              actor: 'system',
              action: 'defense.automation.scheduled',
              detail: {
                banned: r.banned,
                presetChanged: r.presetChanged,
                preset: r.preset,
                score: r.score,
                notes: r.notes.slice(0, 8),
                suggestEmergency: r.suggestEmergency,
              },
              ok: r.ok,
            });
          }
        } catch (e) {
          audit.append({
            actor: 'system',
            action: 'defense.automation.scheduled',
            detail: { error: e instanceof Error ? e.message : String(e) },
            ok: false,
          });
        }
      },
    );

    // GeoIP DB refresh — daily (or 12–48h); fail-soft keeps previous MMDB
    scheduler.everyDynamic(
      'defense-geoip-update',
      () => {
        const envMs = Number(process.env.YSK_GEOIP_UPDATE_MS ?? 24 * 60 * 60 * 1000);
        return Number.isFinite(envMs) && envMs >= 60 * 60 * 1000
          ? Math.min(envMs, 48 * 60 * 60 * 1000)
          : 24 * 60 * 60 * 1000;
      },
      async () => {
        try {
          const {
            loadIpAccessPolicy,
            updateGeoipDatabases,
            resetGeoipReaders,
          } = await import('ysk-server-core');
          const pol = loadIpAccessPolicy(db, dataDir);
          if (pol.autoUpdate === false) return;
          const r = await updateGeoipDatabases(dataDir);
          resetGeoipReaders();
          audit.append({
            actor: 'system',
            action: 'defense.geoip.update.scheduled',
            detail: { ok: r.ok, notes: r.notes.slice(0, 6) },
            ok: r.ok,
          });
        } catch (e) {
          audit.append({
            actor: 'system',
            action: 'defense.geoip.update.scheduled',
            detail: { error: e instanceof Error ? e.message : String(e) },
            ok: false,
          });
        }
      },
    );

    // Log Center: auto vacuum (checks window every 15m) + disk hint for notifications
    scheduler.every(
      'log-auto-vacuum',
      15 * 60_000,
      async () => {
        try {
          const {
            runLogAutoVacuumTick,
            getLogOverview,
          } = await import('ysk-server-core');
          // refresh disk hint for dashboard notifications
          try {
            const ov = await getLogOverview({ host, dataDir, db });
            if (ov.journalDiskMb != null) {
              db.snapshot.settings.log_center_disk_hint = JSON.stringify({
                journalDiskMb: ov.journalDiskMb,
                varLogMb: ov.varLogMb,
                at: ov.at,
              });
              db.persist();
            }
          } catch {
            /* non-fatal */
          }
          const r = await runLogAutoVacuumTick({ host, db });
          if (r.ran) {
            audit.append({
              actor: 'system',
              action: 'logs.journal.auto_vacuum',
              detail: { notes: r.notes.slice(0, 6) },
              ok: true,
            });
          }
        } catch (e) {
          audit.append({
            actor: 'system',
            action: 'logs.journal.auto_vacuum',
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

  // Host-browse: kill Chromium + ephemeral users when panel leaves (no heartbeat)
  setInterval(() => {
    void ctx.hostBrowse.reapStaleSessions(45_000).catch(() => {
      /* non-fatal */
    });
  }, 15_000);

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
