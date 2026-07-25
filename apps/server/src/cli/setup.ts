/**
 * ysk-server setup — init dataDir, SQLite DB, admin user, config.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  AuthService,
  UserRepository,
  SessionRepository,
  AuditRepository,
  buildConfigFromSetup,
  openDatabase,
  closeDatabase,
} from '@ysk/core';
import { CLI_NAME, PRODUCT_NAME, type StructuredResult } from '@ysk/shared';

export interface SetupOptions {
  dataDir?: string;
  listenHost?: string;
  listenPort?: number;
  adminUsername?: string;
  adminPassword?: string;
  locale?: string;
  nonInteractive?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

/**
 * Run setup: write config + initialize SQLite + bootstrap admin.
 */
export function runSetup(opts: SetupOptions = {}): StructuredResult<{
  configPath: string;
  dbPath: string;
  config: ReturnType<typeof buildConfigFromSetup>;
  nextSteps: string[];
}> {
  const dataDir = opts.dataDir ?? join(process.cwd(), '.ysk');
  const configPath = join(dataDir, 'config.json');
  const dbPath = join(dataDir, 'ysk.json');

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
          dbPath,
          config,
          nextSteps: ['Re-run without --dry-run to write config and initialize database'],
        },
      };
    }

    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    mkdirSync(join(dataDir, 'backups'), { recursive: true });
    mkdirSync(join(dataDir, 'projects'), { recursive: true });
    mkdirSync(join(dataDir, 'nginx', 'conf.d'), { recursive: true });

    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    writeFileSync(
      join(dataDir, 'README.txt'),
      `${PRODUCT_NAME} data directory\nCLI: ${CLI_NAME}\nDB: ysk.sqlite\n`,
      'utf8',
    );

    // Real DB init + admin
    const db = openDatabase(dbPath);
    const users = new UserRepository(db);
    const sessions = new SessionRepository(db);
    const audit = new AuditRepository(db);
    const auth = new AuthService(users, sessions, audit);
    const password = opts.adminPassword ?? process.env.YSK_ADMIN_PASSWORD ?? 'admin';
    // force recreate admin when --force
    if (opts.force && users.findByUsername(config.adminUsername)) {
      // leave existing password if user exists; ensureAdmin no-ops
    }
    auth.ensureAdmin(config.adminUsername, password, config.locale);
    audit.append({
      actor: 'system',
      action: 'setup.complete',
      detail: { dataDir, configPath, dbPath },
      ok: true,
    });
    closeDatabase(db);

    return {
      ok: true,
      code: 'YSK_SETUP_OK',
      message: `${PRODUCT_NAME} setup completed (database initialized)`,
      data: {
        configPath,
        dbPath,
        config,
        nextSteps: [
          `Start control plane: ${CLI_NAME} serve --config ${configPath}`,
          `Open Web UI and login as ${config.adminUsername}`,
          'Set YSK_EXECUTE=1 to enable mutating host tools outside dataDir',
          'Configure LLM: POST /api/v1/settings/llm or env YSK_LLM_BASE_URL',
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
