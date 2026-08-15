import type {
  DockerComposeProject,
  DockerContainerRow,
  DockerDaemonSettings,
  DockerDfRow,
  DockerEngineStatus,
  DockerImageRow,
  DockerNetworkRow,
  DockerRunRequest,
  DockerVolumeRow,
} from 'ysk-server-shared';
import { api } from '../../shared/services/api';

export type DockerOpsResponse = {
  ok: boolean;
  apply_status?: string;
  blocked?: boolean;
  notes?: string[];
  blockMessage?: string;
};

export type DockerStatusResponse = {
  ok: boolean;
  status: DockerEngineStatus;
  executeEnabled?: boolean;
  isRoot?: boolean;
};

function post(path: string, body: Record<string, unknown> = {}) {
  return api.requestRaw<DockerOpsResponse>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export const dockerApi = {
  status: () => api.requestRaw<DockerStatusResponse>('/api/v1/docker'),
  containers: () =>
    api.requestRaw<{ ok: boolean; items: DockerContainerRow[] }>('/api/v1/docker/containers'),
  images: () => api.requestRaw<{ ok: boolean; items: DockerImageRow[] }>('/api/v1/docker/images'),
  volumes: () => api.requestRaw<{ ok: boolean; items: DockerVolumeRow[] }>('/api/v1/docker/volumes'),
  networks: () =>
    api.requestRaw<{ ok: boolean; items: DockerNetworkRow[] }>('/api/v1/docker/networks'),
  compose: () =>
    api.requestRaw<{ ok: boolean; items: DockerComposeProject[] }>('/api/v1/docker/compose'),
  df: () => api.requestRaw<{ ok: boolean; items: DockerDfRow[] }>('/api/v1/docker/df'),
  daemon: () => api.requestRaw<{ ok: boolean; daemon: DockerDaemonSettings }>('/api/v1/docker/daemon'),
  logs: (id: string, tail = 200) =>
    api.requestRaw<{ ok: boolean; lines: string[]; notes: string[] }>(
      `/api/v1/docker/containers/${encodeURIComponent(id)}/logs?tail=${tail}`,
    ),
  inspect: (id: string) =>
    api.requestRaw<{ ok: boolean; inspect: unknown; notes?: string[] }>(
      `/api/v1/docker/containers/${encodeURIComponent(id)}`,
    ),
  containerAction: (id: string, action: 'start' | 'stop' | 'restart' | 'remove', execute = true) =>
    post(`/api/v1/docker/containers/${encodeURIComponent(id)}/${action}`, { execute }),
  run: (req: DockerRunRequest, execute = true) =>
    post('/api/v1/docker/containers', { ...req, execute }),
  pull: (image: string, execute = true) => post('/api/v1/docker/images/pull', { image, execute }),
  removeImage: (id: string, execute = true) => post('/api/v1/docker/images/remove', { id, execute }),
  createVolume: (name: string, execute = true) => post('/api/v1/docker/volumes', { name, execute }),
  removeVolume: (name: string, execute = true) =>
    post(`/api/v1/docker/volumes/${encodeURIComponent(name)}/remove`, { execute }),
  createNetwork: (name: string, execute = true) => post('/api/v1/docker/networks', { name, execute }),
  removeNetwork: (id: string, execute = true) =>
    post(`/api/v1/docker/networks/${encodeURIComponent(id)}/remove`, { execute }),
  composeAction: (project: string, action: 'up' | 'down' | 'restart', execute = true) =>
    post(`/api/v1/docker/compose/${encodeURIComponent(project)}/${action}`, { execute }),
  composeLogs: (project: string) =>
    api.requestRaw<{ ok: boolean; lines: string[]; notes: string[] }>(
      `/api/v1/docker/compose/${encodeURIComponent(project)}/logs`,
    ),
  prune: (scope: string, confirm?: string, execute = true) =>
    post('/api/v1/docker/prune', { scope, confirm, execute }),
  engine: (action: 'start' | 'stop' | 'restart', execute = true) =>
    post(`/api/v1/docker/engine/${action}`, { execute }),
  patchDaemon: (body: Record<string, unknown>, execute = true) =>
    api.requestRaw<DockerOpsResponse>('/api/v1/docker/daemon', {
      method: 'PATCH',
      body: JSON.stringify({ ...body, execute }),
    }),
};

export type {
  DockerComposeProject,
  DockerContainerRow,
  DockerDaemonSettings,
  DockerDfRow,
  DockerEngineStatus,
  DockerImageRow,
  DockerNetworkRow,
  DockerVolumeRow,
};
