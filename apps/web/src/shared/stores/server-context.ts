/**
 * Shared defaults for hosting tools (domain / server IP).
 */
const KEY = 'ysk_server_context';

export type ServerContext = {
  domain: string;
  serverIp: string;
  /** Optional public IPv6 for dual-stack DNS/mail templates */
  serverIpv6?: string;
};

const DEFAULT: ServerContext = {
  domain: 'demo.local',
  serverIp: '203.0.113.10',
  serverIpv6: '',
};

function read(): ServerContext {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT };
  }
}

export function getServerContext(): ServerContext {
  return read();
}

export function setServerContext(patch: Partial<ServerContext>) {
  const next = { ...read(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
