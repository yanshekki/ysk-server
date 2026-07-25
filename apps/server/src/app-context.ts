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
}

export function createAppContext(version: string): AppContext {
  const auth = new AuthService();
  // Default admin for bootstrap; setup may reset password in real deploys
  auth.ensureAdmin('admin', 'admin', 'zh-TW');
  return {
    auth,
    allowlist: createDefaultAllowlist(),
    approvals: new ApprovalQueue(),
    agents: new AgentComms(),
    llm: new LlmGateway(
      { baseUrl: process.env.YSK_LLM_BASE_URL ?? 'http://127.0.0.1:11434', defaultModel: 'local' },
      echoTransport,
    ),
    protection: evaluateProtection({ networkReachable: true }),
    version,
    startedAt: new Date().toISOString(),
  };
}
