#!/usr/bin/env bash
# Maakt de schermafbeeldingen voor de rondleiding opnieuw: per taal (nl/en/pt) en thema (licht/donker) één uitsnede
# per stap, als WebP in apps/web/public/tour/<taal>-<thema>-<naam>.webp. Draai dit na elke UI-wijziging die in een
# stap te zien is (zie HANDOVER 6.12 en framework 15.3 punt 15). Werkt met Bun + Chrome + Playwright in de sandbox.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=/tmp/ppshot
OUT=/tmp/ppshot/tourshots
rm -rf "$OUT"; mkdir -p "$OUT" apps/web/public/tour
"${BUN:-/root/.bun/bin/bun}" build apps/web/src/main.ts --outdir "$ROOT/out" --target browser >/dev/null
sed 's#<script type="module" src="/src/main.ts"></script>#<link rel="stylesheet" href="/out/main.css"><script type="module" src="/out/main.js"></script>#' apps/web/index.html > "$ROOT/index.html"
for loc in nl-NL en-GB pt-PT; do
  for theme in light dark; do
    PP_LANG=$loc PP_SHOT_ROOT="$ROOT" PP_SHOT_OUT="$OUT" node tools/screenshot.cjs "$theme" tourshots
  done
done
python3 - "$OUT" apps/web/public/tour <<'PY'
import sys, os
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'): continue
    im = Image.open(os.path.join(src, f)).convert('RGB')
    w = 640
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(os.path.join(dst, f[:-4] + '.webp'), 'WEBP', quality=80, method=6)
print(len(os.listdir(dst)), 'afbeeldingen in', dst)
PY
