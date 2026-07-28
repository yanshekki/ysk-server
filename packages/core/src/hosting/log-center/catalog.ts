/**
 * Curated log sources + path allowlist (fail-closed).
 */

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogSourceDef, LogSourceStatus } from './types.js';

export const BUILTIN_LOG_SOURCES: LogSourceDef[] = [
  {
    id: 'journal:nginx',
    kind: 'journal',
    label: 'nginx',
    unit: 'nginx.service',
    group: 'web',
    defaultEnabled: true,
    description: 'Web server (journal)',
  },
  {
    id: 'journal:sshd',
    kind: 'journal',
    label: 'sshd',
    unit: 'ssh.service',
    group: 'security',
    defaultEnabled: true,
    description: 'SSH (journal; some distros use sshd.service)',
  },
  {
    id: 'journal:fail2ban',
    kind: 'journal',
    label: 'fail2ban',
    unit: 'fail2ban.service',
    group: 'security',
    defaultEnabled: true,
  },
  {
    id: 'journal:postfix',
    kind: 'journal',
    label: 'postfix',
    unit: 'postfix.service',
    group: 'mail',
    defaultEnabled: true,
  },
  {
    id: 'journal:dovecot',
    kind: 'journal',
    label: 'dovecot',
    unit: 'dovecot.service',
    group: 'mail',
    defaultEnabled: true,
  },
  {
    id: 'file:syslog',
    kind: 'file',
    label: 'syslog',
    paths: ['/var/log/syslog', '/var/log/messages'],
    group: 'system',
    defaultEnabled: true,
  },
  {
    id: 'file:auth',
    kind: 'file',
    label: 'auth',
    paths: ['/var/log/auth.log', '/var/log/secure'],
    group: 'security',
    defaultEnabled: true,
  },
  {
    id: 'file:nginx-access',
    kind: 'file',
    label: 'nginx access',
    paths: ['/var/log/nginx/access.log'],
    group: 'web',
    defaultEnabled: true,
  },
  {
    id: 'file:nginx-error',
    kind: 'file',
    label: 'nginx error',
    paths: ['/var/log/nginx/error.log'],
    group: 'web',
    defaultEnabled: true,
  },
  {
    id: 'file:mail',
    kind: 'file',
    label: 'mail',
    paths: ['/var/log/mail.log', '/var/log/maillog'],
    group: 'mail',
    defaultEnabled: true,
  },
  {
    id: 'file:fail2ban',
    kind: 'file',
    label: 'fail2ban.log',
    paths: ['/var/log/fail2ban.log'],
    group: 'security',
    defaultEnabled: true,
  },
];

/** Roots under which file logs may be read (after realpath). */
export const LOG_PATH_ROOTS = [
  '/var/log',
  '/run/log',
] as const;

/** Extract first IPv4 from a log line (for ban deep-link). */
export function extractIpFromLogLine(line: string): string | null {
  const m = line.match(
    /\b((?:\d{1,3}\.){3}\d{1,3})\b/,
  );
  if (!m) return null;
  const ip = m[1];
  const parts = ip.split('.').map(Number);
  if (parts.some((n) => n > 255)) return null;
  // skip obvious non-public noise
  if (ip.startsWith('127.') || ip.startsWith('0.')) return null;
  return ip;
}

const FORBIDDEN_SEGMENTS = [
  '/.ssh/',
  '/etc/',
  '.pem',
  '.key',
  'id_rsa',
  'shadow',
  'passwd',
  '/proc/',
  '/sys/',
];

export function isForbiddenLogPath(path: string): boolean {
  const p = path.toLowerCase();
  return FORBIDDEN_SEGMENTS.some((s) => p.includes(s));
}

/**
 * Resolve and validate a path is under allowlisted roots.
 * Returns absolute real path or null.
 */
export function assertLogPathAllowed(
  candidate: string,
  extraRoots: string[] = [],
): {
  ok: boolean;
  path?: string;
  notes: string[];
} {
  const notes: string[] = [];
  if (!candidate || candidate.includes('\0')) {
    return { ok: false, notes: ['無效路徑'] };
  }
  if (isForbiddenLogPath(candidate)) {
    return { ok: false, notes: ['拒絕讀取敏感路徑'] };
  }
  try {
    if (!existsSync(candidate)) {
      return { ok: false, notes: ['檔案不存在'] };
    }
    const real = realpathSync(candidate);
    if (isForbiddenLogPath(real)) {
      return { ok: false, notes: ['symlink 指向敏感路徑'] };
    }
    const roots = [...LOG_PATH_ROOTS, ...extraRoots.filter(Boolean)];
    const allowed = roots.some((root) => {
      try {
        const rr = existsSync(root) ? realpathSync(root) : root;
        return real === rr || real.startsWith(rr.endsWith('/') ? rr : rr + '/');
      } catch {
        return real === root || real.startsWith(root + '/');
      }
    });
    if (!allowed) {
      return { ok: false, notes: [`路徑不在 allowlist：${real}`] };
    }
    const st = statSync(real);
    if (!st.isFile()) {
      return { ok: false, notes: ['不是一般檔案'] };
    }
    return { ok: true, path: real, notes };
  } catch (e) {
    return {
      ok: false,
      notes: [e instanceof Error ? e.message : '路徑解析失敗'],
    };
  }
}

export function resolveSourcePath(def: LogSourceDef): {
  path?: string;
  available: boolean;
} {
  if (def.kind !== 'file' || !def.paths?.length) {
    return { available: def.kind === 'journal', path: undefined };
  }
  for (const p of def.paths) {
    const r = assertLogPathAllowed(p);
    if (r.ok && r.path) return { available: true, path: r.path };
  }
  return { available: false };
}

export function listSourceStatuses(opts?: {
  disabledIds?: string[];
  extraManagedLogDirs?: string[];
  /** admin custom absolute paths */
  customAllowPaths?: string[];
}): LogSourceStatus[] {
  const disabled = new Set(opts?.disabledIds ?? []);
  const out: LogSourceStatus[] = [];
  const extraRoots = opts?.customAllowPaths ?? [];

  for (const def of BUILTIN_LOG_SOURCES) {
    if (disabled.has(def.id)) continue;
    if (def.kind === 'journal') {
      out.push({
        ...def,
        available: true,
        notes: ['journal 來源；實際可讀性視權限'],
      });
      continue;
    }
    const res = resolveSourcePath(def);
    let bytes: number | undefined;
    let mtime: string | undefined;
    if (res.path) {
      try {
        const st = statSync(res.path);
        bytes = st.size;
        mtime = st.mtime.toISOString();
      } catch {
        /* */
      }
    }
    out.push({
      ...def,
      available: res.available,
      resolvedPath: res.path,
      bytes,
      mtime,
      notes: res.available ? undefined : ['檔案不存在或不可讀'],
    });
  }

  // Custom admin paths
  for (const p of extraRoots) {
    const r = assertLogPathAllowed(p, extraRoots);
    if (!r.ok || !r.path) continue;
    try {
      const st = statSync(r.path);
      out.push({
        id: `file:custom:${Buffer.from(r.path).toString('base64url').slice(0, 24)}`,
        kind: 'file',
        label: r.path.split('/').pop() || r.path,
        paths: [r.path],
        group: 'other',
        defaultEnabled: true,
        available: true,
        resolvedPath: r.path,
        bytes: st.size,
        mtime: st.mtime.toISOString(),
        notes: ['自訂 allow 路徑'],
      });
    } catch {
      /* */
    }
  }

  // Extra managed nginx logs under dataDir
  for (const dir of opts?.extraManagedLogDirs ?? []) {
    try {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir).filter((n) => n.includes('access') || n.includes('error'))) {
        const full = join(dir, name);
        // managed under dataDir may not be under /var/log — allow if under dataDir pattern
        if (!existsSync(full)) continue;
        try {
          const st = statSync(full);
          if (!st.isFile()) continue;
          out.push({
            id: `file:managed:${name}`,
            kind: 'file',
            label: `managed ${name}`,
            paths: [full],
            group: 'web',
            defaultEnabled: true,
            available: true,
            resolvedPath: full,
            bytes: st.size,
            mtime: st.mtime.toISOString(),
            notes: ['YSK managed nginx log'],
          });
        } catch {
          /* */
        }
      }
    } catch {
      /* */
    }
  }

  return out;
}

/** Allow reading managed logs under dataDir/nginx/logs explicitly. */
export function assertManagedOrSystemLogPath(
  candidate: string,
  dataDir?: string,
  customAllowPaths?: string[],
): { ok: boolean; path?: string; notes: string[] } {
  const sys = assertLogPathAllowed(candidate, customAllowPaths);
  if (sys.ok) return sys;
  if (!dataDir) return sys;
  try {
    const real = realpathSync(candidate);
    const root = realpathSync(join(dataDir, 'nginx', 'logs'));
    if (real === root || real.startsWith(root + '/')) {
      if (isForbiddenLogPath(real)) return { ok: false, notes: ['拒絕'] };
      return { ok: true, path: real, notes: ['managed log'] };
    }
  } catch {
    /* */
  }
  return sys;
}
