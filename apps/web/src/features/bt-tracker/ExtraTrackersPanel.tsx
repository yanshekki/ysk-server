/**
 * Operator extra announce list (used when downloading / seeding).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button } from '../../shared/components/ui';
import type { BtExtraTracker, BtTrackerSettings } from './api';
import { btTrackerApi } from './api';

function protoOf(url: string): string {
  const u = url.toLowerCase();
  if (u.startsWith('https://')) return 'HTTPS';
  if (u.startsWith('http://')) return 'HTTP';
  if (u.startsWith('wss://')) return 'WSS';
  if (u.startsWith('ws://')) return 'WS';
  if (u.startsWith('udp://')) return 'UDP';
  return 'URL';
}

export function ExtraTrackersPanel(props: {
  settings: BtTrackerSettings | null;
  busy: boolean;
  onSave: (extra: BtExtraTracker[]) => Promise<void>;
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const extra = props.settings?.extraTrackers ?? [];

  function validate(raw: string): boolean {
    const s = raw.trim();
    if (!s) return false;
    return /^(https?|udp|wss?):\/\//i.test(s) && !/javascript:/i.test(s) && !/\s/.test(s);
  }

  return (
    <div className="tab-panel bt-extras">
      <Alert variant="info">{t('btTracker.extraTrackersDesc')}</Alert>
      <form
        className="bt-extras__add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!validate(url)) {
            setFieldErr(t('btTracker.extraTrackerBad'));
            return;
          }
          const key = url.trim().toLowerCase();
          if (extra.some((x) => x.url.toLowerCase() === key)) {
            setFieldErr(t('btTracker.extraTrackerDup'));
            return;
          }
          if (extra.length >= 32) {
            setFieldErr(t('btTracker.extraTrackerLimit'));
            return;
          }
          setFieldErr(null);
          void props.onSave([...extra, { url: url.trim(), enabled: true }]).then(() => setUrl(''));
        }}
      >
        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('btTracker.extraTrackerUrl')}
          aria-label={t('btTracker.extraTrackerUrl')}
        />
        <Button type="submit" variant="primary" size="sm" disabled={props.busy}>
          {t('btTracker.extraTrackerAdd')}
        </Button>
      </form>
      {fieldErr ? <p className="bt-add__err">{fieldErr}</p> : null}

      {extra.length === 0 ? (
        <div className="bt-empty bt-empty--compact">
          <p className="bt-empty__title">{t('btTracker.extraTrackersEmpty')}</p>
        </div>
      ) : (
        <ul className="bt-extras__list">
          {extra.map((row) => (
            <li key={row.url} className="bt-extras__row">
              <Badge tone="neutral">{protoOf(row.url)}</Badge>
              <code className="bt-extras__url">{row.url}</code>
              <label className="bt-toggle bt-toggle--compact">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  disabled={props.busy}
                  onChange={(e) => {
                    void props.onSave(
                      extra.map((x) =>
                        x.url === row.url ? { ...x, enabled: e.target.checked } : x,
                      ),
                    );
                  }}
                />
                <span className="bt-toggle__lab">{t('btTracker.extraEnabled')}</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={props.busy}
                onClick={() => void props.onSave(extra.filter((x) => x.url !== row.url))}
              >
                {t('common.delete', { defaultValue: 'Delete' })}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="bt-extras__apply">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={props.busy || extra.filter((x) => x.enabled).length === 0}
          onClick={() => {
            void btTrackerApi.applyTrackers().then(() => props.onApplied());
          }}
        >
          {t('btTracker.extraTrackerApply')}
        </Button>
      </div>
    </div>
  );
}
