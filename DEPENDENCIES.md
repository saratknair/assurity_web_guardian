# Dependency Ledger

This ledger records the cost and licensing of dependencies introduced by the
Guardian, so that any non-free or restrictively licensed dependency is flagged
before adoption. Versions are pinned and new dependencies prefer well-known,
actively maintained libraries.

## Vendored (committed, offline) libraries

| Dependency | Version | License | Cost | Where | Notes |
|------------|---------|---------|------|-------|-------|
| Chart.js | 4.4.6 (pinned) | MIT | Free | `dashboard/vendor/chart.umd.min.js` | Charting_Library for the static Dashboard. Vendored as a committed UMD bundle and loaded same-origin (no CDN), so the Pages_Site renders with no external requests. Well-known, actively maintained. Source: `https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js`. |

### Chart.js vendoring status

Chart.js v4.4.6 (MIT) is VENDORED: the real pinned UMD build is committed at
`dashboard/vendor/chart.umd.min.js` (~201 KB) and loaded same-origin (no CDN), so
the Pages_Site renders charts with no external requests. Source of the
pinned bundle: `https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js`.

## Virtual Office (vendored three.js)

The Virtual Office replay viewer (`office/`) is a static, no-build page. It has no
npm dependency, no bundler, and no CDN. three.js is vendored and loaded
same-origin through an import map. Sizes and SHA-256 for every vendored file are
recorded in `office/ASSET-LICENCES.md`.

| Dependency | Version | License | Cost | Where | Notes |
|------------|---------|---------|------|-------|-------|
| three.js | r169 (0.169.0, pinned) | MIT | Free | `office/vendor/three.module.min.js`, `office/vendor/OrbitControls.js` | 3D rendering engine for the office scene. Vendored, committed, loaded via import map (no CDN, no npm dependency). Licence text at `office/vendor/three-LICENSE.txt`. See `office/ASSET-LICENCES.md` for sizes and SHA-256. |
## Guardian runtime dependencies (root)

Recorded for completeness; all MIT/ISC-class permissive, free, and pinned via
the root `package.json`.

| Dependency | Version | License | Cost | Pinned | Notes |
|------------|---------|---------|------|--------|-------|
| @playwright/test | ^1.48.0 | Apache-2.0 | Free | Yes | Browser automation / checks. Well-known, actively maintained. |
| @axe-core/playwright | ^4.10.0 | MPL-2.0 | Free | Yes | Accessibility scanning (axe-core). File-level copyleft only; no restriction on use. |
| ajv | ^8.17.1 | MIT | Free | Yes | JSON schema validation. |
| ajv-formats | ^3.0.1 | MIT | Free | Yes | Format validators for ajv. |
| pixelmatch | ^6.0.0 | ISC | Free | Yes | Visual diff comparison. |
| pngjs | ^7.0.0 | MIT | Free | Yes | PNG encode/decode for visual diffs. |

## License summary

No non-free or restrictively licensed dependency is used. All
direct runtime dependencies are under permissive or weak-copyleft licenses
(MIT, Apache-2.0, ISC, MPL-2.0) that permit free use, redistribution, and
vendoring. All versions are pinned and sourced from well-known,
actively maintained libraries.

