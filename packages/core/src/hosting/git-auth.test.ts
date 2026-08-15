import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  clearGitHttpsToken,
  describeGitAuth,
  hasGitHttpsToken,
  isGitHostPinned,
  parseGitRemoteHost,
  parseSshKeyscan,
  pinGitHostKeys,
  readGitHttpsToken,
  resolveGitAuthRuntime,
  saveGitHttpsToken,
} from './git-auth.js';

describe('parseGitRemoteHost', () => {
  it('classifies https, ssh, and file remotes', () => {
    expect(parseGitRemoteHost('https://github.com/org/repo.git')).toEqual({
      scheme: 'https',
      host: 'github.com',
    });
    expect(parseGitRemoteHost('git@github.com:org/repo.git')).toEqual({
      scheme: 'ssh',
      host: 'github.com',
    });
    expect(parseGitRemoteHost('ssh://git@gitlab.example/a/b.git')).toEqual({
      scheme: 'ssh',
      host: 'gitlab.example',
    });
    expect(parseGitRemoteHost('/var/git/app.git')).toEqual({ scheme: 'file' });
  });
});

describe('HTTPS token vault', () => {
  it('encrypts, reads, and clears without putting the token in describe()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-git-tok-'));
    saveGitHttpsToken(dir, 'p1', 'ghp_supersecrettoken99');
    expect(hasGitHttpsToken(dir, 'p1')).toBe(true);
    expect(readGitHttpsToken(dir, 'p1')).toBe('ghp_supersecrettoken99');
    const pub = describeGitAuth({ dataDir: dir, projectId: 'p1', gitUrl: 'https://x/y.git', authKind: 'https-token' });
    expect(pub.hasToken).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('ghp_');
    clearGitHttpsToken(dir, 'p1');
    expect(hasGitHttpsToken(dir, 'p1')).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('known_hosts pin', () => {
  it('parses ssh-keyscan and pins by host', () => {
    const raw =
      'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n';
    const keys = parseSshKeyscan(raw);
    expect(keys.length).toBe(1);
    expect(keys[0]?.type).toBe('ssh-ed25519');
    const dir = mkdtempSync(join(tmpdir(), 'ysk-git-kh-'));
    pinGitHostKeys(dir, 'p1', 'github.com', keys);
    expect(isGitHostPinned(dir, 'p1', 'github.com')).toBe(true);
    expect(isGitHostPinned(dir, 'p1', 'gitlab.com')).toBe(false);
    expect(readFileSync(join(dir, 'secrets/git/p1.known_hosts'), 'utf8')).toContain('github.com');
    const blocked = resolveGitAuthRuntime({
      dataDir: dir,
      projectId: 'p1',
      gitUrl: 'git@github.com:org/repo.git',
      authKind: 'ssh',
    });
    expect(blocked.blocked?.code).toBe('auth');
    const unpinned = resolveGitAuthRuntime({
      dataDir: dir,
      projectId: 'p2',
      gitUrl: 'git@github.com:org/repo.git',
      authKind: 'ssh',
    });
    expect(unpinned.blocked?.code).toBe('hostkey');
    rmSync(dir, { recursive: true, force: true });
  });
});
