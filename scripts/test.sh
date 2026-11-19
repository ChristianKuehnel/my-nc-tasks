#!/usr/bin/env sh
# test.sh — run the full local quality gate.
#
# Usage: ./scripts/test.sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Local quality gate"

# Use the aggregated 'check' script once Phase 0.3 adds it.
if node -e '
const s = require("./package.json").scripts || {};
process.exit(s.check ? 0 : 1);
'; then
  pnpm check
else
  # Phase 0.2 baseline gate: type checking + linting.
  # (The unit/component test runner is added in Phase 0.3.)
  echo "-- typecheck"
  pnpm typecheck
  echo "-- lint"
  pnpm lint
  echo "-- tests"
  if node -e '
const s = require("./package.json").scripts || {};
process.exit(s.test ? 0 : 1);
'; then
    pnpm test
  else
    echo "    (no test runner configured yet — added in Phase 0.3)"
  fi
fi

echo ""
echo "Quality gate passed."
