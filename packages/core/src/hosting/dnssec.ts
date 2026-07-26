/**
 * DNSSEC key material for a zone (managed under dataDir) — honest, not auto-publish.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export async function generateDnssecKeys(input: {
  dataDir: string;
  zone: string;
  host?: HostExecutor;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  dsRecord?: string;
  publicKey?: string;
  requiresExecute?: boolean;
}> {
  const zone = input.zone.trim().toLowerCase().replace(/\.$/, '');
  const dir = join(input.dataDir, 'dns', 'dnssec', zone);
  mkdirSync(dir, { recursive: true });
  const notes: string[] = [];
  const written: string[] = [];

  if (input.host?.executeEnabled()) {
    // dnssec-keygen if available
    const check = await input.host.runCommand(
      ['bash', '-c', 'command -v dnssec-keygen || true'],
      { timeoutMs: 3_000 },
    );
    if (check.stdout.trim()) {
      const r = await input.host.runCommand(
        [
          'bash',
          '-c',
          `cd ${JSON.stringify(dir)} && dnssec-keygen -a ECDSAP256SHA256 -n ZONE ${zone} 2>&1`,
        ],
        { timeoutMs: 30_000 },
      );
      notes.push(r.stdout || r.stderr || `exit ${r.exitCode}`);
      if (r.exitCode === 0) {
        const files = readdirSync(dir).filter((f) => f.endsWith('.key'));
        for (const f of files) written.push(join(dir, f));
        const keyFile = files.find((f) => f.includes('key'));
        if (keyFile) {
          const pub = readFileSync(join(dir, keyFile), 'utf8');
          const ds = await input.host.runCommand(
            ['bash', '-c', `cd ${JSON.stringify(dir)} && dnssec-dsfromkey ${JSON.stringify(keyFile)} 2>&1 || true`],
            { timeoutMs: 10_000 },
          );
          return {
            ok: true,
            notes: [...notes, '已用 dnssec-keygen 產生金鑰（未自動簽署 zone）'],
            written,
            publicKey: pub.slice(0, 500),
            dsRecord: (ds.stdout || '').trim() || undefined,
          };
        }
      }
    }
  }

  // Fallback: openssl placeholder note
  const meta = join(dir, 'README.txt');
  writeFileSync(
    meta,
    [
      `YSK DNSSEC for ${zone}`,
      'Install bind9-dnsutils and enable YSK_EXECUTE for real dnssec-keygen.',
      'Do not claim DS is live until published at registrar.',
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(meta);
  return {
    ok: true,
    notes: [
      '已建立 DNSSEC 目錄',
      input.host?.executeEnabled()
        ? 'dnssec-keygen 不可用 — 僅寫入說明'
        : '未開啟系統變更：僅寫入說明檔',
      '狀態：written（非已簽署／非已上線）',
    ],
    written,
    requiresExecute: !input.host?.executeEnabled(),
  };
}

export function listDnssecMaterial(
  dataDir: string,
  zone: string,
): { files: string[]; notes: string[] } {
  const dir = join(dataDir, 'dns', 'dnssec', zone.trim().toLowerCase().replace(/\.$/, ''));
  if (!existsSync(dir)) return { files: [], notes: ['尚未產生 DNSSEC 金鑰'] };
  const files = readdirSync(dir).map((f) => join(dir, f));
  return { files, notes: [`${files.length} 個檔案 under ${dir}`] };
}
