FROM python:3.13-slim-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY native/optimal.cpp ./optimal.cpp
RUN g++ -O3 -std=c++17 -static-libstdc++ -static-libgcc -o optimal-linux optimal.cpp
RUN sha256sum optimal.cpp | cut -d ' ' -f 1 > optimal-linux.sha256

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 --no-create-home planner \
    && mkdir /state && chown 10001:10001 /state && chmod 750 /state
WORKDIR /app
COPY LICENSE THIRD_PARTY.md ./
COPY requirements-auth.txt ./
RUN pip install --no-cache-dir -r requirements-auth.txt
COPY *.py ./
COPY scripts/ ./scripts/
COPY data/ ./data/
COPY web/ ./web/
COPY --from=build /build/optimal-linux ./native/optimal-linux
COPY --from=build /build/optimal-linux.sha256 ./native/optimal-linux.sha256
COPY native/optimal.cpp ./native/optimal.cpp
USER 10001:10001
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/healthz', timeout=3)"
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8765"]
