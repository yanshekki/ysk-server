import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserRow } from '../../repositories/user-repo.js';
import { encryptTotpSecret } from './totp-crypto.js';
import { exportTotpBackup, importTotpBackupPreview } from './backup-export.js';

function user(partial: Partial<UserRow> & Pick<UserRow, 'id' | 'username'>): UserRow {
  return {
    password_hash: 'x',
    password_salt: 'y',
    roles: ['admin'],
    locale: 'en',
    created_at: '2020-01-01T00:00:00.000Z',
    updated_at: '2020-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('backup-export', () => {
  let dataDir: string;
  const prevKey = process.env.YSK_SECRETS_KEY;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ysk-2fabak-'));
    delete process.env.YSK_SECRETS_KEY;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.YSK_SECRETS_KEY;
    else process.env.YSK_SECRETS_KEY = prevKey;
  });

  it('refuses export when totp not enabled or secret missing', () => {
    expect(
      exportTotpBackup({
        dataDir,
        user: user({ id: 'u1', username: 'alice', totp_enabled: false }),
      }).ok,
    ).toBe(false);
    expect(
      exportTotpBackup({
        dataDir,
        user: user({
          id: 'u1',
          username: 'alice',
          totp_enabled: true,
          totp_secret: undefined,
        }),
      }).ok,
    ).toBe(false);
  });

  it('exports encrypted blob and previews without leaking secret', () => {
    const plain = 'JBSWY3DPEHPK3PXP';
    const encSecret = encryptTotpSecret(dataDir, 'u1', plain);
    const exp = exportTotpBackup({
      dataDir,
      user: user({
        id: 'u1',
        username: 'alice',
        totp_enabled: true,
        totp_secret: encSecret,
        totp_recovery_hashes: ['h1', 'h2', 'h3'],
      }),
    });
    expect(exp.ok).toBe(true);
    expect(exp.blob?.startsWith('ysk2fabak:v1:')).toBe(true);
    expect(exp.blob).not.toContain(plain);

    const preview = importTotpBackupPreview({
      dataDir,
      userId: 'u1',
      blob: exp.blob!,
    });
    expect(preview.ok).toBe(true);
    expect(preview.payload?.userId).toBe('u1');
    expect(preview.payload?.username).toBe('alice');
    expect(preview.payload?.recoveryRemaining).toBe(3);
    expect(preview.payload?.totpSecret).toBe('***');
    expect(preview.payload?.v).toBe(1);
    expect(Number.isFinite(Date.parse(preview.payload!.exportedAt))).toBe(true);
  });

  it('exports from legacy plaintext totp_secret', () => {
    const plain = 'PLAINTEXTSECRET01';
    const exp = exportTotpBackup({
      dataDir,
      user: user({
        id: 'u2',
        username: 'bob',
        totp_enabled: true,
        totp_secret: plain,
      }),
    });
    expect(exp.ok).toBe(true);
    const preview = importTotpBackupPreview({
      dataDir,
      userId: 'u2',
      blob: exp.blob!,
    });
    expect(preview.ok).toBe(true);
    expect(preview.payload?.username).toBe('bob');
    expect(preview.payload?.totpSecret).toBe('***');
  });

  it('rejects bad blob prefix and wrong AAD userId', () => {
    const exp = exportTotpBackup({
      dataDir,
      user: user({
        id: 'u3',
        username: 'c',
        totp_enabled: true,
        totp_secret: 'SECRET',
      }),
    });
    expect(
      importTotpBackupPreview({ dataDir, userId: 'u3', blob: 'garbage' }).ok,
    ).toBe(false);
    expect(
      importTotpBackupPreview({
        dataDir,
        userId: 'other-user',
        blob: exp.blob!,
      }).ok,
    ).toBe(false);
  });
});
