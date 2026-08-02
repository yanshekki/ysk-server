/**
 * Professional role-policy editor — left role rail, right capability matrix.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CAPABILITY_CATALOG,
  OPERATION_LEVELS,
  SYSTEM_ROLES,
  applyBandToCapabilities,
  factoryRolePolicy,
  type CapabilityId,
  type OperationLevel,
  type SystemRole,
} from '@ysk/shared';
import { bindCall1, bindCall2 } from '../../pages/bind-handlers';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
} from '../../shared/components/ui';

export type RolePolicyView = {
  role: SystemRole;
  dirty: boolean;
  policy: { maxLevel: OperationLevel; capabilities: CapabilityId[] };
  factory: { maxLevel: OperationLevel; capabilities: CapabilityId[] };
};

function capLabelKey(id: CapabilityId): string {
  const def = CAPABILITY_CATALOG.find((c) => c.id === id);
  return def?.labelKey ?? id;
}

type Props = {
  policies: RolePolicyView[];
  policyRole: SystemRole;
  draftMax: OperationLevel;
  draftCaps: CapabilityId[];
  busy?: boolean;
  canEdit: boolean;
  onRoleChange: (r: SystemRole) => void;
  onMaxLevelChange: (lv: OperationLevel) => void;
  onCapsChange: (caps: CapabilityId[]) => void;
  onSave: () => void;
  onRestoreRole: () => void;
  onRestoreAll: () => void;
};

export function RolePermissionsPanel({
  policies,
  policyRole,
  draftMax,
  draftCaps,
  busy,
  canEdit,
  onRoleChange,
  onMaxLevelChange,
  onCapsChange,
  onSave,
  onRestoreRole,
  onRestoreAll,
}: Props) {
  const { t } = useTranslation();
  const policyView = policies.find((p) => p.role === policyRole);
  const factoryCaps =
    policyView?.factory.capabilities ?? factoryRolePolicy(policyRole).capabilities;
  const lockedRole = policyRole === 'admin' || !canEdit;

  // Expand bands that are at/below maxLevel by default
  const [openBands, setOpenBands] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const b of OPERATION_LEVELS) {
      init[b] = OPERATION_LEVELS.indexOf(b) <= OPERATION_LEVELS.indexOf(draftMax);
    }
    return init;
  });

  const enabledCount = draftCaps.length;
  const totalCount = CAPABILITY_CATALOG.filter(
    (c) => OPERATION_LEVELS.indexOf(c.band) <= OPERATION_LEVELS.indexOf(draftMax),
  ).length;

  const bandStats = useMemo(() => {
    return OPERATION_LEVELS.map((band) => {
      const caps = CAPABILITY_CATALOG.filter((c) => c.band === band);
      const on = caps.filter((c) => draftCaps.includes(c.id)).length;
      const locked = OPERATION_LEVELS.indexOf(band) > OPERATION_LEVELS.indexOf(draftMax);
      return { band, total: caps.length, on, locked, caps };
    });
  }, [draftCaps, draftMax]);

  function toggleBandOpen(band: OperationLevel) {
    setOpenBands((prev) => ({ ...prev, [band]: !prev[band] }));
  }

  function setBandAll(band: OperationLevel, enabled: boolean) {
    onCapsChange(applyBandToCapabilities(draftCaps, band, enabled, draftMax));
  }

  return (
    <div className="rbac-panel">
      {!canEdit ? <Alert variant="info">{t('rbac.needRbacPolicy')}</Alert> : null}

      <div className="rbac-panel__layout">
        {/* —— Left: roles —— */}
        <aside className="rbac-panel__roles" aria-label={t('users.role')}>
          <h3 className="rbac-panel__aside-title">{t('rbac.rolePolicy')}</h3>
          <p className="rbac-panel__aside-desc muted u-text-sm">{t('rbac.permissionsDesc')}</p>
          <div className="rbac-role-list" role="tablist">
            {SYSTEM_ROLES.map((r) => {
              const view = policies.find((p) => p.role === r);
              const selected = policyRole === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`rbac-role-item${selected ? ' is-selected' : ''}`}
                  onClick={bindCall1(onRoleChange, r)}
                >
                  <span className="rbac-role-item__name">
                    {t(`users.roleName.${r}`, { defaultValue: r })}
                  </span>
                  <span className="rbac-role-item__meta">
                    {r === 'admin' ? (
                      <Badge tone="ok">{t('rbac.adminLockedFull')}</Badge>
                    ) : view?.dirty ? (
                      <Badge tone="warn">{t('rbac.dirty')}</Badge>
                    ) : (
                      <Badge tone="neutral">{t('rbac.factory')}</Badge>
                    )}
                  </span>
                  <span className="rbac-role-item__hint">
                    {t(`users.roleDesc.${r}`, { defaultValue: '' })}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* —— Right: editor —— */}
        <div className="rbac-panel__main">
          <header className="rbac-panel__toolbar">
            <div className="rbac-panel__toolbar-left">
              <h2 className="rbac-panel__title">
                {t(`users.roleName.${policyRole}`, { defaultValue: policyRole })}
              </h2>
              <p className="rbac-panel__subtitle muted u-text-sm">
                {policyView?.dirty
                  ? t('rbac.dirtyHint', {
                      defaultValue: t('rbac.dirty'),
                    })
                  : t('rbac.factory')}
                {' · '}
                {t('rbac.enabledCount', {
                  enabled: enabledCount,
                  total: totalCount,
                  defaultValue: `${enabledCount} / ${totalCount}`,
                })}
              </p>
            </div>
            <ActionBar align="end" className="rbac-panel__actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={lockedRole || !policyView?.dirty || busy}
                onClick={onRestoreRole}
              >
                {t('rbac.restoreRole')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canEdit || busy}
                onClick={onRestoreAll}
              >
                {t('rbac.restoreAll')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                disabled={lockedRole}
                title={policyRole === 'admin' ? t('rbac.adminLockedFull') : undefined}
                onClick={onSave}
              >
                {t('rbac.save')}
              </Button>
            </ActionBar>
          </header>

          {policyRole === 'admin' ? (
            <Alert variant="info">{t('rbac.adminLockedHint')}</Alert>
          ) : null}

          <fieldset disabled={lockedRole} className="rbac-panel__fieldset">
            {/* Max level */}
            <section className="rbac-section">
              <div className="rbac-section__head">
                <h3 className="rbac-section__title">{t('rbac.maxLevel')}</h3>
                <p className="rbac-section__hint muted u-text-sm">{t('rbac.maxLevelHint')}</p>
              </div>
              <div className="rbac-level-rail" role="radiogroup" aria-label={t('rbac.maxLevel')}>
                {OPERATION_LEVELS.map((lv) => {
                  const selected = draftMax === lv;
                  return (
                    <label
                      key={lv}
                      className={`rbac-level-chip${selected ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="rbac-max-level"
                        value={lv}
                        checked={selected}
                        onChange={() => onMaxLevelChange(lv)}
                      />
                      <span className="rbac-level-chip__label">{t(`rbac.level.${lv}`)}</span>
                    </label>
                  );
                })}
              </div>
            </section>

            {/* Capability bands */}
            <section className="rbac-section">
              <div className="rbac-section__head">
                <h3 className="rbac-section__title">{t('rbac.capabilities')}</h3>
                <p className="rbac-section__hint muted u-text-sm">{t('rbac.capabilitiesHint')}</p>
              </div>

              <div className="rbac-bands">
                {bandStats.map(({ band, total, on, locked, caps }) => {
                  const open = openBands[band] ?? !locked;
                  const allOn = total > 0 && on === total;
                  return (
                    <div
                      key={band}
                      className={`rbac-band${locked ? ' is-locked' : ''}${open ? ' is-open' : ''}`}
                    >
                      <div className="rbac-band__bar">
                        <button
                          type="button"
                          className="rbac-band__toggle"
                          onClick={bindCall1(toggleBandOpen, band)}
                          aria-expanded={open}
                        >
                          <span className="rbac-band__chevron" aria-hidden>
                            {open ? '▾' : '▸'}
                          </span>
                          <span className="rbac-band__name">{t(`rbac.level.${band}`)}</span>
                          <Badge tone={locked ? 'neutral' : allOn ? 'ok' : on > 0 ? 'info' : 'neutral'}>
                            {on}/{total}
                          </Badge>
                          {locked ? (
                            <span className="rbac-band__lock muted u-text-xs">
                              {t('rbac.bandAboveMax')}
                            </span>
                          ) : null}
                        </button>
                        <div className="rbac-band__bulk">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={locked || busy}
                            onClick={bindCall2(setBandAll, band, true)}
                          >
                            {t('rbac.bandAllOn')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={locked || busy}
                            onClick={bindCall2(setBandAll, band, false)}
                          >
                            {t('rbac.bandAllOff')}
                          </Button>
                        </div>
                      </div>

                      {open ? (
                        <ul className="rbac-cap-grid">
                          {caps.map((c) => {
                            const checked = draftCaps.includes(c.id);
                            const factoryHas = factoryCaps.includes(c.id);
                            const differs = checked !== factoryHas;
                            return (
                              <li key={c.id}>
                                <label
                                  className={`rbac-cap${checked ? ' is-on' : ''}${differs ? ' is-diff' : ''}`}
                                  title={c.id}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={locked || busy}
                                    checked={checked}
                                    onChange={(e) => {
                                      const set = new Set(draftCaps);
                                      if (e.target.checked) set.add(c.id);
                                      else set.delete(c.id);
                                      onCapsChange([...set].sort() as CapabilityId[]);
                                    }}
                                  />
                                  <span className="rbac-cap__text">
                                    <span className="rbac-cap__label">{t(capLabelKey(c.id))}</span>
                                    {differs ? (
                                      <span className="rbac-cap__diff" title={t('rbac.diffFromFactory')}>
                                        ·
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </fieldset>
        </div>
      </div>
    </div>
  );
}
