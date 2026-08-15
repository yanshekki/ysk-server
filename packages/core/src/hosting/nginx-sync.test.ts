import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listManagedNginxConfs,
  pruneStalePublicFilesNginxConfs,
  pruneStaleYskSystemNginxConfs,
  renderYskDefaultNginxConf,
  stripListenDefaultServer,
  syncNginxConfigs,
  writeManagedNginxConf,
} from './nginx-sync.js';
import { LocalHostExecutor } from '../host/executor.js';

describe('nginx managed conf', () => {
  it('writes conf under dataDir and dry-run sync lists files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-'));
    mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
    writeManagedNginxConf(dir, 'demo.conf', 'server { server_name demo.test; }\n');
    const files = listManagedNginxConfs(dir);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('demo.conf');

    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const result = await syncNginxConfigs({
      dataDir: dir,
      systemConfDir: join(dir, 'system-nginx'),
      host,
      dryRun: true,
    });
    expect(result.files).toContain('demo.conf');
    expect(result.copied).toHaveLength(0);
    expect(existsSync(join(dir, 'nginx', 'ysk-managed.conf'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('prunes managed ysks_* confs not in keepLinuxUsers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-orphan-'));
    mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
    writeManagedNginxConf(dir, 'ysks_dead.conf', 'server { server_name php.example; }\n');
    writeManagedNginxConf(dir, 'ysks_live.conf', 'server { server_name live.example; }\n');
    writeManagedNginxConf(dir, 'files.conf', 'server { server_name files.example; }\n');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    await syncNginxConfigs({
      dataDir: dir,
      host,
      keepLinuxUsers: ['ysks_live'],
    });
    const names = listManagedNginxConfs(dir).map((f) => f.name);
    expect(names).toContain('ysks_live.conf');
    expect(names).toContain('files.conf');
    expect(names).not.toContain('ysks_dead.conf');
    expect(names).toContain('000-default.conf');
    rmSync(dir, { recursive: true, force: true });
  });

  it('strips default_server from listen lines but catch-all keeps it', () => {
    const stripped = stripListenDefaultServer(
      '  listen 443 ssl default_server;\n  listen 80 default_server reuseport;\n',
    );
    expect(stripped).toContain('listen 443 ssl;');
    expect(stripped).toContain('listen 80 reuseport;');
    expect(stripped).not.toMatch(/\bdefault_server\b/);
    expect(renderYskDefaultNginxConf()).toContain('ssl_reject_handshake on');
    expect(renderYskDefaultNginxConf()).toMatch(/listen 80 default_server/);
  });

  it('prunes leftover ysk-public-files and system copies not in managed set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-pf-'));
    const managed = join(dir, 'nginx', 'conf.d');
    const system = join(dir, 'system-nginx');
    mkdirSync(managed, { recursive: true });
    mkdirSync(system, { recursive: true });
    writeManagedNginxConf(
      dir,
      'public-files-files-example-com.conf',
      'server { server_name files.example.com; }\n',
    );
    writeManagedNginxConf(
      dir,
      'public-files-qa35web-example-com.conf',
      'server { server_name qa35web.example.com; }\n',
    );
    writeFileSync(
      join(system, 'ysk-public-files-qa35web-example-com.conf'),
      'server { server_name qa35web.example.com; }\n',
    );
    writeFileSync(join(system, 'custom.conf'), 'server { server_name keep.me; }\n');

    const removedPf = pruneStalePublicFilesNginxConfs(
      managed,
      'public-files-files-example-com.conf',
    );
    expect(removedPf.some((p) => p.endsWith('public-files-qa35web-example-com.conf'))).toBe(true);

    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    await syncNginxConfigs({
      dataDir: dir,
      systemConfDir: system,
      host,
      keepPublicFilesConf: 'public-files-files-example-com.conf',
    });
    const sys = readdirSync(system);
    expect(sys).toContain('ysk-000-default.conf');
    expect(sys).toContain('ysk-public-files-files-example-com.conf');
    expect(sys).not.toContain('ysk-public-files-qa35web-example-com.conf');
    expect(sys).toContain('custom.conf');
    rmSync(dir, { recursive: true, force: true });
  });

  it('pruneStaleYskSystemNginxConfs drops only ysk- leftovers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-ngx-sys-'));
    writeFileSync(join(dir, 'ysk-gone.conf'), 'x');
    writeFileSync(join(dir, 'ysk-keep.conf'), 'x');
    writeFileSync(join(dir, 'other.conf'), 'x');
    const gone = pruneStaleYskSystemNginxConfs(dir, ['keep.conf']);
    expect(gone.some((p) => p.endsWith('ysk-gone.conf'))).toBe(true);
    expect(existsSync(join(dir, 'ysk-keep.conf'))).toBe(true);
    expect(existsSync(join(dir, 'other.conf'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
