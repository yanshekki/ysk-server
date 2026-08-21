/**
 * Strict scan: generated compose must not leak `$VAR` to Compose interpolation.
 * After RAM overlay, pids_limit must match deploy.resources.limits.pids.
 * After RAM+CPU overlay, top-level cpus must match deploy.resources.limits.cpus.
 */
import { describe, expect, it } from 'vitest';
import type { ValidatorChainId, ValidatorInstanceDto } from 'ysk-server-shared';
import { defaultValidatorMemoryLimit, VALIDATOR_CHAIN_IDS } from 'ysk-server-shared';
import { applyComposeLimits, applyComposeTimezone, stampYskComposeLabels } from './compose-runner.js';
import { planInstallFor } from './adapters/index.js';
import { ETH_CL_IDS, ETH_EL_IDS } from './adapters/eth-clients.js';
import { v1ValidatorClients } from './registry.js';

const COMPOSE_VAR = /(^|[^$])\$(?:\{[A-Za-z_][A-Za-z0-9_]*[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/;

function spec(over: Partial<ValidatorInstanceDto> & Pick<ValidatorInstanceDto, 'id' | 'chain' | 'network'>): ValidatorInstanceDto {
  const clients: ValidatorInstanceDto['clients'] = { ...(over.clients ?? {}) };
  if (over.chain === 'eth') {
    const all = v1ValidatorClients('eth');
    const el = all.find((c) => c.id === (over.clients?.el?.id ?? 'reth')) ?? all.find((c) => c.role === 'el');
    const cl = all.find((c) => c.id === (over.clients?.cl?.id ?? 'lighthouse')) ?? all.find((c) => c.role === 'cl');
    if (el) clients.el = { id: el.id, image: el.image, tag: el.tag };
    if (cl) clients.cl = { id: cl.id, image: cl.image, tag: cl.tag };
  } else {
    const node = v1ValidatorClients(over.chain)[0];
    if (node && !clients.node) clients.node = { id: node.id, image: node.image, tag: node.tag };
  }
  const rest = { ...over };
  delete rest.clients;
  return {
    profile: 'pruned',
    slug: '1',
    dataPath: `/var/lib/ysk-server/validators/${over.id}/data`,
    rpcHost: '127.0.0.1',
    upgradePolicy: 'notify',
    desiredState: 'stopped',
    createdAt: '',
    updatedAt: '',
    ports: { rpc: 1, p2p: 2, p2pCl: 3, beacon: 4, metrics: 5 },
    ...rest,
    clients: { ...clients, ...over.clients },
  };
}

function networksFor(chain: ValidatorChainId): string[] {
  if (chain === 'eth') return ['hoodi', 'sepolia', 'mainnet'];
  if (chain === 'avax') return ['fuji', 'mainnet'];
  if (chain === 'ada') return ['preview', 'preprod', 'mainnet'];
  if (chain === 'dot') return ['westend', 'mainnet'];
  return ['testnet', 'mainnet'];
}

function finalize(yaml: string, id: string, limits?: { memory?: string; cpus?: string }): string {
  return stampYskComposeLabels(applyComposeTimezone(applyComposeLimits(yaml, limits), 'UTC'), id);
}

function unescapedComposeVars(yaml: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(COMPOSE_VAR.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(yaml))) {
    hits.push(yaml.slice(Math.max(0, m.index - 12), Math.min(yaml.length, m.index + 28)).replace(/\n/g, ' '));
  }
  return hits;
}

function cpusClash(yaml: string): string | null {
  if (!/\n[ \t]+deploy:\s*\n/.test(yaml)) return null;
  const top = yaml.match(/^    cpus:\s*(\S+)/m)?.[1];
  if (!top) return null;
  const deploy = yaml.match(/^          cpus:\s*(\S+)/m)?.[1];
  if (deploy !== top) return `cpus=${top} deploy.cpus=${deploy ?? 'missing'}`;
  return null;
}

function pidsMismatch(yaml: string): string | null {
  const limits = [...yaml.matchAll(/^\s+pids_limit:\s*(\S+)/gm)].map((m) => m[1]);
  const deploy = [...yaml.matchAll(/^\s+pids:\s*(\S+)/gm)].map((m) => m[1]);
  if (!limits.length && !deploy.length) return null;
  const all = [...limits, ...deploy];
  if (all.some((v) => v !== all[0])) {
    return `pids_limit=${limits.join(',')} deploy.pids=${deploy.join(',')}`;
  }
  if (limits.length && !deploy.length) return `pids_limit=${limits.join(',')} without deploy.pids`;
  if (deploy.length && !limits.length) return `deploy.pids=${deploy.join(',')} without pids_limit`;
  return null;
}

function allPlans(): { id: string; chain: string; yaml: string }[] {
  const out: { id: string; chain: string; yaml: string }[] = [];
  for (const chain of VALIDATOR_CHAIN_IDS) {
    for (const network of networksFor(chain)) {
      if (chain === 'eth') {
        for (const el of ETH_EL_IDS) {
          for (const cl of ETH_CL_IDS) {
            const id = `eth-${network}-${el}-${cl}`;
            const s = spec({
              id,
              chain,
              network,
              clients: {
                el: { id: el, image: `img/${el}`, tag: '1' },
                cl: { id: cl, image: `img/${cl}`, tag: '1' },
              },
            });
            out.push({ id, chain, yaml: planInstallFor(s).composeYaml });
          }
        }
        continue;
      }
      const id = `${chain}-${network}-1`;
      out.push({ id, chain, yaml: planInstallFor(spec({ id, chain, network })).composeYaml });
      if (chain === 'ada') {
        const prodId = `${id}-producer`;
        out.push({
          id: prodId,
          chain,
          yaml: planInstallFor(
            spec({
              id: prodId,
              chain,
              network,
              cardanoProducer: {
                attached: true,
                kesPresent: true,
                vrfPresent: true,
                opcertPresent: true,
              },
            } as ValidatorInstanceDto),
          ).composeYaml,
        });
      }
    }
  }
  return out;
}

describe('generated compose interpolation + pids lockstep', () => {
  const plans = allPlans();

  it('covers every shipped chain', () => {
    const chains = new Set(plans.map((p) => p.chain));
    expect([...VALIDATOR_CHAIN_IDS].sort()).toEqual([...chains].sort());
    expect(plans.length).toBeGreaterThan(20);
  });

  it('adapter YAML has no Compose-interpolated $VAR except $$ escapes', () => {
    const bad: string[] = [];
    for (const p of plans) {
      for (const hit of unescapedComposeVars(p.yaml)) bad.push(`${p.id}: ${hit}`);
    }
    expect(bad).toEqual([]);
  });

  it('production RAM overlay never clashes pids_limit vs deploy.pids', () => {
    const bad: string[] = [];
    for (const p of plans) {
      const memory = defaultValidatorMemoryLimit(p.chain) ?? '8g';
      const y = finalize(p.yaml, p.id, { memory });
      const mismatch = pidsMismatch(y);
      if (mismatch) bad.push(`${p.id} memory=${memory}: ${mismatch}`);
      const vars = unescapedComposeVars(y);
      if (vars.length) bad.push(`${p.id} $: ${vars[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('RAM + CPU overlay keeps pids and cpus matched and does not leak $VAR', () => {
    const bad: string[] = [];
    for (const p of plans) {
      const y = finalize(p.yaml, p.id, { memory: '4g', cpus: '2.0' });
      const mismatch = pidsMismatch(y) ?? cpusClash(y);
      if (mismatch) bad.push(`${p.id}: ${mismatch}`);
      const vars = unescapedComposeVars(y);
      if (vars.length) bad.push(`${p.id} $: ${vars[0]}`);
    }
    expect(bad).toEqual([]);
  });
});
