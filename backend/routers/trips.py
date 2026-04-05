from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db
from models import Trip, Photo

router = APIRouter(prefix="/api/trips", tags=["trips"])


class TripCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#3B82F6"


class TripUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


def trip_to_dict(trip: Trip, photo_count: int = 0) -> dict:
    return {
        "id": trip.id,
        "name": trip.name,
        "description": trip.description,
        "color": trip.color,
        "created_at": trip.created_at.isoformat() if trip.created_at else None,
        "photo_count": photo_count,
    }


@router.get("")
def list_trips(db: Session = Depends(get_db)):
    trips = db.query(Trip).order_by(Trip.created_at.desc()).all()
    result = []
    for trip in trips:
        count = db.query(Photo).filter(Photo.trip_id == trip.id).count()
        result.append(trip_to_dict(trip, count))
    return result


@router.post("")
def create_trip(data: TripCreate, db: Session = Depends(get_db)):
    trip = Trip(name=data.name, description=data.description, color=data.color)
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip_to_dict(trip)


@router.put("/{trip_id}")
def update_trip(trip_id: int, data: TripUpdate, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if data.name is not None:
        trip.name = data.name
    if data.description is not None:
        trip.description = data.description
    if data.color is not None:
        trip.color = data.color
    db.commit()
    db.refresh(trip)
    count = db.query(Photo).filter(Photo.trip_id == trip_id).count()
    return trip_to_dict(trip, count)


@router.delete("/{trip_id}")
def delete_trip(trip_id: int, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    # Unassign photos from this trip
    db.query(Photo).filter(Photo.trip_id == trip_id).update({"trip_id": None})
    db.delete(trip)
    db.commit()
    return {"ok": True}
