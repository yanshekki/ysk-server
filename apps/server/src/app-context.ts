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
  LocalHostExecutor,
  LlmGateway,
  ProjectRepository,
  ProjectService,
  SessionRepository,
  SettingsRepository,
  UserRepository,
  EmailService,
  AiTaskService,
  FleetService,
  createDefaultAllowlist,
  echoTransport,
  evaluateProtection,
  fetchTransport,
  openDatabase,
  type Allowlist,
  type HostExecutor,
  type ProtectionState,
  type YskConfig,
  type YskDatabase,
} from '@ysk/core';

export interface AppContext {
  db: YskDatabase;
  auth: AuthService;
  allowlist: Allowlist;
  approvals: ApprovalQueue;
  agents: AgentComms;
  fleet: FleetService;
  llm: LlmGateway;
  protection: ProtectionState;
  host: HostExecutor;
  projects: ProjectService;
  email: EmailService;
  ai: AiTaskService;
  audit: AuditRepository;
  settings: SettingsRepository;
  version: string;
  startedAt: string;
  config?: YskConfig;
  configPath?: string;
  dataDir: string;
  /** Rebuild LLM gateway from settings (after settings.llm update) */
  reloadLlm: () => void;
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

  const auth = new AuthService(users, sessions, audit);
  const adminUsername = opts.config?.adminUsername ?? 'admin';
  const locale = opts.config?.locale ?? 'zh-TW';
  const password = opts.adminPassword ?? process.env.YSK_ADMIN_PASSWORD ?? 'admin';
  if (users.count() === 0) {
    auth.ensureAdmin(adminUsername, password, locale);
  }

  const host = new LocalHostExecutor({
    executeEnabled: opts.executeEnabled,
    allowedWriteRoots: [dataDir, '/tmp'],
  });

  const projects = new ProjectService(projectRepo, host, dataDir, audit);
  const email = new EmailService(db, host, audit);
  const fleet = new FleetService(db);
  const allowlist = createDefaultAllowlist();
  const approvals = new ApprovalQueue(approvalRepo);

  const protection = evaluateProtection({ networkReachable: true });

  const ctx: AppContext = {
    db,
    auth,
    allowlist,
    approvals,
    agents: new AgentComms(),
    fleet,
    llm: buildLlm(settings),
    protection,
    host,
    projects,
    email,
    ai: null as unknown as AiTaskService,
    audit,
    settings,
    version: opts.version,
    startedAt: new Date().toISOString(),
    config: opts.config,
    configPath: opts.configPath,
    dataDir,
    reloadLlm() {
      ctx.llm = buildLlm(settings);
      ctx.llm.setProtection(ctx.protection);
      // rebind AI service llm reference via recreate
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
  };
  ctx.llm.setProtection(protection);
  ctx.ai = new AiTaskService(db, allowlist, approvals, host, audit, ctx.llm, () => ctx.protection);
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
  ctx.db.close();
}
