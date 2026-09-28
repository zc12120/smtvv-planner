# Preserve the installed 1Panel image, WAF, Lua modules and library versions.
ARG OPENRESTY_BASE=1panel/openresty:1.31.1.1-2-1-noble@sha256:e86b2a4808f728962ca125b2f81a95c032419073e0b19a42806b2cb43086cd6c
FROM ${OPENRESTY_BASE} AS build
USER root
COPY openresty-1.31.1.1.tar.gz build.sh /build/
COPY patches/ /build/patches/
RUN /bin/sh /build/build.sh

FROM ${OPENRESTY_BASE}
COPY --from=build /output/nginx /usr/local/openresty/nginx/sbin/nginx
COPY --from=build /output/*.so /usr/local/openresty/nginx/modules/
COPY patches.json /usr/local/openresty/security-patches.json
LABEL cc.smtvv.security-build="20260916" \
      cc.smtvv.nginx-backports="CVE-2026-42530,CVE-2026-42055,CVE-2026-48142,CVE-2026-42533,CVE-2026-60005,CVE-2026-56434"
