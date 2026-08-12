/**
 * Thin helper: parse ListQuery + apply text (and optional) matchers → sendJson shape.
 */
import { applyListQuery, type ListMatchers } from 'ysk-server-core';
import { parseListQuery, type ParseListQueryOptions } from 'ysk-server-shared';

export function listWithQuery<T>(
  url: URL,
  all: T[],
  matchers: ListMatchers<T>,
  parseOpts?: ParseListQueryOptions,
): { items: T[]; meta: ReturnType<typeof applyListQuery<T>>['meta'] } {
  const query = parseListQuery(url, parseOpts);
  return applyListQuery(all, query, matchers);
}
