/**
 * Apache global settings + snippet.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { tl } from 'ysk-server-shared';
import {
  DEFAULT_APACHE_SETTINGS,
  type ApacheBodySize,
  type ApacheGlobalSettings,
} from './types.js';

const BODIES: ApacheBodySize[] = ['1m', '10m', '50m', '100m', '500m'];
const KAS = ['15', '65', '120'] as const;

export function normalizeApacheGlobal(
  raw?: Partial<ApacheGlobalSettings> | null,
): ApacheGlobalSettings {
  const d = DEFAULT_APACHE_SETTINGS;
  return {
    gzip: raw?.gzip ?? d.gzip,
    serverTokens: raw?.serverTokens ?? d.serverTokens,
    clientMaxBody: BODIES.includes(raw?.clientMaxBody as ApacheBodySize)
      ? (raw!.clientMaxBody as ApacheBodySize)
      : d.clientMaxBody,
    keepalive: KAS.includes(raw?.keepalive as (typeof KAS)[number])
      ? (raw!.keepalive as ApacheGlobalSettings['keepalive'])
      : d.keepalive,
    http2: raw?.http2 ?? d.http2,
    accessLog: raw?.accessLog === 'off' || raw?.accessLog === 'on' ? raw.accessLog : d.accessLog,
  };
}

export function loadApacheSettings(dataDir: string): ApacheGlobalSettings {
  const p = join(dataDir, 'apache', 'settings.json');
  if (!existsSync(p)) return { ...DEFAULT_APACHE_SETTINGS };
  try {
    return normalizeApacheGlobal(JSON.parse(readFileSync(p, 'utf8')));
  } catch {
    return { ...DEFAULT_APACHE_SETTINGS };
  }
}

export function saveApacheSettings(
  dataDir: string,
  patch: Partial<ApacheGlobalSettings>,
): ApacheGlobalSettings {
  const next = normalizeApacheGlobal({ ...loadApacheSettings(dataDir), ...patch });
  mkdirSync(join(dataDir, 'apache'), { recursive: true });
  writeFileSync(
    join(dataDir, 'apache', 'settings.json'),
    JSON.stringify(next, null, 2) + '\n',
    'utf8',
  );
  writeApacheGlobalSnippet(dataDir, next);
  return next;
}

export function renderApacheGlobalSnippet(s: ApacheGlobalSettings): string {
  return [
    '# YSK apache global defaults',
    `ServerTokens ${s.serverTokens ? 'Full' : 'Prod'}`,
    `ServerSignature ${s.serverTokens ? 'On' : 'Off'}`,
    `KeepAliveTimeout ${s.keepalive}`,
    s.gzip ? 'AddOutputFilterByType DEFLATE text/html text/plain text/css application/javascript' : '# gzip off',
    s.accessLog === 'off' ? '# CustomLog disabled in managed defaults' : '# CustomLog: distro default',
    s.http2 ? 'Protocols h2 http/1.1' : 'Protocols http/1.1',
    '',
  ].join('\n');
}

export function writeApacheGlobalSnippet(
  dataDir: string,
  settings?: ApacheGlobalSettings,
): string {
  const s = settings ?? loadApacheSettings(dataDir);
  const dir = join(dataDir, 'apache', 'conf.d');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'ysk-defaults.conf');
  writeFileSync(path, renderApacheGlobalSnippet(s), 'utf8');
  return path;
}

export async function applyApacheSettings(opts: {
  dataDir: string;
  host: HostExecutor;
  patch?: Partial<ApacheGlobalSettings>;
  /** PHP projects (for owned conf basenames). */
  projects?: Array<Record<string, unknown>>;
}): Promise<{
  ok: boolean;
  settings: ApacheGlobalSettings;
  notes: string[];
  blocked?: boolean;
  requiresExecute?: boolean;
  written: string[];
}> {
  const settings = opts.patch
    ? saveApacheSettings(opts.dataDir, opts.patch)
    : (() => {
        const s = loadApacheSettings(opts.dataDir);
        writeApacheGlobalSnippet(opts.dataDir, s);
        return s;
      })();
  const written = [writeApacheGlobalSnippet(opts.dataDir, settings)];
  const notes = [tl('notes.apache.settingsWritten')];
  if (!opts.host.executeEnabled()) {
    return {
      ok: false,
      settings,
      notes: [...notes, tl('notes.apache.needExecute')],
      blocked: true,
      requiresExecute: true,
      written,
    };
  }
  const { syncApacheConfigs } = await import('./sync.js');
  const { listOwnedApacheConfBasenames } = await import('./sites-list.js');
  const onlyBasenames = listOwnedApacheConfBasenames({
    dataDir: opts.dataDir,
    projects: opts.projects ?? [],
  });
  const sync = await syncApacheConfigs({
    dataDir: opts.dataDir,
    host: opts.host,
    onlyBasenames,
  });
  notes.push(...sync.notes.slice(0, 4));
  return {
    ok: sync.ok,
    settings,
    notes,
    written: [...written, ...sync.copied],
    blocked: sync.blocked,
    requiresExecute: sync.requiresExecute,
  };
}
