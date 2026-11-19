#!/usr/bin/env sh
# doctor.sh — print actionable diagnostics for the development environment.
# Exits non-zero when a required check fails.
#
# Usage: ./scripts/doctor.sh
set -u

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Make sure the user-level bin directory (Corepack shims, uv, ...) is on PATH.
case ":$PATH:" in
*":$HOME/.local/bin:"*) ;;
*) PATH="$HOME/.local/bin:$PATH"; export PATH ;;
esac

FAILURES=0

pass() { echo "  [PASS] $1"; }
warn() { echo "  [WARN] $1"; }
fail() { echo "  [FAIL] $1"; FAILURES=$((FAILURES + 1)); }
info() { echo "  [INFO] $1"; }

echo "==> my-nc-tasks: doctor"
echo ""

# ---------------------------------------------------------------- Node.js
echo "Node.js"
NODE_PIN="$(cat .node-version 2>/dev/null || echo unknown)"
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -p 'process.versions.node')"
  pass "Node.js $NODE_VERSION is installed"
  if [ "$NODE_VERSION" = "$NODE_PIN" ]; then
    pass "matches pinned version $NODE_PIN"
  else
    warn "version $NODE_VERSION differs from pinned $NODE_PIN (CI uses the pinned version)"
  fi
  if node -e '
const [maj, min] = process.versions.node.split(".").map(Number);
const ok = (maj === 22 && min >= 13) || (maj === 24 && min >= 3) || maj >= 26;
process.exit(ok ? 0 : 1);
'; then
    pass "version is supported by Expo SDK 58 (>=22.13 / >=24.3 / >=26)"
  else
    fail "version is NOT supported by Expo SDK 58 (needs >=22.13 on 22.x, >=24.3 on 24.x, or >=26)"
  fi
else
  fail "Node.js is not installed (required: $NODE_PIN)"
fi

# ---------------------------------------------------------------- pnpm
echo ""
echo "pnpm"
PINNED_PNPM="$(node -p "require('./package.json').packageManager.split('@')[1]" 2>/dev/null || echo unknown)"
if command -v pnpm >/dev/null 2>&1; then
  if ! PNPM_VERSION="$(pnpm -v 2>&1)"; then
    fail "pnpm is on PATH but fails to start: $PNPM_VERSION"
    fail "fix: the bundled Corepack is too old for the pinned pnpm — npm install -g --prefix \$HOME/.local corepack@0.36.0"
    PNPM_VERSION="unknown"
  fi
  if [ "$PNPM_VERSION" != "unknown" ]; then
    pass "pnpm $PNPM_VERSION is available"
  fi
  if [ "$PNPM_VERSION" = "$PINNED_PNPM" ]; then
    pass "matches pinned version $PINNED_PNPM (packageManager field)"
  else
    warn "version differs from pin $PINNED_PNPM — run 'corepack enable' or 'mise install' to match"
  fi
else
  if command -v corepack >/dev/null 2>&1; then
    warn "pnpm not on PATH, but corepack is available — run: corepack enable (or corepack enable --install-directory \$HOME/.local/bin)"
  else
    fail "pnpm is not available and corepack is missing (install Node.js >= 22 or mise)"
  fi
fi
if [ -f pnpm-lock.yaml ]; then
  pass "pnpm-lock.yaml is committed"
else
  fail "pnpm-lock.yaml is missing — run 'pnpm install' and commit the lockfile"
fi

# ---------------------------------------------------------------- Expo
echo ""
echo "Expo project"
if [ -f app.json ] && [ -f package.json ]; then
  EXPO_DEP="$(node -p "require('./package.json').dependencies.expo || 'missing'" 2>/dev/null)"
  pass "app.json and package.json present (expo dependency: $EXPO_DEP)"
else
  fail "app.json or package.json is missing"
fi
if [ -d node_modules/expo ]; then
  pass "dependencies installed (node_modules/expo present)"
else
  warn "dependencies not installed — run ./scripts/setup.sh"
fi

# ---------------------------------------------------------------- network
echo ""
echo "Network"
if curl -fsS --max-time 5 -o /dev/null https://registry.npmjs.org/ 2>/dev/null; then
  pass "npm registry is reachable"
else
  warn "npm registry is not reachable (offline mode? dependency installation will fail)"
fi

# ---------------------------------------------------------------- optional: GitHub CLI
echo ""
echo "Optional tooling"
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    GH_USER="$(gh api user --jq '.login' 2>/dev/null || echo unknown)"
    pass "GitHub CLI installed and authenticated as $GH_USER"
  else
    warn "GitHub CLI installed but not authenticated (gh auth login)"
  fi
else
  info "GitHub CLI not installed (optional; needed for PR workflow)"
fi

# ---------------------------------------------------------------- optional: EAS
echo ""
if [ -f eas.json ]; then
  pass "eas.json present"
  if command -v eas >/dev/null 2>&1 || pnpm exec eas --version >/dev/null 2>&1; then
    pass "EAS CLI available"
  else
    info "EAS CLI not installed yet (pnpm dlx eas-cli --version to test without installing)"
  fi
  if [ -n "${EXPO_TOKEN:-}" ]; then
    warn "EXPO_TOKEN is set in the environment (do not commit or log it)"
  else
    info "EXPO_TOKEN is not set (required only for EAS builds, see Phase 0.6)"
  fi
else
  info "eas.json not present yet (added in Phase 0.6)"
fi

# ---------------------------------------------------------------- env files
if [ -f .env ]; then
  warn ".env present (local values only — never commit it)"
else
  info ".env not present (optional; see .env.example)"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "doctor: $FAILURES required check(s) failed."
  exit 1
fi
echo "doctor: all required checks passed."
