# Development guide

How to set up, run, test, and ship `my-nc-tasks` from a Linux machine.
The workflow works for human developers and coding agents alike.

## Requirements

- **Linux or macOS** (Linux is the primary development platform).
- **Node.js 22.23.5** (pinned in `.node-version`). Expo SDK 58 accepts
  > = 22.13 on the 22.x line, >= 24.3 on the 24.x line, or >= 26; the pin is
  > the latest 22.x LTS and is also required by some tooling (lint-staged 17
  > needs >= 22.22.1). CI always installs the pinned version; a local
  > mismatch produces a non-fatal warning. Install via your distribution,
  > [nvm](https://github.com/nvm-sh/nvm), or [mise](https://mise.jdx.dev).
- **No global npm packages required.** pnpm is pinned in `package.json`
  (`packageManager: pnpm@12.21.0`) and activated through **Corepack**
  (shipped with Node) or **mise** (see `.mise.toml`).

> **Corepack version note:** pnpm 12 uses a native-binary layout that requires
> **Corepack >= 0.36**. The Corepack bundled with Node 22.x (0.34) cannot
> start pnpm 12. If `pnpm -v` fails with a "Cannot find module
> .../pnpm.cjs" error, install a newer Corepack at user level (no root needed):
>
> ```sh
> npm install -g --prefix "$HOME/.local" corepack@0.36.0
> ```
>
> (CI does the same upgrade step explicitly.)

Enable Corepack once (pick the directory that is on your PATH and writable):

```sh
corepack enable                              # system Node install
corepack enable --install-directory ~/.local/bin   # user-level (no root)
```

## First-time setup

```sh
./scripts/setup.sh
```

What it does:

1. Validates OS/architecture and the Node.js version (warns when it differs
   from the pin; fails when unsupported).
2. Activates pnpm via Corepack when missing.
3. Installs dependencies from the committed lockfile
   (`pnpm install --frozen-lockfile`).
4. Verifies the Expo CLI and prints next steps.

Verify the environment afterwards:

```sh
./scripts/doctor.sh
```

`doctor.sh` reports Node/pnpm pins, lockfile integrity, Expo project state,
network reachability, and optional tooling (GitHub CLI, EAS). It exits
non-zero when a required check fails.

## Running the app

### On a physical iPhone (Expo Go)

1. Install **Expo Go** from the Apple App Store. It must be version **58.x**
   (the store build 58.0.5, released 2026-10-22, supports Expo SDK 58; older
   Expo Go builds will refuse to open the project).
2. Start the dev server on the Linux machine:

   ```sh
   ./scripts/dev.sh            # LAN mode: iPhone on the same network
   ```

   If the iPhone is on a different network (or behind restrictive NAT),
   use tunneling:

   ```sh
   ./scripts/dev.sh --tunnel
   ```

3. The terminal prints a QR code and URLs. Scan the QR code with the iPhone
   camera (or open the printed URL in Expo Go via "Load > Enter URL").
4. The app loads. **Fast Refresh** works by pressing `r` in the terminal or
   double-tapping `R` in the Expo Go window; live code reloading applies
   edits without a full restart.

### Phase 0.5 gate: verifying the Hello World app

**Gate passed on 2026-11-20** — the user verified the Hello World app on a
physical iPhone via Expo Go (greeting visible, counter increments, Fast
Refresh works). The steps below are kept for the record and for future
fresh-install sanity checks.

The Phase 0.5 screen is the Hello World screen (issue #4): a greeting plus
one button with a press counter. On a physical iPhone, verify that:

1. The screen shows **"Hello from my-nc-tasks"** and "Not pressed yet".
2. Tapping **"Tap to increment"** increments the counter
   ("Pressed 1 time", "Pressed 2 times", ...).
3. Fast Refresh works: while the dev server runs, edit
   `src/app/index.tsx` (e.g. change the greeting text), save, and press `r`
   in the terminal (or double-tap `R` in Expo Go) — the screen updates
   without a reinstall or a full restart.

> **Gate note (Phase 0.5):** this human verification on a physical iPhone is
> mandatory. An automated test is not a substitute.

### Phase 1.3: verifying task-list navigation

In Expo Go, sign in on the dedicated test account and tap **Task lists**
on the **Connected** screen. The app should open the task-list screen even
if discovery is still loading, finds no lists, or reports an error.
Once the lists load, create a uniquely named test list and confirm it
appears without leaving the screen.

### On the simulator (macOS only)

Not part of the standard workflow (Linux-only development is the goal), but
`pnpm ios` / `pnpm android` work where the platform toolchain exists.

## Quality gate

Run before pushing (CI enforces the same):

```sh
pnpm format          # auto-format (Prettier)
pnpm format:check    # fail on unformatted changes (CI)
pnpm lint            # ESLint (Expo recommended config)
pnpm typecheck       # TypeScript strict
pnpm test            # unit/component tests (Jest + jest-expo)
pnpm test:coverage   # tests + coverage report
pnpm check           # the whole gate in one command
./scripts/test.sh    # same gate via script
```

A noninteractive equivalent of the pre-commit hook (for agents and CI):
run `pnpm format && pnpm check` before committing/pushing.

## Live CalDAV checks

Use a dedicated HTTPS Nextcloud test account. Keep `NC_TEST_URL`,
`NC_TEST_USER`, and `NC_TEST_PASSWORD` (an app password) in a local,
gitignored `.env.nc-test`. Do not print or commit the values.

```sh
(
  set -a
  . ./.env.nc-test
  set +a
  NC_TEST_CREATE=0 pnpm exec jest tests/integration --runInBand
)
```

This checks discovery without writing data; the suite skips without
credentials. Only on a dedicated test account, change `NC_TEST_CREATE`
to `1` to also create and rediscover one empty list named `CalDAV check Ü & …`.
This check leaves the list in place. Inspect the test account manually
afterward; an HTTP `204` alone did not confirm removal on the test server.

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main`
and on every pull request targeting `main`. The three required checks
(enforced by the `main` branch protection ruleset):

| Check          | What it validates                                                            |
| -------------- | ---------------------------------------------------------------------------- |
| `quality-gate` | Prettier check, ESLint, TypeScript strict, Jest + coverage, dependency audit |
| `expo-doctor`  | Expo project/dependency configuration (20 checks)                            |
| `ios-bundle`   | `expo export --platform ios` — the Metro/Hermes bundle actually builds       |

CodeQL runs via GitHub's code scanning default setup (JavaScript/TypeScript,
default query suite) — no custom scanner workflow, no duplication.

> **Scope note:** all CI checks run on Linux. They are **not** an iOS
> native compile — they validate the JavaScript bundle, the Expo
> configuration, and code quality. Native iOS builds are produced by EAS
> (see below / Phase 0.6).

Environment handling in CI mirrors the local setup: Node from
`.node-version`, Corepack >= 0.36 installed explicitly (the Corepack
bundled with Node 22.x cannot start pnpm 12), pnpm pinned via the
`packageManager` field, `pnpm install --frozen-lockfile`.

## Scripts overview

| Script                          | Purpose                                   |
| ------------------------------- | ----------------------------------------- |
| `./scripts/setup.sh`            | Idempotent environment + dependency setup |
| `./scripts/doctor.sh`           | Actionable environment diagnostics        |
| `./scripts/dev.sh [--tunnel]`   | Start the Expo dev server                 |
| `./scripts/test.sh`             | Full local quality gate                   |
| `./scripts/format.sh [--check]` | Prettier format / check                   |

## Project layout

- `src/app/` — Expo Router routes (screens/navigation).
- `src/features/` — feature modules (added as phases land).
- `src/services/` — protocol, persistence, and Nextcloud services.
- `src/components/`, `src/hooks/`, `src/constants/` — shared UI building
  blocks (added as features land).
- `tests/` — unit, integration, and fixtures (Jest + jest-expo, React
  Native Testing Library).
- `scripts/` — the environment scripts above.
- `docs/` — architecture, this guide, roadmap, and phase verification.

## Upgrading dependencies

1. Read the Expo changelog for the target SDK and the upgrade guide
   (`npx expo install expo@<sdk> --fix` aligns all supported packages).
2. Update the pins in `package.json` (via `expo install`), `.node-version`
   / `.mise.toml` when the Node requirement changes.
3. Run `npx expo-doctor` to catch misaligned versions.
4. Update `docs/architecture.md` with the new versions and reasoning.
5. Commit `pnpm-lock.yaml`. Keep the change in its own branch/PR.

## EAS builds and distribution

`eas.json` defines three build profiles (Phase 0.6):

| Profile       | Purpose                                                           | Key options                                                                                                      |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `development` | Native development client (iterating on code with native modules) | `developmentClient: true`, `distribution: internal`, channel `development`                                       |
| `internal`    | TestFlight internal preview builds                                | `distribution: internal`, channel `internal`                                                                     |
| `production`  | App Store submission                                              | `distribution: store`, channel `production` (`submit.production` runs `eas submit` against TestFlight/App Store) |

`appVersionSource: remote` lets EAS manage the iOS build number.

**Expo Go vs. dev client:** day-to-day development uses Expo Go (no
build required, see above). The `development` profile is only needed
once the project uses native modules that Expo Go does not ship.

### Accounts and credentials (never committed)

- **Expo account** (free tier supports EAS Build) and an access token
  exposed as the repository secret `EXPO_TOKEN`.
- **Apple Developer Program** account ($99/year) for signing,
  TestFlight, and App Store submission. EAS can use Apple credentials
  stored in the Expo dashboard (remote signing) or your local
  `~/Library/Keychains`/CI credentials (local signing) — nothing is
  stored in this repository.
- **Device registration** for ad-hoc/TestFlight internal testing is
  handled via TestFlight (Apple manages device UDIDs for internal
  testers); no manual provisioning profiles are required with EAS
  remote signing.

### Triggering builds from Linux

- **Manually:** `pnpm dlx eas-cli build --platform ios --profile
internal` (requires `EXPO_TOKEN` in the environment).
- **Via CI:** the `EAS smoke build` workflow
  (`.github/workflows/eas-smoke-build.yml`, manual dispatch, profile
  choice). It fails fast with instructions when `EXPO_TOKEN` is not
  set, and runs `eas build --no-wait` otherwise — the build continues
  in the EAS cloud and is tracked in the Expo dashboard.

Build costs are controlled by the account holder. The native
build/install step of the Phase 0 gate was **explicitly waived by the
user (2026-11-19)** because no Expo/Apple credentials are available in
this environment; see the 0.6 note in `docs/roadmap.md` for the
documented limitations. Expo Go remains the working development path.

## Working as an agent

- Read `AGENTS.md` first; it is the standing contract.
- Use the scripts instead of ad-hoc commands: `setup.sh`, `doctor.sh`,
  `test.sh`, `format.sh`.
- Respect the pinned toolchain and the frozen lockfile.
- One issue, one branch, one PR — see `CONTRIBUTING.md`.
- Never commit secrets; never claim device verification that was not
  performed.
