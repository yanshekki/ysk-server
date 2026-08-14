import { useState, type ChangeEventHandler, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  onChange?: ChangeEventHandler<HTMLInputElement>;
};

/** Password field with a show/hide control (login, FTP, user forms). */
export function PasswordInput({ className, ...rest }: Props) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className={`password-input${className ? ` ${className}` : ''}`}>
      <input {...rest} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="password-input__toggle"
        onClick={() => setShow((v) => !v)}
        aria-pressed={show}
        aria-label={
          show
            ? t('common.hidePassword', { defaultValue: 'Hide password' })
            : t('common.showPassword', { defaultValue: 'Show password' })
        }
      >
        {show
          ? t('common.hidePassword', { defaultValue: 'Hide' })
          : t('common.showPassword', { defaultValue: 'Show' })}
      </button>
    </div>
  );
}
