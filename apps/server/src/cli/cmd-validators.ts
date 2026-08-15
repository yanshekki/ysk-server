/**
 * CLI: validators — L1 node manager.
 */
import {
  clearValidatorInstance,
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
  upgradeValidatorInstance,
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
    h.printJson({
      ok: true,
      instances: listValidatorInstances(ctx.dataDir),
      executeEnabled: ctx.host.executeEnabled(),
      isRoot: ctx.host.isRoot(),
    });
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
    });
    h.printJson(result);
    return h.exitFromResult(result);
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
              });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  process.stderr.write(`${tl('validators.cli.usage')}\n`);
  return 2;
}
