# MoZhou v0.1 Release Hardening Design

## Status
Approved by the user on 2026-09-03 after the pre-release red-team review.

## Goal
Turn the current Technical Preview into a safe, truthful release candidate whose primary writing path actually consumes MoZhou's long-form state/context system.

## Release invariants
1. Production/local launcher binds to loopback by default. LAN exposure must be explicit opt-in.
2. The local HTTP API rejects untrusted Host/Origin values, enforces a bounded JSON body, and never treats arbitrary client filesystem paths as trusted merely because they are syntactically valid.
3. Docker production examples do not publish internal database/crawler/gateway ports and contain no fixed production credentials.
4. Tauri ships with a non-null CSP suitable for a local bundled application.
5. User-visible success must correspond to a real effect. Placeholder backup/license/progress data must be removed or returned as explicitly unavailable.
6. The write-generation path must consume a ContextPacket built from the book's current canon/context surfaces rather than an empty packet.
7. Skill selection is a typed contract: the exact property sent by the UI is the exact property consumed by the API and a regression test proves it changes the generated prompt/context.
8. Chapter selection is not hard-coded to chapter 1 in the core request contract. The currently selected chapter index flows from UI state to draft and quality calls.
9. Long-form claims require executable benchmark evidence; CI must exercise at least one multi-chapter continuity scenario with secret, expired fact/dead-character, promise and retroactive-change assertions.
10. Security/release checks are part of CI; dependency/code security scanning and release checksums are produced by automation.

## Architecture
### Local HTTP boundary
Add a focused request-security helper in `apps/web/server/security.ts`. The router calls it before parsing a body. The default trusted hosts are loopback hostnames/IPs on the active port; accepted browser origins are same-origin loopback origins. Requests without Origin remain accepted for same-machine non-browser clients only when Host is trusted. JSON bodies are capped at 1 MiB and malformed non-empty JSON returns 400 instead of silently becoming `{}`.

Filesystem-bearing routes continue to accept book roots for this release because replacing every call site with a persistent capability registry would be a larger contract migration. Instead, every supplied root/parent directory is resolved through a single path guard. Existing book roots must contain MoZhou's book marker/record; creation parents must resolve to an existing directory and child creation remains beneath that resolved parent. The API is no longer remotely reachable by default, so path validation is defense in depth rather than the sole authorization boundary.

### Generation path
Create a `buildDraftContext` adapter in the server layer. It reads the book record/canon/entity cards and recent chapter prose, builds a NarrativeStateSnapshot-compatible compile input, and invokes `@mozhou/context-compiler` when there is recallable state. If a brand-new book legitimately has no recall candidates, it emits a minimal deterministic packet with structural chapter/task information rather than pretending Story Brain contributed context. The returned packet is the packet passed to `runDraftStep` and the text sent upstream is the compiled packet text.

### Truthful commercial/backup surfaces
The community Technical Preview reports membership/license activation as unavailable. No hard-coded active license is returned. Backup must either create a real artifact through an existing data-plane snapshot primitive or report `501 NOT_IMPLEMENTED`; no fabricated path/digest/size is allowed. Hard-coded daily writing streak/progress copy is removed until backed by data.

### Docker/Tauri
The default launcher uses `127.0.0.1`. Docker's user-facing app can remain published, but internal services are `expose`-only. Secrets become required environment variables where a service is actually enabled. Legacy services not required by the Novel OS release are moved behind an explicit profile. Tauri CSP allows only bundled self resources plus the explicit LLM/connect targets required by the architecture; inline/eval are not granted by default.

### Verification
Use TDD. First add regression tests for host/origin/body limits, skill contract, truthful backup/license responses, non-empty compiled generation context and variable chapter index. Push the failing tests to the isolated branch and use PR CI as the RED execution. Implement minimal production changes, then require CI green. Add a long-form benchmark fixture/test and security workflows before the PR is considered ready.

## Non-goals
- No payment processor or DRM implementation in v0.1.
- No cloud sync service implementation in this hardening pass.
- No unrelated UI redesign.
- No new model provider abstraction.
- No broad data-plane refactor.
