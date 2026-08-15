/**
 * CLI: docker — engine, containers, images, compose, prune.
 */
import {
  dockerComposeAction,
  dockerComposeLogs,
  dockerContainerAction,
  dockerContainerLogs,
  dockerEngineControl,
  dockerEngineStatus,
  dockerPrune,
  dockerPull,
  dockerExec,
  dockerRun,
  dockerSystemDf,
  getDockerDaemonSettings,
  inspectDocker,
  listDockerComposeProjects,
  listDockerContainers,
  listDockerImages,
  listDockerNetworks,
  listDockerVolumes,
} from 'ysk-server-core';
import {
  isDockerComposeAction,
  isDockerContainerAction,
  isDockerEngineAction,
  tl,
} from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

export async function runDockerCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'status';
  const execute = h.wantsHostExecute(args) && ctx.host.executeEnabled();
  const base = { host: ctx.host, dataDir: ctx.dataDir, execute };

  if (sub === 'status') {
    h.printJson({
      ok: true,
      status: await dockerEngineStatus({ host: ctx.host, dataDir: ctx.dataDir }),
      executeEnabled: ctx.host.executeEnabled(),
      isRoot: ctx.host.isRoot(),
    });
    return 0;
  }

  if (sub === 'ps') {
    h.printJson({
      ok: true,
      items: await listDockerContainers({ host: ctx.host, all: !h.hasFlag(args, '--running') }),
    });
    return 0;
  }

  if (sub === 'images') {
    h.printJson({ ok: true, items: await listDockerImages(ctx.host) });
    return 0;
  }

  if (sub === 'volumes') {
    h.printJson({ ok: true, items: await listDockerVolumes({ host: ctx.host }) });
    return 0;
  }

  if (sub === 'networks') {
    h.printJson({ ok: true, items: await listDockerNetworks({ host: ctx.host }) });
    return 0;
  }

  if (sub === 'df') {
    h.printJson({ ok: true, items: await dockerSystemDf(ctx.host) });
    return 0;
  }

  if (sub === 'daemon') {
    h.printJson({ ok: true, daemon: getDockerDaemonSettings() });
    return 0;
  }

  if (sub === 'inspect') {
    const id = h.getOpt(args, '--name') ?? h.getOpt(args, '--id') ?? tokens[2];
    if (!id) {
      process.stderr.write(`${tl('docker.cli.usage')}\n`);
      return 2;
    }
    const r = await inspectDocker({ host: ctx.host, id });
    h.printJson({ ok: r.ok, inspect: r.raw, notes: r.notes });
    return r.ok ? 0 : 4;
  }

  if (sub === 'logs') {
    const id = h.getOpt(args, '--name') ?? h.getOpt(args, '--id') ?? tokens[2];
    if (!id) {
      process.stderr.write(`${tl('docker.cli.usage')}\n`);
      return 2;
    }
    h.printJson({
      ok: true,
      ...(await dockerContainerLogs({
        host: ctx.host,
        id,
        tail: Number(h.getOpt(args, '--tail') ?? '200'),
      })),
    });
    return 0;
  }

  if (sub === 'start' || sub === 'stop' || sub === 'restart' || sub === 'rm') {
    const id = h.getOpt(args, '--name') ?? h.getOpt(args, '--id') ?? tokens[2];
    if (!id) {
      process.stderr.write(`${tl('docker.cli.usage')}\n`);
      return 2;
    }
    const action = sub === 'rm' ? 'remove' : sub;
    if (!isDockerContainerAction(action)) return 2;
    const result = await dockerContainerAction({ ...base, id, action });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'exec') {
    const id = h.getOpt(args, '--name') ?? h.getOpt(args, '--id') ?? tokens[2];
    if (!id) {
      process.stderr.write(`${tl('docker.cli.usage')}\n`);
      return 2;
    }
    const presetRaw = h.getOpt(args, '--preset') ?? 'version';
    const preset =
      presetRaw === 'help' || presetRaw === 'hostname' || presetRaw === 'version' ? presetRaw : '';
    if (!preset) {
      process.stderr.write(`${tl('docker.cli.usage')}\n`);
      return 2;
    }
    const result = await dockerExec({
      ...base,
      id,
      preset,
      bin: h.getOpt(args, '--bin') ?? undefined,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'pull') {
    const image = h.getOpt(args, '--image') ?? tokens[2] ?? '';
    const result = await dockerPull({ ...base, image });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'run') {
    const result = await dockerRun({
      ...base,
      req: {
        image: h.getOpt(args, '--image') ?? tokens[2] ?? '',
        name: h.getOpt(args, '--name'),
      },
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'prune') {
    const scope =
      h.hasFlag(args, '--images')
        ? 'images'
        : h.hasFlag(args, '--volumes')
          ? 'volumes'
          : h.hasFlag(args, '--system')
            ? 'system'
            : 'containers';
    const result = await dockerPrune({
      ...base,
      scope,
      confirm: h.getOpt(args, '--confirm') ?? (scope === 'volumes' || scope === 'system' ? undefined : 'PRUNE'),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'engine') {
    const action = tokens[2] ?? '';
    if (!isDockerEngineAction(action)) {
      process.stderr.write(`${tl('docker.cli.usage')}\n`);
      return 2;
    }
    const result = await dockerEngineControl({ ...base, action });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'compose') {
    const action = tokens[2] ?? 'ls';
    if (action === 'ls') {
      h.printJson({
        ok: true,
        items: await listDockerComposeProjects({ host: ctx.host, dataDir: ctx.dataDir }),
      });
      return 0;
    }
    const project = h.getOpt(args, '--project') ?? tokens[3] ?? '';
    if (action === 'logs') {
      h.printJson({
        ok: true,
        ...(await dockerComposeLogs({ host: ctx.host, dataDir: ctx.dataDir, project })),
      });
      return 0;
    }
    if (!isDockerComposeAction(action)) {
      process.stderr.write(`${tl('docker.cli.usage')}\n`);
      return 2;
    }
    const result = await dockerComposeAction({ ...base, project, action });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  process.stderr.write(`${tl('docker.cli.usage')}\n`);
  return 2;
}
