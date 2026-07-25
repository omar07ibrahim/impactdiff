import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../../..");
const recorderSource = join(repositoryRoot, "tools/capture-pilot-cli-terminal.mjs");
const generatedTestRoot = join(
  repositoryRoot,
  "artifacts/generated/terminal-evidence-tests",
);
const toolRelative = "tools/capture-pilot-cli-terminal.mjs";
const outputRelative = "docs/images/terminal-evidence";
const expectedOutputNames = [
  "MANIFEST.json",
  "evidence-boundary.svg",
  "pilot-evidence-check.svg",
  "pilot-evidence-check.txt",
];
const expectedInputPaths = [
  ".node-version",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "src/cli/pilot-portfolio-evidence.ts",
  "src/portfolio-evidence/publication.ts",
  "docs/images/pilot-portfolio-evidence/MANIFEST.json",
];
const establishes = [
  "one successful exact-runtime verification of the committed local-authoring Pilot evidence",
  "path-free stdout exactly matches the independently derived committed-manifest receipt",
  "the allowlisted source and manifest inputs have the recorded byte identities",
];
function runRecordDoesNotEstablish(nodeVersion: string): readonly string[] {
  return [
    "official dataset release",
    "model quality or benchmark performance",
    "fresh browser capture or production-browser compatibility",
    `execution on any runtime other than the recorded Node.js ${nodeVersion}`,
  ];
}

function terminalDoesNotEstablish(nodeVersion: string): readonly string[] {
  return [
    ...runRecordDoesNotEstablish(nodeVersion),
    "network behavior or network isolation",
  ];
}

interface FixtureOptions {
  readonly commandStdout?: string;
  readonly recordedNode?: string;
  readonly commandMutation?: "tracked_source" | "head";
}

interface Fixture {
  readonly root: string;
  readonly bin: string;
  readonly receipt: string;
  readonly output: string;
  readonly invocations: string;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function runGit(root: string, arguments_: readonly string[]) {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function runRecorder(
  fixture: Pick<Fixture, "root" | "bin">,
  arguments_: readonly string[],
) {
  return spawnSync(
    process.execPath,
    [join(fixture.root, toolRelative), ...arguments_],
    {
      cwd: fixture.root,
      env: {
        PATH: `${fixture.bin}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
}

async function writeFixtureFile(
  root: string,
  relativePath: string,
  bytes: Buffer | string,
): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function createFixture(
  t: test.TestContext,
  options: FixtureOptions = {},
): Promise<Fixture> {
  await mkdir(generatedTestRoot, { recursive: true });
  const root = await mkdtemp(join(generatedTestRoot, "repo-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const recordedNode = options.recordedNode ?? process.versions.node;
  const npmVersion = "10.9.8";
  const evidenceManifest = Buffer.from(
    '{"contract":"impactdiff.test-evidence","official":false}\n',
    "utf8",
  );
  const receipt = `${JSON.stringify({
    official: false,
    manifest_sha256: sha256(evidenceManifest),
    fixture_count: 2,
    workflow_count: 4,
    checkpoint_count: 12,
  })}\n`;
  const sourceContents = new Map<string, Buffer | string>([
    [".node-version", `${recordedNode}\n`],
    [
      "package.json",
      `${JSON.stringify({
        name: "terminal-evidence-fixture",
        private: true,
        packageManager: `npm@${npmVersion}`,
      })}\n`,
    ],
    ["package-lock.json", "{}\n"],
    ["tsconfig.json", "{}\n"],
    ["src/cli/pilot-portfolio-evidence.ts", "export {};\n"],
    ["src/portfolio-evidence/publication.ts", "export {};\n"],
    ["docs/images/pilot-portfolio-evidence/MANIFEST.json", evidenceManifest],
  ]);
  for (const [path, bytes] of sourceContents) {
    await writeFixtureFile(root, path, bytes);
  }
  await writeFixtureFile(root, ".gitignore", ".npm-invocations\n");
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=Omar Ibrahim",
    "-c",
    "user.email=31526072+omar07ibrahim@users.noreply.github.com",
    "commit",
    "--quiet",
    "-m",
    "Create evidence source fixture",
  ]);
  const sourceRevision = runGit(root, [
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]).stdout.trim();
  const sourceTree = runGit(root, [
    "rev-parse",
    "--verify",
    "HEAD^{tree}",
  ]).stdout.trim();

  const inputs = expectedInputPaths.map((path) => {
    const value = sourceContents.get(path);
    assert.ok(value !== undefined);
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    return {
      path,
      sha256: sha256(bytes),
      byte_length: bytes.byteLength,
    };
  });
  const runRecord = {
    contract: "impactdiff.pilot-evidence-cli-run",
    version: 1,
    official: false,
    source: {
      git_revision: sourceRevision,
      git_tree: sourceTree,
    },
    command: {
      argv: ["npm", "run", "--silent", "evidence:pilot:check"],
    },
    runtime: {
      node: recordedNode,
      node_module_abi: process.versions.modules,
      npm: npmVersion,
      platform: process.platform,
      architecture: process.arch,
    },
    result: {
      exit_code: 0,
      stdout: {
        file: "pilot-evidence-check.stdout",
        media_type: "application/jsonl; charset=utf-8",
        sha256: sha256(receipt),
        byte_length: Buffer.byteLength(receipt),
        line_count: 1,
      },
      stderr: {
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        byte_length: 0,
      },
    },
    inputs,
    evidence_boundary: {
      establishes,
      does_not_establish: runRecordDoesNotEstablish(recordedNode),
    },
  };
  await writeFixtureFile(
    root,
    "docs/quality/pilot-evidence-check-run.json",
    `${JSON.stringify(runRecord, null, 2)}\n`,
  );
  await writeFixtureFile(root, "docs/quality/pilot-evidence-check.stdout", receipt);
  await mkdir(join(root, "tools"), { recursive: true });
  await copyFile(recorderSource, join(root, toolRelative));

  const bin = join(root, ".test-bin");
  const invocations = join(root, ".npm-invocations");
  await mkdir(bin);
  const commandStdout = options.commandStdout ?? receipt;
  const mutation =
    options.commandMutation === "tracked_source"
      ? `  printf '%s\\n' ${shellLiteral("export const child_mutated = true;")} > src/cli/pilot-portfolio-evidence.ts\n`
      : options.commandMutation === "head"
        ? "  /usr/bin/git -c user.name='Omar Ibrahim' -c user.email='31526072+omar07ibrahim@users.noreply.github.com' commit --allow-empty --quiet -m 'Advance during capture'\n"
        : "";
  const fakeNpm =
    "#!/bin/sh\n" +
    'printf "%s\\n" "$*" >> .npm-invocations\n' +
    'if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then\n' +
    `  printf '%s\\n' '${npmVersion}'\n` +
    "  exit 0\n" +
    "fi\n" +
    'if [ "$#" -eq 3 ] && [ "$1" = "run" ] && [ "$2" = "--silent" ] && [ "$3" = "evidence:pilot:check" ]; then\n' +
    mutation +
    `  printf '%s' ${shellLiteral(commandStdout)}\n` +
    "  exit 0\n" +
    "fi\n" +
    "exit 70\n";
  await writeFile(join(bin, "npm"), fakeNpm);
  await chmod(join(bin, "npm"), 0o755);

  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=Omar Ibrahim",
    "-c",
    "user.email=31526072+omar07ibrahim@users.noreply.github.com",
    "commit",
    "--quiet",
    "-m",
    "Add terminal evidence fixture",
  ]);

  return {
    root,
    bin,
    receipt,
    output: join(root, outputRelative),
    invocations,
  };
}

test("terminal evidence recorder rejects every malformed invocation path-free", async (t) => {
  const fixture = await createFixture(t);
  const invalid = [
    [],
    ["--help"],
    ["write"],
    ["record", "extra"],
    ["check", "extra"],
  ] as const;
  for (const arguments_ of invalid) {
    await t.test(JSON.stringify(arguments_), () => {
      const result = runRecorder(fixture, arguments_);
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, '{"code":"terminal_evidence.arguments"}\n');
      assert.equal(result.stderr.includes(fixture.root), false);
    });
  }
});

test("record captures one exact CLI run and check remains evidence-command-free", async (t) => {
  const fixture = await createFixture(t);
  const recorded = runRecorder(fixture, ["record"]);

  assert.equal(recorded.error, undefined);
  assert.equal(recorded.signal, null);
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(recorded.stderr, "");
  assert.equal(
    recorded.stdout,
    `recorded 4 manifest-bound files in ${outputRelative}\n`,
  );
  assert.deepEqual((await readdir(fixture.output)).sort(), expectedOutputNames);
  assert.equal(
    await readFile(join(fixture.output, "pilot-evidence-check.txt"), "utf8"),
    `$ npm run --silent evidence:pilot:check\n${fixture.receipt}`,
  );

  const manifestBytes = await readFile(join(fixture.output, "MANIFEST.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    command: { argv: string[]; shell: boolean; invocation_count: number };
    official: boolean;
    network_observation: string;
    runtime: { node: string };
    evidence_boundary: { does_not_establish: string[] };
    sources: Array<{ path: string; sha256: string; byte_length: number }>;
    artifacts: Array<{
      file: string;
      sha256: string;
      byte_length: number;
    }>;
  };
  assert.equal(
    manifestBytes.toString("utf8"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  assert.equal(manifest.official, false);
  assert.equal(manifest.network_observation, "not_observed");
  assert.equal(manifest.runtime.node, process.versions.node);
  assert.deepEqual(
    manifest.evidence_boundary.does_not_establish,
    terminalDoesNotEstablish(process.versions.node),
  );
  assert.deepEqual(manifest.command.argv, [
    "npm",
    "run",
    "--silent",
    "evidence:pilot:check",
  ]);
  assert.equal(manifest.command.shell, false);
  assert.equal(manifest.command.invocation_count, 1);
  assert.deepEqual(
    manifest.sources.map(({ path }) => path),
    [
      ".node-version",
      "docs/images/pilot-portfolio-evidence/MANIFEST.json",
      "docs/quality/pilot-evidence-check-run.json",
      "docs/quality/pilot-evidence-check.stdout",
      "package-lock.json",
      "package.json",
      "src/cli/pilot-portfolio-evidence.ts",
      "src/portfolio-evidence/publication.ts",
      "tools/capture-pilot-cli-terminal.mjs",
      "tsconfig.json",
    ],
  );
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(fixture.output, artifact.file));
    assert.equal(artifact.sha256, sha256(bytes));
    assert.equal(artifact.byte_length, bytes.byteLength);
  }

  const beforeCheckInvocations = await readFile(fixture.invocations, "utf8");
  assert.equal(
    beforeCheckInvocations,
    "--version\nrun --silent evidence:pilot:check\n",
  );
  const checked = runRecorder(fixture, ["check"]);
  assert.equal(checked.error, undefined);
  assert.equal(checked.signal, null);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.stderr, "");
  assert.equal(
    checked.stdout,
    `verified 4 manifest-bound files in ${outputRelative}\n`,
  );
  assert.equal(await readFile(fixture.invocations, "utf8"), beforeCheckInvocations);

  const publicArtifacts = Buffer.concat(
    await Promise.all(
      expectedOutputNames.map((name) => readFile(join(fixture.output, name))),
    ),
  ).toString("utf8");
  assert.equal(publicArtifacts.includes(fixture.root), false);
  assert.equal(publicArtifacts.includes(process.env.HOME ?? "\u0000"), false);
});

test("record requires a clean commit containing the recorder", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    join(fixture.root, "src/cli/pilot-portfolio-evidence.ts"),
    "export const dirty = true;\n",
  );

  const result = runRecorder(fixture, ["record"]);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '{"code":"terminal_evidence.git_dirty"}\n');
  await assert.rejects(readdir(fixture.output), { code: "ENOENT" });
});

test("record rejects linked allowlisted evidence before execution", async (t) => {
  const fixture = await createFixture(t);
  const receiptPath = join(fixture.root, "docs/quality/pilot-evidence-check.stdout");
  await unlink(receiptPath);
  await writeFile(`${receiptPath}.target`, fixture.receipt);
  await symlink("pilot-evidence-check.stdout.target", receiptPath);
  runGit(fixture.root, ["add", "-A"]);
  runGit(fixture.root, [
    "-c",
    "user.name=Omar Ibrahim",
    "-c",
    "user.email=31526072+omar07ibrahim@users.noreply.github.com",
    "commit",
    "--quiet",
    "-m",
    "Link fixture receipt",
  ]);

  const result = runRecorder(fixture, ["record"]);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '{"code":"terminal_evidence.source_unsafe"}\n');
  await assert.rejects(readFile(fixture.invocations), { code: "ENOENT" });
});

test("record rejects a runtime mismatch without invoking npm", async (t) => {
  const fixture = await createFixture(t, { recordedNode: "0.0.0" });

  const result = runRecorder(fixture, ["record"]);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '{"code":"terminal_evidence.runtime_mismatch"}\n');
  await assert.rejects(readFile(fixture.invocations), { code: "ENOENT" });
});

test("record rejects stdout drift and publishes nothing", async (t) => {
  const fixture = await createFixture(t, {
    commandStdout: '{"official":false}\n',
  });

  const result = runRecorder(fixture, ["record"]);

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, '{"code":"terminal_evidence.capture_mismatch"}\n');
  await assert.rejects(readdir(fixture.output), { code: "ENOENT" });
});

test("record rejects child mutations after the exact stdout capture", async (t) => {
  const cases = [
    {
      name: "tracked source mutation",
      mutation: "tracked_source",
      code: "terminal_evidence.git_dirty",
    },
    {
      name: "HEAD mutation",
      mutation: "head",
      code: "terminal_evidence.source_changed",
    },
  ] as const;
  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const fixture = await createFixture(t, {
        commandMutation: item.mutation,
      });

      const result = runRecorder(fixture, ["record"]);

      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `${JSON.stringify({ code: item.code })}\n`);
      await assert.rejects(readdir(fixture.output), { code: "ENOENT" });
    });
  }
});

test("check rejects FIFO inputs and linked directory components without hanging", async (t) => {
  await t.test("FIFO output", async (t) => {
    const fixture = await createFixture(t);
    const recorded = runRecorder(fixture, ["record"]);
    assert.equal(recorded.status, 0, recorded.stderr);
    const transcript = join(fixture.output, "pilot-evidence-check.txt");
    await unlink(transcript);
    const fifo = spawnSync("/usr/bin/mkfifo", [transcript], {
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(fifo.error, undefined);
    assert.equal(fifo.status, 0, fifo.stderr);
    const invocations = await readFile(fixture.invocations, "utf8");

    const checked = runRecorder(fixture, ["check"]);

    assert.equal(checked.error, undefined);
    assert.notEqual(checked.status, 0);
    assert.equal(checked.stdout, "");
    assert.equal(checked.stderr, '{"code":"terminal_evidence.output_unsafe"}\n');
    assert.equal(await readFile(fixture.invocations, "utf8"), invocations);
  });

  await t.test("linked source parent", async (t) => {
    const fixture = await createFixture(t);
    const quality = join(fixture.root, "docs/quality");
    await rename(quality, `${quality}-real`);
    await symlink("quality-real", quality, "dir");

    const checked = runRecorder(fixture, ["check"]);

    assert.equal(checked.error, undefined);
    assert.notEqual(checked.status, 0);
    assert.equal(checked.stdout, "");
    assert.equal(checked.stderr, '{"code":"terminal_evidence.source_unsafe"}\n');
    await assert.rejects(readFile(fixture.invocations), { code: "ENOENT" });
  });

  await t.test("linked output directory", async (t) => {
    const fixture = await createFixture(t);
    const recorded = runRecorder(fixture, ["record"]);
    assert.equal(recorded.status, 0, recorded.stderr);
    const moved = `${fixture.output}-real`;
    await rename(fixture.output, moved);
    await symlink("terminal-evidence-real", fixture.output, "dir");
    const invocations = await readFile(fixture.invocations, "utf8");

    const checked = runRecorder(fixture, ["check"]);

    assert.equal(checked.error, undefined);
    assert.notEqual(checked.status, 0);
    assert.equal(checked.stdout, "");
    assert.equal(checked.stderr, '{"code":"terminal_evidence.output_unsafe"}\n');
    assert.equal(await readFile(fixture.invocations, "utf8"), invocations);
  });
});

test("check rejects tampering and never invokes the evidence command", async (t) => {
  const cases = [
    {
      name: "changed transcript",
      tamper: async (fixture: Fixture) => {
        await writeFile(join(fixture.output, "pilot-evidence-check.txt"), "changed\n");
      },
    },
    {
      name: "unknown output",
      tamper: async (fixture: Fixture) => {
        await writeFile(join(fixture.output, "unknown.txt"), "unknown\n");
      },
    },
    {
      name: "linked SVG",
      tamper: async (fixture: Fixture) => {
        const svg = join(fixture.output, "pilot-evidence-check.svg");
        await unlink(svg);
        await symlink("pilot-evidence-check.txt", svg);
      },
    },
    {
      name: "noncanonical manifest",
      tamper: async (fixture: Fixture) => {
        const path = join(fixture.output, "MANIFEST.json");
        const manifest = JSON.parse(await readFile(path, "utf8")) as unknown;
        await writeFile(path, JSON.stringify(manifest));
      },
    },
    {
      name: "forged manifest provenance",
      tamper: async (fixture: Fixture) => {
        const path = join(fixture.output, "MANIFEST.json");
        const manifest = JSON.parse(await readFile(path, "utf8")) as {
          source: { git_revision: string; git_tree: string };
        };
        manifest.source.git_revision = "a".repeat(40);
        manifest.source.git_tree = "b".repeat(40);
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    },
  ] as const;

  for (const item of cases) {
    await t.test(item.name, async (t) => {
      const fixture = await createFixture(t);
      const recorded = runRecorder(fixture, ["record"]);
      assert.equal(recorded.status, 0, recorded.stderr);
      const invocations = await readFile(fixture.invocations, "utf8");
      await item.tamper(fixture);

      const checked = runRecorder(fixture, ["check"]);

      assert.notEqual(checked.status, 0);
      assert.equal(checked.stdout, "");
      assert.match(checked.stderr, /^\{"code":"terminal_evidence\.[a-z_]+"\}\n$/u);
      assert.equal(await readFile(fixture.invocations, "utf8"), invocations);
      assert.equal(checked.stderr.includes(fixture.root), false);
    });
  }
});
