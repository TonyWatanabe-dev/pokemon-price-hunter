import json,os,subprocess,shutil,urllib.request
F={"F1_132608":"1Pn_y8_C5DPDlgknK-6lNlKlAU0dL0Gz-","F2_134928":"1VrQC7EGOnoNY1RyGeEVXCr6h50LlBh1o","F3_134937":"1mzPEfA4Fgau9dQH55tdfTeCeOo86CxuN","F4_135011":"1o2aHoJvvgarICrRLtySKZI0Hxc3e4Oba","F5_135041":"1EuMTca3xXzAXQlgb-FUj6OF2r1TFZlg7","F6_135121":"127JawcTm9hgRgqIRWqE4uLtkCQewTDF8"}
os.makedirs('tmp-dragonite/fotos',exist_ok=True)
for n,i in F.items():
    a=f'/tmp/{n}.jpg'
    with urllib.request.urlopen(urllib.request.Request(f'https://drive.usercontent.google.com/download?id={i}&export=download&confirm=t',headers={'User-Agent':'Mozilla/5.0'}),timeout=300) as r, open(a,'wb') as f: shutil.copyfileobj(r,f)
    subprocess.run(['ffmpeg','-v','quiet','-y','-i',a,'-vf','scale=900:-2',f'tmp-dragonite/fotos/{n}.jpg'])
