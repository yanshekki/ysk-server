/** Accept a single OpenSSH public-key line. */
export function isValidSshPublicKey(raw: string): boolean {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length !== 1) return false;
  return /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/]+=*(?:\s+\S+)?$/.test(
    lines[0],
  );
}
