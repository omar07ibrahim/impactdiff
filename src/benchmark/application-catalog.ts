import { createHash } from "node:crypto";

import { canonicalJson } from "../contracts/canonical.js";
import { pilotV01ProtocolId } from "./pilot-v01.js";

export const pilotApplicationCatalogContract =
  "impactdiff.pilot-application-catalog" as const;
export const pilotApplicationCatalogVersion = 1 as const;

const catalogIdentityDomain = "impactdiff:pilot-application-catalog:v1";

export const pilotV01ApplicationBlockIds = Object.freeze([
  "block_0",
  "block_1",
  "block_2",
  "block_3",
] as const);

export type PilotV01ApplicationBlockId = (typeof pilotV01ApplicationBlockIds)[number];

function application<
  const ApplicationKey extends string,
  const FixtureKey extends string,
  const BlockId extends PilotV01ApplicationBlockId,
  const FirstWorkflowKey extends string,
  const SecondWorkflowKey extends string,
>(
  applicationKey: ApplicationKey,
  fixtureKey: FixtureKey,
  blockId: BlockId,
  firstWorkflowKey: FirstWorkflowKey,
  secondWorkflowKey: SecondWorkflowKey,
) {
  return Object.freeze({
    application_key: applicationKey,
    fixture_key: fixtureKey,
    block_id: blockId,
    workflow_keys: Object.freeze([firstWorkflowKey, secondWorkflowKey] as const),
  });
}

export const pilotV01ApplicationCatalogEntries = Object.freeze([
  application(
    "market_basket",
    "pilot-market-basket-v1",
    "block_0",
    "add_bundle",
    "choose_pickup",
  ),
  application(
    "incident_command",
    "pilot-incident-command-v1",
    "block_0",
    "acknowledge_alert",
    "assign_responder",
  ),
  application(
    "clinic_slots",
    "pilot-clinic-slots-v1",
    "block_0",
    "book_visit",
    "request_refill",
  ),
  application(
    "model_registry",
    "pilot-model-registry-v1",
    "block_0",
    "promote_candidate",
    "restore_version",
  ),
  application(
    "quality_cell",
    "pilot-quality-cell-v1",
    "block_0",
    "quarantine_lot",
    "accept_rework",
  ),
  application(
    "rail_route",
    "pilot-rail-route-v1",
    "block_1",
    "reserve_departure",
    "confirm_seat",
  ),
  application(
    "workspace_access",
    "pilot-workspace-access-v1",
    "block_1",
    "invite_member",
    "change_role",
  ),
  application(
    "course_path",
    "pilot-course-path-v1",
    "block_1",
    "enroll_module",
    "submit_answer",
  ),
  application(
    "pipeline_runs",
    "pilot-pipeline-runs-v1",
    "block_1",
    "retry_stage",
    "pause_schedule",
  ),
  application(
    "media_review",
    "pilot-media-review-v1",
    "block_1",
    "approve_frame",
    "request_revision",
  ),
  application(
    "ledger_transfer",
    "pilot-ledger-transfer-v1",
    "block_2",
    "schedule_transfer",
    "freeze_card",
  ),
  application(
    "sprint_space",
    "pilot-sprint-space-v1",
    "block_2",
    "move_item",
    "mark_blocker",
  ),
  application(
    "permit_desk",
    "pilot-permit-desk-v1",
    "block_2",
    "submit_application",
    "book_inspection",
  ),
  application(
    "metric_canvas",
    "pilot-metric-canvas-v1",
    "block_2",
    "apply_segment",
    "save_view",
  ),
  application(
    "parcel_dispatch",
    "pilot-parcel-dispatch-v1",
    "block_2",
    "assign_courier",
    "reroute_parcel",
  ),
  application(
    "plan_control",
    "pilot-plan-control-v1",
    "block_3",
    "switch_plan",
    "pause_renewal",
  ),
  application(
    "threat_triage",
    "pilot-threat-triage-v1",
    "block_3",
    "quarantine_endpoint",
    "close_false_positive",
  ),
  application(
    "talent_pipeline",
    "pilot-talent-pipeline-v1",
    "block_3",
    "advance_candidate",
    "schedule_interview",
  ),
  application(
    "support_queue",
    "pilot-support-queue-v1",
    "block_3",
    "assign_case",
    "resolve_case",
  ),
  application(
    "grid_balance",
    "pilot-grid-balance-v1",
    "block_3",
    "dispatch_battery",
    "acknowledge_fault",
  ),
] as const);

export type PilotV01ApplicationCatalogEntry =
  (typeof pilotV01ApplicationCatalogEntries)[number];
export type PilotV01ApplicationKey = PilotV01ApplicationCatalogEntry["application_key"];
export type PilotV01WorkflowKey =
  PilotV01ApplicationCatalogEntry["workflow_keys"][number];

export const pilotV01ApplicationKeys = Object.freeze(
  pilotV01ApplicationCatalogEntries.map((entry) => entry.application_key),
) as readonly PilotV01ApplicationKey[];

export const pilotV01CatalogEntryByApplicationKey = Object.freeze(
  Object.fromEntries(
    pilotV01ApplicationCatalogEntries.map((entry) => [entry.application_key, entry]),
  ),
) as Readonly<Record<PilotV01ApplicationKey, PilotV01ApplicationCatalogEntry>>;

export const pilotV01WorkflowKeysByApplicationKey = Object.freeze(
  Object.fromEntries(
    pilotV01ApplicationCatalogEntries.map((entry) => [
      entry.application_key,
      entry.workflow_keys,
    ]),
  ),
) as Readonly<
  Record<PilotV01ApplicationKey, readonly [PilotV01WorkflowKey, PilotV01WorkflowKey]>
>;

export const pilotV01ApplicationBlockByKey = Object.freeze(
  Object.fromEntries(
    pilotV01ApplicationCatalogEntries.map((entry) => [
      entry.application_key,
      entry.block_id,
    ]),
  ),
) as Readonly<Record<PilotV01ApplicationKey, PilotV01ApplicationBlockId>>;

export const pilotV01ApplicationKeysByBlock = Object.freeze(
  Object.fromEntries(
    pilotV01ApplicationBlockIds.map((blockId) => [
      blockId,
      Object.freeze(
        pilotV01ApplicationCatalogEntries
          .filter((entry) => entry.block_id === blockId)
          .map((entry) => entry.application_key),
      ),
    ]),
  ),
) as Readonly<Record<PilotV01ApplicationBlockId, readonly PilotV01ApplicationKey[]>>;

export function computePilotApplicationCatalogId<
  const Catalog extends { readonly catalog_id: unknown },
>(catalog: Catalog): string {
  const { catalog_id: excluded, ...body } = catalog;
  void excluded;
  const hash = createHash("sha256");
  hash.update(catalogIdentityDomain, "utf8");
  hash.update("\0", "utf8");
  hash.update(canonicalJson(body), "utf8");
  return `idpc1_${hash.digest("hex")}`;
}

const draft = Object.freeze({
  contract: pilotApplicationCatalogContract,
  version: pilotApplicationCatalogVersion,
  protocol_id: pilotV01ProtocolId,
  catalog_id: `idpc1_${"0".repeat(64)}`,
  applications: pilotV01ApplicationCatalogEntries,
});

export const pilotV01ApplicationCatalogId = computePilotApplicationCatalogId(draft);

export const pilotV01ApplicationCatalog = Object.freeze({
  ...draft,
  catalog_id: pilotV01ApplicationCatalogId,
});

export const pilotV01ApplicationCatalogCanonicalJson = canonicalJson(
  pilotV01ApplicationCatalog,
);
