import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  yskSvcComment,
  yskSvcCommentPrefix,
  defaultExposureMode,
  defaultPortsForService,
} from 'ysk-server-shared';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  loadExposureStore,
  saveExposureStore,
  ensureDesired,
  upsertDesired,
  emptyExposureStore,
} from './store.js';
import {
  buildTargetRules,
  syncServiceExposure,
  listManagedServiceRules,
  getServiceExposureStatus,
} from './sync.js';
import { syncMailServiceExposure } from './ports.js';
import {
  engineToServiceId,
  ftpsPortBindings,
  vpnPortBindings,
  dbPortBindings,
  postfixPortBindings,
  dovecotPortBindings,
  unitToExposureService,
} from './ports.js';
import {
  parseUfwNumbered,
  extractUfwComment,
  firewallAllowPort,
  firewallDeleteByComment,
} from '../firewall-ops.js';

function host(opts: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => RunResult;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) =>
      opts.run?.(argv) ?? {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      },
  };
}

describe('service-exposure shared helpers', () => {
  it('builds comments and defaults', () => {
    expect(yskSvcComment('vsftpd', 'ftp')).toBe('ysk-svc:vsftpd:ftp');
    expect(yskSvcCommentPrefix('MySQL')).toBe('ysk-svc:mysql:');
    expect(defaultExposureMode('mysql')).toBe('private');
    expect(defaultExposureMode('nginx')).toBe('public');
    expect(defaultPortsForService('vsftpd').some((p) => p.port === '21')).toBe(true);
    expect(defaultPortsForService('mysql')[0]?.port).toBe('3306');
  });

  it('port adapters map engines and ranges', () => {
    expect(engineToServiceId('postgres')).toBe('postgresql');
    expect(ftpsPortBindings({ listenPort: 21, pasvMin: 30000, pasvMax: 30100 }).map((p) => p.port)).toEqual(
      ['21', '30000:30100', '990'],
    );
    expect(vpnPortBindings(51820, 'udp')[0]?.port).toBe('51820');
    expect(dbPortBindings('mysql', { port: '3307' })[0]?.port).toBe('3307');
    expect(postfixPortBindings().some((p) => p.port === '25')).toBe(true);
    expect(dovecotPortBindings().some((p) => p.port === '993')).toBe(true);
    expect(unitToExposureService('nginx.service')?.serviceId).toBe('nginx');
    expect(unitToExposureService('redis-server')?.serviceId).toBe('redis');
    expect(unitToExposureService('unknown-unit')).toBeNull();
  });
});

describe('parseUfwNumbered comments', () => {
  it('extracts comments from numbered lines', () => {
    expect(extractUfwComment('Anywhere                   # ysk-svc:nginx:http')).toBe(
      'ysk-svc:nginx:http',
    );
    const rules = parseUfwNumbered([
      '[ 1] 80/tcp                     ALLOW IN    Anywhere                   # ysk-svc:nginx:http',
      '[ 2] 22/tcp                     ALLOW IN    Anywhere',
    ]);
    expect(rules[0]?.comment).toBe('ysk-svc:nginx:http');
    expect(rules[0]?.from).toBe('Anywhere');
    expect(rules[1]?.comment).toBeUndefined();
  });
});

describe('firewallAllowPort comment', () => {
  it('appends comment to ufw argv', async () => {
    const calls: string[][] = [];
    const h = host({
      run: (argv) => {
        calls.push(argv.map(String));
        return { stdout: 'Rule added', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const r = await firewallAllowPort(h, 21, 'tcp', undefined, 'ysk-svc:vsftpd:ftp');
    expect(r.ok).toBe(true);
    expect(calls[0]).toContain('comment');
    expect(calls[0]).toContain('ysk-svc:vsftpd:ftp');
  });
});

describe('firewallDeleteByComment', () => {
  it('deletes matching numbered rules high-to-low', async () => {
    let rules = [
      '[ 1] 21/tcp ALLOW IN Anywhere # ysk-svc:vsftpd:ftp',
      '[ 2] 22/tcp ALLOW IN Anywhere',
      '[ 3] 30000:30100/tcp ALLOW IN Anywhere # ysk-svc:vsftpd:ftps-pasv',
    ];
    const deleted: number[] = [];
    const h = host({
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status numbered')) {
          return {
            stdout: rules.join('\n'),
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('ufw delete')) {
          const m = s.match(/ufw delete (\d+)/);
          const n = Number(m?.[1]);
          deleted.push(n);
          rules = rules.filter((line) => !line.startsWith(`[ ${n}]`) && !line.startsWith(`[${n}]`));
          // also handle "[ 3]" style
          rules = rules.filter((line) => {
            const mm = line.match(/^\[\s*(\d+)\]/);
            return !mm || Number(mm[1]) !== n;
          });
          return { stdout: 'deleted', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const r = await firewallDeleteByComment(h, 'ysk-svc:vsftpd:');
    expect(r.removed).toBe(2);
    expect(deleted).toEqual([3, 1]); // high first
  });

  it('blocks when execute disabled', async () => {
    const r = await firewallDeleteByComment(host({ execute: false }), 'ysk-svc:x:');
    expect(r.blocked).toBe(true);
  });
});

describe('exposure store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-exp-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('load empty, upsert, reload', () => {
    expect(loadExposureStore(dir).services).toEqual({});
    const d = upsertDesired(dir, 'mysql', { mode: 'restricted', allowFrom: ['10.0.0.0/8'] });
    expect(d.mode).toBe('restricted');
    expect(d.allowFrom).toContain('10.0.0.0/8');
    expect(d.decided).toBe(true);
    expect(existsSync(join(dir, 'network', 'service-exposure.json'))).toBe(true);
    const again = loadExposureStore(dir);
    expect(again.services.mysql?.mode).toBe('restricted');
  });

  it('ensureDesired uses catalog defaults', () => {
    const store = emptyExposureStore();
    const d = ensureDesired(store, 'nginx');
    expect(d.mode).toBe('public');
    expect(d.ports.some((p) => p.port === '80')).toBe(true);
    const db = ensureDesired(store, 'redis');
    expect(db.mode).toBe('private');
  });

  it('save round-trip', () => {
    const store = emptyExposureStore();
    store.services.vsftpd = ensureDesired(store, 'vsftpd');
    saveExposureStore(dir, store);
    const raw = readFileSync(join(dir, 'network', 'service-exposure.json'), 'utf8');
    expect(raw).toContain('vsftpd');
  });
});

describe('buildTargetRules', () => {
  it('private yields no rules; public and restricted expand', () => {
    expect(
      buildTargetRules({
        serviceId: 'mysql',
        mode: 'private',
        ports: [{ role: 'mysql', port: '3306', proto: 'tcp' }],
        updatedAt: '',
      }),
    ).toEqual([]);

    const pub = buildTargetRules({
      serviceId: 'nginx',
      mode: 'public',
      ports: [{ role: 'http', port: '80', proto: 'tcp' }],
      updatedAt: '',
    });
    expect(pub).toHaveLength(1);
    expect(pub[0]?.comment).toBe('ysk-svc:nginx:http');
    expect(pub[0]?.from).toBeUndefined();

    const res = buildTargetRules({
      serviceId: 'mysql',
      mode: 'restricted',
      ports: [{ role: 'mysql', port: '3306', proto: 'tcp' }],
      allowFrom: ['203.0.113.10', '10.0.0.0/8'],
      updatedAt: '',
    });
    expect(res).toHaveLength(2);
    expect(res.every((r) => r.from)).toBe(true);
  });
});

describe('syncServiceExposure', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ysk-sync-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('public start applies allow with comment', async () => {
    const allows: string[][] = [];
    const h = host({
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status numbered')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'ufw' && argv[1] === 'allow') {
          allows.push(argv.map(String));
        }
        return { stdout: 'Rule added', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const r = await syncServiceExposure({
      host: h,
      dataDir: dir,
      serviceId: 'nginx',
      reason: 'start',
    });
    expect(r.ok).toBe(true);
    expect(r.needsExposureDecision).toBeFalsy();
    expect(r.applied.length).toBeGreaterThan(0);
    expect(allows.some((a) => a.includes('comment') && a.some((x) => x.startsWith('ysk-svc:nginx:')))).toBe(
      true,
    );
    expect(loadExposureStore(dir).services.nginx?.mode).toBe('public');
  });

  it('private start without decision returns needsExposureDecision', async () => {
    const h = host({
      run: () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    });
    const r = await syncServiceExposure({
      host: h,
      dataDir: dir,
      serviceId: 'mysql',
      reason: 'start',
    });
    expect(r.needsExposureDecision).toBe(true);
    expect(r.applied).toEqual([]);
    expect(r.desired.mode).toBe('private');
  });

  it('private start with keep-private decides and opens nothing', async () => {
    const allows: string[][] = [];
    const h = host({
      run: (argv) => {
        if (argv[0] === 'ufw' && argv[1] === 'allow') allows.push(argv.map(String));
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const r = await syncServiceExposure({
      host: h,
      dataDir: dir,
      serviceId: 'mysql',
      reason: 'start',
      exposureDecision: 'keep-private',
    });
    expect(r.ok).toBe(true);
    expect(r.needsExposureDecision).toBeFalsy();
    expect(allows).toHaveLength(0);
    expect(loadExposureStore(dir).services.mysql?.decided).toBe(true);
  });

  it('port-change replaces rules via delete+allow', async () => {
    let live = '[ 1] 21/tcp ALLOW IN Anywhere # ysk-svc:vsftpd:ftp\n';
    const allows: string[][] = [];
    const h = host({
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status numbered')) {
          return { stdout: live, stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('ufw delete')) {
          live = '';
          return { stdout: 'deleted', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'ufw' && argv[1] === 'allow') {
          allows.push(argv.map(String));
        }
        return { stdout: 'Rule added', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    // seed desired public
    upsertDesired(dir, 'vsftpd', { mode: 'public', decided: true });
    const r = await syncServiceExposure({
      host: h,
      dataDir: dir,
      serviceId: 'vsftpd',
      reason: 'port-change',
      ports: [
        { role: 'ftp', port: '2121', proto: 'tcp' },
        { role: 'pasv', port: '40000:40100', proto: 'tcp' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(allows.some((a) => a.some((x) => String(x).includes('2121')))).toBe(true);
    expect(loadExposureStore(dir).services.vsftpd?.ports[0]?.port).toBe('2121');
  });

  it('stop removes managed rules', async () => {
    let live = '[ 1] 80/tcp ALLOW IN Anywhere # ysk-svc:nginx:http\n';
    const h = host({
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status numbered')) {
          return { stdout: live, stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('ufw delete')) {
          live = '';
          return { stdout: 'deleted', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    upsertDesired(dir, 'nginx', { mode: 'public', decided: true });
    const r = await syncServiceExposure({
      host: h,
      dataDir: dir,
      serviceId: 'nginx',
      reason: 'stop',
    });
    expect(r.removed).toBe(1);
    expect(r.applied).toEqual([]);
  });

  it('blocked when execute disabled', async () => {
    upsertDesired(dir, 'nginx', { mode: 'public', decided: true });
    const r = await syncServiceExposure({
      host: host({ execute: false }),
      dataDir: dir,
      serviceId: 'nginx',
      reason: 'manual',
      requireDecision: false,
    });
    expect(r.blocked).toBe(true);
  });

  it('listManagedServiceRules filters by prefix', async () => {
    const h = host({
      run: (argv) => {
        if (argv.join(' ').includes('status numbered')) {
          return {
            stdout:
              '[ 1] 80/tcp ALLOW IN Anywhere # ysk-svc:nginx:http\n[ 2] 22/tcp ALLOW IN Anywhere\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const rules = await listManagedServiceRules(h, 'nginx');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.comment).toContain('ysk-svc:nginx');
  });

  it('getServiceExposureStatus reports firewall probe', async () => {
    const h = host({
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status verbose')) {
          return {
            stdout: 'Status: inactive\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('status numbered')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    // pathExists for ufw
    const h2 = {
      ...h,
      pathExists: (p: string) => p.includes('ufw'),
    };
    const st = await getServiceExposureStatus(h2 as typeof h, dir, 'nginx');
    expect(st.firewall?.installed).toBe(true);
    expect(st.firewall?.active).toBe('inactive');
  });

  it('syncMailServiceExposure applies postfix and dovecot', async () => {
    const allows: string[][] = [];
    const h = host({
      run: (argv) => {
        if (argv[0] === 'ufw' && argv[1] === 'allow') allows.push(argv.map(String));
        return { stdout: 'Rule added', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const r = await syncMailServiceExposure({
      host: h,
      dataDir: dir,
      reason: 'apply',
    });
    expect(r.ok).toBe(true);
    expect(allows.length).toBeGreaterThan(2);
    expect(loadExposureStore(dir).services.postfix).toBeTruthy();
    expect(loadExposureStore(dir).services.dovecot).toBeTruthy();
  });
});
