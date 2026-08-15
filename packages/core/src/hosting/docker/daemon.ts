/**
 * Safe subset of /etc/docker/daemon.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tl, type DockerDaemonSettings } from 'ysk-server-shared';

export const DOCKER_DAEMON_JSON = '/etc/docker/daemon.json';

const ALLOWED_LOG_DRIVERS = new Set(['json-file', 'local', 'journald']);
const ALLOWED_SIZES = new Set(['1m', '10m', '20m', '50m', '100m', '200m']);
const ALLOWED_FILES = new Set(['1', '2', '3', '5', '10']);

export type DockerDaemonPatch = {
  logDriver?: string;
  logMaxSize?: string;
  logMaxFile?: string;
  liveRestore?: boolean;
  registryMirrors?: string[];
  insecureRegistries?: string[];
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

export function readDaemonSettings(path = DOCKER_DAEMON_JSON): DockerDaemonSettings {
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      logDriver: 'json-file',
      logMaxSize: '10m',
      logMaxFile: '3',
      liveRestore: false,
      registryMirrors: [],
      insecureRegistries: [],
      raw: {},
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const opts = (raw['log-opts'] && typeof raw['log-opts'] === 'object'
      ? (raw['log-opts'] as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    return {
      path,
      exists: true,
      logDriver: String(raw['log-driver'] ?? 'json-file'),
      logMaxSize: String(opts['max-size'] ?? '10m'),
      logMaxFile: String(opts['max-file'] ?? '3'),
      liveRestore: raw['live-restore'] === true,
      registryMirrors: asStringArray(raw['registry-mirrors']),
      insecureRegistries: asStringArray(raw['insecure-registries']),
      raw,
    };
  } catch {
    return {
      path,
      exists: true,
      logDriver: 'json-file',
      logMaxSize: '10m',
      logMaxFile: '3',
      liveRestore: false,
      registryMirrors: [],
      insecureRegistries: [],
      raw: {},
    };
  }
}

export function applyDaemonPatch(
  current: Record<string, unknown>,
  patch: DockerDaemonPatch,
): { ok: true; next: Record<string, unknown> } | { ok: false; notes: string[] } {
  const notes: string[] = [];
  const next = { ...current };
  if (patch.logDriver != null) {
    if (!ALLOWED_LOG_DRIVERS.has(patch.logDriver)) {
      notes.push(tl('docker.errors.badDaemon'));
      return { ok: false, notes };
    }
    next['log-driver'] = patch.logDriver;
  }
  const opts = {
    ...((next['log-opts'] && typeof next['log-opts'] === 'object'
      ? next['log-opts']
      : {}) as Record<string, unknown>),
  };
  if (patch.logMaxSize != null) {
    if (!ALLOWED_SIZES.has(patch.logMaxSize)) {
      return { ok: false, notes: [tl('docker.errors.badDaemon')] };
    }
    opts['max-size'] = patch.logMaxSize;
  }
  if (patch.logMaxFile != null) {
    if (!ALLOWED_FILES.has(patch.logMaxFile)) {
      return { ok: false, notes: [tl('docker.errors.badDaemon')] };
    }
    opts['max-file'] = patch.logMaxFile;
  }
  if (Object.keys(opts).length) next['log-opts'] = opts;
  if (patch.liveRestore != null) next['live-restore'] = patch.liveRestore;
  if (patch.registryMirrors) {
    if (patch.registryMirrors.some((u) => !/^https?:\/\//i.test(u))) {
      return { ok: false, notes: [tl('docker.errors.badDaemon')] };
    }
    next['registry-mirrors'] = patch.registryMirrors;
  }
  if (patch.insecureRegistries) {
    next['insecure-registries'] = patch.insecureRegistries;
  }
  delete next.iptables;
  delete next.experimental;
  delete next['storage-driver'];
  return { ok: true, next };
}

export function writeDaemonSettings(input: {
  path?: string;
  next: Record<string, unknown>;
  execute: boolean;
}): { written: string[]; notes: string[] } {
  const path = input.path ?? DOCKER_DAEMON_JSON;
  const written: string[] = [];
  const notes: string[] = [];
  if (!input.execute) {
    notes.push(tl('docker.notes.dryDaemon'));
    return { written, notes };
  }
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const bak = `${path}.ysk-bak`;
    copyFileSync(path, bak);
    written.push(bak);
  }
  writeFileSync(path, `${JSON.stringify(input.next, null, 2)}\n`, 'utf8');
  written.push(path);
  notes.push(tl('docker.notes.daemonWrote'));
  return { written, notes };
}
