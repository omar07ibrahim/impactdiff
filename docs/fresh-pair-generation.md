# Fresh-pair generation protocol

ImpactDiff can generate and atomically publish one real baseline/candidate pair for the
closed checkout fixture. The API owns every capability that could influence role order,
mutation identity, label derivation, or publication membership:

```ts
const release = await publishFreshMutationFixturePair({
  fixtureDirectory: "fixtures/checkout-card-v1",
  publicationRoot: "artifacts/generated/dev-pointer-v1",
  operatorKey: "pointer_interceptor",
});
```

The option wrapper is copied before the first asynchronous operation and accepts exactly
those three fields. The public API does not accept an action plan, browser session,
replicate index, group ID, label, artifact array, or precomputed result. Replicate index
is fixed to `0`; supported operators are `pointer_interceptor` and `palette_swap`.

## Lifecycle

1. Open and verify a real, canonical, current-UID publication root with exact mode
   `0700`, no symbolic path aliases, and only an optional valid `releases/` namespace.
   This may create or recover the reserved namespace but cannot expose a new sample.
2. Load the runtime-owned canonical source-state and action-plan artifacts, then launch
   one verified Chromium environment and derive the exact runtime binding.
3. Construct the candidate mutation request before either role observes an outcome.
4. Open a fresh baseline BrowserContext session, prepare deterministic geometry, execute
   the fixed action plan, and close and audit the session.
5. Open a different candidate BrowserContext session in the same environment, prepare,
   probe, compile and apply the typed mutation, execute the same plan, roll back the
   mutation, and close and audit the session.
6. Close the owning Chromium environment. No pair is derived or published after a
   capture, cleanup, session-audit, blocked-network, or environment-close failure.
7. Derive every visible and sealed payload and identity, prove exact disjoint artifact
   membership, and replay the complete resolved record in memory.
8. Submit the already-complete pair to the atomic publisher, which audits and replays it
   before and after the single-directory-rename commit point.

Fresh roles use distinct sequential BrowserContexts under one shared verified browser
environment. This neither proves process-level separation nor guarantees process reuse
or renderer topology. Sharing one measured environment is deliberate: both records bind
the same live browser, package, font, launch profile, and capture-spec identity.

## Development label policy

This closed policy makes fixture integration releases inspectable; it is not the future
benchmark scorer.

| Baseline task | Candidate task | Sample                      | Regression | Severity | Localization |
| ------------- | -------------- | --------------------------- | ---------- | -------- | ------------ |
| failed        | either         | invalid (`baseline_failed`) | `null`     | `null`   | none         |
| passed        | passed         | valid                       | false      | 0        | none         |
| passed        | failed         | valid                       | true       | 4        | required     |

Severity `4` means the candidate blocks this fixture's primary checkout action. It does
not establish a universal ordinal for other tasks, applications, or mutation families.
Expected operator relation remains sealed provenance; measured task execution determines
the label. The record commits to a domain-separated policy ID, but resolved replay does
not resolve and independently execute the code-owned policy body.

## Development command

The CLI intentionally exposes only the task-breaking pointer case and prints exactly one
JSON receipt on success:

```bash
install -d -m 0700 artifacts/generated/dev-pointer-v1
npm run --silent release:dev -- --root artifacts/generated/dev-pointer-v1
```

Failures print one bounded JSON error code to stderr without stack traces or filesystem
paths. Every invocation recaptures both roles; when the verified inputs derive the same
evidence and publication identities, the publisher strictly reopens and returns the
existing immutable release.

## Non-claims

This path proves fresh role lifecycle ownership, deterministic derivation, structural
and content-addressed resolved-record replay, and atomic pair publication for one
cooperative vendored fixture. Replay is not browser re-execution or policy attestation.
The path does not produce a train/validation/test corpus, isolate a model process from
`sealed/`, attest Node, kernel, system-library, or loaded browser memory, support
hostile same-uid writers, score arbitrary applications, train a model, or report
benchmark accuracy.
