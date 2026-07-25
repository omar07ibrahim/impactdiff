# Pilot evidence architecture

This tour follows the implemented path behind the committed README evidence. It covers
local Pilot authoring evidence only: no official corpus row, learned model, benchmark
score, or production-browser compatibility result is created anywhere on this path.

## Boundary map

| Boundary                | Accepted input                                               | Released output                                                                 | Failure rule                                                                                                   |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Fixture package         | One closed fixture manifest and its audited resource tree    | Canonical SourceState and two manifest-derived ActionPlans                      | A missing, extra, aliased, oversized, or digest-mismatched resource is rejected                                |
| Browser authoring       | One acquired environment lease and one declared workflow key | A success-only audit, or an audit plus exactly three defensive-copy checkpoints | No checkpoint result is exposed before the task oracle and owned browser lifecycle complete                    |
| Portfolio assembly      | The fixed two-fixture, four-workflow catalog                 | 49 named data artifacts and one canonical `official: false` manifest            | Any audit, cardinality, codec, source, or capture-environment mismatch aborts the whole capture                |
| Publication             | A verified in-memory capture and an absent output leaf       | One complete 50-file directory                                                  | Artifacts go to an owned same-parent stage, the manifest is written last, and only a verified stage is renamed |
| Repository verification | The committed bundle plus the current checkout               | A path-free five-field receipt                                                  | Exact membership, byte bindings, semantic bindings, and scoped source freshness must all pass                  |
| Terminal evidence       | One recorded execution of the read-only repository check     | Raw transcript, two SVGs, and a separate evidence manifest                      | The recording is source-bound and explicit about what the single execution did not observe or establish        |

## 1. Authored fixture boundary

The fixture loader audits the complete application resource tree before deriving a
canonical SourceState and the two ActionPlans declared by that fixture. Browser
authoring receives an in-memory byte snapshot, not a path back to the live fixture
directory. The two current packages are Thread & Tally and Nightwatch Relay.

Implementation: [fixture package loader](../src/pilot/fixture/package.ts),
[ActionPlan construction](../src/pilot/fixture/action-plan.ts), and
[closed portfolio catalog](../src/portfolio-evidence/schema.ts).

## 2. Audited browser replay

Portfolio capture launches the pinned Pilot authoring environment once per fixture. Each
workflow acquires that environment for a fresh isolated browser context, executes its
four declared actions, checks the task success oracle, and captures the canonical
`initial_state`, `pre_primary_action`, and `post_primary_action` modalities. The result
crosses the API boundary only after cleanup completes.

Each checkpoint carries:

- one canonical 800 × 600 PNG;
- one normalized accessibility tree;
- one bounded layout graph; and
- a checkpoint identity derived from the ActionPlan reference and ordinal.

Implementation: [environment ownership](../src/pilot/runtime/environment.ts),
[capture-first API](../src/pilot/runtime/capture.ts),
[session audits](../src/pilot/runtime/session.ts), and
[checkpoint construction](../src/pilot/runtime/checkpoint.ts).

## 3. Closed portfolio assembly

The assembler accepts exactly two fixtures, two workflows per fixture, and three
checkpoints per workflow. It rejects a workflow audit unless fixture, revision,
SourceState, task, ActionPlan, action count, checkpoint schedule, and request audits
match the closed catalog. It also requires both fixtures to report the same verified
CaptureSpec.

After rechecking that scoped source bytes did not change during capture, the assembler
binds 49 data files into one canonical manifest. That manifest fixes the Git
revision/tree, root-file identities, authored and compiled source trees, Node ABI,
Playwright and Chromium identities, fixture/task provenance, workflow audits, and every
checkpoint byte identity.

Implementation: [portfolio capture](../src/portfolio-evidence/capture.ts) and
[source identity](../src/portfolio-evidence/source-identity.ts).

## 4. Failure-atomic publication

Publication requires an absent final leaf. It writes the 49 artifacts into an owned
same-parent stage, writes `MANIFEST.json` last, syncs and verifies the complete stage,
then exposes it with one rename. It never replaces an existing bundle. If publication
fails before that rename, the owned stage is removed; uncertain cleanup is surfaced as
an error.

This guarantee is scoped to the repository-compatible filesystem and topology enforced
by the implementation. It is not a claim about arbitrary or hostile filesystems.

Implementation:
[publisher and bundle verifier](../src/portfolio-evidence/publication.ts) and
[repository filesystem boundary](../src/portfolio-evidence/repository-filesystem.ts).

## 5. Read-only verification

`npm run --silent evidence:pilot:check` does not perform a fresh browser capture. It
builds the CLI, verifies the existing 50-file directory, and checks:

1. exact directory membership and a canonical manifest;
2. all 49 artifact lengths and SHA-256 identities;
3. CaptureSpec, fixture, ActionPlan, audit, checkpoint, and cross-modal graph bindings;
4. canonical PNG and structured-evidence codecs; and
5. that the recorded source revision remains an ancestor while current scoped root,
   authored, compiled, fixture, and ActionPlan bytes still match.

Only then does the CLI emit `official`, `manifest_sha256`, `fixture_count`,
`workflow_count`, and `checkpoint_count`.

Implementation: [CLI entry point](../src/cli/pilot-portfolio-evidence.ts),
[bundle verification](../src/portfolio-evidence/publication.ts), and
[repository freshness verification](../src/portfolio-evidence/source-identity.ts).

## 6. Evidence about the verifier

The terminal layer recorded one successful exact Node.js 22.23.1 execution of that
read-only check. Its [raw transcript](images/terminal-evidence/pilot-evidence-check.txt)
and [manifest](images/terminal-evidence/MANIFEST.json) bind the command, runtime, source
commit/tree, allowlisted source bytes, stdout, and the
[terminal receipt](images/terminal-evidence/pilot-evidence-check.svg) and
[claim-boundary figure](images/terminal-evidence/evidence-boundary.svg).

This is evidence about one verifier execution, not another browser replay. The terminal
manifest records `network_observation: "not_observed"`. Its output is commit-bound,
`official: false`, and not independently authenticated. It makes no browser-suite rerun,
network-isolation, cross-runtime, determinism, official-dataset, model-quality,
benchmark, or production-browser claim.
