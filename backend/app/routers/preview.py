"""Preview router: generate a quick SVG preview of the current design."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..schemas import Design
from ..exporters.svg import export_svg

router = APIRouter()


@router.post("/preview")
async def preview_design(design: Design):
    """Generate a 2D SVG preview of the design."""
    svg = export_svg(design)
    return Response(content=svg, media_type="image/svg+xml")
