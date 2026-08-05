/**
 * Shared install CTA block for language runtimes:
 * - disabled when selected version already installed and no addons selected
 * - label switches to "installed" / "install addons only"
 * - optional "switch to newer version" button
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FormActions, FormHint } from '../../shared/components/ui';
import type { RuntimeInstallState } from './install-state';

export function RuntimeInstallActions({
  installState,
  version,
  busy,
  hasAddonsSelected,
  installLabel,
  onInstall,
  onSelectNewer,
  extraHints,
}: {
  installState: RuntimeInstallState;
  version: string;
  busy?: boolean;
  /** extensions or plugins selected beyond bare runtime */
  hasAddonsSelected: boolean;
  /** Primary button when installing fresh e.g. t('runtime.installNodeVBtn', {version}) */
  installLabel: string;
  onInstall: () => void;
  onSelectNewer?: (v: string) => void;
  extraHints?: ReactNode;
}) {
  const { t } = useTranslation();
  const disabled = installState.installDisabled && !hasAddonsSelected;

  let primaryLabel = installLabel;
  if (installState.installDisabled && hasAddonsSelected) {
    primaryLabel = t('runtime.installAddonsOnly', { version });
  } else if (installState.installDisabled) {
    primaryLabel = t('runtime.installedVersionBtn', { version });
  }

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
          disabled={disabled}
          title={
            disabled ? t('runtime.versionAlreadyInstalled', { version }) : undefined
          }
          onClick={onInstall}
        >
          {primaryLabel}
        </Button>
        {installState.newerAvailable[0] && installState.installDisabled && onSelectNewer ? (
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
