"""Pydantic schemas shared between API and internal services."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PaperSize = Literal["letter", "a4"]
ExportFormat = Literal["svg", "dxf", "stl", "3mf", "step"]
OutputMode = Literal["foam", "gridfinity"]


class Point(BaseModel):
    x: float
    y: float


class ToolOutline(BaseModel):
    """A single traced tool, coordinates in millimetres relative to the paper origin."""

    id: str
    outer: list[Point] = Field(description="Outer boundary polygon, ordered, in mm")
    holes: list[list[Point]] = Field(default_factory=list, description="Inner hole polygons in mm")
    label: str = ""
    # Per-tool overrides (None = use bin defaults)
    margin_mm: float | None = None
    pocket_depth_mm: float | None = None
    visible: bool = True


class BinParams(BaseModel):
    """Gridfinity bin configuration."""

    output_mode: OutputMode = "gridfinity"
    # Grid size in 42mm units
    grid_w: int = Field(2, ge=1, le=20)
    grid_l: int = Field(2, ge=1, le=20)
    # Height in 7mm units
    height_units: int = Field(3, ge=1, le=20)
    # Wall/base thickness in mm
    wall_thickness_mm: float = Field(1.2, gt=0)
    base_thickness_mm: float = Field(0.8, gt=0)
    # Default pocket depth (mm) - depth of tool cutout
    pocket_depth_mm: float = Field(15.0, gt=0)
    # Default margin around each tool (mm) - clearance so tool fits
    tool_margin_mm: float = Field(1.0, ge=0)
    # Features
    magnet_holes: bool = True
    screw_holes: bool = False
    scoop: bool = True
    scoop_depth_mm: float = Field(8.0, gt=0)
    tabs: Literal["none", "split", "aligned"] = "none"
    lip: bool = True
    label_tab: bool = False
    # Dividers: list of (x_unit_fraction, y_unit_fraction) creating compartment walls.
    # Simplified: number of compartments along x and y.
    compartments_x: int = Field(1, ge=1, le=10)
    compartments_y: int = Field(1, ge=1, le=10)
    # Foam sheet thickness (foam mode only)
    foam_thickness_mm: float = Field(10.0, gt=0)
    # Rounded corners on pockets (mm radius)
    pocket_corner_radius_mm: float = Field(2.0, ge=0)


class Design(BaseModel):
    """A complete design: outlines + bin params."""

    id: str | None = None
    name: str = "Untitled"
    paper_size: PaperSize = "letter"
    # Scale: mm per pixel in the rectified image
    scale_mm_per_px: float = 0.0
    # Rectified image dimensions in pixels
    rectified_w_px: int = 0
    rectified_h_px: int = 0
    # Detected paper corners in original image (px), for re-calibration display
    paper_corners_px: list[Point] = Field(default_factory=list)
    outlines: list[ToolOutline] = Field(default_factory=list)
    params: BinParams = Field(default_factory=BinParams)
    image_filename: str | None = None


class TraceRequest(BaseModel):
    paper_size: PaperSize = "letter"


class TraceResult(BaseModel):
    paper_size: PaperSize
    scale_mm_per_px: float
    rectified_w_px: int
    rectified_h_px: int
    paper_corners_px: list[Point]
    rectified_image_url: str
    original_image_url: str = ""
    outlines: list[ToolOutline]
    # True if paper was auto-detected; False if user needs to set corners manually.
    paper_detected: bool = True


class ManualRectifyRequest(BaseModel):
    """Request to re-rectify an image with manually-specified paper corners."""

    original_image_url: str
    corners: list[Point]  # 4 corners in original image pixel coords
    paper_size: PaperSize = "letter"


class ExportRequest(BaseModel):
    design: Design
    fmt: ExportFormat


class ExportResponse(BaseModel):
    filename: str
    download_url: str


class DesignSummary(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str
    thumbnail_url: str | None = None


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
