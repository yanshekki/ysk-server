/**
 * Lightweight nav badges: catalog apt upgrades + host inventory upgradable count.
 * Polled infrequently — not a substitute for software hub refresh.
 */
import { useCallback, useEffect, useState } from 'react';
import { systemApi } from '../../features/system';
import { updatesApi } from '../../features/updates';

export type SoftwareNavBadges = {
  /** Product catalog packages with apt candidate (software hub) */
  software: number;
  /** Host inventory rows marked upgradable (updates page) */
  updates: number;
  refresh: () => Promise<void>;
};

export function useSoftwareNavBadges(): SoftwareNavBadges {
  const [software, setSoftware] = useState(0);
  const [updates, setUpdates] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [vers, inv] = await Promise.all([
        systemApi
          .softwareVersions({
            ids: [
              'node',
              'php',
              'python',
              'go',
              'rust',
              'java',
              'kotlin',
              'bun',
              'nginx',
              'mysql-server',
              'mariadb-server',
              'postgresql',
              'redis-server',
              'pdns-server',
              'certbot',
              'postfix',
              'dovecot',
              'vsftpd',
              'ufw',
              'fail2ban',
            ],
          })
          .catch(() => null),
        updatesApi
          .inventory({ upgradable: '1', cached: true })
          .catch(() => null),
      ]);
      const cat = Number(
        vers?.upgradableCount ??
          (vers?.items ?? []).filter((i) => i.upgradable).length,
      );
      setSoftware(Number.isFinite(cat) && cat > 0 ? cat : 0);

      const metaCount = Number(inv?.meta?.upgradableCount ?? 0);
      const rowCount = (inv?.inventory ?? []).filter(
        (i) =>
          i.candidateVersion &&
          i.candidateVersion !== i.currentVersion,
      ).length;
      const host = Math.max(metaCount, rowCount);
      setUpdates(Number.isFinite(host) && host > 0 ? host : 0);
    } catch {
      /* keep last known; nav must not break */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { software, updates, refresh };
}
