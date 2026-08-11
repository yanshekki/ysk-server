import { describe, expect, it } from 'vitest';
import type { HostExecutor } from '../../host/executor.js';
import { resolveVncserverBin, VNCSERVER_ABSOLUTE_PATHS } from './server-session.js';

function mockHost(opts: {
  exists?: string[];
  execExit?: number;
  dpkgStatus?: string;
  dpkgList?: string;
}): HostExecutor {
  const exists = new Set(opts.exists ?? []);
  return {
    pathExists: (p: string) => exists.has(p),
    executeEnabled: () => true,
    isRoot: () => true,
    runCommand: async (argv: string[]) => {
      const joined = argv.join(' ');
      if (argv[0] === 'test' && argv[1] === '-x') {
        return {
          stdout: '',
          stderr: '',
          exitCode: exists.has(argv[2] ?? '') ? 0 : 1,
          argv,
          dryRun: false,
        };
      }
      if (joined.includes('dpkg-query -W')) {
        return {
          stdout: opts.dpkgStatus ?? '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (joined.includes('dpkg-query -L')) {
        return {
          stdout: opts.dpkgList ?? '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      // resolveBin bash PATH probe
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
  };
}

describe('resolveVncserverBin', () => {
  it('finds absolute Debian path via pathExists', async () => {
    const host = mockHost({ exists: ['/usr/bin/tigervncserver'] });
    expect(await resolveVncserverBin(host)).toBe('/usr/bin/tigervncserver');
  });

  it('finds via dpkg -L when package installed', async () => {
    const host = mockHost({
      exists: ['/opt/custom/tigervncserver'],
      dpkgStatus: 'install ok installed',
      dpkgList: '/opt/custom/tigervncserver\n',
    });
    expect(await resolveVncserverBin(host)).toBe('/opt/custom/tigervncserver');
  });

  it('returns null when nothing found', async () => {
    const host = mockHost({});
    expect(await resolveVncserverBin(host)).toBeNull();
  });

  it('prefers first absolute candidate', async () => {
    expect(VNCSERVER_ABSOLUTE_PATHS[0]).toBe('/usr/bin/tigervncserver');
  });
});
