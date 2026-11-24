import {
  firstText,
  parseMultistatus,
  parsePropPatchPropStats,
  textList,
} from '@/services/caldav/xml';

describe('parseMultistatus', () => {
  it('parses a multistatus with the D: prefix bound to the DAV namespace', () => {
    const xml = `<?xml version="1.0"?>
    <D:multistatus xmlns:D="DAV:">
      <D:response>
        <D:href>/remote.php/dav/calendars/alice/personal/</D:href>
        <D:propstat>
          <D:prop>
            <D:displayname>Personal</D:displayname>
            <D:owner><D:href>/remote.php/dav/principals/users/alice/</D:href></D:owner>
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>
    </D:multistatus>`;

    const responses = parseMultistatus(xml);
    expect(responses).toHaveLength(1);
    expect(responses[0].href).toBe('/remote.php/dav/calendars/alice/personal/');
    expect(responses[0].properties.displayname).toBe('Personal');
    expect(responses[0].properties.owner).toEqual({
      href: '/remote.php/dav/principals/users/alice/',
    });
  });

  it('is independent of the chosen namespace prefix (lowercase, calendarserver ns)', () => {
    const xml = `<?xml version="1.0"?>
    <d:multistatus xmlns:d="DAV:" xmlns:c="http://calendarserver.org/ns/">
      <d:response>
        <d:href>/cal/</d:href>
        <d:propstat>
          <d:prop>
            <c:supported-calendar-component-set>
              <c:comp name="VTODO"/>
            </c:supported-calendar-component-set>
          </d:prop>
          <d:status>HTTP/1.1 200 OK</d:status>
        </d:propstat>
      </d:response>
    </d:multistatus>`;

    const responses = parseMultistatus(xml);
    expect(responses[0].properties['supported-calendar-component-set']).toEqual({
      comp: { '@_name': 'VTODO' },
    });
  });

  it('uses the default namespace without a prefix', () => {
    const xml = `<?xml version="1.0"?>
    <multistatus xmlns="DAV:">
      <response>
        <href>/x/</href>
        <propstat>
          <prop><displayname>Default NS</displayname></prop>
          <status>HTTP/1.1 200 OK</status>
        </propstat>
      </response>
    </multistatus>`;

    const responses = parseMultistatus(xml);
    expect(responses[0].properties.displayname).toBe('Default NS');
  });

  it('merges properties across propstat blocks and skips 404 propstats', () => {
    const xml = `<?xml version="1.0"?>
    <D:multistatus xmlns:D="DAV:">
      <D:response>
        <D:href>/m/</D:href>
        <D:propstat>
          <D:prop><D:displayname>Keep</D:displayname></D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
        <D:propstat>
          <D:prop><D:resource-name></D:resource-name></D:prop>
          <D:status>HTTP/1.1 404 Not Found</D:status>
        </D:propstat>
      </D:response>
    </D:multistatus>`;

    const [response] = parseMultistatus(xml);
    expect(response.properties.displayname).toBe('Keep');
    expect('resource-name' in response.properties).toBe(false);
  });

  it('rejects invalid XML and non-multistatus documents', () => {
    expect(() => parseMultistatus('this is not xml')).toThrow();
    expect(() => parseMultistatus('<D:multistatus xmlns:D="DAV:">')).toThrow(/multistatus/);
  });

  it('rejects response entries without an href', () => {
    const xml = `<?xml version="1.0"?>
    <D:multistatus xmlns:D="DAV:">
      <D:response>
        <D:propstat>
          <D:prop><D:displayname>No href</D:displayname></D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>
    </D:multistatus>`;
    expect(() => parseMultistatus(xml)).toThrow(/href/);
  });
});

describe('firstText', () => {
  it('returns trimmed text, null for absent/empty values', () => {
    expect(firstText('  value ')).toBe('value');
    expect(firstText('')).toBeNull();
    expect(firstText(null)).toBeNull();
    expect(firstText(undefined)).toBeNull();
  });

  it('unwraps DAV:cur/@uri attribute wrappers (SabreDAV format)', () => {
    expect(firstText({ href: '/some/href/' })).toBe('/some/href/');
    expect(firstText({ cur: { '@_uri': 'http://cloud/x/users/alice/' } })).toBe(
      'http://cloud/x/users/alice/',
    );
    expect(firstText({ cur: 'http://cloud/x/users/alice/' })).toBe('http://cloud/x/users/alice/');
  });
});

describe('textList', () => {
  it('collects repeated values and tolerates a single value', () => {
    expect(textList(['a', 'b'])).toEqual(['a', 'b']);
    expect(textList({ href: 'solo' })).toEqual(['solo']);
    expect(textList(undefined)).toEqual([]);
  });
});

describe('parsePropPatchPropStats', () => {
  it('extracts per-property statuses from a 207 PROPPATCH response', () => {
    const xml = `<?xml version="1.0"?>
    <D:multistatus xmlns:D="DAV:">
      <D:response>
        <D:href>/cal/</D:href>
        <D:propstat>
          <D:prop><D:displayname/></D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>
    </D:multistatus>`;
    const entries = parsePropPatchPropStats(xml);
    expect(entries).toEqual([{ property: 'displayname', status: 200 }]);
  });

  it('reports a 403 propstat for a refused property', () => {
    const xml = `<?xml version="1.0"?>
    <D:multistatus xmlns:D="DAV:">
      <D:response>
        <D:href>/cal/</D:href>
        <D:propstat>
          <D:prop><D:displayname/></D:prop>
          <D:status>HTTP/1.1 403 Forbidden</D:status>
        </D:propstat>
      </D:response>
    </D:multistatus>`;
    const entries = parsePropPatchPropStats(xml);
    expect(entries).toEqual([{ property: 'displayname', status: 403 }]);
  });

  it('returns an empty array for invalid XML', () => {
    expect(parsePropPatchPropStats('not xml')).toEqual([]);
  });

  it('returns an empty array for a non-multistatus document', () => {
    expect(parsePropPatchPropStats('<D:ok xmlns:D="DAV:">')).toEqual([]);
  });
});
