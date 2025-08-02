# Use Python 3.11 slim image
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for dependency caching
COPY requirements.txt .

# Install Python dependencies (cached layer if requirements.txt unchanged)
RUN pip install --no-cache-dir -r requirements.txt

# Copy .env files if they exist
COPY .env* ./ 2>/dev/null || true

# Copy application code (only invalidates cache when source changes)
COPY app ./app

# Create non-root user
RUN groupadd --gid 1001 python && \
    useradd --uid 1001 --gid python --shell /bin/bash python

# Create directories and set permissions
RUN mkdir -p /app/logs /app/models/mindshare && \
    chown -R python:python /app

USER python

EXPOSE 8000

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"] 