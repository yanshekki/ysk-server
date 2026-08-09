/**
 * Shared honesty model: panel state ≠ disk write ≠ system loaded ≠ external truth.
 *
 * Layers used across DNS / nginx / firewall / SSL:
 *   draft    — only in control-plane DB
 *   written  — artifact on disk under dataDir (or plan file)
 *   applied  — system process reloaded AND post-condition probe passed
 *   external — public view (CDN NS, Let's Encrypt, etc.) may still differ
 *
 * Never mark `applied` from reload exit code alone when the subsystem needs
 * extra registration (PowerDNS named.conf, nginx -t, ufw status).
 *
 * Prefer mapping to shared `ApplyStatus` via:
 *   honestyFromFlags → 'draft'|'written'|'applied'
 *   then assertHonestOps / sendOpsResult on the HTTP edge.
 */
export type HonestyLayer = 'draft' | 'written' | 'applied' | 'external';

export function honestyFromFlags(input: {
  written: boolean;
  systemOk: boolean;
  probeOk?: boolean;
}): Extract<HonestyLayer, 'draft' | 'written' | 'applied'> {
  if (!input.written) return 'draft';
  if (input.systemOk && input.probeOk !== false) return 'applied';
  return 'written';
}

/** Map honesty layer to shared apply_status vocabulary used by OpsResultDto. */
export function applyStatusFromHonesty(
  layer: Extract<HonestyLayer, 'draft' | 'written' | 'applied'>,
): 'written' | 'applied' | 'failed' {
  if (layer === 'applied') return 'applied';
  if (layer === 'written') return 'written';
  return 'failed'; // draft is not yet written — callers usually keep ok:false notes
}
