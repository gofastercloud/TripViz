from datetime import datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    color: Mapped[str] = mapped_column(String(7), default="#3B82F6")  # hex color
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    photos: Mapped[list["Photo"]] = relationship("Photo", back_populates="trip")


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

    trip: Mapped[Optional[Trip]] = relationship("Trip", back_populates="photos")
