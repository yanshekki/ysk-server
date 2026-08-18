/** Pick a bind/journal headline so the lifecycle card is not just “failed”. */
const BIND_HEADLINE =
  /Unable to bind|cannot bind|無法綁定|无法绑定|0\.0\.0\.0:53|already in use|埠被佔用|端口被占用|pdnsBindConflict/i;

export function pickDnsStartFailureNotes(
  healthNotes: string[] | undefined,
  bindHint: string,
  startNotListening: string,
): { notes: string[]; blockMessage: string } {
  const src = (healthNotes ?? []).map((n) => n.trim()).filter(Boolean);
  const bind = src.find((n) => BIND_HEADLINE.test(n));
  const journal = src.find(
    (n) => n !== bind && /Unable to bind|Address already in use|Fatal error/i.test(n),
  );
  const rest = src.filter((n) => n !== bind && n !== journal);
  const notes = [...new Set([bind, journal, bindHint, ...rest].filter(Boolean) as string[])];
  if (!notes.length) notes.push(startNotListening);
  return {
    notes,
    blockMessage: bind || journal || bindHint || startNotListening || notes[0]!,
  };
}
