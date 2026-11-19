#!/usr/bin/env sh
# dev.sh — start the Expo dev server (Metro).
#
# Usage:
#   ./scripts/dev.sh           # LAN mode (iPhone must be on the same network)
#   ./scripts/dev.sh --tunnel  # tunnel mode (works across networks; slower)
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

case "${1:-}" in
--tunnel)
  exec pnpm exec expo start --tunnel
  ;;
"")
  exec pnpm exec expo start
  ;;
*)
  echo "Usage: ./scripts/dev.sh [--tunnel]" >&2
  exit 1
  ;;
esac
