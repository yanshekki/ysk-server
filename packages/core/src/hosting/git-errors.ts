/**
 * Classify git stderr into a stable code for panel / CLI next-action.
 */

export type GitErrorCode =
  | 'missing-bin'
  | 'auth'
  | 'hostkey'
  | 'dirty'
  | 'diverged'
  | 'missing-ref'
  | 'shallow'
  | 'not-repo'
  | 'unrelated'
  | 'lock'
  | 'disk'
  | 'timeout'
  | 'network'
  | 'lfs'
  | 'submodule'
  | 'unknown';

export function classifyGitError(stderr: string, stdout = ''): GitErrorCode {
  const t = `${stderr}\n${stdout}`;
  if (
    /authentication failed|401 unauthorized|403 forbidden|permission denied \(publickey\)|could not read username|invalid username or password|terminal prompts disabled/i.test(
      t,
    )
  ) {
    return 'auth';
  }
  if (/host key verification failed|remote host identification has changed/i.test(t)) {
    return 'hostkey';
  }
  if (
    /your local changes to the following files would be overwritten|uncommitted changes|please commit your changes or stash/i.test(
      t,
    )
  ) {
    return 'dirty';
  }
  if (
    /not possible to fast-forward|cannot fast-forward|diverging branches|refusing to merge unrelated histories/i.test(
      t,
    )
  ) {
    return /unrelated histories/i.test(t) ? 'unrelated' : 'diverged';
  }
  if (/couldn't find remote ref|remote ref does not exist|ambiguous argument/i.test(t)) {
    return 'missing-ref';
  }
  if (
    /shallow|not a commit|object not found|needed a single revision|unshallow/i.test(t) &&
    /fetch --unshallow|not in.*shallow|shallow file/i.test(t)
  ) {
    return 'shallow';
  }
  if (/not a git repository/i.test(t)) return 'not-repo';
  if (/index\.lock|unable to create .*index\.lock/i.test(t)) return 'lock';
  if (/no space left|disk quota exceeded/i.test(t)) return 'disk';
  if (/timed out|timeout|temporarily unavailable/i.test(t)) return 'timeout';
  if (
    /could not resolve host|connection refused|failed to connect|network is unreachable|early eof|rpc failed/i.test(
      t,
    )
  ) {
    return 'network';
  }
  if (/git-lfs|smudge filter lfs/i.test(t)) return 'lfs';
  if (/submodule/i.test(t) && /failed|error/i.test(t)) return 'submodule';
  return 'unknown';
}

export function gitErrorNoteKey(code: GitErrorCode): string {
  return `notes.git.${code.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}`;
}
