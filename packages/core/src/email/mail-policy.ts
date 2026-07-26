/**
 * Apply domain rate-limit + antispam flags to managed Postfix/Rspamd snippets.
 * Honest: written under dataDir; system apply needs EXECUTE+root.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';

export async function applyMailDomainPolicy(input: {
  dataDir: string;
  host: HostExecutor;
  domain: string;
  rateLimitPerHour?: number | null;
  antispam?: boolean;
  applySystem?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  written: string[];
  blocked?: boolean;
  blockMessage?: string;
  apply_status: 'written' | 'applied' | 'blocked';
}> {
  const domain = input.domain.trim().toLowerCase();
  const notes: string[] = [];
  const written: string[] = [];
  const dir = join(input.dataDir, 'email', 'policy', domain);
  mkdirSync(dir, { recursive: true });

  const rate = input.rateLimitPerHour;
  const rateFile = join(dir, 'rate.cf');
  const rateBody =
    rate != null && rate > 0
      ? `# YSK outbound rate for ${domain}\n# messages/hour soft limit (policyd-style hint)\n${domain} ${rate}\n`
      : `# YSK rate: unlimited for ${domain}\n`;
  writeFileSync(rateFile, rateBody, 'utf8');
  written.push(rateFile);

  const spamFile = join(dir, 'rspamd-domain.map');
  const spamBody = input.antispam
    ? `${domain} ysk_antispam_on\n`
    : `# antispam off for ${domain}\n`;
  writeFileSync(spamFile, spamBody, 'utf8');
  written.push(spamFile);

  const readme = join(dir, 'README.txt');
  writeFileSync(
    readme,
    [
      `YSK mail policy for ${domain}`,
      `rateLimitPerHour=${rate ?? 'none'}`,
      `antispam=${Boolean(input.antispam)}`,
      'Include rate map in postfix restriction_classes or external policyd.',
      'Include rspamd map via local.d/multimap.conf — not auto-linked.',
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(readme);
  notes.push(`已寫入政策檔 ${dir}`);

  if (!input.applySystem) {
    notes.push('狀態：written（未套用到系統 Postfix/Rspamd）');
    return { ok: true, notes, written, apply_status: 'written' };
  }

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      ok: false,
      notes: [...notes, '無法套用系統：需 YSK_EXECUTE + root'],
      written,
      blocked: true,
      blockMessage: '需要系統變更權限',
      apply_status: 'blocked',
    };
  }

  // Best-effort: copy maps under /etc/ysk-server/email and reload if units exist
  const sysDir = '/etc/ysk-server/email/policy';
  const cp = await input.host.runCommand(
    [
      'bash',
      '-c',
      `mkdir -p ${JSON.stringify(sysDir)} && cp -a ${JSON.stringify(dir)}/. ${JSON.stringify(join(sysDir, domain))}/ 2>&1`,
    ],
    { timeoutMs: 15_000 },
  );
  notes.push(cp.exitCode === 0 ? `已複製到 ${sysDir}/${domain}` : `複製失敗: ${cp.stderr || cp.stdout}`);

  for (const unit of ['postfix', 'rspamd']) {
    const r = await input.host.runCommand(['systemctl', 'reload', unit], { timeoutMs: 10_000 });
    notes.push(
      r.exitCode === 0
        ? `${unit} reloaded`
        : `${unit} reload skipped/failed: ${(r.stderr || r.stdout).slice(0, 80)}`,
    );
  }

  const applied = cp.exitCode === 0;
  notes.push(
    applied
      ? '狀態：applied（maps 已複製；真正限速需 postfix/rspamd 引用這些檔）'
      : '狀態：written（系統複製未成功）',
  );
  return {
    ok: applied,
    notes,
    written,
    apply_status: applied ? 'applied' : 'written',
  };
}
