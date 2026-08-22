"""Mesh exporters: STL and 3MF from a build123d Solid."""
from __future__ import annotations

import os
import tempfile

import trimesh


def export_stl(solid) -> bytes:
    """Export a build123d Solid/Compound to STL bytes."""
    from build123d import export_stl

    fd, path = tempfile.mkstemp(suffix=".stl")
    os.close(fd)
    try:
        success = export_stl(solid, path)
        with open(path, "rb") as f:
            data = f.read()
    finally:
        if os.path.exists(path):
            os.unlink(path)

    if len(data) == 0:
        raise RuntimeError(
            "STL export produced 0 bytes — the model may be empty. "
            "Check that tool pockets don't cover the entire bin area "
            "and pocket depth is less than bin height."
        )
    return data


def export_3mf(solid) -> bytes:
    """Export a build123d Solid/Compound to 3MF bytes."""
    mesh = _solid_to_trimesh(solid)
    return mesh.export(file_type="3mf")


def _solid_to_trimesh(solid) -> trimesh.Trimesh:
    """Convert a build123d solid to a trimesh mesh."""
    try:
        from build123d import export_stl, Part, Compound

        # Export to STL temp file, then load with trimesh.
        fd, path = tempfile.mkstemp(suffix=".stl")
        os.close(fd)
        try:
            export_stl(solid, path)
            mesh = trimesh.load(path)
            if isinstance(mesh, trimesh.Scene):
                # Concatenate all geometries.
                meshes = [g for g in mesh.geometry.values()]
                mesh = trimesh.util.concatenate(meshes)
            return mesh
        finally:
            os.unlink(path)
    except Exception as e:
        raise RuntimeError(f"Failed to convert solid to mesh: {e}")
