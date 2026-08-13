import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  CardSection,
  Field,
  FormActions,
  FormHint } from '../../../shared/components/ui';
import { sshApi } from './api';
import { ServiceAccessStrip } from '../../network/service-exposure';
import { ServiceLifecycleBar } from '../../system/ServiceLifecycleBar';

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
};

export function SshdPanel({ onFlash }: Props) {
  const { t } = useTranslation();
  const [snippet, setSnippet] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const r = await sshApi.sshdSnippet();
    setSnippet(r.snippet ?? '');
    setNotes(r.notes ?? []);
  }

  useEffect(() => {
    void load().catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <div className="stack-gap">
      {err ? <Alert variant="error">{err}</Alert> : null}

      <ServiceAccessStrip
        serviceId="sshd"
        ports={[{ role: 'ssh', port: '22', proto: 'tcp' }]}
        compact
      />
      <ServiceLifecycleBar
        unit="ssh"
        matrixId="sshd"
        label="sshd"
        danger="sshd"
        actions={['start', 'stop', 'restart', 'reload']}
        size="sm"
      />

      <Card>
        <CardSection
          title={t('security.ssh.sshdTitle')}
          description={t('security.ssh.sshdDesc')}
        >
          <div className="ssh-callout">
            <ol className="list-spaced u-mb-0">
              <li>{t('security.ssh.sshdStep1')}</li>
              <li>{t('security.ssh.sshdStep2')}</li>
              <li>{t('security.ssh.sshdStep3')}</li>
            </ol>
          </div>

          {notes.length > 0 ? (
            <ul className="list-plain u-mb-3">
              {notes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}

          <Field label={t('security.ssh.sshdPreview')} htmlFor="sshd-snip" flush fullWidth>
            <textarea
              id="sshd-snip"
              rows={12}
              readOnly
              value={snippet || t('security.ssh.loadingSnippet')}
              className="u-font-mono"
              spellCheck={false}
            />
          </Field>

          <FormActions>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void load()
                  .then(() => {
                    void navigator.clipboard?.writeText(snippet);
                    onFlash('ok', t('security.ssh.reloadedCopied'));
                  })
                  .catch((e: Error) => setErr(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('security.ssh.reloadAndCopy')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void sshApi
                  .applySshd()
                  .then((r) => {
                    onFlash(
                      r.ok ? 'ok' : 'error',
                      (r.notes ?? []).join(' · ') ||
                        (r.ok ? t('security.ssh.installedOk') : t('security.ssh.notDone')),
                    );
                  })
                  .catch((e: Error) => onFlash('error', e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('security.ssh.installToSystem')}
            </Button>
          </FormActions>
          <FormHint>
            {t('security.ssh.sshdManualHint')}{' '}
            <code className="inline">/etc/ssh/sshd_config.d</code>.
          </FormHint>
        </CardSection>
      </Card>
    </div>
  );
}
