import { describe, expect, it, vi } from 'vitest';
import { YskError } from '@yanshekki/shared';
import type { IncomingMessage } from 'node:http';
import {
  enforceMutatingRouteCaps,
  requireCap,
  effectiveCaps,
} from './rbac-guard.js';
import type { AppContext } from '../app-context.js';

function mockReq(auth?: string): IncomingMessage {
  return {
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
  } as IncomingMessage;
}

function mockCtx(opts?: {
  caps?: string[];
  authenticate?: (token?: string) => { id: string; username: string; roles: string[] };
}): AppContext {
  const caps = opts?.caps ?? ['projects.write', 'rbac.policy'];
  const user = { id: 'u1', username: 'admin', roles: ['admin'] as string[] };
  return {
    auth: {
      authenticate:
        opts?.authenticate ??
        ((token?: string) => {
          if (!token) {
            throw new YskError('YSK_UNAUTHORIZED', 'no token', { httpStatus: 401 });
          }
          return user;
        }),
    },
    db: {
      snapshot: {
        users: [
          {
            id: 'u1',
            username: 'admin',
            roles: ['admin'],
            capability_grants: null,
            capability_revokes: null,
          },
        ],
      },
    },
    rbac: {
      requireCapability: (u: { roles?: string[] }, cap: string) => {
        if (!caps.includes(cap) && !u.roles?.includes('admin')) {
          throw new YskError('YSK_FORBIDDEN', `missing ${cap}`, { httpStatus: 403 });
        }
        // Admin bypass for tests when cap not in list but role is admin — mirror strict list
        if (!caps.includes(cap)) {
          throw new YskError('YSK_FORBIDDEN', `missing ${cap}`, { httpStatus: 403 });
        }
      },
      effectiveForUser: () => caps,
    },
  } as unknown as AppContext;
}

describe('rbac-guard', () => {
  it('requireCap throws when capability missing', () => {
    const ctx = mockCtx({ caps: ['dashboard.read'] });
    const user = { id: 'u1', username: 'admin', roles: ['admin'] as never };
    expect(() => requireCap(ctx, user, 'rbac.policy')).toThrow(YskError);
  });

  it('requireCap passes when capability present', () => {
    const ctx = mockCtx({ caps: ['rbac.policy'] });
    const user = { id: 'u1', username: 'admin', roles: ['admin'] as never };
    expect(() => requireCap(ctx, user, 'rbac.policy')).not.toThrow();
  });

  it('effectiveCaps returns store-backed list', () => {
    const ctx = mockCtx({ caps: ['a', 'b'] });
    const user = { id: 'u1', username: 'admin', roles: ['admin'] as never };
    expect(effectiveCaps(ctx, user)).toEqual(['a', 'b']);
  });

  it('enforceMutatingRouteCaps is no-op for GET', () => {
    const auth = vi.fn();
    const ctx = mockCtx({ authenticate: auth as never });
    expect(() =>
      enforceMutatingRouteCaps(ctx, mockReq(), 'GET', '/api/v1/projects'),
    ).not.toThrow();
    expect(auth).not.toHaveBeenCalled();
  });

  it('enforceMutatingRouteCaps skips public auth login', () => {
    const auth = vi.fn(() => {
      throw new Error('should not auth');
    });
    const ctx = mockCtx({ authenticate: auth as never });
    expect(() =>
      enforceMutatingRouteCaps(ctx, mockReq(), 'POST', '/api/v1/auth/login'),
    ).not.toThrow();
    expect(auth).not.toHaveBeenCalled();
  });

  it('enforceMutatingRouteCaps skips fleet agent heartbeat', () => {
    const auth = vi.fn(() => {
      throw new Error('should not auth');
    });
    const ctx = mockCtx({ authenticate: auth as never });
    expect(() =>
      enforceMutatingRouteCaps(
        ctx,
        mockReq(),
        'POST',
        '/api/v1/fleet/agents/agent-1/heartbeat',
      ),
    ).not.toThrow();
    expect(auth).not.toHaveBeenCalled();
  });

  it('enforceMutatingRouteCaps authenticates for gated POST projects', () => {
    const ctx = mockCtx({ caps: ['projects.write'] });
    expect(() =>
      enforceMutatingRouteCaps(ctx, mockReq('tok'), 'POST', '/api/v1/projects'),
    ).not.toThrow();
  });

  it('enforceMutatingRouteCaps 401 without token on gated path', () => {
    const ctx = mockCtx();
    expect(() =>
      enforceMutatingRouteCaps(ctx, mockReq(), 'POST', '/api/v1/projects'),
    ).toThrow(YskError);
  });

  it('enforceMutatingRouteCaps 403 when missing required cap', () => {
    const ctx = mockCtx({ caps: ['dashboard.read'] });
    expect(() =>
      enforceMutatingRouteCaps(ctx, mockReq('tok'), 'POST', '/api/v1/projects'),
    ).toThrow(YskError);
  });
});
