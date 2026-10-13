#!/usr/bin/env bash
# Publica a pasta data/ no ramo "data" (um commit só, reescrito). Usa GH_TOKEN.
set -e
# Recusa publicar dados vazios/inválidos: o push -f reescreve o ramo "data" inteiro.
node -e 'const s=JSON.parse(require("fs").readFileSync("data/state.json","utf8"));if(!s||!s.offers||!s.generatedAt)process.exit(1)' 2>/dev/null || { echo "push-data: data/state.json ausente ou sem offers/generatedAt; nada publicado" >&2; exit 1; }
D=$(mktemp -d)
cp -r data "$D/"
cd "$D"
git init -q -b data
git config user.name "price-hunter-bot"
git config user.email "bot@users.noreply.github.com"
git add data
git commit -qm "dados $(date -u +%Y-%m-%dT%H:%MZ)"
# PUSH_DATA_REMOTE (opcional) substitui o remoto; usado nos testes com repositório bare local.
git push -q -f "${PUSH_DATA_REMOTE:-https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git}" data
