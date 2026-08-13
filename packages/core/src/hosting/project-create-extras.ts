import { tl } from 'ysk-server-shared';
/**
 * Shared create-site extras: optional DNS zone + mail domain drafts.
 * Used by POST /api/v1/projects, wizard, and `ysk-server projects create`.
 */
import type { JsonStore } from '../db/store.js';
import { createResource, seedDnsZoneRecords } from './managed-resources.js';

export type ProjectCreateExtras = {
  dnsZoneId?: string;
  emailDomainId?: string;
  notes: string[];
};

export type ProjectCreateEmailLike = {
  create: (opts: {
    domain: string;
    serverIp: string;
    serverIpv6?: string;
    actor: string;
  }) => { domain?: { id?: string }; id?: string };
};

export function attachProjectCreateExtras(input: {
  db: JsonStore;
  email: ProjectCreateEmailLike;
  projectId: string;
  domain?: string;
  actor: string;
  createDnsZone?: boolean;
  createMailDomain?: boolean;
  serverIp?: string;
  serverIpv6?: string;
  /** DNS seed template. Panel/API default is `web`. */
  dnsTemplate?: string;
}): ProjectCreateExtras {
  const extras: ProjectCreateExtras = { notes: [] };
  const domain = (input.domain ?? '').trim().toLowerCase();
  if (!domain) return extras;
  const serverIp = (input.serverIp ?? '127.0.0.1').trim() || '127.0.0.1';
  const serverIpv6 = input.serverIpv6?.trim() || undefined;
  const template = input.dnsTemplate ?? 'web';

  if (input.createDnsZone) {
    try {
      const zoneRow = createResource(input.db, 'dns_zones', {
        zone: domain,
        serverIp,
        ...(serverIpv6 ? { serverIpv6 } : {}),
        backend: 'bind',
        template,
        apply_status: 'draft',
        projectId: input.projectId,
      });
      seedDnsZoneRecords(
        input.db,
        String(zoneRow.id),
        domain,
        serverIp,
        template,
        serverIpv6,
      );
      extras.dnsZoneId = String(zoneRow.id);
      extras.notes.push(tl('notes.auto.t0785', { v0: domain }));
    } catch (e) {
      extras.notes.push(
        tl('notes.auto.t0786', { v0: e instanceof Error ? e.message : String(e) }),
      );
    }
  }

  if (input.createMailDomain) {
    try {
      const mail = input.email.create({
        domain,
        serverIp,
        serverIpv6,
        actor: input.actor,
      });
      extras.emailDomainId = String(mail.domain?.id ?? mail.id ?? '');
      extras.notes.push(tl('notes.auto.t0787', { v0: domain }));
    } catch (e) {
      extras.notes.push(
        tl('notes.auto.t0788', { v0: e instanceof Error ? e.message : String(e) }),
      );
    }
  }

  return extras;
}
