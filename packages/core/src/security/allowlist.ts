/**
 * Hard code-level Allowlist — LLM and agents cannot bypass this.
 * Default posture: read-only; destructive tools require explicit listing + approval.
 */

import type { RiskTier } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface AllowlistEntry {
  tool: string;
  /** Whether the tool may run at all */
  allowed: boolean;
  risk: RiskTier;
  /** High-risk tools always require human approval before execute */
  requiresApproval: boolean;
  description: string;
  /** Optional arg schema hints for dry-run / discovery */
  argsSchema?: Record<string, string>;
}

/** Default catalog: read-only tools allowed; destructive denied unless listed with approval */
const DEFAULT_ENTRIES: AllowlistEntry[] = [
  {
    tool: 'fs.read',
    allowed: true,
    risk: 'low',
    requiresApproval: false,
    description: 'Read a file path',
    argsSchema: { path: 'string' },
  },
  {
    tool: 'fs.list',
    allowed: true,
    risk: 'low',
    requiresApproval: false,
    description: 'List directory',
    argsSchema: { path: 'string' },
  },
  {
    tool: 'sys.info',
    allowed: true,
    risk: 'low',
    requiresApproval: false,
    description: 'Read system information',
  },
  {
    tool: 'process.list',
    allowed: true,
    risk: 'low',
    requiresApproval: false,
    description: 'List processes',
  },
  {
    tool: 'service.status',
    allowed: true,
    risk: 'low',
    requiresApproval: false,
    description: 'Query service status',
    argsSchema: { name: 'string' },
  },
  {
    tool: 'fs.write',
    allowed: true,
    risk: 'medium',
    requiresApproval: true,
    description: 'Write a file',
    argsSchema: { path: 'string', content: 'string' },
  },
  {
    tool: 'service.restart',
    allowed: true,
    risk: 'high',
    requiresApproval: true,
    description: 'Restart a system service',
    argsSchema: { name: 'string' },
  },
  {
    tool: 'pkg.install',
    allowed: true,
    risk: 'high',
    requiresApproval: true,
    description: 'Install a package',
    argsSchema: { name: 'string' },
  },
  {
    tool: 'pkg.remove',
    allowed: true,
    risk: 'critical',
    requiresApproval: true,
    description: 'Remove a package',
    argsSchema: { name: 'string' },
  },
  {
    tool: 'fs.delete',
    allowed: true,
    risk: 'critical',
    requiresApproval: true,
    description: 'Delete a file or directory',
    argsSchema: { path: 'string' },
  },
  {
    tool: 'shell.exec',
    allowed: false,
    risk: 'critical',
    requiresApproval: true,
    description: 'Arbitrary shell — denied by default',
  },
  {
    tool: 'user.delete',
    allowed: false,
    risk: 'critical',
    requiresApproval: true,
    description: 'Delete Linux user — denied by default',
  },
  {
    tool: 'firewall.flush',
    allowed: false,
    risk: 'critical',
    requiresApproval: true,
    description: 'Flush firewall rules — denied by default',
  },
];

export class Allowlist {
  private readonly byTool: Map<string, AllowlistEntry>;

  constructor(entries: AllowlistEntry[] = DEFAULT_ENTRIES) {
    this.byTool = new Map(entries.map((e) => [e.tool, e]));
  }

  /** Return a copy of all known tool entries (schema discovery). */
  list(): AllowlistEntry[] {
    return [...this.byTool.values()].map((e) => ({ ...e }));
  }

  get(tool: string): AllowlistEntry | undefined {
    return this.byTool.get(tool);
  }

  /**
   * Evaluate whether a tool invocation is allowed to proceed.
   * Non-listed tools are denied (fail closed).
   */
  evaluate(tool: string): {
    allowed: boolean;
    requiresApproval: boolean;
    risk: RiskTier;
    reason?: string;
    entry?: AllowlistEntry;
  } {
    const entry = this.byTool.get(tool);
    if (!entry) {
      return {
        allowed: false,
        requiresApproval: false,
        risk: 'critical',
        reason: `Tool not on allowlist: ${tool}`,
      };
    }
    if (!entry.allowed) {
      return {
        allowed: false,
        requiresApproval: entry.requiresApproval,
        risk: entry.risk,
        reason: `Tool explicitly denied: ${tool}`,
        entry,
      };
    }
    return {
      allowed: true,
      requiresApproval: entry.requiresApproval,
      risk: entry.risk,
      entry,
    };
  }

  /**
   * Assert tool is allowed; throws YskError on deny.
   */
  assertAllowed(tool: string): AllowlistEntry {
    const result = this.evaluate(tool);
    if (!result.allowed || !result.entry) {
      throw new YskError(ErrorCodes.ALLOWLIST_DENIED, result.reason ?? 'Denied', {
        httpStatus: 403,
        details: { tool },
      });
    }
    return result.entry;
  }
}

export function createDefaultAllowlist(): Allowlist {
  return new Allowlist();
}
