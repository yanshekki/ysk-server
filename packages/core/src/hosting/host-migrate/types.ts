/**
 * Core-side host-migrate helpers (re-export shared + local constants).
 */

export type {
  HostManifest,
  HostManifestProject,
  HostManifestDatabase,
  HostManifestRedis,
  HostManifestMailbox,
  MigratePhase,
  MigrateJobDto,
  MigrateJobStep,
  MigrateJobTarget,
  MigrateJobVerify,
  MigrateDbEngine,
} from '@yanshekki/shared';

export { MIGRATE_PHASES, isMigratePhase } from '@yanshekki/shared';

/** Job root under dataDir */
export function migrateJobDir(dataDir: string, jobId: string): string {
  return `${dataDir.replace(/\/$/, '')}/migrate/${jobId}`;
}
