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

### Connection screen appearance (issue #28)

On a physical iPhone in Expo Go, set **Settings → Display & Brightness**
to Dark. Open the app signed out and check that the heading, server label,
placeholder, typed URL, validation error, and Continue button are readable.
Start sign-in and check the waiting text and Cancel button. Once signed in,
check the server and user details, Task lists, and Log out. Switch back to
Light and confirm the connection screen updates without restarting the app.

### Phase 1.3: verifying task-list navigation

In Expo Go, sign in on the dedicated test account. The **Connected**
screen should show **Task lists** on a blue button and
offer **Log out**, with no Hello World shortcut. Tap **Task lists**.
The app should open the task-list screen even if discovery is still
loading, finds no lists, or reports an error.
Once the lists load, create a uniquely named test list and confirm it
appears without leaving the screen.
Individual list rows are display-only in Phase 1.3; opening a list to
view its tasks comes in Phase 2.

### Phase 1.4: verifying rename, delete, and unsubscribe

In Expo Go, sign in on the dedicated test account and open the task-list
screen. For each operation, verify:

**Rename (owned list):**

1. Tap **Rename** on an owned list — a dialog opens prefilled with the
   current name.
2. Change the name and tap **Rename** — the list disappears briefly
   (re-discovery) and reappears with the new name.
3. Clear the name to whitespace — the **Rename** button is disabled.

**Delete (owned list):**

1. Tap **Delete** on an owned list — a confirmation dialog opens
   warning that the list and all its tasks will be permanently deleted.
2. Tap **Cancel** — no delete occurs; the list is still present.
3. Tap **Delete** again, then **Delete** in the dialog — the list
   disappears from the screen (re-discovery confirms removal).
4. Verify on the test account (Web UI) that the list is gone.

**Unsubscribe (shared list):**

1. Have a list shared with the test account from another account.
2. Tap **Unsubscribe** — a confirmation dialog opens explaining that
   only the share is removed, not the owner’s data.
3. Tap **Unsubscribe** — the shared list disappears from the
   “Shared with me” section.
4. Verify on the owner’s account that the list and its tasks are
   untouched.

**Permission awareness:**

- Owned lists show **Rename** and **Delete** buttons; **Unsubscribe** is
  not offered.
- Shared lists show only **Unsubscribe**; **Rename** and **Delete** are
  not offered (the app never attempts to delete a shared owner’s data).

**Error surfacing:**

- With the network disconnected, attempt any mutation — the dialog
  stays open and shows a network error message; the list state is
  unchanged.

### Phase 1.5: verifying list sharing

List sharing is **capability-gated**: the **Share** action only appears when
the server advertises the `oc-resource-sharing` CalDAV extension in the
`DAV:` response header. Verify the gate first:

- **Capability detection:** sign in against a server that _does not_ support
  the sharing extension — the **Share** button must be absent on owned lists.
  Against a server that does (e.g. the NC 35 test server), the **Share**
  button appears on owned lists only.

In Expo Go, with a sharing-capable server:

**View + share:**

1. Tap **Share** on an owned list — the dialog opens and loads the current
   share list from the server.
2. Search for a user or group — matching sharees appear with a type label
   (e.g. “(group)”). Tap **Add** on one — the share is created and the
   share list refreshes to show the new sharee.
3. A “Shared with N people” line appears under the list row.

**Change access + remove:**

1. In the dialog, tap a sharee’s **Read-only** / **Read-write** button — the
   access level toggles and the list refreshes.
2. Tap **Remove** on a sharee — the share is revoked and the list refreshes.

**Real-server note (single-account limitation):** sharing a calendar with the
_own_ account is a silent server no-op, so a single-account test cannot show
a visible share created by the app itself. To verify end-to-end, create the
share from the Web UI (or a second account) and confirm it appears in the
app; then toggle/remove it from the app and confirm the server-side change.

**Error surfacing:**

- A `403` (refused) or `501` (unsupported) from the sharing endpoint keeps
  the dialog open, shows a share error message, and leaves the previous share
  list unchanged.

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

### Phase 1.7: verifying list trash and restore

On a dedicated Nextcloud account with calendar trash enabled, create a
disposable task list and add a task using Nextcloud Tasks. In Expo Go, use
**Move to Trash** and confirm the list disappears from the active view.
Open **Trash**, restore the list, and confirm that both the list and its
task return. Shared lists should still offer only **Unsubscribe**.

On a server without positive calendar trash retention, **Trash** and
**Move to Trash** are not offered. **Delete** is a separate action with
an irreversible confirmation. Failed trash and restore requests are not
retried as permanent deletes.

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
to `1` to also run a full mutation round-trip: create a list named
`CalDAV check Ü & …`, rename it, and delete it with the
`X-NC-CalDAV-No-Trashbin: 1` header (a real permanent delete, not a
trashbin move). On success the list is gone; verify on the test account
that no leftover list remains.

To also check the trash discovery regression without writing any data, set
`NC_TEST_READ_ONLY_SHARE_SLUG` and `NC_TEST_TRASHED_LIST_SLUG` in
`.env.nc-test`. Use the last path segment (decoded, no surrounding slashes)
of each collection in the test account's calendar home. The first must be an
active VTODO collection shared to that account with read-only access; the
second must be a disposable owned task list already moved to the server's
trash, not permanently deleted. The test checks the deletion marker directly
before verifying that discovery excludes the trashed list and keeps the share.
Set only `NC_TEST_TRASHED_LIST_SLUG` to verify that an owned list is
discoverable in Trash but not in active lists, without needing a share fixture.

### Phase 1 compatibility and verification

| Server / client               | Verified                                                                                                                                                                                                                                                             | Not confirmed by this check                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nextcloud 35.0.3 / CalDAV     | Principal and home discovery; active read-only share; trashed list exclusion; unsubscribe preserved the owned list and removed recipient access; unsharing removed the incoming list                                                                                 | Other server versions, group sharing, and independent server read-back of permission toggles |
| Physical iPhone / my-nc-tasks | User confirmed MFA sign-in and session persistence; owned-list create, rename, and delete; adding a user share and toggling read-only → read-write → read-only. The trashed list disappeared with [PR #30](https://github.com/ChristianKuehnel/my-nc-tasks/pull/30). | Group sharing and behavior on servers without the sharing extension                          |
| Nextcloud web                 | User confirmed the fresh read-only share appeared both in the Nextcloud web UI and in my-nc-tasks. The trashed test collection was not visible as an active list.                                                                                                    | Which web view showed the share (Tasks or Calendar)                                          |
| iOS Reminders                 | The trashed test collection was not visible as an active list.                                                                                                                                                                                                       | Visibility of an active share                                                                |

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
