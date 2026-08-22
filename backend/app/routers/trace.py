"""Trace router: upload image and get tool outlines."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import PAPER_SIZES_MM, settings
from ..cv.pipeline import run_trace, run_rectify_with_corners
from ..schemas import ManualRectifyRequest

router = APIRouter()


@router.post("/trace", response_model=None)
async def trace_image(
    file: UploadFile = File(...),
    paper_size: str = Form("letter"),
):
    """Upload a photo of tools on paper; returns detected outlines + rectified image.

    If paper detection fails, returns the original image with paper_detected=false
    and empty outlines. The frontend should then prompt for manual corner placement
    and call /api/rectify.
    """
    if paper_size not in PAPER_SIZES_MM:
        raise HTTPException(status_code=400, detail=f"paper_size must be one of {list(PAPER_SIZES_MM)}")

    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")

    image_bytes = await file.read()
    if len(image_bytes) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Image too large (max {settings.max_upload_mb}MB).")

    try:
        result, _rect_filename, orig_filename = run_trace(image_bytes, paper_size)  # type: ignore[arg-type]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Set the original image URL for manual corner adjustment.
    result.original_image_url = f"/data/images/{orig_filename}"
    # If scale is 0, paper wasn't detected.
    result.paper_detected = result.scale_mm_per_px > 0

    return result


@router.post("/rectify", response_model=None)
async def rectify_with_corners(req: ManualRectifyRequest):
    """Re-rectify an already-uploaded image using manually-specified paper corners.

    Called by the frontend when auto-detection fails and the user drags
    the 4 corners to the correct positions on the original image.
    """
    if req.paper_size not in PAPER_SIZES_MM:
        raise HTTPException(status_code=400, detail=f"paper_size must be one of {list(PAPER_SIZES_MM)}")
    if len(req.corners) != 4:
        raise HTTPException(status_code=400, detail="Exactly 4 corners are required.")

    try:
        result, _filename = run_rectify_with_corners(
            req.original_image_url, req.corners, req.paper_size
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    result.original_image_url = req.original_image_url
    result.paper_detected = True
    return result
