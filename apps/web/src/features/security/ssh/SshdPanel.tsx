import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardSection,
  Field,
  FormActions,
  FormHint,
} from '../../../shared/components/ui';
import { sshApi } from './api';

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
};

export function SshdPanel({ onFlash }: Props) {
  const [snippet, setSnippet] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    const r = await sshApi.sshdSnippet();
    setSnippet(r.snippet ?? '');
    setNotes(r.notes ?? []);
  }

  useEffect(() => {
    void load().catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <div className="stack-gap">
      {err ? <Alert variant="error">{err}</Alert> : null}

      <Card>
        <CardSection
          title="專案用戶 SFTP（sshd）"
          description="讓 ysks_* / ysk_* 專案用戶可用公鑰 SFTP。未安裝時，登入授權可能無效。"
        >
          <div className="ssh-callout">
            <ol className="list-spaced u-mb-0">
              <li>在「登入授權」為專案加入公鑰</li>
              <li>在此預覽並安裝系統 Match 片段</li>
              <li>安裝需要系統執行權限；會嘗試 reload sshd</li>
            </ol>
          </div>

          {notes.length > 0 ? (
            <ul className="list-plain u-mb-3">
              {notes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}

          <Field label="設定預覽" htmlFor="sshd-snip" flush fullWidth>
            <textarea
              id="sshd-snip"
              rows={12}
              readOnly
              value={snippet || '（載入中…）'}
              className="u-font-mono"
              spellCheck={false}
            />
          </Field>

          <FormActions>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void load()
                  .then(() => {
                    void navigator.clipboard?.writeText(snippet);
                    onFlash('ok', '已重新載入；片段已複製到剪貼簿');
                  })
                  .catch((e: Error) => setErr(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              重新載入並複製
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void sshApi
                  .applySshd()
                  .then((r) => {
                    onFlash(
                      r.ok ? 'ok' : 'error',
                      (r.notes ?? []).join('；') || (r.ok ? '已安裝' : '未完成'),
                    );
                  })
                  .catch((e: Error) => onFlash('error', e.message))
                  .finally(() => setBusy(false));
              }}
            >
              安裝到系統
            </Button>
          </FormActions>
          <FormHint>
            若提示無法執行，請以具備權限的方式執行控制面，或手動將片段放入{' '}
            <code className="inline">/etc/ssh/sshd_config.d</code>。
          </FormHint>
        </CardSection>
      </Card>
    </div>
  );
}
