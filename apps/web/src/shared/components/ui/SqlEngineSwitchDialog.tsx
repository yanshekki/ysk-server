/**
 * Strict confirm dialog: MySQL XOR MariaDB switch with data migration.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import type { SqlSwitchPreview } from '../../../features/software/api';

export interface SqlEngineSwitchDialogProps {
  open: boolean;
  preview: SqlSwitchPreview | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

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

  if (!preview) return null;

  const expected = preview.confirmPhrase || 'SWITCH';
  const canConfirm = ack && phrase.trim() === expected && !busy;
  const fromLabel =
    preview.currentFlavor === 'mysql'
      ? 'MySQL'
      : preview.currentFlavor === 'mariadb'
        ? 'MariaDB'
        : '—';
  const toLabel = preview.target === 'mysql' ? 'MySQL' : 'MariaDB';

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t('sqlEngineSwitch.title', { target: toLabel })}
      description={t('sqlEngineSwitch.subtitle', { from: fromLabel, to: toLabel })}
      size="md"
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
      <div className="sql-engine-switch-dialog">
        <ul className="sql-engine-switch-dialog__warnings">
          {(preview.warnings?.length
            ? preview.warnings
            : [
                t('sqlEngineSwitch.warnExclusive'),
                t('sqlEngineSwitch.warnUninstall', { from: fromLabel }),
                t('sqlEngineSwitch.warnMigrate'),
              ]
          ).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>

        <div className="sql-engine-switch-dialog__dbs">
          <strong>{t('sqlEngineSwitch.dbListTitle', { count: preview.databases?.length ?? 0 })}</strong>
          {(preview.databases?.length ?? 0) === 0 ? (
            <p className="muted u-text-sm">{t('sqlEngineSwitch.noUserDbs')}</p>
          ) : (
            <ul className="sql-engine-switch-dialog__db-list">
              {preview.databases.map((d) => (
                <li key={d.name}>
                  {d.name}
                  {typeof d.tableCount === 'number' ? ` (${d.tableCount} tables)` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="sql-engine-switch-dialog__check">
          <input
            type="checkbox"
            checked={ack}
            disabled={busy}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span>{t('sqlEngineSwitch.ackLabel', { from: fromLabel, to: toLabel })}</span>
        </label>

        <label className="sql-engine-switch-dialog__phrase">
          <span>{t('sqlEngineSwitch.phraseLabel', { phrase: expected })}</span>
          <input
            type="text"
            value={phrase}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder={expected}
            onChange={(e) => setPhrase(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}
