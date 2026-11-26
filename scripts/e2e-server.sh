#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${E2E_DATA_DIR:-$ROOT/.e2e-data}"
PORT="${E2E_PORT:-18090}"

rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

if [[ ! -f "$ROOT/apps/web/dist/index.html" ]]; then
  echo "需要先构建前端：pnpm --filter @opsvault/web build" >&2
  exit 1
fi

cd "$ROOT/apps/server"
DATA_DIR="$DATA_DIR" PORT="$PORT" BASE_URL="http://127.0.0.1:$PORT" LOG_LEVEL=warn \
  exec pnpm exec tsx src/main.ts
