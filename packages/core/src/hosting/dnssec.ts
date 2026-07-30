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
    const check = await input.host.runCommand(
      ['bash', '-c', 'command -v dnssec-keygen'],
      { timeoutMs: 3_000 },
    );
    if (check.exitCode === 0 && check.stdout.trim()) {
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
          notes.push('dnssec-keygen 失敗');
        }
      } else {
        notes.push(`沿用已有金鑰 ${existingKeys.length} 個`);
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
          notes.push('已產生 DS 紀錄（請自行提交 registrar — 面板唔會自動發佈）');
        } else {
          notes.push('dnssec-dsfromkey 未能產生 DS');
        }
      }
    } else {
      notes.push('dnssec-keygen 不在 PATH（apt install bind9-dnsutils）');
    }
  } else {
    notes.push('未開啟系統變更：無法執行 dnssec-keygen');
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
      const signCheck = await input.host.runCommand(
        ['bash', '-c', 'command -v dnssec-signzone'],
        { timeoutMs: 3_000 },
      );
      if (signCheck.exitCode === 0) {
        // Copy zone into dnssec dir for signing next to keys
        const localZone = join(dir, `${zone}.zone`);
        try {
          copyFileSync(zoneFile, localZone);
          written.push(localZone);
        } catch {
          notes.push('無法複製 zone 檔到 dnssec 目錄');
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
              `已簽署 zone → ${signedPath}（需 reload 權威 DNS；DS 仍要人手上 registrar）`,
            );
          } else {
            notes.push('dnssec-signzone 未產生 .signed 檔');
          }
        }
      } else {
        notes.push('dnssec-signzone 不可用 — 只保留金鑰／DS');
      }
    } else {
      notes.push(
        `未找到 managed zone 檔（試過 dns/zones/${zone}.zone）— 跳過簽署`,
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
          ? '狀態：applied（金鑰+簽署本地 zone；非 registrar 上線）'
          : '狀態：written（金鑰/DS 已有；zone 未簽署或未找 zone 檔）',
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
      '需安裝 bind9-dnsutils 並開啟系統變更權限，才可真正執行 dnssec-keygen。',
      'DS 在 registrar 發佈前，請勿宣稱已上線。',
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(meta);
  return {
    ok: false,
    notes: [
      ...notes,
      '已建立 DNSSEC 目錄（僅說明檔）',
      '狀態：written（非已簽署／非已上線）— 唔假成功',
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
  if (!existsSync(dir)) return { files: [], notes: ['尚未產生 DNSSEC 金鑰'] };
  const files = readdirSync(dir).map((f) => join(dir, f));
  return { files, notes: [`${files.length} 個檔案 under ${dir}`] };
}
