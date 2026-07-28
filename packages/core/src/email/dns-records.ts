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
    throw new YskError(ErrorCodes.VALIDATION, '請指定伺服器 IP', { httpStatus: 400 });
  }
  if (!input.dkimPublicKey) {
    throw new YskError(ErrorCodes.VALIDATION, '請提供 DKIM 公鑰', { httpStatus: 400 });
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
      description: '郵件主機 A 記錄',
    },
    {
      type: 'MX',
      name: '@',
      value: mailHost,
      priority: 10,
      importance: 'required',
      description: 'MX 指向郵件主機名',
    },
    {
      type: 'TXT',
      name: '@',
      value: spf,
      importance: 'required',
      description: 'SPF 政策',
    },
    {
      type: 'TXT',
      name: `${selector}._domainkey`,
      value: dkim,
      importance: 'required',
      description: 'DKIM 公鑰',
    },
    {
      type: 'TXT',
      name: '_dmarc',
      value: dmarc,
      importance: 'recommended',
      description: 'DMARC 政策',
    },
  ];
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
        title: '新增 A／AAAA（apex 與 www）',
        description: `將 ${input.domain} 與 www.${input.domain} 指到伺服器公開 IP。CDN（Cloudflare）可灰雲或橙雲。`,
        required: true,
        completed: Boolean(input.dnsApplied),
      },
      {
        id: 'dns-ssl-http01',
        category: 'dns',
        title: '確認 80／443 可從公網到達（LE HTTP-01）',
        description: 'Let’s Encrypt HTTP-01 需要 80 可達；DNS-01 則需 API token。',
        required: true,
        completed: false,
      },
    );
  }

  if (scope === 'mail' || scope === 'full') {
    todos.push(
      {
        id: 'dns-mx-spf-dkim',
        category: 'dns',
        title: '新增 MX／SPF／DKIM DNS 記錄',
        description:
          '於 DNS 供應商新增產生的 MX、SPF（TXT）與 DKIM（TXT）。Cloudflare：郵件相關記錄請用僅 DNS（灰雲）。',
        required: true,
        completed: Boolean(input.dnsApplied),
      },
      {
        id: 'dns-dmarc',
        category: 'dns',
        title: '新增 DMARC TXT 記錄',
        description: '新增 _dmarc TXT 以改善投遞與回報。',
        required: false,
        completed: Boolean(input.dmarcPresent),
      },
      {
        id: 'ptr',
        category: 'ptr',
        title: '設定反向 DNS（PTR）',
        description: `PTR 須由 VPS／雲端 IP 擁有者設定，並與 HELO/EHLO（${input.mailHostname}）一致。請於供應商控制台申請（AWS/GCP 常需工單）。`,
        required: true,
        completed: Boolean(input.ptrOk),
      },
      {
        id: 'port25',
        category: 'port25',
        title: '確認出站 Port 25 已開放',
        description:
          '許多雲供應商封鎖出站 TCP 25。請申請解鎖，或改用外部 SMTP 中繼。',
        required: true,
        completed: input.port25Open === true,
      },
      {
        id: 'reputation',
        category: 'reputation',
        title: '監控 IP／域名聲譽並暖機',
        description:
          '新 IP／域名不宜立刻高量出站。請檢查 Spamhaus 等黑名單，並遵循暖機指引。',
        required: false,
        completed: false,
      },
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
    throw new YskError(ErrorCodes.VALIDATION, '測試寄信需要寄件者與收件者', {
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
    throw new YskError(ErrorCodes.VALIDATION, `域名無效：${domain}`, { httpStatus: 400 });
  }
}
