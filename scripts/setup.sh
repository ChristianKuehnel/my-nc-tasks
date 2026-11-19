#!/usr/bin/env sh
# setup.sh — provision the development environment and install frozen
# dependencies. Idempotent: safe to run multiple times.
#
# Usage: ./scripts/setup.sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Make sure the user-level bin directory (Corepack shims, uv, ...) is on PATH.
case ":$PATH:" in
*":$HOME/.local/bin:"*) ;;
*) PATH="$HOME/.local/bin:$PATH"; export PATH ;;
esac

echo "==> my-nc-tasks: setup"

# ---------------------------------------------------------------- OS/arch
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
Linux | Darwin) ;;
*)
  echo "ERROR: unsupported operating system '$OS' (expected Linux or Darwin)." >&2
  exit 1
  ;;
esac
echo "    OS: $OS / $ARCH"

# ---------------------------------------------------------------- Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed." >&2
  echo "       Install Node.js $(cat .node-version) (LTS 22.x) via your package manager," >&2
  echo "       nvm, or mise (see docs/development.md for details)." >&2
  exit 1
fi
NODE_VERSION="$(node -p 'process.versions.node')"
NODE_PIN="$(cat .node-version)"
node -e '
const [maj, min] = process.versions.node.split(".").map(Number);
const ok = (maj === 22 && min >= 13) || (maj === 24 && min >= 3) || maj >= 26;
if (!ok) {
  console.error("ERROR: Node.js " + process.versions.node + " is not supported by Expo SDK 58.");
  console.error("       Required: >=22.13 on the 22 line, >=24.3 on the 24 line, or >=26.");
  process.exit(1);
}
'
echo "    Node.js: $NODE_VERSION (pinned: $NODE_PIN)"
if [ "$NODE_VERSION" != "$NODE_PIN" ]; then
  echo "    NOTE: local Node ($NODE_VERSION) differs from the pinned version ($NODE_PIN)."
  echo "          CI always uses the pinned version; results may differ locally."
fi

# ---------------------------------------------------------------- pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "    pnpm not found; enabling the Corepack shim in ~/.local/bin ..."
    corepack enable --install-directory "$HOME/.local/bin" 2>/dev/null \
      || corepack enable
    case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *)
      export PATH="$HOME/.local/bin:$PATH"
      echo "    NOTE: add \$HOME/.local/bin to your PATH to use pnpm directly."
      ;;
    esac
  else
    echo "ERROR: pnpm is not installed and corepack is unavailable." >&2
    echo "       Install Node.js >= 22 (ships with corepack) or pnpm via mise." >&2
    exit 1
  fi
fi
PINNED_PNPM="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if ! PNPM_VERSION="$(pnpm -v 2>&1)"; then
  echo "ERROR: pnpm failed to start: $PNPM_VERSION" >&2
  echo "       The Corepack bundled with this Node may be too old for the pinned pnpm." >&2
  echo "       Install a newer Corepack without root:" >&2
  echo "         npm install -g --prefix \$HOME/.local corepack@0.36.0" >&2
  exit 1
fi
echo "    pnpm: $PNPM_VERSION (pinned: $PINNED_PNPM)"
if [ "$PNPM_VERSION" != "$PINNED_PNPM" ]; then
  echo "    NOTE: pnpm version differs from the packageManager pin. Use the"
  echo "          Corepack shim (corepack enable) or mise to match the pin."
fi

# ---------------------------------------------------------------- deps
echo "==> Installing dependencies (frozen lockfile when present)"
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
else
  # First run: no lockfile yet. Disable frozen mode explicitly because pnpm
  # enables it by default in headless (non-TTY) environments.
  pnpm install --no-frozen-lockfile
fi

# ---------------------------------------------------------------- verify
echo "==> Verifying Expo project"
EXPO_VERSION="$(pnpm exec expo --version 2>/dev/null || echo 'unavailable')"
echo "    expo CLI: $EXPO_VERSION"

echo ""
echo "Setup complete. Next steps:"
echo "  ./scripts/doctor.sh   # full environment diagnostics"
echo "  ./scripts/dev.sh      # start the Expo dev server"
echo "  pnpm typecheck        # TypeScript strict checking"
echo ""
echo "To run on an iPhone: install 'Expo Go' (58.x) from the App Store, then"
echo "scan the QR code printed by the dev server (see docs/development.md)."
