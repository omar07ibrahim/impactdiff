# Paired publication protocol

ImpactDiff publishes one already-complete evidence/sealed-record pair as a single
append-only filesystem transaction. This layer does not execute Chromium or decide a
label. It accepts canonical records and every referenced artifact, then proves their
storage and semantic consistency before making the pair visible.

## Release topology

The repository root must already exist as a real current-uid directory with exact mode
`0700`. A committed release has this closed topology:

```text
releases/<evidence_id>/
  COMMIT.json
  visible/
    evidence/<evidence_id>.json
    cas/sha256/<shard>/<digest>
  sealed/
    records/<sealed_record_id>.json
    cas/sha256/<shard>/<digest>
```

`<evidence_id>` is derived from the label-free visible manifest. The final path
therefore does not reveal a sealed record, intervention, or class identity.
`COMMIT.json` sits above the model boundary and contains a domain-separated publication
ID plus the ID, SHA-256, and canonical byte length of both record files. A future
feature process may receive only `visible/`; a `VerifiedPairedRelease` is a
trusted-generator result and must not be passed to model code because it intentionally
includes sealed paths and records.

## Transaction

`PairedReleasePublisher.publish()` performs these operations in one serialized queue per
canonical repository inode:

1. Validate the closed input wrapper, record pair, exact unique artifact membership,
   reference metadata, byte lengths, and digests. Every caller-owned byte array is
   copied before the first asynchronous operation.
2. Create a random reserved sibling such as `.impactdiff-stage-<32 lowercase hex>.tmp`,
   with private directories repaired to exact mode `0700` even under a restrictive
   process umask.
3. Populate independent visible and sealed content-addressed stores using the fixed
   project codec registry. Caller-selected codecs cannot authorize publication.
4. Write canonical evidence and sealed-record files as one-link mode-`0400` leaves.
5. Audit exact CAS membership, digest and inode separation, canonical payloads, and
   every referenced byte.
6. Write `COMMIT.json` last, fsync the required files and directories, and strictly
   reopen the staging tree. Reopen reconstructs the complete resolved record and replays
   changed-surface, oracle, trace, outcome, and localization derivations.
7. Recheck the staging inode and absence of the destination, then rename the whole
   staging directory to `releases/<evidence_id>`. That same-parent directory rename is
   the visibility commit point.
8. Fsync `releases/`, re-bind the final path to the staged inode and committed evidence
   ID, and run the same strict verifier again.

Before the rename, any failure removes only the reserved owned staging tree after a
bounded read-only preflight. Cleanup rejects symlinks, hardlinks, special files, foreign
ownership, unsafe modes, excessive depth, and excessive membership. A cleanup failure
poisons the shared publisher state rather than continuing from uncertain storage.

After the rename, the publisher never rolls a release back. A parent-fsync or final
reopen failure reports an uncertain or invalid committed state and poisons subsequent
operations in that process. This preserves the distinction between “not committed” and
“visible but durability could not be confirmed.”

## Idempotency and recovery

Publishing the same evidence and sealed record again returns the verified existing
release. The same visible evidence ID paired with a different sealed publication is a
conflict; the original remains unchanged. Final directory names are bound to the
committed evidence ID, so moving a valid tree under another syntactically valid ID fails
reopen and repository startup.

`PairedReleasePublisher.open()` serializes first-time `releases/` creation, verifies
existing release identities, and removes only names matching the reserved staging
pattern. Recovery is bounded. The flat v1 repository accepts at most 4096 committed
release entries; a later format can shard this namespace without silently changing the
v1 topology.

## Threat boundary and non-claims

The supported v1 filesystem is local Linux storage with one same-process publisher queue
and private current-uid directories. External writers—including another process with the
same uid—remote filesystems, root compromise, kernel compromise, and hostile concurrent
path replacement are outside the claim. Node's path APIs do not provide the
`openat2`/`renameat2(RENAME_NOREPLACE)` capability needed for that stronger boundary.

The fsync ordering is designed for local durable filesystems, but this protocol does not
claim a portable power-loss guarantee for NFS, FUSE, or hardware that violates its own
flush contract. It also does not provide process-level mount isolation, construct a
three-way train/validation/test dataset, or prove that baseline and candidate were
captured in fresh sessions. The separate fixture pair assembler now supplies that
lifecycle proof for its closed shared-browser development path; dataset construction and
an isolated feature runner remain separate responsibilities.
