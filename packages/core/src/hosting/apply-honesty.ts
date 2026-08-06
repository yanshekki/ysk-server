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
