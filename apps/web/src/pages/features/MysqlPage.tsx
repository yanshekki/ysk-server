import { SqlEnginePage } from './SqlEnginePage';

/** MySQL (Oracle) — separate from MariaDB */
export function MysqlPage() {
  return <SqlEnginePage engine="mysql" />;
}
