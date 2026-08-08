/**
 * Destructive email domain delete — same UX as ProjectDeleteDialog:
 * type domain name to confirm; optional remove local dataDir.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EmailDomain } from '@ysk/shared';
import {
  Alert,
  Button,
  CheckboxField,
  Field,
  FormHint,
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
      <div className="u-stack u-gap-3">
        <Alert variant="warn">
          <ul className="u-text-sm u-mb-0" style={{ paddingLeft: '1.2rem' }}>
            <li>{t('email.deleteDomainC1')}</li>
            <li>{t('email.deleteDomainC2')}</li>
            <li>
              {removeData ? t('email.deleteWillData') : t('email.deleteKeepData')}
            </li>
            <li>{t('email.deleteDomainC4')}</li>
          </ul>
        </Alert>

        <dl className="u-text-sm" style={{ margin: 0 }}>
          <div>
            <dt className="muted">{t('email.domain')}</dt>
            <dd>
              <code>{domain.domain}</code>
            </dd>
          </div>
          <div>
            <dt className="muted">{t('email.serverIp')}</dt>
            <dd>{domain.server_ip || '—'}</dd>
          </div>
          <div>
            <dt className="muted">{t('email.statHealth')}</dt>
            <dd>
              {domain.health_score}/100
            </dd>
          </div>
          <div>
            <dt className="muted">{t('email.statApply')}</dt>
            <dd>
              <code>{String(domain.apply_status ?? 'draft')}</code>
            </dd>
          </div>
        </dl>

        <CheckboxField
          id="email-del-data"
          label={t('email.deleteRemoveData')}
          description={t('email.deleteRemoveDataDesc')}
          checked={removeData}
          onChange={setRemoveData}
          disabled={busy}
        />

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
          />
        </Field>

        {error ? <Alert variant="error">{error}</Alert> : null}
        <FormHint>{t('email.deleteSystemWarn')}</FormHint>
      </div>
    </Modal>
  );
}
