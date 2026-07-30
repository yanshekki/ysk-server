import { tl } from '@ysk/shared';
/**
 * Adminer (lightweight DB browser) — managed download under dataDir + nginx plan.
 * Honest: download needs EXECUTE+network; system nginx needs root + applySystem.
 */

import { copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { writeManagedNginxConf } from './nginx-sync.js';

const ADMINER_URL =
  process.env.YSK_ADMINER_URL ??
  'https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1.php';

export async function applyAdminer(input: {
  dataDir: string;
  host: HostExecutor;
  domain?: string;
  download?: boolean;
  /** Copy managed nginx conf to /etc/nginx/conf.d + nginx -t + reload */
  applySystem?: boolean;
}): Promise<{
  ok: boolean;
  path?: string;
  nginxPath?: string;
  urlHint?: string;
  notes: string[];
  written: string[];
  requiresExecute?: boolean;
  blocked?: boolean;
  blockMessage?: string;
  apply_status: 'written' | 'applied' | 'blocked' | 'failed';
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const dir = join(input.dataDir, 'db', 'adminer');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'adminer.php');
  const domain = (input.domain ?? 'adminer.local').trim().toLowerCase();

  if (input.download !== false) {
    if (!input.host.executeEnabled()) {
      // still write placeholder
      if (!existsSync(path)) {
        writeFileSync(
          path,
          `<?php\n// YSK Adminer placeholder — enable YSK_EXECUTE and re-run download\necho "Adminer not downloaded";\n`,
          'utf8',
        );
        written.push(path);
      }
      // still write nginx plan so operator can inspect
      const confEarly = renderAdminerNginx(domain, dir);
      const nginxEarly = writeManagedNginxConf(
        input.dataDir,
        `adminer-${domain.replace(/\./g, '-')}.conf`,
        confEarly,
      );
      written.push(nginxEarly);
      return {
        ok: false,
        path,
        nginxPath: nginxEarly,
        urlHint: `http://${domain}/adminer.php`,
        notes: [
          tl('notes.auto.n1141'),
          tl('notes.auto.t0351', { v0: (path) }),
          tl('notes.auto.t0352', { v0: (nginxEarly) }),
          tl('notes.auto.n1215'),
        ],
        written,
        requiresExecute: true,
        blocked: true,
        blockMessage: tl('notes.auto.n1558'),
        apply_status: 'blocked' };
    }
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `curl -fsSL ${JSON.stringify(ADMINER_URL)} -o ${JSON.stringify(path)} 2>&1`,
      ],
      { timeoutMs: 120_000 },
    );
    if (r.exitCode !== 0 || !existsSync(path)) {
      notes.push(tl('notes.auto.t0353', { v0: ((r.stderr || r.stdout).slice(0, 200)) }));
      return {
        ok: false,
        notes,
        written,
        path,
        apply_status: 'failed' };
    }
    written.push(path);
    notes.push(tl('notes.auto.t0354', { v0: (path) }));
  } else if (!existsSync(path)) {
    return {
      ok: false,
      notes: [tl('notes.auto.n0074')],
      written,
      apply_status: 'failed' };
  } else {
    notes.push(tl('notes.auto.t0355', { v0: (path) }));
  }

  const conf = renderAdminerNginx(domain, dir);
  const nginxPath = writeManagedNginxConf(
    input.dataDir,
    `adminer-${domain.replace(/\./g, '-')}.conf`,
    conf,
  );
  written.push(nginxPath);
  notes.push(tl('notes.auto.t0356', { v0: (nginxPath) }));
  notes.push(tl('notes.auto.n1429'));

  if (!input.applySystem) {
    notes.push(tl('notes.auto.n1230'));
    return {
      ok: true,
      path,
      nginxPath,
      urlHint: `http://${domain}/adminer.php`,
      notes,
      written,
      apply_status: 'written' };
  }

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    notes.push(tl('notes.auto.n0005'));
    return {
      ok: false,
      path,
      nginxPath,
      urlHint: `http://${domain}/adminer.php`,
      notes,
      written,
      blocked: true,
      requiresExecute: true,
      blockMessage: tl('notes.auto.n1587'),
      apply_status: 'blocked' };
  }

  const sysDir = '/etc/nginx/conf.d';
  const dest = join(sysDir, `ysk-${basename(nginxPath)}`);
  try {
    mkdirSync(sysDir, { recursive: true });
    copyFileSync(nginxPath, dest);
    written.push(dest);
    notes.push(tl('notes.auto.t0357', { v0: (dest) }));
  } catch (e) {
    notes.push(tl('notes.tpl.copyFailed2', { detail: e instanceof Error ? e.message : String(e) }));
    return {
      ok: false,
      path,
      nginxPath,
      notes,
      written,
      apply_status: 'failed' };
  }

  const test = await input.host.runCommand(['nginx', '-t'], { timeoutMs: 15_000 });
  if (test.exitCode !== 0) {
    notes.push(tl('notes.tpl.nginxTestFailed', { detail: (test.stderr || test.stdout).slice(0, 200) }));
    return {
      ok: false,
      path,
      nginxPath,
      notes,
      written,
      apply_status: 'failed' };
  }
  notes.push('nginx -t ok');
  const reload = await input.host.runCommand(['systemctl', 'reload', 'nginx'], {
    timeoutMs: 15_000 });
  if (reload.exitCode !== 0) {
    notes.push(tl('notes.tpl.reloadFailed2', { detail: (reload.stderr || reload.stdout).slice(0, 160) }));
    return {
      ok: false,
      path,
      nginxPath,
      urlHint: `http://${domain}/adminer.php`,
      notes,
      written,
      apply_status: 'failed' };
  }
  notes.push(tl('notes.auto.n0340'));
  return {
    ok: true,
    path,
    nginxPath,
    urlHint: `http://${domain}/adminer.php`,
    notes,
    written,
    apply_status: 'applied' };
}

function renderAdminerNginx(domain: string, rootDir: string): string {
  return `server {
  listen 80;
  listen [::]:80;
  server_name ${domain};
  root ${rootDir};
  index adminer.php;
  location / {
    try_files $uri $uri/ /adminer.php?$query_string;
  }
  location ~ \\.php$ {
    include snippets/fastcgi-php.conf;
    fastcgi_pass unix:/run/php/php8.2-fpm.sock;
  }
}
`;
}
