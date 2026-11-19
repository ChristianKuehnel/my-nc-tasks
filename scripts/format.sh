#!/usr/bin/env sh
# format.sh — automatic repository-wide formatting.
#
# Usage:
#   ./scripts/format.sh          # format all tracked source files
#   ./scripts/format.sh --check  # fail on unformatted files (used by CI)
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -x node_modules/.bin/prettier ]; then
  echo "Prettier is not installed. Run ./scripts/setup.sh first." >&2
  exit 1
fi

case "${1:-}" in
--check)
  node_modules/.bin/prettier --check .
  ;;
"")
  node_modules/.bin/prettier --write .
  ;;
*)
  echo "Usage: ./scripts/format.sh [--check]" >&2
  exit 1
  ;;
esac
