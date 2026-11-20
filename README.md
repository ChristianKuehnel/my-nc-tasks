# my-nc-tasks

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

An open-source, **offline-first iOS task app for Nextcloud**, with an interaction
model inspired by Apple Reminders. Tasks and lists are stored on your Nextcloud
server using **CalDAV / iCalendar `VTODO`** — no custom backend, no data silo.

> **Status:** Phase 1 (Nextcloud authentication, discovery, lists, sharing)
> in progress; Phase 0 complete.
> See [docs/roadmap.md](docs/roadmap.md) for the current, truthful status of
> every planned feature.

## Features (planned, by phase)

- **Phase 1 — Nextcloud basics:** Login Flow v2 authentication, CalDAV discovery,
  list browsing/create/rename/delete, list sharing.
- **Phase 2 — Tasks and UI:** task CRUD, subtasks, recurrence, Reminders-inspired
  UI with Today / Scheduled / All / Important smart views.
- **Phase 3 — Offline:** SQLite persistence, conflict-safe sync engine, local
  notifications that work offline.
- **Phase 4 — Background and distribution:** iOS background sync, EAS/TestFlight
  distribution, release quality audit.

## Development (Linux, no macOS required)

Prerequisites: a Node.js 22.x runtime (see `.node-version`), no global npm
packages required — `corepack`/`mise` handle the rest.

```sh
./scripts/setup.sh    # provision tooling, install frozen dependencies, verify
./scripts/doctor.sh   # full environment diagnostics
./scripts/dev.sh      # start the Expo dev server
./scripts/dev.sh --tunnel   # when the iPhone is not on the same network
```

Quality gate (run before pushing; CI enforces it):

```sh
pnpm format          # auto-format the repository
pnpm format:check    # fail on unformatted changes (CI uses this)
pnpm lint
pnpm typecheck
pnpm test
```

See [docs/development.md](docs/development.md) for onboarding details.

## Running on a physical iPhone (Expo Go)

1. Install **Expo Go** from the Apple App Store (version 58.x, required for
   Expo SDK 58).
2. Start the dev server on your Linux machine: `./scripts/dev.sh`.
3. Scan the printed QR code with the iPhone camera.
4. If the iPhone is on a different network, use `./scripts/dev.sh --tunnel`.
5. Fast Refresh: press `r` in the terminal or double-tap `R` on the device.

See [docs/development.md](docs/development.md#running-on-a-physical-iphone-expo-go)
for the full workflow.

## EAS Build and distribution

`eas.json` defines `development`, `internal` (TestFlight) and `production`
profiles. Native iOS builds require an Expo (EAS) account and an Apple Developer
account; credentials are never stored in this repository. Build costs are
controlled by the account holder. See [docs/development.md](docs/development.md#eas-builds-and-distribution).

## Nextcloud

Authentication uses the official **Nextcloud Login Flow v2**. Supported server
versions will be documented in a compatibility matrix once verified on real
servers (Phase 1).

## Limitations

- Background synchronization is best-effort; iOS controls scheduling.
- Local notifications fire offline, but remote changes are only reflected after
  a synchronization run.
- The App Store release requires explicit maintainer approval (Phase 4).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). All changes
go through pull requests against `main`; Conventional Commits and semantic
versioning are used, with squash merges for a clean history.

- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security policy: [SECURITY.md](SECURITY.md)

## License

[Apache License 2.0](LICENSE) — see [NOTICE](NOTICE).
