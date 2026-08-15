/**
 * Honest mutation results for validator host ops.
 */
import {
  assertHonestOps,
  type ApplyStatus,
  type OpsResultDto,
} from 'ysk-server-shared';
import { panelBlockMessage, type BlockReason } from '../system-apply.js';

export type ValidatorOpsResult = OpsResultDto & {
  instanceId?: string;
  dryRun?: boolean;
  executed?: boolean;
};

export function blockedValidatorOp(input: {
  reason: BlockReason;
  notes?: string[];
  instanceId?: string;
  written?: string[];
}): ValidatorOpsResult {
  return assertHonestOps({
    ok: false,
    blocked: true,
    apply_status: 'blocked' satisfies ApplyStatus,
    blockMessage: panelBlockMessage(input.reason),
    requiresExecute: input.reason === 'no_execute',
    requiresRoot: input.reason === 'no_root',
    notes: input.notes ?? [panelBlockMessage(input.reason)],
    written: input.written,
    instanceId: input.instanceId,
    dryRun: input.reason === 'no_execute',
    executed: false,
  });
}

export function writtenValidatorOp(input: {
  notes: string[];
  instanceId?: string;
  written: string[];
  dryRun?: boolean;
}): ValidatorOpsResult {
  return assertHonestOps({
    ok: true,
    apply_status: 'written',
    notes: input.notes,
    written: input.written,
    instanceId: input.instanceId,
    dryRun: input.dryRun ?? true,
    executed: false,
    requiresExecute: true,
  });
}

export function appliedValidatorOp(input: {
  notes: string[];
  instanceId?: string;
  written?: string[];
}): ValidatorOpsResult {
  return assertHonestOps({
    ok: true,
    apply_status: 'applied',
    notes: input.notes,
    written: input.written,
    instanceId: input.instanceId,
    dryRun: false,
    executed: true,
  });
}

export function failedValidatorOp(input: {
  notes: string[];
  instanceId?: string;
  written?: string[];
}): ValidatorOpsResult {
  return assertHonestOps({
    ok: false,
    apply_status: 'failed',
    notes: input.notes,
    written: input.written,
    instanceId: input.instanceId,
    executed: true,
  });
}
