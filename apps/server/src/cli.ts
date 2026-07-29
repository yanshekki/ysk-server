#!/usr/bin/env node
/**
 * YSK Server CLI — AI-agent friendly structured output.
 */

import {
  CLI_NAME,
  PRODUCT_NAME,
  ErrorCodes,
  YskError,
  type StructuredResult,
} from '@ysk/shared';
import {
  createDefaultAllowlist,
  installControlPlaneSystemd,
  listAgentRuntimes,
  planSelfUpdate,
} from '@ysk/core';
import { createAppContext, closeAppContext } from './app-context.js';
import { createHttpServer, listen } from './http-server.js';
import { runSetup } from './cli/setup.js';
import { runUpdate } from './cli/update.js';
import { loadConfigFile } from './config-loader.js';
import { VERSION } from './version.js';
import { resolveWebRoot } from './http/static.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/** Commands listed for humans + AI (`--json` help). */
const CLI_COMMANDS = [
  'setup',
  'update',
  'serve',
  'system',
  'tools',
  'ask',
  'projects',
  'backup',
  'templates',
  'hosting',
  'dns',
  'logs',
  'host',
  'nginx',
  'ssl',
  'services',
  'defense',
  'protection',
  'agents',
  'agent',
  'readiness',
  'doctor',
  'version',
  'help',
] as const;

/**
 * Map structured result → CLI exit code.
 * Contract: 0 ok · 1 error · 2 validation · 3 blocked · 4 not_found · 5 host_error
 */
function exitFromResult(r: {
  ok?: boolean;
  blocked?: boolean;
  code?: string;
  status?: string;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  allowed?: boolean;
  applyStatus?: string;
  dryRun?: boolean;
  executed?: boolean;
}): number {
  if (r.blocked) return 3;
  // Plan-only success (default for dangerous CLI ops)
  if (r.dryRun === true && r.ok !== false) return 0;
  const code = r.code ?? '';
  if (
    code === ErrorCodes.VALIDATION ||
    code === ErrorCodes.CONFIG_INVALID ||
    code === 'YSK_VALIDATION' ||
    code === 'validation'
  ) {
    return 2;
  }
  if (code === ErrorCodes.NOT_FOUND || code === 'YSK_NOT_FOUND' || code === 'not_found') {
    return 4;
  }
  if (
    code === ErrorCodes.FORBIDDEN ||
    code === ErrorCodes.ALLOWLIST_DENIED ||
    code === ErrorCodes.APPROVAL_REQUIRED ||
    code === ErrorCodes.UNAUTHORIZED ||
    code === 'blocked'
  ) {
    return 3;
  }
  if (code === 'host_error' || code === 'YSK_HOST_ERROR') return 5;
  if (r.allowed === false) return 3;
  if (r.ok === false) {
    // Honest “written only / needs EXECUTE” is still success for file write paths
    if (r.applyStatus === 'written' && r.requiresExecute) return 0;
    return 1;
  }
  if (r.status && ['failed', 'error'].includes(String(r.status))) return 1;
  if (r.applyStatus === 'failed') return 1;
  return 0;
}

/** Map thrown YskError → exit code */
function exitFromError(err: unknown): number {
  if (err instanceof YskError) {
    if (err.code === ErrorCodes.VALIDATION || err.code === ErrorCodes.CONFIG_INVALID) return 2;
    if (err.code === ErrorCodes.NOT_FOUND) return 4;
    if (
      err.code === ErrorCodes.FORBIDDEN ||
      err.code === ErrorCodes.ALLOWLIST_DENIED ||
      err.code === ErrorCodes.APPROVAL_REQUIRED ||
      err.code === ErrorCodes.UNAUTHORIZED ||
      err.code === ErrorCodes.SANDBOX_VIOLATION
    ) {
      return 3;
    }
    return 1;
  }
  return 1;
}

function printCliError(err: unknown, json: boolean): number {
  if (err instanceof YskError) {
    if (json) {
      printJson({
        ok: false,
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        httpStatus: err.httpStatus,
      });
    } else {
      process.stderr.write(`${err.code}: ${err.message}\n`);
    }
    return exitFromError(err);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (json) printJson({ ok: false, code: ErrorCodes.INTERNAL, message: msg });
  else process.stderr.write(`${msg}\n`);
  return 1;
}

function openCliContext(args: string[]) {
  const configPath = getOpt(args, '--config');
  const dataDir = getOpt(args, '--data-dir');
  let config = configPath ? loadConfigFile(configPath) : undefined;
  if (dataDir) {
    config = config ? { ...config, dataDir } : ({ dataDir } as NonNullable<typeof config>);
  }
  return createAppContext({
    version: VERSION,
    config,
    configPath,
    dataDir: dataDir ?? config?.dataDir,
    executeEnabled: process.env.YSK_EXECUTE === '1',
  });
}

function printHelp(): void {
  const text = `
${PRODUCT_NAME} (${CLI_NAME}) v${VERSION}

Control plane CLI — prefer --json for AI agents.
Docs: docs/agent/README.md · docs/cli/reference.md · docs/agent/commands.json

Usage:
  ${CLI_NAME} <command> [options]

Commands:
  setup                 Init dataDir + admin
  update                Self-update check/apply
  serve                 HTTP API + Web UI
  system unit-install   Install ysk-server.service [--enable]
  tools                 List tools; tools run --tool <name> [--dry-run]
  ask                   NL → AI plan [--execute]
  projects              list|get|create|deploy|stop|health|backup|template
  backup all            Backup all project homes
  templates             App templates
  hosting               nginx|dns|db|firewall helpers
  dns                   zone|zones (AI alias → hosting dns-*)
  logs                  sources|query|journal|overview
  host                  overview|metrics (read-only)
  nginx                 status|list|test|sync
  ssl                   list|get (certificates)
  services              Host service matrix (systemctl probe)
  defense | protection  status|ban|unban|whitelist
  agents                List/probe agent runtimes (experimental)
  agent run             Outbound fleet poller (experimental)
  readiness | doctor    Production readiness (honest)
  version | help

Global:
  --json                JSON stdout (AI)
  --data-dir PATH
  --config PATH
  --help | --version

Exit: 0 ok · 1 error · 2 validation · 3 blocked · 4 not found · 5 host error

Safety:
  Dangerous ops default to dry-run (plan only).
  Pass --execute (alias --apply) + env YSK_EXECUTE=1 to mutate host.

Examples:
  ${CLI_NAME} readiness --json
  ${CLI_NAME} host --json
  ${CLI_NAME} nginx status --json
  ${CLI_NAME} ssl list --json
  ${CLI_NAME} projects get --id UUID --json
  ${CLI_NAME} defense ban --ip 1.2.3.4 --json          # dry-run plan
  ${CLI_NAME} projects list --json
  ${CLI_NAME} logs query --source journal: --lines 100 --json
  ${CLI_NAME} tools --json
`.trim();
  process.stdout.write(`${text}\n`);
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function getOpt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
  return undefined;
}

/**
 * Dangerous host mutations: CLI defaults to dry-run.
 * Pass --execute (or legacy --apply) to attempt real change.
 * Still requires YSK_EXECUTE=1 (and often root) on the host.
 */
function wantsHostExecute(args: string[]): boolean {
  return hasFlag(args, '--execute') || hasFlag(args, '--apply');
}

function printVersion(json: boolean): void {
  if (json) {
    printJson({ ok: true, product: PRODUCT_NAME, cli: CLI_NAME, version: VERSION });
  } else {
    process.stdout.write(`${PRODUCT_NAME} ${CLI_NAME}/${VERSION}\n`);
  }
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const json = hasFlag(args, '--json');
  const command = args.find((a) => !a.startsWith('-'));

  // Global flags must win over default-to-help when only flags are present
  if (hasFlag(args, '--version') || hasFlag(args, '-V')) {
    printVersion(json);
    return 0;
  }

  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    if (json) {
      printJson({
        ok: true,
        product: PRODUCT_NAME,
        cli: CLI_NAME,
        version: VERSION,
        commands: [...CLI_COMMANDS],
        docs: ['docs/agent/README.md', 'docs/cli/reference.md', 'docs/agent/commands.json'],
        exitCodes: { 0: 'ok', 1: 'error', 2: 'validation', 3: 'blocked', 4: 'not_found', 5: 'host_error' },
      });
    } else {
      printHelp();
    }
    return 0;
  }

  if (!command || command === 'help') {
    if (json) {
      printJson({
        ok: true,
        product: PRODUCT_NAME,
        cli: CLI_NAME,
        version: VERSION,
        commands: [...CLI_COMMANDS],
        docs: ['docs/agent/README.md', 'docs/cli/reference.md', 'docs/agent/commands.json'],
        exitCodes: { 0: 'ok', 1: 'error', 2: 'validation', 3: 'blocked', 4: 'not_found', 5: 'host_error' },
      });
    } else {
      printHelp();
    }
    return 0;
  }

  if (command === 'version') {
    printVersion(json);
    return 0;
  }

  if (command === 'setup') {
    const result = runSetup({
      dataDir: getOpt(args, '--data-dir'),
      listenHost: getOpt(args, '--host'),
      listenPort: getOpt(args, '--port') ? Number(getOpt(args, '--port')) : undefined,
      locale: getOpt(args, '--locale'),
      nonInteractive: hasFlag(args, '--non-interactive'),
      dryRun: hasFlag(args, '--dry-run'),
      force: hasFlag(args, '--force'),
    });
    if (json || hasFlag(args, '--dry-run')) {
      printJson(result);
    } else if (result.ok) {
      process.stdout.write(`${result.message}\n`);
      process.stdout.write(`Config: ${result.data?.configPath}\n`);
      for (const step of result.data?.nextSteps ?? []) {
        process.stdout.write(`  - ${step}\n`);
      }
    } else {
      process.stderr.write(`${result.message}\n`);
    }
    return result.ok ? 0 : 1;
  }

  if (command === 'update') {
    const result = await runUpdate({
      checkOnly: hasFlag(args, '--check'),
      latest: getOpt(args, '--latest'),
      apply: hasFlag(args, '--apply'),
    });
    if (json) printJson(result);
    else process.stdout.write(`${result.message}\n`);
    return result.ok ? 0 : 1;
  }

  if (command === 'tools') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0];
    if (sub === 'run') {
      const tool = getOpt(args, '--tool');
      if (!tool) {
        process.stderr.write('Usage: ysk-server tools run --tool <name> [--arg key=val] [--dry-run]\n');
        return 1;
      }
      const argPairs = args
        .map((a, i) => (a === '--arg' ? args[i + 1] : null))
        .filter(Boolean) as string[];
      const toolArgs: Record<string, unknown> = {};
      for (const p of argPairs) {
        const eq = p.indexOf('=');
        if (eq > 0) toolArgs[p.slice(0, eq)] = p.slice(eq + 1);
      }
      const { createAppContext, closeAppContext } = await import('./app-context.js');
      const { executeToolCall } = await import('@ysk/core');
      const configPath = getOpt(args, '--config');
      const config = configPath ? (await import('./config-loader.js')).loadConfigFile(configPath) : undefined;
      const ctx = createAppContext({ version: VERSION, config, configPath });
      try {
        const result = await executeToolCall(
          { tool, args: toolArgs, dryRun: hasFlag(args, '--dry-run') },
          {
            allowlist: ctx.allowlist,
            approvals: ctx.approvals,
            actor: 'cli',
            roles: ['admin'],
            host: ctx.host,
            audit: ctx.audit,
            protection: ctx.protection,
            dataDir: ctx.dataDir,
          },
        );
        printJson(result);
        return exitFromResult({
          ok: result.allowed,
          blocked: !result.allowed,
          code: result.allowed ? undefined : 'blocked',
          allowed: result.allowed,
        });
      } finally {
        closeAppContext(ctx);
      }
    }
    const tools = createDefaultAllowlist().list();
    const payload: StructuredResult = {
      ok: true,
      code: 'YSK_TOOLS',
      message: 'Allowlist 工具清單',
      data: tools,
    };
    printJson(payload);
    return 0;
  }

  if (command === 'agents') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0];
    if (sub === 'probe' || hasFlag(args, '--probe')) {
      const configPath = getOpt(args, '--config');
      const dataDir = getOpt(args, '--data-dir');
      let config = configPath ? loadConfigFile(configPath) : undefined;
      if (dataDir) {
        config = config ? { ...config, dataDir } : ({ dataDir } as NonNullable<typeof config>);
      }
      const { createAppContext, closeAppContext } = await import('./app-context.js');
      const { probeAllAgentRuntimes } = await import('@ysk/core');
      const ctx = createAppContext({
        version: VERSION,
        config,
        dataDir: dataDir ?? config?.dataDir,
      });
      try {
        printJson({ ok: true, items: await probeAllAgentRuntimes(ctx.host) });
        return 0;
      } finally {
        closeAppContext(ctx);
      }
    }
    const data = listAgentRuntimes();
    if (json) printJson({ ok: true, code: 'YSK_AGENTS', message: 'Agent 運行時', data });
    else {
      for (const a of data) process.stdout.write(`${a.kind}\t${a.name}\t${a.status}\n`);
    }
    return 0;
  }

  if (command === 'agent') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'run';
    if (sub !== 'run') {
      process.stderr.write('Usage: ysk-server agent run --control-plane URL --id AGENT_ID [--group g]\n');
      return 2;
    }
    const controlPlane = getOpt(args, '--control-plane') ?? 'http://127.0.0.1:9287';
    const agentId = getOpt(args, '--id') ?? `agent-${process.pid}`;
    const group = getOpt(args, '--group');
    const intervalMs = Number(getOpt(args, '--interval') ?? 5000);
    const { runOutboundAgent } = await import('@ysk/core');
    process.stdout.write(
      `YSK outbound agent ${agentId} → ${controlPlane} (interval ${intervalMs}ms)\n`,
    );
    const ac = new AbortController();
    process.on('SIGINT', () => ac.abort());
    process.on('SIGTERM', () => ac.abort());
    await runOutboundAgent({
      controlPlane,
      agentId,
      group,
      intervalMs,
      signal: ac.signal,
      onCommand: async (cmd) => {
        process.stdout.write(`[cmd ${cmd.id}] ${JSON.stringify(cmd.payload)}\n`);
        // Preferred payload: { "cli": ["projects", "list", "--json"] } — runs this binary only
        const payload = cmd.payload as { cli?: string[]; op?: string };
        if (Array.isArray(payload?.cli) && payload.cli.length > 0) {
          const { spawnSync } = await import('node:child_process');
          const bin = process.argv[1] ?? 'ysk-server';
          const argv = payload.cli.map(String);
          if (!argv.includes('--json')) argv.push('--json');
          const r = spawnSync(process.execPath, [bin, ...argv], {
            encoding: 'utf8',
            env: process.env,
            timeout: 120_000,
          });
          let parsed: unknown = r.stdout;
          try {
            parsed = JSON.parse(r.stdout || 'null');
          } catch {
            /* raw */
          }
          return {
            ok: r.status === 0,
            exitCode: r.status ?? 1,
            result: parsed,
            stderr: (r.stderr || '').slice(0, 4000),
            at: new Date().toISOString(),
          };
        }
        // Legacy demos
        if (payload?.op === 'ping') {
          return { ok: true, op: 'pong', at: new Date().toISOString() };
        }
        return {
          ok: true,
          echo: cmd.payload,
          note: 'Pass { "cli": ["projects", "list"] } to run ysk-server CLI',
          at: new Date().toISOString(),
        };
      },
    });
    return 0;
  }

  if (command === 'ask') {
    const prompt = args.filter((a) => !a.startsWith('-')).slice(1).join(' ');
    if (!prompt) {
      process.stderr.write('Usage: ysk-server ask "check system info"\n');
      return 2;
    }
    const configPath = getOpt(args, '--config');
    const config = configPath ? loadConfigFile(configPath) : undefined;
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const ctx = createAppContext({ version: VERSION, config, configPath });
    try {
      const task = await ctx.ai.create(prompt, 'cli', false);
      if (hasFlag(args, '--execute')) {
        ctx.ai.approve(task.id, 'cli');
        const done = await ctx.ai.execute(task.id, 'cli', ['admin']);
        printJson(done);
        return done.status === 'completed' ? 0 : 1;
      }
      printJson(task);
      return 0;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'templates') {
    const { listAppTemplates } = await import('@ysk/core');
    printJson({ ok: true, items: listAppTemplates() });
    return 0;
  }

  if (command === 'backup') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'all';
    if (sub !== 'all') {
      process.stderr.write('Usage: ysk-server backup all [--data-dir <path>] [--config <path>]\n');
      return 2;
    }
    const configPath = getOpt(args, '--config');
    const dataDir = getOpt(args, '--data-dir');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    if (dataDir) {
      config = config ? { ...config, dataDir } : ({ dataDir } as NonNullable<typeof config>);
    }
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const { backupAllProjects, getBackupExclusions } = await import('@ysk/core');
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDir ?? config?.dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1',
    });
    try {
      const projects = ctx.db.snapshot.projects.map((p) => ({
        id: p.id,
        home_dir: p.home_dir,
        name: p.name,
      }));
      const excludes = getBackupExclusions(ctx.db);
      const r = await backupAllProjects({
        host: ctx.host,
        dataDir: ctx.dataDir,
        projects,
        excludes: excludes.length ? excludes : ['node_modules', '.git', 'vendor', '.cache'],
      });
      for (const item of r.results) {
        if (item.ok && item.archivePath && !item.skipped) {
          const p = ctx.db.snapshot.projects.find((x) => x.id === item.projectId);
          if (p) {
            p.last_backup_path = item.archivePath;
            p.last_backup_at = new Date().toISOString();
            p.updated_at = new Date().toISOString();
          }
        }
      }
      ctx.db.persist();
      ctx.settings.setJson('last_backup_run', {
        at: new Date().toISOString(),
        ...r,
        via: 'cli',
      });
      printJson({ ...r, ok: r.ok });
      return r.ok ? 0 : 1;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'projects') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'list';
    const configPath = getOpt(args, '--config');
    const dataDir = getOpt(args, '--data-dir');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    if (dataDir) {
      config = config ? { ...config, dataDir } : ({ dataDir } as NonNullable<typeof config>);
    }
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDir ?? config?.dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1',
    });
    try {
      if (sub === 'list') {
        printJson({ ok: true, items: ctx.projects.list() });
        return 0;
      }
      if (sub === 'get' || sub === 'show' || sub === 'info') {
        const id = getOpt(args, '--id') ?? getOpt(args, '--name');
        if (!id) {
          process.stderr.write(
            'Usage: ysk-server projects get --id <projectId|name> [--json]\n',
          );
          return 2;
        }
        // Prefer UUID id; fall back to name match for agents
        try {
          const project = ctx.projects.get(id);
          printJson({ ok: true, project });
          return 0;
        } catch (err) {
          if (err instanceof YskError && err.code === ErrorCodes.NOT_FOUND) {
            const byName = ctx.projects
              .list()
              .find((p) => p.name === id || p.domain === id);
            if (byName) {
              printJson({ ok: true, project: byName });
              return 0;
            }
            printJson({
              ok: false,
              code: ErrorCodes.NOT_FOUND,
              message: `找不到專案：${id}`,
            });
            return 4;
          }
          throw err;
        }
      }
      if (sub === 'create') {
        const name = getOpt(args, '--name');
        if (!name) {
          process.stderr.write(
            'Usage: ysk-server projects create --name <name> [--domain d] [--runtime node|php|static|python|go|rust] [--template id]\n',
          );
          return 2;
        }
        const runtimeRaw = getOpt(args, '--runtime') ?? 'node';
        const runtime =
          runtimeRaw === 'php' ||
          runtimeRaw === 'static' ||
          runtimeRaw === 'node' ||
          runtimeRaw === 'python' ||
          runtimeRaw === 'go' ||
          runtimeRaw === 'rust'
            ? runtimeRaw
            : 'node';
        const created = await ctx.projects.create({
          name,
          domain: getOpt(args, '--domain'),
          runtime,
          runtimeVersion: getOpt(args, '--runtime-version'),
          templateId: getOpt(args, '--template'),
          forceTemplate: hasFlag(args, '--force'),
          actor: 'cli',
        });
        printJson(created);
        return 0;
      }
      if (sub === 'deploy') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write('Usage: ysk-server projects deploy --id <projectId>\n');
          return 2;
        }
        const proj = ctx.projects.get(id);
        const result =
          proj.runtime === 'php'
            ? await ctx.projectOps.deployPhp(id, {
                actor: 'cli',
                preferFpm: hasFlag(args, '--fpm'),
                forceBuiltin: hasFlag(args, '--builtin'),
              })
            : proj.runtime === 'static'
              ? await ctx.projectOps.deployStatic(id, {
                  actor: 'cli',
                  reload: hasFlag(args, '--reload'),
                })
              : proj.runtime === 'python' ||
                  proj.runtime === 'go' ||
                  proj.runtime === 'rust'
                ? await ctx.projectOps.deployProcess(id, { actor: 'cli' })
                : await ctx.projectOps.deployNode(id, { actor: 'cli' });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'stop') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write('Usage: ysk-server projects stop --id <projectId>\n');
          return 2;
        }
        const result = await ctx.projectOps.stopNode(id, 'cli');
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'backup') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write('Usage: ysk-server projects backup --id <projectId>\n');
          return 2;
        }
        const result = await ctx.projectOps.backup(id, 'cli');
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'template') {
        const id = getOpt(args, '--id');
        const templateId = getOpt(args, '--template');
        if (!id || !templateId) {
          process.stderr.write(
            'Usage: ysk-server projects template --id <projectId> --template <id> [--force]\n',
          );
          return 2;
        }
        printJson(ctx.projects.applyTemplate(id, templateId, 'cli', hasFlag(args, '--force')));
        return 0;
      }
      if (sub === 'health') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write('Usage: ysk-server projects health --id <projectId>\n');
          return 2;
        }
        const result = await ctx.projectOps.health(id);
        printJson(result);
        return exitFromResult(result);
      }
      process.stderr.write(
        'Usage: ysk-server projects list|get|create|deploy|stop|backup|template|health [options]\n',
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'hosting') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'nginx';
    const configPath = getOpt(args, '--config');
    const dataDir = getOpt(args, '--data-dir');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    if (dataDir) {
      config = config ? { ...config, dataDir } : ({ dataDir } as NonNullable<typeof config>);
    }
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const {
      listManagedNginxConfs,
      syncNginxConfigs,
      provisionRedisBinding,
      provisionPostgresDatabase,
      provisionMysqlDatabase,
      writeManagedDnsZone,
      listManagedDnsZones,
      applyPowerDnsZone,
      powerDnsStatus,
      installPowerDnsPackages,
      applyEmailStack,
      applyFirewall,
    } = await import('@ysk/core');
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDir ?? config?.dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1',
    });
    try {
      if (sub === 'nginx' || sub === 'nginx-list') {
        const { listManagedNginxDetailed } = await import('@ysk/core');
        printJson({
          ok: true,
          files: listManagedNginxConfs(ctx.dataDir),
          items: listManagedNginxDetailed(ctx.dataDir),
          dataDir: ctx.dataDir,
        });
        return 0;
      }
      if (sub === 'nginx-sync') {
        const execute = wantsHostExecute(args);
        const result = await syncNginxConfigs({
          dataDir: ctx.dataDir,
          systemConfDir: getOpt(args, '--system-dir'),
          host: ctx.host,
          dryRun: !execute || hasFlag(args, '--dry-run'),
        });
        printJson({
          ok: true,
          dryRun: !execute || hasFlag(args, '--dry-run'),
          ...result,
          notes: [
            ...(result.notes ?? []),
            execute
              ? 'execute 模式（仍需 YSK_EXECUTE 才能寫系統目錄）'
              : 'dry-run 預設：加 --execute 先同步到系統 nginx',
          ],
        });
        return 0;
      }
      if (sub === 'redis-provision') {
        const result = await provisionRedisBinding({
          hostExec: ctx.host,
          projectId: getOpt(args, '--project-id') ?? 'shared',
          dbIndex: getOpt(args, '--db') ? Number(getOpt(args, '--db')) : 0,
          execute: wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'postgres-provision') {
        const result = await provisionPostgresDatabase({
          dbName: getOpt(args, '--db') ?? 'app',
          username: getOpt(args, '--user') ?? 'appuser',
          password: getOpt(args, '--password') ?? '',
          hostExec: ctx.host,
          execute: wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'mysql-provision') {
        const result = await provisionMysqlDatabase({
          dbName: getOpt(args, '--db') ?? 'app',
          username: getOpt(args, '--user') ?? 'appuser',
          password: getOpt(args, '--password') ?? '',
          hostExec: ctx.host,
          execute: wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'dns-zone') {
        const zone = getOpt(args, '--zone');
        const serverIp = getOpt(args, '--ip') ?? getOpt(args, '--server-ip');
        if (!zone || !serverIp) {
          process.stderr.write(
            'Usage: ysk-server hosting dns-zone --zone example.com --ip A.B.C.D [--ipv6 X:X::X] [--validate] [--reload]\n',
          );
          return 2;
        }
        const result = await writeManagedDnsZone({
          dataDir: ctx.dataDir,
          zone,
          serverIp,
          serverIpv6: getOpt(args, '--ipv6') ?? getOpt(args, '--server-ipv6'),
          mailHost: getOpt(args, '--mail'),
          host: ctx.host,
          validate: hasFlag(args, '--validate'),
          tryReload: hasFlag(args, '--reload'),
          template: getOpt(args, '--template'),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'dns-zones') {
        printJson({ ok: true, items: listManagedDnsZones(ctx.dataDir) });
        return 0;
      }
      if (sub === 'powerdns-status') {
        printJson(await powerDnsStatus({ dataDir: ctx.dataDir, host: ctx.host }));
        return 0;
      }
      if (sub === 'powerdns-install') {
        const result = await installPowerDnsPackages({
          dataDir: ctx.dataDir,
          host: ctx.host,
          install: hasFlag(args, '--install') || wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'powerdns-load') {
        const zone = getOpt(args, '--zone');
        const serverIp = getOpt(args, '--ip') ?? getOpt(args, '--server-ip');
        if (!zone || !serverIp) {
          process.stderr.write(
            'Usage: ysk-server hosting powerdns-load --zone example.com --ip A.B.C.D [--ipv6 X:X::X] [--load|--execute]\n',
          );
          return 2;
        }
        const result = await applyPowerDnsZone({
          dataDir: ctx.dataDir,
          host: ctx.host,
          zone,
          serverIp,
          serverIpv6: getOpt(args, '--ipv6') ?? getOpt(args, '--server-ipv6'),
          load: hasFlag(args, '--load') || wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'email-apply') {
        const domain = getOpt(args, '--domain');
        if (!domain) {
          process.stderr.write(
            'Usage: ysk-server hosting email-apply --domain example.com [--install|--execute]\n',
          );
          return 2;
        }
        const result = await applyEmailStack({
          dataDir: ctx.dataDir,
          domain,
          host: ctx.host,
          installPackages: hasFlag(args, '--install') || wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'email-mailbox') {
        const domainName = getOpt(args, '--domain');
        const localPart = getOpt(args, '--local') ?? getOpt(args, '--user');
        if (!domainName || !localPart) {
          process.stderr.write(
            'Usage: ysk-server hosting email-mailbox --domain X --local user [--password P] [--ip A.B.C.D]\n',
          );
          return 2;
        }
        let domainId = ctx.email.list().find((d) => d.domain === domainName)?.id;
        if (!domainId) {
          const serverIp = getOpt(args, '--ip');
          if (!serverIp) {
            process.stderr.write(
              'New domain requires --ip A.B.C.D (no placeholder defaults)\n',
            );
            return 2;
          }
          const created = ctx.email.create({
            domain: domainName,
            serverIp,
            actor: 'cli',
          });
          domainId = created.domain.id;
        }
        const result = await ctx.email.createMailbox(domainId, {
          localPart,
          password: getOpt(args, '--password'),
          provisionSystem: hasFlag(args, '--system'),
          actor: 'cli',
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'ftps-apply') {
        const { applyFtps } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        if (!domain) {
          process.stderr.write(
            'Usage: ysk-server hosting ftps-apply --domain files.example.com [--install|--execute]\n',
          );
          return 2;
        }
        const result = await applyFtps({
          dataDir: ctx.dataDir,
          domain,
          host: ctx.host,
          install: hasFlag(args, '--install') || wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'runtimes' || sub === 'runtimes-probe') {
        const { probeRuntimes, listSupportedRuntimes } = await import('@ysk/core');
        printJson({
          supported: listSupportedRuntimes(),
          probe: await probeRuntimes(ctx.host),
        });
        return 0;
      }
      if (sub === 'runtime-install') {
        const { planOrInstallRuntime } = await import('@ysk/core');
        const kindRaw = getOpt(args, '--kind') ?? 'node';
        const kind = (
          ['node', 'php', 'python', 'go', 'rust'].includes(kindRaw) ? kindRaw : 'node'
        ) as 'node' | 'php' | 'python' | 'go' | 'rust';
        const defaultVer =
          kind === 'php'
            ? '8.2'
            : kind === 'python'
              ? '3.12'
              : kind === 'go'
                ? '1.22'
                : kind === 'rust'
                  ? 'stable'
                  : '20';
        const result = await planOrInstallRuntime({
          dataDir: ctx.dataDir,
          host: ctx.host,
          kind,
          version: getOpt(args, '--version') ?? defaultVer,
          install: hasFlag(args, '--install') || wantsHostExecute(args),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'dovecot-passdb') {
        const { writeDovecotPassdb, writeAllDovecotPassdbs } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        if (!domain || hasFlag(args, '--all')) {
          printJson(writeAllDovecotPassdbs({ dataDir: ctx.dataDir, db: ctx.db }));
          return 0;
        }
        printJson(
          writeDovecotPassdb({ dataDir: ctx.dataDir, db: ctx.db, domain }),
        );
        return 0;
      }
      if (sub === 'webmail-apply') {
        const { applyWebmail } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        if (!domain) {
          process.stderr.write(
            'Usage: ysk-server hosting webmail-apply --domain webmail.example.com [--download]\n',
          );
          return 2;
        }
        const result = await applyWebmail({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain,
          imapHost: getOpt(args, '--imap'),
          smtpHost: getOpt(args, '--smtp'),
          download: hasFlag(args, '--download'),
          systemInstall: hasFlag(args, '--system'),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'public-files') {
        const { applyPublicFileServer } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        if (!domain) {
          process.stderr.write(
            'Usage: ysk-server hosting public-files --domain files.example.com [--reload]\n',
          );
          return 2;
        }
        const result = await applyPublicFileServer({
          dataDir: ctx.dataDir,
          host: ctx.host,
          serverName: domain,
          quotaMb: getOpt(args, '--quota-mb')
            ? Number(getOpt(args, '--quota-mb'))
            : undefined,
          reload: hasFlag(args, '--reload'),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'email-bootstrap') {
        const { bootstrapEmailServer } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        const serverIp = getOpt(args, '--ip');
        if (!domain || !serverIp) {
          process.stderr.write(
            'Usage: ysk-server hosting email-bootstrap --domain example.com --ip 1.2.3.4 [--admin postmaster] [--password P] [--install]\n',
          );
          return 2;
        }
        const result = await bootstrapEmailServer({
          dataDir: ctx.dataDir,
          db: ctx.db,
          host: ctx.host,
          domain,
          serverIp,
          actor: 'cli',
          audit: ctx.audit,
          installPackages: hasFlag(args, '--install') || wantsHostExecute(args),
          adminLocalPart: getOpt(args, '--admin') ?? 'postmaster',
          adminPassword: getOpt(args, '--password'),
          webmail: !hasFlag(args, '--no-webmail'),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'firewall-apply') {
        const result = await applyFirewall({
          host: ctx.host,
          dataDir: ctx.dataDir,
          allowSmtp: hasFlag(args, '--smtp'),
          apply: wantsHostExecute(args),
        });
        printJson({
          ...result,
          dryRun: !wantsHostExecute(args),
          notes: [
            ...(result.notes ?? []),
            wantsHostExecute(args)
              ? 'execute 模式（仍需 YSK_EXECUTE=1 + root）'
              : 'dry-run 預設：加 --execute 先套用 ufw',
          ],
        });
        return exitFromResult({
          ...result,
          dryRun: !wantsHostExecute(args),
          ok: wantsHostExecute(args) ? result.ok : true,
        });
      }
      process.stderr.write(
        [
          'Usage: ysk-server hosting <sub>',
          '  Dangerous ops default dry-run; add --execute (+ YSK_EXECUTE=1) to apply',
          '  nginx | nginx-sync [--execute]',
          '  redis-provision | postgres-provision | mysql-provision [--execute]',
          '  dns-zone --zone X --ip A.B.C.D [--ipv6 X:X::X] [--validate] [--reload]',
          '  dns-zones | powerdns-status | powerdns-install [--install|--execute]',
          '  powerdns-load --zone X --ip A.B.C.D [--load|--execute]',
          '  email-apply --domain X [--install|--execute]',
          '  email-mailbox --domain X --local user [--password P] [--ip A.B.C.D] [--system]',
          '  ftps-apply --domain X [--install|--execute]',
          '  runtimes | runtime-install --kind node|php|python|go|rust --version V [--install|--execute]',
          '  dovecot-passdb --domain X | --all',
          '  webmail-apply --domain webmail.example.com [--download]',
          '  public-files --domain files.example.com [--reload]',
          '  email-bootstrap --domain example.com --ip A.B.C.D [--install|--execute]',
          '  firewall-apply [--smtp] [--execute]',
          '',
        ].join('\n'),
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** Top-level DNS alias for AI agents → hosting dns-zone / dns-zones */
  if (command === 'dns') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'zones';
    const { writeManagedDnsZone, listManagedDnsZones } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'zones' || sub === 'list') {
        printJson({ ok: true, items: listManagedDnsZones(ctx.dataDir) });
        return 0;
      }
      if (sub === 'zone' || sub === 'write' || sub === 'apply') {
        const zone = getOpt(args, '--zone');
        const serverIp = getOpt(args, '--ip') ?? getOpt(args, '--server-ip');
        if (!zone || !serverIp) {
          process.stderr.write(
            `Usage: ${CLI_NAME} dns zone --zone example.com --ip A.B.C.D [--ipv6 X:X::X] [--validate] [--reload]\n`,
          );
          return 2;
        }
        const result = await writeManagedDnsZone({
          dataDir: ctx.dataDir,
          zone,
          serverIp,
          serverIpv6: getOpt(args, '--ipv6') ?? getOpt(args, '--server-ipv6'),
          mailHost: getOpt(args, '--mail'),
          host: ctx.host,
          validate: hasFlag(args, '--validate'),
          tryReload: hasFlag(args, '--reload'),
          template: getOpt(args, '--template'),
        });
        printJson(result);
        return exitFromResult(result);
      }
      process.stderr.write(
        `Usage: ${CLI_NAME} dns zones|zone --zone X --ip A.B.C.D [--ipv6 …] [--json]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** Nginx status / managed confs / config test — AI-friendly */
  if (command === 'nginx') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'status';
    const {
      getServiceMatrix,
      listManagedNginxConfs,
      listManagedNginxDetailed,
      syncNginxConfigs,
    } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'list' || sub === 'confs') {
        printJson({
          ok: true,
          items: listManagedNginxDetailed(ctx.dataDir),
          files: listManagedNginxConfs(ctx.dataDir),
          dataDir: ctx.dataDir,
        });
        return 0;
      }
      if (sub === 'test' || sub === 'check') {
        const hasBin =
          ctx.host.pathExists('/usr/sbin/nginx') ||
          ctx.host.pathExists('/usr/bin/nginx');
        if (!hasBin) {
          const which = await ctx.host.runCommand(
            ['bash', '-c', 'command -v nginx || true'],
            { timeoutMs: 5_000 },
          );
          if (!which.stdout.trim()) {
            printJson({
              ok: false,
              code: 'not_found',
              notes: ['nginx binary not found'],
            });
            return 4;
          }
        }
        const r = await ctx.host.runCommand(['nginx', '-t'], { timeoutMs: 15_000 });
        const output = `${r.stdout}\n${r.stderr}`.trim();
        printJson({
          ok: r.exitCode === 0,
          configTest: { ok: r.exitCode === 0, exitCode: r.exitCode, output },
          notes: [
            r.exitCode === 0
              ? 'nginx -t OK'
              : `nginx -t failed: ${output.slice(0, 400)}`,
          ],
        });
        return r.exitCode === 0 ? 0 : 5;
      }
      if (sub === 'sync') {
        const execute = wantsHostExecute(args);
        const result = await syncNginxConfigs({
          dataDir: ctx.dataDir,
          systemConfDir: getOpt(args, '--system-dir'),
          host: ctx.host,
          dryRun: !execute || hasFlag(args, '--dry-run'),
        });
        printJson({
          ok: true,
          dryRun: !execute || hasFlag(args, '--dry-run'),
          ...result,
          notes: [
            ...(result.notes ?? []),
            execute
              ? 'execute 模式（仍需 YSK_EXECUTE 才能寫系統目錄）'
              : 'dry-run 預設：加 --execute 先同步到系統 nginx',
          ],
        });
        return 0;
      }
      if (sub === 'status' || sub === 'info' || sub === 'overview') {
        const matrix = await getServiceMatrix(ctx.host);
        const service = matrix.items.find((i) => i.id === 'nginx') ?? null;
        const managed = listManagedNginxDetailed(ctx.dataDir);
        let configTest: {
          ok: boolean;
          exitCode: number;
          output: string;
          skipped?: boolean;
        } | null = null;
        const hasBin =
          ctx.host.pathExists('/usr/sbin/nginx') ||
          ctx.host.pathExists('/usr/bin/nginx') ||
          service?.installed;
        if (hasBin) {
          const r = await ctx.host.runCommand(['nginx', '-t'], { timeoutMs: 15_000 });
          configTest = {
            ok: r.exitCode === 0,
            exitCode: r.exitCode,
            output: `${r.stdout}\n${r.stderr}`.trim(),
          };
        } else {
          configTest = {
            ok: false,
            exitCode: -1,
            output: '',
            skipped: true,
          };
        }
        printJson({
          ok: true,
          service,
          managed,
          managedCount: managed.length,
          configTest,
          caps: {
            executeEnabled: matrix.executeEnabled,
            isRoot: matrix.isRoot,
          },
          probedAt: matrix.probedAt,
        });
        return 0;
      }
      process.stderr.write(
        `Usage: ${CLI_NAME} nginx status|list|test|sync [--execute] [--json]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** SSL certificates list/get — read-only */
  if (command === 'ssl') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'list';
    const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      dedupeCertificatesInStore(ctx.db);
      const items = listCertificatesView(ctx.db, ctx.dataDir);
      if (sub === 'list' || sub === 'ls') {
        printJson({
          ok: true,
          items,
          count: items.length,
        });
        return 0;
      }
      if (sub === 'get' || sub === 'show') {
        const domain = (
          getOpt(args, '--domain') ??
          getOpt(args, '--id') ??
          ''
        )
          .trim()
          .toLowerCase();
        if (!domain) {
          process.stderr.write(
            `Usage: ${CLI_NAME} ssl get --domain example.com [--json]\n`,
          );
          return 2;
        }
        const cert =
          items.find((c) => c.domain === domain || c.id === domain) ?? null;
        if (!cert) {
          printJson({
            ok: false,
            code: ErrorCodes.NOT_FOUND,
            message: `找不到憑證：${domain}`,
            items: [],
          });
          return 4;
        }
        printJson({ ok: true, certificate: cert });
        return 0;
      }
      process.stderr.write(`Usage: ${CLI_NAME} ssl list|get --domain X [--json]\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** Host overview / metrics — read-only, AI-friendly */
  if (command === 'host') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'overview';
    const { collectHostOverview, collectMetrics } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'overview' || sub === 'status' || sub === 'info') {
        const overview = await collectHostOverview(ctx.host);
        printJson({ ok: true, ...overview });
        return 0;
      }
      if (sub === 'metrics' || sub === 'load') {
        const path = getOpt(args, '--path') ?? '/';
        const metrics = collectMetrics(path);
        printJson({
          ok: true,
          ...metrics,
          caps: {
            executeEnabled: ctx.host.executeEnabled(),
            isRoot: ctx.host.isRoot(),
          },
        });
        return metrics.alerts.length ? 1 : 0;
      }
      process.stderr.write(
        `Usage: ${CLI_NAME} host overview|metrics [--path /] [--json]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** Log Center query for AI agents */
  if (command === 'logs') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'query';
    const {
      queryLogSource,
      listSourceStatuses,
      getLogOverview,
      loadLogSettings,
      listJournalUnits,
    } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'sources' || sub === 'list') {
        const settings = loadLogSettings(ctx.db);
        const items = listSourceStatuses({
          disabledIds: settings.disabledSources,
          extraManagedLogDirs: [join(ctx.dataDir, 'nginx', 'logs')],
          customAllowPaths: settings.customAllowPaths,
        });
        printJson({ ok: true, items });
        return 0;
      }
      if (sub === 'overview' || sub === 'status') {
        const r = await getLogOverview({
          host: ctx.host,
          dataDir: ctx.dataDir,
          db: ctx.db,
        });
        printJson({ ok: true, ...r });
        return 0;
      }
      if (sub === 'units' || sub === 'journal-units') {
        const r = await listJournalUnits(ctx.host);
        printJson({ ok: true, ...r });
        return 0;
      }
      if (sub === 'journal') {
        const unit = getOpt(args, '--unit') ?? '';
        const source = unit ? `journal:${unit}` : 'journal:';
        const linesRaw = getOpt(args, '--lines');
        const r = await queryLogSource({
          host: ctx.host,
          dataDir: ctx.dataDir,
          db: ctx.db,
          source,
          lines: linesRaw ? Number(linesRaw) : undefined,
          since: getOpt(args, '--since'),
          priority: getOpt(args, '--priority'),
          grep: getOpt(args, '--grep'),
        });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'query' || sub === 'tail' || sub === 'read') {
        const source =
          getOpt(args, '--source') ??
          (getOpt(args, '--unit')
            ? `journal:${getOpt(args, '--unit')}`
            : undefined);
        if (!source) {
          process.stderr.write(
            [
              `Usage: ${CLI_NAME} logs query --source <id> [--lines N] [--grep G] [--since 1h] [--priority err]`,
              '  source examples: journal:  journal:nginx.service  file:syslog  project:<uuid>',
              `  ${CLI_NAME} logs sources --json`,
              `  ${CLI_NAME} logs journal [--unit nginx.service] --json`,
              '',
            ].join('\n'),
          );
          return 2;
        }
        const linesRaw = getOpt(args, '--lines');
        const r = await queryLogSource({
          host: ctx.host,
          dataDir: ctx.dataDir,
          db: ctx.db,
          source,
          lines: linesRaw ? Number(linesRaw) : undefined,
          since: getOpt(args, '--since'),
          priority: getOpt(args, '--priority'),
          grep: getOpt(args, '--grep'),
        });
        printJson(r);
        return exitFromResult(r);
      }
      process.stderr.write(
        `Usage: ${CLI_NAME} logs sources|overview|units|journal|query [--source id] [--json]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'services') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'matrix';
    const { getServiceMatrix, lifecycleServiceUnit } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'matrix' || sub === 'list' || sub === 'status') {
        const r = await getServiceMatrix(ctx.host);
        printJson({ ok: true, ...r });
        return 0;
      }
      if (sub === 'start' || sub === 'stop' || sub === 'restart' || sub === 'reload') {
        const unit = getOpt(args, '--unit') ?? getOpt(args, '--id');
        if (!unit) {
          process.stderr.write(
            `Usage: ${CLI_NAME} services ${sub} --unit <systemd-unit> [--execute] [--json]\n`,
          );
          return 2;
        }
        if (!wantsHostExecute(args)) {
          printJson({
            ok: true,
            dryRun: true,
            unit,
            action: sub,
            plan: [`systemctl ${sub} ${unit}`],
            notes: [
              `dry-run：未 systemctl ${sub}。加 --execute 且 YSK_EXECUTE=1 + root 先真正執行`,
            ],
          });
          return 0;
        }
        const r = await lifecycleServiceUnit(ctx.host, unit, sub);
        printJson(r);
        return exitFromResult(r);
      }
      process.stderr.write(
        `Usage: ${CLI_NAME} services matrix|start|stop|restart|reload --unit NAME [--execute] [--json]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'defense' || command === 'protection') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'status';
    const {
      getDefenseStatus,
      defenseBanIp,
      defenseUnbanIp,
      loadAutoBanPolicy,
      updateAutoBanPolicy,
      probeFirewallDeep,
    } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'status') {
        const status = await getDefenseStatus({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
        });
        const fw = await probeFirewallDeep(ctx.host).catch(() => null);
        printJson({
          ok: true,
          defense: status,
          firewall: fw
            ? {
                active: fw.active,
                activeLabel: fw.activeLabel,
                allowCount: fw.allowCount,
                denyCount: fw.denyCount,
                denyFromIps: fw.denyFromIps,
              }
            : null,
        });
        return 0;
      }
      if (sub === 'ban') {
        const ip = getOpt(args, '--ip');
        if (!ip) {
          process.stderr.write(
            `Usage: ${CLI_NAME} defense ban --ip <ip> [--method fail2ban|ufw|both] [--reason t] [--execute]\n`,
          );
          return 2;
        }
        const methodRaw = getOpt(args, '--method') ?? 'fail2ban';
        const method =
          methodRaw === 'ufw' || methodRaw === 'both' || methodRaw === 'fail2ban'
            ? methodRaw
            : 'fail2ban';
        const r = await defenseBanIp({
          host: ctx.host,
          db: ctx.db,
          ip,
          method,
          reason: getOpt(args, '--reason') ?? 'cli',
          // explicit false = dry-run; true only with --execute
          execute: wantsHostExecute(args),
        });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'unban') {
        const ip = getOpt(args, '--ip');
        if (!ip) {
          process.stderr.write(
            `Usage: ${CLI_NAME} defense unban --ip <ip> [--method fail2ban|ufw|both] [--execute]\n`,
          );
          return 2;
        }
        const methodRaw = getOpt(args, '--method') ?? 'fail2ban';
        const method =
          methodRaw === 'ufw' || methodRaw === 'both' || methodRaw === 'fail2ban'
            ? methodRaw
            : 'fail2ban';
        const r = await defenseUnbanIp({
          host: ctx.host,
          db: ctx.db,
          ip,
          method,
          execute: wantsHostExecute(args),
        });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'whitelist') {
        const action = getOpt(args, '--action') ?? 'list';
        const ip = getOpt(args, '--ip');
        const policy = loadAutoBanPolicy(ctx.db);
        if (action === 'list') {
          printJson({ ok: true, whitelist: policy.whitelist ?? [] });
          return 0;
        }
        if (!ip) {
          process.stderr.write(
            `Usage: ${CLI_NAME} defense whitelist --action list|add|remove [--ip IP]\n`,
          );
          return 2;
        }
        let whitelist = [...(policy.whitelist ?? [])];
        if (action === 'remove') {
          whitelist = whitelist.filter((w) => w !== ip);
        } else if (action === 'add') {
          if (!whitelist.includes(ip)) whitelist.unshift(ip);
          whitelist = whitelist.slice(0, 200);
        } else {
          process.stderr.write('action must be list|add|remove\n');
          return 2;
        }
        const next = updateAutoBanPolicy(ctx.db, { whitelist });
        printJson({ ok: true, whitelist: next.whitelist });
        return 0;
      }
      process.stderr.write(
        `Usage: ${CLI_NAME} defense status|ban|unban|whitelist [--json]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'system') {
    const sub = args[1];
    if (sub === 'unit-install') {
      const dataDir = getOpt(args, '--data-dir') ?? join(process.cwd(), '.ysk');
      const enable = hasFlag(args, '--enable');
      const cliPath = resolveDistCliPath();
      const ctx = createAppContext({
        version: VERSION,
        dataDir,
        executeEnabled: process.env.YSK_EXECUTE === '1',
      });
      try {
        const result = await installControlPlaneSystemd({
          dataDir,
          cliPath,
          host: ctx.host,
          enable,
        });
        if (json) printJson(result);
        else {
          process.stdout.write(`${result.notes.join('\n')}\n`);
          process.stdout.write(`written: ${result.written.join(', ')}\n`);
          if (!enable) {
            process.stdout.write(
              `To enable: YSK_EXECUTE=1 sudo ${CLI_NAME} system unit-install --enable --data-dir ${dataDir}\n`,
            );
          }
        }
        return result.ok ? 0 : 1;
      } finally {
        closeAppContext(ctx);
      }
    }
    process.stderr.write('Usage: ysk-server system unit-install [--enable] [--data-dir PATH]\n');
    return 1;
  }

  if (command === 'serve') {
    const configPath = getOpt(args, '--config');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    const dataDirOpt = getOpt(args, '--data-dir');
    if (dataDirOpt) {
      config = config ? { ...config, dataDir: dataDirOpt } : ({ dataDir: dataDirOpt } as NonNullable<typeof config>);
    }
    const host = getOpt(args, '--host') ?? config?.listenHost ?? '127.0.0.1';
    const port = Number(
      getOpt(args, '--port') ?? process.env.PORT ?? config?.listenPort ?? 9287,
    );
    const webRoot = resolveWebRoot(getOpt(args, '--web-root'));
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDirOpt ?? config?.dataDir,
      adminPassword: process.env.YSK_ADMIN_PASSWORD,
      webRoot: webRoot ?? undefined,
    });
    const server = createHttpServer(ctx);
    const addr = await listen(server, host, port);
    const msg = `${PRODUCT_NAME} listening on http://${addr.host}:${addr.port}`;
    if (json) {
      printJson({
        ok: true,
        code: 'YSK_SERVE',
        message: msg,
        data: {
          ...addr,
          configPath: configPath ?? null,
          adminUsername: config?.adminUsername ?? 'admin',
          locale: config?.locale ?? 'zh-TW',
          webUi: Boolean(webRoot),
          webRoot,
        },
      });
    } else {
      process.stdout.write(`${msg}\n`);
      process.stdout.write(`Health: http://${addr.host}:${addr.port}/health\n`);
      process.stdout.write(
        webRoot
          ? `Web UI:  http://${addr.host}:${addr.port}/\n`
          : `Web UI:  找不到 (build apps/web or set YSK_WEB_ROOT)\n`,
      );
      if (configPath) {
        process.stdout.write(`Config: ${configPath} (admin=${config?.adminUsername}, locale=${config?.locale})\n`);
      }
      if (!ctx.host.executeEnabled() || !ctx.host.isRoot()) {
        process.stdout.write(
          `Mode: degraded (set YSK_EXECUTE=1 + root for OS-level apply)\n`,
        );
      }
    }
    if (process.env.YSK_SERVE_ONCE === '1') {
      server.close();
      return 0;
    }
    await new Promise(() => {
      /* run until signal */
    });
    return 0;
  }

  if (command === 'self-update-plan') {
    printJson(planSelfUpdate({ current: VERSION, latest: getOpt(args, '--latest') ?? VERSION }));
    return 0;
  }

  if (command === 'readiness' || command === 'doctor') {
    const { assessProductionReadiness } = await import('@ysk/core');
    const dataDir = getOpt(args, '--data-dir') ?? join(process.cwd(), '.ysk');
    const ctx = createAppContext({
      version: VERSION,
      dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1',
    });
    try {
      const report = await assessProductionReadiness({
        dataDir: ctx.dataDir,
        host: ctx.host,
        product: PRODUCT_NAME,
        version: VERSION,
      });
      printJson(report);
      return report.productionReady ? 0 : 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  process.stderr.write(`Unknown command: ${command}\nRun \`${CLI_NAME} help\`\n`);
  return 2;
}

// Only auto-run when executed as CLI entry (not when imported by tests)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('/cli.js') ||
    process.argv[1].endsWith('/cli.ts') ||
    process.argv[1].endsWith('ysk-server'));

if (isDirectRun) {
  void main(process.argv).then(
    (code) => {
      if (code !== 0) process.exitCode = code;
    },
    (err) => {
      const json = process.argv.includes('--json');
      process.exitCode = printCliError(err, json);
    },
  );
}

function resolveDistCliPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const p = join(here, 'cli.js');
    return p;
  } catch {
    return process.argv[1] ?? 'ysk-server';
  }
}

export { main, runSetup, runUpdate };
