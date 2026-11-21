#!/usr/bin/env bash
# Typecheck + tests van de Worker, zonder npm install en zonder netwerk.
# Nodig: tsc (TypeScript) en Node 22+ (voor node:sqlite).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== typecheck worker"
tsc -p tools/tsconfig.worker.json
echo "== typecheck app (web)"
tsc -p tools/tsconfig.web.json
echo "== compileren voor tests"
rm -rf .test-build
tsc -p tools/tsconfig.test.json
echo '{"type":"commonjs"}' > .test-build/package.json
echo "== tests"
node --no-warnings tools/worker-test.cjs
