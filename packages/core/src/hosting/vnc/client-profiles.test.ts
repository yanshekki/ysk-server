import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createClientProfile,
  listClientProfilesPublic,
  updateClientProfile,
  deleteClientProfile,
} from './client-profiles.js';
import { LocalHostExecutor } from '../../host/executor.js';

describe('vnc client profiles', () => {
  it('CRUD without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vnc-c-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const p = createClientProfile(dir, {
      name: 'office',
      host: '10.0.0.9',
      port: 5901,
      path: 'via_server', // legacy → server_proxy
    });
    expect(p.name).toBe('office');
    expect(p.path).toBe('server_proxy');
    expect(listClientProfilesPublic(dir)).toHaveLength(1);
    updateClientProfile(dir, p.id, { path: 'direct' }); // legacy → user_reachable
    expect(listClientProfilesPublic(dir)[0]!.path).toBe('user_reachable');

    const lan = createClientProfile(dir, {
      name: 'lan',
      host: 'vnc.internal.example',
      port: 5901,
      path: 'server_proxy',
      connectHost: '10.0.0.9',
    });
    expect(lan.connectHost).toBe('10.0.0.9');
    updateClientProfile(dir, lan.id, { path: 'user_reachable' });
    expect(listClientProfilesPublic(dir).find((x) => x.id === lan.id)?.connectHost).toBeNull();

    const del = await deleteClientProfile({ host, dataDir: dir, id: p.id });
    expect(del.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('resolveClientRfbHost', () => {
  it('rejects IMDS / metadata as RFB target', async () => {
    const { assertSafeVncRfbHost, isBlockedVncRfbHost } = await import('./types.js');
    expect(isBlockedVncRfbHost('169.254.169.254')).toBe(true);
    expect(isBlockedVncRfbHost('metadata.google.internal')).toBe(true);
    expect(isBlockedVncRfbHost('100.100.100.200')).toBe(true);
    expect(isBlockedVncRfbHost('fd00:ec2::254')).toBe(true);
    expect(isBlockedVncRfbHost('127.0.0.1')).toBe(false);
    expect(isBlockedVncRfbHost('10.0.0.9')).toBe(false);
    expect(() => assertSafeVncRfbHost('169.254.169.254')).toThrow();
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vnc-imds-'));
    try {
      expect(() =>
        createClientProfile(dir, {
          name: 'imds',
          host: '169.254.169.254',
          port: 5901,
        }),
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses connectHost only for server_proxy', async () => {
    const { resolveClientRfbHost } = await import('./types.js');
    expect(
      resolveClientRfbHost({
        host: 'public.example',
        path: 'server_proxy',
        connectHost: '10.1.2.3',
      }),
    ).toBe('10.1.2.3');
    expect(
      resolveClientRfbHost({
        host: 'public.example',
        path: 'user_reachable',
        connectHost: '10.1.2.3',
      }),
    ).toBe('public.example');
  });
});
