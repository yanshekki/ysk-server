export type HttpProbeFailCode = 'timeout' | 'dns' | 'refused' | 'tls' | 'unreach' | 'http';

function collectFetchText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const extra = cur as Error & { code?: string; cause?: unknown };
      if (extra.code) parts.push(String(extra.code));
      cur = extra.cause;
    } else if (typeof cur === 'object' && cur && 'code' in cur) {
      parts.push(String((cur as { code?: string }).code));
      break;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.filter(Boolean).join(' ');
}

/** Unwrap Node fetch TypeError: fetch failed + cause.code. */
export function classifyHttpProbeFailure(err: unknown): {
  code: HttpProbeFailCode;
  detail: string;
} {
  const blob = collectFetchText(err);
  const t = blob.toLowerCase();
  if (/abort|timeout|etimedout|und_err_connect_timeout|the operation was aborted/.test(t)) {
    return { code: 'timeout', detail: blob.slice(0, 160) };
  }
  if (/enotfound|getaddrinfo|err_name_not_resolved|dns/.test(t)) {
    return { code: 'dns', detail: blob.slice(0, 160) };
  }
  if (/econnrefused|err_connection_refused/.test(t)) {
    return { code: 'refused', detail: blob.slice(0, 160) };
  }
  if (/cert|unable to verify|self.signed|err_tls|ssl|unhauthorized|certificate/.test(t)) {
    return { code: 'tls', detail: blob.slice(0, 160) };
  }
  if (/ehostunreach|enetunreach|econnreset|network unreachable/.test(t)) {
    return { code: 'unreach', detail: blob.slice(0, 160) };
  }
  return { code: 'http', detail: blob.slice(0, 160) };
}
