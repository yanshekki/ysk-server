import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.js';
import { evaluateProtection, EMERGENCY_PLAYBOOKS } from './protection.js';

describe('auth + protection', () => {
  it('logs in and authenticates tokens', () => {
    const auth = new AuthService();
    auth.ensureAdmin('admin', 'secret', 'zh-TW');
    const login = auth.login({ username: 'admin', password: 'secret' });
    expect(login.token).toBeTruthy();
    expect(login.user.roles).toContain('admin');
    expect(auth.authenticate(login.token).username).toBe('admin');
    expect(() => auth.login({ username: 'admin', password: 'wrong' })).toThrow();
  });

  it('evaluates offline and ddos protection modes', () => {
    expect(evaluateProtection({ networkReachable: false }).mode).toBe('offline');
    expect(evaluateProtection({ networkReachable: true, ddosSuspected: true }).mode).toBe(
      'ddos-protection',
    );
    expect(evaluateProtection({ networkReachable: true }).mode).toBe('normal');
    expect(EMERGENCY_PLAYBOOKS).toContain('local-llm-ops-only');
  });
});
