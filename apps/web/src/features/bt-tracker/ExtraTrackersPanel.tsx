/**
 * Operator extra announce list (used when downloading / seeding).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, EmptyState, Field, FormHint } from '../../shared/components/ui';
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
  const enabledCount = extra.filter((x) => x.enabled).length;

  function validate(raw: string): boolean {
    const s = raw.trim();
    if (!s) return false;
    return /^(https?|udp|wss?):\/\//i.test(s) && !/javascript:/i.test(s) && !/\s/.test(s);
  }

  return (
    <div className="tab-panel bt-extras">
      <section className="bt-card">
        <header className="bt-card__head">
          <h3 className="bt-card__title">{t('btTracker.extraTrackersTitle')}</h3>
          <FormHint>{t('btTracker.extraTrackersDesc')}</FormHint>
        </header>

        <form
          className="bt-extras__add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim()) {
              setFieldErr(t('btTracker.extraTrackerRequired'));
              return;
            }
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
          <Field
            label={t('btTracker.extraTrackerUrl')}
            htmlFor="bt-extra-url"
            error={fieldErr ?? undefined}
            flush
            fullWidth
          >
            <div className="bt-extras__composer">
              <input
                id="bt-extra-url"
                className="input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('btTracker.extraTrackerUrl')}
                aria-label={t('btTracker.extraTrackerUrl')}
              />
              <Button type="submit" variant="primary" size="sm" disabled={props.busy}>
                {t('btTracker.extraTrackerAdd')}
              </Button>
            </div>
          </Field>
        </form>

        {extra.length === 0 ? (
          <EmptyState
            title={t('btTracker.extraTrackersEmptyTitle')}
            description={t('btTracker.extraTrackersEmpty')}
          />
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
                  {t('common.delete')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <footer className="bt-extras__foot">
          <span className="muted u-text-sm">
            {t('btTracker.extraEnabledCount', { count: enabledCount })}
            {enabledCount === 0 ? ` · ${t('btTracker.extraApplyHint')}` : ''}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={props.busy || enabledCount === 0}
            onClick={() => {
              void btTrackerApi.applyTrackers().then(() => props.onApplied());
            }}
          >
            {t('btTracker.extraTrackerApply')}
          </Button>
        </footer>
      </section>
    </div>
  );
}
