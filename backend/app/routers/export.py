"""Export router: generate and download files in various formats."""
from __future__ import annotations

import os
import tempfile
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from ..config import settings
from ..schemas import Design, ExportFormat
from ..exporters.svg import export_svg
from ..exporters.dxf import export_dxf

router = APIRouter()


@router.post("/export")
async def export_design(payload: dict):
    """Export a design to the requested format.

    Accepts a JSON body with 'design' and 'fmt' fields.
    Returns the file as a download.
    """
    try:
        design = Design.model_validate(payload["design"])
        fmt: ExportFormat = payload["fmt"]
    except (KeyError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid request: {e}")

    name = design.name or "tracefinity"
    file_id = str(uuid.uuid4())[:8]

    if fmt == "svg":
        content = export_svg(design)
        filename = f"{name}_{file_id}.svg"
        return Response(
            content=content,
            media_type="image/svg+xml",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    if fmt == "dxf":
        content = export_dxf(design)
        filename = f"{name}_{file_id}.dxf"
        return Response(
            content=content,
            media_type="application/dxf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # 3D formats require build123d
    if fmt in ("stl", "3mf", "step", "stl_flat"):
        try:
            from ..gridfinity.generator import generate_gridfinity, generate_flat_outlines
            from ..exporters.mesh import export_stl, export_3mf
            from ..exporters.step import export_step

            if fmt == "stl_flat":
                # Flat outline: just the tool cutouts as a thin flat plate
                # for test-fitting and two-tone printing
                solid = generate_flat_outlines(design)
                content = export_stl(solid)
                media = "model/stl"
                filename = f"{name}_{file_id}_flat.stl"
            else:
                solid = generate_gridfinity(design)

                if fmt == "stl":
                    content = export_stl(solid)
                    media = "model/stl"
                elif fmt == "3mf":
                    content = export_3mf(solid)
                    media = "model/3mf"
                else:  # step
                    content = export_step(solid)
                    media = "application/step"

                filename = f"{name}_{file_id}.{fmt}"

            return Response(
                content=content,
                media_type=media,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"3D generation failed: {e}")

    raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")
