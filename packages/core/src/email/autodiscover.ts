/**
 * Generate Autodiscover / Autoconfig XML for mail clients.
 */

export function renderMozillaAutoconfig(opts: {
  domain: string;
  imapHost?: string;
  smtpHost?: string;
  imapPort?: number;
  smtpPort?: number;
}): string {
  const imap = opts.imapHost ?? `mail.${opts.domain}`;
  const smtp = opts.smtpHost ?? `mail.${opts.domain}`;
  const imapPort = opts.imapPort ?? 993;
  const smtpPort = opts.smtpPort ?? 587;
  return `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="${opts.domain}">
    <domain>${opts.domain}</domain>
    <displayName>${opts.domain} Mail</displayName>
    <displayShortName>${opts.domain}</displayShortName>
    <incomingServer type="imap">
      <hostname>${imap}</hostname>
      <port>${imapPort}</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>${smtp}</hostname>
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
  const email = opts.email ?? `user@${opts.domain}`;
  const imap = opts.imapHost ?? `mail.${opts.domain}`;
  const smtp = opts.smtpHost ?? `mail.${opts.domain}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <Account>
      <AccountType>email</AccountType>
      <Action>settings</Action>
      <Protocol>
        <Type>IMAP</Type>
        <Server>${imap}</Server>
        <Port>993</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>${email}</LoginName>
        <SPA>off</SPA>
        <SSL>on</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>${smtp}</Server>
        <Port>587</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>${email}</LoginName>
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
