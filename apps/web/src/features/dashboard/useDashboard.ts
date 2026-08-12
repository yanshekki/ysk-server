/**
 * Dashboard feature — load health, metrics, projects, summary.
 * Re-fetches when UI language changes so API summary strings match chrome.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthResponse } from 'ysk-server-shared';
import { dashboardApi } from './api';

export function useDashboard() {
  const { i18n, t } = useTranslation();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; processStatus?: string; port?: number; status?: string }>
  >([]);
  const [backups, setBackups] = useState(0);
  const [expiringCerts, setExpiringCerts] = useState<
    Array<{ domain: string; expires_at: string; days: number }>
  >([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<{
    productionReady: boolean;
    mode: string;
    summary: string[];
    score: { ready: number; degraded: number; missing: number; total: number };
  } | null>(null);
  const [notifications, setNotifications] = useState<
    Array<{
      id: string;
      level: 'critical' | 'warn' | 'info';
      title: string;
      body: string;
      href?: string;
      source: string;
      at: string;
    }>
  >([]);
  const [notifCounts, setNotifCounts] = useState({ critical: 0, warn: 0, info: 0 });
  const [applyAudit, setApplyAudit] = useState<{
    summary: { ok: number; warn: number; bad: number; total: number };
    findings: Array<{
      kind: string;
      id?: string;
      name: string;
      apply_status?: string;
      issue?: string;
      severity: string;
      href?: string;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Isolate each call so one failed/down API never aborts the whole dashboard
      // (proxy ECONNREFUSED while API restarts previously left the page half-dead).
      const soft = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
        try {
          return await fn();
        } catch {
          return undefined;
        }
      };

      try {
        const h = await soft(() => dashboardApi.health());
        if (!cancelled && h) setHealth(h);
        else if (!cancelled && !h) setError(t('errors.http.apiUnreachable', { defaultValue: t('common.loadFailed') }));

        const a = await soft(() => dashboardApi.audit());
        if (!cancelled && a?.items) setAudit(a.items.slice(0, 12));

        const m = await soft(() => dashboardApi.metrics());
        if (!cancelled && m) setMetrics(m);

        const p = await soft(() => dashboardApi.projects());
        if (!cancelled && p?.items) setProjects(p.items.slice(0, 12));

        const b = await soft(() => dashboardApi.backups());
        if (!cancelled && b?.items) setBackups(b.items.length);

        const s = await soft(() => dashboardApi.sslBindings());
        if (!cancelled && s?.items) {
          const now = Date.now();
          const exp = (s.items ?? [])
            .filter((c) => c.expires_at)
            .map((c) => {
              const t = new Date(String(c.expires_at)).getTime();
              const days = Math.floor((t - now) / (86400 * 1000));
              return { domain: c.domain, expires_at: String(c.expires_at), days };
            })
            .filter((c) => c.days <= 30)
            .sort((x, y) => x.days - y.days);
          setExpiringCerts(exp);
        }

        const sum = await soft(() => dashboardApi.summary());
        if (!cancelled && sum) setSummary(sum);

        const r = await soft(() => dashboardApi.readiness());
        // Guard shape: never set partial objects that crash render (score/summary)
        if (
          !cancelled &&
          r &&
          r.score &&
          typeof r.score.ready === 'number' &&
          Array.isArray(r.summary)
        ) {
          setReadiness(r);
        }

        const n = await soft(() => dashboardApi.notifications());
        if (!cancelled && n) {
          setNotifications(n.items ?? []);
          setNotifCounts(n.counts ?? { critical: 0, warn: 0, info: 0 });
        }

        const aa = await soft(() => dashboardApi.applyAudit());
        if (!cancelled && aa?.summary) {
          setApplyAudit({
            summary: aa.summary,
            findings: (aa.findings ?? []).filter((f) => f.severity !== 'ok').slice(0, 12),
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t('common.error', { defaultValue: 'Error' }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-load when language changes so readiness.summary / notifications match UI locale
  }, [i18n.language, t]);

  return {
    health,
    audit,
    metrics,
    projects,
    backups,
    expiringCerts,
    summary,
    readiness,
    notifications,
    notifCounts,
    applyAudit,
    error,
    loading,
  };
}
