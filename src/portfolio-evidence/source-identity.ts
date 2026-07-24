import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import {
  canonicalJson,
  computeCheckpointId,
  sha256Hex,
} from "../contracts/canonical.js";
import {
  auditProvenanceFileTree,
  readStableProvenanceFile,
  type ProvenanceFileTreeAudit,
} from "../mutations/provenance-files.js";
import { loadPilotFixtureAuthoringPackage } from "../pilot/fixture/package.js";
import { PilotPortfolioEvidenceError } from "./errors.js";
import {
  pilotPortfolioEvidenceCatalog,
  type PilotPortfolioByteIdentity,
  type PilotPortfolioEvidenceManifest,
} from "./schema.js";

const execFileAsync = promisify(execFile);
const gitObjectPattern = /^[0-9a-f]{40}$/u;
const rootSourceFiles = Object.freeze([
  ".node-version",
  "package-lock.json",
  "package.json",
  "tsconfig.json",
] as const);

export interface PilotPortfolioSourceIdentity {
  readonly repository_root: string;
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
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotPortfolioEvidenceError(code, message, options);
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function canonicalRepositoryRoot(input: unknown): Promise<string> {
  if (
    typeof input !== "string" ||
    input.length < 1 ||
    input.length > 4_096 ||
    input.includes("\0")
  ) {
    fail(
      "portfolio_evidence.repository",
      "repository root must be one bounded nonempty path",
    );
  }
  const absolute = resolve(input);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch (error) {
    fail("portfolio_evidence.repository", "repository root cannot be resolved", {
      cause: error,
    });
  }
  if (canonical !== absolute) {
    fail(
      "portfolio_evidence.repository_alias",
      "repository root cannot use symbolic path aliases",
    );
  }
  return canonical;
}

async function gitRaw(
  repositoryRoot: string,
  arguments_: readonly string[],
  maximumBytes = 1_048_576,
): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", repositoryRoot, ...arguments_], {
      encoding: "utf8",
      maxBuffer: maximumBytes,
      timeout: 10_000,
    });
    if (result.stderr !== "") {
      fail(
        "portfolio_evidence.git",
        "Git source identity query returned unexpected diagnostic output",
      );
    }
    return result.stdout;
  } catch (error) {
    if (error instanceof PilotPortfolioEvidenceError) {
      throw error;
    }
    fail("portfolio_evidence.git", "Git source identity query failed", {
      cause: error,
    });
  }
}

async function gitLine(
  repositoryRoot: string,
  arguments_: readonly string[],
): Promise<string> {
  const output = await gitRaw(repositoryRoot, arguments_, 8_192);
  const line = output.trim();
  if (line === "" || line.includes("\n")) {
    fail("portfolio_evidence.git", "Git identity query returned invalid output");
  }
  return line;
}

async function assertCleanWorktree(repositoryRoot: string): Promise<void> {
  if (
    (await gitRaw(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignored=no",
    ])) !== ""
  ) {
    fail(
      "portfolio_evidence.source_worktree",
      "portfolio capture and freshness checks require a clean Git worktree",
    );
  }
}

async function auditTree(path: string): Promise<ProvenanceFileTreeAudit> {
  try {
    return await auditProvenanceFileTree(path, {
      maximumFileBytes: 16_777_216,
      maximumTreeBytes: 67_108_864,
      capturePaths: new Set(),
      captureBytePaths: new Set(),
    });
  } catch (error) {
    fail(
      "portfolio_evidence.source_tree",
      "portfolio source tree could not be audited",
      { cause: error },
    );
  }
}

async function rootFileIdentities(repositoryRoot: string): Promise<{
  readonly manifest: readonly {
    readonly name: string;
    readonly sha256: string;
    readonly byte_length: number;
  }[];
  readonly publicIdentities: PilotPortfolioSourceIdentity["root_files"];
}> {
  const records: {
    readonly name: string;
    readonly sha256: string;
    readonly byte_length: number;
  }[] = [];
  for (const name of rootSourceFiles) {
    let file;
    try {
      file = await readStableProvenanceFile(
        join(repositoryRoot, name),
        4_194_304,
        false,
      );
    } catch (error) {
      fail(
        "portfolio_evidence.source_file",
        `required portfolio source file ${name} could not be audited`,
        { cause: error },
      );
    }
    records.push(
      Object.freeze({
        name,
        sha256: file.sha256,
        byte_length: file.byteLength,
      }),
    );
  }
  const byName = new Map(records.map((record) => [record.name, record]));
  const identity = (
    name: (typeof rootSourceFiles)[number],
  ): PilotPortfolioByteIdentity => {
    const record = byName.get(name);
    if (record === undefined) {
      fail("portfolio_evidence.source_file", "required root source identity is absent");
    }
    return Object.freeze({
      sha256: record.sha256,
      byte_length: record.byte_length,
    });
  };
  return Object.freeze({
    manifest: Object.freeze(records),
    publicIdentities: Object.freeze({
      node_version_file: identity(".node-version"),
      package_lock: identity("package-lock.json"),
      package_manifest: identity("package.json"),
      typescript_config: identity("tsconfig.json"),
    }),
  });
}

function treeRecord(label: string, audit: ProvenanceFileTreeAudit) {
  return Object.freeze({
    label,
    directories: audit.directories,
    files: audit.files,
  });
}

async function assertExactTrackedAuthoredFiles(
  repositoryRoot: string,
  sourceTree: ProvenanceFileTreeAudit,
  fixtureTrees: readonly {
    readonly directory: string;
    readonly audit: ProvenanceFileTreeAudit;
  }[],
): Promise<void> {
  const expected = [
    ...rootSourceFiles,
    ...sourceTree.files.map(({ path }) => `src/${path}`),
    ...fixtureTrees.flatMap(({ directory, audit }) =>
      audit.files.map(({ path }) => `${directory}/${path}`),
    ),
  ].sort(codeUnitCompare);
  const trackedOutput = await gitRaw(repositoryRoot, [
    "ls-files",
    "-z",
    "--",
    ...rootSourceFiles,
    "src",
    ...pilotPortfolioEvidenceCatalog.map(({ fixture_directory: path }) => path),
  ]);
  if (trackedOutput !== "" && !trackedOutput.endsWith("\0")) {
    fail(
      "portfolio_evidence.source_tracking",
      "Git tracked-file query was not NUL terminated",
    );
  }
  const tracked = trackedOutput === "" ? [] : trackedOutput.slice(0, -1).split("\0");
  tracked.sort(codeUnitCompare);
  if (
    tracked.length !== expected.length ||
    tracked.some((path, index) => path !== expected[index])
  ) {
    fail(
      "portfolio_evidence.source_tracking",
      "every authored source, fixture, and root input must be tracked exactly by Git",
    );
  }
}

async function assertRecordedRevisionAncestor(
  repositoryRoot: string,
  recordedRevision: string,
  currentRevision: string,
): Promise<void> {
  try {
    const result = await execFileAsync(
      "git",
      [
        "-C",
        repositoryRoot,
        "merge-base",
        "--is-ancestor",
        recordedRevision,
        currentRevision,
      ],
      {
        encoding: "utf8",
        maxBuffer: 8_192,
        timeout: 10_000,
      },
    );
    if (result.stdout !== "" || result.stderr !== "") {
      fail(
        "portfolio_evidence.source_revision_ancestry",
        "Git ancestry check returned unexpected output",
      );
    }
  } catch (error) {
    if (error instanceof PilotPortfolioEvidenceError) {
      throw error;
    }
    fail(
      "portfolio_evidence.source_revision_ancestry",
      "recorded source revision is not an ancestor of the current clean revision",
      { cause: error },
    );
  }
}

/**
 * Binds one clean committed Git baseline and the exact authored/compiled bytes
 * used by a local run. Every authored input must be tracked; ignored compiled
 * output is independently byte-bound.
 */
export async function inspectPilotPortfolioSourceIdentity(
  repositoryRootInput: string,
): Promise<PilotPortfolioSourceIdentity> {
  const repositoryRoot = await canonicalRepositoryRoot(repositoryRootInput);
  const reportedTopLevel = await gitLine(repositoryRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
  ]);
  if (reportedTopLevel !== repositoryRoot) {
    fail(
      "portfolio_evidence.repository_boundary",
      "repository root differs from the Git top-level directory",
    );
  }
  await assertCleanWorktree(repositoryRoot);
  const [gitRevision, gitTree, rootFiles, sourceTree, compiledTree] = await Promise.all(
    [
      gitLine(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
      gitLine(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"]),
      rootFileIdentities(repositoryRoot),
      auditTree(join(repositoryRoot, "src")),
      auditTree(join(repositoryRoot, "dist", "src")),
    ],
  );
  if (!gitObjectPattern.test(gitRevision) || !gitObjectPattern.test(gitTree)) {
    fail(
      "portfolio_evidence.git_identity",
      "repository must use canonical 40-hex Git object identities",
    );
  }

  const fixtureTrees: {
    readonly directory: string;
    readonly audit: ProvenanceFileTreeAudit;
  }[] = [];
  for (const fixture of pilotPortfolioEvidenceCatalog) {
    fixtureTrees.push(
      Object.freeze({
        directory: fixture.fixture_directory,
        audit: await auditTree(join(repositoryRoot, fixture.fixture_directory)),
      }),
    );
  }
  await assertExactTrackedAuthoredFiles(repositoryRoot, sourceTree, fixtureTrees);
  await assertCleanWorktree(repositoryRoot);
  const [gitRevisionAfter, gitTreeAfter] = await Promise.all([
    gitLine(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
    gitLine(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"]),
  ]);
  if (gitRevisionAfter !== gitRevision || gitTreeAfter !== gitTree) {
    fail(
      "portfolio_evidence.source_changed",
      "Git source revision changed during source identity inspection",
    );
  }

  const authoredSourceTreeSha256 = sha256Hex(
    canonicalJson({
      contract: "impactdiff.pilot-portfolio-authored-source-tree",
      version: 1,
      root_files: rootFiles.manifest,
      trees: [
        treeRecord("src", sourceTree),
        ...fixtureTrees.map(({ directory, audit }) => treeRecord(directory, audit)),
      ],
    }),
  );
  const compiledRuntimeTreeSha256 = sha256Hex(
    canonicalJson({
      contract: "impactdiff.pilot-portfolio-compiled-runtime-tree",
      version: 1,
      tree: treeRecord("dist/src", compiledTree),
    }),
  );
  return Object.freeze({
    repository_root: repositoryRoot,
    git_revision: gitRevision,
    git_tree: gitTree,
    root_files: rootFiles.publicIdentities,
    authored_source_tree_sha256: authoredSourceTreeSha256,
    compiled_runtime_tree_sha256: compiledRuntimeTreeSha256,
  });
}

function sameArtifactIdentity(
  manifestIdentity: {
    readonly sha256: string;
    readonly byte_length: number;
    readonly media_type: string;
    readonly format_version: 1;
  },
  packageReference: {
    readonly sha256: string;
    readonly byte_length: number;
    readonly media_type: string;
    readonly format_version: 1;
  },
  packageBytes: Uint8Array,
): boolean {
  return (
    manifestIdentity.sha256 === packageReference.sha256 &&
    manifestIdentity.byte_length === packageReference.byte_length &&
    manifestIdentity.media_type === packageReference.media_type &&
    manifestIdentity.format_version === packageReference.format_version &&
    manifestIdentity.sha256 === sha256Hex(packageBytes) &&
    manifestIdentity.byte_length === packageBytes.byteLength
  );
}

async function assertRepositoryFixtureBindings(
  repositoryRoot: string,
  manifest: PilotPortfolioEvidenceManifest,
): Promise<void> {
  for (const [
    fixtureIndex,
    catalogFixture,
  ] of pilotPortfolioEvidenceCatalog.entries()) {
    const fixture = manifest.fixtures[fixtureIndex];
    if (fixture === undefined) {
      fail(
        "portfolio_evidence.repository_fixture",
        "repository fixture is absent from the evidence manifest",
      );
    }
    const fixtureDirectory = join(repositoryRoot, catalogFixture.fixture_directory);
    const [authoringPackage, rawManifest] = await Promise.all([
      loadPilotFixtureAuthoringPackage(fixtureDirectory),
      readStableProvenanceFile(join(fixtureDirectory, "fixture.json"), 131_072, false),
    ]);
    if (
      authoringPackage.manifest.application_key !== fixture.application_key ||
      authoringPackage.manifest.fixture_key !== fixture.fixture_key ||
      authoringPackage.manifest.revision !== fixture.fixture_revision ||
      rawManifest.sha256 !== fixture.fixture_manifest.sha256 ||
      rawManifest.byteLength !== fixture.fixture_manifest.byte_length ||
      !sameArtifactIdentity(
        fixture.source_state,
        authoringPackage.source_state.reference,
        authoringPackage.source_state.bytes,
      ) ||
      fixture.source_state_id !== authoringPackage.source_state_id
    ) {
      fail(
        "portfolio_evidence.repository_fixture",
        "repository fixture, manifest, or source-state bytes differ from the evidence",
      );
    }
    for (const [workflowIndex, catalogWorkflow] of catalogFixture.workflows.entries()) {
      const workflow = fixture.workflows[workflowIndex];
      const packagedWorkflow = authoringPackage.workflows[workflowIndex];
      if (
        workflow === undefined ||
        packagedWorkflow === undefined ||
        workflow.workflow_key !== catalogWorkflow.workflow_key ||
        packagedWorkflow.workflow_key !== catalogWorkflow.workflow_key ||
        workflow.task_id !== packagedWorkflow.task_id ||
        !sameArtifactIdentity(
          workflow.action_plan,
          packagedWorkflow.action_plan.reference,
          packagedWorkflow.action_plan.bytes,
        ) ||
        workflow.checkpoints.some(
          (checkpoint, checkpointIndex) =>
            checkpoint.checkpoint_id !==
            computeCheckpointId(
              packagedWorkflow.action_plan.reference,
              checkpointIndex,
            ),
        )
      ) {
        fail(
          "portfolio_evidence.repository_workflow",
          "repository action plan, task, or checkpoint identity differs from the evidence",
        );
      }
    }
  }
}

/**
 * Documentation/evidence-only descendant commits are allowed, but all scoped
 * authored, root, and compiled runtime bytes must remain identical.
 */
export async function verifyPilotPortfolioSourceFreshness(
  repositoryRoot: string,
  manifest: PilotPortfolioEvidenceManifest,
): Promise<void> {
  const expected = manifest.source;
  const current = await inspectPilotPortfolioSourceIdentity(repositoryRoot);
  const [recordedCommit, recordedTree] = await Promise.all([
    gitLine(current.repository_root, [
      "rev-parse",
      "--verify",
      `${expected.git_revision}^{commit}`,
    ]),
    gitLine(current.repository_root, [
      "rev-parse",
      "--verify",
      `${expected.git_revision}^{tree}`,
    ]),
  ]);
  if (recordedCommit !== expected.git_revision || recordedTree !== expected.git_tree) {
    fail(
      "portfolio_evidence.source_revision_binding",
      "recorded Git revision or tree no longer resolves to its manifest identity",
    );
  }
  await assertRecordedRevisionAncestor(
    current.repository_root,
    expected.git_revision,
    current.git_revision,
  );
  if (
    canonicalJson(current.root_files) !== canonicalJson(expected.root_files) ||
    current.authored_source_tree_sha256 !== expected.authored_source_tree_sha256 ||
    current.compiled_runtime_tree_sha256 !== expected.compiled_runtime_tree_sha256
  ) {
    fail(
      "portfolio_evidence.source_freshness",
      "current authored, root, or compiled runtime bytes differ from the evidence manifest",
    );
  }
  await assertRepositoryFixtureBindings(current.repository_root, manifest);
  const final = await inspectPilotPortfolioSourceIdentity(current.repository_root);
  if (
    final.git_revision !== current.git_revision ||
    final.git_tree !== current.git_tree ||
    canonicalJson(final.root_files) !== canonicalJson(current.root_files) ||
    final.authored_source_tree_sha256 !== current.authored_source_tree_sha256 ||
    final.compiled_runtime_tree_sha256 !== current.compiled_runtime_tree_sha256
  ) {
    fail(
      "portfolio_evidence.source_changed",
      "repository source or compiled runtime changed during evidence verification",
    );
  }
}
