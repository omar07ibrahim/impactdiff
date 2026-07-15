import { resolve } from "node:path";

import {
  applyCompiledMutation,
  compileMutation,
  computeMutationTargetNodeId,
  executeMutationFixtureTask,
  launchMutationFixtureEnvironment,
  loadVerifiedMutationFixtureActionPlan,
  loadVerifiedMutationFixtureSourceState,
  openMutationFixtureSession,
  prepareMutationFixtureTask,
  probeMutation,
  validateMutationRequest,
  validateMutationRuntimeBinding,
} from "../mutations/index.js";
import type {
  MutationCleanup,
  MutationCompileResult,
  MutationFixtureEnvironment,
  MutationFixtureSession,
  MutationFixtureTaskRun,
  MutationFixtureUpstreamEvidence,
  MutationOperatorKey,
} from "../mutations/index.js";
import { PairedReleasePublisher } from "../publication/publisher.js";
import type { VerifiedPairedRelease } from "../publication/verify.js";
import { deriveMutationFixturePair } from "./derive.js";
import type { AuditedFixtureRoleRun } from "./derive.js";
import { FixturePairGenerationError } from "./errors.js";

const optionKeys = ["fixtureDirectory", "publicationRoot", "operatorKey"] as const;
const maximumPathBytes = 4_096;

export interface FreshMutationFixturePairOptions {
  readonly fixtureDirectory: string;
  readonly publicationRoot: string;
  readonly operatorKey: MutationOperatorKey;
}

type ApplicableCompilation = Extract<
  MutationCompileResult,
  { readonly status: "applicable" }
>;

interface BaselineResult {
  readonly run: AuditedFixtureRoleRun;
}

interface CandidateResult {
  readonly run: AuditedFixtureRoleRun;
  readonly compilation: ApplicableCompilation;
}

function invalidOptions(message: string, options?: ErrorOptions): never {
  throw new FixturePairGenerationError("generation.input", message, options);
}

/**
 * Copies the complete options wrapper before any asynchronous operation. Accessors,
 * inherited fields, symbols, proxies that cannot be inspected, and extra fields fail
 * closed rather than being observed later in the capture lifecycle.
 */
function snapshotOptions(value: unknown): FreshMutationFixturePairOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidOptions("fresh-pair options must be a closed plain data object");
  }

  let prototype: object | null;
  let ownKeys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch (error) {
    invalidOptions("fresh-pair options could not be inspected", { cause: error });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalidOptions("fresh-pair options must use a plain data prototype");
  }

  const expected = new Set<string>(optionKeys);
  if (
    ownKeys.length !== optionKeys.length ||
    ownKeys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    invalidOptions("fresh-pair options have unknown, hidden, or missing fields");
  }

  const snapshot: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of optionKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
      invalidOptions(`fresh-pair option ${key} could not be inspected`, {
        cause: error,
      });
    }
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      invalidOptions(`fresh-pair option ${key} must be an enumerable data property`);
    }
    snapshot[key] = descriptor.value;
  }

  const fixtureDirectory = snapshot.fixtureDirectory;
  const publicationRoot = snapshot.publicationRoot;
  const operatorKey = snapshot.operatorKey;
  if (
    typeof fixtureDirectory !== "string" ||
    fixtureDirectory.length === 0 ||
    fixtureDirectory.includes("\0") ||
    Buffer.byteLength(fixtureDirectory, "utf8") > maximumPathBytes
  ) {
    invalidOptions("fixtureDirectory must be a bounded non-empty filesystem path");
  }
  if (
    typeof publicationRoot !== "string" ||
    publicationRoot.length === 0 ||
    publicationRoot.includes("\0") ||
    Buffer.byteLength(publicationRoot, "utf8") > maximumPathBytes
  ) {
    invalidOptions("publicationRoot must be a bounded non-empty filesystem path");
  }
  if (operatorKey !== "palette_swap" && operatorKey !== "pointer_interceptor") {
    invalidOptions("operatorKey must name one supported fixture operator");
  }

  const resolvedFixtureDirectory = resolve(fixtureDirectory);
  const resolvedPublicationRoot = resolve(publicationRoot);
  if (
    Buffer.byteLength(resolvedFixtureDirectory, "utf8") > maximumPathBytes ||
    Buffer.byteLength(resolvedPublicationRoot, "utf8") > maximumPathBytes
  ) {
    invalidOptions("resolved fresh-pair paths exceed the path byte budget");
  }

  return Object.freeze({
    fixtureDirectory: resolvedFixtureDirectory,
    publicationRoot: resolvedPublicationRoot,
    operatorKey,
  });
}

function appendError(errors: unknown[], error: unknown): void {
  if (error instanceof AggregateError) {
    for (const nested of error.errors) appendError(errors, nested);
    return;
  }
  errors.push(error);
}

function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}

function assertCleanAudit(
  role: "baseline" | "candidate",
  audit: Awaited<ReturnType<MutationFixtureSession["close"]>>,
): void {
  if (audit.blocked_external_requests.length !== 0) {
    throw new FixturePairGenerationError(
      "generation.validation",
      `${role} fixture session blocked external requests and cannot enter a release`,
    );
  }
}

function auditedRoleRun(run: MutationFixtureTaskRun): AuditedFixtureRoleRun {
  const [initial, final] = run.checkpoints;
  return Object.freeze({
    checkpoints: Object.freeze([
      Object.freeze({
        checkpoint_id: initial.checkpoint_id,
        ordinal: initial.ordinal,
        screenshot: Buffer.from(initial.screenshot),
        accessibility_tree: Buffer.from(initial.accessibility_tree),
        layout_graph: Buffer.from(initial.layout_graph),
      }),
      Object.freeze({
        checkpoint_id: final.checkpoint_id,
        ordinal: final.ordinal,
        screenshot: Buffer.from(final.screenshot),
        accessibility_tree: Buffer.from(final.accessibility_tree),
        layout_graph: Buffer.from(final.layout_graph),
      }),
    ] as const),
    task_success: run.task_success,
    first_unsatisfied_step_id: run.first_unsatisfied_step_id,
    virtual_elapsed_ms: run.virtual_elapsed_ms,
  });
}

async function closeAuditedSession(
  role: "baseline" | "candidate",
  session: MutationFixtureSession,
  errors: unknown[],
): Promise<boolean> {
  try {
    const audit = await session.close();
    assertCleanAudit(role, audit);
    return true;
  } catch (error) {
    appendError(errors, error);
    return false;
  }
}

async function executeBaselineRole(
  environment: MutationFixtureEnvironment,
  upstream: MutationFixtureUpstreamEvidence,
): Promise<BaselineResult> {
  let session: MutationFixtureSession | undefined;
  let taskRun: MutationFixtureTaskRun | undefined;
  let closedAndAudited = false;
  const errors: unknown[] = [];
  try {
    session = await openMutationFixtureSession(environment, upstream);
    await prepareMutationFixtureTask(session);
    taskRun = await executeMutationFixtureTask(session);
  } catch (error) {
    appendError(errors, error);
  }

  if (session !== undefined) {
    closedAndAudited = await closeAuditedSession("baseline", session, errors);
  }
  throwCollectedErrors(errors, "baseline capture and lifecycle cleanup failed");
  if (taskRun === undefined || !closedAndAudited) {
    throw new FixturePairGenerationError(
      "generation.outcome",
      "baseline role did not produce one closed and audited task run",
    );
  }
  return Object.freeze({ run: auditedRoleRun(taskRun) });
}

async function executeCandidateRole(
  environment: MutationFixtureEnvironment,
  upstream: MutationFixtureUpstreamEvidence,
  request: ReturnType<typeof validateMutationRequest>,
): Promise<CandidateResult> {
  let session: MutationFixtureSession | undefined;
  let cleanup: MutationCleanup | undefined;
  let taskRun: MutationFixtureTaskRun | undefined;
  let compilation: ApplicableCompilation | undefined;
  let closedAndAudited = false;
  const errors: unknown[] = [];
  try {
    session = await openMutationFixtureSession(environment, upstream);
    await prepareMutationFixtureTask(session);
    const probe = await probeMutation(session, request);
    const compiled = compileMutation(request, probe);
    if (compiled.status !== "applicable") {
      throw new FixturePairGenerationError(
        "generation.compilation",
        "the fixed candidate mutation did not satisfy its live preconditions",
      );
    }
    compilation = compiled;
    cleanup = await applyCompiledMutation(
      session,
      compilation.plan,
      compilation.preconditions,
    );
    taskRun = await executeMutationFixtureTask(session);
  } catch (error) {
    appendError(errors, error);
  }

  if (cleanup !== undefined) {
    try {
      await cleanup();
    } catch (error) {
      appendError(errors, error);
    }
  }
  if (session !== undefined) {
    closedAndAudited = await closeAuditedSession("candidate", session, errors);
  }
  throwCollectedErrors(errors, "candidate capture and lifecycle cleanup failed");
  if (taskRun === undefined || compilation === undefined || !closedAndAudited) {
    throw new FixturePairGenerationError(
      "generation.outcome",
      "candidate role did not produce one closed and audited task run",
    );
  }
  return Object.freeze({ run: auditedRoleRun(taskRun), compilation });
}

function mutationRequest(
  operatorKey: MutationOperatorKey,
  binding: ReturnType<typeof validateMutationRuntimeBinding>,
): ReturnType<typeof validateMutationRequest> {
  const locator = Object.freeze({
    strategy: "test_id" as const,
    value: operatorKey === "palette_swap" ? "app-root" : "place-order",
  });
  return validateMutationRequest({
    contract: "impactdiff.mutation-request",
    version: 1,
    source_state_id: binding.source_state_id,
    task_id: binding.task_id,
    environment_id: binding.environment_id,
    operator_key: operatorKey,
    operator_version: 1,
    replicate_index: 0,
    target: {
      node_id: computeMutationTargetNodeId(binding.source_state_id, locator),
      locator,
    },
  });
}

async function publishSnapshottedFreshPair(
  options: FreshMutationFixturePairOptions,
): Promise<VerifiedPairedRelease> {
  // Opening first is the canonical repository/topology preflight. It may create the
  // reserved releases directory or recover owned staging entries, but cannot expose a
  // new release. The publisher is retained until all browser capabilities are closed.
  const publisher = await PairedReleasePublisher.open(options.publicationRoot);
  const actionPlan = loadVerifiedMutationFixtureActionPlan();
  const sourceState = await loadVerifiedMutationFixtureSourceState(
    options.fixtureDirectory,
  );

  let environment: MutationFixtureEnvironment | undefined;
  let captureSpec: MutationFixtureUpstreamEvidence["capture_spec"] | undefined;
  let binding: ReturnType<typeof validateMutationRuntimeBinding> | undefined;
  let baseline: BaselineResult | undefined;
  let candidate: CandidateResult | undefined;
  const errors: unknown[] = [];
  try {
    environment = await launchMutationFixtureEnvironment(options.fixtureDirectory);
    captureSpec = environment.capture_spec;
    const upstream = Object.freeze({
      source_state: sourceState,
      action_plan: actionPlan,
      capture_spec: captureSpec,
    });
    binding = validateMutationRuntimeBinding(upstream);

    // The request—including fixed replicate zero—is committed before either role
    // observes an outcome. Each role then receives a distinct sequential session.
    const request = mutationRequest(options.operatorKey, binding);
    baseline = await executeBaselineRole(environment, upstream);
    candidate = await executeCandidateRole(environment, upstream, request);
  } catch (error) {
    appendError(errors, error);
  }

  if (environment !== undefined) {
    try {
      await environment.close();
    } catch (error) {
      appendError(errors, error);
      // Browser shutdown is retryable only as cleanup. The first failure remains
      // fatal even if this one cleanup retry succeeds.
      try {
        await environment.close();
      } catch (cleanupError) {
        appendError(errors, cleanupError);
      }
    }
  }
  throwCollectedErrors(errors, "fresh-pair generation and environment cleanup failed");
  if (
    captureSpec === undefined ||
    binding === undefined ||
    baseline === undefined ||
    candidate === undefined
  ) {
    throw new FixturePairGenerationError(
      "generation.outcome",
      "fresh-pair generation produced no complete audited role pair",
    );
  }

  const derived = deriveMutationFixturePair({
    sourceState,
    actionPlan,
    captureSpec,
    binding,
    compilation: candidate.compilation,
    baseline: baseline.run,
    candidate: candidate.run,
  });
  void derived.resolved;
  return publisher.publish(derived.publicationInput);
}

export function publishFreshMutationFixturePair(
  options: FreshMutationFixturePairOptions,
): Promise<VerifiedPairedRelease>;
export function publishFreshMutationFixturePair(
  options: unknown,
): Promise<VerifiedPairedRelease> {
  return publishSnapshottedFreshPair(snapshotOptions(options));
}
