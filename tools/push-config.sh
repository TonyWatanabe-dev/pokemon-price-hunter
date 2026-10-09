#!/usr/bin/env bash
# Publica no main as mudanças que o robô fez em config/ (Lote 6 — Segurança). Uso: bash tools/push-config.sh [remoto] [ramo]
#
# Quem escreve em config/ no robô: src/discover.js (lojas novas em config/stores.json) e src/copag-check.js
# (config/catalog.json → copag.<id>.last_check), ambos só no gatilho diário. As duas escritas são refeitas a partir
# do zero na rodada diária seguinte, lendo o config/ que estiver no main naquele momento.
#
# Antes (até o Lote 5): `git pull --rebase -X theirs` — num conflito, a versão do robô vencia em silêncio e podia
# apagar uma edição humana feita em config/ durante a rodada. Agora:
#  - sem mudança em config/ → sai 0 sem commit;
#  - rebase limpo (inclusive edição humana em OUTRO arquivo ou em outro trecho) → push;
#  - CONFLITO → `git rebase --abort`, a mudança do robô NÃO é publicada, a edição humana fica intacta,
#    `::warning::` com os arquivos em conflito (só nomes, nada de conteúdo) e sai 0 (os dados já foram publicados);
#  - falha de rede/push → tenta 3 vezes; persistindo, sai 1 (a rodada fica vermelha, como antes).
set -u
REMOTE="${1:-origin}"
BRANCH="${2:-main}"

git add config
if git diff --cached --quiet; then echo "config/: sem mudança."; exit 0; fi
git commit -qm "config $(date -u +%Y-%m-%dT%H:%MZ)"

rebasing() { [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; }

for i in 1 2 3; do
  if git pull -q --rebase --no-autostash "$REMOTE" "$BRANCH"; then
    if git push -q "$REMOTE" "HEAD:$BRANCH"; then echo "config/: publicada no $BRANCH."; exit 0; fi
  elif rebasing; then
    files=$(git diff --name-only --diff-filter=U | tr '\n' ' ')
    git rebase --abort
    echo "::warning::config/ mudou no $BRANCH durante a rodada e conflita com a mudança do robô (${files% }). A edição humana foi mantida; a mudança do robô foi descartada e será refeita na próxima rodada diária."
    exit 0
  fi
  sleep "${PUSH_CONFIG_RETRY_SEC:-5}"
done
echo "::error::não foi possível publicar config/ no $BRANCH depois de 3 tentativas."
exit 1
