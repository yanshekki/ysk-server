/**
 * Content safety layers for host-browse (beyond SSRF IP policy).
 */

export type SafetyLevel = 'strict' | 'standard' | 'relaxed';

export type SafetyDecision = {
  action: 'allow' | 'block' | 'warn';
  code: string;
  reason: string;
};

/** Built-in block list (examples; extend via settings). */
const DEFAULT_BLOCK_HOSTS = new Set(
  [
    'malware.testing.google.test',
    'testsafebrowsing.appspot.com',
  ].map((h) => h.toLowerCase()),
);

/** High-risk TLD / host suffixes that warn in standard mode */
const WARN_SUFFIXES = ['.onion'];

const DANGEROUS_DOWNLOAD_EXT = [
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.bash',
  '.deb',
  '.rpm',
  '.apk',
  '.dmg',
  '.scr',
  '.js',
  '.vbs',
  '.jar',
];

export function evaluateNavigateSafety(input: {
  url: string;
  level?: SafetyLevel;
  extraBlockHosts?: string[];
  allowDangerousDownloads?: boolean;
}): SafetyDecision {
  const level = input.level ?? 'standard';
  let u: URL;
  try {
    u = new URL(input.url);
  } catch {
    return { action: 'block', code: 'BAD_URL', reason: 'Invalid URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { action: 'block', code: 'BAD_SCHEME', reason: 'Only http/https allowed' };
  }
  const host = u.hostname.toLowerCase();
  const block = new Set([
    ...DEFAULT_BLOCK_HOSTS,
    ...(input.extraBlockHosts ?? []).map((h) => h.toLowerCase()),
  ]);
  if (block.has(host) || [...block].some((b) => host.endsWith(`.${b}`))) {
    return {
      action: 'block',
      code: 'BLOCKLIST',
      reason: `Host blocked by security list: ${host}`,
    };
  }
  if (level === 'strict' || level === 'standard') {
    for (const s of WARN_SUFFIXES) {
      if (host.endsWith(s)) {
        return {
          action: level === 'strict' ? 'block' : 'warn',
          code: 'WARN_SUFFIX',
          reason: `High-risk host suffix ${s}`,
        };
      }
    }
  }
  return { action: 'allow', code: 'OK', reason: 'ok' };
}

export function evaluateDownloadSafety(input: {
  filename: string;
  allowDangerous?: boolean;
}): SafetyDecision {
  const name = input.filename.toLowerCase();
  const dangerous = DANGEROUS_DOWNLOAD_EXT.some((ext) => name.endsWith(ext));
  if (dangerous && !input.allowDangerous) {
    return {
      action: 'block',
      code: 'DANGEROUS_DOWNLOAD',
      reason: `Blocked potentially dangerous file type: ${input.filename}`,
    };
  }
  if (dangerous) {
    return {
      action: 'warn',
      code: 'DANGEROUS_DOWNLOAD_WARN',
      reason: `Dangerous file type allowed by policy: ${input.filename}`,
    };
  }
  return { action: 'allow', code: 'OK', reason: 'ok' };
}
