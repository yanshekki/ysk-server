/**
 * Honest mutation results for Docker host ops.
 */
import {
  assertHonestOps,
  type ApplyStatus,
  type OpsResultDto,
} from 'ysk-server-shared';
import { panelBlockMessage, type BlockReason } from '../system-apply.js';

export type DockerOpsResult = OpsResultDto & {
  dryRun?: boolean;
  executed?: boolean;
};

export function blockedDockerOp(input: {
  reason: BlockReason;
  notes?: string[];
  written?: string[];
}): DockerOpsResult {
  return assertHonestOps({
    ok: false,
    blocked: true,
    apply_status: 'blocked' satisfies ApplyStatus,
    blockMessage: panelBlockMessage(input.reason),
    requiresExecute: input.reason === 'no_execute',
    requiresRoot: input.reason === 'no_root',
    notes: input.notes ?? [panelBlockMessage(input.reason)],
    written: input.written,
    dryRun: input.reason === 'no_execute',
    executed: false,
  });
}

export function writtenDockerOp(input: {
  notes: string[];
  written?: string[];
}): DockerOpsResult {
  return assertHonestOps({
    ok: true,
    apply_status: 'written',
    notes: input.notes,
    written: input.written,
    dryRun: true,
    executed: false,
    requiresExecute: true,
  });
}

export function appliedDockerOp(input: {
  notes: string[];
  written?: string[];
}): DockerOpsResult {
  return assertHonestOps({
    ok: true,
    apply_status: 'applied',
    notes: input.notes,
    written: input.written,
    dryRun: false,
    executed: true,
  });
}

export function failedDockerOp(input: {
  notes: string[];
  written?: string[];
}): DockerOpsResult {
  return assertHonestOps({
    ok: false,
    apply_status: 'failed',
    notes: input.notes,
    written: input.written,
    executed: true,
  });
}
