# Vendored libraries and dependencies

Third-party code committed to this repository, with version, licence, upstream source and SHA-256 of each file. All libraries are free and permissively licensed.

Verify the hashes with:

```
node scripts/dev/hash-vendored.mjs --check
```

The command exits 1 if a vendored file is changed, added or removed without this table being updated. `node scripts/dev/hash-vendored.mjs` with no argument prints a fresh table to copy from.

## Vendored files

| Name | Version | Licence | Source | File | Size (bytes) | SHA-256 |
|---|---|---|---|---|---|---|
| Chart.js | 4.4.6 | MIT | https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js (npm package chart.js@4.4.6, github.com/chartjs/Chart.js) | `dashboard/vendor/chart.umd.min.js` | 205889 | 9653a0813db743bbe78332a3896e28c7bc7546e4fff51e7e979e908d1f0471d1 |
| three.js | 0.169.0 (r169) | MIT | https://www.npmjs.com/package/three/v/0.169.0 (npm package three@0.169.0, github.com/mrdoob/three.js) | `office/vendor/three.module.min.js` | 687458 | f7cee3c7533449a1505cc12cb5128b89e3d4fd3d7ea62b05f9f5464a217472ee |
| three.js OrbitControls | 0.169.0 | MIT | same package, `examples/jsm/controls/OrbitControls.js` | `office/vendor/OrbitControls.js` | 32134 | 80efaadea4f8a636a65fb0bd08bfef62f3d93a0bb94e2e7500f23176c5c07f4e |
| three.js licence text | 0.169.0 | MIT | same package, `LICENSE` | `office/vendor/three-LICENSE.txt` | 1081 | 4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454 |

Chart.js is the charting library for the static Dashboard. Its MIT licence notice is in the header of the bundle. three.js renders the Virtual Office scene; its licence text is kept next to it in `office/vendor/three-LICENSE.txt`.

## How the pages load them

Both pages load the vendored files by relative URL only. There is no CDN, no absolute URL and no npm dependency for these libraries, so the published pages make no external requests.

- `office/index.html` maps the module names to local files with an import map: `three` to `./vendor/three.module.min.js` and `three/addons/controls/OrbitControls.js` to `./vendor/OrbitControls.js`.
- `dashboard/index.html` loads `./vendor/chart.umd.min.js` with a plain script tag.

The Virtual Office has no other assets. Stations, figures, floor and props are procedural geometry, with no images, fonts, audio or models.

## npm dependencies

The npm packages the Guardian itself uses are listed in `package.json` and locked in `package-lock.json`; those two files are the source of truth for versions. Every version in `package.json` is pinned exactly (no `^` or `~`) and matches the lock file, which `tests/unit/package-scripts.test.ts` checks. All are free and permissively licensed.

| Package | Role | Licence |
|---|---|---|
| @playwright/test | Browser automation and checks | Apache-2.0 |
| @axe-core/playwright | Accessibility scanning (axe-core) | MPL-2.0 (file-level copyleft only; no restriction on use) |
| pixelmatch | Visual diff comparison | ISC |
| pngjs | PNG encode and decode for visual diffs | MIT |
| typescript, vitest, fast-check, @types/* | Build and test tooling (dev only) | Apache-2.0 / MIT |

No non-free or restrictively licensed dependency is used.
