#!/usr/bin/env python3
"""Acervo de fotos dos produtos para os cards sociais (#690).

Para cada produto do state.json: baixa a foto oficial do produto (campo `image`; se falhar, a foto de uma oferta),
recorta o fundo com rembg (modelo isnet-general-use) e salva <productId>.webp com transparência, até 900 px.
A foto é a REAL da loja: só o fundo sai; a embalagem não é gerada nem redesenhada.
Gera também folhas de contato (contato-NN.jpg) para revisão humana e manifesto.json.

Uso: python3 tools/social-acervo.py --state data/state.json --saida acervo/ [--limite N] [--so id1,id2]
"""
import argparse
import io
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageFont

LADO_MAX = 900
UA = 'Mozilla/5.0 (compatible; TCGPriceHunterBot/1.0; +https://tcg-price-hunter.vercel.app)'


def baixar(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'image/*'})
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status != 200:
            raise RuntimeError(f'HTTP {r.status}')
        return Image.open(io.BytesIO(r.read()))


def candidatos(prod, ofertas):
    vistos = []
    for u in [prod.get('image')] + [o.get('image') for o in ofertas if o.get('productId') == prod['id']]:
        if isinstance(u, str) and u.startswith('https://') and u not in vistos:
            vistos.append(u)
    return vistos[:4]


def recortar(img, sessao, remove):
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        rgba = img.convert('RGBA')
        a = rgba.getchannel('A')
        if a.getextrema()[0] < 250:          # já vem com fundo transparente (render oficial): usa como está
            return rgba
    return remove(img.convert('RGB'), session=sessao)


def folhas(itens, pasta):
    fonte = ImageFont.load_default()
    por, cel = 30, 200
    for n in range(0, len(itens), por):
        lote = itens[n:n + por]
        folha = Image.new('RGB', (6 * cel, 5 * (cel + 20)), (40, 40, 40))
        for i, (pid, arq) in enumerate(lote):
            x, y = (i % 6) * cel, (i // 6) * (cel + 20)
            fundo = Image.new('RGBA', (cel, cel), (255, 0, 255, 255))   # magenta: falhas do recorte saltam aos olhos
            if arq:
                im = Image.open(arq).convert('RGBA')
                im.thumbnail((cel - 10, cel - 10))
                fundo.alpha_composite(im, ((cel - im.width) // 2, (cel - im.height) // 2))
            folha.paste(fundo.convert('RGB'), (x, y))
            ImageDraw.Draw(folha).text((x + 4, y + cel + 4), pid[:30], fill=(255, 255, 255), font=fonte)
        folha.save(os.path.join(pasta, f'contato-{n // por + 1:02d}.jpg'), quality=85)


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument('--state', required=True)
    a.add_argument('--saida', required=True)
    a.add_argument('--limite', type=int, default=0)
    a.add_argument('--so', default='')
    o = a.parse_args(argv)
    from rembg import new_session, remove
    sessao = new_session('isnet-general-use')
    st = json.load(open(o.state, encoding='utf-8'))
    prods = st.get('products', [])
    if o.so:
        ids = set(o.so.split(','))
        prods = [p for p in prods if p['id'] in ids]
    if o.limite:
        prods = prods[:o.limite]
    os.makedirs(o.saida, exist_ok=True)
    manifesto, itens = [], []
    for p in prods:
        reg = {'id': p['id'], 'nome': p.get('name'), 'fonte': None, 'erro': None}
        for url in candidatos(p, st.get('offers', [])):
            try:
                rec = recortar(baixar(url), sessao, remove)
                caixa = rec.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
                if not caixa:
                    raise RuntimeError('recorte vazio')
                rec = rec.crop(caixa)
                rec.thumbnail((LADO_MAX, LADO_MAX), Image.LANCZOS)
                arq = os.path.join(o.saida, f"{p['id']}.webp")
                rec.save(arq, 'WEBP', quality=90, method=6)
                reg['fonte'] = url
                reg['erro'] = None
                itens.append((p['id'], arq))
                break
            except Exception as e:  # noqa: BLE001 — tenta a próxima foto
                reg['erro'] = f'{type(e).__name__}: {e}'[:200]
        if not reg['fonte']:
            itens.append((p['id'], None))
        manifesto.append(reg)
        print(f"{'ok ' if reg['fonte'] else 'ERR'} {p['id']}", flush=True)
    json.dump(manifesto, open(os.path.join(o.saida, 'manifesto.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    folhas(itens, o.saida)
    ok = sum(1 for m in manifesto if m['fonte'])
    print(f'{ok}/{len(manifesto)} produtos com foto recortada')
    return 0


if __name__ == '__main__':
    sys.exit(main())
