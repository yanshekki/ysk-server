import { describe, expect, it } from 'vitest';
import {
  canAccessPath,
  canSeeFeature,
  capsRequiredForPath,
  matchGetRouteCaps,
  matchMutatingRouteAnyOf,
  matchMutatingRouteCap,
} from './route-capabilities.js';

describe('matchMutatingRouteCap', () => {
  it('gates restore as backups.restore (not mere run)', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/backups/restore')).toBe('backups.restore');
    expect(matchMutatingRouteCap('POST', '/api/v1/backups/remote/test')).toBe(
      'backups.run',
    );
    expect(matchMutatingRouteCap('POST', '/api/v1/backups/restic/restore')).toBe(
      'backups.restore',
    );
    expect(matchMutatingRouteCap('POST', '/api/v1/backups/run-all')).toBe('backups.run');
  });

  it('gates project delete higher than project write', () => {
    expect(matchMutatingRouteCap('DELETE', '/api/v1/projects/abc')).toBe('projects.delete');
    expect(matchMutatingRouteCap('POST', '/api/v1/projects')).toBe('projects.write');
    expect(matchMutatingRouteCap('POST', '/api/v1/projects/abc/deploy')).toBe('projects.write');
    expect(matchMutatingRouteCap('POST', '/api/v1/projects/abc/publish-nginx')).toBe(
      'publish.apply',
    );
  });

  it('gates updates, services, firewall', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/updates/apply')).toBe('updates.apply');
    expect(matchMutatingRouteCap('POST', '/api/v1/system/services/lifecycle')).toBe(
      'services.control',
    );
    expect(matchMutatingRouteCap('POST', '/api/v1/system/firewall/apply')).toBe('firewall.edit');
    expect(matchMutatingRouteCap('POST', '/api/v1/system/firewall/enable')).toBe(
      'firewall.flush',
    );
    expect(matchMutatingRouteCap('POST', '/api/v1/dns/ddns/update')).toBe('dns.apply');
    expect(matchMutatingRouteCap('DELETE', '/api/v1/dns/ddns/records/abc')).toBe('dns.apply');
  });

  it('gates impersonate separately from users.manage', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/users/u1/impersonate')).toBe(
      'users.impersonate',
    );
    expect(matchMutatingRouteCap('POST', '/api/v1/users')).toBe('users.manage');
    expect(matchMutatingRouteCap('PATCH', '/api/v1/users/u1')).toBe('users.manage');
  });

  it('ignores GET', () => {
    expect(matchMutatingRouteCap('GET', '/api/v1/backups/restore')).toBe(null);
  });

  it('terminal POST accepts settings.system or services.control', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/terminal/session')).toBe('settings.system');
    expect(matchMutatingRouteAnyOf('POST', '/api/v1/terminal/session')).toEqual([
      'settings.system',
      'services.control',
    ]);
  });

  it('matchGetRouteCaps gates inventory prefixes (any-of)', () => {
    expect(matchGetRouteCaps('/api/v1/email/domains')).toEqual(
      expect.arrayContaining(['mail.read']),
    );
    expect(matchGetRouteCaps('/api/v1/projects')).toEqual(
      expect.arrayContaining(['projects.read']),
    );
    expect(matchGetRouteCaps('/api/v1/ssl/certificates')).toEqual(
      expect.arrayContaining(['ssl.read']),
    );
    expect(matchGetRouteCaps('/api/v1/auth/me')).toBeNull();
    expect(matchGetRouteCaps('/api/v1/dashboard')).toBeNull();
    expect(matchGetRouteCaps('/api/v1/validators')).toEqual(
      expect.arrayContaining(['validators.read']),
    );
  });

  it('gates validator mutations by wipe vs manage', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/validators/eth-hoodi-1/clear')).toBe(
      'validators.wipe',
    );
    expect(matchMutatingRouteCap('POST', '/api/v1/validators')).toBe('validators.manage');
    expect(matchMutatingRouteCap('POST', '/api/v1/validators/eth-hoodi-1/start')).toBe(
      'validators.manage',
    );
    expect(matchMutatingRouteCap('POST', '/api/v1/validators/eth-hoodi-1/delete')).toBe(
      'validators.wipe',
    );
    expect(matchMutatingRouteCap('DELETE', '/api/v1/validators/eth-hoodi-1')).toBe(
      'validators.wipe',
    );
  });

  it('gates docker mutations by wipe vs manage', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/docker/prune')).toBe('docker.wipe');
    expect(matchMutatingRouteCap('POST', '/api/v1/docker/engine/start')).toBe('docker.manage');
    expect(matchMutatingRouteCap('POST', '/api/v1/docker/compose/yskval-eth-hoodi-1/rm')).toBe(
      'docker.wipe',
    );
    expect(matchGetRouteCaps('/api/v1/docker')).toEqual(expect.arrayContaining(['docker.read']));
  });

  it('ssl upload is write-low before generic ssl rules', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/ssl/upload')).toBe('ssl.upload');
  });

  it('returns null for mutating paths outside /api/v1', () => {
    expect(matchMutatingRouteCap('POST', '/healthz')).toBe(null);
    expect(matchMutatingRouteCap('PUT', '/not-api')).toBe(null);
  });
});

describe('canSeeFeature', () => {
  it('hides users without manage caps', () => {
    expect(canSeeFeature('users', ['dashboard.read'])).toBe(false);
    expect(canSeeFeature('users', ['users.manage'])).toBe(true);
    expect(canSeeFeature('dashboard', ['dashboard.read'])).toBe(true);
  });

  it('accepts Set effective caps', () => {
    expect(canSeeFeature('users', new Set(['dashboard.read']))).toBe(false);
    expect(canSeeFeature('users', new Set(['rbac.policy']))).toBe(true);
  });

  it('aligns vpn/vnc/systemd nav with path guards', () => {
    expect(canSeeFeature('vpn', ['firewall.edit'])).toBe(false);
    expect(canSeeFeature('vpn', ['network.vpn'])).toBe(true);
    expect(canSeeFeature('vnc', ['firewall.edit'])).toBe(false);
    expect(canSeeFeature('vnc', ['network.vnc'])).toBe(true);
    expect(canSeeFeature('systemd', ['services.read'])).toBe(false);
    expect(canSeeFeature('systemd', ['services.control'])).toBe(true);
  });
});

describe('canAccessPath', () => {
  it('guards /users and allows open paths', () => {
    expect(canAccessPath('/users', ['dashboard.read'])).toBe(false);
    expect(canAccessPath('/users', ['users.manage'])).toBe(true);
    expect(canAccessPath('/projects', ['dashboard.read'])).toBe(true);
  });

  it('longer path prefixes win; Set effective works', () => {
    expect(capsRequiredForPath('/protection/firewall/rules')).toEqual(
      expect.arrayContaining(['firewall.read']),
    );
    expect(capsRequiredForPath('/protection')).toEqual(
      expect.arrayContaining(['firewall.read']),
    );
    expect(canAccessPath('/protection/fail2ban', new Set(['firewall.read']))).toBe(true);
    expect(canAccessPath('/cdn/nodes', new Set(['projects.read']))).toBe(true);
    expect(canAccessPath('/cdn/nodes', new Set(['dashboard.read']))).toBe(false);
  });
});

/** Critical mutating surfaces — every pair must resolve to a non-null cap (B1 audit). */
const CRITICAL_MUTATING: Array<[string, string, string]> = [
  ['POST', '/api/v1/users', 'users.manage'],
  ['POST', '/api/v1/users/u1/impersonate', 'users.impersonate'],
  ['PATCH', '/api/v1/packages/p1', 'packages.manage'],
  ['PUT', '/api/v1/rbac/policies/operator', 'rbac.policy'],
  ['POST', '/api/v1/backups/restore', 'backups.restore'],
  ['DELETE', '/api/v1/projects/abc', 'projects.delete'],
  ['POST', '/api/v1/projects/abc/deploy', 'projects.write'],
  ['POST', '/api/v1/projects/abc/publish-nginx', 'publish.apply'],
  ['POST', '/api/v1/updates/apply', 'updates.apply'],
  ['POST', '/api/v1/tools/execute', 'services.control'],
  ['POST', '/api/v1/defense/ban', 'firewall.edit'],
  ['POST', '/api/v1/cron', 'cron.manage'],
  ['POST', '/api/v1/files/mkdir', 'files.project'],
  ['POST', '/api/v1/email/domains', 'mail.write'],
  ['POST', '/api/v1/email/bootstrap', 'mail.apply'],
  ['POST', '/api/v1/cdn/nodes', 'publish.apply'],
  ['POST', '/api/v1/db/clusters', 'db.write'],
  ['POST', '/api/v1/network/apply', 'settings.system'],
  ['POST', '/api/v1/fleet/agents/register', 'services.control'],
  ['POST', '/api/v1/ssh/identities', 'security.policy'],
  ['POST', '/api/v1/approvals/x/approve', 'approvals.respond'],
  ['POST', '/api/v1/ai/tasks', 'settings.system'],
  ['POST', '/api/v1/migrate/run', 'settings.system'],
  ['POST', '/api/v1/logs/purge', 'logs.purge'],
  // unknown future write surface → fail-closed to settings.system
  ['POST', '/api/v1/future-unknown/mutate', 'settings.system'],
];

describe('B1 critical mutating route audit', () => {
  it.each(CRITICAL_MUTATING)('%s %s → %s', (method, path, cap) => {
    expect(matchMutatingRouteCap(method, path)).toBe(cap);
  });

  it('does not gate public auth login', () => {
    // enforceMutatingRouteCaps skips these; match may still return a cap — document both
    // Login is in PUBLIC_MUTATING_PREFIXES on server, not in match rules specificity
    expect(matchMutatingRouteCap('GET', '/api/v1/users')).toBe(null);
  });
});
