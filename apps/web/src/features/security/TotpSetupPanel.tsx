/**
 * Operator TOTP setup — multi-step UX: reauth → QR + key → confirm → recovery codes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/services/api';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  Field,
  FormHint,
  FormLayout } from '../../shared/components/ui';
import { bindInput } from '../../pages/bind-handlers';
import { TotpQr, formatTotpSecret } from './TotpQr';

export type TotpStatus = {
  enabled: boolean;
  enrolled: boolean;
  recoveryRemaining?: number;
};

type TotpSetupPanelProps = {
  status: TotpStatus | null;
  onStatusChange?: () => void | Promise<void>;
};

type Phase = 'idle' | 'enroll' | 'recovery';

export function TotpSetupPanel({ status, onStatusChange }: TotpSetupPanelProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** Alerts stay inside this panel only — never page-top. */
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [localOk, setLocalOk] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(true);
  const [disableCode, setDisableCode] = useState('');

  const enabled = Boolean(status?.enabled);
  const enrolledPending = Boolean(status?.enrolled && !status?.enabled);

  useEffect(() => {
    // If server says enrolled but unconfirmed, stay ready for confirm once secret known
    if (enrolledPending && !secret && phase === 'idle') {
      /* user must re-begin to get secret again */
    }
  }, [enrolledPending, secret, phase]);

  const flashOk = useCallback((message: string) => {
    setLocalErr(null);
    setLocalOk(message);
  }, []);
  const flashErr = useCallback((message: string) => {
    setLocalOk(null);
    setLocalErr(message);
  }, []);

  const refresh = useCallback(async () => {
    await onStatusChange?.();
  }, [onStatusChange]);

  const cancelEnroll = () => {
    setPhase('idle');
    setSecret(null);
    setOtpauthUrl(null);
    setCode('');
    setPassword('');
    setLocalErr(null);
    setLocalOk(null);
  };

  const beginEnroll = () => {
    setLocalErr(null);
    setLocalOk(null);
    if (!password.trim()) {
      flashErr(t('security.reauthPasswordRequired'));
      return;
    }
    setBusy(true);
    void api
      .totpBegin({ password: password.trim() })
      .then((r) => {
        setSecret(r.secret);
        setOtpauthUrl(r.otpauthUrl);
        setPassword('');
        setCode('');
        setPhase('enroll');
        setShowSecret(true);
        flashOk(t('security.totpSecretGenerated'));
        return refresh();
      })
      .catch((e: Error) => flashErr(e.message))
      .finally(() => setBusy(false));
  };

  const confirmEnroll = () => {
    setLocalErr(null);
    setLocalOk(null);
    const c = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(c)) {
      flashErr(t('security.confirmCodeInvalid'));
      return;
    }
    setBusy(true);
    void api
      .totpConfirm(c)
      .then((r) => {
        setRecoveryCodes(r.recoveryCodes ?? null);
        setSecret(null);
        setOtpauthUrl(null);
        setCode('');
        setPhase(r.recoveryCodes?.length ? 'recovery' : 'idle');
        flashOk(t('security.totpEnabledSaveCodes'));
        return refresh();
      })
      .catch((e: Error) => flashErr(e.message))
      .finally(() => setBusy(false));
  };

  const disableTotp = () => {
    setLocalErr(null);
    setLocalOk(null);
    const c = disableCode.replace(/\s+/g, '');
    if (!c) {
      flashErr(t('security.confirmCodeInvalid'));
      return;
    }
    setBusy(true);
    void api
      .totpDisable(c)
      .then(() => {
        setDisableCode('');
        flashOk(t('security.totpDisabledOk'));
        return refresh();
      })
      .catch((e: Error) => flashErr(e.message))
      .finally(() => setBusy(false));
  };

  const secretGrouped = useMemo(
    () => (secret ? formatTotpSecret(secret) : ''),
    [secret],
  );

  const copySecret = () => {
    if (!secret) return;
    void navigator.clipboard?.writeText(secret.replace(/\s+/g, '')).then(() => {
      flashOk(t('security.totpSecretCopied'));
    });
  };

  const copyRecovery = () => {
    if (!recoveryCodes?.length) return;
    void navigator.clipboard?.writeText(recoveryCodes.join('\n')).then(() => {
      flashOk(t('security.copiedRecoveryCodes'));
    });
  };

  const downloadRecovery = () => {
    if (!recoveryCodes?.length) return;
    const blob = new Blob(
      [
        `# YSK Server TOTP recovery codes\n# ${new Date().toISOString()}\n# Each code works once\n\n`,
        recoveryCodes.join('\n'),
        '\n',
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ysk-totp-recovery-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    flashOk(t('security.recoveryDownloaded'));
  };

  const activeStep =
    phase === 'enroll' ? (code.length >= 6 ? 2 : 1) : phase === 'recovery' ? 3 : 0;

  return (
    <div className="totp-setup">
      <div className="totp-setup__head">
        <div className="totp-setup__title-row">
          <h3 className="totp-setup__title">{t('security.totpTitle')}</h3>
          {enabled ? (
            <Badge tone="ok">{t('security.totpEnabled')}</Badge>
          ) : enrolledPending || phase === 'enroll' ? (
            <Badge tone="warn">{t('security.totpEnrolledUnconfirmed')}</Badge>
          ) : (
            <Badge tone="neutral">{t('security.totpNotSet')}</Badge>
          )}
        </div>
        {!enabled && phase === 'idle' ? (
          <p className="totp-setup__lead muted u-text-sm">{t('security.totpLead')}</p>
        ) : enabled && phase === 'idle' && typeof status?.recoveryRemaining === 'number' ? (
          <p className="totp-setup__lead muted u-text-sm">
            {t('security.totpRecoveryRemaining', { n: status.recoveryRemaining })}
          </p>
        ) : null}
      </div>

      {phase === 'enroll' || phase === 'recovery' ? (
        <ol className="totp-setup__steps" aria-label={t('security.totpStepsLabel')}>
          <li className="is-done">
            <span className="totp-setup__step-n">1</span>
            <span>{t('security.totpStepReauth')}</span>
          </li>
          <li
            className={
              phase === 'recovery'
                ? 'is-done'
                : activeStep <= 1
                  ? 'is-active'
                  : 'is-done'
            }
          >
            <span className="totp-setup__step-n">2</span>
            <span>{t('security.totpStepScan')}</span>
          </li>
          <li
            className={
              phase === 'recovery' ? 'is-done' : activeStep >= 2 ? 'is-active' : ''
            }
          >
            <span className="totp-setup__step-n">3</span>
            <span>{t('security.totpStepConfirm')}</span>
          </li>
          <li className={phase === 'recovery' ? 'is-active' : ''}>
            <span className="totp-setup__step-n">4</span>
            <span>{t('security.totpStepBackup')}</span>
          </li>
        </ol>
      ) : null}

      {localErr ? (
        <Alert variant="error" className="u-mb-3">
          {localErr}
          <Button variant="ghost" size="sm" className="u-ml-2" onClick={() => setLocalErr(null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}
      {localOk ? (
        <Alert variant="ok" className="u-mb-3">
          {localOk}
          <Button variant="ghost" size="sm" className="u-ml-2" onClick={() => setLocalOk(null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      {/* —— Enabled: status + disable —— */}
      {enabled && phase === 'idle' ? (
        <div className="totp-setup__enabled">
          <details className="totp-setup__advanced">
            <summary>{t('security.totpResetSummary')}</summary>
            <FormLayout columns={2} className="u-mt-2">
              <Field
                label={t('security.reauthPassword')}
                htmlFor="totp-reset-pw"
                flush
              >
                <input
                  id="totp-reset-pw"
                  type="password"
                  value={password}
                  onChange={bindInput(setPassword)}
                  autoComplete="current-password"
                />
              </Field>
              <Field
                label={t('security.confirmCode')}
                htmlFor="totp-disable-code"
                flush
              >
                <input
                  id="totp-disable-code"
                  value={disableCode}
                  onChange={bindInput(setDisableCode)}
                  maxLength={16}
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
              </Field>
            </FormLayout>
            <ActionBar className="u-mt-3">
              <Button
                variant="primary"
                size="md"
                loading={busy}
                disabled={!password}
                onClick={beginEnroll}
              >
                {t('security.reset2fa')}
              </Button>
              <Button
                variant="danger"
                size="md"
                loading={busy}
                disabled={!disableCode}
                onClick={disableTotp}
              >
                {t('security.disable2fa')}
              </Button>
            </ActionBar>
          </details>
        </div>
      ) : null}

      {/* —— Idle not enabled: start —— */}
      {!enabled && phase === 'idle' ? (
        <div className="totp-setup__start">
          <Field
            label={t('security.reauthPassword')}
            htmlFor="totp-start-pw"
            flush
            required
          >
            <input
              id="totp-start-pw"
              type="password"
              value={password}
              onChange={bindInput(setPassword)}
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  beginEnroll();
                }
              }}
            />
          </Field>
          <ActionBar className="u-mt-3">
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!password}
              onClick={beginEnroll}
            >
              {t('security.start2fa')}
            </Button>
          </ActionBar>
        </div>
      ) : null}

      {/* —— Enroll: QR + secret + confirm —— */}
      {phase === 'enroll' && secret && otpauthUrl ? (
        <div className="totp-setup__enroll">
          <div className="totp-setup__enroll-grid">
            <div className="totp-setup__qr-panel">
              <p className="totp-setup__panel-label">{t('security.totpScanTitle')}</p>
              <div className="totp-setup__qr-frame">
                <TotpQr otpauthUrl={otpauthUrl} size={200} />
              </div>
              <p className="muted u-text-sm u-mt-2">{t('security.totpScanHint')}</p>
            </div>
            <div className="totp-setup__key-panel">
              <p className="totp-setup__panel-label">{t('security.totpManualTitle')}</p>
              <p className="muted u-text-sm">{t('security.totpManualHint')}</p>
              <div className="totp-setup__secret-box">
                <code className="totp-setup__secret">
                  {showSecret ? secretGrouped : '•••• •••• •••• ••••'}
                </code>
                <div className="totp-setup__secret-actions">
                  <Button variant="secondary" size="sm" onClick={copySecret}>
                    {t('common.copy')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSecret((v) => !v)}
                  >
                    {showSecret ? t('security.hideSecret') : t('security.showSecret')}
                  </Button>
                </div>
              </div>
              <details className="totp-setup__otpauth">
                <summary className="u-text-sm">{t('security.totpShowOtpauth')}</summary>
                <code className="totp-setup__otpauth-url u-break-all">{otpauthUrl}</code>
              </details>
            </div>
          </div>

          <div className="totp-setup__confirm">
            <p className="totp-setup__panel-label">{t('security.totpStepConfirm')}</p>
            <p className="muted u-text-sm">{t('security.confirmCodeHint')}</p>
            <FormLayout columns={2} className="u-mt-2">
              <Field
                label={t('security.confirmCode')}
                htmlFor="totp-confirm"
                flush
                required
              >
                <input
                  id="totp-confirm"
                  className="totp-setup__code-input"
                  value={code}
                  onChange={bindInput(setCode)}
                  maxLength={6}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      confirmEnroll();
                    }
                  }}
                />
              </Field>
            </FormLayout>
            <ActionBar className="u-mt-3">
              <Button
                variant="primary"
                size="md"
                loading={busy}
                disabled={code.replace(/\s+/g, '').length !== 6}
                onClick={confirmEnroll}
              >
                {t('security.confirmEnable')}
              </Button>
              <Button variant="ghost" size="md" disabled={busy} onClick={cancelEnroll}>
                {t('common.cancel')}
              </Button>
            </ActionBar>
          </div>
        </div>
      ) : null}

      {/* —— Recovery codes once —— */}
      {phase === 'recovery' && recoveryCodes && recoveryCodes.length > 0 ? (
        <div className="totp-setup__recovery">
          <Alert variant="warn" className="u-mb-3">
            {t('security.recoveryCodesHint')}
          </Alert>
          <ul className="totp-setup__recovery-grid">
            {recoveryCodes.map((c) => (
              <li key={c} className="totp-setup__recovery-code">
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <ActionBar className="u-mt-3">
            <Button variant="primary" size="md" onClick={copyRecovery}>
              {t('security.copyAll')}
            </Button>
            <Button variant="secondary" size="md" onClick={downloadRecovery}>
              {t('security.downloadRecovery')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setRecoveryCodes(null);
                setPhase('idle');
              }}
            >
              {t('security.savedClose')}
            </Button>
          </ActionBar>
        </div>
      ) : null}
    </div>
  );
}
