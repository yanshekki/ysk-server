/**
 * Public File Server — Spec §4.5: sandboxed public root + nginx site.
 * Always writes managed conf; system install needs root + YSK_EXECUTE.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, tl} from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import { planPublicFileServer } from './extras.js';
import { writeManagedNginxConf, syncNginxConfigs } from './nginx-sync.js';
import { publicFilesRoot } from '../files/manager.js';

export interface PublicFilesApplyResult {
  ok: boolean;
  serverName: string;
  publicRoot: string;
  nginxPath: string;
  written: string[];
  notes: string[];
  nginxReloaded: boolean;
  requiresExecute: boolean;
  requiresRoot: boolean;
}

/**
 * Ensure public root exists, write nginx static server + optional system reload.
 */
export async function applyPublicFileServer(input: {
  dataDir: string;
  host: HostExecutor;
  /** Server name e.g. files.example.com */
  serverName: string;
  quotaMb?: number;
  reload?: boolean;
}): Promise<PublicFilesApplyResult> {
  const serverName = input.serverName.trim().toLowerCase();
  if (!serverName || serverName.includes('..')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1387'), { httpStatus: 400 });
  }
  const plan = planPublicFileServer({
    root: publicFilesRoot(input.dataDir),
    quotaMb: input.quotaMb });
  const publicRoot = plan.publicRoot;
  mkdirSync(publicRoot, { recursive: true });
  const index = join(publicRoot, 'index.html');
  if (!existsSync(index)) {
    writeFileSync(
      index,
      `<!doctype html><html><head><meta charset="utf-8"><title>YSK Files</title></head>
<body><h1>YSK Public File Server</h1><p>Upload via Web Files UI (sandbox).</p></body></html>\n`,
      'utf8',
    );
  }
  const readme = join(publicRoot, 'README.txt');
  writeFileSync(
    readme,
    [
      'YSK managed public file root',
      `Path: ${publicRoot}`,
      `API: ${plan.apiPrefix}?root=public`,
      `Quota soft target: ${plan.quotaMb} MiB`,
      '',
    ].join('\n'),
    'utf8',
  );

  const conf = `server {
  listen 80;
  listen [::]:80;
  server_name ${serverName};
  root ${publicRoot};
  index index.html;

  # Cloudflare-friendly
  real_ip_header CF-Connecting-IP;

  location / {
    autoindex on;
    autoindex_exact_size off;
    autoindex_localtime on;
    try_files $uri $uri/ =404;
  }

  location ~ /\\. {
    deny all;
  }
}
`;
  const nginxPath = writeManagedNginxConf(
    input.dataDir,
    `public-files-${serverName.replace(/\./g, '-')}.conf`,
    conf,
  );
  const notes = [
    `Public root: ${publicRoot}`,
    `Nginx conf: ${nginxPath}`,
    `API prefix: ${plan.apiPrefix}`,
  ];
  const written = [publicRoot, index, readme, nginxPath];
  let nginxReloaded = false;

  const wantReload =
    input.reload === true ||
    (input.reload !== false && input.host.executeEnabled() && input.host.isRoot());
  if (wantReload && input.host.executeEnabled() && input.host.isRoot()) {
    const sync = await syncNginxConfigs({
      dataDir: input.dataDir,
      systemConfDir: '/etc/nginx/conf.d',
      host: input.host,
      dryRun: false });
    written.push(...sync.copied);
    notes.push(...sync.notes);
    if (sync.tested) {
      const rel = await input.host.runCommand(['systemctl', 'reload', 'nginx'], {
        timeoutMs: 15_000 });
      nginxReloaded = rel.exitCode === 0;
      notes.push(nginxReloaded ? tl('notes.nginx.reloaded') : tl('notes.nginx.reloadExit', { code: rel.exitCode }));
    }
  } else if (wantReload) {
    notes.push(tl('ops.blocked.nginxReload'));
  }

  return {
    ok: true,
    serverName,
    publicRoot,
    nginxPath,
    written,
    notes,
    nginxReloaded,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot() };
}
