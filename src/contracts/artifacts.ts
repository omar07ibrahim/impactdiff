import type { EvidenceManifest, SealedRecord } from "./schema.js";
import { issue } from "./errors.js";
import type { ContractIssue } from "./errors.js";

export interface ArtifactRef {
  readonly sha256: string;
  readonly byte_length: number;
  readonly media_type: string;
  readonly format_version: 1;
}

export function checkArtifactSet(
  refs: readonly ArtifactRef[],
  maximumUniqueBytes: number,
  path: string,
  issues: ContractIssue[],
): Set<string> {
  const seen = new Map<string, ArtifactRef>();
  let uniqueBytes = 0;

  for (const ref of refs) {
    const prior = seen.get(ref.sha256);
    if (prior === undefined) {
      seen.set(ref.sha256, ref);
      uniqueBytes += ref.byte_length;
      continue;
    }

    if (
      prior.byte_length !== ref.byte_length ||
      prior.media_type !== ref.media_type ||
      prior.format_version !== ref.format_version
    ) {
      issues.push(
        issue(
          "artifact.metadata_conflict",
          path,
          "one digest has conflicting artifact metadata",
        ),
      );
    }
  }

  if (uniqueBytes > maximumUniqueBytes) {
    issues.push(
      issue(
        "artifact.total_bytes",
        path,
        `unique artifact bytes exceed ${maximumUniqueBytes}`,
      ),
    );
  }

  return new Set(seen.keys());
}

export function visibleArtifacts(manifest: EvidenceManifest): ArtifactRef[] {
  const refs: ArtifactRef[] = [
    manifest.task.action_plan,
    manifest.environment.capture_spec,
  ];

  for (const capture of [manifest.pair.baseline, manifest.pair.candidate]) {
    for (const checkpoint of capture.checkpoints) {
      refs.push(
        checkpoint.screenshot,
        checkpoint.accessibility_tree,
        checkpoint.layout_graph,
      );
    }
  }

  return refs;
}

export function observationArtifacts(manifest: EvidenceManifest): ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  for (const capture of [manifest.pair.baseline, manifest.pair.candidate]) {
    for (const checkpoint of capture.checkpoints) {
      refs.push(
        checkpoint.screenshot,
        checkpoint.accessibility_tree,
        checkpoint.layout_graph,
      );
    }
  }
  return refs;
}

export function sealedArtifacts(record: SealedRecord): ArtifactRef[] {
  const refs: ArtifactRef[] = [
    record.provenance.source_state,
    record.intervention.parameters,
    record.intervention.preconditions,
    record.intervention.changed_surface,
  ];

  for (const outcome of [record.execution.baseline, record.execution.candidate]) {
    refs.push(
      outcome.final_state_oracle,
      outcome.accessibility_oracle,
      outcome.raw_trace,
    );
  }

  if (record.labels.localization !== null) {
    refs.push(record.labels.localization);
  }

  return refs;
}
