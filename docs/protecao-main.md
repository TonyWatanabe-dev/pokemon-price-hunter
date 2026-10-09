# Proteção do ramo main

O código deste lote não muda nenhuma configuração do repositório. Os passos abaixo são feitos pelo dono, no GitHub.

## Quem escreve em cada ramo hoje

| Ramo | Quem escreve | Como |
|---|---|---|
| `main` | pessoas | push direto |
| `main` | robô (`hunter.yml`, passo "Salvar configuração (se mudou)") | commit só de `config/` + `tools/push-config.sh` (rebase, **sem** force push) |
| `data` | robô e `ml-auth.yml` (`tools/push-data.sh`) | **force push** (um commit só, reescrito a cada rodada) |
| `diag` | `diag.yml` | force push |
| `logos` | `logos.yml` | force push |
| `db-validation` | `db-validate.yml` | force push |

Consequência: uma regra que bloqueie force push precisa valer **só para o `main`**. Se valer para todos os ramos, o robô para de publicar os dados.

## Ruleset recomendado (só `main`)

| Regra | Liga? | Por quê |
|---|---|---|
| Restrict deletions | **sim** | ninguém apaga o `main` por engano |
| Block force pushes | **sim** | ninguém reescreve o histórico do `main`; o robô não usa force push no `main` |
| Require linear history | **sim** | o robô já publica com rebase (histórico linear); impede commit de merge no `main` |
| Require a pull request before merging | **não, por enquanto** | o robô grava `config/` direto no `main` com o `GITHUB_TOKEN`, e o `GITHUB_TOKEN` não consegue ser ator de bypass de forma confiável. Com essa regra ligada, o passo "Salvar configuração" falharia todo dia |
| Require status checks | não | não há CI de PR hoje; ligar sem CI só bloquearia pushes |
| Require signed commits | não | os commits do robô (`git push` com `GITHUB_TOKEN`) não são assinados |

### Passos no GitHub

1. Repositório → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name**: `main protegido`.
3. **Enforcement status**: **Active**.
4. **Bypass list**: deixe vazia. Se quiser uma saída de emergência, adicione **Repository admin**. Cada uso fica registrado no histórico do ruleset.
5. **Target branches** → **Add target** → **Include default branch**. Confira que aparece só o `main`; não use `All branches`.
6. Em **Rules**, marque só:
   - **Restrict deletions**
   - **Require linear history**
   - **Block force pushes**
7. Deixe desmarcadas todas as outras regras, em especial **Require a pull request before merging**, **Require status checks to pass**, **Require signed commits** e **Restrict updates**.
8. **Create**.

### Conferir depois de criar

- Na próxima rodada diária (`17 9 * * *` UTC), o passo **Salvar configuração (se mudou)** termina verde. Se nada mudou em `config/`, o log diz "config/: sem mudança".
- As rodadas a cada 15 min continuam publicando o ramo `data` (passo **Salvar dados (ramo data)** verde).
- Um `git push --force origin main` local deve ser recusado.
- Se um PR for aceito pela interface, use **Squash and merge** ou **Rebase and merge**. **Create a merge commit** fica bloqueado pelo histórico linear.

### Reverter

**Settings** → **Rules** → **Rulesets** → `main protegido`: mude **Enforcement status** para **Disabled**, ou apague o ruleset.

## Conflito entre pessoa e robô em `config/`

Desde o Lote 6, o robô não sobrescreve mais edições humanas. Até então, o workflow usava `git pull --rebase -X theirs`: num conflito, a versão do robô vencia em silêncio. Agora `tools/push-config.sh` funciona assim:

- **Rebase limpo**: publica normalmente. Isso inclui uma pessoa ter mudado outro arquivo, ou outro trecho do mesmo arquivo, durante a rodada.
- **Conflito**:
  - aborta o rebase;
  - **não publica** a mudança do robô e deixa a edição humana intacta;
  - mostra um `::warning::` com os nomes dos arquivos em conflito (sem conteúdo);
  - termina com sucesso, porque os dados já foram publicados no ramo `data`.

**A mudança descartada é refeita na rodada diária seguinte.** Só dois trechos do robô escrevem em `config/`, ambos no gatilho diário, e cada um lê o `config/` que estiver no `main` naquele momento:

- **`src/copag-check.js`**: regrava `config/catalog.json → copag.<id>.last_check` de todos os produtos com preço Copag oficial e não manual. É refeito por inteiro todo dia.
- **`src/discover.js`**: acrescenta lojas novas a `config/stores.json`. A loja descartada volta na próxima descoberta, desde que a busca a encontre de novo e a pessoa não a tenha cadastrado. Como não é garantido que a busca a encontre outra vez, o aviso no log é o sinal para conferir à mão.

As rodadas a cada 15 min não mudam `config/` (`src/run.js` só lê `config/`).

## Opção futura: tirar o robô do `main`

Para poder exigir PR no `main`, o robô precisa deixar de escrever nele:

1. **Mover os resultados da descoberta e da verificação Copag para o ramo `data`**: por exemplo `data/discovered-stores.json` e `data/copag-check.json`. Assim o `config/` passa a ser só humano. Exige mudar `src/discover.js`, `src/copag-check.js` e a leitura em `src/run.js`, que precisaria juntar `config/stores.json` com as lojas descobertas.
2. **Ou** fazer o robô abrir um PR (ramo `robo/config`) em vez de dar push. Exige `pull-requests: write` e alguém aprovando todo dia.

Com a opção 1 pronta, dá para ligar **Require a pull request before merging** no ruleset acima sem quebrar o robô.
