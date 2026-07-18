import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptChromiumLayoutSnapshot,
  chromiumLayoutComputedStyles,
  type ChromiumLayoutAdapterOptions,
} from "../../src/capture/chromium-layout.js";
import { ContractValidationError } from "../../src/contracts/errors.js";

const fixtureUrl = "https://fixture.impactdiff.invalid/";
const pilotFixtureUrl = "https://pilot-fixture.impactdiff.invalid/";
const actionTargetId = `idat1_${"a".repeat(64)}`;
const options: ChromiumLayoutAdapterOptions = {
  documentProfile: "development_fixture",
  viewport: { width: 320, height: 240 },
  target: { backendDomNodeId: 107, actionTargetId },
};
const pilotOptions: ChromiumLayoutAdapterOptions = {
  ...options,
  documentProfile: "pilot_fixture",
};

type LooseRecord = Record<string, unknown>;

interface SnapshotFixture {
  readonly strings: string[];
  readonly documents: LooseRecord[];
}

function chromiumSnapshot(documentUrl = fixtureUrl): SnapshotFixture {
  const strings: string[] = [];
  const intern = (value: string): number => {
    const existing = strings.indexOf(value);
    if (existing >= 0) {
      return existing;
    }
    strings.push(value);
    return strings.length - 1;
  };
  const style = (
    display = "block",
    overflowX = "visible",
    overflowY = "visible",
  ): number[] =>
    [display, "static", "visible", "auto", overflowX, overflowY, "1", "auto"].map(
      intern,
    );

  const nodeNames = [
    "#document",
    "html",
    "HTML",
    "BODY",
    "MAIN",
    "::before",
    "#text",
    "BUTTON",
    "#text",
    "DIV",
    "SPAN",
    "#text",
  ].map(intern);
  const nodeValues = [
    -1,
    -1,
    -1,
    -1,
    -1,
    -1,
    intern("pseudo text"),
    -1,
    intern("Place order"),
    -1,
    -1,
    intern("Status"),
  ];

  const layoutNodeIndexes = [0, 2, 4, 5, 5, 6, 7, 8, 10, 11];
  const styles = [
    [],
    style(),
    style("block", "hidden", "hidden"),
    style("inline"),
    style("inline"),
    style("inline"),
    style("inline-block"),
    style("inline"),
    style("inline"),
    style("inline"),
  ];
  const bounds = [
    [0, 0, 320, 240],
    [0, 0, 320, 800],
    [10, 500, 100, 80],
    [12, 502, 20, 10],
    [12, 502, 20, 10],
    [12, 502, 20, 10],
    [20, 520, 80, 24],
    [24, 524, 64, 16],
    [200, 550, 50, 20],
    [202, 552, 46, 16],
  ];
  const clientRects = [
    [],
    [0, 0, 320, 240],
    [2, 3, 96, 74],
    [],
    [],
    [],
    [2, 2, 76, 20],
    [],
    [],
    [],
  ];

  return {
    strings,
    documents: [
      {
        documentURL: intern(documentUrl),
        scrollOffsetX: 0,
        scrollOffsetY: 400,
        nodes: {
          parentIndex: [-1, 0, 0, 2, 3, 4, 5, 4, 7, 3, 9, 10],
          nodeType: [9, 10, 1, 1, 1, 1, 3, 1, 3, 1, 1, 3],
          nodeName: nodeNames,
          nodeValue: nodeValues,
          backendNodeId: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
          pseudoType: {
            index: [5],
            value: [intern("before")],
          },
          attributes: Array.from({ length: 12 }, () => []),
        },
        layout: {
          nodeIndex: layoutNodeIndexes,
          styles,
          bounds,
          text: layoutNodeIndexes.map(() => -1),
          paintOrders: [0, 1, 2, 3, 3, 3, 4, 4, 5, 5],
          offsetRects: clientRects,
          scrollRects: clientRects,
          clientRects,
          stackingContexts: { index: [0] },
        },
      },
    ],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function documentOf(snapshot: SnapshotFixture): LooseRecord {
  const document = snapshot.documents[0];
  assert.ok(document !== undefined);
  return document;
}

function nodesOf(snapshot: SnapshotFixture): LooseRecord {
  return documentOf(snapshot).nodes as LooseRecord;
}

function layoutOf(snapshot: SnapshotFixture): LooseRecord {
  return documentOf(snapshot).layout as LooseRecord;
}

function expectIssue(callback: () => unknown, code: string): void {
  assert.throws(
    callback,
    (error: unknown) =>
      error instanceof ContractValidationError &&
      error.contract === "impactdiff.chromium-layout-adapter/v1" &&
      error.issues.some((entry) => entry.code === code),
  );
}

test("the Chromium style request order is closed and immutable", () => {
  assert.deepEqual(chromiumLayoutComputedStyles, [
    "display",
    "position",
    "visibility",
    "pointer-events",
    "overflow-x",
    "overflow-y",
    "opacity",
    "z-index",
  ]);
  assert.equal(Object.isFrozen(chromiumLayoutComputedStyles), true);
});

test("adapter collapses non-layout parents and excludes complete pseudo subtrees", () => {
  const result = adaptChromiumLayoutSnapshot(chromiumSnapshot(), options);

  assert.deepEqual(
    result.snapshot.nodes.map((node) => [
      node.kind,
      node.parent_index,
      node.child_ordinal,
      node.action_target_id,
    ]),
    [
      ["document", null, 0, null],
      ["element", 0, 0, null],
      ["element", 1, 0, null],
      ["element", 2, 0, actionTargetId],
      ["text", 3, 0, null],
      ["element", 1, 1, null],
      ["text", 5, 0, null],
    ],
  );
  assert.equal(result.backendDomNodeToLayoutIndex.has(105), false);
  assert.equal(result.backendDomNodeToLayoutIndex.has(106), false);
  assert.equal(result.backendDomNodeToLayoutIndex.get(107), 3);
  assert.equal(result.snapshot.nodes[0]?.computed_style.display, "block");
  assert.deepEqual(result.snapshot.nodes[0]?.clip_bounds, {
    x_q64: 0,
    y_q64: 0,
    width_q64: 20_480,
    height_q64: 15_360,
  });
});

test("bounds use viewport coordinates while overflow clips translate local client rects", () => {
  const result = adaptChromiumLayoutSnapshot(chromiumSnapshot(), options);
  const main = result.snapshot.nodes[2];
  assert.ok(main !== undefined);

  assert.deepEqual(main.bounds, {
    x_q64: 640,
    y_q64: 6_400,
    width_q64: 6_400,
    height_q64: 5_120,
  });
  assert.deepEqual(main.clip_bounds, {
    x_q64: 768,
    y_q64: 6_592,
    width_q64: 6_144,
    height_q64: 4_736,
  });
  assert.notEqual(main.clip_bounds?.x_q64, 128);
  assert.notEqual(main.clip_bounds?.y_q64, -25_408);
});

test("a resolved target may be absent from layout after becoming hidden", () => {
  const snapshot = chromiumSnapshot();
  const layout = layoutOf(snapshot);
  for (const key of [
    "nodeIndex",
    "styles",
    "bounds",
    "text",
    "paintOrders",
    "offsetRects",
    "scrollRects",
    "clientRects",
  ]) {
    const entries = layout[key] as unknown[];
    layout[key] = entries.filter((_, index) => index !== 6 && index !== 7);
  }

  const result = adaptChromiumLayoutSnapshot(snapshot, options);
  assert.equal(result.backendDomNodeToLayoutIndex.has(107), false);
  assert.equal(
    result.snapshot.nodes.some((node) => node.action_target_id !== null),
    false,
  );
});

test("adapter binds one exact fixture document and viewport", () => {
  const multiple = chromiumSnapshot();
  multiple.documents.push(clone(documentOf(multiple)));
  expectIssue(
    () => adaptChromiumLayoutSnapshot(multiple, options),
    "chromium_layout.array_length",
  );

  const wrongUrl = chromiumSnapshot();
  documentOf(wrongUrl).documentURL = wrongUrl.strings.push("https://example.test/") - 1;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(wrongUrl, options),
    "chromium_layout.document_url",
  );

  const missingScroll = chromiumSnapshot();
  delete documentOf(missingScroll).scrollOffsetY;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(missingScroll, options),
    "chromium_layout.required",
  );

  const viewportDrift = chromiumSnapshot();
  (layoutOf(viewportDrift).bounds as number[][])[0] = [0, 0, 321, 240];
  expectIssue(
    () => adaptChromiumLayoutSnapshot(viewportDrift, options),
    "chromium_layout.document_viewport",
  );
});

test("adapter binds each closed document profile to its exact fixture URL", () => {
  const pilotResult = adaptChromiumLayoutSnapshot(
    chromiumSnapshot(pilotFixtureUrl),
    pilotOptions,
  );
  assert.equal(pilotResult.backendDomNodeToLayoutIndex.get(107), 3);

  expectIssue(
    () => adaptChromiumLayoutSnapshot(chromiumSnapshot(pilotFixtureUrl), options),
    "chromium_layout.document_url",
  );
  expectIssue(
    () => adaptChromiumLayoutSnapshot(chromiumSnapshot(), pilotOptions),
    "chromium_layout.document_url",
  );

  expectIssue(
    () =>
      adaptChromiumLayoutSnapshot(chromiumSnapshot(), {
        ...options,
        documentProfile: "unknown_fixture",
      } as unknown as ChromiumLayoutAdapterOptions),
    "chromium_layout.document_profile",
  );

  const missingProfile: Omit<ChromiumLayoutAdapterOptions, "documentProfile"> = {
    viewport: options.viewport,
    target: options.target,
  };
  expectIssue(
    () =>
      adaptChromiumLayoutSnapshot(
        chromiumSnapshot(),
        missingProfile as ChromiumLayoutAdapterOptions,
      ),
    "chromium_layout.required",
  );
});

test("adapter rejects malformed indexes, styles, rectangles, and parallel tables", () => {
  const stringIndex = chromiumSnapshot();
  (layoutOf(stringIndex).styles as number[][])[1]![0] = 999_999;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(stringIndex, options),
    "chromium_layout.integer",
  );

  const shortStyle = chromiumSnapshot();
  (layoutOf(shortStyle).styles as number[][])[2]!.pop();
  expectIssue(
    () => adaptChromiumLayoutSnapshot(shortStyle, options),
    "chromium_layout.array_length",
  );

  const unsupportedStyle = chromiumSnapshot();
  const unsupportedIndex = unsupportedStyle.strings.push("flow-root") - 1;
  (layoutOf(unsupportedStyle).styles as number[][])[2]![0] = unsupportedIndex;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(unsupportedStyle, options),
    "chromium_layout.style_value",
  );

  const badOpacity = chromiumSnapshot();
  const opacityIndex = badOpacity.strings.push(".5") - 1;
  (layoutOf(badOpacity).styles as number[][])[2]![6] = opacityIndex;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(badOpacity, options),
    "chromium_layout.opacity",
  );

  const missingClientRect = chromiumSnapshot();
  (layoutOf(missingClientRect).clientRects as number[][])[2] = [];
  expectIssue(
    () => adaptChromiumLayoutSnapshot(missingClientRect, options),
    "chromium_layout.overflow_client_rect",
  );

  const shortParallelTable = chromiumSnapshot();
  (layoutOf(shortParallelTable).paintOrders as number[]).pop();
  expectIssue(
    () => adaptChromiumLayoutSnapshot(shortParallelTable, options),
    "chromium_layout.array_length",
  );
});

test("adapter rejects ambiguous DOM, layout, pseudo, and target identities", () => {
  const forwardParent = chromiumSnapshot();
  (nodesOf(forwardParent).parentIndex as number[])[4] = 10;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(forwardParent, options),
    "chromium_layout.integer",
  );

  const duplicateBackend = chromiumSnapshot();
  (nodesOf(duplicateBackend).backendNodeId as number[])[10] = 107;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(duplicateBackend, options),
    "chromium_layout.duplicate_backend_node",
  );

  const duplicateLayout = chromiumSnapshot();
  (layoutOf(duplicateLayout).nodeIndex as number[])[8] = 7;
  expectIssue(
    () => adaptChromiumLayoutSnapshot(duplicateLayout, options),
    "chromium_layout.duplicate_layout_node",
  );

  const unsortedPseudo = chromiumSnapshot();
  nodesOf(unsortedPseudo).pseudoType = {
    index: [5, 4],
    value: [unsortedPseudo.strings.push("before") - 1, 0],
  };
  expectIssue(
    () => adaptChromiumLayoutSnapshot(unsortedPseudo, options),
    "chromium_layout.sparse_order",
  );

  const missingTarget = chromiumSnapshot();
  expectIssue(
    () =>
      adaptChromiumLayoutSnapshot(missingTarget, {
        ...options,
        target: { ...options.target, backendDomNodeId: 999 },
      }),
    "chromium_layout.action_target_mapping",
  );

  const pseudoTarget = chromiumSnapshot();
  expectIssue(
    () =>
      adaptChromiumLayoutSnapshot(pseudoTarget, {
        ...options,
        target: { ...options.target, backendDomNodeId: 105 },
      }),
    "chromium_layout.action_target_kind",
  );
});

test("adapter enforces raw node limits and rejects active input objects", () => {
  const oversized = chromiumSnapshot();
  const nodes = nodesOf(oversized);
  for (const key of [
    "parentIndex",
    "nodeType",
    "nodeName",
    "nodeValue",
    "backendNodeId",
    "attributes",
  ]) {
    const entries = nodes[key] as unknown[];
    const seed = entries[entries.length - 1];
    while (entries.length < 4_097) {
      entries.push(seed);
    }
  }
  expectIssue(
    () => adaptChromiumLayoutSnapshot(oversized, options),
    "chromium_layout.array_length",
  );

  const active = chromiumSnapshot() as SnapshotFixture & {
    browserObject?: unknown;
  };
  Object.defineProperty(active, "documents", {
    enumerable: true,
    get: () => active.documents,
  });
  expectIssue(
    () => adaptChromiumLayoutSnapshot(active, options),
    "chromium_layout.data_property",
  );
});
