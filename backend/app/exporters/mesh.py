"""Mesh exporters: STL and 3MF from a build123d Solid."""
from __future__ import annotations

import os
import tempfile

import trimesh


def export_stl(solid) -> bytes:
    """Export a build123d Solid/Compound to STL bytes."""
    # build123d can export STL directly via OCP tessellation.
    # Use build123d's export_stl if available, else tessellate via trimesh.
    try:
        from build123d import export_stl

        fd, path = tempfile.mkstemp(suffix=".stl")
        os.close(fd)
        try:
            export_stl(solid, path)
            with open(path, "rb") as f:
                return f.read()
        finally:
            os.unlink(path)
    except (ImportError, Exception):
        pass

    # Fallback: tessellate via trimesh using the solid's mesh.
    mesh = _solid_to_trimesh(solid)
    return mesh.export(file_type="stl")


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
