"""Tests for all export formats."""
import pytest

from app.schemas import Design, BinParams, ToolOutline, Point
from app.exporters.svg import export_svg
from app.exporters.dxf import export_dxf
from app.gridfinity.generator import generate_gridfinity
from app.exporters.mesh import export_stl, export_3mf
from app.exporters.step import export_step


@pytest.fixture
def sample_design():
    return Design(
        name="test",
        paper_size="letter",
        scale_mm_per_px=0.3,
        outlines=[
            ToolOutline(
                id="t1",
                outer=[Point(x=20, y=20), Point(x=60, y=20), Point(x=60, y=50), Point(x=20, y=50)],
                holes=[],
                label="Wrench",
            ),
        ],
        params=BinParams(grid_w=2, grid_l=2, height_units=3, pocket_depth_mm=10),
    )


def test_svg_export(sample_design):
    svg = export_svg(sample_design)
    assert "<svg" in svg
    assert "</svg>" in svg
    assert "path" in svg
    assert "Wrench" in svg  # label


def test_dxf_export(sample_design):
    dxf = export_dxf(sample_design)
    assert len(dxf) > 100
    # DXF files start with specific section
    assert b"SECTION" in dxf or b"AcDb" in dxf


def test_stl_export(sample_design):
    solid = generate_gridfinity(sample_design)
    stl = export_stl(solid)
    assert len(stl) > 100
    # STL can be ASCII (starts with "solid") or binary (84-byte header)
    assert stl[:5] == b"solid" or len(stl) > 84  # binary STL has 84-byte header


def test_3mf_export(sample_design):
    solid = generate_gridfinity(sample_design)
    threemf = export_3mf(solid)
    assert len(threemf) > 100
    # 3MF is a ZIP file
    assert threemf[:2] == b"PK"


def test_step_export(sample_design):
    solid = generate_gridfinity(sample_design)
    step = export_step(solid)
    assert len(step) > 100
    assert b"ISO-10303" in step
