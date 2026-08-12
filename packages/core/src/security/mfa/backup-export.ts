import { tl } from '@yanshekki/shared';
/**
 * Encrypted break-glass backup of panel 2FA material (operator-held).
 * Format: ysk2fabak:v1:<base64(iv|tag|json)>
 */

import { encryptPrivateKey, decryptPrivateKey, resolveMasterKey } from '../ssh-identity/crypto.js';
import type { UserRow } from '../../repositories/user-repo.js';
import { decryptTotpSecret } from './totp-crypto.js';

export type TotpBackupPayload = {
  v: 1;
  userId: string;
  username: string;
  exportedAt: string;
  totpSecret: string;
  recoveryRemaining: number;
  note: string;
};

export function exportTotpBackup(input: {
  dataDir: string;
  user: UserRow;
}): { ok: boolean; blob?: string; notes: string[] } {
  if (!input.user.totp_enabled || !input.user.totp_secret) {
    return { ok: false, notes: [tl('notes.auto.n0951')] };
  }
  try {
    const secret = decryptTotpSecret(
      input.dataDir,
      input.user.id,
      input.user.totp_secret,
    );
    const payload: TotpBackupPayload = {
      v: 1,
      userId: input.user.id,
      username: input.user.username,
      exportedAt: new Date().toISOString(),
      totpSecret: secret,
      recoveryRemaining: (input.user.totp_recovery_hashes ?? []).length,
      note: tl('notes.auto.n1536'),
    };
    const { key } = resolveMasterKey(input.dataDir);
    const enc = encryptPrivateKey(
      key,
      `totp-bak:${input.user.id}`,
      JSON.stringify(payload),
    );
    return {
      ok: true,
      blob: `ysk2fabak:v1:${enc}`,
      notes: [tl('notes.auto.n0789')],
    };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'export failed'] };
  }
}

export function importTotpBackupPreview(input: {
  dataDir: string;
  userId: string;
  blob: string;
}): { ok: boolean; payload?: Omit<TotpBackupPayload, 'totpSecret'> & { totpSecret: '***' }; notes: string[] } {
  if (!input.blob.startsWith('ysk2fabak:v1:')) {
    return { ok: false, notes: [tl('notes.auto.n1112')] };
  }
  try {
    const enc = input.blob.slice('ysk2fabak:v1:'.length);
    const { key } = resolveMasterKey(input.dataDir);
    const json = decryptPrivateKey(key, `totp-bak:${input.userId}`, enc);
    const p = JSON.parse(json) as TotpBackupPayload;
    return {
      ok: true,
      payload: {
        ...p,
        totpSecret: '***',
      },
      notes: [tl('notes.auto.n1351')],
    };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : 'decrypt failed'] };
  }
}
