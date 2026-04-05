import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

_data_dir = os.environ.get("TRIPVIZ_DATA_DIR", os.path.dirname(__file__))
DB_PATH = os.path.join(_data_dir, "tripviz.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _add_column_if_missing(conn, table: str, column: str, definition: str):
    """Safely add a column to an existing table if it doesn't exist."""
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    existing = {row[1] for row in rows}
    if column not in existing:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))


def _migrate(conn):
    """Apply incremental schema migrations for existing databases."""
    # Photos table additions for ML analysis
    _add_column_if_missing(conn, "photos", "activities", "TEXT")
    _add_column_if_missing(conn, "photos", "face_analyzed", "BOOLEAN DEFAULT 0")
    _add_column_if_missing(conn, "photos", "activity_analyzed", "BOOLEAN DEFAULT 0")
    # Notes, location tags, lens info
    _add_column_if_missing(conn, "photos", "lens_model", "VARCHAR(256)")
    _add_column_if_missing(conn, "photos", "notes", "VARCHAR(250)")
    _add_column_if_missing(conn, "photos", "tags", "TEXT")


def init_db():
    from models import Photo, Trip, Person, Face  # noqa: F401
    Base.metadata.create_all(bind=engine)
    # Run migrations for any pre-existing database
    with engine.connect() as conn:
        _migrate(conn)
        conn.commit()
