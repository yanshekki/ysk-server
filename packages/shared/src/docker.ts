/**
 * Docker engine control plane — DTOs shared by core, API, CLI, and web.
 * Mutations never imply success when blocked / dry-run.
 */

export const YSK_DOCKER_MANAGED_LABEL = 'com.ysk-server.managed';
export const YSK_DOCKER_FEATURE_LABEL = 'com.ysk-server.feature';
export const YSK_DOCKER_INSTANCE_LABEL = 'com.ysk-server.instance';

export const DOCKER_PRUNE_SCOPES = [
  'containers',
  'images',
  'volumes',
  'builder',
  'system',
] as const;
export type DockerPruneScope = (typeof DOCKER_PRUNE_SCOPES)[number];

export const DOCKER_RESTART_POLICIES = ['no', 'unless-stopped', 'always', 'on-failure'] as const;
export type DockerRestartPolicy = (typeof DOCKER_RESTART_POLICIES)[number];

export const DOCKER_ENGINE_ACTIONS = ['start', 'stop', 'restart'] as const;
export type DockerEngineAction = (typeof DOCKER_ENGINE_ACTIONS)[number];

export const DOCKER_CONTAINER_ACTIONS = ['start', 'stop', 'restart', 'remove'] as const;
export type DockerContainerAction = (typeof DOCKER_CONTAINER_ACTIONS)[number];

export const DOCKER_COMPOSE_ACTIONS = ['up', 'down', 'restart'] as const;
export type DockerComposeAction = (typeof DOCKER_COMPOSE_ACTIONS)[number];

export type DockerEngineStatus = {
  installed: boolean;
  daemonActive: boolean;
  composeAvailable: boolean;
  version: string | null;
  composeVersion: string | null;
  dataRoot: string | null;
  rootless: boolean;
  cgroupDriver: string | null;
  notes: string[];
  counts: {
    containers: number;
    running: number;
    images: number;
    volumes: number;
    networks: number;
  };
  disk: {
    dataRoot: string | null;
    usedBytes: number | null;
    availBytes: number | null;
    usePct: number | null;
  };
  validatorProjects: number;
};

export type DockerContainerRow = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
  labels: Record<string, string>;
  composeProject: string | null;
  yskManaged: boolean;
  yskFeature: string | null;
  yskInstance: string | null;
};

export type DockerImageRow = {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
};

export type DockerVolumeRow = {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
};

export type DockerNetworkRow = {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  protected: boolean;
};

export type DockerComposeProject = {
  name: string;
  status: string;
  configFiles: string;
  yskManaged: boolean;
  validatorId: string | null;
};

export type DockerDfRow = {
  type: string;
  total: string;
  active: string;
  size: string;
  reclaimable: string;
};

export type DockerDaemonSettings = {
  path: string;
  exists: boolean;
  logDriver: string;
  logMaxSize: string;
  logMaxFile: string;
  liveRestore: boolean;
  registryMirrors: string[];
  insecureRegistries: string[];
  raw: Record<string, unknown>;
};

export type DockerRunPort = {
  host: number;
  container: number;
  proto?: 'tcp' | 'udp';
  bind?: string;
};

export type DockerRunRequest = {
  image: string;
  name?: string;
  ports?: DockerRunPort[];
  env?: Record<string, string>;
  restart?: DockerRestartPolicy;
  network?: string;
  volumes?: Array<{ name: string; dest: string }>;
};

export const DOCKER_IMAGE_RE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$/;

export const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

const BLOCKED_BIND_PREFIXES = [
  '/',
  '/boot',
  '/etc',
  '/root',
  '/var/lib/ysk-server',
  '/proc',
  '/sys',
  '/dev',
];

export function isDockerPruneScope(value: string): value is DockerPruneScope {
  return (DOCKER_PRUNE_SCOPES as readonly string[]).includes(value);
}

export function isDockerRestartPolicy(value: string): value is DockerRestartPolicy {
  return (DOCKER_RESTART_POLICIES as readonly string[]).includes(value);
}

export function isDockerEngineAction(value: string): value is DockerEngineAction {
  return (DOCKER_ENGINE_ACTIONS as readonly string[]).includes(value);
}

export function isDockerContainerAction(value: string): value is DockerContainerAction {
  return (DOCKER_CONTAINER_ACTIONS as readonly string[]).includes(value);
}

export function isDockerComposeAction(value: string): value is DockerComposeAction {
  return (DOCKER_COMPOSE_ACTIONS as readonly string[]).includes(value);
}

export function isSafeDockerImageRef(value: string): boolean {
  const s = String(value ?? '').trim();
  if (!s || s.length > 256) return false;
  if (s.includes('..') || s.includes('://')) return false;
  return DOCKER_IMAGE_RE.test(s);
}

export function isSafeDockerName(value: string): boolean {
  return DOCKER_NAME_RE.test(String(value ?? '').trim());
}

export function isSafeVolumeDest(dest: string): boolean {
  const s = String(dest ?? '').trim();
  if (!s.startsWith('/') || s.includes('..')) return false;
  const norm = s.replace(/\/+$/, '') || '/';
  if (BLOCKED_BIND_PREFIXES.includes(norm)) return false;
  return true;
}

export function parseLabelMap(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  const s = String(raw ?? '').trim();
  if (!s) return out;
  for (const part of s.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function composeProjectFromLabels(labels: Record<string, string>): string | null {
  return (
    labels['com.docker.compose.project'] ||
    labels['com.docker.compose.project.config_files'] ||
    null
  );
}

export function validatorIdFromComposeProject(name: string): string | null {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n.startsWith('yskval-')) return null;
  const id = n.slice('yskval-'.length);
  return id || null;
}
