import { describe, expect, it } from 'vitest';
import { bashAnsiCQuote, sftpStdinArgv } from './ops.js';

describe('sftpStdinArgv', () => {
  it('emits ANSI-C quotes so printf %s expands real newlines', () => {
    const argv = sftpStdinArgv(['sftp', '-b', '-', 'qa@host'], 'pwd\n');
    expect(argv[0]).toBe('bash');
    expect(argv[2]).toContain("printf %s $'pwd\\n'");
    expect(argv[2]).not.toContain('printf %s "pwd\\n"');
    expect(bashAnsiCQuote('pwd\n')).toBe("$'pwd\\n'");
  });

  it('quotes mkdir batches with real newlines not JSON escapes', () => {
    const argv = sftpStdinArgv(['sftp', '-b', '-', 'u@h'], '-mkdir /backups\npwd\n');
    expect(argv[2]).toContain("$'-mkdir /backups\\npwd\\n'");
    expect(argv[2]).not.toMatch(/printf %s ".*\\\\n"/);
  });
});
