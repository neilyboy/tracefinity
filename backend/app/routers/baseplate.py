"""Baseplate designer router: CRUD + export + segment info."""
from __future__ import annotations

import io
import zipfile

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..schemas import BaseplateDesign
from ..storage.db import (
    save_baseplate_design,
    load_baseplate_design,
    list_baseplate_designs,
    delete_baseplate_design,
)

router = APIRouter()


@router.get("")
async def get_baseplate_designs():
    """List all saved baseplate designs."""
    return list_baseplate_designs()


@router.get("/{design_id}")
async def get_baseplate_design(design_id: str):
    design = load_baseplate_design(design_id)
    if design is None:
        raise HTTPException(status_code=404, detail="Baseplate design not found")
    return design


@router.put("")
async def create_or_update_baseplate_design(design: BaseplateDesign):
    design_id = save_baseplate_design(design)
    saved = load_baseplate_design(design_id)
    return saved


@router.delete("/{design_id}")
async def remove_baseplate_design(design_id: str):
    ok = delete_baseplate_design(design_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Baseplate design not found")
    return {"ok": True}


@router.post("/segment-info")
async def get_segment_info(design: BaseplateDesign):
    """Return segment information for UI display (segment count, sizes, cut lines)."""
    from ..gridfinity.baseplate_builder import get_segment_info
    return get_segment_info(design)


@router.post("/export")
async def export_baseplate(payload: dict):
    """Export a baseplate design to STL.

    If the baseplate has multiple segments, returns a ZIP file with
    one STL per segment plus a README.txt with assembly instructions.
    If single segment, returns a single STL file.
    """
    try:
        design = BaseplateDesign.model_validate(payload["design"])
        fmt = payload.get("fmt", "stl")
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid request: {e}")

    from ..gridfinity.baseplate_builder import generate_baseplate, get_segment_info
    from ..exporters.mesh import export_stl

    segments = generate_baseplate(design)
    info = get_segment_info(design)
    name = design.name or "baseplate"

    if len(segments) == 1:
        # Single STL
        stl_data = export_stl(segments[0])
        filename = f"{name}.stl"
        return Response(
            content=stl_data,
            media_type="model/stl",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # Multiple segments → ZIP
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, seg in enumerate(segments):
            stl_data = export_stl(seg)
            seg_num = i + 1
            zf.writestr(f"{name}_segment_{seg_num:02d}.stl", stl_data)

        # README with assembly instructions
        readme_lines = [
            f"Baseplate: {name}",
            f"Drawer: {design.params.drawer_w_mm}x{design.params.drawer_l_mm}mm",
            f"Grid: {info['grid_w']}x{info['grid_l']} cells ({info['plate_w']:.0f}x{info['plate_l']:.0f}mm)",
            f"Segments: {len(segments)}",
            "",
            "Assembly Instructions:",
            "1. Print all segments.",
            "2. Clean up any brims/rafts.",
            "3. Place segments in the drawer, starting from one corner.",
            "4. If using edge clips, slide the tab side into the slot side.",
            "5. Press down to seat the segments flat on the drawer floor.",
            "",
            "Segment Layout (top-down view, Y increases downward):",
        ]
        for seg in info["segments"]:
            readme_lines.append(
                f"  S{seg['index']}: {seg['cells_w']}x{seg['cells_h']} cells "
                f"= {seg['w']:.0f}x{seg['h']:.0f}mm at ({seg['x']:.0f}, {seg['y']:.0f})"
            )
        zf.writestr("README.txt", "\n".join(readme_lines))

    zip_data = zip_buffer.getvalue()
    filename = f"{name}_segments.zip"
    return Response(
        content=zip_data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
