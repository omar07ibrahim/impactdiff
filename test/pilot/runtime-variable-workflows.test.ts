import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { BrowserContext, BrowserContextOptions, Page } from "@playwright/test";

import { canonicalJson, sha256Hex } from "../../src/contracts/canonical.js";
import type { PilotFixtureManifest } from "../../src/pilot/fixture/schema.js";
import {
  acquirePilotFixtureAuthoringEnvironment,
  launchPilotFixtureAuthoringEnvironment,
  type PilotFixtureAuthoringEnvironment,
} from "../../src/pilot/runtime/environment.js";
import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";
import { replayPilotFixtureAuthoringWorkflow } from "../../src/pilot/runtime/replay.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

type MutableFixtureManifest = DeepMutable<PilotFixtureManifest>;

async function readManifest(fixtureRoot: string): Promise<MutableFixtureManifest> {
  return JSON.parse(
    await readFile(join(fixtureRoot, "fixture.json"), "utf8"),
  ) as MutableFixtureManifest;
}

async function writeManifest(
  fixtureRoot: string,
  manifest: MutableFixtureManifest,
): Promise<void> {
  await writeFile(
    join(fixtureRoot, "fixture.json"),
    `${canonicalJson(manifest)}\n`,
    "utf8",
  );
}

async function rewriteManifest(
  fixtureRoot: string,
  transform: (manifest: MutableFixtureManifest) => void,
): Promise<void> {
  const manifest = await readManifest(fixtureRoot);
  transform(manifest);
  await writeManifest(fixtureRoot, manifest);
}

async function rewriteTextResource(
  fixtureRoot: string,
  resourcePath: string,
  transform: (source: string) => string,
): Promise<void> {
  const absolutePath = join(fixtureRoot, resourcePath);
  const source = await readFile(absolutePath, "utf8");
  const rewritten = transform(source);
  assert.notEqual(rewritten, source, `${resourcePath} rewrite must change its bytes`);
  await writeFile(absolutePath, rewritten, "utf8");

  await rewriteManifest(fixtureRoot, (manifest) => {
    const resource = manifest.resources.find(({ path }) => path === resourcePath);
    assert.ok(resource !== undefined, `manifest must declare ${resourcePath}`);
    const bytes = Buffer.from(rewritten, "utf8");
    resource.byte_length = bytes.byteLength;
    resource.sha256 = sha256Hex(bytes);
  });
}

async function withFixtureCopy(
  discriminator: string,
  action: (fixtureRoot: string) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), `impactdiff-pilot-variable-${discriminator}-`),
  );
  const fixtureRoot = join(temporaryRoot, "fixture");
  try {
    await cp(fixtureDirectory, fixtureRoot, { recursive: true });
    await action(fixtureRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function ownedContextCount(environment: PilotFixtureAuthoringEnvironment): number {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  try {
    return lease.browser.contexts().length;
  } finally {
    lease.release();
  }
}

async function replayPreparedFixture(
  fixtureRoot: string,
  expectedActions: number,
  expectedCheckpoints: readonly [number, number, number],
): Promise<void> {
  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
  let closed = false;
  try {
    assert.equal(ownedContextCount(environment), 0);
    const audit = await replayPilotFixtureAuthoringWorkflow(environment, "add_bundle");
    assert.equal(audit.actions_executed, expectedActions);
    assert.deepEqual(audit.checkpoint_after_action_ordinals, expectedCheckpoints);
    assert.match(audit.task_id, /^idtk1_[0-9a-f]{64}$/u);
    assert.ok(Object.isFrozen(audit));
    assert.ok(Object.isFrozen(audit.checkpoint_after_action_ordinals));
    assert.equal(ownedContextCount(environment), 0);
    await environment.close();
    closed = true;
  } finally {
    if (!closed) {
      try {
        await environment.close();
      } catch {
        // Preserve the replay failure after best-effort browser cleanup.
      }
    }
  }
}

async function expectPreparedFixtureFailure(
  fixtureRoot: string,
  expectedCode: string,
): Promise<void> {
  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
  const inspectionLease = acquirePilotFixtureAuthoringEnvironment(environment);
  const browser = inspectionLease.browser;
  inspectionLease.release();
  let closed = false;
  try {
    await assert.rejects(
      replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
      (error: unknown) => {
        assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
        assert.equal(error.code, expectedCode);
        return true;
      },
    );
    assert.equal(browser.contexts().length, 0);
    await assert.rejects(
      replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
      (error: unknown) => {
        assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
        assert.equal(error.code, "pilot_runtime.environment_poisoned");
        return true;
      },
    );
    await environment.close();
    closed = true;
  } finally {
    if (!closed) {
      try {
        await environment.close();
      } catch {
        // Preserve the expected-code assertion after best-effort cleanup.
      }
    }
  }
}

function errorTreeContainsCode(error: unknown, code: string): boolean {
  if (error instanceof PilotFixtureAuthoringRuntimeError && error.code === code) {
    return true;
  }
  if (error instanceof AggregateError) {
    return error.errors.some((nested) => errorTreeContainsCode(nested, code));
  }
  return error instanceof Error && errorTreeContainsCode(error.cause, code);
}

function isTerminalEvaluationPayload(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.mutationAudit !== null &&
    payload.mutationAudit !== undefined &&
    payload.pageGuard !== null &&
    payload.pageGuard !== undefined &&
    payload.setupExpectation !== undefined
  );
}

type TerminalMutationKind =
  | "animation"
  | "css"
  | "dispatch"
  | "dom"
  | "focus"
  | "scroll"
  | "state"
  | "validation";

function injectMutationAfterTerminalSeal(
  environment: PilotFixtureAuthoringEnvironment,
  mutation: TerminalMutationKind,
): {
  readonly contextCount: () => number;
  readonly restore: () => void;
  readonly wasInjected: () => boolean;
} {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  const browser = lease.browser;
  lease.release();
  const originalNewContextMethod = browser.newContext;
  const originalNewContext = originalNewContextMethod.bind(browser) as (
    options?: BrowserContextOptions,
  ) => Promise<BrowserContext>;
  let injected = false;
  const wrappedNewContext = async (
    options?: BrowserContextOptions,
  ): Promise<BrowserContext> => {
    const context = await originalNewContext(options);
    const originalNewPage = context.newPage.bind(context);
    Object.defineProperty(context, "newPage", {
      configurable: true,
      value: async (): Promise<Page> => {
        const page = await originalNewPage();
        const originalEvaluate = page.evaluate.bind(page) as unknown as (
          pageFunction: unknown,
          arg?: unknown,
        ) => Promise<unknown>;
        const wrappedEvaluate = async (
          pageFunction: unknown,
          arg?: unknown,
        ): Promise<unknown> => {
          const result = await originalEvaluate(pageFunction, arg);
          if (!injected && isTerminalEvaluationPayload(arg)) {
            injected = true;
            await originalEvaluate((kind: TerminalMutationKind) => {
              const setup = document.querySelector<HTMLSelectElement>(
                '[data-testid="bundle-weave"]',
              );
              const root = document.querySelector<HTMLElement>(
                '[data-testid="market-basket-root"]',
              );
              const peer = document.querySelector<HTMLElement>(
                '[data-testid="add-bundle-peer"]',
              );
              if (setup === null || root === null || peer === null) {
                throw new Error("terminal fixture ABI is absent");
              }
              try {
                switch (kind) {
                  case "animation":
                    root.animate([{ opacity: 1 }, { opacity: 0.5 }], 100);
                    break;
                  case "css":
                    document.styleSheets[0]?.insertRule(
                      ".terminal-write { color: red; }",
                    );
                    break;
                  case "dispatch":
                    setup.dispatchEvent(new Event("change", { bubbles: true }));
                    break;
                  case "dom":
                    root.setAttribute("data-bundle-state", "terminal-write");
                    break;
                  case "focus":
                    peer.focus();
                    break;
                  case "scroll":
                    root.scrollTop = 1;
                    break;
                  case "state":
                    setup.value = "dawn-pantry";
                    break;
                  case "validation":
                    setup.reportValidity();
                    break;
                }
              } catch {
                // The early native guard must reject this write and emit its sentinel.
              }
            }, mutation);
          }
          return result;
        };
        Object.defineProperty(page, "evaluate", {
          configurable: true,
          value: wrappedEvaluate,
        });
        return page;
      },
    });
    return context;
  };
  Object.defineProperty(browser, "newContext", {
    configurable: true,
    value: wrappedNewContext,
  });
  return Object.freeze({
    contextCount: () => browser.contexts().length,
    restore: () => {
      Object.defineProperty(browser, "newContext", {
        configurable: true,
        value: originalNewContextMethod,
      });
    },
    wasInjected: () => injected,
  });
}

test(
  "Pilot replay executes every declared select setup action",
  { concurrency: false },
  async () => {
    await withFixtureCopy("select-prefix", async (fixtureRoot) => {
      await rewriteManifest(fixtureRoot, (manifest) => {
        const workflow = manifest.workflows.find(
          ({ workflow_key }) => workflow_key === "add_bundle",
        );
        assert.ok(workflow !== undefined);
        const [focus, firstArrow, finalTab, pointer] = workflow.actions;
        assert.ok(
          focus?.intent === "focus" &&
            firstArrow?.intent === "press_key" &&
            finalTab?.intent === "press_key" &&
            pointer?.intent === "pointer_click",
        );
        workflow.actions = [
          focus,
          firstArrow,
          {
            intent: "press_key",
            pointer_source_point: null,
            target: null,
            value: { kind: "key", key: "ArrowUp" },
          },
          structuredClone(firstArrow),
          finalTab,
          pointer,
        ];
        workflow.checkpoints[1]!.after_action_ordinal = 4;
        workflow.checkpoints[2]!.after_action_ordinal = 5;
      });

      await replayPreparedFixture(fixtureRoot, 6, [-1, 4, 5]);
    });
  },
);

test(
  "Pilot replay binds text entry and a distinct select as one closed workflow",
  { concurrency: false },
  async () => {
    await withFixtureCopy("text-and-select", async (fixtureRoot) => {
      await rewriteTextResource(fixtureRoot, "index.html", (html) => {
        const lineMarker =
          '          <div class="field-line">\n            <label for="bundle-weave">';
        const selectMarker =
          '            <select id="bundle-weave" data-testid="bundle-weave">';
        assert.equal(html.split(lineMarker).length, 2);
        assert.equal(html.split(selectMarker).length, 2);
        return html
          .replace(
            lineMarker,
            '          <div class="field-line field-line--dual">\n            <label for="bundle-weave">',
          )
          .replace(
            selectMarker,
            [
              "            <input",
              '              id="bundle-email"',
              '              data-testid="bundle-email"',
              '              type="email"',
              '              aria-label="Bundle contact"',
              "            />",
              selectMarker,
            ].join("\n"),
          );
      });
      await rewriteTextResource(fixtureRoot, "styles.css", (styles) =>
        [
          styles,
          "",
          ".field-line--dual {",
          "  grid-template-columns: 72px 84px 108px;",
          "  gap: 6px;",
          "}",
          "",
          ".field-line--dual input {",
          "  width: 84px;",
          "  height: 32px;",
          "  padding: 0 6px;",
          "  border: 1px solid #847a91;",
          "  border-radius: 0;",
          "  font: inherit;",
          "  font-size: 10px;",
          "}",
          "",
          ".field-line--dual select {",
          "  width: 108px;",
          "  padding-left: 6px;",
          "  font-size: 10px;",
          "}",
          "",
          ".field-line--dual input:focus-visible {",
          "  outline: 3px solid #d38d00;",
          "  outline-offset: 2px;",
          "}",
        ].join("\n"),
      );
      await rewriteManifest(fixtureRoot, (manifest) => {
        const workflow = manifest.workflows.find(
          ({ workflow_key }) => workflow_key === "add_bundle",
        );
        assert.ok(workflow !== undefined);
        const [focus, firstArrow, finalTab, pointer] = workflow.actions;
        assert.ok(
          focus?.intent === "focus" &&
            firstArrow?.intent === "press_key" &&
            finalTab?.intent === "press_key" &&
            pointer?.intent === "pointer_click",
        );
        workflow.abi.focus_entry.value = "bundle-email";
        workflow.expectations.focus_entry_attribute = {
          name: "value",
          initial: "",
          selected: "author@example.invalid",
        };
        workflow.actions = [
          focus,
          {
            intent: "fill_text",
            pointer_source_point: null,
            target: "focus_entry",
            value: { kind: "text", text: "author@example.invalid" },
          },
          {
            intent: "press_key",
            pointer_source_point: null,
            target: null,
            value: { kind: "key", key: "Tab" },
          },
          firstArrow,
          finalTab,
          pointer,
        ];
        workflow.checkpoints[1]!.after_action_ordinal = 4;
        workflow.checkpoints[2]!.after_action_ordinal = 5;
      });

      await replayPreparedFixture(fixtureRoot, 6, [-1, 4, 5]);
    });
  },
);

test(
  "Pilot replay rejects a setup transition synthesized by blur",
  { concurrency: false },
  async () => {
    await withFixtureCopy("blur-forgery", async (fixtureRoot) => {
      await rewriteTextResource(fixtureRoot, "app.js", (application) => {
        const marker = "const bundleChoices = Object.freeze({";
        assert.equal(application.split(marker).length, 2);
        return application.replace(
          marker,
          [
            'bundleSelect.addEventListener("keydown", (event) => {',
            '  if (event.key === "ArrowDown") event.preventDefault();',
            "});",
            'bundleSelect.addEventListener("blur", () => {',
            '  bundleSelect.value = "harbor-picnic";',
            "});",
            "",
            marker,
          ].join("\n"),
        );
      });

      await expectPreparedFixtureFailure(fixtureRoot, "pilot_runtime.action_key");
    });
  },
);

test(
  "Pilot replay rejects a setup transition synthesized by focus",
  { concurrency: false },
  async () => {
    await withFixtureCopy("focus-forgery", async (fixtureRoot) => {
      await rewriteTextResource(fixtureRoot, "app.js", (application) => {
        const marker = "const bundleChoices = Object.freeze({";
        assert.equal(application.split(marker).length, 2);
        return application.replace(
          marker,
          [
            'bundleSelect.addEventListener("focus", () => {',
            '  bundleSelect.value = "harbor-picnic";',
            "}, { once: true });",
            "",
            marker,
          ].join("\n"),
        );
      });

      await expectPreparedFixtureFailure(fixtureRoot, "pilot_runtime.action_focus");
    });
  },
);

test(
  "Pilot replay rejects an author-owned select state accessor",
  { concurrency: false },
  async () => {
    await withFixtureCopy("own-control-accessor", async (fixtureRoot) => {
      await rewriteTextResource(fixtureRoot, "app.js", (application) => {
        const marker = "  bundleStatus.focus({ preventScroll: true });";
        assert.equal(application.split(marker).length, 2);
        return application.replace(
          marker,
          [
            marker,
            "  const guardedValue = Object.getOwnPropertyDescriptor(",
            "    HTMLSelectElement.prototype,",
            '    "value",',
            "  );",
            "  if (guardedValue?.set === undefined) {",
            '    throw new Error("guarded select value setter is unavailable");',
            "  }",
            '  Object.defineProperty(bundleSelect, "value", {',
            "    configurable: true,",
            "    get() {",
            '      return "harbor-picnic";',
            "    },",
            "    set(value) {",
            "      guardedValue.set.call(bundleSelect, value);",
            "    },",
            "  });",
          ].join("\n"),
        );
      });

      await expectPreparedFixtureFailure(
        fixtureRoot,
        "pilot_runtime.final_expectation",
      );
    });
  },
);

test(
  "Pilot terminal seal blocks every admitted late mutation path",
  { concurrency: false },
  async () => {
    const mutations: readonly TerminalMutationKind[] = [
      "animation",
      "css",
      "dispatch",
      "dom",
      "focus",
      "scroll",
      "state",
      "validation",
    ];
    for (const mutation of mutations) {
      const environment =
        await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
      const injection = injectMutationAfterTerminalSeal(environment, mutation);
      let closed = false;
      try {
        await assert.rejects(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          (error: unknown) => {
            assert.ok(error instanceof PilotFixtureAuthoringRuntimeError, mutation);
            assert.equal(error.code, "pilot_runtime.cleanup", mutation);
            assert.equal(
              errorTreeContainsCode(error, "pilot_runtime.session_tainted"),
              true,
              mutation,
            );
            return true;
          },
        );
        assert.equal(injection.wasInjected(), true, mutation);
        assert.equal(injection.contextCount(), 0, mutation);
        await assert.rejects(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          (error: unknown) => {
            assert.ok(error instanceof PilotFixtureAuthoringRuntimeError, mutation);
            assert.equal(error.code, "pilot_runtime.environment_poisoned", mutation);
            return true;
          },
        );
        injection.restore();
        await environment.close();
        closed = true;
      } finally {
        injection.restore();
        if (!closed) {
          try {
            await environment.close();
          } catch {
            // Preserve the terminal-boundary assertion after best-effort cleanup.
          }
        }
      }
    }
  },
);

test(
  "Pilot replay verifies a native radio checked-state transition",
  { concurrency: false },
  async () => {
    await withFixtureCopy("radio", async (fixtureRoot) => {
      await rewriteTextResource(fixtureRoot, "index.html", (html) => {
        const selectMarkup = [
          '            <select id="bundle-weave" data-testid="bundle-weave">',
          '              <option value="dawn-pantry" data-pieces="3">Dawn Pantry</option>',
          '              <option value="harbor-picnic" data-pieces="3">Harbor Picnic</option>',
          "            </select>",
        ].join("\n");
        assert.equal(html.split(selectMarkup).length, 2);
        return html.replace(
          selectMarkup,
          [
            "            <input",
            '              id="bundle-weave"',
            '              data-testid="bundle-weave"',
            '              type="radio"',
            '              value="harbor-picnic"',
            '              aria-label="Harbor Picnic bundle"',
            "            />",
          ].join("\n"),
        );
      });
      await rewriteTextResource(fixtureRoot, "styles.css", (styles) =>
        [
          styles,
          "",
          '.field-line input[type="radio"] {',
          "  width: 20px;",
          "  height: 20px;",
          "  margin: 0;",
          "  accent-color: #29185f;",
          "}",
        ].join("\n"),
      );
      await rewriteTextResource(fixtureRoot, "app.js", (application) => {
        const marker = "!(bundleSelect instanceof HTMLSelectElement)";
        assert.equal(application.split(marker).length, 2);
        return application.replace(
          marker,
          "!(bundleSelect instanceof HTMLInputElement)",
        );
      });
      await rewriteManifest(fixtureRoot, (manifest) => {
        const workflow = manifest.workflows.find(
          ({ workflow_key }) => workflow_key === "add_bundle",
        );
        assert.ok(workflow !== undefined);
        const [focus, , finalTab, pointer] = workflow.actions;
        assert.ok(
          focus?.intent === "focus" &&
            finalTab?.intent === "press_key" &&
            pointer?.intent === "pointer_click",
        );
        workflow.expectations.setup_attribute = {
          name: "checked",
          initial: false,
          selected: true,
        };
        workflow.actions = [
          focus,
          {
            intent: "press_key",
            pointer_source_point: null,
            target: null,
            value: { kind: "key", key: "Space" },
          },
          finalTab,
          pointer,
        ];
      });

      await replayPreparedFixture(fixtureRoot, 4, [-1, 2, 3]);
    });
  },
);

test(
  "Pilot replay rejects a checked transition on a radio group",
  { concurrency: false },
  async () => {
    await withFixtureCopy("radio-group", async (fixtureRoot) => {
      await rewriteTextResource(fixtureRoot, "index.html", (html) => {
        const selectMarkup = [
          '            <select id="bundle-weave" data-testid="bundle-weave">',
          '              <option value="dawn-pantry" data-pieces="3">Dawn Pantry</option>',
          '              <option value="harbor-picnic" data-pieces="3">Harbor Picnic</option>',
          "            </select>",
        ].join("\n");
        assert.equal(html.split(selectMarkup).length, 2);
        return html.replace(
          selectMarkup,
          [
            "            <input",
            '              id="bundle-weave"',
            '              data-testid="bundle-weave"',
            '              type="radio"',
            '              name="bundle-choice"',
            '              value="harbor-picnic"',
            '              aria-label="Harbor Picnic bundle"',
            "            />",
            "            <input",
            '              type="radio"',
            '              name="bundle-choice"',
            '              value="dawn-pantry"',
            '              aria-label="Dawn Pantry bundle"',
            "            />",
          ].join("\n"),
        );
      });
      await rewriteTextResource(fixtureRoot, "app.js", (application) => {
        const marker = "!(bundleSelect instanceof HTMLSelectElement)";
        assert.equal(application.split(marker).length, 2);
        return application.replace(
          marker,
          "!(bundleSelect instanceof HTMLInputElement)",
        );
      });
      await rewriteManifest(fixtureRoot, (manifest) => {
        const workflow = manifest.workflows.find(
          ({ workflow_key }) => workflow_key === "add_bundle",
        );
        assert.ok(workflow !== undefined);
        const [focus, , finalTab, pointer] = workflow.actions;
        assert.ok(
          focus?.intent === "focus" &&
            finalTab?.intent === "press_key" &&
            pointer?.intent === "pointer_click",
        );
        workflow.expectations.setup_attribute = {
          name: "checked",
          initial: false,
          selected: true,
        };
        workflow.actions = [
          focus,
          {
            intent: "press_key",
            pointer_source_point: null,
            target: null,
            value: { kind: "key", key: "Space" },
          },
          finalTab,
          pointer,
        ];
      });

      await expectPreparedFixtureFailure(fixtureRoot, "pilot_runtime.workflow_state");
    });
  },
);
