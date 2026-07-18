import { ContractValidationError, issue } from "../contracts/errors.js";
import { maximumCaptureDimension, maximumCapturePixels } from "./limits.js";
import {
  normalizeLayoutProbe,
  type NormalizedLayoutProbe,
  type RawLayoutBox,
  type RawLayoutComputedStyle,
  type RawLayoutNode,
} from "./normalize-layout.js";

const chromiumLayoutContract = "impactdiff.chromium-layout-adapter/v1";
const chromiumLayoutDocumentUrls = Object.freeze({
  development_fixture: "https://fixture.impactdiff.invalid/",
  pilot_fixture: "https://pilot-fixture.impactdiff.invalid/",
} as const);
const maximumDomNodes = 4_096;
const maximumLayoutRows = 4_096;
const maximumStrings = 32_768;
const maximumStringLength = 65_536;
const maximumStringCodeUnits = 1_048_576;
const maximumBackendDomNodeId = 4_294_967_295;
const maximumPaintOrder = 4_294_967_295;
const actionTargetPattern = /^idat1_[0-9a-f]{64}$/u;

const displayValues = [
  "block",
  "contents",
  "flex",
  "grid",
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "list-item",
  "none",
  "table",
] as const;
const positionValues = ["absolute", "fixed", "relative", "static", "sticky"] as const;
const visibilityValues = ["collapse", "hidden", "visible"] as const;
const pointerEventValues = ["auto", "none"] as const;
const overflowValues = ["auto", "clip", "hidden", "scroll", "visible"] as const;

/**
 * This order is part of the adapter boundary. The caller must request exactly
 * these properties from DOMSnapshot.captureSnapshot.
 */
export const chromiumLayoutComputedStyles = Object.freeze([
  "display",
  "position",
  "visibility",
  "pointer-events",
  "overflow-x",
  "overflow-y",
  "opacity",
  "z-index",
] as const);

export interface ChromiumLayoutViewport {
  readonly width: number;
  readonly height: number;
}

export interface ChromiumLayoutTarget {
  readonly backendDomNodeId: number;
  readonly actionTargetId: string;
}

export type ChromiumLayoutDocumentProfile = keyof typeof chromiumLayoutDocumentUrls;

export interface ChromiumLayoutAdapterOptions {
  readonly documentProfile: ChromiumLayoutDocumentProfile;
  readonly viewport: ChromiumLayoutViewport;
  /** The exact DOM target; a hidden target may legitimately have no layout row. */
  readonly target: ChromiumLayoutTarget;
}

interface ParsedOptions {
  readonly documentUrl: string;
  readonly viewport: ChromiumLayoutViewport;
  readonly target: ChromiumLayoutTarget;
}

interface NodeTable {
  readonly count: number;
  readonly parentIndexes: readonly number[];
  readonly nodeTypes: readonly number[];
  readonly backendDomNodeIds: readonly number[];
  readonly pseudoExcluded: readonly boolean[];
}

interface DecodedLayoutRow {
  readonly domNodeIndex: number;
  readonly bounds: RawLayoutBox;
  readonly clientRect: RawLayoutBox | null;
  readonly paintOrder: number;
  readonly computedStyle: RawLayoutComputedStyle;
}

const documentStyle: RawLayoutComputedStyle = Object.freeze({
  display: "block",
  position: "static",
  visibility: "visible",
  pointerEvents: "auto",
  overflowX: "visible",
  overflowY: "visible",
  opacity: 1,
  zIndex: null,
});

function fail(code: string, path: string, message: string): never {
  throw new ContractValidationError(chromiumLayoutContract, [
    issue(code, path, message),
  ]);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("chromium_layout.object", path, "expected a plain data object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("chromium_layout.object", path, "expected a plain data object");
  }
  return value as Record<string, unknown>;
}

function requiredValue(
  object: Record<string, unknown>,
  key: string,
  path: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    fail("chromium_layout.required", `${path}/${key}`, "required field is missing");
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    fail(
      "chromium_layout.data_property",
      `${path}/${key}`,
      "fields must be enumerable data properties",
    );
  }
  return descriptor.value;
}

function optionalValue(
  object: Record<string, unknown>,
  key: string,
  path: string,
): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    fail(
      "chromium_layout.data_property",
      `${path}/${key}`,
      "fields must be enumerable data properties",
    );
  }
  return descriptor.value;
}

function denseArray(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("chromium_layout.array", path, "expected a built-in dense array");
  }
  if (value.length < minimum || value.length > maximum) {
    fail(
      "chromium_layout.array_length",
      path,
      `expected between ${minimum} and ${maximum} entries`,
    );
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      fail(
        "chromium_layout.dense_array",
        `${path}/${index}`,
        "arrays must contain only enumerable data entries",
      );
    }
    result.push(descriptor.value);
  }
  return result;
}

function integer(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    fail(
      "chromium_layout.integer",
      path,
      `expected an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("chromium_layout.finite_number", path, "expected a finite number");
  }
  return value;
}

function parallelArray(
  object: Record<string, unknown>,
  key: string,
  path: string,
  expectedLength: number,
): readonly unknown[] {
  const result = denseArray(
    requiredValue(object, key, path),
    `${path}/${key}`,
    expectedLength,
    expectedLength,
  );
  return result;
}

function parseStringTable(value: unknown): readonly string[] {
  const raw = denseArray(value, "/strings", 1, maximumStrings);
  let codeUnits = 0;
  const strings = raw.map((entry, index) => {
    if (typeof entry !== "string" || entry.length > maximumStringLength) {
      fail(
        "chromium_layout.string",
        `/strings/${index}`,
        `strings must contain at most ${maximumStringLength} UTF-16 code units`,
      );
    }
    codeUnits += entry.length;
    if (codeUnits > maximumStringCodeUnits) {
      fail(
        "chromium_layout.string_budget",
        "/strings",
        `the string table cannot exceed ${maximumStringCodeUnits} UTF-16 code units`,
      );
    }
    return entry;
  });
  return Object.freeze(strings);
}

function stringAt(value: unknown, path: string, strings: readonly string[]): string {
  const index = integer(value, path, 0, strings.length - 1);
  const decoded = strings[index];
  if (decoded === undefined) {
    fail("chromium_layout.string_index", path, "string index did not resolve");
  }
  return decoded;
}

function optionalStringAt(
  value: unknown,
  path: string,
  strings: readonly string[],
): string | null {
  const index = integer(value, path, -1, strings.length - 1);
  return index < 0 ? null : stringAt(index, path, strings);
}

function enumeration<const Values extends readonly string[]>(
  value: string,
  path: string,
  values: Values,
): Values[number] {
  if (!values.includes(value)) {
    fail("chromium_layout.style_value", path, `expected one of: ${values.join(", ")}`);
  }
  return value as Values[number];
}

function parseOpacity(value: string, path: string): number {
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u.test(value)) {
    fail(
      "chromium_layout.opacity",
      path,
      "opacity must use Chromium's canonical decimal form between zero and one",
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail("chromium_layout.opacity", path, "opacity must be between zero and one");
  }
  return parsed;
}

function parseZIndex(value: string, path: string): number | null {
  if (value === "auto") {
    return null;
  }
  if (!/^-?(?:0|[1-9]\d*)$/u.test(value) || value === "-0") {
    fail(
      "chromium_layout.z_index",
      path,
      "z-index must be auto or a canonical base-ten integer",
    );
  }
  const parsed = Number(value);
  return integer(parsed, path, -2_147_483_648, 2_147_483_647);
}

function parseStyle(
  value: unknown,
  path: string,
  strings: readonly string[],
  documentNode: boolean,
): RawLayoutComputedStyle {
  const styleIndexes = denseArray(
    value,
    path,
    documentNode ? 0 : chromiumLayoutComputedStyles.length,
    documentNode ? 0 : chromiumLayoutComputedStyles.length,
  );
  if (documentNode) {
    return documentStyle;
  }
  const decoded = styleIndexes.map((entry, index) =>
    stringAt(entry, `${path}/${index}`, strings),
  );
  const [
    display,
    position,
    visibility,
    pointerEvents,
    overflowX,
    overflowY,
    opacity,
    zIndex,
  ] = decoded;
  if (
    display === undefined ||
    position === undefined ||
    visibility === undefined ||
    pointerEvents === undefined ||
    overflowX === undefined ||
    overflowY === undefined ||
    opacity === undefined ||
    zIndex === undefined
  ) {
    fail("chromium_layout.style_arity", path, "computed style vector is incomplete");
  }
  return Object.freeze({
    display: enumeration(display, `${path}/0`, displayValues),
    position: enumeration(position, `${path}/1`, positionValues),
    visibility: enumeration(visibility, `${path}/2`, visibilityValues),
    pointerEvents: enumeration(pointerEvents, `${path}/3`, pointerEventValues),
    overflowX: enumeration(overflowX, `${path}/4`, overflowValues),
    overflowY: enumeration(overflowY, `${path}/5`, overflowValues),
    opacity: parseOpacity(opacity, `${path}/6`),
    zIndex: parseZIndex(zIndex, `${path}/7`),
  });
}

function rectangle(value: unknown, path: string): RawLayoutBox {
  const entries = denseArray(value, path, 4, 4);
  const x = finiteNumber(entries[0], `${path}/0`);
  const y = finiteNumber(entries[1], `${path}/1`);
  const width = finiteNumber(entries[2], `${path}/2`);
  const height = finiteNumber(entries[3], `${path}/3`);
  if (width < 0 || height < 0) {
    fail(
      "chromium_layout.negative_size",
      path,
      "rectangle width and height cannot be negative",
    );
  }
  return Object.freeze({ x, y, width, height });
}

function optionalRectangle(value: unknown, path: string): RawLayoutBox | null {
  const entries = denseArray(value, path, 0, 4);
  if (entries.length === 0) {
    return null;
  }
  if (entries.length !== 4) {
    fail(
      "chromium_layout.rectangle_arity",
      path,
      "client rectangles must be empty or contain four coordinates",
    );
  }
  return rectangle(entries, path);
}

function parseOptions(value: ChromiumLayoutAdapterOptions): ParsedOptions {
  const input = record(value, "/options");
  const documentProfile = requiredValue(input, "documentProfile", "/options");
  if (
    documentProfile !== "development_fixture" &&
    documentProfile !== "pilot_fixture"
  ) {
    fail(
      "chromium_layout.document_profile",
      "/options/documentProfile",
      "document profile must be development_fixture or pilot_fixture",
    );
  }
  const viewportInput = record(
    requiredValue(input, "viewport", "/options"),
    "/options/viewport",
  );
  const width = integer(
    requiredValue(viewportInput, "width", "/options/viewport"),
    "/options/viewport/width",
    1,
    maximumCaptureDimension,
  );
  const height = integer(
    requiredValue(viewportInput, "height", "/options/viewport"),
    "/options/viewport/height",
    1,
    maximumCaptureDimension,
  );
  if (width * height > maximumCapturePixels) {
    fail(
      "chromium_layout.viewport_pixels",
      "/options/viewport",
      `viewport cannot exceed ${maximumCapturePixels} CSS pixels`,
    );
  }

  const targetInput = record(
    requiredValue(input, "target", "/options"),
    "/options/target",
  );
  const backendDomNodeId = integer(
    requiredValue(targetInput, "backendDomNodeId", "/options/target"),
    "/options/target/backendDomNodeId",
    1,
    maximumBackendDomNodeId,
  );
  const actionTargetId = requiredValue(
    targetInput,
    "actionTargetId",
    "/options/target",
  );
  if (typeof actionTargetId !== "string" || !actionTargetPattern.test(actionTargetId)) {
    fail(
      "chromium_layout.action_target_id",
      "/options/target/actionTargetId",
      "action target ID must use the idat1_ SHA-256 form",
    );
  }
  return Object.freeze({
    documentUrl: chromiumLayoutDocumentUrls[documentProfile],
    viewport: Object.freeze({ width, height }),
    target: Object.freeze({ backendDomNodeId, actionTargetId }),
  });
}

function parseRarePseudoIndexes(
  value: unknown | undefined,
  nodeCount: number,
  strings: readonly string[],
): ReadonlySet<number> {
  if (value === undefined) {
    return new Set<number>();
  }
  const input = record(value, "/documents/0/nodes/pseudoType");
  const indexes = denseArray(
    requiredValue(input, "index", "/documents/0/nodes/pseudoType"),
    "/documents/0/nodes/pseudoType/index",
    0,
    nodeCount,
  );
  const values = denseArray(
    requiredValue(input, "value", "/documents/0/nodes/pseudoType"),
    "/documents/0/nodes/pseudoType/value",
    indexes.length,
    indexes.length,
  );
  const result = new Set<number>();
  let previous = -1;
  for (const [offset, rawIndex] of indexes.entries()) {
    const index = integer(
      rawIndex,
      `/documents/0/nodes/pseudoType/index/${offset}`,
      0,
      nodeCount - 1,
    );
    if (index <= previous) {
      fail(
        "chromium_layout.sparse_order",
        "/documents/0/nodes/pseudoType/index",
        "sparse indexes must be strictly increasing",
      );
    }
    const pseudoName = stringAt(
      values[offset],
      `/documents/0/nodes/pseudoType/value/${offset}`,
      strings,
    );
    if (pseudoName.length === 0) {
      fail(
        "chromium_layout.pseudo_type",
        `/documents/0/nodes/pseudoType/value/${offset}`,
        "pseudo type cannot be empty",
      );
    }
    result.add(index);
    previous = index;
  }
  return result;
}

function parseNodeTable(value: unknown, strings: readonly string[]): NodeTable {
  const input = record(value, "/documents/0/nodes");
  const parents = denseArray(
    requiredValue(input, "parentIndex", "/documents/0/nodes"),
    "/documents/0/nodes/parentIndex",
    1,
    maximumDomNodes,
  );
  const count = parents.length;
  const nodeTypes = parallelArray(input, "nodeType", "/documents/0/nodes", count);
  const nodeNames = parallelArray(input, "nodeName", "/documents/0/nodes", count);
  const nodeValues = parallelArray(input, "nodeValue", "/documents/0/nodes", count);
  const backendIds = parallelArray(input, "backendNodeId", "/documents/0/nodes", count);
  const pseudoRoots = parseRarePseudoIndexes(
    optionalValue(input, "pseudoType", "/documents/0/nodes"),
    count,
    strings,
  );
  const parsedParents: number[] = [];
  const parsedTypes: number[] = [];
  const parsedBackendIds: number[] = [];
  const pseudoExcluded: boolean[] = [];
  const seenBackendIds = new Set<number>();

  for (let index = 0; index < count; index += 1) {
    const parent = integer(
      parents[index],
      `/documents/0/nodes/parentIndex/${index}`,
      -1,
      Math.max(0, index - 1),
    );
    if ((index === 0 && parent !== -1) || (index > 0 && parent < 0)) {
      fail(
        "chromium_layout.parent_order",
        `/documents/0/nodes/parentIndex/${index}`,
        "the root must be first and every other parent must precede its child",
      );
    }
    const nodeType = integer(
      nodeTypes[index],
      `/documents/0/nodes/nodeType/${index}`,
      1,
      12,
    );
    if ((index === 0 && nodeType !== 9) || (index > 0 && nodeType === 9)) {
      fail(
        "chromium_layout.document_node",
        `/documents/0/nodes/nodeType/${index}`,
        "the node table must contain one document node at index zero",
      );
    }
    stringAt(nodeNames[index], `/documents/0/nodes/nodeName/${index}`, strings);
    optionalStringAt(
      nodeValues[index],
      `/documents/0/nodes/nodeValue/${index}`,
      strings,
    );
    const backendId = integer(
      backendIds[index],
      `/documents/0/nodes/backendNodeId/${index}`,
      1,
      maximumBackendDomNodeId,
    );
    if (seenBackendIds.has(backendId)) {
      fail(
        "chromium_layout.duplicate_backend_node",
        `/documents/0/nodes/backendNodeId/${index}`,
        "backend DOM node IDs must be unique",
      );
    }
    seenBackendIds.add(backendId);
    parsedParents.push(parent);
    parsedTypes.push(nodeType);
    parsedBackendIds.push(backendId);
    pseudoExcluded.push(
      pseudoRoots.has(index) || (parent >= 0 && (pseudoExcluded[parent] ?? false)),
    );
  }
  if (pseudoExcluded[0]) {
    fail(
      "chromium_layout.pseudo_document",
      "/documents/0/nodes/pseudoType",
      "the document node cannot be a pseudo element",
    );
  }
  return Object.freeze({
    count,
    parentIndexes: Object.freeze(parsedParents),
    nodeTypes: Object.freeze(parsedTypes),
    backendDomNodeIds: Object.freeze(parsedBackendIds),
    pseudoExcluded: Object.freeze(pseudoExcluded),
  });
}

function parseLayoutRows(
  value: unknown,
  nodes: NodeTable,
  strings: readonly string[],
  viewport: ChromiumLayoutViewport,
): ReadonlyMap<number, DecodedLayoutRow> {
  const input = record(value, "/documents/0/layout");
  const nodeIndexes = denseArray(
    requiredValue(input, "nodeIndex", "/documents/0/layout"),
    "/documents/0/layout/nodeIndex",
    1,
    maximumLayoutRows,
  );
  const count = nodeIndexes.length;
  const styles = parallelArray(input, "styles", "/documents/0/layout", count);
  const bounds = parallelArray(input, "bounds", "/documents/0/layout", count);
  const paintOrders = parallelArray(input, "paintOrders", "/documents/0/layout", count);
  const clientRects = parallelArray(input, "clientRects", "/documents/0/layout", count);
  const rows = new Map<number, DecodedLayoutRow>();

  for (let index = 0; index < count; index += 1) {
    const path = `/documents/0/layout`;
    const domNodeIndex = integer(
      nodeIndexes[index],
      `${path}/nodeIndex/${index}`,
      0,
      nodes.count - 1,
    );
    const documentNode = nodes.nodeTypes[domNodeIndex] === 9;
    const style = parseStyle(
      styles[index],
      `${path}/styles/${index}`,
      strings,
      documentNode,
    );
    const parsedBounds = rectangle(bounds[index], `${path}/bounds/${index}`);
    const clientRect = optionalRectangle(
      clientRects[index],
      `${path}/clientRects/${index}`,
    );
    const paintOrder = integer(
      paintOrders[index],
      `${path}/paintOrders/${index}`,
      0,
      maximumPaintOrder,
    );

    if (documentNode) {
      if (
        parsedBounds.x !== 0 ||
        parsedBounds.y !== 0 ||
        parsedBounds.width !== viewport.width ||
        parsedBounds.height !== viewport.height
      ) {
        fail(
          "chromium_layout.document_viewport",
          `${path}/bounds/${index}`,
          "document bounds must exactly equal the configured CSS viewport",
        );
      }
      if (clientRect !== null) {
        fail(
          "chromium_layout.document_client_rect",
          `${path}/clientRects/${index}`,
          "Chromium document rows must have an empty client rectangle",
        );
      }
    }

    const nodeType = nodes.nodeTypes[domNodeIndex];
    const retainedKind = nodeType === 1 || nodeType === 3 || nodeType === 9;
    if (!retainedKind && !nodes.pseudoExcluded[domNodeIndex]) {
      fail(
        "chromium_layout.rendered_node_type",
        `${path}/nodeIndex/${index}`,
        "layout rows may resolve only to document, element, or text nodes",
      );
    }
    if (nodes.pseudoExcluded[domNodeIndex]) {
      continue;
    }
    if (rows.has(domNodeIndex)) {
      fail(
        "chromium_layout.duplicate_layout_node",
        `${path}/nodeIndex/${index}`,
        "retained DOM nodes must have exactly one layout row",
      );
    }
    rows.set(
      domNodeIndex,
      Object.freeze({
        domNodeIndex,
        bounds: parsedBounds,
        clientRect,
        paintOrder,
        computedStyle: style,
      }),
    );
  }

  if (!rows.has(0)) {
    fail(
      "chromium_layout.document_layout",
      "/documents/0/layout/nodeIndex",
      "the document node must have exactly one layout row",
    );
  }
  return rows;
}

function viewportBox(viewport: ChromiumLayoutViewport): RawLayoutBox {
  return Object.freeze({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
}

function viewportBounds(
  bounds: RawLayoutBox,
  scrollX: number,
  scrollY: number,
): RawLayoutBox {
  return Object.freeze({
    x: bounds.x - scrollX,
    y: bounds.y - scrollY,
    width: bounds.width,
    height: bounds.height,
  });
}

function overflowClip(
  row: DecodedLayoutRow,
  nodeType: number,
  scrollX: number,
  scrollY: number,
): RawLayoutBox | null {
  if (nodeType !== 1) {
    return null;
  }
  if (
    row.computedStyle.overflowX === "visible" &&
    row.computedStyle.overflowY === "visible"
  ) {
    return null;
  }
  if (row.clientRect === null) {
    fail(
      "chromium_layout.overflow_client_rect",
      "/documents/0/layout/clientRects",
      "overflow-clipping elements require a Chromium client rectangle",
    );
  }
  return Object.freeze({
    x: row.bounds.x + row.clientRect.x - scrollX,
    y: row.bounds.y + row.clientRect.y - scrollY,
    width: row.clientRect.width,
    height: row.clientRect.height,
  });
}

function assembleProbe(
  nodes: NodeTable,
  rows: ReadonlyMap<number, DecodedLayoutRow>,
  scrollX: number,
  scrollY: number,
  options: ParsedOptions,
): NormalizedLayoutProbe {
  const rawNodes: RawLayoutNode[] = [];
  const retainedBackendByDomIndex = new Map<number, number>();
  const nextOrdinalByParent = new Map<number, number>();
  const targetDomNodeIndex = nodes.backendDomNodeIds.indexOf(
    options.target.backendDomNodeId,
  );
  if (targetDomNodeIndex < 0) {
    fail(
      "chromium_layout.action_target_mapping",
      "/options/target/backendDomNodeId",
      "the action target must resolve to exactly one DOM node",
    );
  }
  if (
    nodes.nodeTypes[targetDomNodeIndex] !== 1 ||
    nodes.pseudoExcluded[targetDomNodeIndex]
  ) {
    fail(
      "chromium_layout.action_target_kind",
      "/options/target/backendDomNodeId",
      "the action target backend node must resolve to a non-pseudo element",
    );
  }

  for (const domNodeIndex of [...rows.keys()].sort((left, right) => left - right)) {
    const row = rows.get(domNodeIndex);
    const backendDomNodeId = nodes.backendDomNodeIds[domNodeIndex];
    const nodeType = nodes.nodeTypes[domNodeIndex];
    if (row === undefined || backendDomNodeId === undefined || nodeType === undefined) {
      fail(
        "chromium_layout.internal_mapping",
        "/documents/0/layout",
        "validated layout mapping became incomplete",
      );
    }

    let parentDomNodeIndex = nodes.parentIndexes[domNodeIndex] ?? -1;
    while (
      parentDomNodeIndex >= 0 &&
      !retainedBackendByDomIndex.has(parentDomNodeIndex)
    ) {
      parentDomNodeIndex = nodes.parentIndexes[parentDomNodeIndex] ?? -1;
    }
    const parentBackendDomNodeId =
      parentDomNodeIndex < 0
        ? null
        : (retainedBackendByDomIndex.get(parentDomNodeIndex) ?? null);
    if (domNodeIndex !== 0 && parentBackendDomNodeId === null) {
      fail(
        "chromium_layout.disconnected_layout",
        `/documents/0/layout/nodeIndex/${domNodeIndex}`,
        "every retained layout node must collapse to a retained ancestor",
      );
    }
    const childOrdinal =
      parentBackendDomNodeId === null
        ? 0
        : (nextOrdinalByParent.get(parentBackendDomNodeId) ?? 0);
    if (parentBackendDomNodeId !== null) {
      nextOrdinalByParent.set(parentBackendDomNodeId, childOrdinal + 1);
    }

    let actionTargetId: string | null = null;
    if (options.target.backendDomNodeId === backendDomNodeId) {
      actionTargetId = options.target.actionTargetId;
    }

    const documentNode = nodeType === 9;
    rawNodes.push(
      Object.freeze({
        backendDomNodeId,
        parentBackendDomNodeId,
        childOrdinal,
        kind: documentNode ? "document" : nodeType === 1 ? "element" : "text",
        bounds: documentNode
          ? viewportBox(options.viewport)
          : viewportBounds(row.bounds, scrollX, scrollY),
        clipBounds: documentNode
          ? viewportBox(options.viewport)
          : overflowClip(row, nodeType, scrollX, scrollY),
        paintOrder: row.paintOrder,
        computedStyle: row.computedStyle,
        actionTargetId,
      }),
    );
    retainedBackendByDomIndex.set(domNodeIndex, backendDomNodeId);
  }

  return normalizeLayoutProbe(Object.freeze({ nodes: Object.freeze(rawNodes) }));
}

function adaptChromiumLayoutSnapshotUnchecked(
  snapshot: unknown,
  rawOptions: ChromiumLayoutAdapterOptions,
): NormalizedLayoutProbe {
  const options = parseOptions(rawOptions);
  const root = record(snapshot, "");
  const strings = parseStringTable(requiredValue(root, "strings", ""));
  const documents = denseArray(
    requiredValue(root, "documents", ""),
    "/documents",
    1,
    1,
  );
  const document = record(documents[0], "/documents/0");
  const documentUrl = stringAt(
    requiredValue(document, "documentURL", "/documents/0"),
    "/documents/0/documentURL",
    strings,
  );
  if (documentUrl !== options.documentUrl) {
    fail(
      "chromium_layout.document_url",
      "/documents/0/documentURL",
      `document URL must be exactly ${options.documentUrl}`,
    );
  }
  const scrollX = finiteNumber(
    requiredValue(document, "scrollOffsetX", "/documents/0"),
    "/documents/0/scrollOffsetX",
  );
  const scrollY = finiteNumber(
    requiredValue(document, "scrollOffsetY", "/documents/0"),
    "/documents/0/scrollOffsetY",
  );
  const nodes = parseNodeTable(
    requiredValue(document, "nodes", "/documents/0"),
    strings,
  );
  const rows = parseLayoutRows(
    requiredValue(document, "layout", "/documents/0"),
    nodes,
    strings,
    options.viewport,
  );
  return assembleProbe(nodes, rows, scrollX, scrollY, options);
}

/**
 * Converts one pinned Chromium DOMSnapshot response into the browser-neutral
 * layout graph. The adapter accepts the exact fixture URL selected by a closed
 * internal document profile, omits pseudo subtrees, and never lets selectors,
 * names, attributes, or raw CDP IDs enter the serialized snapshot.
 */
export function adaptChromiumLayoutSnapshot(
  snapshot: unknown,
  options: ChromiumLayoutAdapterOptions,
): NormalizedLayoutProbe {
  try {
    return adaptChromiumLayoutSnapshotUnchecked(snapshot, options);
  } catch (error: unknown) {
    if (error instanceof ContractValidationError) {
      throw error;
    }
    fail(
      "chromium_layout.input_access",
      "",
      "Chromium snapshot input could not be read as inert data",
    );
  }
}
