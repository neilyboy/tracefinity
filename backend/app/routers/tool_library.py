"""Tool library router: save/load/reuse individual tool outlines."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..schemas import ToolOutline
from ..storage.db import (
    delete_tool_from_library,
    list_tool_library,
    load_tool_from_library,
    save_tool_to_library,
)

router = APIRouter()


class SaveToolRequest(BaseModel):
    tool: ToolOutline
    name: str
    category: str = "General"


class ToolLibrarySummary(BaseModel):
    id: str
    name: str
    category: str
    bbox_w_mm: float
    bbox_h_mm: float
    created_at: str


@router.get("")
async def list_tools() -> list[ToolLibrarySummary]:
    """List all tools in the library."""
    return list_tool_library()


@router.get("/{tool_id}")
async def get_tool(tool_id: str) -> ToolOutline:
    tool = load_tool_from_library(tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found in library")
    return tool


@router.put("")
async def save_tool(req: SaveToolRequest) -> dict:
    tool_id = save_tool_to_library(req.tool, req.name, req.category)
    return {"id": tool_id, "ok": True}


@router.delete("/{tool_id}")
async def remove_tool(tool_id: str) -> dict:
    ok = delete_tool_from_library(tool_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tool not found")
    return {"ok": True}
