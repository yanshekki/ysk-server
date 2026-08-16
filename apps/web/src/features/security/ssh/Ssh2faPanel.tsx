/**
 * SSH login 2FA — independent of panel operator TOTP.
 * enroll → confirm code → write ~/.google_authenticator → PAM notes
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  PromptDialog } from '../../../shared/components/ui';
import { api } from '../../../shared/services/api';
import {
  bindCall1,
  bindClear2,
  bindClipboard,
  bindCloseIfIdle,
  bindCopyFlash,
  bindInput,
  bindRefreshCatch,
  bindSet,
  bindVoid } from '../../../pages/bind-handlers';

type Row = {
  id: string;
  linuxUser: string;
  homeDir: string;
  projectId?: string;
  status: string;
  label: string;
  filePath?: string;
  fromPanel?: boolean;
  notes: string[];
  hasSecret: boolean;
};

type ProjectOpt = { id: string; name: string; linuxUser: string; homeDir: string };

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
};

export function statusLabel(s: string, t: (k: string) => string): string {
  switch (s) {
    case 'enrolled':
      return t('security.ssh.enrollStatusSecret');
    case 'confirmed':
      return t('security.ssh.enrollStatusConfirmed');
    case 'file_written':
      return t('security.ssh.enrollStatusWritten');
    case 'retired':
      return t('security.ssh.enrollStatusRetired');
    default:
      return s;
  }
}

export function statusTone(s: string): 'ok' | 'warn' | 'info' | 'neutral' | 'danger' {
  if (s === 'file_written') return 'ok';
  if (s === 'confirmed') return 'info';
  if (s === 'enrolled') return 'warn';
  if (s === 'error') return 'danger';
  return 'neutral';
}

export function Ssh2faPanel({ onFlash }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Row[]>([]);
  const [hostNotes, setHostNotes] = useState<string[]>([]);
  const [lights, setLights] = useState<{
    package: string;
    pam: string;
    kbdInteractive: string;
  } | null>(null);
  const [pamSnippet, setPamSnippet] = useState('');
  const [sshdHints, setSshdHints] = useState('');
  const [strictSnippet, setStrictSnippet] = useState('');
  const [strictNotes, setStrictNotes] = useState<string[]>([]);
  const [recoveryUsers, setRecoveryUsers] = useState('root');
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [linuxUser, setLinuxUser] = useState('');
  const [fromPanel, setFromPanel] = useState(false);
  const [strictTotpOpen, setStrictTotpOpen] = useState(false);
  const [sharedConfirmOpen, setSharedConfirmOpen] = useState(false);

  const [reveal, setReveal] = useState<{
    secret: string;
    otpauthUrl: string;
    id: string;
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    const [list, pam, projs] = await Promise.all([
      api.requestRaw<{
        items: Row[];
        host?: {
          notes?: string[];
          lights?: { package: string; pam: string; kbdInteractive: string };
        };
      }>('/api/v1/ssh/2fa'),
      api.requestRaw<{
        pamSnippet: string;
        sshdHints: string;
        strictSnippet?: string;
        strictNotes?: string[];
      }>('/api/v1/ssh/2fa/pam-snippet?recovery=' + encodeURIComponent(recoveryUsers)),
      api.listProjects(),
    ]);
    setItems(list.items ?? []);
    setHostNotes(list.host?.notes ?? []);
    setLights(list.host?.lights ?? null);
    setPamSnippet(pam.pamSnippet ?? '');
    setSshdHints(pam.sshdHints ?? '');
    setStrictSnippet(pam.strictSnippet ?? '');
    setStrictNotes(pam.strictNotes ?? []);
    setProjects(
      (projs.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        linuxUser: p.linuxUser,
        homeDir: p.homeDir })),
    );
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setErr(e.message));
  }, [refresh]);

  async function doEnroll() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { fromPanel };
      if (projectId) body.projectId = projectId;
      else if (linuxUser.trim()) body.linuxUser = linuxUser.trim();
      else {
        onFlash('error', t('security.ssh.needProjectOrUser'));
        return;
      }
      const r = await api.requestRaw<{
        ok: boolean;
        secret?: string;
        otpauthUrl?: string;
        record?: Row;
        notes?: string[];
      }>('/api/v1/ssh/2fa', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) {
        onFlash('error', (r.notes ?? []).join(' · ') || t('security.ssh.enrollFailed'));
        return;
      }
      setEnrollOpen(false);
      if (r.secret && r.record) {
        setReveal({
          secret: r.secret,
          otpauthUrl: r.otpauthUrl ?? '',
          id: r.record.id });
        setConfirmId(r.record.id);
        setConfirmCode('');
      }
      onFlash('ok', t('security.ssh.totpGenerated'));
      await refresh();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm() {
    if (!confirmId || !confirmCode.trim()) return;
    setBusy(true);
    try {
      const r = await api.requestRaw<{ ok: boolean; notes?: string[] }>(
        `/api/v1/ssh/2fa/${confirmId}/confirm`,
        { method: 'POST', body: JSON.stringify({ code: confirmCode.trim() }) },
      );
      onFlash(r.ok ? 'ok' : 'error', (r.notes ?? []).join(' · ') || (r.ok ? t('security.ssh.confirmed') : t('security.ssh.codeWrong')));
      if (r.ok) {
        setReveal(null);
        setConfirmId(null);
        await refresh();
      }
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function doInstall(id: string) {
    setBusy(true);
    try {
      const r = await api.requestRaw<{
        ok: boolean;
        applied?: boolean;
        blocked?: boolean;
        notes?: string[];
      }>(`/api/v1/ssh/2fa/${id}/install`, {
        method: 'POST',
        body: JSON.stringify({ apply: true }) });
      onFlash(
        r.ok && r.applied ? 'ok' : r.blocked ? 'error' : 'ok',
        (r.notes ?? []).join(' · ') ||
          (r.applied
            ? t('security.ssh.gaWritten')
            : r.blocked
              ? t('security.ssh.needExecute')
              : t('security.ssh.notDone')),
      );
      await refresh();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-gap">
      {err ? <Alert variant="error">{err}</Alert> : null}

      <Card>
        <CardSection
          title={t('security.ssh.ssh2faTitle')}
          description={t('security.ssh.ssh2faDesc')}
        >
          <div className="ssh-callout">
            <ol className="list-spaced u-mb-0">
              <li>{t('security.ssh.ssh2faStep1')}</li>
              <li>{t('security.ssh.ssh2faStep2')}</li>
              <li>{t('security.ssh.ssh2faStep3')} <code className="inline">.google_authenticator</code></li>
              <li>{t('security.ssh.ssh2faStep4')}</li>
            </ol>
          </div>
          {lights ? (
            <ActionBar className="u-mb-3 u-flex-wrap">
              <Badge tone={lights.package === 'green' ? 'ok' : 'danger'}>
                {t('security.ssh.pkgStatus', {
                  status: t(`security.ssh.light.${lights.package}`),
                })}
              </Badge>
              <Badge
                tone={
                  lights.pam === 'green' ? 'ok' : lights.pam === 'yellow' ? 'warn' : 'danger'
                }
              >
                {t('security.ssh.pamStatus', {
                  status: t(`security.ssh.light.${lights.pam}`),
                })}
              </Badge>
              <Badge
                tone={
                  lights.kbdInteractive === 'green'
                    ? 'ok'
                    : lights.kbdInteractive === 'yellow'
                      ? 'warn'
                      : 'danger'
                }
              >
                {t('security.ssh.kbdStatus', {
                  status: t(`security.ssh.light.${lights.kbdInteractive}`),
                })}
              </Badge>
            </ActionBar>
          ) : null}
          {hostNotes.length > 0 ? (
            <ul className="list-plain u-mb-3">
              {hostNotes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
          <ActionBar className="u-mb-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setProjectId(projects[0]?.id ?? '');
                setLinuxUser('');
                setFromPanel(false);
                setEnrollOpen(true);
              }}
            >
              {t('security.ssh.enrollForUser')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={bindRefreshCatch(refresh, setErr)}
            >
              {t('common.refresh')}
            </Button>
          </ActionBar>

          {items.length === 0 ? (
            <EmptyState
              title={t('security.ssh.ssh2faEmpty')}
              description={t('security.ssh.ssh2faEmptyHint')}
            />
          ) : (
            <div className="list-panel">
              {items.map((row) => (
                <div key={row.id} className="list-row list-row--static">
                  <div className="list-row__main">
                    <div className="list-row__title">
                      <span>{row.linuxUser}</span>
                      <Badge tone={statusTone(row.status)}>{statusLabel(row.status, t)}</Badge>
                      {row.fromPanel ? <Badge tone="warn">{t('security.ssh.fromPanelBadge')}</Badge> : null}
                    </div>
                    <div className="list-row__meta">
                      <span>{row.homeDir}</span>
                      {row.filePath ? <span className="u-font-mono">{row.filePath}</span> : null}
                    </div>
                  </div>
                  <div className="list-row__side">
                    <ActionBar>
                      {row.status === 'enrolled' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setConfirmId(row.id);
                            setConfirmCode('');
                            setReveal(null);
                          }}
                        >
                          {t('security.ssh.enterCode')}
                        </Button>
                      ) : null}
                      {row.status === 'confirmed' || row.status === 'file_written' ? (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busy}
                          onClick={bindCall1(doInstall, row.id)}
                        >
                          {row.status === 'file_written' ? t('security.ssh.rewriteHome') : t('security.ssh.writeHome')}
                        </Button>
                      ) : null}
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          setBusy(true);
                          void api
                            .requestRaw(`/api/v1/ssh/2fa/${row.id}?purgeFile=1`, {
                              method: 'DELETE' })
                            .then(() => {
                              onFlash('ok', t('security.ssh.retiredOk'));
                              return refresh();
                            })
                            .catch((e: Error) => onFlash('error', e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {t('security.ssh.retire')}
                      </Button>
                    </ActionBar>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('security.ssh.pamTitle')}
          description={t('security.ssh.pamDesc')}
        >
          <Field label={t('security.ssh.pamSnippet')} htmlFor="pam-snip" flush fullWidth>
            <textarea
              id="pam-snip"
              rows={5}
              readOnly
              value={pamSnippet}
              className="u-font-mono"
            />
          </Field>
          <Field label={t('security.ssh.sshdHint')} htmlFor="sshd-hint" flush fullWidth>
            <textarea
              id="sshd-hint"
              rows={6}
              readOnly
              value={sshdHints}
              className="u-font-mono"
            />
          </Field>
          <Field
            label={t('security.ssh.rescueUsers')}
            htmlFor="rec-u"
            flush
          >
            <input
              id="rec-u"
              value={recoveryUsers}
              onChange={bindInput(setRecoveryUsers)}
              spellCheck={false}
            />
          </Field>
          <Field
            label={t('security.ssh.strictPreview')}
            htmlFor="strict-snip"
            flush
            fullWidth
          >
            <textarea
              id="strict-snip"
              rows={8}
              readOnly
              value={strictSnippet}
              className="u-font-mono"
            />
          </Field>
          {strictNotes.length > 0 ? (
            <ul className="list-plain u-mb-2">
              {strictNotes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
          <FormActions>
            <Button
              variant="secondary"
              size="md"
              onClick={bindCopyFlash(pamSnippet, onFlash, t('security.ssh.copiedPam'), 'ok')}
            >
              {t('security.ssh.copyPam')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void api
                  .requestRaw<{ notes?: string[]; dryRun?: boolean }>(
                    '/api/v1/ssh/2fa/strict-apply',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        apply: false,
                        recoveryUsers: recoveryUsers.split(/[\s,]+/).filter(Boolean) }) },
                  )
                  .then((r) => {
                    const notes = r.notes ?? [];
                    if (notes.length) setStrictSnippet(notes.join('\n'));
                    onFlash('ok', notes.join(' · ') || t('security.ssh.dryRunOk'));
                    return refresh();
                  })
                  .catch((e: Error) => onFlash('error', e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('security.ssh.strictDryRun')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={
                lights?.package !== 'green' ||
                lights?.pam !== 'green' ||
                !(items.some((i) => i.status === 'file_written' || i.status === 'confirmed'))
              }
              title={
                lights?.package !== 'green' || lights?.pam !== 'green'
                  ? t('security.ssh.strictBlocked')
                  : undefined
              }
              onClick={bindSet(setStrictTotpOpen, true)}
            >
              {t('security.ssh.applyStrict')}
            </Button>
          </FormActions>
          <FormHint>
            {t('security.ssh.pamPkgHint')}<code className="inline">libpam-google-authenticator</code>{t('security.ssh.pamRescueHint')}
          </FormHint>
        </CardSection>
      </Card>

      <Modal
        open={enrollOpen}
        onClose={bindSet(setEnrollOpen, false)}
        title={t('security.ssh.enrollModalTitle')}
        description={t('security.ssh.enrollModalDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setEnrollOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="md" loading={busy} onClick={bindVoid(doEnroll)}>
              {t('security.ssh.generateShowSecret')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('security.ssh.projectSuggested')} htmlFor="e2-proj" flush>
            <select
              id="e2-proj"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                if (e.target.value) setLinuxUser('');
              }}
            >
              <option value="">{t('security.ssh.orManualUser')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.linuxUser}
                </option>
              ))}
            </select>
          </Field>
          {!projectId ? (
            <Field label={t('security.ssh.linuxUser')} htmlFor="e2-user" flush>
              <input
                id="e2-user"
                value={linuxUser}
                onChange={bindInput(setLinuxUser)}
                placeholder="deploy"
                spellCheck={false}
              />
            </Field>
          ) : null}
          <label className="ssh-check">
            <input
              type="checkbox"
              checked={fromPanel}
              onChange={(e) => {
                if (e.target.checked) {
                  setSharedConfirmOpen(true);
                  return;
                }
                setFromPanel(false);
              }}
            />
            <span>
              {t('security.ssh.advancedSharePanel')}
            </span>
          </label>
        </FormLayout>
      </Modal>

      <Modal
        open={Boolean(reveal || confirmId)}
        onClose={bindClear2(setReveal, setConfirmId)}
        title={t('security.ssh.setupAuthTitle')}
        description={t('security.ssh.setupAuthDesc')}
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={bindClear2(setReveal, setConfirmId)}
            >
              {t('security.ssh.later')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={confirmCode.trim().length < 6}
              onClick={bindVoid(doConfirm)}
            >
              {t('security.ssh.confirmCodeBtn')}
            </Button>
          </>
        }
      >
        {reveal ? (
          <>
            <FormHint>
              otpauth：
              <code className="inline u-break-all">{reveal.otpauthUrl}</code>
            </FormHint>
            <Field label={t('security.ssh.secretBase32')} htmlFor="sec" flush fullWidth>
              <input
                id="sec"
                readOnly
                value={reveal.secret}
                className="u-font-mono"
                onFocus={(e) => e.target.select()}
              />
            </Field>
            <Button
              variant="ghost"
              size="sm"
              onClick={bindCopyFlash(reveal.secret, onFlash, t('security.ssh.copiedSecret'), 'ok')}
            >
              {t('security.ssh.copySecret')}
            </Button>
          </>
        ) : (
          <FormHint>{t('security.ssh.scanThenCode')}</FormHint>
        )}
        <div className="u-mt-3">
          <Field label={t('security.ssh.verifyCode')} htmlFor="c2" flush required>
            <input
              id="c2"
              value={confirmCode}
              onChange={bindInput(setConfirmCode)}
              maxLength={6}
              inputMode="numeric"
              placeholder="000000"
              autoComplete="one-time-code"
            />
          </Field>
        </div>
      </Modal>

      <PromptDialog
        open={strictTotpOpen}
        onClose={bindCloseIfIdle(busy, bindSet(setStrictTotpOpen, false))}
        title={t('security.ssh.applyStrictStepUp')}
        description={t('security.ssh.enterPanelTotp')}
        label="TOTP"
        secret
        placeholder={t('security.digit6Placeholder')}
        confirmLabel={t('security.ssh.applyBtn')}
        busy={busy}
        onSubmit={async (totp) => {
          setBusy(true);
          try {
            const r = await api.requestRaw<{
              notes?: string[];
              ok?: boolean;
              blocked?: boolean;
            }>('/api/v1/ssh/2fa/strict-apply', {
              method: 'POST',
              body: JSON.stringify({
                apply: true,
                totp,
                recoveryUsers: recoveryUsers.split(/[\s,]+/).filter(Boolean) }) });
            onFlash(
              r.ok ? 'ok' : 'error',
              (r.notes ?? []).join(' · ') || (r.ok ? t('security.ssh.appliedOk') : t('common.failed')),
            );
            await refresh();
            setStrictTotpOpen(false);
            return true;
          } catch (e) {
            onFlash('error', e instanceof Error ? e.message : t('common.failed'));
            return false;
          } finally {
            setBusy(false);
          }
        }}
      />

      <PromptDialog
        open={sharedConfirmOpen}
        onClose={bindSet(setSharedConfirmOpen, false)}
        title={t('security.ssh.sharePanelTitle')}
        description={t('security.ssh.sharePanelDesc')}
        label={t('security.ssh.confirmString')}
        placeholder="SHARED"
        expectExact="SHARED"
        confirmLabel={t('security.ssh.enableShare')}
        danger
        onSubmit={() => {
          setFromPanel(true);
          setSharedConfirmOpen(false);
          return true;
        }}
      />
    </div>
  );
}
