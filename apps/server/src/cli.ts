#!/usr/bin/env node
/**
 * YSK Server CLI — AI-agent friendly structured output.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
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
  setup                 Initialize control plane config skeleton
  update                Check / plan self-update
  serve                 Start control-plane HTTP server
  tools                 List allowlisted tools (schema discovery)
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
  --check               Check only
  --latest <version>    Override latest version for planning

serve options:
  --host <host>         Bind host (default: 127.0.0.1)
  --port <port>         Bind port (default: 8787)

Examples:
  ${CLI_NAME} setup --non-interactive --dry-run
  ${CLI_NAME} serve --port 8787
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

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const json = hasFlag(args, '--json');
  const command = args.find((a) => !a.startsWith('-')) ?? 'help';

  if (hasFlag(args, '--help') || hasFlag(args, '-h') || command === 'help') {
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

  if (hasFlag(args, '--version') || hasFlag(args, '-V') || command === 'version') {
    if (json) {
      printJson({ ok: true, product: PRODUCT_NAME, cli: CLI_NAME, version: VERSION });
    } else {
      process.stdout.write(`${PRODUCT_NAME} ${CLI_NAME}/${VERSION}\n`);
    }
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
    const result = runUpdate({
      checkOnly: hasFlag(args, '--check'),
      latest: getOpt(args, '--latest'),
    });
    if (json) printJson(result);
    else process.stdout.write(`${result.message}\n`);
    return result.ok ? 0 : 1;
  }

  if (command === 'tools') {
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

  if (command === 'serve') {
    const host = getOpt(args, '--host') ?? '127.0.0.1';
    const port = Number(getOpt(args, '--port') ?? process.env.PORT ?? 8787);
    const ctx = createAppContext(VERSION);
    const server = createHttpServer(ctx);
    const addr = await listen(server, host, port);
    const msg = `${PRODUCT_NAME} listening on http://${addr.host}:${addr.port}`;
    if (json) {
      printJson({ ok: true, code: 'YSK_SERVE', message: msg, data: addr });
    } else {
      process.stdout.write(`${msg}\n`);
      process.stdout.write(`Health: http://${addr.host}:${addr.port}/health\n`);
    }
    // Keep alive unless YSK_SERVE_ONCE for tests
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
    // internal helper
    printJson(planSelfUpdate({ current: VERSION, latest: getOpt(args, '--latest') ?? VERSION }));
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\nRun \`${CLI_NAME} help\`\n`);
  return 1;
}

// Ensure dist is importable
void main(process.argv).then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : err}\n`);
    process.exitCode = 1;
  },
);

// re-export for tests
export { main, runSetup, runUpdate };
// silence unused in some bundlers
void mkdirSync;
void writeFileSync;
