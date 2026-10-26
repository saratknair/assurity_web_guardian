# Migrations

Human-readable record of data/format migrations. The authoritative machine
record lives in the append-only audit log (`artifacts/audit.jsonl`), emitted at
run time; this file is a one-time summary for reviewers.

## Phase 2: `test-manifest.json` `specPath` → repo-relative (Req 8.2, 11.8)

**What changed.** The `specPath` stored in each run's `test-manifest.json` is now
a repo-relative path with forward slashes
(e.g. `tests/generated/<slug>.baseline-v<N>.spec.ts`) instead of an absolute,
machine-local filesystem path. The spec file is still written to its absolute
location on disk (behavior unchanged); only the *stored* value is relative.

**Why.** No absolute/internal filesystem path may leak into published data
(Req 8.2, 11.8). Repo-relative paths are portable and machine-independent.

**Legacy data.** Existing on-disk manifests from prior runs are left untouched
(non-destructive). Any absolute paths in legacy manifests are sanitized at
publish time, so they never reach published output.

**Audit record.** Each run emits an append-only audit note
(`type: "migration"`, reason `"test-manifest.specPath is now repo-relative
(Req 8.2, 11.8)"`) via `tel.audit(...)` in `src/core/orchestrator.ts`. The
append-only guarantee of the audit log is unchanged.
