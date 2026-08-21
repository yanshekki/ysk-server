/**
 * CLI: validators — L1 node manager.
 */
import { readFileSync } from 'node:fs';
import {
  clearValidatorInstance,
  removeValidatorInstance,
  collectValidatorDisk,
  createValidatorInstance,
  getValidatorInstance,
  listValidatorChains,
  listValidatorInstances,
  logsValidatorInstance,
  restartValidatorInstance,
  setValidatorPolicy,
  startValidatorInstance,
  statusValidatorInstance,
  stopValidatorInstance,
  restoreAdaMithril,
  restoreValidatorSnapshot,
  pruneValidatorInstance,
  readValidatorCompose,
  switchValidatorNetwork,
  summarizeValidatorInstances,
  loadValidatorSettings,
  saveValidatorSettings,
  upgradeValidatorInstance,
  setValidatorClientVersion,
  listOfficialClientVersions,
  ensureClientOfficialReleases,
  attachAdaProducerKeys,
  detachAdaProducerKeys,
} from 'ysk-server-core';
import { isValidatorInstanceId, tl } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

export async function runValidatorsCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'list';
  const execute = h.wantsHostExecute(args) && ctx.host.executeEnabled();

  if (sub === 'list') {
    const { summaries } = await summarizeValidatorInstances({
      dataDir: ctx.dataDir,
      host: ctx.host,
    });
    h.printJson({
      ok: true,
      instances: listValidatorInstances(ctx.dataDir),
      summaries,
      settings: loadValidatorSettings(ctx.dataDir),
      executeEnabled: ctx.host.executeEnabled(),
      isRoot: ctx.host.isRoot(),
    });
    return 0;
  }

  if (sub === 'settings') {
    if (h.getOpt(args, '--auto-clear') != null) {
      const on = h.getOpt(args, '--auto-clear') === '1' || h.getOpt(args, '--auto-clear') === 'true';
      h.printJson({ ok: true, settings: saveValidatorSettings(ctx.dataDir, { autoClear: on }) });
      return 0;
    }
    h.printJson({ ok: true, settings: loadValidatorSettings(ctx.dataDir) });
    return 0;
  }

  if (sub === 'chains') {
    h.printJson({ ok: true, chains: listValidatorChains() });
    return 0;
  }

  if (sub === 'disk') {
    const disk = await collectValidatorDisk({ dataDir: ctx.dataDir, host: ctx.host });
    h.printJson({ ok: true, disk });
    return 0;
  }

  if (sub === 'get' || sub === 'status') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const instance = getValidatorInstance(ctx.dataDir, id);
    if (!instance) {
      h.printJson({ ok: false, code: 'not_found', message: tl('validators.errors.notFound') });
      return 4;
    }
    if (sub === 'status') {
      const status = await statusValidatorInstance({
        dataDir: ctx.dataDir,
        host: ctx.host,
        id,
      });
      h.printJson({ ok: true, instance, ...status });
      return 0;
    }
    h.printJson({ ok: true, instance });
    return 0;
  }

  if (sub === 'logs') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const logs = await logsValidatorInstance({
      dataDir: ctx.dataDir,
      host: ctx.host,
      id,
      tail: Number(h.getOpt(args, '--tail') ?? '200'),
    });
    h.printJson({ ok: true, ...logs });
    return 0;
  }

  if (sub === 'policy') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    const policy = h.getOpt(args, '--upgrade') ?? tokens[3] ?? '';
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const r = setValidatorPolicy(ctx.dataDir, id, policy);
    h.printJson(r);
    return r.ok ? 0 : 2;
  }

  if (sub === 'upgrade') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await upgradeValidatorInstance({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'versions') {
    const clientId = h.getOpt(args, '--client') ?? tokens[2] ?? '';
    if (!clientId) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    try {
      await ensureClientOfficialReleases({
        dataDir: ctx.dataDir,
        clientId,
        force: h.hasFlag(args, '--refresh'),
      });
    } catch {
      /* pin-only fallback */
    }
    h.printJson({
      ok: true,
      ...listOfficialClientVersions({
        dataDir: ctx.dataDir,
        clientId,
        network: h.getOpt(args, '--network') ?? undefined,
      }),
    });
    return 0;
  }

  if (sub === 'set-version') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await setValidatorClientVersion({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
      clientId: h.getOpt(args, '--client') ?? '',
      tag: h.getOpt(args, '--tag') ?? '',
      confirm: h.getOpt(args, '--confirm') ?? '',
      acceptMainnet: h.hasFlag(args, '--accept-mainnet'),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'create') {
    const chain = h.getOpt(args, '--chain') ?? '';
    const network = h.getOpt(args, '--network') ?? '';
    const profile = h.getOpt(args, '--profile') ?? 'minimal';
    const slug = h.getOpt(args, '--slug');
    const result = await createValidatorInstance({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      chain,
      network,
      profile,
      slug,
      el: h.getOpt(args, '--el') ?? undefined,
      cl: h.getOpt(args, '--cl') ?? undefined,
      elTag: h.getOpt(args, '--el-tag') ?? undefined,
      clTag: h.getOpt(args, '--cl-tag') ?? undefined,
      nodeTag: h.getOpt(args, '--node-tag') ?? undefined,
      memory: h.getOpt(args, '--memory') ?? undefined,
      cpus: h.getOpt(args, '--cpus') ?? undefined,
      dataPath: h.getOpt(args, '--data-path') ?? undefined,
      rpcPort: h.getOpt(args, '--rpc-port') != null ? Number(h.getOpt(args, '--rpc-port')) : undefined,
      acceptLowDisk: h.hasFlag(args, '--accept-low-disk'),
      acceptLowMem: h.hasFlag(args, '--accept-low-mem'),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'prune') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await pruneValidatorInstance({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'switch-network') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    const network = h.getOpt(args, '--network') ?? tokens[3] ?? '';
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await switchValidatorNetwork({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
      network,
      confirm: h.getOpt(args, '--confirm') ?? id,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'snapshot') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await restoreValidatorSnapshot({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
      confirm: h.getOpt(args, '--confirm') ?? id,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'compose') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    h.printJson(readValidatorCompose(ctx.dataDir, id));
    return 0;
  }

  if (sub === 'mithril') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await restoreAdaMithril({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
      confirm: h.getOpt(args, '--confirm') ?? (h.hasFlag(args, '--confirm') ? id : undefined),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'delete' || sub === 'rm') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await removeValidatorInstance({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
      confirm: h.getOpt(args, '--confirm') ?? (h.hasFlag(args, '--confirm') ? id : undefined),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'start' || sub === 'stop' || sub === 'restart' || sub === 'clear') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const base = { dataDir: ctx.dataDir, host: ctx.host, execute, id };
    const result =
      sub === 'start'
        ? await startValidatorInstance(base)
        : sub === 'stop'
          ? await stopValidatorInstance(base)
          : sub === 'restart'
            ? await restartValidatorInstance(base)
            : await clearValidatorInstance({
                ...base,
                confirm: h.getOpt(args, '--confirm') ?? (h.hasFlag(args, '--confirm') ? id : undefined),
                removeUnit: h.hasFlag(args, '--remove-unit'),
                restoreSnapshot: h.hasFlag(args, '--restore-snapshot'),
              });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'producer-keys') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const readMaybe = (flag: string): string | undefined => {
      const p = h.getOpt(args, flag);
      if (!p) return undefined;
      const buf = readFileSync(p);
      const text = buf.toString('utf8').trim();
      return text.startsWith('{') ? text : buf.toString('base64');
    };
    const result = await attachAdaProducerKeys({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
      confirm: h.getOpt(args, '--confirm') ?? (h.hasFlag(args, '--confirm') ? id : undefined),
      acceptMainnet: h.hasFlag(args, '--accept-mainnet'),
      kes: readMaybe('--kes-file'),
      vrf: readMaybe('--vrf-file'),
      opcert: readMaybe('--opcert-file'),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'producer-detach') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id || !isValidatorInstanceId(id)) {
      process.stderr.write(`${tl('validators.cli.usage')}\n`);
      return 2;
    }
    const result = await detachAdaProducerKeys({
      dataDir: ctx.dataDir,
      host: ctx.host,
      execute,
      id,
      confirm: h.getOpt(args, '--confirm') ?? (h.hasFlag(args, '--confirm') ? id : undefined),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  process.stderr.write(`${tl('validators.cli.usage')}\n`);
  return 2;
}
