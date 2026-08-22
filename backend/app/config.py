"""Application configuration loaded from environment variables."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# Known paper/reference sizes in millimetres (width, height).
PAPER_SIZES_MM: dict[str, tuple[float, float]] = {
    "letter": (215.9, 279.4),
    "a4": (210.0, 297.0),
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TRACEFINITY_", env_file=".env", extra="ignore")

    data_dir: Path = Path("/data")
    host: str = "0.0.0.0"
    port: int = 8000
    max_upload_mb: int = 25
    # Minimum tool area in mm^2 to keep (rejects specks/noise).
    min_tool_area_mm2: float = 100.0
    # Maximum vertices per outline after simplification.
    max_outline_vertices: int = 80


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
(settings.data_dir / "images").mkdir(exist_ok=True)
(settings.data_dir / "exports").mkdir(exist_ok=True)
(settings.data_dir / "db").mkdir(exist_ok=True)
