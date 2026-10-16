#!/usr/bin/env python3
"""Base de cartas em português a partir do TCGdex (https://github.com/tcgdex/cards-database, MIT).

Gera config/cartas/cartas-pt.json.gz (toda carta FÍSICA com nome em PT: coleção, número, nome PT/EN, raridade,
ilustrador, tipos, Pokédex, participações, lançamento e URL da imagem em PT no assets.tcgdex.net) e
config/cartas/artistas-pt.json (ilustrador → cartas). Pokémon TCG Pocket (app) fica de fora. As imagens continuam
© Pokémon/Nintendo/Creatures/GAME FREAK: o post leva o crédito. Nada aqui gera ou altera arte.

Uso: python3 tools/cartas-pt-gerar.py --fonte <clone>/data --saida config/cartas
     python3 tools/cartas-pt-gerar.py --clonar /tmp/tcgdex --saida config/cartas     (git clone --depth 1 antes)
"""
import argparse
import collections
import csv
import gzip
import json
import os
import re
import subprocess
import sys
from datetime import date

REPO = 'https://github.com/tcgdex/cards-database'
SERIES_FORA = {'tcgp'}          # Pokémon TCG Pocket: jogo de celular, não é carta física
ASSETS = 'https://assets.tcgdex.net'


def campo(s, k):
    m = re.search(r'^\t' + k + r':\s*(.*?)(?:,\n|\n)', s, re.M | re.S)
    return m.group(1).strip() if m else None


def texto(v):
    if v is None:
        return None
    m = re.match(r'^(["\'])(.*)\1,?$', v.strip(), re.S)
    return m.group(2).replace('\\"', '"').replace("\\'", "'") if m else None


def nomes(s, chave='name'):
    m = re.search(r'^\t' + chave + r':\s*\{(.*?)^\t\}', s, re.M | re.S)
    out = {}
    if not m:
        return out
    for mm in re.finditer(r"""^\s*'?([a-z-]+)'?:\s*(["'])((?:\\.|(?!\2).)*)\2""", m.group(1), re.M):
        out[mm.group(1)] = mm.group(3).replace('\\"', '"').replace("\\'", "'")
    return out


def lista(v):
    return [x.strip().strip('"\'') for x in re.findall(r'[^\[\],]+', v or '') if x.strip()]


def inteiro(v):
    return int(v) if v and str(v).isdigit() else None


def ler(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def gerar(raiz):
    """Percorre data/<Série>.ts, data/<Série>/<Coleção>.ts e data/<Série>/<Coleção>/<nº>.ts."""
    series = {}
    for f in os.listdir(raiz):
        if f.endswith('.ts'):
            sid = texto(campo(ler(os.path.join(raiz, f)), 'id'))
            if sid:
                series[f[:-3]] = sid
    cartas = []
    for serie in sorted(series):
        d = os.path.join(raiz, serie)
        if not os.path.isdir(d) or series[serie] in SERIES_FORA:
            continue
        colecoes = {}
        for f in os.listdir(d):
            if f.endswith('.ts'):
                s = ler(os.path.join(d, f))
                colecoes[f[:-3]] = {'id': texto(campo(s, 'id')), 'nome': nomes(s), 'lancamento': texto(campo(s, 'releaseDate'))}
        for pasta in sorted(os.listdir(d)):
            col = colecoes.get(pasta)
            sd = os.path.join(d, pasta)
            if not col or not col['id'] or not os.path.isdir(sd):
                continue
            for cf in sorted(os.listdir(sd)):
                if not cf.endswith('.ts'):
                    continue
                s = ler(os.path.join(sd, cf))
                nm = nomes(s)
                if 'pt' not in nm and 'pt-br' not in nm:
                    continue
                num = cf[:-3]
                base = f"{series[serie]}/{col['id']}/{num}"
                cartas.append({
                    'id': f"{col['id']}-{num}", 'numero': num, 'colecao': col['id'],
                    'colecaoNome': col['nome'].get('pt') or col['nome'].get('en'), 'serie': series[serie],
                    'lancamento': col['lancamento'], 'nome': nm.get('pt-br') or nm.get('pt'), 'nomeEn': nm.get('en'),
                    'ilustrador': texto(campo(s, 'illustrator')), 'raridade': texto(campo(s, 'rarity')),
                    'categoria': texto(campo(s, 'category')), 'tipos': lista(campo(s, 'types')),
                    'dexId': [int(x) for x in lista(campo(s, 'dexId')) if x.isdigit()],
                    'cameos': [int(x) for x in lista(campo(s, 'cameoDexIds')) if x.isdigit()],
                    'hp': inteiro(campo(s, 'hp')), 'estagio': texto(campo(s, 'stage')), 'sufixo': texto(campo(s, 'suffix')),
                    'imagem': f"{ASSETS}/pt/{base}/high.webp", 'imagemEn': f"{ASSETS}/en/{base}/high.webp",
                })
    cartas.sort(key=lambda c: (c['lancamento'] or '', c['colecao'], c['numero']))
    por_artista = collections.defaultdict(list)
    for c in cartas:
        if c['ilustrador']:
            por_artista[c['ilustrador']].append(c['id'])
    artistas = [{'nome': a, 'cartas': len(v), 'ids': v} for a, v in sorted(por_artista.items(), key=lambda kv: (-len(kv[1]), kv[0]))]
    return cartas, artistas


def escrever(cartas, artistas, saida, csv_tambem=False):
    os.makedirs(saida, exist_ok=True)
    hoje = date.today().isoformat()
    meta = {'geradoEm': hoje, 'fonte': f'{REPO} (MIT); imagens © Pokémon/Nintendo/Creatures/GAME FREAK',
            'nota': 'Só cartas físicas com nome em português; Pokémon TCG Pocket excluído', 'total': len(cartas)}
    with gzip.open(os.path.join(saida, 'cartas-pt.json.gz'), 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump({**meta, 'cartas': cartas}, f, ensure_ascii=False)
    with open(os.path.join(saida, 'artistas-pt.json'), 'w', encoding='utf-8') as f:
        json.dump({'geradoEm': hoje, 'total': len(artistas), 'artistas': artistas}, f, ensure_ascii=False)
    if csv_tambem:
        with open(os.path.join(saida, 'cartas-pt.csv'), 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(['id', 'colecao', 'colecaoNome', 'numero', 'nome', 'nomeEn', 'raridade', 'ilustrador', 'tipos', 'dexId', 'cameos', 'lancamento', 'imagem'])
            for c in cartas:
                w.writerow([c['id'], c['colecao'], c['colecaoNome'], c['numero'], c['nome'], c['nomeEn'], c['raridade'], c['ilustrador'],
                            '|'.join(c['tipos']), '|'.join(map(str, c['dexId'])), '|'.join(map(str, c['cameos'])), c['lancamento'], c['imagem']])


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument('--fonte', help='pasta data/ de um clone do tcgdex/cards-database')
    a.add_argument('--clonar', help='clona (--depth 1) o repositório nesta pasta e usa data/ de lá')
    a.add_argument('--saida', default='config/cartas')
    a.add_argument('--csv', action='store_true', help='grava também cartas-pt.csv (para a equipe)')
    o = a.parse_args(argv)
    fonte = o.fonte
    if o.clonar:
        if not os.path.isdir(os.path.join(o.clonar, 'data')):
            subprocess.run(['git', 'clone', '--depth', '1', REPO, o.clonar], check=True)
        fonte = os.path.join(o.clonar, 'data')
    if not fonte or not os.path.isdir(fonte):
        print('cartas-pt: informe --fonte <clone>/data ou --clonar <pasta>', file=sys.stderr)
        return 2
    cartas, artistas = gerar(fonte)
    escrever(cartas, artistas, o.saida, o.csv)
    print(f'cartas-pt: {len(cartas)} cartas, {len(artistas)} ilustradores → {o.saida}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
