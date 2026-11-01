#!/usr/bin/env python3
"""Gera as configs GSAP dos vídeos com vários hits a partir dos trechos (arquivo, ini, fim, revela-no-arquivo, carta...).
O primeiro trecho é o hit principal; os demais viram C.extras com seg = início do trecho no vídeo final."""
import json
L = '../../tmp-lotes/'
def monta(base, trechos, atraso=0.4, fim=4.5, detalhe=None, **extra):
    segs, extras, t0 = [], [], 0.0
    for i, tr in enumerate(trechos):
        arq, a, b, rv = tr['arq'], tr['ini'], tr['fim'], tr.get('rev')
        segs.append([L + arq, a, b])
        hit = None if rv is None else t0 + (rv - a) + tr.get('atraso', atraso)
        if i == 0:
            base.update(carta=tr['carta'], valor=tr['valor'], raridade=tr['raridade'], hitT=hit, revela=t0 + rv - a)
            if tr.get('estrela'): base['estrela'] = tr['estrela']
        else:
            e = {'seg': t0, 't': hit, 'carta': tr['carta'], 'valor': tr['valor'], 'raridade': tr['raridade'], 'custo': tr.get('custo', base['pack'])}
            for k in ('estrela', 'rotulo'):
                if tr.get(k): e[k] = tr[k]
            extras.append(e)
        t0 += b - a
    if detalhe:
        base['detalhe'] = t0; segs.append([L + detalhe[0], detalhe[1], detalhe[2]]); t0 += detalhe[2] - detalhe[1]
    base.update(segs=segs, extras=extras, dur=round(t0 + fim, 2), fimDur=fim, **extra)
    return base

comum = dict(kick='Fogo Fantasmagórico', titulo='1 blister… espera a <em>última carta</em> 👀', tagFim='Resultado · Fogo Fantasmagórico',
             notaPack='48 blisters por R$ 323,96 (promoção no site) ÷ 48', pack=6.75, ganchoAte=3.6)
cfg = {}
# F4: Wooper de Paldea duas vezes + Jaula de Batalha (3 blisters)
cfg['f4'] = monta(dict(comum, rotulo='1 blister unitário', linhaPack='3 blisters unitários', tipoCarta='escuridao',
    linhas=[{'nome': '3 blisters unitários', 'nota': '48 blisters por R$ 323,96 ÷ 48', 'v': -20.25}, {'nome': 'Wooper de Paldea ×2', 'nota': 'média Liga Pokémon', 'v': 36.40}, {'nome': 'Jaula de Batalha', 'nota': 'média Liga Pokémon', 'v': 20.68}]),
  [dict(arq='F4_wooper_a.mp4', ini=9.0, fim=21.0, rev=17.5, carta='Wooper de Paldea', valor=18.20, raridade='Ilustração Rara', atraso=2.0),
   dict(arq='F4_wooper_b.mp4', ini=12.0, fim=16.2, rev=14.5, carta='Wooper de Paldea', valor=18.20, raridade='Ilustração Rara · 2ª cópia', estrela='2×!', rotulo='2 blisters'),
   dict(arq='F4_jaula.mp4', ini=13.5, fim=20.0, rev=16.0, carta='Jaula de Batalha', valor=20.68, raridade='Rara Ultra', rotulo='3 blisters')],
  detalhe=('F_vitrine_det.mp4', 18.5, 23.0))
# F5: brick
cfg['f5'] = dict(comum, titulo='1 blister… será que vem <em>hit</em>? 👀', rotulo='1 blister unitário', carta='Nada de hit', valor=0, raridade='Nem todo pack é hit',
  brick=True, estrela='BRICK', precoTxt='😭', fonte='no lote inteiro, os 48 blisters deram +R$ 271,06', h1='Deu brick.', lucro=-6.75,
  linhas=[{'nome': '1 blister unitário', 'nota': '48 blisters por R$ 323,96 ÷ 48', 'v': -6.75}, {'nome': 'Lote inteiro (48 blisters)', 'nota': 'todos os hits pela média da Liga', 'v': 271.06}],
  revela=18.0, hitT=18.3, segs=[[L + 'F5_brick.mp4', 4.0, 25.5]], dur=26.0, fimDur=4.5)
# E2: placar da booster box (36 packs), crescente até o Darkrai
esc = dict(kick='Escuridão Absoluta', titulo='Abri uma <em>booster box</em> inteira 👀', tagFim='Resultado · Escuridão Absoluta', pack=349.90, rotulo='Booster box (36 packs)', ganchoAte=2.4,
           notaPack='menor preço do site', tipoCarta='escuridao')
cfg['e2'] = monta(dict(esc, linhas=[{'nome': 'Booster box', 'nota': 'R$ 349,90 no menor preço do site', 'v': -349.90}, {'nome': 'Mega Darkrai ex', 'nota': 'média Liga Pokémon', 'v': 814.04}, {'nome': 'Outras ex e IR (7 cartas)', 'nota': 'média Liga Pokémon', 'v': 73.52}]),
  [dict(arq='E2_wailord.mp4', ini=6.5, fim=12.0, rev=9.0, carta='Wailord ex', valor=17.89, raridade='Rara Ultra', atraso=1.0),
   dict(arq='E3_manectric.mp4', ini=7.5, fim=12.5, rev=9.0, carta='Rampardos ex ×2', valor=12.90, raridade='Rara Dupla', custo=0, estrela='2×!'),
   dict(arq='E2_excadrill.mp4', ini=8.0, fim=13.0, rev=10.0, carta='Mega Excadrill ex', valor=10.69, raridade='Rara Dupla', custo=0),
   dict(arq='E3_manectric.mp4', ini=29.5, fim=34.0, rev=31.0, carta='Manectric', valor=14.54, raridade='Ilustração Rara', custo=0),
   dict(arq='E2_chandelure.mp4', ini=7.5, fim=13.0, rev=9.5, carta='Mega Chandelure ex ×2', valor=17.50, raridade='Rara Dupla', custo=0, estrela='2×!'),
   dict(arq='E1_darkrai.mp4', ini=19.5, fim=27.5, rev=22.0, carta='Mega Darkrai ex', valor=814.04, raridade='Ilustração Rara Especial', custo=0, atraso=1.6)],
  detalhe=('E1_darkrai_det.mp4', 2.6, 7.8))
# F3: placar dos 48 blisters (Lopunny saiu fora da câmera: só na lâmina)
cfg['f3'] = monta(dict(comum, titulo='Abri <em>48 blisters</em> 👀', ganchoAte=2.4, pack=323.96, rotulo='48 blisters', tipoCarta='fogo', lucro=271.06,
  linhas=[{'nome': '48 blisters unitários', 'nota': 'R$ 323,96 na promoção do site', 'v': -323.96}, {'nome': 'Mega Charizard X ex ×2 + Dawn', 'nota': 'média Liga Pokémon', 'v': 519.05}, {'nome': 'Outros 6 hits (1 fora da câmera)', 'nota': 'inclui Mega Lopunny ex, R$ 7,12', 'v': 75.97}]),
  [dict(arq='F3_heracross.mp4', ini=3.0, fim=7.3, rev=5.0, carta='Mega Heracross ex', valor=5.78, raridade='Rara Dupla', atraso=1.5),
   dict(arq='F3_mismagius.mp4', ini=6.5, fim=10.5, rev=8.0, carta='Mismagius ex', valor=5.99, raridade='Rara Dupla', custo=0),
   dict(arq='F4_wooper_a.mp4', ini=16.0, fim=20.0, rev=17.5, carta='Wooper de Paldea', valor=18.20, raridade='Ilustração Rara', custo=0),
   dict(arq='F4_wooper_b.mp4', ini=13.0, fim=16.2, rev=14.5, carta='Wooper de Paldea', valor=18.20, raridade='Ilustração Rara · 2ª cópia', custo=0, estrela='2×!'),
   dict(arq='F4_jaula.mp4', ini=14.5, fim=18.8, rev=16.0, carta='Jaula de Batalha', valor=20.68, raridade='Rara Ultra', custo=0),
   dict(arq='F1_dawn.mp4', ini=27.5, fim=32.5, rev=29.0, carta='Dawn', valor=170.61, raridade='Ilustração Rara Especial', custo=0),
   dict(arq='F2_charizard_a.mp4', ini=14.5, fim=19.5, rev=15.8, carta='Mega Charizard X ex', valor=174.22, raridade='Rara Ultra', custo=0),
   dict(arq='F2_charizard_b.mp4', ini=12.0, fim=16.8, rev=13.8, carta='Mega Charizard X ex', valor=174.22, raridade='Rara Ultra · 2ª cópia', custo=0, estrela='2×!')],
  detalhe=('F_vitrine_det.mp4', 3.0, 8.0))
# E4: vitrine das ex (sem custo; o placar soma o valor das cartas)
cfg['e4'] = monta(dict(esc, titulo='Todas as <em>ex</em> da booster box 👀', pack=0, rotulo='Valor das cartas', lucro=537.66,
  linhas=[{'nome': 'Booster box', 'nota': 'R$ 349,90 no menor preço do site', 'v': -349.90}, {'nome': 'Todas as ex e IR (8 cartas)', 'nota': 'média Liga Pokémon', 'v': 887.56}]),
  [dict(arq='E4_vitrine.mp4', ini=0.0, fim=8.0, rev=3.0, carta='Rampardos ex ×2', valor=12.90, raridade='Rara Dupla', atraso=0.3, estrela='2×!'),
   dict(arq='E4_vitrine.mp4', ini=8.0, fim=16.5, rev=8.5, carta='Mega Chandelure ex ×2', valor=17.50, raridade='Rara Dupla', custo=0, estrela='2×!'),
   dict(arq='E4_vitrine.mp4', ini=16.5, fim=20.3, rev=17.0, carta='Mega Excadrill ex', valor=10.69, raridade='Rara Dupla', custo=0),
   dict(arq='E4_vitrine.mp4', ini=20.3, fim=23.3, rev=20.8, carta='Wailord ex', valor=17.89, raridade='Rara Ultra', custo=0),
   dict(arq='E4_vitrine.mp4', ini=23.3, fim=27.5, rev=23.8, carta='Manectric', valor=14.54, raridade='Ilustração Rara', custo=0),
   dict(arq='E1_darkrai_det.mp4', ini=2.2, fim=7.8, rev=2.6, carta='Mega Darkrai ex', valor=814.04, raridade='Ilustração Rara Especial', custo=0)])
for k, v in cfg.items():
    json.dump(v, open(k + '.json', 'w'), ensure_ascii=False, indent=1)
    print(k, v['dur'], 'hit', round(v['hitT'], 2), [round(e['t'], 2) for e in v.get('extras', [])])
