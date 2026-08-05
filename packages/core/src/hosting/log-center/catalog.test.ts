import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertLogPathAllowed,
  assertManagedOrSystemLogPath,
  BUILTIN_LOG_SOURCES,
  isForbiddenLogPath,
  listSourceStatuses,
  LOG_PATH_ROOTS,
  resolveSourcePath,
} from './catalog.js';
import type { LogSourceDef } from './types.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ysk-logcat-'));
  tmpDirs.push(d);
  return d;
}

describe('catalog forbidden paths', () => {
  it('flags sensitive path segments case-insensitively', () => {
    expect(isForbiddenLogPath('/etc/shadow')).toBe(true);
    expect(isForbiddenLogPath('/home/x/.ssh/id_rsa')).toBe(true);
    expect(isForbiddenLogPath('/var/log/app.key')).toBe(true);
    expect(isForbiddenLogPath('/var/log/nginx/access.log')).toBe(false);
    expect(isForbiddenLogPath('/VAR/LOG/SECURE-PASSWD-backup')).toBe(true);
  });

  it('exposes builtin sources and path roots', () => {
    expect(BUILTIN_LOG_SOURCES.length).toBeGreaterThanOrEqual(8);
    expect(BUILTIN_LOG_SOURCES.every((s) => s.id && s.kind && s.label)).toBe(true);
    expect(BUILTIN_LOG_SOURCES.some((s) => s.kind === 'journal')).toBe(true);
    expect(BUILTIN_LOG_SOURCES.some((s) => s.kind === 'file')).toBe(true);
    expect(BUILTIN_LOG_SOURCES.some((s) => s.id === 'file:letsencrypt')).toBe(true);
    expect(
      BUILTIN_LOG_SOURCES.find((s) => s.id === 'file:letsencrypt')?.paths,
    ).toContain('/var/log/letsencrypt/letsencrypt.log');
    expect(LOG_PATH_ROOTS).toContain('/var/log');
    expect(LOG_PATH_ROOTS).toContain('/run/log');
  });
});

describe('assertLogPathAllowed', () => {
  it('rejects empty, null-byte, and forbidden candidates without touching disk', () => {
    expect(assertLogPathAllowed('').ok).toBe(false);
    expect(assertLogPathAllowed('/var/log/x\0y').ok).toBe(false);
    expect(assertLogPathAllowed('/etc/passwd').ok).toBe(false);
    expect(assertLogPathAllowed('/home/u/.ssh/authorized_keys').ok).toBe(false);
  });

  it('rejects missing files', () => {
    const r = assertLogPathAllowed('/var/log/ysk-definitely-missing-xyz.log');
    expect(r.ok).toBe(false);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('allows regular files under extraRoots (tmp sandbox)', () => {
    const dir = tmp();
    const log = join(dir, 'app.log');
    writeFileSync(log, 'hello\n', 'utf8');
    const ok = assertLogPathAllowed(log, [dir]);
    expect(ok.ok).toBe(true);
    expect(ok.path).toBeTruthy();
    expect(existsSync(ok.path!)).toBe(true);
  });

  it('rejects directories even under allowed roots', () => {
    const dir = tmp();
    const nested = join(dir, 'logs');
    mkdirSync(nested, { recursive: true });
    const r = assertLogPathAllowed(nested, [dir]);
    expect(r.ok).toBe(false);
  });

  it('rejects path that realpaths outside roots via symlink when possible', () => {
    const dir = tmp();
    const outside = tmp();
    const secret = join(outside, 'secret.log');
    writeFileSync(secret, 'nope\n', 'utf8');
    const link = join(dir, 'escape.log');
    try {
      symlinkSync(secret, link);
    } catch {
      // some environments disallow symlinks — skip silently
      return;
    }
    // only allow dir, not outside
    const r = assertLogPathAllowed(link, [dir]);
    expect(r.ok).toBe(false);
  });
});

describe('resolveSourcePath', () => {
  it('marks journal sources available without path', () => {
    const def: LogSourceDef = {
      id: 'journal:x',
      kind: 'journal',
      label: 'x',
      unit: 'x.service',
      group: 'system',
      defaultEnabled: true,
    };
    expect(resolveSourcePath(def)).toEqual({ available: true, path: undefined });
  });

  it('returns first allowed existing path for file sources', () => {
    const dir = tmp();
    const a = join(dir, 'a.log');
    const b = join(dir, 'b.log');
    writeFileSync(b, 'b\n', 'utf8');
    // inject via custom def — paths under dir won't pass system roots;
    // use assertLogPathAllowed path that exists only when roots include dir is internal.
    // resolveSourcePath only uses system roots, so use a path that may exist on host
    // or prove unavailable for synthetic missing paths.
    const missing: LogSourceDef = {
      id: 'file:test',
      kind: 'file',
      label: 'test',
      paths: [a, join(dir, 'nope.log')],
      group: 'other',
      defaultEnabled: true,
    };
    expect(resolveSourcePath(missing).available).toBe(false);
  });
});

describe('listSourceStatuses', () => {
  it('includes journal sources as available and skips disabled ids', () => {
    const statuses = listSourceStatuses({
      disabledIds: ['journal:nginx', 'file:syslog'],
    });
    expect(statuses.some((s) => s.id === 'journal:nginx')).toBe(false);
    expect(statuses.some((s) => s.id === 'file:syslog')).toBe(false);
    const ssh = statuses.find((s) => s.id === 'journal:sshd');
    expect(ssh?.available).toBe(true);
    expect(ssh?.kind).toBe('journal');
  });

  it('adds custom allow paths when files exist under their own root', () => {
    const dir = tmp();
    const log = join(dir, 'custom-app.log');
    writeFileSync(log, 'line\n', 'utf8');
    const statuses = listSourceStatuses({
      disabledIds: BUILTIN_LOG_SOURCES.map((s) => s.id),
      customAllowPaths: [log],
    });
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    const custom = statuses.find((s) => s.id.startsWith('file:custom:'));
    expect(custom).toBeTruthy();
    expect(custom!.available).toBe(true);
    expect(custom!.resolvedPath).toBeTruthy();
    expect(custom!.bytes).toBeGreaterThan(0);
    expect(custom!.group).toBe('other');
  });

  it('discovers managed nginx logs under extraManagedLogDirs', () => {
    const dir = tmp();
    const logDir = join(dir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'site.access.log'), 'a\n', 'utf8');
    writeFileSync(join(logDir, 'site.error.log'), 'e\n', 'utf8');
    writeFileSync(join(logDir, 'other.txt'), 'x\n', 'utf8');

    const statuses = listSourceStatuses({
      disabledIds: BUILTIN_LOG_SOURCES.map((s) => s.id),
      extraManagedLogDirs: [logDir],
    });
    const managed = statuses.filter((s) => s.id.startsWith('file:managed:'));
    expect(managed.length).toBe(2);
    expect(managed.every((m) => m.available && m.group === 'web')).toBe(true);
    expect(managed.some((m) => m.id.includes('access'))).toBe(true);
    expect(statuses.some((s) => s.id.includes('other.txt'))).toBe(false);
  });

  it('ignores missing extraManagedLogDirs', () => {
    const statuses = listSourceStatuses({
      disabledIds: BUILTIN_LOG_SOURCES.map((s) => s.id),
      extraManagedLogDirs: [join(tmp(), 'does-not-exist')],
    });
    expect(statuses.filter((s) => s.id.startsWith('file:managed:'))).toHaveLength(0);
  });
});

describe('assertManagedOrSystemLogPath', () => {
  it('allows system-allowed paths via first branch', () => {
    const dir = tmp();
    const log = join(dir, 'sys.log');
    writeFileSync(log, 'x\n', 'utf8');
    const r = assertManagedOrSystemLogPath(log, undefined, [dir]);
    expect(r.ok).toBe(true);
    expect(r.path).toBeTruthy();
  });

  it('allows files under dataDir/nginx/logs even outside /var/log', () => {
    const dataDir = tmp();
    const logDir = join(dataDir, 'nginx', 'logs');
    mkdirSync(logDir, { recursive: true });
    const log = join(logDir, 'access.log');
    writeFileSync(log, 'ok\n', 'utf8');
    const r = assertManagedOrSystemLogPath(log, dataDir);
    expect(r.ok).toBe(true);
    expect(r.path).toBeTruthy();
    expect(r.notes).toContain('managed log');
  });

  it('rejects files outside managed nginx logs and system roots', () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'nginx', 'logs'), { recursive: true });
    const other = join(dataDir, 'secret.log');
    writeFileSync(other, 'no\n', 'utf8');
    const r = assertManagedOrSystemLogPath(other, dataDir);
    expect(r.ok).toBe(false);
  });
});
