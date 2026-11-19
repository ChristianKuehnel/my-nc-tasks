#!/usr/bin/env sh
# test.sh — run the full local quality gate (format check, lint, typecheck, tests).
#
# Usage: ./scripts/test.sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Local quality gate"
pnpm check

echo ""
echo "Quality gate passed."
