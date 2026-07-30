import { describe, expect, it } from 'vitest';
import {
  canAccessPath,
  canSeeFeature,
  matchMutatingRouteCap,
} from './route-capabilities.js';

describe('matchMutatingRouteCap', () => {
  it('gates restore as backups.restore (not mere run)', () => {
    expect(matchMutatingRouteCap('POST', '/api/v1/backups/restore')).toBe('backups.restore');
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
});

describe('canSeeFeature', () => {
  it('hides users without manage caps', () => {
    expect(canSeeFeature('users', ['dashboard.read'])).toBe(false);
    expect(canSeeFeature('users', ['users.manage'])).toBe(true);
    expect(canSeeFeature('dashboard', ['dashboard.read'])).toBe(true);
  });
});

describe('canAccessPath', () => {
  it('guards /users and allows open paths', () => {
    expect(canAccessPath('/users', ['dashboard.read'])).toBe(false);
    expect(canAccessPath('/users', ['users.manage'])).toBe(true);
    expect(canAccessPath('/projects', ['dashboard.read'])).toBe(true);
  });
});
