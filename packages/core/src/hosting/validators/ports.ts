/**
 * Allocate host ports for a new validator instance.
 */
import type { ValidatorChainId } from 'ysk-server-shared';
import { parseSsListenHosts } from '../panel-tls.js';
import { listValidatorInstances } from './store.js';

const ETH_BASE = { rpc: 8545, engine: 8551, p2p: 30303, p2pCl: 9000, beacon: 5052 };
const AVAX_BASE = { rpc: 9650, p2p: 9651 };
const NEAR_BASE = { rpc: 3030, p2p: 24567 };
const ADA_BASE = { p2p: 3001, metrics: 12798 };
const BTC_BASE = { rpc: 8332, p2p: 8333 };
const COSMOS_BASE = { rpc: 26657, p2p: 26656 };
const SUI_BASE = { rpc: 9002, p2p: 8084 };
const APTOS_BASE = { rpc: 18080, p2p: 6180 };
const DOT_BASE = { rpc: 9933, p2p: 30333 };
const SOL_BASE = { rpc: 8899, p2p: 8000 };

export function usedValidatorPorts(dataDir: string): Set<number> {
  const used = new Set<number>();
  for (const inst of listValidatorInstances(dataDir)) {
    for (const n of Object.values(inst.ports ?? {})) {
      if (Number.isInteger(n)) used.add(n);
    }
  }
  return used;
}

export function hostLoopbackPortTaken(ssOut: string, port: number): boolean {
  const hosts = parseSsListenHosts(ssOut, port);
  return hosts.some(
    (h) => h === '0.0.0.0' || h === '127.0.0.1' || h === '*' || h === '::' || h === '[::]',
  );
}

/** Host TCP listen ports from `ss -lnt` (skip well-known 1–1024). */
export function parseSsListenPortSet(ssOut: string): Set<number> {
  const out = new Set<number>();
  for (const line of String(ssOut ?? '').split('\n')) {
    const m = line.match(/:(\d+)\s/);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 1024 && n <= 65535) out.add(n);
  }
  return out;
}

function nextFree(used: Set<number>, start: number): number {
  let n = start;
  while (used.has(n) || n < 1024 || n > 65535) n += 1;
  used.add(n);
  return n;
}

export function allocateValidatorPorts(
  dataDir: string,
  chain: ValidatorChainId,
  extraUsed?: Iterable<number>,
): Record<string, number> {
  const used = usedValidatorPorts(dataDir);
  if (extraUsed) {
    for (const n of extraUsed) {
      if (Number.isInteger(n)) used.add(n);
    }
  }
  if (chain === 'avax') {
    return {
      rpc: nextFree(used, AVAX_BASE.rpc),
      p2p: nextFree(used, AVAX_BASE.p2p),
    };
  }
  if (chain === 'near') {
    return {
      rpc: nextFree(used, NEAR_BASE.rpc),
      p2p: nextFree(used, NEAR_BASE.p2p),
    };
  }
  if (chain === 'ada') {
    return {
      p2p: nextFree(used, ADA_BASE.p2p),
      metrics: nextFree(used, ADA_BASE.metrics),
    };
  }
  if (chain === 'btc') {
    return { rpc: nextFree(used, BTC_BASE.rpc), p2p: nextFree(used, BTC_BASE.p2p) };
  }
  if (chain === 'cosmos') {
    return { rpc: nextFree(used, COSMOS_BASE.rpc), p2p: nextFree(used, COSMOS_BASE.p2p) };
  }
  if (chain === 'sui') {
    return { rpc: nextFree(used, SUI_BASE.rpc), p2p: nextFree(used, SUI_BASE.p2p) };
  }
  if (chain === 'aptos') {
    return { rpc: nextFree(used, APTOS_BASE.rpc), p2p: nextFree(used, APTOS_BASE.p2p) };
  }
  if (chain === 'dot') {
    return { rpc: nextFree(used, DOT_BASE.rpc), p2p: nextFree(used, DOT_BASE.p2p) };
  }
  if (chain === 'sol') {
    return { rpc: nextFree(used, SOL_BASE.rpc), p2p: nextFree(used, SOL_BASE.p2p) };
  }
  return {
    rpc: nextFree(used, ETH_BASE.rpc),
    engine: nextFree(used, ETH_BASE.engine),
    p2p: nextFree(used, ETH_BASE.p2p),
    p2pCl: nextFree(used, ETH_BASE.p2pCl),
    beacon: nextFree(used, ETH_BASE.beacon),
  };
}
