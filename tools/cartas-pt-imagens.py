#!/usr/bin/env python3
"""Baixa imagens oficiais de cartas (TCGdex) a partir da base config/cartas/cartas-pt.json.gz.

Roda numa máquina com internet (não no sandbox do executor). Tenta a URL em português e, se der 404,
cai para a versão em inglês do mesmo arquivo. As imagens continuam © Pokémon/Nintendo/Creatures/GAME FREAK:
uso editorial com crédito, nunca redesenho.

Uso:
  python3 tools/cartas-pt-imagens.py 30th-023 me01-180 me02.5-284            # ids coleção-número
  python3 tools/cartas-pt-imagens.py --artista "Mitsuhiro Arita" --desde 2024  # todas de um ilustrador
  python3 tools/cartas-pt-imagens.py --colecao 30th --raridade "Pikachu Rare"
  python3 tools/cartas-pt-imagens.py --lista pauta.txt --saida assets/social/cartas
Opções: --saida (padrão assets/social/cartas), --so-urls (imprime as URLs e não baixa), --base <json.gz>.
"""
import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = 'config/cartas/cartas-pt.json.gz'
UA = 'tcg-price-hunter/cartas-pt-imagens (+https://tcgpricehunter.com.br)'


def carregar(caminho):
    with gzip.open(caminho, 'rt', encoding='utf-8') as f:
        return json.load(f)['cartas']


def nome_arquivo(c):
    nome = re.sub(r'[^a-z0-9]+', '-', (c['nome'] or c['nomeEn'] or 'carta').lower()).strip('-')
    return f"{c['colecao']}-{c['numero']}-{nome}.webp"


def selecionar(cartas, o):
    ids = set(o.ids)
    if o.lista:
        with open(o.lista, encoding='utf-8') as f:
            ids.update(l.strip() for l in f if l.strip() and not l.startswith('#'))
    sel = []
    for c in cartas:
        if ids and c['id'] in ids:
            sel.append(c)
            continue
        if o.artista and c['ilustrador'] != o.artista:
            continue
        if o.colecao and c['colecao'] != o.colecao:
            continue
        if o.raridade and c['raridade'] != o.raridade:
            continue
        if o.desde and (c['lancamento'] or '') < f'{o.desde}-01-01':
            continue
        if o.artista or o.colecao or o.raridade:
            sel.append(c)
    return sel


def baixar(url, destino):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r, open(destino, 'wb') as f:
        f.write(r.read())


def main(argv=None):
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('ids', nargs='*', help='ids no formato coleção-número (ex.: 30th-023)')
    a.add_argument('--lista', help='arquivo com um id por linha')
    a.add_argument('--artista')
    a.add_argument('--colecao')
    a.add_argument('--raridade')
    a.add_argument('--desde', type=int, help='ano mínimo de lançamento')
    a.add_argument('--saida', default='assets/social/cartas')
    a.add_argument('--base', default=BASE)
    a.add_argument('--so-urls', action='store_true')
    o = a.parse_args(argv)
    cartas = carregar(o.base)
    sel = selecionar(cartas, o)
    if not sel:
        print('cartas-pt-imagens: nada selecionado (confira os ids: coleção-número, ex. 30th-023)', file=sys.stderr)
        return 2
    if o.so_urls:
        for c in sel:
            print(c['id'], c['nome'], c['imagem'])
        return 0
    os.makedirs(o.saida, exist_ok=True)
    ok = falhas = 0
    creditos = []
    for c in sel:
        destino = os.path.join(o.saida, nome_arquivo(c))
        if os.path.exists(destino):
            ok += 1
            continue
        for url in (c['imagem'], c['imagemEn']):
            try:
                baixar(url, destino)
                ok += 1
                creditos.append(f"{nome_arquivo(c)}\t{c['nome']} · {c['colecaoNome']} {c['numero']} · ilustração: {c['ilustrador'] or '?'} · © Pokémon/Nintendo/Creatures/GAME FREAK · fonte: {url}")
                break
            except urllib.error.HTTPError as e:
                if e.code != 404:
                    print(f"  {c['id']}: HTTP {e.code} em {url}", file=sys.stderr)
            except (urllib.error.URLError, TimeoutError) as e:
                print(f"  {c['id']}: {e}", file=sys.stderr)
        else:
            falhas += 1
            print(f"  {c['id']} {c['nome']}: sem imagem em pt nem en", file=sys.stderr)
        time.sleep(0.2)  # gentileza com o CDN
    if creditos:
        with open(os.path.join(o.saida, 'CREDITOS.tsv'), 'a', encoding='utf-8') as f:
            f.write('\n'.join(creditos) + '\n')
    print(f'cartas-pt-imagens: {ok} ok, {falhas} sem imagem → {o.saida} (créditos em CREDITOS.tsv)')
    return 1 if falhas and not ok else 0


if __name__ == '__main__':
    sys.exit(main())
