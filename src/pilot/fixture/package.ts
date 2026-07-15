import { resolve } from "node:path";

import type { ArtifactRef } from "../../contracts/artifacts.js";
import {
  canonicalJson,
  computeSourceStateId,
  sha256Hex,
} from "../../contracts/canonical.js";
import {
  auditProvenanceFileTree,
  type ProvenanceTreeFile,
} from "../../mutations/provenance-files.js";
import { parseSourceState } from "../../source/validate.js";
import type { SourceState } from "../../source/schema.js";
import {
  buildPilotFixtureActionPlanArtifacts,
  type PilotFixtureActionPlanArtifact,
} from "./action-plan.js";
import type { PilotFixtureManifest } from "./schema.js";
import { parsePilotFixtureManifest } from "./validate.js";

const fixtureManifestPath = "fixture.json";
const maximumFixtureFileBytes = 16_777_216;
const maximumFixtureTreeBytes = 20_971_520;
const maximumApplicationOwnedBytes = 524_288;
const sourceStateMediaType = "application/vnd.impactdiff.source-state+json" as const;

export const pilotFixtureNotoSansSha256 =
  "df8c8215937ab2a4270c0cd997101b3fb8cdd444c9903d342200d6179ebcc097" as const;
export const pilotFixtureOflLicenseSha256 =
  "54ec7b5a35310ad66f9f3091426f7028484cbf9ae1ab5da30122ee412a3009e1" as const;

export class PilotFixtureAuthoringError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PilotFixtureAuthoringError";
    this.code = code;
  }
}

export interface PilotFixtureArtifact {
  readonly reference: ArtifactRef;
  readonly bytes: Uint8Array;
}

export interface PilotFixtureAuthoringWorkflow {
  readonly workflow_key: string;
  readonly action_plan: PilotFixtureArtifact;
  readonly task_id: string;
}

export interface PilotFixtureAuthoringPackage {
  readonly kind: "pilot_fixture_authoring_package";
  readonly official: false;
  readonly manifest: PilotFixtureManifest;
  readonly source_state: PilotFixtureArtifact;
  readonly source_state_id: string;
  readonly workflows: readonly PilotFixtureAuthoringWorkflow[];
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotFixtureAuthoringError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function canonicalManifestPayload(bytes: Uint8Array): Uint8Array {
  if (
    bytes.byteLength > 1 &&
    bytes[bytes.byteLength - 1] === 0x0a &&
    bytes[bytes.byteLength - 2] !== 0x0a &&
    bytes[bytes.byteLength - 2] !== 0x0d
  ) {
    return bytes.subarray(0, bytes.byteLength - 1);
  }
  return bytes;
}

function expectedDirectories(resourcePaths: readonly string[]): readonly string[] {
  const directories = new Set<string>();
  for (const path of resourcePaths) {
    const segments = path.split("/");
    segments.pop();
    let parent = "";
    for (const segment of segments) {
      parent = parent === "" ? segment : `${parent}/${segment}`;
      directories.add(parent);
    }
  }
  return Object.freeze([...directories].sort(codeUnitCompare));
}

function treeFileByPath(
  files: readonly ProvenanceTreeFile[],
): ReadonlyMap<string, ProvenanceTreeFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function verifyResourceBindings(
  manifest: PilotFixtureManifest,
  treeFiles: readonly ProvenanceTreeFile[],
): void {
  const byPath = treeFileByPath(treeFiles);
  let applicationOwnedBytes = 0;
  for (const resource of manifest.resources) {
    const audited = byPath.get(resource.path);
    if (
      audited === undefined ||
      audited.sha256 !== resource.sha256 ||
      audited.byte_length !== resource.byte_length
    ) {
      fail(
        "pilot_fixture.resource_binding",
        `resource ${resource.path} differs from its manifest digest or byte length`,
      );
    }
    if (
      resource.path !== manifest.font.path &&
      resource.path !== manifest.font.license_path
    ) {
      applicationOwnedBytes += resource.byte_length;
    }
  }
  if (applicationOwnedBytes > maximumApplicationOwnedBytes) {
    fail(
      "pilot_fixture.application_bytes",
      "application-owned fixture bytes exceed the 512 KiB authoring budget",
    );
  }

  const font = byPath.get(manifest.font.path);
  const license = byPath.get(manifest.font.license_path);
  if (
    manifest.font.path !== "fonts/noto-sans-latin-standard-normal.woff2" ||
    manifest.font.license_path !== "fonts/ofl-1.1.txt" ||
    manifest.font.family !== "ImpactDiff Noto Sans" ||
    manifest.font.source_package !== "@fontsource-variable/noto-sans@5.2.10" ||
    manifest.font.license !== "OFL-1.1" ||
    manifest.font.sha256 !== pilotFixtureNotoSansSha256 ||
    font?.sha256 !== pilotFixtureNotoSansSha256 ||
    license?.sha256 !== pilotFixtureOflLicenseSha256
  ) {
    fail(
      "pilot_fixture.shared_font",
      "the Pilot fixture must bind the exact allowlisted Noto Sans and OFL bytes",
    );
  }
}

function artifact(reference: ArtifactRef, bytes: Uint8Array): PilotFixtureArtifact {
  const privateBytes = Buffer.from(bytes);
  const value = {} as PilotFixtureArtifact;
  Object.defineProperties(value, {
    reference: {
      configurable: false,
      enumerable: true,
      value: Object.freeze({ ...reference }),
      writable: false,
    },
    bytes: {
      configurable: false,
      enumerable: true,
      get: () => Buffer.from(privateBytes),
    },
  });
  return Object.freeze(value);
}

function sourceStateArtifact(
  manifest: PilotFixtureManifest,
  rawManifest: { readonly sha256: string; readonly byte_length: number },
): { readonly artifact: PilotFixtureArtifact; readonly sourceStateId: string } {
  const sourceState = {
    contract: "impactdiff.source-state",
    version: 1,
    source: {
      kind: "closed_fixture",
      fixture_id: manifest.fixture_key,
      revision: manifest.revision,
      license: manifest.license,
      entrypoint: manifest.entrypoint,
      raw_manifest: rawManifest,
      resources: manifest.resources,
    },
    initial_state: {
      kind: "fixture_default",
      route: "/",
      storage: "empty",
    },
  } as const satisfies SourceState;
  const bytes = Buffer.from(canonicalJson(sourceState), "utf8");
  parseSourceState(bytes);
  const reference = Object.freeze({
    sha256: sha256Hex(bytes),
    byte_length: bytes.byteLength,
    media_type: sourceStateMediaType,
    format_version: 1 as const,
  });
  return Object.freeze({
    artifact: artifact(reference, bytes),
    sourceStateId: computeSourceStateId(reference),
  });
}

function workflowPackage(
  value: PilotFixtureActionPlanArtifact,
): PilotFixtureAuthoringWorkflow {
  return Object.freeze({
    workflow_key: value.workflow_key,
    action_plan: artifact(value.reference, value.bytes),
    task_id: value.task_id,
  });
}

/**
 * Resolves one pre-release Pilot fixture into canonical authoring artifacts. This
 * function performs no browser execution and cannot emit outcomes or official rows.
 */
export async function loadPilotFixtureAuthoringPackage(
  fixtureDirectory: string,
): Promise<PilotFixtureAuthoringPackage> {
  if (
    typeof fixtureDirectory !== "string" ||
    fixtureDirectory.length < 1 ||
    fixtureDirectory.length > 4_096 ||
    fixtureDirectory.includes("\0")
  ) {
    fail("pilot_fixture.directory", "fixture directory path is invalid");
  }
  const root = resolve(fixtureDirectory);
  let tree;
  try {
    tree = await auditProvenanceFileTree(root, {
      maximumFileBytes: maximumFixtureFileBytes,
      maximumTreeBytes: maximumFixtureTreeBytes,
      capturePaths: new Set([fixtureManifestPath]),
      captureBytePaths: new Set([fixtureManifestPath]),
    });
  } catch (error) {
    fail("pilot_fixture.tree", "fixture file-tree audit failed", { cause: error });
  }
  const capturedManifest = tree.captures.get(fixtureManifestPath);
  const manifestBytes = capturedManifest?.bytes;
  if (capturedManifest === undefined || manifestBytes === undefined) {
    fail("pilot_fixture.manifest", "fixture manifest was not captured by the audit");
  }

  let manifest: PilotFixtureManifest;
  try {
    manifest = parsePilotFixtureManifest(canonicalManifestPayload(manifestBytes));
  } catch (error) {
    fail("pilot_fixture.manifest", "fixture manifest validation failed", {
      cause: error,
    });
  }

  const expectedFiles = Object.freeze(
    [fixtureManifestPath, ...manifest.resources.map(({ path }) => path)].sort(
      codeUnitCompare,
    ),
  );
  const expectedDirectoryPaths = expectedDirectories(
    manifest.resources.map(({ path }) => path),
  );
  if (
    !exactStrings(
      tree.files.map(({ path }) => path),
      expectedFiles,
    ) ||
    !exactStrings(tree.directories, expectedDirectoryPaths)
  ) {
    fail(
      "pilot_fixture.membership",
      "fixture directory must contain exactly the manifest and declared resources",
    );
  }
  verifyResourceBindings(manifest, tree.files);

  const source = sourceStateArtifact(manifest, {
    sha256: capturedManifest.sha256,
    byte_length: capturedManifest.byteLength,
  });
  const plans = buildPilotFixtureActionPlanArtifacts(
    manifest,
    capturedManifest.sha256,
  ).map(workflowPackage);

  return Object.freeze({
    kind: "pilot_fixture_authoring_package",
    official: false,
    manifest,
    source_state: source.artifact,
    source_state_id: source.sourceStateId,
    workflows: Object.freeze(plans),
  });
}
