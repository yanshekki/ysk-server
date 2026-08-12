import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './layout/RequireAuth';
import { RequireCapability } from './layout/RequireCapability';
import { GuestOnly } from './layout/GuestOnly';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { ToastViewport } from '../shared/components/ui';
import { OpsStreamProvider } from '../shared/ops-stream/OpsStreamContext';
import { OpsStreamDock } from '../shared/ops-stream/OpsStreamDock';

/** Lightweight fallback while route chunks load */
export function RouteFallback() {
  return (
    <div className="u-pad-panel muted u-text-sm">
      Loading…
    </div>
  );
}

// Eager: login + shell-critical only
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

// Lazy: heavy feature pages — avoids one import crash blanking the whole app
const SecurityPage = lazy(() =>
  import('../pages/SecurityPage').then((m) => ({ default: m.SecurityPage })),
);
const EmailPage = lazy(() =>
  import('../pages/EmailPage').then((m) => ({ default: m.EmailPage })),
);
const EmailDomainPage = lazy(() =>
  import('../pages/EmailDomainPage').then((m) => ({ default: m.EmailDomainPage })),
);
const ProjectsPage = lazy(() =>
  import('../pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
);
const ProjectDetailPage = lazy(() =>
  import('../pages/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })),
);
const UpdatesPage = lazy(() =>
  import('../pages/UpdatesPage').then((m) => ({ default: m.UpdatesPage })),
);
const FilesPage = lazy(() =>
  import('../pages/FilesPage').then((m) => ({ default: m.FilesPage })),
);
const PublicSharePage = lazy(() =>
  import('../pages/PublicSharePage').then((m) => ({ default: m.PublicSharePage })),
);
const VncSharePage = lazy(() =>
  import('../pages/features/VncSharePage').then((m) => ({ default: m.VncSharePage })),
);
const SystemPage = lazy(() =>
  import('../pages/SystemPage').then((m) => ({ default: m.SystemPage })),
);
const NginxPage = lazy(() =>
  import('../pages/features/NginxPage').then((m) => ({ default: m.NginxPage })),
);
const ApachePage = lazy(() =>
  import('../pages/features/ApachePage').then((m) => ({ default: m.ApachePage })),
);
const PhpRuntimePage = lazy(() =>
  import('../pages/features/PhpRuntimePage').then((m) => ({ default: m.PhpRuntimePage })),
);
const GoRuntimePage = lazy(() =>
  import('../pages/features/GenericRuntimePage').then((m) => ({ default: m.GoRuntimePage })),
);
const NodeRuntimePage = lazy(() =>
  import('../pages/features/GenericRuntimePage').then((m) => ({ default: m.NodeRuntimePage })),
);
const PythonRuntimePage = lazy(() =>
  import('../pages/features/GenericRuntimePage').then((m) => ({
    default: m.PythonRuntimePage })),
);
const RustRuntimePage = lazy(() =>
  import('../pages/features/GenericRuntimePage').then((m) => ({ default: m.RustRuntimePage })),
);
const JavaRuntimePage = lazy(() =>
  import('../pages/features/GenericRuntimePage').then((m) => ({ default: m.JavaRuntimePage })),
);
const KotlinRuntimePage = lazy(() =>
  import('../pages/features/GenericRuntimePage').then((m) => ({ default: m.KotlinRuntimePage })),
);
const BunRuntimePage = lazy(() =>
  import('../pages/features/GenericRuntimePage').then((m) => ({ default: m.BunRuntimePage })),
);
const SslPage = lazy(() =>
  import('../pages/features/SslPage').then((m) => ({ default: m.SslPage })),
);
const DnsPage = lazy(() =>
  import('../pages/features/DnsPage').then((m) => ({ default: m.DnsPage })),
);
const CdnPage = lazy(() =>
  import('../pages/features/CdnPage').then((m) => ({ default: m.CdnPage })),
);
const FtpPage = lazy(() =>
  import('../pages/features/FtpPage').then((m) => ({ default: m.FtpPage })),
);
const BtTrackerPage = lazy(() =>
  import('../pages/features/BtTrackerPage').then((m) => ({ default: m.BtTrackerPage })),
);
const FirewallPage = lazy(() =>
  import('../pages/features/FirewallPage').then((m) => ({ default: m.FirewallPage })),
);
const Fail2banPage = lazy(() =>
  import('../pages/features/Fail2banPage').then((m) => ({ default: m.Fail2banPage })),
);
const ProtectionPage = lazy(() =>
  import('../pages/features/ProtectionPage').then((m) => ({ default: m.ProtectionPage })),
);
const MysqlPage = lazy(() =>
  import('../pages/features/MysqlPage').then((m) => ({ default: m.MysqlPage })),
);
const MariadbPage = lazy(() =>
  import('../pages/features/MariadbPage').then((m) => ({ default: m.MariadbPage })),
);
const MysqlServicePage = lazy(() =>
  import('../pages/features/MysqlServicePage').then((m) => ({ default: m.MysqlServicePage })),
);
const MariadbServicePage = lazy(() =>
  import('../pages/features/MariadbServicePage').then((m) => ({
    default: m.MariadbServicePage })),
);
const PostgresServicePage = lazy(() =>
  import('../pages/features/PostgresServicePage').then((m) => ({
    default: m.PostgresServicePage })),
);
const RedisServicePage = lazy(() =>
  import('../pages/features/RedisServicePage').then((m) => ({ default: m.RedisServicePage })),
);
const PostgresPage = lazy(() =>
  import('../pages/features/PostgresPage').then((m) => ({ default: m.PostgresPage })),
);
const RedisPage = lazy(() =>
  import('../pages/features/RedisPage').then((m) => ({ default: m.RedisPage })),
);
const ServicesPage = lazy(() =>
  import('../pages/features/ServicesPage').then((m) => ({ default: m.ServicesPage })),
);

const SystemdUnitPage = lazy(() =>
  import('../pages/features/SystemdUnitPage').then((m) => ({ default: m.SystemdUnitPage })),
);
const ReadinessPage = lazy(() =>
  import('../pages/features/ReadinessPage').then((m) => ({ default: m.ReadinessPage })),
);
const MigrateHostPage = lazy(() =>
  import('../pages/features/MigrateHostPage').then((m) => ({ default: m.MigrateHostPage })),
);
const PublicFilesPage = lazy(() =>
  import('../pages/features/PublicFilesPage').then((m) => ({ default: m.PublicFilesPage })),
);
const CronPage = lazy(() =>
  import('../pages/features/CronPage').then((m) => ({ default: m.CronPage })),
);
const BackupsPage = lazy(() =>
  import('../pages/features/BackupsPage').then((m) => ({ default: m.BackupsPage })),
);
const MetricsPage = lazy(() =>
  import('../pages/features/MetricsPage').then((m) => ({ default: m.MetricsPage })),
);
const NetworkPage = lazy(() =>
  import('../pages/features/NetworkPage').then((m) => ({ default: m.NetworkPage })),
);
const TerminalPage = lazy(() =>
  import('../pages/features/TerminalPage').then((m) => ({ default: m.TerminalPage })),
);
const HostBrowsePage = lazy(() =>
  import('../pages/features/HostBrowsePage').then((m) => ({ default: m.HostBrowsePage })),
);
const VpnPage = lazy(() =>
  import('../pages/features/VpnPage').then((m) => ({ default: m.VpnPage })),
);
const VncPage = lazy(() =>
  import('../pages/features/VncPage').then((m) => ({ default: m.VncPage })),
);
const LogsPage = lazy(() =>
  import('../pages/features/LogsPage').then((m) => ({ default: m.LogsPage })),
);
const UsersPage = lazy(() =>
  import('../pages/UsersPage').then((m) => ({ default: m.UsersPage })),
);

/** Legacy top-level paths → protection subtree (preserve query, e.g. ?tab=whitelist). */
export function RedirectPreserveQuery({ to }: { to: string }) {
  const [params] = useSearchParams();
  const q = params.toString();
  return <Navigate to={q ? `${to}?${q}` : to} replace />;
}

export function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

/**
 * Each major capability has its own route/page.
 * Defense: single nav entry `/protection`; UFW/fail2ban are nested tools.
 * Feature pages are lazy-loaded so a single module error cannot blank login.
 */
export function App() {
  return (
    <ErrorBoundary>
      <OpsStreamProvider>
      <BrowserRouter>
        {/* Global toast: login + authenticated shell */}
        <ToastViewport />
        <OpsStreamDock />
        <Routes>
          <Route
            path="/login"
            element={
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            }
          />
          {/* Public file share — no panel session */}
          <Route
            path="/share/:token"
            element={
              <Lazy>
                <PublicSharePage />
              </Lazy>
            }
          />
          {/* Public VNC view share — no panel session */}
          <Route
            path="/vnc-share/:token"
            element={
              <Lazy>
                <VncSharePage />
              </Lazy>
            }
          />
          <Route
            element={
              <RequireAuth>
                <RequireCapability>
                  <AppShell />
                </RequireCapability>
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            {/* AI panel UI removed — use CLI (ask / agents / tools) + docs */}
            <Route path="ai" element={<Navigate to="/" replace />} />
            <Route path="agents" element={<Navigate to="/" replace />} />
            <Route
              path="projects"
              element={
                <Lazy>
                  <ProjectsPage />
                </Lazy>
              }
            />
            <Route
              path="projects/:id"
              element={
                <Lazy>
                  <ProjectDetailPage />
                </Lazy>
              }
            />
            <Route
              path="security"
              element={
                <Lazy>
                  <SecurityPage />
                </Lazy>
              }
            />
            <Route
              path="users"
              element={
                <Lazy>
                  <UsersPage />
                </Lazy>
              }
            />
            <Route
              path="email"
              element={
                <Lazy>
                  <EmailPage />
                </Lazy>
              }
            />
            <Route
              path="email/domains/:id"
              element={
                <Lazy>
                  <EmailDomainPage />
                </Lazy>
              }
            />
            <Route
              path="files"
              element={
                <Lazy>
                  <FilesPage />
                </Lazy>
              }
            />
            <Route
              path="files/public"
              element={
                <Lazy>
                  <PublicFilesPage />
                </Lazy>
              }
            />
            <Route
              path="ftp"
              element={
                <Lazy>
                  <FtpPage />
                </Lazy>
              }
            />
            {/* Merged into /ftp?tab=service */}
            <Route
              path="ftp/service"
              element={<Navigate to="/ftp?tab=service" replace />}
            />
            <Route
              path="bt-tracker"
              element={
                <Lazy>
                  <BtTrackerPage />
                </Lazy>
              }
            />
            <Route
              path="dns"
              element={
                <Lazy>
                  <DnsPage />
                </Lazy>
              }
            />
            {/* Software hub removed — install on feature pages; upgrades on /updates */}
            <Route path="software" element={<Navigate to="/updates" replace />} />
            <Route
              path="cdn"
              element={
                <Lazy>
                  <CdnPage />
                </Lazy>
              }
            />
            <Route
              path="ssl"
              element={
                <Lazy>
                  <SslPage />
                </Lazy>
              }
            />
            <Route
              path="nginx"
              element={
                <Lazy>
                  <NginxPage />
                </Lazy>
              }
            />
            <Route
              path="apache"
              element={
                <Lazy>
                  <ApachePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/node"
              element={
                <Lazy>
                  <NodeRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/php"
              element={
                <Lazy>
                  <PhpRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/python"
              element={
                <Lazy>
                  <PythonRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/go"
              element={
                <Lazy>
                  <GoRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/rust"
              element={
                <Lazy>
                  <RustRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/java"
              element={
                <Lazy>
                  <JavaRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/kotlin"
              element={
                <Lazy>
                  <KotlinRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="runtimes/bun"
              element={
                <Lazy>
                  <BunRuntimePage />
                </Lazy>
              }
            />
            <Route
              path="databases/mysql"
              element={
                <Lazy>
                  <MysqlPage />
                </Lazy>
              }
            />
            <Route
              path="databases/mysql/service"
              element={
                <Lazy>
                  <MysqlServicePage />
                </Lazy>
              }
            />
            <Route
              path="databases/mariadb"
              element={
                <Lazy>
                  <MariadbPage />
                </Lazy>
              }
            />
            <Route
              path="databases/mariadb/service"
              element={
                <Lazy>
                  <MariadbServicePage />
                </Lazy>
              }
            />
            <Route
              path="databases/postgres"
              element={
                <Lazy>
                  <PostgresPage />
                </Lazy>
              }
            />
            <Route
              path="databases/postgres/service"
              element={
                <Lazy>
                  <PostgresServicePage />
                </Lazy>
              }
            />
            <Route
              path="databases/redis"
              element={
                <Lazy>
                  <RedisPage />
                </Lazy>
              }
            />
            <Route
              path="databases/redis/service"
              element={
                <Lazy>
                  <RedisServicePage />
                </Lazy>
              }
            />
            <Route
              path="protection"
              element={
                <Lazy>
                  <ProtectionPage />
                </Lazy>
              }
            />
            <Route
              path="protection/firewall"
              element={
                <Lazy>
                  <FirewallPage />
                </Lazy>
              }
            />
            <Route
              path="protection/fail2ban"
              element={
                <Lazy>
                  <Fail2banPage />
                </Lazy>
              }
            />
            <Route path="firewall" element={<RedirectPreserveQuery to="/protection/firewall" />} />
            <Route path="fail2ban" element={<RedirectPreserveQuery to="/protection/fail2ban" />} />
            <Route
              path="services"
              element={
                <Lazy>
                  <ServicesPage />
                </Lazy>
              }
            />
            <Route
              path="metrics"
              element={
                <Lazy>
                  <MetricsPage />
                </Lazy>
              }
            />
            <Route
              path="network"
              element={
                <Lazy>
                  <NetworkPage />
                </Lazy>
              }
            />
            <Route
              path="browse"
              element={
                <Lazy>
                  <HostBrowsePage />
                </Lazy>
              }
            />
            <Route
              path="vpn"
              element={
                <Lazy>
                  <VpnPage />
                </Lazy>
              }
            />
            <Route
              path="vnc"
              element={
                <Lazy>
                  <VncPage />
                </Lazy>
              }
            />
            <Route
              path="terminal"
              element={
                <Lazy>
                  <TerminalPage />
                </Lazy>
              }
            />
            <Route
              path="logs"
              element={
                <Lazy>
                  <LogsPage />
                </Lazy>
              }
            />
            <Route
              path="cron"
              element={
                <Lazy>
                  <CronPage />
                </Lazy>
              }
            />
            <Route
              path="backups"
              element={
                <Lazy>
                  <BackupsPage />
                </Lazy>
              }
            />
            <Route
              path="system"
              element={
                <Lazy>
                  <SystemPage />
                </Lazy>
              }
            />
            <Route
              path="system/unit"
              element={
                <Lazy>
                  <SystemdUnitPage />
                </Lazy>
              }
            />
            <Route
              path="system/readiness"
              element={
                <Lazy>
                  <ReadinessPage />
                </Lazy>
              }
            />
            <Route
              path="system/migrate"
              element={
                <Lazy>
                  <MigrateHostPage />
                </Lazy>
              }
            />
            <Route
              path="updates"
              element={
                <Lazy>
                  <UpdatesPage />
                </Lazy>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </OpsStreamProvider>
    </ErrorBoundary>
  );
}
