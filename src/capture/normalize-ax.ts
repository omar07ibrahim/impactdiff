import { ContractValidationError, issue } from "../contracts/errors.js";
import { ImmutableMapView } from "../contracts/immutable-map.js";
import { accessibilityRoles, accessibilityStates } from "./schema.js";
import type { AccessibilityNode, AccessibilitySnapshot } from "./schema.js";

const accessibilityNormalizationContract = "impactdiff.normalize-accessibility/v1";
const maximumNodes = 4_096;
const maximumDepth = 64;
const maximumBackendDomNodeId = 4_294_967_295;
const maximumInternalIdLength = 256;
const maximumStringLength = 512;

type AccessibilityRole = (typeof accessibilityRoles)[number];
type AccessibilityState = (typeof accessibilityStates)[number];

const roles = new Set<string>(accessibilityRoles);
const roleAliases = new Map<string, AccessibilityRole>([
  ["RootWebArea", "document"],
  ["WebArea", "document"],
  ["StaticText", "text"],
  ["InlineTextBox", "text"],
  ["LineBreak", "text"],
  ["LayoutTable", "table"],
  ["LayoutTableRow", "row"],
  ["LayoutTableCell", "cell"],
  ["DescriptionList", "list"],
  ["sectionheader", "heading"],
  ["strong", "generic"],
  ["none", "generic"],
  ["presentation", "generic"],
]);

interface ParsedRawNode {
  readonly nodeId: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly ignored: boolean;
  readonly backendDomNodeId: number | null;
  readonly source: Record<string, unknown>;
  readonly sourcePath: string;
}

function fail(code: string, path: string, message: string): never {
  throw new ContractValidationError(accessibilityNormalizationContract, [
    issue(code, path, message),
  ]);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("accessibility.object", path, "expected a plain data object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("accessibility.object", path, "expected a plain data object");
  }
  return value as Record<string, unknown>;
}

function ownValue(object: Record<string, unknown>, key: string, path: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined) {
    fail("accessibility.required", `${path}/${key}`, "required field is missing");
  }
  if (!descriptor.enumerable || !("value" in descriptor)) {
    fail(
      "accessibility.data_property",
      `${path}/${key}`,
      "fields must be enumerable data properties",
    );
  }
  return descriptor.value;
}

function optionalOwnValue(
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
      "accessibility.data_property",
      `${path}/${key}`,
      "fields must be enumerable data properties",
    );
  }
  return descriptor.value;
}

function denseArray(
  value: unknown,
  path: string,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("accessibility.array", path, "expected a built-in dense array");
  }
  if (value.length < minimumLength || value.length > maximumLength) {
    fail(
      "accessibility.array_length",
      path,
      `array length must be between ${minimumLength} and ${maximumLength}`,
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
      fail("accessibility.dense_array", `${path}/${index}`, "arrays must be dense");
    }
    result.push(descriptor.value);
  }
  return result;
}

function assertUnicodeScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        fail(
          "accessibility.unpaired_surrogate",
          path,
          "strings cannot contain unpaired Unicode surrogates",
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail(
        "accessibility.unpaired_surrogate",
        path,
        "strings cannot contain unpaired Unicode surrogates",
      );
    }
  }
}

function boundedString(value: string, path: string): string {
  assertUnicodeScalarString(value, path);
  const normalized = value.normalize("NFC");
  if ([...normalized].length > maximumStringLength) {
    fail(
      "accessibility.string_length",
      path,
      `strings cannot exceed ${maximumStringLength} Unicode code points`,
    );
  }
  return normalized;
}

function internalId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("accessibility.node_id", path, "node IDs must be non-empty strings");
  }
  assertUnicodeScalarString(value, path);
  if (value.normalize("NFC") !== value || [...value].length > maximumInternalIdLength) {
    fail(
      "accessibility.node_id",
      path,
      "node IDs must be NFC strings of at most 256 Unicode code points",
    );
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
      "accessibility.integer",
      path,
      `expected an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function unwrapAxValue(value: unknown, path: string): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return ownValue(record(value, path), "value", path);
  }
  return value;
}

function optionalText(
  source: Record<string, unknown>,
  key: string,
  path: string,
  missing: string | null,
  allowPrimitiveConversion: boolean,
): string | null {
  const raw = optionalOwnValue(source, key, path);
  if (raw === undefined || raw === null) {
    return missing;
  }
  const value = unwrapAxValue(raw, `${path}/${key}`);
  if (typeof value === "string") {
    return boundedString(value, `${path}/${key}`);
  }
  if (
    allowPrimitiveConversion &&
    (typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)))
  ) {
    return boundedString(String(value), `${path}/${key}`);
  }
  fail(
    "accessibility.text",
    `${path}/${key}`,
    "accessibility text values must contain a string",
  );
}

function normalizeRole(
  source: Record<string, unknown>,
  path: string,
): AccessibilityRole {
  const raw = unwrapAxValue(ownValue(source, "role", path), `${path}/role`);
  if (typeof raw !== "string") {
    fail("accessibility.role", `${path}/role`, "role must contain a string");
  }
  const alias = roleAliases.get(raw);
  if (alias !== undefined) {
    return alias;
  }
  if (!roles.has(raw)) {
    fail(
      "accessibility.role",
      `${path}/role`,
      "role is outside the normalized accessibility allowlist",
    );
  }
  return raw as AccessibilityRole;
}

function propertyPrimitive(value: unknown, path: string): unknown {
  return unwrapAxValue(value, path);
}

function booleanState(
  value: unknown,
  path: string,
  state: AccessibilityState,
  output: Set<AccessibilityState>,
): void {
  const primitive = propertyPrimitive(value, path);
  if (typeof primitive !== "boolean") {
    fail(
      "accessibility.state_value",
      path,
      "boolean accessibility states must contain booleans",
    );
  }
  if (primitive) {
    output.add(state);
  }
}

function normalizeStates(
  source: Record<string, unknown>,
  path: string,
): AccessibilityState[] {
  const rawProperties = optionalOwnValue(source, "properties", path);
  if (rawProperties === undefined) {
    return [];
  }
  const properties = denseArray(
    rawProperties,
    `${path}/properties`,
    0,
    accessibilityStates.length * 4,
  );
  const seenNames = new Set<string>();
  const states = new Set<AccessibilityState>();

  for (const [index, rawProperty] of properties.entries()) {
    const propertyPath = `${path}/properties/${index}`;
    const property = record(rawProperty, propertyPath);
    const name = ownValue(property, "name", propertyPath);
    if (typeof name !== "string" || name.length === 0 || name.length > 64) {
      fail(
        "accessibility.property_name",
        `${propertyPath}/name`,
        "property names must be bounded non-empty strings",
      );
    }
    if (seenNames.has(name)) {
      fail(
        "accessibility.duplicate_property",
        `${propertyPath}/name`,
        "accessibility property names must be unique per node",
      );
    }
    seenNames.add(name);
    const value = ownValue(property, "value", propertyPath);

    switch (name) {
      case "busy":
      case "disabled":
      case "focused":
      case "hidden":
      case "modal":
      case "multiline":
      case "multiselectable":
      case "readonly":
      case "required":
      case "selected":
        booleanState(value, `${propertyPath}/value`, name, states);
        break;
      case "checked":
      case "pressed": {
        const primitive = propertyPrimitive(value, `${propertyPath}/value`);
        if (primitive === true) {
          states.add(name);
        } else if (primitive === "mixed") {
          states.add(`${name}:mixed`);
        } else if (primitive !== false) {
          fail(
            "accessibility.state_value",
            `${propertyPath}/value`,
            `${name} must be a boolean or mixed`,
          );
        }
        break;
      }
      case "expanded": {
        const primitive = propertyPrimitive(value, `${propertyPath}/value`);
        if (typeof primitive !== "boolean") {
          fail(
            "accessibility.state_value",
            `${propertyPath}/value`,
            "expanded must contain a boolean",
          );
        }
        states.add(primitive ? "expanded" : "collapsed");
        break;
      }
      case "editable": {
        const primitive = propertyPrimitive(value, `${propertyPath}/value`);
        if (
          primitive === true ||
          primitive === "plaintext" ||
          primitive === "richtext"
        ) {
          states.add("editable");
        } else if (primitive !== false && primitive !== "none") {
          fail(
            "accessibility.state_value",
            `${propertyPath}/value`,
            "editable must contain a recognized Chromium value",
          );
        }
        break;
      }
      case "invalid": {
        const primitive = propertyPrimitive(value, `${propertyPath}/value`);
        if (
          primitive === true ||
          primitive === "true" ||
          primitive === "grammar" ||
          primitive === "spelling"
        ) {
          states.add("invalid");
        } else if (primitive !== false && primitive !== "false") {
          fail(
            "accessibility.state_value",
            `${propertyPath}/value`,
            "invalid must contain a recognized Chromium value",
          );
        }
        break;
      }
      default:
        // Unknown Chromium properties are intentionally outside the payload.
        break;
    }
  }
  return [...states].sort();
}

function parseRawNode(value: unknown, index: number): ParsedRawNode {
  const path = `/nodes/${index}`;
  const source = record(value, path);
  const rawParentId = optionalOwnValue(source, "parentId", path);
  const rawChildIds = optionalOwnValue(source, "childIds", path);
  const rawIgnored = optionalOwnValue(source, "ignored", path);
  const rawBackendDomNodeId = optionalOwnValue(source, "backendDOMNodeId", path);
  if (rawIgnored !== undefined && typeof rawIgnored !== "boolean") {
    fail("accessibility.ignored", `${path}/ignored`, "ignored must contain a boolean");
  }

  const childIds =
    rawChildIds === undefined
      ? []
      : denseArray(rawChildIds, `${path}/childIds`, 0, maximumNodes).map(
          (childId, childIndex) =>
            internalId(childId, `${path}/childIds/${childIndex}`),
        );

  return Object.freeze({
    nodeId: internalId(ownValue(source, "nodeId", path), `${path}/nodeId`),
    parentId:
      rawParentId === undefined || rawParentId === null
        ? null
        : internalId(rawParentId, `${path}/parentId`),
    childIds: Object.freeze(childIds),
    ignored: rawIgnored ?? false,
    backendDomNodeId:
      rawBackendDomNodeId === undefined
        ? null
        : integer(
            rawBackendDomNodeId,
            `${path}/backendDOMNodeId`,
            1,
            maximumBackendDomNodeId,
          ),
    source,
    sourcePath: path,
  });
}

function validateLayoutMap(
  value: ReadonlyMap<number, number>,
): ReadonlyMap<number, number> {
  const isBuiltInMap = value instanceof Map;
  const isImmutableView =
    value instanceof ImmutableMapView &&
    Object.getPrototypeOf(value) === ImmutableMapView.prototype;
  if (!isBuiltInMap && !isImmutableView) {
    fail(
      "accessibility.layout_map",
      "/layoutNodeIndices",
      "layout node indices must be supplied as a Map or ImmutableMapView",
    );
  }
  const output = new Map<number, number>();
  const seenIndices = new Set<number>();
  const entries = isBuiltInMap
    ? (Map.prototype.entries.call(value) as IterableIterator<[unknown, unknown]>)
    : (ImmutableMapView.prototype.entries.call(value) as IterableIterator<
        [unknown, unknown]
      >);
  for (const [backendDomNodeId, layoutIndex] of entries) {
    const parsedBackendDomNodeId = integer(
      backendDomNodeId,
      "/layoutNodeIndices/key",
      1,
      maximumBackendDomNodeId,
    );
    const parsedLayoutIndex = integer(
      layoutIndex,
      "/layoutNodeIndices/value",
      0,
      maximumNodes - 1,
    );
    if (seenIndices.has(parsedLayoutIndex)) {
      fail(
        "accessibility.layout_map_alias",
        "/layoutNodeIndices",
        "layout map values must be unique",
      );
    }
    seenIndices.add(parsedLayoutIndex);
    output.set(parsedBackendDomNodeId, parsedLayoutIndex);
  }
  return output;
}

function assertAcyclic(
  nodes: readonly ParsedRawNode[],
  parentByChild: ReadonlyMap<string, string>,
): void {
  const complete = new Set<string>();
  for (const start of nodes) {
    const active = new Set<string>();
    const path: string[] = [];
    let currentId: string | undefined = start.nodeId;
    while (currentId !== undefined && !complete.has(currentId)) {
      if (active.has(currentId)) {
        fail(
          "accessibility.cycle",
          "/nodes",
          "accessibility child relationships cannot contain cycles",
        );
      }
      active.add(currentId);
      path.push(currentId);
      currentId = parentByChild.get(currentId);
    }
    for (const nodeId of path) {
      complete.add(nodeId);
    }
  }
}

function normalizeAccessibilitySnapshotUnchecked(
  input: unknown,
  rawLayoutNodeIndices: ReadonlyMap<number, number>,
): AccessibilitySnapshot {
  const layoutNodeIndices = validateLayoutMap(rawLayoutNodeIndices);
  const rootInput = record(input, "");
  const rawNodes = denseArray(
    ownValue(rootInput, "nodes", ""),
    "/nodes",
    1,
    maximumNodes,
  );
  const nodes = rawNodes.map((node, index) => parseRawNode(node, index));
  const byId = new Map<string, ParsedRawNode>();
  for (const node of nodes) {
    if (byId.has(node.nodeId)) {
      fail(
        "accessibility.duplicate_node_id",
        "/nodes",
        "accessibility node IDs must be unique",
      );
    }
    byId.set(node.nodeId, node);
  }

  const parentByChild = new Map<string, string>();
  for (const node of nodes) {
    const localChildren = new Set<string>();
    for (const childId of node.childIds) {
      if (!byId.has(childId)) {
        fail(
          "accessibility.dangling_child",
          node.sourcePath,
          "every child ID must resolve in the probe",
        );
      }
      if (localChildren.has(childId) || parentByChild.has(childId)) {
        fail(
          "accessibility.duplicate_child",
          node.sourcePath,
          "each accessibility node must occur under exactly one parent",
        );
      }
      localChildren.add(childId);
      parentByChild.set(childId, node.nodeId);
    }
  }

  for (const node of nodes) {
    const derivedParent = parentByChild.get(node.nodeId) ?? null;
    if (node.parentId !== null && !byId.has(node.parentId)) {
      fail(
        "accessibility.dangling_parent",
        node.sourcePath,
        "every parent ID must resolve in the probe",
      );
    }
    if (node.parentId !== null && node.parentId !== derivedParent) {
      fail(
        "accessibility.parent_mismatch",
        node.sourcePath,
        "parentId must agree with the ordered childIds graph",
      );
    }
  }
  assertAcyclic(nodes, parentByChild);

  const roots = nodes.filter((node) => !parentByChild.has(node.nodeId));
  if (roots.length !== 1) {
    fail(
      "accessibility.root_count",
      "/nodes",
      "accessibility probes must have exactly one root",
    );
  }
  const root = roots[0];
  if (root === undefined || root.ignored) {
    fail("accessibility.root", "/nodes", "the accessibility root must be retained");
  }

  interface RawPending {
    readonly node: ParsedRawNode;
    readonly depth: number;
  }
  const rawPending: RawPending[] = [{ node: root, depth: 0 }];
  let rawVisited = 0;
  while (rawPending.length > 0) {
    const current = rawPending.pop();
    if (current === undefined) {
      continue;
    }
    rawVisited += 1;
    if (current.depth > maximumDepth) {
      fail(
        "accessibility.depth",
        "/nodes",
        `accessibility depth cannot exceed ${maximumDepth} edges`,
      );
    }
    for (let index = current.node.childIds.length - 1; index >= 0; index -= 1) {
      const childId = current.node.childIds[index];
      const child = childId === undefined ? undefined : byId.get(childId);
      if (child !== undefined) {
        rawPending.push({ node: child, depth: current.depth + 1 });
      }
    }
  }
  if (rawVisited !== nodes.length) {
    fail(
      "accessibility.disconnected",
      "/nodes",
      "all accessibility nodes must be root-reachable",
    );
  }

  const retainedChildren = (node: ParsedRawNode): ParsedRawNode[] => {
    const output: ParsedRawNode[] = [];
    const pending = [...node.childIds].reverse();
    while (pending.length > 0) {
      const childId = pending.pop();
      const child = childId === undefined ? undefined : byId.get(childId);
      if (child === undefined) {
        continue;
      }
      if (!child.ignored) {
        output.push(child);
      } else {
        for (let index = child.childIds.length - 1; index >= 0; index -= 1) {
          const grandchildId = child.childIds[index];
          if (grandchildId !== undefined) {
            pending.push(grandchildId);
          }
        }
      }
    }
    return output;
  };

  interface PendingNode {
    readonly node: ParsedRawNode;
    readonly parentIndex: number | null;
    readonly childOrdinal: number;
    readonly depth: number;
  }
  const pending: PendingNode[] = [
    { node: root, parentIndex: null, childOrdinal: 0, depth: 0 },
  ];
  const normalizedNodes: AccessibilityNode[] = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    if (current.depth > maximumDepth) {
      fail(
        "accessibility.depth",
        "/nodes",
        `accessibility depth cannot exceed ${maximumDepth} edges`,
      );
    }
    const role = normalizeRole(current.node.source, current.node.sourcePath);
    const index = normalizedNodes.length;
    const backendDomNodeId = current.node.backendDomNodeId;
    const layoutNodeIndex =
      backendDomNodeId === null ? null : layoutNodeIndices.get(backendDomNodeId);
    if (backendDomNodeId !== null && layoutNodeIndex === undefined) {
      fail(
        "accessibility.dangling_layout_node",
        current.node.sourcePath,
        "backend DOM links must resolve only through the supplied layout map",
      );
    }
    const states = normalizeStates(current.node.source, current.node.sourcePath);
    Object.freeze(states);
    normalizedNodes.push(
      Object.freeze({
        index,
        parent_index: current.parentIndex,
        child_ordinal: current.childOrdinal,
        role,
        name:
          optionalText(
            current.node.source,
            "name",
            current.node.sourcePath,
            "",
            false,
          ) ?? "",
        description: optionalText(
          current.node.source,
          "description",
          current.node.sourcePath,
          null,
          false,
        ),
        value: optionalText(
          current.node.source,
          "value",
          current.node.sourcePath,
          null,
          true,
        ),
        states,
        layout_node_index: layoutNodeIndex ?? null,
      }),
    );

    const children = retainedChildren(current.node);
    for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = children[childIndex];
      if (child !== undefined) {
        pending.push({
          node: child,
          parentIndex: index,
          childOrdinal: childIndex,
          depth: current.depth + 1,
        });
      }
    }
  }

  if (normalizedNodes.length === 0 || normalizedNodes[0]?.role !== "document") {
    fail(
      "accessibility.root_role",
      "/nodes",
      "the normalized accessibility root must have the document role",
    );
  }
  Object.freeze(normalizedNodes);
  return Object.freeze({
    contract: "impactdiff.accessibility" as const,
    version: 1 as const,
    root_index: 0 as const,
    nodes: normalizedNodes,
  });
}

export function normalizeAccessibilitySnapshot(
  input: unknown,
  layoutNodeIndices: ReadonlyMap<number, number>,
): AccessibilitySnapshot {
  try {
    return normalizeAccessibilitySnapshotUnchecked(input, layoutNodeIndices);
  } catch (error: unknown) {
    if (error instanceof ContractValidationError) {
      throw error;
    }
    fail(
      "accessibility.input_access",
      "",
      "accessibility input could not be read as inert data",
    );
  }
}
