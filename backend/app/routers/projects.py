"""Project folder router: CRUD + export/import for folder trees."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..storage.db import (
    create_folder,
    list_folders,
    rename_folder,
    delete_folder,
    move_folder,
    move_design,
    move_baseplate_design,
    rename_design,
    rename_baseplate_design,
    export_folder_tree,
    import_folder_tree,
)

router = APIRouter()


class CreateFolderRequest(BaseModel):
    name: str
    parent_id: str | None = None


class RenameRequest(BaseModel):
    name: str


class MoveRequest(BaseModel):
    parent_id: str | None = None


class ImportTreeRequest(BaseModel):
    data: dict
    parent_id: str | None = None


@router.get("/folders")
async def get_folders():
    """List all project folders."""
    return list_folders()


@router.post("/folders")
async def create_folder_endpoint(req: CreateFolderRequest):
    """Create a new folder."""
    return create_folder(req.name, req.parent_id)


@router.patch("/folders/{folder_id}")
async def rename_folder_endpoint(folder_id: str, req: RenameRequest):
    ok = rename_folder(folder_id, req.name)
    if not ok:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"ok": True}


@router.delete("/folders/{folder_id}")
async def delete_folder_endpoint(folder_id: str):
    ok = delete_folder(folder_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Folder not found")
    return {"ok": True}


@router.post("/folders/{folder_id}/move")
async def move_folder_endpoint(folder_id: str, req: MoveRequest):
    ok = move_folder(folder_id, req.parent_id)
    if not ok:
        raise HTTPException(status_code=400, detail="Cannot move folder (invalid target or cycle detected)")
    return {"ok": True}


# --- Move/rename projects ---

@router.post("/designs/{design_id}/move")
async def move_design_endpoint(design_id: str, req: MoveRequest):
    ok = move_design(design_id, req.parent_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Design not found")
    return {"ok": True}


@router.patch("/designs/{design_id}/name")
async def rename_design_endpoint(design_id: str, req: RenameRequest):
    ok = rename_design(design_id, req.name)
    if not ok:
        raise HTTPException(status_code=404, detail="Design not found")
    return {"ok": True}


@router.post("/baseplates/{design_id}/move")
async def move_baseplate_endpoint(design_id: str, req: MoveRequest):
    ok = move_baseplate_design(design_id, req.parent_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Baseplate not found")
    return {"ok": True}


@router.patch("/baseplates/{design_id}/name")
async def rename_baseplate_endpoint(design_id: str, req: RenameRequest):
    ok = rename_baseplate_design(design_id, req.name)
    if not ok:
        raise HTTPException(status_code=404, detail="Baseplate not found")
    return {"ok": True}


# --- Folder tree export/import ---

@router.get("/folders/export")
async def export_folder_tree_endpoint(folder_id: str | None = None):
    """Export a folder tree (or entire root if no folder_id)."""
    return export_folder_tree(folder_id)


@router.get("/folders/{folder_id}/export")
async def export_specific_folder_endpoint(folder_id: str):
    """Export a specific folder and all its contents."""
    return export_folder_tree(folder_id)


@router.post("/folders/import")
async def import_folder_tree_endpoint(req: ImportTreeRequest):
    """Import a folder tree. Returns the ID of the imported root folder."""
    if not req.data or "type" not in req.data:
        raise HTTPException(status_code=400, detail="Invalid folder tree data")
    folder_id = import_folder_tree(req.data, req.parent_id)
    return {"ok": True, "folder_id": folder_id}
