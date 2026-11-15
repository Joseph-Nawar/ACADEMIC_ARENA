"""Run: python tests/smoke_api.py (from project root). No network needed."""
import os,sys,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
temp=tempfile.TemporaryDirectory()
os.environ['ARENA_DATABASE_URL']='sqlite:///'+str(Path(temp.name)/'test.sqlite3')
os.environ['ARENA_ORIGIN']='http://localhost:8000'
os.environ['ARENA_ALLOW_INSECURE_HTTP']='1'
from fastapi.testclient import TestClient
from arena.app import app
from arena.db import Account,SessionLocal
from arena.security import hash_password

origin={'Origin':'http://localhost:8000'}
with TestClient(app,base_url='http://localhost:8000') as client:
    with SessionLocal() as db:
        db.add_all([
          Account(username='laila',display_name='Laila',role='student',password_hash=hash_password('initpassword-test-2026!'),must_change_password=True),
          Account(username='moderator',display_name='Staff',role='staff',password_hash=hash_password('initpassword-staff-2026!'),must_change_password=False),
        ]);db.commit()
    assert client.get('/').status_code==200
    assert client.get('/assets/characters/mariam-3d.png').status_code==200
    r=client.get('/api/boards');assert r.status_code==200 and r.json()['rows']==[]
    assert client.put('/api/me/avatar',json={'base':'omar','style':'ink','tone':'mint','badge':'✦'},headers=origin).status_code==401
    assert client.post('/api/auth/login',json={'username':'laila','password':'nope'},headers=origin).status_code==401
    assert client.post('/api/auth/login',json={'username':'laila','password':'initpassword-test-2026!'}).status_code==403
    l=client.post('/api/auth/login',json={'username':'laila','password':'initpassword-test-2026!'},headers=origin);assert l.status_code==200,l.text
    csrf=l.json()['csrf'];auth={**origin,'X-CSRF-Token':csrf}
    assert client.put('/api/me/avatar',json={'base':'omar','style':'cartoon3d','tone':'mint','badge':'✦'},headers=auth).status_code==403
    assert client.post('/api/me/password',json={'old_password':'initpassword-test-2026!','new_password':'my-longest-new-passphrase-2026!'},headers=auth).status_code==200
    a=client.put('/api/me/avatar',json={'base':'omar','style':'cartoon3d','tone':'mint','badge':'✦'},headers=auth);assert a.status_code==200,a.text
    assert client.put('/api/me/avatar',json={'base':'omar','style':'javascript','tone':'mint','badge':'✦'},headers=auth).status_code==422
    r=client.post('/api/wins',json={'type':'project','note':'Team presentation complete!'},headers=auth);assert r.status_code==202,r.text
    win_id=r.json()['id']
    assert client.get('/api/wins').json()['posts']==[]
    assert client.post(f'/api/staff/wins/{win_id}/decision',json={'decision':'approved'},headers=auth).status_code==403
    assert client.post('/api/auth/logout',headers=auth).status_code==200
    staff=client.post('/api/auth/login',json={'username':'moderator','password':'initpassword-staff-2026!'},headers=origin);assert staff.status_code==200,staff.text
    csrf_staff=staff.json()['csrf'];staff_auth={**origin,'X-CSRF-Token':csrf_staff}
    assert len(client.get('/api/staff/pending').json()['posts'])==1
    assert client.post(f'/api/staff/wins/{win_id}/decision',json={'decision':'approved'},headers=staff_auth).status_code==200
    assert len(client.get('/api/wins').json()['posts'])==1
    assert client.put(f'/api/wins/{win_id}/reaction',json={'kind':'clap'},headers=staff_auth).status_code==200
    assert client.get('/api/wins').json()['posts'][0]['counts']==[0,1,0]
    assert client.put(f'/api/wins/{win_id}/reaction',json={'kind':'clap'},headers=staff_auth).status_code==200
    assert client.get('/api/wins').json()['posts'][0]['counts']==[0,0,0]
    assert client.put(f'/api/wins/{win_id}/reaction',json={'kind':'clap'},headers={'Origin':'https://evil.example','X-CSRF-Token':csrf_staff}).status_code==403
    assert client.put(f'/api/wins/{win_id}/reaction',json={'kind':'clap'},headers=origin).status_code==403
    headers=client.get('/').headers
    assert "script-src 'self'" in headers.get('content-security-policy','')
    print('PASS: public read, authentication, change-password, avatar validation, moderation, reactions, CSRF/origin, CSP')
print('TEST DATABASE WAS TEMPORARY')
