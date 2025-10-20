# Use Python 3.11 slim image
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including FFmpeg with H.264 support
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    ffmpeg \
    libx264-dev \
    libffi-dev \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Verify FFmpeg has libx264 encoder (fail build if missing)
RUN ffmpeg -encoders 2>&1 | grep -q libx264 || \
    (echo "ERROR: FFmpeg build missing libx264 encoder!" && exit 1)

# Copy requirements first for dependency caching
COPY requirements.txt .

# Install Python dependencies (cached layer if requirements.txt unchanged)
RUN pip install --no-cache-dir -r requirements.txt

# Copy .env files if they exist
COPY .env* ./

# Copy application code (only invalidates cache when source changes)
COPY app ./app

# Copy assets folder for fonts (needed for watermarking)
COPY assets ./assets

# Copy migration scripts
COPY migrate_watermarks.py ./
COPY README_migration.md ./

# Create non-root user
RUN groupadd --gid 1001 python && \
    useradd --uid 1001 --gid python --shell /bin/bash --home-dir /app python

# Create directories and set permissions
RUN mkdir -p /app/logs /app/models/mindshare /app/temp && \
    chown -R python:python /app && \
    chmod -R 755 /app

# Set the home directory to /app for the python user
ENV HOME=/app

USER python

EXPOSE 8000

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"] 