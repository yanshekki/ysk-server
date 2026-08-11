/**
 * Three-step uninstall wizard: impact → options → double confirm.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { softwareApi } from '../../../features/software/api';
import { Modal } from './Modal';
import { Button } from './Button';
import { Badge } from './Badge';
import { Alert } from './Alert';
import { Field } from './Field';
import { SegRadio } from './SegRadio';
import { CheckboxField } from './Field';
import { LoadingBlock } from './LoadingBlock';

export type SoftwareUninstallDialogProps = {
  open: boolean;
  feature?: string;
  ids?: string[];
  title?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (opts: {
    dataPolicy: 'keep' | 'purge';
    confirmPhrase: string;
  }) => void | Promise<void>;
};

type Preview = Awaited<ReturnType<typeof softwareApi.uninstallPreview>>;

export function SoftwareUninstallDialog({
  open,
  feature,
  ids,
  title,
  busy,
  onClose,
  onConfirm,
}: SoftwareUninstallDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataPolicy, setDataPolicy] = useState<'keep' | 'purge'>('keep');
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState('');

  useEffect(() => {
    if (!open) {
      setStep(0);
      setPreview(null);
      setError(null);
      setDataPolicy('keep');
      setAck(false);
      setPhrase('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void softwareApi
      .uninstallPreview({ feature, ids, dataPolicy: 'keep' })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, feature, ids?.join(',')]);

  useEffect(() => {
    if (!open || !preview) return;
    let cancelled = false;
    void softwareApi
      .uninstallPreview({ feature, ids, dataPolicy })
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dataPolicy]);

  const phraseOk =
    Boolean(preview?.confirmPhrase) && phrase === preview?.confirmPhrase;
  const canSubmit = ack && phraseOk && !busy;

  const impactLabel = (key: string) =>
    t(`softwareLifecycle.impact.${key}`, {
      defaultValue: key,
    });

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('softwareLifecycle.uninstallTitle', {
        name: title ?? feature ?? 'software',
      })}
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={() => {
              if (step === 0) onClose();
              else setStep((s) => (s === 2 ? 1 : 0));
            }}
          >
            {step === 0 ? t('common.cancel') : t('common.back')}
          </Button>
          {step < 2 ? (
            <Button
              variant="primary"
              size="md"
              disabled={loading || !preview?.ok || (preview.summary.installedCount === 0)}
              onClick={() => setStep((s) => (s === 0 ? 1 : 2))}
            >
              {t('common.next')}
            </Button>
          ) : (
            <Button
              variant="danger"
              size="md"
              loading={busy}
              disabled={!canSubmit}
              onClick={() =>
                void onConfirm({
                  dataPolicy,
                  confirmPhrase: phrase,
                })
              }
            >
              {t('softwareLifecycle.confirmUninstall')}
            </Button>
          )}
        </>
      }
    >
      <div className="software-uninstall-wizard">
        <div className="software-uninstall-wizard__steps" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`software-uninstall-wizard__pip${step === i ? ' is-on' : step > i ? ' is-done' : ''}`}
            />
          ))}
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}
        {loading || !preview ? (
          <LoadingBlock label={t('common.loading')} />
        ) : (
          <>
            {step === 0 ? (
              <div className="stack">
                <Alert variant="warn">
                  {t('softwareLifecycle.impactIntro')}
                </Alert>
                {preview.summary.installedCount === 0 ? (
                  <EmptyHint text={t('softwareLifecycle.nothingInstalled')} />
                ) : (
                  <ul className="software-uninstall-wizard__targets">
                    {preview.targets
                      .filter((x) => x.installed)
                      .map((tg) => (
                        <li key={tg.id}>
                          <div className="software-uninstall-wizard__target-head">
                            <strong>{tg.title}</strong>
                            <code className="muted">{tg.id}</code>
                            {tg.protected ? (
                              <Badge tone="warn">
                                {t('softwareLifecycle.protected')}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="muted u-text-sm">
                            {tg.packages.length
                              ? t('softwareLifecycle.packagesList', {
                                  list: tg.packages.join(', '),
                                })
                              : t('softwareLifecycle.noPackages')}
                          </div>
                          {tg.units.length ? (
                            <div className="muted u-text-sm">
                              {t('softwareLifecycle.unitsList', {
                                list: tg.units.join(', '),
                              })}
                            </div>
                          ) : null}
                          <div className="software-uninstall-wizard__impacts">
                            {tg.impactKeys.map((k) => (
                              <Badge key={k} tone="danger">
                                {impactLabel(k)}
                              </Badge>
                            ))}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
                {preview.warningKeys?.length ? (
                  <ul className="software-uninstall-wizard__warns">
                    {preview.warningKeys.map((k) => (
                      <li key={k}>{impactLabel(k)}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="stack">
                <Field
                  label={t('softwareLifecycle.dataPolicy')}
                  htmlFor="un-policy"
                  flush
                >
                  <SegRadio
                    name="un-policy"
                    aria-label={t('softwareLifecycle.dataPolicy')}
                    value={dataPolicy}
                    onChange={(v) =>
                      setDataPolicy(v === 'purge' ? 'purge' : 'keep')
                    }
                    options={[
                      {
                        value: 'keep',
                        label: t('softwareLifecycle.policyKeep'),
                      },
                      {
                        value: 'purge',
                        label: t('softwareLifecycle.policyPurge'),
                      },
                    ]}
                  />
                </Field>
                {dataPolicy === 'purge' ? (
                  <Alert variant="error">
                    {t('softwareLifecycle.purgeWarning')}
                  </Alert>
                ) : (
                  <Alert variant="info">
                    {t('softwareLifecycle.keepHint')}
                  </Alert>
                )}
                <div className="muted u-text-sm">
                  {t('softwareLifecycle.summaryLine', {
                    packages: preview.summary.packageCount,
                    units: preview.summary.unitCount,
                  })}
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="stack">
                <Alert variant="warn">
                  {t('softwareLifecycle.doubleConfirmIntro')}
                </Alert>
                <CheckboxField
                  id="un-ack"
                  label={t('softwareLifecycle.ackLabel')}
                  checked={ack}
                  onChange={setAck}
                />
                <Field
                  label={t('softwareLifecycle.typePhrase', {
                    phrase: preview.confirmPhrase,
                  })}
                  htmlFor="un-phrase"
                  flush
                  required
                >
                  <input
                    id="un-phrase"
                    className="u-input"
                    value={phrase}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder={preview.confirmPhrase}
                  />
                </Field>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="muted">{text}</p>;
}
