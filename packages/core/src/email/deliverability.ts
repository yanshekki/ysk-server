/**
 * Deliverability ops pack — unified checklist for operators.
 * Never claims global inbox delivery; PTR / Port 25 / reputation stay external.
 */

import { tl, type EmailExternalTodo } from '@yanshekki/shared';
import { buildExternalTodos } from './dns-records.js';
import { runLiveEmailChecks, type LiveCheckResult } from './live-checks.js';
import { planEmailWarmup, type WarmupPlan } from './warmup.js';
import { loadSmtpRelaySettings } from './relay.js';

export type DeliverabilityCheckId =
  | 'mx'
  | 'spf'
  | 'dkim'
  | 'dmarc'
  | 'ptr'
  | 'port25'
  | 'dnsbl'
  | 'relay'
  | 'warmup';

export type DeliverabilityItem = {
  id: DeliverabilityCheckId | string;
  title: string;
  ok: boolean | null;
  /** ready | warn | blocked | external | unknown */
  level: 'ready' | 'warn' | 'blocked' | 'external' | 'unknown';
  detail: string;
  /** Operator action — never auto-fixed by panel when external */
  owner: 'panel' | 'dns_provider' | 'vps_provider' | 'operator';
  fixHint?: string;
};

export type DeliverabilityReport = {
  at: string;
  domain: string;
  serverIp: string;
  mailHostname: string;
  /** 0–100 composite from live health; DNSBL may reduce score */
  score: number;
  /** Explicit honesty banner keys / strings */
  honesty: string[];
  items: DeliverabilityItem[];
  externalTodos: EmailExternalTodo[];
  warmup: WarmupPlan;
  live: LiveCheckResult;
  relayConfigured: boolean;
  /** true only when all panel-checkable items are ready AND no hard blocks */
  panelReady: boolean;
  /** Never true for "guaranteed worldwide delivery" */
  deliveryGuaranteed: false;
};

function itemFromLive(
  id: DeliverabilityCheckId,
  title: string,
  check: { ok: boolean | null; detail: string },
  owner: DeliverabilityItem['owner'],
  fixHint?: string,
): DeliverabilityItem {
  const ok = check.ok;
  let level: DeliverabilityItem['level'] = 'unknown';
  if (ok === true) level = 'ready';
  else if (ok === false) level = owner === 'vps_provider' || owner === 'dns_provider' ? 'external' : 'blocked';
  else level = 'warn';
  return {
    id,
    title,
    ok,
    level,
    detail: check.detail,
    owner,
    fixHint,
  };
}

/**
 * Full deliverability pack for one mail domain (live DNS/network + checklist).
 */
export async function buildDeliverabilityReport(input: {
  domain: string;
  serverIp: string;
  serverIpv6?: string;
  mailHostname?: string;
  dkimPublicKey: string;
  dkimSelector?: string;
  dataDir?: string;
  ptrOkStored?: boolean;
  port25Stored?: boolean;
  dnsApplied?: boolean;
  dmarcPresent?: boolean;
}): Promise<DeliverabilityReport> {
  const domain = input.domain.trim().toLowerCase();
  const mailHostname = (input.mailHostname ?? `mail.${domain}`).trim().toLowerCase();
  const serverIp = input.serverIp.trim();

  const live = await runLiveEmailChecks({
    domain,
    serverIp,
    mailHostname,
    dkimPublicKey: input.dkimPublicKey,
    dkimSelector: input.dkimSelector,
  });

  const externalTodos = buildExternalTodos({
    domain,
    mailHostname,
    ptrOk: live.ptr.ok,
    port25Open: live.port25.ok === true,
    dnsApplied: live.mx.ok && live.spf.ok && live.dkim.ok,
    dmarcPresent: live.dmarc.ok,
  });

  let relayConfigured = false;
  if (input.dataDir) {
    try {
      const r = loadSmtpRelaySettings(input.dataDir);
      relayConfigured = Boolean(r?.host);
    } catch {
      relayConfigured = false;
    }
  }

  const warmup = planEmailWarmup({
    domain,
    serverIp,
    isNewIp: !live.ptr.ok || live.port25.ok === false,
  });

  const items: DeliverabilityItem[] = [
    itemFromLive('mx', tl('email.deliv.mx'), live.mx, 'dns_provider', tl('email.deliv.mxFix')),
    itemFromLive('spf', tl('email.deliv.spf'), live.spf, 'dns_provider', tl('email.deliv.spfFix')),
    itemFromLive('dkim', tl('email.deliv.dkim'), live.dkim, 'dns_provider', tl('email.deliv.dkimFix')),
    itemFromLive('dmarc', tl('email.deliv.dmarc'), live.dmarc, 'dns_provider', tl('email.deliv.dmarcFix')),
    itemFromLive(
      'ptr',
      tl('email.deliv.ptr'),
      live.ptr,
      'vps_provider',
      tl('email.deliv.ptrFix'),
    ),
    itemFromLive(
      'port25',
      tl('email.deliv.port25'),
      live.port25,
      'vps_provider',
      live.port25.ok ? undefined : tl('email.deliv.port25Fix'),
    ),
    itemFromLive(
      'dnsbl',
      tl('email.deliv.dnsbl'),
      live.dnsbl,
      'operator',
      live.dnsbl.ok ? undefined : tl('email.deliv.dnsblFix'),
    ),
    {
      id: 'relay',
      title: tl('email.deliv.relay'),
      ok: live.port25.ok === true ? true : relayConfigured,
      level:
        live.port25.ok === true
          ? 'ready'
          : relayConfigured
            ? 'ready'
            : 'warn',
      detail:
        live.port25.ok === true
          ? tl('email.deliv.relayOptional')
          : relayConfigured
            ? tl('email.deliv.relayPresent')
            : tl('email.deliv.relayMissing'),
      owner: 'operator',
      fixHint: tl('email.deliv.relayFix'),
    },
    {
      id: 'warmup',
      title: tl('email.deliv.warmup'),
      ok: true,
      level: 'ready',
      detail: tl('email.deliv.warmupDetail', {
        phases: warmup.phases.length,
        day1: warmup.phases[0]?.maxMessagesPerDay ?? '—',
      }),
      owner: 'operator',
      fixHint: tl('email.deliv.warmupFix'),
    },
  ];

  const honesty = [
    tl('email.deliv.honesty1'),
    tl('email.deliv.honesty2'),
    tl('email.deliv.honesty3'),
    live.port25.ok === false
      ? tl('email.deliv.honestyPortBlocked')
      : tl('email.deliv.honestyPortOk'),
  ];

  const hardBlocks = items.filter(
    (i) =>
      i.ok === false &&
      (i.id === 'mx' || i.id === 'spf' || i.id === 'dkim' || i.id === 'dnsbl'),
  );
  const panelReady =
    hardBlocks.length === 0 &&
    live.mx.ok &&
    live.spf.ok &&
    live.dkim.ok &&
    live.dnsbl.ok;

  return {
    at: new Date().toISOString(),
    domain,
    serverIp,
    mailHostname,
    score: live.health.score,
    honesty,
    items,
    externalTodos,
    warmup,
    live,
    relayConfigured,
    panelReady,
    deliveryGuaranteed: false,
  };
}
