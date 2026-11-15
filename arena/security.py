import hashlib
import os
import secrets
import time
from collections import defaultdict,deque
from datetime import timedelta
from fastapi import HTTPException, Request
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from .db import utcnow

HASHER = PasswordHasher(time_cost=2,memory_cost=19456,parallelism=1)
COOKIE='arena_session'
SESSION_AGE = 24*3600
DEV_HTTP = os.environ.get('ARENA_ALLOW_INSECURE_HTTP','0') == '1'
ORIGIN = os.environ.get('ARENA_ORIGIN', 'http://localhost:8000')
_attempts=defaultdict(deque)

def hash_password(password): return HASHER.hash(password)
def verify_password(hashed,password):
    try: return HASHER.verify(hashed,password)
    except (VerifyMismatchError,VerificationError,ValueError): return False

def strong_password(value):
    if not 15 <= len(value) <= 128: raise HTTPException(422,'Password must be 15–128 characters')
    return value

def hash_token(value): return hashlib.sha256(value.encode('utf-8')).hexdigest()
def new_secret(): return secrets.token_urlsafe(32)

def check_origin(request:Request):
    # All credential and mutation submissions originate from the one configured site.
    if request.headers.get('origin') != ORIGIN:
        raise HTTPException(403, 'Origin not permitted')

def throttle_login(request:Request):
    ip=request.client.host if request.client else 'unknown'
    current=time.monotonic()
    dq=_attempts[ip]
    while dq and current-dq[0]>300: dq.popleft()
    if len(dq)>=15: raise HTTPException(429,'Too many sign-in attempts; try again later')
    dq.append(current)
