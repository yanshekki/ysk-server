/**
 * CLI: software — catalog install/uninstall (panel feature banners + software hub).
 * Complements `stack` (stack plans/bundles).
 *
 *   list | get | install | uninstall-preview | uninstall | upgrades | versions
 */
import {
  probeAllSoftware,
  installSoftware,
  installSoftwareBatch,
  installForFeature,
  getSoftware,
  collectCatalogSoftwareUpgrades,
  resolveSoftwareVersionStatus,
  resolveSoftwareVersionBatch,
  listVersionDiscoveryIds,
  previewSoftwareUninstall,
  uninstallSoftware,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

function needExecute(
  h: CliHelpers,
  args: string[],
  msg: string,
): number | null {
  if (h.wantsHostExecute(args)) return null;
  h.printJson({ ok: false, blocked: true, dryRun: true, notes: [msg] });
  return 3;
}

export async function runSoftwareCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'list';

  if (sub === 'list' || sub === 'status' || sub === 'ls') {
    const feature = h.getOpt(args, '--feature');
    try {
      const items = await probeAllSoftware(ctx.host, feature ?? undefined);
      const missing = items.filter((i) => !i.installed);
      h.printJson({
        ok: true,
        items,
        missing,
        ready: missing.length === 0,
        meta: { total: items.length, missing: missing.length },
      });
      return 0;
    } catch (e) {
      // Host probe may require EXECUTE allowlist for package queries
      h.printJson({
        ok: true,
        items: [],
        missing: [],
        ready: false,
        blockedProbe: true,
        notes: [e instanceof Error ? e.message : String(e)],
        meta: { total: 0, missing: 0 },
      });
      return 0;
    }
  }

  if (sub === 'get' || sub === 'show') {
    const id = h.getOpt(args, '--id') ?? tokens[2];
    if (!id?.trim()) {
      process.stderr.write('Usage: ysk-server software get --id COMPONENT_ID\n');
      return 2;
    }
    const spec = getSoftware(id.trim());
    if (!spec) {
      h.printJson({ ok: false, notes: ['unknown software id'] });
      return 4;
    }
    const items = await probeAllSoftware(ctx.host);
    const status = items.find((i) => i.id === id.trim());
    h.printJson({
      ok: true,
      status,
      spec: { id: spec.id, title: spec.title, packages: spec.aptPackages },
    });
    return 0;
  }

  if (sub === 'install') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to install software packages on the host.',
    );
    if (blocked !== null) return blocked;
    const feature = h.getOpt(args, '--feature');
    const idsCsv = h.getOpt(args, '--ids');
    const id = h.getOpt(args, '--id') ?? tokens[2];
    try {
      let result;
      if (feature) {
        result = await installForFeature({ host: ctx.host, feature });
      } else if (idsCsv) {
        const ids = idsCsv.split(',').map((s) => s.trim()).filter(Boolean);
        result = await installSoftwareBatch({ host: ctx.host, ids });
      } else if (id?.trim()) {
        result = await installSoftware({ host: ctx.host, id: id.trim() });
      } else {
        process.stderr.write(
          'Usage: ysk-server software install --id ID | --ids a,b | --feature FEAT --execute\n',
        );
        return 2;
      }
      h.printJson(result);
      return h.exitFromResult(result);
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'uninstall-preview' || sub === 'preview-uninstall') {
    const feature = h.getOpt(args, '--feature');
    const idsCsv = h.getOpt(args, '--ids');
    const ids = idsCsv?.split(',').map((s) => s.trim()).filter(Boolean);
    const dataPolicy =
      h.getOpt(args, '--data-policy') === 'purge' ? 'purge' : 'keep';
    const preview = await previewSoftwareUninstall({
      host: ctx.host,
      feature: feature ?? undefined,
      ids,
      dataPolicy,
    });
    h.printJson(preview);
    return preview.ok === false ? 1 : 0;
  }

  if (sub === 'uninstall' || sub === 'remove') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to uninstall software on the host.',
    );
    if (blocked !== null) return blocked;
    const feature = h.getOpt(args, '--feature');
    const idsCsv = h.getOpt(args, '--ids');
    const ids = idsCsv?.split(',').map((s) => s.trim()).filter(Boolean);
    const confirmPhrase = h.getOpt(args, '--confirm') ?? h.getOpt(args, '--confirm-phrase');
    if (!confirmPhrase) {
      process.stderr.write(
        'Usage: ysk-server software uninstall --ids a,b|--feature F --confirm PHRASE [--data-policy keep|purge] --execute\n',
      );
      return 2;
    }
    const result = await uninstallSoftware({
      host: ctx.host,
      feature: feature ?? undefined,
      ids,
      dataPolicy: h.getOpt(args, '--data-policy') === 'purge' ? 'purge' : 'keep',
      confirmPhrase,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (sub === 'upgrades') {
    try {
      const items = await collectCatalogSoftwareUpgrades(ctx.host);
      h.printJson({
        ok: true,
        items,
        upgradableCount: items.filter((i) => i.upgradable).length,
      });
      return 0;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  if (sub === 'versions') {
    const id = h.getOpt(args, '--id');
    const idsCsv = h.getOpt(args, '--ids');
    const refresh = h.hasFlag(args, '--refresh');
    try {
      if (idsCsv || (!id && h.hasFlag(args, '--all'))) {
        const ids = idsCsv
          ? idsCsv.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40)
          : listVersionDiscoveryIds().slice(0, 40);
        const items = await resolveSoftwareVersionBatch({
          host: ctx.host,
          dataDir: ctx.dataDir,
          ids,
          refresh,
        });
        h.printJson({
          ok: true,
          items,
          upgradableCount: items.filter((i) => i.upgradable).length,
        });
        return 0;
      }
      if (!id?.trim()) {
        h.printJson({
          ok: false,
          message: 'id or ids required',
          knownIds: listVersionDiscoveryIds(),
        });
        return 2;
      }
      const status = await resolveSoftwareVersionStatus({
        host: ctx.host,
        dataDir: ctx.dataDir,
        id: id.trim(),
        refresh,
      });
      h.printJson({ ok: true, ...status });
      return 0;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  process.stderr.write(
    'Usage: ysk-server software list|get|install|uninstall|uninstall-preview|upgrades|versions [--execute]\n' +
      'See also: ysk-server stack plans|status|install\n',
  );
  return 2;
}
