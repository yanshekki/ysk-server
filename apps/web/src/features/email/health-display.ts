/** True when no live DNS/PTR/port probe has been stored. Score 10/100 is then a checklist stub. */
export function emailHealthUnprobed(d: {
  dns_applied?: boolean;
  ptr_ok?: boolean;
  port25_open?: boolean | null;
} | null | undefined): boolean {
  if (!d) return true;
  return (
    d.dns_applied !== true &&
    d.ptr_ok !== true &&
    d.port25_open !== true &&
    d.port25_open !== false
  );
}
