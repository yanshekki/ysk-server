import { describe, expect, it } from 'vitest';
import { api } from './api';

describe('api service layer', () => {
  it('exposes health and login entry points', () => {
    expect(typeof api.health).toBe('function');
    expect(typeof api.login).toBe('function');
    expect(typeof api.me).toBe('function');
    expect(typeof api.status).toBe('function');
  });
});
