/**
 * Public File Server — Spec §4.5: sandboxed public root + nginx site.
 * Always writes managed conf; system install needs root + YSK_EXECUTE.
 */

import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { ErrorCodes, YskError, tl } from 'ysk-server-shared';
import type { HostExecutor } from '../host/executor.js';
import { planPublicFileServer } from './extras.js';
import { writeManagedNginxConf, syncNginxConfigs } from './nginx-sync.js';
import { publicFilesRoot } from '../files/manager.js';

export interface PublicFilesApplyResult {
  ok: boolean;
  serverName: string;
  publicRoot: string;
  nginxPath: string;
  systemConfPath?: string;
  written: string[];
  notes: string[];
  nginxReloaded: boolean;
  nginxTested: boolean;
  requiresExecute: boolean;
  requiresRoot: boolean;
  /** Soft 404 risk: conf not live under /etc/nginx */
  live: boolean;
}

export interface PublicFilesStatus {
  publicRoot: string;
  publicRootExists: boolean;
  indexExists: boolean;
  fileCount: number;
  serverName?: string;
  managedConf?: string;
  managedConfExists: boolean;
  systemConf?: string;
  systemConfExists: boolean;
  executeEnabled: boolean;
  isRoot: boolean;
  notes: string[];
  /** Likely to serve HTTP for server_name when conf is in conf.d + nginx running */
  likelyLive: boolean;
}

function confFileName(serverName: string): string {
  return `public-files-${serverName.replace(/\./g, '-')}.conf`;
}

function ensureNginxReadable(publicRoot: string, dataDir: string, notes: string[]): void {
  // Nginx (www-data) must traverse parents and read files — 750 on dataDir breaks public files.
  try {
    let cur = publicRoot;
    const stop = dirname(dataDir);
    while (cur && cur !== stop && cur !== '/' && cur.startsWith(dataDir)) {
      try {
        chmodSync(cur, 0o755);
      } catch {
        /* */
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    // dataDir itself: keep group-friendly but allow traverse for others (o+x)
    try {
      const st = statSync(dataDir);
      const mode = st.mode & 0o777;
      // ensure at least 751 so others can traverse into files/public
      chmodSync(dataDir, mode | 0o001 | 0o011);
    } catch {
      /* */
    }
    notes.push(tl('publicFiles.notes.permsFixed', {
      defaultValue: `permissions adjusted for nginx read under ${publicRoot}`,
    }));
  } catch (e) {
    notes.push(
      `chmod for nginx readability failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function buildPublicFilesNginxConf(input: {
  serverName: string;
  publicRoot: string;
  sslCert?: string;
  sslKey?: string;
}): string {
  const { serverName, publicRoot, sslCert, sslKey } = input;
  const hasSsl = Boolean(sslCert && sslKey && existsSync(sslCert) && existsSync(sslKey));

  const common = `
  root ${publicRoot};
  index index.html index.htm;

  charset utf-8;
  autoindex on;
  autoindex_exact_size off;
  autoindex_localtime on;

  # Cloudflare-friendly (ranges applied system-wide when Real IP is enabled)
  real_ip_header CF-Connecting-IP;

  location / {
    try_files $uri $uri/ =404;
  }

  location ~ /\\. {
    deny all;
  }
`;

  if (!hasSsl) {
    return `# YSK public files — ${serverName}
# root must be readable by nginx worker (www-data)
server {
  listen 80;
  listen [::]:80;
  server_name ${serverName};
${common}}
`;
  }

  return `# YSK public files — ${serverName} (HTTP + HTTPS)
server {
  listen 80;
  listen [::]:80;
  server_name ${serverName};
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name ${serverName};
  ssl_certificate ${sslCert};
  ssl_certificate_key ${sslKey};
${common}}
`;
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
    quotaMb: input.quotaMb,
  });
  const publicRoot = plan.publicRoot;
  mkdirSync(publicRoot, { recursive: true });
  const index = join(publicRoot, 'index.html');
  if (!existsSync(index)) {
    writeFileSync(
      index,
      `<!doctype html><html><head><meta charset="utf-8"><title>YSK Files</title></head>
<body><h1>YSK Public File Server</h1><p>Upload via Web Files UI (sandbox: files/public).</p></body></html>\n`,
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

  const notes: string[] = [
    `Public root: ${publicRoot}`,
    `API prefix: ${plan.apiPrefix}?root=public`,
  ];

  // nginx (www-data) must read this tree
  ensureNginxReadable(publicRoot, input.dataDir, notes);

  const leCert = `/etc/letsencrypt/live/${serverName}/fullchain.pem`;
  const leKey = `/etc/letsencrypt/live/${serverName}/privkey.pem`;
  const conf = buildPublicFilesNginxConf({
    serverName,
    publicRoot,
    sslCert: existsSync(leCert) ? leCert : undefined,
    sslKey: existsSync(leKey) ? leKey : undefined,
  });
  if (existsSync(leCert) && existsSync(leKey)) {
    notes.push(`TLS: using Let's Encrypt cert for ${serverName}`);
  } else {
    notes.push(
      tl('publicFiles.notes.httpOnly', {
        defaultValue:
          'HTTP only (port 80). No LE cert found — open http:// not https://, or issue SSL first.',
      }),
    );
  }

  const confName = confFileName(serverName);
  const nginxPath = writeManagedNginxConf(input.dataDir, confName, conf);
  notes.push(`Nginx conf (managed): ${nginxPath}`);
  const written = [publicRoot, index, readme, nginxPath];
  let nginxReloaded = false;
  let nginxTested = false;
  let systemConfPath: string | undefined;
  let live = false;

  const wantReload =
    input.reload === true ||
    (input.reload !== false && input.host.executeEnabled() && input.host.isRoot());

  if (wantReload && input.host.executeEnabled() && input.host.isRoot()) {
    const sync = await syncNginxConfigs({
      dataDir: input.dataDir,
      systemConfDir: '/etc/nginx/conf.d',
      host: input.host,
      dryRun: false,
    });
    written.push(...sync.copied);
    notes.push(...sync.notes);
    nginxTested = Boolean(sync.tested);
    systemConfPath = join('/etc/nginx/conf.d', `ysk-${confName}`);
    if (existsSync(systemConfPath)) {
      live = true;
      notes.push(`System conf: ${systemConfPath}`);
    } else {
      notes.push(
        tl('publicFiles.notes.systemConfMissing', {
          defaultValue: `Expected system conf missing: ${systemConfPath}`,
        }),
      );
    }
    if (sync.tested) {
      const rel = await input.host.runCommand(['systemctl', 'reload', 'nginx'], {
        timeoutMs: 15_000,
      });
      nginxReloaded = rel.exitCode === 0;
      notes.push(
        nginxReloaded
          ? tl('notes.nginx.reloaded')
          : tl('notes.nginx.reloadExit', { code: rel.exitCode }),
      );
    } else {
      notes.push(
        tl('publicFiles.notes.nginxTestFailed', {
          defaultValue: 'nginx -t failed — conf copied but not reloaded; fix nginx -t first',
        }),
      );
    }
  } else if (wantReload) {
    notes.push(tl('ops.blocked.nginxReload'));
    notes.push(
      tl('publicFiles.notes.needRootExecute', {
        defaultValue:
          'Managed conf written only. Need root + YSK_EXECUTE to install under /etc/nginx/conf.d and reload — otherwise domain returns default nginx 404.',
      }),
    );
  } else {
    notes.push(
      tl('publicFiles.notes.noReload', {
        defaultValue:
          'reload=false: conf only under dataDir/nginx/conf.d (not active on public HTTP).',
      }),
    );
  }

  // Persist last server name for status UI
  try {
    const metaPath = join(input.dataDir, 'files', 'public-files-meta.json');
    writeFileSync(
      metaPath,
      JSON.stringify(
        {
          serverName,
          publicRoot,
          nginxPath,
          systemConfPath: systemConfPath ?? null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
    written.push(metaPath);
  } catch {
    /* */
  }

  const ok =
    existsSync(nginxPath) &&
    existsSync(publicRoot) &&
    (!wantReload ||
      !input.host.executeEnabled() ||
      !input.host.isRoot() ||
      (nginxTested && nginxReloaded));

  if (wantReload && input.host.executeEnabled() && input.host.isRoot() && !nginxReloaded) {
    notes.push(
      tl('publicFiles.notes.applyIncomplete', {
        defaultValue:
          'Apply incomplete: public site may still 404 until nginx conf is live and reloaded.',
      }),
    );
  }

  return {
    ok,
    serverName,
    publicRoot,
    nginxPath,
    systemConfPath,
    written,
    notes,
    nginxReloaded,
    nginxTested,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot(),
    live,
  };
}

/** Status for Public Files page (honest live vs managed-only). */
export function probePublicFileServer(input: {
  dataDir: string;
  host: HostExecutor;
}): PublicFilesStatus {
  const publicRoot = publicFilesRoot(input.dataDir);
  const notes: string[] = [];
  let serverName: string | undefined;
  let managedConf: string | undefined;
  let systemConf: string | undefined;

  const metaPath = join(input.dataDir, 'files', 'public-files-meta.json');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        serverName?: string;
        nginxPath?: string;
        systemConfPath?: string;
      };
      serverName = meta.serverName;
      managedConf = meta.nginxPath;
      systemConf = meta.systemConfPath ?? undefined;
    } catch {
      notes.push('public-files-meta.json unreadable');
    }
  }

  // Discover managed confs if meta missing
  const confDir = join(input.dataDir, 'nginx', 'conf.d');
  if (!managedConf && existsSync(confDir)) {
    const found = readdirSync(confDir).filter((f) => f.startsWith('public-files-') && f.endsWith('.conf'));
    if (found[0]) {
      managedConf = join(confDir, found[0]);
      if (!serverName) {
        const m = /^public-files-(.+)\.conf$/.exec(found[0]);
        if (m) serverName = m[1].replace(/-/g, '.');
      }
    }
  }
  if (managedConf && !systemConf) {
    systemConf = join('/etc/nginx/conf.d', `ysk-${managedConf.split('/').pop()}`);
  }

  let fileCount = 0;
  try {
    if (existsSync(publicRoot)) {
      fileCount = readdirSync(publicRoot).length;
    }
  } catch {
    /* */
  }

  const managedConfExists = Boolean(managedConf && existsSync(managedConf));
  const systemConfExists = Boolean(systemConf && existsSync(systemConf));
  const indexExists = existsSync(join(publicRoot, 'index.html'));
  const executeEnabled = input.host.executeEnabled();
  const isRoot = input.host.isRoot();

  if (!managedConfExists) {
    notes.push(
      tl('publicFiles.notes.noManagedConf', {
        defaultValue: 'No managed nginx conf yet — click Apply',
      }),
    );
  }
  if (managedConfExists && !systemConfExists) {
    notes.push(
      tl('publicFiles.notes.notSynced', {
        defaultValue:
          'Managed conf exists but not under /etc/nginx/conf.d — need root + EXECUTE apply with reload',
      }),
    );
  }
  if (systemConfExists) {
    notes.push(`Live system conf: ${systemConf}`);
  }
  notes.push(`Public root: ${publicRoot}`);

  return {
    publicRoot,
    publicRootExists: existsSync(publicRoot),
    indexExists,
    fileCount,
    serverName,
    managedConf,
    managedConfExists,
    systemConf,
    systemConfExists,
    executeEnabled,
    isRoot,
    notes,
    likelyLive: systemConfExists && indexExists,
  };
}
