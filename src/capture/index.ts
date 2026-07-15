export {
  accessibilityRoles,
  accessibilitySnapshotSchema,
  accessibilityStates,
  actionPlanSchema,
  captureSpecSchema,
  layoutSnapshotSchema,
} from "./schema.js";
export type {
  AccessibilityNode,
  AccessibilitySnapshot,
  ActionPlan,
  CaptureSpec,
  LayoutNode,
  LayoutSnapshot,
} from "./schema.js";
export {
  assertCaptureGraphBindings,
  parseAccessibilitySnapshot,
  parseActionPlan,
  parseCaptureSpec,
  parseLayoutSnapshot,
} from "./validate.js";
export {
  maximumQ64Coordinate,
  minimumQ64Coordinate,
  quantizeCssPixelToQ64,
  roundNearestTiesToEven,
} from "./quantize.js";
export { normalizeLayoutProbe, normalizeLayoutSnapshot } from "./normalize-layout.js";
export type {
  NormalizedLayoutProbe,
  RawLayoutBox,
  RawLayoutComputedStyle,
  RawLayoutNode,
  RawLayoutProbe,
} from "./normalize-layout.js";
export { normalizeAccessibilitySnapshot } from "./normalize-ax.js";
export {
  maximumCaptureDimension,
  maximumCapturePixels,
  maximumCapturePngBytes,
} from "./limits.js";
export { computeFixtureActionTargetId } from "./identity.js";
export type { FixtureActionTargetIdentity } from "./identity.js";
