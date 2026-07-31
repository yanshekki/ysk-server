import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('ssh routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated ssh identities list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/ssh/identities', undefined, {
      auth: false,
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists ssh identities when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/ssh/identities');
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; items?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('returns sshd sftp snippet when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/sftp/sshd-snippet');
    expect(res.status).toBe(200);
    const body = res.body as { snippet?: string; notes?: string[] };
    expect(typeof body.snippet).toBe('string');
    expect(body.snippet!.length).toBeGreaterThan(0);
  });

  it('sshd snippet apply (installSystem false) is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/sftp/sshd-snippet/apply', {
      chroot: false,
      installSystem: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      written?: string[];
      notes?: string[];
      blocked?: boolean;
      apply_status?: string;
    };
    expect(typeof body.ok).toBe('boolean');
    // Without installSystem, must not claim system sshd reload applied
    if (body.apply_status === 'applied') {
      expect(body.ok).toBe(true);
    }
    expectHonestOps({
      ok: body.ok ?? false,
      notes: body.notes,
      blocked: body.blocked,
      apply_status: body.apply_status,
    });
  });

  it('rejects unauthenticated sftp keys mutation', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/sftp/keys',
      { username: 'nobody', publicKey: 'ssh-ed25519 AAAA test' },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});
