FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WORKER_DATA_DIR=/var/lib/declarafy-worker

WORKDIR /app
COPY worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --requirement /app/requirements.txt \
    && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin worker \
    && mkdir -p /var/lib/declarafy-worker \
    && chown -R worker:worker /app /var/lib/declarafy-worker

COPY --chown=worker:worker worker/openharness_ingress.py worker/encryption.py worker/migrate_encryption.py worker/maintenance.py worker/openharness_runtime.py worker/staging_preflight.py /app/
USER 10001:10001
EXPOSE 8080
CMD ["uvicorn", "openharness_ingress:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
