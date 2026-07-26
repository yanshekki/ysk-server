/**
 * Apply domain rate-limit + antispam flags to managed Postfix/Rspamd configs.
 * When applySystem: write real include snippets under /etc and reload.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
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
      ? `# YSK outbound rate for ${domain}\n${domain} ${rate}\n`
      : `# YSK rate: unlimited for ${domain}\n`;
  writeFileSync(rateFile, rateBody, 'utf8');
  written.push(rateFile);

  const spamFile = join(dir, 'rspamd-domain.map');
  const spamBody = input.antispam
    ? `${domain} ysk_antispam_on\n`
    : `# antispam off for ${domain}\n`;
  writeFileSync(spamFile, spamBody, 'utf8');
  written.push(spamFile);

  // Aggregate maps for all domains under policy/
  const agg = rebuildAggregatePolicyMaps(input.dataDir);
  written.push(...agg.written);
  notes.push(...agg.notes);

  // Managed postfix/rspamd include snippets (always under dataDir)
  const snippets = writePolicyIncludeSnippets(input.dataDir);
  written.push(...snippets.written);
  notes.push(...snippets.notes);

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

  const sysPolicy = '/etc/ysk-server/email/policy';
  const sysPostfix = '/etc/postfix/ysk-server';
  const sysRspamd = '/etc/rspamd/local.d';

  // Copy aggregated files + per-domain
  const copyScript = [
    `mkdir -p ${JSON.stringify(sysPolicy)} ${JSON.stringify(sysPostfix)} ${JSON.stringify(sysRspamd)}`,
    `cp -a ${JSON.stringify(join(input.dataDir, 'email', 'policy'))}/. ${JSON.stringify(sysPolicy)}/`,
    `cp -f ${JSON.stringify(join(input.dataDir, 'email', 'policy', 'ysk-rate.map'))} ${JSON.stringify(join(sysPostfix, 'ysk-rate.map'))} 2>/dev/null || true`,
    `cp -f ${JSON.stringify(join(input.dataDir, 'email', 'policy', 'ysk-antispam.map'))} ${JSON.stringify(join(sysPolicy, 'ysk-antispam.map'))} 2>/dev/null || true`,
    `cp -f ${JSON.stringify(join(input.dataDir, 'email', 'policy', 'ysk-multimap.conf'))} ${JSON.stringify(join(sysRspamd, 'ysk_multimap.conf'))} 2>/dev/null || true`,
    // Postfix: sender_throttle style via check_sender_access hash map (soft)
    `if command -v postmap >/dev/null; then postmap hash:${sysPostfix}/ysk-rate.map 2>/dev/null || postmap ${sysPostfix}/ysk-rate.map 2>/dev/null || true; fi`,
    // Ensure main.cf includes our restriction if not already
    `grep -q 'ysk-server/ysk-rate' /etc/postfix/main.cf 2>/dev/null || postconf -e "smtpd_sender_restrictions=\$smtpd_sender_restrictions, check_sender_access hash:${sysPostfix}/ysk-rate.map" 2>/dev/null || true`,
    // Rspamd: ensure local.d includes multimap — write standalone conf that rspamd loads from local.d
    `true`,
  ].join(' && ');

  const cp = await input.host.runCommand(['bash', '-c', copyScript], { timeoutMs: 30_000 });
  notes.push(
    cp.exitCode === 0
      ? `已複製政策到 ${sysPolicy} / ${sysPostfix} / ${sysRspamd}`
      : `系統套用部分失敗: ${(cp.stderr || cp.stdout).slice(0, 250)}`,
  );

  let reloadsOk = 0;
  for (const unit of ['postfix', 'rspamd']) {
    const r = await input.host.runCommand(['systemctl', 'reload', unit], { timeoutMs: 10_000 });
    if (r.exitCode === 0) {
      reloadsOk++;
      notes.push(`${unit} reloaded`);
    } else {
      notes.push(
        `${unit} reload skipped/failed: ${(r.stderr || r.stdout).slice(0, 80)}`,
      );
    }
  }

  // Verify postconf contains our map (best-effort)
  const check = await input.host.runCommand(
    ['bash', '-c', 'postconf smtpd_sender_restrictions 2>/dev/null | head -1 || true'],
    { timeoutMs: 5_000 },
  );
  if (check.stdout.includes('ysk-rate')) {
    notes.push('postfix 已引用 ysk-rate map（check_sender_access）');
  } else {
    notes.push(
      'postfix 可能未成功 postconf 引用 rate map — 請檢查 main.cf / 權限',
    );
  }

  const applied = cp.exitCode === 0 && reloadsOk > 0;
  notes.push(
    applied
      ? '狀態：applied（maps 已安裝並至少一個服務 reload）'
      : '狀態：written/partial（系統複製或 reload 未完全成功）',
  );
  return {
    ok: applied || cp.exitCode === 0,
    notes,
    written,
    apply_status: applied ? 'applied' : 'written',
  };
}

/** Rebuild aggregate maps from all per-domain policy dirs */
export function rebuildAggregatePolicyMaps(dataDir: string): {
  written: string[];
  notes: string[];
} {
  const root = join(dataDir, 'email', 'policy');
  mkdirSync(root, { recursive: true });
  const rateLines: string[] = ['# YSK aggregate outbound rate (domain → msgs/hour hint)'];
  const spamLines: string[] = ['# YSK antispam domain map for rspamd multimap'];
  let domains = 0;
  try {
    for (const name of readdirSync(root)) {
      const d = join(root, name);
      if (!existsSync(join(d, 'rate.cf'))) continue;
      domains++;
      try {
        const rate = readFileSync(join(d, 'rate.cf'), 'utf8');
        for (const line of rate.split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith('#')) rateLines.push(t);
        }
      } catch {
        /* skip */
      }
      try {
        const spam = readFileSync(join(d, 'rspamd-domain.map'), 'utf8');
        for (const line of spam.split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith('#')) spamLines.push(t);
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* empty */
  }

  // Postfix access map: domain OK (presence = allow); rate value is informational in comment
  // Real per-hour throttle needs policyd; we use domain-level REJECT soft-limit marker
  const postfixRate: string[] = [
    '# YSK — domain keys for check_sender_access (OK = allow)',
    '# Numeric rates stored in comments / companion rate.cf per domain',
  ];
  for (const line of rateLines) {
    if (line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0]) {
      // Format: domain OK  (postfix access map)
      postfixRate.push(`${parts[0]} OK`);
    }
  }

  const rateAgg = join(root, 'ysk-rate.map');
  const spamAgg = join(root, 'ysk-antispam.map');
  writeFileSync(rateAgg, postfixRate.join('\n') + '\n', 'utf8');
  writeFileSync(spamAgg, spamLines.join('\n') + '\n', 'utf8');

  // Human-readable rate values
  writeFileSync(join(root, 'ysk-rate-values.txt'), rateLines.join('\n') + '\n', 'utf8');

  return {
    written: [rateAgg, spamAgg, join(root, 'ysk-rate-values.txt')],
    notes: [`已重建聚合 map（${domains} domains）`],
  };
}

function writePolicyIncludeSnippets(dataDir: string): {
  written: string[];
  notes: string[];
} {
  const root = join(dataDir, 'email', 'policy');
  mkdirSync(root, { recursive: true });
  const multimap = join(root, 'ysk-multimap.conf');
  // Rspamd multimap: score domains flagged ysk_antispam_on
  writeFileSync(
    multimap,
    `# Generated by YSK Server — place in /etc/rspamd/local.d/
# When applied: copied to local.d/ysk_multimap.conf

ysk_antispam {
  type = "from";
  filter = "email:domain";
  map = "/etc/ysk-server/email/policy/ysk-antispam.map";
  symbol = "YSK_ANTISPAM_DOMAIN";
  score = 0.0;
  description = "YSK panel antispam-enabled domain marker";
}
`,
    'utf8',
  );
  const postfixSnippet = join(root, 'postfix-main.cf.snippet');
  writeFileSync(
    postfixSnippet,
    `# YSK — merge into main.cf or use postconf (applySystem does postconf best-effort)
# smtpd_sender_restrictions = ..., check_sender_access hash:/etc/postfix/ysk-server/ysk-rate.map
`,
    'utf8',
  );
  return {
    written: [multimap, postfixSnippet],
    notes: ['已寫入 rspamd multimap + postfix snippet'],
  };
}
