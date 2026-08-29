"""Pydantic schemas shared between API and internal services."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

PaperSize = Literal["letter", "a4"]
ExportFormat = Literal["svg", "dxf", "stl", "3mf", "step", "stl_flat", "stl_lid"]
OutputMode = Literal["foam", "gridfinity"]


class Point(BaseModel):
    x: float
    y: float


class FingerHole(BaseModel):
    """A user-placed finger hole (spherical pocket for lifting tools out)."""
    x: float  # position in mm relative to paper origin
    y: float
    radius_mm: float = 15.0  # default 15mm radius (Tooltrace.ai default)
    depth_mm: float | None = None  # None = use bin pocket depth


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
    # Rotation angle in degrees (user can rotate tool to align with axes)
    rotation_deg: float = 0.0
    # User-placed finger holes for this tool
    finger_holes: list[FingerHole] = Field(default_factory=list)
    # Path smoothing tension (0.0 = sharp polygon, 0.3 = balanced, 1.0 = max curves)
    smoothing: float = 0.3
    # Pocket bottom shape: flat, spherical (bowl), cylindrical (rounded along length)
    pocket_shape: str = "flat"  # "flat", "spherical", "cylindrical"
    # Radius of the spherical/cylindrical bottom curve (mm). None = use pocket_depth
    pocket_bottom_radius_mm: float | None = None


class TextLabel(BaseModel):
    """A movable text label placed on the bin surface or flat output.

    Labels can be cutout (engraved into the surface) or raised (embossed above).
    They sit on the top surface of the bin, accounting for the stacking lip.
    Multiple labels can be placed — e.g. one per tool ("screwdriver", "extension").

    target: 'tray' = label appears on the 3D bin/tray export
            'flat' = label appears on the flat STL test-fit layer
    """
    id: str
    text: str = "Label"
    x: float = 0.0  # position in bin-local mm (relative to bin top-left)
    y: float = 0.0
    font_size_mm: float = 6.0
    rotation_deg: float = 0.0
    depth_mm: float = 0.6  # emboss depth
    cutout: bool = True  # True = engraved into surface, False = raised above surface
    target: str = "tray"  # 'tray' or 'flat' — which export the label appears on
    font: str = "Arial"  # font family name or bundled font key (e.g. "Lato-Stenciled")


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
    tool_margin_mm: float = Field(2.0, ge=0)
    # Features
    magnet_holes: bool = True
    screw_holes: bool = False
    scoop: bool = False
    scoop_depth_mm: float = Field(8.0, gt=0)
    # Finger scoop: cylindrical cutout at tool edge for easy tool removal
    # (like Tooltrace.ai finger notches). Default 20mm diameter.
    finger_scoop: bool = False
    finger_scoop_diameter_mm: float = Field(20.0, gt=0)
    tabs: Literal["none", "split", "aligned"] = "none"
    lip: bool = False
    label_tab: bool = False
    # Label text (rendered as embossed or engraved text on the bin)
    label_text: str = ""
    label_font_size_mm: float = Field(6.0, gt=0)
    label_depth_mm: float = Field(0.6, gt=0)
    label_engrave: bool = False  # False=embossed (raised), True=engraved (cut in)
    label_tab_inset: bool = False  # False=protruding tab, True=inset tapered pocket (no supports)
    # Dividers: list of (x_unit_fraction, y_unit_fraction) creating compartment walls.
    # Simplified: number of compartments along x and y.
    compartments_x: int = Field(1, ge=1, le=10)
    compartments_y: int = Field(1, ge=1, le=10)
    divider_thickness_mm: float = Field(1.2, gt=0, le=5)
    divider_taper_deg: float = Field(0, ge=0, le=30)  # wall taper for easier access
    divider_chamfer_mm: float = Field(0, ge=0, le=2)  # chamfer on top edges
    divider_corner_radius_mm: float = Field(0, ge=0, le=3)  # rounded bottom corners
    # Foam sheet thickness (foam mode only)
    foam_thickness_mm: float = Field(10.0, gt=0)
    # Rounded corners on pockets (mm radius)
    pocket_corner_radius_mm: float = Field(2.0, ge=0)
    # Chamfer on the top edge of each pocket (mm). 0 = sharp edge.
    # Creates a beveled edge at the top of the pocket for easier tool insertion.
    cutout_chamfer_mm: float = Field(0.0, ge=0, le=3.0)
    # Rounded bottom radius for pockets (mm). 0 = flat bottom.
    # Creates a rounded transition from the pocket walls to the floor.
    pocket_bottom_radius_mm: float = Field(0.0, ge=0)
    # Flat STL plate thickness (for test-fit / two-tone insert layer)
    flat_thickness_mm: float = Field(2.0, gt=0, le=20)
    # When True, the tray is modified to accept a flat insert:
    # - Top surface inside the lip is recessed by flat_thickness_mm
    # - Flat STL is sized to fit inside the lip walls
    # - Finger scoops are cut through the flat STL
    use_flat_insert: bool = False


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
    labels: list[TextLabel] = Field(default_factory=list)
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


# ---------------------------------------------------------------------------
# Baseplate Designer schemas
# ---------------------------------------------------------------------------

class DrawerCutout(BaseModel):
    """A cutout/obstruction in the drawer floor that the baseplate must work around.

    Coordinates are in mm relative to the drawer top-left corner (SVG Y-down).
    """
    id: str
    shape: str = "rect"  # shape type from AddShapeDialog
    outer: list[Point] = Field(default_factory=list, description="Polygon points in mm")
    x: float = 0.0  # center X
    y: float = 0.0  # center Y
    w: float = 10.0  # bounding box width
    h: float = 10.0  # bounding box height
    rotation_deg: float = 0.0
    # Cutout depth type: "through" = cuts all the way through the plate,
    # "partial" = cuts from the BOTTOM up by depth_mm (for obstructions
    # that only stick up a few mm, so trays still sit flat on top)
    cutout_type: str = "through"  # "through" or "partial"
    depth_mm: float = 3.0  # depth of partial cutout from the bottom


class BaseplateParams(BaseModel):
    """Configuration for a custom Gridfinity baseplate."""

    # Drawer dimensions (mm) — the inside dimensions of the drawer
    drawer_w_mm: float = Field(400, gt=0)
    drawer_l_mm: float = Field(300, gt=0)
    # Padding between drawer edge and gridfinity grid (mm)
    padding_top_mm: float = 2.0
    padding_bottom_mm: float = 2.0
    padding_left_mm: float = 2.0
    padding_right_mm: float = 2.0
    # Slop/clearance so baseplate slides into drawer easily (mm, applied to each side)
    drawer_clearance_mm: float = 0.5
    # Baseplate base thickness (non-socket part). Total height = 4 + base_thickness.
    # Set to 0 for an open-bottom baseplate (just the socket grid, no flat floor —
    # for drawers with a flat floor where you don't need the base lifted up).
    base_thickness_mm: float = Field(0.0, ge=0.0, le=10.0)
    # Gridfinity features
    magnet_holes: bool = True
    screw_holes: bool = False
    # Print bed size (mm)
    print_bed_w_mm: float = Field(220, gt=0)
    print_bed_l_mm: float = Field(220, gt=0)
    # Segmentation connectors
    connector_type: Literal["edge_clips", "sockets_only", "magnets", "none"] = "edge_clips"
    # Segment cut lines (grid column/row indices to cut AFTER).
    # Empty = auto-segment based on print bed size.
    cut_lines_x: list[int] = Field(default_factory=list)
    cut_lines_y: list[int] = Field(default_factory=list)
    # Edge clip parameters (when connector_type = "edge_clips")
    clip_width_mm: float = 4.0
    clip_depth_mm: float = 4.0
    clip_tolerance_mm: float = 0.2


class BaseplateDesign(BaseModel):
    """A complete baseplate design: drawer shape + cutouts + params."""

    id: str | None = None
    name: str = "Untitled Baseplate"
    params: BaseplateParams = Field(default_factory=BaseplateParams)
    cutouts: list[DrawerCutout] = Field(default_factory=list)


class BaseplateDesignSummary(BaseModel):
    id: str
    name: str
    created_at: str
    updated_at: str


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
