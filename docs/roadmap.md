# Roadmap

Status legend (kept truthful — never label work "complete" from generated code alone):

- `planned` — not started
- `in progress` — a branch/PR is actively being worked on
- `implemented; automated tests passed` — code and tests exist and pass
- `awaiting manual device/server verification` — automated checks pass, real-device or real-server validation pending
- `awaiting review/merge` — PR open
- `merged and verified` — merged into `main` and verified
- `blocked` — cannot proceed; dependency described

## Phase 0 — Bootstrap, tooling, CI, iPhone Hello World (mandatory gate)

| Item | Description                                                                                                                   | Status                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 0.1  | Repository bootstrap and governance (LICENSE, NOTICE, AGENTS, docs, templates)                                                | merged and verified                   |
| 0.2  | Reproducible Linux/agent development environment (Expo SDK 58, pinned Node/pnpm, scripts)                                     | merged and verified                   |
| 0.3  | Automated code quality, static analysis and tests (Prettier, ESLint, TS strict, Jest, coverage, Dependabot, pre-commit hooks) | merged and verified                   |
| 0.4  | GitHub Actions CI and build validation (frozen installs, quality checks, expo-doctor, CodeQL)                                 | merged and verified                   |
| 0.5  | Minimal interactive Hello World app on a physical iPhone via Expo Go                                                          | merged and verified                   |
| 0.6  | EAS build/release pipeline smoke test (config + workflow; native build gated by credentials)                                  | implemented; automated tests passed\* |

\* **0.6 note:** `eas.json` (three profiles) and the manually triggered smoke-build
workflow are in place and validated against the official `@expo/eas-json` schema.
The native iOS build/install step of the Phase 0 gate was **explicitly waived by
the user on 2026-11-19** (no Expo/Apple credentials available in this
environment). Limitations: no signed native binary has ever been installed or
launched; Expo Go remains the day-to-day development path. The EAS configuration
and workflow are ready for use as soon as credentials exist
(set `EXPO_TOKEN` repo secret → run the "EAS smoke build" workflow).

**Phase 0 hard gate:** no Phase 1 work until items 1–6 of the plan's gate are met
(public repo + PR workflow, green Linux setup/doctor/CI, human-verified Hello World
on a physical iPhone via Expo Go, and EAS smoke test installed on-device **or
explicitly waived by the user**).

**Gate state: SATISFIED (2026-11-20).** Public repo + PR workflow done;
Linux setup/doctor/CI green; the user confirmed the Hello World app on a
physical iPhone via Expo Go (greeting visible, counter increments, Fast
Refresh works); EAS native build **waived by the user** (see 0.6 note).
Phase 1 may proceed.

## Phase 1 — Nextcloud authentication, discovery, lists, sharing

| Item | Description                                                                 | Status      |
| ---- | --------------------------------------------------------------------------- | ----------- |
| 1.1  | Nextcloud Login Flow v2 (browser login, polling, SecureStore sessions, MFA) | in progress |
| 1.2  | CalDAV discovery (principals, calendar home, VTODO calendars, permissions)  | planned     |
| 1.3  | List browsing and create (owned + shared, empty/loading/error states)       | planned     |
| 1.4  | Rename / delete / unsubscribe (safe, permission-aware)                      | planned     |
| 1.5  | List sharing (Nextcloud DAV sharing extensions, capability detection)       | planned     |
| 1.6  | Phase 1 integration hardening (e2e paths, compatibility matrix)             | planned     |

## Phase 2 — Task operations and Reminders-inspired UI

| Item | Description                                                                    | Status  |
| ---- | ------------------------------------------------------------------------------ | ------- |
| 2.1  | VTODO parsing/serialization (safe round-trips, unknown properties, recurrence) | planned |
| 2.2  | Basic task CRUD (create, edit, complete/reopen, delete, conditional writes)    | planned |
| 2.3  | Task metadata (title, notes, due/start, priority, completion)                  | planned |
| 2.4  | Subtasks and task moves (VTODO hierarchy, cross-list moves)                    | planned |
| 2.5  | Recurrence (edit where safe; preserve unsupported rules)                       | planned |
| 2.6  | Reminders-inspired list/task UI (navigation, quick add, swipe actions, themes) | planned |
| 2.7  | Smart views and sorting (Today, Scheduled, All, Important — local filters)     | planned |

## Phase 3 — Offline persistence, conflict-safe sync, notifications

| Item | Description                                                                  | Status  |
| ---- | ---------------------------------------------------------------------------- | ------- |
| 3.1  | SQLite schema/migrations (lists, tasks, ETags, sync cursor, pending ops)     | planned |
| 3.2  | Offline-first repository/UI (local reads and immediate local edits)          | planned |
| 3.3  | Synchronization engine (full/incremental, sync tokens, ETags, retry/backoff) | planned |
| 3.4  | Mutation queue and conflict resolution (no silent overwrites)                | planned |
| 3.5  | Local notification scheduling (reminders offline, restart reconciliation)    | planned |
| 3.6  | Offline and resilience testing (airplane mode, restart, failure injection)   | planned |

## Phase 4 — iOS background operation and production distribution

| Item | Description                                                                       | Status  |
| ---- | --------------------------------------------------------------------------------- | ------- |
| 4.1  | Background task integration (Expo BackgroundTask, non-overlap)                    | planned |
| 4.2  | Native iOS validation (physical-device development build, best-effort background) | planned |
| 4.3  | Distribution and production builds (EAS, TestFlight, release conventions)         | planned |
| 4.4  | Release quality audit (security, a11y, performance, regression, docs)             | planned |
