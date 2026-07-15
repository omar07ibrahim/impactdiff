import { Ajv2020 } from "ajv/dist/2020.js";

import {
  pilotV01ApplicationCatalogEntries,
  pilotV01ApplicationCatalogId,
} from "../../benchmark/application-catalog.js";
import { pilotV01ProtocolId } from "../../benchmark/pilot-v01.js";
import { canonicalJson, parseCanonicalJson } from "../../contracts/canonical.js";
import type { ParseLimits } from "../../contracts/canonical.js";
import { assertNoIssues, issue } from "../../contracts/errors.js";
import type { ContractIssue } from "../../contracts/errors.js";
import { normalizedSchemaValue } from "../../contracts/input.js";
import { pilotMutationLocalPredicateKeys } from "../../mutations/catalog/schema.js";
import { pilotFixtureAbiSlots, pilotFixtureManifestSchema } from "./schema.js";
import type {
  PilotFixtureAbiSlot,
  PilotFixtureManifest,
  PilotFixtureWorkflow,
} from "./schema.js";

const contractName = "impactdiff.pilot-fixture-manifest/v1";
const manifestLimits = Object.freeze({
  maximumBytes: 1_048_576,
  maximumDepth: 16,
  maximumValues: 20_000,
}) satisfies ParseLimits;

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const manifestValidator = ajv.compile<PilotFixtureManifest>(pilotFixtureManifestSchema);

const expectedReadinessGlobal = "__impactdiffFixtureV1";
const expectedFont = Object.freeze({
  family: "ImpactDiff Noto Sans",
  path: "fonts/noto-sans-latin-standard-normal.woff2",
  source_package: "@fontsource-variable/noto-sans@5.2.10",
  license: "OFL-1.1",
  license_path: "fonts/ofl-1.1.txt",
  sha256: "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097",
  byte_length: 59_928,
  media_type: "font/woff2",
});
const expectedLicenseResource = Object.freeze({
  sha256: "54ec7b5a35310ad66f9f3091426f7028484cbf9ae1ab5da30122ee412a3009e1",
  byte_length: 4_518,
  media_type: "text/plain; charset=utf-8",
});

const expectedActions = Object.freeze([
  Object.freeze({
    intent: "focus",
    target: "focus_entry",
    value: Object.freeze({ kind: "none" }),
    pointer_source_point: null,
  }),
  Object.freeze({
    intent: "press_key",
    target: null,
    value: Object.freeze({ kind: "key", key: "ArrowDown" }),
    pointer_source_point: null,
  }),
  Object.freeze({
    intent: "press_key",
    target: null,
    value: Object.freeze({ kind: "key", key: "Tab" }),
    pointer_source_point: null,
  }),
  Object.freeze({
    intent: "pointer_click",
    target: "primary",
    value: Object.freeze({ kind: "pointer", button: "primary" }),
    pointer_source_point: "source_primary_border_box_center",
  }),
] as const);

const expectedCheckpoints = Object.freeze([
  Object.freeze({ key: "initial_state", after_action_ordinal: -1 }),
  Object.freeze({ key: "pre_primary_action", after_action_ordinal: 2 }),
  Object.freeze({ key: "post_primary_action", after_action_ordinal: 3 }),
] as const);

function expectedContentSecurityPolicy(styleNonce: string): string {
  const encodedNonce = Buffer.from(styleNonce, "utf8").toString("base64");
  return `default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-src 'none'; img-src 'self'; manifest-src 'none'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'nonce-${encodedNonce}'; worker-src 'none'`;
}

function unsafeRelativePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("//") ||
    path.includes("\\") ||
    path.includes("%") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function rootIssues(manifest: PilotFixtureManifest): ContractIssue[] {
  const issues: ContractIssue[] = [];
  if (manifest.protocol_id !== pilotV01ProtocolId) {
    issues.push(
      issue(
        "pilot_fixture.protocol_binding",
        "/protocol_id",
        "the manifest must bind the exact Pilot v0.1 protocol",
      ),
    );
  }
  if (manifest.application_catalog_id !== pilotV01ApplicationCatalogId) {
    issues.push(
      issue(
        "pilot_fixture.application_catalog_binding",
        "/application_catalog_id",
        "the manifest must bind the exact Pilot v0.1 application catalog",
      ),
    );
  }

  const catalogEntry = pilotV01ApplicationCatalogEntries.find(
    (entry) => entry.application_key === manifest.application_key,
  );
  if (catalogEntry === undefined) {
    issues.push(
      issue(
        "pilot_fixture.application_catalog",
        "/application_key",
        "application_key must name one frozen Pilot application",
      ),
    );
  } else {
    if (manifest.fixture_key !== catalogEntry.fixture_key) {
      issues.push(
        issue(
          "pilot_fixture.fixture_catalog",
          "/fixture_key",
          "fixture_key must equal the application catalog binding",
        ),
      );
    }
    for (const [index, workflow] of manifest.workflows.entries()) {
      if (workflow.workflow_key !== catalogEntry.workflow_keys[index]) {
        issues.push(
          issue(
            "pilot_fixture.workflow_catalog",
            `/workflows/${index}/workflow_key`,
            "workflow keys must use the exact application-catalog order",
          ),
        );
      }
    }
  }

  const escapedFixtureKey = manifest.fixture_key.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  const revisionPattern = new RegExp(
    `^${escapedFixtureKey}\\.0\\.0-authoring\\.[1-9][0-9]*$`,
    "u",
  );
  if (!revisionPattern.test(manifest.revision)) {
    issues.push(
      issue(
        "pilot_fixture.authoring_revision",
        "/revision",
        "revision must be a positive authoring prerelease of its exact fixture key",
      ),
    );
  }
  if (manifest.license !== "Apache-2.0") {
    issues.push(
      issue(
        "pilot_fixture.license",
        "/license",
        "Pilot application-owned fixture bytes must use Apache-2.0",
      ),
    );
  }
  return issues;
}

function environmentIssues(
  manifest: PilotFixtureManifest,
  issues: ContractIssue[],
): void {
  const environment = manifest.environment;
  if (
    environment.viewport.width !== 800 ||
    environment.viewport.height !== 600 ||
    environment.device_scale_factor !== 1 ||
    environment.locale !== "en-US" ||
    environment.timezone !== "UTC" ||
    environment.color_scheme !== "light"
  ) {
    issues.push(
      issue(
        "pilot_fixture.environment",
        "/environment",
        "Pilot fixtures require the exact 800x600, DPR 1, en-US, UTC, light environment",
      ),
    );
  }
  if (
    manifest.readiness.global !== expectedReadinessGlobal ||
    manifest.readiness.ready !== true ||
    manifest.readiness.pending_requests !== 0
  ) {
    issues.push(
      issue(
        "pilot_fixture.readiness",
        "/readiness",
        "the authoring manifest must declare the exact sealed ready state",
      ),
    );
  }
  if (
    manifest.content_security_policy !==
    expectedContentSecurityPolicy(manifest.mutation_policy.style_nonce)
  ) {
    issues.push(
      issue(
        "pilot_fixture.content_security_policy",
        "/content_security_policy",
        "content_security_policy must be derived exactly from the declared style nonce",
      ),
    );
  }
}

function resourceIssues(manifest: PilotFixtureManifest, issues: ContractIssue[]): void {
  const resourcesByPath = new Map<string, PilotFixtureManifest["resources"][number]>();
  let priorPath: string | undefined;
  for (const [index, resource] of manifest.resources.entries()) {
    const path = `/resources/${index}/path`;
    if (unsafeRelativePath(resource.path)) {
      issues.push(
        issue(
          "pilot_fixture.resource_path",
          path,
          "resource paths must be normalized lowercase relative paths",
        ),
      );
    }
    if (resource.path === "fixture.json") {
      issues.push(
        issue(
          "pilot_fixture.manifest_membership",
          path,
          "fixture.json is bound as raw manifest bytes and cannot be a resource",
        ),
      );
    }
    if (resourcesByPath.has(resource.path)) {
      issues.push(
        issue(
          "pilot_fixture.resource_duplicate",
          path,
          "resource paths must be unique",
        ),
      );
    }
    if (priorPath !== undefined && resource.path <= priorPath) {
      issues.push(
        issue(
          "pilot_fixture.resource_order",
          path,
          "resources must be strictly sorted by path",
        ),
      );
    }
    const parameterNames = resource.media_type
      .split("; ")
      .slice(1)
      .map((parameter) => parameter.slice(0, parameter.indexOf("=")));
    const sortedParameterNames = [...parameterNames].sort();
    if (
      new Set(parameterNames).size !== parameterNames.length ||
      parameterNames.some(
        (name, parameterIndex) => name !== sortedParameterNames[parameterIndex],
      )
    ) {
      issues.push(
        issue(
          "pilot_fixture.media_type_parameter_order",
          `/resources/${index}/media_type`,
          "media-type parameters must be unique and sorted by name",
        ),
      );
    }
    resourcesByPath.set(resource.path, resource);
    priorPath = resource.path;
  }

  const entrypoint = resourcesByPath.get(manifest.entrypoint);
  if (entrypoint === undefined) {
    issues.push(
      issue(
        "pilot_fixture.entrypoint_missing",
        "/entrypoint",
        "entrypoint must name one declared resource",
      ),
    );
  } else if (entrypoint.media_type !== "text/html; charset=utf-8") {
    issues.push(
      issue(
        "pilot_fixture.entrypoint_media_type",
        "/entrypoint",
        "the fixture entrypoint must be UTF-8 HTML",
      ),
    );
  }

  if (
    canonicalJson(manifest.font) !==
    canonicalJson({
      family: expectedFont.family,
      path: expectedFont.path,
      source_package: expectedFont.source_package,
      license: expectedFont.license,
      license_path: expectedFont.license_path,
      sha256: expectedFont.sha256,
    })
  ) {
    issues.push(
      issue(
        "pilot_fixture.font_profile",
        "/font",
        "font must equal the exact pinned Pilot Noto Sans profile",
      ),
    );
  }

  const fontResource = resourcesByPath.get(manifest.font.path);
  if (
    fontResource === undefined ||
    fontResource.sha256 !== manifest.font.sha256 ||
    fontResource.byte_length !== expectedFont.byte_length ||
    fontResource.media_type !== expectedFont.media_type ||
    fontResource.license !== manifest.font.license
  ) {
    issues.push(
      issue(
        "pilot_fixture.font_resource",
        "/font/path",
        "font metadata must bind the exact declared Noto Sans resource",
      ),
    );
  }

  const licenseResource = resourcesByPath.get(manifest.font.license_path);
  if (
    licenseResource === undefined ||
    licenseResource.sha256 !== expectedLicenseResource.sha256 ||
    licenseResource.byte_length !== expectedLicenseResource.byte_length ||
    licenseResource.media_type !== expectedLicenseResource.media_type ||
    licenseResource.license !== manifest.font.license
  ) {
    issues.push(
      issue(
        "pilot_fixture.font_license_resource",
        "/font/license_path",
        "font license metadata must bind the exact declared OFL resource",
      ),
    );
  }

  for (const [index, resource] of manifest.resources.entries()) {
    if (
      resource.path !== manifest.font.path &&
      resource.path !== manifest.font.license_path &&
      resource.license !== manifest.license
    ) {
      issues.push(
        issue(
          "pilot_fixture.resource_license",
          `/resources/${index}/license`,
          "application-owned resources must use the root fixture license",
        ),
      );
    }
  }
}

function workflowIssues(
  workflow: PilotFixtureWorkflow,
  workflowIndex: number,
  issues: ContractIssue[],
): void {
  const path = `/workflows/${workflowIndex}`;
  if (canonicalJson(workflow.actions) !== canonicalJson(expectedActions)) {
    issues.push(
      issue(
        "pilot_fixture.action_recipe",
        `${path}/actions`,
        "workflow actions must be focus, ArrowDown, Tab, and source-bound primary pointer click",
      ),
    );
  }
  if (canonicalJson(workflow.checkpoints) !== canonicalJson(expectedCheckpoints)) {
    issues.push(
      issue(
        "pilot_fixture.checkpoint_schedule",
        `${path}/checkpoints`,
        "workflow checkpoints must use the exact -1, 2, 3 Pilot schedule",
      ),
    );
  }
  if (
    canonicalJson(workflow.predicate_keys) !==
    canonicalJson(pilotMutationLocalPredicateKeys)
  ) {
    issues.push(
      issue(
        "pilot_fixture.predicate_catalog",
        `${path}/predicate_keys`,
        "predicate keys must equal the exact ordered Pilot local-predicate catalog",
      ),
    );
  }

  const valuesBySlot = new Map<string, PilotFixtureAbiSlot>();
  for (const slot of pilotFixtureAbiSlots) {
    const locatorValue = workflow.abi[slot].value;
    const previousSlot = valuesBySlot.get(locatorValue);
    const allowedAlias =
      (slot === "focus_entry" && previousSlot === "setup") ||
      (slot === "setup" && previousSlot === "focus_entry");
    if (previousSlot !== undefined && !allowedAlias) {
      issues.push(
        issue(
          "pilot_fixture.abi_distinctness",
          `${path}/abi/${slot}/value`,
          "ABI locators must be distinct except for setup and focus_entry",
        ),
      );
    } else if (previousSlot === undefined) {
      valuesBySlot.set(locatorValue, slot);
    }
  }
  if (workflow.abi.setup.value !== workflow.abi.focus_entry.value) {
    issues.push(
      issue(
        "pilot_fixture.focus_entry_alias",
        `${path}/abi/focus_entry/value`,
        "focus_entry must alias the workflow setup locator",
      ),
    );
  }
  if (
    workflow.expectations.setup_attribute.name !== "value" ||
    workflow.expectations.setup_attribute.initial ===
      workflow.expectations.setup_attribute.selected
  ) {
    issues.push(
      issue(
        "pilot_fixture.setup_expectation",
        `${path}/expectations/setup_attribute`,
        "setup expectation must declare distinct initial and selected native values",
      ),
    );
  }
  if (workflow.expectations.pre_primary_focus !== "primary") {
    issues.push(
      issue(
        "pilot_fixture.pre_primary_focus",
        `${path}/expectations/pre_primary_focus`,
        "pre-primary focus must resolve to the primary ABI slot",
      ),
    );
  }
  if (workflow.expectations.final.focus !== "success") {
    issues.push(
      issue(
        "pilot_fixture.final_focus",
        `${path}/expectations/final/focus`,
        "successful activation must focus the success ABI slot",
      ),
    );
  }
}

function crossWorkflowIssues(
  manifest: PilotFixtureManifest,
  issues: ContractIssue[],
): void {
  const first = manifest.workflows[0];
  const second = manifest.workflows[1];
  if (first === undefined || second === undefined) {
    return;
  }
  if (first.abi.root.value !== second.abi.root.value) {
    issues.push(
      issue(
        "pilot_fixture.shared_root",
        "/workflows/1/abi/root/value",
        "both workflows must share exactly one application root",
      ),
    );
  }

  const firstNonRoot = new Set(
    pilotFixtureAbiSlots
      .filter((slot) => slot !== "root")
      .map((slot) => first.abi[slot].value),
  );
  for (const slot of pilotFixtureAbiSlots) {
    if (slot === "root") {
      continue;
    }
    const value = second.abi[slot].value;
    if (value === first.abi.root.value || firstNonRoot.has(value)) {
      issues.push(
        issue(
          "pilot_fixture.cross_workflow_abi",
          `/workflows/1/abi/${slot}/value`,
          "only the root locator may be shared across workflows",
        ),
      );
    }
  }
}

function manifestIssues(manifest: PilotFixtureManifest): ContractIssue[] {
  const issues = rootIssues(manifest);
  environmentIssues(manifest, issues);
  resourceIssues(manifest, issues);
  for (const [index, workflow] of manifest.workflows.entries()) {
    workflowIssues(workflow, index, issues);
  }
  crossWorkflowIssues(manifest, issues);
  return issues;
}

export function validatePilotFixtureManifest(value: unknown): PilotFixtureManifest {
  const normalized = normalizedSchemaValue(contractName, manifestValidator, value);
  assertNoIssues(contractName, manifestIssues(normalized));
  return normalized;
}

export function parsePilotFixtureManifest(
  input: string | Uint8Array,
): PilotFixtureManifest {
  return validatePilotFixtureManifest(parseCanonicalJson(input, manifestLimits));
}
