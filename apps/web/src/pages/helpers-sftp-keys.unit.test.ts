import { describe, expect, it } from 'vitest';
import {
  parseSshPubkeyMeta,
  filterSftpKeys,
  formatSftpKeyTime,
} from './features/FtpPage';

describe('SFTP key list helpers', () => {
  it('parses algo, preview and trailing comment', () => {
    const line =
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx laptop';
    const m = parseSshPubkeyMeta(line);
    expect(m.algo).toBe('ssh-ed25519');
    expect(m.comment).toBe('laptop');
    expect(m.preview).toContain('…');
    expect(m.preview.length).toBeLessThan(line.length);
  });

  it('filters by username and formats time', () => {
    const keys = [
      {
        id: '1',
        username: 'alice',
        publicKey: 'ssh-rsa AAAA alice',
        created_at: '2026-08-08T12:00:00.000Z',
      },
      {
        id: '2',
        username: 'bob',
        publicKey: 'ssh-ed25519 BBBB bob',
        created_at: '2026-08-08T13:00:00.000Z',
      },
    ];
    expect(filterSftpKeys(keys, '')).toHaveLength(2);
    expect(filterSftpKeys(keys, 'alice')).toEqual([keys[0]]);
    expect(formatSftpKeyTime('2026-08-08T12:34:56.000Z')).toBe('2026-08-08 12:34:56');
    expect(formatSftpKeyTime('')).toBe('—');
  });
});
