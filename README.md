<div align="center">

<img src="docs/images/logo.svg" alt="Tracefinity" width="400">

**Turn a photo of your tools into custom Gridfinity inserts, foam cutouts, and baseplates.**

Self-hosted · No cloud · No signup · Docker-ready

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Features](#features) · [Export Formats](#export-formats) · [Self-Hosting](#deployment) · [Development](#development)

</div>

---

## Overview

Tracefinity is a self-hosted web app that takes a photo of your tools laid on a sheet of paper, automatically detects and traces each tool's outline, lets you customize a Gridfinity bin around them, and exports the result as SVG, DXF, STL, 3MF, or STEP files.

It also includes a **Baseplate Designer** for creating custom-shaped Gridfinity baseplates that fit your tool chest drawers — with automatic segmentation for smaller 3D printers.

It's a self-hosted alternative to [tooltrace.ai](https://tooltrace.ai) — no accounts, no cloud, no subscription. Just you, your tools, and your 3D printer.

<div align="center">
<img src="docs/images/workflow.svg" alt="Workflow" width="800">
</div>

## How It Works

### 1. Snap a Photo (or Design from Scratch)
Place your tools on a sheet of **US Letter (8.5×11")** or **A4** paper and take a photo from directly above. The paper provides a known reference for scale calibration.

**Don't have a photo ready?** You can also start with an empty tray and build entirely from your saved tool library, or jump straight to the Baseplate Designer.

### 2. Calibrate and Auto-Trace
OpenCV detects all four paper corners, corrects perspective, preserves the paper's portrait or landscape aspect ratio, and establishes an accurate millimetres-per-pixel scale. A **4× zoom magnifier** appears while dragging paper corners for precise manual correction.

Choose a tracing engine before uploading or re-run another engine from the trace-review screen:

| Engine | Best For | Behavior |
|---|---|---|
| **Auto** | Recommended default | Uses FastSAM when available and falls back to Hybrid OpenCV if model inference is unavailable. |
| **Hybrid OpenCV** | Fast local tracing and high-contrast photographs | Uses Otsu thresholding, component merging, GrabCut, morphology, and contour cleanup. It requires no model but can include strong cast shadows. |
| **FastSAM** | Reflective, multi-material, or difficult tools | Combines multiple model segments so handles, shafts, blades, and barrels become one tool. The approximately 23MB model downloads on first use and is then cached in the data directory. |

Auto/FastSAM does not blindly replace the OpenCV result. It uses the OpenCV outline as a tool candidate, assembles all compatible AI segments, constrains them to the candidate area, removes narrow spurs, and falls back safely when the AI mask is incomplete.

### 2.5 Review and Correct Every Trace
The trace-review screen is the manufacturing checkpoint between image detection and tray design. This is where you define the exact tool shapes with the background image visible — a full vector editing environment with an icon-based toolbar, bezier handles, pen tool, and magnifier loupe.

**Vector Editing Toolbar:**

The toolbar at the top of the trace-review screen provides Inkscape-style vector editing tools:

| Tool | Icon | Description |
|---|---|---|
| **Select** | 🖱 | Click tools, drag vertices, edit handles (default mode) |
| **Draw Tool** | ✏ | Click to place points, close to create a new tool outline from scratch |
| **Draw Island** | ✏ | Draw a custom solid island inside the selected tool |
| **Auto-Detect** | 🔍 | Click on a tool in the image to auto-trace it |
| **Handles** | ◐ | Show/hide bezier control handle circles |
| **Loupe** | 🔍 | Toggle the 4× magnifier in the lower-right corner |
| **Help** | ? | Show complete help and keyboard shortcuts |
| **Split** | ✂ | Split a path with a cut line (click both sides) |
| **Delete** | 🗑 | Delete the entire tool |
| **Add Island** | ＋ | Add a solid island to the selected tool |

**Outer boundary (purple/green):**
- Click a tool in the image or tool list to select it.
- Drag a visible path point to move that part of the boundary.
- **Double-click an edge** to insert a new point where more local control is needed.
- **Double-click a vertex** to cycle its handle type: auto → smooth → sharp → straight.
- **Right-click a vertex** to delete it.
- Use the **Curve** slider to reduce small contour jitter. Smoothing rounds an existing path; it does not repair a boundary that is in the wrong place.
- Use **Re-trace** to compare Auto, Hybrid OpenCV, and FastSAM without uploading the photo again.
- Ctrl/Cmd-click multiple fragmented detections and choose **Merge selected paths**.
- Select one incorrectly joined path and choose **Split with a cut line**, then click across the desired separation.
- Use **Auto-Detect**, then click a missed tool in the rectified photograph.
- Use **Draw Tool** to draw a tool outline from scratch when auto-tracing doesn't work well.
- **🔍 Magnifier Loupe** — a 4× zoom window in the lower-right corner follows your cursor for precise vertex placement. Toggle with the Loupe button or `L` key.

**Bezier Handles (Inkscape-style curve editing):**

Each vertex has a handle type that controls how the curve passes through it:

| Type | Color | Behavior |
|---|---|---|
| **Auto** | Purple/Green | Catmull-Rom smoothing — no explicit handles needed (default) |
| **Smooth** | Cyan | Mirrored handles — smooth curve through the vertex. Drag one blue circle and the other mirrors automatically. |
| **Sharp** | Amber | Independent handles — corner with curved approaches on each side. Each blue circle moves independently. |
| **Straight** | Gray | No curve — straight line segments to and from this vertex |

- **Double-click a vertex** to cycle through handle types.
- When a vertex is set to **smooth** or **sharp**, blue handle circles appear (if Handles toggle is on).
- **Drag the blue circles** to shape the curve on each side of the vertex.
- Dashed blue lines connect handles to their vertex for visual clarity.
- Press **H** to toggle handle visibility.

**Interior regions and solid islands:**

A tool pocket is cut from the complete outer silhouette. An interior polygon has the opposite effect: it preserves a **solid island of tray material** inside that pocket. This is useful for a real opening through a tool, such as a scissors finger opening, but wrong for a reflection, translucent insert, printed label, or screwdriver grip detail.

- **Dashed amber region** — an automatically detected but unconfirmed interior. It remains included in the tool pocket by default, so it cannot accidentally leave a black/solid center.
- **Preserve island** — confirm that the tool has a real physical opening and leave tray material inside it.
- **Include in pocket** — dismiss a reflection, label, transparent plastic region, or other false interior and cut that area with the rest of the pocket.
- **Solid island / red inner path** — a confirmed island. Select it to edit its points, or choose **Remove Island** to make the pocket continuous again.
- **Add Island** — manually create an island to shape manually.
- **Draw Island** — use the pen tool to draw a custom island from scratch.

For example, a bright stripe inside a screwdriver handle should normally remain **included in the pocket**. A genuine opening through scissors can be marked **Preserve island**. These decisions remain available later in **Tool Properties → Interior Regions**.

### 3. Customize
Fine-tune everything in the built-in SVG editor with full undo/redo support. The editor includes the same vector editing tools as the trace-review screen — drag vertices, double-click to cycle handle types, right-click to delete, double-click edges to add points, and use the pen tool to draw new paths.

**Background Photo Layer:**
- **🖼 Photo ON/OFF** — toggle the original rectified photo as a background layer behind your tool outlines. Useful for last-minute fine-tuning of tool positions and shapes before exporting.
- **Opacity slider** — adjust the photo's transparency from 0% to 100%. Starts at 25% so you can see both the photo and your tool outlines clearly.
- The photo is aligned exactly with the tool coordinates, so you can verify that each tool outline matches the physical tool.

**Navigation & Zoom:**
- **Ctrl+Mouse Wheel** — zoom in/out smoothly
- **Space+Drag** or **Middle-mouse Drag** — pan the canvas
- **Shift+Wheel** — horizontal scroll
- **Fit button** — zoom to fit the entire workspace
- **Tray button** — zoom to 100% tray size
- **+/− buttons** — zoom in/out by 20%
- **🔍 Magnifier Loupe** — a 4× zoom window in the lower-right corner follows your cursor, showing a close-up of the area around the mouse. Toggle with the Loupe button or `L` key. Essential for precise vertex and handle placement.
- **Coordinate Readout** — the bottom-left corner shows the current mouse position in millimetres, plus the selected tool's bounding box dimensions
- **Help Panel** — click the `? Help` button or press `?` to see a complete reference of all tools, keyboard shortcuts, and handle types

**Keyboard Shortcuts:**

| Key | Action |
|---|---|
| `Ctrl+Wheel` | Zoom in/out |
| `Space+Drag` | Pan canvas |
| `Middle-mouse Drag` | Pan canvas |
| `Shift+Wheel` | Horizontal scroll |
| `+` / `=` | Zoom in |
| `−` | Zoom out |
| `F` | Fit workspace to screen |
| `0` | Zoom to 100% (tray size) |
| `Arrow keys` | Nudge selected tool(s) |
| `Shift+Arrow` | Nudge 10× step size |
| `Delete` / `Backspace` | Delete selected tool(s) |
| `H` | Toggle bezier handle visibility |
| `L` | Toggle magnifier loupe |
| `?` | Toggle help panel |
| `Escape` | Cancel pen tool / deselect |

**Tool Editing:**
- **Drag vertices** to adjust outlines
- **Double-click a vertex** to cycle its handle type (auto → smooth → sharp → straight)
- **Right-click a vertex** to delete it
- **Double-click an edge** to add a vertex
- **Bezier control handles** — Inkscape-style per-vertex control points for smooth and sharp curves. Drag the blue handle circles to shape the curve on either side of a vertex.
- **Handle types:**
  - **Auto** (purple) — Catmull-Rom smoothing applies (default, no explicit handles)
  - **Smooth** (cyan) — handles are mirrored across the vertex for a smooth curve
  - **Sharp** (amber) — handles are independent, creating a corner with curved approaches
  - **Straight** (gray) — no curve at this vertex, straight line segments only
- **Handles ON/OFF** toggle in the toolbar to show or hide bezier handle circles
- **Edit interior regions** (solid islands) the same way as outer paths — select an island in Tool Properties or click it in the canvas, then drag vertices, add, delete, and adjust bezier handles
- **Add Solid Island** button in Tool Properties creates a new island you can shape
- **Draw Island** pen tool — click to place points and create a custom island from scratch
- Review, preserve, dismiss, or remove interior regions from **Tool Properties**
- **Simplify button** removes clustered vertices (< 1.5mm apart)
- Clustered vertices shown in **red** with hover tooltips
- **Mirror X / Mirror Y** for symmetrical tools
- **Live symmetry mode** — mirror vertex drags in real-time
- **Symmetrize** — average both sides for perfect symmetry
- **Scale** tools (50-200%) with slider or quick ±5%/±10% buttons
- **Rotate** to any angle (including negative), with ±90° and auto-align buttons
- **Duplicate** tools to place multiple copies
- **Array tools** — create grids, linear, circular, or hex patterns
- **Per-tool overrides**: custom margins, pocket depths, labels, visibility

**Pen Tool — Draw from Scratch:**
- **✏ Pen Tool** — click to place points one by one, then click the first point (or double-click, or press Enter) to close the path and create a new tool outline
- **✏ Draw Island** — same as Pen Tool but creates a solid island inside the currently selected tool
- Useful when auto-tracing doesn't work well and you need to draw a tool or island manually
- Press **Escape** to cancel drawing at any time
- The first point is highlighted with a cyan ring — click inside it to close the path

**Arrow Key Nudging:**
- Select any tool and use **arrow keys** for precise positioning
- Step size selector: **0.1mm, 1mm, 5mm, 10mm**
- **Shift+Arrow** = 10× the selected step for fast movement
- Works with multi-select (all selected tools move together)

**Dimension Labels:**
- When a tool is selected, **cyan dashed dimension lines** show the distance from the tool's bounding box to each bin edge (left, right, top, bottom)
- Updates in real-time as you drag or nudge

**Alignment & Distribution:**
- **Align** multiple selected tools: left, right, center-h, top, bottom, center-v
- **Distribute** tools evenly along horizontal or vertical axis

**Finger Holes & Scoops:**
- **Click-to-place** finger holes directly on tools
- Drag finger holes to reposition
- Adjustable radius per hole
- Auto finger scoops cut from the **top surface** downward

**Pocket Geometry:**
- The reviewed outer path defines the tool pocket silhouette.
- Clearance is applied later with the global or per-tool **margin**; do not intentionally trace outside the tool to create clearance.
- Confirmed inner paths preserve solid tray islands. Unconfirmed interior candidates do not alter the pocket.
- **Flat** — standard flat-bottom pocket.
- **Spherical** — bowl-shaped pocket bottom for easy tool removal.
- **Cylindrical** — lathe-revolution cutout along the tool's principal axis.
- Pocket shape, depth, margin, bottom radius, and smoothing can be configured per tool.

**Text Labels:**
- Place **multiple movable text labels** on the bin surface
- Per-label: text, font size, rotation, depth
- **Cutout** (engraved into surface) or **Raised** (embossed above)
- Labels sit on the top surface, accounting for stacking lip height
- Multiple bundled fonts (stencil and standard)
- Perfect for labeling individual tools ("screwdriver", "extension", etc.)

**Label Tabs:**
- Optional protruding label tab on the bin front
- Custom label text, font size, and depth
- **Embossed** (raised) or **Engraved** (cut in) text
- **Inset tapered pocket** option for support-free printing

**Bin Parameters:**
- Grid size (shows mm + inches)
- Height in 7mm units (shows total mm + inches, includes lip height)
- Wall & base thickness
- Pocket depth, margin, corner radius, chamfer, bottom radius
- Magnet holes (6×2mm)
- Screw holes (M3)
- Scoop (finger cutout on front edge)
- Finger scoop (cylindrical cutout at tool edge)
- Stacking lip
- Print support tabs (split or aligned)
- **Compartments/dividers** with tapered walls, chamfers, and rounded corners
- Grid snapping for precise placement

**Blank Bin Generator:**
- Create empty bins without uploading a photo
- Set grid width, length, and height
- Add compartments and dividers
- Full bin parameter customization

### 4. Export
Download your design in the format you need:

<div align="center">
<img src="docs/images/export-formats.svg" alt="Export Formats" width="700">
</div>

| Format | Use Case |
|---|---|
| **SVG** | 2D vector for laser cutting, foam cutting, or web preview |
| **DXF** | 2D CAD for laser cutters, CNC, AutoCAD |
| **STL** | 3D mesh for 3D printing (PrusaSlicer, Cura, Bambu Studio) |
| **Flat STL** | 2mm flat plate with tool cutouts — test-fit tools before committing, or print in a different color for two-tone inserts |
| **Lid STL** | Bin lid that snaps onto the bin, with Gridfinity base on bottom and optional text label |
| **3MF** | 3D mesh with metadata (advanced 3D printing) |
| **STEP** | 3D CAD for Fusion 360, FreeCAD, SolidWorks, Onshape |

## Features

### Baseplate Designer

A full-featured designer for custom Gridfinity baseplates that fit your tool chest drawers:

**Drawer Input:**
- Specify drawer dimensions (width × length in mm)
- Per-side padding between drawer edge and gridfinity grid
- Drawer clearance/slop for easy insertion
- Visual SVG editor with grid overlay, ruler markings, and real-time preview

**Cutout Shapes:**
- Add cutouts for drawer obstructions (hinges, latches, circular holes, etc.)
- All shape types supported: rectangle, rounded rect, circle, ellipse, hex, triangle, L-shape, T-shape, cross, and more
- Drag to move, drag vertices to resize
- **Through cutouts** — cut all the way through the plate
- **Partial cutouts** — cut from the bottom up by a specified depth (for low obstructions that only stick up a few mm, so trays still sit flat on top)
- Arrow key nudging with step size selector
- Dimension labels showing distance to plate edges
- Right-side properties panel with precise position and size inputs

**Print Bed Segmentation:**
- Specify your 3D printer bed size
- Presets for common printers (Ender 3, Prusa MK3, Bambu X1, Voron 2.4, etc.)
- **Save custom printer presets** for reuse (stored in browser localStorage)
- Auto-segmentation along grid cell boundaries
- Visual segment preview with color coding and labels
- Print bed overlay shown on canvas

**Segment Connectors:**
- **Edge clips/tabs** — tabs on one segment, matching slots on the adjacent segment
- **Sockets only** — gridfinity socket pattern provides alignment
- **Magnet alignment** — magnet holes at seam midpoints
- **None** — loose pieces held by drawer walls

**Baseplate Features:**
- Standard Gridfinity socket pattern (38.5mm → 41.5mm chamfered, 4mm depth)
- Adjustable base thickness (1-10mm, total height = 4mm socket + base)
- Optional magnet holes in each cell corner
- Optional screw holes (M3 through-holes)
- Bottom edge chamfer for easy drawer insertion

**Export:**
- Multi-segment export as **ZIP file** with one STL per segment + README with assembly instructions
- Single STL for small baseplates that fit on one print bed

### Tool Library
Save individual tool outlines to a persistent library and reuse them across designs:
- **Save** any traced tool with a name and category
- **Browse** the library in the properties panel
- **Add** tools from the library to any workspace with one click
- **Delete** tools from the library
- Tools stored with bounding box dimensions for quick reference
- Build an entire tray from library tools without uploading a new photo

### Save & Load Designs
- **Save** your complete tray designs (tools, labels, bin params)
- **Save** your baseplate designs (cutouts, params, segmentation)
- **Load** saved designs from the upload screen
- Continue editing where you left off

### Design from Scratch
Skip the photo upload entirely:
- Start with an empty tray (blank bin generator)
- Add tools from your library or the shape dialog
- Use the **Pen Tool** to draw custom tool outlines point by point
- Use **Draw Island** to create custom solid islands inside tools
- Customize bin parameters
- Export when ready

### Recommended Workflow for Difficult Tools

Some tools are hard to trace automatically — reflective surfaces, cast shadows, transparent plastic, and multi-material tools can confuse any detection system. Here's how to get good results:

1. **Start with Auto** — it picks the best available engine.
2. **Compare engines** — if Auto gives incomplete results, try Hybrid OpenCV and FastSAM separately using the Re-trace button. One may handle reflections better; the other may handle shadows better.
3. **Correct outer boundaries first** — drag vertices, add points where needed, or use the Draw Tool to redraw the outline from scratch.
4. **Use bezier handles for curves** — double-click a vertex to switch it to "smooth" mode, then drag the blue handle circles to shape the curve. This is much faster than adding dozens of vertices.
5. **Dismiss false interior candidates** — reflections, labels, and transparent regions should be "Included in pocket," not preserved as islands.
6. **Preserve only real openings** — scissors finger holes and similar through-holes should be marked "Preserve island."
7. **Draw missing islands** — if a real opening wasn't detected, use "Add Island" or the "Draw Island" pen tool to create it manually.
8. **Use the magnifier loupe** — toggle it on for precise vertex and handle placement on small details.
9. **Continue to the editor** — once all tool shapes are defined, click "Open Editor →" to arrange them in the tray and configure pocket geometry.

### Known Limitations

- **Cast shadows** can expand Hybrid OpenCV boundaries inward from the tool edge. Use FastSAM or manual correction when this happens.
- **Bright reflections** on metal tools can create uncertain interior regions. These appear as amber dashed candidates and should usually be included in the pocket.
- **FastSAM** can fail when masks are incomplete or merge unrelated regions. The system falls back to Hybrid OpenCV, but the result may need manual correction.
- **Large boundary corrections** are easier with the Pen Tool (draw from scratch) than with vertex dragging alone.
- **Manual review remains necessary** for manufacturing accuracy. Automatic detection is a starting point, not a final result.

## Quick Start

```bash
git clone https://github.com/neilyboy/tracefinity.git
cd tracefinity
docker compose up --build
```

Then open **http://localhost:8000** in your browser. That's it.

### Photo Tips for Best Results

- Use **even lighting** — avoid shadows on the paper
- Place paper on a **dark, contrasting surface** so the boundary is detectable
- Shoot from **directly above** the paper
- Ensure tools are **fully within** the paper boundary
- **Dark tools on white paper** work best
- Avoid overlapping tools

> **Detection not perfect?** You can manually drag the 4 paper corners to the correct positions (with a 4× zoom magnifier for precision), and edit any tool outline in the SVG editor.

## Detection Demo

<div align="center">
<img src="docs/images/detection-demo.png" alt="Detection Demo" width="500">
</div>

*4 tools automatically detected and traced from a photo, overlaid on a 4×5 Gridfinity bin.*

## Editor Screenshot

<div align="center">
<img src="docs/images/screenshot-editor.png" alt="Editor Screenshot" width="600">
</div>

*Interactive SVG editor with grid overlay, tool outlines, bin parameters, and export bar.*

## Gridfinity Specification

Tracefinity follows the standard [Gridfinity spec](https://gridfinity.xyz/):

<div align="center">
<img src="docs/images/gridfinity-spec.svg" alt="Gridfinity Spec" width="500">
</div>

- **Unit cell**: 42 × 42mm
- **Height unit**: 7mm
- **Base (stacking socket)**: 4mm
- **Magnet holes**: 6mm diameter × 2mm depth in corners
- **Screw holes**: M3 (3.35mm)
- **Clearance**: 0.5mm per side

## Deployment

### Docker (Recommended)

The app runs as a single container with everything bundled:

- **Frontend**: React + TypeScript (Vite static build, served by FastAPI)
- **Backend**: Python FastAPI (OpenCV for vision, build123d for 3D generation)
- **Storage**: SQLite database + filesystem for images/exports

```yaml
# docker-compose.yml
services:
  tracefinity:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
    environment:
      TRACEFINITY_DATA_DIR: /data
      TRACEFINITY_MAX_UPLOAD_MB: 25
```

### Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `TRACEFINITY_DATA_DIR` | `/data` | Where uploaded images, DB, and exports are stored |
| `TRACEFINITY_MAX_UPLOAD_MB` | `25` | Max image upload size in MB |
| `TRACEFINITY_MIN_TOOL_AREA_MM2` | `100` | Minimum tool area to detect (filters noise) |
| `TRACEFINITY_MAX_OUTLINE_VERTICES` | `80` | Max vertices per tool outline |
| `TRACEFINITY_PORT` | `8000` | Host port to expose (set in environment, not container) |

### Data Persistence

All data is stored in the mounted volume:
```
data/
├── images/     # uploaded + rectified images
├── exports/    # generated export files
└── db/         # SQLite database (saved designs + tool library + baseplate designs)
```

## Development

### Prerequisites
- Python 3.10–3.12
- Node.js 18+
- Docker (for deployment)

### Local Development

```bash
# Backend
cd backend
python -m venv ../.venv
source ../.venv/bin/activate
pip install -e ".[dev]"
TRACEFINITY_DATA_DIR=../data uvicorn app.main:app --reload --port 8000 --app-dir .

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` and `/data` to the backend at `localhost:8000`.

### Running Tests

```bash
source .venv/bin/activate
TRACEFINITY_DATA_DIR=./data python -m pytest backend/tests/ -v
```

### Regenerating README Graphics

```bash
python docs/images/generate_graphics.py
```

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | FastAPI, OpenCV (computer vision), build123d (parametric CAD), ezdxf (DXF), trimesh (3MF), SQLModel/SQLite |
| **Frontend** | React 18, TypeScript, Vite, Zustand (state management) |
| **CAD Engine** | OCP/OpenCASCADE (via build123d) for STEP/STL/3MF generation |
| **Deployment** | Docker, Docker Compose |

## Project Structure

```
tracefinity/
├── backend/
│   ├── app/
│   │   ├── cv/              # Computer vision pipeline
│   │   │   ├── paper_detect.py   # Paper detection + rectification
│   │   │   ├── tool_detect.py    # Tool outline extraction + smoothing
│   │   │   └── pipeline.py       # Orchestration
│   │   ├── gridfinity/      # Gridfinity generation
│   │   │   ├── bin_builder.py    # Parametric bin construction
│   │   │   ├── baseplate_builder.py  # Custom baseplate generation + segmentation
│   │   │   ├── lid_builder.py    # Bin lid generation
│   │   │   ├── pockets.py        # Tool pocket + finger hole generation
│   │   │   ├── generator.py      # Full model assembly + flat export + labels
│   │   │   └── constants.py      # Gridfinity spec constants
│   │   ├── exporters/       # Export format generators
│   │   │   ├── svg.py             # SVG (2D vector)
│   │   │   ├── dxf.py             # DXF (2D CAD)
│   │   │   ├── mesh.py            # STL + 3MF (3D mesh)
│   │   │   └── step.py            # STEP (3D CAD)
│   │   ├── routers/         # API endpoints
│   │   │   ├── trace.py           # Image upload + tool detection
│   │   │   ├── design.py          # Design CRUD
│   │   │   ├── baseplate.py       # Baseplate CRUD + export + segment info
│   │   │   ├── tool_library.py    # Tool library CRUD
│   │   │   ├── export.py          # Export (SVG/DXF/STL/Flat STL/Lid STL/3MF/STEP)
│   │   │   └── preview.py         # Preview image generation
│   │   ├── storage/         # SQLite persistence
│   │   ├── schemas.py       # Pydantic models
│   │   └── main.py          # FastAPI app
│   └── tests/               # pytest test suite
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   │   ├── SvgEditor.tsx           # Tray SVG editor
│   │   │   ├── BaseplateEditor.tsx     # Baseplate SVG editor
│   │   │   ├── BaseplateView.tsx       # Baseplate designer layout
│   │   │   ├── BaseplateParamsPanel.tsx  # Baseplate parameters
│   │   │   ├── BaseplateExportBar.tsx  # Baseplate export
│   │   │   ├── CutoutPropsPanel.tsx    # Cutout properties
│   │   │   ├── EditorView.tsx          # Tray editor layout
│   │   │   ├── BinParamsPanel.tsx      # Tray parameters
│   │   │   ├── ToolPropsPanel.tsx      # Tool properties
│   │   │   ├── ExportBar.tsx           # Tray export
│   │   │   ├── AddShapeDialog.tsx      # Shape creation dialog
│   │   │   └── ...
│   │   ├── api/             # API client
│   │   ├── editor/          # Editor state (Zustand)
│   │   │   ├── useEditorState.ts       # Tray editor state
│   │   │   └── useBaseplateState.ts    # Baseplate editor state
│   │   └── types.ts         # TypeScript types
│   └── package.json
├── docs/images/             # README graphics
├── samples/                 # Sample test images
├── Dockerfile               # Multi-stage build
├── docker-compose.yml
└── README.md
```

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/trace` | POST | Upload image, detect paper, rectify, and trace tool outlines. Accepts `engine` (auto/hybrid/fastsam) and `smoothing` parameters. |
| `/api/trace-engines` | GET | List available tracing engines with availability and readiness status |
| `/api/trace/retrace` | POST | Re-trace the rectified image with a different engine without re-uploading |
| `/api/rectify` | POST | Re-rectify with manual corners |
| `/api/detect-at-point` | POST | Detect a single tool at a clicked point (accepts `engine` parameter) |
| `/api/auto-rotate` | POST | Auto-align tool to axes |
| `/api/preview` | POST | Generate preview image |
| `/api/export` | POST | Export design (SVG/DXF/STL/Flat STL/Lid STL/3MF/STEP) |
| `/api/designs` | GET | List saved designs |
| `/api/designs` | PUT | Save a design |
| `/api/designs/{id}` | GET | Load a design |
| `/api/designs/{id}` | DELETE | Delete a design |
| `/api/designs/fonts/list` | GET | List available fonts |
| `/api/tools` | GET | List tool library |
| `/api/tools` | PUT | Save tool to library |
| `/api/tools/{id}` | GET | Load tool from library |
| `/api/tools/{id}` | DELETE | Delete tool from library |
| `/api/baseplate` | GET | List saved baseplate designs |
| `/api/baseplate` | PUT | Save a baseplate design |
| `/api/baseplate/{id}` | GET | Load a baseplate design |
| `/api/baseplate/{id}` | DELETE | Delete a baseplate design |
| `/api/baseplate/segment-info` | POST | Get segment info for a baseplate design |
| `/api/baseplate/export` | POST | Export baseplate as STL or ZIP of STLs |

## License

MIT

---

<div align="center">

Made with ❤️ for the Gridfinity community

</div>
