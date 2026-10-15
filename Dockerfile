# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PROJ_NETWORK=OFF \
    PYTHONPATH=/app:/app/backend \
    PORT=8000 \
    WEBGIS_REQUIRE_AUTH=1 \
    WEBGIS_ENABLE_DEMO_ACCOUNTS=0 \
    WEBGIS_ALLOW_REGISTRATION=0

# Compiled GIS libraries come from wheels; full OpenCV also needs libGL.
RUN --mount=type=secret,id=build_ca,mode=0444 \
    if [ -s /run/secrets/build_ca ]; then \
        printf '%s\n' 'Acquire::https::CaInfo "/run/secrets/build_ca";' > /etc/apt/apt.conf.d/99build-ca; \
    fi \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99build-ca \
    && groupadd --gid 10001 webgis \
    && useradd --uid 10001 --gid webgis --create-home webgis

WORKDIR /app
COPY requirements.lock ./
RUN --mount=type=secret,id=build_ca,mode=0444 \
    if [ -s /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi \
    && python -m pip install --no-cache-dir --requirement requirements.lock \
    && python -m pip check

COPY --chown=webgis:webgis backend/ ./backend/
COPY --chown=webgis:webgis frontend/ ./frontend/

# Only these public assets enter the image. The build context is allowlisted.
COPY --chown=webgis:webgis data/fonts/ /opt/webgis-public-data/fonts/
COPY --chown=webgis:webgis data/provinces_boundaries.geojson data/provinces_boundaries_lines.geojson /opt/webgis-public-data/
RUN mkdir -p /app/data /app/scratch \
    && chown -R webgis:webgis /app/data /app/scratch

COPY --chmod=755 <<'ENTRYPOINT' /usr/local/bin/webgis-entrypoint
#!/bin/sh
set -eu
# A bind mount hides image /app/data; seed public assets without replacing data.
python - <<'PY'
from pathlib import Path
import shutil

source = Path('/opt/webgis-public-data')
target = Path('/app/data')
for item in source.rglob('*'):
    destination = target / item.relative_to(source)
    if item.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
    elif not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(item, destination)
PY
exec "$@"
ENTRYPOINT

USER webgis:webgis
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/api/health', timeout=4).read()" || exit 1

ENTRYPOINT ["/usr/local/bin/webgis-entrypoint"]
CMD ["sh", "-c", "exec uvicorn backend.app:app --host 0.0.0.0 --port \"${PORT:-8000}\" --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
