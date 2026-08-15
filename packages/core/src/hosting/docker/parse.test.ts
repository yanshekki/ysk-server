import { describe, expect, it } from 'vitest';
import { parseComposeLs, parseContainers, parseDockerInfo, parseImages } from './parse.js';

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
});
