/**
 * /cluster — cross-engine overview. Engine tabs stay on each service page.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  DataTable,
  FeaturePageLayout,
  LoadingBlock,
  buttonClassName,
} from '../../shared/components/ui';
import { dbClusterApi } from '../../features/db-service/cluster-api';
import { systemApi } from '../../features/system';
import {
  CLUSTER_ENGINE_ORDER,
  clusterServicePath,
  clusterEngineFromServiceRow,
  serviceRowLooksInstalled,
  type ClusterEngine,
} from './cluster-landing';

type OverviewRow = {
  id: string;
  name: string;
  engine: string;
  kind: string;
  status: string;
  members: number;
};

export function ClusterLandingPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [clusters, setClusters] = useState<OverviewRow[]>([]);
  const [installed, setInstalled] = useState<Partial<Record<ClusterEngine, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ov, vers, matrix] = await Promise.all([
          dbClusterApi.overview().catch(() => ({ items: [] as OverviewRow[] })),
          systemApi
            .softwareVersions({ ids: ['mysql', 'mariadb', 'postgres', 'redis'] })
            .catch(() => ({ items: [] as Array<{ id: string; installed: boolean }> })),
          systemApi
            .servicesMatrix()
            .catch(() => ({ items: [] as Array<{ id: string; installed?: boolean; active?: string }> })),
        ]);
        const next: Partial<Record<ClusterEngine, boolean>> = {};
        for (const it of vers.items ?? []) {
          if (
            it.id === 'mysql' ||
            it.id === 'mariadb' ||
            it.id === 'postgres' ||
            it.id === 'redis'
          ) {
            next[it.id] = Boolean(it.installed);
          }
        }
        for (const row of matrix.items ?? []) {
          const engine = clusterEngineFromServiceRow(row);
          if (engine && serviceRowLooksInstalled(row)) next[engine] = true;
        }
        if (!cancelled) {
          setInstalled(next);
          setClusters(ov.items ?? []);
        }
      } catch {
        if (!cancelled) {
          setInstalled({});
          setClusters([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const installedN = CLUSTER_ENGINE_ORDER.filter((e) => installed[e]).length;
  const plannedN = clusters.filter((c) => c.status === 'planned' || c.status === 'draft').length;

  return (
    <FeaturePageLayout
      title={t('db.cluster.landingTitle')}
      subtitle={t('db.cluster.landingDesc')}
      showCapability={false}
      status={{
        pill: {
          label: t('db.cluster.overviewPill', { n: clusters.length }),
          tone: clusters.length ? 'ok' : 'neutral',
        },
        items: [
          { label: t('db.cluster.enginesInstalled'), value: `${installedN}/4` },
          { label: t('db.cluster.plannedCount'), value: plannedN, tone: plannedN ? 'warn' : undefined },
        ],
      }}
    >
      {loading ? <LoadingBlock label={t('common.loading')} /> : null}
      {!loading && installedN === 0 ? (
        <Alert variant="info">{t('db.cluster.landingNoneInstalled')}</Alert>
      ) : null}
      <div className="u-flex u-gap-2 u-flex-wrap u-mt-3 u-mb-3">
        {CLUSTER_ENGINE_ORDER.map((engine) => (
          <Link
            key={engine}
            to={clusterServicePath(engine)}
            className={buttonClassName({
              variant: installed[engine] ? 'secondary' : 'ghost',
              size: 'md',
            })}
            title={
              installed[engine]
                ? undefined
                : t('db.cluster.engineNotInstalled', { engine })
            }
          >
            {t('db.cluster.openEngine', { engine })}
          </Link>
        ))}
        <Link to="/services" className={buttonClassName({ variant: 'ghost', size: 'md' })}>
          {t('nav.services')}
        </Link>
      </div>
      {!loading ? (
        <DataTable<OverviewRow>
          rowKey={(r) => r.id}
          title={t('db.cluster.overviewList', { count: clusters.length })}
          rows={clusters}
          empty={<Alert variant="info">{t('db.cluster.overviewEmpty')}</Alert>}
          columns={[
            { key: 'name', header: t('common.name'), render: (r) => r.name },
            { key: 'engine', header: t('db.cluster.engine'), render: (r) => r.engine },
            { key: 'kind', header: t('db.cluster.kind'), render: (r) => r.kind },
            {
              key: 'status',
              header: t('common.status'),
              render: (r) => (
                <Badge tone={r.status === 'healthy' || r.status === 'applied' ? 'ok' : 'warn'}>
                  {r.status}
                </Badge>
              ),
            },
            { key: 'members', header: t('db.cluster.members'), render: (r) => String(r.members) },
          ]}
          rowActions={(r) => (
            <Link
              to={clusterServicePath(r.engine)}
              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            >
              {t('db.cluster.openEngine', { engine: r.engine })}
            </Link>
          )}
        />
      ) : null}
    </FeaturePageLayout>
  );
}
