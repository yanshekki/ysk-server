/**
 * Professional Email Server — DNS record generation + external checklist + health scoring.
 */

import type { EmailDnsRecord, EmailExternalTodo, EmailHealthReport } from '@ysk/shared';
import { ErrorCodes, YskError } from '@ysk/shared';

export interface EmailDomainInput {
  domain: string;
  serverIp: string;
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
    throw new YskError(ErrorCodes.VALIDATION, 'serverIp required', { httpStatus: 400 });
  }
  if (!input.dkimPublicKey) {
    throw new YskError(ErrorCodes.VALIDATION, 'dkimPublicKey required', { httpStatus: 400 });
  }
  const mailHost = input.mailHostname ?? `mail.${input.domain}`;
  const selector = input.selector ?? 'default';
  const dmarcPolicy = input.dmarcPolicy ?? 'none';
  const rua = input.dmarcRua ?? `mailto:dmarc@${input.domain}`;
  const spf = `v=spf1 mx a ip4:${input.serverIp} ~all`;
  const dkim = `v=DKIM1; k=rsa; p=${input.dkimPublicKey.replace(/\s+/g, '')}`;
  const dmarc = `v=DMARC1; p=${dmarcPolicy}; rua=${rua}; fo=1`;

  return [
    {
      type: 'A',
      name: mailHost.replace(`.${input.domain}`, '') === mailHost ? mailHost : 'mail',
      value: input.serverIp,
      importance: 'required',
      description: 'Mail server A record',
    },
    {
      type: 'MX',
      name: '@',
      value: mailHost,
      priority: 10,
      importance: 'required',
      description: 'MX points to mail hostname',
    },
    {
      type: 'TXT',
      name: '@',
      value: spf,
      importance: 'required',
      description: 'SPF policy',
    },
    {
      type: 'TXT',
      name: `${selector}._domainkey`,
      value: dkim,
      importance: 'required',
      description: 'DKIM public key',
    },
    {
      type: 'TXT',
      name: '_dmarc',
      value: dmarc,
      importance: 'recommended',
      description: 'DMARC policy',
    },
  ];
}

/**
 * Build external todo list (PTR, Port 25, DNS, reputation) — items user must handle outside server.
 */
export function buildExternalTodos(input: {
  domain: string;
  mailHostname: string;
  ptrOk?: boolean;
  port25Open?: boolean | null;
  dnsApplied?: boolean;
  dmarcPresent?: boolean;
}): EmailExternalTodo[] {
  const todos: EmailExternalTodo[] = [
    {
      id: 'dns-mx-spf-dkim',
      category: 'dns',
      title: 'Add MX / SPF / DKIM DNS records',
      description:
        'Add the generated MX, SPF (TXT), and DKIM (TXT) records at your DNS provider. Cloudflare: use DNS only (grey cloud) for mail-related records.',
      required: true,
      completed: Boolean(input.dnsApplied),
    },
    {
      id: 'dns-dmarc',
      category: 'dns',
      title: 'Add DMARC TXT record',
      description: 'Add _dmarc TXT to improve deliverability and reporting.',
      required: false,
      completed: Boolean(input.dmarcPresent),
    },
    {
      id: 'ptr',
      category: 'ptr',
      title: 'Set Reverse DNS (PTR)',
      description: `PTR must be set by your VPS/cloud IP owner to match HELO/EHLO (${input.mailHostname}). Request PTR in your provider console (AWS/GCP often need a ticket).`,
      required: true,
      completed: Boolean(input.ptrOk),
    },
    {
      id: 'port25',
      category: 'port25',
      title: 'Ensure outbound Port 25 is open',
      description:
        'Many cloud providers block outbound Port 25 (TCP 25). Request unblock or configure an external SMTP relay.',
      required: true,
      completed: input.port25Open === true,
    },
    {
      id: 'reputation',
      category: 'reputation',
      title: 'Monitor IP/domain reputation and warm-up',
      description:
        'New IPs/domains should not send high volume immediately. Check Spamhaus/Barracuda/MSRBL blacklists and follow warm-up guidance.',
      required: false,
      completed: false,
    },
  ];
  return todos;
}

/**
 * Compute email setup health score (0-100) from checks.
 */
export function scoreEmailHealth(input: {
  domain: string;
  serverIp: string;
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
    mailHostname,
    dkimPublicKey: input.dkimPublicKey,
    dmarcPolicy: input.dmarcPolicy,
  });
  const externalTodos = buildExternalTodos({
    domain: input.domain,
    mailHostname,
    ptrOk: input.ptrOk,
    port25Open: input.port25Open,
    dnsApplied: input.dnsApplied,
    dmarcPresent: input.dmarcPresent,
  });

  let score = 0;
  const maxScore = 100;
  const messages: string[] = [];

  // DNS base 40
  if (input.dnsApplied) {
    score += 40;
  } else {
    messages.push('DNS records (MX/SPF/DKIM) not yet confirmed');
  }
  // DMARC 15
  if (input.dmarcPresent) {
    score += 15;
  } else {
    messages.push('DMARC missing — strongly recommended');
  }
  // PTR 25
  if (input.ptrOk) {
    score += 25;
  } else {
    messages.push('PTR reverse DNS missing or incorrect — request at VPS provider');
  }
  // Port 25 15
  if (input.port25Open === true) {
    score += 15;
  } else if (input.port25Open === false) {
    messages.push('Outbound Port 25 appears blocked — request unblock or use SMTP relay');
  } else {
    messages.push('Port 25 status unknown — run connectivity check');
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
    messages,
  };
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
    ],
    ports: [25, 465, 587, 993, 995],
    notes: [
      'TLS certs via Let’s Encrypt for SMTP/IMAP',
      'External DNS/PTR/Port25 still required for deliverability',
    ],
  };
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
    throw new YskError(ErrorCodes.VALIDATION, 'from and to required for test send', {
      httpStatus: 400,
    });
  }
  const subject = input.subject ?? 'YSK Server mail test';
  return {
    command: `printf 'Subject: ${subject}\\n\\nYSK Server deliverability test\\n' | sendmail -f ${input.from} ${input.to}`,
    notes: [
      'Requires local MTA (Postfix) installed and Port 25/relay configured',
      'Check recipient spam folder and server mail logs after send',
    ],
    analysisHints: [
      'If deferred: check Port 25 block or relay credentials',
      'If accepted but spam: improve SPF/DKIM/DMARC/PTR and warm-up',
      'Inspect /var/log/mail.log or journalctl -u postfix',
    ],
  };
}

function assertDomain(domain: string): void {
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new YskError(ErrorCodes.VALIDATION, `Invalid domain: ${domain}`, { httpStatus: 400 });
  }
}
