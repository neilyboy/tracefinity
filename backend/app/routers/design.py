"""Design CRUD router."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..fonts import list_fonts
from ..schemas import Design
from ..storage.db import delete_design, list_designs, load_design, save_design

router = APIRouter()


@router.get("")
async def get_designs():
    """List all saved designs."""
    return list_designs()


@router.get("/fonts/list")
async def get_fonts():
    """List all bundled fonts available for labels."""
    return list_fonts()


@router.get("/{design_id}")
async def get_design(design_id: str):
    design = load_design(design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="Design not found")
    return design


@router.put("")
async def create_or_update_design(design: Design):
    design_id = save_design(design)
    saved = load_design(design_id)
    return saved


@router.delete("/{design_id}")
async def remove_design(design_id: str):
    ok = delete_design(design_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Design not found")
    return {"ok": True}
