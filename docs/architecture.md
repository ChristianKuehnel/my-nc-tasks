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

| Component    | Version               | Pin location                                    | Notes                                                                                                                                                                            |
| ------------ | --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expo SDK     | ~58.0.26              | `package.json`                                  | RN 0.88, React 19.3                                                                                                                                                              |
| React Native | 0.88.1                | `package.json`                                  |                                                                                                                                                                                  |
| React        | 19.3.0                | `package.json`                                  |                                                                                                                                                                                  |
| Node.js      | 22.23.5               | `.node-version`, `.mise.toml`                   | Latest 22.x (LTS); Expo requires >=22.13 on the 22 line; some tooling (lint-staged 17) requires >=22.22.1                                                                        |
| pnpm         | 12.21.0               | `package.json` (`packageManager`), `.mise.toml` | via Corepack or mise                                                                                                                                                             |
| TypeScript   | ~6.0.3                | `package.json`                                  | strict mode                                                                                                                                                                      |
| Router       | expo-router ~58.0.32  | `package.json`                                  | file-based routing under `src/app`                                                                                                                                               |
| XML parser   | fast-xml-parser 4.5.7 | `package.json`                                  | v4 pinned on purpose: CJS build with bundled types, single dependency (`strnum`) — compatible with Metro/Hermes; v5 is an ESM Nodable rewrite that is not a safe fit for Expo Go |

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

## CalDAV discovery

Discovery of task-list calendars (Phase 1.2, issue #15) lives in
`src/services/caldav` — pure TypeScript, no React or SQLite.

Flow (per authenticated session, RFC 6764 + RFC 4791):

1. **Locate the principal** — `PROPFIND {server}/.well-known/carddav/`
   with bounded redirect following; the Nextcloud 302 points directly at
   the user principal. If the `.well-known` resource is unavailable, fall
   back to `PROPFIND {server}/remote.php/dav/` (the DAV collection root),
   which reports `DAV:current-user-principal` session-based.
2. **Calendar home set** — from `C:calendar-home-set` in the probing
   response, or a follow-up `PROPFIND` on the principal.
3. **List calendars** — `PROPFIND` on the home set with `Depth: 1`;
   each calendar yields display name, supported components
   (`VTODO` => task list), owner, `calendar-user-address-set`, and the
   current user's `DAV:current-user-privilege-set` (read / read-write).

Implementation notes:

- `http.ts` — DAV request plumbing: RFC 7617 basic auth from the Login
  Flow v2 app password, per-request timeout, and explicit bounded
  redirect following (a 3xx in non-follow mode is a `server_error`,
  since a redirected PROPFIND would change semantics).
- `xml.ts` — namespace-tolerant multistatus parsing. Prefixes are
  stripped (`removeNSPrefix`), so `D:`/`d:`/default-namespace documents
  all parse identically. SabreDAV quirks are handled: `DAV:cur/@uri`
  attribute wrappers and `privilege-uri` child elements.
- `discovery.ts` — the three-step flow; results are absolute URLs with
  canonical trailing slashes.
- Error surface: `CalDAVError` with stable codes — `network`, `timeout`,
  `unauthorized`, `forbidden`, `not_found`, `server_error` — so the UI
  layer (later phases) can map them to user-facing messages.
- `fetch`, timeout and redirect bounds are injectable; all tests run
  against XML fixtures without a live server or timers.

## List browsing and create (task lists)

The lists feature (Phase 1.3, issue #16) is the first UI feature built on
top of the CalDAV client. It reads the calendars already discovered in
Phase 1.2, splits them into **owned** and **shared** lists, and lets the
user **create** a new task list.

- `src/features/lists/use-lists.ts` — `useLists(session)`. A small
  state machine (`loading` / `ready` / `error`) that wraps
  `discoverCalendars` for the initial load and `refresh`, and
  `createCalendar` for creation. After a create it **re-discovers**
  rather than assuming a server-side name or ordering, so the rendered
  state always matches the server. A stale guard prevents an in-flight
  load from clobbering a newer one.
- `src/features/lists/lists-screen.tsx` — presentational screen: owned /
  shared sections, empty / loading / error states, and a create dialog.
  Shared lists are read-only here (mutations land in Phase 1.4).
- `src/app/lists.tsx` — the Expo Router route, auth-gated.
- `src/services/caldav/collections.ts` — `createCalendar` issues an
  RFC 4791 `MKCALENDAR` against the calendar home set and reads the new
  calendar URL from the `Location` header (no guessed URLs).

Non-goals: rename / delete / unsubscribe (Phase 1.4) and list sharing
(Phase 1.5).

## Data safety principles

- iCalendar `VTODO` data round-trips must preserve UIDs, unknown properties,
  and recurrence rules. Loss of user data is a defect, not a limitation.
- Credentials live in `expo-secure-store` (device keychain) only.
- No telemetry by default; HTTPS for all production traffic.
- Real-server integration tests are non-destructive and separately gated.

## Known constraints

- Background synchronization on iOS is best-effort; the OS controls when
  background tasks may run.
- Expo Go supports the subset of native modules shipped with the SDK;
  features needing extra native code require a development build (EAS).
- Native iOS builds require macOS (local or EAS Cloud); Linux-based CI can
  validate everything except actual iOS compilation.
