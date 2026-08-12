import { describe, expect, it } from 'vitest';
import { createDefaultAllowlist } from './allowlist.js';
import { ErrorCodes, YskError } from '@yanshekki/shared';

describe('Allowlist', () => {
  const allowlist = createDefaultAllowlist();

  it('allows default read-only tools', () => {
    const r = allowlist.evaluate('fs.read');
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(false);
    expect(r.risk).toBe('low');
  });

  it('denies non-listed tools by default (fail closed)', () => {
    const r = allowlist.evaluate('rm.rf.root');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/不在允許清單|not on allowlist/i);
  });

  it('denies explicitly blocked destructive tools like shell.exec', () => {
    const r = allowlist.evaluate('shell.exec');
    expect(r.allowed).toBe(false);
    expect(r.risk).toBe('critical');
  });

  it('requires approval for high-risk listed tools', () => {
    const r = allowlist.evaluate('service.restart');
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
    expect(r.risk).toBe('high');
  });

  it('assertAllowed throws ALLOWLIST_DENIED for unknown tools', () => {
    try {
      allowlist.assertAllowed('user.delete');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(YskError);
      expect((e as YskError).code).toBe(ErrorCodes.ALLOWLIST_DENIED);
    }
  });

  it('lists tools for schema discovery', () => {
    const tools = allowlist.list();
    expect(tools.some((t) => t.tool === 'fs.read')).toBe(true);
    expect(tools.find((t) => t.tool === 'fs.write')?.argsSchema).toMatchObject({
      path: 'string',
    });
  });
});
