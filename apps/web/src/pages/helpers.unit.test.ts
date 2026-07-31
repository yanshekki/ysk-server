/**
 * Unit tests for pure page helpers (exported for coverage of branch tables).
 */
import { describe, expect, it } from 'vitest';
import { parseUserAgent, relativeTime } from './SecurityPage';
import {
  statusTone,
  statusLabel,
  cmdStatusTone,
  prettyJson,
  summarizePayload,
  asCliAck,
  unwrapCliBody,
  exitCodeOf,
  exitTone,
  exitHint,
} from './AgentsPage';
import { badgeForKey } from './DashboardPage';
import { summarizeOpsNotes, toneToBadge, relTime } from './features/ProtectionPage';
import { asOps } from './EmailDomainPage';
import type { FleetCommand } from '../features/agents/api';

const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k;

describe('SecurityPage helpers', () => {
  it('parseUserAgent branches', () => {
    expect(parseUserAgent(undefined).browser).toBe('Unknown');
    expect(parseUserAgent('').browser).toBe('Unknown');
    expect(parseUserAgent('curl/8.0').browser).toMatch(/curl/i);
    expect(parseUserAgent('Mozilla Edg/120 Chrome/120').browser).toMatch(/Edge/i);
    expect(parseUserAgent('Mozilla Chrome/120 Safari/537').browser).toMatch(/Chrome/i);
    expect(parseUserAgent('Mozilla Firefox/121').browser).toMatch(/Firefox/i);
    expect(parseUserAgent('Mozilla Version/17 Safari/605').browser).toMatch(/Safari/i);
    expect(parseUserAgent('Mozilla Windows NT 10').os).toMatch(/Windows/i);
    expect(parseUserAgent('Mozilla Macintosh').os).toMatch(/macOS/i);
    expect(parseUserAgent('Mozilla Android 14').os).toMatch(/Android/i);
    expect(parseUserAgent('Mozilla iPhone').os).toMatch(/iOS/i);
    expect(parseUserAgent('Mozilla Linux').os).toMatch(/Linux/i);
    const long = parseUserAgent('X'.repeat(80));
    expect(long.browser.length).toBeLessThanOrEqual(42);
  });

  it('relativeTime branches', () => {
    expect(relativeTime(undefined, t)).toBe('—');
    expect(relativeTime('not-a-date', t)).toBeTruthy();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(relativeTime(future, t)).toBeTruthy();
    expect(relativeTime(new Date().toISOString(), t)).toMatch(/sessionJustNow|security/);
    expect(relativeTime(new Date(Date.now() - 120_000).toISOString(), t)).toMatch(/Min|session/);
    expect(relativeTime(new Date(Date.now() - 7200_000).toISOString(), t)).toMatch(/Hour|session/);
    expect(relativeTime(new Date(Date.now() - 3 * 86400_000).toISOString(), t)).toMatch(
      /Day|session/,
    );
    expect(relativeTime(new Date(Date.now() - 20 * 86400_000).toISOString(), t)).toBeTruthy();
  });
});

describe('AgentsPage helpers', () => {
  it('statusTone / statusLabel / cmdStatusTone', () => {
    for (const s of [
      'running',
      'connected',
      'not_installed',
      'registered',
      'stale',
      'failed',
      'error',
      'disconnected',
      'unknown',
      'other',
      undefined,
    ]) {
      expect(statusTone(s)).toBeTruthy();
      expect(statusLabel(s, t)).toBeTruthy();
    }
    for (const s of ['done', 'queued', 'acked', 'error', 'other']) {
      expect(cmdStatusTone(s)).toBeTruthy();
    }
  });

  it('prettyJson / summarizePayload', () => {
    expect(prettyJson({ a: 1 })).toContain('a');
    expect(prettyJson('x'.repeat(20_000), 100).length).toBeLessThan(200);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(prettyJson(circular)).toBeTruthy();
    expect(summarizePayload(null)).toBe('—');
    expect(summarizePayload(undefined)).toBe('—');
    expect(summarizePayload('hi')).toBe('hi');
    expect(summarizePayload({ cli: ['projects', 'list'] })).toMatch(/ysk-server/);
    expect(summarizePayload({ op: 'echo', message: 'm' })).toMatch(/echo/);
    expect(summarizePayload({ op: 'ping' })).toMatch(/ping/);
    expect(summarizePayload({ big: 'x'.repeat(200) }).length).toBeLessThan(100);
    const circ: Record<string, unknown> = {};
    circ.x = circ;
    expect(summarizePayload(circ)).toBe('…');
  });

  it('asCliAck / unwrap / exit helpers', () => {
    expect(asCliAck(null)).toBeNull();
    expect(asCliAck('x')).toBeNull();
    const ack = asCliAck({ exitCode: 0, result: { ok: true } });
    expect(ack?.exitCode).toBe(0);
    expect(unwrapCliBody(null)).toBeNull();
    expect(unwrapCliBody(ack)).toEqual({ ok: true });
    expect(unwrapCliBody({ note: 'n' })).toEqual({ note: 'n' });

    const mk = (partial: Partial<FleetCommand>): FleetCommand =>
      ({
        id: 'c',
        agent_id: 'a',
        status: 'done',
        payload: {},
        createdAt: new Date().toISOString(),
        ...partial,
      }) as FleetCommand;

    expect(exitCodeOf(mk({ result: { exitCode: 7 } }))).toBe(7);
    expect(exitCodeOf(mk({ status: 'error', result: undefined }))).toBe(1);
    expect(exitCodeOf(mk({ status: 'done', result: {} }))).toBe(0);
    expect(exitCodeOf(mk({ status: 'queued', result: undefined }))).toBeNull();

    for (const c of [null, 0, 1, 2, 3, 4, 5, 99]) {
      expect(exitTone(c)).toBeTruthy();
      expect(exitHint(c)).toBeDefined();
    }
  });
});

describe('Dashboard badgeForKey', () => {
  it('software + control-plane badges', () => {
    const soft = [
      { id: 'nginx', features: ['nginx'], installed: true, active: 'active' as const },
      { id: 'php', features: ['php'], installed: false, active: 'inactive' as const },
      { id: 'mysql', features: ['mysql'], installed: true, active: 'inactive' as const },
    ];
    expect(badgeForKey('nginx', soft as never, {}, t)?.tone).toBe('ok');
    expect(badgeForKey('php', soft as never, {}, t)?.tone).toBe('warn');
    expect(badgeForKey('mysql', soft as never, {}, t)?.tone).toBe('ok');
    // Keys not in KEY_TO_FEATURE fall through to control-plane / panel neutral
    expect(badgeForKey('unknownFeat', soft as never, {}, t)?.tone).toBe('neutral');
    expect(badgeForKey('readiness', soft as never, { productionReady: true }, t)?.tone).toBe(
      'ok',
    );
    expect(badgeForKey('readiness', soft as never, { productionReady: false }, t)?.tone).toBe(
      'warn',
    );
    expect(
      badgeForKey('security', soft as never, { executeEnabled: false }, t)?.tone,
    ).toBe('warn');
    expect(badgeForKey('security', soft as never, { executeEnabled: true }, t)?.tone).toBe(
      'ok',
    );
    expect(badgeForKey('customKey', soft as never, {}, t)?.tone).toBe('neutral');
  });
});

describe('ProtectionPage helpers', () => {
  it('summarizeOpsNotes / toneToBadge / relTime', () => {
    expect(summarizeOpsNotes(undefined, t)).toEqual([]);
    expect(summarizeOpsNotes([], t)).toEqual([]);
    const notes = summarizeOpsNotes(
      [
        'YSK_EXECUTE blocked system',
        'Wrote nginx 00-ysk-defense conf',
        'Wrote jail.local fail2ban',
        'a'.repeat(130) + ' /home/user/path/file',
        'plain',
      ],
      t,
    );
    expect(notes.length).toBe(5);
    for (const tone of ['ok', 'warn', 'danger', 'info', 'other', undefined]) {
      expect(toneToBadge(tone)).toBeTruthy();
    }
    expect(relTime(undefined, t)).toBe('—');
    expect(relTime(new Date().toISOString(), t)).toMatch(/justNow|rel/);
    expect(relTime(new Date(Date.now() - 120_000).toISOString(), t)).toMatch(/minutes|rel/);
    expect(relTime(new Date(Date.now() - 7200_000).toISOString(), t)).toMatch(/hours|rel/);
    expect(relTime(new Date(Date.now() - 3 * 86400_000).toISOString(), t)).toBeTruthy();
  });
});

describe('EmailDomain asOps', () => {
  it('maps blocked / ok / notes', () => {
    expect(asOps(null)).toBeNull();
    expect(asOps({ ok: true, notes: ['a'] })?.ok).toBe(true);
    expect(asOps({ requiresExecute: true })?.blocked).toBe(true);
    expect(asOps({ requiresRoot: true })?.blocked).toBe(true);
    expect(asOps({ apply_status: 'blocked' })?.ok).toBe(false);
    expect(asOps({ apply_status: 'written', notes: [1, 2] as unknown as string[] })?.notes).toEqual(
      ['1', '2'],
    );
    expect(asOps({ blockMessage: 'x' })?.blockMessage).toBe('x');
    expect(asOps({ blockMessage: 1 as unknown as string })?.blockMessage).toBeUndefined();
    expect(asOps({ notes: 'nope' as unknown as string[] })?.notes).toEqual([]);
  });
});
