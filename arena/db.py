from datetime import datetime, timezone
from pathlib import Path
import os
from sqlalchemy import String, Integer, Boolean, ForeignKey, UniqueConstraint, DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped, relationship, sessionmaker

ROOT = Path(__file__).resolve().parent.parent
DB_URL = os.environ.get('ARENA_DATABASE_URL', f'sqlite:///{ROOT / "data" / "arena.sqlite3"}')
engine = create_engine(DB_URL, connect_args={'check_same_thread': False} if DB_URL.startswith('sqlite') else {}, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

class Base(DeclarativeBase): pass

def utcnow(): return datetime.now(timezone.utc).replace(tzinfo=None)

class Account(Base):
    __tablename__ = 'accounts'
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default='student')
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    avatar_base: Mapped[str] = mapped_column(String(32), default='mariam')
    avatar_style: Mapped[str] = mapped_column(String(16), default='ink')
    avatar_tone: Mapped[str] = mapped_column(String(16), default='mint')
    avatar_badge: Mapped[str] = mapped_column(String(8), default='✦')

class SessionToken(Base):
    __tablename__ = 'sessions'
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('accounts.id'))
    csrf: Mapped[str] = mapped_column(String(64))
    expires: Mapped[datetime] = mapped_column(DateTime)

class PublicRanking(Base):
    __tablename__ = 'public_rankings'
    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[str] = mapped_column(String(12), default='2026-27')
    level: Mapped[int] = mapped_column(Integer)
    semester: Mapped[int] = mapped_column(Integer)
    group_key: Mapped[str] = mapped_column(String(70), default='core')
    board_kind: Mapped[str] = mapped_column(String(12)) # semester / module
    board_key: Mapped[str] = mapped_column(String(70)) # all / module code
    rank: Mapped[int] = mapped_column(Integer)
    public_name: Mapped[str] = mapped_column(String(80))
    account_id: Mapped[int | None] = mapped_column(ForeignKey('accounts.id'), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint('year','level','semester','group_key','board_kind','board_key','rank',name='rank_unique_per_board'),)

class Achievement(Base):
    __tablename__ = 'achievements'
    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey('accounts.id'))
    type: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(String(100), default='')
    status: Mapped[str] = mapped_column(String(12), default='pending')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey('accounts.id'), nullable=True)

class Reaction(Base):
    __tablename__ = 'reactions'
    id: Mapped[int] = mapped_column(primary_key=True)
    achievement_id: Mapped[int] = mapped_column(ForeignKey('achievements.id'), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey('accounts.id'))
    kind: Mapped[str] = mapped_column(String(8))
    __table_args__ = (UniqueConstraint('achievement_id','account_id',name='one_reaction_per_user'),)

def create_tables():
    ROOT.joinpath('data').mkdir(exist_ok=True)
    Base.metadata.create_all(engine)
