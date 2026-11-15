from PIL import Image, ImageFilter
from pathlib import Path
import numpy as np, cv2
root=Path(__file__).parent
img=Image.open(root/'assets/source/3d-family-sheet.png').convert('RGB')
assert img.size==(1254,1254)
ids=['omar','mariam','youssef','amara','tariq','habiba2','malek','nour2','zein']
for i,id in enumerate(ids):
    c=i%3;r=i//3
    im=img.crop((c*418,r*418,(c+1)*418,(r+1)*418))
    im.save(root/f'assets/characters/{id}-3d-square.jpg',quality=93)
    arr=np.asarray(im).copy()
    # Approximate background separation; keep holes safe by connected-component exterior fill.
    lab=cv2.cvtColor(arr,cv2.COLOR_RGB2LAB).astype(np.float32)
    # Background is warm pale beige; discard only connected regions close to background.
    rgb=arr.astype(np.float32)
    pale=(np.linalg.norm(rgb - np.array([250.,235.,220.]),axis=2)<38)&(rgb[:,:,0]>225)&(rgb[:,:,1]>207)&(rgb[:,:,2]>185)
    # background regions can touch border; flood fill only from border pixels.
    seed=np.zeros((420,420),np.uint8)
    candidate=(pale*255).astype(np.uint8)
    mask=np.zeros((420,420),np.uint8)
    # flood connected white candidate using seed at all border pixels
    bg=np.zeros((418,418),np.uint8)
    n, labels=cv2.connectedComponents(candidate,connectivity=4)
    vals=np.unique(np.concatenate((labels[0,:],labels[-1,:],labels[:,0],labels[:,-1])))
    bg[np.isin(labels,vals[vals!=0])]=255
    alpha=(255-bg).astype(np.uint8)
    # small soften edge without erasing person
    alpha=cv2.GaussianBlur(alpha,(3,3),0.6)
    rgba=np.dstack([arr,alpha])
    Image.fromarray(rgba,'RGBA').save(root/f'assets/characters/{id}-3d.png',optimize=True)
    # small face crop for lists and feed
    im.crop((78,14,340,276)).resize((180,180),Image.Resampling.LANCZOS).save(root/f'assets/characters/{id}-3d-face.jpg',quality=89)
print('created',len(ids),'3d sets')
