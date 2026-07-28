import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { addSftpKey, listSftpKeys, removeSftpKey } from './sftp-keys.js';

describe('sftp-keys', () => {
  it('adds lists removes managed keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sftp-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const r = addSftpKey(db, dir, {
        username: 'ftp1',
        publicKey: 'ssh-ed25519 AAAA test@host',
        comment: 'test',
      });
      expect(r.ok).toBe(true);
      expect(r.key?.id).toBeTruthy();
      expect(listSftpKeys(db, 'ftp1')).toHaveLength(1);
      expect(listSftpKeys(db)).toHaveLength(1);
      const auth = join(dir, 'ftps', 'ssh', 'ftp1', 'authorized_keys');
      expect(existsSync(auth)).toBe(true);
      expect(readFileSync(auth, 'utf8')).toContain('ssh-ed25519');
      const del = removeSftpKey(db, dir, r.key!.id);
      expect(del.ok).toBe(true);
      expect(listSftpKeys(db)).toHaveLength(0);
      expect(addSftpKey(db, dir, { username: 'x', publicKey: 'not-ssh' }).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
