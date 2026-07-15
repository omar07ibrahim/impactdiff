import { Ajv2020 } from "ajv/dist/2020.js";

import { assertNoIssues, issue } from "../contracts/errors.js";
import type { ContractIssue } from "../contracts/errors.js";
import { normalizedSchemaValue } from "../contracts/input.js";
import { computePilotProtocolId } from "./identity.js";
import { pilotProtocolSchema } from "./schema.js";
import type { PilotProtocol } from "./schema.js";

const contractName = "impactdiff.pilot-protocol/v1";
const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const protocolValidator = ajv.compile<PilotProtocol>(pilotProtocolSchema);

export function validatePilotProtocol(value: unknown): PilotProtocol {
  const protocol = normalizedSchemaValue(contractName, protocolValidator, value);
  const issues: ContractIssue[] = [];
  const design = protocol.design;
  const expectedPairCount =
    design.application_count *
    design.tasks_per_application *
    design.family_ids.length *
    design.declared_relation_variants.length *
    design.replicates.length;

  if (design.planned_pair_count !== expectedPairCount) {
    issues.push(
      issue(
        "pilot.matrix_cardinality",
        "/design/planned_pair_count",
        "planned pair count must equal the complete predeclared matrix cardinality",
      ),
    );
  }

  const partitions = protocol.split.per_fold_partitions;
  const partitionValues = [
    ["train", partitions.train],
    ["validation", partitions.validation],
    ["test", partitions.test],
  ] as const;
  let applicationCount = 0;
  let pairCount = 0;
  for (const [name, partition] of partitionValues) {
    applicationCount += partition.application_count;
    pairCount += partition.planned_pair_count;
    const expectedPartitionPairs =
      partition.application_count *
      design.tasks_per_application *
      design.family_ids.length *
      design.declared_relation_variants.length *
      design.replicates.length;
    if (partition.planned_pair_count !== expectedPartitionPairs) {
      issues.push(
        issue(
          "pilot.partition_cardinality",
          `/split/per_fold_partitions/${name}/planned_pair_count`,
          "partition pair count must equal its complete predeclared matrix cardinality",
        ),
      );
    }
    const relationTotal =
      partition.planned_relation_counts.declared_breaking +
      partition.planned_relation_counts.task_preserving_control;
    if (relationTotal !== partition.planned_pair_count) {
      issues.push(
        issue(
          "pilot.relation_cardinality",
          `/split/per_fold_partitions/${name}/planned_relation_counts`,
          "declared relation counts must cover the partition matrix exactly",
        ),
      );
    }
  }

  if (applicationCount !== design.application_count) {
    issues.push(
      issue(
        "pilot.application_partition",
        "/split/per_fold_partitions",
        "each outer fold must partition every planned application exactly",
      ),
    );
  }
  if (pairCount !== design.planned_pair_count) {
    issues.push(
      issue(
        "pilot.pair_partition",
        "/split/per_fold_partitions",
        "each outer fold must partition every planned pair exactly",
      ),
    );
  }
  if (
    protocol.split.outer_test_coverage.application_count !== design.application_count ||
    protocol.split.outer_test_coverage.planned_pair_count !== design.planned_pair_count
  ) {
    issues.push(
      issue(
        "pilot.outer_test_coverage",
        "/split/outer_test_coverage",
        "pooled outer-test coverage must include every application and planned pair",
      ),
    );
  }
  if (protocol.protocol_id !== computePilotProtocolId(protocol)) {
    issues.push(
      issue(
        "pilot.identity",
        "/protocol_id",
        "protocol_id must be derived from the canonical protocol body",
      ),
    );
  }

  assertNoIssues(contractName, issues);
  return protocol;
}
