/**
 * Cardano adapter — official cardano-node image, relay-first.
 * Producer uses IntersectMBO CARDANO_BLOCK_PRODUCER env in merge mode.
 * The panel never generates keys; cold keys are refused on attach.
 */
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan, ValidatorNodeStatus } from './base.js';
import { v1ValidatorClients } from '../registry.js';
import { composeBind } from '../compose-runner.js';
import { adaProducerReady, producerKeysDirFromSpec } from '../ada-producer.js';

export function cardanoNetworkEnv(network: string): 'preview' | 'preprod' | 'mainnet' {
  if (network === 'mainnet' || network === 'preprod') return network;
  return 'preview';
}

const ADA_IMAGE = 'ghcr.io/intersectmbo/cardano-node';
const ADA_TAG = '11.0.1';

export function resolveAdaImage(spec: ValidatorInstanceDto): string {
  const node = spec.clients.node ?? v1ValidatorClients('ada')[0];
  const image = node?.image === 'inputoutput/cardano-node' || !node?.image ? ADA_IMAGE : node.image;
  const tag = node?.image === 'inputoutput/cardano-node' || !node?.tag ? ADA_TAG : node.tag;
  return `${image}:${tag}`;
}

export function buildAdaComposeYaml(spec: ValidatorInstanceDto): string {
  const img = resolveAdaImage(spec);
  const p2p = spec.ports.p2p ?? 3001;
  const metrics = spec.ports.metrics ?? 12798;
  const network = cardanoNetworkEnv(spec.network);
  const producer = adaProducerReady(spec);
  const keysDir = producerKeysDirFromSpec(spec);
  // Official 11.0.1 entrypoint: NETWORK alone is scripts mode (run-network) and
  // does not honour extra compose command flags. Merge mode (empty JSON merge)
  // plus CARDANO_BLOCK_PRODUCER is what run-node uses to add --shelley-* keys.
  const producerEnv = producer
    ? `      CARDANO_CONFIG_JSON_MERGE: "{}"
      CARDANO_BLOCK_PRODUCER: "true"
      CARDANO_SHELLEY_KES_KEY: /keys/kes.skey
      CARDANO_SHELLEY_VRF_KEY: /keys/vrf.skey
      CARDANO_SHELLEY_OPERATIONAL_CERTIFICATE: /keys/node.cert
`
    : '';
  const keysVol = producer ? `\n      - ${composeBind(keysDir, '/keys', 'ro')}` : '';
  return `# ysk-server validators ada — generated
# ${producer ? 'Block producer: official CARDANO_BLOCK_PRODUCER env. Hot keys mounted read-only. Cold keys stay offline.' : 'Relay-first. No block-producer keys. Mithril is one-click from the panel.'}
services:
  node:
    image: ${img}
    restart: unless-stopped
    environment:
      NETWORK: ${network}
${producerEnv}    ports:
      - "0.0.0.0:${p2p}:3001"
      - "127.0.0.1:${metrics}:12798"
    volumes:
      - ${composeBind(spec.dataPath, '/data')}${keysVol}
`;
}

export function planAdaInstall(spec: ValidatorInstanceDto): ValidatorHostPlan {
  const clients = v1ValidatorClients('ada');
  return {
    notes: adaProducerReady(spec)
      ? [
          'cardano-node block producer',
          'NETWORK env selects preview/preprod/mainnet',
          'hot keys kes/vrf/opcert only',
        ]
      : [
          'cardano-node relay',
          'NETWORK env selects preview/preprod/mainnet',
          'no block-producer keys',
          'mithril one-click restore available',
        ],
    composeYaml: buildAdaComposeYaml(spec),
    dataPath: spec.dataPath,
    images: clients.map((c) => `${c.image}:${c.tag}`),
    ports: spec.ports,
  };
}

/** Prometheus / EKG text — peers + whether a tip slot is present. */
export function parseAdaMetrics(text: string): {
  syncProgress: number | null;
  peers: number | null;
} {
  const peer =
    text.match(/cardano_node_metrics_connectedPeers_int\s+(\d+)/) ??
    text.match(/cardano_node_metrics_peersAsInt\s+(\d+)/);
  const slot = text.match(/cardano_node_metrics_slotNum_int\s+(\d+)/);
  const peers = peer ? Number(peer[1]) : null;
  const hasTip = slot ? Number(slot[1]) > 0 : false;
  return {
    peers: Number.isFinite(peers as number) ? peers : null,
    syncProgress: hasTip ? 1 : null,
  };
}

export async function probeAdaStatus(
  spec: ValidatorInstanceDto,
  fetchFn: typeof fetch = fetch,
): Promise<Pick<ValidatorNodeStatus, 'syncProgress' | 'peers' | 'version' | 'lastError'>> {
  const url = `http://127.0.0.1:${spec.ports.metrics ?? 12798}/metrics`;
  try {
    const res = await fetchFn(url);
    const parsed = parseAdaMetrics(await res.text());
    return { ...parsed, version: 'cardano-node', lastError: null };
  } catch (e) {
    return {
      syncProgress: null,
      peers: null,
      version: null,
      lastError: e instanceof Error ? e.message : 'metrics unreachable',
    };
  }
}
