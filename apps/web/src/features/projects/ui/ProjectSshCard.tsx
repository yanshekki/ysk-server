/**
 * Compact SSH card on project resources — points to full SSH workspace.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectDto } from '@ysk/shared';
import {
  Badge,
  Button,
  Card,
  CardSection,
  FormActions,
  FormHint,
  FormLayout,
  Field,

  buttonClassName,} from '../../../shared/components/ui';
import { sshApi } from '../../security/ssh';
import { shortFingerprint, statusLabel, statusTone } from '../../security/ssh/labels';

export function ProjectSshCard(props: {
  project: ProjectDto;
  onMessage?: (msg: string) => void;
}) {
  const { project, onMessage } = props;
  const [busy, setBusy] = useState(false);
  const [loginN, setLoginN] = useState(0);
  const [identity, setIdentity] = useState<{
    id: string;
    name: string;
    fingerprintSha256: string;
    status: string;
  } | null>(null);

  async function refresh() {
    const [ids, keys] = await Promise.all([
      sshApi.listIdentities(),
      sshApi.listLoginKeys(),
    ]);
    const mine = (ids.items ?? []).filter(
      (i) =>
        i.status !== 'retired' &&
        (i.binding?.projectId === project.id ||
          (project.linuxUser && i.binding?.linuxUser === project.linuxUser)),
    );
    setIdentity(mine[0] ?? null);
    setLoginN(
      (keys.items ?? []).filter(
        (k) =>
          k.projectId === project.id ||
          (project.linuxUser && k.linuxUser === project.linuxUser),
      ).length,
    );
  }

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [project.id, project.linuxUser]);

  return (
    <Card>
      <CardSection
        title="SSH"
        description="登入公鑰決定誰能進來；出站身份決定這用戶出去用哪把匙。"
      >
        <FormLayout columns={2}>
          <Field label="允許登入的公鑰" htmlFor="p-ssh-login" flush>
            <input id="p-ssh-login" value={`${loginN} 把`} readOnly disabled />
          </Field>
          <Field label="出站身份" htmlFor="p-ssh-out" flush>
            <input
              id="p-ssh-out"
              value={
                identity
                  ? `${identity.name} · ${statusLabel(identity.status)}`
                  : '尚未建立'
              }
              readOnly
              disabled
            />
          </Field>
        </FormLayout>
        {identity ? (
          <FormHint>
            <Badge tone={statusTone(identity.status)}>{statusLabel(identity.status)}</Badge>{' '}
            <code className="inline u-break-all">
              {shortFingerprint(identity.fingerprintSha256)}
            </code>
          </FormHint>
        ) : (
          <FormHint>建立出站身份後，此專案用戶可用於 git／腳本連外。</FormHint>
        )}
        <FormActions>
          {!identity ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!project.linuxUser}
              onClick={() => {
                setBusy(true);
                void sshApi
                  .createIdentity({
                    name: `${project.name || project.id.slice(0, 8)}-outbound`,
                    purpose: 'user_outbound',
                    algorithm: 'ed25519',
                    binding: {
                      projectId: project.id,
                      linuxUser: project.linuxUser,
                      homeDir: project.homeDir,
                    },
                  })
                  .then((r) => {
                    onMessage?.(
                      (r.notes ?? []).join('；') ||
                        (r.ok ? '已建立出站身份（私鑰已加密保存）' : '建立失敗'),
                    );
                    return refresh();
                  })
                  .catch((e: Error) => onMessage?.(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              一鍵建立出站身份
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void sshApi
                  .install(identity.id, true)
                  .then((r) => {
                    onMessage?.((r.notes ?? []).join('；') || '已嘗試寫入磁碟');
                    return refresh();
                  })
                  .catch((e: Error) => onMessage?.(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              寫入 home/.ssh
            </Button>
          )}
          <Link
            to="/security?tab=ssh&ssh=outbound"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            開啟 SSH 工作台
          </Link>
          <Link to="/security?tab=ssh&ssh=login" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            管理登入公鑰
          </Link>
        </FormActions>
      </CardSection>
    </Card>
  );
}
