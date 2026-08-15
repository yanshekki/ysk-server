/**
 * Client-native prune after compose image prune. Allowlisted docker run/exec only.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import { classifyDockerArgv } from '../docker/argv.js';

export type NativePrunePlan = {
  argv: string[];
  notes: string[];
};

/** Infer a one-shot prune command. Node must already be stopped for geth state prune. */
export function nativePrunePlan(spec: ValidatorInstanceDto): NativePrunePlan | null {
  if (spec.chain === 'eth') {
    const el = spec.clients.el;
    if (el?.id === 'geth') {
      const image = `${el.image}:${el.tag}`;
      return {
        argv: [
          'run',
          '--rm',
          '--entrypoint',
          'geth',
          '-v',
          `${spec.dataPath}/geth:/data/geth`,
          image,
          'snapshot',
          'prune-state',
          '--datadir',
          '/data/geth',
        ],
        notes: ['geth snapshot prune-state'],
      };
    }
    return {
      argv: [],
      notes: [`${el?.id ?? 'el'} prune is compose-profile (no one-shot CLI)`],
    };
  }
  if (spec.chain === 'btc') {
    return { argv: [], notes: ['bitcoind already uses -prune= in compose'] };
  }
  return { argv: [], notes: [] };
}

export function nativePruneArgvOk(argv: string[]): boolean {
  if (!argv.length) return true;
  return classifyDockerArgv(['docker', ...argv]) !== 'blocked';
}
