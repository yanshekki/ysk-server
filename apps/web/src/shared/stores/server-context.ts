/**
 * Shared defaults for hosting tools (domain / server IP).
 */
/** v2: stop shipping documentation TEST-NET as default serverIp */
const KEY = 'ysk_server_context_v2';

export type ServerContext = {
  domain: string;
  serverIp: string;
  /** Optional public IPv6 for dual-stack DNS/mail templates */
  serverIpv6?: string;
};

const DEFAULT: ServerContext = {
  domain: '',
  /** 空字串：勿預填文件用假 IP，避免用戶當成真實公網位址 */
  serverIp: '',
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
