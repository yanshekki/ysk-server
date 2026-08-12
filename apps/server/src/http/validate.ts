/**
 * Lightweight request body validation for HTTP routes.
 * Prefer these helpers over `JSON.parse(...) as { field?: string }` for new code.
 *
 * Secondary-dev checklist:
 * 1. readJsonBody(req)
 * 2. requireString / requireEnum / optionalString
 * 3. throw YskError → sendError (or let outer catch)
 */
import type { IncomingMessage } from 'node:http';
import { ErrorCodes, yskError } from '@yanshekki/shared';
import { readBody } from './util.js';

export type JsonObject = Record<string, unknown>;

/** Parse JSON body; empty body → {}. Invalid JSON → 400. */
export async function readJsonBody(req: IncomingMessage): Promise<JsonObject> {
  const raw = await readBody(req);
  if (!raw || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw yskError(ErrorCodes.VALIDATION, {
        httpStatus: 400,
        messageKey: 'errors.http.invalidJson',
        details: { reason: 'body_must_be_object' },
      });
    }
    return v as JsonObject;
  } catch (e) {
    if (e && typeof e === 'object' && 'httpStatus' in e) throw e;
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.http.invalidJson',
      details: { reason: 'json_parse' },
    });
  }
}

export function requireString(
  data: JsonObject,
  key: string,
  opts?: { min?: number; max?: number; trim?: boolean },
): string {
  const raw = data[key];
  if (typeof raw !== 'string') {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.required',
      details: { field: key, expected: 'string' },
    });
  }
  const s = opts?.trim === false ? raw : raw.trim();
  if (opts?.min !== undefined && s.length < opts.min) {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.tooShort',
      details: { field: key, min: opts.min },
    });
  }
  if (opts?.max !== undefined && s.length > opts.max) {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.tooLong',
      details: { field: key, max: opts.max },
    });
  }
  if (!s && (opts?.min === undefined || opts.min > 0)) {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.required',
      details: { field: key },
    });
  }
  return s;
}

export function optionalString(
  data: JsonObject,
  key: string,
  opts?: { max?: number },
): string | undefined {
  if (data[key] === undefined || data[key] === null) return undefined;
  const s = requireString(data, key, { min: 0, max: opts?.max });
  return s.length ? s : undefined;
}

export function requireEnum<T extends string>(
  data: JsonObject,
  key: string,
  allowed: readonly T[],
): T {
  const s = requireString(data, key);
  if (!(allowed as readonly string[]).includes(s)) {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.invalidEnum',
      details: { field: key, allowed: [...allowed] },
    });
  }
  return s as T;
}

export function optionalBoolean(data: JsonObject, key: string): boolean | undefined {
  if (data[key] === undefined || data[key] === null) return undefined;
  if (typeof data[key] !== 'boolean') {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.invalidType',
      details: { field: key, expected: 'boolean' },
    });
  }
  return data[key] as boolean;
}

export function optionalNumber(
  data: JsonObject,
  key: string,
  opts?: { min?: number; max?: number },
): number | undefined {
  if (data[key] === undefined || data[key] === null) return undefined;
  const n = data[key];
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.invalidType',
      details: { field: key, expected: 'number' },
    });
  }
  if (opts?.min !== undefined && n < opts.min) {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.outOfRange',
      details: { field: key, min: opts.min },
    });
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw yskError(ErrorCodes.VALIDATION, {
      httpStatus: 400,
      messageKey: 'errors.validation.outOfRange',
      details: { field: key, max: opts.max },
    });
  }
  return n;
}
