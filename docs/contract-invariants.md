# Contract invariants

The v1 contract is an executable trust boundary. JSON Schema establishes the shape of
each manifest and capture payload; runtime validators establish relationships that a
schema cannot express. Validation returns a fresh, recursively frozen data tree so
callers never retain hidden JavaScript state through a typed result.

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
capture ID, checkpoint ID, task ID, environment ID, or feature-profile ID cannot be
independently selected after its label-free visible body is known. Source-state identity
is derived from a sealed source-state artifact reference and is therefore checked at the
visible/sealed pair boundary rather than by the standalone evidence validator. IDs and
digests are routing metadata and are not intended model features.

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

## Resolved artifact boundary

An artifact reference alone proves only a declared digest, media type, format version,
and byte length. `ArtifactStore` adds the resolved-byte boundary. A store opens with an
explicit set of codecs, with exactly one registered codec per media type. Every write:

1. checks both the store and codec byte budgets;
2. canonicalizes and validates the payload before hashing;
3. canonicalizes the result again and rejects a non-idempotent codec; and
4. publishes the canonical bytes at a digest-derived path.

Reads and audits do not trust publication. They open the leaf without following
symlinks, compare path and file-descriptor identity, require a regular single-link file,
read with an exact byte budget, verify stable metadata and SHA-256, then run the
registered codec again. Stored bytes must already equal the codec's canonical output. An
audit requires exact reference-to-store membership and seals that `ArtifactStore`
instance against later writes. A paired audit also rejects nested or aliased visible and
sealed roots, shared digests, and shared inodes.

Published roots and shard directories must belong to the current uid with exact mode
`0700`; artifact leaves must have exact mode `0400`. Publication uses a private
temporary file, fsync, and atomic rename under the threat boundary below. Unexpected
files, abandoned temporary entries, symlinks, hardlinks, ownership changes, and
permission drift fail closed.

### ArtifactStore v1 threat boundary

The supported v1 deployment is a private staging root with one process, one same-process
`ArtifactStore` instance, and one logical writer. The instance serializes its own
publication and audit operations.

External processes, a second writer—including another process running as the same
uid—and hostile concurrent filesystem mutation are explicitly out of scope. Unix mode
bits do not defend a file from another process with the same uid. Supporting that model
requires an `openat2`/`renameat2`-backed native helper plus inter-process locking; the
Node path-based implementation does not claim that guarantee.

### PairedReleasePublisher v1 transaction

The paired publisher accepts one complete evidence/sealed-record pair and the exact
unique artifacts referenced by each side. It copies all caller-owned bytes before its
first asynchronous operation, uses a fixed project codec registry, and constructs both
stores beneath one reserved private staging directory. Canonical record files and a
domain-separated `COMMIT.json` bind both record identities, hashes, and byte lengths.

Before commit, the publisher audits exact visible/sealed membership and reconstructs the
entire resolved record. This replay checks changed surface, both executable oracle
results, raw task traces, measured outcomes, and optional localization against the
captured action, layout, and accessibility state. The complete staging directory becomes
visible through one same-parent rename to `releases/<evidence_id>`, followed by parent
fsync, inode rebinding, path-name binding, and a second strict replay. Pre-rename
failure removes only a bounded reserved staging tree; post-rename uncertainty never
rolls a visible release back and poisons the process-local publisher queue.

The final directory is named by the label-free evidence ID. `COMMIT.json` and `sealed/`
remain outside the `visible/` model boundary. This is an atomic storage transaction, not
proof that its two roles came from fresh browser sessions and not process-level mount
isolation. The exact topology, recovery rules, capacity, and threat model are documented
in [paired publication](paired-publication.md).

## Canonical capture payloads

The registered production codecs cover source-state provenance, action plan, capture
specification, accessibility snapshot, layout snapshot, mutation plan, precondition
report, changed surface, executable oracle result, raw trace, localization, and PNG
screenshot. JSON codecs parse the bounded canonical document, validate its closed v1
schema and semantic invariants, then emit canonical JSON again.

The resolved evidence validator composes those payload guarantees for bytes supplied by
an artifact resolver. It checks each digest, byte length, media type, and format
version; requires already-canonical payloads; binds screenshot dimensions to the capture
viewport; matches both checkpoint sequences to the fixed action-plan schedule; and
applies the action/accessibility/layout graph checks at every checkpoint. The resolved
intervention validator similarly composes one visible manifest, sealed record,
source-state artifact, mutation plan, and precondition report. It resolves and parses
every canonical payload, then checks their exact references and source, task,
environment, operator, instance, and expected-relation bindings.

The resolved-record validator adds the sealed execution layer. It verifies that changed
surface is derived from the exact plan and probe; oracle observations agree with the
final layout/accessibility state; raw trace steps reproduce the fixed action plan and
scalar outcome; and regression localization, when present, names the derived failed step
and changed surface.

These validators deliberately accept resolved bytes rather than paths. They prove the
composition of the supplied payload bundle, not that an arbitrary external resolver or
filesystem mount is trustworthy.

PNG handling is decode-and-reencode canonicalization, not metadata filtering by name.
The decoder verifies every chunk CRC, enforces chunk, byte, dimension, pixel, and exact
inflate budgets, accepts only bounded non-interlaced eight-bit RGB, indexed, or RGBA
images, and rejects APNG and unknown critical chunks. Decoded pixels are normalized to
RGBA, RGB beneath zero alpha is cleared, and a deterministic encoder emits only
`IHDR`/`IDAT`/`IEND`. The PNG codec can also bind the decoded image to the dimensions in
the capture specification.

Four closed capture payloads establish the model-visible surface:

- the action plan is non-branching, uses a bounded action vocabulary, and fixes an
  initial/final checkpoint schedule before execution;
- the capture specification pins exact installed Playwright file trees, browser
  installation tree/executable/source revision/launch profile, execution mode,
  render-font files, display, locale, timezone, media, virtual clock, network policy,
  budgets, and Q64 geometry rules;
- the accessibility snapshot is a bounded normalized preorder tree with allowlisted
  roles and states; and
- the layout snapshot is a bounded normalized preorder graph containing Q64 boxes,
  selected computed style, paint order, and opaque action-target links.

The capture specification contains renderer/environment provenance only. The evidence
manifest carries a separate opaque source-state identity and task reference. Its sealed
record now references a canonical source-state artifact containing the fixture identity,
revision, license, entrypoint, exact raw-manifest identity, normalized resource digests
and lengths, and fixed initial-state policy. The pair validator derives the visible
source ID from that reference, while the closed fixture runtime resolves the bytes and
matches the complete package description before opening a page. Raw browser node IDs are
used only inside the normalization adapter and cannot appear in normalized
accessibility/layout payloads. The normalizers reject ambiguous, dangling, cyclic,
disconnected, overdeep, oversized, or non-finite input; the payload validators enforce
cross-graph action and accessibility links.

The `checkout-card-v1` fixture is self-contained: its manifest pins the fixture revision
and hashes every HTML, CSS, JavaScript, font, and license resource; its CSP denies
external connections; and readiness is published only after the vendored font loads. The
Latin variable WOFF2 comes from `@fontsource-variable/noto-sans@5.2.10` and remains
under the SIL Open Font License 1.1, whose
[text is shipped beside the font](../fixtures/checkout-card-v1/fonts/OFL-1.1.txt). The
capture schema pins the three Playwright 1.61.1 package roots and Chromium Headless
Shell registry revision 1228 (149.0.7827.55), while keeping its live source revision,
complete installation tree, executable bytes, and normalized launch profile distinct.
The host launcher requires all computed digests to equal the project's known-good
closure; these are reproducibility pins, not vendor signatures.

### Verified Chromium mutation session

`launchMutationFixtureEnvironment` accepts the fixture directory, launches and owns the
pinned Chromium Headless Shell, and returns a branded capability plus fresh copy-on-read
canonical CaptureSpec bytes. `openMutationFixtureSession` accepts that capability and
canonical source-state, action-plan, and CaptureSpec artifacts. Before returning a
session, together they:

- hash every regular file under the exact `@playwright/test`, `playwright`, and
  `playwright-core` package roots, reject symbolic, hard-linked, and special entries,
  validate package versions and the Headless Shell registry entry, then require the
  resulting closure digest to equal the project pin;
- hash the complete live browser installation and executable, read the live source
  revision and command line through CDP, and bind a normalized launch profile that
  substitutes only the binary and ephemeral user-data paths, with each live measurement
  required to equal its project pin;
- verify the exact WOFF2 before launch and prove at session initialization and before
  every checkpoint that rendered glyphs use only that custom Noto Sans resource;
- verify the source-state `ArtifactRef` and canonical bytes, match the exact closed
  fixture package and initial state, then derive `source_state_id` from the reference;
- verify the exact action-plan `ArtifactRef`, canonical bytes, and supported primary
  pointer target, then derive `task_id` from that reference;
- verify the exact CaptureSpec `ArtifactRef` and canonical bytes, require it to equal
  the branded live environment, then derive `environment_id` from that reference;
- derive the stable action-target ID from the fixture ID, revision, exact manifest
  digest, and fixed `test_id` locator rather than from a capture result;
- verify the exact fixture manifest digest, directory membership, resource byte lengths
  and hashes, and CSP;
- create the context, clock, and screenshot policy from the verified CaptureSpec, apply
  its navigation and action fields as Playwright defaults, and bound its explicit
  readiness wait; and
- serve only allowlisted in-memory fixture resources while aborting and recording
  external or unexpected requests.

`loadVerifiedMutationFixtureSourceState` performs the same exact directory, manifest,
and resource audit and returns a fresh copy of the canonical source-state bytes plus
their reference. Generator code therefore does not duplicate the runtime's private
fixture description when preparing the sealed artifact.

The returned `MutationFixtureSession` is branded in a module-private `WeakMap`; copied
objects and transplanted Playwright pages fail provenance checks. Operations are
serialized so close cannot race a probe or mutation, and the environment permits only
one active branded session lease. A context-cleanup failure permanently poisons that
capability for capture reuse; browser shutdown remains retryable as cleanup. A bounded
in-memory enforcement audit accumulates network, CSP, page, and integrity events and
makes close fail on a tainted session. A successful close returns only the fixture
digest, served resources, and blocked external requests—not a durable event log.
Retained element handles, exact DOM/CSS fingerprints, an early `MutationObserver`,
task-state transitions, owned mutation nodes, and cleanup checks detect navigation,
replacement, persistent tampering, and transient DOM changes. The runtime applies only
the typed operations emitted by the mutation compiler; integration tests exercise the
primary task with a real coordinate click through the trusted Playwright page.

`prepareMutationFixtureTask` lets the pinned renderer perform its deterministic initial
scroll, records the resulting scroll and target rectangle, and then rejects geometry
drift before execution. This happens before an optional mutation is probed or applied;
the runtime binds its viewport to the CaptureSpec but does not require one golden target
rectangle shared across browser builds. `executeMutationFixtureTask` owns one serialized
operation from the initial checkpoint through the true coordinate click and final
checkpoint. Caller code cannot select a role, checkpoint ordinal, locator, or
coordinate. The executor accepts only one primary pointer action with checkpoints before
and after it, captures screenshot, DOM snapshot, and full accessibility tree in a fixed
order, and exposes copy-on-read canonical modality bytes only after both checkpoints
succeed. The initial layout must contain exactly one authenticated action target; the
final target presence must match the measured closed task state. A failed technical
capture poisons that run and cannot expose or retry a partial sequence. Chromium does
not provide an atomic transaction spanning those three modalities. Their fixed
sequential reads are justified only by the paused clock, blocked network, cooperative
closed fixture, and authentication audits before and after each checkpoint.

The returned task run is provisional generator state until an active mutation cleanup
and `MutationFixtureSession.close()` both succeed. The pending pair assembler must
retain it only in trusted generator state until those lifecycle audits pass; a cleanup
or close failure invalidates all checkpoint bytes from that role.

The Chromium layout adapter strictly decodes one exact-origin document, removes pseudo
subtrees, collapses non-layout ancestors, translates document coordinates by the actual
scroll offset, reconstructs overflow clips from local client rectangles, and links the
one CDP-resolved action target through an internal backend-node map. Raw browser node
IDs, selectors, attributes, and CDP string tables do not enter serialized layout or
accessibility payloads. Fresh-session integration tests require byte-identical baseline
modalities and distinguish the successful palette candidate from the blocked pointer
candidate without treating task failure as an executor error.

This boundary is intentionally narrower than a browser sandbox. Source, task, and
environment IDs are all derived from resolved exact artifacts; callers cannot choose
them independently. The byte-tree audit assumes trusted same-process intrinsics and no
hostile concurrent filesystem writer, and host mode does not attest loaded process
memory, Node, kernel, or system-library bytes. CaptureSpec's OCI branch is reserved for
an external orchestrator with exact statement bytes and a configured trusted verifier;
schema validation alone is not attestation verification, and this launcher creates host
mode only. The navigation and action timeout fields are Playwright defaults rather than
whole-phase deadlines for raw CDP or coordinate input. The public `session.page` is also
a trusted same-process capability: code that controls it, or hostile page code that
replaces JavaScript intrinsics and listener state, may evade page-realm checks. The
runtime therefore attests the exact fixture and its cooperative audited execution, not
arbitrary JavaScript pages. Complete paired-capture assembly is still pending.

## Reversible mutation compilation

Mutation requests, source probes, precondition reports, and plans are closed sealed
contracts. Domain-separated identities bind the exact source state, task, environment,
operator, target, and replicate in an outcome-free request body; the contract does not
attest when a producer created that body. Preconditions are deterministically derived
from the embedded request and probe; failed checks yield an explicit `not_applicable`
result rather than a fallback plan.

The v1 compiler supports two fixed operators: a contrast-checked `palette_swap` expected
to preserve the task and a `pointer_interceptor` expected to break pointer hit testing.
Plans carry one typed forward operation and an inverse that removes the same owned
handle. They accept only a bounded `test_id` locator and fixed opcodes—no arbitrary
JavaScript, CSS, selectors, or free-form mutation payload. Expected task relation is
sealed provenance and never substitutes for the measured execution label.

## What remains unproven

The repository does not yet assemble and mount a complete read-only visible dataset for
an isolated feature process. Cross-session pair assembly, dataset-level publication, the
isolated feature runner, and the versioned scorer are still incomplete. The scorer must
recompute severity, failed-step membership, and localization from resolved oracle,
trace, action-plan, and policy artifacts.

Until the full generation and scoring path is exercised on a released corpus, this
repository makes no benchmark-quality, leakage-safety, or model-accuracy claim.

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
