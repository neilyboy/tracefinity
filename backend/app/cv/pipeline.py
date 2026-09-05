"""CV pipeline orchestration: paper detection -> tool tracing."""
from __future__ import annotations

import uuid

import cv2
import numpy as np

from ..config import settings
from ..schemas import PaperSize, Point, TraceEngine, TraceResult
from .paper_detect import detect_and_rectify, detect_paper_quad, rectify_paper
from .tool_detect import detect_tools, resolve_trace_engine


def run_trace(
    image_bytes: bytes,
    paper_size: PaperSize,
    smoothing: float = 0.3,
    trace_engine: TraceEngine = "hybrid",
) -> tuple[TraceResult, str, str]:
    """Run the full trace pipeline.

    Returns (TraceResult, rectified_image_filename, original_image_filename).
    Saves both the original and rectified images so the frontend can show
    the original with corner overlays for manual adjustment.
    """
    # Decode image from bytes.
    arr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image. Supported formats: JPG, PNG, WEBP.")

    img_id = str(uuid.uuid4())[:8]

    # Save the original image (for manual corner adjustment in the frontend).
    orig_filename = f"{img_id}_original.jpg"
    orig_filepath = settings.data_dir / "images" / orig_filename
    cv2.imwrite(str(orig_filepath), image, [cv2.IMWRITE_JPEG_QUALITY, 90])

    # Try to detect paper + rectify.
    try:
        result = detect_and_rectify(image, paper_size)
        rectified = result["rectified_image"]
        scale = result["scale_mm_per_px"]
        corners_px = result["corners_px"]
    except RuntimeError:
        # Paper not detected — return the original image with no rectification.
        # The frontend will prompt for manual corner placement.
        return (
            TraceResult(
                paper_size=paper_size,
                scale_mm_per_px=0.0,
                rectified_w_px=image.shape[1],
                rectified_h_px=image.shape[0],
                paper_corners_px=[],
                rectified_image_url=f"/data/images/{orig_filename}",
                outlines=[],
                trace_engine=trace_engine,
                trace_engine_used=resolve_trace_engine(trace_engine),
            ),
            orig_filename,
            orig_filename,
        )

    # Save rectified image for the frontend to display.
    rect_filename = f"{img_id}_rectified.png"
    rect_filepath = settings.data_dir / "images" / rect_filename
    cv2.imwrite(str(rect_filepath), rectified)

    # Detect tools.
    outlines = detect_tools(rectified, scale, smoothing=smoothing, engine=trace_engine)

    return (
        TraceResult(
            paper_size=paper_size,
            scale_mm_per_px=scale,
            rectified_w_px=result["w_px"],
            rectified_h_px=result["h_px"],
            paper_corners_px=[
                {"x": float(c[0]), "y": float(c[1])} for c in corners_px
            ],
            rectified_image_url=f"/data/images/{rect_filename}",
            outlines=outlines,
            trace_engine=trace_engine,
            trace_engine_used=resolve_trace_engine(trace_engine),
        ),
        rect_filename,
        orig_filename,
    )


def run_rectify_with_corners(
    original_image_url: str,
    corners: list[Point],
    paper_size: PaperSize,
    smoothing: float = 0.3,
    trace_engine: TraceEngine = "hybrid",
) -> tuple[TraceResult, str]:
    """Re-rectify an already-uploaded image using manually-specified corners.

    This is used when auto-detection fails and the user drags the corners
    to the correct positions in the frontend.
    """
    # Load the original image from disk.
    filename = original_image_url.split("/")[-1]
    filepath = settings.data_dir / "images" / filename
    image = cv2.imread(str(filepath))
    if image is None:
        raise ValueError(f"Could not load image: {filename}")

    corners_arr = np.array([[c.x, c.y] for c in corners], dtype=np.float32)
    rectified, scale = rectify_paper(image, corners_arr, paper_size)

    # Save rectified image.
    img_id = str(uuid.uuid4())[:8]
    rect_filename = f"{img_id}_rectified.png"
    rect_filepath = settings.data_dir / "images" / rect_filename
    cv2.imwrite(str(rect_filepath), rectified)

    # Detect tools.
    outlines = detect_tools(rectified, scale, smoothing=smoothing, engine=trace_engine)

    return (
        TraceResult(
            paper_size=paper_size,
            scale_mm_per_px=scale,
            rectified_w_px=rectified.shape[1],
            rectified_h_px=rectified.shape[0],
            paper_corners_px=[{"x": float(c.x), "y": float(c.y)} for c in corners],
            rectified_image_url=f"/data/images/{rect_filename}",
            outlines=outlines,
            trace_engine=trace_engine,
            trace_engine_used=resolve_trace_engine(trace_engine),
        ),
        rect_filename,
    )
