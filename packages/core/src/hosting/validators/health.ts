/**
 * Post-upgrade health probes used before committing an image bump.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import { composePsRunning, composeFilePath, composeProjectName } from './compose-runner.js';
import { instanceDir } from './store.js';
import type { HostExecutor } from '../../host/executor.js';

export type HealthProbe = (spec: ValidatorInstanceDto) => Promise<boolean>;

export function clHealthUrl(spec: ValidatorInstanceDto): string {
  const port = spec.ports.beacon ?? 5052;
  return `http://127.0.0.1:${port}/eth/v1/node/health`;
}

export function elRpcUrl(spec: ValidatorInstanceDto): string {
  return `http://127.0.0.1:${spec.ports.rpc ?? 8545}`;
}

export async function defaultHealthProbe(
  spec: ValidatorInstanceDto,
  input: { dataDir: string; host: HostExecutor; fetchFn?: typeof fetch },
): Promise<boolean> {
  const running = await composePsRunning({
    host: input.host,
    file: composeFilePath(instanceDir(input.dataDir, spec.id)),
    project: composeProjectName(spec.id),
  });
  if (!running) return false;
  const fetchFn = input.fetchFn ?? fetch;
  if (spec.chain === 'eth') {
    try {
      const rpc = await fetchFn(elRpcUrl(spec), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      });
      if (!rpc.ok) return false;
      const cl = await fetchFn(clHealthUrl(spec));
      return cl.ok || cl.status === 206;
    } catch {
      return false;
    }
  }
  if (spec.chain === 'ada') {
    try {
      const res = await fetchFn(`http://127.0.0.1:${spec.ports.metrics ?? 12798}/metrics`);
      return res.ok;
    } catch {
      return false;
    }
  }
  return true;
}

export async function waitValidatorHealthy(input: {
  spec: ValidatorInstanceDto;
  probe: HealthProbe;
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const timeout = input.timeoutMs ?? 90_000;
  const interval = input.intervalMs ?? 2_000;
  const sleep = input.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = Date.now();
  while (Date.now() - start <= timeout) {
    try {
      if (await input.probe(input.spec)) return true;
    } catch {
      /* retry */
    }
    if (Date.now() - start + interval > timeout) break;
    await sleep(interval);
  }
  return false;
}
