"""SQLite storage via SQLModel for saved designs, folders, and tool library."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlmodel import Field, Session, SQLModel, create_engine, select
from sqlalchemy import text

from ..config import settings


class DesignRecord(SQLModel, table=True):
    __tablename__ = "designs"

    id: str = Field(primary_key=True)
    name: str = "Untitled"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    design_json: str = ""  # full Design model serialized
    image_filename: str | None = None
    folder_id: str | None = None


class ToolLibraryRecord(SQLModel, table=True):
    __tablename__ = "tool_library"

    id: str = Field(primary_key=True)
    name: str = "Unnamed Tool"
    category: str = "General"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    tool_json: str = ""  # ToolOutline serialized
    # Bounding box for quick display
    bbox_w_mm: float = 0.0
    bbox_h_mm: float = 0.0


class ProjectFolderRecord(SQLModel, table=True):
    __tablename__ = "project_folders"

    id: str = Field(primary_key=True)
    name: str = "New Folder"
    parent_id: str | None = None  # None = root level
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class BaseplateDesignRecord(SQLModel, table=True):
    __tablename__ = "baseplate_designs"

    id: str = Field(primary_key=True)
    name: str = "Untitled Baseplate"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    design_json: str = ""
    folder_id: str | None = None


_engine = None


def get_engine():
    global _engine
    if _engine is None:
        db_path = settings.data_dir / "db" / "tracefinity.db"
        _engine = create_engine(f"sqlite:///{db_path}", echo=False, connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(_engine)
        _migrate_add_folder_id(_engine)
    return _engine


def _migrate_add_folder_id(engine):
    """Add folder_id column to designs and baseplate_designs if missing."""
    with engine.connect() as conn:
        for table_name in ("designs", "baseplate_designs"):
            cols = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
            col_names = {c[1] for c in cols}
            if "folder_id" not in col_names:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN folder_id TEXT"))
                conn.commit()


# ---------------------------------------------------------------------------
# Design (tray) CRUD
# ---------------------------------------------------------------------------

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
                "folder_id": r.folder_id,
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


def rename_design(design_id: str, name: str) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(DesignRecord, design_id)
        if record is None:
            return False
        record.name = name
        record.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(record)
        session.commit()
        return True


def move_design(design_id: str, folder_id: str | None) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(DesignRecord, design_id)
        if record is None:
            return False
        record.folder_id = folder_id
        record.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(record)
        session.commit()
        return True


# ---------------------------------------------------------------------------
# Tool Library CRUD
# ---------------------------------------------------------------------------

def save_tool_to_library(tool, name: str, category: str = "General") -> str:
    """Save a tool outline to the library. Returns the tool id."""
    from ..schemas import ToolOutline
    import numpy as np

    engine = get_engine()
    tool_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Compute bounding box
    xs = [p.x for p in tool.outer]
    ys = [p.y for p in tool.outer]
    bbox_w = max(xs) - min(xs) if xs else 0
    bbox_h = max(ys) - min(ys) if ys else 0

    with Session(engine) as session:
        record = ToolLibraryRecord(
            id=tool_id,
            name=name,
            category=category,
            tool_json=tool.model_dump_json(),
            bbox_w_mm=bbox_w,
            bbox_h_mm=bbox_h,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.commit()
    return tool_id


def load_tool_from_library(tool_id: str):
    """Load a tool from the library. Returns a ToolOutline or None."""
    from ..schemas import ToolOutline

    engine = get_engine()
    with Session(engine) as session:
        record = session.get(ToolLibraryRecord, tool_id)
        if record is None:
            return None
        return ToolOutline.model_validate_json(record.tool_json)


def list_tool_library() -> list[dict]:
    """Return summary list of all tools in the library, grouped by category."""
    engine = get_engine()
    with Session(engine) as session:
        records = session.exec(
            select(ToolLibraryRecord).order_by(ToolLibraryRecord.category, ToolLibraryRecord.name)
        ).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "category": r.category,
                "bbox_w_mm": r.bbox_w_mm,
                "bbox_h_mm": r.bbox_h_mm,
                "created_at": r.created_at,
            }
            for r in records
        ]


def delete_tool_from_library(tool_id: str) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(ToolLibraryRecord, tool_id)
        if record is None:
            return False
        session.delete(record)
        session.commit()
        return True


# ---------------------------------------------------------------------------
# Baseplate Design CRUD
# ---------------------------------------------------------------------------

def save_baseplate_design(design) -> str:
    """Save or update a baseplate design. Returns the design id."""
    engine = get_engine()
    design_id = design.id or str(uuid.uuid4())
    design.id = design_id
    now = datetime.now(timezone.utc).isoformat()

    with Session(engine) as session:
        existing = session.get(BaseplateDesignRecord, design_id)
        if existing:
            existing.name = design.name
            existing.design_json = design.model_dump_json()
            existing.updated_at = now
            session.add(existing)
        else:
            record = BaseplateDesignRecord(
                id=design_id,
                name=design.name,
                design_json=design.model_dump_json(),
                created_at=now,
                updated_at=now,
            )
            session.add(record)
        session.commit()
    return design_id


def load_baseplate_design(design_id: str):
    """Load a baseplate design by id. Returns a BaseplateDesign or None."""
    from ..schemas import BaseplateDesign
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(BaseplateDesignRecord, design_id)
        if record is None:
            return None
        return BaseplateDesign.model_validate_json(record.design_json)


def list_baseplate_designs() -> list[dict]:
    """Return summary list of all baseplate designs, newest first."""
    engine = get_engine()
    with Session(engine) as session:
        records = session.exec(
            select(BaseplateDesignRecord).order_by(BaseplateDesignRecord.updated_at.desc())
        ).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
                "folder_id": r.folder_id,
            }
            for r in records
        ]


def delete_baseplate_design(design_id: str) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(BaseplateDesignRecord, design_id)
        if record is None:
            return False
        session.delete(record)
        session.commit()
        return True


def rename_baseplate_design(design_id: str, name: str) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(BaseplateDesignRecord, design_id)
        if record is None:
            return False
        record.name = name
        record.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(record)
        session.commit()
        return True


def move_baseplate_design(design_id: str, folder_id: str | None) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(BaseplateDesignRecord, design_id)
        if record is None:
            return False
        record.folder_id = folder_id
        record.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(record)
        session.commit()
        return True


# ---------------------------------------------------------------------------
# Project Folder CRUD
# ---------------------------------------------------------------------------

def create_folder(name: str, parent_id: str | None = None) -> dict:
    """Create a new folder. Returns the folder dict."""
    engine = get_engine()
    folder_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with Session(engine) as session:
        record = ProjectFolderRecord(
            id=folder_id,
            name=name,
            parent_id=parent_id,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        session.commit()
    return {"id": folder_id, "name": name, "parent_id": parent_id, "created_at": now, "updated_at": now}


def list_folders() -> list[dict]:
    """Return all folders."""
    engine = get_engine()
    with Session(engine) as session:
        records = session.exec(
            select(ProjectFolderRecord).order_by(ProjectFolderRecord.name)
        ).all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "parent_id": r.parent_id,
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            }
            for r in records
        ]


def rename_folder(folder_id: str, name: str) -> bool:
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(ProjectFolderRecord, folder_id)
        if record is None:
            return False
        record.name = name
        record.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(record)
        session.commit()
        return True


def delete_folder(folder_id: str) -> bool:
    """Delete a folder. Projects inside are moved to root (not deleted).
    Subfolders are recursively deleted."""
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(ProjectFolderRecord, folder_id)
        if record is None:
            return False

        # Recursively delete subfolders
        def _delete_recursive(fid: str):
            subfolders = session.exec(
                select(ProjectFolderRecord).where(ProjectFolderRecord.parent_id == fid)
            ).all()
            for sub in subfolders:
                _delete_recursive(sub.id)
                session.delete(sub)

        _delete_recursive(folder_id)

        # Move projects in this folder to root (folder_id = None)
        for dr in session.exec(select(DesignRecord).where(DesignRecord.folder_id == folder_id)).all():
            dr.folder_id = None
            session.add(dr)
        for br in session.exec(select(BaseplateDesignRecord).where(BaseplateDesignRecord.folder_id == folder_id)).all():
            br.folder_id = None
            session.add(br)

        session.delete(record)
        session.commit()
        return True


def move_folder(folder_id: str, parent_id: str | None) -> bool:
    """Move a folder to a new parent (None = root). Prevents cycles."""
    if folder_id == parent_id:
        return False
    engine = get_engine()
    with Session(engine) as session:
        record = session.get(ProjectFolderRecord, folder_id)
        if record is None:
            return False
        # Prevent moving into own descendant
        if parent_id is not None:
            cursor = parent_id
            while cursor is not None:
                if cursor == folder_id:
                    return False  # would create a cycle
                parent_record = session.get(ProjectFolderRecord, cursor)
                cursor = parent_record.parent_id if parent_record else None
        record.parent_id = parent_id
        record.updated_at = datetime.now(timezone.utc).isoformat()
        session.add(record)
        session.commit()
        return True


# ---------------------------------------------------------------------------
# Folder Export / Import
# ---------------------------------------------------------------------------

def export_folder_tree(folder_id: str | None = None) -> dict:
    """Recursively export a folder and all its contents as a nested dict.

    If folder_id is None, exports everything at root level (folders + projects).
    The returned dict is JSON-serializable and can be imported on another instance.
    """
    engine = get_engine()
    with Session(engine) as session:
        return _export_node(session, folder_id)


def _export_node(session, folder_id: str | None) -> dict:
    """Export a single folder node with all its children."""
    # Get subfolders
    subfolders = session.exec(
        select(ProjectFolderRecord).where(ProjectFolderRecord.parent_id == folder_id)
    ).all()

    # Get tray designs in this folder
    trays = session.exec(
        select(DesignRecord).where(DesignRecord.folder_id == folder_id)
    ).all()

    # Get baseplate designs in this folder
    baseplates = session.exec(
        select(BaseplateDesignRecord).where(BaseplateDesignRecord.folder_id == folder_id)
    ).all()

    folder_name = None
    if folder_id is not None:
        fr = session.get(ProjectFolderRecord, folder_id)
        folder_name = fr.name if fr else None

    return {
        "type": "folder",
        "version": 1,
        "name": folder_name,
        "folders": [_export_node(session, sf.id) for sf in subfolders],
        "trays": [
            {
                "type": "tray",
                "name": t.name,
                "design": json.loads(t.design_json),
            }
            for t in trays
        ],
        "baseplates": [
            {
                "type": "baseplate",
                "name": b.name,
                "design": json.loads(b.design_json),
            }
            for b in baseplates
        ],
    }


def import_folder_tree(data: dict, parent_id: str | None = None) -> str | None:
    """Import a folder tree dict. Creates folders and projects as needed.

    Returns the ID of the imported root folder (or None if data has no folder name).
    """
    engine = get_engine()

    # Determine the folder name — if data has a name, create a folder for it
    folder_name = data.get("name")
    target_folder_id = parent_id

    if folder_name:
        folder = create_folder(folder_name, parent_id)
        target_folder_id = folder["id"]

    # Import subfolders
    for sub in data.get("folders", []):
        import_folder_tree(sub, target_folder_id)

    # Import tray designs
    for tray_data in data.get("trays", []):
        from ..schemas import Design
        design = Design.model_validate(tray_data["design"])
        design.id = None  # fresh ID
        if not design.name.endswith(" (imported)"):
            design.name = f"{design.name} (imported)"
        design_id = save_design(design)
        move_design(design_id, target_folder_id)

    # Import baseplate designs
    for bp_data in data.get("baseplates", []):
        from ..schemas import BaseplateDesign
        design = BaseplateDesign.model_validate(bp_data["design"])
        design.id = None  # fresh ID
        if not design.name.endswith(" (imported)"):
            design.name = f"{design.name} (imported)"
        design_id = save_baseplate_design(design)
        move_baseplate_design(design_id, target_folder_id)

    return target_folder_id
