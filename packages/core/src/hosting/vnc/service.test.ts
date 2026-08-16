import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../../host/executor.js';
import { VncService } from './service.js';

describe('VncService accounts (no execute)', () => {
  it('creates account meta without root and lists it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vnc-'));
    const host = new LocalHostExecutor({
      allowedWriteRoots: [dir],
      executeEnabled: false,
    });
    const svc = new VncService(dir, host);
    const created = await svc.createAccount({
      name: 'Alice Desk',
      password: 'secret99',
      desktop: 'terminal',
    });
    expect(created.ok).toBe(false);
    expect(created.blocked).toBe(true);
    expect(created.account?.linuxUser).toMatch(/^yskvnc_/);
    expect(created.account?.display).toBe(1);
    expect(created.account?.rfbPort).toBe(5901);
    expect(created.account?.hasPassword).toBe(true);

    const list = await svc.listAccounts();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('written');

    const patched = await svc.updateAccount(list[0].id, {
      geometry: '1280x720',
      rfbBind: 'all',
    });
    expect(patched.ok).toBe(true);
    expect(patched.account?.geometry).toBe('1280x720');

    const st = await svc.status();
    expect(st.accountCount).toBe(1);
    expect(st.accounts).toHaveLength(1);

    const del = await svc.deleteAccount(list[0].id, { removeLinuxUser: false });
    expect(del.ok).toBe(true);
    expect(await svc.listAccounts()).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects duplicate name/user', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-vnc2-'));
    const host = new LocalHostExecutor({
      allowedWriteRoots: [dir],
      executeEnabled: false,
    });
    const svc = new VncService(dir, host);
    await svc.createAccount({ name: 'bob' });
    await expect(svc.createAccount({ name: 'bob' })).rejects.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
