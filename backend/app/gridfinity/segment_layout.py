"""ASCII art renderer for segment layout maps.

Produces a top-down visual map of how segments are arranged in the
drawer / on the plate, so users assembling a multi-piece export can
see at a glance which segment goes where.

The layout matches the segment numbering produced by
``_segment_bounds`` (x-major, then y-minor ordering).
"""

from __future__ import annotations


def render_segment_map(
    grid_w: int,
    grid_l: int,
    cuts_x: list[int],
    cuts_y: list[int],
    cell_w: int = 4,
    cell_h: int = 2,
) -> list[str]:
    """Render an ASCII map of the segment layout (top-down view).

    Each gridfinity cell is represented by ``cell_w`` × ``cell_h``
    characters.  Segment borders are drawn with ``+``, ``-``, ``|``;
    a light dotted grid shows individual cells inside each segment;
    and each segment is labelled with its number (``S1``, ``S2`` …)
    and cell dimensions, centered.

    Returns a list of strings (one per line), ready to join with
    ``"\\n"`` or extend into a README.

    Parameters
    ----------
    grid_w, grid_l
        Total grid size in cells.
    cuts_x, cuts_y
        Cut-line positions (in cell units).  Empty lists mean a
        single segment.
    cell_w, cell_h
        Characters per cell.  Defaults give compact but readable
        output; bump up for more breathing room.
    """
    x_bounds = [0] + sorted(cuts_x) + [grid_w]
    y_bounds = [0] + sorted(cuts_y) + [grid_l]
    num_x = len(x_bounds) - 1
    num_y = len(y_bounds) - 1

    # Shrink cell size for very large grids so the map stays manageable
    if grid_w * cell_w > 80:
        cell_w = max(2, 80 // grid_w)
    if grid_l * cell_h > 40:
        cell_h = max(1, 40 // grid_l)

    cols = grid_w * cell_w + 1
    rows = grid_l * cell_h + 1
    canvas = [[" "] * cols for _ in range(rows)]

    # Canvas positions of segment boundary lines
    x_lines = {x * cell_w for x in x_bounds}
    y_lines = {y * cell_h for y in y_bounds}

    # --- Draw segment borders -------------------------------------------
    # Corners
    for lx in x_bounds:
        cx = lx * cell_w
        for ly in y_bounds:
            cy = ly * cell_h
            canvas[cy][cx] = "+"
    # Horizontal borders
    for ly in y_bounds:
        cy = ly * cell_h
        for x in range(1, cols - 1):
            if canvas[cy][x] in (" ", "."):
                canvas[cy][x] = "-"
    # Vertical borders
    for lx in x_bounds:
        cx = lx * cell_w
        for y in range(1, rows - 1):
            if canvas[y][cx] in (" ", ":"):
                canvas[y][cx] = "|"

    # --- Light cell grid inside segments --------------------------------
    for cy in range(grid_l):
        for cx in range(grid_w):
            # internal vertical (right edge of this cell, if not a seg boundary)
            vx = (cx + 1) * cell_w
            if vx not in x_lines:
                for y in range(cy * cell_h + 1, (cy + 1) * cell_h):
                    if canvas[y][vx] == " ":
                        canvas[y][vx] = ":"
            # internal horizontal (bottom edge of this cell, if not a seg boundary)
            hy = (cy + 1) * cell_h
            if hy not in y_lines:
                for x in range(cx * cell_w + 1, (cx + 1) * cell_w):
                    if canvas[hy][x] == " ":
                        canvas[hy][x] = "."

    # --- Place segment labels -------------------------------------------
    for xi in range(num_x):
        for yi in range(num_y):
            seg_idx = xi * num_y + yi + 1
            cx_start, cx_end = x_bounds[xi], x_bounds[xi + 1]
            cy_start, cy_end = y_bounds[yi], y_bounds[yi + 1]
            cells_w = cx_end - cx_start
            cells_h = cy_end - cy_start

            # Interior center (in canvas coords, between border lines)
            mid_x = (cx_start * cell_w + cx_end * cell_w) // 2
            mid_y = (cy_start * cell_h + cy_end * cell_h) // 2
            interior_h = cells_h * cell_h - 1  # rows between borders

            label = f"S{seg_idx}"
            _clear_row(canvas, mid_y, cx_start * cell_w + 1, cx_end * cell_w)
            _place_text(canvas, mid_y, mid_x, label, rows, cols)

            # Show dimensions on a second line if there's room.
            # Place at mid_y - 1 because the canvas is vertically flipped
            # at the end, so mid_y - 1 in canvas → mid_y + 1 in display
            # (below the S-label).
            size_label = f"{cells_w}x{cells_h}"
            if interior_h >= 3 and len(size_label) <= cells_w * cell_w - 1:
                _clear_row(canvas, mid_y - 1, cx_start * cell_w + 1, cx_end * cell_w)
                _place_text(canvas, mid_y - 1, mid_x, size_label, rows, cols)

    # Flip vertically so high-Y (top of drawer) appears at the top,
    # matching the frontend's top-down view (SVG Y-down with flipped
    # backend coords).  Without this, y=0 (bottom of drawer) would
    # appear at the top of the map — the reverse of what the user
    # sees on screen.
    canvas.reverse()
    return ["".join(row) for row in canvas]


def _clear_row(canvas: list[list[str]], row: int, x_start: int, x_end: int) -> None:
    """Clear grid characters (``:``, ``.``) on a row, leaving borders intact."""
    if not (0 <= row < len(canvas)):
        return
    for x in range(max(0, x_start), min(len(canvas[row]), x_end)):
        if canvas[row][x] in (":", "."):
            canvas[row][x] = " "


def _place_text(
    canvas: list[list[str]],
    row: int,
    center_col: int,
    text: str,
    rows: int,
    cols: int,
) -> None:
    """Place ``text`` horizontally centered at ``(row, center_col)``."""
    start = center_col - len(text) // 2
    for k, ch in enumerate(text):
        px = start + k
        if 0 <= row < rows and 0 <= px < cols:
            canvas[row][px] = ch
