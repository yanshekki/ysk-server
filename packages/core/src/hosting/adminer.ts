/**
 * Adminer (lightweight DB browser) — managed download under dataDir + nginx plan.
 * Honest: download needs EXECUTE+network; system nginx needs root.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
      return {
        ok: false,
        path,
        notes: ['無法下載 Adminer：未開啟系統變更權限', `管理路徑 ${path}`],
        written,
        requiresExecute: true,
        blocked: true,
        blockMessage: '需要 YSK_EXECUTE 下載 Adminer',
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
      return { ok: false, notes, written, path };
    }
    written.push(path);
    notes.push(`已下載 Adminer → ${path}`);
  } else if (!existsSync(path)) {
    return { ok: false, notes: ['Adminer 檔案不存在；請 download:true'], written };
  } else {
    notes.push(`已有 ${path}`);
  }

  const conf = `server {
  listen 80;
  server_name ${domain};
  root ${dir};
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
  const nginxPath = writeManagedNginxConf(input.dataDir, `adminer-${domain.replace(/\./g, '-')}.conf`, conf);
  written.push(nginxPath);
  notes.push(`nginx 管理 conf: ${nginxPath}`);
  notes.push('written ≠ 已上線 — 需 PHP-FPM + 發布 nginx + DNS');
  notes.push('請限制來源 IP 或 HTTP auth 後再公開');

  return {
    ok: true,
    path,
    nginxPath,
    urlHint: `http://${domain}/adminer.php`,
    notes,
    written,
  };
}
