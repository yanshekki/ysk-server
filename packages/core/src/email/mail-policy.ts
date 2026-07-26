/**
 * Apply domain rate-limit + antispam flags to managed Postfix/Rspamd configs.
 * When applySystem: write real include snippets under /etc and reload.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { applySenderRatePolicyService, writeSenderRatePolicyDaemon } from './sender-rate-policy.js';

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

  // Per-sender policy daemon files (always written)
  const senderPol = writeSenderRatePolicyDaemon(input.dataDir);
  written.push(...senderPol.written);
  notes.push(...senderPol.notes);

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

  // Derive global anvil rate (msgs/hour): min positive rate across domains, default 500
  const globalRate = computeGlobalMessageRatePerHour(input.dataDir);
  writeFileSync(
    join(input.dataDir, 'email', 'policy', 'ysk-anvil.env'),
    `YSK_MSG_RATE_PER_HOUR=${globalRate}\n`,
    'utf8',
  );
  written.push(join(input.dataDir, 'email', 'policy', 'ysk-anvil.env'));

  // Rspamd ratelimit module (domain buckets from ysk-rate-values)
  const rlConf = writeRspamdRatelimitConf(input.dataDir, globalRate);
  written.push(...rlConf.written);
  notes.push(...rlConf.notes);

  // Copy aggregated files + apply postfix anvil rate + rspamd
  const copyScript = [
    `mkdir -p ${JSON.stringify(sysPolicy)} ${JSON.stringify(sysPostfix)} ${JSON.stringify(sysRspamd)}`,
    `cp -a ${JSON.stringify(join(input.dataDir, 'email', 'policy'))}/. ${JSON.stringify(sysPolicy)}/`,
    `cp -f ${JSON.stringify(join(input.dataDir, 'email', 'policy', 'ysk-rate.map'))} ${JSON.stringify(join(sysPostfix, 'ysk-rate.map'))} 2>/dev/null || true`,
    `cp -f ${JSON.stringify(join(input.dataDir, 'email', 'policy', 'ysk-antispam.map'))} ${JSON.stringify(join(sysPolicy, 'ysk-antispam.map'))} 2>/dev/null || true`,
    `cp -f ${JSON.stringify(join(input.dataDir, 'email', 'policy', 'ysk-multimap.conf'))} ${JSON.stringify(join(sysRspamd, 'ysk_multimap.conf'))} 2>/dev/null || true`,
    `cp -f ${JSON.stringify(join(input.dataDir, 'email', 'policy', 'ysk-ratelimit.conf'))} ${JSON.stringify(join(sysRspamd, 'ratelimit.conf'))} 2>/dev/null || true`,
    `if command -v postmap >/dev/null; then postmap hash:${sysPostfix}/ysk-rate.map 2>/dev/null || postmap ${sysPostfix}/ysk-rate.map 2>/dev/null || true; fi`,
    // Sender access map (domain allowlist style)
    `grep -q 'ysk-server/ysk-rate' /etc/postfix/main.cf 2>/dev/null || postconf -e "smtpd_sender_restrictions=\$smtpd_sender_restrictions, check_sender_access hash:${sysPostfix}/ysk-rate.map" 2>/dev/null || true`,
    // Real outbound throttle via anvil (messages per hour window)
    `postconf -e anvil_rate_time_unit=3600s 2>/dev/null || true`,
    `postconf -e smtpd_client_message_rate_limit=${globalRate} 2>/dev/null || true`,
    `postconf -e smtpd_client_recipient_rate_limit=$((${globalRate} * 5)) 2>/dev/null || true`,
    `postconf -e smtpd_client_connection_rate_limit=$((${globalRate} / 10 + 20)) 2>/dev/null || true`,
  ].join(' && ');

  const cp = await input.host.runCommand(['bash', '-c', copyScript], { timeoutMs: 30_000 });
  notes.push(
    cp.exitCode === 0
      ? `已複製政策 + anvil 限速 ≈ ${globalRate} msgs/hour`
      : `系統套用部分失敗: ${(cp.stderr || cp.stdout).slice(0, 250)}`,
  );
  notes.push(
    `Postfix anvil: smtpd_client_message_rate_limit=${globalRate} / 3600s（全域；取各域名 rate 最小值）`,
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

  const check = await input.host.runCommand(
    [
      'bash',
      '-c',
      'postconf smtpd_client_message_rate_limit anvil_rate_time_unit smtpd_sender_restrictions 2>/dev/null | head -5 || true',
    ],
    { timeoutMs: 5_000 },
  );
  if (check.stdout.includes('message_rate_limit')) {
    notes.push(`postconf 確認: ${check.stdout.trim().replace(/\n/g, ' | ').slice(0, 200)}`);
  }

  // Per-sender check_policy_service
  const senderApply = await applySenderRatePolicyService({
    dataDir: input.dataDir,
    host: input.host,
  });
  written.push(...senderApply.written);
  notes.push(...senderApply.notes);

  const applied =
    (cp.exitCode === 0 && reloadsOk > 0) || senderApply.apply_status === 'applied';
  notes.push(
    applied
      ? '狀態：applied（anvil + per-sender policy + maps）'
      : '狀態：written/partial（系統複製或 reload 未完全成功）',
  );
  return {
    ok: applied || cp.exitCode === 0,
    notes,
    written,
    apply_status: applied ? 'applied' : 'written',
  };
}

/** Min positive per-domain rate; default 500 msgs/hour */
export function computeGlobalMessageRatePerHour(dataDir: string): number {
  const root = join(dataDir, 'email', 'policy');
  let min = Infinity;
  try {
    for (const name of readdirSync(root)) {
      const f = join(root, name, 'rate.cf');
      if (!existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const n = Number(t.split(/\s+/)[1]);
        if (Number.isFinite(n) && n > 0 && n < min) min = n;
      }
    }
  } catch {
    /* empty */
  }
  if (!Number.isFinite(min) || min === Infinity) return 500;
  return Math.max(10, Math.min(Math.floor(min), 50_000));
}

function writeRspamdRatelimitConf(
  dataDir: string,
  globalRate: number,
): { written: string[]; notes: string[] } {
  const path = join(dataDir, 'email', 'policy', 'ysk-ratelimit.conf');
  // Rspamd ratelimit: per-IP and soft per-domain buckets (msgs per hour → burst-ish)
  const perMin = Math.max(1, Math.ceil(globalRate / 60));
  writeFileSync(
    path,
    `# Generated by YSK Server — copied to /etc/rspamd/local.d/ratelimit.conf on apply
# ~${globalRate} msgs/hour ≈ ${perMin}/min soft bucket

rates {
  # per authenticated user / IP
  to = {
    bucket = [
      { burst = ${perMin * 2}; rate = "${perMin} / 1m"; },
      { burst = ${Math.min(globalRate, 200)}; rate = "${globalRate} / 1h"; },
    ];
  }
  # bounce protection
  bounce_to = {
    bucket = [
      { burst = 2; rate = "2 / 1h"; },
    ];
  }
}
`,
    'utf8',
  );
  return {
    written: [path],
    notes: [`已寫 rspamd ratelimit.conf（~${globalRate}/h）`],
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
