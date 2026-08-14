/**
 * Live email deliverability checks (DNS / PTR / Port 25 / DNSBL).
 */

import { resolveMx, resolveTxt, reverse } from 'node:dns/promises';
import { createConnection } from 'node:net';
import { tl, type EmailHealthReport } from 'ysk-server-shared';
import { scoreEmailHealth } from './dns-records.js';
import { checkIpDnsbl, type DnsblReport } from './dnsbl.js';

function dnsLookupDetail(e: unknown, unpublished: string): string {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
  if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ETIMEOUT') return unpublished;
  const msg = e instanceof Error ? e.message : '';
  if (/ENODATA|ENOTFOUND|queryMx|queryTxt/i.test(msg)) return unpublished;
  return msg || unpublished;
}

export interface LiveCheckResult {
  mx: { ok: boolean; detail: string };
  spf: { ok: boolean; detail: string };
  dkim: { ok: boolean; detail: string };
  dmarc: { ok: boolean; detail: string };
  ptr: { ok: boolean; detail: string };
  port25: { ok: boolean | null; detail: string };
  dnsbl: { ok: boolean; detail: string; report?: DnsblReport };
  health: EmailHealthReport;
}

/**
 * Probe outbound TCP connectivity to host:port with timeout.
 */
export function probeTcp(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/**
 * Run live DNS + network checks for an email domain.
 */
export async function runLiveEmailChecks(input: {
  domain: string;
  serverIp: string;
  mailHostname: string;
  dkimPublicKey: string;
  dkimSelector?: string;
}): Promise<LiveCheckResult> {
  const selector = input.dkimSelector ?? 'default';

  let mxOk = false;
  let mxDetail = '';
  try {
    const mx = await resolveMx(input.domain);
    mxOk = mx.length > 0;
    mxDetail = mx.map((m) => `${m.priority} ${m.exchange}`).join(', ') || tl('email.live.noMx');
  } catch (e) {
    mxDetail = dnsLookupDetail(e, tl('email.live.noMx'));
  }

  let spfOk = false;
  let spfDetail = '';
  try {
    const txts = await resolveTxt(input.domain);
    const flat = txts.map((t) => t.join(''));
    const spf = flat.find((t) => t.startsWith('v=spf1'));
    spfOk = Boolean(spf);
    spfDetail = spf ?? tl('email.live.noSpf');
  } catch (e) {
    spfDetail = dnsLookupDetail(e, tl('email.live.noSpf'));
  }

  let dkimOk = false;
  let dkimDetail = '';
  try {
    const name = `${selector}._domainkey.${input.domain}`;
    const txts = await resolveTxt(name);
    const flat = txts.map((t) => t.join(''));
    const dkim = flat.find((t) => /v=DKIM1/i.test(t));
    dkimOk = Boolean(dkim);
    dkimDetail = dkim ? dkim.slice(0, 80) + '…' : tl('email.live.noDkim');
  } catch (e) {
    dkimDetail = dnsLookupDetail(e, tl('email.live.noDkim'));
  }

  let dmarcOk = false;
  let dmarcDetail = '';
  try {
    const txts = await resolveTxt(`_dmarc.${input.domain}`);
    const flat = txts.map((t) => t.join(''));
    const dmarc = flat.find((t) => /v=DMARC1/i.test(t));
    dmarcOk = Boolean(dmarc);
    dmarcDetail = dmarc ?? tl('email.live.noDmarc');
  } catch (e) {
    dmarcDetail = dnsLookupDetail(e, tl('email.live.noDmarc'));
  }

  let ptrOk = false;
  let ptrDetail = '';
  try {
    const names = await reverse(input.serverIp);
    ptrDetail = names.join(', ') || tl('email.live.noPtr');
    ptrOk = names.some(
      (n) =>
        n.replace(/\.$/, '').toLowerCase() === input.mailHostname.toLowerCase() ||
        n.toLowerCase().includes(input.domain.toLowerCase()),
    );
  } catch (e) {
    ptrDetail = e instanceof Error ? e.message : tl('email.live.ptrLookupFailed');
  }

  // Port 25: try connecting to a public SMTP (gmail) — may be blocked by cloud
  const port25Open = await probeTcp('gmail-smtp-in.l.google.com', 25, 4000);
  const port25Detail = port25Open
    ? tl('email.live.port25Open')
    : tl('email.live.port25Blocked');

  // Multi-list DNSBL (Spamhaus / SpamCop / Barracuda)
  const dnsblReport = await checkIpDnsbl(input.serverIp);
  const dnsblOk = dnsblReport.ok;
  const dnsblDetail =
    dnsblReport.listedOn.length > 0
      ? tl('email.live.dnsblListed', { list: dnsblReport.listedOn.join(', ') })
      : tl('email.live.dnsblClean', { list: dnsblReport.cleanOn.join(', ') });

  const health = scoreEmailHealth({
    domain: input.domain,
    serverIp: input.serverIp,
    dkimPublicKey: input.dkimPublicKey,
    mailHostname: input.mailHostname,
    ptrOk,
    port25Open,
    dnsApplied: mxOk && spfOk && dkimOk,
    dmarcPresent: dmarcOk,
  });
  if (!dnsblOk) {
    health.messages.push(`DNSBL: ${dnsblDetail}`);
    health.score = Math.max(0, health.score - 15);
  }

  return {
    mx: { ok: mxOk, detail: mxDetail },
    spf: { ok: spfOk, detail: spfDetail },
    dkim: { ok: dkimOk, detail: dkimDetail },
    dmarc: { ok: dmarcOk, detail: dmarcDetail },
    ptr: { ok: ptrOk, detail: ptrDetail },
    port25: { ok: port25Open, detail: port25Detail },
    dnsbl: { ok: dnsblOk, detail: dnsblDetail, report: dnsblReport },
    health,
  };
}
