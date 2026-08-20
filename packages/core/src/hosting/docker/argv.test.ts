import { describe, expect, it } from 'vitest';
import { classifyDockerArgv } from './argv.js';

describe('classifyDockerArgv', () => {
  it('treats inventory as read', () => {
    expect(classifyDockerArgv(['docker', 'version'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'info'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'ps', '-a'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'images'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'logs', '--tail', '100', 'x'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'compose', 'version'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'compose', '-f', 'a.yml', '-p', 'p', 'ps'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'system', 'df'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'volume', 'ls'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'network', 'ls'])).toBe('read');
    expect(classifyDockerArgv(['docker', 'stats', '--no-stream'])).toBe('read');
    expect(
      classifyDockerArgv(['docker', 'stats', '--no-stream', '--format', '{{json .}}', 'abc123def456']),
    ).toBe('read');
    expect(classifyDockerArgv(['docker', 'ps', '-q', '--filter', 'name=yskval-'])).toBe('read');
  });

  it('treats lifecycle as mutate', () => {
    expect(classifyDockerArgv(['docker', 'start', 'x'])).toBe('mutate');
    expect(classifyDockerArgv(['docker', 'run', '-d', 'alpine:3.20'])).toBe('mutate');
    expect(classifyDockerArgv(['docker', 'compose', '-f', 'a.yml', '-p', 'p', 'up', '-d'])).toBe(
      'mutate',
    );
    expect(classifyDockerArgv(['docker', 'system', 'prune', '-f'])).toBe('mutate');
    expect(classifyDockerArgv(['docker', 'pull', 'alpine:3.20'])).toBe('mutate');
  });

  it('blocks dangerous argv', () => {
    expect(classifyDockerArgv(['docker', 'exec', '-it', 'x', 'sh'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'exec', 'x', 'sh'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'exec', 'yskval-el', 'geth', 'version'])).toBe('mutate');
    expect(classifyDockerArgv(['docker', 'exec', 'yskval-el', 'hostname'])).toBe('mutate');
    expect(classifyDockerArgv(['docker', 'build', '.'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'run', '--privileged', 'alpine'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'run', '--network', 'host', 'alpine'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'run', '-v', '/:/host', 'alpine'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'logs', '-f', 'x'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'login'])).toBe('blocked');
    expect(classifyDockerArgv(['docker', 'swarm', 'init'])).toBe('blocked');
  });
});
