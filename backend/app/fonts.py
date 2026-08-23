"""Bundled font registry.

Provides a curated set of fonts shipped with the application. Fonts are
grouped into two categories:

1. **Stencil fonts** — letters have built-in bridges connecting enclosed
   counters (the "drips" you see in pumpkin/industrial stencil lettering).
   These are ideal for cutout-through labels because the inner pieces of
   letters like A, O, B, P don't fall out.

2. **Standard fonts** — regular fonts for raised/embossed labels where
   counters are not a problem.

Stencil fonts come from two sources:
- Pre-made stencil typefaces (Saira Stencil One, Black Ops One, Plaster)
- Regular OFL fonts converted to stencil versions using the *stencilizer*
  tool (https://github.com/cosmix/stencilizer), which automatically adds
  bridges to enclosed contours.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

FONTS_DIR = Path(__file__).parent / "fonts"


@dataclass(frozen=True)
class FontInfo:
    """Metadata for a bundled font."""

    key: str  # unique identifier used by the frontend
    name: str  # human-readable display name
    category: str  # "Stencil" or "Standard"
    filename: str  # TTF filename inside the fonts directory
    is_stencil: bool  # True if font has stencil bridges

    @property
    def path(self) -> Path:
        return FONTS_DIR / self.filename

    def exists(self) -> bool:
        return self.path.exists()


# Curated font catalogue. Order matters — this is the order shown in the UI.
FONT_CATALOGUE: list[FontInfo] = [
    # ── Stencil fonts (best for cutout-through labels) ──────────────────
    FontInfo("Saira-Stencil", "Saira Stencil One", "Stencil", "SairaStencilOne-Regular.ttf", True),
    FontInfo("BlackOps-One", "Black Ops One", "Stencil", "BlackOpsOne-Regular.ttf", True),
    FontInfo("Plaster", "Plaster", "Stencil", "Plaster-Regular.ttf", True),
    FontInfo("Lato-Stenciled", "Lato Stenciled", "Stencil", "Lato-Regular-Stenciled.ttf", True),
    FontInfo("Roboto-Stenciled", "Roboto Stenciled", "Stencil", "Roboto-Regular-Stenciled.ttf", True),
    FontInfo("NotoSans-Stenciled", "Noto Sans Stenciled", "Stencil", "NotoSans-Regular-Stenciled.ttf", True),
    FontInfo("Inter-Stenciled", "Inter Stenciled", "Stencil", "Inter-Regular-Stenciled.ttf", True),
    FontInfo("Inter-Bold-Stenciled", "Inter Bold Stenciled", "Stencil", "Inter-Bold-Stenciled.ttf", True),
    FontInfo("Montserrat-Stenciled", "Montserrat Stenciled", "Stencil", "Montserrat-Regular-Stenciled.ttf", True),
    FontInfo("Montserrat-Bold-Stenciled", "Montserrat Bold Stenciled", "Stencil", "Montserrat-Bold-Stenciled.ttf", True),
    FontInfo("Archivo-Stenciled", "Archivo Stenciled", "Stencil", "Archivo-Regular-Stenciled.ttf", True),
    FontInfo("Archivo-Bold-Stenciled", "Archivo Bold Stenciled", "Stencil", "Archivo-Bold-Stenciled.ttf", True),
    FontInfo("OpenSans-Stenciled", "Open Sans Stenciled", "Stencil", "OpenSans-Regular-Stenciled.ttf", True),
    FontInfo("Bitter-Stenciled", "Bitter Stenciled", "Stencil", "Bitter-Regular-Stenciled.ttf", True),
    FontInfo("MajorMono-Stenciled", "Major Mono Stenciled", "Stencil", "MajorMonoDisplay-Regular-Stenciled.ttf", True),
    FontInfo("PressStart2P-Stenciled", "Press Start 2P Stenciled", "Stencil", "PressStart2P-Regular-Stenciled.ttf", True),
    # ── Standard fonts (best for raised/embossed labels) ────────────────
    FontInfo("Lato", "Lato", "Standard", "Lato-Regular.ttf", False),
    FontInfo("Roboto", "Roboto", "Standard", "Roboto-Regular.ttf", False),
    FontInfo("NotoSans", "Noto Sans", "Standard", "NotoSans-Regular.ttf", False),
    FontInfo("Inter", "Inter", "Standard", "Inter-Regular.ttf", False),
    FontInfo("Inter-Bold", "Inter Bold", "Standard", "Inter-Bold.ttf", False),
    FontInfo("Montserrat", "Montserrat", "Standard", "Montserrat-Regular.ttf", False),
    FontInfo("Montserrat-Bold", "Montserrat Bold", "Standard", "Montserrat-Bold.ttf", False),
    FontInfo("Archivo", "Archivo", "Standard", "Archivo-Regular.ttf", False),
    FontInfo("Archivo-Bold", "Archivo Bold", "Standard", "Archivo-Bold.ttf", False),
    FontInfo("OpenSans", "Open Sans", "Standard", "OpenSans-Regular.ttf", False),
    FontInfo("Bitter", "Bitter", "Standard", "Bitter-Regular.ttf", False),
    FontInfo("MajorMono", "Major Mono Display", "Standard", "MajorMonoDisplay-Regular.ttf", False),
    FontInfo("PressStart2P", "Press Start 2P", "Standard", "PressStart2P-Regular.ttf", False),
]

# Quick lookup by key
_FONT_MAP: dict[str, FontInfo] = {f.key: f for f in FONT_CATALOGUE}


def list_fonts() -> list[dict]:
    """Return a list of font metadata dicts for the API."""
    return [
        {
            "key": f.key,
            "name": f.name,
            "category": f.category,
            "is_stencil": f.is_stencil,
            "available": f.exists(),
        }
        for f in FONT_CATALOGUE
        if f.exists()
    ]


def get_font_path(key: str) -> str | None:
    """Return the filesystem path to a font file by its key.

    Returns None if the key is not found or the file doesn't exist.
    Falls back to system fonts (returns the key as-is) for non-bundled keys
    like "Arial" — build123d will resolve these via the system font manager.
    """
    info = _FONT_MAP.get(key)
    if info and info.exists():
        return str(info.path)
    # Non-bundled font (e.g. "Arial") — let build123d resolve from system
    return None


def is_bundled_font(key: str) -> bool:
    """Check if a font key refers to a bundled font."""
    return key in _FONT_MAP
