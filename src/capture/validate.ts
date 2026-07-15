import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

import { parseCanonicalJson } from "../contracts/canonical.js";
import type { ParseLimits } from "../contracts/canonical.js";
import { assertNoIssues, issue } from "../contracts/errors.js";
import type { ContractIssue } from "../contracts/errors.js";
import { normalizedSchemaValue } from "../contracts/input.js";
import { maximumCapturePixels } from "./limits.js";
import {
  accessibilitySnapshotSchema,
  actionPlanSchema,
  captureSpecSchema,
  layoutSnapshotSchema,
} from "./schema.js";
import type {
  AccessibilitySnapshot,
  ActionPlan,
  CaptureSpec,
  LayoutSnapshot,
} from "./schema.js";

const actionPlanContract = "impactdiff.action-plan/v1";
const captureSpecContract = "impactdiff.capture-spec/v1";
const accessibilityContract = "impactdiff.accessibility/v1";
const layoutContract = "impactdiff.layout/v1";
const graphBindingContract = "impactdiff.capture-graph-binding/v1";

const ajv = new Ajv2020({ allErrors: true, ownProperties: true, strict: true });
const actionPlanValidator = ajv.compile<ActionPlan>(actionPlanSchema);
const captureSpecValidator = ajv.compile<CaptureSpec>(captureSpecSchema);
const accessibilityValidator = ajv.compile<AccessibilitySnapshot>(
  accessibilitySnapshotSchema,
);
const layoutValidator = ajv.compile<LayoutSnapshot>(layoutSnapshotSchema);

const actionPlanLimits = {
  maximumBytes: 131_072,
  maximumDepth: 12,
  maximumValues: 10_000,
} as const satisfies ParseLimits;

const captureSpecLimits = {
  maximumBytes: 65_536,
  maximumDepth: 12,
  maximumValues: 2_000,
} as const satisfies ParseLimits;

const accessibilityLimits = {
  maximumBytes: 2_097_152,
  maximumDepth: 12,
  maximumValues: 150_000,
} as const satisfies ParseLimits;

const layoutLimits = {
  maximumBytes: 4_194_304,
  maximumDepth: 12,
  maximumValues: 250_000,
} as const satisfies ParseLimits;

function decodeCanonical<T>(
  contract: string,
  validator: ValidateFunction<T>,
  input: string | Uint8Array,
  limits: ParseLimits,
): T {
  const value = parseCanonicalJson(input, limits);
  return normalizedSchemaValue(contract, validator, value);
}

function actionPlanIssues(plan: ActionPlan): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const actionIds = new Set<string>();

  for (const [index, action] of plan.actions.entries()) {
    if (action.ordinal !== index) {
      issues.push(
        issue(
          "action_plan.action_order",
          `/actions/${index}/ordinal`,
          "action ordinals must be contiguous and zero-based",
        ),
      );
    }
    if (actionIds.has(action.action_id)) {
      issues.push(
        issue(
          "action_plan.duplicate_action_id",
          `/actions/${index}/action_id`,
          "action IDs must be unique within a plan",
        ),
      );
    }
    actionIds.add(action.action_id);
  }

  for (const [index, checkpoint] of plan.checkpoints.entries()) {
    if (checkpoint.ordinal !== index) {
      issues.push(
        issue(
          "action_plan.checkpoint_order",
          `/checkpoints/${index}/ordinal`,
          "checkpoint ordinals must be contiguous and zero-based",
        ),
      );
    }
    if (checkpoint.after_action_ordinal >= plan.actions.length) {
      issues.push(
        issue(
          "action_plan.checkpoint_out_of_range",
          `/checkpoints/${index}/after_action_ordinal`,
          "a checkpoint boundary must refer to an action in this plan",
        ),
      );
    }
    const previous = plan.checkpoints[index - 1];
    if (
      previous !== undefined &&
      checkpoint.after_action_ordinal <= previous.after_action_ordinal
    ) {
      issues.push(
        issue(
          "action_plan.checkpoint_schedule_order",
          `/checkpoints/${index}/after_action_ordinal`,
          "checkpoint boundaries must be strictly increasing",
        ),
      );
    }
  }

  if (plan.checkpoints[0]?.after_action_ordinal !== -1) {
    issues.push(
      issue(
        "action_plan.initial_checkpoint",
        "/checkpoints/0/after_action_ordinal",
        "the first checkpoint must be scheduled before the first action",
      ),
    );
  }
  const lastCheckpoint = plan.checkpoints.at(-1);
  if (lastCheckpoint?.after_action_ordinal !== plan.actions.length - 1) {
    issues.push(
      issue(
        "action_plan.final_checkpoint",
        `/checkpoints/${plan.checkpoints.length - 1}/after_action_ordinal`,
        "the final checkpoint must be scheduled after the final action",
      ),
    );
  }

  return issues;
}

function captureSpecIssues(spec: CaptureSpec): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const fontNames = new Set<string>();
  let priorFontName: string | undefined;

  for (const [index, font] of spec.fonts.files.entries()) {
    const path = `/fonts/files/${index}/logical_name`;
    if (fontNames.has(font.logical_name)) {
      issues.push(
        issue(
          "capture_spec.duplicate_font",
          path,
          "font logical names must be unique within the closed bundle",
        ),
      );
    }
    if (priorFontName !== undefined && font.logical_name <= priorFontName) {
      issues.push(
        issue(
          "capture_spec.font_order",
          path,
          "font files must be strictly sorted by logical name",
        ),
      );
    }
    fontNames.add(font.logical_name);
    priorFontName = font.logical_name;
  }

  if (
    spec.display.viewport.width * spec.display.viewport.height >
    maximumCapturePixels
  ) {
    issues.push(
      issue(
        "capture_spec.pixel_budget",
        "/display/viewport",
        `the viewport cannot exceed ${maximumCapturePixels} CSS pixels`,
      ),
    );
  }
  if (
    spec.display.viewport.width !== spec.display.screen.width ||
    spec.display.viewport.height !== spec.display.screen.height
  ) {
    issues.push(
      issue(
        "capture_spec.screen_mismatch",
        "/display/screen",
        "screen and viewport dimensions must be identical",
      ),
    );
  }

  if (spec.budgets.action_timeout_ms > spec.budgets.readiness_timeout_ms) {
    issues.push(
      issue(
        "capture_spec.action_timeout",
        "/budgets/action_timeout_ms",
        "the action timeout cannot exceed the readiness timeout",
      ),
    );
  }
  if (spec.budgets.readiness_timeout_ms > spec.budgets.navigation_timeout_ms) {
    issues.push(
      issue(
        "capture_spec.readiness_timeout",
        "/budgets/readiness_timeout_ms",
        "the readiness timeout cannot exceed the navigation timeout",
      ),
    );
  }
  return issues;
}

interface PreorderNode {
  readonly index: number;
  readonly parent_index: number | null;
  readonly child_ordinal: number;
}

function preorderIssues(
  namespace: "accessibility" | "layout",
  nodes: readonly PreorderNode[],
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const depths: number[] = [];
  const childCounts = new Map<number, number>();

  for (const [index, node] of nodes.entries()) {
    const path = `/nodes/${index}`;
    if (node.index !== index) {
      issues.push(
        issue(
          `${namespace}.node_index`,
          `${path}/index`,
          "node indices must equal their preorder array positions",
        ),
      );
    }

    if (index === 0) {
      depths.push(0);
      if (node.parent_index !== null) {
        issues.push(
          issue(
            `${namespace}.root_parent`,
            `${path}/parent_index`,
            "the root node cannot have a parent",
          ),
        );
      }
      if (node.child_ordinal !== 0) {
        issues.push(
          issue(
            `${namespace}.root_ordinal`,
            `${path}/child_ordinal`,
            "the root child ordinal must be zero",
          ),
        );
      }
      continue;
    }

    const parentIndex = node.parent_index;
    if (parentIndex === null || parentIndex < 0 || parentIndex >= nodes.length) {
      depths.push(0);
      issues.push(
        issue(
          `${namespace}.dangling_parent`,
          `${path}/parent_index`,
          "every non-root node must reference an existing parent",
        ),
      );
      continue;
    }
    if (parentIndex >= index) {
      depths.push(0);
      issues.push(
        issue(
          `${namespace}.parent_order`,
          `${path}/parent_index`,
          "parents must precede children; forward edges and cycles are forbidden",
        ),
      );
      continue;
    }

    const ancestors = new Set<number>();
    let ancestorIndex: number | null = index - 1;
    while (ancestorIndex !== null && !ancestors.has(ancestorIndex)) {
      ancestors.add(ancestorIndex);
      ancestorIndex = nodes[ancestorIndex]?.parent_index ?? null;
    }
    if (!ancestors.has(parentIndex)) {
      issues.push(
        issue(
          `${namespace}.preorder`,
          `${path}/parent_index`,
          "a closed subtree cannot be reopened later in preorder",
        ),
      );
    }

    const expectedChildOrdinal = childCounts.get(parentIndex) ?? 0;
    if (node.child_ordinal !== expectedChildOrdinal) {
      issues.push(
        issue(
          `${namespace}.child_order`,
          `${path}/child_ordinal`,
          "sibling ordinals must be contiguous and zero-based",
        ),
      );
    }
    childCounts.set(parentIndex, expectedChildOrdinal + 1);

    const depth = (depths[parentIndex] ?? 0) + 1;
    depths.push(depth);
    if (depth > 64) {
      issues.push(
        issue(
          `${namespace}.depth`,
          path,
          "graph depth cannot exceed 64 edges from the root",
        ),
      );
    }
  }

  return issues;
}

function accessibilityIssues(snapshot: AccessibilitySnapshot): ContractIssue[] {
  const issues = preorderIssues("accessibility", snapshot.nodes);
  if (snapshot.nodes[0]?.role !== "document") {
    issues.push(
      issue(
        "accessibility.root_role",
        "/nodes/0/role",
        "the accessibility root must have the document role",
      ),
    );
  }

  for (const [index, node] of snapshot.nodes.entries()) {
    const sortedStates = [...node.states].sort();
    if (node.states.some((state, stateIndex) => state !== sortedStates[stateIndex])) {
      issues.push(
        issue(
          "accessibility.state_order",
          `/nodes/${index}/states`,
          "accessibility states must be sorted lexicographically",
        ),
      );
    }
  }
  return issues;
}

function layoutIssues(snapshot: LayoutSnapshot): ContractIssue[] {
  const issues = preorderIssues("layout", snapshot.nodes);
  const actionTargetIds = new Set<string>();

  if (snapshot.nodes[0]?.kind !== "document") {
    issues.push(
      issue(
        "layout.root_kind",
        "/nodes/0/kind",
        "the layout root must have the document kind",
      ),
    );
  }

  for (const [index, node] of snapshot.nodes.entries()) {
    const targetId = node.action_target_id;
    if (targetId === null) {
      continue;
    }
    if (node.kind !== "element") {
      issues.push(
        issue(
          "layout.action_target_kind",
          `/nodes/${index}/action_target_id`,
          "only element nodes can expose an action target ID",
        ),
      );
    }
    if (actionTargetIds.has(targetId)) {
      issues.push(
        issue(
          "layout.duplicate_action_target",
          `/nodes/${index}/action_target_id`,
          "action target IDs must resolve to exactly one layout node",
        ),
      );
    }
    actionTargetIds.add(targetId);
  }
  return issues;
}

export function parseActionPlan(input: string | Uint8Array): ActionPlan {
  const plan = decodeCanonical(
    actionPlanContract,
    actionPlanValidator,
    input,
    actionPlanLimits,
  );
  const issues = actionPlanIssues(plan);
  assertNoIssues(actionPlanContract, issues);
  return plan;
}

export function parseCaptureSpec(input: string | Uint8Array): CaptureSpec {
  const spec = decodeCanonical(
    captureSpecContract,
    captureSpecValidator,
    input,
    captureSpecLimits,
  );
  const issues = captureSpecIssues(spec);
  assertNoIssues(captureSpecContract, issues);
  return spec;
}

export function parseAccessibilitySnapshot(
  input: string | Uint8Array,
): AccessibilitySnapshot {
  const snapshot = decodeCanonical(
    accessibilityContract,
    accessibilityValidator,
    input,
    accessibilityLimits,
  );
  const issues = accessibilityIssues(snapshot);
  assertNoIssues(accessibilityContract, issues);
  return snapshot;
}

export function parseLayoutSnapshot(input: string | Uint8Array): LayoutSnapshot {
  const snapshot = decodeCanonical(
    layoutContract,
    layoutValidator,
    input,
    layoutLimits,
  );
  const issues = layoutIssues(snapshot);
  assertNoIssues(layoutContract, issues);
  return snapshot;
}

export function assertCaptureGraphBindings(
  actionPlan: ActionPlan,
  accessibility: AccessibilitySnapshot,
  layout: LayoutSnapshot,
): void {
  const issues: ContractIssue[] = [];
  const layoutTargets = new Map<string, number>();
  const actionTargets = new Set(
    actionPlan.actions.flatMap((action) =>
      action.target_id === null ? [] : [action.target_id],
    ),
  );

  for (const node of layout.nodes) {
    if (node.action_target_id !== null) {
      layoutTargets.set(node.action_target_id, node.index);
    }
  }

  // A checkpoint is an observation of one point in a state-changing task. A
  // target may be created by an earlier action or removed by the action that
  // just completed, so absence from one checkpoint is not a binding failure.
  // The executor and sealed trace own action-time target resolution. This
  // boundary only prevents a layout payload from introducing target IDs that
  // were never declared by the action plan.
  for (const [targetId, nodeIndex] of layoutTargets) {
    if (!actionTargets.has(targetId)) {
      issues.push(
        issue(
          "capture_binding.unexpected_action_target",
          `/layout/nodes/${nodeIndex}/action_target_id`,
          "the layout graph cannot expose targets absent from the action plan",
        ),
      );
    }
  }

  for (const [index, node] of accessibility.nodes.entries()) {
    if (
      node.layout_node_index !== null &&
      node.layout_node_index >= layout.nodes.length
    ) {
      issues.push(
        issue(
          "capture_binding.dangling_layout_link",
          `/accessibility/nodes/${index}/layout_node_index`,
          "accessibility layout links must resolve in the paired layout graph",
        ),
      );
    }
  }

  assertNoIssues(graphBindingContract, issues);
}
