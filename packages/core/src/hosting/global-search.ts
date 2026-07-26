/**
 * Global object search across projects, email, DNS, users, FTP.
 */

import type { YskDatabase } from '../db/database.js';

export type SearchHit = {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export function globalSearch(db: YskDatabase, q: string, limit = 40): SearchHit[] {
  const query = q.trim().toLowerCase();
  if (query.length < 1) return [];
  const hits: SearchHit[] = [];

  for (const p of db.snapshot.projects) {
    const hay = `${p.name} ${p.domain ?? ''} ${p.id} ${p.linux_user}`.toLowerCase();
    if (hay.includes(query)) {
      hits.push({
        kind: 'project',
        id: p.id,
        title: p.name,
        subtitle: p.domain,
        href: `/projects/${p.id}`,
      });
    }
  }
  for (const e of db.snapshot.email_domains) {
    const domain = String(e.domain ?? '');
    const id = String(e.id ?? '');
    if (domain.toLowerCase().includes(query) || id.includes(query)) {
      hits.push({
        kind: 'email',
        id,
        title: domain,
        subtitle: String(e.server_ip ?? ''),
        href: `/email/domains/${id}`,
      });
    }
  }
  // dns from resources collections if present as dns_zones array of records
  const dnsZones = (db.snapshot as { dns_zones?: Array<Record<string, unknown>> }).dns_zones ?? [];
  for (const z of dnsZones) {
    const zone = String(z.zone ?? '');
    const id = String(z.id ?? '');
    if (zone.toLowerCase().includes(query) || id.includes(query)) {
      hits.push({
        kind: 'dns',
        id,
        title: zone,
        subtitle: String(z.serverIp ?? z.server_ip ?? ''),
        href: '/dns',
      });
    }
  }
  for (const u of db.snapshot.users) {
    if (u.username.toLowerCase().includes(query)) {
      hits.push({
        kind: 'user',
        id: u.id,
        title: u.username,
        subtitle: u.roles.join(','),
        href: '/users',
      });
    }
  }
  for (const a of db.snapshot.ftp_accounts ?? []) {
    const username = String(a.username ?? '');
    const id = String(a.id ?? '');
    if (username.toLowerCase().includes(query)) {
      hits.push({
        kind: 'ftp',
        id,
        title: username,
        subtitle: String(a.homePath ?? ''),
        href: '/ftp',
      });
    }
  }
  for (const c of db.snapshot.certificates ?? []) {
    const domain = String(c.domain ?? '');
    const id = String(c.id ?? '');
    if (domain.toLowerCase().includes(query)) {
      hits.push({
        kind: 'ssl',
        id,
        title: domain,
        subtitle: String(c.status ?? ''),
        href: '/ssl',
      });
    }
  }

  return hits.slice(0, limit);
}
