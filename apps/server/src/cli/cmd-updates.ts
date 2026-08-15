/**
 * CLI: updates — host package inventory + apply (panel Updates page).
 * Distinct from `update` (panel self-update binary).
 *
 *   inventory | refresh | apply | apply-batch | summary | self
 */
import {
  collectInventory,
  adviseInventory,
  applyPackageUpdate,
  adviseUpdate,
  planUpdateExecution,
  checkSelfUpdate,
  buildUpdatesSummary,
  normalizeUpdatesScanSettings,
  DEFAULT_UPDATES_SCAN,
  collectUpdateHub,
  summarizeHub,
} from 'ysk-server-core';
import { cliPositionals } from '../cli-argv.js';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';
import { VERSION } from '../version.js';

function needExecute(
  h: CliHelpers,
  args: string[],
  msg: string,
): number | null {
  if (h.wantsHostExecute(args)) return null;
  h.printJson({ ok: false, blocked: true, dryRun: true, notes: [msg] });
  return 3;
}

export async function runUpdatesCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = cliPositionals(args);
  const sub = tokens[1] ?? 'inventory';

  if (sub === 'hub') {
    try {
      const r = await collectUpdateHub({
        host: ctx.host,
        dataDir: ctx.dataDir,
        currentPanelVersion: VERSION,
        refreshRuntimes: h.hasFlag(args, '--refresh-runtimes'),
      });
      h.printJson({
        ok: true,
        entries: r.entries,
        inventoryMeta: r.inventoryMeta,
        summary: summarizeHub(r.entries),
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

  if (sub === 'inventory' || sub === 'list' || sub === 'status') {
    const cached = h.hasFlag(args, '--cached');
    let inv: Awaited<ReturnType<typeof collectInventory>>;
    if (cached) {
      const last = ctx.settings.getJson('last_inventory') as
        | { inventory?: unknown[]; collectedAt?: string }
        | null;
      if (last?.inventory) {
        const inventory = last.inventory as Parameters<typeof adviseInventory>[0];
        const advice = adviseInventory(inventory);
        h.printJson({
          ok: true,
          inventory,
          advice,
          collectedAt: last.collectedAt,
          cached: true,
        });
        return 0;
      }
    }
    try {
      inv = await collectInventory(ctx.host);
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
    const items = inv.items;
    const advice = adviseInventory(items);
    let filtered = items.map((row, i) => ({
      ...row,
      ...advice[i],
      packageName:
        (row as { name?: string; packageName?: string }).packageName ??
        (row as { name?: string }).name,
    }));
    const q = (h.getOpt(args, '--q') ?? h.getOpt(args, '--query') ?? '').toLowerCase();
    const risk = h.getOpt(args, '--risk');
    if (q) {
      filtered = filtered.filter((r) =>
        String(r.packageName ?? '')
          .toLowerCase()
          .includes(q),
      );
    }
    if (risk) {
      filtered = filtered.filter((r) => String((r as { risk?: string }).risk ?? 'low') === risk);
    }
    if (h.hasFlag(args, '--upgradable')) {
      filtered = filtered.filter(
        (r) =>
          Boolean((r as { candidateVersion?: string }).candidateVersion) &&
          (r as { candidateVersion?: string }).candidateVersion !==
            (r as { currentVersion?: string; version?: string }).currentVersion &&
          (r as { candidateVersion?: string }).candidateVersion !==
            (r as { version?: string }).version,
      );
    }
    ctx.settings.setJson('last_inventory', {
      inventory: items,
      collectedAt: new Date().toISOString(),
      collectMeta: inv.meta,
    });
    h.printJson({
      ok: true,
      inventory: filtered,
      advice,
      meta: { total: filtered.length, raw: items.length, collect: inv.meta },
      collectedAt: new Date().toISOString(),
    });
    return 0;
  }

  if (sub === 'refresh' || sub === 'scan') {
    try {
      const inv = await collectInventory(ctx.host);
      const advice = adviseInventory(inv.items);
      ctx.settings.setJson('last_inventory', {
        inventory: inv.items,
        collectedAt: new Date().toISOString(),
        collectMeta: inv.meta,
      });
      h.printJson({
        ok: true,
        inventory: inv.items,
        advice,
        meta: inv.meta,
        collectedAt: new Date().toISOString(),
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

  if (sub === 'apply') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute (and YSK_EXECUTE=1) to apply package updates on the host.',
    );
    if (blocked !== null) return blocked;
    const packageName = h.getOpt(args, '--package') ?? h.getOpt(args, '--name') ?? tokens[2];
    const currentVersion = h.getOpt(args, '--current') ?? '0';
    const candidateVersion = h.getOpt(args, '--candidate') ?? h.getOpt(args, '--to');
    if (!packageName?.trim() || !candidateVersion?.trim()) {
      process.stderr.write(
        'Usage: ysk-server updates apply --package NAME --candidate VER [--current VER] [--confirm-high-risk] --execute\n',
      );
      return 2;
    }
    const item = adviseUpdate({
      packageName: packageName.trim(),
      currentVersion,
      candidateVersion: candidateVersion.trim(),
      knownCves: h.getOpt(args, '--cves')?.split(',').filter(Boolean),
      hasSecurityFix: h.hasFlag(args, '--security'),
    });
    const risk = h.getOpt(args, '--risk');
    if (risk) (item as { risk: string }).risk = risk;
    const plan = planUpdateExecution(item);
    const result = await applyPackageUpdate({
      host: ctx.host,
      item,
      confirmHighRisk: h.hasFlag(args, '--confirm-high-risk'),
    });
    h.printJson({ ...result, plan });
    return h.exitFromResult(result);
  }

  if (sub === 'apply-batch' || sub === 'batch') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to apply a batch of package updates.',
    );
    if (blocked !== null) return blocked;
    const list = h.getOpt(args, '--packages');
    // format: name@current->candidate,name2@c->cand
    if (!list?.trim()) {
      process.stderr.write(
        'Usage: ysk-server updates apply-batch --packages "pkg@1.0->1.1,pkg2@2->3" [--confirm-high-risk] --execute\n',
      );
      return 2;
    }
    const parts = list.split(',').map((s) => s.trim()).filter(Boolean);
    const results: Array<Record<string, unknown>> = [];
    let appliedCount = 0;
    let failedCount = 0;
    for (const p of parts.slice(0, 40)) {
      const m = p.match(/^([^@]+)@([^-]+)->(.+)$/);
      if (!m) {
        results.push({ packageName: p, ok: false, notes: ['bad format name@cur->cand'] });
        failedCount += 1;
        continue;
      }
      const item = adviseUpdate({
        packageName: m[1]!.trim(),
        currentVersion: m[2]!.trim(),
        candidateVersion: m[3]!.trim(),
      });
      const result = await applyPackageUpdate({
        host: ctx.host,
        item,
        confirmHighRisk: h.hasFlag(args, '--confirm-high-risk'),
      });
      results.push({ packageName: item.packageName, ...result });
      if (result.ok && result.applied) appliedCount += 1;
      else failedCount += 1;
    }
    h.printJson({
      ok: failedCount === 0,
      appliedCount,
      failedCount,
      results,
    });
    return failedCount === 0 ? 0 : 1;
  }

  if (sub === 'summary') {
    const scanCfg = normalizeUpdatesScanSettings(
      ctx.settings.getJson('updates_scan_settings') ?? DEFAULT_UPDATES_SCAN,
    );
    const job = ctx.scheduler.list().find((j) => j.id === 'updates.scan');
    const summary = buildUpdatesSummary({
      lastInventory: ctx.settings.getJson('last_inventory'),
      lastSelf: ctx.settings.getJson('last_self_update'),
      scanSettings: scanCfg,
      nextScanAt: job?.nextRunAt ?? null,
    });
    h.printJson({ ok: true, summary });
    return 0;
  }

  if (sub === 'self' || sub === 'self-update') {
    try {
      const r = await checkSelfUpdate({
        currentVersion: VERSION,
      });
      h.printJson({ ...r, ok: true, currentVersion: VERSION });
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
    'Usage: ysk-server updates hub|inventory|refresh|apply|apply-batch|summary|self [--refresh-runtimes] [--execute] [--json]\n' +
      'Note: panel self-update binary is also `ysk-server update`.\n',
  );
  return 2;
}
