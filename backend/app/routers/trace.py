"""Trace router: upload image and get tool outlines."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ..config import PAPER_SIZES_MM, settings
from ..cv.pipeline import run_trace, run_rectify_with_corners
from ..cv.tool_detect import auto_rotate_angle, detect_tool_at_point, detect_tools, merge_tool_outlines, resolve_trace_engine, split_tool_outline, trace_engine_status
from ..schemas import ManualRectifyRequest, Point, RetraceResult, ToolOutline, TraceEngine, TraceEngineInfo, TraceResult

router = APIRouter()


@router.get("/trace-engines", response_model=list[TraceEngineInfo])
async def list_trace_engines():
    return trace_engine_status()


class RetraceRequest(BaseModel):
    rectified_image_url: str
    scale_mm_per_px: float
    smoothing: float = 0.3
    trace_engine: TraceEngine = "hybrid"


@router.post("/retrace", response_model=RetraceResult)
async def retrace_image(req: RetraceRequest):
    import cv2
    filename = req.rectified_image_url.split("/")[-1]
    filepath = settings.data_dir / "images" / filename
    img = cv2.imread(str(filepath))
    if img is None:
        raise HTTPException(status_code=400, detail=f"Could not load image: {filename}")
    try:
        outlines = detect_tools(
            img,
            req.scale_mm_per_px,
            smoothing=req.smoothing,
            engine=req.trace_engine,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {
        "outlines": outlines,
        "trace_engine": req.trace_engine,
        "trace_engine_used": resolve_trace_engine(req.trace_engine),
    }


@router.post("/trace", response_model=TraceResult)
async def trace_image(
    file: UploadFile = File(...),
    paper_size: str = Form("letter"),
    smoothing: float = Form(0.3),
    trace_engine: TraceEngine = Form("hybrid"),
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
        result, _rect_filename, orig_filename = run_trace(
            image_bytes, paper_size, smoothing=smoothing, trace_engine=trace_engine  # type: ignore[arg-type]
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # Set the original image URL for manual corner adjustment.
    result.original_image_url = f"/data/images/{orig_filename}"
    # If scale is 0, paper wasn't detected.
    result.paper_detected = result.scale_mm_per_px > 0

    return result


@router.post("/rectify", response_model=TraceResult)
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
            req.original_image_url,
            req.corners,
            req.paper_size,
            smoothing=req.smoothing,
            trace_engine=req.trace_engine,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    result.original_image_url = req.original_image_url
    result.paper_detected = True
    return result


class ClickDetectRequest(BaseModel):
    """Request to detect a tool at a clicked point on the rectified image."""
    rectified_image_url: str
    scale_mm_per_px: float
    click_x: int  # pixel x in rectified image
    click_y: int  # pixel y in rectified image
    smoothing: float = 0.3
    trace_engine: TraceEngine = "hybrid"


@router.post("/detect-at-point", response_model=None)
async def detect_at_point(req: ClickDetectRequest):
    """Detect a single tool outline at a clicked point.

    This implements Tooltrace-style click-based detection: the user clicks
    on a tool in the rectified image, and we detect the outline of just
    that tool using floodfill segmentation.
    """
    import cv2
    filename = req.rectified_image_url.split("/")[-1]
    filepath = settings.data_dir / "images" / filename
    img = cv2.imread(str(filepath))
    if img is None:
        raise HTTPException(status_code=400, detail=f"Could not load image: {filename}")

    try:
        outline = detect_tool_at_point(
            img,
            req.scale_mm_per_px,
            req.click_x,
            req.click_y,
            smoothing=req.smoothing,
            engine=req.trace_engine,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if outline is None:
        raise HTTPException(status_code=400, detail="No tool detected at that point.")

    return outline


class MergeOutlinesRequest(BaseModel):
    outlines: list[ToolOutline]


@router.post("/merge-outlines", response_model=ToolOutline)
async def merge_outlines(req: MergeOutlinesRequest):
    try:
        return merge_tool_outlines(req.outlines)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class SplitOutlineRequest(BaseModel):
    outline: ToolOutline
    start: Point
    end: Point
    gap_mm: float = 1.0


@router.post("/split-outline", response_model=list[ToolOutline])
async def split_outline(req: SplitOutlineRequest):
    try:
        return split_tool_outline(req.outline, req.start, req.end, req.gap_mm)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class AutoRotateRequest(BaseModel):
    """Request to auto-rotate a tool outline to align with axes."""
    outer: list[Point]


@router.post("/auto-rotate", response_model=None)
async def auto_rotate_tool(req: AutoRotateRequest):
    """Find the rotation angle that minimizes the bounding box.

    Like Tooltrace.ai's auto-rotate: finds the angle that aligns the tool's
    principal axis with the nearest coordinate axis (0°, 90°, 180°, or 270°).
    """
    if len(req.outer) < 3:
        raise HTTPException(status_code=400, detail="Need at least 3 points.")
    angle = auto_rotate_angle(req.outer)
    return {"rotation_deg": angle}
