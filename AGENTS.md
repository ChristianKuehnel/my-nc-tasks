# AGENTS.md — Persistent instructions for coding agents

This file is the standing contract for OpenCode/agent sessions working in this repository.
Read it together with `my-nc-tasks-implementation-plan.md`, `docs/architecture.md`,
`docs/development.md`, and the issue assigned to the work item before changing code.

## Project identity

- **Project:** `my-nc-tasks` — an open-source, offline-first iOS task app for Nextcloud.
- **Stack:** TypeScript (strict), React Native, Expo + Expo Router, SQLite (`expo-sqlite`),
  `expo-secure-store`, `expo-notifications`, Nextcloud CalDAV/iCalendar `VTODO`.
- **Target:** physical iPhone via Expo Go (compatible features) and EAS builds (distribution).
- **License:** Apache-2.0. Language of code, docs, issues, commits, and PRs: **English**.

## Repository layout

See the "Recommended repository structure" section of the implementation plan.
Adapt to the actual Expo SDK layout; do not invent unsupported folders.

## Mandatory workflow (no exceptions)

1. **Never commit directly to `main` for feature work.** After the bootstrap baseline,
   every change — feature, toolchain, docs, refactor, or fix — gets its own
   short-lived branch **and** GitHub pull request.
2. Branch naming: `feat/<issue>-<name>`, `fix/<issue>-<name>`,
   `chore/<issue>-<name>`, `docs/<issue>-<name>`, `test/<issue>-<name>`.
3. One issue per independently deliverable unit; link the issue from the PR.
4. Start from an up-to-date, green `main` (`git pull --ff-only origin main`).
   Never mix unrelated changes into one PR.
5. Add or update tests and documentation **in the same PR** as the behavior change.
6. Before pushing, run locally: `pnpm format`, `pnpm lint`, `pnpm typecheck`,
   `pnpm test`, plus any relevant build validation.
7. Push the branch and open the PR with: linked issue, scope and non-goals,
   test evidence (commands + results), CI status, manual verification steps,
   security/compatibility notes, screenshots for UI changes, and known limitations.
8. **Never self-merge or merge a PR without explicit user authorization.**
   Green CI is necessary but not sufficient. Never claim open PR code is merged.
9. After an authorized merge, update local `main` before starting the next dependent unit.
10. Never rewrite or force-push shared history. Never delete remote branches,
    server data, or user files without explicit authorization.

## Development environment rules

- Respect the pinned Node.js version and the frozen `pnpm-lock.yaml`
  (`pnpm install --frozen-lockfile` in CI; use `pnpm install` locally to add deps).
- No prerequisite global npm packages. Use `corepack`/`mise` per `docs/development.md`.
- Verify the environment with `./scripts/doctor.sh` before coding.
- No telemetry by default. Secrets, credentials, tokens, and task data are sensitive:
  never commit them, log them, or embed them in fixtures.

## Code quality rules

- TypeScript strict mode; no casual `any`; no `@ts-ignore` to hide real errors.
- Do not disable failing tests, skip checks, or pretend unrun checks passed.
- Keep the Expo Go path working for compatible features; isolate native-only APIs
  behind abstractions so features can degrade gracefully.
- Preserve VTODO metadata and unknown iCalendar properties on round-trips.
  **Never silently lose user data.**
- Prefer deterministic tests that run without a live Nextcloud server.
  Real-server integration tests are separately gated and non-destructive.

## Gates that require explicit user approval

- Merging pull requests.
- Phase gates (in particular the Phase 0 → Phase 1 gate: physical iPhone
  Hello World verification via Expo Go, and the EAS smoke test or its waiver).
- Destructive actions (deleting branches, data, releases).
- Payments, paid resources, EAS/Apple credential use, native signing,
  TestFlight/App Store submission.

## End-of-work-item report

Every work item ends with a concise report containing:

- Issue number and title.
- Branch name and PR URL (if created).
- Files changed (summary) and exact commands/tests run with their results.
- CI state (green/red/pending), with any failing checks listed.
- Manual verification state (done / pending / blocked — be truthful).
- Blockers and the exact next actionable step.
