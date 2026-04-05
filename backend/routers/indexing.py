import threading
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import database as _db_module
from database import get_db
from indexer import run_indexing, get_index_state

router = APIRouter(prefix="/api/index", tags=["indexing"])


class IndexRequest(BaseModel):
    directory: str
    force_reindex: bool = False


@router.post("/start")
def start_indexing(data: IndexRequest, db: Session = Depends(get_db)):
    state = get_index_state()
    if state["running"]:
        raise HTTPException(status_code=409, detail="Indexing already in progress")

    import os
    if not os.path.isdir(data.directory):
        raise HTTPException(status_code=400, detail="Directory does not exist")

    # Run indexing in a background thread with its own DB session
    def _run():
        session = _db_module.SessionLocal()
        try:
            run_indexing(data.directory, session, data.force_reindex)
        finally:
            session.close()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    return {"ok": True, "message": f"Indexing started for: {data.directory}"}


@router.get("/status")
def indexing_status():
    return get_index_state()
