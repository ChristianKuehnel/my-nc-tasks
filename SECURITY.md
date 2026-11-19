# Security policy

## Scope

This policy covers security vulnerabilities in the `my-nc-tasks` codebase
(iOS app, tooling, and documentation).

## Supported versions

The current stable release line. See the release notes for the version you use.

## Reporting a vulnerability

**Do not report security issues through public GitHub issues.**

Please report security vulnerabilities:

1. Via GitHub's private vulnerability reporting:
   <https://github.com/ChristianKuehnel/my-nc-tasks/security/advisories/new>, or
2. By email to the project maintainer (see repository settings), clearly
   marked as a security report.

We aim to acknowledge receipt within 2 business days and to provide a remediation
timeline within 14 days.

## What to include

- A description of the vulnerability and its impact.
- Steps to reproduce or a proof of concept (without exposing real credentials).
- Affected versions and, if known, fixed versions.

## Security practices in this project

- HTTPS is required for all production communication with Nextcloud servers.
- Credentials are stored with `expo-secure-store` (device keychain), never in
  plain storage, logs, or fixtures.
- No telemetry by default.
- CI runs dependency and lockfile audits; Dependabot keeps dependencies current.
- Real Nextcloud integration credentials are never committed to the repository.
