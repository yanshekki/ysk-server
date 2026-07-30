/**
 * AI agent runtime management for OpenClaw / Hermes / IonClaw.
 * Install commands must not mask failure with `|| true`.
 */

import type { AgentRuntimeDto, AgentRuntimeKind } from '@ysk/shared';
import { ErrorCodes, YskError, tl} from '@ysk/shared';

export type AgentCatalogEntry = {
  name: string;
  defaultInstallPath: string;
  /** npm package(s) to install globally (real exit codes) */
  npmPackages: string[];
  /** CLI binary names to probe after install (first found wins for ExecStart) */
  binNames: string[];
  installCommands: string[];
};

const CATALOG: Record<AgentRuntimeKind, AgentCatalogEntry> = {
  openclaw: {
    name: 'OpenClaw',
    defaultInstallPath: '/opt/ysk-server/agents/openclaw',
    npmPackages: ['openclaw'],
    binNames: ['openclaw'],
    installCommands: [
      'mkdir -p /opt/ysk-server/agents/openclaw',
      'npm install -g openclaw',
    ],
  },
  hermes: {
    name: 'Hermes',
    defaultInstallPath: '/opt/ysk-server/agents/hermes',
    npmPackages: ['@hermes-agent/cli'],
    binNames: ['hermes', 'hermes-agent'],
    installCommands: [
      'mkdir -p /opt/ysk-server/agents/hermes',
      'npm install -g @hermes-agent/cli',
    ],
  },
  ionclaw: {
    name: 'IonClaw',
    defaultInstallPath: '/opt/ysk-server/agents/ionclaw',
    npmPackages: ['ionclaw'],
    binNames: ['ionclaw'],
    installCommands: [
      'mkdir -p /opt/ysk-server/agents/ionclaw',
      'npm install -g ionclaw',
    ],
  },
};

export function getAgentCatalogEntry(kind: AgentRuntimeKind): AgentCatalogEntry {
  return CATALOG[kind];
}

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
  binNames: string[];
  npmPackages: string[];
} {
  const entry = CATALOG[kind];
  if (!entry) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0496', { v0: (kind) }), {
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
    binNames: entry.binNames,
    npmPackages: entry.npmPackages,
    supervision: [
      `systemd unit: ysk-agent-${kind}.service`,
      'All agent tool calls must pass YSK Allowlist + Approval',
      'Agent role RBAC capped at write-low',
      'ExecStart uses real CLI binary when present — never a silent placeholder as success',
    ],
  };
}

export function parseAgentKind(value: string): AgentRuntimeKind {
  if (value === 'openclaw' || value === 'hermes' || value === 'ionclaw') {
    return value;
  }
  throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0497', { v0: (value) }), {
    httpStatus: 400,
  });
}
