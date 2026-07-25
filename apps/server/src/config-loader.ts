/**
 * Load setup-written config.json for serve.
 */

import { existsSync, readFileSync } from 'node:fs';
import { parseConfig, type YskConfig } from '@ysk/core';
import { ErrorCodes, YskError } from '@ysk/shared';

/**
 * Load and parse a YSK config file path produced by `ysk-server setup`.
 */
export function loadConfigFile(configPath: string): YskConfig {
  if (!configPath) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, 'config path is required', { httpStatus: 400 });
  }
  if (!existsSync(configPath)) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, `Config file not found: ${configPath}`, {
      httpStatus: 400,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new YskError(ErrorCodes.CONFIG_INVALID, `Failed to parse config: ${configPath}`, {
      httpStatus: 400,
      cause: err,
    });
  }
  return parseConfig(raw);
}
