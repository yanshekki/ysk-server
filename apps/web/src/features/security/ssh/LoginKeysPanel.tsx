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
} from '../../../shared/components/ui';
import { sshApi } from './api';
import type { ProjectOpt, SftpKeyRow } from './types';
import { bindSet, bindInput, bindVoid } from '../../../pages/bind-handlers';

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
  onChanged: () => void;
};

export function LoginKeysPanel({ onFlash, onChanged }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SftpKeyRow[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [pub, setPub] = useState('');
  const [comment, setComment] = useState('');

  const refresh = useCallback(async () => {
    setErr(null);
    const [keys, projs] = await Promise.all([
      sshApi.listLoginKeys(),
      sshApi.listProjects(),
    ]);
    setItems(keys.items ?? []);
    setProjects(projs);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setErr(e.message));
  }, [refresh]);

  async function addKey() {
    if (!projectId || !pub.trim().startsWith('ssh-')) {
      onFlash('error', t('security.ssh.loginNeedPub'));
      return;
    }
    setBusy(true);
    try {
      const r = await sshApi.addLoginKey({
        projectId,
        publicKey: pub.trim(),
        comment: comment.trim() || undefined,
      });
      onFlash(
        r.ok ? 'ok' : 'error',
        (r.notes ?? []).join(' · ') || (r.ok ? t('security.ssh.loginAdded') : t('common.failed')),
      );
      if (r.ok) {
        setOpen(false);
        setPub('');
        setComment('');
        await refresh();
        onChanged();
      }
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
          title={t('security.ssh.loginTitle')}
          description={t('security.ssh.loginDesc')}
        >
          <ActionBar className="u-mb-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setProjectId(projects[0]?.id ?? '');
                setOpen(true);
              }}
            >
              {t('security.ssh.loginAdd')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={() => void refresh().catch((e: Error) => setErr(e.message))}
            >
              {t('common.refresh')}
            </Button>
          </ActionBar>

          {items.length === 0 ? (
            <EmptyState
              title={t('security.ssh.loginEmpty')}
              description={t('security.ssh.loginEmptyHint')}
            />
          ) : (
            <div className="list-panel">
              {items.map((k) => (
                <div key={k.id} className="list-row list-row--static">
                  <div className="list-row__main">
                    <div className="list-row__title">
                      <span>{k.username}</span>
                      {k.comment ? <span className="muted">· {k.comment}</span> : null}
                      {k.projectId ? (
                        <Badge tone="info">{t('security.ssh.boundProject')}</Badge>
                      ) : (
                        <Badge tone="neutral">{t('security.ssh.unboundProject')}</Badge>
                      )}
                    </div>
                    <div className="list-row__meta">
                      <span className="u-font-mono u-break-all">
                        {k.publicKey.slice(0, 56)}
                        {k.publicKey.length > 56 ? '…' : ''}
                      </span>
                      {k.homeDir ? <span>{k.homeDir}/.ssh</span> : null}
                    </div>
                  </div>
                  <div className="list-row__side">
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      onClick={() => {
                        setBusy(true);
                        void sshApi
                          .removeLoginKey(k.id)
                          .then(() => {
                            onFlash('ok', t('security.ssh.loginRemoved'));
                            return refresh();
                          })
                          .then(() => onChanged())
                          .catch((e: Error) => onFlash('error', e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      {t('security.ssh.remove')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </Card>

      <Modal
        open={open}
        onClose={bindSet(setOpen, false)}
        title={t('security.ssh.loginModalTitle')}
        description={t('security.ssh.loginModalDesc')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!projectId || !pub.trim()}
              onClick={bindVoid(addKey)}
            >
              {t('security.ssh.addAuth')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('common.project')} htmlFor="login-proj" flush required>
            <select
              id="login-proj"
              value={projectId}
              onChange={bindInput(setProjectId)}
            >
              <option value="">{t('security.ssh.selectOption')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.linuxUser}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t('security.ssh.publicKey')}
            htmlFor="login-pub"
            flush
            required
            fullWidth
            hint={t('security.ssh.publicKeyHint')}
          >
            <textarea
              id="login-pub"
              rows={4}
              value={pub}
              onChange={bindInput(setPub)}
              className="u-font-mono"
              spellCheck={false}
              placeholder="ssh-ed25519 AAAA… user@laptop"
            />
          </Field>
          <Field label={t('security.ssh.commentOptional')} htmlFor="login-cmt" flush>
            <input
              id="login-cmt"
              value={comment}
              onChange={bindInput(setComment)}
              placeholder={t('security.ssh.commentPlaceholder')}
            />
          </Field>
        </FormLayout>
        {projects.length === 0 ? (
          <FormHint>{t('security.ssh.loginNeedProject')}</FormHint>
        ) : null}
      </Modal>
    </div>
  );
}
