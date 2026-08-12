/**
 * Compact SSH card — create/install identity only (no redirect fluff).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@yanshekki/shared';
import {
  Badge,
  Button,
  Card,
  CardSection,
  FormActions,
  FormLayout,
  Field } from '../../../shared/components/ui';
import { sshApi } from '../../security/ssh';
import { shortFingerprint, statusLabel, statusTone } from '../../security/ssh/labels';

export function ProjectSshCard(props: {
  project: ProjectDto;
  onMessage?: (msg: string) => void;
}) {
  const { t } = useTranslation();
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
      <CardSection title="SSH">
        <FormLayout columns={2}>
          <Field label={t('projects.sshLoginKeys')} htmlFor="p-ssh-login" flush>
            <input id="p-ssh-login" value={t('projects.sshKeyCount', { count: loginN })} readOnly disabled />
          </Field>
          <Field label={t('projects.sshOutbound')} htmlFor="p-ssh-out" flush>
            <input
              id="p-ssh-out"
              value={
                identity
                  ? `${identity.name} · ${statusLabel(identity.status, t)}`
                  : t('projects.sshOutboundNone')
              }
              readOnly
              disabled
            />
          </Field>
        </FormLayout>
        {identity ? (
          <p className="muted u-text-sm">
            <Badge tone={statusTone(identity.status)}>{statusLabel(identity.status, t)}</Badge>{' '}
            <code className="inline u-break-all">
              {shortFingerprint(identity.fingerprintSha256)}
            </code>
          </p>
        ) : null}
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
                      homeDir: project.homeDir } })
                  .then((r) => {
                    onMessage?.(
                      (r.notes ?? []).join('；') ||
                        (r.ok ? t('projects.sshOutboundCreated') : t('common.createFailed')),
                    );
                    return refresh();
                  })
                  .catch((e: Error) => onMessage?.(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('projects.sshCreateOutbound')}
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
                    onMessage?.((r.notes ?? []).join('；') || t('projects.sshWriteTried'));
                    return refresh();
                  })
                  .catch((e: Error) => onMessage?.(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('projects.sshWriteHome')}
            </Button>
          )}
        </FormActions>
      </CardSection>
    </Card>
  );
}
