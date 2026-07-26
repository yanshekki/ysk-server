import { SqlEnginePage } from './SqlEnginePage';

/** MariaDB — separate from MySQL */
export function MariadbPage() {
  return <SqlEnginePage engine="mariadb" />;
}
