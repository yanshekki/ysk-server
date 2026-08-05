/**
 * Render otpauth:// URL as a scannable QR (data URL).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type TotpQrProps = {
  otpauthUrl: string;
  /** CSS size of the image (default 200) */
  size?: number;
  className?: string;
};

export function TotpQr({ otpauthUrl, size = 200, className }: TotpQrProps) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setErr(null);
    if (!otpauthUrl) return;
    void (async () => {
      try {
        const QR = await import('qrcode');
        const url = await QR.toDataURL(otpauthUrl, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: size * 2,
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        if (!cancelled) setDataUrl(url);
      } catch {
        if (!cancelled) setErr(t('security.totpQrFailed'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl, size, t]);

  if (err) {
    return (
      <div className="totp-qr totp-qr--err" role="alert">
        {err}
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div
        className="totp-qr totp-qr--loading"
        style={{ width: size, height: size }}
        aria-busy="true"
      >
        <span className="muted u-text-sm">{t('common.loading')}</span>
      </div>
    );
  }
  return (
    <img
      className={className ? `totp-qr ${className}` : 'totp-qr'}
      src={dataUrl}
      width={size}
      height={size}
      alt={t('security.totpQrAlt')}
    />
  );
}

/** Group Base32 secret for readability: ABCD EFGH … */
export function formatTotpSecret(secret: string): string {
  const s = secret.replace(/\s+/g, '').toUpperCase();
  return s.replace(/(.{4})/g, '$1 ').trim();
}
