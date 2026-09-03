# v0.1 Technical Preview release gates — 2026-09-03

This document records the hardening boundary used for PR #90. It is intentionally a gate description, not evidence that the release has passed; GitHub Actions on the final commit are the source of truth.

## Required before merge or release

- Workspace TypeScript build passes.
- All package tests pass.
- `apps/web` typecheck, tests, and production Vite build pass.
- Dependency audit gate passes with no configured blocking vulnerabilities.
- Security workflow (gitleaks secret scan + SPDX SBOM) passes. CodeQL SARIF upload requires GitHub Advanced Security on this private repository, so the executable security gates in `security.yml` replace CodeQL; `codeql.yml` was removed for that reason.
- Legacy app CI remains green.
- HTTP API rejects untrusted Host/Origin, malformed JSON, and oversized bodies.
- Desktop/server defaults bind locally unless explicitly deployed inside the container network.
- Technical Preview surfaces fail closed for capabilities without a real provider/source; no canned ranking, web-search, analysis, backup, license, login, export, compliance, progress, or rollback result is presented as real.
- Draft generation consumes the existing Context Compiler / Context Receipt path rather than constructing an empty production context.
- Selected skills and chapter index reach the server contract used by draft generation.
- Release artifacts include SHA-256 checksums and are labelled Technical Preview.
- The 50-chapter continuity benchmark remains green for secret leakage, stale facts, dead-character resurrection, expired promises, and upstream revision impact.

## Merge policy

PR #90 remains isolated from `master` until its final-head checks are green and the diff has been reviewed. The hardening work does not authorize an automatic merge.
