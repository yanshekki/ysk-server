import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './layout/RequireAuth';
import { GuestOnly } from './layout/GuestOnly';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { SecurityPage } from '../pages/SecurityPage';
import { EmailPage } from '../pages/EmailPage';
import { EmailDomainPage } from '../pages/EmailDomainPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { ProjectDetailPage } from '../pages/ProjectDetailPage';
import { UpdatesPage } from '../pages/UpdatesPage';
import { AgentsPage } from '../pages/AgentsPage';
import { AiPage } from '../pages/AiPage';
import { FilesPage } from '../pages/FilesPage';
import { SystemPage } from '../pages/SystemPage';
import { NginxPage } from '../pages/features/NginxPage';
import { PhpRuntimePage } from '../pages/features/PhpRuntimePage';
import {
  GoRuntimePage,
  NodeRuntimePage,
  PythonRuntimePage,
  RustRuntimePage,
} from '../pages/features/GenericRuntimePage';
import { SslPage } from '../pages/features/SslPage';
import { DnsPage } from '../pages/features/DnsPage';
import { FtpPage } from '../pages/features/FtpPage';
import { FtpsServicePage } from '../pages/features/FtpsServicePage';
import { FirewallPage } from '../pages/features/FirewallPage';
import { Fail2banPage } from '../pages/features/Fail2banPage';
import { ProtectionPage } from '../pages/features/ProtectionPage';
import { MysqlPage } from '../pages/features/MysqlPage';
import { MariadbPage } from '../pages/features/MariadbPage';
import { MysqlServicePage } from '../pages/features/MysqlServicePage';
import { MariadbServicePage } from '../pages/features/MariadbServicePage';
import { PostgresServicePage } from '../pages/features/PostgresServicePage';
import { RedisServicePage } from '../pages/features/RedisServicePage';
import { PostgresPage } from '../pages/features/PostgresPage';
import { RedisPage } from '../pages/features/RedisPage';
import { ServicesPage } from '../pages/features/ServicesPage';
import { SystemdUnitPage } from '../pages/features/SystemdUnitPage';
import { ReadinessPage } from '../pages/features/ReadinessPage';
import { MigrateHostPage } from '../pages/features/MigrateHostPage';
import { PublicFilesPage } from '../pages/features/PublicFilesPage';
import { CronPage } from '../pages/features/CronPage';
import { BackupsPage } from '../pages/features/BackupsPage';
import { MetricsPage } from '../pages/features/MetricsPage';
import { NetworkPage } from '../pages/features/NetworkPage';
import { LogsPage } from '../pages/features/LogsPage';
import { UsersPage } from '../pages/UsersPage';

/**
 * Each major capability has its own route/page.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="ai" element={<AiPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="email" element={<EmailPage />} />
          <Route path="email/domains/:id" element={<EmailDomainPage />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="files/public" element={<PublicFilesPage />} />
          <Route path="ftp" element={<FtpPage />} />
          <Route path="ftp/service" element={<FtpsServicePage />} />
          <Route path="dns" element={<DnsPage />} />
          <Route path="ssl" element={<SslPage />} />
          <Route path="nginx" element={<NginxPage />} />
          <Route path="runtimes/node" element={<NodeRuntimePage />} />
          <Route path="runtimes/php" element={<PhpRuntimePage />} />
          <Route path="runtimes/python" element={<PythonRuntimePage />} />
          <Route path="runtimes/go" element={<GoRuntimePage />} />
          <Route path="runtimes/rust" element={<RustRuntimePage />} />
          <Route path="databases/mysql" element={<MysqlPage />} />
          <Route path="databases/mysql/service" element={<MysqlServicePage />} />
          <Route path="databases/mariadb" element={<MariadbPage />} />
          <Route path="databases/mariadb/service" element={<MariadbServicePage />} />
          <Route path="databases/postgres" element={<PostgresPage />} />
          <Route path="databases/postgres/service" element={<PostgresServicePage />} />
          <Route path="databases/redis" element={<RedisPage />} />
          <Route path="databases/redis/service" element={<RedisServicePage />} />
          <Route path="protection" element={<ProtectionPage />} />
          <Route path="firewall" element={<FirewallPage />} />
          <Route path="fail2ban" element={<Fail2banPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="metrics" element={<MetricsPage />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="cron" element={<CronPage />} />
          <Route path="backups" element={<BackupsPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="system/unit" element={<SystemdUnitPage />} />
          <Route path="system/readiness" element={<ReadinessPage />} />
          <Route path="system/migrate" element={<MigrateHostPage />} />
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="agents" element={<AgentsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
