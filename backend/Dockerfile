FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Cache bust per forzare COPY aggiornato: 20260414142806
ARG CACHEBUST=20260423060506

# Copia tutto il contenuto della directory backend (inclusa static/)
COPY . .

# Verifica che static/index.html sia presente
RUN ls -la /app/static/ && echo "Frontend presente: OK" || echo "Frontend MANCANTE"

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2"]
