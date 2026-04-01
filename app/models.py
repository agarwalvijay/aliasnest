from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    masks = relationship("Mask", back_populates="user")
    domains = relationship("Domain", back_populates="user")


class Domain(Base):
    __tablename__ = "domains"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    verification_token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user = relationship("User", back_populates="domains")


class Mask(Base):
    __tablename__ = "masks"
    __table_args__ = (UniqueConstraint("local_part", "domain", name="uq_mask_local_part_domain"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    local_part: Mapped[str] = mapped_column(String(120), index=True)
    domain: Mapped[str] = mapped_column(String(255), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="masks")
    messages = relationship("Message", back_populates="mask")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mask_id: Mapped[int] = mapped_column(ForeignKey("masks.id"), index=True)
    from_addr: Mapped[str] = mapped_column(String(500))
    to_addr: Mapped[str] = mapped_column(String(500), index=True)
    subject: Mapped[str] = mapped_column(String(500), default="(No Subject)")
    text_preview: Mapped[str] = mapped_column(Text, default="")
    is_outbound: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    raw_path: Mapped[str] = mapped_column(String(600))
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    mask = relationship("Mask", back_populates="messages")
