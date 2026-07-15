import type { Browser } from "@playwright/test";

import type { CaptureSpec } from "../../capture/schema.js";
import { parseCaptureSpec } from "../../capture/validate.js";
import type { ArtifactRef } from "../../contracts/artifacts.js";
import { computeEnvironmentId, sha256Hex } from "../../contracts/canonical.js";
import {
  acquireMutationFixtureEnvironment,
  launchMutationFixtureEnvironment,
  type MutationFixtureEnvironment,
} from "../../mutations/environment.js";
import {
  loadPilotFixtureAuthoringSnapshot,
  type PilotFixtureAuthoringSnapshot,
} from "../fixture/package.js";
import { PilotFixtureAuthoringRuntimeError } from "./errors.js";

const environmentConstructorToken = Symbol(
  "impactdiff.pilot-fixture-authoring-environment",
);
const environmentStates = new WeakMap<
  PilotFixtureAuthoringEnvironment,
  PilotFixtureAuthoringEnvironmentState
>();

type EnvironmentLifecycle = "open" | "poisoned" | "closing" | "closed";

interface PilotFixtureAuthoringEnvironmentState {
  readonly mutationEnvironment: MutationFixtureEnvironment;
  readonly captureSpec: CaptureSpec;
  readonly captureSpecReference: ArtifactRef;
  readonly captureSpecBytes: Buffer;
  readonly environmentId: string;
  readonly authoringSnapshot: PilotFixtureAuthoringSnapshot;
  activeLease: boolean;
  lifecycle: EnvironmentLifecycle;
}

export interface PilotFixtureAuthoringCaptureSpecArtifact {
  readonly reference: ArtifactRef;
  readonly bytes: Uint8Array;
}

/** @internal Consumed only by the branded Pilot replay/session factory. */
export interface PilotFixtureAuthoringEnvironmentLease {
  readonly browser: Browser;
  readonly capture_spec: CaptureSpec;
  readonly capture_spec_reference: ArtifactRef;
  readonly environment_id: string;
  readonly authoring_snapshot: PilotFixtureAuthoringSnapshot;
  readonly release: () => void;
  readonly invalidate: () => void;
}

function fail(code: string, message: string, options?: ErrorOptions): never {
  throw new PilotFixtureAuthoringRuntimeError(code, message, options);
}

function captureSpecReference(reference: ArtifactRef): ArtifactRef {
  return Object.freeze({ ...reference });
}

function environmentState(value: unknown): PilotFixtureAuthoringEnvironmentState {
  if (value === null || typeof value !== "object") {
    fail(
      "pilot_runtime.untrusted_environment",
      "Pilot authoring environment must be created by the verified launcher",
    );
  }
  const state = environmentStates.get(value as PilotFixtureAuthoringEnvironment);
  if (
    state === undefined ||
    Object.getPrototypeOf(value) !== PilotFixtureAuthoringEnvironment.prototype
  ) {
    fail(
      "pilot_runtime.untrusted_environment",
      "Pilot authoring environment capability is not registered",
    );
  }
  return state;
}

function verifyCaptureSpecArtifact(reference: ArtifactRef, bytes: Buffer): void {
  if (
    reference.sha256 !== sha256Hex(bytes) ||
    reference.byte_length !== bytes.byteLength ||
    reference.media_type !== "application/vnd.impactdiff.capture-spec+json" ||
    reference.format_version !== 1
  ) {
    fail(
      "pilot_runtime.capture_spec_binding",
      "verified browser CaptureSpec bytes differ from their artifact reference",
    );
  }
}

function verifyManifestEnvironment(
  snapshot: PilotFixtureAuthoringSnapshot,
  captureSpec: CaptureSpec,
): void {
  const manifest = snapshot.authoring_package.manifest;
  const manifestEnvironment = manifest.environment;
  const { display, internationalization, media } = captureSpec;
  if (
    display.viewport.width !== manifestEnvironment.viewport.width ||
    display.viewport.height !== manifestEnvironment.viewport.height ||
    display.screen.width !== manifestEnvironment.viewport.width ||
    display.screen.height !== manifestEnvironment.viewport.height ||
    display.device_scale_factor !== manifestEnvironment.device_scale_factor ||
    internationalization.locale !== manifestEnvironment.locale ||
    internationalization.timezone_id !== manifestEnvironment.timezone ||
    media.color_scheme !== manifestEnvironment.color_scheme
  ) {
    fail(
      "pilot_runtime.environment_binding",
      "fixture manifest display, locale, timezone, or color scheme differs from the verified CaptureSpec",
    );
  }

  const manifestFont = manifest.font;
  const resource = manifest.resources.find(({ path }) => path === manifestFont.path);
  const [captureFont] = captureSpec.fonts.files;
  if (
    resource === undefined ||
    captureSpec.fonts.files.length !== 1 ||
    captureFont === undefined ||
    captureFont.logical_name !== "noto-sans-latin-standard-normal" ||
    captureFont.format !== "woff2" ||
    captureFont.sha256 !== manifestFont.sha256 ||
    captureFont.sha256 !== resource.sha256 ||
    captureFont.byte_length !== resource.byte_length
  ) {
    fail(
      "pilot_runtime.font_binding",
      "fixture manifest font differs from the verified CaptureSpec font bundle",
    );
  }
}

async function closeFailedLaunch(
  environment: MutationFixtureEnvironment,
  launchError: unknown,
): Promise<never> {
  let cause = launchError;
  try {
    await environment.close();
  } catch (cleanupError) {
    cause = new AggregateError(
      [launchError, cleanupError],
      "Pilot authoring environment initialization and browser cleanup both failed",
    );
  }
  if (launchError instanceof PilotFixtureAuthoringRuntimeError) {
    throw new PilotFixtureAuthoringRuntimeError(launchError.code, launchError.message, {
      cause,
    });
  }
  fail(
    "pilot_runtime.environment_initialization",
    "verified Pilot authoring environment could not be initialized",
    { cause },
  );
}

export class PilotFixtureAuthoringEnvironment {
  private constructor(
    token: symbol,
    state: Omit<PilotFixtureAuthoringEnvironmentState, "activeLease" | "lifecycle">,
  ) {
    if (token !== environmentConstructorToken) {
      fail(
        "pilot_runtime.untrusted_environment",
        "Pilot authoring environments can only be created by the verified launcher",
      );
    }
    environmentStates.set(this, {
      ...state,
      activeLease: false,
      lifecycle: "open",
    });
    Object.freeze(this);
  }

  get capture_spec(): PilotFixtureAuthoringCaptureSpecArtifact {
    const state = environmentState(this);
    return Object.freeze({
      reference: captureSpecReference(state.captureSpecReference),
      bytes: Buffer.from(state.captureSpecBytes),
    });
  }

  async close(): Promise<void> {
    const state = environmentState(this);
    if (state.lifecycle === "closed") {
      fail(
        "pilot_runtime.environment_closed",
        "Pilot authoring environment is already closed",
      );
    }
    if (state.lifecycle === "closing") {
      fail(
        "pilot_runtime.environment_closing",
        "Pilot authoring environment is already closing",
      );
    }
    if (state.activeLease) {
      fail(
        "pilot_runtime.environment_in_use",
        "Pilot authoring environment cannot close while an attempt is active",
      );
    }

    state.lifecycle = "closing";
    try {
      await state.mutationEnvironment.close();
      state.lifecycle = "closed";
    } catch (error) {
      state.lifecycle = "poisoned";
      fail(
        "pilot_runtime.environment_close",
        "Pilot authoring environment browser failed to close and remains available only for cleanup",
        { cause: error },
      );
    }
  }
}

Object.freeze(PilotFixtureAuthoringEnvironment.prototype);

/**
 * Snapshots the complete fixture byte tree before starting the verified browser.
 * The returned public capability exposes no live fixture-directory authority.
 */
export async function launchPilotFixtureAuthoringEnvironment(
  fixtureDirectory: string,
): Promise<PilotFixtureAuthoringEnvironment> {
  let snapshot: PilotFixtureAuthoringSnapshot;
  try {
    snapshot = await loadPilotFixtureAuthoringSnapshot(fixtureDirectory);
  } catch (error) {
    fail(
      "pilot_runtime.fixture_snapshot",
      "Pilot fixture authoring snapshot could not be loaded",
      { cause: error },
    );
  }

  let mutationEnvironment: MutationFixtureEnvironment;
  try {
    mutationEnvironment = await launchMutationFixtureEnvironment(fixtureDirectory);
  } catch (error) {
    fail(
      "pilot_runtime.environment_launch",
      "verified Pilot browser environment could not be launched",
      { cause: error },
    );
  }

  try {
    const captureArtifact = mutationEnvironment.capture_spec;
    const captureSpecBytes = Buffer.from(captureArtifact.bytes);
    verifyCaptureSpecArtifact(captureArtifact.reference, captureSpecBytes);
    const captureSpec = parseCaptureSpec(captureSpecBytes);
    verifyManifestEnvironment(snapshot, captureSpec);
    const reference = captureSpecReference(captureArtifact.reference);
    return Reflect.construct(PilotFixtureAuthoringEnvironment, [
      environmentConstructorToken,
      {
        mutationEnvironment,
        captureSpec,
        captureSpecReference: reference,
        captureSpecBytes,
        environmentId: computeEnvironmentId(reference),
        authoringSnapshot: snapshot,
      },
    ]) as PilotFixtureAuthoringEnvironment;
  } catch (error) {
    return closeFailedLaunch(mutationEnvironment, error);
  }
}

/** @internal Used only by the branded Pilot replay/session factory. */
export function acquirePilotFixtureAuthoringEnvironment(
  environment: unknown,
): PilotFixtureAuthoringEnvironmentLease {
  const state = environmentState(environment);
  if (state.lifecycle === "closed") {
    fail(
      "pilot_runtime.environment_closed",
      "Pilot authoring environment browser is not available",
    );
  }
  if (state.lifecycle === "closing") {
    fail(
      "pilot_runtime.environment_closing",
      "Pilot authoring environment browser is closing",
    );
  }
  if (state.lifecycle === "poisoned") {
    fail(
      "pilot_runtime.environment_poisoned",
      "Pilot authoring environment is poisoned and cannot be reused",
    );
  }
  if (state.activeLease) {
    fail(
      "pilot_runtime.environment_in_use",
      "Pilot authoring environment permits only one active attempt",
    );
  }

  let mutationLease;
  try {
    mutationLease = acquireMutationFixtureEnvironment(
      state.mutationEnvironment,
      state.captureSpecReference,
    );
  } catch (error) {
    state.lifecycle = "poisoned";
    fail(
      "pilot_runtime.environment_poisoned",
      "verified browser capability could not be acquired for Pilot authoring",
      { cause: error },
    );
  }
  state.activeLease = true;

  let finalized = false;
  const finish = (reusable: boolean): void => {
    if (finalized) {
      fail(
        "pilot_runtime.environment_lease",
        "Pilot authoring environment lease was finalized more than once",
      );
    }
    finalized = true;
    state.activeLease = false;
    try {
      if (reusable) {
        mutationLease.release();
      } else {
        mutationLease.invalidate();
      }
    } catch (error) {
      state.lifecycle = "poisoned";
      fail(
        "pilot_runtime.environment_lease",
        "verified browser lease could not be finalized",
        { cause: error },
      );
    }
    if (!reusable || !mutationLease.browser.isConnected()) {
      state.lifecycle = "poisoned";
    }
  };

  return Object.freeze({
    browser: mutationLease.browser,
    capture_spec: state.captureSpec,
    capture_spec_reference: captureSpecReference(state.captureSpecReference),
    environment_id: state.environmentId,
    authoring_snapshot: state.authoringSnapshot,
    release: () => finish(true),
    invalidate: () => finish(false),
  });
}
