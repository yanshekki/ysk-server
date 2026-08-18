import { isSafeValidatorDataPath } from 'ysk-server-shared';

/** Wizard gates for validator create — last-step Install must match step-2 ack. */

export function validatorWizardCanInstall(input: {
  dockerInstalled: boolean | null;
  hasSpec: boolean;
  isMainnet: boolean;
  mainnetAck: boolean;
  diskShort: boolean;
  customPath?: boolean;
  dataPath?: string;
}): boolean {
  return validatorWizardBlockReason(input) == null;
}

export type WizardBlockReason = 'docker' | 'spec' | 'mainnet' | 'disk' | 'path';

export function validatorWizardBlockReason(input: {
  dockerInstalled: boolean | null;
  hasSpec: boolean;
  isMainnet: boolean;
  mainnetAck: boolean;
  diskShort: boolean;
  customPath?: boolean;
  dataPath?: string;
}): WizardBlockReason | null {
  if (input.dockerInstalled !== true) return 'docker';
  if (!input.hasSpec) return 'spec';
  if (input.isMainnet && !input.mainnetAck) return 'mainnet';
  if (input.diskShort && !(input.isMainnet && input.mainnetAck)) return 'disk';
  if (input.customPath && !isSafeValidatorDataPath(String(input.dataPath ?? '').trim())) {
    return 'path';
  }
  return null;
}

export function previewInstanceId(
  existingIds: string[],
  chain: string,
  network: string,
): string {
  const prefix = `${chain}-${network}-`;
  const used = new Set(existingIds);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function previewComposeProject(id: string): string {
  return `yskval-${id}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 48);
}

export function defaultDataPath(rootPath: string | undefined, id: string): string {
  const root = String(rootPath || '/var/lib/ysk-server/validators').replace(/\/+$/, '');
  return `${root}/${id}/data`;
}
