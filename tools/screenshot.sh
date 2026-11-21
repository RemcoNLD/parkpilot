#!/usr/bin/env bash
# Gebruik: [PP_LANG=en-US] bash tools/screenshot.sh [dark|light] [settings|history|main|lang|queue|game|tour|help|issues] (issues: met PP_RICH=1)
# Bouwt de app met Bun (zonder vite/npm install) en maakt screenshots met Chrome + Playwright, met nepdata.
# Werkte in de Claude-sandbox van 21 nov 2026 (bun in /root/.bun/bin, chrome in /usr/bin, playwright in /opt/npm-tools).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=/tmp/ppshot
mkdir -p "$ROOT"
"${BUN:-/root/.bun/bin/bun}" build apps/web/src/main.ts --outdir "$ROOT/out" --target browser >/dev/null
sed 's#<script type="module" src="/src/main.ts"></script>#<link rel="stylesheet" href="/out/main.css"><script type="module" src="/out/main.js"></script>#' apps/web/index.html > "$ROOT/index.html"
PP_SHOT_ROOT="$ROOT" node tools/screenshot.cjs "${1:-dark}" "${2:-settings}"
ls "${PP_SHOT_OUT:-$ROOT/shots}"
