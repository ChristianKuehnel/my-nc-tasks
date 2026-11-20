import { InvalidServerUrlError, normalizeServerUrl } from '@/services/nextcloud/server-url';

describe('normalizeServerUrl', () => {
  it('adds https:// to a bare host', () => {
    expect(normalizeServerUrl('cloud.example.com')).toBe('https://cloud.example.com');
  });

  it('keeps an explicit http scheme (local dev servers)', () => {
    expect(normalizeServerUrl('http://nas:3000')).toBe('http://nas:3000');
  });

  it('keeps an explicit https scheme', () => {
    expect(normalizeServerUrl('https://cloud.example.com')).toBe('https://cloud.example.com');
  });

  it('allows localhost without a dot', () => {
    expect(normalizeServerUrl('http://localhost:8443')).toBe('http://localhost:8443');
  });

  it('allows IPv4 addresses', () => {
    expect(normalizeServerUrl('https://192.168.1.10')).toBe('https://192.168.1.10');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeServerUrl('  cloud.example.com  ')).toBe('https://cloud.example.com');
  });

  it('strips a trailing slash', () => {
    expect(normalizeServerUrl('https://cloud.example.com/')).toBe('https://cloud.example.com');
  });

  it('keeps a base path for sub-path installs', () => {
    expect(normalizeServerUrl('https://cloud.example.com/nextcloud/')).toBe(
      'https://cloud.example.com/nextcloud',
    );
  });

  it('drops query and fragment', () => {
    expect(normalizeServerUrl('https://cloud.example.com/?a=1#x')).toBe(
      'https://cloud.example.com',
    );
  });

  it('rejects an empty input', () => {
    expect(() => normalizeServerUrl('')).toThrow(InvalidServerUrlError);
    expect(() => normalizeServerUrl('   ')).toThrow(InvalidServerUrlError);
  });

  it('rejects unsupported schemes', () => {
    expect(() => normalizeServerUrl('ftp://cloud.example.com')).toThrow(InvalidServerUrlError);
  });

  it('rejects input that does not look like a URL or server address', () => {
    expect(() => normalizeServerUrl('not a url')).toThrow(InvalidServerUrlError);
  });
});
