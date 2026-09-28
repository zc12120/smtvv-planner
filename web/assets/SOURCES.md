# Interface assets

The public distribution contains Lucide 0.468.0 (ISC), the Noto, Barlow, Cinzel, Archivo Black and Chakra Petch font families (SIL OFL 1.1), and the original `planner-mark.svg` / `planner-icon.svg` marks (MIT). Full notices are preserved beside the files and listed in [THIRD_PARTY.md](../../THIRD_PARTY.md).

- Lucide source: https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js
- Noto Sans SC: https://github.com/google/fonts/tree/main/ofl/notosanssc
- Barlow Condensed: https://github.com/google/fonts/tree/main/ofl/barlowcondensed
- Barlow: https://github.com/google/fonts/tree/main/ofl/barlow
- Cinzel: https://github.com/google/fonts/tree/main/ofl/cinzel
- Archivo Black: https://github.com/google/fonts/tree/main/ofl/archivoblack
- Chakra Petch: https://github.com/google/fonts/tree/main/ofl/chakrapetch
- Noto Sans / Serif CJK: https://github.com/googlefonts/noto-cjk

The public interface uses normal-width Barlow with locale-specific Noto Sans. SMT V titles pair Cinzel with Noto Serif CJK; P5 uses Archivo Black; P3 Reload uses Chakra Petch. The shared definitions live in `web/auth/theme/typography.css`. The admin console and sign-in page use the same SMT V typography. The supplied WOFF2 conversions retain the upstream OFL notices. No external font service is used at runtime. See [design references and font build instructions](../../docs/DESIGN.md).

Game logos, portraits, attribute icons and ailment icons remain copyright ATLUS / SEGA. They are bundled in this complete website copy, with their source and verification manifests. See [the resource documentation](../../docs/ASSETS.md).

The sign-in page uses the same logo as the public site and admin console. Its copy at `web/auth/theme/smtvv-logo.png` loads before authentication and falls back to the text site name if unavailable. All page tabs use `web/auth/theme/smtvv-favicon.png`, the matching 64px V icon copied from `web/assets/favicon.png`. Both authentication assets are included in this repository and its Docker images.
