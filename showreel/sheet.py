import sys,glob
from PIL import Image,ImageDraw
fs=sys.argv[2:]; out=sys.argv[1]
w,h=640,360; cols=3; rows=(len(fs)+cols-1)//cols
S=Image.new('RGB',(cols*w,rows*h),'black'); d=ImageDraw.Draw(S)
for i,f in enumerate(fs):
    im=Image.open(f).resize((w,h)); S.paste(im,((i%cols)*w,(i//cols)*h)); d.text(((i%cols)*w+8,(i//cols)*h+8),f.split('_')[-1],fill='yellow')
S.save(out,quality=85)
