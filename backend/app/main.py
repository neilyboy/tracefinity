"""FastAPI application entry point."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers import design, export, preview, trace
from .schemas import HealthResponse

app = FastAPI(title="Tracefinity", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

# Same-origin SPA; allow configurable CORS for dev if needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trace.router, prefix="/api", tags=["trace"])
app.include_router(design.router, prefix="/api/designs", tags=["designs"])
app.include_router(preview.router, prefix="/api", tags=["preview"])
app.include_router(export.router, prefix="/api", tags=["export"])


@app.get("/api/health", response_model=HealthResponse)
async def health():
    return HealthResponse()


# Serve uploaded images and exports from the data directory.
app.mount("/data/images", StaticFiles(directory=str(settings.data_dir / "images")), name="images")
app.mount("/data/exports", StaticFiles(directory=str(settings.data_dir / "exports")), name="exports")


# SPA fallback: serve the built React app for any non-API route.
_STATIC_DIR = Path(__file__).resolve().parent / "static"
_INDEX = _STATIC_DIR / "index.html"


@app.get("/")
async def root():
    if _INDEX.exists():
        return FileResponse(_INDEX)
    return {"message": "Tracefinity API running. Frontend not built. See /api/docs."}


if _STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(_STATIC_DIR / "assets")), name="assets")


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """Catch-all for SPA client-side routing. Returns index.html for non-API, non-file paths."""
    if full_path.startswith("api/") or full_path.startswith("data/"):
        return {"detail": "Not found"}
    candidate = _STATIC_DIR / full_path
    if candidate.is_file():
        return FileResponse(candidate)
    if _INDEX.exists():
        return FileResponse(_INDEX)
    return {"detail": "Frontend not built."}
