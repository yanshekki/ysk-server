import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createVncShareLink,
  getVncShareLink,
  revokeVncShareLink,
} from './share-links.js';

describe('vnc share links', () => {
  let dir: string;
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('creates and resolves share token', () => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-vnc-share-'));
    const rec = createVncShareLink({
      dataDir: dir,
      kind: 'client',
      targetId: 'c1',
      label: 'hermes',
      createdBy: 'admin',
      viewOnly: true,
      ttlMs: 60_000,
    });
    expect(rec.token.length).toBeGreaterThan(10);
    expect(getVncShareLink(dir, rec.token)?.label).toBe('hermes');
    expect(getVncShareLink(dir, rec.token)?.viewOnly).toBe(true);
  });

  it('revokes share', () => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-vnc-share-'));
    const rec = createVncShareLink({
      dataDir: dir,
      kind: 'account',
      targetId: 'a1',
      label: 'desk',
      createdBy: 'admin',
    });
    expect(revokeVncShareLink(dir, rec.token)).toBe(true);
    expect(getVncShareLink(dir, rec.token)).toBeNull();
  });
});
