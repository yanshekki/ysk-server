/**
 * RPC / HTTP JSON body — empty or non-JSON must not become SyntaxError.
 */
export async function readRpcJson(res: {
  status: number;
  text(): Promise<string>;
}): Promise<unknown> {
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new Error('rpc unauthorized');
  }
  if (!String(text).trim()) {
    throw new Error('rpc unreachable');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('rpc unreachable');
  }
}
