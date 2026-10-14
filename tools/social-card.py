#!/usr/bin/env python3
"""Card do Telegram (#690): foto REAL do produto, recortada do fundo branco, em pé sobre a mesa do fundo fixo.

Nunca gera, redesenha nem altera a embalagem: só recorta o fundo branco da foto da loja, redimensiona e aplica sombra.
Sem texto na imagem (preços vão na legenda). Saída JPEG 1080x1080.

Uso: python3 tools/social-card.py --foto produto.jpg --saida card.jpg [--fundo assets/social/fundo-mesa.jpg]
Saída 0 = card gerado; 3 = foto sem fundo branco recortável (quem chama envia a foto original); 1 = erro.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

LADO = 1080
ALTURA = 0.76        # altura do produto em fração do card
BASE = 930           # linha (y) onde o produto toca a mesa
LARGURA_MAX = 0.80   # largura máxima do produto (caixas largas)
BRANCO = 238         # limiar do fundo "quase branco"
FUNDO_PADRAO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'social', 'fundo-mesa.jpg')


def mascara(foto):
    """Alfa do produto: o branco ligado às bordas vira transparente (flood fill a partir de uma moldura branca)."""
    w, h = foto.size
    claro = foto.convert('L').point(lambda v: 255 if v > BRANCO else 0)
    # o canal L mistura cores; exige também que nenhum canal RGB esteja abaixo do limiar
    r, g, b = foto.split()
    for c in (r, g, b):
        claro = Image.composite(claro, Image.new('L', (w, h), 0), c.point(lambda v: 255 if v > BRANCO else 0))
    moldura = Image.new('L', (w + 2, h + 2), 255)
    moldura.paste(claro, (1, 1))
    ImageDraw.floodfill(moldura, (0, 0), 128)
    fundo = moldura.crop((1, 1, w + 1, h + 1)).point(lambda v: 255 if v == 128 else 0)
    return fundo.point(lambda v: 255 - v)


def sem_rodape(alfa):
    """Corta legenda solta no pé da foto ("imagens meramente ilustrativas"): faixa vazia no último quarto separa o texto."""
    w, h = alfa.size
    linhas = [alfa.crop((0, y, w, y + 1)).getbbox() is not None for y in range(h)]
    ultimo = max((y for y, cheia in enumerate(linhas) if cheia), default=0)
    y = ultimo
    while y > h * 0.75:
        if not linhas[y]:
            fim = y
            while fim > 0 and not linhas[fim]:
                fim -= 1
            if y - fim >= 6:            # faixa vazia de pelo menos 6 px
                return fim + 1
            y = fim
        y -= 1
    return h


def so_produto(alfa, fracao=0.5):
    """Mantém só o produto: o maior bloco recortado e os que tiverem pelo menos `fracao` da área dele (kits com
    duas caixas). Logos, selos e textos soltos ao lado da foto (ex.: logo da coleção) saem. Rotulagem numa versão
    reduzida da máscara, ampliada de volta e cruzada com a máscara original (borda continua precisa)."""
    w, h = alfa.size
    k = max(1, max(w, h) // 240)
    peq = alfa.resize((max(1, w // k), max(1, h // k)), Image.NEAREST).point(lambda v: 255 if v > 127 else 0)
    pw, ph = peq.size
    px = peq.load()
    areas = {}
    rotulo = 1
    for y in range(ph):
        for x in range(pw):
            if px[x, y] == 255:
                if rotulo > 250:                       # ruído demais: não arrisca, mantém a máscara inteira
                    return alfa
                ImageDraw.floodfill(peq, (x, y), rotulo)
                rotulo += 1
    hist = peq.histogram()
    areas = {r: hist[r] for r in range(1, rotulo)}
    if len(areas) <= 1:
        return alfa
    maior = max(areas.values())
    manter = {r for r, a in areas.items() if a >= maior * fracao}
    sel = peq.point(lambda v: 255 if v in manter else 0).resize((w, h), Image.NEAREST).filter(ImageFilter.MaxFilter(2 * k + 1))
    return Image.composite(alfa, Image.new('L', (w, h), 0), sel)


def gerar(foto_path, saida, fundo_path=FUNDO_PADRAO):
    fundo = Image.open(fundo_path).convert('RGB').resize((LADO, LADO), Image.LANCZOS)
    foto = Image.open(foto_path).convert('RGB')
    alfa = mascara(foto)
    w, h = foto.size
    removido = 1 - sum(alfa.histogram()[128:]) / (w * h)
    if removido < 0.08:
        return 3                         # foto ambientada/sem fundo branco: não recorta, quem chama usa a original
    corte = sem_rodape(alfa)
    alfa = alfa.crop((0, 0, w, corte)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
    foto = foto.crop((0, 0, w, corte))
    alfa = so_produto(alfa)
    caixa = alfa.getbbox()
    if not caixa:
        return 3
    prod = foto.crop(caixa)
    prod.putalpha(alfa.crop(caixa))
    escala = min(LADO * ALTURA / prod.height, LADO * LARGURA_MAX / prod.width)
    prod = prod.resize((max(1, round(prod.width * escala)), max(1, round(prod.height * escala))), Image.LANCZOS)
    cx = LADO // 2
    sombra = Image.new('L', (LADO, LADO), 0)
    ImageDraw.Draw(sombra).ellipse((cx - prod.width * 0.55, BASE - 18, cx + prod.width * 0.55, BASE + 22), fill=150)
    sombra = sombra.filter(ImageFilter.GaussianBlur(16))
    fundo.paste(Image.new('RGB', (LADO, LADO), (30, 18, 8)), (0, 0), sombra)
    fundo.paste(prod, (cx - prod.width // 2, BASE - prod.height), prod)
    fundo.save(saida, 'JPEG', quality=90)
    return 0


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument('--foto', required=True)
    a.add_argument('--saida', required=True)
    a.add_argument('--fundo', default=FUNDO_PADRAO)
    o = a.parse_args(argv)
    try:
        return gerar(o.foto, o.saida, o.fundo)
    except Exception as e:  # noqa: BLE001 — erro vira código 1 com mensagem curta
        print(f'card: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
