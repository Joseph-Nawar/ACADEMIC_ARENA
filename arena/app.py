"""Public read-only board + private student/staff interactions. Pilot, not deployed production."""
from datetime import timedelta
from pathlib import Path
import secrets
import os
import re
from collections import Counter
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from .db import SessionLocal, create_tables, Account, SessionToken, PublicRanking, Achievement, Reaction, utcnow
from .security import COOKIE, ORIGIN, DEV_HTTP, SESSION_AGE, hash_token, new_secret, check_origin, throttle_login, strong_password, verify_password, hash_password

ROOT=Path(__file__).resolve().parent.parent
CHARACTERS={'omar','mariam','youssef','amara','tariq','habiba2','malek','nour2','zein'}
STYLES={'ink','cartoon3d'}
TONES={'mint','coral','gold','paper','blue','lilac'}
BADGES={'✦','⚡','♥','★',''}
WIN_TYPES={'top3':'academic','streak':'consistency','workshop':'consistency','project':'academic','helped':'community'}
REACTIONS={'heart','clap','fire'}
app=FastAPI(title='Academic Arena Pilot API', docs_url=None, redoc_url=None, openapi_url=None)

@app.on_event('startup')
def startup():
    if not DEV_HTTP and not ORIGIN.startswith('https://'):
        raise RuntimeError('Production mode requires ARENA_ORIGIN=https://... or explicitly enable local development HTTP')
    create_tables()

@app.middleware('http')
async def headers(request:Request,call_next):
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['Referrer-Policy']='no-referrer'
    response.headers['X-Frame-Options']='DENY'
    response.headers['Permissions-Policy']='camera=(), microphone=(), geolocation=()'
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
    response.headers['Cache-Control']='no-store' if request.url.path.startswith('/api/') else 'private, max-age=0'
    if not DEV_HTTP: response.headers['Strict-Transport-Security']='max-age=31536000; includeSubDomains'
    return response

app.mount('/assets',StaticFiles(directory=ROOT/'assets'),name='assets')
@app.get('/')
def homepage(): return FileResponse(ROOT/'index.html',media_type='text/html')
@app.get('/api/config')
def config(): return {'mode':'server','auth_required_for_writes':True,'no_grades':True}

def db():
    with SessionLocal() as s: yield s

def auth(request:Request, database:Session=Depends(db)):
    value=request.cookies.get(COOKIE,'')
    if not value: raise HTTPException(401,'Sign-in required')
    token=database.scalar(select(SessionToken).where(SessionToken.token_hash==hash_token(value)))
    if not token or token.expires < utcnow(): raise HTTPException(401,'Session expired')
    user=database.get(Account,token.user_id)
    if not user or not user.active: raise HTTPException(401,'Account inactive')
    return user,token

def write_auth(request:Request,credentials=Depends(auth)):
    check_origin(request)
    user, token=credentials
    if not secrets.compare_digest(request.headers.get('x-csrf-token',''),token.csrf):
        raise HTTPException(403,'CSRF check failed')
    return user,token

def may_edit(credentials=Depends(write_auth)):
    user,token=credentials
    if user.must_change_password: raise HTTPException(403,'Change your initial password before editing')
    return user,token

def staff(credentials=Depends(may_edit)):
    user,token=credentials
    if user.role not in ('staff','admin'): raise HTTPException(403,'Staff permission required')
    return user,token

class LoginInput(BaseModel):
    username: str=Field(min_length=2,max_length=80)
    password: str=Field(min_length=1,max_length=128)

@app.post('/api/auth/login')
def login(payload:LoginInput,request:Request,response:Response,database:Session=Depends(db)):
    check_origin(request); throttle_login(request)
    username=payload.username.strip().lower()
    user=database.scalar(select(Account).where(Account.username==username))
    if not user or not user.active: raise HTTPException(401,'Invalid credentials')
    now=utcnow()
    if user.locked_until and user.locked_until>now: raise HTTPException(429,'Account temporarily locked')
    if not verify_password(user.password_hash,payload.password):
        user.failed_attempts+=1
        if user.failed_attempts>=8:
            user.failed_attempts=0;user.locked_until=now+timedelta(minutes=15)
        database.commit()
        raise HTTPException(401,'Invalid credentials')
    user.failed_attempts=0;user.locked_until=None
    raw=new_secret();csrf=new_secret()
    database.add(SessionToken(token_hash=hash_token(raw),user_id=user.id,csrf=csrf,expires=now+timedelta(seconds=SESSION_AGE)))
    database.commit()
    response.set_cookie(COOKIE,raw,httponly=True,secure=not DEV_HTTP,samesite='lax',path='/',max_age=SESSION_AGE)
    return {'user':public_me(user),'csrf':csrf}

def public_me(user:Account):
    return {'username':user.username,'display_name':user.display_name,'role':user.role,'must_change_password':user.must_change_password,'avatar':{'base':user.avatar_base,'style':user.avatar_style,'tone':user.avatar_tone,'badge':user.avatar_badge}}

@app.get('/api/me')
def me(credentials=Depends(auth)):
    user,session=credentials
    return {'user':public_me(user),'csrf':session.csrf}

class PasswordInput(BaseModel):
    old_password:str
    new_password:str

@app.post('/api/me/password')
def password_change(payload:PasswordInput,credentials=Depends(write_auth),database:Session=Depends(db)):
    user,session=credentials
    strong_password(payload.new_password)
    if not verify_password(user.password_hash,payload.old_password): raise HTTPException(403,'Current password incorrect')
    if payload.new_password==payload.old_password: raise HTTPException(422,'Choose a different password')
    user.password_hash=hash_password(payload.new_password)
    user.must_change_password=False
    database.commit()
    return {'ok':True}

@app.post('/api/auth/logout')
def logout(response:Response,credentials=Depends(write_auth),database:Session=Depends(db)):
    _,sess=credentials
    database.delete(sess);database.commit()
    response.delete_cookie(COOKIE,path='/')
    return {'ok':True}

class AvatarInput(BaseModel):
    base:str
    style:str
    tone:str
    badge:str=Field(max_length=2)

@app.put('/api/me/avatar')
def update_avatar(payload:AvatarInput,credentials=Depends(may_edit),database:Session=Depends(db)):
    user,_=credentials
    if payload.base not in CHARACTERS or payload.style not in STYLES or payload.tone not in TONES or payload.badge not in BADGES:
        raise HTTPException(422,'Unrecognized avatar option')
    user.avatar_base=payload.base;user.avatar_style=payload.style;user.avatar_tone=payload.tone;user.avatar_badge=payload.badge
    database.commit()
    return {'ok':True,'avatar':public_me(user)['avatar']}

@app.get('/api/catalog')
def catalog(level:int=5,semester:int=1,year:str='2026-27',database:Session=Depends(db)):
    if level not in (4,5,6) or semester not in (1,2):raise HTTPException(422,'Unknown semester')
    published=database.scalars(select(PublicRanking).where(PublicRanking.year==year,PublicRanking.level==level,PublicRanking.semester==semester,PublicRanking.is_published==True)).all()
    groups=sorted({p.group_key for p in published})
    modules={g:sorted({p.board_key for p in published if p.group_key==g and p.board_kind=='module'}) for g in groups}
    return {'groups':groups,'modules':modules}

@app.get('/api/boards')
def boards(level:int=5,semester:int=1,board_kind:str='semester',board_key:str='all',group_key:str='core',year:str='2026-27',database:Session=Depends(db)):
    if level not in (4,5,6) or semester not in (1,2): raise HTTPException(422,'Unknown semester')
    if board_kind not in ('semester','module') or not re.fullmatch(r'[a-zA-Z0-9_-]{1,70}',board_key) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,70}',group_key): raise HTTPException(422,'Unknown leaderboard')
    if board_kind=='semester': board_key='all'
    query=select(PublicRanking).where(PublicRanking.year==year,PublicRanking.level==level,PublicRanking.semester==semester,PublicRanking.group_key==group_key,PublicRanking.board_kind==board_kind,PublicRanking.board_key==board_key,PublicRanking.is_published==True).order_by(PublicRanking.rank).limit(10)
    rows=database.scalars(query).all()
    output=[]
    for item in rows:
        a=database.get(Account,item.account_id) if item.account_id else None
        output.append({'rank':item.rank,'name':item.public_name,'avatar':a.avatar_base if a else 'mariam','style':a.avatar_style if a else 'ink'})
    return {'rows':output,'approved_snapshot_only':True,'level':level,'semester':semester,'group_key':group_key,'board_kind':board_kind,'board_key':board_key}

class WinInput(BaseModel):
    type:str
    note:str=Field(default='',max_length=100)

def sanitize_note(value:str):
    value=' '.join(value.split())
    if re.search(r'(?:https?://|www\.|@|\b\d{6,}\b)',value,re.I): raise HTTPException(422,'No links or contact details')
    return value

@app.post('/api/wins',status_code=202)
def submit_win(payload:WinInput,credentials=Depends(may_edit),database:Session=Depends(db)):
    user,_=credentials
    if payload.type not in WIN_TYPES: raise HTTPException(422,'Unsupported achievement type')
    a=Achievement(author_id=user.id,type=payload.type,note=sanitize_note(payload.note),status='pending')
    database.add(a);database.commit()
    return {'status':'pending','id':a.id}

@app.get('/api/wins')
def published_wins(database:Session=Depends(db)):
    posts=database.scalars(select(Achievement).where(Achievement.status=='approved').order_by(Achievement.created_at.desc()).limit(40)).all()
    out=[]
    for p in posts:
        user=database.get(Account,p.author_id)
        counts=Counter(x.kind for x in database.scalars(select(Reaction).where(Reaction.achievement_id==p.id)))
        out.append({'id':p.id,'author':user.display_name,'char':user.avatar_base,'style':user.avatar_style,'category':WIN_TYPES[p.type],'type':p.type,'note':p.note,'created':p.created_at.strftime('%d %b'), 'counts':[counts['heart'],counts['clap'],counts['fire']]})
    return {'posts':out}

class ReactionInput(BaseModel):
    kind:str

@app.put('/api/wins/{win_id}/reaction')
def react(win_id:int,payload:ReactionInput,credentials=Depends(may_edit),database:Session=Depends(db)):
    user,_=credentials
    if payload.kind not in REACTIONS:raise HTTPException(422,'Unsupported reaction')
    post=database.get(Achievement,win_id)
    if not post or post.status!='approved': raise HTTPException(404,'No published post')
    prior=database.scalar(select(Reaction).where(Reaction.achievement_id==win_id,Reaction.account_id==user.id))
    if prior:
        if prior.kind==payload.kind: database.delete(prior)
        else: prior.kind=payload.kind
    else: database.add(Reaction(achievement_id=win_id,account_id=user.id,kind=payload.kind))
    database.commit();return {'ok':True}

def staff_read(credentials=Depends(auth)):
    user,token=credentials
    if user.must_change_password or user.role not in ('staff','admin'): raise HTTPException(403,'Staff permission required')
    return user,token

@app.get('/api/staff/pending')
def pending(credentials=Depends(staff_read),database:Session=Depends(db)):
    entries=database.scalars(select(Achievement).where(Achievement.status=='pending').order_by(Achievement.created_at)).all()
    return {'posts':[{'id':p.id,'author':database.get(Account,p.author_id).display_name,'type':p.type,'note':p.note} for p in entries]}

class Decision(BaseModel):
    decision:str

@app.post('/api/staff/wins/{win_id}/decision')
def decide(win_id:int,payload:Decision,credentials=Depends(staff),database:Session=Depends(db)):
    user,_=credentials
    if payload.decision not in ('approved','rejected'): raise HTTPException(422,'Invalid decision')
    post=database.get(Achievement,win_id)
    if not post or post.status!='pending': raise HTTPException(404,'No pending post')
    post.status=payload.decision;post.reviewer_id=user.id;post.reviewed_at=utcnow()
    database.commit();return {'ok':True,'status':post.status}
