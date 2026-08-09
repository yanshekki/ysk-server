/**
 * Shared helpers for network routes (Wave Y2).
 */
import type { IncomingMessage } from 'node:http';
import { readBody } from '../http/util.js';

export async function readNetworkJson(
  req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
