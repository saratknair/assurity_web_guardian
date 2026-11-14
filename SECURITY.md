# Security

This document describes how Guardian is protected, what it stores, what access it needs, and how to report a problem.

## Trust model

**Local admin console.**
- The console listens on 127.0.0.1 only. The address is fixed in code and cannot be changed by an option or environment variable.
- Every request must carry a `Host` header that is the loopback address and the console port. This blocks DNS rebinding.
- Every request that changes state must also pass these checks: an `Origin` (when present) that is the same loopback origin, a `Sec-Fetch-Site` value that is not `cross-site` or `same-site`, and a JSON content type. No CORS headers are sent.
- File access goes through one port that rejects absolute paths, `..` segments and NUL bytes. Run ids, slugs and log names are matched against fixed patterns before they reach a path.
- Background jobs run only scripts from a fixed list, with no shell, and with an allow-listed environment.
- There is no login. The person who can reach the console on the local machine is trusted. Decisions are attributed to a Reviewer name that the user types, not to a verified identity. Do not run the console on a shared machine.

**CI workflow.**
- The default token is read-only. Each job sets its own permissions, and write scopes exist only in the job that deploys Pages and the job that pushes run data.
- Every third-party action is pinned to a full commit SHA.
- Jobs do not run in forks. Pull requests run only a read-only verification job, and only for branches in the same repository. The workflow never uses `pull_request_target`.
- Event and input values reach shell steps only through `env:`, never by interpolation into `run:`.

**Published static site.**
- Published data is sanitised first (see "Data stored").
- The dashboard and the virtual office fetch relative URLs only. They make no requests to third-party hosts, and all libraries are served from the repository (see "Vendored libraries").

**Guardian runs.**
- A run visits only the approved domain and its subdomains. Every navigation is checked against that domain before it happens.
- Runs are gentle on the site: one page at a time, spacing between requests, no form submission and no load testing.
- Guardian sends no data to external telemetry services and makes no calls to AI or language-model services, so there is no prompt-injection surface.

## Data stored

| Where | What |
| --- | --- |
| `artifacts/` on the machine that runs Guardian | Per-run folders with screenshots, traces, accessibility results, findings, results, test manifests, an event log, and an append-only audit log. Also the dispositions log, which records reviewer decisions and the Reviewer names typed into the console. |
| `runs-data` branch | Run folders committed by the workflow, so history survives between runs. |
| GitHub Pages | The static dashboard and virtual office with sanitised run data. |

- Before publishing, local file paths, home folders and secret-shaped values are removed from the data. Older manifests that hold absolute paths are cleaned the same way.
- Nothing from authenticated areas of a site is captured by default.
- Credentials are never written to run data. Guardian does not store or read a GitHub token. Git operations from the console use the user's own git credentials.
- Pages content is reachable by anyone if the repository or its Pages site is public. Screenshots, findings and Reviewer names are part of that content. Treat published data as public.

## Permissions needed

| Job | GitHub token scopes |
| --- | --- |
| Run Guardian | `contents: read` |
| Verify on other platforms (pull requests and manual runs) | `contents: read` |
| Deploy Pages | `pages: write`, `id-token: write` |
| Push run data to `runs-data` | `contents: write` |

- The workflow uses no repository or organisation secrets. It relies on the automatic `GITHUB_TOKEN` only.
- Actions and Pages must be enabled for the repository, with the Pages source set to GitHub Actions.
- Publishing and syncing from the console use the git credentials already configured on the local machine. Use an account with only the access it needs.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Repository maintainers should enable this feature under Settings, Code security.

Please do not post vulnerability details, tokens, or other secrets in public issues or pull requests. Include the affected version or commit, the steps to reproduce, and the impact you see.

## Known advisories

`npm audit` reports six findings. All are in development-only packages reached through the test runner `vitest` 2.1.9. `npm audit --omit=dev` reports none for the runtime dependencies.

| Package | Severity | Advisories |
| --- | --- | --- |
| vitest | critical | GHSA-5xrq-8626-4rwp, GHSA-82fw-gwwq-j7x9 |
| tinypool | critical | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr |
| vite | high | GHSA-587h-7wmj-h5pm, GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-v6wh-96g9-6wx3, GHSA-4w7w-66w2-5vf9, GHSA-rq7h-c2jc-7f22, GHSA-fx2h-pf6j-xcff, GHSA-9jrq-w75r-8gcw |
| @vitest/mocker | moderate | GHSA-82fw-gwwq-j7x9, GHSA-qxg6-89mg-rqv8 |
| esbuild | moderate | GHSA-67mh-4wv8-2f99 |
| vite-node | moderate | Through vite |

Why they remain: the only fix npm offers is vitest 4, a breaking major upgrade. The affected code is a development server, a UI server, or worker options. The test suite runs `vitest run` only, starts no reachable dev server, and takes no attacker-controlled input. The risk is accepted for development machines until the upgrade is done.

Documented code risks, accepted for a single-user local tool:
- The console's file port checks paths lexically and follows symlinks inside the project folder. Exploiting this needs write access to the project, which already allows editing the code. Run logs and the local dashboard refuse symlinks.
- A non-browser client on the same machine can send a request with no `Origin` header. It still needs the exact `Host`, a JSON content type and loopback access. Browsers always send `Origin` on cross-origin requests, so CSRF protection is unchanged.
- The console has no authentication. Any local process or user on the same machine can reach it.

## Vendored libraries

Third-party browser libraries are copied into the repository, not loaded from a CDN. Versions, licences, sources and SHA-256 hashes are listed in [docs/VENDORED.md](docs/VENDORED.md). To confirm the files are unchanged, run:

```
node scripts/dev/hash-vendored.mjs --check
```

## Re-running the checks

```
npm run scan:secrets   # pattern scan of tracked files
npm run scan:history   # scan of comments for stage and history wording
npm audit              # dependency advisories
npm audit --omit=dev   # runtime dependencies only
npm run verify         # platform self-checks
npm test               # unit, property and integration tests
```

## Limits

Scans and reviews cannot prove that a repository is free of secrets or vulnerabilities. The secret scan matches known patterns and can miss a secret that has an unusual shape. Dependency audits report only advisories that are already published.

The security review behind this document is a point-in-time review, completed on 2026-11-15. It applies to the code as reviewed then and does not cover later changes. Re-run the checks above after any change, and before publishing data from a new instance.
