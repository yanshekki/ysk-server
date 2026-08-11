/**
 * Software hub removed — install on feature pages; upgrades live on /updates.
 * Kept as redirect for bookmarks and old links.
 */
import { Navigate } from 'react-router-dom';

export function SoftwareHubPage() {
  return <Navigate to="/updates" replace />;
}
