#!/usr/bin/env bash
# Publica a pasta data/ no ramo "data" (um commit só, reescrito). Usa GH_TOKEN.
set -e
D=$(mktemp -d)
cp -r data "$D/"
cd "$D"
git init -q -b data
git config user.name "price-hunter-bot"
git config user.email "bot@users.noreply.github.com"
git add data
git commit -qm "dados $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" data
