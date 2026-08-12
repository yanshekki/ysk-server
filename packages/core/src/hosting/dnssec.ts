import { tl } from '@ysk-server/shared';
/**
 * DNSSEC key material + optional zone signing under dataDir — honest, not auto-publish DS.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export async function generateDnssecKeys(input: {
  dataDir: string;
  zone: string;
  host?: HostExecutor;
  /** When true and keys exist, attempt dnssec-signzone on managed zone file */
  signZone?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  dsRecord?: string;
  publicKey?: string;
  signedZonePath?: string;
  requiresExecute?: boolean;
  apply_status?: 'written' | 'applied' | 'partial';
}> {
  const zone = input.zone.trim().toLowerCase().replace(/\.$/, '');
  const dir = join(input.dataDir, 'dns', 'dnssec', zone);
  mkdirSync(dir, { recursive: true });
  const notes: string[] = [];
  const written: string[] = [];

  let dsRecord: string | undefined;
  let publicKey: string | undefined;
  let keysOk = false;

  if (input.host?.executeEnabled()) {
    const { binPresent } = await import('./software-probe/index.js');
    const checkOk = await binPresent(input.host, 'dnssec-keygen');
    if (checkOk) {
      // Avoid re-generating if keys already present
      const existingKeys = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith('.key'))
        : [];
      if (existingKeys.length === 0) {
        const r = await input.host.runCommand(
          [
            'bash',
            '-c',
            `cd ${JSON.stringify(dir)} && dnssec-keygen -a ECDSAP256SHA256 -n ZONE ${zone} 2>&1`,
          ],
          { timeoutMs: 30_000 },
        );
        notes.push(r.stdout || r.stderr || `exit ${r.exitCode}`);
        if (r.exitCode !== 0) {
          notes.push(tl('notes.auto.n0256'));
        }
      } else {
        notes.push(tl('notes.auto.t0360', { v0: (existingKeys.length) }));
      }

      const files = readdirSync(dir).filter((f) => f.endsWith('.key'));
      for (const f of files) written.push(join(dir, f));
      const keyFile = files.find((f) => f.includes('key')) ?? files[0];
      if (keyFile) {
        keysOk = true;
        const pub = readFileSync(join(dir, keyFile), 'utf8');
        publicKey = pub.slice(0, 500);
        const ds = await input.host.runCommand(
          [
            'bash',
            '-c',
            `cd ${JSON.stringify(dir)} && dnssec-dsfromkey ${JSON.stringify(keyFile)} 2>&1`,
          ],
          { timeoutMs: 10_000 },
        );
        if (ds.exitCode === 0 && ds.stdout.trim()) {
          dsRecord = ds.stdout.trim();
          const dsPath = join(dir, 'DS.txt');
          writeFileSync(dsPath, dsRecord + '\n', 'utf8');
          written.push(dsPath);
          notes.push(tl('notes.auto.n0788'));
        } else {
          notes.push(tl('notes.auto.n0254'));
        }
      }
    } else {
      notes.push(tl('notes.auto.n0255'));
    }
  } else {
    notes.push(tl('notes.auto.n0986'));
  }

  // Optional: sign managed zone file
  let signedZonePath: string | undefined;
  let signed = false;
  if (keysOk && input.signZone !== false && input.host?.executeEnabled()) {
    const zoneCandidates = [
      join(input.dataDir, 'dns', 'zones', `${zone}.zone`),
      join(input.dataDir, 'dns', 'zones', zone),
    ];
    const zoneFile = zoneCandidates.find((p) => existsSync(p));
    if (zoneFile) {
      const { binPresent: hasSign } = await import('./software-probe/index.js');
      if (await hasSign(input.host, 'dnssec-signzone')) {
        // Copy zone into dnssec dir for signing next to keys
        const localZone = join(dir, `${zone}.zone`);
        try {
          copyFileSync(zoneFile, localZone);
          written.push(localZone);
        } catch {
          notes.push(tl('notes.auto.n1180'));
        }
        if (existsSync(localZone)) {
          const sign = await input.host.runCommand(
            [
              'bash',
              '-c',
              `cd ${JSON.stringify(dir)} && dnssec-signzone -A -3 $(head -c 16 /dev/urandom | xxd -p) -N INCREMENT -o ${JSON.stringify(zone)} -t ${JSON.stringify(zone + '.zone')} 2>&1`,
            ],
            { timeoutMs: 60_000 },
          );
          notes.push(sign.stdout || sign.stderr || `sign exit ${sign.exitCode}`);
          const signedPath = join(dir, `${zone}.zone.signed`);
          if (sign.exitCode === 0 && existsSync(signedPath)) {
            signed = true;
            signedZonePath = signedPath;
            written.push(signedPath);
            notes.push(
              tl('notes.auto.t0361', { v0: (signedPath) }),
            );
          } else {
            notes.push(tl('notes.auto.n0258'));
          }
        }
      } else {
        notes.push(tl('notes.auto.n0257'));
      }
    } else {
      notes.push(
        tl('notes.auto.t0362', { v0: (zone) }),
      );
    }
  }

  if (keysOk) {
    const readme = join(dir, 'README.txt');
    writeFileSync(
      readme,
      [
        `YSK DNSSEC for ${zone}`,
        signed ? `signed: ${signedZonePath}` : 'not signed',
        'Publish DS at registrar before claiming DNSSEC is live.',
        '',
      ].join('\n'),
      'utf8',
    );
    written.push(readme);
    return {
      ok: true,
      notes: [
        ...notes,
        signed
          ? tl('notes.auto.n1213')
          : tl('notes.auto.n1232'),
      ],
      written,
      publicKey,
      dsRecord,
      signedZonePath,
      apply_status: signed ? 'applied' : 'written',
    };
  }

  // Fallback: README only — not success
  const meta = join(dir, 'README.txt');
  writeFileSync(
    meta,
    [
      `YSK DNSSEC for ${zone}`,
      tl('notes.auto.n1552'),
      tl('notes.auto.n0099'),
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(meta);
  return {
    ok: false,
    notes: [
      ...notes,
      tl('notes.auto.n0773'),
      tl('notes.auto.n1234'),
    ],
    written,
    requiresExecute: !input.host?.executeEnabled(),
    apply_status: 'written',
  };
}

export function listDnssecMaterial(
  dataDir: string,
  zone: string,
): { files: string[]; notes: string[] } {
  const dir = join(dataDir, 'dns', 'dnssec', zone.trim().toLowerCase().replace(/\.$/, ''));
  if (!existsSync(dir)) return { files: [], notes: [tl('notes.auto.n0710')] };
  const files = readdirSync(dir).map((f) => join(dir, f));
  return { files, notes: [tl('notes.auto.t0363', { v0: (files.length), v1: (dir) })] };
}
