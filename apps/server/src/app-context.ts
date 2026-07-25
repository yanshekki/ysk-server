/**
 * Shared runtime context for HTTP server and CLI.
 */

import {
  AgentComms,
  Allowlist,
  ApprovalQueue,
  AuthService,
  createDefaultAllowlist,
  evaluateProtection,
  LlmGateway,
  echoTransport,
  type ProtectionState,
  type YskConfig,
} from '@ysk/core';

export interface AppContext {
  auth: AuthService;
  allowlist: Allowlist;
  approvals: ApprovalQueue;
  agents: AgentComms;
  llm: LlmGateway;
  protection: ProtectionState;
  version: string;
  startedAt: string;
  config?: YskConfig;
  configPath?: string;
}

export interface CreateAppContextOptions {
  version: string;
  config?: YskConfig;
  configPath?: string;
  /** Admin password for bootstrap (tests may override) */
  adminPassword?: string;
}

export function createAppContext(versionOrOpts: string | CreateAppContextOptions): AppContext {
  const opts: CreateAppContextOptions =
    typeof versionOrOpts === 'string' ? { version: versionOrOpts } : versionOrOpts;

  const auth = new AuthService();
  const adminUsername = opts.config?.adminUsername ?? 'admin';
  const locale = opts.config?.locale ?? 'zh-TW';
  const password = opts.adminPassword ?? 'admin';
  auth.ensureAdmin(adminUsername, password, locale);

  const llm = new LlmGateway(
    {
      baseUrl: process.env.YSK_LLM_BASE_URL ?? 'http://127.0.0.1:11434',
      defaultModel: 'local',
      localBaseUrl: process.env.YSK_LLM_LOCAL_URL ?? 'http://127.0.0.1:11434',
      localModel: 'local',
    },
    echoTransport,
  );

  const protection = evaluateProtection({ networkReachable: true });
  llm.setProtection(protection);

  return {
    auth,
    allowlist: createDefaultAllowlist(),
    approvals: new ApprovalQueue(),
    agents: new AgentComms(),
    llm,
    protection,
    version: opts.version,
    startedAt: new Date().toISOString(),
    config: opts.config,
    configPath: opts.configPath,
  };
}

/**
 * Update protection on context and propagate to LLM gateway.
 */
export function applyProtection(ctx: AppContext, state: ProtectionState): void {
  ctx.protection = state;
  ctx.llm.setProtection(state);
}
