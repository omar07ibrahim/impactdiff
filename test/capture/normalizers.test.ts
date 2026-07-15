import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccessibilitySnapshot } from "../../src/capture/normalize-ax.js";
import {
  normalizeLayoutProbe,
  normalizeLayoutSnapshot,
} from "../../src/capture/normalize-layout.js";
import {
  quantizeCssPixelToQ64,
  roundNearestTiesToEven,
} from "../../src/capture/quantize.js";
import {
  parseAccessibilitySnapshot,
  parseLayoutSnapshot,
} from "../../src/capture/validate.js";
import { canonicalJson } from "../../src/contracts/canonical.js";
import { ContractValidationError } from "../../src/contracts/errors.js";

const digest = (character: string): string => character.repeat(64);
const targetId = `idat1_${digest("a")}`;
type LooseRecord = Record<string, unknown>;

const style = () => ({
  display: "block",
  position: "static",
  visibility: "visible",
  pointerEvents: "auto",
  overflowX: "visible",
  overflowY: "visible",
  opacity: 1,
  zIndex: null,
  className: "must-not-survive",
});

const box = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
  selector: "#must-not-survive",
});

const layoutNodes = (): LooseRecord[] => [
  {
    backendDomNodeId: 100,
    parentBackendDomNodeId: null,
    childOrdinal: 0,
    kind: "document",
    bounds: box(0, 0, 800, 600),
    clipBounds: box(0, 0, 800, 600),
    paintOrder: 0,
    computedStyle: style(),
    actionTargetId: null,
    attributes: ["data-canary", "secret"],
  },
  {
    backendDomNodeId: 200,
    parentBackendDomNodeId: 100,
    childOrdinal: 0,
    kind: "element",
    bounds: box(1 / 128, 10, 500, 400),
    clipBounds: null,
    paintOrder: 20,
    computedStyle: style(),
    actionTargetId: null,
    domPath: "/html/body/main",
  },
  {
    backendDomNodeId: 400,
    parentBackendDomNodeId: 200,
    childOrdinal: 0,
    kind: "element",
    bounds: box(-3 / 128, 20, 240, 32),
    clipBounds: null,
    paintOrder: 30,
    computedStyle: style(),
    actionTargetId: targetId,
    canary: "must-not-survive",
  },
  {
    backendDomNodeId: 300,
    parentBackendDomNodeId: 100,
    childOrdinal: 1,
    kind: "element",
    bounds: box(600, 20, 120, 32),
    clipBounds: null,
    paintOrder: 10,
    computedStyle: style(),
    actionTargetId: null,
    frameId: "must-not-survive",
  },
];

const layoutProbe = (order = [0, 1, 2, 3]) => ({
  nodes: order.map((index) => layoutNodes()[index]),
  browserObjectId: "must-not-survive",
});

const axNodes = (): LooseRecord[] => [
  {
    nodeId: "ax-root",
    ignored: false,
    role: { type: "internalRole", value: "RootWebArea" },
    name: { type: "computedString", value: "Cafe\u0301 checkout" },
    childIds: ["ignored-shell", "ax-button"],
    backendDOMNodeId: 100,
    frameId: "A1B2C3",
    attributes: ["lang", "en"],
  },
  {
    nodeId: "ignored-shell",
    parentId: "ax-root",
    ignored: true,
    childIds: ["ax-main"],
    selector: "main",
  },
  {
    nodeId: "ax-main",
    parentId: "ignored-shell",
    ignored: false,
    role: { value: "main" },
    name: { value: "Checkout form" },
    childIds: ["ax-input"],
    backendDOMNodeId: 200,
    className: "checkout",
  },
  {
    nodeId: "ax-input",
    parentId: "ax-main",
    ignored: false,
    role: { value: "textbox" },
    name: { value: "Name" },
    value: { value: "Omar" },
    backendDOMNodeId: 400,
    properties: [
      { name: "required", value: { value: true } },
      { name: "focused", value: { value: true } },
      { name: "editable", value: { value: "plaintext" } },
      { name: "focusable", value: { value: true }, canary: "ignored" },
    ],
    domPath: "/html/body/main/input",
  },
  {
    nodeId: "ax-button",
    parentId: "ax-root",
    ignored: false,
    role: { value: "button" },
    name: { value: "Help" },
    backendDOMNodeId: 300,
    properties: [{ name: "disabled", value: { value: false } }],
    canary: "must-not-survive",
  },
];

const axProbe = (order = [0, 1, 2, 3, 4]) => ({
  nodes: order.map((index) => axNodes()[index]),
  frameId: "must-not-survive",
});

function assertContractFailure(callback: () => unknown): void {
  assert.throws(callback, ContractValidationError);
}

test("Q64 quantization uses nearest ties-to-even for positive and negative values", () => {
  assert.equal(quantizeCssPixelToQ64(1 / 128), 0);
  assert.equal(quantizeCssPixelToQ64(3 / 128), 2);
  assert.equal(quantizeCssPixelToQ64(5 / 128), 2);
  assert.equal(quantizeCssPixelToQ64(-1 / 128), 0);
  assert.equal(quantizeCssPixelToQ64(-3 / 128), -2);
  assert.equal(quantizeCssPixelToQ64(-5 / 128), -2);
  assert.equal(roundNearestTiesToEven(10.5), 10);
  assert.equal(roundNearestTiesToEven(11.5), 12);
  assert.equal(roundNearestTiesToEven(-10.5), -10);
  assert.equal(roundNearestTiesToEven(-11.5), -12);
  assert.ok(!Object.is(quantizeCssPixelToQ64(-1 / 128), -0));
});

test("Q64 quantization rejects non-finite and out-of-range geometry", () => {
  assertContractFailure(() => quantizeCssPixelToQ64(Number.NaN));
  assertContractFailure(() => quantizeCssPixelToQ64(Number.POSITIVE_INFINITY));
  assertContractFailure(() => quantizeCssPixelToQ64(262_145));
});

test("layout normalization is stable under input shuffling and emits preorder", () => {
  const first = normalizeLayoutProbe(layoutProbe());
  const shuffled = normalizeLayoutProbe(layoutProbe([3, 2, 0, 1]));

  assert.deepEqual(first.snapshot, shuffled.snapshot);
  assert.deepEqual(
    first.snapshot.nodes.map((node) => [node.index, node.parent_index]),
    [
      [0, null],
      [1, 0],
      [2, 1],
      [3, 0],
    ],
  );
  assert.deepEqual(
    first.snapshot.nodes.map((node) => node.paint_order),
    [0, 2, 3, 1],
  );
  assert.equal(first.snapshot.nodes[1]?.bounds.x_q64, 0);
  assert.equal(first.snapshot.nodes[2]?.bounds.x_q64, -2);
  assert.equal(first.backendDomNodeToLayoutIndex.get(400), 2);
  assert.equal("set" in first.backendDomNodeToLayoutIndex, false);
  assert.deepEqual(parseLayoutSnapshot(canonicalJson(first.snapshot)), first.snapshot);
});

test("layout output strips browser identities, selectors, classes, paths and attributes", () => {
  const serialized = JSON.stringify(normalizeLayoutSnapshot(layoutProbe()));
  for (const canary of [
    "backendDomNodeId",
    "parentBackendDomNodeId",
    "selector",
    "className",
    "domPath",
    "attributes",
    "frameId",
    "canary",
    "must-not-survive",
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
});

test("layout normalization rejects duplicate, dangling and cyclic identities", () => {
  const duplicate = layoutProbe();
  duplicate.nodes[3] = { ...duplicate.nodes[3], backendDomNodeId: 200 };
  assertContractFailure(() => normalizeLayoutSnapshot(duplicate));

  const dangling = layoutProbe();
  dangling.nodes[1] = {
    ...dangling.nodes[1],
    parentBackendDomNodeId: 999,
  };
  assertContractFailure(() => normalizeLayoutSnapshot(dangling));

  const cyclicNodes = layoutNodes().slice(0, 2);
  cyclicNodes[0] = {
    ...cyclicNodes[0],
    parentBackendDomNodeId: 200,
    kind: "element",
  };
  cyclicNodes[1] = {
    ...cyclicNodes[1],
    parentBackendDomNodeId: 100,
  };
  assertContractFailure(() => normalizeLayoutSnapshot({ nodes: cyclicNodes }));
});

test("layout normalization rejects ambiguous ordering and invalid geometry", () => {
  const duplicateOrdinal = layoutProbe();
  duplicateOrdinal.nodes[3] = {
    ...duplicateOrdinal.nodes[3],
    childOrdinal: 0,
  };
  assertContractFailure(() => normalizeLayoutSnapshot(duplicateOrdinal));

  const nonFinite = layoutProbe();
  const nonFiniteNode = nonFinite.nodes[1];
  assert.ok(nonFiniteNode !== undefined);
  nonFinite.nodes[1] = {
    ...nonFiniteNode,
    bounds: { ...(nonFiniteNode.bounds as LooseRecord), x: Number.NaN },
  };
  assertContractFailure(() => normalizeLayoutSnapshot(nonFinite));

  const negativeSize = layoutProbe();
  const negativeSizeNode = negativeSize.nodes[1];
  assert.ok(negativeSizeNode !== undefined);
  negativeSize.nodes[1] = {
    ...negativeSizeNode,
    bounds: { ...(negativeSizeNode.bounds as LooseRecord), width: -1 },
  };
  assertContractFailure(() => normalizeLayoutSnapshot(negativeSize));
});

test("accessibility normalization is stable under raw CDP array shuffling", () => {
  const layout = normalizeLayoutProbe(layoutProbe());
  const first = normalizeAccessibilitySnapshot(
    axProbe(),
    layout.backendDomNodeToLayoutIndex,
  );
  const shuffled = normalizeAccessibilitySnapshot(
    axProbe([4, 2, 0, 3, 1]),
    layout.backendDomNodeToLayoutIndex,
  );

  assert.deepEqual(first, shuffled);
  assert.deepEqual(
    first.nodes.map((node) => [node.role, node.parent_index, node.child_ordinal]),
    [
      ["document", null, 0],
      ["main", 0, 0],
      ["textbox", 1, 0],
      ["button", 0, 1],
    ],
  );
  assert.equal(first.nodes[0]?.name, "Café checkout");
  assert.deepEqual(first.nodes[2]?.states, ["editable", "focused", "required"]);
  assert.equal(first.nodes[2]?.layout_node_index, 2);
  assert.deepEqual(parseAccessibilitySnapshot(canonicalJson(first)), first);
});

test("accessibility output contains only normalized allowlisted fields", () => {
  const layout = normalizeLayoutProbe(layoutProbe());
  const serialized = JSON.stringify(
    normalizeAccessibilitySnapshot(axProbe(), layout.backendDomNodeToLayoutIndex),
  );
  for (const canary of [
    "nodeId",
    "parentId",
    "childIds",
    "backendDOMNodeId",
    "frameId",
    "selector",
    "className",
    "domPath",
    "attributes",
    "focusable",
    "canary",
    "must-not-survive",
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
});

test("accessibility normalization rejects cycles, dangling and duplicate IDs", () => {
  const cycle = {
    nodes: [
      {
        nodeId: "a",
        parentId: "b",
        childIds: ["b"],
        role: { value: "document" },
      },
      {
        nodeId: "b",
        parentId: "a",
        childIds: ["a"],
        role: { value: "generic" },
      },
    ],
  };
  assertContractFailure(() => normalizeAccessibilitySnapshot(cycle, new Map()));

  const dangling = axProbe();
  dangling.nodes[0] = {
    ...dangling.nodes[0],
    childIds: ["missing"],
  };
  assertContractFailure(() => normalizeAccessibilitySnapshot(dangling, new Map()));

  const duplicate = axProbe();
  duplicate.nodes[4] = { ...duplicate.nodes[4], nodeId: "ax-main" };
  assertContractFailure(() => normalizeAccessibilitySnapshot(duplicate, new Map()));
});

test("accessibility backend links can resolve only through the layout map", () => {
  const layout = normalizeLayoutProbe(layoutProbe());
  const incompleteMap = new Map(layout.backendDomNodeToLayoutIndex);
  incompleteMap.delete(400);
  assertContractFailure(() => normalizeAccessibilitySnapshot(axProbe(), incompleteMap));
});

test("normalizers enforce the 4096-node and 64-edge budgets", () => {
  const nodes = Array.from({ length: 66 }, (_, index) => ({
    nodeId: `node-${index}`,
    ...(index === 0 ? {} : { parentId: `node-${index - 1}` }),
    ...(index === 65 ? {} : { childIds: [`node-${index + 1}`] }),
    role: { value: index === 0 ? "document" : "generic" },
  }));
  assertContractFailure(() => normalizeAccessibilitySnapshot({ nodes }, new Map()));

  const tooManyNodes = Array.from({ length: 4_097 }, (_, index) => ({
    nodeId: `wide-${index}`,
    role: { value: index === 0 ? "document" : "generic" },
  }));
  assertContractFailure(() =>
    normalizeAccessibilitySnapshot({ nodes: tooManyNodes }, new Map()),
  );
});
