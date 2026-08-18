/**
 * Host-migrate inventory helpers — leftover homes listed once, not again as warnings.
 */

export function isOrphanHomeWarning(note: string, orphanHomes: string[]): boolean {
  const n = String(note || '');
  if (orphanHomes.some((p) => p && n.includes(p))) return true;
  return /孤立.*主目錄|leftover (project )?home|orphan home|store 無對應|not in the store/i.test(
    n,
  );
}

export function otherInventoryWarnings(
  warnings: string[],
  orphanHomes: string[],
): string[] {
  return warnings.filter((w) => !isOrphanHomeWarning(w, orphanHomes));
}

export function orphanHomeName(path: string): string {
  const parts = String(path).split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

export type InventoryPillKind =
  | 'loading'
  | 'ok'
  | 'warn'
  | 'orphans'
  | 'both'
  | 'failed'
  | 'pending';

export function inventoryPillKind(input: {
  loading: boolean;
  hasInventory: boolean;
  otherWarningCount: number;
  orphanCount: number;
  hasError: boolean;
}): InventoryPillKind {
  if (input.loading) return 'loading';
  if (input.hasInventory) {
    const w = input.otherWarningCount > 0;
    const o = input.orphanCount > 0;
    if (w && o) return 'both';
    if (w) return 'warn';
    if (o) return 'orphans';
    return 'ok';
  }
  if (input.hasError) return 'failed';
  return 'pending';
}
