#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[clean] Resetting postgres-pglite working tree..."
cd "$ROOT_DIR/postgres-pglite"
git reset --hard
git clean -fdx
git submodule sync --recursive
git submodule update --init --recursive

echo "[clean] Removing pglite build/test outputs..."
cd "$ROOT_DIR"
rm -rf \
  packages/pglite/dist \
  packages/pglite/release \
  packages/pglite/pgdata-test \
  packages/pglite-tools/release \
  /tmp/extensions/build

echo "[clean] Done. Rebuild with: pnpm build:all"
