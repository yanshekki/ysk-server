/**
 * Live email deliverability checks (DNS / PTR / Port 25 / DNSBL).
 */

import { resolveMx, resolveTxt, reverse } from 'node:dns/promises';
import { createConnection } from 'node:net';
import type { EmailHealthReport } from '@ysk/shared';
import { scoreEmailHealth } from './dns-records.js';

export interface LiveCheckResult {
  mx: { ok: boolean; detail: string };
  spf: { ok: boolean; detail: string };
  dkim: { ok: boolean; detail: string };
  dmarc: { ok: boolean; detail: string };
  ptr: { ok: boolean; detail: string };
  port25: { ok: boolean | null; detail: string };
  dnsbl: { ok: boolean; detail: string };
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
    mxDetail = mx.map((m) => `${m.priority} ${m.exchange}`).join(', ') || 'no MX';
  } catch (e) {
    mxDetail = e instanceof Error ? e.message : 'MX lookup failed';
  }

  let spfOk = false;
  let spfDetail = '';
  try {
    const txts = await resolveTxt(input.domain);
    const flat = txts.map((t) => t.join(''));
    const spf = flat.find((t) => t.startsWith('v=spf1'));
    spfOk = Boolean(spf);
    spfDetail = spf ?? 'no SPF TXT';
  } catch (e) {
    spfDetail = e instanceof Error ? e.message : 'SPF lookup failed';
  }

  let dkimOk = false;
  let dkimDetail = '';
  try {
    const name = `${selector}._domainkey.${input.domain}`;
    const txts = await resolveTxt(name);
    const flat = txts.map((t) => t.join(''));
    const dkim = flat.find((t) => /v=DKIM1/i.test(t));
    dkimOk = Boolean(dkim);
    dkimDetail = dkim ? dkim.slice(0, 80) + '…' : 'no DKIM TXT';
  } catch (e) {
    dkimDetail = e instanceof Error ? e.message : 'DKIM lookup failed';
  }

  let dmarcOk = false;
  let dmarcDetail = '';
  try {
    const txts = await resolveTxt(`_dmarc.${input.domain}`);
    const flat = txts.map((t) => t.join(''));
    const dmarc = flat.find((t) => /v=DMARC1/i.test(t));
    dmarcOk = Boolean(dmarc);
    dmarcDetail = dmarc ?? 'no DMARC';
  } catch (e) {
    dmarcDetail = e instanceof Error ? e.message : 'DMARC lookup failed';
  }

  let ptrOk = false;
  let ptrDetail = '';
  try {
    const names = await reverse(input.serverIp);
    ptrDetail = names.join(', ') || 'no PTR';
    ptrOk = names.some(
      (n) =>
        n.replace(/\.$/, '').toLowerCase() === input.mailHostname.toLowerCase() ||
        n.toLowerCase().includes(input.domain.toLowerCase()),
    );
  } catch (e) {
    ptrDetail = e instanceof Error ? e.message : 'PTR lookup failed';
  }

  // Port 25: try connecting to a public SMTP (gmail) — may be blocked by cloud
  const port25Open = await probeTcp('gmail-smtp-in.l.google.com', 25, 4000);
  const port25Detail = port25Open
    ? 'Outbound TCP 25 appears open (probe to gmail-smtp-in.l.google.com)'
    : 'Outbound TCP 25 probe failed — may be blocked; request unblock or use relay';

  // Simple zen.spamhaus.org style DNSBL (ip reversed)
  let dnsblOk = true;
  let dnsblDetail = 'not listed (zen.spamhaus.org query)';
  try {
    const rev = input.serverIp.split('.').reverse().join('.');
    const { resolve4 } = await import('node:dns/promises');
    try {
      await resolve4(`${rev}.zen.spamhaus.org`);
      dnsblOk = false;
      dnsblDetail = 'LISTED on zen.spamhaus.org (or query returned A)';
    } catch {
      dnsblOk = true;
      dnsblDetail = 'No A record from zen.spamhaus.org (likely not listed)';
    }
  } catch {
    dnsblDetail = 'DNSBL check skipped';
  }

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

  return {
    mx: { ok: mxOk, detail: mxDetail },
    spf: { ok: spfOk, detail: spfDetail },
    dkim: { ok: dkimOk, detail: dkimDetail },
    dmarc: { ok: dmarcOk, detail: dmarcDetail },
    ptr: { ok: ptrOk, detail: ptrDetail },
    port25: { ok: port25Open, detail: port25Detail },
    dnsbl: { ok: dnsblOk, detail: dnsblDetail },
    health,
  };
}
