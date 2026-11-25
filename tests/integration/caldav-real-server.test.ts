import { randomUUID } from 'node:crypto';

import { createCalendar } from '@/services/caldav/collections';
import { discoverCalendars } from '@/services/caldav/discovery';
import { webdavRequest } from '@/services/caldav/http';
import { renameCalendar, deleteCalendar } from '@/services/caldav/mutations';
import { parseMultistatus } from '@/services/caldav/xml';
import { normalizeServerUrl } from '@/services/nextcloud/server-url';
import { nodeFetch } from './node-fetch';

const {
  NC_TEST_URL,
  NC_TEST_USER,
  NC_TEST_PASSWORD,
  NC_TEST_CREATE,
  NC_TEST_READ_ONLY_SHARE_SLUG,
  NC_TEST_TRASHED_LIST_SLUG,
} = process.env;
const credentials =
  NC_TEST_URL && NC_TEST_USER && NC_TEST_PASSWORD
    ? {
        serverUrl: normalizeServerUrl(NC_TEST_URL),
        loginName: NC_TEST_USER,
        appPassword: NC_TEST_PASSWORD,
      }
    : null;

if (credentials && !credentials.serverUrl.startsWith('https://')) {
  throw new Error('Live CalDAV tests require HTTPS.');
}

const deps = { fetchImpl: nodeFetch };

(credentials ? describe : describe.skip)('live Nextcloud CalDAV', () => {
  jest.setTimeout(90_000);

  it('discovers the principal, home set and calendars', async () => {
    if (!credentials) return;
    const result = await discoverCalendars(credentials, deps);
    const origin = new URL(credentials.serverUrl).origin;
    expect(new URL(result.principalUrl).origin).toBe(origin);
    expect(new URL(result.homeSetUrl).origin).toBe(origin);
    expect(result.principalUrl).toMatch(/\/$/);
    expect(result.homeSetUrl).toMatch(/\/$/);
    expect(result.calendars.some((calendar) => calendar.isOwned && calendar.canRead)).toBe(true);
  });

  function checkDiscoveryFixtures(shareSlug: string, trashSlug: string) {
    it('discovers an active read-only share without including a trashed task list', async () => {
      if (!credentials) return;
      const { homeSetUrl, calendars } = await discoverCalendars(credentials, deps);
      const fixtureUrl = (slug: string) => new URL(`${encodeURIComponent(slug)}/`, homeSetUrl).href;
      const trashUrl = fixtureUrl(trashSlug);
      const { body } = await webdavRequest({
        credentials,
        ...deps,
        method: 'PROPFIND',
        url: homeSetUrl,
        depth: '1',
        body: `<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
          <D:prop><D:resourcetype/><C:supported-calendar-component-set/></D:prop>
        </D:propfind>`,
      });
      // Confirm the fixture still exists in the trash, rather than passing
      // because the server already purged it.
      const trash = parseMultistatus(body).find(
        ({ href }) =>
          new URL(href, homeSetUrl).pathname.replace(/\/?$/, '/') === new URL(trashUrl).pathname,
      );
      expect(trash?.properties.resourcetype).toHaveProperty('deleted-calendar');
      const components = trash?.properties['supported-calendar-component-set'] as
        { comp?: { '@_name': string } | { '@_name': string }[] } | undefined;
      expect([components?.comp].flat()).toContainEqual({ '@_name': 'VTODO' });
      const share = calendars.find(({ url }) => url === fixtureUrl(shareSlug));
      expect(share).toMatchObject({
        isTaskList: true,
        isOwned: false,
        isSharedWithMe: true,
        canRead: true,
        canWrite: false,
      });
      expect(calendars.some(({ url }) => url === trashUrl)).toBe(false);
    });
  }

  if (NC_TEST_READ_ONLY_SHARE_SLUG && NC_TEST_TRASHED_LIST_SLUG) {
    checkDiscoveryFixtures(NC_TEST_READ_ONLY_SHARE_SLUG, NC_TEST_TRASHED_LIST_SLUG);
  }

  // Explicit opt-in: this creates, renames, and deletes a list on the
  // dedicated test account. The delete uses the no-trashbin header, so the
  // list is actually removed (not just moved to the calendar trashbin).
  (NC_TEST_CREATE === '1' ? it : it.skip)(
    'creates, renames, and deletes a VTODO list (full mutation round-trip)',
    async () => {
      if (!credentials) return;
      const { homeSetUrl } = await discoverCalendars(credentials, deps);
      const name = `CalDAV check Ü & ${randomUUID()}`;

      // Create
      const { url } = await createCalendar(credentials, homeSetUrl, name, deps);

      // Verify it appears in discovery
      let { calendars } = await discoverCalendars(credentials, deps);
      expect(calendars.find((calendar) => calendar.url === url)).toMatchObject({
        displayName: name,
        components: ['VTODO'],
        isTaskList: true,
        isOwned: true,
        canRead: true,
        canWrite: true,
      });

      // Rename
      const newName = `Renamed ${randomUUID()}`;
      await renameCalendar(credentials, url, newName, deps);
      ({ calendars } = await discoverCalendars(credentials, deps));
      const renamed = calendars.find((calendar) => calendar.url === url);
      expect(renamed?.displayName).toBe(newName);

      // Delete (no-trashbin header → real permanent delete)
      await deleteCalendar(credentials, url, deps);
      ({ calendars } = await discoverCalendars(credentials, deps));
      expect(calendars.find((calendar) => calendar.url === url)).toBeUndefined();
    },
  );
});
