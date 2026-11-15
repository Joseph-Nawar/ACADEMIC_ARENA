"""Offline staff-only provisioning and publication tools.

Usage (from repository root):
  python -m arena.cli create-user --username student001 --display-name 'Student Example' --role student
  python -m arena.cli import-board --csv data/approved_ranks.csv --approved
"""
import argparse
import csv
import secrets
from pathlib import Path
from sqlalchemy import select,delete
from .db import SessionLocal,create_tables,Account,PublicRanking
from .security import hash_password

REQUIRED={'year','level','semester','group_key','board_kind','board_key','rank','public_name','account_username'}

def create_user(args):
    create_tables()
    initial_password=secrets.token_urlsafe(22)
    with SessionLocal() as db:
        if db.scalar(select(Account).where(Account.username==args.username.lower())):
            raise SystemExit('Account exists')
        db.add(Account(username=args.username.lower(),display_name=args.display_name,role=args.role,password_hash=hash_password(initial_password),must_change_password=True))
        db.commit()
    print('ACCOUNT CREATED. Deliver this initial password privately to the assigned student; do not email it in a mass mailing or store it in version control.')
    print('username:',args.username.lower())
    print('ONE-TIME PASSWORD:',initial_password)

def import_board(args):
    if not args.approved: raise SystemExit('Publication blocked: explicit --approved flag is required after staff review of the source spreadsheet and disclosure policy.')
    create_tables()
    path=Path(args.csv)
    with path.open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f)
        if set(reader.fieldnames or [])!=REQUIRED:
            raise SystemExit(f'Invalid columns: must equal {sorted(REQUIRED)}. Never include raw attendance, grades, scores, student IDs or email addresses.')
        rows=list(reader)
    if not rows: raise SystemExit('CSV empty')
    boards={}
    with SessionLocal() as db:
        prepared=[]
        for row in rows:
            try:
                lev=int(row['level']);sem=int(row['semester']);rank=int(row['rank'])
            except (TypeError,ValueError): raise SystemExit('Bad level, semester or rank')
            if lev not in (4,5,6) or sem not in (1,2) or rank<1 or rank>10: raise SystemExit('Invalid level, semester or top-ten rank')
            if row['board_kind'] not in ('semester','module'): raise SystemExit('Bad board kind')
            if not all(row[k] and len(row[k])<82 for k in ['year','group_key','board_key','public_name']): raise SystemExit('Missing board/public name')
            if row['board_kind']=='semester' and row['board_key']!='all': raise SystemExit('Semester board_key must be all')
            if any(c in row['group_key']+row['board_key'] for c in '/\\&?') : raise SystemExit('Invalid board key')
            account=None
            if row['account_username']:
                account=db.scalar(select(Account).where(Account.username==row['account_username'].lower()))
                if account is None: raise SystemExit(f"No account for {row['account_username']}; provision it first or leave blank for unclaimed approved name.")
                if account.display_name != row['public_name']: raise SystemExit('Display name mismatch; staff must resolve identity before publishing')
            key=(row['year'],lev,sem,row['group_key'],row['board_kind'],row['board_key'])
            boards.setdefault(key,[]).append(rank)
            prepared.append(PublicRanking(year=row['year'],level=lev,semester=sem,group_key=row['group_key'],board_kind=row['board_kind'],board_key=row['board_key'],rank=rank,public_name=row['public_name'],account_id=account.id if account else None,is_published=True))
        for key,ranks in boards.items():
            if len(set(ranks))!=len(ranks) or ranks!=list(range(1,len(ranks)+1)):
                raise SystemExit(f'Ranks must be unique and ordered starting at 1 in group {key}')
        for year,level,semester,group,kind,board_key in boards:
            db.execute(delete(PublicRanking).where(PublicRanking.year==year,PublicRanking.level==level,PublicRanking.semester==semester,PublicRanking.group_key==group,PublicRanking.board_kind==kind,PublicRanking.board_key==board_key))
        db.add_all(prepared);db.commit()
    print(f'PUBLISHED {len(prepared)} approved rank entries across {len(boards)} leaderboard(s).')

def main():
    parser=argparse.ArgumentParser(description='Academic Arena restricted staff CLI')
    sub=parser.add_subparsers(dest='command',required=True)
    u=sub.add_parser('create-user');u.add_argument('--username',required=True);u.add_argument('--display-name',required=True);u.add_argument('--role',choices=['student','staff','admin'],default='student');u.set_defaults(func=create_user)
    x=sub.add_parser('import-board');x.add_argument('--csv',required=True);x.add_argument('--approved',action='store_true',help='I confirm institutional approval for publication of every listed public name and rank');x.set_defaults(func=import_board)
    args=parser.parse_args();args.func(args)
if __name__=='__main__':main()
