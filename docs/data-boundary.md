# Visible and sealed data boundary

ImpactDiff treats label isolation as a filesystem and process boundary, not a field-name
convention. A model process must be able to read every byte in its mount without direct
access to declared intervention metadata, execution outcomes, failed steps, severity, or
target-localization labels. Visible evidence may still support statistical inference
about a mutation family; eliminating that scientific confound requires held-out-family
evaluation rather than a storage claim.

The current implementation validates manifests, cross-record relationships, canonical
bytes, and the composition of supported resolved evidence and intervention bundles. It
also provides a private registered-codec content-addressed store, a paired
visible/sealed audit, and a verified Chromium session for the closed local fixture. An
atomic publisher now materializes and reopens one complete visible/sealed pair. The
fresh-session pair assembler, multi-pair dataset builder, read-only process mounts, and
scorer are not complete, so the project does not yet claim that a released corpus is
leakage-safe model input.

## Storage roots

Each committed pair uses independent content-addressed stores:

```text
releases/<evidence_id>/
  COMMIT.json
  visible/
    evidence/<evidence_id>.json
    cas/sha256/
  sealed/
    records/<sealed_record_id>.json
    cas/sha256/
```

The future feature and model processes receive `visible/` read-only and do not receive a
mount, path, descriptor, or network route to `sealed/`. Artifact references contain only
a digest, byte length, media type, and format version. A loader derives the CAS location
from the digest, so a filename cannot smuggle a label such as `clipped-submit` into the
feature process.

`ArtifactStore` and `PairedReleasePublisher` enforce the storage-side subset of this
boundary. Visible and sealed roots must be distinct and non-nested; pair audit rejects
shared content digests or inodes and requires exact membership. The publisher commits a
complete pair with one directory rename only after fixed-codec audit and full resolved
replay, then repeats verification from the final path. This proves neither mount
isolation nor resistance to another same-uid process: v1 supports one process and one
logical writer per private root. The complete protocol is documented in
[paired publication](paired-publication.md).

## Generation-side browser boundary

The fixture session belongs to the trusted generator, never to the model-visible feature
process. Its launcher owns the Chromium process and creates canonical CaptureSpec bytes
only after hashing the installed Playwright roots, complete browser installation, live
executable/command line, and exact declared font, and requiring the software
measurements to equal project pins. The session resolves exact source-state,
action-plan, and CaptureSpec artifacts; derives `source_state_id`, `task_id`, and
`environment_id` from their references; blocks external traffic; audits actual
custom-font use at initialization and every checkpoint plus DOM/CSS/CSP/clock state; and
requires exact rollback of its owned mutation node. It allows one active branded session
lease and poisons the environment after any unconfirmed context cleanup. Its single-role
task executor fixes preparation before mutation, holds the authenticated operation lock
across both checkpoints and the real coordinate click, and returns canonical screenshot,
accessibility, and layout bytes only as a complete two-checkpoint sequence. Mutation
family, operator, preconditions, cleanup state, and blocked-task result remain
generator-side or label-side data. Detailed integrity events exist only in bounded
in-memory enforcement state; a successful close exposes a small generator-side summary,
not a durable trace for the model.

At this trusted-generator layer, `MutationFixtureTaskRun` returns copy-on-read canonical
modalities and the measured task outcome together. It is provisional until mutation
cleanup and the session-close audit succeed, and is not itself a visible artifact. The
pending pair assembler must discard it after any lifecycle failure, derive outcome,
trace, intervention, and label payloads only after both roles close, and then submit the
complete visible/sealed input to the publisher.

This is not yet the complete dataset boundary. The launcher verifies project-pinned
installed bytes and the live process command line under a trusted same-process,
non-hostile filesystem boundary; host mode does not attest loaded process memory, the
Node binary, kernel or system libraries. The session also exposes a same-process
Playwright `Page` capability to trusted generator code. The publisher stores complete
inputs under exact references and audits both stores, but a generator must still prove
fresh role lifecycles and an isolated feature runner must mount only `visible/`.

## Visible evidence manifest

`impactdiff.evidence` contains one opaque evidence ID, the fixed feature profile, a
sanitized action plan, a capture-environment specification, and paired
baseline/candidate checkpoints. Each checkpoint has exactly the same three modalities:
canonical PNG screenshot, normalized accessibility tree, and bounded normalized layout
graph.

The pending pair assembler must fix the action plan before either execution. The plan
may contain action intents and opaque target IDs, but never actual status, retry, error,
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

The capture specification describes only the renderer and environment: exact installed
Playwright file trees, browser distribution/executable/source revision/launch profile,
the browser's complete installation file tree, an honest host or OCI execution shape
reserved for external verification, a closed list of exact render-font files, viewport,
locale, timezone, media, virtual clock, screenshot policy, network policy, budgets, and
geometry quantization. It intentionally contains neither application source revision nor
mutation operator. Source-state identity and the task reference are separate visible
fields, while operator identity/version stay in the sealed record. The sealed record
references a canonical source-state artifact with the fixture revision, raw manifest
digest, resource set, and initial-state policy. The runtime resolves that artifact and
matches it to the exact fixture package; the publisher permits it only in the sealed
store.

Host execution records only `linux/amd64` and makes no container-image claim; it is a
development capture mode, not a reproducible base-image attestation. OCI execution
instead names the immutable base image before the repository, fixture, or CaptureSpec is
mounted, and is acceptable only after an external trusted orchestrator verifies the
referenced in-toto subject and exact statement bytes. Today that branch is structural
and reserved: the launcher emits host mode, the host capability rejects a different OCI
CaptureSpec, and schema validation alone does not verify an attestation. This split
avoids both fictitious host digests and an image that would need to contain its own
hash.

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
sealed source-state reference, and replacing the former ambiguous capture-environment
hashes, are explicit pre-release v1 identity resets—not compatible migrations for
artifacts produced by earlier commits. New capture-spec bytes also reset their artifact
reference, environment ID, feature-profile ID, evidence ID, and every downstream
identity that commits to those values.
