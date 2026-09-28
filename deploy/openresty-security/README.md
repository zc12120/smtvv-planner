# OpenResty security build

This recipe retains the installed 1Panel/OpenResty image and rebuilds its Nginx
binary and bundled dynamic modules with 15 upstream fixes from Nginx 1.31.2 and
1.31.3. It addresses CVE-2026-42530, CVE-2026-42055, CVE-2026-48142,
CVE-2026-42533, CVE-2026-60005 and CVE-2026-56434. The 1Panel WAF, Lua libraries,
OpenSSL and application state remain supplied by the pinned base image.

The source archive is `https://openresty.org/download/openresty-1.31.1.1.tar.gz`.
Download it into this directory before building; `build.sh` verifies its SHA-256.
`patches.json` records the upstream commit and digest of every applied patch.
Patches are applied in filename order with fuzzy matching disabled.

The access-log fix (`4d32a2703c79`) is adapted to preserve OpenResty's
`log_escape_non_ascii` setting: the escape-length check and copy both receive
the same location configuration. Its unmodified upstream patch is retained in
`upstream-patches/` for review. Other fixes are unmodified upstream patches.

```sh
docker build --pull=false -t smtvv-openresty:security-20260916 .
```

Before selecting this image in the existing 1Panel Compose file, validate all
mounted virtual hosts and dynamic modules, test an isolated instance, and retain
the previous image and Compose file for rollback. This directory does not create
another public listener or modify the 1Panel database. After a later 1Panel
upgrade, verify that the selected vendor build includes these fixes.
