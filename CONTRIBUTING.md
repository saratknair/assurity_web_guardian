# Contributing

This guide covers building, testing, the repository layout, the scans that
guard the code base, and the conventions for changes.

## Prerequisites

- Node.js 22 (the version in `.nvmrc`; `package.json` allows `>=22 <23`)
- Git

## Build and test

```
npm ci
npm run build
npm run typecheck
npm test
```

- `npm run test:unit` runs `tests/unit` only.
- `npm run test:property` runs the property-based tests in `tests/property`.
- `npm run verify` checks the output of the last two runs: both runs exist,
  the run layout is complete, screenshots are present and non-empty,
  `findings.json` is well formed, deterministic findings stay separate from AI
  findings, and the audit log chain is intact.

Instance data (`config/app.config.json`, baselines, `artifacts/runs`) is absent
in a fresh copy. Checks that need it are reported as `skipped: no instance
data`. Set `GUARDIAN_REQUIRE_INSTANCE_DATA=1` for strict mode, where every
skipped check fails instead.

## Folder map

| Path | Contents |
| --- | --- |
| `src/agents` | Check agents that produce findings |
| `src/admin` | Local admin console server and its APIs |
| `src/approval` | Approval workflow for pending items |
| `src/config` | Configuration loading and validation |
| `src/core` | Run orchestration and shared logic |
| `src/publish` | Published data builder |
| `src/reporting` | Run reports |
| `src/safety` | Safety limits and guards |
| `src/telemetry` | Append-only audit log and activity events |
| `src/types` | Shared types |
| `admin-ui/` | Static front end for the admin console (`lib/`, `sections/`) |
| `dashboard/` | Static dashboard published with the site |
| `office/` | Static virtual office published with the site |
| `scripts/` | Entry-point scripts run through npm |
| `scripts/dev/` | Developer scans and tooling |
| `scripts/lib/` | Helpers shared by the scripts |
| `tests/unit` | Unit tests |
| `tests/property` | Property-based tests |
| `tests/helpers` | Shared test helpers |
| `tests/instance` | Tests that need instance data; excluded from export |
| `config/` | Configuration; `*.example.json` files are the committed templates |
| `docs/` | Documentation, including `VENDORED.md` |
| `.github/workflows/guardian.yml` | CI workflow |

## npm scripts

| Script | Purpose |
| --- | --- |
| `console` | Start the local admin console |
| `guardian` | Run the guardian |
| `build` | Compile TypeScript to `dist/` |
| `typecheck` | Type-check without emitting |
| `test` | Run all tests |
| `test:unit` | Run unit tests |
| `test:property` | Run property-based tests |
| `verify` | Check the last two runs |
| `check` | Run Playwright tests |
| `approve` | Approve a pending item |
| `list-pending` | List pending items |
| `init-config` | Create config files from the examples |
| `scan:history` | Comment policy scan |
| `scan:secrets` | Secret scan |

## Scans

Run these before opening a change:

- `npm run scan:history` enforces the comment policy. Comments describe
  current behaviour only: no requirement numbers, no history, ASCII only. The
  allowlist lives in the script.
- `npm run scan:secrets` looks for secret-shaped strings. Exceptions go in
  `scripts/dev/secret-scan.allow.json`, each with a reason. Stale entries fail
  the scan. Tests that need secret-shaped fixtures must build them at runtime
  instead of committing them.
- `node scripts/dev/hash-vendored.mjs --check` verifies vendored files against
  the recorded hashes.
- The self-scans check an assembled site: `scripts/scan-dashboard.mjs`,
  `scripts/scan-office.mjs` and `scripts/check-site-sizes.mjs`.

To assemble a site locally:

```
npm run build
node dist/publish/build-published-data.js <site>
```

Then copy `dashboard/` and `office/` into `<site>` and run the self-scans
against it.

## Code rules

- Use `textContent`, never `innerHTML`, when rendering text in the UI.
- Pass arguments to child processes as arrays; never go through a shell.
- Start Node child processes with `process.execPath`.
- Use `node:path` and `fileURLToPath` for paths; no hard-coded separators.
- The admin console listens on loopback only.
- Published data is additive. Never rename persisted fields such as `aiItems`.
  Older runs must stay readable, so keep Legacy_Run support working.

## Dependencies

Install and update dependencies with exact versions:

```
npm install --save-exact <pkg>@<version>
```

No `.npmrc` is committed, so pass the flag each time. Commit
`package-lock.json` with every dependency change. Dependencies and vendored
libraries are documented in [docs/VENDORED.md](docs/VENDORED.md). When you
change a vendored file, update that document and run
`node scripts/dev/hash-vendored.mjs --check`.

## Commits and pull requests

- Write a short imperative subject, for example `Pin dependency versions`.
- Make one logical change per commit.
- Do not force-push to `main` or to the runs-data branch.
- For pull requests from the same repository, the `verify-platform` job runs
  on Linux and macOS. It must pass before merging.

## License

See [LICENSE](LICENSE).
