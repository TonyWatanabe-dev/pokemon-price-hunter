"""Final dos anúncios (sem cartela de site): "Não rasgue dinheiro" com impacto, chamada "toca aqui embaixo" com seta grande
e selo "É grátis". Desenha num quadro RGBA 1080x1920 já com fundo navy. Tempos relativos ao início da fala do CTA.
Uso: desenha(fr, t, H) com H = dict(F=..., texto=..., pilula=..., cola=..., ease=..., back=..., logo=..., marcas=(t_toca, t_gratis))."""
import math
from PIL import Image, ImageDraw

Y = (255, 207, 51); RED = (235, 64, 52); GREEN = (40, 175, 95); WHITE = (255, 255, 255); NAVY = (14, 19, 48)
_cache = {}

def _seta(h):
    if 'seta' in _cache: return _cache['seta']
    w = 300; im = Image.new('RGBA', (w + 24, 380 + 24), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    pts = [(12 + w * .3, 12), (12 + w * .7, 12), (12 + w * .7, 12 + 200), (12 + w, 12 + 200), (12 + w / 2, 12 + 380), (12, 12 + 200), (12 + w * .3, 12 + 200)]
    d.polygon(pts, fill=Y, outline=WHITE, width=10)
    _cache['seta'] = im; return im

def eventos(t0, marcas):
    """Sons do final: impacto no início, whoosh na seta, ching no 'grátis' e batida final."""
    tt, tg = marcas
    return [(t0, 'impacto'), (t0 + tt - .1, 'whoosh'), (t0 + tg, 'ching'), (t0 + tg + 1.0, 'impacto')]

def desenha(fr, t, h):
    F, texto, pilula, cola, ease, back = h['F'], h['texto'], h['pilula'], h['cola'], h['ease'], h['back']
    tt, tg = h['marcas']
    W, H = fr.size
    if 'nao' not in _cache:
        _cache['nao'] = texto([[('NÃO RASGUE', WHITE)], [('DINHEIRO!', Y)]], F[900](150), track=-5, lh=150)
        _cache['toca'] = texto([[('TOCA NO BOTÃO', WHITE)], [('AQUI EMBAIXO', Y)]], F[900](96), track=-3, lh=100)
        _cache['gratis'] = pilula('É GRÁTIS!', F[900](86), GREEN, WHITE, 52, 30)
    # impacto inicial: flash e tremida
    if t < .12: fr.alpha_composite(Image.new('RGBA', (W, H), (255, 255, 255, int(200 * (1 - t / .12)))))
    sh = 22 * math.exp(-t * 7) * math.sin(t * 60)
    if t < tt:
        s = 1.7 - .7 * ease(t / .22)
        cola(fr, _cache['nao'], (W / 2 + sh, 760), min(1, ease(t / .1)), s, -4 * math.exp(-t * 5))
        return
    lt = t - tt
    # "toca aqui embaixo" + seta grande pulando para baixo
    cola(fr, _cache['nao'], (W / 2, 420), 1 - ease(lt / .25) * .65, 1 - .45 * ease(lt / .25))
    cola(fr, _cache['toca'], (W / 2, 820 - 40 * (1 - ease(lt / .3))), ease(lt / .3), max(.01, back(lt / .35)))
    b = abs(math.sin(lt * 6)) * 70
    cola(fr, _cache.get('seta') or _seta(None), (W / 2, 1290 + b), ease((lt - .15) / .25), .9 + .1 * abs(math.sin(lt * 6)))
    if t >= tg:
        lg = t - tg
        cola(fr, _cache['gratis'], (W / 2, 1000), min(1, ease(lg / .12)), max(.01, back(lg / .4)) * (1 + .04 * math.sin(lg * 9)), 6)
