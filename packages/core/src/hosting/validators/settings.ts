/**
 * Global validators panel settings (auto-clear, etc.).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_VALIDATOR_SETTINGS,
  type ValidatorSettingsDto,
} from 'ysk-server-shared';

function settingsPath(dataDir: string): string {
  return join(dataDir, 'validators', 'settings.json');
}

export function loadValidatorSettings(dataDir: string): ValidatorSettingsDto {
  const p = settingsPath(dataDir);
  if (!existsSync(p)) return { ...DEFAULT_VALIDATOR_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<ValidatorSettingsDto>;
    return { autoClear: raw.autoClear === true };
  } catch {
    return { ...DEFAULT_VALIDATOR_SETTINGS };
  }
}

export function saveValidatorSettings(
  dataDir: string,
  next: ValidatorSettingsDto,
): ValidatorSettingsDto {
  mkdirSync(join(dataDir, 'validators'), { recursive: true });
  const out: ValidatorSettingsDto = { autoClear: next.autoClear === true };
  writeFileSync(settingsPath(dataDir), `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
