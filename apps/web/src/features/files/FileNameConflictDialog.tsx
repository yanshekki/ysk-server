import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, CheckboxField, Modal } from '../../shared/components/ui';
import type { ConflictAction, ConflictDecision, FileNameConflictPrompt } from './name-conflict';

export function FileNameConflictDialog({
  open,
  prompt,
  onDecide,
}: {
  open: boolean;
  prompt: FileNameConflictPrompt | null;
  onDecide: (decision: ConflictDecision) => void;
}) {
  const { t } = useTranslation();
  const [applyToAll, setApplyToAll] = useState(false);

  useEffect(() => {
    if (open) setApplyToAll(false);
  }, [open, prompt?.destPath, prompt?.name]);

  if (!prompt) return null;

  const bothFolders = prompt.incomingType === 'dir' && prompt.destType === 'dir';
  const typeMismatch = prompt.incomingType !== prompt.destType;
  const title = bothFolders
    ? t('files.conflict.titleFolder', { name: prompt.name })
    : t('files.conflict.titleFile', { name: prompt.name });

  function decide(action: ConflictAction) {
    onDecide({ action, applyToAll });
  }

  function kindLabel(kind: 'file' | 'dir'): string {
    return kind === 'dir' ? t('files.conflict.kindFolder') : t('files.conflict.kindFile');
  }

  return (
    <Modal
      open={open}
      onClose={() => decide('cancel')}
      title={title}
      description={
        bothFolders ? t('files.conflict.descFolder') : t('files.conflict.descFile')
      }
      size="md"
      className="fm-conflict"
      footer={
        <Button variant="secondary" onClick={() => decide('cancel')}>
          {t('files.conflict.cancelRest')}
        </Button>
      }
    >
      <div className="fm-conflict__body">
        {prompt.total > 1 ? (
          <p className="muted u-text-sm u-mt-0">
            {t('files.conflict.progress', {
              current: prompt.current,
              total: prompt.total,
            })}
          </p>
        ) : null}

        {typeMismatch ? (
          <Alert variant="warn">
            {t('files.conflict.typeMismatch', {
              name: prompt.name,
              destKind: kindLabel(prompt.destType),
              incomingKind: kindLabel(prompt.incomingType),
            })}
          </Alert>
        ) : null}

        <div className="fm-conflict__compare">
          <div className="fm-conflict__card">
            <div className="fm-conflict__card-label">{t('files.conflict.incoming')}</div>
            <div className="fm-conflict__card-kind">{kindLabel(prompt.incomingType)}</div>
            <div className="fm-conflict__card-name" title={prompt.name}>
              {prompt.incomingType === 'dir' ? '📁 ' : '📄 '}
              {prompt.name}
            </div>
          </div>
          <div className="fm-conflict__card">
            <div className="fm-conflict__card-label">{t('files.conflict.existing')}</div>
            <div className="fm-conflict__card-kind">{kindLabel(prompt.destType)}</div>
            <div className="fm-conflict__card-name" title={prompt.destPath}>
              {prompt.destType === 'dir' ? '📁 ' : '📄 '}
              {prompt.name}
            </div>
          </div>
        </div>

        <div className="fm-conflict__actions" role="group" aria-label={title}>
          <button type="button" className="fm-conflict__choice" onClick={() => decide('skip')}>
            <strong>{t('files.conflict.skip')}</strong>
            <span>{t('files.conflict.skipHint')}</span>
          </button>
          <button
            type="button"
            className="fm-conflict__choice fm-conflict__choice--primary"
            onClick={() => decide('keepBoth')}
          >
            <strong>{t('files.conflict.keepBoth')}</strong>
            <span>{t('files.conflict.keepBothHint', { name: prompt.keepBothName })}</span>
          </button>
          {bothFolders ? (
            <button
              type="button"
              className="fm-conflict__choice fm-conflict__choice--primary"
              onClick={() => decide('merge')}
            >
              <strong>{t('files.conflict.merge')}</strong>
              <span>{t('files.conflict.mergeHint')}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="fm-conflict__choice fm-conflict__choice--danger"
            onClick={() => decide('replace')}
          >
            <strong>{t('files.conflict.replace')}</strong>
            <span>
              {bothFolders ? t('files.conflict.replaceFolderHint') : t('files.conflict.replaceHint')}
            </span>
          </button>
        </div>

        {prompt.remaining > 1 ? (
          <CheckboxField
            id="fm-conflict-apply-all"
            label={t('files.conflict.applyAll')}
            description={t('files.conflict.applyAllHint')}
            checked={applyToAll}
            onChange={setApplyToAll}
          />
        ) : null}
      </div>
    </Modal>
  );
}
