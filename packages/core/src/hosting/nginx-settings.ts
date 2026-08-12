/**
 * Nginx global settings (control plane + conf.d snippet).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { syncNginxConfigs } from './nginx-sync.js';
import { tl } from '@ysk-server/shared';

export type NginxBodySize = '1m' | '10m' | '50m' | '100m' | '500m';
export type NginxKeepalive = '15' | '65' | '120';
export type NginxAccessLog = 'off' | 'on' | 'buffered';

export type NginxGlobalSettings = {
  gzip: boolean;
  serverTokens: boolean;
  /** false = hide version (server_tokens off) */
  clientMaxBody: NginxBodySize;
  keepalive: NginxKeepalive;
  http2: boolean;
  accessLog: NginxAccessLog;
};

export const DEFAULT_NGINX_SETTINGS: NginxGlobalSettings = {
  gzip: true,
  serverTokens: false,
  clientMaxBody: '10m',
  keepalive: '65',
  http2: true,
  accessLog: 'on',
};

export type NginxSiteSettings = {
  ssl?: boolean;
  forceHttps?: boolean;
  hsts?: boolean;
  clientMaxBody?: NginxBodySize | 'inherit';
  websocket?: boolean;
  cloudflareRealIp?: boolean;
  indexes?: boolean;
};

const BODY_SIZES: NginxBodySize[] = ['1m', '10m', '50m', '100m', '500m'];
const KEEPALIVES: NginxKeepalive[] = ['15', '65', '120'];

export function normalizeNginxGlobal(
  raw: Partial<NginxGlobalSettings> | null | undefined,
): NginxGlobalSettings {
  const d = DEFAULT_NGINX_SETTINGS;
  const body = BODY_SIZES.includes(raw?.clientMaxBody as NginxBodySize)
    ? (raw!.clientMaxBody as NginxBodySize)
    : d.clientMaxBody;
  const ka = KEEPALIVES.includes(raw?.keepalive as NginxKeepalive)
    ? (raw!.keepalive as NginxKeepalive)
    : d.keepalive;
  const access: NginxAccessLog =
    raw?.accessLog === 'off' || raw?.accessLog === 'buffered' || raw?.accessLog === 'on'
      ? raw.accessLog
      : d.accessLog;
  return {
    gzip: raw?.gzip ?? d.gzip,
    serverTokens: raw?.serverTokens ?? d.serverTokens,
    clientMaxBody: body,
    keepalive: ka,
    http2: raw?.http2 ?? d.http2,
    accessLog: access,
  };
}

export function loadNginxSettings(dataDir: string): NginxGlobalSettings {
  const p = join(dataDir, 'nginx', 'settings.json');
  if (!existsSync(p)) return { ...DEFAULT_NGINX_SETTINGS };
  try {
    return normalizeNginxGlobal(JSON.parse(readFileSync(p, 'utf8')) as Partial<NginxGlobalSettings>);
  } catch {
    return { ...DEFAULT_NGINX_SETTINGS };
  }
}

export function saveNginxSettings(
  dataDir: string,
  patch: Partial<NginxGlobalSettings>,
): NginxGlobalSettings {
  const next = normalizeNginxGlobal({ ...loadNginxSettings(dataDir), ...patch });
  const dir = join(dataDir, 'nginx');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
  writeNginxGlobalSnippet(dataDir, next);
  return next;
}

/** http-context snippet under conf.d (included inside http{} on Debian/Ubuntu). */
export function renderNginxGlobalSnippet(s: NginxGlobalSettings): string {
  const lines = [
    '# YSK nginx global defaults — do not edit by hand',
    `server_tokens ${s.serverTokens ? 'on' : 'off'};`,
    `client_max_body_size ${s.clientMaxBody};`,
    `keepalive_timeout ${s.keepalive};`,
    s.gzip
      ? 'gzip on;\ngzip_types text/plain text/css application/json application/javascript text/xml application/xml;'
      : 'gzip off;',
    s.accessLog === 'off'
      ? 'access_log off;'
      : s.accessLog === 'buffered'
        ? 'access_log /var/log/nginx/access.log combined buffer=32k flush=5s;'
        : '# access_log: use distro default',
    s.http2 ? '# http2: enabled on SSL listen in site conf when supported' : '# http2: off (site conf may still set)',
    '',
  ];
  return lines.join('\n');
}

export function writeNginxGlobalSnippet(
  dataDir: string,
  settings?: NginxGlobalSettings,
): string {
  const s = settings ?? loadNginxSettings(dataDir);
  const dir = join(dataDir, 'nginx', 'conf.d');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'ysk-http-defaults.conf');
  writeFileSync(path, renderNginxGlobalSnippet(s), 'utf8');
  return path;
}

export async function applyNginxSettings(opts: {
  dataDir: string;
  host: HostExecutor;
  patch?: Partial<NginxGlobalSettings>;
}): Promise<{
  ok: boolean;
  settings: NginxGlobalSettings;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  written: string[];
}> {
  const settings = opts.patch
    ? saveNginxSettings(opts.dataDir, opts.patch)
    : (() => {
        const s = loadNginxSettings(opts.dataDir);
        writeNginxGlobalSnippet(opts.dataDir, s);
        return s;
      })();
  const written = [writeNginxGlobalSnippet(opts.dataDir, settings)];
  const notes = [tl('notes.nginx.settingsWritten')];
  if (!opts.host.executeEnabled()) {
    notes.push(tl('notes.nginx.settingsNeedExecute'));
    return {
      ok: false,
      settings,
      notes,
      blocked: true,
      requiresExecute: true,
      written,
    };
  }
  const sync = await syncNginxConfigs({
    dataDir: opts.dataDir,
    systemConfDir: '/etc/nginx/conf.d',
    host: opts.host,
  });
  notes.push(...(sync.notes ?? []).slice(0, 4));
  if (sync.ok && opts.host.executeEnabled()) {
    const rel = await opts.host.runCommand(['systemctl', 'reload', 'nginx'], {
      timeoutMs: 30_000,
    });
    if (rel.exitCode === 0) notes.push(tl('notes.nginx.reloaded'));
    else notes.push(tl('notes.nginx.reloadFailed'));
  }
  return {
    ok: Boolean(sync.ok),
    settings,
    notes,
    written: [...written, ...(sync.copied ?? [])],
    blocked: sync.blocked,
    requiresExecute: sync.requiresExecute,
  };
}

/** Extra server{} lines from site settings. */
export function siteExtraDirectives(s: NginxSiteSettings | undefined, global?: NginxGlobalSettings): string {
  if (!s) return '';
  const lines: string[] = [];
  const body =
    s.clientMaxBody && s.clientMaxBody !== 'inherit'
      ? s.clientMaxBody
      : undefined;
  if (body) lines.push(`client_max_body_size ${body};`);
  if (s.indexes) lines.push('autoindex on;');
  else if (s.indexes === false) lines.push('autoindex off;');
  void global;
  return lines.length ? lines.join('\n  ') + '\n  ' : '';
}
