/**
 * Collect files (and empty dirs) from browser drag-drop / file input,
 * including full folder trees via webkitGetAsEntry.
 */

export type CollectedUpload = {
  /** Relative path with / (e.g. folder/sub/a.txt) */
  relativePath: string;
  /** Top-level folder name for UI, or '' for loose files */
  folderLabel: string;
  kind: 'file' | 'dir';
  file?: File;
};

function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(out);
          return;
        }
        out.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(
  entry: FileSystemEntry,
  parentRel: string,
  folderLabel: string,
  out: CollectedUpload[],
): Promise<void> {
  const name = entry.name;
  const rel = parentRel ? `${parentRel}/${name}` : name;

  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    out.push({
      relativePath: rel,
      folderLabel,
      kind: 'file',
      file,
    });
    return;
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children = await readAllDirectoryEntries(reader);
    if (!children.length) {
      out.push({ relativePath: rel, folderLabel, kind: 'dir' });
      return;
    }
    for (const child of children) {
      await walkEntry(child, rel, folderLabel || name, out);
    }
  }
}

/** Prefer DataTransferItemList for folders; fall back to FileList. */
export async function collectFromDataTransfer(
  dt: DataTransfer,
): Promise<CollectedUpload[]> {
  const items = dt.items;
  if (items && items.length) {
    const out: CollectedUpload[] = [];
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const entry =
        typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
    if (entries.length) {
      for (const entry of entries) {
        const top = entry.isDirectory ? entry.name : '';
        await walkEntry(entry, '', top, out);
      }
      return out;
    }
  }
  return collectFromFileList(dt.files);
}

/** Flat file list (no directory tree metadata). */
export function collectFromFileList(list: FileList | File[]): CollectedUpload[] {
  return Array.from(list).map((file) => {
    // webkitRelativePath when using input[webkitdirectory]
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
    const folderLabel = parts.length > 1 ? parts[0]! : '';
    return {
      relativePath: parts.join('/'),
      folderLabel,
      kind: 'file' as const,
      file,
    };
  });
}
