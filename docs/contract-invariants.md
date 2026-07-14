# Contract invariants

The v1 contract is an executable trust boundary. JSON Schema establishes the shape of
each manifest; runtime validators establish relationships that a schema cannot express.
Validation returns a fresh, recursively frozen data tree so callers never retain hidden
JavaScript state through a typed result.

## Strict JSON boundary

Contract values contain only dense arrays, plain or null-prototype objects, NFC strings,
booleans, null, and safe integers other than negative zero. Accessors, custom
prototypes, symbols, non-enumerable properties, sparse arrays, cycles, invalid Unicode,
and values such as `undefined` fail closed.

Serialized manifests use RFC 8785 canonical JSON with additional contract restrictions:

- UTF-8 is decoded fatally and a byte-order mark is rejected;
- duplicate keys, trailing data, noncanonical key order, and noncanonical escapes are
  rejected;
- encoder and decoder apply the same Unicode, integer, depth, and array rules; and
- hashes are lowercase SHA-256 over canonical bytes.

Root IDs and model-visible routing IDs use domain-separated hashes. An `evidence_id`,
capture ID, checkpoint ID, task ID, environment ID, source-state ID, or feature-profile
ID cannot be independently selected after its label-free body is known. IDs and digests
are routing metadata and are not intended model features.

## Record and split binding

The sealed record stores the canonical digest of its exact visible evidence manifest.
The sealed split audit similarly stores the canonical digest of its exact visible split
assignment. Source-state and mutation-family grouping keys are deterministically derived
where the v1 manifests contain enough evidence; the remaining application,
near-duplicate, source-task, and asset-component groups are policy outputs and must
match between each sealed record and the sealed split audit.

Runtime validation enforces:

- symmetric checkpoint count, order, identity, and modality;
- distinct baseline and candidate capture identities;
- internally consistent outcome, validity, and derived regression fields;
- no visible/sealed digest overlap within a pair or anywhere in a dataset;
- exact assignment, audit, and evidence-record membership;
- one feature profile and one label policy per split;
- grouping disjointness required by the selected holdout protocol; and
- no screenshot, accessibility-tree, or layout-graph digest crossing a partition.

The artifact budget is measured as unique content-addressed storage bytes. Repeated
references with identical metadata count once; the same digest with conflicting media,
length, or format metadata is invalid.

## What manifest validation does not prove

An artifact reference proves identity and declared metadata, not that the referenced
bytes are safe. The materializer must resolve every digest, verify byte length and hash,
decode each media type with bounded parsers, strip PNG ancillary metadata, and validate
the action-plan, capture-spec, accessibility, and layout payload schemas. That resolved
artifact layer is part of the capture milestone and must land before a public benchmark
is claimed leakage-safe.

Likewise, record-only checks establish label consistency; the future versioned scorer
must recompute severity, failed-step membership, and localization from resolved oracle,
trace, action-plan, and policy artifacts. Until then, this repository makes no benchmark
quality or model-accuracy claim.

## Public validation flow

```ts
import {
  parseCanonicalJson,
  validateDatasetBundle,
  validateEvidenceManifest,
} from "impactdiff";

const decoded = parseCanonicalJson(evidenceBytes);
const evidence = validateEvidenceManifest(decoded);

const dataset = validateDatasetBundle(splitAssignment, splitAudit, pairs);
```

`validateDatasetBundle` returns pairs in canonical train, validation, then test order,
independent of caller input order.

`parseCanonicalJson` defaults to a 128 KiB input budget and 100,000 JSON values, which
fits evidence and sealed-record manifests. A trusted pipeline loading a larger split
manifest must pass explicit `ParseLimits`; future large-corpus tooling will replace the
current in-memory path with streaming validation.
