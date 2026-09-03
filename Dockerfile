# ---- Stage 1: Build the React frontend ----
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --silent 2>/dev/null || npm install --silent
COPY frontend/ ./
RUN mkdir -p ../backend/app/static && npm run build

# ---- Stage 2: Python backend + static frontend ----
FROM python:3.11-slim AS runtime

# System deps for OpenCV and build123d/OCP
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir -e ".[dev]" || pip install --no-cache-dir -e .

# Copy backend source
COPY backend/app/ ./app/

# Copy built frontend into static dir served by FastAPI
COPY --from=frontend-build /frontend/dist ./app/static

ENV TRACEFINITY_DATA_DIR=/data
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
