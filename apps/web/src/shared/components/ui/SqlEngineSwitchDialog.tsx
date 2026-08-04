/**
 * MySQL XOR MariaDB exclusive switch — professional confirm UX.
 * All operator copy from i18n (warningKeys from API, not English prose).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import { Badge } from './Badge';
import type { SqlSwitchPreview } from '../../../features/software/api';

export interface SqlEngineSwitchDialogProps {
  open: boolean;
  preview: SqlSwitchPreview | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const DEFAULT_WARN_KEYS = [
  'replace_engine',
  'exclusive',
  'uninstall_packages',
  'logical_dump',
  'dialect_risk',
  'no_replication',
  'root_auth',
] as const;

export function SqlEngineSwitchDialog({
  open,
  preview,
  busy = false,
  onClose,
  onConfirm,
}: SqlEngineSwitchDialogProps) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState('');

  useEffect(() => {
    if (open) {
      setAck(false);
      setPhrase('');
    }
  }, [open, preview?.target]);

  const expected = preview?.confirmPhrase || 'SWITCH';
  const canConfirm = Boolean(preview && ack && phrase.trim() === expected && !busy);

  const fromLabel = useMemo(() => {
    if (!preview) return '—';
    if (preview.currentFlavor === 'mysql') return 'MySQL';
    if (preview.currentFlavor === 'mariadb') return 'MariaDB';
    return '—';
  }, [preview]);

  const toLabel = preview?.target === 'mysql' ? 'MySQL' : preview?.target === 'mariadb' ? 'MariaDB' : '—';

  const warnKeys = useMemo(() => {
    if (!preview) return [...DEFAULT_WARN_KEYS];
    if (preview.warningKeys?.length) return preview.warningKeys;
    return [
      ...DEFAULT_WARN_KEYS,
      (preview.databases?.length ?? 0) > 0 ? 'has_user_dbs' : 'no_user_dbs',
    ];
  }, [preview]);

  const impactKeys = warnKeys.filter((k) =>
    ['replace_engine', 'exclusive', 'uninstall_packages', 'logical_dump', 'has_user_dbs', 'no_user_dbs'].includes(
      k,
    ),
  );
  const limitKeys = warnKeys.filter((k) =>
    ['dialect_risk', 'no_replication', 'root_auth'].includes(k),
  );

  if (!preview) return null;

  const dbCount = preview.databases?.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t('sqlEngineSwitch.title', { target: toLabel })}
      description={t('sqlEngineSwitch.subtitle', { from: fromLabel, to: toLabel })}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>
            {t('dialogs.cancelDefault')}
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={onConfirm}
            loading={busy}
            disabled={!canConfirm}
          >
            {t('sqlEngineSwitch.confirm')}
          </Button>
        </>
      }
    >
      <div className="sesd">
        {/* Engine flow */}
        <section className="sesd__hero" aria-label={t('sqlEngineSwitch.flowAria')}>
          <div className="sesd__engine">
            <span className="sesd__engine-label">{t('sqlEngineSwitch.from')}</span>
            <Badge tone="warn">{fromLabel}</Badge>
          </div>
          <div className="sesd__arrow" aria-hidden>
            →
          </div>
          <div className="sesd__engine">
            <span className="sesd__engine-label">{t('sqlEngineSwitch.to')}</span>
            <Badge tone="ok">{toLabel}</Badge>
          </div>
        </section>

        <div className="sesd__callout" role="status">
          <strong className="sesd__callout-title">{t('sqlEngineSwitch.calloutTitle')}</strong>
          <p className="sesd__callout-body muted u-text-sm u-mb-0">
            {t('sqlEngineSwitch.calloutBody', { from: fromLabel, to: toLabel })}
          </p>
        </div>

        {/* What will happen */}
        <section className="sesd__section">
          <h3 className="sesd__section-title">{t('sqlEngineSwitch.sectionImpact')}</h3>
          {/* ul + custom badges only — never <ol> markers (avoids 1. 1 double numbers) */}
          <ul className="sesd__steps">
            {impactKeys.map((key, i) => (
              <li key={key} className="sesd__step">
                <span className="sesd__step-num" aria-hidden>
                  {i + 1}
                </span>
                <span className="sesd__step-text">
                  {t(`sqlEngineSwitch.warn.${key}`, {
                    from: fromLabel,
                    to: toLabel,
                    count: dbCount,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Databases */}
        <section className="sesd__section">
          <div className="sesd__section-head">
            <h3 className="sesd__section-title u-mb-0">
              {t('sqlEngineSwitch.dbListTitle', { count: dbCount })}
            </h3>
            {dbCount > 0 ? (
              <Badge tone="neutral">{t('sqlEngineSwitch.dbMigrateBadge', { count: dbCount })}</Badge>
            ) : (
              <Badge tone="warn">{t('sqlEngineSwitch.dbEmptyBadge')}</Badge>
            )}
          </div>
          {dbCount === 0 ? (
            <p className="muted u-text-sm u-mb-0">{t('sqlEngineSwitch.noUserDbs')}</p>
          ) : (
            <ul className="sesd__db-grid">
              {preview.databases.map((d) => (
                <li key={d.name} className="sesd__db-chip">
                  <span className="sesd__db-name">{d.name}</span>
                  {typeof d.tableCount === 'number' ? (
                    <span className="sesd__db-meta muted">
                      {t('sqlEngineSwitch.tableCount', { count: d.tableCount })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Limitations */}
        {limitKeys.length > 0 ? (
          <section className="sesd__section sesd__section--muted">
            <h3 className="sesd__section-title">{t('sqlEngineSwitch.sectionLimits')}</h3>
            <ul className="sesd__limits">
              {limitKeys.map((key) => (
                <li key={key}>
                  {t(`sqlEngineSwitch.warn.${key}`, { from: fromLabel, to: toLabel })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Confirm gates */}
        <section className="sesd__confirm">
          <label className="sesd__ack">
            <input
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>{t('sqlEngineSwitch.ackLabel', { from: fromLabel, to: toLabel })}</span>
          </label>

          <div className="sesd__phrase">
            <label className="sesd__phrase-label" htmlFor="sesd-phrase">
              {t('sqlEngineSwitch.phraseLabel', { phrase: expected })}
            </label>
            <input
              id="sesd-phrase"
              className="sesd__phrase-input"
              type="text"
              value={phrase}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={expected}
              onChange={(e) => setPhrase(e.target.value)}
            />
            {phrase.length > 0 && phrase.trim() !== expected ? (
              <p className="sesd__phrase-hint" role="alert">
                {t('sqlEngineSwitch.phraseMismatch')}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </Modal>
  );
}
