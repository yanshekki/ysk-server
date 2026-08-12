/**
 * Real self-update: resolve latest from npm / GitHub releases, plan, optional apply.
 * Never pretends "already latest" when the channel was not actually checked.
 */

import { planSelfUpdate, compareVersions, isValidSha256 } from './self-update.js';
import type { HostExecutor } from '../host/executor.js';
import { ErrorCodes, YskError, tl} from '@yanshekki/shared';
import { shellBinExists } from '../hosting/software-probe/index.js';

export interface RegistryVersion {
  latest: string;
  tarball?: string;
  shasum?: string;
  channel: 'npm' | 'github' | 'env';
  packageName?: string;
  sourceUrl?: string;
}

export type SelfUpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  lastCheckAt: string;
  channel: string;
  packageName?: string;
  ok: boolean;
  checked: boolean;
  notes: string[];
  registry?: RegistryVersion;
  plan: ReturnType<typeof planSelfUpdate>;
  steps: string[];
};

const DEFAULT_NPM_CANDIDATES = [
  process.env.YSK_NPM_PACKAGE,
  'ysk-server',
  'ysk-server',
].filter((x): x is string => Boolean(x && x.trim()));

const DEFAULT_GITHUB_REPO =
  process.env.YSK_GITHUB_REPO?.trim() || 'yanshekki/ysk-server';

/**
 * Query npm registry for package latest version.
 */
export async function fetchNpmLatest(packageName = 'ysk-server'): Promise<RegistryVersion> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new YskError(ErrorCodes.UPDATE_FAILED, tl('notes.auto.t0469', { v0: (res.status) }), {
      httpStatus: 502,
      details: { packageName, url },
    });
  }
  const body = (await res.json()) as {
    version?: string;
    dist?: { tarball?: string; shasum?: string };
  };
  if (!body.version) {
    throw new YskError(ErrorCodes.UPDATE_FAILED, tl('notes.auto.n0347'), { httpStatus: 502 });
  }
  return {
    latest: body.version.replace(/^v/, ''),
    tarball: body.dist?.tarball,
    shasum: body.dist?.shasum,
    channel: 'npm',
    packageName,
    sourceUrl: url,
  };
}

/**
 * Query GitHub releases/latest for tag_name.
 */
export async function fetchGithubLatest(
  repo = DEFAULT_GITHUB_REPO,
): Promise<RegistryVersion> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ysk-server-self-update',
    },
  });
  if (!res.ok) {
    throw new YskError(
      ErrorCodes.UPDATE_FAILED,
      tl('notes.auto.t0470', { v0: (res.status) }),
      { httpStatus: 502, details: { repo, url } },
    );
  }
  const body = (await res.json()) as {
    tag_name?: string;
    name?: string;
    tarball_url?: string;
  };
  const tag = (body.tag_name || body.name || '').trim();
  if (!tag) {
    throw new YskError(ErrorCodes.UPDATE_FAILED, tl('notes.auto.n0111'), {
      httpStatus: 502,
    });
  }
  return {
    latest: tag.replace(/^v/, ''),
    tarball: body.tarball_url,
    channel: 'github',
    packageName: repo,
    sourceUrl: url,
  };
}

/**
 * Fallback: read version from repo package.json on default branch (source installs).
 */
export async function fetchGithubPackageJsonVersion(
  repo = DEFAULT_GITHUB_REPO,
  branch = process.env.YSK_GITHUB_BRANCH?.trim() || 'main',
  path = process.env.YSK_GITHUB_PACKAGE_JSON?.trim() || 'package.json',
): Promise<RegistryVersion> {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ysk-server-self-update', Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new YskError(
      ErrorCodes.UPDATE_FAILED,
      tl('notes.auto.t0471', { v0: (res.status) }),
      { httpStatus: 502, details: { repo, branch, path, url } },
    );
  }
  const body = (await res.json()) as { version?: string; name?: string };
  if (!body.version) {
    throw new YskError(ErrorCodes.UPDATE_FAILED, tl('notes.auto.n0110'), {
      httpStatus: 502,
    });
  }
  return {
    latest: body.version.replace(/^v/, ''),
    channel: 'github',
    packageName: body.name || repo,
    sourceUrl: url,
  };
}

/**
 * Resolve latest version from override → npm candidates → GitHub.
 * Throws only if every channel fails and no override.
 */
export async function resolveLatestVersion(input?: {
  packageName?: string;
  latestOverride?: string;
  githubRepo?: string;
}): Promise<{ registry: RegistryVersion; notes: string[] }> {
  const notes: string[] = [];

  const envLatest = process.env.YSK_LATEST_VERSION?.trim();
  if (input?.latestOverride?.trim()) {
    return {
      registry: {
        latest: input.latestOverride.trim().replace(/^v/, ''),
        channel: 'env',
        packageName: input.packageName,
      },
      notes: [tl('notes.auto.n0540')],
    };
  }
  if (envLatest) {
    return {
      registry: {
        latest: envLatest.replace(/^v/, ''),
        channel: 'env',
        packageName: input?.packageName,
      },
      notes: [tl('notes.auto.n0541')],
    };
  }

  const npmNames = input?.packageName
    ? [input.packageName, ...DEFAULT_NPM_CANDIDATES.filter((n) => n !== input.packageName)]
    : DEFAULT_NPM_CANDIDATES;

  for (const name of npmNames) {
    try {
      const registry = await fetchNpmLatest(name);
      notes.push(tl('notes.auto.t0472', { v0: (name), v1: (registry.latest) }));
      return { registry, notes };
    } catch (e) {
      notes.push(
        tl('notes.auto.t0473', { v0: (name), v1: (e instanceof Error ? e.message : String(e)) }),
      );
    }
  }

  const repo = input?.githubRepo ?? DEFAULT_GITHUB_REPO;
  try {
    const registry = await fetchGithubLatest(repo);
    notes.push(`GitHub release：${registry.packageName} tag ${registry.latest}`);
    return { registry, notes };
  } catch (e) {
    notes.push(tl('notes.auto.t0474', { v0: (e instanceof Error ? e.message : String(e)) }));
  }

  try {
    const registry = await fetchGithubPackageJsonVersion(repo);
    notes.push(
      tl('notes.auto.t0475', { v0: (registry.sourceUrl), v1: (registry.latest) }),
    );
    return { registry, notes };
  } catch (e) {
    notes.push(
      tl('notes.auto.t0476', { v0: (e instanceof Error ? e.message : String(e)) }),
    );
  }

  throw new YskError(
    ErrorCodes.UPDATE_FAILED,
    tl('notes.auto.n1170'),
    { httpStatus: 502, details: { notes } },
  );
}

/**
 * Check only — honest status for panel GET /updates/self.
 */
export async function checkSelfUpdate(input: {
  currentVersion: string;
  packageName?: string;
  latestOverride?: string;
  githubRepo?: string;
}): Promise<SelfUpdateCheckResult> {
  const at = new Date().toISOString();
  try {
    const { registry, notes } = await resolveLatestVersion({
      packageName: input.packageName,
      latestOverride: input.latestOverride,
      githubRepo: input.githubRepo,
    });
    if (registry.shasum && !isValidSha256(registry.shasum) && registry.shasum.length !== 40) {
      notes.push(tl('notes.auto.n0404'));
    }
    const plan = planSelfUpdate({
      current: input.currentVersion,
      latest: registry.latest,
      checksumSha256:
        registry.shasum && isValidSha256(registry.shasum) ? registry.shasum : undefined,
    });
    if (!plan.status.updateAvailable) {
      notes.push(tl('notes.auto.n0784'));
    } else {
      notes.push(tl('notes.auto.t0477', { v0: (input.currentVersion), v1: (registry.latest) }));
    }
    return {
      currentVersion: input.currentVersion,
      latestVersion: registry.latest,
      updateAvailable: plan.status.updateAvailable,
      lastCheckAt: at,
      channel: registry.channel,
      packageName: registry.packageName,
      ok: true,
      checked: true,
      notes,
      registry,
      plan,
      steps: plan.steps,
    };
  } catch (e) {
    const notes = [
      e instanceof Error ? e.message : String(e),
      tl('notes.auto.n0974'),
    ];
    // Keep plan shape with latest=current only for structure; flag checked=false
    const plan = planSelfUpdate({
      current: input.currentVersion,
      latest: input.currentVersion,
    });
    return {
      currentVersion: input.currentVersion,
      latestVersion: 'unknown',
      updateAvailable: false,
      lastCheckAt: at,
      channel: 'none',
      packageName: input.packageName,
      ok: false,
      checked: false,
      notes,
      plan,
      steps: plan.steps,
    };
  }
}

/**
 * Apply update from git source tree (YSK_SOURCE_ROOT or process.cwd).
 * Honest: requires EXECUTE; does not claim success without exit 0.
 */
export async function applySelfUpdateFromGit(input: {
  host: HostExecutor;
  latest: string;
  repo: string;
}): Promise<{
  applied: boolean;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stdout: string; stderr: string }>;
}> {
  const notes: string[] = [];
  const commandResults: Array<{
    argv: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
  }> = [];
  const root =
    process.env.YSK_SOURCE_ROOT?.trim() ||
    process.env.YSK_INSTALL_ROOT?.trim() ||
    process.cwd();

  const gitCheck = await input.host.runCommand(
    ['bash', '-c', `test -d ${JSON.stringify(root + '/.git')} && echo yes || echo no`],
    { timeoutMs: 5_000 },
  );
  commandResults.push({
    argv: ['test', '-d', `${root}/.git`],
    exitCode: gitCheck.exitCode,
    stdout: gitCheck.stdout,
    stderr: gitCheck.stderr,
  });

  if (!gitCheck.stdout.includes('yes')) {
    notes.push(
      tl('notes.auto.t0478', { v0: (root) }),
    );
    // Try download tarball of main into staging (does not replace running tree without root swap)
    const staging = `${root}/.ysk-self-update-staging`;
    const tarUrl = `https://codeload.github.com/${input.repo}/tar.gz/refs/heads/main`;
    const dl = await input.host.runCommand(
      [
        'bash',
        '-c',
        [
          `rm -rf ${JSON.stringify(staging)}`,
          `mkdir -p ${JSON.stringify(staging)}`,
          `curl -fsSL ${JSON.stringify(tarUrl)} -o ${JSON.stringify(staging + '/src.tgz')}`,
          `tar -xzf ${JSON.stringify(staging + '/src.tgz')} -C ${JSON.stringify(staging)} --strip-components=1`,
        ].join(' && '),
      ],
      { timeoutMs: 180_000 },
    );
    commandResults.push({
      argv: ['curl+tar', tarUrl],
      exitCode: dl.exitCode,
      stdout: dl.stdout,
      stderr: dl.stderr,
    });
    if (dl.exitCode !== 0) {
      notes.push(tl('notes.auto.t0479', { v0: ((dl.stderr || dl.stdout).slice(0, 300)) }));
      return { applied: false, notes, commandResults };
    }
    notes.push(
      tl('notes.auto.t0480', { v0: (staging) }),
    );
    notes.push(tl('notes.auto.n1219'));
    return { applied: false, notes, commandResults };
  }

  notes.push(tl('notes.auto.t0481', { v0: (root) }));
  const tag = input.latest.replace(/^v/, '');
  const steps = [
    {
      name: 'fetch',
      argv: [
        'bash',
        '-c',
        `cd ${JSON.stringify(root)} && git fetch --tags --force origin 2>&1`,
      ],
    },
    {
      name: 'checkout',
      argv: [
        'bash',
        '-c',
        `cd ${JSON.stringify(root)} && (git checkout "v${tag}" 2>&1 || git checkout "${tag}" 2>&1 || git pull --ff-only origin main 2>&1 || git pull --ff-only origin master 2>&1)`,
      ],
    },
    {
      name: 'install',
      argv: [
        'bash',
        '-c',
        `cd ${JSON.stringify(root)} && if ${shellBinExists('pnpm')}; then pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1; else npm ci 2>&1 || npm install 2>&1; fi`,
      ],
    },
    {
      name: 'build',
      argv: [
        'bash',
        '-c',
        `cd ${JSON.stringify(root)} && if ${shellBinExists('pnpm')}; then pnpm build 2>&1; else npm run build 2>&1; fi`,
      ],
    },
  ];

  for (const step of steps) {
    const r = await input.host.runCommand(step.argv, { timeoutMs: 600_000 });
    commandResults.push({
      argv: step.argv,
      exitCode: r.exitCode,
      stdout: r.stdout.slice(0, 2000),
      stderr: r.stderr.slice(0, 2000),
    });
    if (r.exitCode !== 0) {
      notes.push(
        tl('notes.auto.t0482', { v0: (step.name), v1: (r.exitCode), v2: ((r.stderr || r.stdout).slice(0, 300)) }),
      );
      return { applied: false, notes, commandResults };
    }
    notes.push(`${step.name} ok`);
  }

  notes.push(
    tl('notes.auto.t0483', { v0: (input.latest) }),
  );
  return { applied: true, notes, commandResults };
}

/**
 * Build and optionally apply self-update via npm install -g or git source tree.
 */
export async function runSelfUpdate(input: {
  currentVersion: string;
  host: HostExecutor;
  packageName?: string;
  apply?: boolean;
  latestOverride?: string;
  githubRepo?: string;
}): Promise<{
  registry?: RegistryVersion;
  plan: ReturnType<typeof planSelfUpdate>;
  applied: boolean;
  /** false when apply was requested but did not succeed, or check failed */
  ok: boolean;
  checked: boolean;
  commandResults: Array<{ argv: string[]; exitCode: number; stdout: string; stderr: string }>;
  notes: string[];
  /** Flattened status fields for panel */
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  channel: string;
  packageName?: string;
}> {
  const check = await checkSelfUpdate({
    currentVersion: input.currentVersion,
    packageName: input.packageName,
    latestOverride: input.latestOverride,
    githubRepo: input.githubRepo,
  });
  const notes = [...check.notes];
  const registry = check.registry;
  const plan = check.plan;
  const commandResults: Array<{
    argv: string[];
    exitCode: number;
    stdout: string;
    stderr: string;
  }> = [];
  let applied = false;

  const pkgName =
    input.packageName ||
    registry?.packageName ||
    process.env.YSK_NPM_PACKAGE ||
    'ysk-server';

  if (!check.checked) {
    return {
      registry,
      plan,
      applied: false,
      ok: false,
      checked: false,
      commandResults,
      notes,
      currentVersion: check.currentVersion,
      latestVersion: check.latestVersion,
      updateAvailable: false,
      channel: check.channel,
      packageName: pkgName,
    };
  }

  if (input.apply && plan.status.updateAvailable) {
    if (!input.host.executeEnabled()) {
      notes.push(tl('ops.blocked.update'));
    } else {
      const latest = plan.status.latestVersion ?? registry?.latest ?? '';
      const preferNpm =
        registry?.channel === 'npm' ||
        Boolean(process.env.YSK_NPM_PACKAGE) ||
        (input.packageName && !input.packageName.includes('/'));

      if (preferNpm && registry?.channel !== 'github') {
        const installName =
          registry?.channel === 'npm' && registry.packageName
            ? registry.packageName
            : pkgName.startsWith('@') || !pkgName.includes('/')
              ? pkgName
              : 'ysk-server';
        const pkg = `${installName}@${latest}`;
        const r = await input.host.runCommand(['npm', 'install', '-g', pkg], {
          timeoutMs: 300_000,
        });
        commandResults.push({
          argv: ['npm', 'install', '-g', pkg],
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
        });
        applied = r.exitCode === 0;
        notes.push(
          applied ? tl('notes.auto.t0484', { v0: (pkg) }) : tl('notes.auto.t0485', { v0: ((r.stderr || r.stdout).slice(0, 400)) }),
        );
      }

      // GitHub / source tree path — real git pull + build when YSK_SOURCE_ROOT or cwd is a git repo
      if (!applied && (registry?.channel === 'github' || registry?.channel === 'env')) {
        const gitResult = await applySelfUpdateFromGit({
          host: input.host,
          latest,
          repo: registry?.packageName?.includes('/')
            ? registry.packageName
            : process.env.YSK_GITHUB_REPO?.trim() || DEFAULT_GITHUB_REPO,
        });
        commandResults.push(...gitResult.commandResults);
        notes.push(...gitResult.notes);
        applied = gitResult.applied;
      }

      // Last resort: try npm even on github channel if YSK_NPM_PACKAGE set
      if (!applied && process.env.YSK_NPM_PACKAGE) {
        const pkg = `${process.env.YSK_NPM_PACKAGE}@${latest}`;
        const r = await input.host.runCommand(['npm', 'install', '-g', pkg], {
          timeoutMs: 300_000,
        });
        commandResults.push({
          argv: ['npm', 'install', '-g', pkg],
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
        });
        applied = r.exitCode === 0;
        notes.push(
          applied
            ? tl('notes.auto.t0486', { v0: (pkg) })
            : tl('notes.auto.t0487', { v0: ((r.stderr || r.stdout).slice(0, 300)) }),
        );
      }

      if (!applied) {
        notes.push(
          tl('notes.auto.n0973'),
        );
      }
    }
  }

  const ok = input.apply
    ? applied || !plan.status.updateAvailable
    : check.ok;

  if (input.apply && plan.status.updateAvailable && !applied) {
    if (!notes.some((n) => /權限|失敗|failed|GitHub|npm 套件|最新/i.test(n))) {
      notes.push(tl('notes.auto.n0929'));
    }
  }

  return {
    registry,
    plan,
    applied,
    ok,
    checked: true,
    commandResults,
    notes,
    currentVersion: check.currentVersion,
    latestVersion: check.latestVersion,
    updateAvailable: plan.status.updateAvailable,
    channel: check.channel,
    packageName: registry?.packageName ?? pkgName,
  };
}

export { compareVersions };
