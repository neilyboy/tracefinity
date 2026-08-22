"""SQLite storage via SQLModel for saved designs."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Field, Session, SQLModel, create_engine, select

from ..config import settings


class DesignRecord(SQLModel, table=True):
    __tablename__ = "designs"

    id: str = Field(primary_key=True)
    name: str = "Untitled"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    design_json: str = ""  # full Design model serialized
    image_filename: str | None = None


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        db_path = settings.data_dir / "db" / "tracefinity.db"
        _engine = create_engine(f"sqlite:///{db_path}", echo=False, connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(_engine)
    return _engine


def save_design(design) -> str:
    """Save or update a design. Returns the design id."""
    from ..schemas import Design

    engine = get_engine()
    design_id = design.id or str(uuid.uuid4())
    design.id = design_id
    now = datetime.now(timezone.utc).isoformat()

    with Session(engine) as session:
        existing = session.get(DesignRecord, design_id)
        if existing:
            existing.name = design.name
            existing.design_json = design.model_dump_json()
            existing.updated_at = now
            existing.image_filename = design.image_filename
            session.add(existing)
        else:
            record = DesignRecord(
                id=design_id,
                name=design.name,
                design_json=design.model_dump_json(),
                image_filename=design.image_filename,
                created_at=now,
                updated_at=now,
            )
            session.add(record)
        session.commit()
    return design_id


def load_design(design_id: str):
    """Load a design by id. Returns a Design model or None."""
    from ..schemas import Design

    engine = get_engine()
    with Session(engine) as session:
        record = session.get(DesignRecord, design_id)
        if record is None:
            return None
        return Design.model_validate_json(record.design_json)


def list_designs() -> list[dict]:
    """Return summary list of all designs, newest first."""
    engine = get_engine()
    with Session(engine) as session:
        records = session.exec(select(DesignRecord).order_by(DesignRecord.updated_at.desc())).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
                "thumbnail_url": f"/api/designs/{r.id}/thumbnail" if r.image_filename else None,
            }
            for r in records
        ]


def delete_design(design_id: str) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(DesignRecord, design_id)
        if record is None:
            return False
        session.delete(record)
        session.commit()
        return True
