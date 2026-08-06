/**
 * Shared **runtime version** install CTA only.
 * Companion tools / PHP extensions install via their own「安裝選定…」buttons above.
 * - Disabled when selected version already installed
 * - Go/Rust: "switch default" when installed but not active
 * - Optional "switch to newer version" chip select
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
  onSwitch,
  onSelectNewer,
  extraHints,
}: {
  installState: RuntimeInstallState;
  version: string;
  busy?: boolean;
  /** Primary when installing e.g. t('runtime.installNodeVBtn', {version}) */
  installLabel: string;
  onInstall: () => void;
  /** Go/Rust: make selected installed version the active default */
  onSwitch?: () => void;
  onSelectNewer?: (v: string) => void;
  extraHints?: ReactNode;
}) {
  const { t } = useTranslation();
  const already = installState.installDisabled;
  const canSwitch = Boolean(installState.canSwitch && onSwitch);
  const primaryLabel = already
    ? installState.selectedActive
      ? t('runtime.installedVersionBtn', { version })
      : t('runtime.installedNotActive', {
          version,
          defaultValue: `${version} 已安裝（非預設）`,
        })
    : installLabel;

  return (
    <>
      {installState.canSwitch ? (
        <FormHint>
          {t('runtime.switchDefaultHint', {
            version,
            defaultValue:
              '此版本已安裝但不是目前預設。可「切換為預設」而無需重裝；亦可安裝其他版本並存。',
          })}
        </FormHint>
      ) : installState.selectedInstalled ? (
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
        {canSwitch ? (
          <Button variant="secondary" size="md" loading={busy} onClick={onSwitch}>
            {t('runtime.switchDefaultBtn', {
              version,
              defaultValue: `切換為預設 ${version}`,
            })}
          </Button>
        ) : null}
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
