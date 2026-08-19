/**
 * Unit tests for pure page helpers (exported for coverage of branch tables).
 */
import { describe, expect, it } from 'vitest';
import {
  parseUserAgent,
  relativeTime,
  mapWebAuthnError,
  browserSupportsWebAuthn,
  isSecureWebAuthnContext,
  isWebAuthnIpHostname,
  diagnoseWebAuthnBlocker,
  getWebAuthnEnv,
} from './SecurityPage';
import {
  statusTone,
  statusLabel,
  cmdStatusTone,
  cmdStatusLabel,
  prettyJson,
  summarizePayload,
  asCliAck,
  unwrapCliBody,
  exitCodeOf,
  exitTone,
  exitHint,
  fleetDisplayStatus,
  runtimeHonestStatus,
  runtimeJournalTo,
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

  it('mapWebAuthnError localizes library English messages', () => {
    // jsdom is usually insecure → "not supported" maps via diagnose, not bare unsupported
    const mapped = mapWebAuthnError(new Error('WebAuthn is not supported in this browser'), t);
    expect(mapped).toMatch(/webauthn(InsecureContext|Unsupported|IpHost)/);
    expect(mapWebAuthnError(new Error('This feature is only available in secure contexts'), t)).toMatch(
      /webauthnInsecureContext/,
    );
    expect(mapWebAuthnError(new Error('The operation either timed out or was not allowed'), t)).toBe(
      'security.webauthnCancelled',
    );
    expect(mapWebAuthnError(new Error(''), t)).toBe('security.webauthnFailed');
    expect(mapWebAuthnError(new Error('面板 未登記 passkey'), t)).toMatch(/passkey|面板/);
    expect(mapWebAuthnError(new Error('A'.repeat(200)), t)).toBe('security.webauthnFailed');
    expect(
      mapWebAuthnError(
        Object.assign(new Error('1.2.3.4 is an invalid domain'), { code: 'ERROR_INVALID_DOMAIN' }),
        t,
      ),
    ).toMatch(/webauthnIpHost/);
  });

  it('isWebAuthnIpHostname detects public IP RP hosts', () => {
    expect(isWebAuthnIpHostname('219.73.47.192')).toBe(true);
    expect(isWebAuthnIpHostname('10.0.0.1')).toBe(true);
    expect(isWebAuthnIpHostname('localhost')).toBe(false);
    expect(isWebAuthnIpHostname('127.0.0.1')).toBe(false);
    expect(isWebAuthnIpHostname('panel.example.com')).toBe(false);
  });

  it('diagnoseWebAuthnBlocker prefers IP / insecure over bare unsupported', () => {
    expect(
      diagnoseWebAuthnBlocker(t, {
        origin: 'http://1.2.3.4:9173',
        hostname: '1.2.3.4',
        isSecureContext: false,
        hasPublicKeyCredential: true,
        isIpHost: true,
        isLocalhost: false,
        likelyOk: false,
      }),
    ).toMatch(/webauthnIpHost/);
    expect(
      diagnoseWebAuthnBlocker(t, {
        origin: 'http://panel.example.com',
        hostname: 'panel.example.com',
        isSecureContext: false,
        hasPublicKeyCredential: true,
        isIpHost: false,
        isLocalhost: false,
        likelyOk: false,
      }),
    ).toMatch(/webauthnInsecureContext/);
    expect(
      diagnoseWebAuthnBlocker(t, {
        origin: 'https://panel.example.com',
        hostname: 'panel.example.com',
        isSecureContext: true,
        hasPublicKeyCredential: true,
        isIpHost: false,
        isLocalhost: false,
        likelyOk: true,
      }),
    ).toBeNull();
  });

  it('browserSupportsWebAuthn / isSecureWebAuthnContext / getWebAuthnEnv', () => {
    expect(typeof browserSupportsWebAuthn()).toBe('boolean');
    expect(typeof isSecureWebAuthnContext()).toBe('boolean');
    const env = getWebAuthnEnv();
    expect(env).toMatchObject({
      isSecureContext: expect.any(Boolean),
      hasPublicKeyCredential: expect.any(Boolean),
      isIpHost: expect.any(Boolean),
      likelyOk: expect.any(Boolean),
    });
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
    expect(cmdStatusLabel('queued', t)).toBe('agents.cmdStatus.queued');
    expect(cmdStatusLabel('other', t)).toBe('other');
  });

  it('fleetDisplayStatus does not mix registered with stale', () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(fleetDisplayStatus('registered', old)).toBe('registered');
    expect(fleetDisplayStatus('connected', new Date(Date.now() - 90_000).toISOString())).toBe(
      'stale',
    );
    expect(fleetDisplayStatus('connected', old)).toBe('disconnected');
    expect(fleetDisplayStatus('stale', new Date(Date.now() - 90_000).toISOString())).toBe('stale');
  });

  it('runtimeHonestStatus treats failed as not running', () => {
    expect(runtimeHonestStatus({ status: 'running', pathExists: true })).toBe('running');
    expect(runtimeHonestStatus({ status: 'running', pathExists: false })).toBe('not_installed');
    expect(runtimeHonestStatus({ status: 'failed', unitActive: 'activating' })).toBe('stuck');
    expect(runtimeHonestStatus({ status: 'failed' })).toBe('failed');
    expect(runtimeJournalTo({ kind: 'openclaw' })).toContain('ysk-agent-openclaw.service');
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
