import assert from "node:assert/strict";
import test from "node:test";

import type { Page } from "@playwright/test";

import { assertClosedChromiumFonts } from "../../src/capture/chromium-fonts.js";

interface PlatformFont {
  readonly familyName: string;
  readonly glyphCount: number;
  readonly isCustomFont: boolean;
}

interface FakeChromiumOptions {
  readonly fontsByNode?: ReadonlyMap<number, readonly PlatformFont[]>;
  readonly sessionFailure?: Error;
  readonly sendFailureAt?: string;
  readonly sendFailure?: Error;
  readonly detachFailure?: Error;
}

interface FakeChromiumPage {
  readonly page: Page;
  readonly calls: string[];
  readonly detachCount: () => number;
}

class TestFontAuditError extends Error {
  readonly code = "test.font_audit";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TestFontAuditError";
  }
}

const createError = (message: string, options?: ErrorOptions): TestFontAuditError =>
  new TestFontAuditError(message, options);

function fakeChromiumPage(options: FakeChromiumOptions = {}): FakeChromiumPage {
  const calls: string[] = [];
  let detachCount = 0;
  const fontsByNode =
    options.fontsByNode ??
    new Map([
      [
        10,
        [
          {
            familyName: "Noto Sans",
            glyphCount: 12,
            isCustomFont: true,
          },
        ],
      ],
    ]);
  const client = {
    async send(method: string, parameters?: unknown): Promise<unknown> {
      calls.push(method);
      if (method === options.sendFailureAt) {
        throw options.sendFailure ?? new Error(`failed ${method}`);
      }
      if (method === "DOM.getDocument") {
        return { root: { nodeId: 1 } };
      }
      if (method === "DOM.querySelectorAll") {
        return { nodeIds: [...fontsByNode.keys()] };
      }
      if (method === "CSS.getPlatformFontsForNode") {
        const nodeId = parameters as { readonly nodeId: number } | undefined;
        return { fonts: fontsByNode.get(nodeId?.nodeId ?? -1) ?? [] };
      }
      return {};
    },
    async detach(): Promise<void> {
      detachCount += 1;
      if (options.detachFailure !== undefined) {
        throw options.detachFailure;
      }
    },
  };
  const page = {
    context: () => ({
      newCDPSession: async () => {
        if (options.sessionFailure !== undefined) throw options.sessionFailure;
        return client;
      },
    }),
  } as unknown as Page;
  return { page, calls, detachCount: () => detachCount };
}

async function audit(page: Page): Promise<void> {
  await assertClosedChromiumFonts(page, {
    expectedPlatformFamilyName: "Noto Sans",
    createError,
  });
}

test("closed Chromium font audit accepts only rendered custom-family glyphs", async () => {
  const fixture = fakeChromiumPage({
    fontsByNode: new Map([
      [10, [{ familyName: "Noto Sans", glyphCount: 7, isCustomFont: true }]],
      [20, [{ familyName: "Noto Sans", glyphCount: 5, isCustomFont: true }]],
    ]),
  });

  await audit(fixture.page);

  assert.deepEqual(fixture.calls, [
    "DOM.enable",
    "CSS.enable",
    "DOM.getDocument",
    "DOM.querySelectorAll",
    "CSS.getPlatformFontsForNode",
    "CSS.getPlatformFontsForNode",
  ]);
  assert.equal(fixture.detachCount(), 1);
});

test("closed Chromium font audit rejects fallback and empty glyph usage", async (t) => {
  await t.test("platform fallback", async () => {
    const fixture = fakeChromiumPage({
      fontsByNode: new Map([
        [10, [{ familyName: "Arial", glyphCount: 3, isCustomFont: false }]],
      ]),
    });
    await assert.rejects(audit(fixture.page), (error: unknown) => {
      assert.ok(error instanceof TestFontAuditError);
      assert.equal(error.code, "test.font_audit");
      assert.equal(
        error.message,
        "fixture text used a font outside the exact custom WOFF2 bundle",
      );
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(fixture.detachCount(), 1);
  });

  await t.test("no rendered glyphs", async () => {
    const fixture = fakeChromiumPage({ fontsByNode: new Map() });
    await assert.rejects(audit(fixture.page), (error: unknown) => {
      assert.ok(error instanceof TestFontAuditError);
      assert.equal(
        error.message,
        "fixture font audit observed no rendered custom glyphs",
      );
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(fixture.detachCount(), 1);
  });
});

test("closed Chromium font audit aggregates probing and detach failures", async () => {
  const sendFailure = new Error("CSS unavailable");
  const detachFailure = new Error("detach unavailable");
  const fixture = fakeChromiumPage({
    sendFailureAt: "CSS.enable",
    sendFailure,
    detachFailure,
  });

  await assert.rejects(audit(fixture.page), (error: unknown) => {
    assert.ok(error instanceof TestFontAuditError);
    assert.equal(error.message, "fixture platform-font usage could not be audited");
    assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.message, "fixture font audit and CDP cleanup both failed");
    assert.deepEqual(error.cause.errors, [sendFailure, detachFailure]);
    return true;
  });
  assert.equal(fixture.detachCount(), 1);
});

test("closed Chromium font audit types a CDP session initialization failure", async () => {
  const sessionFailure = new Error("CDP unavailable");
  const fixture = fakeChromiumPage({ sessionFailure });

  await assert.rejects(audit(fixture.page), (error: unknown) => {
    assert.ok(error instanceof TestFontAuditError);
    assert.equal(error.message, "fixture platform-font usage could not be audited");
    assert.equal(error.cause, sessionFailure);
    return true;
  });
  assert.equal(fixture.detachCount(), 0);
});

test("closed Chromium font audit reports a detach-only failure", async () => {
  const detachFailure = new Error("detach unavailable");
  const fixture = fakeChromiumPage({ detachFailure });

  await assert.rejects(audit(fixture.page), (error: unknown) => {
    assert.ok(error instanceof TestFontAuditError);
    assert.equal(
      error.message,
      "fixture platform-font audit session could not be detached",
    );
    assert.equal(error.cause, detachFailure);
    return true;
  });
  assert.equal(fixture.detachCount(), 1);
});
