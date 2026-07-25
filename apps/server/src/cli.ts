#!/usr/bin/env node
/**
 * YSK Server CLI — AI-agent friendly structured output.
 */

import { CLI_NAME, PRODUCT_NAME, type StructuredResult } from '@ysk/shared';
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

function printHelp(): void {
  const text = `
${PRODUCT_NAME} (${CLI_NAME}) v${VERSION}

AI-secure Linux server manager with web hosting control panel.

Usage:
  ${CLI_NAME} <command> [options]

Commands:
  setup                 Initialize control plane + database
  update                Check / plan self-update
  serve                 Start HTTP API + Web UI (if built)
  system unit-install   Install ysk-server.service [--enable]
  tools                 List tools; tools run --tool <name>
  ask                   Plan AI task from natural language
  projects              list|create|deploy|stop|backup|template
  templates             List one-click app templates
  hosting               nginx|nginx-sync|db|dns|powerdns|firewall helpers
  agents                List / probe managed AI agent runtimes
  agent run             Outbound fleet agent (poll control plane)
  version               Print version
  help                  Show this help

Global options:
  --json                Structured JSON output (AI-agent friendly)
  --help, -h            Show help
  --version, -V         Show version
  --data-dir <path>     Data directory (many commands)
  --config <path>       Config.json from setup

projects create:
  --name <n> --domain <d> --runtime node|php|static
  --template node-starter|static-site|wordpress-php

projects deploy|stop|backup|template:
  --id <projectId>   [--template <id>] [--force]

Examples:
  ${CLI_NAME} setup --non-interactive --dry-run
  ${CLI_NAME} serve --config .ysk/config.json
  ${CLI_NAME} projects create --name demo --template node-starter
  ${CLI_NAME} projects deploy --id <uuid>
  ${CLI_NAME} templates --json
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
        commands: ['setup', 'update', 'serve', 'tools', 'agents', 'version', 'help'],
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
        commands: ['setup', 'update', 'serve', 'tools', 'agents', 'version', 'help'],
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
        return result.allowed ? 0 : 1;
      } finally {
        closeAppContext(ctx);
      }
    }
    const tools = createDefaultAllowlist().list();
    const payload: StructuredResult = {
      ok: true,
      code: 'YSK_TOOLS',
      message: 'Allowlist tool catalog',
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
    if (json) printJson({ ok: true, code: 'YSK_AGENTS', message: 'Agent runtimes', data });
    else {
      for (const a of data) process.stdout.write(`${a.kind}\t${a.name}\t${a.status}\n`);
    }
    return 0;
  }

  if (command === 'agent') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'run';
    if (sub !== 'run') {
      process.stderr.write('Usage: ysk-server agent run --control-plane URL --id AGENT_ID [--group g]\n');
      return 1;
    }
    const controlPlane = getOpt(args, '--control-plane') ?? 'http://127.0.0.1:8787';
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
        return { ok: true, echo: cmd.payload, at: new Date().toISOString() };
      },
    });
    return 0;
  }

  if (command === 'ask') {
    const prompt = args.filter((a) => !a.startsWith('-')).slice(1).join(' ');
    if (!prompt) {
      process.stderr.write('Usage: ysk-server ask "check system info"\n');
      return 1;
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
      if (sub === 'create') {
        const name = getOpt(args, '--name');
        if (!name) {
          process.stderr.write(
            'Usage: ysk-server projects create --name <name> [--domain d] [--runtime node|php|static] [--template id]\n',
          );
          return 1;
        }
        const runtimeRaw = getOpt(args, '--runtime') ?? 'node';
        const runtime =
          runtimeRaw === 'php' || runtimeRaw === 'static' || runtimeRaw === 'node'
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
          return 1;
        }
        const proj = ctx.projects.get(id);
        const result =
          proj.runtime === 'php'
            ? await ctx.projectOps.deployPhp(id, { actor: 'cli' })
            : await ctx.projectOps.deployNode(id, { actor: 'cli' });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'stop') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write('Usage: ysk-server projects stop --id <projectId>\n');
          return 1;
        }
        printJson(await ctx.projectOps.stopNode(id, 'cli'));
        return 0;
      }
      if (sub === 'backup') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write('Usage: ysk-server projects backup --id <projectId>\n');
          return 1;
        }
        const result = await ctx.projectOps.backup(id, 'cli');
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'template') {
        const id = getOpt(args, '--id');
        const templateId = getOpt(args, '--template');
        if (!id || !templateId) {
          process.stderr.write(
            'Usage: ysk-server projects template --id <projectId> --template <id> [--force]\n',
          );
          return 1;
        }
        printJson(ctx.projects.applyTemplate(id, templateId, 'cli', hasFlag(args, '--force')));
        return 0;
      }
      if (sub === 'health') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write('Usage: ysk-server projects health --id <projectId>\n');
          return 1;
        }
        const result = await ctx.projectOps.health(id);
        printJson(result);
        return result.ok ? 0 : 1;
      }
      process.stderr.write(
        'Usage: ysk-server projects list|create|deploy|stop|backup|template|health [options]\n',
      );
      return 1;
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
        printJson({ files: listManagedNginxConfs(ctx.dataDir), dataDir: ctx.dataDir });
        return 0;
      }
      if (sub === 'nginx-sync') {
        const result = await syncNginxConfigs({
          dataDir: ctx.dataDir,
          systemConfDir: getOpt(args, '--system-dir'),
          host: ctx.host,
          dryRun: hasFlag(args, '--dry-run'),
        });
        printJson(result);
        return 0;
      }
      if (sub === 'redis-provision') {
        const result = await provisionRedisBinding({
          hostExec: ctx.host,
          projectId: getOpt(args, '--project-id') ?? 'shared',
          dbIndex: getOpt(args, '--db') ? Number(getOpt(args, '--db')) : 0,
          execute: hasFlag(args, '--execute'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'postgres-provision') {
        const result = await provisionPostgresDatabase({
          dbName: getOpt(args, '--db') ?? 'app',
          username: getOpt(args, '--user') ?? 'appuser',
          password: getOpt(args, '--password') ?? '',
          hostExec: ctx.host,
          execute: hasFlag(args, '--execute'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'mysql-provision') {
        const result = await provisionMysqlDatabase({
          dbName: getOpt(args, '--db') ?? 'app',
          username: getOpt(args, '--user') ?? 'appuser',
          password: getOpt(args, '--password') ?? '',
          hostExec: ctx.host,
          execute: hasFlag(args, '--execute'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'dns-zone') {
        const result = await writeManagedDnsZone({
          dataDir: ctx.dataDir,
          zone: getOpt(args, '--zone') ?? 'example.com',
          serverIp: getOpt(args, '--ip') ?? '203.0.113.10',
          host: ctx.host,
          validate: hasFlag(args, '--validate'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'dns-zones') {
        printJson({ items: listManagedDnsZones(ctx.dataDir) });
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
          install: hasFlag(args, '--install'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'powerdns-load') {
        const result = await applyPowerDnsZone({
          dataDir: ctx.dataDir,
          host: ctx.host,
          zone: getOpt(args, '--zone') ?? 'example.com',
          serverIp: getOpt(args, '--ip') ?? '203.0.113.10',
          load: hasFlag(args, '--load'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'email-apply') {
        const result = await applyEmailStack({
          dataDir: ctx.dataDir,
          domain: getOpt(args, '--domain') ?? 'example.com',
          host: ctx.host,
          installPackages: hasFlag(args, '--install'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      if (sub === 'firewall-apply') {
        const result = await applyFirewall({
          host: ctx.host,
          dataDir: ctx.dataDir,
          allowSmtp: hasFlag(args, '--smtp'),
          apply: hasFlag(args, '--apply'),
        });
        printJson(result);
        return result.ok ? 0 : 1;
      }
      process.stderr.write(
        [
          'Usage: ysk-server hosting <sub>',
          '  nginx | nginx-sync | redis-provision | postgres-provision | mysql-provision',
          '  dns-zone --zone X --ip A.B.C.D [--validate]',
          '  dns-zones | powerdns-status | powerdns-install [--install]',
          '  powerdns-load --zone X --ip A.B.C.D [--load]',
          '  email-apply --domain X [--install]',
          '  firewall-apply [--smtp] [--apply]',
          '',
        ].join('\n'),
      );
      return 1;
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
      getOpt(args, '--port') ?? process.env.PORT ?? config?.listenPort ?? 8787,
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
          : `Web UI:  not found (build apps/web or set YSK_WEB_ROOT)\n`,
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

  process.stderr.write(`Unknown command: ${command}\nRun \`${CLI_NAME} help\`\n`);
  return 1;
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
      process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : err}\n`);
      process.exitCode = 1;
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
