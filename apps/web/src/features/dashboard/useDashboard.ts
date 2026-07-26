/**
 * Dashboard feature — load health, metrics, projects, summary.
 */
import { useEffect, useState } from 'react';
import type { HealthResponse } from '@ysk/shared';
import { dashboardApi } from './api';

export function useDashboard() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; processStatus?: string; port?: number; status?: string }>
  >([]);
  const [backups, setBackups] = useState(0);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [readiness, setReadiness] = useState<{
    productionReady: boolean;
    mode: string;
    summary: string[];
    score: { ready: number; degraded: number; missing: number; total: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await dashboardApi.health();
        if (!cancelled) setHealth(h);
        const a = await dashboardApi.audit();
        if (!cancelled) setAudit(a.items.slice(0, 12));
        const m = await dashboardApi.metrics();
        if (!cancelled) setMetrics(m);
        try {
          const p = await dashboardApi.projects();
          if (!cancelled) setProjects(p.items.slice(0, 12));
        } catch {
          /* guest */
        }
        try {
          const b = await dashboardApi.backups();
          if (!cancelled) setBackups(b.items.length);
        } catch {
          /* optional */
        }
        try {
          const s = await dashboardApi.summary();
          if (!cancelled) setSummary(s);
        } catch {
          /* optional */
        }
        try {
          const r = await dashboardApi.readiness();
          if (!cancelled) setReadiness(r);
        } catch {
          /* optional / 503 still returns body via fetch throw — ignore */
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { health, audit, metrics, projects, backups, summary, readiness, error, loading };
}
