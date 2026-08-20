/**
 * Display helpers for NodeID / BLS hex — grouped for reading, copy stays raw.
 */

const HEX_RE = /^(0x)?([0-9a-fA-F]+)$/;

export function formatHexForDisplay(
  raw: string,
  group = 8,
  groupsPerLine = 4,
): string | null {
  const s = raw.trim();
  const m = HEX_RE.exec(s);
  if (!m) return null;
  const hex = m[2] ?? '';
  if (hex.length < 16) return null;
  const chunks: string[] = [];
  for (let i = 0; i < hex.length; i += group) {
    chunks.push(hex.slice(i, i + group));
  }
  const lines: string[] = [];
  for (let i = 0; i < chunks.length; i += groupsPerLine) {
    const row = chunks.slice(i, i + groupsPerLine).join('  ');
    if (i === 0) {
      lines.push(m[1] ? `${m[1]}${row}` : row);
    } else {
      lines.push(m[1] ? `  ${row}` : row);
    }
  }
  return lines.join('\n');
}

export function credentialCopyText(
  items: Array<{ label: string; value?: string | null }>,
): string {
  return items
    .filter((row) => row.value?.trim())
    .map((row) => `${row.label}: ${row.value!.trim()}`)
    .join('\n');
}
