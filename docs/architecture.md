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

| Component | Version | Pin location | Notes |
| --------- | ------- | ------------ | ----- |
| Expo SDK  | ~58.0.26 | `package.json` | RN 0.88, React 19.3 |
| React Native | 0.88.1 | `package.json` | |
| React     | 19.3.0  | `package.json` | |
| Node.js   | 22.22.0 | `.node-version`, `.mise.toml` | LTS 22.x; Expo requires >=22.13 on the 22 line |
| pnpm      | 12.21.0 | `package.json` (`packageManager`), `.mise.toml` | via Corepack or mise |
| TypeScript| ~6.0.3  | `package.json` | strict mode |
| Router    | expo-router ~58.0.32 | `package.json` | file-based routing under `src/app` |

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

### Why Node 22.22.0

- Satisfies the Expo SDK 58 requirement (>= 22.13 on the 22 line).
- Matches the version available on the primary development machine; CI
  installs exactly this version via `actions/setup-node` reading
  `.node-version`.

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
