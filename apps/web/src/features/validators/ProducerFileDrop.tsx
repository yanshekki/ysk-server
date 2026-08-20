/**
 * One Cardano hot-key slot: click or drop a single file. Native file control stays
 * in the DOM (sr-only) so tests and assistive tech keep working.
 */
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button } from '../../shared/components/ui';

function firstFile(dt: DataTransfer | null): File | undefined {
  const f = dt?.files?.[0];
  return f && f.size > 0 ? f : undefined;
}

export function ProducerFileDrop({
  id,
  label,
  fileHint,
  present,
  fingerprint,
  queuedName,
  onFile,
  onClear,
}: {
  id: string;
  label: string;
  fileHint: string;
  present?: boolean;
  fingerprint?: string | null;
  queuedName?: string;
  onFile: (file: File) => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState(0);
  const queued = Boolean(queuedName);
  const onDisk = Boolean(present && fingerprint);

  function statusLabel(): { text: string; tone: 'ok' | 'warn' | 'neutral' } {
    if (queued) return { text: t('validators.producer.queuedShort'), tone: 'ok' };
    if (onDisk) return { text: t('validators.producer.presentShort'), tone: 'ok' };
    return { text: t('validators.producer.missing'), tone: 'neutral' };
  }

  const status = statusLabel();

  function enter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDrag((d) => d + 1);
  }

  function over(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function leave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDrag((d) => Math.max(0, d - 1));
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDrag(0);
    const f = firstFile(e.dataTransfer);
    if (f) onFile(f);
  }

  const cls = [
    'val-producer-slot',
    drag > 0 ? 'is-drag' : '',
    queued ? 'is-queued' : '',
    onDisk && !queued ? 'is-attached' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-testid={`${id}-drop`}
      onDragEnter={enter}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
    >
      <div className="val-producer-slot__head">
        <span className="val-producer-slot__label">{label}</span>
        <Badge tone={status.tone}>{status.text}</Badge>
      </div>
      <label className="val-producer-slot__drop" htmlFor={id}>
        <input
          id={id}
          className="sr-only"
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
        <span className="val-producer-slot__glyph" aria-hidden>
          {drag > 0 ? '↓' : queued ? '●' : '+'}
        </span>
        <span className="val-producer-slot__title">
          {drag > 0
            ? t('validators.producer.dropping', { label })
            : queuedName
              ? queuedName
              : t('validators.producer.dropOrBrowse', { file: fileHint })}
        </span>
        <span className="val-producer-slot__browse">{t('validators.producer.browse')}</span>
      </label>
      <div className="val-producer-slot__foot">
        <p className="val-producer-slot__meta">
          {queuedName
            ? t('validators.producer.queued', { name: queuedName })
            : onDisk
              ? t('validators.producer.present', { fp: fingerprint })
              : t('validators.producer.fileHint', { file: fileHint })}
        </p>
        {queuedName && onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }}
          >
            {t('validators.producer.clearFile')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
