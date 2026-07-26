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
  writeControlPlaneSystemdUnit,
} from '@ysk/core';
import { CLI_NAME, PRODUCT_NAME, type StructuredResult } from '@ysk/shared';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

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
      message: `設定已存在於 ${configPath}。使用 --force 覆寫。`,
      error: {
        code: 'YSK_SETUP_EXISTS',
        message: `設定已存在於 ${configPath}`,
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
      `${PRODUCT_NAME} data directory\nCLI: ${CLI_NAME}\nDB: ysk.json\n`,
      'utf8',
    );

    // Systemd unit template for control plane
    const cliPath = resolveCliPath();
    const { unitPath } = writeControlPlaneSystemdUnit({
      dataDir,
      cliPath,
      nodePath: process.execPath,
    });
    mkdirSync(join(dataDir, 'systemd'), { recursive: true });

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
      detail: { dataDir, configPath, dbPath, unitPath },
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
          `Start (API + Web UI): ${CLI_NAME} serve --config ${configPath}`,
          `Open http://${config.listenHost}:${config.listenPort}/ and login as ${config.adminUsername}`,
          `Systemd unit template: ${unitPath}`,
          `Install unit (root + YSK_EXECUTE): ${CLI_NAME} system unit-install --enable --data-dir ${dataDir}`,
          'Production host mutations require YSK_EXECUTE=1 and root',
          'See docs/deploy/production-mvp.md',
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

function resolveCliPath(): string {
  try {
    // setup.js lives in dist/cli/ or src/cli/
    const here = dirname(fileURLToPath(import.meta.url));
    const distCli = join(here, '..', 'cli.js');
    if (existsSync(distCli)) return distCli;
    return join(here, 'cli.js');
  } catch {
    return 'ysk-server';
  }
}
