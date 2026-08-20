/**
 * Pinned validator client images — catalog + local presence.
 * Pull is allowlisted to registry pins plus cached official tags.
 */
import {
  tl,
  type ValidatorSoftwareImageDto,
  type ValidatorSoftwareReportDto,
} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { listDockerImages, probeDockerEngine } from '../docker/manager.js';
import { dockerPull, type DockerCtx } from '../docker/manager.js';
import { findValidatorClient, listValidatorChains, suiNodeImagePins } from './registry.js';
import {
  allowedDockerTagsForClient,
  CLIENT_RELEASES,
  dockerRegistryHost,
  listOfficialClientVersions,
  loadRemoteReleases,
} from './releases.js';
import { listValidatorInstances } from './store.js';

export function validatorImageRef(image: string, tag: string): string {
  return `${String(image).trim()}:${String(tag).trim()}`;
}

export function parseValidatorImageRef(raw: string): { image: string; tag: string } | null {
  const s = String(raw ?? '').trim();
  const i = s.lastIndexOf(':');
  if (i <= 0 || i === s.length - 1) return null;
  const image = s.slice(0, i).trim();
  const tag = s.slice(i + 1).trim();
  if (!image || !tag || /\s/.test(image) || /\s/.test(tag)) return null;
  return { image, tag };
}

export function pinnedValidatorImageRefs(): Set<string> {
  const out = new Set<string>();
  for (const chain of listValidatorChains()) {
    for (const client of chain.clients) {
      out.add(validatorImageRef(client.image, client.tag));
    }
  }
  for (const ref of suiNodeImagePins()) out.add(ref);
  return out;
}

export function isPinnedValidatorImage(ref: string): boolean {
  const parsed = parseValidatorImageRef(ref);
  if (!parsed) return false;
  return pinnedValidatorImageRefs().has(validatorImageRef(parsed.image, parsed.tag));
}

function emptySource(clientId: string, image: string) {
  const meta = CLIENT_RELEASES[clientId];
  return {
    registryHost: dockerRegistryHost(image),
    sourceGithub: meta?.github ?? null,
    changelogUrl: meta?.changelog ?? null,
    officialTag: null as string | null,
    officialDockerTag: null as string | null,
    officialAt: null as string | null,
    officialError: null as string | null,
    staleInstances: [] as ValidatorSoftwareImageDto['staleInstances'],
  };
}

export function listPinnedValidatorImages(): ValidatorSoftwareImageDto[] {
  return listValidatorChains().flatMap((chain) =>
    chain.clients.map((client) => {
      const ref = validatorImageRef(client.image, client.tag);
      return {
        chain: chain.id,
        clientId: client.id,
        role: client.role,
        image: client.image,
        tag: client.tag,
        ref,
        present: null,
        size: null,
        usedBy: [],
        ...emptySource(client.id, client.image),
      };
    }),
  );
}

/** Pin ∪ cached official Docker tags for the same image repository. */
export function isAllowedValidatorImage(ref: string, dataDir?: string): boolean {
  const parsed = parseValidatorImageRef(ref);
  if (!parsed) return false;
  if (parsed.tag === 'latest' || /nightly/i.test(parsed.tag)) return false;
  if (isPinnedValidatorImage(ref)) return true;
  if (!dataDir) return false;
  const catalog = findValidatorClientByImage(parsed.image);
  if (!catalog) return false;
  const allowed = allowedDockerTagsForClient({
    clientId: catalog.clientId,
    dataDir,
  });
  return allowed.has(parsed.tag);
}

function findValidatorClientByImage(image: string): { clientId: string } | null {
  const img = String(image ?? '').trim();
  for (const chain of listValidatorChains()) {
    const c = chain.clients.find((x) => x.image === img);
    if (c) return { clientId: c.id };
  }
  return null;
}

export function isAllowedClientTag(input: {
  clientId: string;
  tag: string;
  dataDir: string;
  extraTags?: string[];
  network?: string;
}): boolean {
  const tag = String(input.tag ?? '').trim();
  if (!tag || tag === 'latest' || /nightly/i.test(tag)) return false;
  const cat = findValidatorClient(input.clientId);
  if (!cat) return false;
  if (tag === cat.tag) return true;
  const listed = listOfficialClientVersions({
    clientId: input.clientId,
    dataDir: input.dataDir,
    network: input.network,
    extraTags: input.extraTags,
  });
  return listed.versions.some((v) => v.dockerTag === tag);
}

export async function collectValidatorSoftware(input: {
  host: HostExecutor;
  dataDir: string;
}): Promise<ValidatorSoftwareReportDto> {
  const probe = await probeDockerEngine(input.host);
  const pins = listPinnedValidatorImages();
  const instances = listValidatorInstances(input.dataDir);
  const usedBy = new Map<string, string[]>();
  for (const inst of instances) {
    for (const client of Object.values(inst.clients ?? {})) {
      const ref = validatorImageRef(client.image, client.tag);
      const list = usedBy.get(ref) ?? [];
      if (!list.includes(inst.id)) list.push(inst.id);
      usedBy.set(ref, list);
    }
  }

  let local = new Map<string, { size?: string }>();
  if (probe.installed && probe.daemonActive) {
    try {
      const images = await listDockerImages(input.host);
      local = new Map(
        images
          .filter((row) => row.repository && row.tag && row.tag !== '<none>')
          .map((row) => [validatorImageRef(row.repository, row.tag), { size: row.size }]),
      );
    } catch {
      local = new Map();
    }
  }

  const dockerKnown = probe.installed && probe.daemonActive;
  const official = loadRemoteReleases(input.dataDir);
  const images = pins.map((pin) => {
    const hit = local.get(pin.ref);
    const listed = listOfficialClientVersions({
      clientId: pin.clientId,
      dataDir: input.dataDir,
    });
    const newest = official.clients[pin.clientId]?.items[0];
    const staleInstances = instances
      .flatMap((inst) =>
        Object.values(inst.clients ?? {})
          .filter((c) => c.id === pin.clientId && c.tag !== pin.tag)
          .map((c) => ({ id: inst.id, tag: c.tag })),
      )
      .filter((row, i, all) => all.findIndex((x) => x.id === row.id && x.tag === row.tag) === i);
    return {
      ...pin,
      present: dockerKnown ? Boolean(hit) : null,
      size: hit?.size ?? null,
      usedBy: usedBy.get(pin.ref) ?? [],
      registryHost: listed.registryHost,
      sourceGithub: listed.github,
      changelogUrl: listed.changelogUrl,
      officialTag: newest?.gitTag ?? null,
      officialDockerTag: newest?.dockerTag ?? null,
      officialAt: listed.at,
      officialError: listed.error,
      staleInstances,
    };
  });

  return {
    dockerInstalled: probe.installed,
    dockerRunning: probe.daemonActive,
    composeAvailable: probe.composeAvailable,
    dockerVersion: probe.version,
    composeVersion: probe.composeVersion,
    images,
    officialAt: official.at || null,
    executeEnabled: input.host.executeEnabled(),
    isRoot: input.host.isRoot(),
  };
}

export async function pullPinnedValidatorImage(
  input: DockerCtx & { image: string; tag?: string },
) {
  const raw = input.tag
    ? validatorImageRef(input.image, input.tag)
    : String(input.image ?? '').trim();
  if (!isAllowedValidatorImage(raw, input.dataDir) && !isPinnedValidatorImage(raw)) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('docker.errors.badImage'),
      notes: [tl('docker.errors.badImage')],
    };
  }
  const parsed = parseValidatorImageRef(raw);
  if (!parsed) {
    return {
      ok: false,
      blocked: true,
      blockMessage: tl('docker.errors.badImage'),
      notes: [tl('docker.errors.badImage')],
    };
  }
  return dockerPull({ ...input, image: validatorImageRef(parsed.image, parsed.tag) });
}
