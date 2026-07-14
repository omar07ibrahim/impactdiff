import assert from "node:assert/strict";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import {
  evidenceManifestSchema,
  sealedRecordSchema,
  splitAssignmentSchema,
  splitAuditSchema,
} from "../src/contracts/schema.js";
import {
  artifact,
  evidence,
  hex,
  sealedRecord,
  splitAssignment,
  splitAudit,
} from "./fixtures.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateEvidence = ajv.compile(evidenceManifestSchema);
const validateSealedRecord = ajv.compile(sealedRecordSchema);
const validateSplitAssignment = ajv.compile(splitAssignmentSchema);
const validateSplitAudit = ajv.compile(splitAuditSchema);

test("the four representative v1 manifests satisfy their schemas", () => {
  assert.equal(
    validateEvidence(evidence),
    true,
    ajv.errorsText(validateEvidence.errors),
  );
  assert.equal(
    validateSealedRecord(sealedRecord),
    true,
    ajv.errorsText(validateSealedRecord.errors),
  );
  assert.equal(
    validateSplitAssignment(splitAssignment),
    true,
    ajv.errorsText(validateSplitAssignment.errors),
  );
  assert.equal(
    validateSplitAudit(splitAudit),
    true,
    ajv.errorsText(validateSplitAudit.errors),
  );
});

test("visible evidence rejects direct label fields", () => {
  const contaminated = { ...evidence, task_regression: true };

  assert.equal(validateEvidence(contaminated), false);
  assert.match(ajv.errorsText(validateEvidence.errors), /additional properties/);
});

test("artifact references cannot carry paths or URIs", () => {
  const withPath = {
    ...evidence,
    task: {
      ...evidence.task,
      action_plan: {
        ...evidence.task.action_plan,
        path: "sealed/mutations/clipped-submit.json",
      },
    },
  };

  assert.equal(validateEvidence(withPath), false);
  assert.match(ajv.errorsText(validateEvidence.errors), /additional properties/);
});

test("candidate observations cannot include an execution trace", () => {
  const withTrace = {
    ...evidence,
    pair: {
      ...evidence.pair,
      candidate: {
        ...evidence.pair.candidate,
        raw_trace: artifact("application/vnd.impactdiff.raw-trace+json", "f"),
      },
    },
  };

  assert.equal(validateEvidence(withTrace), false);
  assert.match(ajv.errorsText(validateEvidence.errors), /additional properties/);
});

test("artifact digests are exact lowercase SHA-256 values", () => {
  const uppercaseDigest = {
    ...evidence,
    environment: {
      ...evidence.environment,
      capture_spec: {
        ...evidence.environment.capture_spec,
        sha256: hex("A"),
      },
    },
  };

  assert.equal(validateEvidence(uppercaseDigest), false);
  assert.match(ajv.errorsText(validateEvidence.errors), /pattern/);
});

test("capture roles cannot be swapped", () => {
  const swappedRole = {
    ...evidence,
    pair: {
      ...evidence.pair,
      baseline: { ...evidence.pair.baseline, role: "candidate" },
    },
  };

  assert.equal(validateEvidence(swappedRole), false);
  assert.match(ajv.errorsText(validateEvidence.errors), /constant/);
});

test("artifact size budgets are enforced by media type", () => {
  const oversizedScreenshot = {
    ...evidence,
    pair: {
      ...evidence.pair,
      candidate: {
        ...evidence.pair.candidate,
        checkpoints: [
          {
            ...evidence.pair.candidate.checkpoints[0],
            screenshot: {
              ...evidence.pair.candidate.checkpoints[0].screenshot,
              byte_length: 8_388_609,
            },
          },
        ],
      },
    },
  };

  assert.equal(validateEvidence(oversizedScreenshot), false);
  assert.match(ajv.errorsText(validateEvidence.errors), /must be <= 8388608/);
});

test("one partition cannot contain the same evidence ID twice", () => {
  const duplicate = {
    ...splitAssignment,
    partitions: {
      ...splitAssignment.partitions,
      train: [splitAssignment.partitions.train[0], splitAssignment.partitions.train[0]],
    },
  };

  assert.equal(validateSplitAssignment(duplicate), false);
  assert.match(ajv.errorsText(validateSplitAssignment.errors), /duplicate items/);
});
