/**
 * Minimal `fetch` implementation for the real-server integration tests.
 *
 * jest-expo replaces the global `fetch` with a whatwg-fetch polyfill that
 * relies on XMLHttpRequest, which does not exist under Node — so calls
 * resolve without a usable `status`. The integration suite therefore
 * injects this node:http/https-based adapter through the service modules'
 * `fetchImpl` dependency. Only the surface the CalDAV client uses is
 * implemented: `status`, `ok`, `text()` and `headers` (get + forEach).
 * Redirects are intentionally NOT followed (the client does that itself).
 */

import http from 'node:http';
import https from 'node:https';

import type { FetchLike } from '@/services/caldav/http';

export const nodeFetch: FetchLike = (url, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;

    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port === '' ? undefined : Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string> | undefined,
        signal: init.signal ?? undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined)
                headers.set(key, Array.isArray(value) ? value.join(', ') : value);
            }
            const status = res.statusCode ?? 599;
            const body = [204, 205, 304].includes(status)
              ? null
              : Buffer.concat(chunks).toString('utf8');
            resolve(new Response(body, { status, headers }));
          } catch (error) {
            reject(error);
          }
        });
        res.on('error', reject);
      },
    );

    request.on('error', reject);
    if (typeof init.body === 'string' && init.body.length > 0) {
      request.write(init.body);
    }
    request.end();
  });
