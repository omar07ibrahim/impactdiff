# Visible and sealed data boundary

ImpactDiff treats label isolation as a filesystem and process boundary, not a field-name
convention. A model process must be able to read every byte in its mount without
learning the intervention family, execution outcome, failed step, severity, or target
localization.

## Storage roots

The planned materializer creates independent content-addressed stores:

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

The feature and model processes receive `visible/` read-only and do not receive a mount,
path, descriptor, or network route to `sealed/`. The two stores do not share hardlinks,
symlinks, or a common CAS. Artifact references contain only a digest, byte length, media
type, and format version. A loader derives the CAS location from the digest, so a
filename cannot smuggle a label such as `clipped-submit` into the feature process.

## Visible evidence manifest

`impactdiff.evidence` contains one opaque evidence ID, the fixed feature profile, a
sanitized action plan, a capture-environment specification, and paired
baseline/candidate checkpoints. Each checkpoint has exactly the same three modalities:
PNG screenshot, accessibility tree, and bounded layout graph.

The action plan is compiled before either execution. It may contain action intents and
opaque target IDs, but never actual status, retry, error, duration, recovery, oracle, or
failed-step fields. Baseline and candidate captures must have the same checkpoint IDs,
ordinals, counts, and modalities. An incomplete pair is invalid and is not made visible
as a shorter candidate sequence.

## Sealed record

`impactdiff.sealed-record` binds to the exact evidence manifest digest. It contains
grouping keys, intervention provenance, raw baseline and candidate outcomes, oracle
results, execution traces, and labels. A scorer derives validity, task regression,
severity, failed step, and localization from this record under a versioned label policy.

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

## Versioning

Version 1 has no extension maps or optional free-form metadata. Unknown keys, new
modalities, and new artifact formats fail closed. Adding a model-visible field requires
a new evidence contract and feature-profile ID, followed by a fresh leakage audit and
benchmark split.
