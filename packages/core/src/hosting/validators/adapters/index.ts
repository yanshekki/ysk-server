import type { ValidatorChainId, ValidatorInstanceDto } from 'ysk-server-shared';
import type { ValidatorHostPlan } from './base.js';
import { planEthInstall } from './eth.js';
import { planAvaxInstall } from './avax.js';
import { planNearInstall } from './near.js';
import { planAdaInstall } from './ada.js';
import {
  planAptosInstall,
  planBtcInstall,
  planCosmosInstall,
  planDotInstall,
  planSolInstall,
  planSuiInstall,
} from './phase2.js';
import { stubComposeYaml } from '../compose-runner.js';

export function planInstallFor(spec: ValidatorInstanceDto): ValidatorHostPlan {
  if (spec.chain === 'eth') return planEthInstall(spec);
  if (spec.chain === 'avax') return planAvaxInstall(spec);
  if (spec.chain === 'near') return planNearInstall(spec);
  if (spec.chain === 'ada') return planAdaInstall(spec);
  if (spec.chain === 'btc') return planBtcInstall(spec);
  if (spec.chain === 'cosmos') return planCosmosInstall(spec);
  if (spec.chain === 'sui') return planSuiInstall(spec);
  if (spec.chain === 'aptos') return planAptosInstall(spec);
  if (spec.chain === 'dot') return planDotInstall(spec);
  if (spec.chain === 'sol') return planSolInstall(spec);
  return {
    notes: ['stub'],
    composeYaml: stubComposeYaml(spec),
    dataPath: spec.dataPath,
    images: Object.values(spec.clients).map((c) => `${c.image}:${c.tag}`),
    ports: spec.ports,
  };
}

export function adapterId(chain: ValidatorChainId): ValidatorChainId {
  return chain;
}
