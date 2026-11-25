FROM python:3.14-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends chromium nodejs npm ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --no-save --package-lock=false playwright-core@1.56.1

COPY requirements.docker.txt ./
RUN pip install --no-cache-dir -r requirements.docker.txt

COPY *.py *.cjs live.html airbkk_hourly_stations.json airbkk-daily-2026-11-09-to-22.csv ./
COPY models/ ./models/
RUN mkdir -p /data

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
