import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  SegRadio } from '../../../shared/components/ui';
import { sshApi } from './api';
import {
  nextAction,
  pipelineStep,
  purposeHint,
  purposeLabel,
  shortFingerprint,
  statusLabel,
  statusTone } from './labels';
import type { ProjectOpt, SshIdentityRow } from './types';
import { bindCall1, bindCheck, bindClipboard, bindInput, bindRefreshCatch, bindSet, bindVoid } from '../../../pages/bind-handlers';

type Filter = 'active' | 'panel' | 'user' | 'retired' | 'all';

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
  onChanged: () => void;
};

export function OutboundIdentities({ onFlash, onChanged }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SshIdentityRow[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // wizard
  const [wizOpen, setWizOpen] = useState(false);
  const [wizStep, setWizStep] = useState<1 | 2 | 3>(1);
  const [purpose, setPurpose] = useState<'panel_outbound' | 'user_outbound'>('panel_outbound');
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [installNow, setInstallNow] = useState(false);
  const [algo, setAlgo] = useState<'ed25519' | 'rsa-4096'>('ed25519');

  // reveal private one-time
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [revealFp, setRevealFp] = useState<string | null>(null);
  const [revealAck, setRevealAck] = useState(false);
  const [revealNextId, setRevealNextId] = useState<string | null>(null);

  // test modal
  const [testId, setTestId] = useState<string | null>(null);
  const [testTarget, setTestTarget] = useState('root@');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // confirm
  const [confirm, setConfirm] = useState<
    null | { kind: 'delete' | 'rotate'; id: string; name: string }
  >(null);

  const refresh = useCallback(async () => {
    setLoadErr(null);
    const [ids, projs] = await Promise.all([sshApi.listIdentities(), sshApi.listProjects()]);
    setItems(ids.items ?? []);
    setProjects(projs);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setLoadErr(e.message));
  }, [refresh]);

  const filtered = useMemo(() => {
    let list = items;
    if (filter === 'active') list = list.filter((i) => i.status !== 'retired');
    if (filter === 'panel') list = list.filter((i) => i.purpose === 'panel_outbound');
    if (filter === 'user') list = list.filter((i) => i.purpose === 'user_outbound');
    if (filter === 'retired') list = list.filter((i) => i.status === 'retired');
    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(qq) ||
          i.fingerprintSha256.toLowerCase().includes(qq) ||
          (i.binding?.linuxUser ?? '').toLowerCase().includes(qq),
      );
    }
    return list;
  }, [items, filter, q]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  function openWizard() {
    setWizStep(1);
    setPurpose('panel_outbound');
    setProjectId(projects[0]?.id ?? '');
    setName('');
    setInstallNow(false);
    setAlgo('ed25519');
    setWizOpen(true);
  }

  function defaultName(): string {
    if (purpose === 'user_outbound') {
      const p = projects.find((x) => x.id === projectId);
      return p ? `${p.name}-outbound` : 'project-outbound';
    }
    return 'panel-peer';
  }

  async function submitCreate() {
    setBusy(true);
    try {
      const proj = projects.find((p) => p.id === projectId);
      const r = await sshApi.createIdentity({
        name: (name.trim() || defaultName()).slice(0, 64),
        algorithm: algo,
        purpose,
        revealPrivate: true,
        install: installNow,
        binding:
          purpose === 'user_outbound' && proj
            ? {
                projectId: proj.id,
                linuxUser: proj.linuxUser,
                homeDir: proj.homeDir }
            : undefined });
      if (!r.ok) {
        onFlash('error', (r.notes ?? []).join(' · ') || t('security.ssh.createFailed'));
        return;
      }
      setWizOpen(false);
      if (r.privateKey) {
        setRevealKey(r.privateKey);
        setRevealFp(r.identity?.fingerprintSha256 ?? null);
        setRevealAck(false);
        setRevealNextId(r.identity?.id ?? null);
      }
      onFlash('ok', t('security.ssh.identityCreatedOnce'));
      await refresh();
      onChanged();
      if (r.identity) setSelectedId(r.identity.id);
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : t('security.ssh.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function runInstall(id: string) {
    setBusy(true);
    try {
      const r = await sshApi.install(id, true);
      onFlash(
        r.ok && r.applied ? 'ok' : r.blocked ? 'error' : 'ok',
        (r.notes ?? []).join(' · ') ||
          (r.applied
            ? t('security.ssh.writtenToDisk')
            : r.blocked
              ? t('security.ssh.cannotWriteNeedExecute')
              : t('security.ssh.notDone')),
      );
      await refresh();
      onChanged();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : t('security.ssh.installFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    if (!testId || !testTarget.trim()) return;
    setBusy(true);
    try {
      const r = await sshApi.test(testId, testTarget.trim(), true);
      const text =
        (r.notes ?? []).join(' · ') ||
        (r.ok ? t('security.ssh.testPassed') : t('security.ssh.testFailed'));
      onFlash(r.ok ? 'ok' : 'error', text);
      setTestResult({ ok: Boolean(r.ok), text });
      if (r.ok) {
        setTestId(null);
        setTestResult(null);
      }
      await refresh();
      onChanged();
    } catch (e) {
      const text = e instanceof Error ? e.message : t('security.ssh.testError');
      setTestResult({ ok: false, text });
      onFlash('error', text);
    } finally {
      setBusy(false);
    }
  }

  async function runPrimary(row: SshIdentityRow) {
    const act = nextAction(row.status, row.purpose, t);
    if (act.id === 'install') return runInstall(row.id);
    if (act.id === 'test') {
      setTestTarget(row.binding?.linuxUser ? `${row.binding.linuxUser}@` : 'root@');
      setTestResult(null);
      setTestId(row.id);
      return;
    }
    if (act.id === 'copy_pub') {
      void navigator.clipboard?.writeText(row.publicKey);
      onFlash('ok', t('security.ssh.copiedPubPaste'));
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'delete') {
        await sshApi.remove(confirm.id, true);
        onFlash('ok', t('security.ssh.deletedNamed', { name: confirm.name }));
        if (selectedId === confirm.id) setSelectedId(null);
      } else {
        const r = await sshApi.rotate(confirm.id, true);
        if (r.privateKey) {
          setRevealKey(r.privateKey);
          setRevealFp(r.newIdentity?.fingerprintSha256 ?? null);
          setRevealAck(false);
          setRevealNextId(r.newIdentity?.id ?? null);
        }
        onFlash('ok', t('security.ssh.rotated'));
        if (r.newIdentity) setSelectedId(r.newIdentity.id);
      }
      setConfirm(null);
      await refresh();
      onChanged();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-gap">
      {loadErr ? <Alert variant="error">{loadErr}</Alert> : null}

      <Card>
        <CardSection
          title={t('security.ssh.outboundTitle')}
          description={t('security.ssh.outboundDesc')}
        >
          <ActionBar className="u-mb-3 u-flex-wrap">
            <Button variant="primary" size="md" onClick={openWizard}>
              {t('security.ssh.outboundAdd')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={bindRefreshCatch(refresh, setLoadErr)}
            >
              {t('common.refresh')}
            </Button>
          </ActionBar>

          <div className="ssh-filters">
            {(
              [
                ['active', t('security.ssh.filterActive')],
                ['panel', t('security.ssh.filterPanel')],
                ['user', t('security.ssh.filterUser')],
                ['retired', t('security.ssh.filterRetired')],
                ['all', t('security.ssh.filterAll')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`ssh-filter${filter === id ? ' is-on' : ''}`}
                onClick={bindSet(setFilter, id)}
              >
                {label}
              </button>
            ))}
            <input
              className="ssh-filter-search"
              placeholder={t('security.ssh.searchIdentity')}
              value={q}
              onChange={bindInput(setQ)}
              aria-label={t('security.ssh.searchIdentityAria')}
            />
          </div>
        </CardSection>
      </Card>

      <div className={`ssh-split${selected ? ' has-detail' : ''}`}>
        <Card className="ssh-split__list">
          <CardSection title={filtered.length ? t('security.ssh.identityCount', { count: filtered.length }) : t('security.ssh.identityList')}>
            {filtered.length === 0 ? (
              <EmptyState
                title={items.length === 0 ? t('security.ssh.outboundEmpty') : t('security.ssh.outboundEmptyFilter')}
                description={
                  items.length === 0
                    ? t('security.ssh.outboundEmptyHint')
                    : t('security.ssh.outboundEmptyFilterHint')
                }
              />
            ) : (
              <div className="list-panel">
                {filtered.map((row) => {
                  const act = nextAction(row.status, row.purpose, t);
                  const on = selectedId === row.id;
                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      className={`list-row${on ? ' is-selected' : ''}`}
                      onClick={bindSet(setSelectedId, row.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(row.id);
                        }
                      }}
                    >
                      <div className="list-row__main">
                        <div className="list-row__title">
                          <span>{row.name}</span>
                          <Badge
                            tone={statusTone(row.status)}
                            title={
                              row.lastVerifyNote ||
                              (row.status === 'error' ? t('security.ssh.errorNoDetail') : undefined)
                            }
                          >
                            {statusLabel(row.status, t)}
                          </Badge>
                          <Badge tone="neutral">{purposeLabel(row.purpose, t)}</Badge>
                        </div>
                        <div className="list-row__meta">
                          <span title={row.fingerprintSha256} className="u-font-mono">
                            {shortFingerprint(row.fingerprintSha256)}
                          </span>
                          {row.binding?.linuxUser ? (
                            <span>{t('security.ssh.userPrefix', { user: row.binding.linuxUser })}</span>
                          ) : null}
                          <span className="muted">{row.algorithm}</span>
                          {row.lastVerifyNote ? (
                            <span className="muted u-text-sm">{row.lastVerifyNote}</span>
                          ) : row.status === 'error' ? (
                            <span className="muted u-text-sm">{t('security.ssh.errorNoDetail')}</span>
                          ) : null}
                        </div>
                      </div>
                      <div className="list-row__side" onClick={(e) => e.stopPropagation()}>
                        {act.id !== 'none' ? (
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={bindCall1(runPrimary, row)}
                          >
                            {act.label}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardSection>
        </Card>

        {selected ? (
          <Card className="ssh-split__detail">
            <CardSection title={selected.name} description={purposeHint(selected.purpose, t)}>
              <ActionBar className="u-mb-3 u-justify-end">
                <Button variant="ghost" size="sm" onClick={bindSet(setSelectedId, null)}>
                  {t('common.close')}
                </Button>
              </ActionBar>
              <StatusPipeline status={selected.status} />

              <dl className="ssh-facts">
                <div>
                  <dt>{t('security.ssh.detailStatus')}</dt>
                  <dd>
                    <Badge
                      tone={statusTone(selected.status)}
                      title={
                        selected.lastVerifyNote ||
                        (selected.status === 'error' ? t('security.ssh.errorNoDetail') : undefined)
                      }
                    >
                      {statusLabel(selected.status, t)}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>{t('security.ssh.detailPurpose')}</dt>
                  <dd>{purposeLabel(selected.purpose, t)}</dd>
                </div>
                <div>
                  <dt>Fingerprint</dt>
                  <dd className="u-font-mono u-break-all u-text-sm">
                    {selected.fingerprintSha256}
                  </dd>
                </div>
                {selected.binding?.linuxUser ? (
                  <div>
                    <dt>{t('security.ssh.detailLinuxUser')}</dt>
                    <dd>
                      {selected.binding.linuxUser}
                      {selected.binding.homeDir ? (
                        <div className="muted u-text-sm">{selected.binding.homeDir}</div>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {selected.install?.path ? (
                  <div>
                    <dt>{t('security.ssh.detailDiskPath')}</dt>
                    <dd className="u-font-mono u-text-sm u-break-all">
                      {selected.install.path}
                    </dd>
                  </div>
                ) : null}
                {selected.lastVerifyNote ? (
                  <div>
                    <dt>{t('security.ssh.detailLastTest')}</dt>
                    <dd className="u-text-sm">{selected.lastVerifyNote}</dd>
                  </div>
                ) : null}
              </dl>

              <FormHint>
                {t('security.ssh.suggestFlowPrefix')}<strong>{t('security.ssh.publicKeyStrong')}</strong>{t('security.ssh.suggestFlowSuffix')}
              </FormHint>

              <div className="ssh-detail-actions">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={bindCall1(runPrimary, selected)}
                >
                  {nextAction(selected.status, selected.purpose, t).label || t('security.ssh.actionCopyPub')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    void navigator.clipboard?.writeText(selected.publicKey);
                    onFlash('ok', t('security.ssh.copiedPub'));
                  }}
                >
                  {t('security.ssh.actionCopyPub')}
                </Button>
                {(selected.binding?.linuxUser || selected.binding?.projectId) &&
                selected.status !== 'retired' ? (
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      void sshApi
                        .authorizeSelf(selected.id)
                        .then((r) => {
                          onFlash(
                            r.ok ? 'ok' : 'error',
                            (r.notes ?? []).join(' · ') ||
                              (r.ok ? t('security.ssh.localLoginOk') : t('common.failed')),
                          );
                        })
                        .catch((e: Error) => onFlash('error', e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t('security.ssh.allowLocalLogin')}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setTestTarget(
                      selected.binding?.linuxUser
                        ? `${selected.binding.linuxUser}@`
                        : 'root@',
                    );
                    setTestId(selected.id);
                  }}
                >
                  {t('security.ssh.testingConnection')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={selected.status === 'retired'}
                  onClick={() =>
                    setConfirm({ kind: 'rotate', id: selected.id, name: selected.name })
                  }
                >
                  {t('security.ssh.rotateKey')}
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={() =>
                    setConfirm({ kind: 'delete', id: selected.id, name: selected.name })
                  }
                >
                  {t('common.delete')}
                </Button>
              </div>
            </CardSection>
          </Card>
        ) : null}
      </div>

      {/* —— Create wizard —— */}
      <Modal
        open={wizOpen}
        onClose={bindSet(setWizOpen, false)}
        title={
          wizStep === 1
            ? t('security.ssh.wizStepPurpose')
            : wizStep === 2
              ? purpose === 'user_outbound'
                ? t('security.ssh.wizStepProject')
                : t('security.ssh.wizStepPanelConfirm')
              : t('security.ssh.wizStepName')
        }
        description={
          wizStep === 1
            ? t('security.ssh.wizStepPurposeDesc')
            : wizStep === 2
              ? purpose === 'user_outbound'
                ? t('security.ssh.wizStepProjectDesc')
                : t('security.ssh.wizStepPanelDesc')
              : t('security.ssh.wizStepNameDesc')
        }
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (wizStep === 1) setWizOpen(false);
                else setWizStep((s) => (s === 3 ? 2 : 1));
              }}
            >
              {wizStep === 1 ? t('common.cancel') : t('security.ssh.prevStep')}
            </Button>
            {wizStep < 3 ? (
              <Button
                variant="primary"
                size="md"
                disabled={wizStep === 2 && purpose === 'user_outbound' && !projectId}
                onClick={() => {
                  if (wizStep === 1) setWizStep(2);
                  else {
                    if (!name) setName(defaultName());
                    setWizStep(3);
                  }
                }}
              >
                {t('security.ssh.nextStep')}
              </Button>
            ) : (
              <Button variant="primary" size="md" loading={busy} onClick={bindVoid(submitCreate)}>
                {t('security.ssh.createIdentity')}
              </Button>
            )}
          </>
        }
      >
        {wizStep === 1 ? (
          <div className="ssh-purpose-grid">
            <button
              type="button"
              className={`ssh-purpose-card${purpose === 'panel_outbound' ? ' is-on' : ''}`}
              onClick={bindSet(setPurpose, 'panel_outbound')}
            >
              <strong>{t('security.ssh.purposePanelTitle')}</strong>
              <span>{t('security.ssh.purposePanelSub')}</span>
              <span className="muted u-text-sm">{t('security.ssh.purposePanelRec')}</span>
            </button>
            <button
              type="button"
              className={`ssh-purpose-card${purpose === 'user_outbound' ? ' is-on' : ''}`}
              onClick={bindSet(setPurpose, 'user_outbound')}
            >
              <strong>{t('security.ssh.purposeUserTitle')}</strong>
              <span>{t('security.ssh.purposeUserSub')}</span>
              <span className="muted u-text-sm">{t('security.ssh.purposeUserPath')}</span>
            </button>
          </div>
        ) : null}

        {wizStep === 2 && purpose === 'user_outbound' ? (
          <Field label={t('common.project')} htmlFor="wiz-proj" flush fullWidth required>
            <select
              id="wiz-proj"
              value={projectId}
              onChange={bindInput(setProjectId)}
            >
              <option value="">{t('security.ssh.selectProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.linuxUser}
                </option>
              ))}
            </select>
            {projects.length === 0 ? (
              <FormHint>{t('security.ssh.noProjectsHint')}</FormHint>
            ) : null}
          </Field>
        ) : null}

        {wizStep === 2 && purpose === 'panel_outbound' ? (
          <div className="ssh-callout">
            <p>
              {t('security.ssh.afterCreatePub')}<strong>{t('security.ssh.publicKeyStrong')}</strong>{t('security.ssh.afterCreatePubMid')}{' '}
              <code className="inline">authorized_keys</code>
              {t('security.ssh.afterCreatePubEnd')}
            </p>
            <p className="muted u-text-sm u-mb-0">
              {t('security.ssh.privKeyStayLocal')}
            </p>
          </div>
        ) : null}

        {wizStep === 3 ? (
          <FormLayout columns={1}>
            <Field label={t('security.ssh.displayName')} htmlFor="wiz-name" flush required hint={t('security.ssh.displayNameHint')}>
              <input
                id="wiz-name"
                value={name}
                onChange={bindInput(setName)}
                placeholder={defaultName()}
                spellCheck={false}
              />
            </Field>
            <Field label={t('security.ssh.algorithm')} htmlFor="wiz-algo" flush>
              <SegRadio
                name="wiz-algo"
                aria-label={t('security.ssh.algorithm')}
                value={algo}
                onChange={setAlgo}
                options={[
                  { value: 'ed25519', label: 'ed25519', hint: t('security.ssh.algoSuggested') },
                  { value: 'rsa-4096', label: 'RSA 4096', hint: t('security.ssh.algoLegacy') },
                ]}
              />
            </Field>
            <label className="ssh-check">
              <input
                type="checkbox"
                checked={installNow}
                onChange={bindCheck(setInstallNow)}
              />
              <span>
                {t('security.ssh.installImmediately')}
                <span className="muted u-text-sm">
                  {' '}
                  {t('security.ssh.installImmediatelyHint')}
                </span>
              </span>
            </label>
          </FormLayout>
        ) : null}
      </Modal>

      {/* private reveal */}
      <Modal
        open={Boolean(revealKey)}
        onClose={() => {
          if (revealKey && !revealAck) {
            onFlash('warn', t('security.ssh.privCloseWithoutAck'));
          }
          setRevealKey(null);
          setRevealFp(null);
          setRevealNextId(null);
          setRevealAck(false);
        }}
        title={t('security.ssh.savePrivTitle')}
        description={t('security.ssh.savePrivDesc')}
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (revealKey) void navigator.clipboard?.writeText(revealKey);
                onFlash('ok', t('security.ssh.copiedPriv'));
              }}
            >
              {t('security.ssh.copyPriv')}
            </Button>
            {revealNextId ? (
              <Button
                variant="secondary"
                size="md"
                loading={busy}
                onClick={() => {
                  const id = revealNextId;
                  setRevealKey(null);
                  setRevealAck(false);
                  void runInstall(id);
                }}
              >
                {t('security.ssh.nextInstallDisk')}
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="md"
              disabled={!revealAck}
              onClick={() => {
                setRevealKey(null);
                setRevealFp(null);
                setRevealNextId(null);
                setRevealAck(false);
              }}
            >
              {t('security.ssh.savedCloseBtn')}
            </Button>
          </>
        }
      >
        {revealFp ? (
          <FormHint>
            Fingerprint：<code className="inline u-break-all">{revealFp}</code>
          </FormHint>
        ) : null}
        <Field label={t('security.ssh.privKeyOnce')} htmlFor="reveal-priv" flush fullWidth>
          <textarea
            id="reveal-priv"
            rows={8}
            readOnly
            value={revealKey ?? ''}
            className="u-font-mono"
            spellCheck={false}
          />
        </Field>
        <label className="ssh-check u-mt-3">
          <input
            type="checkbox"
            checked={revealAck}
            onChange={bindCheck(setRevealAck)}
          />
          <span>{t('security.ssh.privSavedConfirm')}</span>
        </label>
      </Modal>

      {/* test */}
      <Modal
        open={Boolean(testId)}
        onClose={bindSet(setTestId, null)}
        title={t('security.ssh.testConnTitle')}
        description={t('security.ssh.testConnDesc')}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setTestId(null);
                setTestResult(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!testTarget.includes('@')}
              onClick={bindVoid(runTest)}
            >
              {t('security.ssh.startTest')}
            </Button>
          </>
        }
      >
        {testResult ? (
          <Alert variant={testResult.ok ? 'ok' : 'error'} className="u-mb-3">
            {testResult.text}
          </Alert>
        ) : null}
        <Field
          label={t('security.ssh.testTarget')}
          htmlFor="test-target"
          flush
          required
          hint={t('security.ssh.testTargetHint')}
        >
          <input
            id="test-target"
            value={testTarget}
            onChange={bindInput(setTestTarget)}
            placeholder="root@10.0.0.2"
            spellCheck={false}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={bindSet(setConfirm, null)}
        onConfirm={bindVoid(confirmAction)}
        title={confirm?.kind === 'delete' ? t('security.ssh.deleteIdentityTitle') : t('security.ssh.rotateKeyTitle')}
        description={
          confirm?.kind === 'delete'
            ? t('security.ssh.deleteIdentityDesc', { name: confirm?.name })
            : t('security.ssh.rotateKeyDesc', { name: confirm?.name })
        }
        confirmLabel={confirm?.kind === 'delete' ? t('common.delete') : t('security.ssh.rotate')}
        cancelLabel={t('common.cancel')}
        danger={confirm?.kind === 'delete'}
        busy={busy}
      />
    </div>
  );
}

function StatusPipeline({ status }: { status: string }) {
  const { t } = useTranslation();
  const step = pipelineStep(status);
  const labels = [
    t('security.ssh.pipelineStored'),
    t('security.ssh.pipelineInstalled'),
    t('security.ssh.pipelineVerified'),
  ];
  return (
    <ol className="ssh-pipeline" aria-label={t('security.ssh.progressAria')}>
      {labels.map((lab, i) => {
        const done = step !== 3 && i <= step;
        const fail = step === 3 && i === 0;
        return (
          <li
            key={lab}
            className={`ssh-pipeline__step${done ? ' is-done' : ''}${fail ? ' is-fail' : ''}`}
          >
            <span className="ssh-pipeline__dot" />
            <span>{lab}</span>
          </li>
        );
      })}
    </ol>
  );
}
