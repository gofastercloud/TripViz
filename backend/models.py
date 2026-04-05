from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Boolean, LargeBinary, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    color: Mapped[str] = mapped_column(String(7), default="#3B82F6")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    photos: Mapped[list["Photo"]] = relationship("Photo", back_populates="trip")


class Person(Base):
    __tablename__ = "people"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    faces: Mapped[list["Face"]] = relationship("Face", back_populates="person")


class Face(Base):
    __tablename__ = "faces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    photo_id: Mapped[int] = mapped_column(Integer, ForeignKey("photos.id", ondelete="CASCADE"), nullable=False, index=True)
    # Normalized bounding box (0.0 – 1.0 relative to image dimensions)
    bbox_x: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_w: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_h: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    # 128-dim float32 embedding serialized as raw bytes (512 bytes)
    embedding: Mapped[Optional[bytes]] = mapped_column(LargeBinary, nullable=True)
    person_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("people.id", ondelete="SET NULL"), nullable=True, index=True)

    photo: Mapped["Photo"] = relationship("Photo", back_populates="faces")
    person: Mapped[Optional[Person]] = relationship("Person", back_populates="faces")


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    file_path: Mapped[str] = mapped_column(String(2048), unique=True, nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    date_taken: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    date_indexed: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    camera_make: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    camera_model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    orientation: Mapped[int] = mapped_column(Integer, default=1)
    has_thumbnail: Mapped[bool] = mapped_column(Boolean, default=False)
    trip_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("trips.id"), nullable=True, index=True)
    lens_model: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(250), nullable=True)
    tags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list of location tags
    # ML analysis
    activities: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list of strings
    face_analyzed: Mapped[bool] = mapped_column(Boolean, default=False)
    activity_analyzed: Mapped[bool] = mapped_column(Boolean, default=False)

    trip: Mapped[Optional[Trip]] = relationship("Trip", back_populates="photos")
    faces: Mapped[list[Face]] = relationship("Face", back_populates="photo", cascade="all, delete-orphan")
