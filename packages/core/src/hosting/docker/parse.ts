/**
 * Parse docker --format '{{json .}}' / compose ls JSON into DTOs.
 */
import {
  composeProjectFromLabels,
  parseLabelMap,
  validatorIdFromComposeProject,
  type DockerComposeProject,
  type DockerContainerRow,
  type DockerDfRow,
  type DockerImageRow,
  type DockerNetworkRow,
  type DockerVolumeRow,
  YSK_DOCKER_FEATURE_LABEL,
  YSK_DOCKER_INSTANCE_LABEL,
  YSK_DOCKER_MANAGED_LABEL,
} from 'ysk-server-shared';

export function parseJsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return out;
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === 'object') out.push(item as Record<string, unknown>);
        }
        return out;
      }
    } catch {
      /* fall through to line mode */
    }
  }
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try {
      const o = JSON.parse(s) as unknown;
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>);
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

function str(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

export function reconcileDockerState(state: string, status: string): string {
  const st = String(status ?? '');
  if (/^exited\b/i.test(st) || /\bexited\b/i.test(st)) return 'exited';
  if (/^up\b/i.test(st) || /\bup\b/i.test(st)) {
    if (/paused/i.test(st)) return 'paused';
    if (/restarting/i.test(st)) return 'restarting';
    return 'running';
  }
  if (/^created\b/i.test(st)) return 'created';
  if (/^dead\b/i.test(st)) return 'dead';
  return String(state ?? '').toLowerCase();
}

function labelsOf(o: Record<string, unknown>): Record<string, string> {
  const raw = o.Labels ?? o.labels;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = String(v ?? '');
    }
    return out;
  }
  return parseLabelMap(typeof raw === 'string' ? raw : '');
}

export function parseContainers(text: string): DockerContainerRow[] {
  return parseJsonLines(text).map((o) => {
    const labels = labelsOf(o);
    const name = str(o, 'Names', 'Name', 'names').replace(/^\//, '');
    const compose =
      composeProjectFromLabels(labels) ||
      str(o, 'Label', 'Project') ||
      null;
    const ysk = labels[YSK_DOCKER_MANAGED_LABEL] === 'true' || Boolean(validatorIdFromComposeProject(compose ?? ''));
    const status = str(o, 'Status', 'status');
    const rawState = str(o, 'State', 'state').toLowerCase();
    const state = reconcileDockerState(rawState, status);
    return {
      id: str(o, 'ID', 'Id', 'id').slice(0, 64),
      name,
      image: str(o, 'Image', 'image'),
      status,
      state,
      ports: str(o, 'Ports', 'ports'),
      created: str(o, 'CreatedAt', 'Created', 'created'),
      labels,
      composeProject: compose,
      yskManaged: ysk,
      yskFeature: labels[YSK_DOCKER_FEATURE_LABEL] || null,
      yskInstance: labels[YSK_DOCKER_INSTANCE_LABEL] || validatorIdFromComposeProject(compose ?? ''),
    };
  });
}

export function parseImages(text: string): DockerImageRow[] {
  return parseJsonLines(text).map((o) => ({
    id: str(o, 'ID', 'Id', 'id').slice(0, 64),
    repository: str(o, 'Repository', 'repository') || '<none>',
    tag: str(o, 'Tag', 'tag') || '<none>',
    size: str(o, 'Size', 'size'),
    created: str(o, 'CreatedAt', 'CreatedSince', 'created'),
  }));
}

export function parseVolumes(text: string): DockerVolumeRow[] {
  return parseJsonLines(text).map((o) => ({
    name: str(o, 'Name', 'name'),
    driver: str(o, 'Driver', 'driver') || 'local',
    mountpoint: str(o, 'Mountpoint', 'mountpoint'),
    labels: labelsOf(o),
  }));
}

export function parseNetworks(text: string): DockerNetworkRow[] {
  return parseJsonLines(text).map((o) => {
    const name = str(o, 'Name', 'name');
    const driver = str(o, 'Driver', 'driver');
    const protectedNet = name === 'bridge' || name === 'host' || name === 'none' || name === 'docker0';
    return {
      id: str(o, 'ID', 'Id', 'id').slice(0, 64),
      name,
      driver,
      scope: str(o, 'Scope', 'scope') || 'local',
      internal: str(o, 'Internal', 'internal') === 'true',
      protected: protectedNet,
    };
  });
}

export function parseComposeLs(text: string): DockerComposeProject[] {
  return parseJsonLines(text).map((o) => {
    const name = str(o, 'Name', 'name');
    const validatorId = validatorIdFromComposeProject(name);
    return {
      name,
      status: str(o, 'Status', 'status'),
      configFiles: str(o, 'ConfigFiles', 'configFiles'),
      yskManaged: Boolean(validatorId),
      validatorId,
    };
  });
}

export function parseSystemDf(text: string): DockerDfRow[] {
  const rows = parseJsonLines(text);
  if (rows.length) {
    return rows.map((o) => ({
      type: str(o, 'Type', 'type'),
      total: str(o, 'TotalCount', 'total'),
      active: str(o, 'Active', 'active'),
      size: str(o, 'Size', 'size'),
      reclaimable: str(o, 'Reclaimable', 'reclaimable'),
    }));
  }
  const out: DockerDfRow[] = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^(Images|Containers|Local Volumes|Build Cache)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    out.push({
      type: m[1]!,
      total: m[2]!,
      active: m[3]!,
      size: m[4]!,
      reclaimable: m[5]!.trim(),
    });
  }
  return out;
}

export function parseDockerInfo(text: string): {
  version: string | null;
  dataRoot: string | null;
  rootless: boolean;
  cgroupDriver: string | null;
  containers: number;
  running: number;
  images: number;
} {
  try {
    const o = JSON.parse(String(text ?? '').trim()) as Record<string, unknown>;
    const sec = Array.isArray(o.SecurityOptions)
      ? (o.SecurityOptions as unknown[]).map((x) => String(x))
      : [];
    return {
      version: o.ServerVersion ? String(o.ServerVersion) : null,
      dataRoot: o.DockerRootDir ? String(o.DockerRootDir) : null,
      rootless: sec.some((s) => /rootless/i.test(s)),
      cgroupDriver: o.CgroupDriver ? String(o.CgroupDriver) : null,
      containers: Number(o.Containers ?? 0) || 0,
      running: Number(o.ContainersRunning ?? 0) || 0,
      images: Number(o.Images ?? 0) || 0,
    };
  } catch {
    return {
      version: null,
      dataRoot: null,
      rootless: false,
      cgroupDriver: null,
      containers: 0,
      running: 0,
      images: 0,
    };
  }
}

export function firstDockerInspect(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  const obj = Array.isArray(raw) ? raw[0] : raw;
  if (!obj || typeof obj !== 'object') return null;
  return obj as Record<string, unknown>;
}

function formatPortMap(map: unknown): string {
  if (!map || typeof map !== 'object') return '';
  const parts: string[] = [];
  for (const [ctr, binds] of Object.entries(map as Record<string, unknown>)) {
    if (!Array.isArray(binds) || !binds.length) continue;
    for (const b of binds) {
      if (!b || typeof b !== 'object') continue;
      const rec = b as { HostIp?: string; HostPort?: string };
      const ip = rec.HostIp || '0.0.0.0';
      const hp = rec.HostPort || '';
      if (hp) parts.push(`${ip}:${hp}->${ctr}`);
    }
  }
  return parts.join(', ');
}

export function inspectActualPorts(raw: unknown): string {
  const o = firstDockerInspect(raw);
  const nets = o?.NetworkSettings as { Ports?: unknown } | undefined;
  return formatPortMap(nets?.Ports);
}

export function inspectIntentPorts(raw: unknown): string {
  const o = firstDockerInspect(raw);
  const host = o?.HostConfig as { PortBindings?: unknown } | undefined;
  return formatPortMap(host?.PortBindings);
}

export function inspectHasNetwork(raw: unknown): boolean {
  const o = firstDockerInspect(raw);
  const nets = o?.NetworkSettings as { Networks?: unknown } | undefined;
  if (!nets?.Networks || typeof nets.Networks !== 'object') return false;
  return Object.keys(nets.Networks as object).length > 0;
}

export function inspectHasPortBindings(raw: unknown): boolean {
  return Boolean(inspectIntentPorts(raw));
}

export function sanitizeDockerCliHelp(text: string): string {
  return String(text ?? '')
    .replace(/\s*See ['"]?docker run --help['"]? for more information\.?/gi, '')
    .replace(/\s*Run ['"]?docker run --help['"]? for more information\.?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function formatDockerInspectSummary(raw: unknown): string {
  const actual = inspectActualPorts(raw);
  const intent = inspectIntentPorts(raw);
  const net = inspectHasNetwork(raw);
  const lines = [
    `published (actual): ${actual || '—'}`,
    `port bindings (intent): ${intent || '—'}`,
    `network attached: ${net ? 'yes' : 'no'}`,
  ];
  if (intent && !actual) {
    lines.push('intent≠actual — ports were requested but never published');
  }
  return lines.join('\n');
}
