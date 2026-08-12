#!/usr/bin/env node
/**
 * YSK Server CLI — AI-agent friendly structured output.
 */

import {
  CLI_NAME,
  PRODUCT_NAME,
  ErrorCodes,
  YskError,
  localeFromEnv,
  normalizeLocale,
  runWithLocaleAsync,
  type StructuredResult,  tl} from '@ysk/shared';
import {
  createDefaultAllowlist,
  installControlPlaneSystemd,
  listAgentRuntimes,
  planSelfUpdate,
  listStackPlans,
  listStackBundles,
  getStackStatus,
  installStack,
  uninstallStack,
  scanStack,
  expandComponents,
} from '@ysk/core';
import { createAppContext, closeAppContext } from './app-context.js';

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
  'stack',
  'tools',
  'ask',
  'projects',
  'users',
  'packages',
  'rbac',
  'audit',
  'security',
  'backup',
  'templates',
  'hosting',
  'dns',
  'logs',
  'host',
  'nginx',
  'ssl',
  'db-cluster',
  'ssh-key',
  'ssh-2fa',
  'services',
  'defense',
  'protection',
  'cdn',
  'agents',
  'agent',
  'store',
  'files',
  'cron',
  'email',
  'health',
  'readiness',
  'doctor',
  'migrate',
  'vpn',
  'vnc',
  'apache',
  'network',
  'real-ip',
  'updates',
  'software',
  'db',
  'redis',
  'ftp',
  'runtimes',
  'version',
  'help',
] as const;

/**
 * Map structured result → CLI exit code.
 * Contract: 0 ok · 1 error · 2 validation · 3 blocked · 4 not_found · 5 host_error
 */
export function exitFromResult(r: {
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
export function exitFromError(err: unknown): number {
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

export function printCliError(err: unknown, json: boolean): number {
  if (err instanceof YskError) {
    if (json) {
      printJson({
        ok: false,
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        httpStatus: err.httpStatus });
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
    executeEnabled: process.env.YSK_EXECUTE === '1' });
}

function printHelp(): void {
  const text = tl('cli.help.main', {
    product: PRODUCT_NAME,
    cli: CLI_NAME,
    version: VERSION,
  });
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
  // Locale: --locale=xx | YSK_LOCALE | LANG
  const localeFlag =
    args.find((a) => a.startsWith('--locale='))?.slice('--locale='.length) ??
    (() => {
      const i = args.indexOf('--locale');
      return i >= 0 ? args[i + 1] : undefined;
    })();
  const locale = normalizeLocale(localeFlag ?? localeFromEnv());

  return runWithLocaleAsync(locale, () => mainInner(args, json, command));
}

async function mainInner(
  args: string[],
  json: boolean,
  command: string | undefined,
): Promise<number> {
  // Global --version / -V only when no command (else --version is a subcommand option, e.g. runtime install)
  if (
    !command &&
    (hasFlag(args, '--version') || hasFlag(args, '-V'))
  ) {
    printVersion(json);
    return 0;
  }
  if (command === 'version') {
    printVersion(json);
    return 0;
  }

  // Global --help only without a command; `ysk-server <cmd> --help` handled per-command where present
  if (
    !command &&
    (hasFlag(args, '--help') || hasFlag(args, '-h'))
  ) {
    if (json) {
      printJson({
        ok: true,
        product: PRODUCT_NAME,
        cli: CLI_NAME,
        version: VERSION,
        commands: [...CLI_COMMANDS],
        docs: ['docs/agent/README.md', 'docs/cli/reference.md', 'docs/agent/commands.json'],
        exitCodes: { 0: 'ok', 1: 'error', 2: 'validation', 3: 'blocked', 4: 'not_found', 5: 'host_error' } });
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
        exitCodes: { 0: 'ok', 1: 'error', 2: 'validation', 3: 'blocked', 4: 'not_found', 5: 'host_error' } });
    } else {
      printHelp();
    }
    return 0;
  }

  if (command === 'setup') {
    const result = runSetup({
      dataDir: getOpt(args, '--data-dir'),
      listenHost: getOpt(args, '--host'),
      listenPort: getOpt(args, '--port') ? Number(getOpt(args, '--port')) : undefined,
      adminUsername: getOpt(args, '--admin-user') ?? getOpt(args, '--username'),
      adminPassword: getOpt(args, '--admin-password') ?? getOpt(args, '--password'),
      locale: getOpt(args, '--locale'),
      nonInteractive: hasFlag(args, '--non-interactive'),
      dryRun: hasFlag(args, '--dry-run'),
      force: hasFlag(args, '--force'),
      allowInsecureDefaults:
        hasFlag(args, '--allow-insecure-defaults') ||
        process.env.YSK_ALLOW_INSECURE_DEFAULTS === '1',
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
      apply: hasFlag(args, '--apply') });
    if (json) printJson(result);
    else process.stdout.write(`${result.message}\n`);
    return result.ok ? 0 : 1;
  }

  if (command === 'tools') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0];
    if (sub === 'run') {
      const tool = getOpt(args, '--tool');
      if (!tool) {
        process.stderr.write(`${tl('cli.usage.tools.run.--tool.name.--arg.cd327c')}\n`);
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
            dataDir: ctx.dataDir },
        );
        printJson(result);
        return exitFromResult({
          ok: result.allowed,
          blocked: !result.allowed,
          code: result.allowed ? undefined : 'blocked',
          allowed: result.allowed });
      } finally {
        closeAppContext(ctx);
      }
    }
    const tools = createDefaultAllowlist().list();
    const payload: StructuredResult = {
      ok: true,
      code: 'YSK_TOOLS',
      message: tl('notes.auto.n0077'),
      data: tools };
    printJson(payload);
    return 0;
  }

  if (command === 'email') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'help';
    const ctx = openCliContext(args);
    try {
      if (sub === 'help' || sub === '--help') {
        process.stderr.write(`${tl('cli.usage.email.sub.--data-dir.path.--json.73dad0')}\n`);
        return 2;
      }

      const resolveDomain = () => {
        const idOpt = getOpt(args, '--id');
        const domainName = (getOpt(args, '--domain') ?? '').trim().toLowerCase();
        if (idOpt) return ctx.email.list().find((d) => d.id === idOpt);
        if (domainName) return ctx.email.list().find((d) => d.domain === domainName);
        return undefined;
      };

      if (sub === 'domains') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        if (act === 'list') {
          let items = ctx.email.list().map((d) => ({
            ...d,
            dkim_private_key: '***redacted***',
          }));
          const q = (getOpt(args, '--q') ?? '').trim().toLowerCase();
          if (q) {
            items = items.filter(
              (d) =>
                d.domain.includes(q) ||
                d.id.includes(q) ||
                (d.mail_hostname ?? '').includes(q),
            );
          }
          printJson({ ok: true, items, meta: { total: items.length } });
          return 0;
        }
        if (act === 'create') {
          const domain = (getOpt(args, '--domain') ?? '').trim().toLowerCase();
          const serverIp = getOpt(args, '--ip') ?? getOpt(args, '--server-ip');
          if (!domain || !serverIp) {
            process.stderr.write(`${tl('cli.usage.email.domains.create.--domain.example.bd4036')}\n`);
            return 2;
          }
          const created = ctx.email.create({
            domain,
            serverIp,
            serverIpv6: getOpt(args, '--ipv6'),
            mailHostname: getOpt(args, '--mail-host'),
            actor: 'cli',
          });
          printJson({ ok: true, ...created });
          return 0;
        }
        if (act === 'get') {
          const row = resolveDomain();
          if (!row) {
            printJson({ ok: false, code: ErrorCodes.NOT_FOUND });
            return 4;
          }
          printJson({
            ok: true,
            domain: { ...row, dkim_private_key: '***redacted***' },
            dns: ctx.email.getDnsBundle(row.id),
          });
          return 0;
        }
        process.stderr.write(`${tl('cli.usage.email.domains.list.create.get.b94a62')}\n`);
        return 2;
      }

      if (sub === 'mailboxes' || sub === 'mailbox') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        if (act === 'list') {
          const row = resolveDomain();
          const items = ctx.email.listMailboxes(row?.id);
          const q = (getOpt(args, '--q') ?? '').trim().toLowerCase();
          const filtered = q
            ? items.filter((m) =>
                JSON.stringify(m).toLowerCase().includes(q),
              )
            : items;
          printJson({ ok: true, items: filtered, meta: { total: filtered.length } });
          return 0;
        }
        if (act === 'create') {
          const domainName = (getOpt(args, '--domain') ?? '').trim().toLowerCase();
          const localPart = getOpt(args, '--local') ?? getOpt(args, '--user');
          if (!domainName || !localPart) {
            process.stderr.write(`${tl('cli.usage.email.mailboxes.create.--domain.example.7227f3')}\n`);
            return 2;
          }
          let domainId = ctx.email.list().find((d) => d.domain === domainName)?.id;
          if (!domainId) {
            const serverIp = getOpt(args, '--ip');
            if (!serverIp) {
              process.stderr.write(`${tl('cli.msg.domain.missing.pass.5be09b')}\n`);
              return 2;
            }
            domainId = ctx.email.create({
              domain: domainName,
              serverIp,
              actor: 'cli',
            }).domain.id;
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
        process.stderr.write(`${tl('cli.usage.email.mailboxes.list.create.42b26c')}\n`);
        return 2;
      }

      if (sub === 'deliverability' || sub === 'deliverability-overview') {
        if (sub === 'deliverability-overview' || hasFlag(args, '--overview')) {
          const { buildDeliverabilityReport } = await import('@ysk/core');
          const domains = ctx.email.list();
          const items = [];
          for (const d of domains.slice(0, 20)) {
            const report = await buildDeliverabilityReport({
              domain: d.domain,
              serverIp: d.server_ip,
              serverIpv6: d.server_ipv6,
              mailHostname: d.mail_hostname,
              dkimPublicKey: d.dkim_public_key ?? '',
              dataDir: ctx.dataDir,
            });
            items.push({
              domainId: d.id,
              domain: d.domain,
              score: report.score,
              panelReady: report.panelReady,
              deliveryGuaranteed: false as const,
            });
          }
          printJson({ ok: true, items });
          return 0;
        }
        const row = resolveDomain();
        if (!row) {
          process.stderr.write(`${tl('cli.usage.email.deliverability.--domain.example.com.b0dff0')}\n`);
          return 2;
        }
        const { buildDeliverabilityReport } = await import('@ysk/core');
        const report = await buildDeliverabilityReport({
          domain: row.domain,
          serverIp: row.server_ip,
          serverIpv6: row.server_ipv6,
          mailHostname: row.mail_hostname,
          dkimPublicKey: row.dkim_public_key ?? '',
          dataDir: ctx.dataDir,
        });
        printJson({ ok: true, report });
        return report.panelReady ? 0 : 1;
      }

      if (sub === 'bootstrap') {
        const { bootstrapEmailServer } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        const serverIp = getOpt(args, '--ip');
        if (!domain || !serverIp) {
          process.stderr.write(`${tl('cli.usage.email.bootstrap.--domain.example.com.affc8d')}\n`);
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
          projects: ctx.projects,
          projectOps: ctx.projectOps,
          webmailDownload: wantsHostExecute(args) || hasFlag(args, '--install'),
        });
        printJson(result);
        return exitFromResult(result);
      }

      if (sub === 'dns') {
        const row = resolveDomain();
        if (!row) {
          process.stderr.write(`${tl('cli.usage.email.dns.--domain.example.com.26b806')}\n`);
          return 2;
        }
        printJson({ ok: true, ...ctx.email.getDnsBundle(row.id) });
        return 0;
      }

      if (sub === 'aliases' || sub === 'alias') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        const row = resolveDomain();
        if (!row) {
          process.stderr.write(
            'Usage: ysk-server email aliases list|create|delete --domain example.com …\n',
          );
          return 2;
        }
        if (act === 'list') {
          printJson({
            ok: true,
            domainId: row.id,
            items: ctx.email.listAliases(row.id),
          });
          return 0;
        }
        if (act === 'create' || act === 'add') {
          const typeRaw = getOpt(args, '--type') ?? 'alias';
          const type =
            typeRaw === 'forward' || typeRaw === 'catchall' ? typeRaw : 'alias';
          const destCsv = getOpt(args, '--to') ?? getOpt(args, '--destinations') ?? '';
          const destinations = destCsv.split(',').map((s) => s.trim()).filter(Boolean);
          try {
            const result = ctx.email.createAlias(row.id, {
              type,
              localPart: getOpt(args, '--local') ?? getOpt(args, '--user') ?? undefined,
              destinations,
              actor: 'cli',
            });
            printJson(result);
            return result.ok ? 0 : 1;
          } catch (e) {
            printJson({
              ok: false,
              notes: [e instanceof Error ? e.message : String(e)],
            });
            return 1;
          }
        }
        if (act === 'delete' || act === 'rm') {
          const id = getOpt(args, '--id') ?? getOpt(args, '--alias-id');
          if (!id?.trim()) {
            process.stderr.write(
              'Usage: ysk-server email aliases delete --domain example.com --id ALIAS_ID\n',
            );
            return 2;
          }
          try {
            const result = ctx.email.deleteAlias(row.id, id.trim(), 'cli');
            printJson(result);
            return result.ok ? 0 : 1;
          } catch (e) {
            printJson({
              ok: false,
              notes: [e instanceof Error ? e.message : String(e)],
            });
            return 4;
          }
        }
        process.stderr.write(
          'Usage: ysk-server email aliases list|create|delete --domain … [--local …] [--to dest@…]\n',
        );
        return 2;
      }

      if (sub === 'queue') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        const { listMailQueue, flushMailQueue } = await import('@ysk/core');
        if (act === 'list' || act === 'status') {
          printJson({ ...(await listMailQueue(ctx.host)), ok: true });
          return 0;
        }
        if (act === 'flush') {
          if (!wantsHostExecute(args)) {
            printJson({
              ok: false,
              blocked: true,
              dryRun: true,
              notes: ['Pass --execute to flush the mail queue on the host.'],
            });
            return 3;
          }
          const r = await flushMailQueue(ctx.host, {
            id: getOpt(args, '--id'),
            all: hasFlag(args, '--all') || !getOpt(args, '--id'),
          });
          printJson(r);
          return exitFromResult(r);
        }
        process.stderr.write('Usage: ysk-server email queue list|flush [--all|--id ID] [--execute]\n');
        return 2;
      }

      if (sub === 'relay') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'get';
        const { applySmtpRelay, loadSmtpRelaySettings } = await import('@ysk/core');
        if (act === 'get' || act === 'status' || act === 'show') {
          const stored = ctx.settings.get('email.smtp_relay');
          printJson({
            ok: true,
            settings: stored ? JSON.parse(stored) : null,
            files: loadSmtpRelaySettings(ctx.dataDir),
          });
          return 0;
        }
        if (act === 'set' || act === 'apply') {
          const hostName = getOpt(args, '--host') ?? getOpt(args, '--relay-host');
          if (!hostName?.trim()) {
            process.stderr.write(
              'Usage: ysk-server email relay apply --host smtp.example.com [--port 587] [--user …] [--password …] [--execute]\n',
            );
            return 2;
          }
          const result = await applySmtpRelay({
            dataDir: ctx.dataDir,
            host: ctx.host,
            relay: {
              host: hostName.trim(),
              port: Number(getOpt(args, '--port') ?? 587),
              username: getOpt(args, '--user') ?? getOpt(args, '--username'),
              password: getOpt(args, '--password'),
              security:
                (getOpt(args, '--security') as 'none' | 'starttls' | 'tls' | undefined) ??
                'starttls',
              domain: getOpt(args, '--domain'),
            },
            applySystem: wantsHostExecute(args),
            db: ctx.db,
            actor: 'cli',
          });
          printJson(result);
          return exitFromResult(result);
        }
        process.stderr.write(
          'Usage: ysk-server email relay get|apply --host … [--port 587] [--execute]\n',
        );
        return 2;
      }

      process.stderr.write(`${tl('cli.err.unknown.email.sub.sub.e37257', { sub })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'cron') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'help';
    const ctx = openCliContext(args);
    try {
      if (sub === 'help' || sub === '--help') {
        process.stderr.write(`${tl('cli.usage.cron.sub.--data-dir.path.--json.0349e6')}\n`);
        return 2;
      }
      if (sub === 'list') {
        const projectId = getOpt(args, '--project-id') ?? getOpt(args, '--project');
        let items = ctx.cron.list(projectId);
        const q = (getOpt(args, '--q') ?? '').trim().toLowerCase();
        if (q) {
          items = items.filter(
            (j) =>
              j.id.toLowerCase().includes(q) ||
              j.command.toLowerCase().includes(q) ||
              j.schedule.toLowerCase().includes(q) ||
              (j.user ?? '').toLowerCase().includes(q),
          );
        }
        printJson({ ok: true, items, meta: { total: items.length } });
        return 0;
      }
      if (sub === 'create') {
        const schedule = getOpt(args, '--schedule') ?? getOpt(args, '--cron');
        const commandLine = getOpt(args, '--command') ?? getOpt(args, '--cmd');
        if (!schedule || !commandLine) {
          process.stderr.write(`${tl('cli.usage.cron.create.--schedule.0.3.9a8328')}\n`);
          return 2;
        }
        const job = ctx.cron.create({
          projectId: getOpt(args, '--project-id') ?? getOpt(args, '--project'),
          user: getOpt(args, '--user') ?? 'ysk',
          schedule,
          command: commandLine,
          actor: 'cli',
        });
        printJson({ ok: true, job });
        return 0;
      }
      if (sub === 'delete' || sub === 'rm') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cron.delete.--id.job.id.f6aafe')}\n`);
          return 2;
        }
        const ok = ctx.cron.delete(id);
        printJson({ ok });
        return ok ? 0 : 4;
      }
      if (sub === 'enable' || sub === 'disable') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cron.sub.--id.job.id.99cfdf', { sub })}\n`);
          return 2;
        }
        const job = ctx.cron.setEnabled(id, sub === 'enable');
        if (!job) {
          printJson({ ok: false, code: ErrorCodes.NOT_FOUND });
          return 4;
        }
        printJson({ ok: true, job });
        return 0;
      }
      if (sub === 'run' || sub === 'run-now') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cron.run.--id.job.id.a0a97f')}\n`);
          return 2;
        }
        const r = await ctx.cron.runNow(id, 'cli');
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'install') {
        const r = await ctx.cron.installCrontab('cli');
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'status') {
        const status = await ctx.cron.probeInstallStatus();
        const jobs = ctx.cron.list();
        printJson({
          ok: true,
          ...status,
          jobCount: jobs.length,
          enabledCount: jobs.filter((j) => j.enabled).length,
        });
        return 0;
      }
      if (sub === 'host-list' || sub === 'host' || sub === 'host-scan') {
        const projects = (ctx.db.snapshot.projects ?? []).map((p) => ({
          id: String(p.id ?? ''),
          name: String(p.name ?? p.id ?? ''),
          linuxUser: String(p.linux_user ?? ''),
          linux_user: String(p.linux_user ?? ''),
        }));
        const inv = await ctx.cron.listHostCrontabs(projects);
        const userFilter = (getOpt(args, '--user') ?? '').trim();
        let lines = inv.lines;
        if (userFilter) {
          lines = lines.filter((l) => l.user === userFilter);
        }
        const jobsOnly = hasFlag(args, '--jobs-only');
        if (jobsOnly) {
          lines = lines.filter((l) => l.kind === 'job');
        }
        printJson({
          ok: true,
          partial: inv.partial,
          isRoot: inv.isRoot,
          executeEnabled: inv.executeEnabled,
          notes: inv.notes,
          users: inv.users,
          lines,
          jobCount: lines.filter((l) => l.kind === 'job').length,
        });
        return inv.partial && lines.length === 0 ? 3 : 0;
      }
      process.stderr.write(`${tl('cli.err.unknown.cron.sub.sub.e1a9ed', { sub })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'files') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'help';
    const {
      FileManager,
      publicFilesRoot,
      listFileShares,
      createFileShare,
      deleteFileShare,
      listFavorites,
      chownProjectPath,
      getWebDavSettings,
      issueWebDavToken,
      setWebDavSettings,
    } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'help' || sub === '--help') {
        process.stderr.write(`${tl('cli.usage.files.sub.--root.public.project.42ebd4')}\n`);
        return 2;
      }

      const rootParam = getOpt(args, '--root') ?? 'public';
      let root: string;
      let rootKey: string;
      let owner:
        | { linuxUser: string; linuxGroup: string; homeDir: string }
        | undefined;
      if (rootParam === 'public' || !rootParam) {
        root = publicFilesRoot(ctx.dataDir);
        rootKey = 'public';
      } else if (rootParam.startsWith('project:')) {
        const projectId = rootParam.slice('project:'.length);
        const proj = ctx.projects.get(projectId);
        root = proj.homeDir;
        rootKey = rootParam;
        owner = {
          linuxUser: proj.linuxUser,
          linuxGroup: proj.linuxGroup || proj.linuxUser,
          homeDir: proj.homeDir,
        };
      } else {
        process.stderr.write(`${tl('cli.msg.--root.must.be.a84834')}\n`);
        return 2;
      }
      const fm = new FileManager(root);

      const maybeChown = async (relPaths: string[]) => {
        if (!owner?.linuxUser) return { chowned: false, notes: [] as string[] };
        const notes: string[] = [];
        let any = false;
        for (const rel of relPaths) {
          if (!rel || rel === '.' || rel === '/') continue;
          const abs = join(owner.homeDir, rel.replace(/^\/+/, ''));
          const r = await chownProjectPath(ctx.host, owner, abs);
          notes.push(...r.notes);
          if (r.ok) any = true;
        }
        return { chowned: any, notes };
      };

      if (sub === 'list' || sub === 'ls') {
        const path = getOpt(args, '--path') ?? '.';
        const items = fm.list(path, {
          q: getOpt(args, '--q'),
          sort: (getOpt(args, '--sort') as 'name' | 'size' | 'mtime') || 'name',
          order: (getOpt(args, '--order') as 'asc' | 'desc') || 'asc',
        });
        printJson({
          ok: true,
          root: rootKey,
          path,
          items,
          usage: fm.usage(),
          meta: { total: items.length },
        });
        return 0;
      }

      if (sub === 'stat') {
        const path = getOpt(args, '--path');
        if (!path) {
          process.stderr.write(`${tl('cli.usage.files.stat.--path.rel.17c8f2')}\n`);
          return 2;
        }
        printJson({ ok: true, root: rootKey, ...fm.stat(path) });
        return 0;
      }

      if (sub === 'read') {
        const path = getOpt(args, '--path');
        if (!path) {
          process.stderr.write(`${tl('cli.usage.files.read.--path.rel.e35f8d')}\n`);
          return 2;
        }
        printJson({ ok: true, root: rootKey, ...fm.readText(path) });
        return 0;
      }

      if (sub === 'write') {
        const path = getOpt(args, '--path');
        if (!path) {
          process.stderr.write(`${tl('cli.usage.files.write.--path.rel.--content.0addb1')}\n`);
          return 2;
        }
        let content = getOpt(args, '--content');
        const localFile = getOpt(args, '--file');
        if (localFile) {
          const { readFileSync } = await import('node:fs');
          content = readFileSync(localFile, 'utf8');
        }
        if (content == null) {
          process.stderr.write(`${tl('cli.msg.need.--content.or.4d7001')}\n`);
          return 2;
        }
        const result = fm.writeText(path, content);
        const own = await maybeChown([path]);
        printJson({ ok: true, root: rootKey, ...result, ...own });
        return 0;
      }

      if (sub === 'mkdir') {
        const path = getOpt(args, '--path');
        if (!path) {
          process.stderr.write(`${tl('cli.usage.files.mkdir.--path.rel.ae0438')}\n`);
          return 2;
        }
        const result = fm.mkdir(path);
        const own = await maybeChown([path]);
        printJson({ ok: true, root: rootKey, ...result, ...own });
        return 0;
      }

      if (sub === 'rm' || sub === 'delete') {
        const path = getOpt(args, '--path');
        if (!path) {
          process.stderr.write(`${tl('cli.usage.files.rm.--path.rel.--permanent.fe2051')}\n`);
          return 2;
        }
        const result = hasFlag(args, '--permanent')
          ? fm.removePermanent(path)
          : fm.remove(path);
        printJson({ ok: true, root: rootKey, ...result });
        return result.deleted ? 0 : 4;
      }

      if (sub === 'rename') {
        const from = getOpt(args, '--from') ?? getOpt(args, '--src');
        const to = getOpt(args, '--to') ?? getOpt(args, '--dst');
        if (!from || !to) {
          process.stderr.write(`${tl('cli.usage.files.rename.--from.rel.--to.35a260')}\n`);
          return 2;
        }
        const result = fm.rename(from, to);
        const own = await maybeChown([to]);
        printJson({ ok: true, root: rootKey, ...result, ...own });
        return 0;
      }

      if (sub === 'copy' || sub === 'cp') {
        const from = getOpt(args, '--from') ?? getOpt(args, '--src');
        const to = getOpt(args, '--to') ?? getOpt(args, '--dst');
        if (!from || !to) {
          process.stderr.write(`${tl('cli.usage.files.copy.--from.rel.--to.5337f4')}\n`);
          return 2;
        }
        const result = fm.copy(from, to);
        const own = await maybeChown([to]);
        printJson({ ok: true, root: rootKey, ...result, ...own });
        return 0;
      }

      if (sub === 'move' || sub === 'mv') {
        const from = getOpt(args, '--from') ?? getOpt(args, '--src');
        const to = getOpt(args, '--to') ?? getOpt(args, '--dst');
        if (!from || !to) {
          process.stderr.write(`${tl('cli.usage.files.move.--from.rel.--to.75cf5d')}\n`);
          return 2;
        }
        const result = fm.move(from, to);
        const own = await maybeChown([to]);
        printJson({ ok: true, root: rootKey, ...result, ...own });
        return 0;
      }

      if (sub === 'chmod') {
        const path = getOpt(args, '--path');
        const mode = getOpt(args, '--mode');
        if (!path || !mode) {
          process.stderr.write(`${tl('cli.usage.files.chmod.--path.rel.--mode.39f983')}\n`);
          return 2;
        }
        const result = fm.chmod(path, mode);
        printJson({ ok: true, root: rootKey, ...result });
        return 0;
      }

      if (sub === 'trash') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        if (act === 'list') {
          printJson({ ok: true, root: rootKey, items: fm.listTrash() });
          return 0;
        }
        if (act === 'restore') {
          const id = getOpt(args, '--id');
          if (!id) {
            process.stderr.write(`${tl('cli.usage.files.trash.restore.--id.trash.c89ce9')}\n`);
            return 2;
          }
          printJson({ ok: true, root: rootKey, ...fm.restoreTrash(id) });
          return 0;
        }
        if (act === 'purge') {
          const id = getOpt(args, '--id');
          const purged = fm.purgeTrash(id ?? undefined);
          printJson({ root: rootKey, ...purged });
          return purged.ok ? 0 : 1;
        }
        process.stderr.write(`${tl('cli.usage.files.trash.list.restore.purge.ef063d')}\n`);
        return 2;
      }

      if (sub === 'shares') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        if (act === 'list') {
          printJson({ ok: true, root: rootKey, items: listFileShares(ctx.db, rootKey) });
          return 0;
        }
        if (act === 'create' || act === 'add') {
          const path = getOpt(args, '--path');
          if (!path?.trim()) {
            process.stderr.write(
              'Usage: ysk-server files shares create --path REL [--password …] [--expires ISO] --root public|project:ID\n',
            );
            return 2;
          }
          try {
            const share = createFileShare(ctx.db, {
              root: rootKey,
              path: path.trim(),
              password: getOpt(args, '--password') ?? undefined,
              expiresAt: getOpt(args, '--expires') ?? getOpt(args, '--expires-at') ?? undefined,
              createdBy: 'cli',
            });
            printJson({
              ok: true,
              root: rootKey,
              share,
              publicPath: `/share/${share.token}`,
            });
            return 0;
          } catch (e) {
            printJson({
              ok: false,
              notes: [e instanceof Error ? e.message : String(e)],
            });
            return 1;
          }
        }
        if (act === 'delete' || act === 'rm' || act === 'remove') {
          const id = getOpt(args, '--id') ?? getOpt(args, '--token');
          if (!id?.trim()) {
            process.stderr.write('Usage: ysk-server files shares delete --id SHARE_ID\n');
            return 2;
          }
          const ok = deleteFileShare(ctx.db, id.trim());
          printJson({ ok, root: rootKey });
          return ok ? 0 : 4;
        }
        process.stderr.write(
          'Usage: ysk-server files shares list|create|delete [--path …] [--id …]\n',
        );
        return 2;
      }

      if (sub === 'favorites' || sub === 'fav') {
        printJson({ ok: true, root: rootKey, items: listFavorites(ctx.db, rootKey) });
        return 0;
      }

      if (sub === 'upload') {
        const dir = (getOpt(args, '--dir') ?? '.').replace(/\/$/, '') || '.';
        const files: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if ((args[i] === '--file' || args[i] === '-f') && args[i + 1] && !args[i + 1].startsWith('-')) {
            files.push(args[i + 1]!);
          }
        }
        if (!files.length) {
          process.stderr.write(`${tl('cli.usage.files.upload.--dir.rel.--file.f8c3bf')}\n`);
          return 2;
        }
        const { readFileSync } = await import('node:fs');
        const { basename } = await import('node:path');
        const written: Array<{ path: string; bytes: number }> = [];
        for (const local of files.slice(0, 50)) {
          const name = basename(local);
          const rel = dir === '.' ? name : `${dir}/${name}`;
          const buf = readFileSync(local);
          const r = fm.writeBase64(rel, buf.toString('base64'));
          written.push(r);
          await maybeChown([rel]);
        }
        printJson({
          ok: true,
          root: rootKey,
          dir,
          count: written.length,
          items: written,
        });
        return 0;
      }

      if (sub === 'webdav') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'status';
        if (act === 'status') {
          const s = getWebDavSettings(ctx.db);
          printJson({
            ok: true,
            enabled: s.enabled,
            mountPath: s.mountPath,
            tokenId: s.tokenId ?? null,
            hasToken: Boolean(s.tokenHash),
            notes: [
              s.enabled
                ? 'WebDAV enabled — use Basic ysk:<token> on /webdav'
                : 'WebDAV disabled',
            ],
          });
          return 0;
        }
        if (act === 'token' || act === 'issue') {
          const r = issueWebDavToken(ctx.db);
          printJson({
            ok: true,
            token: r.token,
            tokenId: r.settings.tokenId,
            enabled: r.settings.enabled,
            notes: [
              ...r.notes,
              'Token shown once — store securely; password field = token',
            ],
          });
          return 0;
        }
        if (act === 'disable') {
          setWebDavSettings(ctx.db, { enabled: false });
          printJson({ ok: true, enabled: false, notes: ['WebDAV disabled'] });
          return 0;
        }
        process.stderr.write(`${tl('cli.usage.files.webdav.status.token.disable.f8e94b')}\n`);
        return 2;
      }

      process.stderr.write(`${tl('cli.err.unknown.files.sub.sub.07ad7e', { sub })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'store') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'status';
    if (sub === 'help' || sub === '--help') {
      process.stderr.write(`${tl('cli.usage.store.sub.--data-dir.path.--json.d580e4')}\n`);
      return 2;
    }
    const {
      exportStoreDocument,
      importStoreDocument,
      storeStatus,
      openDocumentStoreSync,
      resolveStoreBackend,
    } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'status') {
        const resolved = resolveStoreBackend({
          path: join(ctx.dataDir, 'ysk.json'),
          kind: (getOpt(args, '--kind') as 'json' | 'sqlite' | 'postgres' | undefined) ?? undefined,
        });
        printJson({
          ...storeStatus(ctx.db, join(ctx.dataDir, 'ysk.json')),
          resolved,
          dataDir: ctx.dataDir,
        });
        return 0;
      }
      if (sub === 'export') {
        const out = getOpt(args, '--out') ?? join(ctx.dataDir, 'exports', `store-${Date.now()}.json`);
        const r = exportStoreDocument(ctx.db, out);
        printJson(r);
        return 0;
      }
      if (sub === 'import') {
        const inp = getOpt(args, '--in') ?? getOpt(args, '--file');
        if (!inp) {
          process.stderr.write(`${tl('cli.usage.store.import.--in.file.json.5b6fdd')}\n`);
          return 2;
        }
        const r = importStoreDocument(ctx.db, inp);
        printJson(r);
        return 0;
      }
      if (sub === 'migrate') {
        const to = (getOpt(args, '--to') ?? '').toLowerCase();
        if (to !== 'json' && to !== 'sqlite') {
          process.stderr.write(`${tl('cli.usage.store.migrate.--to.json.sqlite.1c52a3')}\n`);
          return 2;
        }
        const out =
          getOpt(args, '--out') ??
          join(ctx.dataDir, to === 'sqlite' ? 'ysk.sqlite' : 'ysk.migrated.json');
        // Export then open target and import
        const tmp = join(ctx.dataDir, `.migrate-${process.pid}.json`);
        exportStoreDocument(ctx.db, tmp);
        const target = openDocumentStoreSync({
          kind: to as 'json' | 'sqlite',
          path: out,
        });
        importStoreDocument(target, tmp);
        target.close();
        printJson({
          ok: true,
          to,
          out,
          notes: [
            `migrated document → ${out}`,
            to === 'sqlite'
              ? 'Start with YSK_STORE=sqlite or -- path ending .sqlite'
              : 'JSON atomic file store',
          ],
        });
        return 0;
      }
      process.stderr.write(`${tl('cli.err.unknown.store.sub.sub.b7a083', { sub })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'cdn') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'help';
    const ctx = openCliContext(args);
    try {
      const {
        listCdnNodes,
        upsertCdnNode,
        deleteCdnNode,
        setCdnNodeDrain,
        probeAllCdnNodes,
        probeCdnNode,
        listCdnSites,
        upsertCdnSite,
        deleteCdnSite,
        getCdnSite,
        applyCdnSiteEdgeRender,
        fanOutCdnSite,
        purgeCdnSite,
        collectCdnDashboard,
        runAllCdnSitesHealthLoop,
        enableCdnFromProject,
        syncCdnSiteDns,
      } = await import('@ysk/core');

      if (sub === 'help' || sub === '--help') {
        process.stderr.write(`${tl('cli.usage.cdn.sub.--data-dir.path.--json.092842')}\n`);
        return 2;
      }

      if (sub === 'nodes') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        if (act === 'list') {
          const items = listCdnNodes(ctx.db);
          printJson({ ok: true, items, meta: { total: items.length } });
          return 0;
        }
        if (act === 'upsert' || act === 'create') {
          const name = getOpt(args, '--name');
          if (!name) {
            process.stderr.write(`${tl('cli.usage.cdn.nodes.upsert.--name.name.8f6f39')}\n`);
            return 2;
          }
          const node = upsertCdnNode(ctx.db, {
            id: getOpt(args, '--id'),
            name,
            baseUrl: getOpt(args, '--base-url'),
            fleetAgentId: getOpt(args, '--fleet-agent-id'),
            sshHost: getOpt(args, '--ssh-host'),
            sshPort: getOpt(args, '--ssh-port')
              ? Number(getOpt(args, '--ssh-port'))
              : undefined,
            sshUsername: getOpt(args, '--ssh-user'),
            sshIdentityId: getOpt(args, '--ssh-identity'),
            region: getOpt(args, '--region'),
            publicIpv4: getOpt(args, '--ipv4')
              ? String(getOpt(args, '--ipv4')).split(/[\s,]+/).filter(Boolean)
              : undefined,
            healthUrl: getOpt(args, '--health-url'),
          });
          printJson({ ok: true, node });
          return 0;
        }
        if (act === 'delete') {
          const id = getOpt(args, '--id');
          if (!id) {
            process.stderr.write(`${tl('cli.usage.cdn.nodes.delete.--id.node.0c6a1e')}\n`);
            return 2;
          }
          const ok = deleteCdnNode(ctx.db, id);
          printJson({ ok });
          return ok ? 0 : 4;
        }
        if (act === 'probe') {
          const id = getOpt(args, '--id');
          if (id) {
            const r = await probeCdnNode(ctx.db, id);
            printJson(r);
            return exitFromResult(r);
          }
          const r = await probeAllCdnNodes(ctx.db);
          printJson(r);
          return exitFromResult(r);
        }
        if (act === 'drain') {
          const id = getOpt(args, '--id');
          if (!id) {
            process.stderr.write(`${tl('cli.usage.cdn.nodes.drain.--id.node.a8aa81')}\n`);
            return 2;
          }
          const node = setCdnNodeDrain(ctx.db, id, !hasFlag(args, '--off'));
          printJson({ ok: true, node });
          return 0;
        }
        process.stderr.write(`${tl('cli.usage.cdn.nodes.list.upsert.delete.52549e')}\n`);
        return 2;
      }

      if (sub === 'sites') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        if (act === 'list') {
          const items = listCdnSites(ctx.db);
          printJson({ ok: true, items, meta: { total: items.length } });
          return 0;
        }
        if (act === 'get') {
          const id = getOpt(args, '--id') ?? getOpt(args, '--site-id');
          if (!id) {
            process.stderr.write(`${tl('cli.usage.cdn.sites.get.--id.site.3c3c35')}\n`);
            return 2;
          }
          const site = getCdnSite(ctx.db, id);
          if (!site) {
            printJson({ ok: false, code: ErrorCodes.NOT_FOUND });
            return 4;
          }
          printJson({ ok: true, site });
          return 0;
        }
        if (act === 'upsert' || act === 'create') {
          const name = getOpt(args, '--name');
          const domains = getOpt(args, '--domains') ?? getOpt(args, '--domain');
          if (!name || !domains) {
            process.stderr.write(`${tl('cli.usage.cdn.sites.upsert.--name.n.6ebb75')}\n`);
            return 2;
          }
          const edgeIds = args
            .map((a, i) => (a === '--edge-id' || a === '--edge' ? args[i + 1] : null))
            .filter((x): x is string => Boolean(x && !x.startsWith('-')));
          const originProject = getOpt(args, '--origin-project');
          const originUrl = getOpt(args, '--origin-url');
          const site = upsertCdnSite(ctx.db, {
            id: getOpt(args, '--id'),
            name,
            domains: domains.split(/[\s,]+/).filter(Boolean),
            edgeNodeIds: edgeIds.length ? edgeIds : undefined,
            origin: originProject
              ? { kind: 'project', projectId: originProject }
              : originUrl
                ? { kind: 'url', url: originUrl }
                : undefined,
            mode: getOpt(args, '--mode') as import('@ysk/shared').CdnSiteMode | undefined,
          });
          printJson({ ok: true, site });
          return 0;
        }
        if (act === 'delete') {
          const id = getOpt(args, '--id') ?? getOpt(args, '--site-id');
          if (!id) {
            process.stderr.write(`${tl('cli.usage.cdn.sites.delete.--id.site.51ef8f')}\n`);
            return 2;
          }
          const ok = deleteCdnSite(ctx.db, id);
          printJson({ ok });
          return ok ? 0 : 4;
        }
        process.stderr.write(`${tl('cli.usage.cdn.sites.list.get.upsert.609da6')}\n`);
        return 2;
      }

      if (sub === 'render') {
        const siteId = getOpt(args, '--site-id') ?? getOpt(args, '--id');
        if (!siteId) {
          process.stderr.write(`${tl('cli.usage.cdn.render.--site-id.id.--dry-run.2149eb')}\n`);
          return 2;
        }
        const r = await applyCdnSiteEdgeRender({
          db: ctx.db,
          dataDir: ctx.dataDir,
          siteId,
          host: ctx.host,
          dryRun: hasFlag(args, '--dry-run'),
        });
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'apply' || sub === 'fan-out' || sub === 'fanout') {
        const siteId = getOpt(args, '--site-id') ?? getOpt(args, '--id');
        if (!siteId) {
          process.stderr.write(`${tl('cli.usage.cdn.apply.--site-id.id.--edge-id.a527b3')}\n`);
          return 2;
        }
        const r = await fanOutCdnSite({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId,
          edgeNodeId: getOpt(args, '--edge-id') ?? getOpt(args, '--edge'),
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload),
        });
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'purge') {
        const siteId = getOpt(args, '--site-id') ?? getOpt(args, '--id');
        if (!siteId) {
          process.stderr.write(`${tl('cli.usage.cdn.purge.--site-id.id.--edge-id.bc08ec')}\n`);
          return 2;
        }
        const r = await purgeCdnSite({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId,
          edgeNodeId: getOpt(args, '--edge-id') ?? getOpt(args, '--edge'),
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload),
        });
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'dns-sync') {
        const siteId = getOpt(args, '--site-id') ?? getOpt(args, '--id');
        if (!siteId) {
          process.stderr.write(`${tl('cli.usage.cdn.dns-sync.--site-id.id.--apply-zone.343068')}\n`);
          return 2;
        }
        const r = await syncCdnSiteDns({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
          siteId,
          applyZone: hasFlag(args, '--apply-zone'),
          probeFirst: !hasFlag(args, '--no-probe'),
        });
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'probe') {
        const r = await probeAllCdnNodes(ctx.db);
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'dashboard') {
        const dash = await collectCdnDashboard({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
        });
        printJson({ ok: true, ...dash });
        return 0;
      }

      if (sub === 'health-loop') {
        const r = await runAllCdnSitesHealthLoop({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
          applyZone: hasFlag(args, '--apply-zone'),
        });
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'from-project') {
        const projectId = getOpt(args, '--project-id') ?? getOpt(args, '--id');
        if (!projectId) {
          process.stderr.write(`${tl('cli.usage.cdn.from-project.--project-id.id.--edge-id.a96f42')}\n`);
          return 2;
        }
        const proj = ctx.projects.get(projectId);
        const edgeIds = args
          .map((a, i) => (a === '--edge-id' || a === '--edge' ? args[i + 1] : null))
          .filter((x): x is string => Boolean(x && !x.startsWith('-')));
        const r = enableCdnFromProject({
          db: ctx.db,
          project: proj,
          edgeNodeIds: edgeIds.length ? edgeIds : undefined,
          name: getOpt(args, '--name'),
        });
        printJson(r);
        return r.ok ? 0 : 1;
      }

      process.stderr.write(`${tl('cli.err.unknown.cdn.subcommand.sub.76664f', { sub })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'agents') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0];
    // Fleet registry (panel parity)
    if (sub === 'fleet' || sub === 'list' || sub === 'register' || sub === 'commands') {
      const ctx = openCliContext(args);
      try {
        if (sub === 'fleet' || sub === 'list') {
          const act =
            sub === 'list'
              ? 'list'
              : (args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list');
          if (act === 'list' || sub === 'list') {
            const group = getOpt(args, '--group');
            const items = ctx.fleet.list(group);
            printJson({
              ok: true,
              items,
              notes: [
                'status registered = panel-only (not live); connected = heartbeat seen',
                'stale when last_seen > 60s (connected) or > 5m (registered)',
              ],
            });
            return 0;
          }
          if (act === 'register') {
            const agentId = getOpt(args, '--id') ?? getOpt(args, '--agent-id');
            if (!agentId) {
              process.stderr.write(`${tl('cli.usage.agents.fleet.register.--id.agent.209b2d')}\n`);
              return 2;
            }
            const row = ctx.fleet.register(
              agentId,
              getOpt(args, '--group'),
              hasFlag(args, '--edge') ? { source: 'edge' } : { source: 'cli' },
            );
            printJson({
              ok: true,
              agent: row,
              notes: [
                row.status === 'registered'
                  ? 'panel/cli register only — not live until heartbeat'
                  : 'edge-style register (connected)',
              ],
            });
            return 0;
          }
          if (act === 'commands') {
            const sessionId = getOpt(args, '--session') ?? getOpt(args, '--id');
            if (!sessionId) {
              process.stderr.write(`${tl('cli.usage.agents.fleet.commands.--session.session.f8067c')}\n`);
              return 2;
            }
            const items = ctx.fleet.listCommands(sessionId);
            printJson({
              ok: true,
              items,
              notes: ['queued ≠ done — agent must pull + ack'],
            });
            return 0;
          }
          if (act === 'remove' || act === 'delete') {
            const sessionId = getOpt(args, '--session') ?? getOpt(args, '--id');
            if (!sessionId) {
              process.stderr.write(`${tl('cli.usage.agents.fleet.remove.--session.session.1827fe')}\n`);
              return 2;
            }
            const r = ctx.fleet.remove(sessionId);
            printJson(r);
            return 0;
          }
        }
        if (sub === 'register') {
          const agentId = getOpt(args, '--id') ?? getOpt(args, '--agent-id');
          if (!agentId) {
            process.stderr.write(`${tl('cli.usage.agents.register.--id.agent.id.3c4477')}\n`);
            return 2;
          }
          const row = ctx.fleet.register(agentId, getOpt(args, '--group'), { source: 'cli' });
          printJson({ ok: true, agent: row });
          return 0;
        }
        if (sub === 'commands') {
          const sessionId = getOpt(args, '--session') ?? getOpt(args, '--id');
          if (!sessionId) {
            process.stderr.write(`${tl('cli.usage.agents.commands.--session.session.id.e620d2')}\n`);
            return 2;
          }
          printJson({ ok: true, items: ctx.fleet.listCommands(sessionId) });
          return 0;
        }
      } finally {
        closeAppContext(ctx);
      }
    }
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
        dataDir: dataDir ?? config?.dataDir });
      try {
        printJson({ ok: true, items: await probeAllAgentRuntimes(ctx.host) });
        return 0;
      } finally {
        closeAppContext(ctx);
      }
    }
    if (sub === 'runtimes' || !sub) {
      const data = listAgentRuntimes();
      if (json) printJson({ ok: true, code: 'YSK_AGENTS', message: tl('notes.auto.n0076'), data });
      else {
        for (const a of data) process.stdout.write(`${a.kind}\t${a.name}\t${a.status}\n`);
      }
      return 0;
    }
    process.stderr.write(`${tl('cli.usage.agents.runtimes.probe.fleet.list.261fa4')}\n`);
    return 2;
  }

  if (command === 'agent') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'run';
    if (sub !== 'run') {
      process.stderr.write(`${tl('cli.usage.agent.run.--control-plane.url.--id.cfefbe')}\n`);
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
        const payload = cmd.payload as {
          cli?: string[];
          op?: string;
          cluster?: unknown;
          siteId?: string;
          confContent?: string;
          confBasename?: string;
          remoteDir?: string;
          cacheDir?: string;
          edgeNodeId?: string;
        };
        // CDN fleet apply / purge on edge (honest local write + nginx)
        if (
          payload?.op === 'cdn.edge.apply' ||
          payload?.op === 'cdn.edge.purge'
        ) {
          const { isCdnFleetPayload, runCdnFleetPayload } = await import(
            '@ysk/core'
          );
          if (!isCdnFleetPayload(payload)) {
            return {
              ok: false,
              exitCode: 2,
              error: 'invalid cdn fleet payload',
              at: new Date().toISOString() };
          }
          const dataDir =
            getOpt(args, '--data-dir') ??
            process.env.YSK_DATA_DIR ??
            join(process.cwd(), '.ysk');
          const ctxCdn = openCliContext([
            ...args.filter((a) => a.startsWith('--')),
            '--data-dir',
            dataDir,
          ]);
          try {
            const r = await runCdnFleetPayload(ctxCdn.host, payload);
            return {
              ...r,
              ok: r.ok,
              exitCode: r.exitCode,
              at: r.at };
          } finally {
            closeAppContext(ctxCdn);
          }
        }
        // Fleet cluster sync: upsert registry + plan on edge
        if (payload?.op === 'clusterSync' && payload.cluster) {
          const { importDbClusterSync } = await import('@ysk/core');
          const dataDir =
            getOpt(args, '--data-dir') ??
            process.env.YSK_DATA_DIR ??
            join(process.cwd(), '.ysk');
          const ctxSync = openCliContext([
            ...args.filter((a) => a.startsWith('--')),
            '--data-dir',
            dataDir,
          ]);
          try {
            const r = importDbClusterSync({
              db: ctxSync.db,
              dataDir: ctxSync.dataDir,
              cluster: payload.cluster as import('@ysk/core').DbCluster });
            return {
              ok: r.ok,
              exitCode: r.ok ? 0 : 1,
              op: 'clusterSync',
              result: r,
              at: new Date().toISOString() };
          } finally {
            closeAppContext(ctxSync);
          }
        }
        // Preferred payload: { "cli": ["projects", "list", "--json"] }
        if (Array.isArray(payload?.cli) && payload.cli.length > 0) {
          const { spawnSync } = await import('node:child_process');
          const bin = process.argv[1] ?? 'ysk-server';
          const argv = payload.cli.map(String);
          if (!argv.includes('--json')) argv.push('--json');
          // strip import-sync alone — handled via clusterSync
          if (argv[0] === 'db-cluster' && argv[1] === 'import-sync') {
            return {
              ok: false,
              exitCode: 2,
              note: 'Use payload.op=clusterSync with cluster snapshot',
              at: new Date().toISOString() };
          }
          const r = spawnSync(process.execPath, [bin, ...argv], {
            encoding: 'utf8',
            env: process.env,
            timeout: 120_000 });
          let parsed: unknown = r.stdout;
          try {
            parsed = JSON.parse(r.stdout || 'null');
          } catch {
            /* raw */
          }
          const exitCode = r.status ?? 1;
          return {
            ok: exitCode === 0,
            exitCode,
            cli: argv,
            result: parsed,
            stderr: (r.stderr || '').slice(0, 4000),
            at: new Date().toISOString() };
        }
        if (payload?.op === 'ping') {
          return { ok: true, exitCode: 0, op: 'pong', at: new Date().toISOString() };
        }
        return {
          ok: true,
          exitCode: 0,
          echo: cmd.payload,
          note: 'Pass { "cli": [...] } or { "op":"clusterSync", "cluster":{...} }',
          at: new Date().toISOString() };
      } });
    return 0;
  }

  if (command === 'ask') {
    const prompt = args.filter((a) => !a.startsWith('-')).slice(1).join(' ');
    if (!prompt) {
      process.stderr.write(`${tl('cli.usage.ask.check.system.info.b0c781')}\n`);
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
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'help';
    const configPath = getOpt(args, '--config');
    const dataDir = getOpt(args, '--data-dir');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    if (dataDir) {
      config = config ? { ...config, dataDir } : ({ dataDir } as NonNullable<typeof config>);
    }
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const {
      backupAllProjects,
      backupControlPlane,
      restoreControlPlaneBackup,
      restoreProjectBackup,
      deleteProjectBackup,
      listBackups,
      filterBackupList,
      getBackupExclusions,
      getBackupRemotePublic,
      getResticSettingsPublic,
      getResticSettings,
      setBackupRemote,
      setBackupExclusions,
      setResticSettings,
      resticBackupProject,
      listResticSnapshots,
      resticRestoreProject,
      pushBackupRemote,
      localizeLastBackupRun,
      CONTROL_PLANE_BACKUP_ID,
    } = await import('@ysk/core');
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDir ?? config?.dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1',
    });
    try {
      if (sub === 'help' || sub === '--help') {
        process.stderr.write(`${tl('cli.usage.backup.sub.--data-dir.path.--json.777243')}\n`);
        return 2;
      }

      if (sub === 'list') {
        const items = filterBackupList(listBackups(ctx.dataDir), {
          projectId: getOpt(args, '--project-id') ?? getOpt(args, '--id'),
          q: getOpt(args, '--q'),
        });
        printJson({
          ok: true,
          items,
          meta: { total: items.length },
        });
        return 0;
      }

      if (sub === 'status') {
        const rawLast = ctx.settings.getJson<Record<string, unknown>>('last_backup_run');
        const items = listBackups(ctx.dataDir);
        const schedule = await ctx.cron.probeInstallStatus();
        const jobs = ctx.cron
          .list()
          .filter((j) => j.command.includes('ysk-backup-all') || j.command.includes('backup all'));
        printJson({
          ok: true,
          dataDir: ctx.dataDir,
          archiveCount: items.length,
          controlPlaneCount: items.filter((x) => x.projectId === CONTROL_PLANE_BACKUP_ID).length,
          lastRun: localizeLastBackupRun(rawLast ?? null),
          lastControlPlane: ctx.settings.getJson('last_control_plane_backup'),
          scheduleJobs: jobs,
          schedule,
        });
        return 0;
      }

      if (sub === 'settings') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'get';
        if (act === 'get' || act === 'show' || act === 'list') {
          printJson({
            ok: true,
            remote: getBackupRemotePublic(ctx.db),
            exclusions: getBackupExclusions(ctx.db),
            restic: getResticSettingsPublic(ctx.db),
          });
          return 0;
        }
        if (act === 'set' || act === 'update') {
          const fromJson = getOpt(args, '--from-json') ?? getOpt(args, '--file');
          if (fromJson) {
            const { readFileSync } = await import('node:fs');
            const patch = JSON.parse(readFileSync(fromJson, 'utf8')) as {
              remote?: Record<string, unknown>;
              exclusions?: string[];
              restic?: Record<string, unknown>;
            };
            if (patch.remote) setBackupRemote(ctx.db, patch.remote as never);
            if (patch.exclusions) setBackupExclusions(ctx.db, patch.exclusions);
            if (patch.restic) setResticSettings(ctx.db, patch.restic as never);
          } else {
            // remote flags
            const kind = getOpt(args, '--remote-kind') as 'local' | 'sftp' | 's3' | undefined;
            const remotePatch: Record<string, unknown> = {};
            if (kind) remotePatch.kind = kind;
            if (hasFlag(args, '--remote-enable')) remotePatch.enabled = true;
            if (hasFlag(args, '--remote-disable')) remotePatch.enabled = false;
            if (getOpt(args, '--remote-path')) remotePatch.path = getOpt(args, '--remote-path');
            if (getOpt(args, '--remote-host')) remotePatch.host = getOpt(args, '--remote-host');
            if (getOpt(args, '--remote-user')) remotePatch.username = getOpt(args, '--remote-user');
            if (getOpt(args, '--remote-password'))
              remotePatch.password = getOpt(args, '--remote-password');
            if (getOpt(args, '--remote-port'))
              remotePatch.port = Number(getOpt(args, '--remote-port'));
            if (getOpt(args, '--s3-bucket')) remotePatch.s3Bucket = getOpt(args, '--s3-bucket');
            if (getOpt(args, '--s3-region')) remotePatch.s3Region = getOpt(args, '--s3-region');
            if (Object.keys(remotePatch).length) setBackupRemote(ctx.db, remotePatch as never);

            const excl =
              getOpt(args, '--exclude') ?? getOpt(args, '--exclusions') ?? getOpt(args, '--exclude-list');
            if (excl) {
              setBackupExclusions(
                ctx.db,
                excl.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
              );
            }
            const exclFile = getOpt(args, '--exclusions-file');
            if (exclFile) {
              const { readFileSync } = await import('node:fs');
              setBackupExclusions(
                ctx.db,
                readFileSync(exclFile, 'utf8')
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              );
            }

            const resticPatch: Record<string, unknown> = {};
            if (hasFlag(args, '--restic-enable')) resticPatch.enabled = true;
            if (hasFlag(args, '--restic-disable')) resticPatch.enabled = false;
            if (getOpt(args, '--restic-password'))
              resticPatch.password = getOpt(args, '--restic-password');
            if (getOpt(args, '--restic-repo')) resticPatch.repoPath = getOpt(args, '--restic-repo');
            if (getOpt(args, '--restic-s3')) resticPatch.s3Repo = getOpt(args, '--restic-s3');
            if (Object.keys(resticPatch).length) setResticSettings(ctx.db, resticPatch as never);
          }
          printJson({
            ok: true,
            remote: getBackupRemotePublic(ctx.db),
            exclusions: getBackupExclusions(ctx.db),
            restic: getResticSettingsPublic(ctx.db),
            notes: ['settings saved (secrets masked in response)'],
          });
          return 0;
        }
        // default: get (back-compat: `backup settings` alone)
        printJson({
          ok: true,
          remote: getBackupRemotePublic(ctx.db),
          exclusions: getBackupExclusions(ctx.db),
          restic: getResticSettingsPublic(ctx.db),
        });
        return 0;
      }

      if (sub === 'control-plane' || sub === 'cp') {
        ctx.db.persist();
        const r = await backupControlPlane({ host: ctx.host, dataDir: ctx.dataDir });
        ctx.settings.setJson('last_control_plane_backup', {
          at: new Date().toISOString(),
          ok: r.ok,
          archivePath: r.archivePath,
          bytes: r.bytes,
          notes: r.notes,
          via: 'cli',
        });
        printJson(r);
        return r.ok ? 0 : 1;
      }

      if (sub === 'control-plane-restore' || sub === 'cp-restore') {
        const name = getOpt(args, '--name');
        if (!name) {
          process.stderr.write(`${tl('cli.usage.backup.control-plane-restore.--name.archive.--mode.316a76')}\n`);
          return 2;
        }
        const mode = (getOpt(args, '--mode') as 'dry-run' | 'full' | undefined) ?? 'dry-run';
        const r = await restoreControlPlaneBackup({
          host: ctx.host,
          dataDir: ctx.dataDir,
          archiveName: name,
          mode,
          confirmPhrase: getOpt(args, '--confirm'),
        });
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'restore') {
        const projectId = getOpt(args, '--project-id') ?? getOpt(args, '--id');
        const name = getOpt(args, '--name');
        const mode = (getOpt(args, '--mode') as 'full' | 'web' | 'dry-run' | undefined) ?? 'full';
        if (!projectId || !name) {
          process.stderr.write(`${tl('cli.usage.backup.restore.--project-id.id.--name.bc7041')}\n`);
          return 2;
        }
        if (projectId === CONTROL_PLANE_BACKUP_ID) {
          process.stderr.write(`${tl('cli.msg.use.ysk-server.backup.ca67f4')}\n`);
          return 2;
        }
        const project = ctx.db.snapshot.projects.find((p) => p.id === projectId);
        if (!project) {
          printJson({ ok: false, code: ErrorCodes.NOT_FOUND, notes: [tl('notes.auto.n0028')] });
          return 4;
        }
        const r = await restoreProjectBackup({
          host: ctx.host,
          dataDir: ctx.dataDir,
          projectId,
          archiveName: name,
          homeDir: project.home_dir,
          linuxUser: project.linux_user,
          linuxGroup: project.linux_group || project.linux_user,
          mode,
        });
        printJson(r);
        return exitFromResult(r);
      }

      if (sub === 'delete') {
        const projectId = getOpt(args, '--project-id') ?? getOpt(args, '--id');
        const name = getOpt(args, '--name');
        if (!projectId || !name) {
          process.stderr.write(`${tl('cli.usage.backup.delete.--project-id.id.--name.d66c29')}\n`);
          return 2;
        }
        const r = deleteProjectBackup(ctx.dataDir, projectId, name);
        printJson(r);
        return r.ok ? 0 : 1;
      }

      if (sub === 'schedule') {
        const cronExpr = getOpt(args, '--cron') ?? getOpt(args, '--schedule') ?? '0 3 * * *';
        const job = ctx.cron.ensureBackupSchedule(cronExpr);
        let install: Awaited<ReturnType<typeof ctx.cron.installCrontab>> | undefined;
        if (hasFlag(args, '--install') || wantsHostExecute(args)) {
          install = await ctx.cron.installCrontab('cli');
        }
        const probe = await ctx.cron.probeInstallStatus();
        const overallOk = install ? install.ok : true;
        printJson({
          ok: overallOk,
          job,
          install: install ?? null,
          schedule: probe,
          notes: [
            `schedule=${job.schedule}`,
            `command=${job.command}`,
            install
              ? install.ok
                ? 'host crontab installed'
                : install.notes.join('; ')
              : 'managed crontab written; pass --install + YSK_EXECUTE=1 to load host crontab',
          ],
        });
        return overallOk ? 0 : exitFromResult(install ?? { ok: false });
      }

      if (sub === 'restic') {
        const resticSub = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        if (resticSub === 'list') {
          const r = await listResticSnapshots({
            host: ctx.host,
            db: ctx.db,
            dataDir: ctx.dataDir,
            projectId: getOpt(args, '--project-id') ?? getOpt(args, '--id'),
          });
          printJson(r);
          return exitFromResult(r);
        }
        if (resticSub === 'run') {
          const rs = getResticSettings(ctx.db);
          if (!rs.enabled || !rs.password?.trim()) {
            printJson({
              ok: false,
              notes: [
                !rs.enabled ? 'restic disabled in settings' : 'restic password not set',
              ],
            });
            return 2;
          }
          const projects = ctx.db.snapshot.projects.slice(0, 40);
          const results = [];
          for (const p of projects) {
            results.push({
              projectId: p.id,
              ...(await resticBackupProject({
                host: ctx.host,
                dataDir: ctx.dataDir,
                db: ctx.db,
                projectId: p.id,
                homeDir: p.home_dir,
              })),
            });
          }
          const attempted = results.filter((row) => !row.skipped);
          const ok = attempted.length === 0 ? true : attempted.every((row) => row.ok);
          printJson({ ok, results });
          return ok ? 0 : 1;
        }
        if (resticSub === 'restore') {
          const projectId = getOpt(args, '--project-id') ?? getOpt(args, '--id');
          const snapshotId = getOpt(args, '--snapshot') ?? getOpt(args, '--snapshot-id');
          if (!projectId || !snapshotId) {
            process.stderr.write(`${tl('cli.usage.backup.restic.restore.--project-id.id.a8f133')}\n`);
            return 2;
          }
          const p = ctx.db.snapshot.projects.find((x) => x.id === projectId);
          if (!p) {
            printJson({ ok: false, code: ErrorCodes.NOT_FOUND });
            return 4;
          }
          const r = await resticRestoreProject({
            host: ctx.host,
            db: ctx.db,
            dataDir: ctx.dataDir,
            projectId: p.id,
            homeDir: p.home_dir,
            snapshotId,
            targetDir: getOpt(args, '--target'),
            overwriteHome: hasFlag(args, '--overwrite-home'),
            confirmPhrase: getOpt(args, '--confirm'),
            dryRun: hasFlag(args, '--dry-run') || !hasFlag(args, '--overwrite-home'),
          });
          printJson(r);
          return exitFromResult(r);
        }
        process.stderr.write(`${tl('cli.usage.backup.restic.list.run.restore.10402b')}\n`);
        return 2;
      }

      if (sub === 'all') {
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
        const sideResults: Array<{
          projectId: string;
          kind: 'remote' | 'restic';
          ok: boolean;
          skipped?: boolean;
          notes: string[];
        }> = [];
        let sideOk = true;
        const resticOn = getResticSettings(ctx.db).enabled;
        for (const item of r.results) {
          if (item.ok && item.archivePath && !item.skipped) {
            const p = ctx.db.snapshot.projects.find((x) => x.id === item.projectId);
            if (p) {
              p.last_backup_path = item.archivePath;
              p.last_backup_at = new Date().toISOString();
              p.updated_at = new Date().toISOString();
            }
            try {
              const push = await pushBackupRemote({
                host: ctx.host,
                db: ctx.db,
                dataDir: ctx.dataDir,
                localArchivePath: item.archivePath,
              });
              sideResults.push({
                projectId: item.projectId,
                kind: 'remote',
                ok: push.ok,
                skipped: push.skipped,
                notes: push.notes,
              });
              if (!push.skipped && !push.ok) sideOk = false;
            } catch (e) {
              sideOk = false;
              sideResults.push({
                projectId: item.projectId,
                kind: 'remote',
                ok: false,
                notes: [e instanceof Error ? e.message : String(e)],
              });
            }
            if (resticOn && p) {
              try {
                const rs = await resticBackupProject({
                  host: ctx.host,
                  dataDir: ctx.dataDir,
                  db: ctx.db,
                  projectId: p.id,
                  homeDir: p.home_dir,
                });
                sideResults.push({
                  projectId: item.projectId,
                  kind: 'restic',
                  ok: rs.ok,
                  skipped: rs.skipped,
                  notes: rs.notes,
                });
                if (!rs.skipped && !rs.ok) sideOk = false;
              } catch (e) {
                sideOk = false;
                sideResults.push({
                  projectId: item.projectId,
                  kind: 'restic',
                  ok: false,
                  notes: [e instanceof Error ? e.message : String(e)],
                });
              }
            }
          }
        }
        ctx.db.persist();
        const overallOk = r.ok && sideOk;
        const payload = {
          at: new Date().toISOString(),
          ...r,
          ok: overallOk,
          tarOk: r.ok,
          sideOk,
          sideResults,
          via: 'cli',
        };
        ctx.settings.setJson('last_backup_run', payload);
        printJson(payload);
        return overallOk ? 0 : 1;
      }

      process.stderr.write(`${tl('cli.err.unknown.backup.subcommand.sub.4092ad', { sub })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** Panel parity: users / packages / rbac / audit / security */
  if (
    command === 'users' ||
    command === 'packages' ||
    command === 'rbac' ||
    command === 'audit' ||
    command === 'security'
  ) {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'list';
    const configPath = getOpt(args, '--config');
    const dataDir = getOpt(args, '--data-dir');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    if (dataDir) {
      config = config ? { ...config, dataDir } : ({ dataDir } as NonNullable<typeof config>);
    }
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const { applyListQuery } = await import('@ysk/core');
    const { parseListQuery } = await import('@ysk/shared');
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDir ?? config?.dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1',
    });
    try {
      if (command === 'users') {
        if (sub === 'list') {
          const all = ctx.usersAdmin.listUsers();
          const q = getOpt(args, '--q') ?? '';
          const role = getOpt(args, '--role');
          const url = new URL('http://local/');
          if (q) url.searchParams.set('q', q);
          if (role) url.searchParams.set('role', role);
          const query = parseListQuery(url, {
            enums: { role: ['admin', 'operator', 'viewer', 'agent'] },
          });
          const { items, meta } = applyListQuery(all, query, {
            text: (u) => [u.username, u.roles.join(' '), u.packageId ?? ''],
            predicates: {
              role: (u, v) => u.roles.includes(v as never),
            },
          });
          printJson({ ok: true, items, meta });
          return 0;
        }
        if (sub === 'create') {
          const username = getOpt(args, '--username') ?? getOpt(args, '--user');
          const password = getOpt(args, '--password');
          if (!username || !password) {
            process.stderr.write(`${tl('cli.usage.users.create.--username.u.--password.7145c7')}\n`);
            return 2;
          }
          const role = (getOpt(args, '--role') ?? 'operator') as
            | 'admin'
            | 'operator'
            | 'viewer';
          const created = ctx.usersAdmin.createUser({
            username,
            password,
            roles: [role],
            packageId: getOpt(args, '--package-id') ?? undefined,
            actor: 'cli',
          });
          printJson({ ok: true, user: created });
          return 0;
        }
        process.stderr.write(`${tl('cli.usage.users.list.--q.text.--role.544685')}\n`);
        return 2;
      }
      if (command === 'packages') {
        if (sub === 'list') {
          const all = ctx.usersAdmin.listPackages();
          const q = getOpt(args, '--q') ?? '';
          const url = new URL('http://local/');
          if (q) url.searchParams.set('q', q);
          const query = parseListQuery(url);
          const { items, meta } = applyListQuery(all, query, {
            text: (p) => [p.name, p.notes ?? '', p.id],
          });
          printJson({ ok: true, items, meta });
          return 0;
        }
        process.stderr.write(`${tl('cli.usage.packages.list.--q.text.b8e16b')}\n`);
        return 2;
      }
      if (command === 'rbac') {
        if (sub === 'list' || sub === 'policies') {
          printJson({ ok: true, items: ctx.rbac.listPolicies() });
          return 0;
        }
        if (sub === 'show') {
          const role = (getOpt(args, '--role') ?? 'operator') as
            | 'admin'
            | 'operator'
            | 'viewer'
            | 'agent';
          printJson({
            ok: true,
            role,
            policy: ctx.rbac.getEffectivePolicy(role),
          });
          return 0;
        }
        if (sub === 'audit' || sub === 'routes') {
          const { matchMutatingRouteCap, MUTATING_ROUTE_CAP_RULES } = await import(
            '@ysk/shared'
          );
          const samples: Array<{ method: string; path: string; cap: string | null }> = [
            ['POST', '/api/v1/users'],
            ['POST', '/api/v1/users/x/impersonate'],
            ['DELETE', '/api/v1/projects/x'],
            ['POST', '/api/v1/projects/x/publish-nginx'],
            ['POST', '/api/v1/backups/restore'],
            ['POST', '/api/v1/defense/ban'],
            ['POST', '/api/v1/tools/execute'],
            ['POST', '/api/v1/db/clusters'],
            ['POST', '/api/v1/network/apply'],
            ['POST', '/api/v1/future-unknown/op'],
          ].map(([method, path]) => ({
            method,
            path,
            cap: matchMutatingRouteCap(method, path),
          }));
          printJson({
            ok: true,
            ruleCount: MUTATING_ROUTE_CAP_RULES.length,
            failClosedFallback: true,
            samples,
            note: 'Central enforceMutatingRouteCaps on all mutating /api/v1; public auth/agent prefixes skipped',
          });
          return 0;
        }
        process.stderr.write(`${tl('cli.usage.rbac.list.policies.330ade')}\n`);
        return 2;
      }
      if (command === 'audit') {
        const limit = Math.min(500, Number(getOpt(args, '--limit') ?? 100) || 100);
        const all = ctx.audit.listRecent(limit) as unknown as Array<Record<string, unknown>>;
        const q = getOpt(args, '--q') ?? '';
        const url = new URL('http://local/');
        if (q) url.searchParams.set('q', q);
        const query = parseListQuery(url);
        const { items, meta } = applyListQuery(all, query, {
          text: (e: Record<string, unknown>) => [
            String(e.actor ?? ''),
            String(e.action ?? ''),
            String(e.resource ?? ''),
          ],
        });
        printJson({ ok: true, items, meta });
        return 0;
      }
      if (command === 'security') {
        const resolveUserId = (): { id: string; username: string } | null => {
          const want =
            getOpt(args, '--user') ?? getOpt(args, '--username') ?? getOpt(args, '--user-id');
          const all = ctx.usersAdmin.listUsers();
          if (want) {
            const byId = all.find((u) => u.id === want);
            if (byId) return { id: byId.id, username: byId.username };
            const byName = all.find((u) => u.username === want);
            if (byName) return { id: byName.id, username: byName.username };
            return null;
          }
          const admin = all.find((u) => u.roles.includes('admin')) ?? all[0];
          return admin ? { id: admin.id, username: admin.username } : null;
        };

        // security | security status | security list (back-compat default sub)
        if (sub === 'list' || sub === 'status' || sub === 'help') {
          if (sub === 'help') {
            process.stderr.write(`${tl('cli.security.help')}\n`);
            return 2;
          }
          const users = ctx.usersAdmin.listUsers();
          const admins = users.filter((u) => u.roles.includes('admin'));
          const storeAdmins = ctx.db.snapshot.users.filter((u) =>
            u.roles.includes('admin'),
          );
          const requireTotp =
            ctx.db.snapshot.settings?.['security.require_admin_totp'] === '1';
          const strict =
            ctx.db.snapshot.settings?.['security.require_admin_totp_strict'] === '1';
          printJson({
            ok: true,
            requireAdminTotp: requireTotp,
            requireAdminTotpStrict: strict,
            adminCount: admins.length,
            adminsWith2fa: admins.filter((u) => u.totpEnabled).length,
            mustChangePassword: storeAdmins.filter((u) => u.must_change_password).length,
            listenPublic: ctx.db.snapshot.settings?.['security.listen_public'] === '1',
            bootstrapInsecure:
              ctx.db.snapshot.settings?.['security.bootstrap_insecure'] === '1',
          });
          return 0;
        }

        if (sub === 'sessions') {
          const action = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
          const target = resolveUserId();
          if (!target) {
            process.stderr.write(`${tl('cli.security.noUser')}\n`);
            return 4;
          }
          if (action === 'list') {
            const items = ctx.auth.listSessions(target.id);
            printJson({ ok: true, userId: target.id, username: target.username, items });
            return 0;
          }
          if (action === 'revoke') {
            const id = getOpt(args, '--id') ?? getOpt(args, '--session');
            if (!id) {
              process.stderr.write(`${tl('cli.security.sessionRevokeUsage')}\n`);
              return 2;
            }
            const ok = ctx.auth.revokeSession(target.id, id);
            printJson({ ok, userId: target.id, username: target.username, sessionId: id });
            return ok ? 0 : 4;
          }
          if (action === 'revoke-others' || action === 'revoke-all') {
            // CLI has no live Bearer — optional --keep-token; empty keeps none (full wipe for user)
            const keep = getOpt(args, '--keep-token') ?? '';
            const n = ctx.auth.revokeOtherSessions(target.id, keep);
            printJson({
              ok: true,
              userId: target.id,
              username: target.username,
              revoked: n,
              keptToken: keep ? true : false,
            });
            return 0;
          }
          process.stderr.write(`${tl('cli.security.sessionsHelp')}\n`);
          return 2;
        }

        if (sub === 'api-keys' || sub === 'api-key' || sub === 'apikeys') {
          const action = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
          const { listApiKeys, createApiKey, deleteApiKey } = await import('@ysk/core');
          if (action === 'list') {
            const items = listApiKeys(ctx.db);
            printJson({ ok: true, items });
            return 0;
          }
          if (action === 'create') {
            const name = getOpt(args, '--name') ?? 'cli-key';
            const scopeRaw = getOpt(args, '--scope') ?? 'full';
            const scope = scopeRaw === 'read' ? 'read' : 'full';
            const target = resolveUserId();
            if (!target) {
              process.stderr.write(`${tl('cli.security.noUser')}\n`);
              return 4;
            }
            const created = createApiKey(ctx.db, {
              name,
              userId: target.id,
              scope,
            });
            ctx.audit.append({
              actor: 'cli',
              action: 'auth.api_key.create',
              detail: {
                id: created.key.id,
                name: created.key.name,
                scope: created.key.scope,
                userId: target.id,
              },
              ok: true,
            });
            printJson({
              ok: true,
              key: created.key,
              token: created.token,
              note: tl('cli.security.tokenOnce'),
            });
            return 0;
          }
          if (action === 'delete' || action === 'revoke') {
            const id = getOpt(args, '--id');
            if (!id) {
              process.stderr.write(`${tl('cli.security.apiKeyDeleteUsage')}\n`);
              return 2;
            }
            const ok = deleteApiKey(ctx.db, id);
            if (ok) {
              ctx.audit.append({
                actor: 'cli',
                action: 'auth.api_key.delete',
                resource: id,
                detail: { ok },
                ok: true,
              });
            }
            printJson({ ok, id });
            return ok ? 0 : 4;
          }
          process.stderr.write(`${tl('cli.security.apiKeysHelp')}\n`);
          return 2;
        }

        process.stderr.write(`${tl('cli.security.help')}\n`);
        return 2;
      }
      return 2;
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
      executeEnabled: process.env.YSK_EXECUTE === '1' });
    try {
      if (sub === 'list') {
        printJson({ ok: true, items: ctx.projects.list() });
        return 0;
      }
      if (sub === 'isolation') {
        const action = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        const { listIsolationReport, backfillProjectOwners } = await import('@ysk/core');
        if (action === 'list' || action === 'status') {
          const snaps = ctx.projects.list().map((p) => ({
            id: p.id,
            name: p.name,
            linuxUser: p.linuxUser,
            homeDir: p.homeDir,
            osProvisioned: Boolean(p.osProvisioned),
            ownerUserId: p.ownerUserId,
          }));
          printJson({ ok: true, ...listIsolationReport(snaps) });
          return 0;
        }
        if (action === 'provision') {
          const id = getOpt(args, '--id');
          if (!id) {
            process.stderr.write(`${tl('cli.usage.projects.isolation.provision.--id.projectid.5aff44')}\n`);
            return 2;
          }
          const r = await ctx.projects.provisionOsIsolation(id, 'cli');
          printJson(r);
          return r.ok ? 0 : 3;
        }
        if (action === 'provision-all') {
          const limit = getOpt(args, '--limit')
            ? Number(getOpt(args, '--limit'))
            : undefined;
          const r = await ctx.projects.provisionOsIsolationAll('cli', { limit });
          printJson(r);
          return r.ok ? 0 : r.attempted ? 1 : 3;
        }
        if (action === 'backfill-owners') {
          const owner =
            getOpt(args, '--owner-user-id') ??
            getOpt(args, '--user-id') ??
            ctx.db.snapshot.users.find((u) => u.roles.includes('admin'))?.id;
          if (!owner) {
            process.stderr.write(`${tl('cli.usage.projects.isolation.backfill-owners.--owner-user-id.id.8691da')}\n`);
            return 2;
          }
          const r = backfillProjectOwners(ctx.db, owner, { onlyUnowned: true });
          printJson({ ok: true, ...r });
          return 0;
        }
        process.stderr.write(`${tl('cli.usage.projects.isolation.list.provision.provision-all.8e9da3')}\n`);
        return 2;
      }
      if (sub === 'get' || sub === 'show' || sub === 'info') {
        const id = getOpt(args, '--id') ?? getOpt(args, '--name');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.projects.get.--id.projectid.name.b0d532')}\n`);
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
              message: tl('notes.project.notFound', { id }) });
            return 4;
          }
          throw err;
        }
      }
      if (sub === 'create') {
        const name = getOpt(args, '--name');
        if (!name) {
          process.stderr.write(`${tl('cli.usage.projects.create.--name.name.--domain.66e857')}\n`);
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
          actor: 'cli' });
        printJson(created);
        return 0;
      }
      if (sub === 'deploy') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.projects.deploy.--id.projectid.--entry.339111')}\n`);
          return 2;
        }
        const proj = ctx.projects.get(id);
        const entry = getOpt(args, '--entry');
        const portRaw = getOpt(args, '--port');
        const port = portRaw ? Number(portRaw) : undefined;
        const result =
          proj.runtime === 'php'
            ? await ctx.projectOps.deployPhp(id, {
                actor: 'cli',
                preferFpm: hasFlag(args, '--fpm'),
                forceBuiltin: hasFlag(args, '--builtin'),
                port: Number.isFinite(port) ? port : undefined,
              })
            : proj.runtime === 'static'
              ? await ctx.projectOps.deployStatic(id, {
                  actor: 'cli',
                  reload: hasFlag(args, '--reload'),
                })
              : proj.runtime === 'python' ||
                  proj.runtime === 'go' ||
                  proj.runtime === 'rust' ||
                  proj.runtime === 'java' ||
                  proj.runtime === 'kotlin' ||
                  proj.runtime === 'bun'
                ? await ctx.projectOps.deployProcess(id, {
                    actor: 'cli',
                    entry,
                    port: Number.isFinite(port) ? port : undefined,
                  })
                : await ctx.projectOps.deployNode(id, {
                    actor: 'cli',
                    entry,
                    port: Number.isFinite(port) ? port : undefined,
                  });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'git-deploy' || sub === 'git') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.projects.git-deploy.--id.id.--git-url.a513f5')}\n`);
          return 2;
        }
        const result = await ctx.projectOps.gitDeploy(id, {
          actor: 'cli',
          gitUrl: getOpt(args, '--git-url') ?? getOpt(args, '--url'),
          branch: getOpt(args, '--branch'),
          redeploy: !hasFlag(args, '--no-redeploy'),
          depth: getOpt(args, '--depth') ? Number(getOpt(args, '--depth')) : undefined,
          entry: getOpt(args, '--entry'),
          skipBuild: hasFlag(args, '--skip-build'),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'stop') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.projects.stop.--id.projectid.b15409')}\n`);
          return 2;
        }
        const result = await ctx.projectOps.stopNode(id, 'cli');
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'backup') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.projects.backup.--id.projectid.e62846')}\n`);
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
          process.stderr.write(`${tl('cli.usage.projects.template.--id.projectid.--template.591ce4')}\n`);
          return 2;
        }
        printJson(ctx.projects.applyTemplate(id, templateId, 'cli', hasFlag(args, '--force')));
        return 0;
      }
      if (sub === 'health') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.projects.health.--id.projectid.e816ec')}\n`);
          return 2;
        }
        const result = await ctx.projectOps.health(id);
        printJson(result);
        return exitFromResult(result);
      }
      process.stderr.write(`${tl('cli.usage.projects.list.get.create.deploy.253b48')}\n`);
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
      applyFirewall } = await import('@ysk/core');
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDir ?? config?.dataDir,
      executeEnabled:
        process.env.YSK_EXECUTE === '1' || wantsHostExecute(args),
    });
    try {
      if (sub === 'nginx' || sub === 'nginx-list') {
        const { listManagedNginxDetailed } = await import('@ysk/core');
        printJson({
          ok: true,
          files: listManagedNginxConfs(ctx.dataDir),
          items: listManagedNginxDetailed(ctx.dataDir),
          dataDir: ctx.dataDir });
        return 0;
      }
      if (sub === 'nginx-sync') {
        const execute = wantsHostExecute(args);
        const result = await syncNginxConfigs({
          dataDir: ctx.dataDir,
          systemConfDir: getOpt(args, '--system-dir'),
          host: ctx.host,
          dryRun: !execute || hasFlag(args, '--dry-run') });
        printJson({
          ...result,
          ok: result.ok !== false,
          dryRun: !execute || hasFlag(args, '--dry-run'),
          notes: [
            ...(result.notes ?? []),
            execute
              ? tl('notes.auto.n0046')
              : tl('notes.auto.n0047'),
          ] });
        return result.ok === false ? 3 : 0;
      }
      if (sub === 'redis-provision') {
        const result = await provisionRedisBinding({
          hostExec: ctx.host,
          projectId: getOpt(args, '--project-id') ?? 'shared',
          dbIndex: getOpt(args, '--db') ? Number(getOpt(args, '--db')) : 0,
          execute: wantsHostExecute(args) });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'postgres-provision') {
        const password = getOpt(args, '--password');
        if (!password || password.length < 8) {
          process.stderr.write(`${tl('cli.usage.hosting.postgres-provision.--db.name.--user.2c8889')}\n`);
          return 2;
        }
        const execute = wantsHostExecute(args);
        const result = await provisionPostgresDatabase({
          dbName: getOpt(args, '--db') ?? 'app',
          username: getOpt(args, '--user') ?? 'appuser',
          password,
          hostExec: ctx.host,
          execute,
        });
        printJson({
          ...result,
          dryRun: !execute,
          notes: [
            ...(result.notes ?? []),
            execute
              ? 'execute requested — check ok/executed fields (fail-closed if no root)'
              : 'plan/dry-run only — no host mutation without --execute',
          ],
        });
        return exitFromResult({ ...result, dryRun: !execute });
      }
      if (sub === 'mysql-provision') {
        const password = getOpt(args, '--password');
        if (!password || password.length < 8) {
          process.stderr.write(`${tl('cli.usage.hosting.mysql-provision.--db.name.--user.fc25aa')}\n`);
          return 2;
        }
        const execute = wantsHostExecute(args);
        const result = await provisionMysqlDatabase({
          dbName: getOpt(args, '--db') ?? 'app',
          username: getOpt(args, '--user') ?? 'appuser',
          password,
          hostExec: ctx.host,
          execute,
        });
        printJson({
          ...result,
          dryRun: !execute,
          notes: [
            ...(result.notes ?? []),
            execute
              ? 'execute requested — check ok/executed fields (fail-closed if no root)'
              : 'plan/dry-run only — no host mutation without --execute',
          ],
        });
        return exitFromResult({ ...result, dryRun: !execute });
      }
      if (sub === 'dns-zone') {
        const zone = getOpt(args, '--zone');
        const serverIp = getOpt(args, '--ip') ?? getOpt(args, '--server-ip');
        if (!zone || !serverIp) {
          process.stderr.write(`${tl('cli.usage.hosting.dns-zone.--zone.example.com.bdaa0d')}\n`);
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
          template: getOpt(args, '--template') });
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
          install: hasFlag(args, '--install') || wantsHostExecute(args) });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'powerdns-load') {
        const zone = getOpt(args, '--zone');
        const serverIp = getOpt(args, '--ip') ?? getOpt(args, '--server-ip');
        if (!zone || !serverIp) {
          process.stderr.write(`${tl('cli.usage.hosting.powerdns-load.--zone.example.com.dba49c')}\n`);
          return 2;
        }
        const result = await applyPowerDnsZone({
          dataDir: ctx.dataDir,
          host: ctx.host,
          zone,
          serverIp,
          serverIpv6: getOpt(args, '--ipv6') ?? getOpt(args, '--server-ipv6'),
          load: hasFlag(args, '--load') || wantsHostExecute(args) });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'email-apply') {
        const domain = getOpt(args, '--domain');
        if (!domain) {
          process.stderr.write(`${tl('cli.usage.hosting.email-apply.--domain.example.com.37d350')}\n`);
          return 2;
        }
        const result = await applyEmailStack({
          dataDir: ctx.dataDir,
          domain,
          host: ctx.host,
          installPackages: hasFlag(args, '--install') || wantsHostExecute(args) });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'email-mailbox') {
        const domainName = getOpt(args, '--domain');
        const localPart = getOpt(args, '--local') ?? getOpt(args, '--user');
        if (!domainName || !localPart) {
          process.stderr.write(`${tl('cli.usage.hosting.email-mailbox.--domain.x.--local.3d9be3')}\n`);
          return 2;
        }
        let domainId = ctx.email.list().find((d) => d.domain === domainName)?.id;
        if (!domainId) {
          const serverIp = getOpt(args, '--ip');
          if (!serverIp) {
            process.stderr.write(`${tl('cli.msg.new.domain.requires.986b78')}\n`);
            return 2;
          }
          const created = ctx.email.create({
            domain: domainName,
            serverIp,
            actor: 'cli' });
          domainId = created.domain.id;
        }
        const result = await ctx.email.createMailbox(domainId, {
          localPart,
          password: getOpt(args, '--password'),
          provisionSystem: hasFlag(args, '--system'),
          actor: 'cli' });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'ftps-apply') {
        const { applyFtps } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        if (!domain) {
          process.stderr.write(`${tl('cli.usage.hosting.ftps-apply.--domain.files.example.284a7c')}\n`);
          return 2;
        }
        const result = await applyFtps({
          dataDir: ctx.dataDir,
          domain,
          host: ctx.host,
          install: hasFlag(args, '--install') || wantsHostExecute(args) });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'runtimes' || sub === 'runtimes-probe') {
        const { probeRuntimes, listSupportedRuntimes } = await import('@ysk/core');
        try {
          printJson({
            ok: true,
            supported: listSupportedRuntimes(),
            probe: await probeRuntimes(ctx.host, { dataDir: ctx.dataDir }),
          });
          return 0;
        } catch (e) {
          printJson({
            ok: true,
            supported: listSupportedRuntimes(),
            probe: null,
            blockedProbe: true,
            notes: [e instanceof Error ? e.message : String(e)],
          });
          return 0;
        }
      }
      if (sub === 'runtime-install') {
        const {
          planOrInstallRuntime,
          defaultRuntimeVersion,
        } = await import('@ysk/core');
        const kindRaw = getOpt(args, '--kind') ?? 'node';
        const allowed = [
          'node',
          'php',
          'python',
          'go',
          'rust',
          'java',
          'kotlin',
          'bun',
        ] as const;
        const kind = (
          (allowed as readonly string[]).includes(kindRaw) ? kindRaw : 'node'
        ) as (typeof allowed)[number];
        const pluginsCsv = getOpt(args, '--plugins');
        const plugins = pluginsCsv
          ? pluginsCsv.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const extCsv = getOpt(args, '--extensions');
        const extensions = extCsv
          ? extCsv.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const result = await planOrInstallRuntime({
          dataDir: ctx.dataDir,
          host: ctx.host,
          kind,
          version: getOpt(args, '--version') ?? defaultRuntimeVersion(kind),
          install: hasFlag(args, '--install') || wantsHostExecute(args),
          plugins: kind !== 'php' ? plugins : undefined,
          extensions: kind === 'php' ? extensions : undefined,
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'runtime-switch') {
        if (!wantsHostExecute(args)) {
          printJson({
            ok: false,
            blocked: true,
            dryRun: true,
            notes: ['Pass --execute to switch the default runtime version on the host.'],
          });
          return 3;
        }
        const { switchRuntimeDefault, defaultRuntimeVersion } = await import('@ysk/core');
        const kindRaw = getOpt(args, '--kind') ?? 'node';
        const allowed = [
          'node',
          'php',
          'python',
          'go',
          'rust',
          'java',
          'kotlin',
          'bun',
        ] as const;
        const kind = (
          (allowed as readonly string[]).includes(kindRaw) ? kindRaw : 'node'
        ) as (typeof allowed)[number];
        const result = await switchRuntimeDefault({
          host: ctx.host,
          kind,
          version: getOpt(args, '--version') ?? defaultRuntimeVersion(kind),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'runtime-uninstall') {
        if (!wantsHostExecute(args)) {
          printJson({
            ok: false,
            blocked: true,
            dryRun: true,
            notes: ['Pass --execute to uninstall a managed runtime version on the host.'],
          });
          return 3;
        }
        const { uninstallRuntimeVersion } = await import('@ysk/core');
        const kindRaw = getOpt(args, '--kind') ?? 'node';
        const version = getOpt(args, '--version');
        if (!version?.trim()) {
          process.stderr.write(
            'Usage: ysk-server hosting runtime-uninstall --kind node|php|…|java|kotlin|bun --version VER --execute\n',
          );
          return 2;
        }
        const allowed = [
          'node',
          'php',
          'python',
          'go',
          'rust',
          'java',
          'kotlin',
          'bun',
        ] as const;
        const kind = (
          (allowed as readonly string[]).includes(kindRaw) ? kindRaw : 'node'
        ) as (typeof allowed)[number];
        const result = await uninstallRuntimeVersion({
          host: ctx.host,
          kind,
          version: version.trim(),
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
          process.stderr.write(`${tl('cli.usage.hosting.webmail-apply.--domain.webmail.example.2ad5b5')}\n`);
          return 2;
        }
        const result = await applyWebmail({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain,
          imapHost: getOpt(args, '--imap'),
          smtpHost: getOpt(args, '--smtp'),
          download: hasFlag(args, '--download'),
          systemInstall: hasFlag(args, '--system') });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'public-files') {
        const { applyPublicFileServer } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        if (!domain) {
          process.stderr.write(`${tl('cli.usage.hosting.public-files.--domain.files.example.0e9013')}\n`);
          return 2;
        }
        const result = await applyPublicFileServer({
          dataDir: ctx.dataDir,
          host: ctx.host,
          serverName: domain,
          quotaMb: getOpt(args, '--quota-mb')
            ? Number(getOpt(args, '--quota-mb'))
            : undefined,
          reload: hasFlag(args, '--reload') });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'email-deliverability' || sub === 'deliverability') {
        const domainName = (getOpt(args, '--domain') ?? '').trim().toLowerCase();
        const idOpt = getOpt(args, '--id');
        const row = idOpt
          ? ctx.email.list().find((d) => d.id === idOpt)
          : ctx.email.list().find((d) => d.domain === domainName);
        if (!row) {
          process.stderr.write(`${tl('cli.usage.hosting.email-deliverability.--domain.example.com.8774a4')}\n`);
          return 2;
        }
        const { buildDeliverabilityReport } = await import('@ysk/core');
        const report = await buildDeliverabilityReport({
          domain: row.domain,
          serverIp: row.server_ip,
          serverIpv6: row.server_ipv6,
          mailHostname: row.mail_hostname,
          dkimPublicKey: row.dkim_public_key ?? '',
          dataDir: ctx.dataDir,
        });
        printJson({ ok: true, report });
        return report.panelReady ? 0 : 1;
      }
      if (sub === 'email-bootstrap') {
        const { bootstrapEmailServer } = await import('@ysk/core');
        const domain = getOpt(args, '--domain');
        const serverIp = getOpt(args, '--ip');
        if (!domain || !serverIp) {
          process.stderr.write(`${tl('cli.usage.hosting.email-bootstrap.--domain.example.com.796da5')}\n`);
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
          projects: ctx.projects,
          projectOps: ctx.projectOps,
          webmailDownload: wantsHostExecute(args) || hasFlag(args, '--install'),
        });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'firewall-apply') {
        const result = await applyFirewall({
          host: ctx.host,
          dataDir: ctx.dataDir,
          allowSmtp: hasFlag(args, '--smtp'),
          apply: wantsHostExecute(args) });
        printJson({
          ...result,
          dryRun: !wantsHostExecute(args),
          notes: [
            ...(result.notes ?? []),
            wantsHostExecute(args)
              ? tl('notes.auto.n0279')
              : tl('notes.auto.n0269'),
          ] });
        return exitFromResult({
          ...result,
          dryRun: !wantsHostExecute(args),
          ok: wantsHostExecute(args) ? result.ok : true });
      }
      process.stderr.write(`${tl('cli.usage.hostingHelp')}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** Top-level DNS alias for AI agents → hosting dns-zone / dns-zones */
  if (command === 'dns') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'zones';
    const {
      writeManagedDnsZone,
      listManagedDnsZones,
      generateDnssecKeys,
      listDnssecMaterial,
      healPowerDnsListener,
      probeDnsServiceHealth,
      lookupDns,
      validateDnsRecordSet,
      hasDnsErrors,
    } = await import('@ysk/core');
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
          process.stderr.write(`${tl('cli.usage.cli.name.dns.zone.--zone.ad30fa', { CLI_NAME })}\n`);
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
          template: getOpt(args, '--template') });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'dnssec') {
        const act = args.filter((a) => !a.startsWith('-')).slice(2)[0] ?? 'list';
        const zone = getOpt(args, '--zone') ?? args.filter((a) => !a.startsWith('-')).slice(3)[0];
        if (!zone?.trim()) {
          process.stderr.write(
            'Usage: ysk-server dns dnssec list|generate --zone example.com [--execute]\n',
          );
          return 2;
        }
        if (act === 'list' || act === 'get' || act === 'show') {
          printJson({ ok: true, ...listDnssecMaterial(ctx.dataDir, zone.trim()) });
          return 0;
        }
        if (act === 'generate' || act === 'create' || act === 'sign') {
          if (!wantsHostExecute(args)) {
            printJson({
              ok: false,
              blocked: true,
              dryRun: true,
              notes: ['Pass --execute to run dnssec-keygen on the host.'],
            });
            return 3;
          }
          const r = await generateDnssecKeys({
            dataDir: ctx.dataDir,
            zone: zone.trim(),
            host: ctx.host,
          });
          printJson(r);
          return exitFromResult(r);
        }
        process.stderr.write(
          'Usage: ysk-server dns dnssec list|generate --zone example.com [--execute]\n',
        );
        return 2;
      }
      if (sub === 'heal') {
        if (!wantsHostExecute(args)) {
          printJson({
            ok: false,
            blocked: true,
            dryRun: true,
            notes: ['Pass --execute to heal PowerDNS listener on the host.'],
          });
          return 3;
        }
        const r = await healPowerDnsListener({
          host: ctx.host,
          dataDir: ctx.dataDir,
        });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'health') {
        const r = await probeDnsServiceHealth({
          dataDir: ctx.dataDir,
          host: ctx.host,
          digName: getOpt(args, '--name') ?? undefined,
        });
        printJson({ ...r, ok: true });
        return 0;
      }
      if (sub === 'lookup') {
        const name = getOpt(args, '--name') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!name?.trim()) {
          process.stderr.write(
            'Usage: ysk-server dns lookup --name example.com [--type A|MX|TXT|…] [--server 1.1.1.1]\n',
          );
          return 2;
        }
        const r = await lookupDns({
          host: ctx.host,
          name: name.trim(),
          type: (getOpt(args, '--type') as 'A' | 'AAAA' | 'MX' | 'TXT' | 'CNAME' | 'NS' | undefined) ?? 'A',
          server: getOpt(args, '--server'),
        });
        printJson(r);
        return r.ok ? 0 : 1;
      }
      if (sub === 'records' || sub === 'validate') {
        // Validate record set from --json file or inline JSON
        const jsonPath = getOpt(args, '--file');
        const jsonInline = getOpt(args, '--json-records') ?? getOpt(args, '--records');
        let records: Array<{ type: string; name: string; value: string; ttl?: number }> = [];
        if (jsonPath) {
          try {
            const { readFileSync } = await import('node:fs');
            records = JSON.parse(readFileSync(jsonPath, 'utf8')) as typeof records;
          } catch (e) {
            printJson({
              ok: false,
              notes: [e instanceof Error ? e.message : String(e)],
            });
            return 1;
          }
        } else if (jsonInline) {
          try {
            records = JSON.parse(jsonInline) as typeof records;
          } catch {
            process.stderr.write('--records must be JSON array\n');
            return 2;
          }
        } else if (sub === 'records') {
          // Managed zones are written as whole zone files — list zones as record source
          printJson({
            ok: true,
            notes: [
              'Managed DNS uses zone files (dns zones|zone). Use dns records --records JSON to validate, or dns dnssec / heal / lookup for ops.',
            ],
            zones: listManagedDnsZones(ctx.dataDir),
          });
          return 0;
        }
        const issues = validateDnsRecordSet(records);
        printJson({
          ok: !hasDnsErrors(issues),
          issues,
          notes: hasDnsErrors(issues)
            ? ['DNS record set has errors']
            : issues.length
              ? ['warnings only']
              : ['valid'],
        });
        return hasDnsErrors(issues) ? 1 : 0;
      }
      process.stderr.write(
        `${CLI_NAME} dns zones|zone|dnssec|heal|health|lookup|records [--zone …] [--execute]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** DB engine HA clusters — plan-first (MariaDB Galera v1) */
  if (command === 'db-cluster') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'list';
    const {
      listDbClusters,
      getDbCluster,
      createDbCluster,
      planAndMaterializeDbCluster,
      deleteDbCluster,
      applyDbClusterLocal,
      probeDbCluster,
      probeDbClusterFull,
      bundleDbClusterArtifacts,
      listDbClusterArtifacts,
      pushDbClusterToPeers,
      dispatchDbClusterFleet,
      installDbClusterOnPeers,
      firewallPortsForCluster,
      importDbClusterSync } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'list' || sub === 'ls') {
        const engineRaw = getOpt(args, '--engine');
        const engine =
          engineRaw === 'mysql' ||
          engineRaw === 'mariadb' ||
          engineRaw === 'postgres' ||
          engineRaw === 'redis'
            ? engineRaw
            : undefined;
        printJson({ ok: true, items: listDbClusters(ctx.db, engine) });
        return 0;
      }
      if (sub === 'get' || sub === 'show') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.get.--id.00f803', { CLI_NAME })}\n`);
          return 2;
        }
        printJson({ ok: true, cluster: getDbCluster(ctx.db, id) });
        return 0;
      }
      if (sub === 'create') {
        const name = getOpt(args, '--name');
        const engineRaw = getOpt(args, '--engine') ?? 'mariadb';
        const kindRaw = getOpt(args, '--kind') ?? 'mariadb-galera';
        if (!name) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.create.--name.e3b733', { CLI_NAME })}\n`);
          return 2;
        }
        const memberArgs: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--member' && args[i + 1] && !args[i + 1].startsWith('-')) {
            memberArgs.push(args[i + 1]);
          }
        }
        if (memberArgs.length < 1) {
          process.stderr.write(`${tl('cli.msg.need.at.least.7d311a')}\n`);
          return 2;
        }
        const members = memberArgs.map((spec, idx) => {
          // HOST | HOST=role | HOST=role:access | HOST=role:fleet:AGENT_SESSION_ID
          const [hostPart, rest] = spec.split('=');
          const host = hostPart.trim();
          let role: string | undefined;
          let access: 'local' | 'ssh' | 'fleet' | undefined = idx === 0 ? 'local' : 'ssh';
          let fleetAgentId: string | undefined;
          if (rest) {
            const parts = rest.split(':');
            role = parts[0] || undefined;
            if (parts[1] === 'local' || parts[1] === 'ssh' || parts[1] === 'fleet') {
              access = parts[1];
            }
            if (parts[1] === 'fleet' && parts[2]) fleetAgentId = parts[2];
            if (parts[2] && parts[1] !== 'fleet') {
              // role:access only
            }
          }
          return { host, role, access, fleetAgentId };
        });
        const engine = (
          ['mysql', 'mariadb', 'postgres', 'redis'].includes(engineRaw)
            ? engineRaw
            : 'mariadb'
        ) as 'mysql' | 'mariadb' | 'postgres' | 'redis';
        const kind = kindRaw as
          | 'mariadb-galera'
          | 'mysql-replica'
          | 'postgres-replica'
          | 'redis-replica'
          | 'redis-sentinel';
        const cluster = createDbCluster(ctx.db, {
          name,
          engine,
          kind,
          members,
          params: {
            ...(getOpt(args, '--sst')
              ? { sstMethod: getOpt(args, '--sst')! }
              : {}),
            ...(getOpt(args, '--cluster-name')
              ? { clusterName: getOpt(args, '--cluster-name')! }
              : {}) } });
        printJson({ ok: true, cluster });
        return 0;
      }
      if (sub === 'plan') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.plan.--id.483f52', { CLI_NAME })}\n`);
          return 2;
        }
        const { cluster, plan } = planAndMaterializeDbCluster({
          db: ctx.db,
          dataDir: ctx.dataDir,
          clusterId: id,
          writeArtifacts: true });
        printJson({ ok: plan.ok, dryRun: true, cluster, plan });
        return plan.ok ? 0 : 1;
      }
      if (sub === 'apply') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.apply.--id.4cddb8', { CLI_NAME })}\n`);
          return 2;
        }
        const result = await applyDbClusterLocal({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
          clusterId: id,
          execute: wantsHostExecute(args),
          bootstrap: hasFlag(args, '--bootstrap') });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'probe') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.probe.--id.22870c', { CLI_NAME })}\n`);
          return 2;
        }
        const result = hasFlag(args, '--peers')
          ? await probeDbClusterFull({
              db: ctx.db,
              host: ctx.host,
              clusterId: id,
              dataDir: ctx.dataDir,
              identityId: getOpt(args, '--identity') })
          : await probeDbCluster({
              db: ctx.db,
              host: ctx.host,
              clusterId: id });
        printJson(result);
        return result.ok ? 0 : result.localOk ? 0 : 1;
      }
      if (sub === 'install-peers' || sub === 'remote-install') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.install-peers.--id.600b02', { CLI_NAME })}\n`);
          return 2;
        }
        const result = await installDbClusterOnPeers({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
          clusterId: id,
          memberId: getOpt(args, '--member'),
          execute: wantsHostExecute(args),
          restart: !hasFlag(args, '--no-restart'),
          identityId: getOpt(args, '--identity') });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'overview' || sub === 'summary') {
        const items = listDbClusters(ctx.db);
        printJson({
          ok: true,
          count: items.length,
          byStatus: items.reduce(
            (acc, c) => {
              acc[c.status] = (acc[c.status] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
          items: items.map((c) => ({
            id: c.id,
            name: c.name,
            engine: c.engine,
            kind: c.kind,
            status: c.status,
            members: c.members.length,
            firewallPorts: firewallPortsForCluster(c.kind) })) });
        return 0;
      }
      if (sub === 'import-sync') {
        // stdin JSON { cluster: {...} } or --file
        const file = getOpt(args, '--file');
        let raw = '';
        if (file) {
          const { readFileSync } = await import('node:fs');
          raw = readFileSync(file, 'utf8');
        } else {
          process.stderr.write(`${tl('cli.msg.import-sync.prefers.fleet.4d7590')}\n`);
          return 2;
        }
        const data = JSON.parse(raw) as { cluster?: import('@ysk/core').DbCluster };
        if (!data.cluster) {
          printJson({ ok: false, notes: ['need { cluster }'] });
          return 2;
        }
        const r = importDbClusterSync({
          db: ctx.db,
          dataDir: ctx.dataDir,
          cluster: data.cluster });
        printJson(r);
        return r.ok ? 0 : 1;
      }
      if (sub === 'artifacts' || sub === 'files') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.artifacts.--id.6b33c4', { CLI_NAME })}\n`);
          return 2;
        }
        const r = listDbClusterArtifacts({
          db: ctx.db,
          dataDir: ctx.dataDir,
          clusterId: id });
        printJson({
          ok: r.ok,
          artifactDir: r.artifactDir,
          files: r.files.map((f) => ({ path: f.relativePath, bytes: f.bytes })),
          notes: r.notes });
        return r.ok ? 0 : 4;
      }
      if (sub === 'bundle') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.bundle.--id.94ed27', { CLI_NAME })}\n`);
          return 2;
        }
        const r = bundleDbClusterArtifacts({
          db: ctx.db,
          dataDir: ctx.dataDir,
          clusterId: id });
        printJson(r);
        return r.ok ? 0 : 1;
      }
      if (sub === 'push') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.push.--id.697080', { CLI_NAME })}\n`);
          return 2;
        }
        const result = await pushDbClusterToPeers({
          db: ctx.db,
          dataDir: ctx.dataDir,
          host: ctx.host,
          clusterId: id,
          memberId: getOpt(args, '--member'),
          execute: wantsHostExecute(args),
          identityId: getOpt(args, '--identity') });
        printJson(result);
        return exitFromResult(result);
      }
      if (sub === 'fleet') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.fleet.--id.239462', { CLI_NAME })}\n`);
          return 2;
        }
        const opRaw = getOpt(args, '--op') ?? 'apply';
        const op =
          opRaw === 'probe' ||
          opRaw === 'plan' ||
          opRaw === 'apply' ||
          opRaw === 'sync'
            ? opRaw
            : 'apply';
        const result = dispatchDbClusterFleet({
          db: ctx.db,
          clusterId: id,
          memberId: getOpt(args, '--member'),
          op,
          execute: wantsHostExecute(args),
          edgeExecute: hasFlag(args, '--edge-execute'),
          enqueue: wantsHostExecute(args)
            ? (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload)
            : undefined });
        printJson(result);
        return result.ok || result.dryRun ? 0 : 1;
      }
      if (sub === 'delete' || sub === 'rm') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.delete.--id.3de0e4', { CLI_NAME })}\n`);
          return 2;
        }
        const ok = deleteDbCluster(ctx.db, id);
        printJson({
          ok,
          notes: ok
            ? ['registry removed; system conf not auto-cleaned']
            : ['not found'] });
        return ok ? 0 : 4;
      }
      process.stderr.write(`${tl('cli.usage.cli.name.db-cluster.list.get.3b9cfa', { CLI_NAME })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** SSH identity vault — encrypted private keys (user/panel outbound) */
  if (command === 'ssh-key' || command === 'ssh-keys') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'list';
    const {
      listSshIdentities,
      getSshIdentity,
      createSshIdentity,
      importSshIdentity,
      exportSshIdentityPrivate,
      deleteSshIdentity,
      installSshIdentity,
      uninstallSshIdentity } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'list' || sub === 'ls') {
        const purposeRaw = getOpt(args, '--purpose');
        const purpose =
          purposeRaw === 'user_outbound' ||
          purposeRaw === 'panel_outbound' ||
          purposeRaw === 'unbound' ||
          purposeRaw === 'user' ||
          purposeRaw === 'panel'
            ? purposeRaw === 'user'
              ? 'user_outbound'
              : purposeRaw === 'panel'
                ? 'panel_outbound'
                : purposeRaw
            : undefined;
        printJson({
          ok: true,
          items: listSshIdentities(ctx.dataDir, {
            linuxUser: getOpt(args, '--user'),
            projectId: getOpt(args, '--project'),
            purpose }) });
        return 0;
      }
      if (sub === 'get' || sub === 'show') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.get.--id.292716', { CLI_NAME })}\n`);
          return 2;
        }
        const identity = getSshIdentity(ctx.dataDir, id);
        if (!identity) {
          printJson({ ok: false, code: 'YSK_NOT_FOUND', message: tl('notes.ssh.identityNotFound') });
          return 4;
        }
        printJson({ ok: true, identity });
        return 0;
      }
      if (sub === 'create') {
        const name = getOpt(args, '--name');
        if (!name) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.create.--name.8b1d79', { CLI_NAME })}\n`);
          return 2;
        }
        const algoRaw = getOpt(args, '--algo') ?? 'ed25519';
        const algorithm =
          algoRaw === 'rsa-4096' || algoRaw === 'rsa' ? 'rsa-4096' : 'ed25519';
        const purposeRaw = getOpt(args, '--purpose') ?? 'unbound';
        const purpose =
          purposeRaw === 'user' || purposeRaw === 'user_outbound'
            ? 'user_outbound'
            : purposeRaw === 'panel' || purposeRaw === 'panel_outbound'
              ? 'panel_outbound'
              : 'unbound';
        const r = createSshIdentity(
          ctx.dataDir,
          {
            name,
            algorithm,
            purpose,
            comment: getOpt(args, '--comment'),
            binding: {
              projectId: getOpt(args, '--project'),
              linuxUser: getOpt(args, '--user'),
              homeDir: getOpt(args, '--home') },
            revealPrivate: hasFlag(args, '--reveal') },
          ctx.db,
        );
        if (r.ok && hasFlag(args, '--install') && r.identity) {
          const inst = await installSshIdentity({
            dataDir: ctx.dataDir,
            id: r.identity.id,
            apply: wantsHostExecute(args),
            host: ctx.host,
            executeEnabled: ctx.host.executeEnabled() });
          printJson({ ok: r.ok && inst.ok, create: r, install: inst });
          return exitFromResult(inst);
        }
        printJson(r);
        return r.ok ? 0 : 2;
      }
      if (sub === 'import') {
        const name = getOpt(args, '--name');
        const file = getOpt(args, '--file');
        if (!name || !file) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.import.--name.6eb800', { CLI_NAME })}\n`);
          return 2;
        }
        const { readFileSync } = await import('node:fs');
        let privateKey: string;
        try {
          privateKey = readFileSync(file, 'utf8');
        } catch (e) {
          printJson({
            ok: false,
            code: 'YSK_NOT_FOUND',
            message: e instanceof Error ? e.message : String(e) });
          return 4;
        }
        const purposeRaw = getOpt(args, '--purpose') ?? 'panel_outbound';
        const purpose =
          purposeRaw === 'user' || purposeRaw === 'user_outbound'
            ? 'user_outbound'
            : purposeRaw === 'unbound'
              ? 'unbound'
              : 'panel_outbound';
        const r = importSshIdentity(
          ctx.dataDir,
          {
            name,
            privateKey,
            purpose,
            binding: {
              projectId: getOpt(args, '--project'),
              linuxUser: getOpt(args, '--user'),
              homeDir: getOpt(args, '--home') },
            revealPrivate: hasFlag(args, '--reveal') },
          ctx.db,
        );
        printJson(r);
        return r.ok ? 0 : 2;
      }
      if (sub === 'public') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.public.--id.525d7d', { CLI_NAME })}\n`);
          return 2;
        }
        const identity = getSshIdentity(ctx.dataDir, id);
        if (!identity) {
          printJson({ ok: false, code: 'YSK_NOT_FOUND', message: tl('notes.ssh.identityNotFound') });
          return 4;
        }
        if (json) printJson({ ok: true, publicKey: identity.publicKey, fingerprintSha256: identity.fingerprintSha256 });
        else process.stdout.write(`${identity.publicKey}\n`);
        return 0;
      }
      if (sub === 'export') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        const out = getOpt(args, '--out');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.export.--id.0a6d81', { CLI_NAME })}\n`);
          return 2;
        }
        const r = exportSshIdentityPrivate(ctx.dataDir, id);
        if (!r.ok || !r.privateKey) {
          printJson({ ok: false, notes: r.notes });
          return 4;
        }
        if (out) {
          const { writeFileSync, chmodSync } = await import('node:fs');
          writeFileSync(out, r.privateKey.endsWith('\n') ? r.privateKey : r.privateKey + '\n', {
            mode: 0o600 });
          try {
            chmodSync(out, 0o600);
          } catch {
            /* ignore */
          }
          printJson({
            ok: true,
            written: out,
            fingerprintSha256: r.fingerprintSha256,
            notes: r.notes });
          return 0;
        }
        if (json) {
          printJson({
            ok: true,
            privateKey: r.privateKey,
            fingerprintSha256: r.fingerprintSha256,
            notes: r.notes });
        } else {
          process.stdout.write(r.privateKey.endsWith('\n') ? r.privateKey : r.privateKey + '\n');
        }
        return 0;
      }
      if (sub === 'install') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.install.--id.b99c56', { CLI_NAME })}\n`);
          return 2;
        }
        const r = await installSshIdentity({
          dataDir: ctx.dataDir,
          id,
          apply: wantsHostExecute(args),
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'test') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        const target = getOpt(args, '--target');
        if (!id || !target) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.test.--id.e1aed3', { CLI_NAME })}\n`);
          return 2;
        }
        const { testSshIdentity } = await import('@ysk/core');
        const r = await testSshIdentity({
          dataDir: ctx.dataDir,
          id,
          target,
          apply: wantsHostExecute(args),
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'rotate') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.rotate.--id.9c3224', { CLI_NAME })}\n`);
          return 2;
        }
        const { rotateSshIdentity } = await import('@ysk/core');
        const r = rotateSshIdentity({
          dataDir: ctx.dataDir,
          id,
          revealPrivate: hasFlag(args, '--reveal'),
          db: ctx.db });
        printJson(r);
        return r.ok ? 0 : 4;
      }
      if (sub === 'authorize-self' || sub === 'authorize') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.authorize-self.--id.b7ea2e', { CLI_NAME })}\n`);
          return 2;
        }
        const { authorizeSelfSshIdentity } = await import('@ysk/core');
        const r = await authorizeSelfSshIdentity({
          dataDir: ctx.dataDir,
          db: ctx.db,
          id,
          host: ctx.host });
        printJson(r);
        return r.ok ? 0 : 1;
      }
      if (sub === 'uninstall') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.uninstall.--id.afcba0', { CLI_NAME })}\n`);
          return 2;
        }
        const r = await uninstallSshIdentity({
          dataDir: ctx.dataDir,
          id,
          apply: wantsHostExecute(args),
          purgeFiles: !hasFlag(args, '--keep-files') });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'delete' || sub === 'rm') {
        const id = getOpt(args, '--id') ?? args.filter((a) => !a.startsWith('-')).slice(2)[0];
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.delete.--id.a6e2f2', { CLI_NAME })}\n`);
          return 2;
        }
        if (hasFlag(args, '--purge-disk') || hasFlag(args, '--purge')) {
          await uninstallSshIdentity({
            dataDir: ctx.dataDir,
            id,
            apply: true,
            purgeFiles: true });
        }
        const r = deleteSshIdentity(ctx.dataDir, id);
        printJson(r);
        return r.ok ? 0 : 4;
      }
      process.stderr.write(`${tl('cli.usage.cli.name.ssh-key.list.get.2c92c6', { CLI_NAME })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  /** SSH login 2FA (PAM TOTP) — independent of panel operator 2FA */
  if (command === 'ssh-2fa' || command === 'ssh2fa') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'list';
    const {
      listSsh2fa,
      enrollSsh2fa,
      confirmSsh2fa,
      installSsh2faFile,
      uninstallSsh2faFile,
      retireSsh2fa,
      buildPamSshSnippet,
      buildSshdTotpHints,
      probeSsh2faHost,
      revealSsh2faSecret } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'list' || sub === 'ls') {
        const host = await probeSsh2faHost(ctx.host);
        printJson({
          ok: true,
          items: listSsh2fa(ctx.dataDir, {
            linuxUser: getOpt(args, '--user'),
            projectId: getOpt(args, '--project') }),
          host });
        return 0;
      }
      if (sub === 'enroll' || sub === 'create') {
        const user = getOpt(args, '--user');
        const project = getOpt(args, '--project');
        if (!user && !project) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-2fa.enroll.--user.081432', { CLI_NAME })}\n`);
          return 2;
        }
        let secret: string | undefined;
        let fromPanel = false;
        if (hasFlag(args, '--from-panel')) {
          const me = ctx.db.snapshot.users[0];
          // prefer admin with totp
          const withTotp =
            ctx.db.snapshot.users.find((u) => u.totp_secret && u.roles?.includes('admin')) ||
            ctx.db.snapshot.users.find((u) => u.totp_secret);
          if (!withTotp?.totp_secret) {
            printJson({
              ok: false,
              notes: [tl('notes.auto.n0365')] });
            return 2;
          }
          secret = withTotp.totp_secret;
          fromPanel = true;
          void me;
        }
        const r = enrollSsh2fa(
          ctx.dataDir,
          {
            linuxUser: user,
            projectId: project,
            homeDir: getOpt(args, '--home'),
            secret,
            fromPanel },
          ctx.db,
        );
        printJson(r);
        return r.ok ? 0 : 2;
      }
      if (sub === 'confirm') {
        const id = getOpt(args, '--id');
        const code = getOpt(args, '--code');
        if (!id || !code) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-2fa.confirm.--id.9ee8a2', { CLI_NAME })}\n`);
          return 2;
        }
        const r = confirmSsh2fa(ctx.dataDir, id, code);
        printJson(r);
        return r.ok ? 0 : 2;
      }
      if (sub === 'install') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-2fa.install.--id.dace06', { CLI_NAME })}\n`);
          return 2;
        }
        const r = await installSsh2faFile({
          dataDir: ctx.dataDir,
          id,
          apply: wantsHostExecute(args),
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'uninstall') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-2fa.uninstall.--id.0bb464', { CLI_NAME })}\n`);
          return 2;
        }
        const r = await uninstallSsh2faFile({
          dataDir: ctx.dataDir,
          id,
          apply: wantsHostExecute(args),
          retire: true });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'pam' || sub === 'snippet') {
        printJson({
          ok: true,
          pamSnippet: buildPamSshSnippet(),
          sshdHints: buildSshdTotpHints(),
          notes: [
            tl('notes.auto.n0349'),
            tl('notes.auto.n1241'),
          ] });
        return 0;
      }
      if (sub === 'reveal') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-2fa.reveal.--id.a6c27f', { CLI_NAME })}\n`);
          return 2;
        }
        printJson(revealSsh2faSecret(ctx.dataDir, id));
        return 0;
      }
      if (sub === 'retire' || sub === 'delete' || sub === 'rm') {
        const id = getOpt(args, '--id');
        if (!id) {
          process.stderr.write(`${tl('cli.usage.cli.name.ssh-2fa.retire.--id.6e1fa3', { CLI_NAME })}\n`);
          return 2;
        }
        if (hasFlag(args, '--purge-file')) {
          await uninstallSsh2faFile({
            dataDir: ctx.dataDir,
            id,
            apply: true,
            retire: true });
        }
        printJson(retireSsh2fa(ctx.dataDir, id));
        return 0;
      }
      process.stderr.write(`${tl('cli.usage.cli.name.ssh-2fa.list.enroll.802ed0', { CLI_NAME })}\n`);
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
      syncNginxConfigs } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'list' || sub === 'confs') {
        printJson({
          ok: true,
          items: listManagedNginxDetailed(ctx.dataDir),
          files: listManagedNginxConfs(ctx.dataDir),
          dataDir: ctx.dataDir });
        return 0;
      }
      if (sub === 'test' || sub === 'check') {
        {
          const { binPresent } = await import('@ysk/core');
          if (!(await binPresent(ctx.host, 'nginx'))) {
            printJson({
              ok: false,
              code: 'not_found',
              notes: ['nginx binary not found'] });
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
          ] });
        return r.exitCode === 0 ? 0 : 5;
      }
      if (sub === 'sync') {
        const execute = wantsHostExecute(args);
        const result = await syncNginxConfigs({
          dataDir: ctx.dataDir,
          systemConfDir: getOpt(args, '--system-dir'),
          host: ctx.host,
          dryRun: !execute || hasFlag(args, '--dry-run') });
        printJson({
          ...result,
          ok: result.ok !== false,
          dryRun: !execute || hasFlag(args, '--dry-run'),
          notes: [
            ...(result.notes ?? []),
            execute
              ? tl('notes.auto.n0046')
              : tl('notes.auto.n0047'),
          ] });
        return result.ok === false ? 3 : 0;
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
            output: `${r.stdout}\n${r.stderr}`.trim() };
        } else {
          configTest = {
            ok: false,
            exitCode: -1,
            output: '',
            skipped: true };
        }
        printJson({
          ok: true,
          service,
          managed,
          managedCount: managed.length,
          configTest,
          caps: {
            executeEnabled: matrix.executeEnabled,
            isRoot: matrix.isRoot },
          probedAt: matrix.probedAt });
        return 0;
      }
      process.stderr.write(`${tl('cli.usage.cli.name.nginx.status.list.d67a16', { CLI_NAME })}\n`);
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
          count: items.length });
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
          process.stderr.write(`${tl('cli.usage.cli.name.ssl.get.--domain.91c444', { CLI_NAME })}\n`);
          return 2;
        }
        const cert =
          items.find((c) => c.domain === domain || c.id === domain) ?? null;
        if (!cert) {
          printJson({
            ok: false,
            code: ErrorCodes.NOT_FOUND,
            message: tl('notes.auto.t0781', { v0: (domain) }),
            items: [] });
          return 4;
        }
        printJson({ ok: true, certificate: cert });
        return 0;
      }
      if (sub === 'bootstrap' || sub === 'bootstrap-tls') {
        const { ensureBootstrapPanelTls } = await import('@ysk/core');
        const force = hasFlag(args, '--force');
        const ipOpt = getOpt(args, '--ip');
        const ips = ipOpt
          ? ipOpt.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const dnsOpt = getOpt(args, '--dns') ?? getOpt(args, '--san-dns');
        const dns = dnsOpt
          ? dnsOpt.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const listenHost = getOpt(args, '--host') ?? getOpt(args, '--listen-host');
        const r = ensureBootstrapPanelTls({
          dataDir: ctx.dataDir,
          configPath: join(ctx.dataDir, 'config.json'),
          ips,
          dns,
          force,
          listenHost: listenHost ?? undefined,
        });
        printJson({
          ...r,
          ok: r.ok,
        });
        return r.ok ? 0 : 1;
      }
      if (sub === 'panel-tls' || sub === 'panel') {
        const helpers = {
          printJson,
          getOpt,
          hasFlag,
          wantsHostExecute,
          exitFromResult,
        };
        const { runPanelTlsCommand } = await import('./cli/cmd-panel-tls.js');
        return await runPanelTlsCommand(ctx, args, helpers);
      }
      process.stderr.write(
        `${CLI_NAME} ssl list|get|bootstrap|panel-tls [--ip IP] [--dns name] [--force] [--data-dir PATH]\n`,
      );
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
      if (sub === 'metrics' || sub === 'load' || sub === 'network') {
        const path = getOpt(args, '--path') ?? '/';
        const metrics = collectMetrics(path);
        const overview = await collectHostOverview(ctx.host);
        printJson({
          ok: true,
          ...metrics,
          host: {
            identity: overview.identity,
            runtime: overview.runtime,
            disks: overview.disks,
            network: overview.network,
            time: overview.time,
          },
          caps: {
            executeEnabled: ctx.host.executeEnabled(),
            isRoot: ctx.host.isRoot(),
          },
          notes: [
            sub === 'network'
              ? 'network interfaces under host.network'
              : 'CPU/load/mem via collectMetrics; disks+net via host overview',
          ],
        });
        return metrics.alerts?.length ? 1 : 0;
      }
      process.stderr.write(`${tl('cli.usage.cli.name.host.overview.metrics.93c828', { CLI_NAME })}\n`);
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
      listJournalUnits } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'sources' || sub === 'list') {
        const settings = loadLogSettings(ctx.db);
        const items = listSourceStatuses({
          disabledIds: settings.disabledSources,
          extraManagedLogDirs: [join(ctx.dataDir, 'nginx', 'logs')],
          customAllowPaths: settings.customAllowPaths });
        printJson({ ok: true, items });
        return 0;
      }
      if (sub === 'overview' || sub === 'status') {
        const r = await getLogOverview({
          host: ctx.host,
          dataDir: ctx.dataDir,
          db: ctx.db });
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
          grep: getOpt(args, '--grep') });
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
          process.stderr.write(`${tl('cli.usage.logsQuery', { CLI_NAME })}\n`);
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
          grep: getOpt(args, '--grep') });
        printJson(r);
        return exitFromResult(r);
      }
      process.stderr.write(`${tl('cli.usage.cli.name.logs.sources.overview.79058c', { CLI_NAME })}\n`);
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
          process.stderr.write(`${tl('cli.usage.cli.name.services.sub.--unit.4fe3fa', { CLI_NAME, sub })}\n`);
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
              tl('notes.auto.t0782', { v0: (sub) }),
            ] });
          return 0;
        }
        const r = await lifecycleServiceUnit(ctx.host, unit, sub);
        printJson(r);
        return exitFromResult(r);
      }
      process.stderr.write(`${tl('cli.usage.cli.name.services.matrix.start.4f3a35', { CLI_NAME })}\n`);
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
      probeFirewallDeep } = await import('@ysk/core');
    const ctx = openCliContext(args);
    try {
      if (sub === 'status') {
        const status = await getDefenseStatus({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir });
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
                denyFromIps: fw.denyFromIps }
            : null });
        return 0;
      }
      if (sub === 'bans' || sub === 'list-bans') {
        const { listDefenseBans, applyListQuery } = await import('@ysk/core');
        const { parseListQuery } = await import('@ysk/shared');
        const r = await listDefenseBans({ host: ctx.host, db: ctx.db });
        const q = getOpt(args, '--q') ?? '';
        const url = new URL('http://local/');
        if (q) url.searchParams.set('q', q);
        const source = getOpt(args, '--source');
        if (source) url.searchParams.set('source', source);
        const query = parseListQuery(url, {
          enums: { source: ['fail2ban', 'panel', 'ufw', 'auto'] },
        });
        const { items, meta } = applyListQuery(r.items, query, {
          text: (b) => [b.ip, b.source, b.jail ?? '', b.reason ?? ''],
          predicates: { source: (b, v) => b.source === v },
        });
        printJson({ ok: true, items, meta, notes: r.notes });
        return 0;
      }
      if (sub === 'suspects') {
        const { listSuspectIps, applyListQuery } = await import('@ysk/core');
        const { parseListQuery } = await import('@ysk/shared');
        const r = await listSuspectIps({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
        });
        const q = getOpt(args, '--q') ?? '';
        const url = new URL('http://local/');
        if (q) url.searchParams.set('q', q);
        const query = parseListQuery(url);
        const { items, meta } = applyListQuery(r.items, query, {
          text: (s) => [s.ip, String(s.hits ?? ''), String(s.score ?? '')],
        });
        printJson({ ok: true, items, meta, notes: r.notes });
        return 0;
      }
      if (sub === 'stack-apply' || sub === 'apply-stack') {
        const { applyDefenseStack } = await import('@ysk/core');
        const r = await applyDefenseStack({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          execute: wantsHostExecute(args),
          actor: 'cli',
        });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'ban') {
        const ip = getOpt(args, '--ip');
        if (!ip) {
          process.stderr.write(`${tl('cli.usage.cli.name.defense.ban.--ip.cc22de', { CLI_NAME })}\n`);
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
          execute: wantsHostExecute(args) });
        printJson(r);
        return exitFromResult(r);
      }
      if (sub === 'unban') {
        const ip = getOpt(args, '--ip');
        if (!ip) {
          process.stderr.write(`${tl('cli.usage.cli.name.defense.unban.--ip.46aa23', { CLI_NAME })}\n`);
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
          execute: wantsHostExecute(args) });
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
          process.stderr.write(`${tl('cli.usage.cli.name.defense.whitelist.--action.c1cbdf', { CLI_NAME })}\n`);
          return 2;
        }
        let whitelist = [...(policy.whitelist ?? [])];
        if (action === 'remove') {
          whitelist = whitelist.filter((w) => w !== ip);
        } else if (action === 'add') {
          if (!whitelist.includes(ip)) whitelist.unshift(ip);
          whitelist = whitelist.slice(0, 200);
        } else {
          process.stderr.write(`${tl('cli.msg.action.must.be.ba14c1')}\n`);
          return 2;
        }
        const next = updateAutoBanPolicy(ctx.db, { whitelist });
        printJson({ ok: true, whitelist: next.whitelist });
        return 0;
      }
      if (sub === 'fail2ban' || sub === 'f2b') {
        const { getFail2banDeepStatus } = await import('@ysk/core');
        const r = await getFail2banDeepStatus({ host: ctx.host, dataDir: ctx.dataDir });
        printJson({ ok: true, ...r });
        return 0;
      }
      if (sub === 'firewall' || sub === 'ufw') {
        const fw = await probeFirewallDeep(ctx.host);
        printJson({
          ok: true,
          active: fw.active,
          activeLabel: fw.activeLabel,
          allowCount: fw.allowCount,
          denyCount: fw.denyCount,
          denyFromIps: fw.denyFromIps,
          notes: fw.notes ?? [],
        });
        return 0;
      }
      if (sub === 'timeline') {
        const { listDefenseTimeline } = await import('@ysk/core');
        const hours = Number(getOpt(args, '--hours') ?? 24);
        let items = listDefenseTimeline(ctx.db, Number.isFinite(hours) ? hours : 24);
        const q = (getOpt(args, '--q') ?? '').trim().toLowerCase();
        if (q) {
          items = items.filter(
            (e) =>
              e.kind.toLowerCase().includes(q) ||
              e.title.toLowerCase().includes(q) ||
              (e.detail ?? '').toLowerCase().includes(q),
          );
        }
        const limit = Number(getOpt(args, '--limit') ?? 50);
        if (Number.isFinite(limit) && limit > 0) items = items.slice(0, limit);
        printJson({ ok: true, items, meta: { total: items.length } });
        return 0;
      }
      if (sub === 'presets') {
        const { listDefensePresets, getDefenseStatus } = await import('@ysk/core');
        const status = await getDefenseStatus({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
        });
        printJson({
          ok: true,
          activePreset: status.activePreset,
          items: listDefensePresets().map((p) => ({
            id: p.id,
            label: p.label,
            short: p.short,
            bullets: p.bullets,
          })),
        });
        return 0;
      }
      process.stderr.write(`${tl('cli.usage.cli.name.defense.status.bans.a8d96b', { CLI_NAME })}\n`);
      return 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'migrate') {
    const sub = args.filter((a) => !a.startsWith('-')).slice(1)[0] ?? 'help';
    const configPath = getOpt(args, '--config');
    const dataDirOpt = getOpt(args, '--data-dir');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    if (dataDirOpt) {
      config = config
        ? { ...config, dataDir: dataDirOpt }
        : ({ dataDir: dataDirOpt } as NonNullable<typeof config>);
    }
    const { createAppContext, closeAppContext } = await import('./app-context.js');
    const {
      migrateInventory,
      runSourceMigrateHost,
      runLocalMigratePost,
      loadMigrateJob,
      listMigrateJobs } = await import('@ysk/core');
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDirOpt ?? config?.dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1' });
    try {
      if (sub === 'inventory') {
        const r = await migrateInventory({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          yskVersion: VERSION });
        printJson(r);
        return r.ok ? 0 : 1;
      }
      if (sub === 'status') {
        const jobId = getOpt(args, '--job');
        if (jobId) {
          const job = loadMigrateJob(ctx.dataDir, jobId);
          if (!job) {
            printJson({ ok: false, notes: [tl('notes.auto.t0783', { v0: (jobId) })] });
            return 4;
          }
          printJson({ ok: true, job });
          return 0;
        }
        printJson({ ok: true, jobs: listMigrateJobs(ctx.dataDir) });
        return 0;
      }
      if (sub === 'post') {
        const jobId = getOpt(args, '--job');
        if (!jobId) {
          process.stderr.write(`${tl('cli.usage.migrate.post.--job.id.--data-dir.6a73cd')}\n`);
          return 2;
        }
        if (!wantsHostExecute(args)) {
          printJson({
            ok: false,
            blocked: true,
            notes: [tl('notes.auto.n0330')] });
          return 3;
        }
        const r = await runLocalMigratePost({
          host: ctx.host,
          dataDir: ctx.dataDir,
          jobId });
        printJson(r);
        return r.ok ? 0 : r.blocked ? 3 : 1;
      }
      if (sub === 'host' || sub === 'resume') {
        const target =
          getOpt(args, '--target') ??
          (sub === 'resume' ? undefined : undefined);
        const jobId = getOpt(args, '--job');
        if (sub === 'host' && !target && !jobId) {
          process.stderr.write(`${tl('cli.usage.migrate.host.--target.root.new.3e94a2')}\n`);
          return 2;
        }
        if (!wantsHostExecute(args) && !hasFlag(args, '--dry-run')) {
          printJson({
            ok: false,
            blocked: true,
            notes: [
              tl('notes.auto.n0329'),
            ] });
          return 3;
        }
        const identityFile = getOpt(args, '--identity-file');
        const identityId = getOpt(args, '--identity-id');
        let auth:
          | { kind: 'identity'; privateKeyPath: string }
          | { kind: 'identityId'; dataDir: string; identityId: string }
          | { kind: 'password'; password: string }
          | { kind: 'agent' } = { kind: 'agent' };
        let passwordForTempKey: string | undefined;
        if (identityFile) {
          auth = { kind: 'identity', privateKeyPath: identityFile };
        } else if (identityId) {
          auth = {
            kind: 'identityId',
            dataDir: ctx.dataDir,
            identityId };
        } else if (hasFlag(args, '--password') || process.env.YSK_MIGRATE_SSH_PASSWORD) {
          const pw =
            getOpt(args, '--password') ||
            process.env.YSK_MIGRATE_SSH_PASSWORD ||
            '';
          if (!pw) {
            printJson({
              ok: false,
              notes: [tl('notes.auto.n0056')] });
            return 2;
          }
          passwordForTempKey = pw;
          auth = { kind: 'password', password: pw };
        }
        // resume: load job target
        let targetStr = target;
        if (!targetStr && jobId) {
          const j = loadMigrateJob(ctx.dataDir, jobId);
          if (j?.target) {
            targetStr = `${j.target.user}@${j.target.host}`;
          }
        }
        if (!targetStr) {
          printJson({ ok: false, notes: [tl('notes.auto.n1555')] });
          return 2;
        }
        const port = getOpt(args, '--port')
          ? Number(getOpt(args, '--port'))
          : undefined;
        const r = await runSourceMigrateHost({
          host: ctx.host,
          db: ctx.db,
          dataDir: ctx.dataDir,
          target: targetStr,
          port,
          auth: passwordForTempKey
            ? { kind: 'agent' } // will switch after temp key
            : auth,
          passwordForTempKey,
          maintenanceAccepted:
            hasFlag(args, '--maintenance') ||
            hasFlag(args, '--yes') ||
            wantsHostExecute(args),
          forceWipeTarget: hasFlag(args, '--force-wipe-target'),
          targetDataDir: getOpt(args, '--target-data-dir'),
          dryRun: hasFlag(args, '--dry-run'),
          remotePost: !hasFlag(args, '--skip-remote-post'),
          yskVersion: VERSION,
          jobId });
        printJson(r);
        return r.ok ? 0 : r.blocked ? 3 : 1;
      }
      process.stderr.write(`${tl('cli.usage.x.972912')}\n`);
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
        executeEnabled: process.env.YSK_EXECUTE === '1' });
      try {
        const result = await installControlPlaneSystemd({
          dataDir,
          cliPath,
          host: ctx.host,
          enable });
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
    process.stderr.write(`${tl('cli.usage.system.unit-install.--enable.--data-dir.path.33daa1')}\n`);
    return 1;
  }

  if (command === 'stack') {
    const sub = args[1] ?? 'status';
    const dataDir = getOpt(args, '--data-dir') ?? join(process.cwd(), '.ysk');
    const ctx = createAppContext({
      version: VERSION,
      dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1',
    });
    try {
      if (sub === 'plans') {
        const plans = listStackPlans();
        if (json) printJson({ ok: true, plans });
        else {
          for (const p of plans) {
            process.stdout.write(`${p.id}\t${p.title}\t${p.bundles.join(',')}\n`);
          }
        }
        return 0;
      }
      if (sub === 'bundles') {
        const bundles = listStackBundles();
        if (json) printJson({ ok: true, bundles });
        else {
          for (const b of bundles) {
            process.stdout.write(`${b.id}\t${b.title}\t${b.components.join(',')}\n`);
          }
        }
        return 0;
      }
      if (sub === 'expand' || sub === 'preview') {
        const plan = getOpt(args, '--plan') ?? undefined;
        const bundlesCsv = getOpt(args, '--bundles');
        const bundles = bundlesCsv ? bundlesCsv.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        const sql = hasFlag(args, '--with-mysql-server') ? 'mysql' : 'mariadb';
        const r = expandComponents({ plan, bundles }, { sqlServer: sql as 'mysql' | 'mariadb', clamav: hasFlag(args, '--with-clamav') });
        if (json) printJson(r);
        else if (!r.ok) {
          process.stderr.write(`${r.error}\n`);
          return 2;
        } else {
          process.stdout.write(`plan=${r.plan}\nbundles=${r.bundles.join(',')}\ncomponents:\n`);
          for (const c of r.components) process.stdout.write(`  - ${c}\n`);
        }
        return r.ok ? 0 : 2;
      }
      if (sub === 'status') {
        const st = await getStackStatus({ host: ctx.host, dataDir });
        if (json) printJson({ ok: true, ...st });
        else {
          process.stdout.write(`manifest plan=${st.manifest.plan} bundles=${st.manifest.bundles.join(',')}\n`);
          for (const c of st.components.filter((x) => x.installed || x.inManifest)) {
            process.stdout.write(
              `${c.id}\tinstalled=${c.installed}\tinManifest=${c.inManifest}\n`,
            );
          }
        }
        return 0;
      }
      if (sub === 'scan') {
        const scan = await scanStack({ host: ctx.host, dataDir });
        if (json) printJson({ ok: true, ...scan });
        else {
          process.stdout.write(`${scan.notes.join('\n')}\n`);
          process.stdout.write(`components: ${Object.keys(scan.manifest.components).join(', ')}\n`);
        }
        return 0;
      }
      if (sub === 'install') {
        const plan = getOpt(args, '--plan') ?? undefined;
        const bundlesCsv = getOpt(args, '--bundles');
        const bundles = bundlesCsv ? bundlesCsv.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        const wantExecute = hasFlag(args, '--yes') || hasFlag(args, '--execute');
        const useDry = hasFlag(args, '--dry-run') || !wantExecute;
        // Real install requires YSK_EXECUTE=1 + root honesty via host
        const runCtx = createAppContext({
          version: VERSION,
          dataDir,
          executeEnabled: wantExecute && process.env.YSK_EXECUTE === '1',
        });
        try {
          const result = await installStack({
            host: runCtx.host,
            dataDir,
            plan,
            bundles,
            options: {
              sqlServer: hasFlag(args, '--with-mysql-server') ? 'mysql' : 'mariadb',
              clamav: hasFlag(args, '--with-clamav'),
            },
            dryRun: useDry || process.env.YSK_EXECUTE !== '1',
          });
          if (json) printJson(result);
          else {
            process.stdout.write(`${result.notes.join('\n')}\n`);
            for (const s of result.steps.slice(0, 40)) {
              process.stdout.write(`  [${s.status}] ${s.name}${s.detail ? `: ${s.detail}` : ''}\n`);
            }
            if (result.dryRun) {
              process.stdout.write(
                `Dry-run only. Apply with: YSK_EXECUTE=1 sudo ${CLI_NAME} stack install --yes --plan ${plan ?? 'recommended'} --data-dir ${dataDir}\n`,
              );
            }
          }
          return exitFromResult(result);
        } finally {
          closeAppContext(runCtx);
        }
      }
      if (sub === 'uninstall') {
        const wantExecute = hasFlag(args, '--yes') || hasFlag(args, '--execute');
        const useDry = hasFlag(args, '--dry-run') || !wantExecute;
        const bundlesCsv = getOpt(args, '--bundles');
        const componentsCsv = getOpt(args, '--components');
        const runCtx = createAppContext({
          version: VERSION,
          dataDir,
          executeEnabled: wantExecute && process.env.YSK_EXECUTE === '1',
        });
        try {
          const result = await uninstallStack({
            host: runCtx.host,
            dataDir,
            all: hasFlag(args, '--all'),
            bundles: bundlesCsv ? bundlesCsv.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
            components: componentsCsv
              ? componentsCsv.split(',').map((s) => s.trim()).filter(Boolean)
              : undefined,
            dataPolicy: hasFlag(args, '--purge-data') ? 'purge' : 'keep',
            removeProduct: hasFlag(args, '--remove-product'),
            dryRun: useDry || process.env.YSK_EXECUTE !== '1',
          });
          if (json) printJson(result);
          else {
            process.stdout.write(`${result.notes.join('\n')}\n`);
            for (const s of result.steps.slice(0, 40)) {
              process.stdout.write(`  [${s.status}] ${s.name}${s.detail ? `: ${s.detail}` : ''}\n`);
            }
            if (result.dryRun) {
              process.stdout.write(
                `Dry-run only. Apply with: YSK_EXECUTE=1 sudo ${CLI_NAME} stack uninstall --yes ...\n`,
              );
            }
          }
          return exitFromResult(result);
        } finally {
          closeAppContext(runCtx);
        }
      }
      process.stderr.write(
        `Usage: ${CLI_NAME} stack plans|bundles|status|scan|expand|install|uninstall [--plan recommended] [--bundles web,defense] [--dry-run|--yes] [--keep-data|--purge-data] [--data-dir PATH] [--json]\n`,
      );
      return 2;
    } finally {
      closeAppContext(ctx);
    }
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
      webRoot: webRoot ?? undefined });
    const { listenControlPlane } = await import('./http-server.js');
    const dual = await listenControlPlane(ctx, host, port);
    const scheme = dual.primary.scheme;
    const addr = { host: dual.primary.host, port: dual.primary.port };
    const msg = `${PRODUCT_NAME} listening on ${scheme}://${addr.host}:${addr.port}`;
    const publicBind = host === '0.0.0.0' || host === '::' || host === '[::]';
    if (json) {
      printJson({
        ok: true,
        code: 'YSK_SERVE',
        message: msg,
        data: {
          ...addr,
          https: dual.https,
          scheme,
          http: dual.http ?? null,
          configPath: configPath ?? null,
          adminUsername: config?.adminUsername ?? 'admin',
          locale: config?.locale ?? 'zh-HK',
          webUi: Boolean(webRoot),
          webRoot,
          securityWarnings: publicBind
            ? [
                'Listening on all interfaces — firewall / reverse proxy required; prefer 127.0.0.1 for admin plane',
              ]
            : [],
        },
      });
    } else {
      process.stdout.write(`${msg}\n`);
      if (dual.http) {
        process.stdout.write(
          `HTTP dual: http://${dual.http.host}:${dual.http.port}` +
            (config?.tlsHttpRedirect !== false ? ` → https :${port}\n` : '\n'),
        );
      }
      if (publicBind) {
        process.stderr.write(`${tl('cli.msg.security.control.plane.f59a63')}\n`);
      }
      process.stdout.write(`Health: ${scheme}://${addr.host}:${addr.port}/health\n`);
      process.stdout.write(
        webRoot
          ? `Web UI:  ${scheme}://${addr.host}:${addr.port}/\n`
          : tl('notes.auto.t0784'),
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
      for (const s of dual.servers) s.close();
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

  if (command === 'health') {
    const url = getOpt(args, '--url');
    if (url) {
      try {
        const base = url.replace(/\/$/, '');
        const target = /\/health(\?|$)/.test(base) ? base : `${base}/health`;
        const res = await fetch(target, { signal: AbortSignal.timeout(8_000) });
        const text = await res.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* plain */
        }
        printJson({
          ok: res.ok,
          httpStatus: res.status,
          url: target,
          body,
        });
        return res.ok ? 0 : 1;
      } catch (e) {
        printJson({
          ok: false,
          url,
          error: e instanceof Error ? e.message : String(e),
        });
        return 5;
      }
    }
    const ctx = openCliContext(args);
    try {
      const executeEnabled = ctx.host.executeEnabled();
      const isRoot = ctx.host.isRoot();
      printJson({
        ok: true,
        status: ctx.protection.mode === 'normal' ? 'ok' : 'degraded',
        product: PRODUCT_NAME,
        version: VERSION,
        protectionMode: ctx.protection.mode,
        timestamp: new Date().toISOString(),
        executeEnabled,
        isRoot,
        mode: executeEnabled && isRoot ? 'production_capable' : 'degraded',
        dataDir: ctx.dataDir,
        notes: [
          'Local snapshot (no HTTP). Pass --url http://127.0.0.1:9287 to probe a running serve.',
        ],
      });
      return 0;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (command === 'readiness' || command === 'doctor') {
    const { assessProductionReadiness, storeStatus } = await import('@ysk/core');
    const dataDir = getOpt(args, '--data-dir') ?? join(process.cwd(), '.ysk');
    const ctx = createAppContext({
      version: VERSION,
      dataDir,
      executeEnabled: process.env.YSK_EXECUTE === '1' });
    try {
      const store = storeStatus(ctx.db, join(ctx.dataDir, 'ysk.json'));
      // last_backup_run may live in SettingsRepository not only settings map
      let lastBackup: string | undefined;
      try {
        const lb = ctx.settings.getJson<{ at?: string }>('last_backup_run');
        if (lb?.at) {
          ctx.db.snapshot.settings = ctx.db.snapshot.settings ?? {};
          ctx.db.snapshot.settings['last_backup_run'] = JSON.stringify(lb);
        }
        lastBackup = lb?.at;
      } catch {
        /* ignore */
      }
      const report = await assessProductionReadiness({
        dataDir: ctx.dataDir,
        host: ctx.host,
        product: PRODUCT_NAME,
        version: VERSION,
        projects: ctx.db.snapshot.projects.map((p) => ({
          id: p.id,
          name: p.name,
          linuxUser: p.linux_user,
          homeDir: p.home_dir,
          osProvisioned: Boolean(p.os_provisioned),
        })),
        db: ctx.db,
        storeKind: store.kind,
      });
      printJson({
        ...report,
        store: {
          kind: store.kind,
          location: store.location,
          users: store.users,
          projects: store.projects,
          lastBackupAt: lastBackup ?? null,
        },
        via: command,
      });
      return report.productionReady ? 0 : 2;
    } finally {
      closeAppContext(ctx);
    }
  }

  if (
    command === 'vpn' ||
    command === 'vnc' ||
    command === 'apache' ||
    command === 'network' ||
    command === 'real-ip' ||
    command === 'updates' ||
    command === 'software' ||
    command === 'db' ||
    command === 'redis' ||
    command === 'ftp' ||
    command === 'runtimes'
  ) {
    // Honour --execute together with YSK_EXECUTE for host mutations
    const configPath = getOpt(args, '--config');
    const dataDirOpt = getOpt(args, '--data-dir');
    let config = configPath ? loadConfigFile(configPath) : undefined;
    if (dataDirOpt) {
      config = config
        ? { ...config, dataDir: dataDirOpt }
        : ({ dataDir: dataDirOpt } as NonNullable<typeof config>);
    }
    const ctx = createAppContext({
      version: VERSION,
      config,
      configPath,
      dataDir: dataDirOpt ?? config?.dataDir,
      executeEnabled:
        process.env.YSK_EXECUTE === '1' || wantsHostExecute(args),
    });
    try {
      const helpers = {
        printJson,
        getOpt,
        hasFlag,
        wantsHostExecute,
        exitFromResult,
      };
      if (command === 'vpn') {
        const { runVpnCommand } = await import('./cli/cmd-vpn.js');
        return await runVpnCommand(ctx, args, json, helpers);
      }
      if (command === 'vnc') {
        const { runVncCommand } = await import('./cli/cmd-vnc.js');
        return await runVncCommand(ctx, args, json, helpers);
      }
      if (command === 'apache') {
        const { runApacheCommand } = await import('./cli/cmd-apache.js');
        return await runApacheCommand(ctx, args, json, helpers);
      }
      if (command === 'real-ip') {
        const { runRealIpCommand } = await import('./cli/cmd-network.js');
        return await runRealIpCommand(ctx, args, json, helpers);
      }
      if (command === 'updates') {
        const { runUpdatesCommand } = await import('./cli/cmd-updates.js');
        return await runUpdatesCommand(ctx, args, json, helpers);
      }
      if (command === 'software') {
        const { runSoftwareCommand } = await import('./cli/cmd-software.js');
        return await runSoftwareCommand(ctx, args, json, helpers);
      }
      if (command === 'db') {
        const { runDbCommand } = await import('./cli/cmd-db.js');
        return await runDbCommand(ctx, args, json, helpers);
      }
      if (command === 'redis') {
        const { runRedisCommand } = await import('./cli/cmd-redis.js');
        return await runRedisCommand(ctx, args, json, helpers);
      }
      if (command === 'ftp') {
        const { runFtpCommand } = await import('./cli/cmd-ftp.js');
        return await runFtpCommand(ctx, args, json, helpers);
      }
      if (command === 'runtimes') {
        // Alias → hosting runtimes / runtime-install / switch / uninstall
        const tokens = args.filter((a) => !a.startsWith('-'));
        const act = tokens[1] ?? 'list';
        const {
          probeRuntimes,
          listSupportedRuntimes,
          planOrInstallRuntime,
          defaultRuntimeVersion,
          switchRuntimeDefault,
          uninstallRuntimeVersion,
        } = await import('@ysk/core');
        const kinds = [
          'node',
          'php',
          'python',
          'go',
          'rust',
          'java',
          'kotlin',
          'bun',
        ] as const;
        type Kind = (typeof kinds)[number];
        const parseKind = (raw: string | undefined): Kind =>
          raw && (kinds as readonly string[]).includes(raw)
            ? (raw as Kind)
            : 'node';

        if (act === 'list' || act === 'status' || act === 'probe') {
          try {
            printJson({
              ok: true,
              supported: listSupportedRuntimes(),
              probe: await probeRuntimes(ctx.host, { dataDir: ctx.dataDir }),
            });
            return 0;
          } catch (e) {
            printJson({
              ok: true,
              supported: listSupportedRuntimes(),
              probe: null,
              blockedProbe: true,
              notes: [e instanceof Error ? e.message : String(e)],
            });
            return 0;
          }
        }
        if (act === 'install') {
          const kind = parseKind(getOpt(args, '--kind') ?? tokens[2]);
          const result = await planOrInstallRuntime({
            dataDir: ctx.dataDir,
            host: ctx.host,
            kind,
            version: getOpt(args, '--version') ?? defaultRuntimeVersion(kind),
            install: wantsHostExecute(args) || hasFlag(args, '--install'),
            plugins: getOpt(args, '--plugins')
              ?.split(',')
              .map((s) => s.trim())
              .filter(Boolean),
            extensions: getOpt(args, '--extensions')
              ?.split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          });
          printJson(result);
          return exitFromResult(result);
        }
        if (act === 'switch') {
          if (!wantsHostExecute(args)) {
            printJson({
              ok: false,
              blocked: true,
              dryRun: true,
              notes: ['Pass --execute to switch default runtime version.'],
            });
            return 3;
          }
          const kind = parseKind(getOpt(args, '--kind') ?? tokens[2]);
          const result = await switchRuntimeDefault({
            host: ctx.host,
            kind,
            version: getOpt(args, '--version') ?? defaultRuntimeVersion(kind),
          });
          printJson(result);
          return exitFromResult(result);
        }
        if (act === 'uninstall' || act === 'remove') {
          if (!wantsHostExecute(args)) {
            printJson({
              ok: false,
              blocked: true,
              dryRun: true,
              notes: ['Pass --execute to uninstall a managed runtime version.'],
            });
            return 3;
          }
          const kind = parseKind(getOpt(args, '--kind') ?? tokens[2]);
          const version = getOpt(args, '--version') ?? tokens[3];
          if (!version?.trim()) {
            process.stderr.write(
              'Usage: ysk-server runtimes uninstall --kind KIND --version VER --execute\n',
            );
            return 2;
          }
          const result = await uninstallRuntimeVersion({
            host: ctx.host,
            kind,
            version: version.trim(),
          });
          printJson(result);
          return exitFromResult(result);
        }
        process.stderr.write(
          'Usage: ysk-server runtimes list|install|switch|uninstall [--kind java|kotlin|bun|…] [--version …] [--execute]\n',
        );
        return 2;
      }
      const { runNetworkCommand } = await import('./cli/cmd-network.js');
      return await runNetworkCommand(ctx, args, json, helpers);
    } finally {
      closeAppContext(ctx);
    }
  }

  process.stderr.write(
    `${tl('cli.unknownCommand', { command, cli: CLI_NAME })}\n`,
  );
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
      // Force exit so host probes / open handles cannot hang the process after work is done.
      process.exit(typeof code === 'number' ? code : 0);
    },
    (err) => {
      const json = process.argv.includes('--json');
      process.exit(printCliError(err, json));
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
