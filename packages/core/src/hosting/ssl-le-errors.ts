/**
 * Turn certbot / ACME stderr into an operator-facing reason (i18n keys under ssl.*).
 */
import { tl } from '@yanshekki/shared';

export type LeFailureKind =
  | 'nxdomain'
  | 'dns'
  | 'connection'
  | 'http01'
  | 'rate_limit'
  | 'caa'
  | 'challenge'
  | 'unknown';

export type LeFailureExplain = {
  kind: LeFailureKind;
  domain?: string;
  /** Primary human sentence for UI alert */
  summary: string;
  /** Short next-step line */
  hint: string;
};

/** Extract a domain-looking token from certbot / ACME text. */
export function extractDomainFromLeOutput(raw: string): string | undefined {
  const text = raw || '';
  const patterns = [
    /NXDOMAIN looking up A(?:AAA)? for ([a-z0-9*.-]+)/i,
    /Challenge failed for domain ([a-z0-9*.-]+)/i,
    /Domain:\s*([a-z0-9*.-]+)/i,
    /http-01 challenge for ([a-z0-9*.-]+)/i,
    /for domain ([a-z0-9*.-]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1] && m[1].includes('.')) return m[1].toLowerCase().replace(/\.$/, '');
  }
  return undefined;
}

/**
 * Classify LE failure and return localized summary + hint.
 * Prefers actionable DNS/HTTP reasons over raw certbot dump.
 */
export function explainLetsEncryptFailure(
  raw: string,
  fallbackDomain?: string,
): LeFailureExplain {
  const text = raw || '';
  const domain =
    extractDomainFromLeOutput(text) ||
    (fallbackDomain ? fallbackDomain.trim().toLowerCase().replace(/\.$/, '') : undefined);
  const d = domain || '—';

  if (/NXDOMAIN|no such host|NXDOMAIN looking up/i.test(text)) {
    return {
      kind: 'nxdomain',
      domain,
      summary: tl('ssl.leFailNxdomain', { domain: d }),
      hint: tl('ssl.leFailNxdomainHint', { domain: d }),
    };
  }
  if (
    /DNS problem|SERVFAIL|dnssec|no valid A records|incorrect name servers/i.test(
      text,
    )
  ) {
    return {
      kind: 'dns',
      domain,
      summary: tl('ssl.leFailDns', { domain: d }),
      hint: tl('ssl.leFailDnsHint', { domain: d }),
    };
  }
  if (/rate.?Limited|too many certificates|too many failed authorizations/i.test(text)) {
    return {
      kind: 'rate_limit',
      domain,
      summary: tl('ssl.leFailRateLimit'),
      hint: tl('ssl.leFailRateLimitHint'),
    };
  }
  if (/\bCAA\b|caa record/i.test(text)) {
    return {
      kind: 'caa',
      domain,
      summary: tl('ssl.leFailCaa', { domain: d }),
      hint: tl('ssl.leFailCaaHint'),
    };
  }
  if (
    /Invalid response|404|connection refused|Timeout during connect|Connection timed out|network unreachable/i.test(
      text,
    )
  ) {
    return {
      kind: 'http01',
      domain,
      summary: tl('ssl.leFailHttp01', { domain: d }),
      hint: tl('ssl.leFailHttp01Hint', { domain: d }),
    };
  }
  if (/Some challenges have failed|Challenge failed|AuthorizationError/i.test(text)) {
    return {
      kind: 'challenge',
      domain,
      summary: tl('ssl.leFailChallenge', { domain: d }),
      hint: tl('ssl.leFailChallengeHint', { domain: d }),
    };
  }
  return {
    kind: 'unknown',
    domain,
    summary: tl('ssl.leFailUnknown', { domain: d }),
    hint: tl('ssl.leFailUnknownHint'),
  };
}

/** Notes array: human reason first, then short raw tail for support. */
export function notesForLetsEncryptFailure(
  raw: string,
  fallbackDomain?: string,
): string[] {
  const ex = explainLetsEncryptFailure(raw, fallbackDomain);
  const notes = [ex.summary, ex.hint];
  const compact = (raw || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  if (compact && !/Saving debug log/i.test(compact.slice(0, 40))) {
    notes.push(tl('ssl.leFailRawTail', { snippet: compact }));
  } else if (compact) {
    // Drop the useless "Saving debug log to ..." prefix if that's all we have
    const withoutNoise = compact
      .replace(/^Saving debug log to \S+\s*/i, '')
      .slice(0, 280);
    if (withoutNoise.length > 20) {
      notes.push(tl('ssl.leFailRawTail', { snippet: withoutNoise }));
    }
  }
  return notes;
}
