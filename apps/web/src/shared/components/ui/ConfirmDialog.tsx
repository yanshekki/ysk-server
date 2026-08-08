/**
 * Severity-aware delete / destructive confirmation.
 * L1 soft · L2 standard (danger btn) · L3 consequences list · L4 type-to-confirm.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import { Alert } from './Alert';
import { Field } from './Field';

export type ConfirmSeverity = 'soft' | 'standard' | 'destructive' | 'critical';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  /** L3+ bullet consequences */
  consequences?: string[];
  /**
   * L4: user must type this exact string to enable confirm.
   * When set, severity is treated as critical if not already.
   */
  confirmText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * soft | standard | destructive | critical
   * Legacy: `danger` true maps to standard.
   */
  severity?: ConfirmSeverity;
  /** @deprecated use severity="standard" | "destructive" */
  danger?: boolean;
  busy?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  consequences,
  confirmText,
  confirmLabel,
  cancelLabel,
  severity: severityProp,
  danger = false,
  busy = false,
  children }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');

  const severity: ConfirmSeverity =
    severityProp ??
    (confirmText ? 'critical' : danger ? 'standard' : 'soft');

  const needsType = severity === 'critical' || Boolean(confirmText);
  const matchToken = (confirmText ?? '').trim();
  const typedOk = !needsType || typed.trim() === matchToken;

  useEffect(() => {
    if (open) setTyped('');
  }, [open, matchToken]);

  const isDanger = severity !== 'soft';
  const showConsequences =
    (severity === 'destructive' || severity === 'critical') &&
    consequences &&
    consequences.length > 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      description={description}
      size={needsType || showConsequences ? 'md' : 'sm'}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t('dialogs.cancelDefault')}
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            size="md"
            onClick={onConfirm}
            loading={busy}
            disabled={!typedOk}
          >
            {confirmLabel ?? t('dialogs.confirmDefault')}
          </Button>
        </>
      }
    >
      <div className="confirm-dialog-body">
        {showConsequences ? (
          <Alert variant="warn" className="confirm-dialog-body__consequences">
            <p className="u-text-sm u-mb-2 u-mt-0">
              <strong>{t('dialogs.severity.consequencesTitle')}</strong>
            </p>
            <ul className="list-plain list-spaced u-text-sm u-mb-0">
              {consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {needsType && matchToken ? (
          <Field
            label={t('dialogs.severity.typeToConfirm', { text: matchToken })}
            htmlFor="confirm-type-token"
            flush
          >
            <input
              id="confirm-type-token"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              placeholder={matchToken}
            />
          </Field>
        ) : null}

        {children}
      </div>
    </Modal>
  );
}
