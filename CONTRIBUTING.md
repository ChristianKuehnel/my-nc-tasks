# Contributing to my-nc-tasks

Thank you for contributing! This project follows a strict pull-request workflow
to keep history clean and reviews focused.

## Development setup

See `docs/development.md`. In short, on Linux:

```sh
./scripts/setup.sh    # install frozen dependencies and verify the toolchain
./scripts/doctor.sh   # verify Node/pnpm/Expo compatibility
./scripts/dev.sh      # start the Expo dev server (add --tunnel behind NAT)
```

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/) are required:

```
<type>(<optional scope>): <short summary>

<optional body>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`.
Versioning follows [semantic versioning](https://semver.org/).

## Branch and pull-request workflow

1. Sync `main`: `git fetch origin && git checkout main && git pull --ff-only origin main`.
2. Create a descriptive branch from `main`:
   - `feat/<issue-number>-<short-name>`
   - `fix/<issue-number>-<short-name>`
   - `chore/<issue-number>-<short-name>`
   - `docs/<issue-number>-<short-name>`
   - `test/<issue-number>-<short-name>`
3. Implement **only** that PR's documented scope. Keep unrelated changes separate.
4. Add or update tests and documentation in the same PR as the behavior change.
5. Run the local quality gate before pushing:

   ```sh
   pnpm format
   pnpm lint
   pnpm typecheck
   pnpm test
   ```

6. Push the branch and open a pull request referencing the issue.
7. Fix any CI failures on the same feature branch.
8. **PRs are merged only after CI is green, acceptance criteria are met, and
   review/approval is complete.** Merges are performed by a maintainer using
   **squash merge** for a clean history. Do not self-merge.

## Pull request content

Use the PR template. Every PR must document: linked issue, scope and non-goals,
tests and how to run them, CI status, manual verification steps,
compatibility considerations, screenshots for UI changes, documentation updates,
and outstanding limitations.

## What not to do

- Never push directly to `main` for feature work.
- Never rewrite or force-push shared history.
- Never commit secrets, credentials, or real task data.
- Never disable failing tests or bypass CI to make a PR green.
- Never claim manual/device verification that was not actually performed.
