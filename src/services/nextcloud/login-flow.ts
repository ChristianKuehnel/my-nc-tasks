/**
 * Nextcloud Login Flow v2 client (protocol layer only — no React, no storage).
 *
 * Reference: Nextcloud server core `core/Controller/ClientFlowLoginV2Controller.php`
 *
 *   1. POST {server}/login/v2
 *        -> 200 { "poll": { "token", "endpoint" }, "login": "<absolute url>" }
 *   2. The user completes login (including MFA) in the opened browser at
 *      `login`. MFA is entirely server-side; the app never sees the password.
 *   3. POST {poll.endpoint} with form field `token`
 *        -> 404 (empty) while the flow is still pending
 *        -> 200 { "server", "loginName", "appPassword" } when done
 *
 * The returned `appPassword` is an app-specific password issued by the server
 * for the login name — it is the only secret the app stores.
 */

import type { LoginFlowCredentials, LoginFlowInitResponse } from './types';

export type LoginFlowErrorCode =
  'init_failed' | 'poll_failed' | 'invalid_response' | 'timeout' | 'cancelled';

export class LoginFlowError extends Error {
  readonly code: LoginFlowErrorCode;

  constructor(code: LoginFlowErrorCode, message: string) {
    super(message);
    this.name = 'LoginFlowError';
    this.code = code;
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Defaults. Overridable for tests and for the UI layer. */
export const LOGIN_FLOW_DEFAULTS = {
  /** Per HTTP request timeout (ms). */
  requestTimeoutMs: 15_000,
  /** Wait between poll requests (ms). */
  pollIntervalMs: 2_000,
  /** Overall login-flow deadline (ms). */
  flowTimeoutMs: 5 * 60_000,
} as const;

export interface InitDeps {
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

export interface PollDeps {
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  flowTimeoutMs?: number;
  /** External cancellation. */
  signal?: AbortSignal;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Injectable delay; defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>;
}

export interface PollResult {
  credentials: LoginFlowCredentials;
  /** Number of poll requests that were actually issued. */
  attempts: number;
}

/**
 * Perform a fetch with a hard timeout. The AbortController is cleared on
 * completion, so a fast response never leaves a pending timer behind.
 */
async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  code: 'init_failed' | 'poll_failed',
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new LoginFlowError(code, `Request timed out after ${timeoutMs} ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Step 1 of Login Flow v2: start the flow and obtain the poll token/endpoint
 * and the browser login URL.
 */
export async function initLoginFlow(
  serverUrl: string,
  deps: InitDeps = {},
): Promise<LoginFlowInitResponse> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.requestTimeoutMs ?? LOGIN_FLOW_DEFAULTS.requestTimeoutMs;
  const url = `${serverUrl}/login/v2`;

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, { method: 'POST' }, timeoutMs, 'init_failed');
  } catch (err) {
    if (err instanceof LoginFlowError) throw err;
    throw new LoginFlowError('init_failed', describeNetworkError(err));
  }

  if (!response.ok) {
    throw new LoginFlowError('init_failed', `Server responded with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as unknown;
  return parseInitResponse(body);
}

/**
 * Step 3 (single request) of Login Flow v2: poll once.
 *
 * Returns the credentials when the flow is done, or `null` when the server
 * still reports the flow as pending (HTTP 404).
 */
export async function pollLoginFlowOnce(
  init: Pick<LoginFlowInitResponse, 'poll'>,
  deps: Pick<PollDeps, 'fetchImpl' | 'requestTimeoutMs'> = {},
): Promise<LoginFlowCredentials | null> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.requestTimeoutMs ?? LOGIN_FLOW_DEFAULTS.requestTimeoutMs;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      init.poll.endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(init.poll.token)}`,
      },
      timeoutMs,
      'poll_failed',
    );
  } catch (err) {
    if (err instanceof LoginFlowError) throw err;
    throw new LoginFlowError('poll_failed', describeNetworkError(err));
  }

  // 404 = flow not finished yet. The server returns an empty body in this case.
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new LoginFlowError('poll_failed', `Server responded with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as unknown;
  return parseCredentials(body);
}

/**
 * Poll until the user finishes the browser login, the overall timeout is hit,
 * or the flow is cancelled. Pure and fully injectable: pass `delay`/`now` (or
 * a custom `fetchImpl`) to make it deterministic in tests.
 */
export async function pollLoginFlow(
  init: LoginFlowInitResponse,
  deps: PollDeps = {},
): Promise<PollResult> {
  const pollIntervalMs = deps.pollIntervalMs ?? LOGIN_FLOW_DEFAULTS.pollIntervalMs;
  const flowTimeoutMs = deps.flowTimeoutMs ?? LOGIN_FLOW_DEFAULTS.flowTimeoutMs;
  const now = deps.now ?? Date.now;
  const delay =
    deps.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const startedAt = now();
  let attempts = 0;

  for (;;) {
    if (deps.signal?.aborted) {
      throw new LoginFlowError('cancelled', 'Login flow was cancelled.');
    }
    if (now() - startedAt >= flowTimeoutMs) {
      throw new LoginFlowError('timeout', 'Login flow timed out before the login finished.');
    }

    attempts += 1;
    const credentials = await pollLoginFlowOnce(init, deps);
    if (credentials) {
      return { credentials, attempts };
    }

    await delay(pollIntervalMs);
  }
}

/** Strict validation of the `POST /login/v2` response shape. */
export function parseInitResponse(body: unknown): LoginFlowInitResponse {
  if (typeof body !== 'object' || body === null) {
    throw new LoginFlowError('invalid_response', 'Login flow init returned a non-object body.');
  }
  const { poll, login } = body as Record<string, unknown>;

  if (
    typeof poll !== 'object' ||
    poll === null ||
    typeof (poll as Record<string, unknown>).token !== 'string' ||
    typeof (poll as Record<string, unknown>).endpoint !== 'string'
  ) {
    throw new LoginFlowError(
      'invalid_response',
      'Login flow init is missing a valid poll token/endpoint.',
    );
  }
  if (typeof login !== 'string') {
    throw new LoginFlowError(
      'invalid_response',
      'Login flow init is missing the browser login URL.',
    );
  }

  return {
    poll: {
      token: (poll as Record<string, string>).token,
      endpoint: (poll as Record<string, string>).endpoint,
    },
    login,
  };
}

/**
 * Strict validation of the poll response credentials.
 *
 * Current Nextcloud servers (LoginFlowV2Credentials::jsonSerialize) return
 * `{ server, loginName, appPassword }`.
 */
export function parseCredentials(body: unknown): LoginFlowCredentials {
  if (typeof body !== 'object' || body === null) {
    throw new LoginFlowError('invalid_response', 'Poll returned a non-object body.');
  }
  const { server, loginName, appPassword } = body as Record<string, unknown>;
  if (
    typeof server !== 'string' ||
    typeof loginName !== 'string' ||
    typeof appPassword !== 'string'
  ) {
    throw new LoginFlowError(
      'invalid_response',
      'Poll response is missing server/loginName/appPassword.',
    );
  }
  return { server, loginName, appPassword };
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    return `Network error: ${err.message}`;
  }
  return 'Unknown network error.';
}
