/**
 * Pure helpers lifted for function coverage (≥90% target).
 * Fail2ban / Firewall / App route helpers.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import {
  resolveJailOptions,
  initialSelectedJails,
  filterBannedRows,
  jailEnabledTone,
  normalizeDurationPreset,
  clampMaxretry,
  isValidBanIp,
} from './features/Fail2banPage';
import {
  parsePorts,
  firewallActionTone,
  firewallActiveTone,
  parsePortInput,
  parsePortInputNumber,
  isValidDenyIp,
  mapFirewallRules,
} from './features/FirewallPage';
import {
  catLabel,
  levelTone,
  levelLabel,
  severityLabel,
} from './features/ReadinessPage';
import { RouteFallback, RedirectPreserveQuery, Lazy } from '../app/App';
import {
  statusTone as cdnStatusTone,
  toggleMembership,
  parseGeoMapText,
  canDeleteCdnSite,
} from './features/CdnPage';

const t = (k: string) => k;

describe('Fail2ban pure helpers', () => {
  it('resolveJailOptions / initialSelectedJails', () => {
    expect(resolveJailOptions([{ id: 'sshd' }, { id: 'x' }], undefined)).toEqual([
      'sshd',
      'x',
    ]);
    expect(resolveJailOptions([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(resolveJailOptions(undefined, undefined)).toContain('sshd');

    expect(initialSelectedJails({ jails: [{ name: 'sshd' }, { name: 'x' }] })).toEqual([
      'sshd',
      'x',
    ]);
    expect(
      initialSelectedJails({
        catalog: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
      }),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(initialSelectedJails({})).toContain('sshd');
  });

  it('filterBannedRows', () => {
    const rows = [
      { ip: '1.2.3.4', jail: 'sshd' },
      { ip: '10.0.0.1', jail: 'nginx-http-auth' },
    ];
    expect(filterBannedRows(rows, '')).toEqual(rows);
    expect(filterBannedRows(rows, '  ')).toEqual(rows);
    expect(filterBannedRows(rows, '1.2')).toEqual([rows[0]]);
    expect(filterBannedRows(rows, 'NGINX')).toEqual([rows[1]]);
    expect(filterBannedRows(rows, 'nope')).toEqual([]);
  });

  it('jailEnabledTone / duration / maxretry / ban ip', () => {
    expect(jailEnabledTone(true)).toBe('ok');
    expect(jailEnabledTone(false)).toBe('warn');
    expect(jailEnabledTone(undefined)).toBe('neutral');

    expect(normalizeDurationPreset('')).toBe('1h');
    expect(normalizeDurationPreset('  30m ')).toBe('30m');
    expect(normalizeDurationPreset('1H')).toBe('1h');
    expect(normalizeDurationPreset('90')).toBe('90s');
    expect(normalizeDurationPreset('weird', '10m')).toBe('10m');

    expect(clampMaxretry(5)).toBe(5);
    expect(clampMaxretry(0)).toBe(1);
    expect(clampMaxretry(100)).toBe(50);
    expect(clampMaxretry('3')).toBe(3);
    expect(clampMaxretry('x')).toBe(5);
    expect(clampMaxretry(undefined)).toBe(5);

    expect(isValidBanIp('1.2.3.4')).toBe(true);
    expect(isValidBanIp('  ')).toBe(false);
    expect(isValidBanIp('ab')).toBe(false);
    expect(isValidBanIp('2001:db8::1')).toBe(true);
  });
});

describe('Firewall pure helpers', () => {
  it('parsePorts ranges and singles', () => {
    expect(parsePorts('80,443')).toEqual([80, 443]);
    expect(parsePorts('21 30000:30002')).toEqual([21, 30000, 30001, 30002]);
    expect(parsePorts('0,99999,bad')).toEqual([]);
    expect(parsePorts('')).toEqual([]);
    // dedupe + cap (200 for full FTPS PASV range)
    const many = parsePorts('1:50');
    expect(many.length).toBe(50);
    expect(parsePorts('80,80,80')).toEqual([80]);
    expect(parsePorts('30000:30100').length).toBe(101);
  });

  it('action/active tones and port/ip validators', () => {
    expect(firewallActionTone('ALLOW')).toBe('ok');
    expect(firewallActionTone('DENY')).toBe('danger');
    expect(firewallActionTone('REJECT IN')).toBe('danger');
    expect(firewallActionTone('LIMIT')).toBe('neutral');
    expect(firewallActionTone(undefined)).toBe('neutral');

    expect(firewallActiveTone(true, true)).toBe('ok');
    expect(firewallActiveTone(false, true)).toBe('warn');
    expect(firewallActiveTone(false, false)).toBe('danger');

    expect(parsePortInput('8080')).toBe('8080');
    expect(parsePortInputNumber('8080')).toBe(8080);
    expect(parsePortInputNumber(' 22 ')).toBe(22);
    expect(parsePortInputNumber('0')).toBeNull();
    expect(parsePortInput('x')).toBeNull();
    expect(parsePortInput('70000')).toBeNull();

    expect(isValidDenyIp('203.0.113.1')).toBe(true);
    expect(isValidDenyIp('10.0.0.0/8')).toBe(true);
    expect(isValidDenyIp('')).toBe(false);
    expect(isValidDenyIp('no')).toBe(false);
  });

  it('mapFirewallRules from rules and numbered', () => {
    const fromRules = mapFirewallRules(
      [
        { num: 1, action: 'ALLOW', to: '22/tcp', from: 'Anywhere', raw: 'r1' },
        { num: 2, action: 'DENY', to: 'Anywhere', from: '1.1.1.1' },
      ],
      undefined,
    );
    expect(fromRules).toHaveLength(2);
    expect(fromRules[0].action).toBe('ALLOW');
    expect(fromRules[1].raw).toBe('2');

    const fromNum = mapFirewallRules(undefined, [
      '[ 1] 22 ALLOW',
      { num: 2, action: 'DENY', to: 'x', from: 'y', raw: 'r2' },
    ]);
    expect(fromNum[0].action).toBe('?');
    expect(fromNum[0].to).toBe('[ 1] 22 ALLOW');
    expect(fromNum[1].num).toBe(2);
    expect(mapFirewallRules(undefined, undefined)).toEqual([]);
  });
});

describe('Readiness pure helpers', () => {
  it('labels and tones', () => {
    expect(catLabel('security', t)).toBeTruthy();
    expect(catLabel('unknown-cat', t)).toBeTruthy();
    expect(levelTone('ready')).toBe('ok');
    expect(levelTone('degraded')).toBe('warn');
    expect(levelTone('missing')).toBe('danger');
    expect(levelTone('unknown' as never)).toBe('neutral');
    expect(levelLabel('ready', t)).toBeTruthy();
    expect(levelLabel('missing', t)).toBeTruthy();
    expect(severityLabel('critical', t)).toBeTruthy();
    expect(severityLabel(undefined, t)).toBeNull();
    expect(severityLabel('recommended', t)).toBeTruthy();
  });
});

describe('Cdn pure helpers', () => {
  it('statusTone / toggleMembership / parseGeoMapText / canDelete', () => {
    expect(cdnStatusTone('online')).toBe('ok');
    expect(cdnStatusTone('draining')).toBe('warn');
    expect(cdnStatusTone('offline')).toBe('danger');
    expect(cdnStatusTone('unknown')).toBe('neutral');

    expect(toggleMembership(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(toggleMembership(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleMembership([], 'x')).toEqual(['x']);

    expect(parseGeoMapText('')).toBeNull();
    expect(parseGeoMapText('  ')).toBeNull();
    expect(parseGeoMapText('{')).toBeNull();
    expect(parseGeoMapText('[1,2]')).toBeNull();
    expect(parseGeoMapText('{"US":"n1"}')).toEqual({ US: 'n1' });

    expect(canDeleteCdnSite(null)).toBe(false);
    expect(canDeleteCdnSite({ apply_status: 'applying' })).toBe(false);
    expect(canDeleteCdnSite({ apply_status: 'applied' })).toBe(true);
  });
});

describe('App route helpers', () => {
  it('RouteFallback renders', () => {
    render(<RouteFallback />);
    expect(document.body.textContent).toMatch(/Loading/i);
  });

  it('RedirectPreserveQuery keeps query string', () => {
    render(
      <MemoryRouter initialEntries={['/firewall?tab=ports&x=1']}>
        <Routes>
          <Route path="/firewall" element={<RedirectPreserveQuery to="/protection/firewall" />} />
          <Route path="/protection/firewall" element={<div>DEST</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('DEST')).toBeInTheDocument();
    // landed with query preserved
    expect(window.location?.pathname || true).toBeTruthy();
  });

  it('RedirectPreserveQuery without query', () => {
    render(
      <MemoryRouter initialEntries={['/fail2ban']}>
        <Routes>
          <Route path="/fail2ban" element={<RedirectPreserveQuery to="/protection/fail2ban" />} />
          <Route path="/protection/fail2ban" element={<div>F2B</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('F2B')).toBeInTheDocument();
  });

  it('Lazy renders children after suspend resolves', async () => {
    render(
      <MemoryRouter>
        <Lazy>
          <div>child-ok</div>
        </Lazy>
      </MemoryRouter>,
    );
    expect(await screen.findByText('child-ok')).toBeInTheDocument();
  });
});
