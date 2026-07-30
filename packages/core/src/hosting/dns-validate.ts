/**
 * DNS record validation + conflict detection (control-plane honesty).
 */

export type DnsRecordLike = {
  type: string;
  name: string;
  value: string;
  ttl?: number;
};

export type DnsValidationIssue = {
  level: 'error' | 'warn';
  code: string;
  message: string;
  recordIndex?: number;
};

const ALLOWED_TYPES = new Set([
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SRV',
  'CAA',
]);

function normName(n: string): string {
  const s = (n || '@').trim().toLowerCase();
  if (!s || s === '@') return '@';
  return s.replace(/\.$/, '');
}

function isIpv4(v: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) &&
    v.split('.').every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255;
    });
}

function isIpv6(v: string): boolean {
  // Practical check (not full RFC)
  return v.includes(':') && v.length >= 2 && v.length <= 45 && !/\s/.test(v);
}

/**
 * Validate a single record shape.
 */
export function validateDnsRecord(
  rec: DnsRecordLike,
  index?: number,
): DnsValidationIssue[] {
  const issues: DnsValidationIssue[] = [];
  const type = (rec.type || '').toUpperCase();
  const name = normName(rec.name);
  const value = (rec.value || '').trim();
  const ttl = rec.ttl ?? 300;

  if (!ALLOWED_TYPES.has(type)) {
    issues.push({
      level: 'error',
      code: 'bad_type',
      message: `不支援的類型：${rec.type}`,
      recordIndex: index,
    });
  }
  if (!value) {
    issues.push({
      level: 'error',
      code: 'empty_value',
      message: '記錄值不可為空',
      recordIndex: index,
    });
  }
  if (!Number.isFinite(ttl) || ttl < 30 || ttl > 86400 * 7) {
    issues.push({
      level: 'warn',
      code: 'ttl_range',
      message: `TTL ${ttl} 建議介於 30–604800`,
      recordIndex: index,
    });
  }

  if (type === 'A' && value && !isIpv4(value)) {
    issues.push({
      level: 'error',
      code: 'bad_a',
      message: 'A 記錄必須是 IPv4',
      recordIndex: index,
    });
  }
  if (type === 'AAAA' && value && !isIpv6(value)) {
    issues.push({
      level: 'error',
      code: 'bad_aaaa',
      message: 'AAAA 記錄必須是 IPv6',
      recordIndex: index,
    });
  }
  if (type === 'MX' && value && !/^\d+\s+\S+/.test(value)) {
    issues.push({
      level: 'error',
      code: 'bad_mx',
      message: 'MX 格式：優先級 主機（例如 10 mail.example.com.）',
      recordIndex: index,
    });
  }
  if (type === 'CNAME' && name === '@') {
    issues.push({
      level: 'warn',
      code: 'apex_cname',
      message: 'apex CNAME 在多數授權伺服器不建議／不相容',
      recordIndex: index,
    });
  }
  if (type === 'SRV' && value && !/^\d+\s+\d+\s+\d+\s+\S+/.test(value)) {
    issues.push({
      level: 'warn',
      code: 'bad_srv',
      message: 'SRV 建議格式：priority weight port target',
      recordIndex: index,
    });
  }

  return issues;
}

/**
 * Validate a set of records for conflicts (same name).
 */
export function validateDnsRecordSet(
  records: DnsRecordLike[],
): DnsValidationIssue[] {
  const issues: DnsValidationIssue[] = [];
  records.forEach((r, i) => {
    issues.push(...validateDnsRecord(r, i));
  });

  const byName = new Map<string, DnsRecordLike[]>();
  for (const r of records) {
    const k = normName(r.name);
    const list = byName.get(k) ?? [];
    list.push(r);
    byName.set(k, list);
  }

  for (const [name, list] of byName) {
    const types = list.map((r) => r.type.toUpperCase());
    if (types.includes('CNAME') && types.some((t) => t !== 'CNAME')) {
      issues.push({
        level: 'error',
        code: 'cname_conflict',
        message: `名稱 ${name} 同時有 CNAME 與其他類型（禁止）`,
      });
    }
    if (types.filter((t) => t === 'CNAME').length > 1) {
      // multiple CNAME same name is also bad
      const cnames = list.filter((r) => r.type.toUpperCase() === 'CNAME');
      if (new Set(cnames.map((c) => c.value)).size > 1) {
        issues.push({
          level: 'error',
          code: 'multi_cname',
          message: `名稱 ${name} 有多個不同 CNAME 目標`,
        });
      }
    }
  }

  return issues;
}

export function hasDnsErrors(issues: DnsValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
