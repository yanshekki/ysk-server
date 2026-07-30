/**
 * Localized ops helpers — blocked / notes / honesty keys.
 */
import { assertHonestOps, type OpsResultDto, type OpsResultInput } from './ops.js';
import { tl } from './i18n/request-locale.js';
import { t } from './i18n/t.js';
import { getLocale } from './i18n/request-locale.js';

/** True if string looks like an i18n key we own (ops.* / errors.* / common.*). */
export function looksLikeI18nKey(s: string): boolean {
  return /^(ops|errors|common|auth)\.[a-zA-Z0-9_.]+$/.test(s.trim());
}

/**
 * Translate a note if it is a known key; otherwise return as-is
 * (legacy free-text / already localized).
 */
export function translateNote(
  note: string,
  locale?: string | null,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  const n = note.trim();
  if (!n) return note;
  if (looksLikeI18nKey(n)) {
    const out = t(locale ?? getLocale(), n, params);
    return out === n ? note : out;
  }
  return note;
}

export function translateNotes(
  notes: string[] | readonly string[] | undefined,
  locale?: string | null,
): string[] {
  if (!notes?.length) return [];
  return notes.map((n) => translateNote(String(n), locale));
}

/** Standard blocked-for-EXECUTE result (localized). */
export function opsBlockedNeedExecute(
  extra?: Partial<OpsResultInput> & Record<string, unknown>,
): OpsResultDto & Record<string, unknown> {
  const msg = tl('ops.blocked.needExecute');
  const extraNotes = extra?.notes
    ? translateNotes(extra.notes as string[])
    : [];
  const { notes: _n, ...rest } = extra ?? {};
  return assertHonestOps({
    ok: false,
    blocked: true,
    requiresExecute: true,
    apply_status: 'blocked',
    blockMessage: (extra?.blockMessage as string | undefined) ?? msg,
    ...rest,
    notes: extraNotes.length ? [...extraNotes, msg] : [msg],
  }) as OpsResultDto & Record<string, unknown>;
}

export function opsBlockedNeedRoot(
  extra?: Partial<OpsResultInput> & Record<string, unknown>,
): OpsResultDto & Record<string, unknown> {
  const msg = tl('ops.blocked.needRoot');
  return assertHonestOps({
    ok: false,
    blocked: true,
    requiresRoot: true,
    apply_status: 'blocked',
    blockMessage: msg,
    notes: [msg],
    ...extra,
  }) as OpsResultDto & Record<string, unknown>;
}

export function opsBlockedNeedExecuteRoot(
  extra?: Partial<OpsResultInput> & Record<string, unknown>,
): OpsResultDto & Record<string, unknown> {
  const msg = tl('ops.blocked.needExecuteRoot');
  return assertHonestOps({
    ok: false,
    blocked: true,
    requiresExecute: true,
    requiresRoot: true,
    apply_status: 'blocked',
    blockMessage: msg,
    notes: [msg],
    ...extra,
  }) as OpsResultDto & Record<string, unknown>;
}

/** Localize honesty/fields on an ops-shaped object before send. */
export function localizeOpsResult<T extends OpsResultInput>(
  result: T,
  locale?: string | null,
): T & OpsResultDto {
  const loc = locale ?? getLocale();
  const honest = assertHonestOps(result);
  return {
    ...honest,
    blockMessage: honest.blockMessage
      ? translateNote(honest.blockMessage, loc)
      : honest.blockMessage,
    notes: translateNotes(honest.notes, loc),
  } as T & OpsResultDto;
}
