import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { canonicalJson, sha256Hex } from "../../src/contracts/canonical.js";
import { pilotMutationLocalPredicateKeys } from "../../src/mutations/catalog/schema.js";
import { launchPilotFixtureAuthoringEnvironment } from "../../src/pilot/runtime/environment.js";
import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";
import { measurePilotFixtureAuthoringWorkflowPredicates } from "../../src/pilot/runtime/predicate-authoring.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");

interface MutableFixtureManifest {
  resources: {
    path: string;
    sha256: string;
    byte_length: number;
  }[];
}

async function rewriteFixtureTextResource(
  fixtureRoot: string,
  resourcePath: string,
  transform: (source: string) => string,
): Promise<void> {
  const absoluteResourcePath = join(fixtureRoot, resourcePath);
  const manifestPath = join(fixtureRoot, "fixture.json");
  const source = await readFile(absoluteResourcePath, "utf8");
  const rewritten = transform(source);
  assert.notEqual(rewritten, source, `${resourcePath} rewrite must change its bytes`);
  await writeFile(absoluteResourcePath, rewritten, "utf8");

  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as MutableFixtureManifest;
  const resource = manifest.resources.find(({ path }) => path === resourcePath);
  assert.ok(resource !== undefined, `manifest must declare ${resourcePath}`);
  const bytes = Buffer.from(rewritten, "utf8");
  resource.byte_length = bytes.byteLength;
  resource.sha256 = sha256Hex(bytes);
  await writeFile(manifestPath, `${canonicalJson(manifest)}\n`, "utf8");
}

async function withFixtureCopy(
  discriminator: string,
  action: (fixtureRoot: string) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), `impactdiff-pilot-predicates-${discriminator}-`),
  );
  const fixtureRoot = join(temporaryRoot, "fixture");
  try {
    await cp(fixtureDirectory, fixtureRoot, { recursive: true });
    await action(fixtureRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function expectedVector(failingOrdinal: 1 | 5 | 6 | 7 | null) {
  return pilotMutationLocalPredicateKeys.map((predicate, ordinal) => ({
    predicate,
    state: ordinal === failingOrdinal ? "fail" : "pass",
  }));
}

async function assertMeasuredVector(
  fixtureRoot: string,
  failingOrdinal: 1 | 5 | 6 | 7 | null,
): Promise<void> {
  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
  let closed = false;
  try {
    const result = await measurePilotFixtureAuthoringWorkflowPredicates(
      environment,
      "add_bundle",
    );
    assert.deepEqual(result.source_predicates, expectedVector(failingOrdinal));
    await environment.close();
    closed = true;
  } finally {
    if (!closed) {
      try {
        await environment.close();
      } catch {
        // Preserve the predicate assertion after best-effort browser cleanup.
      }
    }
  }
}

async function assertMeasurementRejected(
  fixtureRoot: string,
  expectedCode: string,
): Promise<void> {
  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
  try {
    await assert.rejects(
      measurePilotFixtureAuthoringWorkflowPredicates(environment, "add_bundle"),
      (error: unknown) => {
        assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
        assert.equal(error.code, expectedCode);
        return true;
      },
    );
  } finally {
    try {
      await environment.close();
    } catch {
      // Preserve the closed-runtime assertion after best-effort browser cleanup.
    }
  }
}

test(
  "Pilot predicate authoring measures every source workflow in fresh contexts",
  { concurrency: false },
  async () => {
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    let closed = false;
    try {
      for (const workflowKey of ["add_bundle", "choose_pickup"]) {
        for (let replicate = 0; replicate < 2; replicate += 1) {
          const result = await measurePilotFixtureAuthoringWorkflowPredicates(
            environment,
            workflowKey,
          );
          assert.deepEqual(Reflect.ownKeys(result).sort(), [
            "audit",
            "kind",
            "official",
            "source_predicates",
          ]);
          assert.equal(
            result.kind,
            "pilot_fixture_workflow_predicate_authoring_result",
          );
          assert.equal(result.official, false);
          assert.equal(result.audit.workflow_key, workflowKey);
          assert.equal(Object.isFrozen(result), true);
          assert.equal(Object.isFrozen(result.source_predicates), true);
          assert.deepEqual(result.source_predicates, expectedVector(null));
          for (const observation of result.source_predicates) {
            assert.equal(Object.isFrozen(observation), true);
          }
        }
      }
      await environment.close();
      closed = true;
    } finally {
      if (!closed) {
        try {
          await environment.close();
        } catch {
          // Preserve the predicate assertion after best-effort browser cleanup.
        }
      }
    }
  },
);

test(
  "Pilot predicates derive accessibility, containment, and contrast from Chromium",
  { concurrency: false },
  async (t) => {
    await t.test("corner-only primary hit-test occlusion", async () => {
      await withFixtureCopy("corner-occlusion", async (fixtureRoot) => {
        await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
          const marker = [
            "              </button>",
            "            </div>",
            '            <button class="task-button" type="button" data-testid="add-bundle-peer">',
          ].join("\n");
          assert.equal(html.split(marker).length, 2);
          return html.replace(
            marker,
            [
              "              </button>",
              "            </div>",
              '            <div class="predicate-corner-occluder" aria-hidden="true"></div>',
              '            <button class="task-button" type="button" data-testid="add-bundle-peer">',
            ].join("\n"),
          );
        });
        await rewriteFixtureTextResource(fixtureRoot, "styles.css", (css) =>
          [
            css,
            "",
            ".predicate-corner-occluder {",
            "  position: absolute;",
            "  top: 0;",
            "  left: 0;",
            "  z-index: 2;",
            "  width: 12px;",
            "  height: 12px;",
            "  background: transparent;",
            "  pointer-events: auto;",
            "}",
          ].join("\n"),
        );
        await assertMeasuredVector(fixtureRoot, 1);
      });
    });

    await t.test("empty browser-computed primary name", async () => {
      await withFixtureCopy("accessible-name", async (fixtureRoot) => {
        await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
          const marker = "                Add bundle\n";
          assert.equal(html.split(marker).length, 2);
          return html.replace(marker, "");
        });
        await assertMeasuredVector(fixtureRoot, 5);
      });
    });

    await t.test("overflowing fixed content-pressure box", async () => {
      await withFixtureCopy("content-pressure", async (fixtureRoot) => {
        await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
          const marker = "Weave note: three compact pieces travel together.";
          assert.equal(html.split(marker).length, 2);
          return html.replace(marker, "P".repeat(192));
        });
        await assertMeasuredVector(fixtureRoot, 6);
      });
    });

    await t.test("opaque low-contrast primary palette", async () => {
      await withFixtureCopy("primary-contrast", async (fixtureRoot) => {
        await rewriteFixtureTextResource(fixtureRoot, "styles.css", (css) => {
          const marker =
            "  color: #fff4d6;\n  background: #29185f;\n  font-size: 11px;";
          assert.equal(css.split(marker).length, 2);
          return css.replace(
            marker,
            "  color: #777e88;\n  background: #808791;\n  font-size: 11px;",
          );
        });
        await assertMeasuredVector(fixtureRoot, 7);
      });
    });

    await t.test("filtered primary is not admitted as a visible source", async () => {
      await withFixtureCopy("filtered-primary", async (fixtureRoot) => {
        await rewriteFixtureTextResource(fixtureRoot, "styles.css", (css) =>
          [css, "", '[data-testid="add-bundle"] {', "  filter: opacity(0);", "}"].join(
            "\n",
          ),
        );
        await assertMeasurementRejected(fixtureRoot, "pilot_runtime.pointer_geometry");
      });
    });

    await t.test(
      "predicate vector is withheld when the final oracle fails",
      async () => {
        await withFixtureCopy("failed-final-oracle", async (fixtureRoot) => {
          await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
            const marker = "root.dataset.bundleState = `${bundleSelect.value}-added`;";
            assert.equal(application.split(marker).length, 2);
            return application.replace(
              marker,
              "root.dataset.bundleState = `${bundleSelect.value}-not-added`;",
            );
          });
          await assertMeasurementRejected(
            fixtureRoot,
            "pilot_runtime.final_expectation",
          );
        });
      },
    );

    await t.test(
      "fixture-side intrinsic replacements cannot forge evidence",
      async () => {
        await withFixtureCopy("intrinsic-replacements", async (fixtureRoot) => {
          await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
            const marker =
              "void Promise.all([document.fonts.ready, wovenTagReady]).then(() => {";
            assert.equal(application.split(marker).length, 2);
            const replacements = [
              "Document.prototype.elementFromPoint = () => document.body;",
              "Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);",
              "window.getComputedStyle = () => ({ getPropertyValue: () => 'forged' });",
              "Object.defineProperty(window, 'HTMLButtonElement', {",
              "  configurable: true,",
              "  value: class ForgedButtonElement {},",
              "});",
              "",
            ].join("\n");
            return application.replace(marker, `${replacements}${marker}`);
          });
          await assertMeasuredVector(fixtureRoot, null);
        });
      },
    );
  },
);
