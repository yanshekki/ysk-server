#!/usr/bin/env node
/**
 * YSK Server CLI — AI-agent friendly structured output.
 */

import { CLI_NAME, PRODUCT_NAME, type StructuredResult } from '@ysk/shared';
import {
  createDefaultAllowlist,
  listAgentRuntimes,
  planSelfUpdate,
} from '@ysk/core';
import { createAppContext } from './app-context.js';
import { createHttpServer, listen } from './http-server.js';
import { runSetup } from './cli/setup.js';
import { runUpdate } from './cli/update.js';
import { loadConfigFile } from './config-loader.js';
import { VERSION } from './version.js';

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
  serve                 Start control-plane HTTP server
  tools                 List tools; tools run --tool <name>
  ask                   Plan AI task from natural language
  projects              List/create projects (real disk)
  hosting               nginx list|sync
  agents                List managed AI agent runtimes
  version               Print version
  help                  Show this help

Global options:
  --json                Structured JSON output (AI-agent friendly)
  --help, -h            Show help
  --version, -V         Show version

setup options:
  --data-dir <path>     Data directory (default: ./.ysk)
  --host <host>         Listen host (default: 127.0.0.1)
  --port <port>         Listen port (default: 8787)
  --locale <code>       zh-TW | en | zh-CN
  --non-interactive     No prompts (scripted deploy)
  --dry-run             Validate and print plan without writing
  --force               Overwrite existing config

update options:
  --check               Check only (npm registry when online)
  --latest <version>    Override latest version for planning
  --apply               Apply npm install -g (requires YSK_EXECUTE=1)

serve options:
  --config <path>       Load config.json written by setup
  --host <host>         Bind host (overrides config)
  --port <port>         Bind port (overrides config)

Examples:
  ${CLI_NAME} setup --non-interactive --dry-run
  ${CLI_NAME} serve --config .ysk/config.json
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
    const data = listAgentRuntimes();
    if (json) printJson({ ok: true, code: 'YSK_AGENTS', message: 'Agent runtimes', data });
    else {
      for (const a of data) process.stdout.write(`${a.kind}\t${a.name}\t${a.status}\n`);
    }
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

  if (command === 'projects') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'list';
    const configPath = getOpt(args, '--config');
    const config = configPath ? loadConfigFile(configPath) : undefined;
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const ctx = createAppContext({ version: VERSION, config, configPath });
    try {
      if (sub === 'create') {
        const name = getOpt(args, '--name');
        if (!name) {
          process.stderr.write('Usage: ysk-server projects create --name <name> [--domain d]\n');
          return 1;
        }
        const created = await ctx.projects.create({
          name,
          domain: getOpt(args, '--domain'),
          runtime: (getOpt(args, '--runtime') as 'node') ?? 'node',
          actor: 'cli',
        });
        printJson(created);
        return 0;
      }
      printJson({ ok: true, items: ctx.projects.list() });
      return 0;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'hosting') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'nginx';
    const configPath = getOpt(args, '--config');
    const config = configPath ? loadConfigFile(configPath) : undefined;
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const { listManagedNginxConfs, syncNginxConfigs } = await import('@ysk/core');
    const ctx = createAppContext({ version: VERSION, config, configPath });
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
      process.stderr.write('Usage: ysk-server hosting nginx|nginx-sync [--dry-run] [--system-dir PATH]\n');
      return 1;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'serve') {
    const configPath = getOpt(args, '--config');
    const config = configPath ? loadConfigFile(configPath) : undefined;
    const host = getOpt(args, '--host') ?? config?.listenHost ?? '127.0.0.1';
    const port = Number(
      getOpt(args, '--port') ?? process.env.PORT ?? config?.listenPort ?? 8787,
    );
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
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
        },
      });
    } else {
      process.stdout.write(`${msg}\n`);
      process.stdout.write(`Health: http://${addr.host}:${addr.port}/health\n`);
      if (configPath) {
        process.stdout.write(`Config: ${configPath} (admin=${config?.adminUsername}, locale=${config?.locale})\n`);
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

export { main, runSetup, runUpdate };
