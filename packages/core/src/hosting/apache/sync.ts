/**
 * Sync managed Apache conf to system and configtest + reload.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { tl } from '@ysk-server/shared';

export async function syncApacheConfigs(opts: {
  dataDir: string;
  host: HostExecutor;
  dryRun?: boolean;
  /**
   * When set, only these basenames under apache/sites are pushed to the system.
   * Orphan / artifact confs must not be enabled (ServerName clash risk).
   * When omitted, all `*.conf` are synced (legacy); prefer passing owned set.
   */
  onlyBasenames?: Iterable<string>;
}): Promise<{
  ok: boolean;
  notes: string[];
  copied: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  tested?: boolean;
  skippedOrphans?: number;
}> {
  const sourceDir = join(opts.dataDir, 'apache', 'sites');
  const confd = join(opts.dataDir, 'apache', 'conf.d');
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(confd, { recursive: true });
  const notes = [tl('notes.apache.managedDir', { path: sourceDir })];
  const allFiles = existsSync(sourceDir)
    ? readdirSync(sourceDir).filter((f) => f.endsWith('.conf'))
    : [];
  const allow =
    opts.onlyBasenames != null ? new Set(opts.onlyBasenames) : null;
  const files = allow
    ? allFiles.filter((f) => allow.has(f))
    : allFiles;
  const skippedOrphans = allow ? allFiles.length - files.length : 0;
  if (skippedOrphans > 0) {
    notes.push(tl('notes.apache.skippedOrphans', { count: skippedOrphans }));
  }
  const globals = existsSync(confd)
    ? readdirSync(confd).filter((f) => f.endsWith('.conf'))
    : [];

  if (opts.dryRun || !opts.host.executeEnabled()) {
    return {
      ok: !opts.host.executeEnabled() ? false : true,
      notes: [
        ...notes,
        opts.host.executeEnabled()
          ? tl('notes.apache.dryRun')
          : tl('notes.apache.needExecute'),
      ],
      copied: [],
      blocked: !opts.host.executeEnabled(),
      requiresExecute: !opts.host.executeEnabled(),
      skippedOrphans,
    };
  }

  // Detect Debian apache2 vs RHEL httpd
  const isDebian = await binOk(opts.host, 'apache2ctl');
  const targetSites = isDebian
    ? '/etc/apache2/sites-available'
    : '/etc/httpd/conf.d';
  const targetConf = isDebian ? '/etc/apache2/conf-available' : '/etc/httpd/conf.d';
  const copied: string[] = [];

  try {
    mkdirSync(targetSites, { recursive: true });
  } catch {
    /* may need root via host later */
  }

  for (const f of files) {
    const src = join(sourceDir, f);
    const dest = join(targetSites, `ysk-${f}`);
    try {
      // copy via host when possible
      const b64 = Buffer.from(
        (await import('node:fs')).readFileSync(src),
      ).toString('base64');
      const r = await opts.host.runCommand(
        [
          'bash',
          '-c',
          `mkdir -p ${shell(targetSites)} && echo ${shell(b64)} | base64 -d > ${shell(dest)}`,
        ],
        { timeoutMs: 15_000 },
      );
      if (r.exitCode === 0) {
        copied.push(dest);
        if (isDebian) {
          await opts.host.runCommand(
            ['bash', '-c', `a2ensite ysk-${f.replace(/\.conf$/, '')} 2>/dev/null || true`],
            { timeoutMs: 10_000 },
          );
        }
      }
    } catch {
      try {
        copyFileSync(src, dest);
        copied.push(dest);
      } catch {
        notes.push(tl('notes.apache.copyFailed', { file: f }));
      }
    }
  }

  for (const f of globals) {
    const src = join(confd, f);
    const dest = join(targetConf, `ysk-${f}`);
    try {
      const content = (await import('node:fs')).readFileSync(src, 'utf8');
      const b64 = Buffer.from(content, 'utf8').toString('base64');
      const r = await opts.host.runCommand(
        [
          'bash',
          '-c',
          `mkdir -p ${shell(targetConf)} && echo ${shell(b64)} | base64 -d > ${shell(dest)}`,
        ],
        { timeoutMs: 15_000 },
      );
      if (r.exitCode === 0) {
        copied.push(dest);
        if (isDebian) {
          await opts.host.runCommand(
            ['bash', '-c', `a2enconf ysk-${f.replace(/\.conf$/, '')} 2>/dev/null || true`],
            { timeoutMs: 10_000 },
          );
        }
      }
    } catch {
      notes.push(tl('notes.apache.copyFailed', { file: f }));
    }
  }

  const testCmd = isDebian
    ? (['apache2ctl', 'configtest'] as string[])
    : (['httpd', '-t'] as string[]);
  const test = await opts.host.runCommand(testCmd, { timeoutMs: 15_000 });
  const tested = test.exitCode === 0;
  notes.push(
    tested
      ? tl('notes.apache.configOk')
      : tl('notes.apache.configFailed', {
          detail: (test.stderr || test.stdout || '').slice(0, 160),
        }),
  );
  if (!tested) {
    return { ok: false, notes, copied, tested: false, skippedOrphans };
  }

  const unit = isDebian ? 'apache2' : 'httpd';
  const rel = await opts.host.runCommand(['systemctl', 'reload', unit], {
    timeoutMs: 30_000,
  });
  if (rel.exitCode === 0) notes.push(tl('notes.apache.reloaded'));
  else notes.push(tl('notes.apache.reloadFailed'));

  return {
    ok: rel.exitCode === 0,
    notes,
    copied,
    tested: true,
    skippedOrphans,
  };
}

async function binOk(host: HostExecutor, bin: string): Promise<boolean> {
  try {
    const r = await host.runCommand(
      ['bash', '-c', `command -v ${bin} >/dev/null 2>&1 && echo ok || true`],
      { timeoutMs: 5_000 },
    );
    return r.stdout.includes('ok');
  } catch {
    return existsSync(`/usr/sbin/${bin}`) || existsSync(`/usr/bin/${bin}`);
  }
}

function shell(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// silence unused
void writeFileSync;
