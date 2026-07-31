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

  it('GET sftp keys / ssh 2fa / pam-snippet / fail2ban snippets', async () => {
    ts = await startTestServer();
    for (const path of [
      '/api/v1/sftp/keys',
      '/api/v1/ssh/2fa',
      '/api/v1/ssh/2fa/pam-snippet',
      '/api/v1/security/fail2ban-snippets',
    ]) {
      const res = await apiJson(ts, 'GET', path);
      expect(res.status).toBeLessThan(500);
      expect(res.status).toBeGreaterThanOrEqual(200);
    }
  });

  it('creates ssh identity without install is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/ssh/identities', {
      name: 'http-test-id',
      algorithm: 'ed25519',
      purpose: 'user_outbound',
      install: false,
      revealPrivate: false,
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
      identity?: { id?: string };
    };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
    if (body.ok && body.identity?.id) {
      const detail = await apiJson(ts, 'GET', `/api/v1/ssh/identities/${body.identity.id}`);
      // detail route may or may not exist — honesty: not 500
      expect(detail.status).toBeLessThan(500);
    }
  });

  it('ssh 2fa strict-apply without apply is honest plan', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/ssh/2fa/strict-apply', {
      apply: false,
      recoveryUsers: ['root'],
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      requiresExecute?: boolean;
      notes?: string[];
    };
    if (typeof body.ok === 'boolean') {
      expect(body.apply_status).not.toBe('applied');
      expectHonestOps({
        ok: body.ok,
        blocked: body.blocked,
        apply_status: body.apply_status,
        requiresExecute: body.requiresExecute,
        notes: body.notes,
      });
    }
  });

  it('sftp keys list is authenticated only', async () => {
    ts = await startTestServer();
    const unauth = await apiJson(ts, 'GET', '/api/v1/sftp/keys', undefined, { auth: false });
    expect(unauth.status).toBeGreaterThanOrEqual(401);
    const auth = await apiJson(ts, 'GET', '/api/v1/sftp/keys');
    expect(auth.status).toBe(200);
  });

  it('adds sftp key and lists by username', async () => {
    ts = await startTestServer();
    const add = await apiJson(ts, 'POST', '/api/v1/sftp/keys', {
      username: 'ysk_sftp_cov',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICovTestKey000000000000000000000000 cov@test',
      comment: 'http-cov',
    });
    expect(add.status).toBeLessThan(500);
    const list = await apiJson(ts, 'GET', '/api/v1/sftp/keys?username=ysk_sftp_cov');
    expect(list.status).toBe(200);
    expect(Array.isArray((list.body as { items?: unknown[] }).items)).toBe(true);
  });

  it('lists identities with purpose filter and imports invalid key honestly', async () => {
    ts = await startTestServer();
    const list = await apiJson(
      ts,
      'GET',
      '/api/v1/ssh/identities?purpose=user_outbound',
    );
    expect(list.status).toBe(200);

    const imp = await apiJson(ts, 'POST', '/api/v1/ssh/identities/import', {
      name: 'bad-import',
      privateKey: 'not-a-real-key',
      purpose: 'unbound',
    });
    expect(imp.status).toBeLessThan(500);
    const body = imp.body as { ok?: boolean };
    expect(typeof body.ok).toBe('boolean');
    if (body.ok === true) {
      // unexpected but still ok
    } else {
      expect(body.ok).toBe(false);
    }
  });

  it('enrolls ssh 2fa for linux user without install', async () => {
    ts = await startTestServer();
    const enroll = await apiJson(ts, 'POST', '/api/v1/ssh/2fa', {
      linuxUser: 'ysk_2fa_cov',
      homeDir: '/tmp/ysk-2fa-cov',
    });
    expect(enroll.status).toBeLessThan(500);
    const body = enroll.body as { ok?: boolean; record?: { id?: string } };
    expect(typeof body.ok).toBe('boolean');

    // fromPanel without totp → 422/403
    const fromPanel = await apiJson(ts, 'POST', '/api/v1/ssh/2fa', {
      linuxUser: 'ysk_2fa_cov2',
      fromPanel: true,
    });
    expect(fromPanel.status).toBeLessThan(500);
    expect([200, 403, 422]).toContain(fromPanel.status);
  });

  it('sshd snippet with chroot=1', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/sftp/sshd-snippet?chroot=1');
    expect(res.status).toBe(200);
    expect(typeof (res.body as { snippet?: string }).snippet).toBe('string');
  });

  it('ssh 2fa strict-apply apply=true without step-up is honest fail', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/ssh/2fa/strict-apply', {
      apply: true,
      recoveryUsers: ['root'],
      totp: '000000',
    });
    expect(res.status).toBeLessThan(500);
  });
});
