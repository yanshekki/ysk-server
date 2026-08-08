/**
 * Modal text prompt — replaces window.prompt for operator UX.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, FormLayout } from './Field';

export type PromptDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Return false / throw to keep open; otherwise closes */
  onSubmit: (value: string) => void | boolean | Promise<void | boolean>;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** password-style input (TOTP) */
  secret?: boolean;
  danger?: boolean;
  busy?: boolean;
  /** Require exact match (e.g. EMERGENCY) */
  expectExact?: string;
};

export function PromptDialog({
  open,
  onClose,
  onSubmit,
  title,
  description,
  label,
  placeholder,
  defaultValue = '',
  confirmLabel,
  cancelLabel,
  secret = false,
  danger = false,
  busy = false,
  expectExact }: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const [localBusy, setLocalBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolvedLabel = label ?? t('common.input');
  const resolvedConfirm = confirmLabel ?? t('dialogs.confirmDefault');
  const resolvedCancel = cancelLabel ?? t('dialogs.cancelDefault');

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setErr(null);
    }
  }, [open, defaultValue]);

  const working = busy || localBusy;
  const canSubmit =
    value.trim().length > 0 &&
    (!expectExact || value.trim() === expectExact) &&
    !working;

  async function submit() {
    if (!canSubmit) {
      if (expectExact && value.trim() !== expectExact) {
        setErr(t('common.pleaseEnter', { value: expectExact }));
      }
      return;
    }
    setLocalBusy(true);
    setErr(null);
    try {
      const r = await onSubmit(value.trim());
      if (r === false) return;
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('common.failed'));
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !working && onClose()}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={working}
          >
            {resolvedCancel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="md"
            loading={working}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {resolvedConfirm}
          </Button>
        </>
      }
    >
      <FormLayout>
        <Field label={resolvedLabel} htmlFor="ysk-prompt-input" flush required>
          <input
            id="ysk-prompt-input"
            type={secret ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoComplete={secret ? 'one-time-code' : 'off'}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </Field>
      </FormLayout>
      {err ? (
        <p className="muted u-text-sm u-text-danger">
          {err}
        </p>
      ) : null}
    </Modal>
  );
}
