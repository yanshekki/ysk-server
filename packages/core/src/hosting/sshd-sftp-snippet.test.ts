import { describe, expect, it } from 'vitest';
import { buildSshdSftpSnippet } from './sshd-sftp-snippet.js';

describe('sshd sftp snippet', () => {
  it('matches ysk project users and forces internal-sftp', () => {
    const s = buildSshdSftpSnippet();
    expect(s).toContain('Match User ysks_*,ysk_*');
    expect(s).toContain('ForceCommand internal-sftp');
    expect(s).toContain('AuthorizedKeysFile .ssh/authorized_keys');
    expect(s).toContain('PasswordAuthentication no');
  });

  it('optional chroot', () => {
    const s = buildSshdSftpSnippet({ chroot: true });
    expect(s).toContain('ChrootDirectory %h');
  });
});
