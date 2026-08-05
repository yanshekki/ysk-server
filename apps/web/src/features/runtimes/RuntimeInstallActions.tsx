/**
 * Shared **runtime version** install CTA only.
 * Companion tools / PHP extensions install via their own「安裝選定…」buttons above.
 * - Disabled when selected version already installed
 * - Optional "switch to newer version" button
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FormActions, FormHint } from '../../shared/components/ui';
import type { RuntimeInstallState } from './install-state';

export function RuntimeInstallActions({
  installState,
  version,
  busy,
  installLabel,
  onInstall,
  onSelectNewer,
  extraHints,
}: {
  installState: RuntimeInstallState;
  version: string;
  busy?: boolean;
  /** Primary when installing e.g. t('runtime.installNodeVBtn', {version}) */
  installLabel: string;
  onInstall: () => void;
  onSelectNewer?: (v: string) => void;
  extraHints?: ReactNode;
}) {
  const { t } = useTranslation();
  const already = installState.installDisabled;
  const primaryLabel = already
    ? t('runtime.installedVersionBtn', { version })
    : installLabel;

  return (
    <>
      {installState.selectedInstalled ? (
        <FormHint>{t('runtime.versionAlreadyInstalled', { version })}</FormHint>
      ) : installState.newerAvailable.length > 0 ? (
        <FormHint>
          {t('runtime.newerVersionAvailable', {
            current: installState.newestInstalled ?? '—',
            newer: installState.newerAvailable.join(', '),
          })}
        </FormHint>
      ) : null}
      {extraHints}
      <FormActions>
        <Button
          variant="primary"
          size="md"
          loading={busy}
          disabled={already}
          title={already ? t('runtime.versionAlreadyInstalled', { version }) : undefined}
          onClick={onInstall}
        >
          {primaryLabel}
        </Button>
        {installState.newerAvailable[0] && already && onSelectNewer ? (
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => onSelectNewer(installState.newerAvailable[0]!)}
          >
            {t('runtime.switchToNewer', {
              version: installState.newerAvailable[0],
            })}
          </Button>
        ) : null}
      </FormActions>
    </>
  );
}
