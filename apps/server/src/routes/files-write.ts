/**
 * Authenticated file write dispatcher (Wave AA1).
 * content → fs-ops
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  handleFilesContentRoutes,
  type FilesWriteCtx,
} from './files-content.js';
import { handleFilesFsOpsRoutes } from './files-fs-ops.js';

export type { FilesWriteCtx };

export async function handleFilesWriteRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  auth: FilesWriteCtx,
): Promise<boolean> {
  if (await handleFilesContentRoutes(ctx, req, res, url, method, auth)) return true;
  if (await handleFilesFsOpsRoutes(ctx, req, res, url, method, auth)) return true;
  return false;
}
