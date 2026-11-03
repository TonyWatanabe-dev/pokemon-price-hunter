#!/usr/bin/env python3
"""Card do Telegram (#690): foto REAL do produto, recortada do fundo branco, em pé sobre a mesa do fundo fixo.

Nunca gera, redesenha nem altera a embalagem: só recorta o fundo branco da foto da loja, redimensiona e aplica sombra.
Sem texto na imagem (preços vão na legenda). Saída JPEG 1080x1080.

Uso: python3 tools/social-card.py --foto produto.jpg --saida card.jpg [--fundo assets/social/fundo-mesa.jpg] [--tema blackfriday]

Tema blackfriday (campanha de 02/11/2026, pedido do dono): fundo preto com faixas vermelhas, selo "BLACK FRIDAY" no topo e o
logo oficial embaixo; o produto continua a foto real recortada. Foto sem fundo branco recortável entra inteira, numa
moldura branca (o card sai do mesmo jeito, para a oferta Black Friday sempre ter a arte própria). Sem preço na imagem.
Saída 0 = card gerado; 3 = foto sem fundo branco recortável (quem chama envia a foto original); 1 = erro.
"""
import argparse
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

LADO = 1080
ALTURA = 0.76        # altura do produto em fração do card
BASE = 930           # linha (y) onde o produto toca a mesa
LARGURA_MAX = 0.80   # largura máxima do produto (caixas largas)
BRANCO = 238         # limiar do fundo "quase branco"
RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONTE = os.path.join(RAIZ, 'assets', 'social', 'fontes', 'rubik-variavel.ttf')   # Rubik (OFL), eixo de peso 300–900
LOGO = os.path.join(RAIZ, 'tools', 'logo.webp')                                   # logo horizontal oficial
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


_sessao = None


def mascara_ia(foto):
    """Máscara binária do produto pela IA (rembg, isnet-general-use), ou None se o rembg não estiver instalado."""
    global _sessao
    try:
        from rembg import new_session, remove
    except ImportError:
        return None
    if _sessao is None:
        _sessao = new_session('isnet-general-use')
    return remove(foto, session=_sessao).getchannel('A').point(lambda v: 255 if v > 128 else 0)


def gerar(foto_path, saida, fundo_path=FUNDO_PADRAO, tema=None):
    bf = tema == 'blackfriday'
    fundo = fundo_black_friday() if bf else Image.open(fundo_path).convert('RGB').resize((LADO, LADO), Image.LANCZOS)
    bruta = Image.open(foto_path)
    if bruta.mode == 'RGBA' and bruta.getchannel('A').getextrema()[0] < 250:
        prod = bruta.crop(bruta.getchannel('A').getbbox())       # foto do acervo, já recortada e revisada
        return compor_bf(fundo, prod, saida) if bf else compor(fundo, prod, saida)
    foto = bruta.convert('RGB')
    alfa = mascara(foto)
    w, h = foto.size
    removido = 1 - sum(alfa.histogram()[128:]) / (w * h)
    if removido < 0.08:
        if bf:
            return compor_bf(fundo, moldura(foto), saida)
        return 3                         # foto ambientada/sem fundo branco: não recorta, quem chama usa a original
    ia = mascara_ia(foto)
    if ia is not None:
        # Híbrido: a IA devolve as partes claras da embalagem que o fundo branco "comeu" (caixa rasgada).
        alfa = ImageChops.lighter(alfa, ia)
    corte = sem_rodape(alfa)
    alfa = alfa.crop((0, 0, w, corte)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1))
    foto = foto.crop((0, 0, w, corte))
    alfa = so_produto(alfa)
    caixa = alfa.getbbox()
    if not caixa:
        return compor_bf(fundo, moldura(foto), saida) if bf else 3
    prod = foto.crop(caixa)
    prod.putalpha(alfa.crop(caixa))
    return compor_bf(fundo, prod, saida) if bf else compor(fundo, prod, saida)


def compor(fundo, prod, saida):
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


# --- Tema Black Friday ---------------------------------------------------------------------------------------------
PRETO = (14, 14, 16)
VERMELHO = (226, 35, 26)
AMARELO = (255, 210, 0)
BF_ALTURA = 0.52      # produto menor: divide o card com o selo e o logo
BF_BASE = 870


def fonte(tamanho, peso=900):
    f = ImageFont.truetype(FONTE, tamanho)
    try:
        f.set_variation_by_axes([peso])
    except Exception:  # noqa: BLE001 — Pillow sem suporte a fonte variável: fica o peso padrão
        pass
    return f


def fundo_black_friday():
    """Preto com faixas diagonais vermelhas nos cantos e um foco de luz atrás do produto."""
    img = Image.new('RGB', (LADO, LADO), PRETO)
    faixas = Image.new('L', (LADO, LADO), 0)
    f = ImageDraw.Draw(faixas)
    for x0, larg in ((-520, 90), (-360, 34), (LADO - 60, 90), (LADO + 100, 34)):
        f.polygon([(x0, LADO), (x0 + larg, LADO), (x0 + larg + 560, 0), (x0 + 560, 0)], fill=255)
    img.paste(Image.new('RGB', (LADO, LADO), VERMELHO), (0, 0), faixas)
    luz = Image.new('L', (LADO, LADO), 0)
    ImageDraw.Draw(luz).ellipse((LADO * 0.14, 230, LADO * 0.86, 900), fill=70)
    img.paste(Image.new('RGB', (LADO, LADO), (255, 255, 255)), (0, 0), luz.filter(ImageFilter.GaussianBlur(90)))
    return img


def moldura(foto):
    """Foto ambientada (sem recorte): entra inteira numa moldura branca arredondada."""
    lado = max(foto.size)
    m = 28
    quad = Image.new('RGB', (lado + 2 * m, lado + 2 * m), (255, 255, 255))
    quad.paste(foto, (m + (lado - foto.width) // 2, m + (lado - foto.height) // 2))
    alfa = Image.new('L', quad.size, 0)
    ImageDraw.Draw(alfa).rounded_rectangle((0, 0, quad.width - 1, quad.height - 1), radius=max(24, quad.width // 18), fill=255)
    quad.putalpha(alfa)
    return quad


def selo(img):
    """Faixa vermelha inclinada com "BLACK FRIDAY" em amarelo, no topo."""
    camada = Image.new('RGBA', (LADO + 200, 190), (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    d.rectangle((0, 18, camada.width, 172), fill=VERMELHO + (255,))
    d.rectangle((0, 18, camada.width, 26), fill=AMARELO + (255,))
    d.rectangle((0, 164, camada.width, 172), fill=AMARELO + (255,))
    texto = 'BLACK FRIDAY'
    f = fonte(118)
    caixa = d.textbbox((0, 0), texto, font=f)
    while caixa[2] - caixa[0] > LADO * 0.86:
        f = fonte(f.size - 4)
        caixa = d.textbbox((0, 0), texto, font=f)
    x = (camada.width - (caixa[2] - caixa[0])) // 2 - caixa[0]
    y = 95 - (caixa[3] + caixa[1]) // 2
    d.text((x + 6, y + 6), texto, font=f, fill=PRETO + (255,))
    d.text((x, y), texto, font=f, fill=AMARELO + (255,))
    camada = camada.rotate(4, resample=Image.BICUBIC, expand=True)
    img.paste(camada, ((LADO - camada.width) // 2, 34), camada)


def rodape(img):
    """Logo oficial embaixo, sem deformar."""
    try:
        logo = Image.open(LOGO).convert('RGBA')
    except OSError:
        return
    alt = 118
    logo = logo.resize((round(logo.width * alt / logo.height), alt), Image.LANCZOS)
    img.paste(logo, ((LADO - logo.width) // 2, LADO - alt - 44), logo)


def compor_bf(fundo, prod, saida):
    alto = LADO * BF_ALTURA
    escala = min(alto / prod.height, LADO * 0.72 / prod.width)
    prod = prod.resize((max(1, round(prod.width * escala)), max(1, round(prod.height * escala))), Image.LANCZOS)
    cx = LADO // 2
    sombra = Image.new('L', (LADO, LADO), 0)
    ImageDraw.Draw(sombra).ellipse((cx - prod.width * 0.5, BF_BASE - 16, cx + prod.width * 0.5, BF_BASE + 20), fill=190)
    fundo.paste(Image.new('RGB', (LADO, LADO), (0, 0, 0)), (0, 0), sombra.filter(ImageFilter.GaussianBlur(14)))
    fundo.paste(prod, (cx - prod.width // 2, BF_BASE - prod.height), prod)
    selo(fundo)
    rodape(fundo)
    fundo.save(saida, 'JPEG', quality=90)
    return 0


def main(argv=None):
    a = argparse.ArgumentParser()
    a.add_argument('--foto', required=True)
    a.add_argument('--saida', required=True)
    a.add_argument('--fundo', default=FUNDO_PADRAO)
    a.add_argument('--tema', choices=['blackfriday'], default=None)
    o = a.parse_args(argv)
    try:
        return gerar(o.foto, o.saida, o.fundo, o.tema)
    except Exception as e:  # noqa: BLE001 — erro vira código 1 com mensagem curta
        print(f'card: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
