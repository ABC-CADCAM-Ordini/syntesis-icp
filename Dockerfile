FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Cache buster: incrementare per forzare il rebuild del layer sottostante
ARG CACHEBUST=20260423140630

# Copia backend
COPY backend/ .

# Copia frontend nella cartella static
RUN mkdir -p /app/static
COPY frontend/index.html /app/static/index.html

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

