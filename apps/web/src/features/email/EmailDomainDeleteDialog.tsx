/**
 * Destructive email domain delete — same safety model as ProjectDeleteDialog,
 * professional delete-confirm layout.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmailDomain } from '@yanshekki/shared';
import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  Field,
  Modal } from '../../shared/components/ui';
import { emailApi } from './api';

export interface EmailDomainDeleteDialogProps {
  domain: EmailDomain | null;
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onDeleted: (result: {
    ok: boolean;
    notes?: string[];
    warnings?: string[];
  }) => void;
}

export function EmailDomainDeleteDialog({
  domain,
  open,
  busy: parentBusy,
  onClose,
  onDeleted }: EmailDomainDeleteDialogProps) {
  const { t } = useTranslation();
  const [confirmName, setConfirmName] = useState('');
  const [removeData, setRemoveData] = useState(true);
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setConfirmName('');
      setRemoveData(true);
      setError(null);
    }
  }, [open, domain?.id]);

  const busy = Boolean(parentBusy || localBusy);
  const nameOk = Boolean(
    domain && confirmName.trim().toLowerCase() === domain.domain.trim().toLowerCase(),
  );

  async function submit() {
    if (!domain || !nameOk) return;
    setLocalBusy(true);
    setError(null);
    try {
      const r = await emailApi.deleteDomain(domain.id, {
        confirmName: confirmName.trim(),
        removeData,
      });
      onDeleted(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.deleteFailed'));
    } finally {
      setLocalBusy(false);
    }
  }

  if (!domain) return null;

  const applyLabel = String(domain.apply_status ?? 'draft');
  const impactItems = [
    t('email.deleteDomainC1'),
    t('email.deleteDomainC2'),
    removeData ? t('email.deleteWillData') : t('email.deleteKeepData'),
    t('email.deleteDomainC4'),
  ];

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('email.deleteDialogTitle')}
      description={t('email.deleteDialogDesc', { domain: domain.domain })}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="md"
            loading={busy}
            disabled={!nameOk}
            onClick={() => void submit()}
          >
            {t('email.deletePermanent')}
          </Button>
        </>
      }
    >
      <div className="delete-confirm">
        <section className="delete-confirm__impact" aria-label={t('dialogs.severity.consequencesTitle')}>
          <header className="delete-confirm__section-head">
            <span className="delete-confirm__section-label">
              {t('dialogs.severity.consequencesTitle')}
            </span>
          </header>
          <ul className="delete-confirm__impact-list">
            {impactItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="delete-confirm__meta" aria-label={t('email.domain')}>
          <div className="delete-confirm__meta-grid">
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">{t('email.domain')}</span>
              <span className="delete-confirm__meta-val">
                <code className="delete-confirm__code">{domain.domain}</code>
              </span>
            </div>
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">{t('email.serverIp')}</span>
              <span className="delete-confirm__meta-val">
                <code className="delete-confirm__code">{domain.server_ip || '—'}</code>
              </span>
            </div>
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">{t('email.statHealth')}</span>
              <span className="delete-confirm__meta-val">
                <Badge tone={domain.health_score >= 80 ? 'ok' : 'warn'}>
                  {domain.health_score}/100
                </Badge>
              </span>
            </div>
            <div className="delete-confirm__meta-cell">
              <span className="delete-confirm__meta-lab">{t('email.statApply')}</span>
              <span className="delete-confirm__meta-val">
                <Badge tone={applyLabel === 'applied' ? 'ok' : 'neutral'}>{applyLabel}</Badge>
              </span>
            </div>
          </div>
        </section>

        <section className="delete-confirm__options">
          <CheckboxField
            id="email-del-data"
            label={t('email.deleteRemoveData')}
            description={t('email.deleteRemoveDataDesc')}
            checked={removeData}
            onChange={setRemoveData}
            disabled={busy}
          />
        </section>

        <section className="delete-confirm__type">
          <Field
            label={t('email.deleteTypeName')}
            htmlFor="email-del-name"
            hint={t('email.deleteTypeNameHint', { name: domain.domain })}
            flush
          >
            <input
              id="email-del-name"
              className="input"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={domain.domain}
              autoComplete="off"
              disabled={busy}
              spellCheck={false}
              autoFocus
            />
          </Field>
        </section>

        {error ? <Alert variant="error">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
