/**
 * Shared ops / apply honesty contract.
 * Single source of truth for written | applied | blocked across API, core, web.
 */

/**
 * Control-plane apply lifecycle (honest; never mark applied without host success).
 * - planned / pending_execute: resource draft awaiting EXECUTE (legacy resource CRUD)
 */
export type ApplyStatus =
  | 'draft'
  | 'written'
  | 'planned'
  | 'pending_execute'
  | 'applied'
  | 'blocked'
  | 'failed'
  | 'partial';

/**
 * Standard operator mutation result.
 * Rules:
 * - ok && blocked is forbidden
 * - apply_status === 'applied' implies ok && !blocked
 * - notes always preferred over raw shell homework in UI
 */
export interface OpsResultDto {
  ok: boolean;
  apply_status?: ApplyStatus;
  blocked?: boolean;
  blockMessage?: string;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  notes: string[];
  written?: string[];
  /** Optional resource / process facts for panels */
  url?: string;
  port?: number;
  pid?: number;
  processStatus?: string;
}

export type OpsResultInput = Partial<OpsResultDto> & {
  ok?: boolean;
  notes?: string[] | readonly string[];
};

function asNotes(notes: OpsResultInput['notes']): string[] {
  if (!notes) return [];
  return Array.isArray(notes) ? notes.map(String) : [];
}

/**
 * Normalize ops result honesty.
 *
 * Hard rule: `blocked: true` never coexists with `ok: true` or `applied`.
 * Soft flags `requiresExecute` / `requiresRoot` alone do **not** flip ok when
 * `apply_status` is `written` / `draft` / `partial` (control-plane success).
 * Missing notes → [].
 */
export function assertHonestOps<T extends OpsResultInput>(result: T): T & OpsResultDto {
  const notes = asNotes(result.notes);
  const hardBlocked = result.blocked === true;
  let ok = typeof result.ok === 'boolean' ? result.ok : !hardBlocked;
  let apply_status = result.apply_status;
  const nextNotes = [...notes];

  if (hardBlocked && ok) {
    ok = false;
    // Stable i18n keys — localize at sendOpsResult / localizeOpsResult
    nextNotes.push('ops.honesty.blockedNotOk');
    if (apply_status === 'applied' || !apply_status) apply_status = 'blocked';
  }

  if (apply_status === 'applied' && hardBlocked) {
    ok = false;
    apply_status = 'blocked';
    if (!nextNotes.some((n) => n.includes('ops.honesty') || n.includes('誠實校正'))) {
      nextNotes.push('ops.honesty.blockedNotApplied');
    }
  }

  // Claimed applied but ok=false → demote
  if (apply_status === 'applied' && !ok) {
    apply_status = hardBlocked ? 'blocked' : 'failed';
    if (!nextNotes.some((n) => n.includes('ops.honesty') || n.includes('ok=false'))) {
      nextNotes.push('ops.honesty.okFalseNotApplied');
    }
  }

  // Claimed applied while soft-gated without host success flag: only if blocked already handled
  // written + requiresExecute is valid (dataDir written; system not applied)

  return {
    ...result,
    ok,
    blocked: hardBlocked ? true : result.blocked,
    requiresExecute: result.requiresExecute,
    requiresRoot: result.requiresRoot,
    blockMessage: result.blockMessage,
    apply_status,
    notes: nextNotes,
    written: result.written ? [...result.written] : result.written,
  } as T & OpsResultDto;
}

/** @deprecated use assertHonestOps */
export const normalizeOpsHonesty = assertHonestOps;

export function isApplyStatus(v: unknown): v is ApplyStatus {
  return (
    v === 'draft' ||
    v === 'written' ||
    v === 'planned' ||
    v === 'pending_execute' ||
    v === 'applied' ||
    v === 'blocked' ||
    v === 'failed' ||
    v === 'partial'
  );
}
