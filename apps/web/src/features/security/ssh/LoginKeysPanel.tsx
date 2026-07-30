import { useCallback, useEffect, useState } from 'react';
import { ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
} from '../../../shared/components/ui';
import { sshApi } from './api';
import type { ProjectOpt, SftpKeyRow } from './types';

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
  onChanged: () => void;
};

export function LoginKeysPanel({ onFlash, onChanged }: Props) {
  const [items, setItems] = useState<SftpKeyRow[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [pub, setPub] = useState('');
  const [comment, setComment] = useState('');

  const refresh = useCallback(async () => {
    setErr(null);
    const [keys, projs] = await Promise.all([
      sshApi.listLoginKeys(),
      sshApi.listProjects(),
    ]);
    setItems(keys.items ?? []);
    setProjects(projs);
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setErr(e.message));
  }, [refresh]);

  async function addKey() {
    if (!projectId || !pub.trim().startsWith('ssh-')) {
      onFlash('error', '請選擇專案並貼上以 ssh- 開頭的公鑰');
      return;
    }
    setBusy(true);
    try {
      const r = await sshApi.addLoginKey({
        projectId,
        publicKey: pub.trim(),
        comment: comment.trim() || undefined,
      });
      onFlash(r.ok ? 'ok' : 'error', (r.notes ?? []).join('；') || (r.ok ? '已加入' : '失敗'));
      if (r.ok) {
        setOpen(false);
        setPub('');
        setComment('');
        await refresh();
        onChanged();
      }
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-gap">
      {err ? <Alert variant="error">{err}</Alert> : null}

      <Card>
        <CardSection
          title="登入授權（公鑰）"
          description="決定「誰可以進來」。只存公鑰，寫入專案 home 的 authorized_keys。與出站私鑰無關。"
        >
          <ActionBar className="u-mb-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setProjectId(projects[0]?.id ?? '');
                setOpen(true);
              }}
            >
              新增登入公鑰
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={() => void refresh().catch((e: Error) => setErr(e.message))}
            >
              重新整理
            </Button>
          </ActionBar>

          {items.length === 0 ? (
            <EmptyState
              title="還沒有允許登入的公鑰"
              description="把筆電或 CI 的公鑰貼上來，綁到專案用戶後即可 SFTP／SSH（需 sshd 片段）。"
              action={
                <Button variant="primary" size="md" onClick={() => setOpen(true)}>
                  新增第一把登入公鑰
                </Button>
              }
            />
          ) : (
            <div className="list-panel">
              {items.map((k) => (
                <div key={k.id} className="list-row list-row--static">
                  <div className="list-row__main">
                    <div className="list-row__title">
                      <span>{k.username}</span>
                      {k.comment ? <span className="muted">· {k.comment}</span> : null}
                      {k.projectId ? (
                        <Badge tone="info">專案</Badge>
                      ) : (
                        <Badge tone="neutral">未綁專案</Badge>
                      )}
                    </div>
                    <div className="list-row__meta">
                      <span className="u-font-mono u-break-all">
                        {k.publicKey.slice(0, 56)}
                        {k.publicKey.length > 56 ? '…' : ''}
                      </span>
                      {k.homeDir ? <span>{k.homeDir}/.ssh</span> : null}
                    </div>
                  </div>
                  <div className="list-row__side">
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      onClick={() => {
                        setBusy(true);
                        void sshApi
                          .removeLoginKey(k.id)
                          .then(() => {
                            onFlash('ok', '已移除公鑰');
                            return refresh();
                          })
                          .then(() => onChanged())
                          .catch((e: Error) => onFlash('error', e.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      移除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="允許一把公鑰登入"
        description="選擇專案後，公鑰會寫入該 Linux 用戶 home/.ssh/authorized_keys"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={!projectId || !pub.trim()}
              onClick={() => void addKey()}
            >
              加入授權
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label="專案" htmlFor="login-proj" flush required>
            <select
              id="login-proj"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— 選擇 —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.linuxUser}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="公鑰"
            htmlFor="login-pub"
            flush
            required
            fullWidth
            hint="整行貼上，例如 ssh-ed25519 AAAA… comment"
          >
            <textarea
              id="login-pub"
              rows={4}
              value={pub}
              onChange={(e) => setPub(e.target.value)}
              className="u-font-mono"
              spellCheck={false}
              placeholder="ssh-ed25519 AAAA… user@laptop"
            />
          </Field>
          <Field label="備註（可選）" htmlFor="login-cmt" flush>
            <input
              id="login-cmt"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="筆電 / CI"
            />
          </Field>
        </FormLayout>
        {projects.length === 0 ? (
          <FormHint>請先建立專案。系統用戶就緒後再綁公鑰效果最佳。</FormHint>
        ) : null}
      </Modal>
    </div>
  );
}
