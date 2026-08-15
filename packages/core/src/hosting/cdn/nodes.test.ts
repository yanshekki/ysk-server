import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { JsonStore } from '../../db/store.js';
import {
  listCdnNodes,
  upsertCdnNode,
  deleteCdnNode,
  probeCdnNode,
  setCdnNodeDrain,
  probeAllCdnNodes,
  resolveCdnSshTarget,
} from './nodes.js';

describe('cdn nodes (PR-C1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CRUD nodes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      expect(listCdnNodes(db)).toHaveLength(0);
      const n = upsertCdnNode(db, {
        name: 'edge-hkg-1',
        region: 'hkg',
        roles: ['edge'],
        publicIpv4: ['203.0.113.10'],
        weight: 100,
      });
      expect(n.id).toBeTruthy();
      expect(listCdnNodes(db)).toHaveLength(1);
      const n2 = upsertCdnNode(db, {
        id: n.id,
        name: 'edge-hkg-1',
        region: 'hkg',
        roles: ['edge', 'dns'],
        publicIpv4: ['203.0.113.10'],
        weight: 50,
      });
      expect(n2.roles).toContain('dns');
      expect(n2.weight).toBe(50);
      expect(deleteCdnNode(db, n.id)).toBe(true);
      expect(listCdnNodes(db)).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects empty contact surface', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      expect(() =>
        upsertCdnNode(db, { name: 'x', roles: ['edge'] }),
      ).toThrow(/至少提供/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probes HTTP healthUrl and drain keeps status', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no addr');
    const port = addr.port;
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cdn-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const n = upsertCdnNode(db, {
        name: 'local-edge',
        roles: ['edge'],
        publicIpv4: ['127.0.0.1'],
        healthUrl: `http://127.0.0.1:${port}/health`,
      });
      const r = await probeCdnNode(db, n.id);
      expect(r.ok).toBe(true);
      expect(r.method).toBe('http');
      expect(r.node.status).toBe('online');

      setCdnNodeDrain(db, n.id, true);
      const r2 = await probeCdnNode(db, n.id);
      expect(r2.ok).toBe(true);
      expect(r2.node.status).toBe('draining');
      expect(r2.notes.some((x) => /draining/i.test(x))).toBe(true);

      setCdnNodeDrain(db, n.id, false);
      const undrained = listCdnNodes(db)[0];
      expect(undrained.status).not.toBe('draining');

      const all = await probeAllCdnNodes(db);
      expect(all.items.length).toBe(1);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not treat default root + panel URL as SSH', () => {
    expect(
      resolveCdnSshTarget({
        id: 'e1',
        name: 'hermes',
        roles: ['edge'],
        publicIpv4: ['203.0.113.8'],
        publicIpv6: [],
        baseUrl: 'http://203.0.113.8:9287',
        sshUsername: 'root',
        status: 'online',
        weight: 100,
        region: 'default',
      } as never),
    ).toBeNull();
    expect(
      resolveCdnSshTarget({
        id: 'e2',
        name: 'ssh-only',
        roles: ['edge'],
        publicIpv4: ['203.0.113.9'],
        publicIpv6: [],
        sshUsername: 'root',
        status: 'online',
        weight: 100,
        region: 'default',
      } as never)?.host,
    ).toBe('203.0.113.9');
    expect(
      resolveCdnSshTarget({
        id: 'e3',
        name: 'explicit',
        roles: ['edge'],
        publicIpv4: ['203.0.113.10'],
        publicIpv6: [],
        baseUrl: 'http://203.0.113.10:9287',
        sshHost: '203.0.113.10',
        sshUsername: 'root',
        status: 'online',
        weight: 100,
        region: 'default',
      } as never),
    ).toBeNull();
  });
});
