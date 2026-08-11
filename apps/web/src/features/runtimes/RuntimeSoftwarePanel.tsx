/**
 * Runtime software tab — single version list as primary UI.
 * At most one primary CTA per row; uninstall only in ⋯ menu or advanced stack.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  FormHint,
  InstallStreamPanel,
  SoftwareInstallBanner,
  type InstallStreamLine,
} from '../../shared/components/ui';
import {
  hostSatisfiesTarget,
  resolveRuntimeInstallState,
  supportsHostDefault,
  supportsVersionUninstall,
  type RuntimeInstallState,
} from './install-state';
import { RuntimeInstallActions } from './RuntimeInstallActions';
import { RuntimePluginsField } from './RuntimePluginsField';

export type RuntimeProbeItem = {
  version?: unknown;
  available?: unknown;
  active?: unknown;
  versionOutput?: unknown;
  resolvedPath?: unknown;
};

export type RuntimeSoftwarePanelProps = {
  kind: string;
  title: string;
  bannerTitle: string;
  version: string;
  onVersionChange: (v: string) => void;
  supported: string[];
  available: string[];
  hostRaw: string;
  hostDisplay: string;
  items: RuntimeProbeItem[];
  multiVersion: boolean;
  panelDefault: string | null;
  busy?: boolean;
  plugins?: string[];
  onPluginsChange?: (v: string[]) => void;
  pluginsRefreshToken?: number;
  /** Companion tools field (Node etc.). Off for PHP (uses detailExtra extensions). */
  showPlugins?: boolean;
  installLog: InstallStreamLine[];
  installLabel: string;
  /** Install currently selected version (caller should use arg if provided) */
  onInstall: (version?: string) => void;
  onSetHostDefault: (v: string) => void;
  onSetPanelDefault: (v: string) => void;
  onUninstallVersion: (v: string) => void;
  onReprobe?: () => void;
  /** Extra content under selected version (e.g. PHP extensions) */
  detailExtra?: ReactNode;
  remoteHint?: ReactNode;
};

function rowStateFor(
  v: string,
  props: Pick<
    RuntimeSoftwarePanelProps,
    'supported' | 'available' | 'items' | 'hostRaw' | 'multiVersion' | 'kind'
  >,
): RuntimeInstallState {
  return resolveRuntimeInstallState({
    selectedVersion: v,
    supportedVersions: props.supported,
    availableVersions: props.available,
    probeItems: props.items.map((i) => ({
      version: i.version != null ? String(i.version) : undefined,
      available: Boolean(i.available),
      active: Boolean(i.active),
      versionOutput: i.versionOutput != null ? String(i.versionOutput) : undefined,
    })),
    hostDefault: props.hostRaw || null,
    multiVersion: props.multiVersion,
    kind: props.kind,
  });
}

export function RuntimeSoftwarePanel(props: RuntimeSoftwarePanelProps) {
  const { t } = useTranslation();
  const {
    kind,
    title,
    bannerTitle,
    version,
    onVersionChange,
    supported,
    hostRaw,
    hostDisplay,
    items,
    panelDefault,
    busy,
    plugins = [],
    onPluginsChange,
    pluginsRefreshToken = 0,
    showPlugins = true,
    installLog,
    installLabel,
    onInstall,
    onSetHostDefault,
    onSetPanelDefault,
    onUninstallVersion,
    onReprobe,
    detailExtra,
    remoteHint,
  } = props;

  const hostDefaultOk = supportsHostDefault(kind);
  const versionUninstallOk = supportsVersionUninstall(kind);
  const selected = useMemo(
    () => rowStateFor(version, props),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- props bag for row helper
    [version, props.supported, props.available, props.items, props.hostRaw, props.multiVersion, props.kind],
  );

  const selectedItem = items.find(
    (i) =>
      i.available &&
      (String(i.version) === version ||
        hostSatisfiesTarget(String(i.versionOutput ?? ''), version)),
  );

  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  return (
    <div className="tab-panel runtime-software">
      {/* A. Status row */}
      <div className="runtime-software__status" role="group" aria-label={t('runtime.tabSoftware')}>
        <div className="runtime-software__chips">
          <div className="runtime-software__chip">
            <span className="runtime-software__chip-label">{t('runtime.hostDefault')}</span>
            <strong className="runtime-software__chip-value">{hostDisplay || '—'}</strong>
          </div>
          <div className="runtime-software__chip">
            <span className="runtime-software__chip-label">{t('runtime.panelDefaultLabel')}</span>
            <strong className="runtime-software__chip-value">
              {panelDefault || t('runtime.panelDefaultNone')}
            </strong>
          </div>
        </div>
        {onReprobe ? (
          <Button variant="secondary" size="sm" loading={busy} onClick={onReprobe}>
            {t('common.reprobe')}
          </Button>
        ) : null}
      </div>
      <p className="runtime-software__hint muted u-text-sm">{t('runtime.softwareIntro')}</p>

      {/* B. Version list — single source of selection */}
      <Card>
        <CardSection title={t('runtime.versionsTitle')} description={t('runtime.versionsDesc')}>
          {supported.length === 0 ? (
            <EmptyState
              title={t('runtime.pressReprobeHost')}
              description={t('runtime.installScriptNote')}
            />
          ) : (
            <div className="runtime-version-list" role="list">
              {supported.map((v) => {
                const st = rowStateFor(v, props);
                const isSel = v === version;
                const isHost = st.selectedActive;
                const isPanel = panelDefault === v;
                const primary = !st.selectedInstalled
                  ? 'install'
                  : hostDefaultOk && !isHost
                    ? 'host'
                    : null;

                return (
                  <div
                    key={v}
                    role="listitem"
                    className={
                      isSel
                        ? 'runtime-version-row runtime-version-row--selected'
                        : 'runtime-version-row'
                    }
                    onClick={() => onVersionChange(v)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onVersionChange(v);
                      }
                    }}
                    tabIndex={0}
                  >
                    <div className="runtime-version-row__main">
                      <strong className="runtime-version-row__ver">{v}</strong>
                      <div className="runtime-version-row__badges">
                        <Badge tone={st.selectedInstalled ? 'ok' : 'neutral'}>
                          {st.selectedInstalled
                            ? t('common.installed')
                            : t('common.notInstalled')}
                        </Badge>
                        {isHost ? (
                          <Badge tone="info">{t('runtime.roleHost')}</Badge>
                        ) : null}
                        {isPanel ? (
                          <Badge tone="info">{t('runtime.rolePanel')}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className="runtime-version-row__actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {primary === 'install' ? (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busy && isSel}
                          onClick={() => {
                            onVersionChange(v);
                            onInstall(v);
                          }}
                        >
                          {t('common.install')}
                        </Button>
                      ) : null}
                      {primary === 'host' ? (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busy}
                          onClick={() => onSetHostDefault(v)}
                        >
                          {t('runtime.setHostDefault')}
                        </Button>
                      ) : null}
                      {st.selectedInstalled && isHost && primary === null ? (
                        <span className="runtime-version-row__quiet muted u-text-sm">
                          {t('runtime.alreadyHostDefaultShort')}
                        </span>
                      ) : null}
                      {st.selectedInstalled ? (
                        <details
                          className="runtime-row-menu"
                          open={menuOpen === v}
                          onToggle={(e) => {
                            const open = (e.target as HTMLDetailsElement).open;
                            setMenuOpen(open ? v : null);
                          }}
                        >
                          <summary
                            className="runtime-row-menu__sum"
                            aria-label={t('runtime.moreActions')}
                          >
                            ···
                          </summary>
                          <div className="runtime-row-menu__panel" role="menu">
                            {panelDefault !== v ? (
                              <button
                                type="button"
                                className="runtime-row-menu__item"
                                role="menuitem"
                                onClick={() => {
                                  setMenuOpen(null);
                                  onSetPanelDefault(v);
                                }}
                              >
                                {t('runtime.setPanelDefault')}
                              </button>
                            ) : null}
                            {versionUninstallOk ? (
                              <button
                                type="button"
                                className="runtime-row-menu__item runtime-row-menu__item--danger"
                                role="menuitem"
                                onClick={() => {
                                  setMenuOpen(null);
                                  onUninstallVersion(v);
                                }}
                              >
                                {t('runtime.rowUninstall')}
                              </button>
                            ) : null}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardSection>
      </Card>

      {/* C. Selected version detail — install only when missing */}
      <Card>
        <CardSection
          title={t('runtime.selectedVersion', { version })}
          description={
            selected.selectedInstalled
              ? t('runtime.selectedInstalledDesc')
              : t('runtime.selectedMissingDesc')
          }
        >
          <DescriptionList
            columns={2}
            items={[
              { label: t('runtime.targetVersion'), value: version },
              {
                label: t('common.status'),
                value: (
                  <Badge tone={selected.selectedInstalled ? 'ok' : 'warn'}>
                    {selected.selectedInstalled
                      ? t('common.installed')
                      : t('common.notInstalled')}
                  </Badge>
                ),
              },
              {
                label: t('runtime.path'),
                value:
                  selectedItem?.resolvedPath != null
                    ? String(selectedItem.resolvedPath)
                    : '—',
              },
              {
                label: t('runtime.fullVersion'),
                value:
                  selectedItem?.versionOutput != null
                    ? String(selectedItem.versionOutput)
                    : hostRaw && hostSatisfiesTarget(hostRaw, version)
                      ? hostRaw
                      : '—',
              },
            ]}
          />
          {remoteHint}
          {detailExtra}
          {!selected.selectedInstalled ? (
            <>
              {showPlugins && onPluginsChange ? (
                <RuntimePluginsField
                  kind={kind}
                  value={plugins}
                  onChange={onPluginsChange}
                  disabled={busy}
                  refreshToken={pluginsRefreshToken}
                  showInstallButton={false}
                />
              ) : null}
              <RuntimeInstallActions
                installState={selected}
                version={version}
                busy={busy}
                installLabel={installLabel}
                onInstall={() => onInstall()}
              />
              <InstallStreamPanel lines={installLog} busy={busy} />
            </>
          ) : (
            <>
              {showPlugins && onPluginsChange ? (
                <RuntimePluginsField
                  kind={kind}
                  value={plugins}
                  onChange={onPluginsChange}
                  disabled={busy}
                  refreshToken={pluginsRefreshToken}
                  showInstallButton
                />
              ) : null}
              <p className="muted u-text-sm u-mt-2">{t('runtime.useListForDefaults')}</p>
            </>
          )}
        </CardSection>
      </Card>

      {/* E. Advanced stack lifecycle — only full-stack uninstall entry */}
      <details className="runtime-advanced-stack">
        <summary className="runtime-advanced-stack__sum">
          {t('runtime.advancedFeatureUninstall', { name: title })}
        </summary>
        <p className="muted u-text-sm u-mt-2 u-mb-3">
          {t('runtime.advancedFeatureUninstallHint', { name: title })}
        </p>
        <SoftwareInstallBanner
          feature={kind}
          title={bannerTitle}
          readyTitle={t('runtime.stackReadyTitle', { name: title })}
        />
      </details>
    </div>
  );
}
