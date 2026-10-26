# Dependency Ledger

This ledger records the cost and licensing of dependencies introduced by the
Guardian, so that any non-free or restrictively licensed dependency is flagged
before adoption (Requirements 13.1, 13.2, 13.3). Versions are pinned
(Requirement 13.1) and new dependencies prefer well-known, actively maintained
libraries (Requirement 13.2). This is the final Phase 2 ledger.

## Vendored (committed, offline) libraries

| Dependency | Version | License | Cost | Where | Notes |
|------------|---------|---------|------|-------|-------|
| Chart.js | 4.4.6 (pinned) | MIT | Free | `dashboard/vendor/chart.umd.min.js` | Charting_Library for the static Dashboard. Vendored as a committed UMD bundle and loaded same-origin (no CDN), so the Pages_Site renders with no external requests (Req 1.4, 1.5). Well-known, actively maintained. Source: `https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js`. |

### Chart.js vendoring status

Chart.js v4.4.6 (MIT) is now VENDORED: the real pinned UMD build is committed at
`dashboard/vendor/chart.umd.min.js` (~201 KB) and loaded same-origin (no CDN), so
the Pages_Site renders charts with no external requests (Req 1.4, 1.5). The former
`chart.umd.min.js.NEEDS_VENDORING` placeholder has been removed. Source of the
pinned bundle: `https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js`.

## Phase 2 Virtual Office runtime dependencies

The Virtual Office replay viewer (`virtual-office/`) is a Vite + React + Three.js
app. Its direct, notable runtime dependencies are recorded below; transitive
dependencies are not listed. All are permissively licensed (MIT), free, and
version-pinned via `virtual-office/package.json`.

| Dependency | Version | License | Cost | Pinned | Notes |
|------------|---------|---------|------|--------|-------|
| react | ^18.3.1 | MIT | Free | Yes | UI runtime. Well-known, actively maintained. |
| react-dom | ^18.3.1 | MIT | Free | Yes | React DOM renderer. |
| three | ^0.169.0 | MIT | Free | Yes | 3D rendering engine for the office scene. |
| @react-three/fiber | ^8.18.0 | MIT | Free | Yes | React renderer for three.js. |
| @react-three/drei | ^9.122.0 | MIT | Free | Yes | Helper/abstraction library for @react-three/fiber. |
| vite | ^5.4.11 | MIT | Free | Yes | Build/dev tooling (devDependency) for the office app. |

## Phase 2 Guardian runtime dependencies (root)

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

## License summary (Req 13.2)

No non-free or restrictively licensed dependency was introduced in Phase 2. All
direct runtime dependencies are under permissive or weak-copyleft licenses
(MIT, Apache-2.0, ISC, MPL-2.0) that permit free use, redistribution, and
vendoring. All versions are pinned (Req 13.1) and sourced from well-known,
actively maintained libraries (Req 13.2).

