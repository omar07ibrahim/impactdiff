# Visible and sealed data boundary

ImpactDiff treats label isolation as a filesystem and process boundary, not a field-name
convention. A model process must be able to read every byte in its mount without direct
access to declared intervention metadata, execution outcomes, failed steps, severity, or
target-localization labels. Visible evidence may still support statistical inference
about a mutation family; eliminating that scientific confound requires held-out-family
evaluation rather than a storage claim.

The current implementation validates manifests, cross-record relationships, canonical
bytes, and the composition of supported resolved evidence and intervention bundles. It
also provides a private registered-codec content-addressed store and a paired
visible/sealed store audit, plus a verified Chromium session for the closed local
fixture. The end-to-end dataset publisher, read-only process mounts, and scorer are not
complete, so the project does not yet claim that a released corpus is leakage-safe model
input.

## Storage roots

The intended publisher layout uses independent content-addressed stores:

```text
visible/
  evidence/
  cas/sha256/
  splits/

sealed/
  records/
  cas/sha256/
  split-audits/
```

The future feature and model processes receive `visible/` read-only and do not receive a
mount, path, descriptor, or network route to `sealed/`. Artifact references contain only
a digest, byte length, media type, and format version. A loader derives the CAS location
from the digest, so a filename cannot smuggle a label such as `clipped-submit` into the
feature process.

`ArtifactStore` already enforces the storage-side subset of this boundary. Visible and
sealed roots must be distinct and non-nested; pair audit rejects shared content digests
or inodes and requires exact membership. Each supported media type has one codec that
canonicalizes and validates on write, read, and audit. This proves neither mount
isolation nor resistance to another same-uid process: v1 supports one process, one store
instance per private root, and one logical writer. The complete threat boundary is
documented in [contract invariants](contract-invariants.md).

## Generation-side browser boundary

The fixture session belongs to the trusted generator, never to the model-visible feature
process. It receives canonical visible action-plan bytes and sealed mutation
instructions, verifies the fixed fixture resources and browser version, blocks external
traffic, audits DOM/CSS/CSP/clock state, and requires exact rollback of its owned
mutation node. The action plan determines `task_id`; mutation family, operator,
preconditions, cleanup state, and blocked-task result remain generator-side or
label-side data. Detailed integrity events exist only in bounded in-memory enforcement
state; a successful close exposes a small generator-side summary, not a durable trace
for the model.

This is not yet the dataset-publication boundary. The session resolves canonical sealed
source-state bytes and derives `source_state_id`, but still trusts upstream
`environment_id`, cannot attest the hash of a Browser process that is already running,
and exposes a same-process Playwright `Page` capability to trusted generator code. A
complete publisher must still bind the captured modalities to the canonical capture
specification, store them under their exact visible references, move traces and outcomes
to the sealed root, audit both stores, and mount only the visible root into an isolated
feature process.

## Visible evidence manifest

`impactdiff.evidence` contains one opaque evidence ID, the fixed feature profile, a
sanitized action plan, a capture-environment specification, and paired
baseline/candidate checkpoints. Each checkpoint has exactly the same three modalities:
canonical PNG screenshot, normalized accessibility tree, and bounded normalized layout
graph.

The future publisher must fix the action plan before either execution. The plan may
contain action intents and opaque target IDs, but never actual status, retry, error,
duration, recovery, oracle, or failed-step fields. Baseline and candidate captures must
have the same checkpoint IDs, ordinals, counts, and modalities. An incomplete pair is
invalid and is not made visible as a shorter candidate sequence.

Every model-visible routing identity is derived with a domain-separated hash from a
label-free canonical body. Source-state identity is the one cross-boundary case: its
body is a sealed artifact reference, so standalone evidence validation checks only its
shape and visible/sealed pair validation proves its derivation. This does not prove that
a producer selected any body before observing an outcome. Feature code will consume
ordered modality payloads, not routing IDs, content digests, or manifest filenames as
learned features.

The capture specification describes only the renderer and environment: pinned browser
and package builds, container/platform, font bundle, viewport, locale, timezone, media,
virtual clock, screenshot policy, network policy, budgets, and geometry quantization. It
intentionally contains neither source revision nor mutation operator. Source-state
identity and the task reference are separate visible fields, while operator
identity/version stay in the sealed record. The sealed record references a canonical
source-state artifact with the fixture revision, raw manifest digest, resource set, and
initial-state policy. The runtime resolves that artifact and matches it to the exact
fixture package; the future publisher must materialize it only in the sealed store.

## Sealed record

`impactdiff.sealed-record` binds to the exact evidence manifest digest. It contains
source-state provenance, grouping keys, intervention provenance, raw baseline and
candidate outcomes, oracle results, execution traces, and labels. Its intervention
references a typed mutation plan and precondition report; those payloads embed and bind
the exact pre-outcome request/source probe. A scorer derives validity, task regression,
severity, failed step, and localization from the record under a versioned label policy.

The current record validator checks consistency among stored scalar outcomes and labels;
the scorer that replays the versioned policy against resolved trace and oracle artifacts
has not landed yet. Severity should therefore be read as contract data, not as a
validated benchmark claim.

If the baseline task fails, the sample is invalid. Its outcome remains useful for
generator diagnostics, but it cannot become a negative benchmark item.

## Split manifests

A visible split assignment lists only opaque evidence IDs in sorted train, validation,
and test partitions. It carries no group IDs or class counts. A separate sealed audit
maps each evidence ID to application, source-state, source-task, near-duplicate,
shared-asset, and mutation-family groups.

The audit code must recompute overlap. It does not trust a stored `passed` boolean.
Joint holdouts require application and mutation-family disjointness; all protocols also
keep source states, near duplicates, and transitive shared-asset components within one
partition.

Dataset validation also requires exact assignment/audit/record membership, a single
feature and label policy, global visible-versus-sealed CAS separation, and partition
ownership for every screenshot, accessibility, and layout digest. Reuse of the global
action plan or capture specification is allowed; reuse of an observation across a
partition boundary is not.

## Canonical encoding and binding

All four dataset manifests are closed v1 schemas and canonical JSON documents. The
action plan, capture specification, normalized accessibility tree, and normalized layout
graph add four closed resolved-payload schemas; mutation requests, probes,
preconditions, and plans are closed sealed contracts. The decoder rejects duplicate
keys, invalid UTF-8 or Unicode, non-NFC strings, unsafe or fractional numbers, hidden
JavaScript state, and noncanonical serialization. Root identities bind canonical bodies,
sealed records bind exact evidence-manifest digests, and split audits bind exact
assignment digests.

Screenshots are decoded under fixed resource limits and deterministically re-encoded as
RGBA PNG. This discards ancillary chunks and clears invisible RGB values beneath zero
alpha before hashing, closing two channels that metadata-only stripping would leave.

See [contract invariants](contract-invariants.md) for the implemented codec checks, CAS
threat boundary, and remaining end-to-end materialization work.

## Versioning

Version 1 has no extension maps or optional free-form metadata. Unknown keys, new
modalities, and new artifact formats fail closed. Adding a model-visible field requires
a new evidence contract and feature-profile ID, followed by a fresh leakage audit and
benchmark split.

The repository remains at `0.0.0` and has not released a corpus. Moving
`source_state_id` from the former task/environment/baseline-derived prototype to the
sealed source-state reference is therefore an explicit pre-release v1 identity reset,
not a compatible migration for artifacts produced by earlier commits.
