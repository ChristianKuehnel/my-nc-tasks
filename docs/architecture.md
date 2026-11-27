# Architecture

This document records the technical decisions for `my-nc-tasks`, including the
pinned versions and the reasoning behind them. Keep it current whenever
versions or layering decisions change.

## Target platform

- **iOS on a physical iPhone** as the primary target (Expo Go for development,
  EAS builds for distribution).
- Development happens on **Linux**; no local macOS/Xcode is required.
- Android is not an MVP target but is not architecturally precluded
  (Expo/React Native is cross-platform by default).

## Technology stack (pinned)

| Component    | Version                | Pin location                                    | Notes                                                                                                                           |
| ------------ | ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Expo SDK     | ~58.0.26               | `package.json`                                  | RN 0.88, React 19.3                                                                                                             |
| React Native | 0.88.1                 | `package.json`                                  |                                                                                                                                 |
| React        | 19.3.0                 | `package.json`                                  |                                                                                                                                 |
| Node.js      | 22.23.5                | `.node-version`, `.mise.toml`                   | Latest 22.x (LTS); Expo requires >=22.13 on the 22 line; some tooling (lint-staged 17) requires >=22.22.1                       |
| pnpm         | 12.21.0                | `package.json` (`packageManager`), `.mise.toml` | via Corepack or mise                                                                                                            |
| TypeScript   | ~6.0.3                 | `package.json`                                  | strict mode                                                                                                                     |
| Router       | expo-router ~58.0.32   | `package.json`                                  | file-based routing under `src/app`                                                                                              |
| XML parser   | fast-xml-parser 5.12.1 | `package.json`, `pnpm-lock.yaml`                | Parses CalDAV XML. The v5 upgrade passed the iOS bundle check and a physical iPhone user-search smoke test in Expo Go (PR #49). |

### Why Expo SDK 58

- Expo SDK 58 is the current stable SDK (released 2026-09-29, React Native
  0.88) and requires Node.js >= 22.13 (22.x), >= 24.3 (24.x) or >= 26.
- The **App Store build of Expo Go (58.0.5, released 2026-10-22) supports
  only SDK 58**; earlier SDKs (e.g. 57) are no longer opened by the store
  Expo Go. Using SDK 58 is therefore the only choice that keeps the required
  "Expo Go on a physical iPhone" workflow working.
- SDK 58 minimum iOS version is 16.4+; the app targets the device installed
  by the user, verified during Phase 0.5.
- Compatibility was checked against the official Expo SDK reference and
  changelog before pinning (see `docs/development.md` for the upgrade path).

### Why Node 22.23.5

- Latest 22.x (LTS) as of the pin; satisfies the Expo SDK 58 requirement
  (>= 22.13 on the 22 line).
- Chosen >= 22.22.1 so current tooling (e.g. lint-staged 17, which declares
  `engines.node >= 22.22.1`) works without warnings.
- CI installs exactly this version via `actions/setup-node` reading
  `.node-version`; local machines using a different 22.x patch get a
  non-fatal warning from `scripts/doctor.sh`.

### Why pnpm 12.21.0 (Corepack)

- The `packageManager` field in `package.json` pins the exact pnpm version;
  Corepack (shipped with Node) or mise activates it without any prerequisite
  global npm packages.
- The committed `pnpm-lock.yaml` plus `--frozen-lockfile` in CI guarantees
  reproducible installs.

## Layering (target architecture)

The codebase is organized so that protocol, domain, persistence,
synchronization, and UI stay separate. This prevents the app from becoming an
untestable tangle and keeps the Expo Go path working for compatible features.

```text
UI (React Native / Expo Router)
  └── features/        auth, lists, tasks, sharing, sync, reminders
        └── domain     models + use cases (pure TypeScript, framework-free)
              ├── services/caldav      WebDAV/CalDAV protocol client
              ├── services/nextcloud   Login Flow v2, principal discovery
              ├── services/storage     SQLite persistence (expo-sqlite)
              └── sync                 synchronization engine + mutation queue
```

Rules:

- **Protocol layer** (`services/caldav`, `services/nextcloud`) speaks WebDAV
  XML and Nextcloud endpoints only. It does not know about React or SQLite.
- **Domain layer** contains task/list models and business rules (round-trip
  safety, permission handling) as pure TypeScript with unit tests.
- **Persistence** is isolated behind a storage service; SQLite is an
  implementation detail of the offline-first strategy.
- **Sync engine** is independent of the UI: full/incremental sync, ETags,
  sync tokens, retry/backoff, concurrency protection.
- **UI** renders state and emits intents; it never performs protocol calls
  directly.
- Native-only APIs (background tasks, notifications) are isolated behind
  abstractions so features can degrade gracefully when unavailable
  (e.g. under Expo Go limitations).

## Nextcloud Login Flow v2 (authentication)

Login Flow v2 is the sole authentication mechanism (Phase 1.1, issue #14).
Reference implementation: Nextcloud server core,
`core/Controller/ClientFlowLoginV2Controller.php`.

Protocol (as implemented by Nextcloud 28+):

1. `POST {server}/login/v2` → `200 { "poll": { "token", "endpoint" }, "login": "<absolute login URL>" }`
2. The user completes the login in the opened in-app browser (SFSafariViewController
   via `expo-web-browser` `openAuthSessionAsync`). **MFA / 2FA is handled
   entirely by the server-rendered login page** — the app never sees or
   transmits the user password.
3. The app polls `POST {poll.endpoint}` with the form field `token`:
   `404` (empty body) while the flow is pending,
   `200 { "server", "loginName", "appPassword" }` when done.

Implementation notes:

- The protocol layer is `src/services/nextcloud` (pure TypeScript,
  injectable `fetch`/clock/delay — deterministic unit tests, no timers).
- The state machine lives in `src/features/auth/use-auth.ts`:
  `restoring → unauthenticated → authenticating → authenticated`.
- Polling runs with a 2 s interval, a 15 s per-request timeout, and a 5 min
  overall deadline; explicit cancellation aborts the loop without reporting
  an error. Dismissing the browser early does not cancel the flow — the poll
  endpoint is the source of truth.
- The app does **not** implement MFA itself and does not use `@nextcloud/auth`
  (that package only handles CSRF/guest tokens for web embeds).

Security notes:

- The only secret stored is the `appPassword` (an app-specific password
  issued by the server during Login Flow v2), together with `serverUrl` and
  `loginName`, in `expo-secure-store` (device keychain). Keys are namespaced
  `my.nctasks.v1.*`; nothing outside that key set is ever read or written.
- Credentials are never written to the filesystem, SQLite, or logs.
- Logout deletes exactly the owned key set; unrelated SecureStore/Keychain
  entries of other apps are untouched.

## CalDAV discovery and mutations

Discovery (Phase 1.2, issue #15) and mutations (Phase 1.4, issue #17) live
in `src/services/caldav` — pure TypeScript, no React or SQLite.

Flow (per authenticated session, RFC 6764 + RFC 4791):

1. **Locate the principal** — `PROPFIND {server}/.well-known/carddav/`
   with bounded redirect following. If the `.well-known` resource is
   unavailable, fall back to `PROPFIND {server}/remote.php/dav/` (the DAV
   collection root), which reports `DAV:current-user-principal`
   session-based. The reported `current-user-principal` is a relative DAV
   href, an absolute URL, or a Nextcloud `principal://` URI (mapped onto
   the DAV root). Before sending credentials the client checks that the
   destination is on the configured origin. Same-host redirects from
   HTTPS to HTTP are rewritten to HTTPS before that check.
2. **Calendar home set** — from `calendar-home-set` in the probing
   response, or a follow-up `PROPFIND` on the principal. Some deployments
   report no `calendar-home-set` at all; for those the Nextcloud home set
   (`calendars/{uid}/`) is derived from the principal
   (`principals/users/{uid}/`) and verified via its `DAV:owner` before use.
3. **List calendars** — `PROPFIND` on the home set with `Depth: 1`;
   each calendar yields display name, supported components
   (`VTODO` => task list), owner, `calendar-user-address-set`, and the
   current user's `DAV:current-user-privilege-set` (read / read-write).
   Discovery checks `DAV:resourcetype` and excludes entries explicitly
   marked `deleted-calendar` by Nextcloud, even if they still advertise
   `VTODO`. Active read-only shared lists remain visible.
   For the separate Trash view, discovery retains deleted owned VTODO
   calendars only when the server advertises `nc-calendar-trashbin` and
   reports a typed trash collection with positive retention. The client
   rechecks these conditions before a trash or restore request, then
   verifies the resulting state with another discovery. Trashing uses plain
   `DELETE`; restoring uses `MOVE` to `trashbin/restore/file`. Nextcloud
   controls retention, and its DAV API does not provide an atomic check
   that retention is still enabled when deletion executes.

Implementation notes:

- CalDAV properties are sent in the RFC 4791 namespace
  (`urn:ietf:params:xml:ns:caldav`). Newer SabreDAV/Nextcloud servers do
  not map the legacy Apple `http://calendarserver.org/ns/` namespace (they
  answer `404` for PROPFIND properties and `400` for MKCALENDAR), so the
  RFC namespace is required.
- `http.ts` — DAV request plumbing: RFC 7617 basic auth from the Login
  Flow v2 app password, per-request timeout, and explicit bounded
  redirect following (a 3xx in non-follow mode is a `server_error`,
  since a redirected PROPFIND would change semantics).
- `xml.ts` — namespace-tolerant multistatus parsing. Prefixes are
  stripped (`removeNSPrefix`), so `D:`/`d:`/default-namespace documents
  all parse identically. SabreDAV quirks are handled: `DAV:cur/@uri`
  attribute wrappers and `privilege-uri` child elements.
- Privileges are parsed from RFC 3744 child elements (`<write/>`,
  `<read-free-busy/>`) as sent by Nextcloud. The client also accepts the
  previously supported `privilege-uri` representation.
- `discovery.ts` — the three-step flow; results are absolute URLs with
  canonical trailing slashes.
- `mutations.ts` — `renameCalendar` (RFC 3744 `PROPPATCH` on
  `DAV:displayname`), `deleteCalendar` (DAV `DELETE` with the Nextcloud
  `X-NC-CalDAV-No-Trashbin: 1` header for a permanent delete on NC 30+;
  unknown servers ignore the header and `DELETE` was already permanent),
  and `unsubscribeCalendar` (plain DAV `DELETE`; Nextcloud routes the
  delete of a shared calendar to `unshare()`, leaving the owner's data
  untouched). A 207 `PROPPATCH` response is inspected per-property: the
  overall HTTP 207 is success at the protocol level, but a `403`/`404`
  propstat for `displayname` means the rename was refused.
  `xml.ts` — `parsePropPatchPropStats` extracts the per-property statuses.
- Error surface: `CalDAVError` with stable codes — `network`, `timeout`,
  `bad_request`, `unauthorized`, `forbidden`, `not_found`, `server_error`
  — so the UI layer (later phases) can map them to user-facing messages.
- Unit tests use XML fixtures without a live server. A gated
  integration suite exercises the same service modules over HTTPS; see
  [the development guide](development.md#live-caldav-checks).

## List browsing, create, and mutations (task lists)

The lists feature (Phases 1.3 + 1.4, issues #16 + #17) is the first UI
feature built on top of the CalDAV client. It reads the calendars already
discovered in Phase 1.2, splits them into **owned** and **shared** lists,
and lets the user **create**, **rename**, **delete** (owned only), and
**unsubscribe** (shared only) task lists. Every mutation is guarded by a
confirmation dialog; the UI enforces permission awareness (owned lists
offer rename + delete, shared lists offer only unsubscribe) so a shared
owner’s data is never touched from this screen.

- `src/features/lists/use-lists.ts` — `useLists(session)`. A small
  state machine (`loading` / `ready` / `error`) that wraps
  `discoverCalendars` for the initial load and `refresh`, and
  `createCalendar` for creation, and the Phase 1.4 mutations
  (`renameCalendar`, `deleteCalendar`, `unsubscribeCalendar`). After
  every mutation it **re-discovers** rather than assuming a server-side
  name, ordering, or permission change, so the rendered state always
  matches the server. A stale guard prevents an in-flight load from
  clobbering a newer one; a single-flight guard prevents concurrent
  mutations.
- `src/features/lists/lists-screen.tsx` — presentational screen: owned /
  shared sections, empty / loading / error states, a create dialog, and
  per-row action buttons (rename / delete for owned lists, unsubscribe
  for shared lists) with confirmation dialogs.
- `src/app/lists.tsx` — the Expo Router route, auth-gated.
- `src/services/caldav/collections.ts` — `createCalendar` issues an
  RFC 4791 `MKCALENDAR`. Per the RFC the request targets the URL of the
  calendar to be created (`{homeSet}{slug}/`), derived from a
  lowercased, URL-safe slug of the display name — not the home set
  itself (SabreDAV answers `405` when targeted at the home set). On
  success the requested URL is authoritative; a `Location` header, when
  the server sends one, wins (Nextcloud/SabreDAV sends none).

Non-goals: list sharing (Phase 1.5).

## List sharing (Phase 1.5)

List sharing (issue #18) is built on the Nextcloud/ownCloud CalDAV sharing
extension, **not** on the W3C/Apple `calendarserver-sharing` protocol. The
server exposes two signals that the client checks before offering any sharing
UI:

- The `DAV:` response header from the calendar-home `PROPFIND` advertises the
  `oc-resource-sharing` token (and, on newer servers,
  `calendarserver-sharing`). `discoverCalendars` parses this header into a
  `CalDAVCapabilities` object; `parseDavFeatures` is the tolerant
  case/whitespace-insensitive tokenizer. When the header is absent or empty,
  `capabilities.sharing` is `false` and the **Share** action is hidden, so the
  UI never offers a feature the server cannot serve.
- `discoverCalendars` also returns `davRootUrl` (`{server}/remote.php/dav/`),
  the target for the sharee `REPORT` search.

The client speaks the `http://owncloud.org/ns` (`oc:`) dialect:

- **Read shares** — `listShares` `PROPFIND`s the calendar for
  `{oc}invite`. Nextcloud returns `200` with an empty `<oc:invite/>` when a
  calendar is unshared, so an empty/absent property maps to `[]` rather than
  an error. Each `<oc:user>` carries the sharee `DAV:href`, an optional
  `oc:common-name`, and an `oc:access` block whose presence of
  `oc:read-write` (vs. `oc:read`) determines the access level.
- **Write shares** — `updateShares` `POST`s an `oc:share` document to the
  calendar URL. `oc:set` entries add or change a share (presence of
  `oc:read-write` ⇒ read-write, absence ⇒ read-only); `oc:remove` entries
  revoke. Nextcloud self-shares (sharee == owner) are a silent no-op. Batches
  larger than ten set+remove operations are rejected client-side before any
  request is sent (the server answers `400`).
- **Search sharees** — `searchPrincipals` issues a DAV
  `principal-property-search` `REPORT` against `davRootUrl`, matching
  `D:displayname` (prefix) and `s:email-address`. Results are mapped to
  `SharePrincipal` with a `kind` (`user` / `group` / `room` / `resource` /
  `other`) derived from the principal collection path.

A key wire-format detail: the server resolves a sharee through `findByUri`,
which understands only `principal:` and `mailto:` URIs — a raw DAV path
resolves to nothing and the sharee is **silently skipped** (`continue`). The
`oc:invite` property reports sharees in the `principal:principals/...` form,
but the sharee search reports DAV paths in `principal-URL`. `toPrincipalUri`
therefore normalizes both sources to the `principal:` form (applied in
`searchPrincipals` and again as a safety net in `updateShares`), so every
`oc:set` / `oc:remove` href is resolvable.

`src/services/caldav/sharing.ts` is the pure service layer
(`listShares`, `updateShares`, `searchPrincipals`, and the pure
`buildShareRequestXml` serializer); `src/features/lists/use-lists.ts` adds
the state (`sharingSupported`, a per-calendar `shares` map, `isSharing`,
`shareError`) and the callbacks (`refreshShares`, `searchSharePrincipals`,
`shareCalendar`, `updateShareAccess`, `revokeShare`). Share mutations
re-fetch only that calendar's shares (no full re-discovery) and are guarded
so only one share operation is in flight at a time. `lists-screen.tsx` adds a
`Share` action (owned rows, capability-gated) that opens a `ShareDialog`
to view/add/toggle-access/remove shares and to search for sharees.

Non-goals: sharing task items (not lists), circle/room sharee selection
beyond display, and optimistic share state (the server is always re-read).

## VTODO codec (Phase 2.1)

`src/services/caldav/vtodo.ts` uses `ical.js` to read a single VTODO
resource, including multiple instances of the same UID. Dates, floating
times, UTC times, and times with a `TZID` stay distinct; parsing does not
resolve time zones or expand recurring series.

Serializing an existing resource returns its original text, preserving
recurrence rules and exceptions, alarms, time-zone definitions, subtask
relationships, and extension properties. Creating a new task generates
a minimal `VCALENDAR` from a caller-supplied UID, UTC timestamp, and
escaped summary.

## Basic task CRUD (Phase 2.2)

`src/services/caldav/tasks.ts` queries a single collection for VTODO
resources and fetches each original body and its ETag together with `GET`.
This avoids using a REPORT snapshot's ETag for a separately fetched body.
Only direct children of the selected collection are accepted. Reads and
writes use the discovered privileges; the server is still authoritative.

Creation sends `If-None-Match: *`; updates and deletes require a strong
ETag and send `If-Match`. A `412` is a conflict and is never retried
unconditionally. Read the task again before another mutation. Summary and
completion changes replace only the relevant top-level properties,
preserving other lines, alarms, and extensions. Basic edits and deletes
refuse recurring resources. Task UI, recurrence editing,
and bulk synchronization are separate work.

## Task metadata (Phase 2.3)

The task model exposes `DESCRIPTION` as notes, RFC 5545 priority
(`0` means undefined priority; `1` is highest and `9` lowest), and the UTC
`COMPLETED` timestamp when present. The same conditional update supports
notes, priority, start and due changes. Omitted fields stay unchanged;
`null` clears optional fields. Schedule edits validate wall-clock fields,
require due to follow start when both exist, and refuse mixed time kinds or
different zones rather than guessing an ordering. The codec reuses zones
already used by the task or defined in its `VTIMEZONE`; it does not generate
time zone definitions. `DURATION`, alarms, and unrelated metadata are kept
intact. Task editor controls and recurrence editing are out of scope.

## Subtasks and task moves (Phase 2.4)

Tasks expose `RELATED-TO` links by UID; an omitted `RELTYPE` means
`PARENT`. Parent edits affect only that link. They check for missing
ancestors, ambiguous links, and cycles in the current list before a
conditional write. Ancestor checks are snapshots, not a server-side
transaction across resources.

Cross-list moves use one same-server WebDAV `MOVE`, with `If-Match` and
`Overwrite: F`; there is no copy/delete fallback. Moves currently accept
only non-recurring tasks with no outgoing links or incoming links visible
in the source list. This avoids splitting known relationships. Moves of
entire subtrees, cross-list link discovery, and the task UI are out of
scope. Destination UID collisions are checked before the move; the
server is authoritative for concurrent writes and permissions.

## Task recurrence (Phase 2.5)

With a valid `DTSTART`, one VTODO can add, replace, or remove a simple
daily, weekly, monthly, or yearly `RRULE` with interval 1–999. Recurrence
changes use the task's captured strong ETag and replace only the rule.
Rules with extra fields (including `COUNT`, `UNTIL`, and `BYDAY`),
parameterized or duplicate rules, recurrence dates, and exception
instances stay read-only and are preserved verbatim. The service does not
expand occurrences or complete recurring tasks.

## Task screen (Phase 2.6)

Opening a readable active list uses the discovered collection and the
authenticated session in memory. The task screen offers quick add, a
metadata editor, simple recurrence controls, and completion, reopening,
and confirmed deletion for non-recurring tasks. Each task has a compact
row with a completion circle and a tappable title. Completed titles are
struck through. A swipe or the row's menu reveals Delete. Writes reload server state.
An error blocks further mutations until refresh, avoiding retries with
an old ETag. Hierarchy and moves remain service APIs; smart views and
offline editing are separate work.

## Data safety principles

- iCalendar `VTODO` data round-trips must preserve UIDs, unknown properties,
  and recurrence rules. Loss of user data is a defect, not a limitation.
- Credentials live in `expo-secure-store` (device keychain) only.
- No telemetry by default; HTTPS for all production traffic.
- Real-server integration tests are read-only by default. The optional
  create check is for a dedicated test account and never deletes data.

## Known constraints

- Background synchronization on iOS is best-effort; the OS controls when
  background tasks may run.
- Expo Go supports the subset of native modules shipped with the SDK;
  features needing extra native code require a development build (EAS).
- Native iOS builds require macOS (local or EAS Cloud); Linux-based CI can
  validate everything except actual iOS compilation.
