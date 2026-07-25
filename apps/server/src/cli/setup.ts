/**
 * ysk-server setup — initialize control plane config skeleton.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildConfigFromSetup } from '@ysk/core';
import { CLI_NAME, PRODUCT_NAME, type StructuredResult } from '@ysk/shared';

export interface SetupOptions {
  dataDir?: string;
  listenHost?: string;
  listenPort?: number;
  adminUsername?: string;
  locale?: string;
  nonInteractive?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

/**
 * Run setup: write config skeleton under dataDir.
 */
export function runSetup(opts: SetupOptions = {}): StructuredResult<{
  configPath: string;
  config: ReturnType<typeof buildConfigFromSetup>;
  nextSteps: string[];
}> {
  const dataDir = opts.dataDir ?? join(process.cwd(), '.ysk');
  const configPath = join(dataDir, 'config.json');

  if (existsSync(configPath) && !opts.force && !opts.dryRun) {
    return {
      ok: false,
      code: 'YSK_SETUP_EXISTS',
      message: `Config already exists at ${configPath}. Use --force to overwrite.`,
      error: {
        code: 'YSK_SETUP_EXISTS',
        message: `Config already exists at ${configPath}`,
      },
    };
  }

  try {
    const config = buildConfigFromSetup({
      dataDir,
      listenHost: opts.listenHost ?? '127.0.0.1',
      listenPort: opts.listenPort ?? 8787,
      adminUsername: opts.adminUsername ?? 'admin',
      locale: opts.locale ?? 'zh-TW',
      nonInteractive: Boolean(opts.nonInteractive),
    });

    if (opts.dryRun) {
      return {
        ok: true,
        code: 'YSK_SETUP_DRY_RUN',
        message: `${PRODUCT_NAME} setup dry-run OK`,
        data: {
          configPath,
          config,
          nextSteps: ['Re-run without --dry-run to write config'],
        },
      };
    }

    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    mkdirSync(join(dataDir, 'backups'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    writeFileSync(
      join(dataDir, 'README.txt'),
      `${PRODUCT_NAME} data directory\nCLI: ${CLI_NAME}\n`,
      'utf8',
    );

    return {
      ok: true,
      code: 'YSK_SETUP_OK',
      message: `${PRODUCT_NAME} setup completed`,
      data: {
        configPath,
        config,
        nextSteps: [
          `Start control plane: ${CLI_NAME} serve --config ${configPath}`,
          `Open Web UI and login as ${config.adminUsername}`,
          'Configure LLM provider (OpenAI-compatible) in settings',
          'Review security docs: docs/security/',
        ],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 'YSK_SETUP_FAILED',
      message,
      error: { code: 'YSK_SETUP_FAILED', message },
    };
  }
}
