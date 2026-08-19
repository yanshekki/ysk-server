import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostExecutor } from '../../host/executor.js';
import {
  buildDockerExecArgv,
  buildDockerRunArgv,
  dockerContainerAction,
  dockerEngineStatus,
  dockerRun,
  inferExecBin,
} from './manager.js';

function mockHost(opts: {
  execute?: boolean;
  docker?: boolean;
  info?: string;
  ss?: string;
  runFail?: string;
  inspect?: unknown;
} = {}): HostExecutor {
  const execute = opts.execute ?? false;
  const dockerOk = opts.docker !== false;
  const calls: string[][] = [];
  const host = {
    executeEnabled: () => execute,
    isRoot: () => true,
    calls,
    runCommand: async (argv: string[]) => {
      calls.push(argv);
      const r = (stdout: string, exitCode = 0, stderr = '') => ({ stdout, stderr, exitCode });
      if (argv[0] === 'ss') {
        return r(opts.ss ?? '');
      }
      if (argv[0] === 'docker' && argv[1] === 'version') {
        return dockerOk ? r('27.0.3') : r('', 1);
      }
      if (argv[0] === 'docker' && argv[1] === 'compose' && argv[2] === 'version') {
        return dockerOk ? r('Docker Compose version v2.29.0') : r('', 1);
      }
      if (argv[0] === 'docker' && argv[1] === 'info') {
        if (!dockerOk) return r('', 1);
        if (argv.includes('--format') && argv.at(-1) === '{{.ServerVersion}}') return r('27.0.3');
        return r(
          opts.info ??
            JSON.stringify({
              ServerVersion: '27.0.3',
              DockerRootDir: '/var/lib/docker',
              CgroupDriver: 'systemd',
              Containers: 1,
              ContainersRunning: 1,
              Images: 2,
            }),
        );
      }
      if (argv[0] === 'docker' && argv[1] === 'inspect') {
        return r(JSON.stringify(opts.inspect ?? [{ NetworkSettings: { Ports: {}, Networks: { bridge: {} } } }]));
      }
      if (argv[0] === 'docker' && argv[1] === 'volume') return r('');
      if (argv[0] === 'docker' && argv[1] === 'network') return r('');
      if (argv[0] === 'docker' && argv[1] === 'run') {
        if (opts.runFail) return r('', 125, opts.runFail);
        return r('cid123');
      }
      if (argv[0] === 'docker' && argv[1] === 'rm') return r(argv[3] ?? 'rm');
      if (argv[0] === 'docker' && argv[1] === 'start') return r('ok');
      return r('ok');
    },
  };
  return host as unknown as HostExecutor;
}

describe('docker manager', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('status reports missing docker honestly', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const st = await dockerEngineStatus({ host: mockHost({ docker: false }), dataDir });
    expect(st.installed).toBe(false);
    expect(st.daemonActive).toBe(false);
  });

  it('status reports engine when docker info works', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const st = await dockerEngineStatus({ host: mockHost({ docker: true }), dataDir });
    expect(st.installed).toBe(true);
    expect(st.daemonActive).toBe(true);
    expect(st.composeAvailable).toBe(true);
    expect(st.counts.running).toBe(1);
  });

  it('run is dry-run without execute', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const r = await dockerRun({
      host: mockHost({ execute: false, docker: true }),
      dataDir,
      execute: false,
      req: { image: 'alpine:3.20', name: 'ysk-e2e' },
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
    expect(r.blocked).toBeFalsy();
  });

  it('run applies when execute + docker work', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const r = await dockerRun({
      host: mockHost({ execute: true, docker: true }),
      dataDir,
      execute: true,
      req: { image: 'alpine:3.20', name: 'ysk-e2e' },
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
  });

  it('rejects privileged-style run requests via builder', () => {
    const bad = buildDockerRunArgv({ image: 'alpine:3.20', network: 'host' });
    expect(bad.ok).toBe(false);
    const ok = buildDockerRunArgv({ image: 'alpine:3.20', name: 'demo', ports: [{ host: 8080, container: 80 }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.argv.join(' ')).toContain('127.0.0.1:8080:80');
      expect(ok.argv.join(' ')).toContain('com.ysk-server.managed=true');
      expect(ok.argv).not.toContain('--privileged');
      expect(ok.argv[ok.argv.indexOf('--restart') + 1]).toBe('unless-stopped');
    }
    const never = buildDockerRunArgv({ image: 'hello-world', restart: 'no' });
    expect(never.ok).toBe(true);
    if (never.ok) {
      expect(never.argv[never.argv.indexOf('--restart') + 1]).toBe('no');
    }
    const withCmd = buildDockerRunArgv({
      image: 'nginx:alpine',
      entrypoint: 'nginx',
      command: ['-g', 'daemon-off'],
    });
    expect(withCmd.ok).toBe(true);
    if (withCmd.ok) {
      expect(withCmd.argv).toContain('--entrypoint');
      expect(withCmd.argv.at(-3)).toBe('nginx:alpine');
      expect(withCmd.argv.slice(-2)).toEqual(['-g', 'daemon-off']);
    }
    expect(buildDockerRunArgv({ image: 'alpine:3.20', command: ['echo', 'a;b'] }).ok).toBe(false);
  });

  it('blocks run when the host port is already listening', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const r = await dockerRun({
      host: mockHost({
        execute: true,
        docker: true,
        ss: 'LISTEN 0 511 127.0.0.1:8080 0.0.0.0:*',
      }),
      dataDir,
      execute: true,
      req: { image: 'nginx:alpine', name: 'qa-dock-web', ports: [{ host: 8080, container: 80 }] },
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('blocked');
    expect(String(r.notes?.join(' '))).toMatch(/portBusy|8080/);
  });

  it('removes named leftover after bind failure', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const host = mockHost({
      execute: true,
      docker: true,
      runFail:
        "failed to bind host port 127.0.0.1:8080/tcp: address already in use\nRun 'docker run --help' for more information.",
    });
    const r = await dockerRun({
      host,
      dataDir,
      execute: true,
      req: { image: 'nginx:alpine', name: 'qa-dock-web' },
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('failed');
    expect(String(r.notes?.join(' '))).not.toMatch(/docker run --help/);
    const calls = (host as unknown as { calls: string[][] }).calls;
    expect(calls.some((a) => a[0] === 'docker' && a[1] === 'rm' && a.includes('qa-dock-web'))).toBe(
      true,
    );
  });

  it('start without published ports is failed, not applied', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const r = await dockerContainerAction({
      host: mockHost({
        execute: true,
        docker: true,
        inspect: [
          {
            HostConfig: { PortBindings: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }] } },
            NetworkSettings: { Ports: {}, Networks: {} },
          },
        ],
      }),
      dataDir,
      execute: true,
      id: 'qa-dock-web',
      action: 'start',
    });
    expect(r.apply_status).toBe('failed');
    expect(r.ok).toBe(false);
  });

  it('container start without execute stays written', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-'));
    dirs.push(dataDir);
    const r = await dockerContainerAction({
      host: mockHost({ execute: false, docker: true }),
      dataDir,
      execute: false,
      id: 'ysk-e2e',
      action: 'start',
    });
    expect(r.apply_status).toBe('written');
  });

  it('builds allowlisted exec argv from image', () => {
    expect(inferExecBin('ethereum/client-go:v1.15.11')).toBe('geth');
    const built = buildDockerExecArgv({
      id: 'yskval-el',
      preset: 'version',
      image: 'ghcr.io/paradigmxyz/reth:v1.4.8',
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.argv).toEqual(['exec', 'yskval-el', 'reth', '--version']);
    expect(buildDockerExecArgv({ id: 'x', preset: 'version' }).ok).toBe(false);
  });
});
