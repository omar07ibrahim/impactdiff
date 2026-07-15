import { ContractValidationError, issue } from "../contracts/errors.js";
import { ImmutableMapView } from "../contracts/immutable-map.js";
import type { LayoutNode, LayoutSnapshot } from "./schema.js";
import {
  maximumQ64Coordinate,
  quantizeCssPixelToQ64,
  roundNearestTiesToEven,
} from "./quantize.js";

const layoutNormalizationContract = "impactdiff.normalize-layout/v1";
const maximumNodes = 4_096;
const maximumDepth = 64;
const maximumBackendDomNodeId = 4_294_967_295;
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
const kindValues = ["document", "element", "text"] as const;

type Display = (typeof displayValues)[number];
type Position = (typeof positionValues)[number];
type Visibility = (typeof visibilityValues)[number];
type PointerEvents = (typeof pointerEventValues)[number];
type Overflow = (typeof overflowValues)[number];
type LayoutKind = (typeof kindValues)[number];

export interface RawLayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RawLayoutComputedStyle {
  readonly display: Display;
  readonly position: Position;
  readonly visibility: Visibility;
  readonly pointerEvents: PointerEvents;
  readonly overflowX: Overflow;
  readonly overflowY: Overflow;
  readonly opacity: number;
  readonly zIndex: number | null;
}

/**
 * A deliberately small adapter boundary. Browser-specific selectors, DOM
 * paths, attributes, class names and frontend object identities have no field
 * here and therefore cannot enter the normalized payload.
 */
export interface RawLayoutNode {
  readonly backendDomNodeId: number;
  readonly parentBackendDomNodeId: number | null;
  readonly childOrdinal: number;
  readonly kind: LayoutKind;
  readonly bounds: RawLayoutBox;
  readonly clipBounds: RawLayoutBox | null;
  readonly paintOrder: number;
  readonly computedStyle: RawLayoutComputedStyle;
  readonly actionTargetId: string | null;
}

export interface RawLayoutProbe {
  readonly nodes: readonly RawLayoutNode[];
}

export interface NormalizedLayoutProbe {
  readonly snapshot: LayoutSnapshot;
  readonly backendDomNodeToLayoutIndex: ReadonlyMap<number, number>;
}

interface ParsedBox {
  readonly x_q64: number;
  readonly y_q64: number;
  readonly width_q64: number;
  readonly height_q64: number;
}

interface ParsedStyle {
  readonly display: Display;
  readonly position: Position;
  readonly visibility: Visibility;
  readonly pointer_events: PointerEvents;
  readonly overflow_x: Overflow;
  readonly overflow_y: Overflow;
  readonly opacity_milli: number;
  readonly z_index: number | null;
}

interface ParsedNode {
  readonly backendDomNodeId: number;
  readonly parentBackendDomNodeId: number | null;
  readonly childOrdinal: number;
  readonly kind: LayoutKind;
  readonly bounds: ParsedBox;
  readonly clipBounds: ParsedBox | null;
  readonly rawPaintOrder: number;
  readonly computedStyle: ParsedStyle;
  readonly actionTargetId: string | null;
}

function fail(code: string, path: string, message: string): never {
  throw new ContractValidationError(layoutNormalizationContract, [
    issue(code, path, message),
  ]);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("layout.object", path, "expected a plain data object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("layout.object", path, "expected a plain data object");
  }
  return value as Record<string, unknown>;
}

function ownValue(object: Record<string, unknown>, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    fail("layout.required", `${path}/${key}`, "required field is missing");
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    fail(
      "layout.data_property",
      `${path}/${key}`,
      "fields must be enumerable data properties",
    );
  }
  return descriptor.value;
}

function denseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("layout.array", path, "expected a built-in dense array");
  }
  if (value.length < 1 || value.length > maximumNodes) {
    fail(
      "layout.node_count",
      path,
      `layout probes must contain between 1 and ${maximumNodes} nodes`,
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
      fail("layout.dense_array", `${path}/${index}`, "arrays must be dense");
    }
    result.push(descriptor.value);
  }
  return result;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("layout.finite_number", path, "expected a finite number");
  }
  return value;
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
      "layout.integer",
      path,
      `expected an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function enumeration<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    fail("layout.enum", path, `expected one of: ${values.join(", ")}`);
  }
  return value as Values[number];
}

function parseBackendDomNodeId(value: unknown, path: string): number {
  return integer(value, path, 1, maximumBackendDomNodeId);
}

function parseBox(value: unknown, path: string): ParsedBox {
  const input = record(value, path);
  const x = finiteNumber(ownValue(input, "x", path), `${path}/x`);
  const y = finiteNumber(ownValue(input, "y", path), `${path}/y`);
  const width = finiteNumber(ownValue(input, "width", path), `${path}/width`);
  const height = finiteNumber(ownValue(input, "height", path), `${path}/height`);
  if (width < 0 || height < 0) {
    fail("layout.negative_size", path, "box width and height cannot be negative");
  }

  const parsed = {
    x_q64: quantizeCssPixelToQ64(x),
    y_q64: quantizeCssPixelToQ64(y),
    width_q64: quantizeCssPixelToQ64(width),
    height_q64: quantizeCssPixelToQ64(height),
  };
  if (
    parsed.width_q64 < 0 ||
    parsed.width_q64 > maximumQ64Coordinate ||
    parsed.height_q64 < 0 ||
    parsed.height_q64 > maximumQ64Coordinate
  ) {
    fail("layout.box_range", path, "quantized box size is out of range");
  }
  return Object.freeze(parsed);
}

function parseStyle(value: unknown, path: string): ParsedStyle {
  const input = record(value, path);
  const opacity = finiteNumber(ownValue(input, "opacity", path), `${path}/opacity`);
  if (opacity < 0 || opacity > 1) {
    fail("layout.opacity", `${path}/opacity`, "opacity must be between 0 and 1");
  }
  const rawZIndex = ownValue(input, "zIndex", path);
  const zIndex =
    rawZIndex === null
      ? null
      : integer(rawZIndex, `${path}/zIndex`, -2_147_483_648, 2_147_483_647);

  return Object.freeze({
    display: enumeration(
      ownValue(input, "display", path),
      `${path}/display`,
      displayValues,
    ),
    position: enumeration(
      ownValue(input, "position", path),
      `${path}/position`,
      positionValues,
    ),
    visibility: enumeration(
      ownValue(input, "visibility", path),
      `${path}/visibility`,
      visibilityValues,
    ),
    pointer_events: enumeration(
      ownValue(input, "pointerEvents", path),
      `${path}/pointerEvents`,
      pointerEventValues,
    ),
    overflow_x: enumeration(
      ownValue(input, "overflowX", path),
      `${path}/overflowX`,
      overflowValues,
    ),
    overflow_y: enumeration(
      ownValue(input, "overflowY", path),
      `${path}/overflowY`,
      overflowValues,
    ),
    opacity_milli: roundNearestTiesToEven(opacity * 1_000),
    z_index: zIndex,
  });
}

function parseNode(value: unknown, index: number): ParsedNode {
  const path = `/nodes/${index}`;
  const input = record(value, path);
  const rawParent = ownValue(input, "parentBackendDomNodeId", path);
  const rawClipBounds = ownValue(input, "clipBounds", path);
  const rawActionTargetId = ownValue(input, "actionTargetId", path);
  if (
    rawActionTargetId !== null &&
    (typeof rawActionTargetId !== "string" ||
      !actionTargetPattern.test(rawActionTargetId))
  ) {
    fail(
      "layout.action_target_id",
      `${path}/actionTargetId`,
      "action target IDs must use the idat1_ SHA-256 form",
    );
  }

  return Object.freeze({
    backendDomNodeId: parseBackendDomNodeId(
      ownValue(input, "backendDomNodeId", path),
      `${path}/backendDomNodeId`,
    ),
    parentBackendDomNodeId:
      rawParent === null
        ? null
        : parseBackendDomNodeId(rawParent, `${path}/parentBackendDomNodeId`),
    childOrdinal: integer(
      ownValue(input, "childOrdinal", path),
      `${path}/childOrdinal`,
      0,
      maximumNodes - 1,
    ),
    kind: enumeration(ownValue(input, "kind", path), `${path}/kind`, kindValues),
    bounds: parseBox(ownValue(input, "bounds", path), `${path}/bounds`),
    clipBounds:
      rawClipBounds === null ? null : parseBox(rawClipBounds, `${path}/clipBounds`),
    rawPaintOrder: integer(
      ownValue(input, "paintOrder", path),
      `${path}/paintOrder`,
      0,
      4_294_967_295,
    ),
    computedStyle: parseStyle(
      ownValue(input, "computedStyle", path),
      `${path}/computedStyle`,
    ),
    actionTargetId: rawActionTargetId,
  });
}

function assertAcyclic(
  nodes: readonly ParsedNode[],
  byId: ReadonlyMap<number, ParsedNode>,
) {
  const complete = new Set<number>();
  for (const start of nodes) {
    const active = new Set<number>();
    const path: number[] = [];
    let current: ParsedNode | undefined = start;

    while (current !== undefined && !complete.has(current.backendDomNodeId)) {
      if (active.has(current.backendDomNodeId)) {
        fail(
          "layout.cycle",
          "/nodes",
          "layout parent relationships cannot contain cycles",
        );
      }
      active.add(current.backendDomNodeId);
      path.push(current.backendDomNodeId);
      current =
        current.parentBackendDomNodeId === null
          ? undefined
          : byId.get(current.parentBackendDomNodeId);
    }
    for (const backendDomNodeId of path) {
      complete.add(backendDomNodeId);
    }
  }
}

function normalizeLayoutProbeUnchecked(input: unknown): NormalizedLayoutProbe {
  const rootInput = record(input, "");
  const rawNodes = denseArray(ownValue(rootInput, "nodes", ""), "/nodes");
  const nodes = rawNodes.map((node, index) => parseNode(node, index));
  const byId = new Map<number, ParsedNode>();

  for (const node of nodes) {
    if (byId.has(node.backendDomNodeId)) {
      fail(
        "layout.duplicate_backend_node",
        "/nodes",
        "backend DOM node IDs must be unique",
      );
    }
    byId.set(node.backendDomNodeId, node);
  }

  for (const node of nodes) {
    if (
      node.parentBackendDomNodeId !== null &&
      !byId.has(node.parentBackendDomNodeId)
    ) {
      fail(
        "layout.dangling_parent",
        "/nodes",
        "every parent backend DOM node ID must resolve in the probe",
      );
    }
  }
  assertAcyclic(nodes, byId);

  const roots = nodes.filter((node) => node.parentBackendDomNodeId === null);
  if (roots.length !== 1) {
    fail("layout.root_count", "/nodes", "layout probes must have exactly one root");
  }
  const root = roots[0];
  if (root === undefined || root.kind !== "document" || root.childOrdinal !== 0) {
    fail(
      "layout.root",
      "/nodes",
      "the root must be a document with child ordinal zero",
    );
  }

  const children = new Map<number, ParsedNode[]>();
  const actionTargets = new Set<string>();
  for (const node of nodes) {
    if (node !== root && node.kind === "document") {
      fail("layout.document_kind", "/nodes", "only the root may be a document");
    }
    if (node.actionTargetId !== null) {
      if (node.kind !== "element") {
        fail(
          "layout.action_target_kind",
          "/nodes",
          "only elements may expose action target IDs",
        );
      }
      if (actionTargets.has(node.actionTargetId)) {
        fail(
          "layout.duplicate_action_target",
          "/nodes",
          "action target IDs must be unique",
        );
      }
      actionTargets.add(node.actionTargetId);
    }
    if (node.parentBackendDomNodeId !== null) {
      const siblings = children.get(node.parentBackendDomNodeId) ?? [];
      siblings.push(node);
      children.set(node.parentBackendDomNodeId, siblings);
    }
  }

  for (const [parentId, siblings] of children) {
    siblings.sort(
      (left, right) =>
        left.childOrdinal - right.childOrdinal ||
        left.backendDomNodeId - right.backendDomNodeId,
    );
    for (const [ordinal, child] of siblings.entries()) {
      if (child.childOrdinal !== ordinal) {
        fail(
          "layout.child_ordinal",
          "/nodes",
          "sibling child ordinals must be unique, contiguous and zero-based",
        );
      }
    }
    if (byId.get(parentId)?.kind === "text" && siblings.length > 0) {
      fail("layout.text_children", "/nodes", "text nodes cannot have children");
    }
  }

  const paintRanks = new Map<number, number>();
  const paintOrders = [...new Set(nodes.map((node) => node.rawPaintOrder))].sort(
    (left, right) => left - right,
  );
  for (const [rank, paintOrder] of paintOrders.entries()) {
    paintRanks.set(paintOrder, rank);
  }

  interface PendingNode {
    readonly node: ParsedNode;
    readonly parentIndex: number | null;
    readonly depth: number;
  }
  const pending: PendingNode[] = [{ node: root, parentIndex: null, depth: 0 }];
  const normalizedNodes: LayoutNode[] = [];
  const backendDomNodeToLayoutIndex = new Map<number, number>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    if (current.depth > maximumDepth) {
      fail(
        "layout.depth",
        "/nodes",
        `layout depth cannot exceed ${maximumDepth} edges`,
      );
    }
    const index = normalizedNodes.length;
    backendDomNodeToLayoutIndex.set(current.node.backendDomNodeId, index);
    normalizedNodes.push(
      Object.freeze({
        index,
        parent_index: current.parentIndex,
        child_ordinal: current.parentIndex === null ? 0 : current.node.childOrdinal,
        kind: current.node.kind,
        bounds: current.node.bounds,
        clip_bounds: current.node.clipBounds,
        paint_order: paintRanks.get(current.node.rawPaintOrder) ?? 0,
        computed_style: current.node.computedStyle,
        action_target_id: current.node.actionTargetId,
      }),
    );

    const childNodes = children.get(current.node.backendDomNodeId) ?? [];
    for (let childIndex = childNodes.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = childNodes[childIndex];
      if (child !== undefined) {
        pending.push({ node: child, parentIndex: index, depth: current.depth + 1 });
      }
    }
  }

  if (normalizedNodes.length !== nodes.length) {
    fail("layout.disconnected", "/nodes", "all layout nodes must be root-reachable");
  }

  Object.freeze(normalizedNodes);
  const snapshot: LayoutSnapshot = Object.freeze({
    contract: "impactdiff.layout" as const,
    version: 1 as const,
    root_index: 0 as const,
    nodes: normalizedNodes,
  });
  return Object.freeze({
    snapshot,
    backendDomNodeToLayoutIndex: new ImmutableMapView(backendDomNodeToLayoutIndex),
  });
}

export function normalizeLayoutProbe(input: unknown): NormalizedLayoutProbe {
  try {
    return normalizeLayoutProbeUnchecked(input);
  } catch (error: unknown) {
    if (error instanceof ContractValidationError) {
      throw error;
    }
    fail("layout.input_access", "", "layout input could not be read as inert data");
  }
}

export function normalizeLayoutSnapshot(input: unknown): LayoutSnapshot {
  return normalizeLayoutProbe(input).snapshot;
}
