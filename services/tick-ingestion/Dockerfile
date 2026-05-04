FROM python:3.11-slim

WORKDIR /app

# System deps for DuckDB
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

ENV PYTHONUNBUFFERED=1
EXPOSE 8001

# Start both producer and API in same container via supervisor.
# In production deploy them separately.
CMD ["python", "-m", "app.main"]
