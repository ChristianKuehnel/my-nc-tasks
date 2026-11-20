/**
 * Server URL validation and normalization for Login Flow v2.
 *
 * Accepts `cloud.example.com`, `https://cloud.example.com`, and
 * sub-path installs (`https://cloud.example.com/nextcloud`).
 * The result is a normalized base URL: `scheme://host[:port][/path]`
 * with no trailing slash and no credentials/query/fragment.
 */

export class InvalidServerUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidServerUrlError';
  }
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InvalidServerUrlError('Server URL must not be empty.');
  }

  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidServerUrlError(`"${trimmed}" is not a valid URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidServerUrlError(
      `Only http:// and https:// servers are supported (got ${url.protocol}//).`,
    );
  }

  // Host syntax is validated by the URL parser; additionally require a
  // non-empty hostname. Single-label hostnames (LAN/NAS names such as
  // `nas:3000`) are allowed on purpose.
  if (url.hostname.length === 0) {
    throw new InvalidServerUrlError(`"${trimmed}" does not look like a server address.`);
  }

  // Keep an optional base path (sub-path installs), strip trailing slashes.
  // Drop credentials, query and fragment: they are never part of the base.
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}
