/**
 * AI agent runtime management for OpenClaw / Hermes / IonClaw.
 */

import type { AgentRuntimeDto, AgentRuntimeKind } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';

const CATALOG: Record<
  AgentRuntimeKind,
  { name: string; defaultInstallPath: string; installCommands: string[] }
> = {
  openclaw: {
    name: 'OpenClaw',
    defaultInstallPath: '/opt/ysk-server/agents/openclaw',
    installCommands: [
      'mkdir -p /opt/ysk-server/agents/openclaw',
      'npm install -g openclaw || true',
    ],
  },
  hermes: {
    name: 'Hermes',
    defaultInstallPath: '/opt/ysk-server/agents/hermes',
    installCommands: [
      'mkdir -p /opt/ysk-server/agents/hermes',
      'npm install -g @hermes-agent/cli || true',
    ],
  },
  ionclaw: {
    name: 'IonClaw',
    defaultInstallPath: '/opt/ysk-server/agents/ionclaw',
    installCommands: [
      'mkdir -p /opt/ysk-server/agents/ionclaw',
      'npm install -g ionclaw || true',
    ],
  },
};

export function listAgentRuntimes(): AgentRuntimeDto[] {
  return (Object.keys(CATALOG) as AgentRuntimeKind[]).map((kind) => ({
    kind,
    name: CATALOG[kind].name,
    status: 'unknown',
    installPath: CATALOG[kind].defaultInstallPath,
  }));
}

export function planAgentInstall(kind: AgentRuntimeKind): {
  runtime: AgentRuntimeDto;
  commands: string[];
  supervision: string[];
} {
  const entry = CATALOG[kind];
  if (!entry) {
    throw new YskError(ErrorCodes.VALIDATION, `Unknown agent runtime: ${kind}`, {
      httpStatus: 400,
    });
  }
  return {
    runtime: {
      kind,
      name: entry.name,
      status: 'stopped',
      installPath: entry.defaultInstallPath,
    },
    commands: entry.installCommands,
    supervision: [
      `systemd unit: ysk-agent-${kind}.service`,
      'All agent tool calls must pass YSK Allowlist + Approval',
      'Agent role RBAC capped at write-low',
    ],
  };
}

export function parseAgentKind(value: string): AgentRuntimeKind {
  if (value === 'openclaw' || value === 'hermes' || value === 'ionclaw') {
    return value;
  }
  throw new YskError(ErrorCodes.VALIDATION, `Unsupported agent kind: ${value}`, {
    httpStatus: 400,
  });
}
