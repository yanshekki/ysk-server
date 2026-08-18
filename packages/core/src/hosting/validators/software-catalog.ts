/**
 * Pinned validator client images — catalog + local presence.
 * Pull is allowlisted to registry pins only (not a general Docker Hub).
 */
import {
  tl,
  type ValidatorSoftwareImageDto,
  type ValidatorSoftwareReportDto,
} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import { listDockerImages, probeDockerEngine } from '../docker/manager.js';
import { dockerPull, type DockerCtx } from '../docker/manager.js';
import { listValidatorChains } from './registry.js';
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
  return out;
}

export function isPinnedValidatorImage(ref: string): boolean {
  const parsed = parseValidatorImageRef(ref);
  if (!parsed) return false;
  return pinnedValidatorImageRefs().has(validatorImageRef(parsed.image, parsed.tag));
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
      };
    }),
  );
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
  const images = pins.map((pin) => {
    const hit = local.get(pin.ref);
    return {
      ...pin,
      present: dockerKnown ? Boolean(hit) : null,
      size: hit?.size ?? null,
      usedBy: usedBy.get(pin.ref) ?? [],
    };
  });

  return {
    dockerInstalled: probe.installed,
    dockerRunning: probe.daemonActive,
    composeAvailable: probe.composeAvailable,
    dockerVersion: probe.version,
    composeVersion: probe.composeVersion,
    images,
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
  if (!isPinnedValidatorImage(raw)) {
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
