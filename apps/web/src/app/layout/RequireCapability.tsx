/**
 * Block SPA routes when effective capabilities lack any-of required set.
 * Admin system role always allowed (full-open).
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { canAccessPath } from '@ysk-server/shared';
import { useCapabilities } from '../../shared/hooks/useCapabilities';
import { useAuth } from '../../shared/hooks/useAuth';
import { LoadingBlock } from '../../shared/components/ui';
import { useTranslation } from 'react-i18next';

export function RequireCapability({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { capabilities, loaded } = useCapabilities();
  const { user } = useAuth();
  const location = useLocation();

  if (!loaded) {
    return <LoadingBlock label={t('common.loading', { defaultValue: 'Loading…' })} />;
  }

  // Panel admin always full access
  if (user?.roles?.includes('admin')) {
    return <>{children}</>;
  }

  if (!canAccessPath(location.pathname, capabilities)) {
    return <Navigate to="/" replace state={{ forbiddenPath: location.pathname }} />;
  }

  return <>{children}</>;
}
