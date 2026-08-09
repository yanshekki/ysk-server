/**
 * Secure tool execution: Protection → Allowlist → RBAC → Approval → HostExecutor.
 * Never returns fake executed:true without real host work for mutating tools.
 */

import type {
  OperationLevel,
  ResourceScope,
  SystemRole,
  ToolCallRequest,
  ToolCallResult } from '@ysk/shared';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
import { resolve as pathResolve } from 'node:path';
import type { Allowlist } from './allowlist.js';
import type { ApprovalQueue } from './approval.js';
import { checkRbac } from './rbac.js';
import { toolImpliedLevel } from './operation-level.js';
import type { ProtectionState } from '../services/protection.js';
import { pathUnderRoot, type HostExecutor } from '../host/executor.js';
import type { AuditRepository } from '../repositories/audit-repo.js';

const EMERGENCY_TOOLS = new Set([
  'sys.info',
  'process.list',
  'service.status',
  'fs.read',
  'fs.list',
  'service.restart',
]);

export interface ToolExecutorOptions {
  allowlist: Allowlist;
  approvals: ApprovalQueue;
  actor: string;
  roles?: SystemRole[];
  scope?: ResourceScope;
  protection?: ProtectionState;
  host: HostExecutor;
  audit?: AuditRepository;
  /** dataDir is always an allowed FS root for tools */
  dataDir?: string;
  /**
   * Additional absolute roots for fs.read/list/write/delete.
   * Fail-closed: if neither dataDir nor fsRoots is set, fs.* tools refuse.
   */
  fsRoots?: string[];
}

/**
 * Evaluate and execute a tool call against the real host when permitted.
 */
export async function executeToolCall(
  req: ToolCallRequest,
  opts: ToolExecutorOptions,
  approvalId?: string,
): Promise<ToolCallResult> {
  if (!req.tool || typeof req.tool !== 'string') {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1408'), { httpStatus: 400 });
  }

  const protection = opts.protection;
  if (protection?.blockExternalTools || protection?.emergencyPlaybooksOnly) {
    if (!EMERGENCY_TOOLS.has(req.tool)) {
      return deny(
        req,
        opts,
        `Protection mode ${protection.mode}: tool blocked (emergency playbooks only)`,
      );
    }
  }

  const evaluation = opts.allowlist.evaluate(req.tool);
  if (!evaluation.allowed) {
    return deny(req, opts, evaluation.reason ?? tl('notes.auto.n0779'));
  }

  const level: OperationLevel = toolImpliedLevel(req.tool, evaluation.risk);
  const scope: ResourceScope = opts.scope ?? req.scope ?? { kind: 'global' };
  const roles = opts.roles?.length ? opts.roles : (['viewer'] as SystemRole[]);
  const rbacAllowed = roles.some((role) => checkRbac(role, scope, level).allowed);
  if (!rbacAllowed) {
    const reason =
      roles.map((role) => checkRbac(role, scope, level).reason).find(Boolean) ??
      `RBAC denied for roles=${roles.join(',')} level=${level}`;
    return deny(req, opts, reason);
  }

  if (req.dryRun) {
    return {
      allowed: true,
      requiresApproval: evaluation.requiresApproval,
      dryRun: true,
      result: {
        tool: req.tool,
        args: req.args,
        risk: evaluation.risk,
        operationLevel: level,
        wouldRequireApproval: evaluation.requiresApproval,
        schema: evaluation.entry?.argsSchema,
        protectionMode: protection?.mode ?? 'normal',
        hostExecuteEnabled: opts.host.executeEnabled() } };
  }

  if (evaluation.requiresApproval) {
    if (!approvalId) {
      const pending = opts.approvals.request({
        action: req.tool,
        risk: evaluation.risk,
        requestedBy: opts.actor,
        payload: req.args });
      opts.audit?.append({
        actor: opts.actor,
        action: 'tool.approval_requested',
        resource: req.tool,
        detail: { approvalId: pending.id, args: req.args },
        ok: true });
      return {
        allowed: true,
        requiresApproval: true,
        approvalId: pending.id,
        dryRun: false,
        result: { status: 'pending_approval', approvalId: pending.id } };
    }
    opts.approvals.assertApproved(approvalId, req.tool);
  }

  try {
    const resultPayload = await dispatchTool(req.tool, req.args ?? {}, opts);
    if (approvalId) {
      try {
        opts.approvals.markExecuted(approvalId);
      } catch {
        /* ignore */
      }
    }
    opts.audit?.append({
      actor: opts.actor,
      action: 'tool.execute',
      resource: req.tool,
      detail: { args: req.args, result: summarize(resultPayload), approvalId },
      ok: true });
    return {
      allowed: true,
      requiresApproval: evaluation.requiresApproval,
      approvalId,
      dryRun: false,
      result: {
        tool: req.tool,
        executed: true,
        ...resultPayload } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts.audit?.append({
      actor: opts.actor,
      action: 'tool.execute',
      resource: req.tool,
      detail: { args: req.args, error: message },
      ok: false });
    if (err instanceof YskError) throw err;
    throw new YskError(ErrorCodes.INTERNAL, message, { httpStatus: 500, cause: err });
  }
}

/** Resolve allowed roots for tool filesystem ops (fail-closed when empty). */
export function toolFsRoots(opts: Pick<ToolExecutorOptions, 'dataDir' | 'fsRoots'>): string[] {
  const roots: string[] = [];
  if (opts.dataDir?.trim()) roots.push(pathResolve(opts.dataDir.trim()));
  for (const r of opts.fsRoots ?? []) {
    const t = String(r ?? '').trim();
    if (t) roots.push(pathResolve(t));
  }
  return roots;
}

/**
 * Ensure tool path is inside at least one allowed root (boundary-safe).
 * Returns resolved absolute path.
 */
export function assertToolFsPath(
  rawPath: string,
  roots: string[],
): string {
  if (!rawPath?.trim()) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needPath'), { httpStatus: 400 });
  }
  if (rawPath.includes('\0')) {
    throw new YskError(ErrorCodes.SANDBOX_VIOLATION, tl('notes.files.pathOutsideSandbox', { target: rawPath }), {
      httpStatus: 403,
      details: { path: rawPath },
    });
  }
  if (!roots.length) {
    throw new YskError(
      ErrorCodes.SANDBOX_VIOLATION,
      tl('notes.files.pathOutsideSandbox', { target: rawPath }),
      {
        httpStatus: 403,
        details: { path: rawPath, reason: 'fs_tools_require_sandbox_roots' },
      },
    );
  }
  const abs = pathResolve(rawPath);
  for (const root of roots) {
    if (pathUnderRoot(root, abs)) return abs;
  }
  throw new YskError(ErrorCodes.SANDBOX_VIOLATION, tl('notes.files.pathOutsideSandbox', { target: rawPath }), {
    httpStatus: 403,
    details: { path: abs, roots },
  });
}

async function dispatchTool(
  tool: string,
  args: Record<string, unknown>,
  opts: ToolExecutorOptions,
): Promise<Record<string, unknown>> {
  const host = opts.host;
  const roots = toolFsRoots(opts);
  switch (tool) {
    case 'fs.read': {
      const path = assertToolFsPath(String(args.path ?? ''), roots);
      const content = await host.readFile(path);
      return { path, content, bytes: Buffer.byteLength(content) };
    }
    case 'fs.list': {
      const path = assertToolFsPath(String(args.path ?? ''), roots);
      const entries = await host.listDir(path);
      return { path, entries };
    }
    case 'fs.write': {
      const path = assertToolFsPath(String(args.path ?? ''), roots);
      const content = String(args.content ?? '');
      await host.writeFile(path, content);
      return { path, bytesWritten: Buffer.byteLength(content) };
    }
    case 'fs.delete': {
      const path = assertToolFsPath(String(args.path ?? ''), roots);
      await host.deletePath(path);
      return { path, deleted: true };
    }
    case 'sys.info': {
      const info = await host.sysInfo();
      return { info };
    }
    case 'process.list': {
      // portable: read /proc if present else empty
      try {
        const entries = await host.listDir('/proc');
        const pids = entries.filter((e) => /^\d+$/.test(e)).slice(0, 50);
        return { pids, note: 'limited pid list from /proc' };
      } catch {
        return { pids: [], note: '/proc unavailable' };
      }
    }
    case 'service.status': {
      const name = String(args.name ?? '');
      if (!name) throw new YskError(ErrorCodes.VALIDATION, tl('notes.needName'), { httpStatus: 400 });
      const r = await host.serviceStatus(name);
      return { name, ...r };
    }
    case 'service.restart': {
      const name = String(args.name ?? '');
      if (!name) throw new YskError(ErrorCodes.VALIDATION, tl('notes.needName'), { httpStatus: 400 });
      if (!/^[a-zA-Z0-9@_.-]+$/.test(name)) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0947'), { httpStatus: 400 });
      }
      const r = await host.runCommand(['systemctl', 'restart', name]);
      return { name, ...r };
    }
    case 'pkg.install': {
      const name = String(args.name ?? '');
      if (!name || !/^[a-zA-Z0-9+._-]+$/.test(name)) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.invalidPackageName'), { httpStatus: 400 });
      }
      const r = await host.runCommand(['apt-get', 'install', '-y', name], { timeoutMs: 120_000 });
      return { package: name, ...r };
    }
    case 'pkg.remove': {
      const name = String(args.name ?? '');
      if (!name || !/^[a-zA-Z0-9+._-]+$/.test(name)) {
        throw new YskError(ErrorCodes.VALIDATION, tl('notes.invalidPackageName'), { httpStatus: 400 });
      }
      const r = await host.runCommand(['apt-get', 'remove', '-y', name], { timeoutMs: 120_000 });
      return { package: name, ...r };
    }
    default:
      throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.t0019', { v0: (tool) }), {
        httpStatus: 400 });
  }
}

function deny(
  req: ToolCallRequest,
  opts: ToolExecutorOptions,
  reason: string,
): ToolCallResult {
  opts.audit?.append({
    actor: opts.actor,
    action: 'tool.denied',
    resource: req.tool,
    detail: { reason, args: req.args },
    ok: false });
  return {
    allowed: false,
    requiresApproval: false,
    dryRun: Boolean(req.dryRun),
    denialReason: reason };
}

function summarize(payload: Record<string, unknown>): unknown {
  if (typeof payload.content === 'string' && payload.content.length > 200) {
    return { ...payload, content: String(payload.content).slice(0, 200) + '…' };
  }
  return payload;
}
