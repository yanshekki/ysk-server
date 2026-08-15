import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyGitHookEvent,
  describeGitHook,
  extractGitHookPushRef,
  generateGitHookSecret,
  gitHookRateLimited,
  hasGitHookSecret,
  hookPushMatchesTrackedRef,
  isGitHookProjectId,
  readGitHookSecret,
  resetGitHookRateLimit,
  saveGitHookSecret,
  verifyGitHookAuth,
} from './git-hook.js';

describe('git hook secret + verify', () => {
  it('stores encrypted secret and verifies GitHub HMAC / plain header', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-githook-'));
    const id = '11111111-2222-4333-a444-555555555555';
    const secret = generateGitHookSecret();
    saveGitHookSecret(dir, id, secret);
    expect(hasGitHookSecret(dir, id)).toBe(true);
    expect(readGitHookSecret(dir, id)).toBe(secret);
    const body = '{"ref":"refs/heads/main"}';
    const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(
      verifyGitHookAuth({ 'x-hub-signature-256': `sha256=${hex}` }, body, secret),
    ).toBe(true);
    expect(verifyGitHookAuth({ 'x-ysk-git-hook': secret }, body, secret)).toBe(true);
    expect(verifyGitHookAuth({ 'x-gitlab-token': secret }, body, secret)).toBe(true);
    expect(verifyGitHookAuth({ 'x-gitea-signature': hex }, body, secret)).toBe(true);
    expect(verifyGitHookAuth({ 'x-ysk-git-hook': 'nope' }, body, secret)).toBe(false);
    expect(JSON.stringify(describeGitHook(dir, id, true))).not.toContain(secret);
    rmSync(dir, { recursive: true, force: true });
  });

  it('classifies ping vs push', () => {
    expect(classifyGitHookEvent({ 'x-github-event': 'ping' }, '{}')).toBe('ping');
    expect(classifyGitHookEvent({ 'x-github-event': 'push' }, '{}')).toBe('push');
    expect(classifyGitHookEvent({ 'x-gitlab-event': 'Push Hook' }, '{}')).toBe('push');
    expect(classifyGitHookEvent({}, '{}')).toBe('push');
    expect(classifyGitHookEvent({}, '{"zen":"hi"}')).toBe('ping');
  });

  it('matches push ref to the project branch and ignores SHA pins', () => {
    expect(extractGitHookPushRef('{"ref":"refs/heads/main"}')).toBe('refs/heads/main');
    expect(extractGitHookPushRef('not-json')).toBeUndefined();
    expect(hookPushMatchesTrackedRef(undefined, 'main')).toBe(true);
    expect(hookPushMatchesTrackedRef('refs/heads/main', 'main')).toBe(true);
    expect(hookPushMatchesTrackedRef('refs/heads/main', 'refs/heads/main')).toBe(true);
    expect(hookPushMatchesTrackedRef('refs/tags/v1.0.0', 'v1.0.0')).toBe(true);
    expect(hookPushMatchesTrackedRef('refs/heads/dev', 'main')).toBe(false);
    expect(hookPushMatchesTrackedRef('refs/heads/main', 'abcdef1')).toBe(false);
    expect(hookPushMatchesTrackedRef('refs/heads/other', '')).toBe(true);
  });

  it('rate-limits and validates project ids', () => {
    resetGitHookRateLimit();
    const id = '11111111-2222-4333-a444-555555555555';
    expect(isGitHookProjectId(id)).toBe(true);
    expect(isGitHookProjectId('../etc/passwd')).toBe(false);
    expect(gitHookRateLimited(id, 60_000)).toBe(false);
    expect(gitHookRateLimited(id, 60_000)).toBe(true);
  });
});
