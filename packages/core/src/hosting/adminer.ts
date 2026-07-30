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
          '無法下載 Adminer：未開啟系統變更權限',
          `管理路徑 ${path}`,
          `nginx 管理 conf: ${nginxEarly}`,
          '狀態：blocked（placeholder written）',
        ],
        written,
        requiresExecute: true,
        blocked: true,
        blockMessage: '需要 YSK_EXECUTE 下載 Adminer',
        apply_status: 'blocked',
      };
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
      notes.push(`下載失敗: ${(r.stderr || r.stdout).slice(0, 200)}`);
      return {
        ok: false,
        notes,
        written,
        path,
        apply_status: 'failed',
      };
    }
    written.push(path);
    notes.push(`已下載 Adminer → ${path}`);
  } else if (!existsSync(path)) {
    return {
      ok: false,
      notes: ['Adminer 檔案不存在；請 download:true'],
      written,
      apply_status: 'failed',
    };
  } else {
    notes.push(`已有 ${path}`);
  }

  const conf = renderAdminerNginx(domain, dir);
  const nginxPath = writeManagedNginxConf(
    input.dataDir,
    `adminer-${domain.replace(/\./g, '-')}.conf`,
    conf,
  );
  written.push(nginxPath);
  notes.push(`nginx 管理 conf: ${nginxPath}`);
  notes.push('請限制來源 IP 或 HTTP auth 後再公開');

  if (!input.applySystem) {
    notes.push('狀態：written（未複製到系統 Nginx；設 applySystem 才會 try reload）');
    return {
      ok: true,
      path,
      nginxPath,
      urlHint: `http://${domain}/adminer.php`,
      notes,
      written,
      apply_status: 'written',
    };
  }

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    notes.push('無法套用系統：需 YSK_EXECUTE + root');
    return {
      ok: false,
      path,
      nginxPath,
      urlHint: `http://${domain}/adminer.php`,
      notes,
      written,
      blocked: true,
      requiresExecute: true,
      blockMessage: '需要系統變更權限才能複製 nginx conf 並 reload',
      apply_status: 'blocked',
    };
  }

  const sysDir = '/etc/nginx/conf.d';
  const dest = join(sysDir, `ysk-${basename(nginxPath)}`);
  try {
    mkdirSync(sysDir, { recursive: true });
    copyFileSync(nginxPath, dest);
    written.push(dest);
    notes.push(`已複製 → ${dest}`);
  } catch (e) {
    notes.push(`複製失敗: ${e instanceof Error ? e.message : String(e)}`);
    return {
      ok: false,
      path,
      nginxPath,
      notes,
      written,
      apply_status: 'failed',
    };
  }

  const test = await input.host.runCommand(['nginx', '-t'], { timeoutMs: 15_000 });
  if (test.exitCode !== 0) {
    notes.push(`nginx -t 失敗: ${(test.stderr || test.stdout).slice(0, 200)}`);
    return {
      ok: false,
      path,
      nginxPath,
      notes,
      written,
      apply_status: 'failed',
    };
  }
  notes.push('nginx -t ok');
  const reload = await input.host.runCommand(['systemctl', 'reload', 'nginx'], {
    timeoutMs: 15_000,
  });
  if (reload.exitCode !== 0) {
    notes.push(`reload 失敗: ${(reload.stderr || reload.stdout).slice(0, 160)}`);
    return {
      ok: false,
      path,
      nginxPath,
      urlHint: `http://${domain}/adminer.php`,
      notes,
      written,
      apply_status: 'failed',
    };
  }
  notes.push('nginx reload ok · 狀態：applied');
  return {
    ok: true,
    path,
    nginxPath,
    urlHint: `http://${domain}/adminer.php`,
    notes,
    written,
    apply_status: 'applied',
  };
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
