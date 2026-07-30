/**
 * Professional user detail editor — large modal, sectioned, progressive disclosure.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CAPABILITY_CATALOG,
  OPERATION_LEVELS,
  type CapabilityId,
  type OperationLevel,
  type SystemRole,
} from '@ysk/shared';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  Field,
  Modal,
  MultiCheckSelect,
  PageTabs,
} from '../../shared/components/ui';

export type UserDetailPkg = { id: string; name: string };

export type UserDetailModel = {
  id: string;
  username: string;
  roles: string[];
  packageId?: string;
  packageName?: string;
  suspended?: boolean;
  totpEnabled?: boolean;
  lastSeenAt?: string;
};

type DetailTab = 'account' | 'access' | 'advanced';

const ROLE_ORDER: SystemRole[] = ['admin', 'operator', 'viewer', 'agent'];

function capLabelKey(id: CapabilityId): string {
  const def = CAPABILITY_CATALOG.find((c) => c.id === id);
  return def?.labelKey ?? id;
}

export type UserDetailModalProps = {
  open: boolean;
  user: UserDetailModel | null;
  packages: UserDetailPkg[];
  role: SystemRole;
  packageId: string;
  suspended: boolean;
  password: string;
  grants: CapabilityId[];
  revokes: CapabilityId[];
  effective: CapabilityId[];
  busy?: boolean;
  canImpersonate?: boolean;
  isAdminRole: boolean;
  onRoleChange: (r: SystemRole) => void;
  onPackageChange: (id: string) => void;
  onSuspendedChange: (v: boolean) => void;
  onPasswordChange: (v: string) => void;
  onGrantsChange: (v: CapabilityId[]) => void;
  onRevokesChange: (v: CapabilityId[]) => void;
  onSave: () => void;
  onClose: () => void;
  onImpersonate?: () => void;
  onDelete?: () => void;
  onRestoreOverrides?: () => void;
};

export function UserDetailModal({
  open,
  user,
  packages,
  role,
  packageId,
  suspended,
  password,
  grants,
  revokes,
  effective,
  busy,
  canImpersonate,
  isAdminRole,
  onRoleChange,
  onPackageChange,
  onSuspendedChange,
  onPasswordChange,
  onGrantsChange,
  onRevokesChange,
  onSave,
  onClose,
  onImpersonate,
  onDelete,
  onRestoreOverrides,
}: UserDetailModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DetailTab>('account');

  const initial = user?.username?.charAt(0) || '?';
  const hasOverrides = grants.length > 0 || revokes.length > 0;

  const capOptions = useMemo(
    () =>
      CAPABILITY_CATALOG.map((c) => ({
        value: c.id,
        label: t(capLabelKey(c.id)),
        hint: t(`rbac.level.${c.band}`),
      })),
    [t],
  );

  const byBand = useMemo(() => {
    const map = new Map<OperationLevel, CapabilityId[]>();
    for (const lv of OPERATION_LEVELS) map.set(lv, []);
    for (const id of effective) {
      const def = CAPABILITY_CATALOG.find((c) => c.id === id);
      const band = def?.band ?? 'read';
      map.get(band)?.push(id);
    }
    return map;
  }, [effective]);

  if (!user) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      className="modal--user-detail"
      title={user.username}
      description={t('users.detailDesc')}
      footer={
        <ActionBar align="between" size="md">
          <ActionBar>
            {canImpersonate && onImpersonate ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={onImpersonate}>
                {t('users.impersonate')}
              </Button>
            ) : null}
            {onDelete ? (
              <Button variant="danger" size="sm" disabled={busy} onClick={onDelete}>
                {t('common.delete')}
              </Button>
            ) : null}
          </ActionBar>
          <ActionBar align="end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={onSave}>
              {t('users.saveUser')}
            </Button>
          </ActionBar>
        </ActionBar>
      }
    >
      <div className="user-detail">
        {/* Hero */}
        <div className="user-detail__hero">
          <div className="user-detail__avatar" aria-hidden>
            {initial}
          </div>
          <div className="user-detail__hero-main">
            <h3 className="user-detail__name">{user.username}</h3>
            <p className="user-detail__meta">
              {user.lastSeenAt
                ? t('users.lastSeenValue', {
                    time: new Date(user.lastSeenAt).toLocaleString(),
                  })
                : t('users.neverSeen')}
              {user.packageName || packageId
                ? ` · ${t('users.package')}: ${user.packageName || packages.find((p) => p.id === packageId)?.name || packageId}`
                : ` · ${t('users.noneOption')}`}
            </p>
            <div className="user-detail__badges">
              <Badge tone={role === 'admin' ? 'warn' : 'neutral'}>{role}</Badge>
              <Badge tone={suspended ? 'warn' : 'ok'}>
                {suspended ? t('users.suspended') : t('common.normal')}
              </Badge>
              {user.totpEnabled ? <Badge tone="ok">2FA</Badge> : (
                <Badge tone="neutral">{t('users.no2fa')}</Badge>
              )}
              {hasOverrides ? <Badge tone="info">{t('rbac.overridesBadge')}</Badge> : null}
            </div>
          </div>
        </div>

        <div className="user-detail__tabs">
          <PageTabs
            tabs={[
              { id: 'account', label: t('users.tabAccount') },
              { id: 'access', label: t('users.tabAccess') },
              { id: 'advanced', label: t('users.tabAdvanced') },
            ]}
            active={tab}
            onChange={(id) => setTab(id as DetailTab)}
            variant="scroll"
          >
            {tab === 'account' ? (
              <div className="user-detail__tab-panel">
                <section className="user-detail__section">
                  <div className="user-detail__section-head">
                    <h4 className="user-detail__section-title">{t('users.role')}</h4>
                    <p className="user-detail__section-hint">{t('users.rolePickHint')}</p>
                  </div>
                  <div className="role-card-grid" role="radiogroup" aria-label={t('users.roleAria')}>
                    {ROLE_ORDER.map((r) => (
                      <label
                        key={r}
                        className={`role-card${role === r ? ' is-selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="user-detail-role"
                          value={r}
                          checked={role === r}
                          onChange={() => onRoleChange(r)}
                        />
                        <span className="role-card__title">
                          {t(`users.roleName.${r}`, { defaultValue: r })}
                        </span>
                        <span className="role-card__desc">{t(`users.roleDesc.${r}`)}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="user-detail__section">
                  <div className="user-detail__section-head">
                    <h4 className="user-detail__section-title">{t('users.accountSection')}</h4>
                  </div>
                  <div className="user-detail__grid-2">
                    <Field
                      label={t('users.package')}
                      htmlFor="ud-pkg"
                      flush
                      hint={t('users.packageHint')}
                    >
                      <select
                        id="ud-pkg"
                        value={packageId}
                        onChange={(e) => onPackageChange(e.target.value)}
                      >
                        <option value="">{t('users.noneOption')}</option>
                        {packages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label={t('users.newPassword')}
                      htmlFor="ud-pass"
                      flush
                      hint={t('users.passwordHint')}
                    >
                      <input
                        id="ud-pass"
                        type="password"
                        value={password}
                        onChange={(e) => onPasswordChange(e.target.value)}
                        minLength={8}
                        autoComplete="new-password"
                        placeholder={t('users.resetPasswordOptional')}
                      />
                    </Field>
                  </div>
                  <div className="user-detail__status-row u-mt-4">
                    <div>
                      <div className="user-detail__status-label">{t('users.accountStatus')}</div>
                      <div className="user-detail__status-hint">
                        {suspended ? t('users.suspendedHint') : t('users.activeHint')}
                      </div>
                    </div>
                    <label className="user-switch">
                      <input
                        type="checkbox"
                        checked={suspended}
                        onChange={(e) => onSuspendedChange(e.target.checked)}
                      />
                      {t('users.suspended')}
                    </label>
                  </div>
                </section>
              </div>
            ) : null}

            {tab === 'access' ? (
              <section className="user-detail__section">
                <div className="user-detail__section-head">
                  <h4 className="user-detail__section-title">{t('rbac.effectivePreview')}</h4>
                  <p className="user-detail__section-hint">{t('users.accessHint')}</p>
                </div>
                {isAdminRole ? (
                  <div className="user-detail__fullopen">
                    <span className="user-detail__fullopen-icon" aria-hidden>
                      ✓
                    </span>
                    <div>
                      <strong>{t('rbac.adminLockedFull')}</strong>
                      <p>{t('rbac.adminLockedHint')}</p>
                    </div>
                  </div>
                ) : (
                  <div className="access-bands">
                    {OPERATION_LEVELS.map((band) => {
                      const ids = byBand.get(band) ?? [];
                      return (
                        <div key={band} className="access-band">
                          <div className="access-band__head">
                            <span className="access-band__title">{t(`rbac.level.${band}`)}</span>
                            <Badge tone={ids.length ? 'ok' : 'neutral'}>{ids.length}</Badge>
                          </div>
                          {ids.length === 0 ? (
                            <p className="access-band__empty">{t('users.noCapsInBand')}</p>
                          ) : (
                            <div className="access-band__chips">
                              {ids.map((id) => (
                                <Badge key={id} tone="neutral">
                                  {t(capLabelKey(id))}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null}

            {tab === 'advanced' ? (
              <section className="user-detail__section">
                <div className="user-detail__section-head">
                  <h4 className="user-detail__section-title">{t('rbac.userOverrides')}</h4>
                  <p className="user-detail__section-hint">{t('users.overridesHint')}</p>
                </div>
                {isAdminRole ? (
                  <Alert variant="info">{t('users.adminNoOverrides')}</Alert>
                ) : (
                  <>
                    <Field
                      label={t('rbac.extraGrants')}
                      htmlFor="ud-grants"
                      flush
                      hint={t('users.grantsHint')}
                    >
                      <MultiCheckSelect
                        id="ud-grants"
                        options={capOptions}
                        value={grants}
                        onChange={(v) => onGrantsChange(v as CapabilityId[])}
                        searchPlaceholder={t('users.searchCaps')}
                        emptyText={t('users.noCapMatch')}
                      />
                    </Field>
                    <div className="u-mt-4">
                      <Field
                        label={t('rbac.extraRevokes')}
                        htmlFor="ud-revokes"
                        flush
                        hint={t('users.revokesHint')}
                      >
                        <MultiCheckSelect
                          id="ud-revokes"
                          options={capOptions}
                          value={revokes}
                          onChange={(v) => onRevokesChange(v as CapabilityId[])}
                          searchPlaceholder={t('users.searchCaps')}
                          emptyText={t('users.noCapMatch')}
                        />
                      </Field>
                    </div>
                    {hasOverrides && onRestoreOverrides ? (
                      <ActionBar className="u-mt-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={onRestoreOverrides}
                        >
                          {t('rbac.restoreUserOverrides')}
                        </Button>
                      </ActionBar>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}
          </PageTabs>
        </div>
      </div>
    </Modal>
  );
}
