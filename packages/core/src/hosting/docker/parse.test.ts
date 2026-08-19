import { describe, expect, it } from 'vitest';
import {
  formatDockerInspectSummary,
  inspectActualPorts,
  inspectHasNetwork,
  parseComposeLs,
  parseContainers,
  parseDockerInfo,
  parseImages,
  sanitizeDockerCliHelp,
} from './parse.js';

describe('docker parse', () => {
  it('parses container json lines and ysk labels', () => {
    const rows = parseContainers(
      JSON.stringify({
        ID: 'abc123',
        Names: '/ysk-demo',
        Image: 'alpine:3.20',
        Status: 'Up 2 minutes',
        State: 'running',
        Ports: '127.0.0.1:8080->80/tcp',
        Labels: 'com.ysk-server.managed=true,com.ysk-server.feature=docker-run,com.docker.compose.project=yskval-eth-hoodi-1',
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('ysk-demo');
    expect(rows[0]!.yskManaged).toBe(true);
    expect(rows[0]!.yskInstance).toBe('eth-hoodi-1');
  });

  it('prefers Status Exited over a stale running State', () => {
    const rows = parseContainers(
      JSON.stringify({
        ID: 'deadbeef',
        Names: '/hello',
        Image: 'hello-world',
        Status: 'Exited (0) 1 second ago',
        State: 'running',
      }),
    );
    expect(rows[0]!.state).toBe('exited');
  });

  it('parses images and compose ls arrays', () => {
    expect(
      parseImages(JSON.stringify({ ID: 'sha256:1', Repository: 'alpine', Tag: '3.20', Size: '8MB' })),
    ).toEqual([
      expect.objectContaining({ repository: 'alpine', tag: '3.20' }),
    ]);
    const proj = parseComposeLs(
      JSON.stringify([{ Name: 'yskval-eth-hoodi-1', Status: 'running(2)', ConfigFiles: '/x/compose.yml' }]),
    );
    expect(proj[0]!.validatorId).toBe('eth-hoodi-1');
    expect(proj[0]!.yskManaged).toBe(true);
  });

  it('parses docker info json', () => {
    const info = parseDockerInfo(
      JSON.stringify({
        ServerVersion: '27.0.3',
        DockerRootDir: '/var/lib/docker',
        CgroupDriver: 'systemd',
        Containers: 4,
        ContainersRunning: 2,
        Images: 9,
        SecurityOptions: ['name=apparmor'],
      }),
    );
    expect(info.version).toBe('27.0.3');
    expect(info.dataRoot).toBe('/var/lib/docker');
    expect(info.running).toBe(2);
    expect(info.rootless).toBe(false);
  });

  it('reads actual NetworkSettings.Ports, not PortBindings intent', () => {
    const leftover = {
      HostConfig: { PortBindings: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }] } },
      NetworkSettings: { Ports: {}, Networks: {} },
    };
    expect(inspectActualPorts(leftover)).toBe('');
    expect(inspectHasNetwork(leftover)).toBe(false);
    const ok = {
      HostConfig: { PortBindings: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }] } },
      NetworkSettings: {
        Ports: { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '18080' }] },
        Networks: { bridge: { IPAddress: '172.17.0.2' } },
      },
    };
    expect(inspectActualPorts(ok)).toContain('127.0.0.1:18080->80/tcp');
    expect(inspectHasNetwork(ok)).toBe(true);
    expect(formatDockerInspectSummary(leftover)).toMatch(/intent≠actual/);
  });

  it('strips docker run --help from daemon errors', () => {
    expect(
      sanitizeDockerCliHelp(
        "failed to bind host port 127.0.0.1:8080/tcp: address already in use\nRun 'docker run --help' for more information.",
      ),
    ).toBe('failed to bind host port 127.0.0.1:8080/tcp: address already in use');
  });
});
