/**
 * Desktop-style name-conflict planning for Files drop / copy / move / rename.
 */
import { uniqueFileName, type DirIfExists, type FileIfExists } from 'ysk-server-shared';
import { ApiError } from '../../shared/services/api';
import type { CollectedUpload } from './drop-collect';

export type ConflictAction = 'skip' | 'replace' | 'keepBoth' | 'merge' | 'cancel';

export type ConflictDecision = {
  action: ConflictAction;
  applyToAll: boolean;
};

export type FileNameConflictPrompt = {
  name: string;
  destType: 'file' | 'dir';
  incomingType: 'file' | 'dir';
  destPath: string;
  keepBothName: string;
  current: number;
  total: number;
  remaining: number;
};

export type DestNameEntry = { name: string; type: string };

export type PlannedWriteIfExists = FileIfExists | DirIfExists;

export type PlannedUpload = CollectedUpload & {
  destRelativePath: string;
  ifExists: PlannedWriteIfExists;
  skipped?: boolean;
  cancelled?: boolean;
};

type WorkItem = CollectedUpload & { sourceRelativePath?: string };

function sourcePath(item: WorkItem): string {
  return item.sourceRelativePath ?? item.relativePath;
}

export function isNameConflictError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false;
  const details = err.details;
  if (!details || typeof details !== 'object') return true;
  const o = details as Record<string, unknown>;
  const nested =
    o.details && typeof o.details === 'object'
      ? (o.details as Record<string, unknown>)
      : null;
  const reason = o.reason ?? nested?.reason;
  return reason == null || reason === 'EEXIST';
}

export function topLevelName(rel: string): string {
  return rel.replace(/^\/+/, '').split('/').filter(Boolean)[0] ?? '';
}

export function groupCollectedUploads(items: CollectedUpload[]): Array<{
  name: string;
  incomingType: 'file' | 'dir';
  items: CollectedUpload[];
}> {
  const map = new Map<
    string,
    { name: string; incomingType: 'file' | 'dir'; items: CollectedUpload[] }
  >();
  for (const item of items) {
    const name = topLevelName(item.relativePath);
    if (!name) continue;
    const isDir = item.kind === 'dir' || item.relativePath.includes('/');
    let g = map.get(name);
    if (!g) {
      g = { name, incomingType: isDir ? 'dir' : 'file', items: [] };
      map.set(name, g);
    } else if (isDir) {
      g.incomingType = 'dir';
    }
    g.items.push(item);
  }
  return [...map.values()];
}

export function rewriteTopLevelPath(rel: string, fromTop: string, toTop: string): string {
  if (rel === fromTop) return toTop;
  if (rel.startsWith(`${fromTop}/`)) return `${toTop}${rel.slice(fromTop.length)}`;
  return rel;
}

export function destKindOf(items: DestNameEntry[], name: string): 'file' | 'dir' | null {
  const e = items.find((i) => i.name === name);
  if (!e) return null;
  return e.type === 'dir' ? 'dir' : 'file';
}

/** Apply-to-all: merge only auto-applies to folder+folder; files still ask. */
export function resolveAppliedAction(
  action: ConflictAction | null,
  incomingType: 'file' | 'dir',
  destType: 'file' | 'dir',
): ConflictAction | null {
  if (!action) return null;
  if (action === 'merge') {
    return incomingType === 'dir' && destType === 'dir' ? 'merge' : null;
  }
  return action;
}

function joinRel(dir: string, name: string): string {
  if (!dir || dir === '.') return name;
  return `${dir.replace(/\/$/, '')}/${name}`;
}

function prefixRel(parent: string, rel: string): string {
  if (!rel) return parent;
  return `${parent}/${rel}`;
}

export async function planCollectedUploads(opts: {
  collected: CollectedUpload[];
  destItems: DestNameEntry[];
  destDir: string;
  listDir: (rel: string) => Promise<DestNameEntry[]>;
  ask: (prompt: FileNameConflictPrompt) => Promise<ConflictDecision>;
}): Promise<PlannedUpload[]> {
  const applyAll: { action: ConflictAction | null } = { action: null };
  return planGroups({
    collected: opts.collected,
    destItems: opts.destItems,
    destDir: opts.destDir,
    pathPrefix: '',
    listDir: opts.listDir,
    ask: opts.ask,
    applyAll,
  });
}

async function planGroups(opts: {
  collected: WorkItem[];
  destItems: DestNameEntry[];
  destDir: string;
  pathPrefix: string;
  listDir: (rel: string) => Promise<DestNameEntry[]>;
  ask: (prompt: FileNameConflictPrompt) => Promise<ConflictDecision>;
  applyAll: { action: ConflictAction | null };
}): Promise<PlannedUpload[]> {
  const taken = new Set(opts.destItems.map((i) => i.name));
  const groups = groupCollectedUploads(opts.collected);
  const out: PlannedUpload[] = [];
  let cancelledRest = false;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const destRel = opts.pathPrefix
      ? prefixRel(opts.pathPrefix, group.name)
      : group.name;

    if (cancelledRest) {
      for (const item of group.items) {
        out.push(mark(item, destRelItem(item, opts.pathPrefix), 'fail', 'cancelled'));
      }
      continue;
    }

    const destType = destKindOf(opts.destItems, group.name);
    if (!destType) {
      taken.add(group.name);
      for (const item of group.items) {
        out.push({
          ...item,
          relativePath: sourcePath(item),
          destRelativePath: destRelItem(item, opts.pathPrefix),
          ifExists: 'fail',
        });
      }
      continue;
    }

    let action = resolveAppliedAction(opts.applyAll.action, group.incomingType, destType);
    if (!action) {
      const keepBothName = uniqueFileName(group.name, taken, { kind: group.incomingType });
      const decision = await opts.ask({
        name: group.name,
        destType,
        incomingType: group.incomingType,
        destPath: joinRel(opts.destDir, group.name),
        keepBothName,
        current: i + 1,
        total: groups.length,
        remaining: groups.length - i,
      });
      if (decision.applyToAll) opts.applyAll.action = decision.action;
      action =
        resolveAppliedAction(decision.action, group.incomingType, destType) ?? decision.action;
    }

    if (action === 'cancel') {
      cancelledRest = true;
      for (const item of group.items) {
        out.push(mark(item, destRelItem(item, opts.pathPrefix), 'fail', 'cancelled'));
      }
      continue;
    }

    if (action === 'skip') {
      for (const item of group.items) {
        out.push(mark(item, destRelItem(item, opts.pathPrefix), 'fail', 'skipped'));
      }
      continue;
    }

    if (action === 'keepBoth') {
      const newName = uniqueFileName(group.name, taken, { kind: group.incomingType });
      taken.add(newName);
      for (const item of group.items) {
        const rewritten = rewriteTopLevelPath(item.relativePath, group.name, newName);
        out.push({
          ...item,
          relativePath: sourcePath(item),
          destRelativePath: opts.pathPrefix ? prefixRel(opts.pathPrefix, rewritten) : rewritten,
          ifExists: 'rename',
        });
      }
      continue;
    }

    if (action === 'merge' && group.incomingType === 'dir' && destType === 'dir') {
      out.push({
        relativePath: destRel,
        folderLabel: group.items[0]?.folderLabel ?? group.name,
        kind: 'dir',
        destRelativePath: destRel,
        ifExists: 'merge',
      });
      const children: WorkItem[] = [];
      for (const item of group.items) {
        if (item.relativePath === group.name) continue;
        const stripped = rewriteTopLevelPath(item.relativePath, group.name, '').replace(
          /^\//,
          '',
        );
        if (!stripped) continue;
        children.push({
          ...item,
          relativePath: stripped,
          sourceRelativePath: sourcePath(item),
        });
      }
      if (!children.length) continue;
      const childDest = joinRel(opts.destDir, group.name);
      let childItems: DestNameEntry[] = [];
      try {
        childItems = await opts.listDir(childDest);
      } catch {
        childItems = [];
      }
      const nested = await planGroups({
        collected: children,
        destItems: childItems,
        destDir: childDest,
        pathPrefix: destRel,
        listDir: opts.listDir,
        ask: opts.ask,
        applyAll: opts.applyAll,
      });
      out.push(...nested);
      if (nested.some((n) => n.cancelled)) cancelledRest = true;
      continue;
    }

    // replace (including type mismatch after user confirmed)
    taken.add(group.name);
    const typeMismatch = destType !== group.incomingType;
    for (const item of group.items) {
      out.push({
        ...item,
        relativePath: sourcePath(item),
        destRelativePath: destRelItem(item, opts.pathPrefix),
        ifExists:
          item.kind === 'dir'
            ? typeMismatch
              ? 'overwrite'
              : 'merge'
            : 'overwrite',
      });
    }
  }

  return out;
}

function destRelItem(item: CollectedUpload, pathPrefix: string): string {
  return pathPrefix ? prefixRel(pathPrefix, item.relativePath) : item.relativePath;
}

function mark(
  item: WorkItem,
  destRelativePath: string,
  ifExists: PlannedWriteIfExists,
  mode: 'skipped' | 'cancelled',
): PlannedUpload {
  return {
    ...item,
    relativePath: sourcePath(item),
    destRelativePath,
    ifExists,
    skipped: mode === 'skipped',
    cancelled: mode === 'cancelled',
  };
}
