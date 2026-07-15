import assert from "node:assert/strict";
import test from "node:test";

import {
  changedSurfaceCodec,
  localizationCodec,
  oracleResultCodec,
  rawTraceCodec,
} from "../../src/artifacts/codecs.js";
import { canonicalJson } from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";
import {
  validateChangedSurface,
  validateLocalization,
  validateOracleResult,
  validateRawTrace,
} from "../../src/sealed/validate.js";

const id = (prefix: string, digit: string): string => `${prefix}${digit.repeat(64)}`;
const rect = {
  x: 10_000,
  y: 20_000,
  width: 120_000,
  height: 48_000,
  scale: 1_000,
} as const;

const changedSurface = {
  contract: "impactdiff.changed-surface",
  version: 1,
  plan_id: id("idmp1_", "1"),
  instance_id: id("idmi1_", "2"),
  affected_node_ids: [id("idnd1_", "3")],
  regions_milli_css_px: [rect],
} as const;

const finalOracle = {
  contract: "impactdiff.oracle-result",
  version: 1,
  role: "baseline",
  capture_id: id("idcp1_", "4"),
  task_id: id("idtk1_", "5"),
  kind: "final_state",
  passed: true,
  observed_state: "confirmed",
} as const;

const trace = {
  contract: "impactdiff.raw-trace",
  version: 1,
  role: "candidate",
  capture_id: id("idcp1_", "6"),
  task_id: id("idtk1_", "5"),
  task_success: false,
  steps: [{ action_id: id("idst1_", "7"), ordinal: 0, status: "unsatisfied" }],
  first_unsatisfied_step_id: id("idst1_", "7"),
  recovery_actions: 0,
  virtual_elapsed_ms: 0,
} as const;

function expectIssue(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(error.issues.some((candidate) => candidate.code === code));
    return true;
  });
}

test("sealed evidence payloads are closed, canonical, and replayable", async () => {
  assert.deepEqual(validateChangedSurface(changedSurface), changedSurface);
  assert.deepEqual(validateOracleResult(finalOracle), finalOracle);
  assert.deepEqual(validateRawTrace(trace), trace);
  const localization = {
    contract: "impactdiff.localization",
    version: 1,
    instance_id: changedSurface.instance_id,
    failed_step_id: trace.first_unsatisfied_step_id,
    changed_surface_sha256: "8".repeat(64),
    affected_node_ids: changedSurface.affected_node_ids,
    regions_milli_css_px: changedSurface.regions_milli_css_px,
  } as const;
  assert.deepEqual(validateLocalization(localization), localization);

  for (const [codec, payload] of [
    [changedSurfaceCodec, changedSurface],
    [oracleResultCodec, finalOracle],
    [rawTraceCodec, trace],
    [localizationCodec, localization],
  ] as const) {
    const bytes = Buffer.from(canonicalJson(payload), "utf8");
    assert.deepEqual(await codec.canonicalize(bytes), bytes);
    assert.deepEqual(await codec.validate(bytes), payload);
  }
});

test("sealed payloads reject semantic contradictions", () => {
  expectIssue(
    () => validateOracleResult({ ...finalOracle, passed: false }),
    "oracle.derived_result",
  );
  expectIssue(
    () => validateRawTrace({ ...trace, task_success: true }),
    "trace.derived_success",
  );
  expectIssue(
    () =>
      validateChangedSurface({
        ...changedSurface,
        affected_node_ids: [id("idnd1_", "4"), id("idnd1_", "3")],
      }),
    "sealed.noncanonical_order",
  );
});

test("raw trace codec honors its declared multi-megabyte parser budget", async () => {
  const steps = Array.from({ length: 2_000 }, (_, ordinal) => ({
    action_id: `idst1_${ordinal.toString(16).padStart(64, "0")}`,
    ordinal,
    status: ordinal === 1_999 ? ("unsatisfied" as const) : ("satisfied" as const),
  }));
  const largeTrace = {
    ...trace,
    steps,
    first_unsatisfied_step_id: steps.at(-1)!.action_id,
  };
  const bytes = Buffer.from(canonicalJson(largeTrace), "utf8");
  assert.ok(bytes.byteLength > 131_072);
  assert.ok(bytes.byteLength < rawTraceCodec.maximumBytes);

  const decoded = await rawTraceCodec.validate(bytes);

  assert.equal(decoded.steps.length, steps.length);
  assert.equal(decoded.first_unsatisfied_step_id, steps.at(-1)!.action_id);
});
