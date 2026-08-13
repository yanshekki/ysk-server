/**
 * Generate Autodiscover / Autoconfig XML for mail clients.
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** DNS name safe to interpolate (public query param). */
export function isSafeAutoconfigDomain(raw: string): boolean {
  const d = String(raw ?? '').trim().toLowerCase();
  if (!d || d.length > 253) return false;
  if (d === 'localhost') return true;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d);
}

export function isSafeAutoconfigEmail(raw: string): boolean {
  const e = String(raw ?? '').trim();
  if (!e || e.length > 254 || /[<>&'"\\]/.test(e)) return false;
  const at = e.lastIndexOf('@');
  if (at < 1) return false;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (!/^[a-zA-Z0-9._%+-]+$/.test(local)) return false;
  return isSafeAutoconfigDomain(domain);
}

export function renderMozillaAutoconfig(opts: {
  domain: string;
  imapHost?: string;
  smtpHost?: string;
  imapPort?: number;
  smtpPort?: number;
}): string {
  const domain = isSafeAutoconfigDomain(opts.domain) ? opts.domain.trim().toLowerCase() : 'localhost';
  const imapRaw = opts.imapHost ?? `mail.${domain}`;
  const smtpRaw = opts.smtpHost ?? `mail.${domain}`;
  const imap = isSafeAutoconfigDomain(imapRaw) ? imapRaw.trim().toLowerCase() : `mail.${domain}`;
  const smtp = isSafeAutoconfigDomain(smtpRaw) ? smtpRaw.trim().toLowerCase() : `mail.${domain}`;
  const imapPort = Number.isInteger(opts.imapPort) && opts.imapPort! > 0 && opts.imapPort! <= 65535
    ? opts.imapPort!
    : 993;
  const smtpPort = Number.isInteger(opts.smtpPort) && opts.smtpPort! > 0 && opts.smtpPort! <= 65535
    ? opts.smtpPort!
    : 587;
  return `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="${escapeXml(domain)}">
    <domain>${escapeXml(domain)}</domain>
    <displayName>${escapeXml(domain)} Mail</displayName>
    <displayShortName>${escapeXml(domain)}</displayShortName>
    <incomingServer type="imap">
      <hostname>${escapeXml(imap)}</hostname>
      <port>${imapPort}</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>${escapeXml(smtp)}</hostname>
      <port>${smtpPort}</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>
`;
}

export function renderOutlookAutodiscover(opts: {
  domain: string;
  email?: string;
  imapHost?: string;
  smtpHost?: string;
}): string {
  const domain = isSafeAutoconfigDomain(opts.domain) ? opts.domain.trim().toLowerCase() : 'localhost';
  const emailRaw = opts.email ?? `user@${domain}`;
  const email = isSafeAutoconfigEmail(emailRaw) ? emailRaw.trim() : `user@${domain}`;
  const imapRaw = opts.imapHost ?? `mail.${domain}`;
  const smtpRaw = opts.smtpHost ?? `mail.${domain}`;
  const imap = isSafeAutoconfigDomain(imapRaw) ? imapRaw.trim().toLowerCase() : `mail.${domain}`;
  const smtp = isSafeAutoconfigDomain(smtpRaw) ? smtpRaw.trim().toLowerCase() : `mail.${domain}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <Account>
      <AccountType>email</AccountType>
      <Action>settings</Action>
      <Protocol>
        <Type>IMAP</Type>
        <Server>${escapeXml(imap)}</Server>
        <Port>993</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>${escapeXml(email)}</LoginName>
        <SPA>off</SPA>
        <SSL>on</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>${escapeXml(smtp)}</Server>
        <Port>587</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>${escapeXml(email)}</LoginName>
        <SPA>off</SPA>
        <Encryption>TLS</Encryption>
        <AuthRequired>on</AuthRequired>
        <UsePOPAuth>on</UsePOPAuth>
        <SMTPLast>off</SMTPLast>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>
`;
}
