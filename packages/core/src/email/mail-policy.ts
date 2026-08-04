import { tl } from '@ysk/shared';
/**
 * Apply domain rate-limit + antispam flags to managed Postfix/Rspamd configs.
 * When applySystem: write real include snippets under /etc and reload.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { applySenderRatePolicyService, writeSenderRatePolicyDaemon } from './sender-rate-policy.js';
import { shellBinExists } from '../hosting/software-probe/index.js';

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
    notes.push(tl('notes.auto.n1229'));
    return { ok: true, notes, written, apply_status: 'written' };
  }

  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return {
      ok: false,
      notes: [...notes, tl('notes.auto.n0005')],
      written,
      blocked: true,
      blockMessage: tl('notes.auto.n0006'),
      apply_status: 'blocked' };
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

  // Stepwise system apply — no || true masking on mutate steps
  const rateMap = join(input.dataDir, 'email', 'policy', 'ysk-rate.map');
  const spamMap = join(input.dataDir, 'email', 'policy', 'ysk-antispam.map');
  const multiMap = join(input.dataDir, 'email', 'policy', 'ysk-multimap.conf');
  const rlMap = join(input.dataDir, 'email', 'policy', 'ysk-ratelimit.conf');

  let hardFail = false;

  const run = async (name: string, argv: string[], hard = false) => {
    const r = await input.host.runCommand(argv, { timeoutMs: 30_000 });
    if (r.exitCode !== 0) {
      notes.push(tl('notes.tpl.actionFailed', { action: name, detail: (r.stderr || r.stdout).slice(0, 200) }));
      if (hard) hardFail = true;
    } else {
      notes.push(`${name} ok`);
    }
    return r;
  };

  await run(
    'mkdir policy dirs',
    [
      'bash',
      '-c',
      `mkdir -p ${JSON.stringify(sysPolicy)} ${JSON.stringify(sysPostfix)} ${JSON.stringify(sysRspamd)}`,
    ],
    true,
  );
  await run(
    'cp policy tree',
    [
      'bash',
      '-c',
      `cp -a ${JSON.stringify(join(input.dataDir, 'email', 'policy'))}/. ${JSON.stringify(sysPolicy)}/`,
    ],
    true,
  );

  if (existsSync(rateMap)) {
    await run('cp ysk-rate.map', ['cp', '-f', rateMap, join(sysPostfix, 'ysk-rate.map')], true);
    await run(
      'postmap ysk-rate',
      [
        'bash',
        '-c',
        `if ${shellBinExists('postmap')}; then postmap hash:${sysPostfix}/ysk-rate.map || postmap ${sysPostfix}/ysk-rate.map; fi`,
      ],
      false,
    );
  }
  if (existsSync(spamMap)) {
    await run('cp antispam map', ['cp', '-f', spamMap, join(sysPolicy, 'ysk-antispam.map')], false);
  }
  if (existsSync(multiMap)) {
    await run(
      'cp rspamd multimap',
      ['cp', '-f', multiMap, join(sysRspamd, 'ysk_multimap.conf')],
      false,
    );
  }
  if (existsSync(rlMap)) {
    await run(
      'cp rspamd ratelimit',
      ['cp', '-f', rlMap, join(sysRspamd, 'ratelimit.conf')],
      false,
    );
  }

  await run(
    'postconf sender_access',
    [
      'bash',
      '-c',
      `grep -q 'ysk-server/ysk-rate' /etc/postfix/main.cf 2>/dev/null || postconf -e "smtpd_sender_restrictions=\$smtpd_sender_restrictions, check_sender_access hash:${sysPostfix}/ysk-rate.map"`,
    ],
    false,
  );
  await run('postconf anvil_rate_time_unit', ['postconf', '-e', 'anvil_rate_time_unit=3600s'], true);
  await run(
    'postconf message_rate_limit',
    ['postconf', '-e', `smtpd_client_message_rate_limit=${globalRate}`],
    true,
  );
  await run(
    'postconf recipient_rate',
    ['postconf', '-e', `smtpd_client_recipient_rate_limit=${globalRate * 5}`],
    false,
  );
  await run(
    'postconf connection_rate',
    [
      'postconf',
      '-e',
      `smtpd_client_connection_rate_limit=${Math.floor(globalRate / 10) + 20}`,
    ],
    false,
  );

  notes.push(
    tl('notes.auto.t0094', { v0: (globalRate) }),
  );

  let reloadsOk = 0;
  for (const unit of ['postfix', 'rspamd']) {
    const r = await input.host.runCommand(['systemctl', 'reload', unit], { timeoutMs: 10_000 });
    if (r.exitCode === 0) {
      reloadsOk++;
      notes.push(`${unit} reloaded`);
    } else {
      notes.push(`${unit} reload failed: ${(r.stderr || r.stdout).slice(0, 80)}`);
      if (unit === 'postfix') hardFail = true;
    }
  }

  const check = await input.host.runCommand(
    [
      'bash',
      '-c',
      'postconf smtpd_client_message_rate_limit anvil_rate_time_unit smtpd_sender_restrictions 2>/dev/null | head -5',
    ],
    { timeoutMs: 5_000 },
  );
  const verified = check.stdout.includes('message_rate_limit');
  if (verified) {
    notes.push(tl('notes.auto.t0095', { v0: (check.stdout.trim().replace(/\n/g, ' | ').slice(0, 200)) }));
  } else {
    notes.push(tl('notes.auto.n0383'));
    hardFail = true;
  }

  // Per-sender check_policy_service
  const senderApply = await applySenderRatePolicyService({
    dataDir: input.dataDir,
    host: input.host });
  written.push(...senderApply.written);
  notes.push(...senderApply.notes);
  if (senderApply.blocked || !senderApply.ok) hardFail = true;

  const applied =
    !hardFail && reloadsOk > 0 && verified && senderApply.apply_status === 'applied';
  notes.push(
    applied
      ? tl('notes.auto.n1208')
      : tl('notes.auto.n1223'),
  );
  return {
    ok: applied,
    notes,
    written,
    apply_status: applied ? 'applied' : 'written' };
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
    notes: [tl('notes.auto.t0096', { v0: (globalRate) })] };
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
    notes: [tl('notes.auto.t0097', { v0: (domains) })] };
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
    notes: [tl('notes.auto.n0761')] };
}
