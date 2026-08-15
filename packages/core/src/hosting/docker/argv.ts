/**
 * Fail-closed docker argv classifier for HostExecutor + manager.
 * Read inventory is allowed without EXECUTE; everything else is mutating.
 */

export type DockerArgvClass = 'read' | 'mutate' | 'blocked';

const READ_TOP = new Set([
  'version',
  'info',
  'ps',
  'images',
  'inspect',
  'logs',
  'stats',
]);

const READ_COMPOSE = new Set(['version', 'ls', 'ps', 'logs', 'config']);

const MUTATE_TOP = new Set([
  'start',
  'stop',
  'restart',
  'rm',
  'rmi',
  'pull',
  'run',
  'update',
  'tag',
  'container',
  'image',
  'volume',
  'network',
  'system',
  'compose',
]);

const BLOCKED_TOP = new Set([
  'build',
  'login',
  'logout',
  'exec',
  'attach',
  'swarm',
  'stack',
  'plugin',
  'checkpoint',
  'import',
  'export',
  'load',
  'save',
  'commit',
  'cp',
  'builder',
  'buildx',
  'context',
  'trust',
  'secret',
  'config',
]);

const BLOCKED_FLAGS = [
  '--privileged',
  '--pid=host',
  '--userns=host',
  '--ipc=host',
  '--cgroupns=host',
  '--cap-add=ALL',
  '--cap-add',
];

function hasFollow(args: string[]): boolean {
  return args.includes('-f') || args.includes('--follow');
}

function composeSub(args: string[]): { file?: string; project?: string; sub: string; rest: string[] } {
  let file: string | undefined;
  let project: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === '-f' || a === '--file') {
      file = args[i + 1];
      i += 1;
      continue;
    }
    if (a === '-p' || a === '--project-name') {
      project = args[i + 1];
      i += 1;
      continue;
    }
    rest.push(a);
  }
  return { file, project, sub: rest[0] ?? '', rest: rest.slice(1) };
}

export function classifyDockerArgv(argv: readonly string[]): DockerArgvClass {
  if (argv[0] !== 'docker') return 'blocked';
  const args = argv.slice(1).filter((a) => a !== '--');
  if (args.length === 0) return 'read';
  if (args[0] === '--version' || args[0] === '-v') return 'read';

  const joined = args.join(' ');
  if (/--privileged|--pid=host|--userns=host|--ipc=host|--cgroupns=host/i.test(joined)) {
    return 'blocked';
  }
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '-v' && args[i] !== '--volume') continue;
    const spec = args[i + 1] ?? '';
    const src = spec.split(':')[0] ?? '';
    if (src === '/' || /^(?:\/boot|\/etc|\/root|\/proc|\/sys|\/dev)(?:\/|$)/.test(src)) {
      return 'blocked';
    }
  }
  if (args.includes('--network') && args[args.indexOf('--network') + 1] === 'host') {
    return 'blocked';
  }
  if (args.includes('--cap-add')) return 'blocked';

  const top = args[0] ?? '';
  if (BLOCKED_TOP.has(top)) return 'blocked';
  for (const f of BLOCKED_FLAGS) {
    if (args.includes(f)) return 'blocked';
  }

  if (top === 'compose') {
    const c = composeSub(args.slice(1));
    if (!c.sub || READ_COMPOSE.has(c.sub)) {
      if (c.sub === 'logs' && hasFollow(c.rest)) return 'blocked';
      return 'read';
    }
    if (c.sub === 'up' || c.sub === 'down' || c.sub === 'pull' || c.sub === 'restart' || c.sub === 'stop' || c.sub === 'start' || c.sub === 'rm') {
      return 'mutate';
    }
    return 'blocked';
  }

  if (top === 'volume') {
    const sub = args[1] ?? 'ls';
    if (sub === 'ls' || sub === 'inspect') return 'read';
    if (sub === 'create' || sub === 'rm' || sub === 'prune') return 'mutate';
    return 'blocked';
  }

  if (top === 'network') {
    const sub = args[1] ?? 'ls';
    if (sub === 'ls' || sub === 'inspect') return 'read';
    if (sub === 'create' || sub === 'rm' || sub === 'prune') return 'mutate';
    return 'blocked';
  }

  if (top === 'container') {
    const sub = args[1] ?? '';
    if (sub === 'ls' || sub === 'inspect' || sub === 'logs') {
      if (hasFollow(args)) return 'blocked';
      return 'read';
    }
    if (sub === 'start' || sub === 'stop' || sub === 'restart' || sub === 'rm' || sub === 'prune') {
      return 'mutate';
    }
    return 'blocked';
  }

  if (top === 'image') {
    const sub = args[1] ?? '';
    if (sub === 'ls' || sub === 'inspect') return 'read';
    if (sub === 'pull' || sub === 'rm' || sub === 'prune') return 'mutate';
    return 'blocked';
  }

  if (top === 'system') {
    const sub = args[1] ?? '';
    if (sub === 'df' || sub === 'info') return 'read';
    if (sub === 'prune') return 'mutate';
    return 'blocked';
  }

  if (READ_TOP.has(top)) {
    if (top === 'logs' && hasFollow(args.slice(1))) return 'blocked';
    if (top === 'stats' && !args.includes('--no-stream')) return 'blocked';
    return 'read';
  }

  if (MUTATE_TOP.has(top)) return 'mutate';
  return 'blocked';
}

export function isReadOnlyDockerArgv(argv: readonly string[]): boolean {
  return classifyDockerArgv(argv) === 'read';
}

export function isBlockedDockerArgv(argv: readonly string[]): boolean {
  return classifyDockerArgv(argv) === 'blocked';
}
