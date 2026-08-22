"""STEP exporter using build123d/OCP."""
from __future__ import annotations

import os
import tempfile


def export_step(solid) -> bytes:
    """Export a build123d Solid/Compound to STEP bytes."""
    try:
        from build123d import export_step

        fd, path = tempfile.mkstemp(suffix=".step")
        os.close(fd)
        try:
            export_step(solid, path)
            with open(path, "rb") as f:
                return f.read()
        finally:
            os.unlink(path)
    except ImportError:
        raise RuntimeError("STEP export requires build123d with OCP (OpenCascade).")
