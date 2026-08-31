"""Export router: generate and download files in various formats."""
from __future__ import annotations

import io
import os
import tempfile
import uuid
import zipfile

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
    if fmt in ("stl", "3mf", "step", "stl_flat", "stl_lid"):
        try:
            from ..gridfinity.generator import (
                generate_gridfinity, generate_flat_outlines,
                generate_gridfinity_segmented, get_tray_segment_info,
            )
            from ..gridfinity.lid_builder import generate_lid
            from ..gridfinity.segment_layout import render_segment_map
            from ..exporters.mesh import export_stl, export_3mf
            from ..exporters.step import export_step

            if fmt == "stl_flat":
                # Flat outline: just the tool cutouts as a thin flat plate
                # for test-fitting and two-tone printing
                solid = generate_flat_outlines(design)
                content = export_stl(solid)
                media = "model/stl"
                filename = f"{name}_{file_id}_flat.stl"
            elif fmt == "stl_lid":
                # Bin lid: snaps onto the bin, with Gridfinity base on bottom
                solid = generate_lid(design)
                content = export_stl(solid)
                media = "model/stl"
                filename = f"{name}_{file_id}_lid.stl"
            else:
                # Check if tray needs segmentation
                seg_info = get_tray_segment_info(design)
                if seg_info["needs_segment"]:
                    # Segmented tray → ZIP of multiple STLs
                    segments = generate_gridfinity_segmented(design)
                    zip_buffer = io.BytesIO()
                    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                        for i, seg in enumerate(segments):
                            stl_data = export_stl(seg)
                            zf.writestr(f"{name}_segment_{i+1:02d}.stl", stl_data)
                        # README
                        readme = [
                            f"Tray: {name}",
                            f"Grid: {seg_info['grid_w']}x{seg_info['grid_l']} cells ({seg_info['tray_w']:.0f}x{seg_info['tray_l']:.0f}mm)",
                            f"Segments: {len(segments)}",
                            "",
                            "Assembly Instructions:",
                            "1. Print all segments.",
                            "2. Clean up any brims/rafts.",
                            "3. If using edge clips, slide the tab side into the slot side.",
                            "4. Press together to seat the dovetail tabs.",
                            "",
                            "Segment Layout (top-down view, Y increases downward):",
                            "",
                        ]
                        # Visual ASCII map
                        for line in render_segment_map(
                            seg_info["grid_w"], seg_info["grid_l"],
                            seg_info.get("cuts_x", []), seg_info.get("cuts_y", []),
                        ):
                            readme.append(line)
                        readme.append("")
                        # Detailed per-segment dimensions
                        for seg in seg_info["segments"]:
                            readme.append(
                                f"  S{seg['index']}: {seg['cells_w']}x{seg['cells_h']} cells "
                                f"= {seg['w']:.0f}x{seg['h']:.0f}mm at ({seg['x']:.0f}, {seg['y']:.0f})"
                            )
                        zf.writestr("README.txt", "\n".join(readme))

                    zip_data = zip_buffer.getvalue()
                    filename = f"{name}_{file_id}_segments.zip"
                    return Response(
                        content=zip_data,
                        media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                    )

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


@router.post("/tray-segment-info")
async def tray_segment_info(design: Design):
    """Return segment information for tray UI display."""
    from ..gridfinity.generator import get_tray_segment_info
    return get_tray_segment_info(design)
