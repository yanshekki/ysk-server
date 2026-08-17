/**
 * /cluster — land on an installed engine's cluster tab, or explain why not MySQL.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FeaturePageLayout,
  LoadingBlock,
  buttonClassName,
} from '../../shared/components/ui';
import { dbClusterApi } from '../../features/db-service/cluster-api';
import { systemApi } from '../../features/system';
import {
  CLUSTER_ENGINE_ORDER,
  clusterServicePath,
  pickClusterLandingPath,
  type ClusterEngine,
} from './cluster-landing';

export function ClusterLandingPage() {
  const { t } = useTranslation();
  const [href, setHref] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ov, vers] = await Promise.all([
          dbClusterApi.overview().catch(() => ({ items: [] as Array<{ engine: string }> })),
          systemApi
            .softwareVersions({ ids: ['mysql', 'mariadb', 'postgres', 'redis'] })
            .catch(() => ({ items: [] as Array<{ id: string; installed: boolean }> })),
        ]);
        const installed: Partial<Record<ClusterEngine, boolean>> = {};
        for (const it of vers.items ?? []) {
          if (
            it.id === 'mysql' ||
            it.id === 'mariadb' ||
            it.id === 'postgres' ||
            it.id === 'redis'
          ) {
            installed[it.id] = Boolean(it.installed);
          }
        }
        const path = pickClusterLandingPath({
          clusters: (ov.items ?? []).map((x) => ({ engine: String(x.engine) })),
          installed,
        });
        if (!cancelled) setHref(path);
      } catch {
        if (!cancelled) setHref(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (href === undefined) {
    return <LoadingBlock label={t('common.loading')} />;
  }
  if (href) return <Navigate to={href} replace />;

  return (
    <FeaturePageLayout
      title={t('db.cluster.landingTitle')}
      subtitle={t('db.cluster.landingDesc')}
      showCapability={false}
      status={{
        pill: { label: t('db.cluster.landingTitle'), tone: 'warn' },
        items: [
          {
            label: t('db.cluster.landingTitle'),
            value: t('db.cluster.notApplied'),
            tone: 'warn',
          },
        ],
      }}
    >
      <Alert variant="info">{t('db.cluster.landingNoneInstalled')}</Alert>
      <div className="u-flex u-gap-2 u-flex-wrap u-mt-3">
        {CLUSTER_ENGINE_ORDER.map((engine) => (
          <Link
            key={engine}
            to={clusterServicePath(engine)}
            className={buttonClassName({ variant: 'secondary', size: 'md' })}
          >
            {t('db.cluster.openEngine', { engine })}
          </Link>
        ))}
        <Link to="/services" className={buttonClassName({ variant: 'ghost', size: 'md' })}>
          {t('nav.services')}
        </Link>
      </div>
    </FeaturePageLayout>
  );
}
