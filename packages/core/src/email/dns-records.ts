/**
 * Professional Email Server — DNS record generation + external checklist + health scoring.
 */

import type { EmailDnsRecord, EmailExternalTodo, EmailHealthReport } from 'ysk-server-shared';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';

export interface EmailDomainInput {
  domain: string;
  serverIp: string;
  /** Optional public IPv6 for mail AAAA + SPF ip6: */
  serverIpv6?: string;
  mailHostname?: string;
  dkimPublicKey: string;
  dmarcPolicy?: 'none' | 'quarantine' | 'reject';
  dmarcRua?: string;
  selector?: string;
}

/**
 * Generate the full set of DNS records the user must add at their DNS provider.
 */
export function generateEmailDnsRecords(input: EmailDomainInput): EmailDnsRecord[] {
  assertDomain(input.domain);
  if (!input.serverIp) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needServerIp'), { httpStatus: 400 });
  }
  if (!input.dkimPublicKey) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1413'), { httpStatus: 400 });
  }
  const mailHost = input.mailHostname ?? `mail.${input.domain}`;
  const selector = input.selector ?? 'default';
  const dmarcPolicy = input.dmarcPolicy ?? 'none';
  const rua = input.dmarcRua ?? `mailto:dmarc@${input.domain}`;
  const v6 = input.serverIpv6?.trim();
  const spf = v6
    ? `v=spf1 mx a ip4:${input.serverIp} ip6:${v6} ~all`
    : `v=spf1 mx a ip4:${input.serverIp} ~all`;
  const dkim = `v=DKIM1; k=rsa; p=${input.dkimPublicKey.replace(/\s+/g, '')}`;
  const dmarc = `v=DMARC1; p=${dmarcPolicy}; rua=${rua}; fo=1`;

  const records: EmailDnsRecord[] = [
    {
      type: 'A',
      name: mailHost.replace(`.${input.domain}`, '') === mailHost ? mailHost : 'mail',
      value: input.serverIp,
      importance: 'required',
      description: tl('notes.auto.n1505') },
    {
      type: 'MX',
      name: '@',
      value: mailHost,
      priority: 10,
      importance: 'required',
      description: tl('notes.auto.n0131') },
    {
      type: 'TXT',
      name: '@',
      value: spf,
      importance: 'required',
      description: tl('notes.auto.n0183') },
    {
      type: 'TXT',
      name: `${selector}._domainkey`,
      value: dkim,
      importance: 'required',
      description: tl('notes.auto.n0096') },
    {
      type: 'TXT',
      name: '_dmarc',
      value: dmarc,
      importance: 'recommended',
      description: tl('notes.auto.n0097') },
  ];
  if (v6) {
    records.splice(1, 0, {
      type: 'AAAA',
      name: mailHost.replace(`.${input.domain}`, '') === mailHost ? mailHost : 'mail',
      value: v6,
      importance: 'recommended',
      description: tl('notes.auto.n1506') });
  }
  return records;
}

/**
 * Build external todo list (PTR, Port 25, DNS, reputation) — items user must handle outside server.
 * Shared by email domain health + optional DNS panel checklist (scope=web|mail|full).
 */
export function buildExternalTodos(input: {
  domain: string;
  mailHostname: string;
  ptrOk?: boolean;
  port25Open?: boolean | null;
  dnsApplied?: boolean;
  dmarcPresent?: boolean;
  /** mail (default) | web | full */
  scope?: 'mail' | 'web' | 'full';
}): EmailExternalTodo[] {
  const scope = input.scope ?? 'mail';
  const todos: EmailExternalTodo[] = [];

  if (scope === 'web' || scope === 'full') {
    todos.push(
      {
        id: 'dns-a-www',
        category: 'dns',
        title: tl('notes.auto.n0902'),
        description: tl('notes.auto.t0077', { v0: (input.domain), v1: (input.domain) }),
        required: true,
        completed: Boolean(input.dnsApplied) },
      {
        id: 'dns-ssl-http01',
        category: 'dns',
        title: tl('notes.auto.n1288'),
        description: tl('notes.auto.n0128'),
        required: true,
        completed: false },
    );
  }

  if (scope === 'mail' || scope === 'full') {
    todos.push(
      {
        id: 'dns-mx-spf-dkim',
        category: 'dns',
        title: tl('notes.auto.n0904'),
        description:
          tl('notes.auto.n0907'),
        required: true,
        completed: Boolean(input.dnsApplied) },
      {
        id: 'dns-dmarc',
        category: 'dns',
        title: tl('notes.auto.n0903'),
        description: tl('notes.auto.n0905'),
        required: false,
        completed: Boolean(input.dmarcPresent) },
      {
        id: 'ptr',
        category: 'ptr',
        title: tl('notes.auto.n1366'),
        description: tl('notes.auto.t0078', { v0: (input.mailHostname) }),
        required: true,
        completed: Boolean(input.ptrOk) },
      {
        id: 'port25',
        category: 'port25',
        title: tl('notes.auto.n1290'),
        description:
          tl('notes.auto.n1374'),
        required: true,
        completed: input.port25Open === true },
      {
        id: 'reputation',
        category: 'reputation',
        title: tl('notes.auto.n1265'),
        description:
          tl('notes.auto.n0901'),
        required: false,
        completed: false },
    );
  }

  return todos;
}

/**
 * Compute email setup health score (0-100) from checks.
 */
export function scoreEmailHealth(input: {
  domain: string;
  serverIp: string;
  serverIpv6?: string;
  dkimPublicKey: string;
  mailHostname?: string;
  ptrOk?: boolean;
  port25Open?: boolean | null;
  dnsApplied?: boolean;
  dmarcPresent?: boolean;
  dmarcPolicy?: 'none' | 'quarantine' | 'reject';
}): EmailHealthReport {
  const mailHostname = input.mailHostname ?? `mail.${input.domain}`;
  const records = generateEmailDnsRecords({
    domain: input.domain,
    serverIp: input.serverIp,
    serverIpv6: input.serverIpv6,
    mailHostname,
    dkimPublicKey: input.dkimPublicKey,
    dmarcPolicy: input.dmarcPolicy });
  const externalTodos = buildExternalTodos({
    domain: input.domain,
    mailHostname,
    ptrOk: input.ptrOk,
    port25Open: input.port25Open,
    dnsApplied: input.dnsApplied,
    dmarcPresent: input.dmarcPresent });

  let score = 0;
  const maxScore = 100;
  const messages: string[] = [];

  // DNS base 40
  if (input.dnsApplied) {
    score += 40;
  } else {
    messages.push(tl('email.health.dnsUnconfirmed'));
  }
  // DMARC 15
  if (input.dmarcPresent) {
    score += 15;
  } else {
    messages.push(tl('email.health.dmarcUnpublished'));
  }
  // PTR 25
  if (input.ptrOk) {
    score += 25;
  } else {
    messages.push(tl('email.health.ptrBad'));
  }
  // Port 25 15
  if (input.port25Open === true) {
    score += 15;
  } else if (input.port25Open === false) {
    messages.push(tl('email.health.port25Blocked'));
  } else {
    messages.push(tl('email.health.port25Unknown'));
    score += 5;
  }
  // Warm-up awareness 5 (always partial credit for showing checklist)
  score += 5;

  return {
    score: Math.min(score, maxScore),
    maxScore,
    records,
    externalTodos,
    ptrOk: Boolean(input.ptrOk),
    port25Open: input.port25Open ?? null,
    messages };
}

/**
 * Plan local Postfix/Dovecot/OpenDKIM install commands (not executed in unit tests).
 */
export function planEmailStackInstall(domain: string): {
  packages: string[];
  commands: string[];
  ports: number[];
  notes: string[];
} {
  assertDomain(domain);
  return {
    packages: ['postfix', 'dovecot-core', 'dovecot-imapd', 'opendkim', 'opendkim-tools', 'rspamd'],
    commands: [
      'DEBIAN_FRONTEND=noninteractive apt-get install -y postfix dovecot-core dovecot-imapd opendkim opendkim-tools rspamd',
      `postconf -e "myhostname = mail.${domain}"`,
      `postconf -e "myorigin = ${domain}"`,
      'postconf -e "smtpd_tls_security_level = may"',
      `postconf -e "virtual_mailbox_domains = ${domain}"`,
      'postconf -e "mydestination = localhost, localhost.localdomain"',
    ],
    ports: [25, 465, 587, 993, 995],
    notes: [tl('email.stack.tlsNote'), tl('email.stack.externalNote')] };
}

/**
 * Plan a test-send (does not actually send in unit tests / non-root envs).
 */
export function planTestSend(input: {
  from: string;
  to: string;
  subject?: string;
}): { command: string; notes: string[]; analysisHints: string[] } {
  if (!input.from || !input.to) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1054'), {
      httpStatus: 400 });
  }
  const subject = input.subject ?? tl('email.test.defaultSubject');
  return {
    command: `printf 'Subject: ${subject}\\n\\nYSK Server deliverability test\\n' | sendmail -f ${input.from} ${input.to}`,
    notes: [tl('email.test.needMta'), tl('email.test.checkSpam')],
    analysisHints: [
      tl('email.test.hintDeferred'),
      tl('email.test.hintSpam'),
      tl('email.test.hintLogs'),
    ] };
}

function assertDomain(domain: string): void {
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.tpl.domainInvalid', { domain: domain }), { httpStatus: 400 });
  }
}
