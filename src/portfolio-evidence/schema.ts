import type { ArtifactRef } from "../contracts/artifacts.js";

export const pilotPortfolioEvidenceContract =
  "impactdiff.pilot-portfolio-evidence" as const;
export const pilotPortfolioEvidenceVersion = 1 as const;
export const pilotPortfolioEvidenceManifestFile = "MANIFEST.json" as const;
export const pilotPortfolioEvidenceCaptureSpecFile = "capture-spec.json" as const;

export const pilotPortfolioCheckpointKeys = Object.freeze([
  "initial_state",
  "pre_primary_action",
  "post_primary_action",
] as const);

export interface PilotPortfolioCatalogWorkflow {
  readonly workflow_key: string;
  readonly file_stem: string;
  readonly checkpoint_after_action_ordinals: readonly [-1, 2, 3];
}

export interface PilotPortfolioCatalogFixture {
  readonly application_key: string;
  readonly fixture_key: string;
  readonly fixture_revision: string;
  readonly fixture_directory: string;
  readonly file_stem: string;
  readonly workflows: readonly [
    PilotPortfolioCatalogWorkflow,
    PilotPortfolioCatalogWorkflow,
  ];
}

export const pilotPortfolioEvidenceCatalog: readonly [
  PilotPortfolioCatalogFixture,
  PilotPortfolioCatalogFixture,
] = Object.freeze([
  Object.freeze({
    application_key: "incident_command",
    fixture_key: "pilot-incident-command-v1",
    fixture_revision: "pilot-incident-command-v1.0.0-authoring.1",
    fixture_directory: "fixtures/pilot-incident-command-v1",
    file_stem: "incident-command",
    workflows: Object.freeze([
      Object.freeze({
        workflow_key: "acknowledge_alert",
        file_stem: "acknowledge-alert",
        checkpoint_after_action_ordinals: Object.freeze([-1, 2, 3] as const),
      }),
      Object.freeze({
        workflow_key: "assign_responder",
        file_stem: "assign-responder",
        checkpoint_after_action_ordinals: Object.freeze([-1, 2, 3] as const),
      }),
    ]) as readonly [PilotPortfolioCatalogWorkflow, PilotPortfolioCatalogWorkflow],
  }),
  Object.freeze({
    application_key: "market_basket",
    fixture_key: "pilot-market-basket-v1",
    fixture_revision: "pilot-market-basket-v1.0.0-authoring.2",
    fixture_directory: "fixtures/pilot-market-basket-v1",
    file_stem: "market-basket",
    workflows: Object.freeze([
      Object.freeze({
        workflow_key: "add_bundle",
        file_stem: "add-bundle",
        checkpoint_after_action_ordinals: Object.freeze([-1, 2, 3] as const),
      }),
      Object.freeze({
        workflow_key: "choose_pickup",
        file_stem: "choose-pickup",
        checkpoint_after_action_ordinals: Object.freeze([-1, 2, 3] as const),
      }),
    ]) as readonly [PilotPortfolioCatalogWorkflow, PilotPortfolioCatalogWorkflow],
  }),
]);

export interface PilotPortfolioByteIdentity {
  readonly sha256: string;
  readonly byte_length: number;
}

export interface PilotPortfolioScreenshotIdentity extends PilotPortfolioByteIdentity {
  readonly file: string;
  readonly media_type: "image/png";
  readonly width: 800;
  readonly height: 600;
}

export interface PilotPortfolioCheckpointEvidence {
  readonly key: "initial_state" | "pre_primary_action" | "post_primary_action";
  readonly ordinal: 0 | 1 | 2;
  readonly after_action_ordinal: -1 | 2 | 3;
  readonly checkpoint_id: string;
  readonly screenshot: PilotPortfolioScreenshotIdentity;
  readonly accessibility_tree: PilotPortfolioByteIdentity;
  readonly layout_graph: PilotPortfolioByteIdentity;
}

export interface PilotPortfolioWorkflowEvidence {
  readonly workflow_key: string;
  readonly official: false;
  readonly task_id: string;
  readonly environment_id: string;
  readonly actions_executed: 4;
  readonly checkpoint_after_action_ordinals: readonly [-1, 2, 3];
  readonly resource_request_audit_sha256: string;
  readonly resource_request_count: number;
  readonly blocked_external_requests: 0;
  readonly unexpected_fixture_requests: 0;
  readonly checkpoints: readonly [
    PilotPortfolioCheckpointEvidence,
    PilotPortfolioCheckpointEvidence,
    PilotPortfolioCheckpointEvidence,
  ];
}

export interface PilotPortfolioFixtureEvidence {
  readonly application_key: string;
  readonly fixture_key: string;
  readonly fixture_revision: string;
  readonly fixture_manifest: PilotPortfolioByteIdentity;
  readonly source_state_id: string;
  readonly workflows: readonly [
    PilotPortfolioWorkflowEvidence,
    PilotPortfolioWorkflowEvidence,
  ];
}

export interface PilotPortfolioBrowserIdentity {
  readonly engine: "chromium";
  readonly distribution: "chromium_headless_shell";
  readonly playwright_registry_revision: "1228";
  readonly version: "149.0.7827.55";
  readonly source_revision: string;
  readonly installation_file_tree_sha256: string;
  readonly executable_sha256: string;
  readonly launch_profile_sha256: string;
}

export interface PilotPortfolioPlaywrightIdentity {
  readonly version: "1.61.1";
  readonly installed_file_tree_sha256: string;
}

export interface PilotPortfolioEvidenceManifest {
  readonly contract: typeof pilotPortfolioEvidenceContract;
  readonly version: typeof pilotPortfolioEvidenceVersion;
  readonly official: false;
  readonly scope: "local-authoring-checkpoint-evidence";
  readonly source: {
    readonly git_revision: string;
    readonly git_tree: string;
    readonly root_files: {
      readonly node_version_file: PilotPortfolioByteIdentity;
      readonly package_lock: PilotPortfolioByteIdentity;
      readonly package_manifest: PilotPortfolioByteIdentity;
      readonly typescript_config: PilotPortfolioByteIdentity;
    };
    readonly authored_source_tree_sha256: string;
    readonly compiled_runtime_tree_sha256: string;
  };
  readonly runtime: {
    readonly node_version: "22.23.1";
    readonly node_module_abi: string;
    readonly platform: "linux";
    readonly architecture: "x64";
    readonly capture_spec_file: typeof pilotPortfolioEvidenceCaptureSpecFile;
    readonly capture_spec: ArtifactRef;
    readonly playwright: PilotPortfolioPlaywrightIdentity;
    readonly browser: PilotPortfolioBrowserIdentity;
  };
  readonly evidence_boundary: {
    readonly establishes: readonly [
      "deterministic_local_pilot_authoring_replay",
      "checkpoint_screenshot_and_modality_byte_identities",
      "closed_fixture_task_and_capture_environment_bindings",
    ];
    readonly does_not_establish: readonly [
      "official_dataset_release",
      "model_quality_or_benchmark_performance",
      "production_browser_compatibility",
    ];
  };
  readonly fixtures: readonly [
    PilotPortfolioFixtureEvidence,
    PilotPortfolioFixtureEvidence,
  ];
}

export interface PilotPortfolioEvidenceFile {
  readonly name: string;
  readonly bytes: Buffer;
}

export interface CapturedPilotPortfolioEvidence {
  readonly kind: "captured_pilot_portfolio_evidence";
  readonly official: false;
  readonly manifest: PilotPortfolioEvidenceManifest;
  readonly manifest_bytes: Buffer;
  readonly files: readonly PilotPortfolioEvidenceFile[];
}

export interface VerifiedPilotPortfolioEvidence {
  readonly kind: "verified_pilot_portfolio_evidence";
  readonly official: false;
  readonly manifest: PilotPortfolioEvidenceManifest;
  readonly manifest_sha256: string;
  readonly fixture_count: 2;
  readonly workflow_count: 4;
  readonly checkpoint_count: 12;
}

export function pilotPortfolioScreenshotFileName(
  fixture: PilotPortfolioCatalogFixture,
  workflow: PilotPortfolioCatalogWorkflow,
  checkpointOrdinal: 0 | 1 | 2,
): string {
  const checkpointKey = pilotPortfolioCheckpointKeys[checkpointOrdinal];
  return `${fixture.file_stem}--${workflow.file_stem}--${checkpointKey.replaceAll(
    "_",
    "-",
  )}.png`;
}
