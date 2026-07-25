import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { RequireAuth } from './layout/RequireAuth';
import { GuestOnly } from './layout/GuestOnly';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { SecurityPage } from '../pages/SecurityPage';
import { EmailPage } from '../pages/EmailPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { UpdatesPage } from '../pages/UpdatesPage';
import { AgentsPage } from '../pages/AgentsPage';

/**
 * Unauthenticated users only reach /login.
 * All product pages require auth and render inside AppShell.
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
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="email" element={<EmailPage />} />
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="agents" element={<AgentsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
