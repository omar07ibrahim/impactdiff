import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { BrowserContext, Request } from "@playwright/test";

import { canonicalJson, sha256Hex } from "../../src/contracts/canonical.js";
import {
  acquirePilotFixtureAuthoringEnvironment,
  launchPilotFixtureAuthoringEnvironment,
  type PilotFixtureAuthoringEnvironment,
} from "../../src/pilot/runtime/environment.js";
import { PilotFixtureAuthoringRuntimeError } from "../../src/pilot/runtime/errors.js";
import { replayPilotFixtureAuthoringWorkflow } from "../../src/pilot/runtime/replay.js";

const fixtureDirectory = resolve("fixtures/pilot-market-basket-v1");

const exactAuditKeys = Object.freeze(
  [
    "actions_executed",
    "blocked_external_requests",
    "checkpoint_after_action_ordinals",
    "environment_id",
    "fixture_key",
    "fixture_revision",
    "kind",
    "official",
    "resource_requests",
    "source_state_id",
    "task_id",
    "unexpected_fixture_requests",
    "workflow_key",
  ].sort(),
);

const forbiddenSurfaceNames = Object.freeze([
  "outcome",
  "pass",
  "success",
  "label",
  "result",
  "capture",
  "operator",
  "browser",
  "page",
  "context",
  "session",
]);

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
    join(tmpdir(), `impactdiff-pilot-runtime-${discriminator}-`),
  );
  const fixtureRoot = join(temporaryRoot, "fixture");
  try {
    await cp(fixtureDirectory, fixtureRoot, { recursive: true });
    await action(fixtureRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function expectRuntimeError(
  action: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
    assert.equal(error.code, code);
    return true;
  });
}

function inspectOwnedBrowser(environment: PilotFixtureAuthoringEnvironment) {
  const lease = acquirePilotFixtureAuthoringEnvironment(environment);
  try {
    return Object.freeze({
      browser: lease.browser,
      contextCount: lease.browser.contexts().length,
    });
  } finally {
    lease.release();
  }
}

function stringOwnKeys(value: object, path: string): string[] {
  return Reflect.ownKeys(value).map((key) => {
    assert.equal(typeof key, "string", `${path} must not expose symbol capabilities`);
    return key as string;
  });
}

function assertDeeplyFrozenSafeJson(value: unknown, path = "$root"): void {
  if (value === null || typeof value !== "object") {
    assert.ok(
      value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
      `${path} must contain only JSON data`,
    );
    return;
  }

  assert.ok(Object.isFrozen(value), `${path} must be frozen`);
  assert.equal(
    Object.getPrototypeOf(value),
    Array.isArray(value) ? Array.prototype : Object.prototype,
    `${path} must use its exact plain JSON prototype`,
  );

  for (const key of stringOwnKeys(value, path)) {
    if (Array.isArray(value) && key === "length") continue;
    const normalizedKey = key.toLowerCase();
    for (const forbidden of forbiddenSurfaceNames) {
      assert.equal(
        normalizedKey.includes(forbidden),
        false,
        `${path}.${key} exposes forbidden ${forbidden} authority`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(descriptor !== undefined && "value" in descriptor);
    assertDeeplyFrozenSafeJson(descriptor.value, `${path}.${key}`);
  }
}

async function addUnexpectedReadinessKey(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const marker = "      pendingRequests: 0,\n";
    assert.equal(
      application.split(marker).length,
      2,
      "readiness marker must be unique",
    );
    return application.replace(marker, `${marker}      unexpected: true,\n`);
  });
}

async function addCredentialBearingFixtureRequest(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const marker =
      "void Promise.all([document.fonts.ready, wovenTagReady]).then(() => {";
    assert.equal(
      application.split(marker).length,
      2,
      "readiness promise marker must be unique",
    );
    return application.replace(
      marker,
      [
        'document.cookie = "pilot_credential=forbidden; SameSite=Strict";',
        "const credentialProbe = new Image();",
        'credentialProbe.addEventListener("error", () => credentialProbe.remove(), { once: true });',
        'credentialProbe.src = "/catalog/items.json";',
        "document.body.append(credentialProbe);",
        "",
        marker,
      ].join("\n"),
    );
  });
}

async function addStructuredSuccessContent(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const marker =
      "  bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;";
    assert.equal(
      application.split(marker).length,
      2,
      "bundle success marker must be unique",
    );
    return application.replace(
      marker,
      "  bundleStatus.innerHTML = `<span>${choice.label} bundle added, ${choice.pieces} pieces.</span>`;",
    );
  });
}

async function addDocumentLevelComment(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const marker =
      "  bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;";
    assert.equal(
      application.split(marker).length,
      2,
      "bundle success marker must be unique",
    );
    return application.replace(
      marker,
      `${marker}\n  document.append(document.createComment("undeclared document child"));`,
    );
  });
}

async function addOtherWorkflowSelectMutation(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const marker =
      "  bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;";
    assert.equal(
      application.split(marker).length,
      2,
      "bundle success marker must be unique",
    );
    return application.replace(
      marker,
      `${marker}\n  pickupSelect.value = "river-steps";`,
    );
  });
}

async function addDuplicateSetupOption(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
    const marker =
      '              <option value="harbor-picnic" data-pieces="3">Harbor Picnic</option>';
    assert.equal(html.split(marker).length, 2, "bundle option marker must be unique");
    return html.replace(
      marker,
      [
        marker,
        '              <option value="harbor-picnic" data-pieces="3">Harbor Picnic duplicate</option>',
      ].join("\n"),
    );
  });
}

async function addPostClickScrollMutation(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
    const marker = "  </body>";
    assert.equal(html.split(marker).length, 2, "body marker must be unique");
    return html.replace(
      marker,
      [
        '    <div class="runtime-scroll-probe" data-runtime-scroll-probe aria-hidden="true">',
        "      <span></span>",
        "    </div>",
        marker,
      ].join("\n"),
    );
  });
  await rewriteFixtureTextResource(fixtureRoot, "styles.css", (styles) =>
    [
      styles,
      "",
      ".runtime-scroll-probe {",
      "  position: fixed;",
      "  top: 0;",
      "  left: 0;",
      "  width: 1px;",
      "  height: 1px;",
      "  overflow: auto;",
      "  opacity: 0;",
      "  pointer-events: none;",
      "}",
      "",
      ".runtime-scroll-probe > span {",
      "  display: block;",
      "  width: 1px;",
      "  height: 2px;",
      "}",
    ].join("\n"),
  );
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const declarationMarker =
      "const pickupStatus = document.querySelector('[data-testid=\"use-pickup-status\"]');";
    const validationMarker = "  !(pickupStatus instanceof HTMLElement)";
    const actionMarker =
      "  bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;";
    assert.equal(application.split(declarationMarker).length, 2);
    assert.equal(application.split(validationMarker).length, 2);
    assert.equal(application.split(actionMarker).length, 2);
    return application
      .replace(
        declarationMarker,
        `${declarationMarker}\nconst runtimeScrollProbe = document.querySelector("[data-runtime-scroll-probe]");`,
      )
      .replace(
        validationMarker,
        `${validationMarker} ||\n  !(runtimeScrollProbe instanceof HTMLElement)`,
      )
      .replace(actionMarker, `${actionMarker}\n  runtimeScrollProbe.scrollTop = 1;`);
  });
}

async function addClosedDeclarativeShadowRoot(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
    const marker = "  </body>";
    assert.equal(html.split(marker).length, 2, "body marker must be unique");
    return html.replace(
      marker,
      [
        '    <div data-runtime-shadow-host aria-hidden="true">',
        '      <template shadowrootmode="closed">',
        "        <span>closed author shadow content</span>",
        "      </template>",
        "    </div>",
        marker,
      ].join("\n"),
    );
  });
}

async function addOversizedClosedDeclarativeShadowRoot(
  fixtureRoot: string,
): Promise<void> {
  const shadowChildren = Array.from(
    { length: 5_000 },
    (_, index) => `<span>${index}</span>`,
  ).join("");
  await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
    const marker = "  </body>";
    assert.equal(html.split(marker).length, 2, "body marker must be unique");
    return html.replace(
      marker,
      [
        '<div data-runtime-oversized-shadow-host aria-hidden="true">',
        `<template shadowrootmode="closed">${shadowChildren}</template>`,
        "</div>",
        marker,
      ].join(""),
    );
  });
}

async function addPopoverMutation(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
    const marker = "  </body>";
    assert.equal(html.split(marker).length, 2, "body marker must be unique");
    return html.replace(
      marker,
      [
        '    <div id="runtime-popover" popover="manual">Undeclared overlay</div>',
        marker,
      ].join("\n"),
    );
  });
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const declarationMarker =
      "const pickupStatus = document.querySelector('[data-testid=\"use-pickup-status\"]');";
    const validationMarker = "  !(pickupStatus instanceof HTMLElement)";
    const actionMarker =
      "  bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;";
    assert.equal(application.split(declarationMarker).length, 2);
    assert.equal(application.split(validationMarker).length, 2);
    assert.equal(application.split(actionMarker).length, 2);
    return application
      .replace(
        declarationMarker,
        `${declarationMarker}\nconst runtimePopover = document.querySelector("#runtime-popover");`,
      )
      .replace(
        validationMarker,
        `${validationMarker} ||\n  !(runtimePopover instanceof HTMLElement)`,
      )
      .replace(actionMarker, `${actionMarker}\n  runtimePopover.showPopover();`);
  });
}

async function addFileChooserAction(fixtureRoot: string): Promise<void> {
  await rewriteFixtureTextResource(fixtureRoot, "index.html", (html) => {
    const marker = "  </body>";
    assert.equal(html.split(marker).length, 2, "body marker must be unique");
    return html.replace(
      marker,
      ['    <input id="runtime-file-input" type="file" hidden />', marker].join("\n"),
    );
  });
  await rewriteFixtureTextResource(fixtureRoot, "app.js", (application) => {
    const declarationMarker =
      "const pickupStatus = document.querySelector('[data-testid=\"use-pickup-status\"]');";
    const validationMarker = "  !(pickupStatus instanceof HTMLElement)";
    const actionMarker =
      "  bundleStatus.textContent = `${choice.label} bundle added, ${choice.pieces} pieces.`;";
    assert.equal(application.split(declarationMarker).length, 2);
    assert.equal(application.split(validationMarker).length, 2);
    assert.equal(application.split(actionMarker).length, 2);
    return application
      .replace(
        declarationMarker,
        `${declarationMarker}\nconst runtimeFileInput = document.querySelector("#runtime-file-input");`,
      )
      .replace(
        validationMarker,
        `${validationMarker} ||\n  !(runtimeFileInput instanceof HTMLInputElement)`,
      )
      .replace(actionMarker, `${actionMarker}\n  runtimeFileInput.click();`);
  });
}

async function expectFixtureFailureAndPoisoned(
  fixtureRoot: string,
  expectedCode: string,
): Promise<void> {
  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
  let closed = false;
  try {
    await expectRuntimeError(
      replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
      expectedCode,
    );
    await expectRuntimeError(
      replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
      "pilot_runtime.environment_poisoned",
    );
    await environment.close();
    closed = true;
  } finally {
    if (!closed) {
      try {
        await environment.close();
      } catch {
        // Preserve the first assertion or replay failure after best-effort cleanup.
      }
    }
  }
}

async function expectInjectedTeardownEvent(
  prepare: (context: BrowserContext) => () => boolean,
): Promise<void> {
  const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
  const { browser } = inspectOwnedBrowser(environment);
  const originalDescriptor = Object.getOwnPropertyDescriptor(browser, "newContext");
  const originalNewContext = browser.newContext.bind(browser);
  let eventEmitted = false;
  let assertionsComplete = false;
  let closed = false;
  Object.defineProperty(browser, "newContext", {
    configurable: true,
    value: async (...args: Parameters<typeof browser.newContext>) => {
      const context = await originalNewContext(...args);
      const emit = prepare(context);
      const originalClose = context.close.bind(context);
      Object.defineProperty(context, "close", {
        configurable: true,
        value: async (...closeArgs: Parameters<typeof context.close>) => {
          eventEmitted = emit();
          return originalClose(...closeArgs);
        },
      });
      return context;
    },
  });

  try {
    await expectRuntimeError(
      replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
      "pilot_runtime.cleanup",
    );
    assert.equal(eventEmitted, true);
    assert.equal(browser.contexts().length, 0);
    await expectRuntimeError(
      replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
      "pilot_runtime.environment_poisoned",
    );
    assertionsComplete = true;
  } finally {
    if (originalDescriptor === undefined) {
      Reflect.deleteProperty(browser, "newContext");
    } else {
      Object.defineProperty(browser, "newContext", originalDescriptor);
    }
    if (!closed) {
      if (assertionsComplete) {
        await environment.close();
        closed = true;
        assert.equal(browser.contexts().length, 0);
      } else {
        try {
          await environment.close();
          closed = true;
        } catch {
          // Preserve the first assertion or replay failure after best-effort cleanup.
        }
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

test(
  "Pilot replay rejects unknown workflows before context creation and serves its launch snapshot",
  { concurrency: false },
  async () => {
    await withFixtureCopy("snapshot", async (fixtureRoot) => {
      const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
      let closed = false;
      try {
        const beforeUnknown = inspectOwnedBrowser(environment);
        assert.equal(beforeUnknown.contextCount, 0);

        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "not_declared"),
          "pilot_runtime.workflow",
        );

        const afterUnknown = inspectOwnedBrowser(environment);
        assert.equal(afterUnknown.browser, beforeUnknown.browser);
        assert.equal(afterUnknown.contextCount, 0);

        await rm(join(fixtureRoot, "app.js"));
        const audit = await replayPilotFixtureAuthoringWorkflow(
          environment,
          "add_bundle",
        );

        const afterReplay = inspectOwnedBrowser(environment);
        assert.equal(afterReplay.browser, beforeUnknown.browser);
        assert.equal(afterReplay.contextCount, 0);
        assert.deepEqual(
          stringOwnKeys(audit, "$add_bundle_audit").sort(),
          exactAuditKeys,
        );
        assert.equal(audit.kind, "pilot_fixture_workflow_authoring_audit");
        assert.equal(audit.official, false);
        assert.equal(audit.fixture_key, "pilot-market-basket-v1");
        assert.equal(audit.fixture_revision, "pilot-market-basket-v1.0.0-authoring.2");
        assert.equal(audit.workflow_key, "add_bundle");
        assert.equal(
          audit.task_id,
          "idtk1_79c6534b21c46bfabcb881f01a2a51bf72ccaf3d3d4a1215deef3285f8e4453f",
        );
        assert.equal(audit.actions_executed, 4);
        assert.deepEqual(audit.checkpoint_after_action_ordinals, [-1, 2, 3]);
        assert.deepEqual(audit.blocked_external_requests, []);
        assert.deepEqual(audit.unexpected_fixture_requests, []);
        assert.deepEqual(audit.resource_requests, [
          { path: "app.js", request_count: 1 },
          { path: "art/woven-tag.svg", request_count: 1 },
          {
            path: "fonts/noto-sans-latin-standard-normal.woff2",
            request_count: 1,
          },
          { path: "index.html", request_count: 1 },
          { path: "styles.css", request_count: 1 },
        ]);
        assert.deepEqual(
          audit.resource_requests.find(({ path }) => path === "app.js"),
          { path: "app.js", request_count: 1 },
        );
        for (const request of audit.resource_requests) {
          assert.deepEqual(stringOwnKeys(request, "$resource_request").sort(), [
            "path",
            "request_count",
          ]);
          assert.ok(Number.isSafeInteger(request.request_count));
          assert.ok(request.request_count > 0);
        }
        assertDeeplyFrozenSafeJson(audit);

        const pickupAudit = await replayPilotFixtureAuthoringWorkflow(
          environment,
          "choose_pickup",
        );
        const afterPickupReplay = inspectOwnedBrowser(environment);
        assert.equal(afterPickupReplay.browser, beforeUnknown.browser);
        assert.equal(afterPickupReplay.contextCount, 0);
        assert.deepEqual(
          stringOwnKeys(pickupAudit, "$choose_pickup_audit").sort(),
          exactAuditKeys,
        );
        assert.equal(pickupAudit.kind, "pilot_fixture_workflow_authoring_audit");
        assert.equal(pickupAudit.official, false);
        assert.equal(pickupAudit.fixture_key, audit.fixture_key);
        assert.equal(pickupAudit.fixture_revision, audit.fixture_revision);
        assert.equal(pickupAudit.source_state_id, audit.source_state_id);
        assert.equal(pickupAudit.environment_id, audit.environment_id);
        assert.equal(pickupAudit.workflow_key, "choose_pickup");
        assert.equal(
          pickupAudit.task_id,
          "idtk1_ab2de7b7bfe7df885fbb0b8f7f4d6fe82828b2da578e14daace7cf146d23e8f9",
        );
        assert.equal(pickupAudit.actions_executed, 4);
        assert.deepEqual(pickupAudit.checkpoint_after_action_ordinals, [-1, 2, 3]);
        assert.deepEqual(pickupAudit.resource_requests, audit.resource_requests);
        assert.deepEqual(pickupAudit.blocked_external_requests, []);
        assert.deepEqual(pickupAudit.unexpected_fixture_requests, []);
        assertDeeplyFrozenSafeJson(pickupAudit);

        await environment.close();
        closed = true;
      } finally {
        if (!closed) {
          try {
            await environment.close();
          } catch {
            // Preserve the first assertion or replay failure after best-effort cleanup.
          }
        }
      }
    });
  },
);

test(
  "Pilot replay rejects credential-bearing same-origin fixture requests",
  { concurrency: false },
  async () => {
    await withFixtureCopy("credentials", async (fixtureRoot) => {
      await addCredentialBearingFixtureRequest(fixtureRoot);
      const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
      let closed = false;
      try {
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.unexpected_fixture_request",
        );
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.environment_poisoned",
        );
        await environment.close();
        closed = true;
      } finally {
        if (!closed) {
          try {
            await environment.close();
          } catch {
            // Preserve the first assertion or replay failure after best-effort cleanup.
          }
        }
      }
    });
  },
);

test(
  "Pilot replay revokes success when a browser event arrives during teardown",
  { concurrency: false },
  async () => {
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    const { browser } = inspectOwnedBrowser(environment);
    const originalDescriptor = Object.getOwnPropertyDescriptor(browser, "newContext");
    const originalNewContext = browser.newContext.bind(browser);
    let closed = false;
    Object.defineProperty(browser, "newContext", {
      configurable: true,
      value: async (...args: Parameters<typeof browser.newContext>) => {
        const context = await originalNewContext(...args);
        const originalClose = context.close.bind(context);
        Object.defineProperty(context, "close", {
          configurable: true,
          value: async (...closeArgs: Parameters<typeof context.close>) => {
            const emitter = context as unknown as {
              emit: (event: string, value: unknown) => boolean;
            };
            emitter.emit("weberror", {
              error: () => new Error("late teardown browser error"),
            });
            return originalClose(...closeArgs);
          },
        });
        return context;
      },
    });

    try {
      await expectRuntimeError(
        replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
        "pilot_runtime.cleanup",
      );
      assert.equal(browser.contexts().length, 0);
      await expectRuntimeError(
        replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
        "pilot_runtime.environment_poisoned",
      );
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(browser, "newContext");
      } else {
        Object.defineProperty(browser, "newContext", originalDescriptor);
      }
      if (!closed) {
        try {
          await environment.close();
          closed = true;
        } catch {
          // Preserve the first assertion or replay failure after best-effort cleanup.
        }
      }
    }
  },
);

test(
  "Pilot replay detects an unsolicited page close after the terminal seal",
  { concurrency: false },
  async () => {
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    const { browser } = inspectOwnedBrowser(environment);
    const originalDescriptor = Object.getOwnPropertyDescriptor(browser, "newContext");
    const originalNewContext = browser.newContext.bind(browser);
    let closed = false;
    Object.defineProperty(browser, "newContext", {
      configurable: true,
      value: async (...args: Parameters<typeof browser.newContext>) => {
        const context = await originalNewContext(...args);
        const originalNewPage = context.newPage.bind(context);
        Object.defineProperty(context, "newPage", {
          configurable: true,
          value: async (...pageArgs: Parameters<typeof context.newPage>) => {
            const page = await originalNewPage(...pageArgs);
            const originalEvaluate = page.evaluate.bind(page) as unknown as (
              pageFunction: unknown,
              arg?: unknown,
            ) => Promise<unknown>;
            let injected = false;
            Object.defineProperty(page, "evaluate", {
              configurable: true,
              value: async (pageFunction: unknown, arg?: unknown) => {
                const value = await originalEvaluate(pageFunction, arg);
                if (!injected && arg !== null && typeof arg === "object") {
                  const payload = arg as Record<string, unknown>;
                  if (
                    payload.mutationAudit !== null &&
                    payload.mutationAudit !== undefined &&
                    payload.pageGuard !== null &&
                    payload.pageGuard !== undefined
                  ) {
                    injected = true;
                    await page.close();
                  }
                }
                return value;
              },
            });
            return page;
          },
        });
        return context;
      },
    });

    try {
      await assert.rejects(
        replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
        (error: unknown) => {
          assert.ok(error instanceof PilotFixtureAuthoringRuntimeError);
          assert.equal(error.code, "pilot_runtime.cleanup");
          assert.ok(errorTreeContainsCode(error, "pilot_runtime.session_tainted"));
          return true;
        },
      );
      assert.equal(browser.contexts().length, 0);
      await expectRuntimeError(
        replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
        "pilot_runtime.environment_poisoned",
      );
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(browser, "newContext");
      } else {
        Object.defineProperty(browser, "newContext", originalDescriptor);
      }
      if (!closed) {
        try {
          await environment.close();
          closed = true;
        } catch {
          // Preserve the first assertion or replay failure after best-effort cleanup.
        }
      }
    }
  },
);

test(
  "Pilot replay rejects success text hidden inside undeclared element structure",
  { concurrency: false },
  async () => {
    await withFixtureCopy("structured-success", async (fixtureRoot) => {
      await addStructuredSuccessContent(fixtureRoot);
      const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
      let closed = false;
      try {
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.document_integrity",
        );
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.environment_poisoned",
        );
        await environment.close();
        closed = true;
      } finally {
        if (!closed) {
          try {
            await environment.close();
          } catch {
            // Preserve the first assertion or replay failure after best-effort cleanup.
          }
        }
      }
    });
  },
);

test(
  "Pilot replay rejects undeclared nodes beside the retained document element",
  { concurrency: false },
  async () => {
    await withFixtureCopy("document-child", async (fixtureRoot) => {
      await addDocumentLevelComment(fixtureRoot);
      const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
      let closed = false;
      try {
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.document_integrity",
        );
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.environment_poisoned",
        );
        await environment.close();
        closed = true;
      } finally {
        if (!closed) {
          try {
            await environment.close();
          } catch {
            // Preserve the first assertion or replay failure after best-effort cleanup.
          }
        }
      }
    });
  },
);

test(
  "Pilot replay rejects a self-consistent manifest with an unsealed readiness shape",
  { concurrency: false },
  async () => {
    await withFixtureCopy("readiness", async (fixtureRoot) => {
      await addUnexpectedReadinessKey(fixtureRoot);
      const environment = await launchPilotFixtureAuthoringEnvironment(fixtureRoot);
      let closed = false;
      try {
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.fixture_readiness",
        );
        await expectRuntimeError(
          replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
          "pilot_runtime.environment_poisoned",
        );
        await environment.close();
        closed = true;
      } finally {
        if (!closed) {
          try {
            await environment.close();
          } catch {
            // Preserve the first assertion or replay failure after best-effort cleanup.
          }
        }
      }
    });
  },
);

test(
  "Pilot replay rejects a closed declarative author shadow root while admitting native-control UA roots",
  { concurrency: false },
  async () => {
    await withFixtureCopy("closed-shadow", async (fixtureRoot) => {
      await addClosedDeclarativeShadowRoot(fixtureRoot);
      await expectFixtureFailureAndPoisoned(
        fixtureRoot,
        "pilot_runtime.document_integrity",
      );
    });
  },
);

test(
  "Pilot replay rejects an over-budget closed shadow tree without piercing its descendants",
  { concurrency: false },
  async () => {
    await withFixtureCopy("oversized-closed-shadow", async (fixtureRoot) => {
      await addOversizedClosedDeclarativeShadowRoot(fixtureRoot);
      await expectFixtureFailureAndPoisoned(
        fixtureRoot,
        "pilot_runtime.document_integrity",
      );
    });
  },
);

test(
  "Pilot replay fingerprints live selectedness outside the active workflow",
  { concurrency: false },
  async () => {
    await withFixtureCopy("other-select", async (fixtureRoot) => {
      await addOtherWorkflowSelectMutation(fixtureRoot);
      await expectFixtureFailureAndPoisoned(
        fixtureRoot,
        "pilot_runtime.document_integrity",
      );
    });
  },
);

test(
  "Pilot replay rejects duplicate-valued setup options before normalization",
  { concurrency: false },
  async () => {
    await withFixtureCopy("duplicate-setup", async (fixtureRoot) => {
      await addDuplicateSetupOption(fixtureRoot);
      await expectFixtureFailureAndPoisoned(
        fixtureRoot,
        "pilot_runtime.workflow_state",
      );
    });
  },
);

test(
  "Pilot replay fingerprints post-click element scroll state",
  { concurrency: false },
  async () => {
    await withFixtureCopy("element-scroll", async (fixtureRoot) => {
      await addPostClickScrollMutation(fixtureRoot);
      await expectFixtureFailureAndPoisoned(
        fixtureRoot,
        "pilot_runtime.document_integrity",
      );
    });
  },
);

test(
  "Pilot replay rejects an undeclared open popover top-layer state",
  { concurrency: false },
  async () => {
    await withFixtureCopy("popover", async (fixtureRoot) => {
      await addPopoverMutation(fixtureRoot);
      await expectFixtureFailureAndPoisoned(
        fixtureRoot,
        "pilot_runtime.document_integrity",
      );
    });
  },
);

test(
  "Pilot replay revokes success when the primary action opens a native file chooser",
  { concurrency: false },
  async () => {
    await withFixtureCopy("file-chooser", async (fixtureRoot) => {
      await addFileChooserAction(fixtureRoot);
      await expectFixtureFailureAndPoisoned(
        fixtureRoot,
        "pilot_runtime.session_tainted",
      );
    });
  },
);

test(
  "Pilot replay revokes success when a declared fixture request reports failure",
  { concurrency: false },
  async () => {
    await expectInjectedTeardownEvent((context) => {
      let declaredRequest: Request | undefined;
      context.on("request", (request) => {
        if (request.url().endsWith("/app.js")) declaredRequest = request;
      });
      return () => {
        if (declaredRequest === undefined) return false;
        return (
          context as unknown as {
            emit: (event: string, value: Request) => boolean;
          }
        ).emit("requestfailed", declaredRequest);
      };
    });
  },
);

test(
  "Pilot replay revokes success when the renderer crashes during teardown",
  { concurrency: false },
  async () => {
    await expectInjectedTeardownEvent((context) => () => {
      const page = context.pages()[0];
      if (page === undefined) return false;
      return (
        page as unknown as {
          emit: (event: string) => boolean;
        }
      ).emit("crash");
    });
  },
);

test(
  "Pilot replay poisons the environment when context close resolves without destruction",
  { concurrency: false },
  async () => {
    const environment = await launchPilotFixtureAuthoringEnvironment(fixtureDirectory);
    const { browser } = inspectOwnedBrowser(environment);
    const originalNewContextDescriptor = Object.getOwnPropertyDescriptor(
      browser,
      "newContext",
    );
    const originalNewContext = browser.newContext.bind(browser);
    let createdContext: BrowserContext | undefined;
    let originalCloseDescriptor: PropertyDescriptor | undefined;
    let assertionsComplete = false;
    let closed = false;
    Object.defineProperty(browser, "newContext", {
      configurable: true,
      value: async (...args: Parameters<typeof browser.newContext>) => {
        const context = await originalNewContext(...args);
        createdContext = context;
        originalCloseDescriptor = Object.getOwnPropertyDescriptor(context, "close");
        Object.defineProperty(context, "close", {
          configurable: true,
          value: async () => undefined,
        });
        return context;
      },
    });

    try {
      await expectRuntimeError(
        replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
        "pilot_runtime.cleanup",
      );
      assert.equal(browser.contexts().length, 1);
      assert.equal(browser.contexts()[0], createdContext);
      await expectRuntimeError(
        replayPilotFixtureAuthoringWorkflow(environment, "add_bundle"),
        "pilot_runtime.environment_poisoned",
      );
      assertionsComplete = true;
    } finally {
      if (originalNewContextDescriptor === undefined) {
        Reflect.deleteProperty(browser, "newContext");
      } else {
        Object.defineProperty(browser, "newContext", originalNewContextDescriptor);
      }
      if (createdContext !== undefined) {
        if (originalCloseDescriptor === undefined) {
          Reflect.deleteProperty(createdContext, "close");
        } else {
          Object.defineProperty(createdContext, "close", originalCloseDescriptor);
        }
      }
      if (!closed) {
        if (assertionsComplete) {
          await environment.close();
          closed = true;
          assert.equal(browser.contexts().length, 0);
        } else {
          try {
            await environment.close();
            closed = true;
          } catch {
            // Preserve the first assertion or replay failure after best-effort cleanup.
          }
        }
      }
    }
  },
);
