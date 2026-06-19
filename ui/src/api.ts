/**
 * Typed fetch client for the BackScroll HTTP API. [TASK-010]
 *
 * Same-origin requests carry the auth token (read once from the URL) as an
 * `Authorization: Bearer <token>` header. A 401 surfaces as UnauthorizedError
 * so callers can distinguish auth failures from other request errors.
 */

import type {
  ApiCommandDetail,
  ApiSearchResponse,
  ApiStats,
  RerunResponse,
  SearchQuery,
} from './api-types';

/** Thrown when the server rejects a request with HTTP 401. */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** The auth token, read once from the URL's `token` query param. */
const TOKEN: string | null = new URLSearchParams(location.search).get('token');

/** Shape of an error response body, when the server provides one. */
interface ErrorBody {
  error?: string;
}

/**
 * Perform a same-origin JSON request, attaching the auth token as a bearer
 * header. Throws UnauthorizedError on 401 and Error (with the body's `error`
 * field when present) on any other non-2xx response.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (TOKEN !== null) {
    headers.set('Authorization', `Bearer ${TOKEN}`);
  }

  const response = await fetch(path, { ...init, headers });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as ErrorBody;
      if (typeof body.error === 'string' && body.error.length > 0) {
        message = body.error;
      }
    } catch {
      // Body was empty or not JSON — fall back to the status message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

/** Build a query string from a SearchQuery, omitting undefined fields. */
function buildSearchParams(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.q !== undefined) params.set('q', query.q);
  if (query.cwd !== undefined) params.set('cwd', query.cwd);
  if (query.success === true) params.set('success', 'true');
  if (query.since !== undefined) params.set('since', query.since);
  if (query.until !== undefined) params.set('until', query.until);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  return params.toString();
}

/** Search recorded commands. */
export function search(query: SearchQuery): Promise<ApiSearchResponse> {
  const qs = buildSearchParams(query);
  const path = qs.length > 0 ? `/api/search?${qs}` : '/api/search';
  return request<ApiSearchResponse>(path);
}

/** Fetch full detail (including captured output) for a single command. */
export function getCommand(id: number): Promise<ApiCommandDetail> {
  return request<ApiCommandDetail>(`/api/commands/${id}`);
}

/** Fetch aggregate statistics about the recorded command corpus. */
export function getStats(): Promise<ApiStats> {
  return request<ApiStats>('/api/stats');
}

/** Re-run a previously recorded command by id. */
export function rerun(id: number): Promise<RerunResponse> {
  return request<RerunResponse>('/api/rerun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}
