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
  hardenDataDirPerms,
} from 'ysk-server-core';
import { CLI_NAME, PRODUCT_NAME, type StructuredResult, tl } from 'ysk-server-shared';
import { assessPassword, isBootstrapDefaultPassword } from 'ysk-server-core';
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
  /**
   * Allow weak/default bootstrap password (dev only).
   * Production must pass a strong --admin-password or YSK_ADMIN_PASSWORD.
   */
  allowInsecureDefaults?: boolean;
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
      message: tl('notes.auto.t0792', { v0: (configPath) }),
      error: {
        code: 'YSK_SETUP_EXISTS',
        message: tl('notes.auto.t0793', { v0: (configPath) }),
      },
    };
  }

  try {
    const config = buildConfigFromSetup({
      dataDir,
      listenHost: opts.listenHost ?? '127.0.0.1',
      listenPort: opts.listenPort ?? 9287,
      adminUsername: opts.adminUsername ?? 'admin',
      locale: opts.locale ?? 'zh-HK',
      nonInteractive: Boolean(opts.nonInteractive),
    });

    if (opts.dryRun) {
      return {
        ok: true,
        code: 'YSK_SETUP_DRY_RUN',
        message: tl('cli.setup.dryRunOk', { product: PRODUCT_NAME }),
        data: {
          configPath,
          dbPath,
          config,
          nextSteps: [tl('cli.setup.dryRunNext')],
        },
      };
    }

    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, 'logs'), { recursive: true });
    mkdirSync(join(dataDir, 'backups'), { recursive: true });
    mkdirSync(join(dataDir, 'projects'), { recursive: true });
    mkdirSync(join(dataDir, 'nginx', 'conf.d'), { recursive: true });
    // §2.3 — other users must not read control-plane JSON (install + setup)
    const perms = hardenDataDirPerms(dataDir);
    if (!perms.ok) {
      // Non-fatal: readiness still flags + UI one-click fix
      console.warn(`[setup] dataDir chmod 750 failed: ${perms.notes.join('; ')}`);
    }

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
    const auth = new AuthService(users, sessions, audit, db, dataDir);
    const password = opts.adminPassword ?? process.env.YSK_ADMIN_PASSWORD ?? 'admin';
    const policy = assessPassword(password);
    const insecure =
      !policy.ok || isBootstrapDefaultPassword(password);
    const allowInsecure =
      opts.allowInsecureDefaults === true ||
      process.env.YSK_ALLOW_INSECURE_DEFAULTS === '1' ||
      process.env.YSK_ALLOW_INSECURE_DEFAULTS === 'true';
    if (insecure && !allowInsecure) {
      closeDatabase(db);
      return {
        ok: false,
        code: 'YSK_SETUP_WEAK_PASSWORD',
        message: tl('cli.setup.weakPassword'),
        error: {
          code: 'YSK_SETUP_WEAK_PASSWORD',
          message: tl('cli.setup.weakPasswordShort'),
          details: { reasons: policy.reasons },
        },
      };
    }
    // force recreate admin when --force
    if (opts.force && users.findByUsername(config.adminUsername)) {
      // leave existing password if user exists; ensureAdmin no-ops
    }
    auth.ensureAdmin(config.adminUsername, password, config.locale);

    // Production hardening defaults in settings
    if (!insecure) {
      db.snapshot.settings['security.require_admin_totp'] =
        db.snapshot.settings['security.require_admin_totp'] ?? '0';
      db.snapshot.settings['security.require_user_totp'] =
        db.snapshot.settings['security.require_user_totp'] ?? '0';
    } else {
      // Insecure bootstrap: force change + recommend 2FA
      db.snapshot.settings['security.bootstrap_insecure'] = '1';
    }
    // Prefer loopback unless operator explicitly chose otherwise
    if (config.listenHost === '0.0.0.0' || config.listenHost === '::') {
      db.snapshot.settings['security.listen_public'] = '1';
    }
    db.persist();

    audit.append({
      actor: 'system',
      action: 'setup.complete',
      detail: {
        dataDir,
        configPath,
        dbPath,
        unitPath,
        insecureBootstrap: insecure,
        listenHost: config.listenHost,
      },
      ok: true,
    });
    closeDatabase(db);

    const nextSteps = [
      tl('cli.setup.nextStart', { cli: CLI_NAME, configPath }),
      tl('cli.setup.nextOpen', {
        host: config.listenHost,
        port: config.listenPort,
        user: config.adminUsername,
      }),
      tl('cli.setup.nextUnit', { unitPath }),
      tl('cli.setup.nextInstall', { cli: CLI_NAME, dataDir }),
      tl('cli.setup.nextExecute'),
      tl('cli.setup.nextGolive'),
    ];
    if (insecure) {
      nextSteps.unshift(tl('cli.setup.secPassword'), tl('cli.setup.sec2fa'));
    }
    if (config.listenHost === '0.0.0.0' || config.listenHost === '::') {
      nextSteps.unshift(tl('cli.setup.secListen'));
    }

    return {
      ok: true,
      code: 'YSK_SETUP_OK',
      message: insecure
        ? tl('cli.setup.okInsecure', { product: PRODUCT_NAME })
        : tl('cli.setup.ok', { product: PRODUCT_NAME }),
      data: {
        configPath,
        dbPath,
        config,
        nextSteps,
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
