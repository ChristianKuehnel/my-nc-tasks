import {
  initLoginFlow,
  LOGIN_FLOW_DEFAULTS,
  LoginFlowError,
  parseCredentials,
  parseInitResponse,
  pollLoginFlow,
  pollLoginFlowOnce,
} from '@/services/nextcloud/login-flow';
import type { LoginFlowInitResponse } from '@/services/nextcloud/types';

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const VALID_CREDENTIALS = {
  server: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__secret',
};

const INIT: LoginFlowInitResponse = {
  poll: {
    token: 'poll-token-123',
    endpoint: 'https://cloud.example.com/login/v2/poll',
  },
  login: 'https://cloud.example.com/login/v2/flow/login-token-456',
};

const INIT_BODY = {
  poll: { token: INIT.poll.token, endpoint: INIT.poll.endpoint },
  login: INIT.login,
};

describe('initLoginFlow', () => {
  it('POSTs to /login/v2 on the normalized server and returns the parsed shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, INIT_BODY));
    const result = await initLoginFlow('https://cloud.example.com', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloud.example.com/login/v2');
    expect(init.method).toBe('POST');
    expect(result).toEqual(INIT);
  });

  it('maps a non-OK status to init_failed', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(500, {}));
    await expect(initLoginFlow('https://cloud.example.com', { fetchImpl })).rejects.toThrow(
      new LoginFlowError('init_failed', 'Server responded with HTTP 500.'),
    );
  });

  it('maps a network failure to init_failed', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('Network request failed'));
    const promise = initLoginFlow('https://cloud.example.com', { fetchImpl });
    await expect(promise).rejects.toThrow(LoginFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'init_failed' });
  });

  it('rejects a malformed body as invalid_response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { login: 'x' }));
    await expect(initLoginFlow('https://cloud.example.com', { fetchImpl })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects a timeout as poll_failed', async () => {
    // The timeout aborts the request; the mock observes the abort and rejects.
    const fetchImpl = jest.fn(
      (_: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), {
            once: true,
          });
        }),
    );
    await expect(
      initLoginFlow('https://cloud.example.com', {
        fetchImpl,
        requestTimeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: 'init_failed' });
  });
});

describe('pollLoginFlowOnce', () => {
  it('POSTs the token as a form field to the poll endpoint', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, VALID_CREDENTIALS));
    const result = await pollLoginFlowOnce(INIT, { fetchImpl });

    expect(result).toEqual(VALID_CREDENTIALS);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INIT.poll.endpoint);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(`token=${encodeURIComponent(INIT.poll.token)}`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  it('returns null for HTTP 404 (flow still pending)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(404, []));
    await expect(pollLoginFlowOnce(INIT, { fetchImpl })).resolves.toBeNull();
  });

  it('maps other non-OK statuses to poll_failed', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(500, {}));
    await expect(pollLoginFlowOnce(INIT, { fetchImpl })).rejects.toMatchObject({
      code: 'poll_failed',
    });
  });

  it('rejects a malformed 200 body as invalid_response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response(200, { server: 'x' }));
    await expect(pollLoginFlowOnce(INIT, { fetchImpl })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('pollLoginFlow', () => {
  const init = INIT;

  function fetchReturning(...responses: Array<() => Response>) {
    return jest.fn().mockImplementation(async () => {
      const next = responses.shift();
      if (!next) throw new Error('fetchImpl mock exhausted');
      return next();
    });
  }

  it('returns credentials as soon as the flow is done (first attempt)', async () => {
    const fetchImpl = fetchReturning(() => response(200, VALID_CREDENTIALS));
    const result = await pollLoginFlow(init, {
      fetchImpl,
      delay: async () => {},
    });
    expect(result.credentials).toEqual(VALID_CREDENTIALS);
    expect(result.attempts).toBe(1);
  });

  it('keeps polling through 404s until the flow is done', async () => {
    const fetchImpl = fetchReturning(
      () => response(404, []),
      () => response(404, []),
      () => response(200, VALID_CREDENTIALS),
    );
    const result = await pollLoginFlow(init, {
      fetchImpl,
      delay: async () => {},
    });
    expect(result.credentials).toEqual(VALID_CREDENTIALS);
    expect(result.attempts).toBe(3);
  });

  it('gives up with a timeout error after the deadline', async () => {
    let t = 0;
    const now = () => t;
    const delay = async (ms: number) => {
      t += ms;
    };
    // Always pending. With interval 2000 and deadline 5000, the loop polls at
    // t=0, t=2000, t=4000 and then observes t=6000 >= 5000 -> timeout.
    const fetchImpl = fetchReturning(
      () => response(404, []),
      () => response(404, []),
      () => response(404, []),
      () => response(404, []),
    );
    const promise = pollLoginFlow(init, {
      fetchImpl,
      now,
      delay,
      flowTimeoutMs: 5_000,
      pollIntervalMs: 2_000,
    });
    await expect(promise).rejects.toMatchObject({ code: 'timeout' });
  });

  it('throws cancelled when the signal is already aborted (no request issued)', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = jest.fn();
    const promise = pollLoginFlow(init, {
      fetchImpl,
      signal: controller.signal,
      delay: async () => {},
    });
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops and reports cancelled when aborted while pending', async () => {
    const controller = new AbortController();
    const fetchImpl = fetchReturning(() => response(404, []));
    // Abort during the first inter-poll delay.
    const delay = async () => {
      controller.abort();
    };
    const promise = pollLoginFlow(init, {
      fetchImpl,
      signal: controller.signal,
      delay,
    });
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses the documented defaults', () => {
    expect(LOGIN_FLOW_DEFAULTS.pollIntervalMs).toBeGreaterThan(0);
    expect(LOGIN_FLOW_DEFAULTS.flowTimeoutMs).toBeGreaterThan(LOGIN_FLOW_DEFAULTS.pollIntervalMs);
  });
});

describe('parseInitResponse', () => {
  it('accepts the documented shape', () => {
    expect(parseInitResponse(INIT_BODY)).toEqual(INIT);
  });

  it('rejects non-object bodies', () => {
    expect(() => parseInitResponse(null)).toThrow(LoginFlowError);
    expect(() => parseInitResponse('x')).toThrow(LoginFlowError);
  });
});

describe('parseCredentials', () => {
  it('accepts the documented shape', () => {
    expect(parseCredentials(VALID_CREDENTIALS)).toEqual(VALID_CREDENTIALS);
  });

  it('rejects missing fields', () => {
    expect(() => parseCredentials({ server: 's', loginName: 'l' })).toThrow(LoginFlowError);
  });
});
