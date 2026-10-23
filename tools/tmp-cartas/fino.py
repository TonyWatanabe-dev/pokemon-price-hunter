"""Temporário: mosaicos finos (4 q/s) de janelas escolhidas, para achar o quadro exato dos hits."""
import json,os,subprocess,shutil,urllib.request,sys
J=json.load(open('tools/tmp-cartas/fino.json'));IDS=json.load(open('tools/tmp-cartas/dragonite.json'))
os.makedirs('tmp-dragonite/fino',exist_ok=True)
for nome,(a,b) in J.items():
    arq=f'/tmp/{nome}.mp4'
    if not os.path.exists(arq):
        with urllib.request.urlopen(urllib.request.Request(f'https://drive.usercontent.google.com/download?id={IDS[nome]}&export=download&confirm=t',headers={'User-Agent':'Mozilla/5.0'}),timeout=900) as r, open(arq,'wb') as f: shutil.copyfileobj(r,f,1<<22)
    subprocess.run(['ffmpeg','-v','quiet','-ss',str(a),'-to',str(b),'-i',arq,'-vf',"fps=4,scale=240:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=16:fontcolor=white:box=1:boxcolor=black,tile=8x6",'-frames:v','1',f'tmp-dragonite/fino/{nome}_{a}.jpg'])
    os.remove(arq)
