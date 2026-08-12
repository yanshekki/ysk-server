import { describe, expect, it } from 'vitest';
import { YskError } from '@ysk-server/shared';
import {
  actorCan,
  effectiveCapsFor,
  requireCapability,
} from './capabilities-enforce.js';

describe('capabilities-enforce', () => {
  it('admin has broad caps; viewer is limited', () => {
    const admin = effectiveCapsFor({ roles: ['admin'] });
    const viewer = effectiveCapsFor({ roles: ['viewer'] });
    expect(admin.length).toBeGreaterThan(viewer.length);
    expect(actorCan({ roles: ['admin'] }, 'users.manage')).toBe(true);
    expect(actorCan({ roles: ['viewer'] }, 'users.manage')).toBe(false);
  });

  it('grants add caps for non-admin roles', () => {
    expect(
      actorCan(
        { roles: ['viewer'], capabilityGrants: ['users.manage'] },
        'users.manage',
      ),
    ).toBe(true);
  });

  it('revokes strip caps for operator (admin revokes are ignored by design)', () => {
    // operator may have projects.write by factory; revoke it
    const hasWrite = actorCan({ roles: ['operator'] }, 'projects.write');
    if (hasWrite) {
      expect(
        actorCan(
          { roles: ['operator'], capabilityRevokes: ['projects.write'] },
          'projects.write',
        ),
      ).toBe(false);
    } else {
      // factory may not grant projects.write — still verify revoke path is safe
      expect(
        actorCan(
          {
            roles: ['operator'],
            capabilityGrants: ['projects.write'],
            capabilityRevokes: ['projects.write'],
          },
          'projects.write',
        ),
      ).toBe(false);
    }
    // admin always keeps users.manage
    expect(
      actorCan(
        { roles: ['admin'], capabilityRevokes: ['users.manage'] },
        'users.manage',
      ),
    ).toBe(true);
  });

  it('requireCapability throws FORBIDDEN when missing', () => {
    expect(() =>
      requireCapability({ roles: ['viewer'] }, 'users.manage'),
    ).toThrow(YskError);
    try {
      requireCapability({ roles: ['viewer'] }, 'users.manage');
    } catch (e) {
      expect(e).toBeInstanceOf(YskError);
      expect((e as YskError).httpStatus).toBe(403);
    }
  });

  it('requireCapability passes when actor has cap', () => {
    expect(() =>
      requireCapability({ roles: ['admin'] }, 'users.manage'),
    ).not.toThrow();
  });
});
